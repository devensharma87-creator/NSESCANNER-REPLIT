import { db, kiteSessionTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getActiveSession } from "./kiteAuth";
import { feedStatus } from "./kiteFeed";
import { computeMarketStatus, isNseHoliday } from "./marketEvents";
import { getAppState, setAppStateIfAbsent, deleteAppState } from "./appStateStore";
import { logger } from "./logger";

/**
 * Kite readiness service — a single, honest roll-up of "can the platform see
 * live market data right now, and if not, why?". VISIBILITY ONLY: this module
 * never places orders, never changes any trading decision, and is composed
 * entirely from existing primitives (getActiveSession / feedStatus /
 * computeMarketStatus) plus a persisted first-offline timestamp.
 */

const ACTIVE_ID = "active";
const KITE_OFFLINE_SINCE_KEY = "kite_offline_since";
const EXPIRES_SOON_MS = 30 * 60 * 1000; // 30 min to the next ~06:00 IST expiry
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export type KiteReadinessState =
  | "KITE_READY"
  | "KITE_EXPIRES_SOON"
  | "KITE_EXPIRED"
  | "KITE_OFFLINE_PREOPEN"
  | "KITE_OFFLINE_MARKET_HOURS"
  | "KITE_CONNECTED_BUT_FEED_STALE";

export type KiteReadinessSeverity = "ok" | "info" | "warn" | "critical";

export interface KiteReadiness {
  state: KiteReadinessState;
  severity: KiteReadinessSeverity;
  sessionPresent: boolean;
  sessionValid: boolean;
  loginTime: string | null;
  expiresAt: string | null;
  kiteOfflineSince: string | null;
  marketSession: "open" | "closed" | "pre_open";
  isPreOpenWindow: boolean;
  feedConnected: boolean;
  feedRunning: boolean;
  userActionRequired: boolean;
  checkedAt: string;
}

/**
 * 08:45–09:15 IST on an NSE trading day. Deliberately WIDER than
 * computeMarketStatus's pre_open (09:00–09:15) — it is the operational
 * "you must reconnect before the open" safeguard window. Weekends and NSE
 * holidays return false, so a logged-out Sunday morning is never escalated to
 * a pre-open emergency.
 */
export function isPreOpenWindowIST(now: Date): boolean {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const dow = ist.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  if (isNseHoliday(ist)) return false;
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return mins >= 8 * 60 + 45 && mins < 9 * 60 + 15;
}

export interface DeriveKiteReadinessInput {
  sessionPresent: boolean;
  sessionValid: boolean;
  loginTime: Date | null;
  expiresAt: Date | null;
  marketSession: "open" | "closed" | "pre_open";
  isPreOpenWindow: boolean;
  feedConnected: boolean;
  feedRunning: boolean;
  kiteOfflineSince: string | null;
  now: Date;
}

/**
 * PURE state machine — no IO, fully unit-testable. First matching rule wins
 * (precedence, per spec):
 *   1. invalid session + market open      → KITE_OFFLINE_MARKET_HOURS (critical)
 *   2. invalid session + pre-open window   → KITE_OFFLINE_PREOPEN      (critical)
 *   3. invalid session otherwise           → KITE_EXPIRED              (warn)
 *   4. valid session + feed down @ open    → KITE_CONNECTED_BUT_FEED_STALE (warn)
 *   5. valid session + <30 min to expiry   → KITE_EXPIRES_SOON         (info)
 *   6. otherwise                           → KITE_READY                (ok)
 */
