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

/**
 * Depth of the bounded structural copy applied at insertion and at read.
 *
 * Depth 0 is the entry object itself. The deepest mutable container in a
 * Kite full-mode tick payload is `entry.raw.depth.buy[i]` — depth 4 — so
 * 6 covers every real payload shape with headroom while keeping per-append
 * work strictly bounded and immune to reference cycles.
 */
export const COPY_DEPTH_LIMIT = 6;

/**
 * Bounded structural copy — the immutability primitive for this module.
 *
 * WHY: the ring stores whatever reference the caller handed us, and
 * `drainSince` handed the same reference back out. Consumer mutation
 * therefore corrupted retained storage, and re-pushing one mutated
 * caller object retroactively rewrote earlier events. Both were proven
 * failing before this correction (see liveTapRing.immutability.test.ts).
 *
 * THE CONTRACT — copy exactly what the recorder can serialise.
 *
 * This is NOT a general-purpose structured clone, and deliberately so.
 * The only consumer of this buffer writes entries out as JSONL, so the
 * authoritative definition of "the entry's shape" is what
 * JSON.stringify can observe: own, enumerable, string-keyed properties,
 * with getters evaluated. The copy reproduces exactly that set, which
 * makes JSON/JSONL output provably byte-identical to the pre-0.5C
 * recorder while keeping the append path on V8's fast property path.
 *
 * An earlier attempt preserved full property descriptors via
 * Reflect.ownKeys + defineProperty. It was rejected for two measured
 * reasons: it cost ~23.4us per tick (a ~10x regression), and
 * transplanting accessors kept the getter's closure shared, so a
 * consumer could still reach retained state through it — defeating the
 * whole invariant.
 *
 * POLICY:
 *   • Plain objects (Object.prototype or null-prototype) and arrays are
 *     copied recursively until COPY_DEPTH_LIMIT.
 *   • Getters are EVALUATED ONCE at insertion and stored as plain data,
 *     exactly as JSON.stringify would. No accessor is ever retained, so
 *     no closure is shared with storage.
 *   • Symbol-keyed and non-enumerable own properties are NOT retained.
 *     JSON.stringify cannot express them, so the recorder's output is
 *     unchanged. Declared and tested, never silent.
 *   • An own "__proto__" key is stored as real data via defineProperty,
 *     never through the inherited setter. JSON.parse can produce such a
 *     key and chain snapshots come from parsed HTTP JSON.
 *   • A null prototype is preserved rather than promoted.
 *   • Array holes stay holes; `length` is preserved.
 *   • Date, Map and Set ARE copied. Date matters in production: a Kite
 *     tick carries `timestamp` / `last_trade_time` as real Date objects,
 *     so passing them by reference left `drained.raw.timestamp.setTime(0)`
 *     as a live corruption path. A copied Date serialises identically.
 *   • null / undefined are preserved exactly — never coerced to `{}`.
 *   • No JSON stringify/parse. No structuredClone. No full-buffer clone.
 *
 * THE TWO REMAINING EXCLUSIONS — bounded, not silent.
 * Isolation is complete for every shape this system actually produces
 * (Kite binary ticks and JSON.parse'd HTTP snapshots). Two inputs cannot
 * be isolated without breaking a harder guarantee, so instead of being
 * assumed absent they are COUNTED and exposed via
 * getBoundedCopyDiagnostics():
 *   1. Class instances and objects carrying a `toJSON` method are shared
 *      by reference. A class instance cannot be reconstructed without
 *      invoking its constructor, and a `toJSON` object's serialisation
 *      is driven by state the contract above does not reproduce — so
 *      sharing the original is the only way to keep JSON output exact.
 *   2. Containers deeper than COPY_DEPTH_LIMIT are shared. Unbounded
 *      cloning on the append path would reintroduce the unbounded
 *      per-append work Phase 0.5C exists to eliminate.
 * Both counters are asserted in the tests. If either is ever non-zero in
 * production, the exclusion is real rather than theoretical and must be
 * revisited — that is a measurement, not an assumption.
 *
 * Cost is proportional to ONE entry's payload, never to the number of
 * retained entries, so append remains O(1) in buffer size.
 */

/** Observability for the two documented reference-sharing exclusions. */
export interface BoundedCopyDiagnostics {
  /** Containers shared because they sat deeper than COPY_DEPTH_LIMIT. */
  depthLimitTruncations: number;
  /** Class instances / toJSON-bearing objects shared by reference. */
  exoticPassthroughs: number;
}

const copyDiagnostics: BoundedCopyDiagnostics = {
  depthLimitTruncations: 0,
  exoticPassthroughs: 0,
};

export function getBoundedCopyDiagnostics(): BoundedCopyDiagnostics {
  return { ...copyDiagnostics };
}

/** Test-only: reset the exclusion counters. */
export function _resetBoundedCopyDiagnostics(): void {
  copyDiagnostics.depthLimitTruncations = 0;
  copyDiagnostics.exoticPassthroughs = 0;
}
/**
 * True when serialising `value` would call a toJSON this copy cannot
 * reproduce.
 *
 * Must be tested BEFORE the Date/Map/Set branches: those produce a new
 * instance that would silently lose an own toJSON, changing the emitted
 * bytes. `Date.prototype.toJSON` is excluded because it is standard and
 * a copied Date reproduces it exactly.
 */
