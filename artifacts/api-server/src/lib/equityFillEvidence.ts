/**
 * Canonical equity execution-fill evidence type (P0.2 Corrections 2–4, 2026-07-22).
 *
 * An EquityFillEvidence object is the inseparable bundle of fill price,
 * provider quote timestamp, and source provenance that Phase B validates
 * before authorizing a durable equity open.
 *
 * Only constructable via `buildEquityFillEvidence()` — the opaque unique-symbol
 * brand field prevents callers from satisfying the interface without going through
 * the factory. No cryptographic protection is claimed; the requirement is a single
 * controlled construction path so the durable writer cannot receive price from one
 * object and timestamp from another.
 *
 * Struct design: `price` and `providerQuoteTimestamp` are taken from the same
 * `row.quote` object so they are provably from the same upstream Kite event
 * (kq.last_price and kq.ts). Separating them at construction is impossible.
 */

// Module-private unique symbol — NOT exported.
// External modules cannot name this key and therefore cannot construct a
// compliant EquityFillEvidence object literal without going through
// buildEquityFillEvidence(). TypeScript enforces this at compile time.
const _EVIDENCE_BRAND: unique symbol = Symbol("EquityFillEvidence@equityFillEvidence.ts");

/**
 * Immutable, opaque-branded evidence bundle for an equity fill.
 * Only constructable via `buildEquityFillEvidence()`.
 *
 * The brand is an unexported unique symbol: external code cannot name the
 * key and therefore cannot satisfy this interface in an object literal without
 * a type-assertion cast. TypeScript will emit a compile error on any uncast
 * external object literal (verified by @ts-expect-error in tradeAdmission.test.ts).
 */
export interface EquityFillEvidence {
  /**
   * Opaque brand key — enforces single controlled construction path.
   * The symbol is unexported; only buildEquityFillEvidence() can produce
   * a structurally valid EquityFillEvidence without a type-assertion bypass.
   */
  readonly [_EVIDENCE_BRAND]: void;
  /** NSE symbol — must equal ctx.instrument at Phase B entry. */
  readonly instrument: string;
  /**
   * Modeled fill price: kq.last_price from the same upstream Kite event
   * as providerQuoteTimestamp. Always > 0.
   */
  readonly price: number;
  /**
   * Kite feed event timestamp: new Date(kq.ts).
   * Phase B derives quote age from (decisionTime − providerQuoteTimestamp).
   * Always a finite Date and never in the future relative to decisionTime.
   */
  readonly providerQuoteTimestamp: Date;
  /**
   * Provider that served the quote.
   * Typically "kite" for authoritative equity fills; "yahoo" or "unknown" for
   * secondary/unavailable sources that will be rejected at the trade-grade check.
   */
  readonly providerIdentity: string;
  /** Coarse trust tier — must be "authoritative" for a trade-grade fill. */
  readonly sourceTrustTier: "authoritative" | "secondary_analytics" | "unavailable";
  /**
   * True when the source must never drive trade decisions.
   * Set when sourceProvider="yahoo", or when kitePriceOverlay=true
   * (Kite LTP overlay on a Yahoo-signal scanner row — price source is Kite
   * but the signal itself is Yahoo, so the quote is not trade-grade).
   */
  readonly notForTradeDecisions: boolean;
  /**
   * True when the quote exceeds its freshness budget at scan-build time.
   * null when the scanner could not determine staleness.
   * Note: Phase B re-derives freshness from execution-time age — this field
   * reflects the scanner's assessment at build time, not the fill-time age.
   */
  readonly isStale: boolean | null;
  /** Descriptive kind of the price source, e.g. "kite_ltp". */
  readonly priceSourceKind: string;
  /**
   * Freshness-policy identifier resolved to a max-age via `resolveFreshnessPolicy()`.
   * Must be a key of EQUITY_FRESHNESS_POLICY.
   * Source: MODULE_REQUIREMENTS.watchlist.quote.maxFreshnessSec (requirements.ts:189)
   */
  readonly freshnessPolicyId: string;
}

/**
 * Phase-B-validated fill evidence returned on successful final admission.
 *
 * The durable writer MUST use `price` and `instrument` from this object — not
 * from the original signal or any other source. This is the structural binding
 * enforced by P0.2 Correction 4.
 */
export interface ValidatedFillEvidence {
  /** Phase-B-approved fill price (from EquityFillEvidence.price). */
  readonly price: number;
  /** Phase-B-confirmed instrument symbol (from EquityFillEvidence.instrument). */
  readonly instrument: string;
  /** Upstream Kite feed event timestamp (EquityFillEvidence.providerQuoteTimestamp). */
  readonly providerTimestamp: Date;
  /** Decision instant captured at open-attempt time (FinalExecutionAdmissionContext.decisionTime). */
  readonly decisionTime: Date;
  /** Execution-time age in seconds: (decisionTime − providerTimestamp) / 1000. Derived internally. */
  readonly computedAgeSec: number;
  /** Provider identity from the evidence object (e.g. "kite"). */
  readonly provider: string;
  /** Freshness-policy identifier from the evidence (e.g. "watchlist.quote.maxFreshnessSec"). */
  readonly policyId: string;
  /** Maximum acceptable age in seconds resolved from policyId. */
  readonly policyMaxAgeSec: number;
}

/**
 * Authoritative freshness policy registry for equity fill evidence.
 * Source of truth: MODULE_REQUIREMENTS in marketData/requirements.ts.
 * All values are in seconds.
 */
