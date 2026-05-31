/**
 * W3-P1 — pure view helpers for the future F&O paper-trading / options cockpit.
 *
 * STRICTLY presentation / classification / filtering / grouping over the data the
 * cockpit pages already fetch (`/paper/positions/fo`, `/paper/trades/fo`, etc.).
 * Nothing here computes or alters a trading decision: no signal, entry, stop,
 * target, sizing, gate, P25-tracker mutation, or MFE/MAE recomputation. It only
 * reshapes, classifies, and labels existing fields for display.
 *
 * Every function is deterministic and side-effect free — no API calls, no DB
 * calls, no clock reads (callers pass `nowMs`), no input mutation.
 *
 * The P25 eligibility helpers mirror the accepted OFFICIAL counting rule for UI
 * classification only. They do NOT change the real gate, its threshold, or the
 * backend tracker.
 */

// ── Row model (covers both open and closed F&O trade-like rows) ───────────────

/** A numeric field as it may arrive from the API: number, numeric string, or absent. */
export type Num = number | string | null | undefined;

export interface FoTradeRow {
  id?: string | number | null;
  signalDate?: string | null;
  indexSymbol?: string | null;
  indexName?: string | null;
  setupKey?: string | null;
  direction?: string | null;
  optionType?: string | null;
  strike?: Num;
  lots?: Num;
  lotSize?: Num;
  entryPremium?: Num;
  stopPremium?: Num;
  target1Premium?: Num;
  target2Premium?: Num;
  capitalDeployed?: Num;
  lastPremium?: Num;
  unrealizedPnl?: Num;
  maxRunup?: Num;
  maxDrawdown?: Num;
  openedAt?: string | null;
  lastEvaluatedAt?: string | null;
  status?: string | null;
  exitPremium?: Num;
  exitedAt?: string | null;
  realizedPnl?: Num;
  exitReason?: string | null;
  journal?: string | null;
  tags?: string[] | null;
  /** Optional — only present on some reasoning-joined rows; never required. */
  confidence?: Num;
}

// ── safe primitives ──────────────────────────────────────────────────────────

/** Parse a possibly-string/null/undefined numeric field to a finite number or NaN. */
export const toNum = (v: Num): number => {
  if (v == null) return NaN;
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  const s = v.trim();
  if (s === "") return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};

/** Parse an ISO timestamp to epoch ms, or NaN. */
export const parseTs = (iso: string | null | undefined): number => {
  if (!iso) return NaN;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : NaN;
};

/** Status === CLOSED (case-insensitive, trimmed). */
export const isClosed = (row: Pick<FoTradeRow, "status">): boolean =>
  (row.status ?? "").trim().toUpperCase() === "CLOSED";

/** Status === OPEN (case-insensitive, trimmed). */
export const isOpen = (row: Pick<FoTradeRow, "status">): boolean =>
  (row.status ?? "").trim().toUpperCase() === "OPEN";

/** Quantity in shares = lots × lotSize (NaN if either is missing/invalid). */
export const getQuantity = (row: Pick<FoTradeRow, "lots" | "lotSize">): number => {
  const lots = toNum(row.lots);
  const lotSize = toNum(row.lotSize);
  if (!Number.isFinite(lots) || !Number.isFinite(lotSize)) return NaN;
  return lots * lotSize;
};

/**
 * Effective P&L for display/classification: realised for CLOSED rows, unrealised
 * (MTM) for OPEN rows. Returns NaN when the relevant field is missing.
 */
export const effectivePnl = (row: FoTradeRow): number =>
  isClosed(row) ? toNum(row.realizedPnl) : toNum(row.unrealizedPnl);

/** True when MFE/MAE evidence exists (both finite and NOT the 0/0 placeholder). */
export const hasMfeMaeEvidence = (row: Pick<FoTradeRow, "maxRunup" | "maxDrawdown">): boolean => {
  const up = toNum(row.maxRunup);
  const down = toNum(row.maxDrawdown);
  if (!Number.isFinite(up) || !Number.isFinite(down)) return false;
  return !(up === 0 && down === 0);
};

/**
 * P&L as a fraction of capital deployed (`effectivePnl ÷ capitalDeployed`).
 * Returns null when capital is not a finite positive number or the P&L is not
 * finite — never throws, never divides by zero. Display-only.
 */
export const deriveFoPnlPct = (row: FoTradeRow): number | null => {
  const pnl = effectivePnl(row);
  const cap = toNum(row.capitalDeployed);
  if (!Number.isFinite(pnl) || !Number.isFinite(cap) || cap <= 0) return null;
  return pnl / cap;
};

// ── 1. P25 official eligibility (UI classification only) ──────────────────────

