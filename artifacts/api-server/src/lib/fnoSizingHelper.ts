/**
 * F&O dynamic lot-sizing helper (pure).
 *
 * Single source of truth for "how many lots may this F&O paper trade open
 * right now?" — used by `paperTradingFO.openPaperTrade`. Zero side effects:
 * no DB, no audit rows, no signal-pipeline contact. Pure function over an
 * `FnoSizingInput`.
 *
 * OWNER-APPROVED model (2026-06-11):
 *
 *   The risk base is the LIVE available cash (paper_account.balance), NOT
 *   the original seed capital. As the bankroll grows/shrinks, both the
 *   per-trade risk budget and the portfolio-heat cap scale with it. The
 *   per-index `PAPER_FIXED_LOTS` map is now only a CEILING — dynamic
 *   sizing may open fewer lots, never more.
 *
 * Formula:
 *
 *   riskBase             = availableCash
 *   perTradeRiskBudget   = availableCash × maxLossPctPerTrade
 *   heatCap              = availableCash × maxFnoHeatPct
 *   riskPerLot           = |entryPremium − stopPremium| × lotSize
 *   maxLotsByTradeRisk   = floor(perTradeRiskBudget / riskPerLot)
 *   maxLotsByPortfolioHeat = floor((heatCap − currentHeat) / riskPerLot)
 *   absoluteMaxLots      = PAPER_FIXED_LOTS[index]   (ceiling; null = none)
 *   finalLots            = min(maxLotsByTradeRisk, maxLotsByPortfolioHeat, absoluteMaxLots)
 *
 * Rejections (finalLots < 1), risk checked FIRST per owner spec:
 *   - RISK_TOO_WIDE_FOR_MIN_LOT — one lot's risk exceeds the per-trade budget
 *   - PORTFOLIO_HEAT_CAP        — no heat headroom left for even one lot
 *   - INVALID_PLAN              — non-finite / non-positive premium distance or inputs
 *
 * NOTE: this helper computes the BASE lot count. The caller still applies
 * its post-stop cool-down / VOLATILE-regime multipliers AFTER this (which
 * only ever REDUCE size) and keeps a FINAL fail-closed heat assertion as
 * defense-in-depth. Capital moves (top-up / withdraw) only change
 * `availableCash`; they are never P&L.
 *
 * The reason strings are stable ENUM-like strings so callers/UI can switch
 * on them. `verdict` is "ACCEPT" only when at least one lot fits.
 */

export type FnoSizingVerdict = "ACCEPT" | "REJECT";

export type FnoSizingRejectReason =
  | "INVALID_PLAN"
  | "RISK_TOO_WIDE_FOR_MIN_LOT"
  | "PORTFOLIO_HEAT_CAP";

export interface FnoSizingInput {
  /** Display tag (only echoed back; no lookups). */
  indexSymbol: string;
  /** Locked option entry premium (₹/share). */
  entryPremium: number;
  /** Locked option stop premium (₹/share). For a long option, < entry. */
  stopPremium: number;
  /** Contract lot size (shares per lot). */
  lotSize: number;
  /** LIVE available cash in the F&O paper account (₹) = paper_account.balance. */
  availableCash: number;
  /** Per-trade risk budget as a fraction of availableCash (e.g. 0.02 = 2%). */
  maxLossPctPerTrade: number;
  /** Current portfolio heat (₹) = Σ risk across all OPEN F&O positions. */
  currentHeat: number;
  /** Portfolio heat cap as a fraction of availableCash (e.g. 0.06 = 6%). */
  maxFnoHeatPct: number;
  /**
   * Hard ceiling on lots for this index (from PAPER_FIXED_LOTS). Pass
   * undefined / null for indices with no configured ceiling — dynamic
   * sizing is then bounded only by risk + heat.
   */
  absoluteMaxLots?: number | null;
}

export interface FnoSizingResult {
  verdict: FnoSizingVerdict;
  /** Specific reason when verdict === "REJECT"; null on ACCEPT. */
  reason: FnoSizingRejectReason | null;
  /** Human-readable explanation (audit-detail style). */
  detail: string;

  /** Final lot count to open. 0 on REJECT. */
  lots: number;

  /* Working numbers — populated regardless of verdict for UI/tooltips. */
  riskBase: number;
  perTradeRiskBudget: number;
  heatCap: number;
  heatAvailable: number;
  perShareLoss: number;
  riskPerLot: number;
  maxLotsByTradeRisk: number;
  maxLotsByPortfolioHeat: number;
  /** Echo of the ceiling actually applied; null when none configured. */
  absoluteMaxLots: number | null;
  /** This trade's incremental heat = lots × riskPerLot. */
  newHeat: number;
  /** currentHeat + newHeat. */
  projectedHeat: number;
}

