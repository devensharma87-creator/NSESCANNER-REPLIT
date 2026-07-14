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

/**
 * Environment label. The backend `getEnvironmentLabel()` returns a structured
 * object `{ env, autoTradingEnabled, reason }`; older/other surfaces may pass a
 * plain string. This formatter renders honestly as a SHORT string and NEVER
 * returns the raw object (rendering an object as a React child throws React #31).
 */
export function formatEnvLabel(env: unknown): {
  label: string;
  reason: string | null;
  autoTrading: boolean | null;
} {
  if (env == null) return { label: "n/a", reason: null, autoTrading: null };
  if (typeof env === "string") {
    return { label: env.length > 0 ? env : "n/a", reason: null, autoTrading: null };
  }
  if (typeof env === "object") {
    const o = env as { env?: unknown; autoTradingEnabled?: unknown; reason?: unknown };
    return {
      label: typeof o.env === "string" && o.env.length > 0 ? o.env : "n/a",
      reason: typeof o.reason === "string" && o.reason.length > 0 ? o.reason : null,
      autoTrading: typeof o.autoTradingEnabled === "boolean" ? o.autoTradingEnabled : null,
    };
  }
  return { label: String(env), reason: null, autoTrading: null };
}

/**
 * Defensive last-resort renderer: guarantees a React-safe string for any value.
 * Primitives render directly; objects/arrays collapse to compact JSON (debug
 * use only). Use this anywhere a loosely-typed value might otherwise reach JSX
 * as a raw object/array and trigger React #31.
 */
export function formatDiagnosticValue(value: unknown): string {
  if (value == null) return "n/a";
  const t = typeof value;
  if (t === "string") return (value as string).length > 0 ? (value as string) : "n/a";
  if (t === "number") return Number.isFinite(value as number) ? String(value) : "n/a";
  if (t === "boolean") return value ? "true" : "false";
  if (t === "bigint") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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
