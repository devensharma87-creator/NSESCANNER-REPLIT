/**
 * Custom React Query hook for the F&O Replay Diagnostics endpoint.
 *
 * GET /api/backtest/fno/runs/:runId/diagnostics
 *
 * Returns all diagnostic sections (Parts A–I) without going through codegen.
 * The response shape mirrors FnoReplayDiagnosticsOut from the server lib.
 */
import { useQuery } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Response types (mirrors server lib/backtest/diagnostics.ts)
// ---------------------------------------------------------------------------

export interface DiagStats {
  totalTrades: number;
  pricedTrades: number;
  unavailableTrades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  grossPnl: number;
  totalCosts: number;
  netPnl: number;
  avgWin: number | null;
  avgLoss: number | null;
  profitFactor: number | null;
  expectancyPerTrade: number | null;
  maxDrawdown: number;
  bestTrade: number | null;
  worstTrade: number | null;
  avgEntryPremium: number | null;
  avgSpreadCost: number | null;
}

export interface DiagGroup extends DiagStats {
  key: string;
  label: string;
}

export interface DiagSetupGroup extends DiagGroup {
  underlying: string;
  direction: string | null;
  optionType: string | null;
}

export interface DiagDayCluster extends DiagStats {
  date: string;
  underlying: string;
}

export interface DiagReentryCluster {
  underlying: string;
  date: string;
  strike: number;
  direction: string;
  optionType: string | null;
  numEntries: number;
  totalGrossPnl: number;
  totalCosts: number;
  totalNetPnl: number;
  exitReasons: string[];
  timeGapMinutes: number | null;
  simulationNoReentry: SimulationResult;
}

export interface DiagUnavailableReason {
  reason: string;
  count: number;
  underlyings: string[];
  exampleDates: string[];
}

export interface SimulationResult {
  label: string;
  simulationType: "SIMULATION_ONLY";
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  grossPnl: number;
  totalCosts: number;
  netPnl: number;
  profitFactor: number | null;
  expectancyPerTrade: number | null;
}

export interface FnoReplayDiagnosticsOut {
  runId: string;
  backtestMode: string | null;
  fromDate: string | null;
  toDate: string | null;
  instrument: string;
  generatedAt: string;

  byUnderlying: DiagGroup[];
  bySetup: DiagSetupGroup[];
  byDirection: DiagGroup[];
  byOptionType: DiagGroup[];
  byExitReason: DiagGroup[];
  byTimeOfDay: DiagGroup[];
  byDayOfWeek: DiagGroup[];
  byExpiryDistance: DiagGroup[];
  byPremiumBucket: DiagGroup[];
  byCostBucket: DiagGroup[];
  bySnapshotAvailability: DiagGroup[];

  worstLossClusters: DiagDayCluster[];
  bestProfitClusters: DiagDayCluster[];
  reentryClusters: DiagReentryCluster[];

  sensexAudit: {
    all: DiagStats;
    excludingJun11to17: SimulationResult;
    byDirection: DiagGroup[];
    byExitReason: DiagGroup[];
    byTimeOfDay: DiagGroup[];
    byPremiumBucket: DiagGroup[];
    byExpiryDistance: DiagGroup[];
  };

  bankniftyAudit: {
    all: DiagStats;
    excludingBestTrade: SimulationResult;
    excludingWorstTrade: SimulationResult;
    excludingBothBestAndWorst: SimulationResult;
    robustnessVerdict: string;
    bySetup: DiagGroup[];
    byDirection: DiagGroup[];
    byExpiryDistance: DiagGroup[];
  };

  unavailableReasons: DiagUnavailableReason[];
  unavailableByUnderlying: DiagGroup[];
  unavailableByDate: { date: string; underlying: string; count: number }[];

  simulationOnlyRecommendations: {
    tag: "SIMULATION_ONLY";
    label: string;
    description: string;
    value: string | null;
    results: (SimulationResult & { minPremiumThreshold?: number; tradesFiltered?: number })[];
  }[];
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

async function fetchDiagnostics(runId: string): Promise<FnoReplayDiagnosticsOut> {
  const res = await fetch(`/api/backtest/fno/runs/${encodeURIComponent(runId)}/diagnostics`, {
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<FnoReplayDiagnosticsOut>;
}

export function useReplayDiagnostics(runId: string | null) {
  return useQuery({
    queryKey: ["backtest", "diagnostics", runId],
    queryFn: () => fetchDiagnostics(runId!),
    enabled: Boolean(runId),
    staleTime: 5 * 60 * 1000, // 5 min — diagnostics are pure analytics, stable
    retry: 1,
  });
}