function hasCustomToJSON(value: object): boolean {
  const fn = (value as { toJSON?: unknown }).toJSON;
  if (typeof fn !== "function") return false;
  if (value instanceof Date && fn === Date.prototype.toJSON) return false;
  return true;
}

function boundedCopy<T>(value: T, depth: number): T {
  if (value === null || typeof value !== "object") return value;

  // Checked first, ahead of every copy branch: a custom toJSON drives
  // serialisation, so the original must be shared to keep bytes exact.
  if (hasCustomToJSON(value)) {
    copyDiagnostics.exoticPassthroughs++;
    return value;
  }

  // Date is handled BEFORE the depth check: the copy is O(1) and
  // terminal, so there is no reason to leave a mutable Date shared just
  // because it sits deep in the payload. `new Date(ms)` serialises to
  // the identical ISO string.
  if (value instanceof Date) {
    return new Date(value.getTime()) as unknown as T;
  }

  if (depth >= COPY_DEPTH_LIMIT) {
    copyDiagnostics.depthLimitTruncations++;
    return value;
  }

  if (Array.isArray(value)) {
    const src = value as unknown[];
    const n = src.length;
    const out = new Array<unknown>(n);
    for (let i = 0; i < n; i++) {
      // `i in src` keeps a sparse slot a hole instead of materialising
      // it into an explicit `undefined`.
      if (i in src) out[i] = boundedCopy(src[i], depth + 1);
    }
    return out as unknown as T;
  }

  if (value instanceof Map) {
    const out = new Map<unknown, unknown>();
    for (const [k, v] of value) {
      out.set(boundedCopy(k, depth + 1), boundedCopy(v, depth + 1));
    }
    return out as unknown as T;
  }

  if (value instanceof Set) {
    const out = new Set<unknown>();
    for (const v of value) out.add(boundedCopy(v, depth + 1));
    return out as unknown as T;
  }

  const proto = Object.getPrototypeOf(value) as object | null;
  // Class instances cannot be rebuilt without invoking a constructor.
  if (proto !== Object.prototype && proto !== null) {
    copyDiagnostics.exoticPassthroughs++;
    return value;
  }

  const src = value as Record<string, unknown>;
  // Preserve a null prototype rather than promoting to an ordinary object.
  const out = (proto === null ? Object.create(null) : {}) as Record<string, unknown>;

  // Object.keys + plain assignment keeps this on V8's fast property
  // path. Reading `src[k]` evaluates any getter exactly once, which is
  // both what JSON.stringify does and what prevents an accessor closure
  // from ever being retained in storage.
  for (const k of Object.keys(src)) {
    const copied = boundedCopy(src[k], depth + 1);
    if (k === "__proto__") {
      // Never `out[k] = ...` here: that would invoke the inherited
      // __proto__ setter, silently dropping the key and mutating the
      // copy's prototype.
      Object.defineProperty(out, k, {
        value: copied,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    } else {
      out[k] = copied;
    }
  }
  return out as unknown as T;
}

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

// Every push stores a PRIVATE bounded copy. The caller's object is never
// retained, never frozen and never mutated — callers may keep reusing and
// mutating one scratch object across pushes without corrupting earlier
// entries.

export function tapPushTick(t: TapTick): void {
  ticks.push(boundedCopy(t, 0));
  trimByAge(ticks, (x) => x.receivedAtMs);
}

export function tapPushChainSnapshot(s: TapChainSnapshot): void {
  chains.push(boundedCopy(s, 0));
  trimByAge(chains, (x) => x.capturedAtMs);
}

export function tapPushBoardSnapshot(b: TapBoardSnapshot): void {
  boards.push(boundedCopy(b, 0));
  trimByAge(boards, (x) => x.capturedAtMs);
}

export function tapPushSystemEvent(e: TapSystemEvent): void {
  events.push(boundedCopy(e, 0));
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
  //
  // Each returned ENTRY is additionally a bounded copy, so a consumer may
  // mutate the drained fixture freely without reaching retained storage,
  // and two successive drains are independent of one another. This copy
  // cost is paid only on the owner-triggered drain path.
  const t = ticks
    .filterToArray((x) => x.receivedAtMs >= window.sinceMs)
    .map((x) => boundedCopy(x, 0));
  const c = chains
    .filterToArray((x) => x.capturedAtMs >= window.sinceMs)
    .map((x) => boundedCopy(x, 0));
  const b = boards
    .filterToArray((x) => x.capturedAtMs >= window.sinceMs)
    .map((x) => boundedCopy(x, 0));
  const e = events
    .filterToArray((x) => x.emittedAtMs >= window.sinceMs)
    .map((x) => boundedCopy(x, 0));
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
  /**
   * Cumulative occurrences of the two documented reference-sharing
   * exclusions, counted on BOTH the insertion and the drain copy. These
   * are occurrence counters, not a census of retained exceptional
   * entries — any non-zero value means the exclusion is real in this
   * process rather than theoretical, which is the signal that matters.
   * Expected to stay at zero for Kite ticks and JSON HTTP snapshots.
   */
  copyExclusions: BoundedCopyDiagnostics;
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
    copyExclusions: getBoundedCopyDiagnostics(),
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
  // Reset the exclusion counters too, so a full reset really is a full
  // reset and counter state cannot leak between tests.
  _resetBoundedCopyDiagnostics();
}
