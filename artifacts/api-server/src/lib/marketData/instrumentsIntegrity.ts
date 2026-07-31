/**
 * Instruments-dump integrity check (fix-file BUG-35).
 *
 * Once per trading day (first opportunity from 08:00 IST, retried every tick
 * until a Kite session exists, deadline 09:20 IST):
 *   1. Force-refresh the instruments dump from Kite (NSE + NFO + BFO).
 *   2. Diff the F&O subset (NIFTY / BANKNIFTY / SENSEX options + futures)
 *      against the previous baseline: any change in lot_size / tick_size /
 *      name → Telegram alert (contract-breaking changes).
 *   3. Persist today's subset as the new baseline (/app/.cache JSON).
 * Failure path: refresh impossible by deadline → Telegram alert + a sticky
 * per-date failure flag consumed by SystemMode (DEGRADED → auto-opens blocked
 * for the day, per fix file).
 *
 * B0: adds markInstrumentsRefreshRecovered() — callable by the admin
 * instruments-refresh route to emit exactly one INFO recovery alert after
 * the owner manually resolves a refresh failure (e.g. by renewing Kite and
 * triggering a forced refresh). The failure flag and in-memory cache are
 * cleared so SystemMode can exit DEGRADED on the next tick.
 *
 * Lives inside lib/marketData/ (guard-exempt) — needs kiteAuth directly.
 */
import fs from "fs";
import path from "path";
import { forceRefreshInstruments, exportInstrumentsCache, getActiveSession } from "../kiteAuth";
import { getAppState, setAppState, deleteAppState } from "../appStateStore";
import { alertOwner } from "../alerting";
import { logger } from "../logger";

const BASELINE_FILE = path.resolve(process.cwd(), "../../.cache/instruments_baseline.json");
const FNO_NAMES = new Set(["NIFTY", "BANKNIFTY", "SENSEX"]);
const CLAIM_KEY_PREFIX = "instruments_check_";
const FAIL_KEY_PREFIX = "instruments_refresh_failed_";
const WINDOW_START_MIN = 8 * 60; // 08:00 IST
const DEADLINE_MIN = 9 * 60 + 20; // 09:20 IST
const TICK_MS = 10 * 60_000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

interface BaselineRow {
  lot: number;
  tick: number;
  name: string;
}
interface Baseline {
  asOfDate: string;
  rows: Record<string, BaselineRow>; // key = exchange:tradingsymbol
}

export interface InstrumentsIntegrityStatus {
  lastCheckedDate: string | null;
  lastResult: "OK" | "CHANGES_ALERTED" | "REFRESH_FAILED" | "NO_SESSION_YET" | null;
  changesDetected: number;
  failedToday: boolean;
  checkedAt: string | null;
}

let status: InstrumentsIntegrityStatus = {
  lastCheckedDate: null,
  lastResult: null,
  changesDetected: 0,
  failedToday: false,
  checkedAt: null,
};
let failedDateCache: string | null = null;
let timer: NodeJS.Timeout | null = null;

function istNowParts(now: Date = new Date()): { date: string; minutes: number; dow: number } {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return {
    date: ist.toISOString().slice(0, 10),
    minutes: ist.getUTCHours() * 60 + ist.getUTCMinutes(),
    dow: ist.getUTCDay(),
  };
}

export function getInstrumentsIntegrityStatus(): InstrumentsIntegrityStatus {
  return status;
}

/** Sync gate consumed by SystemMode: true → DEGRADED driver for today. */
export function isInstrumentsRefreshFailedToday(now: Date = new Date()): boolean {
  return failedDateCache === istNowParts(now).date;
}

/** Re-hydrate the sticky failure flag after a process restart. */
export async function hydrateInstrumentsFailureFlag(now: Date = new Date()): Promise<void> {
  const { date } = istNowParts(now);
  const v = await getAppState(`${FAIL_KEY_PREFIX}${date}`);
  failedDateCache = v ? date : null;
  status = { ...status, failedToday: failedDateCache !== null };
}

/**
 * Mark a manual instruments refresh as recovered after a prior failure.
 *
 * Call this from the admin instruments-refresh route when a forced refresh
 * succeeds after today's scheduler had already recorded a failure. Emits
 * exactly one INFO recovery alert and clears the failure state so SystemMode
 * can exit DEGRADED on the next tick.
 *
 * If there was no failure recorded for `date`, this is a no-op.
 */
export async function markInstrumentsRefreshRecovered(date: string): Promise<void> {
  if (failedDateCache !== date) return; // not failed today — nothing to recover
  failedDateCache = null;
  status = { ...status, failedToday: false, lastResult: "OK", lastCheckedDate: date, checkedAt: new Date().toISOString() };
  // Clear the DB failure flag so a process restart doesn't re-hydrate it.
  await deleteAppState(`${FAIL_KEY_PREFIX}${date}`).catch(() => undefined);
  alertOwner(
    "INSTRUMENTS_REFRESH_RECOVERED",
    `Daily instruments refresh recovered for ${date}. Auto-opens are unblocked (SystemMode can exit DEGRADED).`,
    undefined,
    2 * 60 * 60_000,
    `INSTRUMENTS_REFRESH_RECOVERED::${date}`,
    "INFO",
  );
  logger.info({ date }, "instruments refresh recovered — failure flag cleared (BUG-35)");
}