export const EQUITY_FRESHNESS_POLICY: Readonly<Record<string, number>> = {
  /**
   * Watchlist quote max freshness.
   * MODULE_REQUIREMENTS.watchlist.quote.maxFreshnessSec (requirements.ts:189)
   */
  "watchlist.quote.maxFreshnessSec": 120,
};

/**
 * Resolve a freshness-policy identifier to its maximum acceptable age in seconds.
 *
 * Returns null when the policy identifier is not registered in EQUITY_FRESHNESS_POLICY.
 * Callers should propagate null as TRADE_ADMISSION_CONTEXT_INCOMPLETE.
 */
export function resolveFreshnessPolicy(policyId: string): number | null {
  const maxAge = EQUITY_FRESHNESS_POLICY[policyId];
  return typeof maxAge === "number" ? maxAge : null;
}

// ─── Minimal shapes the builder reads from a scanner row ─────────────────────

/** Minimal quote snapshot required by buildEquityFillEvidence. */
interface StockQuoteSnapshot {
  price: number;
  updatedAt?: Date | null;
}

/** Minimal provenance snapshot required by buildEquityFillEvidence. */
interface StockProvenanceSnapshot {
  sourceProvider?: string | null;
  trustTier?: string;
  notForTradeDecisions?: boolean;
  isStale?: boolean | null;
  kitePriceOverlay?: boolean;
}

/**
 * Minimal scanner-row shape required by buildEquityFillEvidence.
 * Compatible with the StockRow shape from fullNseScanner.ts.
 */
export interface StockRowForEvidence {
  symbol: string;
  quote: StockQuoteSnapshot;
  provenance?: StockProvenanceSnapshot | null;
}

/**
 * Canonical factory for EquityFillEvidence.
 *
 * Takes `price` and `providerQuoteTimestamp` from the same `row.quote` object
 * so they are provably from the same upstream Kite event (kq.last_price and
 * kq.ts are inseparable). Returns null when the row lacks a valid positive
 * price or a finite non-null Date timestamp — callers must treat null as a
 * structured pre-writer rejection.
 *
 * - price:                  row.quote.price          = kq.last_price
 * - providerQuoteTimestamp: row.quote.updatedAt      = new Date(kq.ts)
 * - providerIdentity, sourceTrustTier, notForTradeDecisions, isStale:
 *     from row.provenance (built by buildSourceProvenance in fullNseScanner.ts)
 *
 * kitePriceOverlay: when true, the price came from a Kite LTP overlay but the
 * signal/indicator source is Yahoo — the fill is not trade-grade and
 * notForTradeDecisions is set to true.
 */
export function buildEquityFillEvidence(
  row: StockRowForEvidence,
): EquityFillEvidence | null {
  const price = row.quote.price;
  const updatedAt = row.quote.updatedAt;

  if (!(price > 0)) return null;
  if (!(updatedAt instanceof Date) || !isFinite(updatedAt.getTime())) return null;

  const prov = row.provenance;
  const providerIdentity = prov?.sourceProvider ?? "unknown";
  const rawTrustTier = prov?.trustTier ?? "unavailable";
  const sourceTrustTier: EquityFillEvidence["sourceTrustTier"] =
    rawTrustTier === "authoritative"
      ? "authoritative"
      : rawTrustTier === "secondary_analytics"
        ? "secondary_analytics"
        : "unavailable";
  const kitePriceOverlay = prov?.kitePriceOverlay ?? false;
  const notForTradeDecisions = (prov?.notForTradeDecisions ?? true) || kitePriceOverlay;
  const isStale = prov?.isStale ?? null;

  return Object.freeze({
    [_EVIDENCE_BRAND]: undefined as void,
    instrument: row.symbol,
    price,
    providerQuoteTimestamp: updatedAt,
    providerIdentity,
    sourceTrustTier,
    notForTradeDecisions,
    isStale,
    priceSourceKind: providerIdentity === "kite" ? "kite_ltp" : `${providerIdentity}_price`,
    freshnessPolicyId: "watchlist.quote.maxFreshnessSec",
  }) as EquityFillEvidence;
}

// ─── Pure writer-mapping seam ─────────────────────────────────────────────────

/**
 * Core equity insert values derived directly from Phase-B-validated fill evidence.
 *
 * All fields are raw (pre-DB-formatting) so tests can verify the mapping without
 * a database. The durable writer applies toDbNumeric() to numeric fields before
 * the actual SQL insert — that formatting step is a separate concern.
 */
export interface EquityInsertCore {
  /** Directly from ValidatedFillEvidence.instrument — NOT signal.symbol. */
  symbol: string;
  /** Directly from ValidatedFillEvidence.price — NOT signal.entryPrice. */
  entryPrice: number;
  /** Same as entryPrice at open time — both come from ValidatedFillEvidence.price. */
  lastPrice: number;
  /** Directly from ValidatedFillEvidence.decisionTime. */
  openedAt: Date;
  /** Same as openedAt — both from ValidatedFillEvidence.decisionTime. */
  lastEvaluatedAt: Date;
}

/**
 * Pure writer-mapping seam: maps Phase-B-validated fill evidence to the core
 * equity insert values (P0.2 Corrections 3 + 4).
 *
 * Tests import this function to verify the exact mapping that the durable writer
 * uses, without requiring a database connection or a live paper-trade insert.
 * The production insert path uses the same derivation: symbol and price come
 * directly from validatedFill, never from signal.symbol or signal.entryPrice.
 */
export function buildEquityInsertCore(fill: ValidatedFillEvidence): EquityInsertCore {
  return {
    symbol: fill.instrument,
    entryPrice: fill.price,
    lastPrice: fill.price,
    openedAt: fill.decisionTime,
    lastEvaluatedAt: fill.decisionTime,
  };
}