export type P25Reason =
  | "eligible"
  | "not_closed"
  | "missing_exit_premium"
  | "invalid_entry_premium"
  | "invalid_quantity"
  | "excluded_zero_zero_mfe_mae"
  | "missing_mfe_mae";

/**
 * Returns the OFFICIAL P25 eligibility reason for a row, mirroring the accepted
 * gate rule (display classification only — does NOT touch the real tracker):
 *
 *   status === CLOSED
 *   exitPremium != null
 *   entryPremium > 0
 *   quantity = lots * lotSize > 0
 *   NOT (maxRunup === 0 AND maxDrawdown === 0)
 *
 * A raw "MFE/MAE IS NOT NULL" check is intentionally NOT used: 0/0 placeholder
 * rows (pre-fix) are excluded, and rows with missing MFE/MAE are excluded.
 */
export function getP25EligibilityReason(row: FoTradeRow): P25Reason {
  if (!isClosed(row)) return "not_closed";
  if (row.exitPremium == null || !Number.isFinite(toNum(row.exitPremium)))
    return "missing_exit_premium";
  const entry = toNum(row.entryPremium);
  if (!Number.isFinite(entry) || entry <= 0) return "invalid_entry_premium";
  const qty = getQuantity(row);
  if (!Number.isFinite(qty) || qty <= 0) return "invalid_quantity";
  const up = toNum(row.maxRunup);
  const down = toNum(row.maxDrawdown);
  if (!Number.isFinite(up) || !Number.isFinite(down)) return "missing_mfe_mae";
  if (up === 0 && down === 0) return "excluded_zero_zero_mfe_mae";
  return "eligible";
}

/** Display-only predicate: does this row count toward the official P25 evidence? */
export function isP25EligibleTrade(row: FoTradeRow): boolean {
  return getP25EligibilityReason(row) === "eligible";
}

export interface P25Summary {
  threshold: number;
  eligibleCount: number;
  /** threshold − eligibleCount (per the accepted rule; may be negative). */
  remaining: number;
  /** Gate is OPEN while fewer than `threshold` eligible trades exist. */
  gateOpen: boolean;
  eligibleTrades: FoTradeRow[];
  /** Rows excluded specifically because MFE/MAE was the 0/0 pre-fix placeholder. */
  excludedZeroZero: FoTradeRow[];
  excludedZeroZeroCount: number;
  /** The most recently closed eligible trade (by exitedAt), or null. */
  lastEligible: FoTradeRow | null;
  /** Count of rows per eligibility reason (full breakdown for the panel). */
  reasonCounts: Record<P25Reason, number>;
}

const emptyReasonCounts = (): Record<P25Reason, number> => ({
  eligible: 0,
  not_closed: 0,
  missing_exit_premium: 0,
  invalid_entry_premium: 0,
  invalid_quantity: 0,
  excluded_zero_zero_mfe_mae: 0,
  missing_mfe_mae: 0,
});

/**
 * Roll up the OFFICIAL P25 evidence picture for the panel. `rows` may include
 * open and closed trades freely — non-closed rows are simply classified
 * `not_closed` and never counted. Pure; does not mutate `rows`.
 */
export function deriveP25Summary(rows: FoTradeRow[], threshold = 20): P25Summary {
  const reasonCounts = emptyReasonCounts();
  const eligibleTrades: FoTradeRow[] = [];
  const excludedZeroZero: FoTradeRow[] = [];
  for (const r of rows) {
    const reason = getP25EligibilityReason(r);
    reasonCounts[reason] += 1;
    if (reason === "eligible") eligibleTrades.push(r);
    else if (reason === "excluded_zero_zero_mfe_mae") excludedZeroZero.push(r);
  }
  let lastEligible: FoTradeRow | null = null;
  let lastMs = -Infinity;
  for (const r of eligibleTrades) {
    const ms = parseTs(r.exitedAt);
    if (Number.isFinite(ms) && ms > lastMs) {
      lastMs = ms;
      lastEligible = r;
    }
  }
  const eligibleCount = eligibleTrades.length;
  return {
    threshold,
    eligibleCount,
    remaining: threshold - eligibleCount,
    gateOpen: eligibleCount < threshold,
    eligibleTrades,
    excludedZeroZero,
    excludedZeroZeroCount: excludedZeroZero.length,
    lastEligible,
    reasonCounts,
  };
}

// ── P25 evidence headline (display state for the cockpit banner/card) ─────────
//
// The OFFICIAL eligible count is supplied by the caller — in W3-P2 it comes from
// the server-computed `mfeAvailableCount` on `/paper/analytics/fo/shadow-exits`,
// which already applies the accepted rule (CLOSED + exit!=null + entry>0 + qty>0
// + NOT 0/0 MFE/MAE). This helper does NOT recompute the count, change the
// threshold (default 20), or touch the tracker — it only derives display labels.

