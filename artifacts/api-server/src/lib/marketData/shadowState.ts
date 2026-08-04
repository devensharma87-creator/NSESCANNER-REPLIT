/**
 * Shadow provider routing states and non-interference engine.
 *
 * Pack 5 governance:
 *   - Upstox and IndianAPI enter as NOT_CONFIGURED or SHADOW_ONLY.
 *   - Neither may become APPROVED_SECONDARY without explicit owner action.
 *   - Shadow results NEVER replace, average, or influence canonical Kite data.
 *   - Shadow failures NEVER delay canonical responses.
 *   - Disagreement produces diagnostics only — never silent substitution.
 */

// ---------------------------------------------------------------------------
// Provider routing states (§9.1)
// ---------------------------------------------------------------------------

export type ShadowRoutingState =
  | "NOT_CONFIGURED"      // credentials absent
  | "SHADOW_ONLY"         // credentials present; running shadow comparisons only
  | "PARITY_PENDING"      // shadow active; collecting parity evidence
  | "APPROVED_SECONDARY"  // owner-approved secondary (requires explicit action)
  | "DISABLED";           // administratively disabled

export type ShadowProvider = "upstox" | "indianapi";

// ---------------------------------------------------------------------------
// Comparison metric types (§9.3)
// ---------------------------------------------------------------------------

export interface ShadowQuoteMetrics {
  provider: ShadowProvider;
  symbol: string;
  sampledAt: string;
  /** Canonical Kite LTP */
  canonicalLtp: number;
  /** Shadow provider LTP, or null if unavailable */
  shadowLtp: number | null;
  /** Absolute LTP difference, or null */
  ltpAbsDiff: number | null;
  /** LTP difference as fraction of canonical price, or null */
  ltpRelDiff: number | null;
  /** Shadow quote age in seconds, or null */
  shadowAgeSec: number | null;
  /** Canonical quote age in seconds */
  canonicalAgeSec: number | null;
  /** Fetch latency of shadow request in ms */
  shadowLatencyMs: number | null;
  /** Whether the shadow quote was within the acceptable tolerance */
  withinTolerance: boolean;
  /** Reason when outside tolerance or unavailable */
  reason: string | null;
}

export interface ShadowCandleMetrics {
  provider: ShadowProvider;
  symbol: string;
  interval: string;
  sampledAt: string;
  canonicalCount: number;
  shadowCount: number | null;
  countMatch: boolean;
  /** Last canonical candle close */
  canonicalLastClose: number | null;
  /** Last shadow candle close */
  shadowLastClose: number | null;
  closeAbsDiff: number | null;
  closeRelDiff: number | null;
  withinTolerance: boolean;
  reason: string | null;
}

export interface ShadowParitySummary {
  provider: ShadowProvider;
  routingState: ShadowRoutingState;
  sampleCount: number;
  quoteSamples: ShadowQuoteMetrics[];
  candleSamples: ShadowCandleMetrics[];
  lastSampleAt: string | null;
  overallWithinTolerance: boolean;
  promotionEligible: false; // Pack 5: never automatically eligible
}

// ---------------------------------------------------------------------------
// Tolerance definitions (per domain, per §9.3)
// ---------------------------------------------------------------------------

/** LTP relative tolerance (fraction): 0.005 = 0.5% */
export const LTP_RELATIVE_TOLERANCE = 0.005;
/** Candle close relative tolerance: 0.005 = 0.5% */
export const CANDLE_CLOSE_RELATIVE_TOLERANCE = 0.005;
/** Maximum acceptable shadow quote age in seconds */
export const SHADOW_MAX_AGE_SEC = 120;
/** Maximum number of parity samples retained in memory (ring buffer) */
export const PARITY_SAMPLE_RING_SIZE = 100;

// ---------------------------------------------------------------------------
// Module-level state (per provider, single-process)
// ---------------------------------------------------------------------------

