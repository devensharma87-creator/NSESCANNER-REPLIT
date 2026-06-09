/**
 * Cross-provider source validation — PURE comparison of the authoritative Kite
 * quote against the secondary INDstocks quote for the same instrument.
 *
 * Produces a transparent verdict (MATCHED / WARNING / DATA_CONFLICT), the
 * per-field mismatch %, and a `blockSignal` flag. In task #123 `blockSignal` is
 * SURFACED in diagnostics only — it does not yet gate any execution path (that
 * is task #124). Price fields drive the verdict; volume is informational and
 * never escalates to a conflict (providers legitimately differ on cumulative
 * volume). No I/O — fully unit-testable.
 */

import type { QuoteCore } from "./types";

export type FieldVerdict = "MATCH" | "WARN" | "CONFLICT" | "NA";
export type CrossVerdict = "MATCHED" | "WARNING" | "DATA_CONFLICT";

export interface FieldComparison {
  field: string;
  kite: number | null;
  indstocks: number | null;
  diffPct: number | null;
  verdict: FieldVerdict;
  /** Volume is informational — it never escalates the overall verdict. */
  informationalOnly: boolean;
}

export interface ValidationResult {
  verdict: CrossVerdict;
  /** True only on DATA_CONFLICT — surfaced in diagnostics (does NOT gate yet). */
  blockSignal: boolean;
  /** Worst price-field mismatch %, or null when nothing comparable. */
  mismatchPct: number | null;
  fields: FieldComparison[];
  reason: string;
}

export interface PriceTolerance {
  warnPct: number;
  conflictPct: number;
}

export const VALIDATION_TOLERANCES: {
  lastPrice: PriceTolerance;
  previousClose: PriceTolerance;
  ohlc: PriceTolerance;
  volumeWarnPct: number;
} = {
  lastPrice: { warnPct: 0.5, conflictPct: 2.0 },
  previousClose: { warnPct: 0.25, conflictPct: 1.0 },
  ohlc: { warnPct: 0.75, conflictPct: 3.0 },
  volumeWarnPct: 25,
};

function diffPct(kite: number | null | undefined, ind: number | null | undefined): number | null {
  if (kite == null || ind == null || !Number.isFinite(kite) || !Number.isFinite(ind)) return null;
  if (kite === 0) return ind === 0 ? 0 : null;
  return Math.abs((ind - kite) / kite) * 100;
}

function priceField(
  field: string,
  kite: number | null | undefined,
  ind: number | null | undefined,
  tol: PriceTolerance,
): FieldComparison {
  const d = diffPct(kite, ind);
  let verdict: FieldVerdict = "NA";
  if (d != null) {
    verdict = d > tol.conflictPct ? "CONFLICT" : d > tol.warnPct ? "WARN" : "MATCH";
  }
  return {
    field,
    kite: kite ?? null,
    indstocks: ind ?? null,
    diffPct: d,
    verdict,
    informationalOnly: false,
  };
}

/** Compare an authoritative Kite quote against an INDstocks secondary quote. */
export function validateQuotePair(kite: QuoteCore, ind: QuoteCore): ValidationResult {
  const fields: FieldComparison[] = [
    priceField("lastPrice", kite.lastPrice, ind.lastPrice, VALIDATION_TOLERANCES.lastPrice),
    priceField("previousClose", kite.previousClose, ind.previousClose, VALIDATION_TOLERANCES.previousClose),
    priceField("open", kite.open, ind.open, VALIDATION_TOLERANCES.ohlc),
    priceField("high", kite.high, ind.high, VALIDATION_TOLERANCES.ohlc),
    priceField("low", kite.low, ind.low, VALIDATION_TOLERANCES.ohlc),
  ];

  // Volume — informational only.
  const volDiff = diffPct(kite.volume, ind.volume);
  fields.push({
    field: "volume",
    kite: kite.volume ?? null,
    indstocks: ind.volume ?? null,
    diffPct: volDiff,
    verdict: volDiff == null ? "NA" : volDiff > VALIDATION_TOLERANCES.volumeWarnPct ? "WARN" : "MATCH",
    informationalOnly: true,
  });

  const priceFields = fields.filter((f) => !f.informationalOnly);
  const comparable = priceFields.filter((f) => f.diffPct != null);
  const mismatchPct = comparable.length
    ? Math.max(...comparable.map((f) => f.diffPct as number))
    : null;

  // Only price fields drive the verdict. Volume is informational and never
  // escalates the verdict (INDstocks full-quote volume can legitimately lag /
  // differ from Kite); it is still surfaced per-field for the owner to inspect.
  const hasConflict = priceFields.some((f) => f.verdict === "CONFLICT");
  const hasWarn = priceFields.some((f) => f.verdict === "WARN");

  let verdict: CrossVerdict;
  let reason: string;
  if (comparable.length === 0) {
    verdict = "WARNING";
    reason = "No comparable price fields between Kite and INDstocks.";
  } else if (hasConflict) {
    verdict = "DATA_CONFLICT";
    const worst = priceFields
      .filter((f) => f.verdict === "CONFLICT")
      .map((f) => `${f.field} ${(f.diffPct as number).toFixed(2)}%`)
      .join(", ");
    reason = `Price conflict beyond tolerance: ${worst}.`;
  } else if (hasWarn) {
    verdict = "WARNING";
    reason = `Minor cross-provider divergence within warn band (worst ${mismatchPct?.toFixed(2)}%).`;
  } else {
    verdict = "MATCHED";
    reason = `Kite and INDstocks agree within tolerance (worst ${mismatchPct?.toFixed(2)}%).`;
  }

  return {
    verdict,
    blockSignal: verdict === "DATA_CONFLICT",
    mismatchPct,
    fields,
    reason,
  };
}