export interface P25Headline {
  /** True when an official count was available from the source. */
  available: boolean;
  /** The official eligible count (0 when unavailable). */
  officialCount: number;
  threshold: number;
  /** Math.max(0, threshold − officialCount). */
  remaining: number;
  thresholdMet: boolean;
  gateStatus: "OPEN" | "THRESHOLD_MET";
  /** "Evidence gate open" | "Evidence gate: threshold met". */
  gateLabel: string;
  /** "5/20" when available, else "—/20". */
  ratioLabel: string;
}

export function deriveP25Headline(args: {
  officialCount: number | null | undefined;
  threshold?: number;
}): P25Headline {
  const threshold = args.threshold ?? 20;
  const n = toNum(args.officialCount);
  const available = Number.isFinite(n);
  const officialCount = available ? n : 0;
  const thresholdMet = available && officialCount >= threshold;
  return {
    available,
    officialCount,
    threshold,
    remaining: Math.max(0, threshold - officialCount),
    thresholdMet,
    gateStatus: thresholdMet ? "THRESHOLD_MET" : "OPEN",
    gateLabel: thresholdMet ? "Evidence gate: threshold met" : "Evidence gate open",
    ratioLabel: available ? `${officialCount}/${threshold}` : `—/${threshold}`,
  };
}

// ── P25 evidence detail (display-only) ────────────────────────────────────────

/**
 * Defensive client-side read type for the `/paper/analytics/fo/shadow-exits`
 * payload. Every field is optional because the server's disabled branch omits
 * several of them, and we must never crash on a missing/malformed field. This
 * mirrors fields the server ALREADY returns — it adds nothing to the payload.
 */
export interface FoShadowExitsGroupRow {
  key?: string | null;
  trades?: number | null;
  mfeAvailableCount?: number | null;
  actualPnl?: number | null;
}

export interface FoShadowExitsResponse {
  enabled?: boolean;
  /** Official P25 eligible count (server-computed). The ONLY count we trust. */
  mfeAvailableCount?: number | null;
  rawRowCount?: number | null;
  processedRowCount?: number | null;
  rowCount?: number | null;
  lowSampleWarning?: boolean | null;
  lowSampleThreshold?: number | null;
  byIndex?: FoShadowExitsGroupRow[] | null;
  bySetup?: FoShadowExitsGroupRow[] | null;
  byTier?: FoShadowExitsGroupRow[] | null;
}

/** Normalized breakdown row for compact display tables. */
export interface P25BreakdownRow {
  name: string;
  trades: number | null;
  eligible: number | null;
  pnl: number | null;
}

export interface P25EvidenceDetail {
  /** True when an official eligible count was usable from the payload. */
  available: boolean;
  /** Server `enabled` flag; false means reporting is suppressed. */
  enabled: boolean;
  /** Official eligible count (mfeAvailableCount), null when unavailable. */
  officialCount: number | null;
  threshold: number;
  /** Math.max(0, threshold − officialCount). */
  remaining: number;
  thresholdMet: boolean;
  gateStatus: "OPEN" | "THRESHOLD_MET" | "UNAVAILABLE";
  gateLabel: string;
  /** "5/20" when available, else "—/20". */
  ratioLabel: string;
  rawRowCount: number | null;
  processedRowCount: number | null;
  /**
   * processedRowCount − mfeAvailableCount, clamped to ≥ 0. Null when either
   * input is missing. Labeled "Excluded / not MFE-available rows" — it does NOT
   * claim every excluded row is a 0/0 placeholder.
   */
  excludedNotMfeAvailable: number | null;
  lowSampleWarning: boolean | null;
  lowSampleThreshold: number | null;
  byIndex: P25BreakdownRow[];
  bySetup: P25BreakdownRow[];
  byTier: P25BreakdownRow[];
}

function normalizeP25Breakdown(
  rows: FoShadowExitsGroupRow[] | null | undefined,
): P25BreakdownRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => {
    const trades = toNum(r?.trades);
    const eligible = toNum(r?.mfeAvailableCount);
    const pnl = toNum(r?.actualPnl);
    return {
      name: typeof r?.key === "string" && r.key.length > 0 ? r.key : "—",
      trades: Number.isFinite(trades) ? trades : null,
      eligible: Number.isFinite(eligible) ? eligible : null,
      pnl: Number.isFinite(pnl) ? pnl : null,
    };
  });
}

/**
 * Derive the P25 evidence detail display model from the shadow-exits payload.
 *
 * Pure. Reuses {@link deriveP25Headline} for the official ratio/remaining/gate
 * so there is a single source of truth for the count math. The ONLY count read
 * is the server's official `mfeAvailableCount`; raw non-null MFE/MAE counts are
 * never consulted. Threshold defaults to 20, negative remaining is clamped, and
 * every missing/malformed field collapses to a safe placeholder (null).
 */
