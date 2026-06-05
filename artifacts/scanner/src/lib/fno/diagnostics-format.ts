/**
 * Pure, honest formatters for the owner-only F&O Diagnostics cockpit.
 *
 * READ-ONLY presentation helpers only — no data fetching, no trading logic.
 * Every helper is explicit about MISSING data: it returns a labelled "n/a"
 * (with a reason where useful) and NEVER fabricates a zero, a percentage,
 * or a verdict when the underlying value is absent.
 */

export type Severity = "ok" | "warn" | "fail" | "unavailable";

/** Map a backend HealthSeverity / blockingSeverity onto the UI severity. */
export function normalizeSeverity(s: string | null | undefined): Severity {
  switch ((s ?? "").toUpperCase()) {
    case "OK":
      return "ok";
    case "WARN":
      return "warn";
    case "FAIL":
      return "fail";
    case "UNAVAILABLE":
      return "unavailable";
    default:
      return "unavailable";
  }
}

/** Roll a set of severities up into the worst one (fail > warn > ok). */
export function rollUpSeverity(list: Severity[]): Severity {
  if (list.length === 0) return "unavailable";
  if (list.includes("fail")) return "fail";
  if (list.includes("warn")) return "warn";
  if (list.every((s) => s === "unavailable")) return "unavailable";
  return "ok";
}

/**
 * Verdict → UI severity. KITE_OFFLINE/UNAVAILABLE/KITE_STALE are degraded;
 * PARTIAL is a warning; only LIVE_KITE is OK.
 */
export function verdictSeverity(verdict: string | null | undefined): Severity {
  switch (verdict) {
    case "LIVE_KITE":
      return "ok";
    case "PARTIAL":
      return "warn";
    case "KITE_STALE":
      return "warn";
    case "KITE_OFFLINE":
      return "fail";
    case "UNAVAILABLE":
      return "unavailable";
    default:
      return "unavailable";
  }
}

const VERDICT_LABEL: Record<string, string> = {
  LIVE_KITE: "Live (Kite)",
  PARTIAL: "Partial",
  KITE_STALE: "Kite stale",
  KITE_OFFLINE: "Kite offline",
  UNAVAILABLE: "Unavailable",
};
export function verdictLabel(verdict: string | null | undefined): string {
  if (!verdict) return "n/a";
  return VERDICT_LABEL[verdict] ?? verdict;
}

const PROVIDER_LABEL: Record<string, string> = {
  KITE_WS: "Kite WebSocket",
  KITE_REST: "Kite REST",
  CACHE: "Cache",
  KITE: "Kite",
  NSE: "NSE (non-Kite)",
  YAHOO: "Yahoo (non-Kite)",
  UNAVAILABLE: "Unavailable",
};
export function providerLabel(p: string | null | undefined): string {
  if (!p) return "n/a";
  return PROVIDER_LABEL[p] ?? p;
}

/** Human age from seconds; honest "n/a" when missing. */
export function formatAgeSec(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "n/a";
  if (sec < 0) return "just now";
  if (sec < 60) return `${Math.round(sec)}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86_400) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86_400)}d ago`;
}

/** Number with no fake zero — null/NaN becomes a labelled "n/a". */
export function numOrNa(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return n.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Percentage with explicit n/a; value is already in percent units. */
export function pctOrNa(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return `${n.toFixed(digits)}%`;
}

/** Ratio (0..1) → percent string, honest n/a. */
export function rateOrNa(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return `${(n * 100).toFixed(digits)}%`;
}

/**
 * Expected-move display: returns the straddle / points / percent with an
 * explicit reason when unavailable. Never invents a straddle from a single
 * leg or a zero.
 */
export interface ExpectedMoveLike {
  atmStraddlePremium: number | null;
  expectedMovePoints: number | null;
  expectedMovePercent: number | null;
  formulaLabel: string | null;
  reason: string | null;
}
export function formatExpectedMove(em: ExpectedMoveLike | null | undefined): {
  available: boolean;
  straddle: string;
  points: string;
  percent: string;
  reason: string | null;
  formula: string | null;
} {
  if (!em || em.atmStraddlePremium == null) {
    return {
      available: false,
      straddle: "n/a",
      points: "n/a",
      percent: "n/a",
      reason: em?.reason ?? "UNAVAILABLE",
      formula: em?.formulaLabel ?? null,
    };
  }
  return {
    available: true,
    straddle: numOrNa(em.atmStraddlePremium, 2),
    points: numOrNa(em.expectedMovePoints, 2),
    percent: pctOrNa(em.expectedMovePercent, 2),
    reason: null,
    formula: em.formulaLabel,
  };
}

/** One-line human summary of why a signal is blocked (or that it is allowed). */
export function summarizeReadiness(input: {
  signalAllowed: boolean;
  blockingReasons?: Array<{ code: string; severity: string; detail: string }> | null;
}): string {
  if (input.signalAllowed) return "Signal allowed — live Kite spot + Kite option data, fresh.";
  const reasons = input.blockingReasons ?? [];
  const fails = reasons.filter((r) => r.severity === "FAIL");
  if (fails.length > 0) return fails.map((r) => r.detail).join("; ");
  if (reasons.length > 0) return reasons.map((r) => r.detail).join("; ");
  return "Signal not allowed — data not fresh enough.";
}
