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
import { loadBlob, saveBlob } from "./diskCache";

/**
 * Hard per-request timeout for every Kite REST call.
 *
 * Without this the KiteConnect SDK uses no timeout (axios default = 0 =
 * infinite), so a slow `getHistoricalData` response hangs for the OS TCP
 * reset interval (30–60 s). During market hours that blocks the shared
 * historical-data throttle slot for up to 60 s, starving the F&O signal
 * sweep and producing a cascade of "ECONNABORTED" / "no_live_kite_intraday"
 * suppressions even when the Kite session is perfectly valid.
 *
 * 15 s gives `getHistoricalData` enough room for large daily-bar series
 * (180-day history) and large instrument CSVs (NFO/BFO dumps are ~1–3 MB)
 * while failing fast enough that the throttle queue drains normally.
 */
import {
  encryptToken,
  decryptToken,
  isEncrypted,
  isEncryptionKeyConfigured,
} from "./kiteCrypto";

/**
 * Hard per-request timeout for every Kite REST call.
 *
 * Without this the KiteConnect SDK uses no timeout (axios default = undefined =
 * infinite), so a slow `getHistoricalData` response hangs for the OS TCP
 * reset interval (30–60 s). During market hours that blocks the shared
 * historical-data throttle slot for up to 60 s, starving the F&O signal
 * sweep and producing a cascade of "ECONNABORTED" / "no_live_kite_intraday"
 * suppressions even when the Kite session is perfectly valid.
 *
 * 15 s gives `getHistoricalData` enough room for large daily-bar series
 * (180-day history) and large instrument CSVs (NFO/BFO dumps are ~1–3 MB)
 * while failing fast enough that the throttle queue drains normally.
 */
const KITE_HTTP_TIMEOUT_MS = 15_000;

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

/**
 * Classified result code from a Kite session DB read.
 *
 * - DB_SESSION_OK             — session row present, valid, decrypted.
 * - DB_SESSION_MISSING        — no row found in kite_session.
 * - DB_SESSION_EXPIRED        — row present but expiresAt is in the past.
 * - DB_POOL_CONNECTION_TERMINATED — DB pool handed a zombie/dead TCP
 *   connection; a 200 ms retry was attempted automatically.
 * - DB_SESSION_READ_FAILED    — DB query or decrypt threw an unexpected error.
 */
export type KiteSessionReadCode =
  | "DB_SESSION_OK"
  | "DB_SESSION_MISSING"
  | "DB_SESSION_EXPIRED"
  | "DB_POOL_CONNECTION_TERMINATED"
  | "DB_SESSION_READ_FAILED";

export interface ActiveSessionStatus {
  session: ActiveSession | null;
  code: KiteSessionReadCode;
  /** True when the primary pool read hit a zombie connection but the
   *  200 ms retry succeeded — useful for diagnostic surfaces. */
  recoveredByRetry?: true;
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

  const kc = new KiteConnect({ api_key: creds.apiKey, timeout: KITE_HTTP_TIMEOUT_MS });
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
  // Persist as ciphertext when KITE_TOKEN_ENC_KEY is set; passthrough otherwise.
  const dbRow = {
    id: ACTIVE_ID,
    apiKey: encryptToken(creds.apiKey),
    accessToken: encryptToken(session.access_token),
    publicToken: session.public_token ? encryptToken(session.public_token) : null,
    userId: session.user_id ?? null,
    userName: session.user_name ?? null,
    loginTime: now,
    expiresAt,
  };

  await db
    .insert(kiteSessionTable)
    .values(dbRow)
    .onConflictDoUpdate({
      target: kiteSessionTable.id,
      set: {
        apiKey: dbRow.apiKey,
        accessToken: dbRow.accessToken,
        publicToken: dbRow.publicToken,
        userId: dbRow.userId,
        userName: dbRow.userName,
        loginTime: dbRow.loginTime,
        expiresAt: dbRow.expiresAt,
      },
    });

  logger.info(
    {
      userId: dbRow.userId,
      expiresAt: dbRow.expiresAt.toISOString(),
      encryptedAtRest: isEncryptionKeyConfigured(),
    },
    "Kite session stored",
  );
  return {
    apiKey: creds.apiKey,
    accessToken: session.access_token,
    userId: session.user_id ?? null,
    userName: session.user_name ?? null,
    loginTime: now,
    expiresAt,
  };
}