export function deriveP25EvidenceDetail(
  report: FoShadowExitsResponse | null | undefined,
  opts?: { threshold?: number },
): P25EvidenceDetail {
  const threshold = opts?.threshold ?? 20;
  const headline = deriveP25Headline({
    officialCount: report?.enabled === false ? null : report?.mfeAvailableCount,
    threshold,
  });

  const raw = toNum(report?.rawRowCount);
  const processed = toNum(report?.processedRowCount);
  const mfe = toNum(report?.mfeAvailableCount);
  const lowThr = toNum(report?.lowSampleThreshold);

  const rawRowCount = Number.isFinite(raw) ? raw : null;
  const processedRowCount = Number.isFinite(processed) ? processed : null;
  const excludedNotMfeAvailable =
    Number.isFinite(processed) && Number.isFinite(mfe)
      ? Math.max(0, processed - mfe)
      : null;

  return {
    available: headline.available,
    enabled: report?.enabled !== false,
    officialCount: headline.available ? headline.officialCount : null,
    threshold: headline.threshold,
    remaining: headline.remaining,
    thresholdMet: headline.thresholdMet,
    gateStatus: headline.available ? headline.gateStatus : "UNAVAILABLE",
    gateLabel: headline.available
      ? headline.gateLabel
      : "Evidence gate status unavailable",
    ratioLabel: headline.ratioLabel,
    rawRowCount,
    processedRowCount,
    excludedNotMfeAvailable,
    lowSampleWarning:
      typeof report?.lowSampleWarning === "boolean"
        ? report.lowSampleWarning
        : null,
    lowSampleThreshold: Number.isFinite(lowThr) ? lowThr : null,
    byIndex: normalizeP25Breakdown(report?.byIndex),
    bySetup: normalizeP25Breakdown(report?.bySetup),
    byTier: normalizeP25Breakdown(report?.byTier),
  };
}

/**
 * Classify a fetch failure for the P25 evidence panel into a friendly state.
 * Prefers the HTTP status (reliable) and falls back to message text, because
 * the shared `api()` helper may replace `HTTP 401/403` with the server's textual
 * `error` body. Returns null when no error is present. Pure.
 */
export function classifyP25PanelError(args: {
  status?: number | null;
  message?: string | null;
}): "auth" | "network" | null {
  const status = args.status ?? null;
  const message = args.message ?? null;
  if (status == null && (message == null || message === "")) return null;
  if (status === 401 || status === 403) return "auth";
  if (message && /\b(401|403)\b/.test(message)) return "auth";
  if (
    message &&
    /(unauthor|forbidden|owner[- ]only|not authori|requires? (owner|login|sign))/i.test(
      message,
    )
  ) {
    return "auth";
  }
  return "network";
}

// ── Safety / freshness banner display state ───────────────────────────────────

/** Fixed compliance lines for the cockpit safety banner (display-only). */
export const FO_SAFETY_STATIC_LINES: readonly string[] = [
  "Paper trading only",
  "No live order placement",
  "No exit-rule change approved",
];

export type FoFreshnessLevel = "healthy" | "stale" | "unknown";

export interface FoFreshnessState {
  lastMtmSweepAt: string | null;
  lastOpenEvalAt: string | null;
  lastClosedAt: string | null;
  level: FoFreshnessLevel;
}

/**
 * Derive a freshness verdict for the cockpit banner. Primary signal is the last
 * successful MTM sweep; falls back to the last open-trade evaluation. When no
 * timestamp or `now` is available the level is "unknown" (a safe placeholder,
 * never a crash). Pure.
 */
export function deriveFoFreshness(args: {
  now?: number;
  mtmSweepLastSuccessAt?: string | null;
  lastOpenEvalAt?: string | null;
  lastClosedAt?: string | null;
  staleMinutes?: number;
}): FoFreshnessState {
  const { now, mtmSweepLastSuccessAt = null, lastOpenEvalAt = null, lastClosedAt = null } = args;
  const staleMinutes = args.staleMinutes ?? 20;

  const primaryIso = mtmSweepLastSuccessAt ?? lastOpenEvalAt;
  let level: FoFreshnessLevel = "unknown";
  const primaryMs = parseTs(primaryIso);
  if (now != null && Number.isFinite(now) && Number.isFinite(primaryMs)) {
    level = now - primaryMs > staleMinutes * 60_000 ? "stale" : "healthy";
  }

  return {
    lastMtmSweepAt: mtmSweepLastSuccessAt,
    lastOpenEvalAt,
    lastClosedAt,
    level,
  };
}

// ── 2. Summary aggregation ────────────────────────────────────────────────────