function extractFnoSubset(): Record<string, BaselineRow> | null {
  const cache = exportInstrumentsCache();
  if (!cache) return null;
  const out: Record<string, BaselineRow> = {};
  for (const ex of ["NFO", "BFO"]) {
    for (const raw of cache.exchanges[ex] ?? []) {
      const r = raw as { name?: string; tradingsymbol?: string; lot_size?: number; tick_size?: number };
      if (!r.name || !FNO_NAMES.has(r.name) || !r.tradingsymbol) continue;
      out[`${ex}:${r.tradingsymbol}`] = {
        lot: Number(r.lot_size ?? 0),
        tick: Number(r.tick_size ?? 0),
        name: r.name,
      };
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function diffBaselines(prev: Baseline, cur: Record<string, BaselineRow>): string[] {
  const changes: string[] = [];
  for (const [key, p] of Object.entries(prev.rows)) {
    const c = cur[key];
    if (!c) continue; // expired/delisted contracts churn daily — not alert-worthy
    if (c.lot !== p.lot) changes.push(`${key}: lot_size ${p.lot} → ${c.lot}`);
    if (c.tick !== p.tick) changes.push(`${key}: tick_size ${p.tick} → ${c.tick}`);
    if (c.name !== p.name) changes.push(`${key}: name ${p.name} → ${c.name}`);
  }
  return changes;
}

function readBaseline(): Baseline | null {
  try {
    return JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8")) as Baseline;
  } catch {
    return null;
  }
}

function writeBaseline(date: string, rows: Record<string, BaselineRow>): void {
  try {
    fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
    fs.writeFileSync(BASELINE_FILE, JSON.stringify({ asOfDate: date, rows } satisfies Baseline));
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "instruments baseline write failed");
  }
}

async function markFailed(date: string, reason: string): Promise<void> {
  failedDateCache = date;
  status = { ...status, lastCheckedDate: date, lastResult: "REFRESH_FAILED", failedToday: true, checkedAt: new Date().toISOString() };
  await setAppState(`${FAIL_KEY_PREFIX}${date}`, reason);
  alertOwner(
    "INSTRUMENTS_REFRESH_FAILED",
    `Daily instruments dump refresh FAILED for ${date} (${reason}). ` +
      `Auto-opens are blocked (SystemMode DEGRADED) until instruments are refreshed.`,
    undefined,
    2 * 60 * 60_000,
    `INSTRUMENTS_REFRESH_FAILED::${date}`,
  );
}

/** One attempt. Returns true when the day's check is complete (claimed). */
export async function runInstrumentsCheck(now: Date = new Date()): Promise<boolean> {
  const { date, minutes, dow } = istNowParts(now);
  if (dow === 0 || dow === 6) return false;
  if (minutes < WINDOW_START_MIN) return false;
  const claimKey = `${CLAIM_KEY_PREFIX}${date}`;
  if ((await getAppState(claimKey)) !== null) return true; // already done today

  const session = await getActiveSession();
  if (!session) {
    if (minutes >= DEADLINE_MIN) {
      await setAppState(claimKey, "failed_no_session");
      await markFailed(date, "no Kite session by 09:20 IST");
      return true;
    }
    status = { ...status, lastResult: "NO_SESSION_YET", checkedAt: now.toISOString() };
    return false; // retry next tick
  }

  try {
    const refreshed = await forceRefreshInstruments();
    if (!refreshed) throw new Error("session lost during refresh");
    const errs = Object.entries(refreshed.results).filter(([, v]) => "error" in v);
    if (errs.length > 0) throw new Error(errs.map(([ex, v]) => `${ex}: ${(v as { error: string }).error}`).join("; "));
  } catch (err) {
    await setAppState(claimKey, "failed_refresh");
    await markFailed(date, (err as Error).message);
    return true;
  }

  const cur = extractFnoSubset();
  if (!cur) {
    await setAppState(claimKey, "failed_empty_dump");
    await markFailed(date, "refreshed dump contained no NIFTY/BANKNIFTY/SENSEX F&O rows");
    return true;
  }
  const prev = readBaseline();
  let changes: string[] = [];
  if (prev && prev.asOfDate !== date) {
    changes = diffBaselines(prev, cur);
    if (changes.length > 0) {
      alertOwner(
        "INSTRUMENTS_CONTRACT_CHANGED",
        `Instruments dump changed vs ${prev.asOfDate} (${changes.length} contract change(s)):\n` +
          changes.slice(0, 10).join("\n") + (changes.length > 10 ? `\n… +${changes.length - 10} more` : ""),
        undefined,
        2 * 60 * 60_000,
        `INSTRUMENTS_CONTRACT_CHANGED::${date}`,
      );
    }
  }
  writeBaseline(date, cur);
  await setAppState(claimKey, changes.length > 0 ? `ok_changes_${changes.length}` : "ok");
  failedDateCache = null;
  status = {
    lastCheckedDate: date,
    lastResult: changes.length > 0 ? "CHANGES_ALERTED" : "OK",
    changesDetected: changes.length,
    failedToday: false,
    checkedAt: now.toISOString(),
  };
  logger.info({ date, tracked: Object.keys(cur).length, changes: changes.length },
    "instruments integrity check complete (BUG-35)");
  return true;
}

export function startInstrumentsIntegrityScheduler(): void {
  if (timer) return;
  void hydrateInstrumentsFailureFlag().then(() =>
    runInstrumentsCheck().catch((err) =>
      logger.warn({ err: (err as Error).message }, "instruments check (boot) failed"),
    ),
  );
  timer = setInterval(() => {
    void runInstrumentsCheck().catch((err) =>
      logger.warn({ err: (err as Error).message }, "instruments check tick failed"),
    );
  }, TICK_MS);
  timer.unref?.();
  logger.info({ tickMs: TICK_MS }, "instruments integrity scheduler started (BUG-35, window 08:00–09:20 IST)");
}