/** Read the active (non-expired) Kite session, if any.
 *
 *  Decrypts the token columns transparently. If a row is still in legacy
 *  plaintext format AND KITE_TOKEN_ENC_KEY is now configured, lazily
 *  re-writes it as ciphertext so the next dump is clean. Lazy migration
 *  failures never fail the read (we have a working session — log and move on).
 */
/**
 * Detect whether a DB error is a connection-termination class error.
 *
 * These are transient pool errors where `pg.Pool` handed out a stale/zombie
 * TCP connection that the managed-PG side had already half-closed.  Drizzle
 * surfaces this as a "Failed query" message with an empty or absent cause
 * body — the exact fingerprint observed in production against `kite_session`,
 * `option_signal_history`, and `global_screener_presets`.
 *
 * We also recognise socket-level signals (ECONNRESET, broken pipe) and the
 * PostgreSQL SQLSTATE codes for admin-shutdown (57P01) and connection-failure
 * (08006) that bubble up through the cause chain.
 */
function isDbConnectionTerminated(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? "").toLowerCase();
  const causeMsg = String((err as any)?.cause?.message ?? "").toLowerCase();
  const causeCode = String((err as any)?.cause?.code ?? "");
  if (msg.includes("connection terminated") || causeMsg.includes("connection terminated")) return true;
  if (msg.includes("econnreset") || causeMsg.includes("econnreset")) return true;
  if (msg.includes("broken pipe") || causeMsg.includes("broken pipe")) return true;
  // Drizzle zombie-connection fingerprint: starts with "failed query" and
  // the underlying cause has no message body.
  if (msg.startsWith("failed query") && !causeMsg) return true;
  // SQLSTATE: 57P01 = admin_shutdown, 08006 = connection_failure
  if (causeCode === "57P01" || causeCode === "08006") return true;
  return false;
}

/**
 * Read the active Kite session from the DB pool and return a classified
 * status result.
 *
 * On a DB pool connection-termination error (zombie TCP connection), retries
 * once after 200 ms so a transient pool hiccup does not suppress F&O signals
 * for the rest of the cycle.  If the retry also fails, returns
 * `code: "DB_SESSION_READ_FAILED"` — never treats an uncertain DB state as
 * "session valid".
 *
 * Logs are structured for grep: look for `dbErrCode` in production logs.
 * Access-token values are NEVER logged.
 */
export async function getActiveSessionStatus(): Promise<ActiveSessionStatus> {
  async function tryRead(): Promise<
    { result: ActiveSessionStatus } | { connectionTerminated: true }
  > {
    try {
      const rows = await db
        .select()
        .from(kiteSessionTable)
        .where(eq(kiteSessionTable.id, ACTIVE_ID))
        .limit(1);
      const r = rows[0];
      if (!r) return { result: { session: null, code: "DB_SESSION_MISSING" } };
      if (r.expiresAt.getTime() <= Date.now()) return { result: { session: null, code: "DB_SESSION_EXPIRED" } };

      let apiKey: string;
      let accessToken: string;
      let publicToken: string | null;
      try {
        apiKey = decryptToken(r.apiKey)!;
        accessToken = decryptToken(r.accessToken)!;
        publicToken = decryptToken(r.publicToken);
      } catch (decErr) {
        // Decrypt failure (key missing or tag mismatch) → treat as no session
        // so the daily login flow recovers. Don't expose token internals.
        logger.warn(
          { err: (decErr as Error).message },
          "Kite session decrypt failed — treating as no session",
        );
        return { result: { session: null, code: "DB_SESSION_READ_FAILED" } };
      }

      // Lazy migration: encrypt-on-read if the row is plaintext and a key is
      // now configured. Best-effort — never fail the read on migration failure.
      if (isEncryptionKeyConfigured() && (!isEncrypted(r.apiKey) || !isEncrypted(r.accessToken))) {
        void db
          .update(kiteSessionTable)
          .set({
            apiKey: encryptToken(apiKey),
            accessToken: encryptToken(accessToken),
            publicToken: publicToken ? encryptToken(publicToken) : null,
          })
          .where(eq(kiteSessionTable.id, ACTIVE_ID))
          .then(() => {
            logger.info({ userId: r.userId }, "Kite session migrated plaintext→encrypted at rest");
          })
          .catch((mErr: Error) => {
            logger.warn(
              { err: mErr.message },
              "Kite session lazy-encrypt migration failed (will retry next read)",
            );
          });
      }

      return {
        result: {
          session: {
            apiKey,
            accessToken,
            userId: r.userId,
            userName: r.userName,
            loginTime: r.loginTime,
            expiresAt: r.expiresAt,
          },
          code: "DB_SESSION_OK",
        },
      };
    } catch (err) {
      if (isDbConnectionTerminated(err)) return { connectionTerminated: true };
      logger.warn(
        { err: (err as Error).message, dbErrCode: "DB_SESSION_READ_FAILED" },
        "Kite session read failed",
      );
      return { result: { session: null, code: "DB_SESSION_READ_FAILED" } };
    }
  }

  const first = await tryRead();
  if ("result" in first) return first.result;

  // DB pool handed a zombie TCP connection.  Wait 200 ms so the pool can
  // evict the dead client, then try once more with a fresh checkout.
  logger.warn(
    { dbErrCode: "DB_POOL_CONNECTION_TERMINATED" },
    "Kite session read: pool zombie connection — retrying once after 200 ms",
  );
  await new Promise((r) => setTimeout(r, 200));

  const retry = await tryRead();
  if ("connectionTerminated" in retry) {
    logger.warn(
      { dbErrCode: "DB_SESSION_READ_FAILED" },
      "Kite session read: retry also hit zombie connection",
    );
    return { session: null, code: "DB_SESSION_READ_FAILED" };
  }
  if (retry.result.session) {
    logger.info(
      { dbErrCode: "DB_POOL_CONNECTION_TERMINATED", recoveredByRetry: true },
      "Kite session read: recovered after retry",
    );
    return { ...retry.result, recoveredByRetry: true };
  }
  return retry.result;
}

