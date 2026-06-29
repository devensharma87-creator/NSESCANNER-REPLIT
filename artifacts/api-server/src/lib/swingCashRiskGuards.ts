/**
 * Part D — Swing Cash Risk Guards composer (pure).
 *
 * `evaluateSwingCashRisk(candidate, portfolioState, config)` runs the full
 * swing-CASH live-readiness gate chain and returns a single decision. It is the
 * swing-cash analogue of `fnoPaperRiskGuards.evaluateFnoPaperRiskGuards`, but it
 * is COMPLETELY ISOLATED from the F&O engine: it never imports, reads, or mutates
 * any F&O / option-chain / capital-ledger / paper-trade state.
 *
 * ABSOLUTE RULES:
 *   - Pure: no DB, no network, no side effects, no order placement.
 *   - Never recomputes the swing scoring / entry / stop / target — those come
 *     immutable from the existing scanner via the candidate.
 *   - Default config is the SAFEST: mode "paper_only", manual approval required,
 *     live capital capped small, all blocking gates ON. Nothing here can place a
 *     live order; live execution is wired (and hard-disabled) only in later phases.
 *
 * Gate chain (functional order; sizing precedes exposure/cost because both need
 * the proposed position value/qty):
 *   DataTrust(B) → Entry(C) → Liquidity(F) → Event(H) → Sizing(E) → Exposure(G) → Cost(N)
 *   + portfolio-level caps (open/daily/weekly).
 */

import type {
  SwingCashCandidate,
  SwingCashPortfolioState,
  SwingCashRiskConfig,
  SwingCashRiskDecision,
  SwingCashBlockReason,
} from "./swingCashTypes";
import { evaluateSwingCashDataTrust } from "./swingCashDataTrust";
import { evaluateSwingCashEntry } from "./swingCashEntryGate";
import { evaluateSwingCashLiquidity } from "./swingCashLiquidity";
import { evaluateSwingCashEventRisk } from "./swingCashEventRisk";
import { evaluateSwingCashExposure } from "./swingCashExposure";
import { computeSwingCashSizing } from "./swingCashSizing";
import { computeSwingCashCost } from "./swingCashCostModel";

// ---------------------------------------------------------------------------
// Default conservative config (Part M). SAFEST possible defaults.
// ---------------------------------------------------------------------------

export const DEFAULT_SWING_CASH_CONFIG: SwingCashRiskConfig = {
  // Safest mode. Nothing is wired to execution; this only classifies.
  mode: "paper_only",
  minRR: 1.8,
  // Live readiness starts on 10% of the book, so per-trade risk/value stay tiny.
  liveCapitalCapPct: 10,
  maxOpenPositions: 3,
  maxDailyEntries: 1,
  maxWeeklyEntries: 3,
  requireManualApproval: true,
  blockIfKiteOffline: true,
  blockIfDataStale: true,
  blockOnEventRisk: true,
  blockOnLowLiquidity: true,
  blockOnWeakRR: true,
  dataTrust: {
    dailyMaxAgeMs: 30 * 60 * 60 * 1000, // 30h — covers an overnight gap, not a weekend.
    ltpMaxAgeMs: 5 * 60 * 1000, // 5 min.
    // Kite-only by default. No licensed provider is approved/wired yet (owner
    // decision pending), so it must be added EXPLICITLY via config — never
    // trusted implicitly.
    tradeGradeSources: ["kite"],
    requireBenchmark: true,
    requireSector: true,
  },
  entry: {
    maxSignalAgeDays: 3,
    maxChaseAtrMultiple: 0.5,
    maxChasePctOfEntry: 2,
    minDistToTargetPct: 1.0,
    minDistToStopPct: 1.0,
    minRR: 1.8,
  },
  liquidity: {
    minAvgTradedValue: 50_000_000, // ₹5 cr/day.
    minVolume: 100_000,
    maxSpreadPct: 0.5,
    minDeliveryPct: 30,
    blockOnAsmGsm: true,
    blockOnCircuit: true,
  },
  eventRisk: {
    resultWithinDaysBlock: 3,
    blockOnResultDay: true,
    blockOnCorporateAction: true,
    requireApprovalWhenUnavailable: true,
  },
  exposure: {
    maxSectorExposurePct: 25,
    maxSingleStockExposurePct: 8,
    blockDuplicate: true,
    blockConsecutiveDaySameStock: true,
    sectorCrowdedWarnCount: 3,
  },
  sizing: {
    riskPerTradePct: 0.5,
    maxRiskPerTrade: 500,
    maxPositionValuePct: 5,
    reserveCashPct: 20,
    slippageBufferPct: 0.5,
    gapBufferPct: 2,
    minPositionValue: 1000,
    lotSize: 1,
  },
  cost: {
    brokeragePerOrder: 0, // zero-brokerage delivery (discount broker).
    brokeragePct: 0,
    sttPct: 0.1, // delivery STT, each side.
    exchangeTxnPct: 0.00297, // NSE.
    sebiPct: 0.0001,
    stampDutyPctBuy: 0.015,
    gstPct: 18,
    dpChargePerSell: 15.93,
    slippagePct: 0.05,
    gapBufferPct: 2,
  },
};

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