export interface FoCockpitSummary {
  openCount: number;
  closedCount: number;
  /** Closed trades whose exit calendar-date matches `todayDate`; null when not supplied. */
  closedTodayCount: number | null;
  realizedPnl: number;
  unrealizedPnl: number;
  winCount: number;
  lossCount: number;
  /** Average MFE (maxRunup) over closed trades with finite values; null when none. */
  avgMfe: number | null;
  /** Average MAE (maxDrawdown) over closed trades with finite values; null when none. */
  avgMae: number | null;
  bestTrade: FoTradeRow | null;
  worstTrade: FoTradeRow | null;
  lastOpenAt: string | null;
  lastEvaluatedAt: string | null;
  p25Count: number;
  remainingToThreshold: number;
  gateOpen: boolean;
}

const datePart = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const s = iso.trim();
  if (s === "") return null;
  // ISO timestamps start with YYYY-MM-DD; fall back to the whole string.
  return s.length >= 10 ? s.slice(0, 10) : s;
};

const avgFinite = (values: number[]): number | null => {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return null;
  return finite.reduce((a, b) => a + b, 0) / finite.length;
};

const maxTs = (rows: FoTradeRow[], pick: (r: FoTradeRow) => string | null | undefined):
  string | null => {
  let bestMs = -Infinity;
  let best: string | null = null;
  for (const r of rows) {
    const iso = pick(r);
    const ms = parseTs(iso);
    if (Number.isFinite(ms) && ms > bestMs) {
      bestMs = ms;
      best = iso ?? null;
    }
  }
  return best;
};

export interface SummarizeArgs {
  openTrades: FoTradeRow[];
  closedTrades: FoTradeRow[];
  threshold?: number;
  /** Optional YYYY-MM-DD used only to compute `closedTodayCount`. */
  todayDate?: string | null;
}

/**
 * Aggregate the open + closed sets into the cockpit summary-card numbers. All
 * values are derived from existing fields with safe numeric parsing; nothing is
 * recomputed beyond simple sums/averages/extrema. Pure; inputs untouched.
 */
export function summarizeFoCockpit(args: SummarizeArgs): FoCockpitSummary {
  const { openTrades, closedTrades, threshold = 20, todayDate = null } = args;

  const realizedPnl = closedTrades.reduce((acc, r) => {
    const v = toNum(r.realizedPnl);
    return acc + (Number.isFinite(v) ? v : 0);
  }, 0);
  const unrealizedPnl = openTrades.reduce((acc, r) => {
    const v = toNum(r.unrealizedPnl);
    return acc + (Number.isFinite(v) ? v : 0);
  }, 0);

  let winCount = 0;
  let lossCount = 0;
  let bestTrade: FoTradeRow | null = null;
  let worstTrade: FoTradeRow | null = null;
  let bestPnl = -Infinity;
  let worstPnl = Infinity;
  for (const r of closedTrades) {
    const pnl = toNum(r.realizedPnl);
    if (!Number.isFinite(pnl)) continue;
    if (pnl > 0) winCount += 1;
    else if (pnl < 0) lossCount += 1;
    if (pnl > bestPnl) {
      bestPnl = pnl;
      bestTrade = r;
    }
    if (pnl < worstPnl) {
      worstPnl = pnl;
      worstTrade = r;
    }
  }

  const closedTodayCount =
    todayDate == null
      ? null
      : closedTrades.filter((r) => datePart(r.exitedAt) === todayDate).length;

  const allRows = [...openTrades, ...closedTrades];
  const p25 = deriveP25Summary(allRows, threshold);

  return {
    openCount: openTrades.length,
    closedCount: closedTrades.length,
    closedTodayCount,
    realizedPnl,
    unrealizedPnl,
    winCount,
    lossCount,
    avgMfe: avgFinite(closedTrades.map((r) => toNum(r.maxRunup))),
    avgMae: avgFinite(closedTrades.map((r) => toNum(r.maxDrawdown))),
    bestTrade,
    worstTrade,
    lastOpenAt: maxTs(allRows, (r) => r.openedAt),
    lastEvaluatedAt: maxTs(allRows, (r) => r.lastEvaluatedAt),
    p25Count: p25.eligibleCount,
    remainingToThreshold: p25.remaining,
    gateOpen: p25.gateOpen,
  };
}

// ── 3. Risk badges (display-only, derived from existing fields) ────────────────

export type FoBadgeTone = "danger" | "warn" | "info" | "muted" | "success";
export type FoBadgeKind = "status" | "evidence" | "exit" | "data" | "pnl";

export interface FoBadge {
  label: string;
  tone: FoBadgeTone;
  kind: FoBadgeKind;
}

