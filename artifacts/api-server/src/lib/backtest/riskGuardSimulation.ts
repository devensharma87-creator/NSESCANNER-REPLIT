/**
 * F&O Risk Guard Shadow Simulation — pure analytics over historical replay trades.
 *
 * Runs the 7 required scenarios (Parts C–D of the guard pack spec) against
 * a list of DiagTrade and reports exact blocked-trade lists with P&L impact.
 *
 * ABSOLUTE RULES:
 *   - Pure function. No DB, no network, no side effects.
 *   - Every output is tagged simulationType: "SIMULATION_ONLY".
 *   - No fabricated values. Missing data → null.
 *   - No division by zero.
 */

import type { DiagTrade } from "./diagnostics";
import {
  evaluateFnoPaperRiskGuards,
  computeDteCalendarDays,
  type FnoPaperRiskGuardConfig,
  type FnoPaperRiskGuardReason,
  type RecentStoppedTrade,
} from "../fnoPaperRiskGuards";

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface SimulatedBlockedTrade {
  tradeId: string;
  underlying: string;
  entryAt: string | null;
  direction: string;
  optionType: string | null;
  strike: number | null;
  entryPremium: number | null;
  expiry: string | null;
  dteCalendarDays: number | null;
  exitReason: string | null;
  grossPnl: number | null;
  netPnl: number | null;
  guardReasons: FnoPaperRiskGuardReason[];
  explanation: string[];
  pricingMode: string | null;
}

export interface GuardScenarioResult {
  simulationType: "SIMULATION_ONLY";
  scenarioId: string;
  label: string;
  description: string;
  configSummary: {
    mode: string;
    disableSensex: boolean;
    lowPremiumGateEnabled: boolean;
    minPremiumNifty: number;
    minPremiumBanknifty: number;
    minPremiumSensex: number;
    thetaEnabled: boolean;
    maxDteDays: number;
    cooldownEnabled: boolean;
    cooldownMinutes: number;
  };
  tradesEvaluated: number;
  pricedEvaluated: number;
  unavailableEvaluated: number;
  tradesBlocked: number;
  pricedBlocked: number;
  unavailableBlocked: number;
  winnersBlocked: number;
  losersBlocked: number;
  grossPnlAvoided: number;
  netPnlAvoided: number;
  netPnlLostFromBlockedWinners: number;
  /** Positive = net improvement (saved losses > lost winners). */
  netImprovement: number;
  byUnderlying: Record<string, { blocked: number; netPnlAvoided: number; winnersBlocked: number }>;
  byExitReason: Record<string, { blocked: number; netPnlAvoided: number }>;
  byPremiumBucket: Record<string, { blocked: number; netPnlAvoided: number }>;
  byDteBucket: Record<string, { blocked: number; netPnlAvoided: number }>;
  blockedTrades: SimulatedBlockedTrade[];
}

export interface RiskGuardSimulationOut {
  simulationType: "SIMULATION_ONLY";
  generatedAt: string;
  totalTrades: number;
  pricedTrades: number;
  unavailableTrades: number;
  activeConfig: FnoPaperRiskGuardConfig;
  scenarios: GuardScenarioResult[];
}

// ---------------------------------------------------------------------------
// Scenario definitions
// ---------------------------------------------------------------------------

type ScenarioSpec = {
  id: string;
  label: string;
  description: string;
  config: FnoPaperRiskGuardConfig;
  underlyingFilter?: string;
};

const BASE_MIN_PREM = { NIFTY: 250, BANKNIFTY: 500, SENSEX: 250 };
const ZERO_MIN_PREM = { NIFTY: 0, BANKNIFTY: 0, SENSEX: 0 };

