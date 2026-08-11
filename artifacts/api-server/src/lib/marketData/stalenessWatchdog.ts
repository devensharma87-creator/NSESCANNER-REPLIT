/**
 * Per-token staleness watchdog (fix-file BUG-30).
 *
 * Kite ticks carry no per-token sequence numbers, so gap detection is
 * AGE-based: during market hours every subscribed symbol must have ticked
 * within STALE_AGE_MS. Stale symbols get a resubscribe nudge (Kite re-sends
 * a full snapshot on subscribe); if more than STALE_PCT_DEGRADE of the
 * universe is stale the owner is alerted and SystemMode degrades (via the
 * snapshot consumed by `systemMode.ts`).
 *
 * Lives inside lib/marketData/ (guard-exempt) because it must read the raw
 * kiteFeed quote map directly.
 */
import { getAllLiveQuotes, subscribe, feedStatus } from "../kiteFeed";
import { computeMarketStatus } from "../marketEvents";
import { alertOwner } from "../alerting";
import { logger } from "../logger";

export const STALE_AGE_MS = 90_000;
export const STALE_PCT_DEGRADE = 0.05;
export const MIN_UNIVERSE_FOR_ALERT = 10;
const TICK_MS = 15_000;
const NUDGE_COOLDOWN_MS = 5 * 60_000;

export interface StalenessSnapshot {
  active: boolean; // false when market closed / feed down (no verdict)
  totalTracked: number;
  staleCount: number;
  stalePct: number; // 0..1
  staleSymbols: string[]; // capped at 20 for payload size
  degrade: boolean; // true → SystemMode should treat as DEGRADED driver
  checkedAt: string | null;
}

let snapshot: StalenessSnapshot = {
  active: false,
  totalTracked: 0,
  staleCount: 0,
  stalePct: 0,
  staleSymbols: [],
  degrade: false,
  checkedAt: null,
};
let lastNudgeAt = 0;
let timer: NodeJS.Timeout | null = null;

export function getStalenessSnapshot(): StalenessSnapshot {
  return snapshot;
}

export function runStalenessCheck(now: Date = new Date()): StalenessSnapshot {
  const marketOpen = computeMarketStatus(now) === "open";
  const feed = feedStatus();
  if (!marketOpen || !feed.connected) {
    snapshot = { ...snapshot, active: false, degrade: false, checkedAt: now.toISOString() };
    return snapshot;
  }
  const quotes = getAllLiveQuotes();
  const entries = Object.entries(quotes);
  const nowMs = now.getTime();
  const stale: string[] = [];
  // subscribe() resolves plain NSE equity trading symbols only. Snapshot keys
  // can be index aliases ("^NSEI") or exchange-qualified canonical ids for
  // symbols listed on both exchanges, neither of which it can resolve — so the
  // nudge is driven by the canonical trading symbol instead of the map key.
  const staleNseEquitySymbols: string[] = [];
  for (const [key, q] of entries) {
    if (!q || nowMs - q.ts <= STALE_AGE_MS) continue;
    stale.push(key);
    if (q.segment === "EQUITY" && q.exchange === "NSE") staleNseEquitySymbols.push(q.tradingSymbol);
  }
  const total = entries.length;
  const stalePct = total > 0 ? stale.length / total : 0;
  const degrade = total >= MIN_UNIVERSE_FOR_ALERT && stalePct > STALE_PCT_DEGRADE;
  snapshot = {
    active: true,
    totalTracked: total,
    staleCount: stale.length,
    stalePct: Math.round(stalePct * 1000) / 1000,
    staleSymbols: stale.slice(0, 20),
    degrade,
    checkedAt: now.toISOString(),
  };

  if (stale.length > 0 && nowMs - lastNudgeAt > NUDGE_COOLDOWN_MS) {
    lastNudgeAt = nowMs;
    // Re-subscribe = Kite re-sends a fresh snapshot tick for those tokens.
    if (staleNseEquitySymbols.length > 0) void subscribe(staleNseEquitySymbols).catch(() => {});
    logger.warn({ staleCount: stale.length, total, sample: stale.slice(0, 5) },
      "staleness watchdog: nudged resubscribe for stale tokens (BUG-30)");
  }
  if (degrade) {
    alertOwner(
      "TOKEN_STALENESS_HIGH",
      `${stale.length}/${total} subscribed tokens stale (> ${STALE_AGE_MS / 1000}s without a tick) during market hours. ` +
        `Sample: ${stale.slice(0, 5).join(", ")}. Resubscribe nudge sent; SystemMode degrades while this persists.`,
      undefined,
      15 * 60_000,
    );
  }
  return snapshot;
}

export function startStalenessWatchdog(): void {
  if (timer) return;
  timer = setInterval(() => {
    try {
      runStalenessCheck();
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "staleness watchdog tick failed");
    }
  }, TICK_MS);
  timer.unref?.();
  logger.info({ tickMs: TICK_MS, staleAgeMs: STALE_AGE_MS }, "token staleness watchdog started (BUG-30)");
}