export interface FoBadgeOptions {
  now?: number;
  staleMinutes?: number;
  lowSampleWarning?: boolean;
  snapshotMissing?: boolean;
  /** |maxDrawdown| ÷ capitalDeployed at/above this fraction → "high-drawdown". */
  highDrawdownPct?: number;
}

const EXIT_TIME_RE = /TIME|15[:.]?20|1520|EOD|FORCE/i;
const EXIT_STOP_RE = /STOP|SL\b/i;
const EXIT_TARGET_RE = /TARGET|PROFIT|T1|T2/i;

/**
 * Derive display-only risk/status badges from a trade row. No trading logic, no
 * new signals, no strategy recomputation — every badge keys off existing fields
 * (status, P&L, exitReason, MFE/MAE evidence, timestamps) or caller-supplied
 * display context (snapshot/sample/staleness).
 */
export function deriveFoRiskBadges(row: FoTradeRow, options: FoBadgeOptions = {}): FoBadge[] {
  const { now, staleMinutes = 15, lowSampleWarning, snapshotMissing, highDrawdownPct = 0.5 } =
    options;
  const out: FoBadge[] = [];

  out.push({ label: "paper-only", tone: "muted", kind: "status" });

  if (isOpen(row)) out.push({ label: "open-position", tone: "info", kind: "status" });
  else if (isClosed(row)) out.push({ label: "closed-position", tone: "muted", kind: "status" });

  const pnl = effectivePnl(row);
  if (Number.isFinite(pnl)) {
    if (pnl > 0) out.push({ label: "profit", tone: "success", kind: "pnl" });
    else if (pnl < 0) out.push({ label: "loss", tone: "danger", kind: "pnl" });
  }

  const reason = getP25EligibilityReason(row);
  if (reason === "eligible")
    out.push({ label: "evidence-eligible", tone: "success", kind: "evidence" });
  else if (reason === "excluded_zero_zero_mfe_mae")
    out.push({ label: "evidence-excluded-0/0", tone: "warn", kind: "evidence" });

  if (!hasMfeMaeEvidence(row))
    out.push({ label: "no-MFE-data", tone: "muted", kind: "data" });

  // high-drawdown: magnitude of adverse excursion relative to deployed capital.
  const down = toNum(row.maxDrawdown);
  const cap = toNum(row.capitalDeployed);
  if (Number.isFinite(down) && Number.isFinite(cap) && cap > 0) {
    if (Math.abs(down) / cap >= highDrawdownPct)
      out.push({ label: "high-drawdown", tone: "danger", kind: "data" });
  }

  const exitReason = (row.exitReason ?? "").trim();
  if (exitReason) {
    if (EXIT_TIME_RE.test(exitReason))
      out.push({ label: "time-exit", tone: "info", kind: "exit" });
    else if (EXIT_STOP_RE.test(exitReason))
      out.push({ label: "stop-exit", tone: "danger", kind: "exit" });
    else if (EXIT_TARGET_RE.test(exitReason))
      out.push({ label: "target-exit", tone: "success", kind: "exit" });
  }

  if (isFoQuoteStale(row, now, staleMinutes))
    out.push({ label: "stale-quote", tone: "warn", kind: "data" });

  if (snapshotMissing === true)
    out.push({ label: "missing-option-snapshot", tone: "warn", kind: "data" });

  if (lowSampleWarning === true)
    out.push({ label: "low-sample-warning", tone: "warn", kind: "data" });

  return out;
}

// ── 7. Time helpers (pure) ────────────────────────────────────────────────────

/**
 * Duration the trade has been/was held, in ms. For CLOSED rows uses exitedAt;
 * for OPEN rows uses `nowMs` when supplied, else lastEvaluatedAt. NaN if the
 * open time or the relevant end time is missing.
 */
export function getTimeInTradeMs(row: FoTradeRow, nowMs?: number): number {
  const openMs = parseTs(row.openedAt);
  if (!Number.isFinite(openMs)) return NaN;
  const exitMs = parseTs(row.exitedAt);
  let endMs: number;
  if (Number.isFinite(exitMs)) endMs = exitMs;
  else if (nowMs != null && Number.isFinite(nowMs)) endMs = nowMs;
  else endMs = parseTs(row.lastEvaluatedAt);
  if (!Number.isFinite(endMs)) return NaN;
  return endMs - openMs;
}

/** The most recent activity timestamp (exitedAt ▸ lastEvaluatedAt ▸ openedAt), or null. */
export function getFoLastActivityAt(row: FoTradeRow): string | null {
  const candidates: Array<string | null | undefined> = [
    row.exitedAt,
    row.lastEvaluatedAt,
    row.openedAt,
  ];
  let bestMs = -Infinity;
  let best: string | null = null;
  for (const iso of candidates) {
    const ms = parseTs(iso);
    if (Number.isFinite(ms) && ms > bestMs) {
      bestMs = ms;
      best = iso ?? null;
    }
  }
  return best;
}