const SCENARIOS: ScenarioSpec[] = [
  // ─── Scenario 1: Low premium only ────────────────────────────────────────
  {
    id: "LOW_PREMIUM_ONLY",
    label: "G2 — Low Premium Gate Only",
    description:
      "Blocks trades below min entry premium (NIFTY \u20b9250, BANKNIFTY \u20b9500, SENSEX \u20b9250). No DTE guard, no cooldown, SENSEX not disabled.",
    config: {
      mode: "paper_block",
      disableSensexPaperAutoOpen: false,
      lowPremiumGateEnabled: true,
      minEntryPremium: BASE_MIN_PREM,
      thetaRisk: { enabled: false, maxDteCalendarDays: 5, onlyWhenPremiumBelowThreshold: true },
      sameStrikeStopCooldown: { enabled: false, minutes: 90 },
      badTimeWindowShadowOnly: { enabled: false, windowsIST: [] },
    },
  },
  // ─── Scenario 2: Theta risk only ─────────────────────────────────────────
  {
    id: "THETA_RISK_ONLY",
    label: "G1 — Near-Expiry Theta Risk Only",
    description:
      "Blocks DTE \u2264 5 + premium below threshold. No blanket premium gate, no cooldown, SENSEX not disabled.",
    config: {
      mode: "paper_block",
      disableSensexPaperAutoOpen: false,
      lowPremiumGateEnabled: false,
      minEntryPremium: BASE_MIN_PREM,
      thetaRisk: { enabled: true, maxDteCalendarDays: 5, onlyWhenPremiumBelowThreshold: true },
      sameStrikeStopCooldown: { enabled: false, minutes: 90 },
      badTimeWindowShadowOnly: { enabled: false, windowsIST: [] },
    },
  },
  // ─── Scenario 3: Same-strike stop cooldown only ───────────────────────────
  {
    id: "SAME_STRIKE_STOP_COOLDOWN_ONLY",
    label: "G3 — Same-Strike STOP Cooldown Only",
    description:
      "Blocks same underlying+direction+strike re-entry within 90 min of a STOP exit. No premium gate, no DTE guard.",
    config: {
      mode: "paper_block",
      disableSensexPaperAutoOpen: false,
      lowPremiumGateEnabled: false,
      minEntryPremium: ZERO_MIN_PREM,
      thetaRisk: { enabled: false, maxDteCalendarDays: 5, onlyWhenPremiumBelowThreshold: true },
      sameStrikeStopCooldown: { enabled: true, minutes: 90 },
      badTimeWindowShadowOnly: { enabled: false, windowsIST: [] },
    },
  },
  // ─── Scenario 4: SENSEX disable only ─────────────────────────────────────
  {
    id: "SENSEX_DISABLE_ONLY",
    label: "G4 — SENSEX Paper Disable Only",
    description:
      "Blocks SENSEX paper auto-open only. NIFTY and BANKNIFTY unchanged. Signals still visible in UI.",
    config: {
      mode: "paper_block",
      disableSensexPaperAutoOpen: true,
      lowPremiumGateEnabled: false,
      minEntryPremium: ZERO_MIN_PREM,
      thetaRisk: { enabled: false, maxDteCalendarDays: 5, onlyWhenPremiumBelowThreshold: true },
      sameStrikeStopCooldown: { enabled: false, minutes: 90 },
      badTimeWindowShadowOnly: { enabled: false, windowsIST: [] },
    },
  },
  // ─── Scenario 5: Combined G1/G2/G3 ───────────────────────────────────────
  {
    id: "COMBINED_G1_G2_G3",
    label: "Combined G1 + G2 + G3 (SENSEX enabled)",
    description:
      "Low premium + near-expiry theta + re-entry cooldown. SENSEX NOT disabled. Baseline acceptance test.",
    config: {
      mode: "paper_block",
      disableSensexPaperAutoOpen: false,
      lowPremiumGateEnabled: true,
      minEntryPremium: BASE_MIN_PREM,
      thetaRisk: { enabled: true, maxDteCalendarDays: 5, onlyWhenPremiumBelowThreshold: true },
      sameStrikeStopCooldown: { enabled: true, minutes: 90 },
      badTimeWindowShadowOnly: { enabled: false, windowsIST: [] },
    },
  },
  // ─── Scenario 6: Combined G1/G2/G3/G4 ────────────────────────────────────
  {
    id: "COMBINED_G1_G2_G3_G4",
    label: "Combined G1 + G2 + G3 + G4 (SENSEX disabled)",
    description:
      "All four guards active. SENSEX paper auto-open disabled. Full protection scenario.",
    config: {
      mode: "paper_block",
      disableSensexPaperAutoOpen: true,
      lowPremiumGateEnabled: true,
      minEntryPremium: BASE_MIN_PREM,
      thetaRisk: { enabled: true, maxDteCalendarDays: 5, onlyWhenPremiumBelowThreshold: true },
      sameStrikeStopCooldown: { enabled: true, minutes: 90 },
      badTimeWindowShadowOnly: { enabled: false, windowsIST: [] },
    },
  },
  // ─── Scenario 7: BANKNIFTY protection check ──────────────────────────────
  {
    id: "BANKNIFTY_PROTECTION_CHECK",
    label: "G1 + G2 + G3 — BANKNIFTY Only",
    description:
      "Applies G1/G2/G3 exclusively to BANKNIFTY. Verifies profitable BANKNIFTY edge is protected: blocked winners listed explicitly.",
    config: {
      mode: "paper_block",
      disableSensexPaperAutoOpen: false,
      lowPremiumGateEnabled: true,
      minEntryPremium: BASE_MIN_PREM,
      thetaRisk: { enabled: true, maxDteCalendarDays: 5, onlyWhenPremiumBelowThreshold: true },
      sameStrikeStopCooldown: { enabled: true, minutes: 90 },
      badTimeWindowShadowOnly: { enabled: false, windowsIST: [] },
    },
    underlyingFilter: "BANKNIFTY",
  },
];