export function computeFnoLotSizing(input: FnoSizingInput): FnoSizingResult {
  const {
    indexSymbol,
    entryPremium,
    stopPremium,
    lotSize,
    availableCash,
    maxLossPctPerTrade,
    currentHeat,
    maxFnoHeatPct,
  } = input;
  const absoluteMaxLots =
    input.absoluteMaxLots == null || !Number.isFinite(input.absoluteMaxLots)
      ? null
      : input.absoluteMaxLots;

  const perShareLoss = Math.abs(entryPremium - stopPremium);
  const riskPerLot = perShareLoss * lotSize;
  const riskBase = availableCash;
  const perTradeRiskBudget = availableCash * maxLossPctPerTrade;
  const heatCap = availableCash * maxFnoHeatPct;
  const heatAvailable = heatCap - currentHeat;

  // Guard — a degenerate plan can't be sized.
  if (
    !Number.isFinite(entryPremium) ||
    !Number.isFinite(stopPremium) ||
    !Number.isFinite(lotSize) ||
    lotSize <= 0 ||
    !(perShareLoss > 0) ||
    !(riskPerLot > 0) ||
    !Number.isFinite(availableCash) ||
    !Number.isFinite(maxLossPctPerTrade) ||
    !Number.isFinite(maxFnoHeatPct)
  ) {
    return buildResult({
      verdict: "REJECT",
      reason: "INVALID_PLAN",
      detail: `Cannot size ${indexSymbol}: invalid plan (entry=${entryPremium}, stop=${stopPremium}, lotSize=${lotSize}, perShareLoss=${perShareLoss})`,
      perShareLoss,
      riskPerLot,
      riskBase,
      perTradeRiskBudget,
      heatCap,
      heatAvailable,
      absoluteMaxLots,
    });
  }

  const maxLotsByTradeRisk = Math.floor(perTradeRiskBudget / riskPerLot);
  const maxLotsByPortfolioHeat =
    heatAvailable > 0 ? Math.floor(heatAvailable / riskPerLot) : 0;
  const ceiling = absoluteMaxLots ?? Number.POSITIVE_INFINITY;
  const finalLots = Math.min(maxLotsByTradeRisk, maxLotsByPortfolioHeat, ceiling);

  const base = {
    perShareLoss,
    riskPerLot,
    riskBase,
    perTradeRiskBudget,
    heatCap,
    heatAvailable,
    maxLotsByTradeRisk,
    maxLotsByPortfolioHeat,
    absoluteMaxLots,
  };

  if (finalLots < 1) {
    // Risk-budget shortfall is checked FIRST per owner spec — it is the more
    // fundamental constraint (one lot is simply too expensive to risk),
    // whereas a heat block can clear as open positions close.
    if (maxLotsByTradeRisk < 1) {
      return buildResult({
        ...base,
        verdict: "REJECT",
        reason: "RISK_TOO_WIDE_FOR_MIN_LOT",
        detail: `One lot risks ₹${riskPerLot.toFixed(2)} > per-trade budget ₹${perTradeRiskBudget.toFixed(2)} (${(maxLossPctPerTrade * 100).toFixed(2)}% of ₹${availableCash.toFixed(2)} cash) for ${indexSymbol}`,
      });
    }
    return buildResult({
      ...base,
      verdict: "REJECT",
      reason: "PORTFOLIO_HEAT_CAP",
      detail: `No heat headroom for one lot of ${indexSymbol}: available ₹${heatAvailable.toFixed(2)} (cap ₹${heatCap.toFixed(2)} − used ₹${currentHeat.toFixed(2)}) < risk/lot ₹${riskPerLot.toFixed(2)}`,
    });
  }

  const newHeat = finalLots * riskPerLot;
  const projectedHeat = currentHeat + newHeat;
  const bind =
    finalLots === ceiling
      ? "ceiling"
      : finalLots === maxLotsByTradeRisk
        ? "per-trade risk"
        : "portfolio heat";
  return buildResult({
    ...base,
    verdict: "ACCEPT",
    reason: null,
    lots: finalLots,
    newHeat,
    projectedHeat,
    detail: `Size ${indexSymbol} to ${finalLots} lot(s) — min(risk ${maxLotsByTradeRisk}, heat ${maxLotsByPortfolioHeat}, ceiling ${absoluteMaxLots ?? "none"}); bound by ${bind}. Risk ₹${newHeat.toFixed(2)} on ₹${availableCash.toFixed(2)} cash`,
  });
}

function buildResult(
  partial: Pick<FnoSizingResult, "verdict" | "reason" | "detail"> &
    Partial<Omit<FnoSizingResult, "verdict" | "reason" | "detail">>,
): FnoSizingResult {
  return {
    verdict: partial.verdict,
    reason: partial.reason,
    detail: partial.detail,
    lots: partial.lots ?? 0,
    riskBase: partial.riskBase ?? 0,
    perTradeRiskBudget: partial.perTradeRiskBudget ?? 0,
    heatCap: partial.heatCap ?? 0,
    heatAvailable: partial.heatAvailable ?? 0,
    perShareLoss: partial.perShareLoss ?? 0,
    riskPerLot: partial.riskPerLot ?? 0,
    maxLotsByTradeRisk: partial.maxLotsByTradeRisk ?? 0,
    maxLotsByPortfolioHeat: partial.maxLotsByPortfolioHeat ?? 0,
    absoluteMaxLots: partial.absoluteMaxLots ?? null,
    newHeat: partial.newHeat ?? 0,
    projectedHeat: partial.projectedHeat ?? 0,
  };
}