/**
 * Is an OPEN position's live quote stale? Closed rows are never "stale". An open
 * row with no `lastEvaluatedAt` is treated as stale (unknown freshness). Requires
 * `now` (epoch ms); without it nothing is flagged stale.
 */
export function isFoQuoteStale(row: FoTradeRow, now?: number, staleMinutes = 15): boolean {
  if (!isOpen(row)) return false;
  if (now == null || !Number.isFinite(now)) return false;
  const ms = parseTs(row.lastEvaluatedAt);
  if (!Number.isFinite(ms)) return true;
  return now - ms > staleMinutes * 60_000;
}

// ── 4. Filters ────────────────────────────────────────────────────────────────

export type PnlSign = "ALL" | "POSITIVE" | "NEGATIVE";

export interface FoFilters {
  index: string; // "ALL" | indexSymbol
  setup: string; // "ALL" | setupKey
  direction: string; // "ALL" | LONG/SHORT
  optionType: string; // "ALL" | CE/PE
  status: string; // "ALL" | OPEN/CLOSED
  dateFrom: string | null; // YYYY-MM-DD inclusive
  dateTo: string | null; // YYYY-MM-DD inclusive
  pnlSign: PnlSign;
  p25EligibleOnly: boolean;
  exitReason: string; // "ALL" | exact exitReason
  evidenceAvailableOnly: boolean;
  paperOnly: boolean; // all paper trades are paper; kept for UI completeness
}

export const DEFAULT_FO_FILTERS: FoFilters = {
  index: "ALL",
  setup: "ALL",
  direction: "ALL",
  optionType: "ALL",
  status: "ALL",
  dateFrom: null,
  dateTo: null,
  pnlSign: "ALL",
  p25EligibleOnly: false,
  exitReason: "ALL",
  evidenceAvailableOnly: false,
  paperOnly: false,
};

/** Reference calendar date for a row: signalDate ▸ date part of openedAt. */
const rowRefDate = (row: FoTradeRow): string | null =>
  datePart(row.signalDate) ?? datePart(row.openedAt);

/** Filter rows by the cockpit filter set. Pure; returns a new array. */
export function applyFoFilters(rows: FoTradeRow[], filters: FoFilters): FoTradeRow[] {
  return rows.filter((r) => {
    if (filters.index !== "ALL" && (r.indexSymbol ?? "") !== filters.index) return false;
    if (filters.setup !== "ALL" && (r.setupKey ?? "") !== filters.setup) return false;
    if (filters.direction !== "ALL" && (r.direction ?? "") !== filters.direction) return false;
    if (filters.optionType !== "ALL" && (r.optionType ?? "") !== filters.optionType) return false;
    if (filters.status !== "ALL" && (r.status ?? "").toUpperCase() !== filters.status.toUpperCase())
      return false;

    const ref = rowRefDate(r);
    if (filters.dateFrom != null && (ref == null || ref < filters.dateFrom)) return false;
    if (filters.dateTo != null && (ref == null || ref > filters.dateTo)) return false;

    if (filters.pnlSign !== "ALL") {
      const pnl = effectivePnl(r);
      if (filters.pnlSign === "POSITIVE" && !(Number.isFinite(pnl) && pnl > 0)) return false;
      if (filters.pnlSign === "NEGATIVE" && !(Number.isFinite(pnl) && pnl < 0)) return false;
    }

    if (filters.p25EligibleOnly && !isP25EligibleTrade(r)) return false;
    if (filters.exitReason !== "ALL" && (r.exitReason ?? "") !== filters.exitReason) return false;
    if (filters.evidenceAvailableOnly && !hasMfeMaeEvidence(r)) return false;
    // paperOnly: every row is a paper trade, so this never removes rows.
    return true;
  });
}

// ── 5. Sorting ────────────────────────────────────────────────────────────────

export type FoSortKey =
  | "entryTime"
  | "exitTime"
  | "realizedPnl"
  | "unrealizedPnl"
  | "mfe"
  | "mae"
  | "confidence"
  | "timeInTrade"
  | "symbol";
export type FoSortDir = "asc" | "desc";

const sortValue = (row: FoTradeRow, key: FoSortKey): number => {
  switch (key) {
    case "entryTime":
      return parseTs(row.openedAt);
    case "exitTime":
      return parseTs(row.exitedAt);
    case "realizedPnl":
      return toNum(row.realizedPnl);
    case "unrealizedPnl":
      return toNum(row.unrealizedPnl);
    case "mfe":
      return toNum(row.maxRunup);
    case "mae":
      return toNum(row.maxDrawdown);
    case "confidence":
      return toNum(row.confidence);
    case "timeInTrade":
      return getTimeInTradeMs(row);
    default:
      return NaN;
  }
};

