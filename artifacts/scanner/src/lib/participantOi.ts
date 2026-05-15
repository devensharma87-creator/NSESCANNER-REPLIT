/**
 * Pure helpers for Participant-wise Open Interest math.
 *
 * Single source of truth for the per-segment "Net OI" formulas surfaced on
 * the /flows page. Lives in /lib (no React, no fetch) so the same code can
 * be unit-tested in isolation and imported by both the table view and the
 * stance scorer without drift.
 *
 * Formula contract (NSE F&O participant-wise OI archive convention)
 * ──────────────────────────────────────────────────────────────────
 *   Index Futures   :  Long − Short
 *   Stock Futures   :  Long − Short
 *   Index Options   :  (Call Long + Put Short) − (Call Short + Put Long)
 *   Stock Options   :  (Call Long + Put Short) − (Call Short + Put Long)
 *
 * The options formulas are DIRECTIONAL — long calls and short puts are
 * bullish exposure, short calls and long puts are bearish exposure. A naive
 * `(CallLong + PutLong) − (CallShort + PutShort)` ignores that calls and
 * puts have opposite directional meaning and produces values that flip sign
 * arbitrarily as participants rotate between calls and puts. Reference
 * desks (NSE EOD desks, StockMojo summary, niftytrader) all use the
 * directional formula above.
 *
 * Units: every value here is in CONTRACTS (raw lot count). Never label the
 * output as rupee crores. Lakh formatting (1L = 100,000) is purely a
 * display concern handled by `formatLakh` / `formatLakhSigned`.
 */

export type SegmentKey = "indexFut" | "stockFut" | "indexOpt" | "stockOpt";

/**
 * Subset of the Participant OI row shape needed by the formulas. Matches
 * the OpenAPI `ParticipantOiRow` schema (a superset is also accepted).
 */
export interface ParticipantOiComponents {
  futureIndexLong: number;
  futureIndexShort: number;
  futureStockLong: number;
  futureStockShort: number;
  optionIndexCallLong: number;
  optionIndexCallShort: number;
  optionIndexPutLong: number;
  optionIndexPutShort: number;
  optionStockCallLong: number;
  optionStockCallShort: number;
  optionStockPutLong: number;
  optionStockPutShort: number;
}

export const SEGMENT_FORMULAS: Record<SegmentKey, string> = {
  indexFut: "Future Index Long − Future Index Short",
  stockFut: "Future Stock Long − Future Stock Short",
  indexOpt:
    "(Index Call Long + Index Put Short) − (Index Call Short + Index Put Long)",
  stockOpt:
    "(Stock Call Long + Stock Put Short) − (Stock Call Short + Stock Put Long)",
};

export const SEGMENT_LABELS: Record<SegmentKey, string> = {
  indexFut: "Index Futures",
  stockFut: "Stock Futures",
  indexOpt: "Index Options",
  stockOpt: "Stock Options",
};

/**
 * Compute the directional Net OI for a single segment of a single
 * participant. Returns contracts (signed integer-valued; a participant
 * cannot hold a fractional lot, so non-integer inputs indicate upstream
 * data corruption — we still return the arithmetic result so callers can
 * detect and surface the discrepancy via Σ checks).
 */
export function computeSegmentNet(
  r: ParticipantOiComponents,
  seg: SegmentKey,
): number {
  switch (seg) {
    case "indexFut":
      return r.futureIndexLong - r.futureIndexShort;
    case "stockFut":
      return r.futureStockLong - r.futureStockShort;
    case "indexOpt":
      return (
        (r.optionIndexCallLong + r.optionIndexPutShort) -
        (r.optionIndexCallShort + r.optionIndexPutLong)
      );
    case "stockOpt":
      return (
        (r.optionStockCallLong + r.optionStockPutShort) -
        (r.optionStockCallShort + r.optionStockPutLong)
      );
  }
}

/**
 * Day-over-day change in Net OI for a segment. Returns null if either side
 * is missing (the UI must show "—" rather than fabricate a zero baseline,
 * which would silently understate the change on the first available date).
 */
export function computeSegmentChange(
  today: ParticipantOiComponents | undefined,
  prev: ParticipantOiComponents | undefined,
  seg: SegmentKey,
): number | null {
  if (!today || !prev) return null;
  return computeSegmentNet(today, seg) - computeSegmentNet(prev, seg);
}

/* ── Lakh formatting (1L = 100,000) ─────────────────────────────────────
 * Display-only. Pulled in here so the audit endpoint can return the same
 * formatted string the UI shows, eliminating ambiguity when comparing
 * against reference screenshots. */

const LAKH = 100_000;

export function formatLakh(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= LAKH) {
    const sign = n < 0 ? "-" : "";
    return `${sign}${(abs / LAKH).toFixed(2)}L`;
  }
  // Sub-lakh values stay raw with Indian grouping.
  return n.toLocaleString("en-IN");
}

export function formatLakhSigned(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  const formatted = formatLakh(n);
  return n > 0 ? `+${formatted}` : formatted;
}
