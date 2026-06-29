/**
 * React Query hook for the F&O Risk Guard Simulation endpoint.
 *
 * GET /api/backtest/fno/runs/:runId/risk-guard-simulation
 *
 * Returns simulation results for all 7 scenarios (Parts C–D of the guard pack spec).
 * All outputs are tagged simulationType: "SIMULATION_ONLY".
 */
import { useQuery } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Response types (mirrors server lib/backtest/riskGuardSimulation.ts)
// ---------------------------------------------------------------------------

export type FnoPaperRiskGuardReason =
  | "SENSEX_DISABLED_BY_REPLAY_DIAGNOSTICS"
  | "LOW_ENTRY_PREMIUM"
  | "NEAR_EXPIRY_THETA_RISK"
  | "SAME_STRIKE_DIRECTION_STOP_COOLDOWN"
  | "BAD_TIME_WINDOW_SHADOW_ONLY"
  | "HIGH_COST_TO_EDGE_RATIO_SHADOW_ONLY";

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
  activeConfig: {
    mode: string;
    disableSensexPaperAutoOpen: boolean;
    lowPremiumGateEnabled: boolean;
    minEntryPremium: { NIFTY: number; BANKNIFTY: number; SENSEX: number };
    thetaRisk: { enabled: boolean; maxDteCalendarDays: number; onlyWhenPremiumBelowThreshold: boolean };
    sameStrikeStopCooldown: { enabled: boolean; minutes: number };
    badTimeWindowShadowOnly: { enabled: boolean };
  };
  scenarios: GuardScenarioResult[];
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

async function fetchSimulation(runId: string): Promise<RiskGuardSimulationOut> {
  const res = await fetch(
    `/api/backtest/fno/runs/${encodeURIComponent(runId)}/risk-guard-simulation`,
    { credentials: "include" },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<RiskGuardSimulationOut>;
}

export function useRiskGuardSimulation(runId: string | null) {
  return useQuery({
    queryKey: ["backtest", "risk-guard-simulation", runId],
    queryFn: () => fetchSimulation(runId!),
    enabled: Boolean(runId),
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
}