// ---------------------------------------------------------------------------
// Premium bucket helper
// ---------------------------------------------------------------------------

function premiumBucket(prem: number | null): string {
  if (prem === null) return "UNAVAILABLE";
  if (prem < 100) return "<100";
  if (prem < 200) return "100-199";
  if (prem < 400) return "200-399";
  if (prem < 700) return "400-699";
  if (prem < 1000) return "700-999";
  return ">=1000";
}

function dteBucket(dte: number | null): string {
  if (dte === null) return "UNKNOWN";
  if (dte <= 0) return "0";
  if (dte <= 2) return "1-2";
  if (dte <= 5) return "3-5";
  if (dte <= 14) return "6-14";
  if (dte <= 30) return "15-30";
  return ">30";
}

// ---------------------------------------------------------------------------
// Build a RecentStoppedTrade from a DiagTrade (for cooldown simulation)
// ---------------------------------------------------------------------------

function diagToStopped(t: DiagTrade): RecentStoppedTrade | null {
  if (!t.exitAt || t.strike === null) return null;
  return {
    underlying: t.indexSymbol,
    direction: t.direction,
    optionType: t.optionType ?? "CALL",
    strike: t.strike,
    exitTime: t.exitAt,
    exitReason: t.exitReason ?? "STOP",
  };
}

// ---------------------------------------------------------------------------
// Run a single scenario against all trades
// ---------------------------------------------------------------------------