/** Read the active Kite session from DB. Returns null when absent, expired,
 *  or on any DB error (including pool zombie connections — retried once).
 *  Compatibility wrapper around {@link getActiveSessionStatus}. */
export async function getActiveSession(): Promise<ActiveSession | null> {
  const { session } = await getActiveSessionStatus();
  return session;
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
  // Encrypt before writing. Token values returned to the caller stay plaintext
  // so the live request flow keeps working; only the at-rest copy is sealed.
  const dbRow = {
    id: ACTIVE_ID,
    apiKey: encryptToken(s.apiKey),
    accessToken: encryptToken(s.accessToken),
    publicToken: s.publicToken ? encryptToken(s.publicToken) : null,
    userId: s.userId ?? null,
    userName: s.userName ?? null,
    loginTime,
    expiresAt,
  };
  await db
    .insert(kiteSessionTable)
    .values(dbRow)
    .onConflictDoUpdate({
      target: kiteSessionTable.id,
      set: {
        apiKey: dbRow.apiKey,
        accessToken: dbRow.accessToken,
        publicToken: dbRow.publicToken,
        userId: dbRow.userId,
        userName: dbRow.userName,
        loginTime: dbRow.loginTime,
        expiresAt: dbRow.expiresAt,
      },
    });
  logger.info(
    {
      userId: dbRow.userId,
      expiresAt: dbRow.expiresAt.toISOString(),
      encryptedAtRest: isEncryptionKeyConfigured(),
    },
    "Kite session imported from peer environment",
  );
  return {
    apiKey: s.apiKey,
    accessToken: s.accessToken,
    userId: s.userId ?? null,
    userName: s.userName ?? null,
    loginTime,
    expiresAt,
  };
}

const INSTR_CACHE_TTL = 6 * 60 * 60 * 1000;
const BASE_COOLDOWN_MS = 5 * 60 * 1000;
const MAX_COOLDOWN_MS = 30 * 60 * 1000;
const DISK_PREFIX = "kite_instruments_";
const DISK_VERSION = 1;
const FAIL_DISK_KEY = "kite_instruments_fail";

// ─── Instrument-master validation ────────────────────────────────────────────

/**
 * Minimum acceptable row count per exchange — initial operational safeguards.
 * Based on observed live counts: NSE=10022, NFO=34222, BFO=4337, BSE≥1000.
 * Conservative floors catch catastrophic fetch failures while accepting any
 * legitimately larger response.
 */
const MIN_INSTRUMENT_ROWS: Partial<Record<string, number>> = {
  NSE:  5_000,
  BSE:    500,
  NFO: 15_000,
  BFO:  2_000,
};

