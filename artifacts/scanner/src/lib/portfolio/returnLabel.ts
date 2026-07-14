/**
 * Portfolio Analyser — return-metric labelling.
 *
 * The annualised figure is a true XIRR ONLY when every holding contributed a
 * dated cashflow. When some holdings were excluded (missing purchase date or
 * live value) the same number is an *estimate* over the dated subset, and is
 * labelled as such. When nothing was computable it is explicitly unavailable.
 * Never presents a fabricated or mislabelled return.
 */

export type ReturnLabelKind = "XIRR" | "ESTIMATE" | "UNAVAILABLE";

export interface ReturnLabel {
  kind: ReturnLabelKind;
  /** Short heading for the metric. */
  label: string;
  /** Annualised fraction (0.18 = 18%), or null when unavailable. */
  value: number | null;
  /** Explanatory tooltip — always factual about what was/wasn't included. */
  tooltip: string;
}

export interface ReturnLabelInput {
  approxXirr: number | null;
  /** Holdings excluded from the cashflow set (no date or no live value). */
  xirrExcluded: number;
  holdingsCount: number;
}

export function returnLabel(input: ReturnLabelInput): ReturnLabel {
  const { approxXirr, xirrExcluded, holdingsCount } = input;

  if (approxXirr == null) {
    return {
      kind: "UNAVAILABLE",
      label: "XIRR unavailable",
      value: null,
      tooltip:
        "XIRR needs at least one holding with a valid purchase date and a live current value. " +
        "Add purchase dates (and ensure live prices resolve) to compute an annualised return.",
    };
  }

  if (xirrExcluded > 0) {
    const included = Math.max(0, holdingsCount - xirrExcluded);
    return {
      kind: "ESTIMATE",
      label: "Annualised Return Estimate",
      value: approxXirr,
      tooltip:
        `Money-weighted annualised return over the ${included} of ${holdingsCount} holding(s) that ` +
        `had a valid purchase date and a live value. ${xirrExcluded} holding(s) were excluded, ` +
        "so this is a partial estimate, not a full-portfolio XIRR.",
    };
  }

  return {
    kind: "XIRR",
    label: "XIRR",
    value: approxXirr,
    tooltip:
      "Money-weighted annualised return (XIRR) computed from each holding's dated purchase outflow " +
      "and its live current value today. All holdings contributed a dated cashflow.",
  };
}
