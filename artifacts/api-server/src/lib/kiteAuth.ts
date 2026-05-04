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

/** Payload shape returned by /api/kite/export-session and consumed by
 *  /api/kite/import-session. Timestamps are ISO strings. */
export interface ExportedSession {
  apiKey: string;
  accessToken: string;
  publicToken: string | null;
  userId: string | null;
  userName: string | null;
  loginTime: string;
  expiresAt: string;
}

/** Persist a session row that was minted on a different environment (e.g.
 *  the production server). We do NOT contact Zerodha — the access_token is
 *  taken as-is. Returns the active session record. */
export async function storeImportedSession(s: ExportedSession): Promise<ActiveSession> {
  const loginTime = new Date(s.loginTime);
  const expiresAt = new Date(s.expiresAt);
  if (Number.isNaN(loginTime.getTime()) || Number.isNaN(expiresAt.getTime())) {
    throw new Error("Imported session has invalid timestamps");
  }
  if (expiresAt.getTime() <= Date.now()) {
    throw new Error("Imported session is already expired");
  }
  if (!s.apiKey || !s.accessToken) {
    throw new Error("Imported session is missing apiKey or accessToken");
  }
  const row = {
    id: ACTIVE_ID,
    apiKey: s.apiKey,
    accessToken: s.accessToken,
    publicToken: s.publicToken ?? null,
    userId: s.userId ?? null,
    userName: s.userName ?? null,
    loginTime,
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
  logger.info(
    { userId: row.userId, expiresAt: row.expiresAt.toISOString() },
    "Kite session imported from peer environment",
  );
  return {
    apiKey: row.apiKey,
    accessToken: row.accessToken,
    userId: row.userId,
    userName: row.userName,
    loginTime: row.loginTime,
    expiresAt: row.expiresAt,
  };
}

/** Build a KiteConnect REST client from the active session, or return null. */
export async function getRestClient(): Promise<{ kc: any; session: ActiveSession } | null> {
  const session = await getActiveSession();
  if (!session) return null;
  const kc = new KiteConnect({ api_key: session.apiKey });
  kc.setAccessToken(session.accessToken);
  return { kc, session };
}

/**
 * Auto-mirror the Kite session from a production peer on startup.
 *
 * Called by bootstrapKite() when no local session exists and
 * KITE_MIRROR_URL is configured (e.g. "https://marketscannerbydev.in").
 * Uses the same server-to-server export/import flow as the manual
 * /api/kite/import-session route, but fires automatically so the dev
 * environment picks up the daily login without any user intervention.
 *
 * Returns the imported session on success, null on any failure (logged).
 */
export async function autoMirrorSession(): Promise<ActiveSession | null> {
  const mirrorUrl = (process.env["KITE_MIRROR_URL"] ?? "").trim();
  const password  = (process.env["APP_ACCESS_PASSWORD"] ?? "").trim();
  if (!mirrorUrl || !password) return null;

  let base: URL;
  try {
    base = new URL(mirrorUrl);
  } catch {
    logger.info({ mirrorUrl }, "Auto-mirror: KITE_MIRROR_URL is not a valid URL");
    return null;
  }
  const host = base.hostname.toLowerCase();
  const isLoopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (base.protocol === "http:" && !isLoopback) {
    logger.info({ mirrorUrl }, "Auto-mirror: refusing http for non-loopback host (use https)");
    return null;
  }
  const ALLOWED_PEER_HOSTS = (process.env["KITE_MIRROR_ALLOWED_HOSTS"] ?? "marketscannerbydev.in,localhost,127.0.0.1")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (!ALLOWED_PEER_HOSTS.includes(host)) {
    logger.info(
      { host, allowed: ALLOWED_PEER_HOSTS },
      "Auto-mirror: host not in allowed peer list (set KITE_MIRROR_ALLOWED_HOSTS to override)",
    );
    return null;
  }

  const exportUrl = new URL("/api/kite/export-session", base).toString();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    let resp: Response;
    try {
      resp = await fetch(exportUrl, {
        method: "GET",
        headers: { "x-app-password": password, accept: "application/json" },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      logger.info(
        { status: resp.status, body: body.slice(0, 200) },
        "Auto-mirror: production has no exportable session (or auth mismatch)",
      );
      return null;
    }
    const payload = (await resp.json()) as ExportedSession;
    const stored = await storeImportedSession(payload);
    logger.info(
      { userId: stored.userId, expiresAt: stored.expiresAt.toISOString() },
      "Auto-mirror: Kite session imported from production on startup",
    );
    return stored;
  } catch (err) {
    logger.info(
      { err: (err as Error).message, url: exportUrl },
      "Auto-mirror: could not reach production (expected if offline or no session)",
    );
    return null;
  }
}