/**
 * Sort rows by a cockpit key. Non-mutating (operates on a copy). Invalid /
 * missing values (NaN) always sort LAST regardless of direction. `symbol` sorts
 * alphabetically by indexSymbol.
 */
export function sortFoRows(rows: FoTradeRow[], key: FoSortKey, dir: FoSortDir): FoTradeRow[] {
  const out = [...rows];
  if (key === "symbol") {
    out.sort((a, b) => {
      const cmp = (a.indexSymbol ?? "").localeCompare(b.indexSymbol ?? "");
      return dir === "asc" ? cmp : -cmp;
    });
    return out;
  }
  out.sort((a, b) => {
    const av = sortValue(a, key);
    const bv = sortValue(b, key);
    const aBad = !Number.isFinite(av);
    const bBad = !Number.isFinite(bv);
    if (aBad && bBad) return 0;
    if (aBad) return 1; // NaN/null last
    if (bBad) return -1;
    return dir === "desc" ? bv - av : av - bv;
  });
  return out;
}

// ── 6. Grouping ───────────────────────────────────────────────────────────────

export type FoGroupBy =
  | "none"
  | "index"
  | "setup"
  | "exitReason"
  | "status"
  | "p25Status"
  | "pnlSign";

export interface FoGroup {
  key: string;
  rows: FoTradeRow[];
}

const pnlSignLabel = (row: FoTradeRow): string => {
  const pnl = effectivePnl(row);
  if (!Number.isFinite(pnl)) return "No P&L";
  if (pnl > 0) return "Profit";
  if (pnl < 0) return "Loss";
  return "Flat";
};

const p25StatusLabel = (row: FoTradeRow): string => {
  const reason = getP25EligibilityReason(row);
  if (reason === "eligible") return "P25 eligible";
  if (reason === "excluded_zero_zero_mfe_mae") return "Excluded 0/0";
  if (reason === "missing_mfe_mae") return "No MFE/MAE";
  if (reason === "not_closed") return "Open / not closed";
  return "Ineligible";
};

/** Group rows by a cockpit dimension. Pure; rows are referenced, not mutated. */
export function groupFoRows(rows: FoTradeRow[], by: FoGroupBy): FoGroup[] {
  if (by === "none") return [{ key: "All", rows: [...rows] }];
  const map = new Map<string, FoTradeRow[]>();
  const keyOf = (r: FoTradeRow): string => {
    switch (by) {
      case "index":
        return (r.indexSymbol ?? "").trim() || "Unknown";
      case "setup":
        return (r.setupKey ?? "").trim() || "Unknown";
      case "exitReason":
        return (r.exitReason ?? "").trim() || "—";
      case "status":
        return (r.status ?? "").trim().toUpperCase() || "UNKNOWN";
      case "p25Status":
        return p25StatusLabel(r);
      case "pnlSign":
        return pnlSignLabel(r);
      default:
        return "All";
    }
  };
  for (const r of rows) {
    const k = keyOf(r);
    const arr = map.get(k) ?? [];
    arr.push(r);
    map.set(k, arr);
  }
  return [...map.entries()]
    .map(([key, rs]) => ({ key, rows: rs }))
    .sort((a, b) => b.rows.length - a.rows.length || a.key.localeCompare(b.key));
}

// ── 8. Empty-state classification ─────────────────────────────────────────────

export type FoEmptyState =
  | "ok"
  | "no_open_trades"
  | "no_closed_trades"
  | "no_data";

/**
 * Classify the empty-state for a given section. Display-only — the caller decides
 * the copy. `section` selects which set matters.
 */
export function deriveFoEmptyState(
  section: "open" | "closed",
  rows: FoTradeRow[] | null | undefined,
): FoEmptyState {
  if (rows == null) return "no_data";
  if (rows.length > 0) return "ok";
  return section === "open" ? "no_open_trades" : "no_closed_trades";
}

// ── helpers for building filter option lists ─────────────────────────────────

const uniqueSorted = (
  rows: FoTradeRow[],
  pick: (r: FoTradeRow) => string | null | undefined,
): string[] => {
  const set = new Set<string>();
  for (const r of rows) {
    const v = (pick(r) ?? "").trim();
    if (v) set.add(v);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
};

export const uniqueIndexes = (rows: FoTradeRow[]): string[] =>
  uniqueSorted(rows, (r) => r.indexSymbol);
export const uniqueSetups = (rows: FoTradeRow[]): string[] => uniqueSorted(rows, (r) => r.setupKey);
export const uniqueExitReasons = (rows: FoTradeRow[]): string[] =>
  uniqueSorted(rows, (r) => r.exitReason);
