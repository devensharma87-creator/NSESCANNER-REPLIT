/**
 * Zerodha Kite Connect authentication.
 *
 * Flow:
 *   1. User clicks "Login to Kite" → we redirect them to
 *      `https://kite.zerodha.com/connect/login?api_key=...&v=3`.
 *   2. Zerodha redirects back to our `/api/kite/callback` with `request_token`.
 *   3. We POST `request_token + api_key + checksum(api_key+request_token+api_secret)`
 *      to `/session/token` and receive the day's `access_token`.
 *   4. We store the access_token in Postgres (`kite_session` row id="active").
 *   5. The token expires at ~06:00 IST the next morning; user re-logins daily.
 *
 * Reads `KITE_API_KEY` and `KITE_API_SECRET` from env. The user's daily
 * access_token lives only in DB, never in env.
 */
import { db, kiteSessionTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
// @ts-expect-error: kiteconnect publishes CJS with side-effect default
import { KiteConnect } from "kiteconnect";

const ACTIVE_ID = "active";
const KITE_LOGIN_BASE = "https://kite.zerodha.com/connect/login";

export interface KiteCreds {
  apiKey: string;
  apiSecret: string;
}

export interface ActiveSession {
  apiKey: string;
  accessToken: string;
  userId: string | null;
  userName: string | null;
  loginTime: Date;
  expiresAt: Date;
}

/** Read API key + secret from env. Returns null if either is missing. */
export function getKiteCreds(): KiteCreds | null {
  const apiKey = process.env["KITE_API_KEY"]?.trim();
  const apiSecret = process.env["KITE_API_SECRET"]?.trim();
  if (!apiKey || !apiSecret) return null;
  return { apiKey, apiSecret };
}

export function buildLoginUrl(apiKey: string): string {
  const params = new URLSearchParams({ api_key: apiKey, v: "3" });
  return `${KITE_LOGIN_BASE}?${params.toString()}`;
}

/** Compute the next 06:00 IST timestamp after `from`. Kite tokens die there. */
function next6amIST(from: Date = new Date()): Date {
  const istNow = new Date(from.getTime() + 5.5 * 3600 * 1000);
  const y = istNow.getUTCFullYear();
  const m = istNow.getUTCMonth();
  const d = istNow.getUTCDate();
  const h = istNow.getUTCHours();
  // 06:00 IST = 00:30 UTC of the same calendar day
  let target = new Date(Date.UTC(y, m, d, 0, 30, 0));
  if (h >= 6) target = new Date(target.getTime() + 24 * 3600 * 1000);
  return target;
}

/** Exchange request_token for an access_token, persist it, return the session. */
export async function completeLogin(requestToken: string): Promise<ActiveSession> {
  const creds = getKiteCreds();
  if (!creds) throw new Error("KITE_API_KEY and KITE_API_SECRET must be configured");

  const kc = new KiteConnect({ api_key: creds.apiKey });
  // generateSession returns SessionData (camel/snake mix in TS types)
  const session = (await kc.generateSession(requestToken, creds.apiSecret)) as {
    access_token: string;
    public_token?: string;
    user_id?: string;
    user_name?: string;
    login_time?: string;
  };

  const now = new Date();
  const expiresAt = next6amIST(now);
  const row = {
    id: ACTIVE_ID,
    apiKey: creds.apiKey,
    accessToken: session.access_token,
    publicToken: session.public_token ?? null,
    userId: session.user_id ?? null,
    userName: session.user_name ?? null,
    loginTime: now,
    expiresAt,
  };

  await db
    .insert(kiteSessionTable)
    .values(row)
    .onConflictDoUpdate({
      target: kiteSessionTable.id,
      set: {
        apiKey: row.apiKey,
        accessToken: row.accessToken,
        publicToken: row.publicToken,
        userId: row.userId,
        userName: row.userName,
        loginTime: row.loginTime,
        expiresAt: row.expiresAt,
      },
    });

  logger.info({ userId: row.userId, expiresAt: row.expiresAt.toISOString() }, "Kite session stored");
  return {
    apiKey: row.apiKey,
    accessToken: row.accessToken,
    userId: row.userId,
    userName: row.userName,
    loginTime: row.loginTime,
    expiresAt: row.expiresAt,
  };
}

/** Read the active (non-expired) Kite session, if any. */
export async function getActiveSession(): Promise<ActiveSession | null> {
  try {
    const rows = await db.select().from(kiteSessionTable).where(eq(kiteSessionTable.id, ACTIVE_ID)).limit(1);
    const r = rows[0];
    if (!r) return null;
    if (r.expiresAt.getTime() <= Date.now()) return null;
    return {
      apiKey: r.apiKey,
      accessToken: r.accessToken,
      userId: r.userId,
      userName: r.userName,
      loginTime: r.loginTime,
      expiresAt: r.expiresAt,
    };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "Kite session read failed");
    return null;
  }
}

/** Delete the active session (manual logout). */
export async function clearSession(): Promise<void> {
  await db.delete(kiteSessionTable).where(eq(kiteSessionTable.id, ACTIVE_ID));
  logger.info("Kite session cleared");
}

/** Build a KiteConnect REST client from the active session, or return null. */
export async function getRestClient(): Promise<{ kc: any; session: ActiveSession } | null> {
  const session = await getActiveSession();
  if (!session) return null;
  const kc = new KiteConnect({ api_key: session.apiKey });
  kc.setAccessToken(session.accessToken);
  return { kc, session };
}