export function deriveKiteReadiness(input: DeriveKiteReadinessInput): KiteReadiness {
  const {
    sessionPresent,
    sessionValid,
    loginTime,
    expiresAt,
    marketSession,
    isPreOpenWindow,
    feedConnected,
    feedRunning,
    kiteOfflineSince,
    now,
  } = input;

  let state: KiteReadinessState;
  let severity: KiteReadinessSeverity;

  if (!sessionValid) {
    if (marketSession === "open") {
      state = "KITE_OFFLINE_MARKET_HOURS";
      severity = "critical";
    } else if (isPreOpenWindow) {
      state = "KITE_OFFLINE_PREOPEN";
      severity = "critical";
    } else {
      state = "KITE_EXPIRED";
      severity = "warn";
    }
  } else if (marketSession === "open" && !feedConnected) {
    state = "KITE_CONNECTED_BUT_FEED_STALE";
    severity = "warn";
  } else if (expiresAt !== null && expiresAt.getTime() - now.getTime() < EXPIRES_SOON_MS) {
    state = "KITE_EXPIRES_SOON";
    severity = "info";
  } else {
    state = "KITE_READY";
    severity = "ok";
  }

  return {
    state,
    severity,
    sessionPresent,
    sessionValid,
    loginTime: loginTime ? loginTime.toISOString() : null,
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    kiteOfflineSince,
    marketSession,
    isPreOpenWindow,
    feedConnected,
    feedRunning,
    userActionRequired: !sessionValid,
    checkedAt: now.toISOString(),
  };
}

interface StoredSessionMeta {
  present: boolean;
  loginTime: Date | null;
  expiresAt: Date | null;
}

/**
 * Read-only metadata from the kite_session row WITHOUT the expiry gate and
 * WITHOUT decrypting any token columns. This lets us surface "last login /
 * expires-at" even after the session has expired, and distinguish
 * sessionPresent (a row exists) from sessionValid (getActiveSession() != null).
 * Only non-secret columns are selected.
 */
async function readStoredSessionMeta(): Promise<StoredSessionMeta> {
  try {
    const rows = await db
      .select({ loginTime: kiteSessionTable.loginTime, expiresAt: kiteSessionTable.expiresAt })
      .from(kiteSessionTable)
      .where(eq(kiteSessionTable.id, ACTIVE_ID))
      .limit(1);
    const r = rows[0];
    if (!r) return { present: false, loginTime: null, expiresAt: null };
    return { present: true, loginTime: r.loginTime, expiresAt: r.expiresAt };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "kite_session meta read failed (fail-open)");
    return { present: false, loginTime: null, expiresAt: null };
  }
}

/**
 * Persist the first-offline timestamp (idempotent INSERT … ON CONFLICT DO
 * NOTHING) or clear it when a valid session returns. Returns the best-known
 * offline-since (or null). Fail-open throughout.
 */
async function syncKiteOfflineSince(sessionValid: boolean, nowIso: string): Promise<string | null> {
  if (sessionValid) {
    const existing = await getAppState(KITE_OFFLINE_SINCE_KEY);
    if (existing !== null) await deleteAppState(KITE_OFFLINE_SINCE_KEY);
    return null;
  }
  await setAppStateIfAbsent(KITE_OFFLINE_SINCE_KEY, nowIso);
  return await getAppState(KITE_OFFLINE_SINCE_KEY);
}

/**
 * Compose the live Kite readiness from existing primitives + persisted
 * offline-since. Side-effect: records/clears `kite_offline_since` (fail-open).
 * getActiveSession() is the authoritative validity gate (handles expiry +
 * decrypt failure); the raw meta read only supplements present + last-known
 * timestamps when the session is invalid.
 */
export async function getKiteReadiness(): Promise<KiteReadiness> {
  const now = new Date();
  const session = await getActiveSession();
  const sessionValid = session !== null;
  const meta = await readStoredSessionMeta();
  const feed = feedStatus();
  const marketSession = computeMarketStatus(now);
  const isPreOpen = isPreOpenWindowIST(now);
  const kiteOfflineSince = await syncKiteOfflineSince(sessionValid, now.toISOString());

  return deriveKiteReadiness({
    sessionPresent: meta.present,
    sessionValid,
    loginTime: session?.loginTime ?? meta.loginTime ?? null,
    expiresAt: session?.expiresAt ?? meta.expiresAt ?? null,
    marketSession,
    isPreOpenWindow: isPreOpen,
    feedConnected: feed.connected,
    feedRunning: feed.running,
    kiteOfflineSince,
    now,
  });
}