/**
 * If a refresh returns fewer than this fraction of the previous valid count,
 * treat it as an implausible collapse and preserve last-good instead.
 */
const COUNT_COLLAPSE_RATIO = 0.5;

export type ExchangeStatus =
  | "CURRENT"
  | "LAST_KNOWN"
  | "UNAVAILABLE"
  | "INVALID_REFRESH_REJECTED";

export type InstrumentRefreshReason =
  | "EMPTY_MASTER_REJECTED"
  | "MALFORMED_MASTER_REJECTED"
  | "IMPLAUSIBLE_ROW_COUNT_REJECTED"
  | "PROVIDER_FETCH_FAILED_LAST_GOOD_PRESERVED"
  | "PROVIDER_FETCH_FAILED_NO_LAST_GOOD"
  | "MASTER_REFRESH_COMMITTED";

/** Per-exchange status tracking — survives the lifetime of the process. */
const instrStatusByExchange = new Map<string, ExchangeStatus>();

/**
 * Validate a provider response before replacing the existing disk/memory cache.
 *
 * @param ex        Exchange identifier (NSE, BSE, NFO, BFO).
 * @param rows      Raw response from the provider (any type).
 * @param prevCount Previous valid row count (0 if no prior data).
 */
export function validateInstrumentRows(
  ex: string,
  rows: unknown,
  prevCount = 0,
): { ok: boolean; reason: InstrumentRefreshReason } {
  if (!Array.isArray(rows)) {
    return { ok: false, reason: "MALFORMED_MASTER_REJECTED" };
  }
  if (rows.length === 0) {
    return { ok: false, reason: "EMPTY_MASTER_REJECTED" };
  }
  // Verify a sample of rows have the minimum required identity fields.
  const sample = rows.slice(0, Math.min(5, rows.length));
  const hasIdentity = sample.every(
    (r) =>
      r !== null &&
      typeof r === "object" &&
      "tradingsymbol" in r &&
      "instrument_token" in r,
  );
  if (!hasIdentity) {
    return { ok: false, reason: "MALFORMED_MASTER_REJECTED" };
  }
  // Absolute floor check (exchange-aware).
  const minFloor = MIN_INSTRUMENT_ROWS[ex] ?? 100;
  if (rows.length < minFloor) {
    return { ok: false, reason: "IMPLAUSIBLE_ROW_COUNT_REJECTED" };
  }
  // Collapse check: new count < 50% of previous valid count indicates a
  // catastrophic data loss that should preserve last-good.
  if (prevCount > 0 && rows.length < prevCount * COUNT_COLLAPSE_RATIO) {
    return { ok: false, reason: "IMPLAUSIBLE_ROW_COUNT_REJECTED" };
  }
  return { ok: true, reason: "MASTER_REFRESH_COMMITTED" };
}

