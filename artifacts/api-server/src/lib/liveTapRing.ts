/**
 * LiveTapRing — the R1-tail recorder's in-memory ring buffer.
 *
 * A pure read-only tap on the live trading path. Every push is
 * wrapped by callers in try/catch so a buffer failure NEVER affects
 * the trading engine (per spec §12.2: "recorder failure must never
 * touch the trading path").
 *
 * Storage is process-local + capped by count-per-stream + wall-clock
 * age. When the owner hits `POST /api/replay/record`, this buffer is
 * drained to disk in the exact JSONL format the replay driver expects.
 *
 * Spec: BACKTEST_REPLAY_HARNESS_SPEC.md §12.2
 */

// Hard caps — chosen to keep RAM comfortably under 512 MB with worst-
// case burst rates (a full trading day at ~250 ticks/sec = ~7M ticks;
// we cap far below that per the "last N minutes" contract). The
// recorder trims to `minutes` at drain time.
const CAP_TICKS = 400_000;
const CAP_CHAIN = 2_000;    // 2min × 60 min × N underlyings ~= 6k; wider cap for full-day capture
const CAP_BOARDS = 2_000;
const CAP_EVENTS = 5_000;
// Absolute-age drop threshold — anything older than this at push time
// is dropped even if under count cap. 4h covers a full session + prep.
const MAX_AGE_MS = 4 * 60 * 60_000;

export interface TapTick {
  receivedAtMs: number;
  instrumentToken: number;
  symbol: string | undefined;
  ltp: number;
  ltq: number | null;
  volume: number | null;
  oi: number | null;
  /** Original Kite payload (kept for R2 engine compatibility). */
  raw: Record<string, unknown>;
}

export interface TapChainSnapshot {
  capturedAtMs: number;
  underlying: string;
  expiry: string;         // "YYYY-MM-DD"
  source: "kite" | "nse" | string;
  /** Raw snapshot payload — full chain per spec §7. */
  snapshot: Record<string, unknown>;
}

export interface TapBoardSnapshot {
  capturedAtMs: number;
  /** Serialised board rows (indices ticker widget rollup). */
  rows: Array<Record<string, unknown>>;
}

export interface TapSystemEvent {
  emittedAtMs: number;
  kind:
    | "SYSTEM_MODE_TRANSITION"
    | "REGIME_CHANGE"
    | "KITE_SESSION_EDGE"
    | "OTHER";
  detail: Record<string, unknown>;
}

const ticks: TapTick[] = [];
const chains: TapChainSnapshot[] = [];
const boards: TapBoardSnapshot[] = [];
const events: TapSystemEvent[] = [];

function trim<T>(
  arr: T[],
  cap: number,
  ageOf: (row: T) => number,
): void {
  const cutoff = Date.now() - MAX_AGE_MS;
  while (arr.length > 0 && ageOf(arr[0]!) < cutoff) arr.shift();
  if (arr.length > cap) arr.splice(0, arr.length - cap);
}

// ── Push API — every entry point wrapped by caller in try/catch ────

export function tapPushTick(t: TapTick): void {
  ticks.push(t);
  trim(ticks, CAP_TICKS, (x) => x.receivedAtMs);
}

export function tapPushChainSnapshot(s: TapChainSnapshot): void {
  chains.push(s);
  trim(chains, CAP_CHAIN, (x) => x.capturedAtMs);
}

export function tapPushBoardSnapshot(b: TapBoardSnapshot): void {
  boards.push(b);
  trim(boards, CAP_BOARDS, (x) => x.capturedAtMs);
}

export function tapPushSystemEvent(e: TapSystemEvent): void {
  events.push(e);
  trim(events, CAP_EVENTS, (x) => x.emittedAtMs);
}

// ── Drain API — used by the recorder endpoint ──────────────────────

export interface DrainWindow {
  /** Inclusive lower bound (epoch ms). Rows older than this are dropped. */
  sinceMs: number;
}

export interface DrainedFixture {
  ticks: TapTick[];
  chainSnapshots: TapChainSnapshot[];
  boardSnapshots: TapBoardSnapshot[];
  systemEvents: TapSystemEvent[];
  /** Actual observed span (min/max of tick timestamps within window). */
  observedRangeMs: { min: number; max: number } | null;
}

export function drainSince(window: DrainWindow): DrainedFixture {
  const t = ticks.filter((x) => x.receivedAtMs >= window.sinceMs);
  const c = chains.filter((x) => x.capturedAtMs >= window.sinceMs);
  const b = boards.filter((x) => x.capturedAtMs >= window.sinceMs);
  const e = events.filter((x) => x.emittedAtMs >= window.sinceMs);
  const range = t.length > 0
    ? { min: t[0]!.receivedAtMs, max: t[t.length - 1]!.receivedAtMs }
    : null;
  return {
    ticks: t,
    chainSnapshots: c,
    boardSnapshots: b,
    systemEvents: e,
    observedRangeMs: range,
  };
}

/** Compact stats for /api/replay/record dry-run / health-check. */
export interface TapStats {
  tickCount: number;
  chainCount: number;
  boardCount: number;
  eventCount: number;
  oldestTickMs: number | null;
  newestTickMs: number | null;
}

export function tapStats(): TapStats {
  return {
    tickCount: ticks.length,
    chainCount: chains.length,
    boardCount: boards.length,
    eventCount: events.length,
    oldestTickMs: ticks[0]?.receivedAtMs ?? null,
    newestTickMs: ticks[ticks.length - 1]?.receivedAtMs ?? null,
  };
}

/** Test-only reset. Not part of the barrel export. */
export function _resetLiveTapRing(): void {
  ticks.length = 0;
  chains.length = 0;
  boards.length = 0;
  events.length = 0;
}