export function evaluateSwingCashRisk(
  candidate: SwingCashCandidate,
  portfolio: SwingCashPortfolioState,
  config: SwingCashRiskConfig = DEFAULT_SWING_CASH_CONFIG,
): SwingCashRiskDecision {
  const reasons: SwingCashBlockReason[] = [];
  const warnings: string[] = [];
  const explanation: string[] = [];
  let reviewRequired = false;

  const pushReason = (r: SwingCashBlockReason, text: string) => {
    if (!reasons.includes(r)) reasons.push(r);
    explanation.push(text);
  };

  // Live-capital base: live readiness sizes off a small slice of the full book.
  const liveCapitalBase = Math.max(
    0,
    portfolio.totalSwingCapital * (config.liveCapitalCapPct / 100),
  );

  // ── B. Data trust ────────────────────────────────────────────────────────
  const dataTrust = evaluateSwingCashDataTrust(
    {
      symbol: candidate.symbol,
      dataSource: candidate.dataSource,
      ltp: candidate.ltp,
      ohlc: candidate.ohlc,
      dailyCandleAsOfMs: candidate.dailyCandleAsOfMs,
      ltpAsOfMs: candidate.ltpAsOfMs,
      fallbackUsed: candidate.fallbackUsed,
      fallbackReason: candidate.fallbackReason,
      benchmarkAvailable: candidate.benchmarkAvailable,
      // Fail-closed: if availability isn't explicitly stated, infer it from the
      // presence of a real sector value (null sector → unavailable → review).
      sectorAvailable: candidate.sectorAvailable ?? (candidate.sector != null),
      nowMs: candidate.nowMs,
    },
    config.dataTrust,
  );
  if (!dataTrust.trustedForTrade) {
    if (dataTrust.classification === "UNAVAILABLE") {
      pushReason("DATA_UNAVAILABLE", "Market data unavailable — not tradeable.");
    } else if (dataTrust.classification === "STALE") {
      if (config.blockIfDataStale) pushReason("DATA_STALE", "Market data is stale — blocked.");
    } else {
      pushReason(
        "DATA_NOT_TRADE_GRADE",
        `Data is ${dataTrust.classification} (not trade-grade).`,
      );
    }
  }
  if (dataTrust.reviewRequired) reviewRequired = true;

  // ── C. Entry validity ────────────────────────────────────────────────────
  const entry = evaluateSwingCashEntry(
    {
      entry: candidate.entry,
      stop: candidate.stop,
      target1: candidate.target1,
      ltp: candidate.ltp,
      atr: candidate.atr,
      entryZoneLow: candidate.entryZoneLow,
      entryZoneHigh: candidate.entryZoneHigh,
      signalAgeDays: candidate.signalAgeDays,
      validityExpiryMs: candidate.validityExpiryMs,
      nowMs: candidate.nowMs,
      triggered: candidate.triggered,
    },
    config.entry,
  );
  switch (entry.classification) {
    case "ENTRY_ALREADY_CHASED":
      pushReason("ENTRY_CHASED", "Entry already chased.");
      break;
    case "ENTRY_STALE":
      pushReason("ENTRY_STALE", "Entry signal stale.");
      break;
    case "ENTRY_TOO_CLOSE_TO_TARGET":
      pushReason("ENTRY_TOO_CLOSE_TO_TARGET", "LTP too close to target.");
      break;
    case "ENTRY_TOO_CLOSE_TO_STOP":
      pushReason("ENTRY_TOO_CLOSE_TO_STOP", "LTP too close to stop.");
      break;
    case "ENTRY_RR_TOO_LOW":
      pushReason("ENTRY_RR_TOO_LOW", "Remaining R:R below minimum.");
      break;
    case "ENTRY_INVALID_DATA":
      pushReason("ENTRY_INVALID_DATA", "Entry plan numerically invalid.");
      break;
    case "ENTRY_REVIEW_REQUIRED":
      reviewRequired = true;
      break;
    default:
      break;
  }
  const notReadyNow = entry.classification === "ENTRY_WAITING_FOR_TRIGGER";
  if (notReadyNow) {
    warnings.push("Entry valid but waiting for trigger — watch queue, not stageable now.");
  }

  // ── F. Liquidity ─────────────────────────────────────────────────────────
  const liquidity = evaluateSwingCashLiquidity(
    {
      avgTradedValue: candidate.avgTradedValue ?? null,
      volume: candidate.volume ?? null,
      spreadPct: candidate.spreadPct ?? null,
      deliveryPct: candidate.deliveryPct ?? null,
      asmGsmStatus: candidate.asmGsmStatus ?? null,
      circuitRisk: candidate.circuitRisk ?? null,
    },
    config.liquidity,
  );
  if (!liquidity.tradeable) {
    switch (liquidity.classification) {
      case "CIRCUIT_RISK":
        pushReason("CIRCUIT_RISK", "Circuit / price-band risk.");
        break;
      case "ASM_GSM_RISK":
        pushReason("ASM_GSM_RISK", "Under ASM/GSM surveillance.");
        break;
      case "LOW_TRADED_VALUE":
      case "LOW_VOLUME":
      case "HIGH_SPREAD":
        if (config.blockOnLowLiquidity) pushReason("LOW_LIQUIDITY", "Liquidity below threshold.");
        break;
      case "ASM_GSM_UNAVAILABLE_REVIEW_REQUIRED":
      case "LIQUIDITY_DATA_UNAVAILABLE":
        reviewRequired = true;
        break;
      default:
        break;
    }
  }
  if (liquidity.reviewRequired) reviewRequired = true;
  warnings.push(...liquidity.warnings);

  // ── H. Event risk ────────────────────────────────────────────────────────
  const eventRisk = evaluateSwingCashEventRisk(
    {
      daysToResult: candidate.daysToResult ?? null,
      isResultDay: candidate.isResultDay,
      corporateActionRisk: candidate.corporateActionRisk ?? null,
      eventDataAvailable: candidate.eventDataAvailable ?? false,
      resultScheduleKnown: candidate.resultScheduleKnown ?? false,
      newsRiskAvailable: candidate.newsRiskAvailable ?? false,
    },
    config.eventRisk,
  );
  if (config.blockOnEventRisk) {
    switch (eventRisk.classification) {
      case "RESULT_DAY":
        pushReason("EVENT_RISK_RESULT_DAY", "Result/earnings day.");
        break;
      case "RESULT_WITHIN_3_DAYS":
        pushReason("EVENT_RISK_RESULT_SOON", "Result within event window.");
        break;
      case "CORPORATE_ACTION_RISK":
        pushReason("EVENT_RISK_CORPORATE_ACTION", "Corporate-action risk.");
        break;
      default:
        break;
    }
  }
  if (eventRisk.reviewRequired) reviewRequired = true;

  // ── E. Sizing (off the live-capital base) ────────────────────────────────
  const sizing = computeSwingCashSizing(
    {
      entry: candidate.entry,
      stop: candidate.stop,
      totalSwingCapital: liveCapitalBase,
      availableCash: portfolio.availableCash,
    },
    config.sizing,
  );
  if (!sizing.allowed) {
    switch (sizing.reason) {
      case "SIZING_INPUT_INVALID":
        pushReason("SIZING_INPUT_INVALID", sizing.detail);
        break;
      case "RISK_PER_SHARE_INVALID":
        pushReason("RISK_PER_SHARE_INVALID", sizing.detail);
        break;
      case "INSUFFICIENT_CASH":
        pushReason("INSUFFICIENT_CASH", sizing.detail);
        break;
      case "POSITION_TOO_SMALL":
        pushReason("POSITION_TOO_SMALL", sizing.detail);
        break;
      case "QTY_LT_1":
        pushReason("INSUFFICIENT_CASH", sizing.detail);
        break;
      default:
        break;
    }
  }
  // Defensive: per-trade risk must never exceed the absolute cap.
  if (sizing.allowed && sizing.maxLoss > config.sizing.maxRiskPerTrade + 0.01) {
    pushReason(
      "MAX_RISK_PER_TRADE_EXCEEDED",
      `Max loss ₹${Math.round(sizing.maxLoss)} > cap ₹${config.sizing.maxRiskPerTrade}.`,
    );
  }

  // ── G. Exposure (uses the proposed position value) ───────────────────────
  const sector = candidate.sector;
  const exposure = evaluateSwingCashExposure(
    {
      symbol: candidate.symbol,
      sector,
      proposedPositionValue: sizing.capitalRequired,
      totalSwingCapital: liveCapitalBase,
      currentSectorExposureValue: sector
        ? portfolio.sectorExposureValueBySector[sector] ?? 0
        : 0,
      currentSingleStockExposureValue:
        portfolio.singleStockExposureValueBySymbol[candidate.symbol] ?? 0,
      openPositionSymbols: portfolio.openPositionSymbols,
      sectorOpenCount: sector ? portfolio.sectorOpenCountBySector[sector] ?? 0 : 0,
      lastEntryDateForSymbolIst:
        portfolio.lastEntryDateBySymbolIst?.[candidate.symbol] ?? null,
      todayIst: portfolio.todayIst,
    },
    config.exposure,
  );
  if (exposure.inputInvalid) {
    pushReason(
      "EXPOSURE_INPUT_INVALID",
      "Exposure inputs invalid (non-finite/negative) — caps uncomputable; blocked.",
    );
  }
  if (exposure.metrics.duplicate && config.exposure.blockDuplicate) {
    pushReason("DUPLICATE_POSITION", "Symbol already open.");
  }
  if (exposure.metrics.consecutiveDay && config.exposure.blockConsecutiveDaySameStock) {
    pushReason("CONSECUTIVE_DAY_STACKING", "Same stock entered on consecutive day.");
  }
  if (exposure.metrics.singleStockExposureAfterPct > config.exposure.maxSingleStockExposurePct) {
    pushReason("SINGLE_STOCK_EXPOSURE_EXCEEDED", "Single-stock exposure cap exceeded.");
  }
  if (
    sector &&
    exposure.metrics.sectorExposureAfterPct > config.exposure.maxSectorExposurePct
  ) {
    pushReason("SECTOR_EXPOSURE_EXCEEDED", "Sector exposure cap exceeded.");
  }
  warnings.push(...exposure.warnings);

  // ── N. Cost / net-R ──────────────────────────────────────────────────────
  const cost = computeSwingCashCost(
    {
      entry: candidate.entry,
      target: candidate.target1,
      stop: candidate.stop,
      qty: sizing.qty,
      minRR: config.minRR,
    },
    config.cost,
  );
  if (config.blockOnWeakRR && sizing.qty > 0 && !cost.passesMinRR) {
    pushReason(
      "RR_AFTER_COST_TOO_LOW",
      `After-cost R ${cost.expectedRAfterCost.toFixed(2)} < min ${config.minRR}.`,
    );
  }

  // ── Portfolio-level caps ─────────────────────────────────────────────────
  // Fail-closed: a non-finite/negative counter or cap would make every `>=`
  // comparison false and silently bypass the open/daily/weekly limits. Never
  // let an uncomputable portfolio state pass as if the caps were satisfied.
  const isFiniteNum = (n: number) => Number.isFinite(n);
  const portfolioStateInvalid =
    !isFiniteNum(portfolio.openPositionsCount) ||
    !isFiniteNum(portfolio.dailyEntriesUsed) ||
    !isFiniteNum(portfolio.weeklyEntriesUsed) ||
    portfolio.openPositionsCount < 0 ||
    portfolio.dailyEntriesUsed < 0 ||
    portfolio.weeklyEntriesUsed < 0 ||
    !isFiniteNum(portfolio.totalSwingCapital) ||
    !isFiniteNum(portfolio.availableCash) ||
    portfolio.totalSwingCapital < 0 ||
    portfolio.availableCash < 0 ||
    !isFiniteNum(config.maxOpenPositions) ||
    !isFiniteNum(config.maxDailyEntries) ||
    !isFiniteNum(config.maxWeeklyEntries) ||
    !isFiniteNum(config.liveCapitalCapPct);
  if (portfolioStateInvalid) {
    pushReason(
      "PORTFOLIO_STATE_INVALID",
      "Portfolio state / caps invalid (non-finite or negative) — blocked.",
    );
  }
  if (portfolio.openPositionsCount >= config.maxOpenPositions) {
    pushReason("MAX_OPEN_POSITIONS", `Open positions ${portfolio.openPositionsCount} ≥ ${config.maxOpenPositions}.`);
  }
  if (portfolio.dailyEntriesUsed >= config.maxDailyEntries) {
    pushReason("MAX_DAILY_ENTRIES", `Daily entries ${portfolio.dailyEntriesUsed} ≥ ${config.maxDailyEntries}.`);
  }
  if (portfolio.weeklyEntriesUsed >= config.maxWeeklyEntries) {
    pushReason("MAX_WEEKLY_ENTRIES", `Weekly entries ${portfolio.weeklyEntriesUsed} ≥ ${config.maxWeeklyEntries}.`);
  }

  // ── Aggregate ────────────────────────────────────────────────────────────
  const cleanPass =
    reasons.length === 0 &&
    dataTrust.trustedForTrade &&
    entry.validForStaging &&
    liquidity.tradeable &&
    eventRisk.clear &&
    sizing.allowed &&
    exposure.allowed &&
    (!config.blockOnWeakRR || cost.passesMinRR);

  // Even a clean candidate needs human approval before any live action when
  // manual approval is required and we're in a live-capable mode.
  if (cleanPass && config.requireManualApproval && config.mode !== "paper_only") {
    reviewRequired = true;
    explanation.push("Clean candidate, but manual approval is required before any live action.");
  }

  const allowed = cleanPass && !notReadyNow && !reviewRequired;

  let severity: SwingCashRiskDecision["severity"] = "info";
  if (reasons.length > 0) severity = "block";
  else if (warnings.length > 0 || reviewRequired || notReadyNow) severity = "warn";

  if (allowed) {
    explanation.push(
      `Eligible: ${sizing.qty} sh @ ₹${candidate.entry.toFixed(2)} (₹${Math.round(sizing.capitalRequired)}, risk ₹${Math.round(sizing.maxLoss)}). Mode "${config.mode}" — no live order placed.`,
    );
  }

  const stopDistancePct =
    candidate.entry > 0 ? ((candidate.entry - candidate.stop) / candidate.entry) * 100 : null;

  return {
    allowed,
    mode: config.mode,
    severity,
    reviewRequired,
    reasons,
    warnings,
    explanation,
    metrics: {
      qty: sizing.qty,
      capitalRequired: sizing.capitalRequired,
      maxLoss: sizing.maxLoss,
      maxLossWithGap: sizing.maxLossWithGap,
      riskPct: sizing.riskPct,
      positionValuePct: sizing.positionValuePct,
      rr: candidate.rr ?? entry.metrics.rrNow,
      rrAfterCost: cost.expectedRAfterCost,
      netTargetProfit: cost.netTargetProfit,
      sectorExposureAfterPct: exposure.metrics.sectorExposureAfterPct,
      singleStockExposureAfterPct: exposure.metrics.singleStockExposureAfterPct,
      stopDistancePct,
      dataClassification: dataTrust.classification,
      entryClassification: entry.classification,
      liquidityClassification: liquidity.classification,
      eventClassification: eventRisk.classification,
    },
    gates: { dataTrust, entry, liquidity, eventRisk, exposure, sizing, cost },
  };
}