function runScenario(spec: ScenarioSpec, trades: DiagTrade[]): GuardScenarioResult {
  const { id, label, description, config, underlyingFilter } = spec;

  // Sort by entry time (ascending) for accurate cooldown simulation.
  const sorted = [...trades].sort((a, b) => {
    if (!a.entryAt) return 1;
    if (!b.entryAt) return -1;
    return a.entryAt < b.entryAt ? -1 : a.entryAt > b.entryAt ? 1 : 0;
  });

  // Running list of stopped trades encountered so far (for cooldown tracking).
  const stoppedHistory: RecentStoppedTrade[] = [];

  const blockedTrades: SimulatedBlockedTrade[] = [];

  let tradesBlocked = 0;
  let pricedBlocked = 0;
  let unavailableBlocked = 0;
  let winnersBlocked = 0;
  let losersBlocked = 0;
  let grossPnlAvoided = 0;
  let netPnlAvoided = 0;
  let netPnlLostFromBlockedWinners = 0;

  const byUnderlying: Record<string, { blocked: number; netPnlAvoided: number; winnersBlocked: number }> = {};
  const byExitReason: Record<string, { blocked: number; netPnlAvoided: number }> = {};
  const byPremiumBucket: Record<string, { blocked: number; netPnlAvoided: number }> = {};
  const byDteBucket: Record<string, { blocked: number; netPnlAvoided: number }> = {};

  const cooldownMs = config.sameStrikeStopCooldown.minutes * 60_000;

  for (const t of sorted) {
    // If scenario has a filter, skip non-matching underlyings but still track stops.
    const evaluate = !underlyingFilter || t.indexSymbol === underlyingFilter;

    const entryMs = t.entryAt ? new Date(t.entryAt).getTime() : NaN;

    // Compute DTE for this trade.
    const dte =
      t.entryAt && t.expiryDate
        ? computeDteCalendarDays(t.entryAt, t.expiryDate)
        : null;

    if (evaluate) {
      const validUnderlying =
        t.indexSymbol === "NIFTY" ||
        t.indexSymbol === "BANKNIFTY" ||
        t.indexSymbol === "SENSEX";

      if (validUnderlying) {
        const guardInput = {
          underlying: t.indexSymbol as "NIFTY" | "BANKNIFTY" | "SENSEX",
          direction: (t.direction === "BULLISH" || t.direction === "BEARISH"
            ? t.direction
            : "BULLISH") as "BULLISH" | "BEARISH",
          optionType: (t.optionType === "CALL" || t.optionType === "PUT"
            ? t.optionType
            : "CALL") as "CALL" | "PUT",
          strike: t.strike ?? 0,
          entryPremium: t.optionEntry,
          entryTime: t.entryAt ?? new Date(0).toISOString(),
          expiry: t.expiryDate,
          pricingMode: t.pricingMode,
          setupKey: t.setupKey,
          setupName: t.setupName,
          candidateTier: t.tier,
          premiumTrusted: null,
          expectedGrossEdge: null,
          estimatedCosts: null,
        };

        // Build recentStops for cooldown: only stops within cooldown window before this entry.
        const recentStops = !Number.isNaN(entryMs)
          ? stoppedHistory.filter((s) => {
              try {
                const sMs = new Date(s.exitTime).getTime();
                return sMs > entryMs - cooldownMs && sMs <= entryMs;
              } catch {
                return false;
              }
            })
          : [];

        const decision = evaluateFnoPaperRiskGuards(guardInput, recentStops, config);

        if (!decision.allowed) {
          // Trade would be blocked.
          const priced = t.pricingMode === "REAL_CAPTURED_PREMIUM";
          const netPnl = t.netPnl;
          const isWinner = netPnl !== null && netPnl > 0;
          const isLoser = netPnl !== null && netPnl <= 0;
          const grossPnl = t.grossPnl;
          const ul = t.indexSymbol;
          const er = t.exitReason ?? "UNKNOWN";
          const pb = premiumBucket(t.optionEntry);
          const db = dteBucket(dte);

          tradesBlocked++;
          if (priced) pricedBlocked++;
          else unavailableBlocked++;
          if (isWinner) {
            winnersBlocked++;
            netPnlLostFromBlockedWinners += netPnl ?? 0;
          }
          if (isLoser) losersBlocked++;
          grossPnlAvoided += grossPnl ?? 0;
          netPnlAvoided += netPnl ?? 0;

          byUnderlying[ul] ??= { blocked: 0, netPnlAvoided: 0, winnersBlocked: 0 };
          byUnderlying[ul]!.blocked++;
          byUnderlying[ul]!.netPnlAvoided += netPnl ?? 0;
          if (isWinner) byUnderlying[ul]!.winnersBlocked++;

          byExitReason[er] ??= { blocked: 0, netPnlAvoided: 0 };
          byExitReason[er]!.blocked++;
          byExitReason[er]!.netPnlAvoided += netPnl ?? 0;

          byPremiumBucket[pb] ??= { blocked: 0, netPnlAvoided: 0 };
          byPremiumBucket[pb]!.blocked++;
          byPremiumBucket[pb]!.netPnlAvoided += netPnl ?? 0;

          byDteBucket[db] ??= { blocked: 0, netPnlAvoided: 0 };
          byDteBucket[db]!.blocked++;
          byDteBucket[db]!.netPnlAvoided += netPnl ?? 0;

          blockedTrades.push({
            tradeId: t.id,
            underlying: t.indexSymbol,
            entryAt: t.entryAt,
            direction: t.direction,
            optionType: t.optionType,
            strike: t.strike,
            entryPremium: t.optionEntry,
            expiry: t.expiryDate,
            dteCalendarDays: dte,
            exitReason: t.exitReason,
            grossPnl: t.grossPnl,
            netPnl: t.netPnl,
            guardReasons: decision.reasons,
            explanation: decision.explanation,
            pricingMode: t.pricingMode,
          });
        }
      }
    }

    // Track stopped trades for cooldown (regardless of filter, across all underlyings).
    if ((t.exitReason === "STOP" || t.exitReason === "STOPPED") && t.exitAt) {
      const stopped = diagToStopped(t);
      if (stopped) stoppedHistory.push(stopped);
    }
  }

  // netPnlAvoided = Σ netPnl of ALL blocked trades (winners + losers combined).
  // If blocked trades collectively lost money (netPnlAvoided < 0), not taking them
  // improves P&L by exactly -(netPnlAvoided).  Winners are already included in that
  // sum — subtracting netPnlLostFromBlockedWinners again would double-count them.
  // netImprovement > 0 means the guards improve total net P&L.
  const netImprovement = -(netPnlAvoided);

  return {
    simulationType: "SIMULATION_ONLY",
    scenarioId: id,
    label,
    description,
    configSummary: {
      mode: config.mode,
      disableSensex: config.disableSensexPaperAutoOpen,
      lowPremiumGateEnabled: config.lowPremiumGateEnabled,
      minPremiumNifty: config.minEntryPremium.NIFTY,
      minPremiumBanknifty: config.minEntryPremium.BANKNIFTY,
      minPremiumSensex: config.minEntryPremium.SENSEX,
      thetaEnabled: config.thetaRisk.enabled,
      maxDteDays: config.thetaRisk.maxDteCalendarDays,
      cooldownEnabled: config.sameStrikeStopCooldown.enabled,
      cooldownMinutes: config.sameStrikeStopCooldown.minutes,
    },
    tradesEvaluated: underlyingFilter
      ? trades.filter((t) => t.indexSymbol === underlyingFilter).length
      : trades.length,
    pricedEvaluated: trades.filter(
      (t) =>
        t.pricingMode === "REAL_CAPTURED_PREMIUM" &&
        (!underlyingFilter || t.indexSymbol === underlyingFilter),
    ).length,
    unavailableEvaluated: trades.filter(
      (t) =>
        t.pricingMode !== "REAL_CAPTURED_PREMIUM" &&
        (!underlyingFilter || t.indexSymbol === underlyingFilter),
    ).length,
    tradesBlocked,
    pricedBlocked,
    unavailableBlocked,
    winnersBlocked,
    losersBlocked,
    grossPnlAvoided,
    netPnlAvoided,
    netPnlLostFromBlockedWinners,
    netImprovement,
    byUnderlying,
    byExitReason,
    byPremiumBucket,
    byDteBucket,
    blockedTrades,
  };
}

// ---------------------------------------------------------------------------
// Main simulation function
// ---------------------------------------------------------------------------

/**
 * Run all 7 risk-guard scenarios against the provided DiagTrade list.
 *
 * @param trades DiagTrade[] from the replay run (all trades, priced + unavailable).
 * @param activeConfig Current live guard config (for display; simulation uses hardcoded scenario configs).
 */
export function computeRiskGuardSimulation(
  trades: DiagTrade[],
  activeConfig: FnoPaperRiskGuardConfig,
): RiskGuardSimulationOut {
  const priced = trades.filter((t) => t.pricingMode === "REAL_CAPTURED_PREMIUM").length;
  const unavail = trades.length - priced;

  const scenarios = SCENARIOS.map((spec) => runScenario(spec, trades));

  return {
    simulationType: "SIMULATION_ONLY",
    generatedAt: new Date().toISOString(),
    totalTrades: trades.length,
    pricedTrades: priced,
    unavailableTrades: unavail,
    activeConfig,
    scenarios,
  };
}