/** Return a snapshot of per-exchange instrument-master status. */
export function getInstrumentExchangeStatus(): Record<string, ExchangeStatus> {
  const out: Record<string, ExchangeStatus> = {};
  for (const [ex, status] of instrStatusByExchange) out[ex] = status;
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────

interface ExchangeCache { rows: any[]; ts: number }
const instrCacheByExchange = new Map<string, ExchangeCache>();
const instrInflight = new Map<string, Promise<any[]>>();
const instrFailTs = new Map<string, number>();
const instrFailCount = new Map<string, number>();
/**
 * Generation token for cooldown state. Bumped by `clearInstrumentsCooldown()`.
 * In-flight `getInstruments` callbacks capture the gen at call-time and skip
 * all post-clear state writes (cache set, fail-cooldown set, inflight delete)
 * if the generation has changed under them. Prevents stale upstream failures
 * from re-introducing cooldown after a successful force-refresh.
 */
let instrGeneration = 0;

let failCooldownHydrated = false;

interface FailEntry { ts: number; count: number }
function persistFailCooldown(): void {
  const entries: [string, FailEntry][] = [];
  for (const [ex, ts] of instrFailTs) {
    entries.push([ex, { ts, count: instrFailCount.get(ex) ?? 1 }]);
  }
  saveBlob(FAIL_DISK_KEY, DISK_VERSION, { entries });
}

function cooldownForCount(count: number): number {
  return Math.min(BASE_COOLDOWN_MS * Math.pow(2, Math.max(0, count - 1)), MAX_COOLDOWN_MS);
}

function hydrateExchangeFromDisk(ex: string): void {
  if (instrCacheByExchange.has(ex)) return;
  if (!failCooldownHydrated) {
    failCooldownHydrated = true;
    const blob = loadBlob<{ entries: [string, FailEntry][] }>(FAIL_DISK_KEY, DISK_VERSION);
    if (blob) {
      for (const [k, entry] of blob.payload.entries) {
        const cd = cooldownForCount(entry.count);
        if (Date.now() - entry.ts < cd) {
          instrFailTs.set(k, entry.ts);
          instrFailCount.set(k, entry.count);
        }
      }
      if (instrFailTs.size > 0) {
        const info: Record<string, string> = {};
        for (const [k] of instrFailTs) {
          const c = instrFailCount.get(k) ?? 1;
          info[k] = `attempt=${c}, cooldown=${Math.round(cooldownForCount(c) / 60_000)}min`;
        }
        logger.info({ exchanges: info }, "Kite instruments: cooldown restored from disk");
      }
    }
  }
  const blob = loadBlob<any[]>(`${DISK_PREFIX}${ex}`, DISK_VERSION);
  if (blob && Array.isArray(blob.payload) && blob.payload.length > 0 && Date.now() - blob.ts < INSTR_CACHE_TTL) {
    instrCacheByExchange.set(ex, { rows: blob.payload, ts: blob.ts });
    instrStatusByExchange.set(ex, "LAST_KNOWN");
    logger.info(
      { exchange: ex, count: blob.payload.length, ageMin: Math.round((Date.now() - blob.ts) / 60_000) },
      "Kite instruments: warm-started from disk",
    );
  }
}

function wrapGetInstruments(kc: any): void {
  const original = kc.getInstruments.bind(kc);
  kc.getInstruments = async (exchange: string | string[]): Promise<any[]> => {
    const ex = (Array.isArray(exchange) ? exchange[0] : exchange) as string;
    hydrateExchangeFromDisk(ex);

    const cached = instrCacheByExchange.get(ex);
    if (cached && Date.now() - cached.ts < INSTR_CACHE_TTL) return cached.rows;

    const lastFail = instrFailTs.get(ex);
    const failCount = instrFailCount.get(ex) ?? 0;
    const activeCooldown = cooldownForCount(failCount);
    if (lastFail && Date.now() - lastFail < activeCooldown) {
      return cached?.rows ?? [];
    }

    const existing = instrInflight.get(ex);
    if (existing) return existing;

    const callGen = instrGeneration;
    let promise!: Promise<any[]>;
    promise = (async () => {
      try {
        const rows = await original(exchange);
        // Generation guard: a clearInstrumentsCooldown() ran mid-flight.
        // Skip ALL state writes — the post-clear world owns the cache now.
        if (callGen !== instrGeneration) return rows;
        if (Array.isArray(rows) && rows.length > 0) {
          instrCacheByExchange.set(ex, { rows, ts: Date.now() });
          instrFailTs.delete(ex);
          instrFailCount.delete(ex);
          instrStatusByExchange.set(ex, "CURRENT");
          saveBlob(`${DISK_PREFIX}${ex}`, DISK_VERSION, rows);
          persistFailCooldown();
        }
        return rows;
      } catch (err) {
        // Same generation guard on the failure path: don't reintroduce
        // cooldown after a force-refresh has cleared it.
        if (callGen !== instrGeneration) {
          logger.warn(
            { exchange: ex, err: (err as Error).message },
            "Kite getInstruments failed (stale generation — cooldown not applied)",
          );
          if (cached) return cached.rows;
          return [];
        }
        const newCount = (instrFailCount.get(ex) ?? 0) + 1;
        instrFailTs.set(ex, Date.now());
        instrFailCount.set(ex, newCount);
        persistFailCooldown();
        const nextCd = cooldownForCount(newCount);
        logger.warn(
          { exchange: ex, err: (err as Error).message, attempt: newCount, nextCooldownMin: Math.round(nextCd / 60_000) },
          "Kite getInstruments failed",
        );
        if (cached) return cached.rows;
        return [];
      } finally {
        // Only delete the inflight entry if we still own the slot (i.e.
        // no clear happened OR the clear didn't replace our promise).
        if (callGen === instrGeneration && instrInflight.get(ex) === promise) {
          instrInflight.delete(ex);
        }
      }
    })();
    instrInflight.set(ex, promise);
    return promise;
  };
}

/**
 * Force-clear all instruments cooldown / in-memory cache state. Bumps the
 * generation token so any in-flight wrapped getInstruments call cannot
 * reintroduce cooldown after we return.
 *
 * PRESERVE-FIRST: on-disk caches are intentionally NOT wiped. The existing
 * populated disk entries serve as last-good data for `hydrateExchangeFromDisk`
 * after the in-memory clear, and as the fallback if the subsequent
 * `forceRefreshInstruments` fetch or validation fails for any exchange.
 * Status for previously-populated exchanges is set to LAST_KNOWN to reflect
 * that they are no longer serving live in-memory data.
 *
 * Returns a snapshot of what was cleared (for the API response).
 */
export function clearInstrumentsCooldown(): {
  clearedCacheExchanges: string[];
  clearedCooldownExchanges: string[];
  clearedInflight: number;
} {
  const cacheKeys = Array.from(instrCacheByExchange.keys());
  const failKeys = Array.from(instrFailTs.keys());
  const inflightCount = instrInflight.size;
  // Bump generation BEFORE clearing maps so any in-flight callback that
  // resolves after this point sees `callGen !== instrGeneration` and
  // skips its cache/cooldown writes.
  instrGeneration++;
  instrCacheByExchange.clear();
  instrFailTs.clear();
  instrFailCount.clear();
  instrInflight.clear();
  persistFailCooldown();
  // Mark previously-populated exchanges as LAST_KNOWN (data is on disk,
  // not in memory). Exchanges that were never populated remain unchanged.
  for (const ex of cacheKeys) {
    instrStatusByExchange.set(ex, "LAST_KNOWN");
  }
  return {
    clearedCacheExchanges: cacheKeys,
    clearedCooldownExchanges: failKeys,
    clearedInflight: inflightCount,
  };
}

/**
 * Admin one-shot: clears in-memory cooldown/cache, then calls the raw Kite
 * SDK `getInstruments` directly via a request-scoped, NON-wrapped KiteConnect
 * instance. This sidesteps the wrapper's swallow-and-fall-back behaviour so
 * true upstream errors propagate, while having ZERO effect on any concurrent
 * normal `getInstruments()` calls in the rest of the process (they continue
 * to flow through their own wrapped clients with full cache/cooldown semantics).
 *
 * PRESERVE-FIRST: each exchange's response is validated before the existing
 * disk/memory cache is replaced. On fetch failure or validation failure the
 * existing last-good cache is preserved and restored into memory. BSE is
 * included in the refresh alongside NSE, NFO, and BFO.
 *
 * Returns null if no Kite session is active. Otherwise returns per-exchange
 * `{count, status}` on success or `{error, status}` on failure/rejection.
 */
export async function forceRefreshInstruments(): Promise<{
  cleared: ReturnType<typeof clearInstrumentsCooldown>;
  results: Record<
    string,
    { count: number; status: ExchangeStatus } | { error: string; status: ExchangeStatus }
  >;
} | null> {
  // Check session BEFORE the in-memory clear — a 409 must be non-destructive.
  const session = await getActiveSession();
  if (!session) return null;
  const cleared = clearInstrumentsCooldown();
  // Deliberately NOT wrapped — we want the SDK's getInstruments to throw on
  // upstream failure so the admin route can report a real error.
  const rawKc = new KiteConnect({ api_key: session.apiKey, timeout: KITE_HTTP_TIMEOUT_MS });
  rawKc.setAccessToken(session.accessToken);
  const results: Record<
    string,
    { count: number; status: ExchangeStatus } | { error: string; status: ExchangeStatus }
  > = {};
  // BSE is now included so BSE-only instruments (e.g. NSDL) are always refreshed.
  const exchanges = ["NSE", "BSE", "NFO", "BFO"] as const;
  await Promise.all(
    exchanges.map(async (ex) => {
      // Snapshot the previous disk state BEFORE we attempt a refresh, so we
      // can restore last-good on validation failure or fetch error.
      const prevBlob = loadBlob<any[]>(`${DISK_PREFIX}${ex}`, DISK_VERSION);
      const prevCount =
        prevBlob && Array.isArray(prevBlob.payload) ? prevBlob.payload.length : 0;

      const restoreLastGood = (): ExchangeStatus => {
        if (prevBlob && Array.isArray(prevBlob.payload) && prevBlob.payload.length > 0) {
          instrCacheByExchange.set(ex, { rows: prevBlob.payload, ts: prevBlob.ts });
          instrStatusByExchange.set(ex, "LAST_KNOWN");
          return "LAST_KNOWN";
        }
        instrStatusByExchange.set(ex, "UNAVAILABLE");
        return "UNAVAILABLE";
      };

      try {
        const rows = (await rawKc.getInstruments(ex)) as unknown[];
        const fetchedCount = Array.isArray(rows) ? rows.length : 0;
        const validation = validateInstrumentRows(ex, rows, prevCount);

        if (!validation.ok) {
          const status = restoreLastGood();
          logger.warn(
            {
              exchange: ex,
              fetchedCount,
              prevCount,
              validationResult: validation.reason,
              cacheAction: prevCount > 0 ? "LAST_GOOD_PRESERVED" : "NONE",
              reason: validation.reason,
            },
            `Kite instruments: ${validation.reason}`,
          );
          instrStatusByExchange.set(ex, "INVALID_REFRESH_REJECTED");
          results[ex] = { error: validation.reason, status: "INVALID_REFRESH_REJECTED" };
          return;
        }

        const rowsArr = rows as any[];
        instrCacheByExchange.set(ex, { rows: rowsArr, ts: Date.now() });
        instrFailTs.delete(ex);
        instrFailCount.delete(ex);
        instrStatusByExchange.set(ex, "CURRENT");
        saveBlob(`${DISK_PREFIX}${ex}`, DISK_VERSION, rowsArr);
        logger.info(
          {
            exchange: ex,
            fetchedCount: rowsArr.length,
            prevCount,
            validationResult: "MASTER_REFRESH_COMMITTED",
            cacheAction: "REPLACED",
            reason: "MASTER_REFRESH_COMMITTED",
          },
          "Kite instruments: master refresh committed",
        );
        results[ex] = { count: rowsArr.length, status: "CURRENT" };
      } catch (err) {
        const status = restoreLastGood();
        const reason: InstrumentRefreshReason =
          prevCount > 0
            ? "PROVIDER_FETCH_FAILED_LAST_GOOD_PRESERVED"
            : "PROVIDER_FETCH_FAILED_NO_LAST_GOOD";
        logger.warn(
          {
            exchange: ex,
            err: (err as Error).message,
            prevCount,
            validationResult: reason,
            cacheAction: prevCount > 0 ? "PRESERVED" : "NONE",
            reason,
          },
          `Kite getInstruments failed: ${reason}`,
        );
        results[ex] = { error: (err as Error).message, status };
      }
    }),
  );
  return { cleared, results };
}

/**
 * Test-only: run the force-refresh exchange loop with an injected rawKc client,
 * bypassing the session check. Use this in unit tests to control provider
 * responses without a real Kite session or DB.
 *
 * @internal — do not call from production code.
 */
export async function _forTesting_forceRefreshWithClient(
  rawKc: { getInstruments: (ex: string) => Promise<unknown[]> },
): Promise<
  Record<
    string,
    { count: number; status: ExchangeStatus } | { error: string; status: ExchangeStatus }
  >
> {
  clearInstrumentsCooldown();
  const exchanges = ["NSE", "BSE", "NFO", "BFO"] as const;
  const results: Record<
    string,
    { count: number; status: ExchangeStatus } | { error: string; status: ExchangeStatus }
  > = {};
  await Promise.all(
    exchanges.map(async (ex) => {
      const prevBlob = loadBlob<any[]>(`${DISK_PREFIX}${ex}`, DISK_VERSION);
      const prevCount =
        prevBlob && Array.isArray(prevBlob.payload) ? prevBlob.payload.length : 0;

      const restoreLastGood = (): ExchangeStatus => {
        if (prevBlob && Array.isArray(prevBlob.payload) && prevBlob.payload.length > 0) {
          instrCacheByExchange.set(ex, { rows: prevBlob.payload, ts: prevBlob.ts });
          instrStatusByExchange.set(ex, "LAST_KNOWN");
          return "LAST_KNOWN";
        }
        instrStatusByExchange.set(ex, "UNAVAILABLE");
        return "UNAVAILABLE";
      };

      try {
        const rows = await rawKc.getInstruments(ex);
        const fetchedCount = Array.isArray(rows) ? rows.length : 0;
        const validation = validateInstrumentRows(ex, rows, prevCount);

        if (!validation.ok) {
          restoreLastGood();
          instrStatusByExchange.set(ex, "INVALID_REFRESH_REJECTED");
          results[ex] = { error: validation.reason, status: "INVALID_REFRESH_REJECTED" };
          return;
        }

        const rowsArr = rows as any[];
        instrCacheByExchange.set(ex, { rows: rowsArr, ts: Date.now() });
        instrFailTs.delete(ex);
        instrFailCount.delete(ex);
        instrStatusByExchange.set(ex, "CURRENT");
        saveBlob(`${DISK_PREFIX}${ex}`, DISK_VERSION, rowsArr);
        logger.info(
          { exchange: ex, fetchedCount: rowsArr.length, prevCount, reason: "MASTER_REFRESH_COMMITTED" },
          "Kite instruments [test]: master refresh committed",
        );
        results[ex] = { count: rowsArr.length, status: "CURRENT" };
      } catch (err) {
        const status = restoreLastGood();
        results[ex] = { error: (err as Error).message, status };
      }
    }),
  );
  return results;
}

/**
 * Test-only: reset all in-memory instrument state to a clean slate.
 * Use in `beforeEach` / `afterEach` so tests start from a known state.
 * @internal — do not call from production code.
 */
export function _forTesting_resetInstrumentState(): void {
  instrCacheByExchange.clear();
  instrStatusByExchange.clear();
  instrFailTs.clear();
  instrFailCount.clear();
  instrInflight.clear();
  instrGeneration++;
  // Allow hydrateExchangeFromDisk to re-read the fail-cooldown blob.
  failCooldownHydrated = false;
}

/** Build a KiteConnect REST client from the active session, or return null. */
export async function getRestClient(): Promise<{ kc: any; session: ActiveSession } | null> {
  const session = await getActiveSession();
  if (!session) return null;
  const kc = new KiteConnect({ api_key: session.apiKey, timeout: KITE_HTTP_TIMEOUT_MS });
  kc.setAccessToken(session.accessToken);
  wrapGetInstruments(kc);
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

export function exportInstrumentsCache(): { exchanges: Record<string, any[]>; ts: number } | null {
  const exchanges: Record<string, any[]> = {};
  let latestTs = 0;
  for (const [ex, cached] of instrCacheByExchange) {
    if (cached.rows.length > 0) {
      exchanges[ex] = cached.rows;
      if (cached.ts > latestTs) latestTs = cached.ts;
    }
  }
  if (Object.keys(exchanges).length === 0) return null;
  return { exchanges, ts: latestTs };
}

export function seedInstrumentsCache(exchanges: Record<string, any[]>): number {
  let total = 0;
  for (const [ex, rows] of Object.entries(exchanges)) {
    if (!Array.isArray(rows) || rows.length === 0) continue;
    instrCacheByExchange.set(ex, { rows, ts: Date.now() });
    instrFailTs.delete(ex);
    instrFailCount.delete(ex);
    saveBlob(`${DISK_PREFIX}${ex}`, DISK_VERSION, rows);
    total += rows.length;
  }
  if (total > 0) persistFailCooldown();
  return total;
}

export async function autoMirrorInstruments(): Promise<boolean> {
  const hasData = Array.from(instrCacheByExchange.values()).some((c) => c.rows.length > 0);
  if (hasData) return false;

  const mirrorUrl = (process.env["KITE_MIRROR_URL"] ?? "").trim();
  const password = (process.env["APP_ACCESS_PASSWORD"] ?? "").trim();
  if (!mirrorUrl || !password) return false;

  let base: URL;
  try {
    base = new URL(mirrorUrl);
  } catch {
    return false;
  }

  const url = new URL("/api/kite/export-instruments", base).toString();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: "GET",
        headers: { "x-app-password": password, accept: "application/json" },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) {
      logger.info({ status: resp.status }, "Auto-mirror instruments: production returned non-200");
      return false;
    }
    const payload = (await resp.json()) as { exchanges: Record<string, any[]> };
    const total = seedInstrumentsCache(payload.exchanges);
    if (total > 0) {
      logger.info({ total }, "Auto-mirror: instruments imported from production");
      return true;
    }
    return false;
  } catch (err) {
    logger.info(
      { err: (err as Error).message },
      "Auto-mirror instruments: could not reach production (expected if endpoint missing)",
    );
    return false;
  }
}
