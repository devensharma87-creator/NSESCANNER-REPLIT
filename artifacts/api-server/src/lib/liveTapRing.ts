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
 * Phase 0.5C: storage is a strictly bounded O(1) ring buffer. Appends
 * no longer shift or splice the retained history, so per-tick cost is
 * constant regardless of how many entries are retained.
 *
 * Spec: BACKTEST_REPLAY_HARNESS_SPEC.md §12.2
 */
import { RingBuffer } from "./ringBuffer";

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

const ticks = new RingBuffer<TapTick>(CAP_TICKS);
const chains = new RingBuffer<TapChainSnapshot>(CAP_CHAIN);
const boards = new RingBuffer<TapBoardSnapshot>(CAP_BOARDS);
const events = new RingBuffer<TapSystemEvent>(CAP_EVENTS);

/**
 * Age-based eviction. The count cap is enforced by the ring itself —
 * `push` overwrites exactly the oldest entry once capacity is reached,
 * in O(1), so no linear trim runs on the tick path any more.
 *
 * This is a HEAD SCAN, matching the original semantics exactly: it stops
 * at the first entry that is not expired. An out-of-order old entry
 * sitting behind a fresh one is therefore not evicted here, just as
 * before. Each eviction is O(1), so the loop costs O(k) for k expired
 * entries rather than the previous O(k*n).
 */
function trimByAge<T>(ring: RingBuffer<T>, ageOf: (row: T) => number): void {
  const cutoff = Date.now() - MAX_AGE_MS;
  for (;;) {
    const oldest = ring.peekOldest();
    if (oldest === undefined || ageOf(oldest) >= cutoff) break;
    ring.dropOldest();
  }
}

// ── Push API — every entry point wrapped by caller in try/catch ────

export function tapPushTick(t: TapTick): void {
  ticks.push(t);
  trimByAge(ticks, (x) => x.receivedAtMs);
}

export function tapPushChainSnapshot(s: TapChainSnapshot): void {
  chains.push(s);
  trimByAge(chains, (x) => x.capturedAtMs);
}

export function tapPushBoardSnapshot(b: TapBoardSnapshot): void {
  boards.push(b);
  trimByAge(boards, (x) => x.capturedAtMs);
}

export function tapPushSystemEvent(e: TapSystemEvent): void {
  events.push(e);
  trimByAge(events, (x) => x.emittedAtMs);
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
  // Single-pass filtered reads. O(n) in retained entries, which is
  // unavoidable when materialising a window, but it runs ONLY here —
  // on owner demand — never on the tick path. Reads never mutate the
  // rings, and every returned array is freshly allocated.
  const t = ticks.filterToArray((x) => x.receivedAtMs >= window.sinceMs);
  const c = chains.filterToArray((x) => x.capturedAtMs >= window.sinceMs);
  const b = boards.filterToArray((x) => x.capturedAtMs >= window.sinceMs);
  const e = events.filterToArray((x) => x.emittedAtMs >= window.sinceMs);
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
  // Head/tail reads, O(1). Deliberately NOT a min/max scan — this
  // preserves the pre-existing observable contract exactly.
  return {
    tickCount: ticks.size,
    chainCount: chains.size,
    boardCount: boards.size,
    eventCount: events.size,
    oldestTickMs: ticks.peekOldest()?.receivedAtMs ?? null,
    newestTickMs: ticks.peekNewest()?.receivedAtMs ?? null,
  };
}

/** Test-only capacity introspection. Read-only; no behavioural effect. */
export function _tapCapacities(): {
  ticks: number;
  chains: number;
  boards: number;
  events: number;
} {
  return {
    ticks: CAP_TICKS,
    chains: CAP_CHAIN,
    boards: CAP_BOARDS,
    events: CAP_EVENTS,
  };
}

/** Test-only reset. Not part of the barrel export. */
export function _resetLiveTapRing(): void {
  ticks.clear();
  chains.clear();
  boards.clear();
  events.clear();
}
