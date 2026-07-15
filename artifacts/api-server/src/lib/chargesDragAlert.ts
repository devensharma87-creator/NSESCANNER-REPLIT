/**
 * Charges-drag alert (owner-approved iteration 11).
 *
 * On each post-market run, compute today's F&O drag % of gross realized
 * P&L. Compare against the 7-day rolling median + 2σ from the last 7
 * IST trading days' post-close snapshots. Emit a Telegram warn message
 * on breach.
 *
 * Rationale: healthy days have a stable drag distribution driven by the
 * charge schedule; sudden spikes typically indicate either a
 * schedule-model bug, or a fat-finger position that skewed the ratio
 * (large stake with a small edge → charges eat everything).
 *
 * This helper computes PURE math. Persistence + notification are
 * hooked into `postMarketReports.runPostMarketCadence` in a follow-up
 * — kept pure here so it's fully unit-testable.
 */

export interface DragObservation {
  istDate: string;        // "YYYY-MM-DD"
  grossPnl: number;       // ₹, signed
  chargesTotal: number;   // ₹, always >= 0
}

export interface DragAlertConfig {
  /** Rolling window length in observations. Default 7. */
  windowSize?: number;
  /** Alert threshold in σ. Default 2.0. */
  sigmaThreshold?: number;
  /** Skip alert entirely if the window has fewer than this many days of
   *  useful data. Default 5. Prevents alerting on early-days variance. */
  minSamples?: number;
}

export interface DragAlertResult {
  /** Today's drag %, capped at absurd values (see clampDrag). */
  todayDragPct: number | null;
  /** Rolling median from the window (excluding today). */
  medianPct: number | null;
  /** Rolling σ from the window (excluding today). */
  sigmaPct: number | null;
  /** Threshold that must be exceeded to alert (median + Nσ). */
  thresholdPct: number | null;
  breach: boolean;
  reason: "OK" | "TOO_FEW_SAMPLES" | "TODAY_NULL" | "SIGMA_ZERO" | "BREACH";
}

/** Compute drag % from gross + charges. Returns null when gross is
 *  ≈ 0 (division would be meaningless). */
export function computeDragPct(obs: DragObservation): number | null {
  if (Math.abs(obs.grossPnl) < 0.005) return null;
  return (obs.chargesTotal / Math.abs(obs.grossPnl)) * 100;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

function populationStdev(nums: number[]): number {
  if (nums.length < 2) return 0;
  const mean = nums.reduce((s, x) => s + x, 0) / nums.length;
  const variance = nums.reduce((s, x) => s + (x - mean) ** 2, 0) / nums.length;
  return Math.sqrt(variance);
}

/**
 * Evaluate today's drag against a rolling window.
 *
 * @param today   Today's observation (drag % may be null on zero-gross days).
 * @param history Previous N observations, oldest-first. Only the tail of
 *                length `windowSize` is used.
 */
export function evaluateDragAlert(
  today: DragObservation,
  history: DragObservation[],
  cfg: DragAlertConfig = {},
): DragAlertResult {
  const windowSize = cfg.windowSize ?? 7;
  const sigmaThreshold = cfg.sigmaThreshold ?? 2.0;
  const minSamples = cfg.minSamples ?? 5;

  const todayPct = computeDragPct(today);
  if (todayPct == null) {
    return {
      todayDragPct: null,
      medianPct: null,
      sigmaPct: null,
      thresholdPct: null,
      breach: false,
      reason: "TODAY_NULL",
    };
  }

  const historyPcts = history
    .slice(-windowSize)
    .map((h) => computeDragPct(h))
    .filter((p): p is number => p != null);

  if (historyPcts.length < minSamples) {
    return {
      todayDragPct: todayPct,
      medianPct: null,
      sigmaPct: null,
      thresholdPct: null,
      breach: false,
      reason: "TOO_FEW_SAMPLES",
    };
  }

  const medianPct = median(historyPcts);
  const sigmaPct = populationStdev(historyPcts);

  if (sigmaPct < 1e-9) {
    // Perfectly stable schedule + volume mix — no useful threshold to
    // draw. Not a breach — just an under-informed alarm.
    return {
      todayDragPct: todayPct,
      medianPct,
      sigmaPct: 0,
      thresholdPct: medianPct,
      breach: false,
      reason: "SIGMA_ZERO",
    };
  }

  const thresholdPct = medianPct + sigmaThreshold * sigmaPct;
  const breach = todayPct > thresholdPct;
  return {
    todayDragPct: todayPct,
    medianPct,
    sigmaPct,
    thresholdPct,
    breach,
    reason: breach ? "BREACH" : "OK",
  };
}

/** Human-readable alert body for Telegram / logs. */
export function renderDragAlertMessage(
  today: DragObservation,
  result: DragAlertResult,
): string {
  if (!result.breach) return "";
  const md = result.medianPct?.toFixed(2) ?? "?";
  const sd = result.sigmaPct?.toFixed(2) ?? "?";
  const th = result.thresholdPct?.toFixed(2) ?? "?";
  const dr = result.todayDragPct?.toFixed(2) ?? "?";
  return (
    `⚠️ Charges-drag anomaly · ${today.istDate}\n` +
    `Today drag: ${dr}% of |gross|\n` +
    `7-day baseline: median ${md}% · σ ${sd}%\n` +
    `Threshold (median + 2σ): ${th}%\n` +
    `Gross: ₹${today.grossPnl.toLocaleString("en-IN")} · Charges: ₹-${today.chargesTotal.toLocaleString("en-IN")}\n` +
    `Likely causes: (a) charge-schedule model drift, (b) fat-finger position sizing, (c) micro-edge trades with heavy round-trip cost.`
  );
}
