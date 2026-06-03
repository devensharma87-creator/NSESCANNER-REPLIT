/**
 * Portfolio Analyser — benchmark comparison (pure, tested).
 *
 * HONEST BY CONSTRUCTION. A benchmark return is only shown when a real index
 * series is supplied; sector-weight comparison is reported as explicitly
 * unavailable because no Nifty-500 sector-weight reference is wired in this
 * build. The function NEVER fabricates a benchmark weight or return.
 */

/**
 * Selectable benchmark indices. Each maps to a real index series fetched via the
 * existing chart endpoint (segment "index", Kite→Yahoo). No fabricated series:
 * if a given index returns no closes, the comparison falls back to the explicit
 * "unavailable" state per index.
 */
export interface BenchmarkOption {
  /** Stable selector key. */
  key: "NIFTY" | "BANKNIFTY" | "SENSEX";
  /** Chart-endpoint symbol (segment "index"). */
  symbol: string;
  /** Human label shown in the panel. */
  name: string;
}

export const BENCHMARK_OPTIONS: readonly BenchmarkOption[] = [
  { key: "NIFTY", symbol: "NIFTY", name: "NIFTY 50" },
  { key: "BANKNIFTY", symbol: "BANKNIFTY", name: "Bank Nifty" },
  { key: "SENSEX", symbol: "SENSEX", name: "Sensex" },
] as const;

export interface BenchmarkInput {
  /** Portfolio total return over the comparison window (%), null if unknown. */
  portfolioReturnPct: number | null;
  /** Real benchmark return over the SAME window (%), null when no series supplied. */
  benchmarkReturnPct: number | null;
  /** Human label for the benchmark, e.g. "NIFTY 50". */
  benchmarkName: string;
  /** Description of the comparison window, e.g. "since earliest purchase (2024-01-15)". */
  windowLabel: string | null;
}

export interface BenchmarkComparison {
  benchmarkName: string;
  windowLabel: string | null;
  portfolioReturnPct: number | null;
  benchmarkReturnPct: number | null;
  /** portfolio − benchmark (percentage points), null when either side missing. */
  relativePct: number | null;
  /** "outperforming" | "underperforming" | "in line" | null. */
  verdict: "outperforming" | "underperforming" | "in line" | null;
  /** Non-null when the return comparison cannot be made. */
  returnUnavailable: string | null;
  /** Always set in this build — sector-weight reference is not available. */
  sectorWeightUnavailable: string;
}

export function compareToBenchmark(input: BenchmarkInput): BenchmarkComparison {
  const { portfolioReturnPct, benchmarkReturnPct, benchmarkName, windowLabel } = input;

  let relativePct: number | null = null;
  let verdict: BenchmarkComparison["verdict"] = null;
  let returnUnavailable: string | null = null;

  if (portfolioReturnPct == null && benchmarkReturnPct == null) {
    returnUnavailable =
      "Benchmark comparison unavailable — neither a portfolio return nor a live benchmark series could be computed.";
  } else if (benchmarkReturnPct == null) {
    returnUnavailable = `${benchmarkName} series unavailable for this window — cannot compute relative performance.`;
  } else if (portfolioReturnPct == null) {
    returnUnavailable =
      "Portfolio return unavailable (no live values) — cannot compute relative performance.";
  } else {
    relativePct = portfolioReturnPct - benchmarkReturnPct;
    verdict = relativePct > 0.5 ? "outperforming" : relativePct < -0.5 ? "underperforming" : "in line";
  }

  return {
    benchmarkName,
    windowLabel,
    portfolioReturnPct,
    benchmarkReturnPct,
    relativePct,
    verdict,
    returnUnavailable,
    sectorWeightUnavailable:
      "Sector-weight benchmark unavailable — no Nifty-500 reference weights are wired in this build; " +
      "weights are not fabricated.",
  };
}

/**
 * Compute a buy-and-hold benchmark return (%) from a real index close series.
 * Returns null when there are fewer than two finite closes — never a guess.
 */
export function benchmarkReturnFromCloses(closes: number[]): number | null {
  const finite = closes.filter(c => Number.isFinite(c));
  if (finite.length < 2) return null;
  const first = finite[0];
  const last = finite[finite.length - 1];
  if (first === 0) return null;
  return ((last - first) / first) * 100;
}