const _state = new Map<ShadowProvider, ShadowRoutingState>();
const _quoteSamples = new Map<ShadowProvider, ShadowQuoteMetrics[]>();
const _candleSamples = new Map<ShadowProvider, ShadowCandleMetrics[]>();
const _lastSampleAt = new Map<ShadowProvider, string>();
const _sampleCount = new Map<ShadowProvider, number>();

export function getShadowRoutingState(provider: ShadowProvider): ShadowRoutingState {
  return _state.get(provider) ?? "NOT_CONFIGURED";
}

export function setShadowRoutingState(provider: ShadowProvider, state: ShadowRoutingState): void {
  _state.set(provider, state);
}

/** Test seam: reset all state. */
export function __resetShadowStateForTests(): void {
  _state.clear();
  _quoteSamples.clear();
  _candleSamples.clear();
  _lastSampleAt.clear();
  _sampleCount.clear();
}

// ---------------------------------------------------------------------------
// Sample recording
// ---------------------------------------------------------------------------

function appendToRing<T>(map: Map<ShadowProvider, T[]>, provider: ShadowProvider, sample: T): void {
  const arr = map.get(provider) ?? [];
  arr.push(sample);
  if (arr.length > PARITY_SAMPLE_RING_SIZE) arr.splice(0, arr.length - PARITY_SAMPLE_RING_SIZE);
  map.set(provider, arr);
}

export function recordQuoteSample(metrics: ShadowQuoteMetrics): void {
  appendToRing(_quoteSamples, metrics.provider, metrics);
  _lastSampleAt.set(metrics.provider, metrics.sampledAt);
  _sampleCount.set(metrics.provider, (_sampleCount.get(metrics.provider) ?? 0) + 1);
}

export function recordCandleSample(metrics: ShadowCandleMetrics): void {
  appendToRing(_candleSamples, metrics.provider, metrics);
  _lastSampleAt.set(metrics.provider, metrics.sampledAt);
  _sampleCount.set(metrics.provider, (_sampleCount.get(metrics.provider) ?? 0) + 1);
}

export function getParitySummary(provider: ShadowProvider): ShadowParitySummary {
  const quotes = _quoteSamples.get(provider) ?? [];
  const candles = _candleSamples.get(provider) ?? [];
  const total = quotes.length + candles.length;
  const allInTolerance = total === 0 ||
    (quotes.every(q => q.withinTolerance) && candles.every(c => c.withinTolerance));
  return {
    provider,
    routingState: getShadowRoutingState(provider),
    sampleCount: _sampleCount.get(provider) ?? 0,
    quoteSamples: quotes.slice(-10), // last 10 only (safe)
    candleSamples: candles.slice(-10),
    lastSampleAt: _lastSampleAt.get(provider) ?? null,
    overallWithinTolerance: allInTolerance,
    promotionEligible: false, // Pack 5 hard block
  };
}

// ---------------------------------------------------------------------------
// Non-interference helpers
// ---------------------------------------------------------------------------

/**
 * Assert that a canonical result was not modified by shadow context.
 * Pure function used in shadow dispatch to double-check non-interference.
 * Returns true when safe (i.e., the shadow did not mutate the canonical value).
 */
export function assertCanonicalUnchanged<T>(
  before: T,
  after: T,
): boolean {
  // Simple JSON-serialization equality for plain data structures.
  // For non-serializable (branded) types, reference equality.
  if (before === after) return true;
  try {
    return JSON.stringify(before) === JSON.stringify(after);
  } catch {
    return false;
  }
}

/**
 * Fire-and-forget shadow dispatch: runs `shadowFn` without blocking `result`.
 * Any shadow error is caught and discarded — it MUST NOT affect the caller.
 * Shadow timeout is enforced via a race.
 */
export function fireShadow(
  shadowFn: () => Promise<void>,
  timeoutMs = 5_000,
): void {
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
  Promise.race([shadowFn(), timeout]).catch(() => {
    // Intentionally swallow all shadow errors — non-interference guarantee.
  });
}
