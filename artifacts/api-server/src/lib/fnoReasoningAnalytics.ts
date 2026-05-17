/**
 * F&O Reasoning Analytics (P15 — 2026-05-17).
 *
 * Pure, observational analytics layer on top of `fno_signal_reasoning`
 * rows (produced by P14 + P14b loggers). Read-only — does NOT touch
 * signal generation, gates, sizing, execution, Kite, scheduler,
 * scanner, swing, paper-equity, strategy builder, combo lane, option
 * snapshot ingestion, or candle warehouse ingestion.
 *
 * Two roles:
 *   1. `analyticsFiltersFromQuery` — extends the existing reasoning
 *      filter shape with P15-specific filters (`regime`, `optionType`,
 *      `latestN`) and validates each one.
 *   2. `computeReasoningAnalytics(rows)` — pure function that derives
 *      every histogram / breakdown requested in the P15 spec from a
 *      list of `FnoSignalReasoningRow`s. No I/O. No mutation.
 *
 * Determinism: every histogram is sorted (count desc, key asc) so the
 * JSON output is stable across calls — important for the UI cache key
 * and for snapshot tests.
 */

import { and, desc, eq, gte, isNotNull, lte } from "drizzle-orm";
import {
  fnoSignalReasoningTable,
  type FnoSignalReasoningRow,
  db,
} from "@workspace/db";

/* ─────────────────────────── Filters ──────────────────────────────── */

export interface AnalyticsFilters {
  indexSymbol?: string;
  setupKey?: string;
  direction?: string;
  optionType?: string;
  tier?: string;
  decision?: string;
  reasonCode?: string;
  regime?: string;
  from?: string;
  to?: string;
  /** Caps the row pull. Default 2000, max 10_000. */
  latestN: number;
  /**
   * P16: when true, restricts the result set to rows that carry a
   * `signal_fingerprint` (i.e. exact lifecycle linkage only). Default
   * false. Applied in `whereClause` as `signal_fingerprint IS NOT NULL`.
   */
  exactOnly?: boolean;
}

const DEFAULT_LATEST_N = 2000;
const MAX_LATEST_N = 10_000;

const isValidDate = (s: unknown): s is string => {
  if (typeof s !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  if (Number.isNaN(t)) return false;
  return new Date(t).toISOString().slice(0, 10) === s;
};

const pickStr = (raw: Record<string, unknown>, k: string, max: number): string | undefined => {
  const v = raw[k];
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (!t) return undefined;
  return t.length > max ? t.slice(0, max) : t;
};

/**
 * Validates and trims the public analytics filter shape.
 * Unknown keys are ignored. Bad values fall back to undefined / default.
 */
export function analyticsFiltersFromQuery(raw: Record<string, unknown>): AnalyticsFilters {
  let latestN = DEFAULT_LATEST_N;
  const rawN = raw.latestN ?? raw.limit;
  if (typeof rawN === "string" || typeof rawN === "number") {
    const n = Number(rawN);
    if (Number.isFinite(n) && n > 0) latestN = Math.min(Math.floor(n), MAX_LATEST_N);
  }
  return {
    indexSymbol: pickStr(raw, "index", 32) ?? pickStr(raw, "indexSymbol", 32),
    setupKey: pickStr(raw, "setup", 64) ?? pickStr(raw, "setupKey", 64),
    direction: pickStr(raw, "direction", 16) ?? pickStr(raw, "side", 16),
    optionType: pickStr(raw, "optionType", 4) ?? pickStr(raw, "option", 4),
    tier: pickStr(raw, "tier", 16),
    decision: pickStr(raw, "decision", 32) ?? pickStr(raw, "status", 32),
    reasonCode: pickStr(raw, "reason", 64) ?? pickStr(raw, "reasonCode", 64),
    regime: pickStr(raw, "regime", 24),
    from: isValidDate(raw.from) ? raw.from : undefined,
    to: isValidDate(raw.to) ? raw.to : undefined,
    latestN,
    exactOnly: raw.exactOnly === true || raw.exactOnly === "true" || raw.exactOnly === "1",
  };
}

function whereClause(f: AnalyticsFilters) {
  const conds = [] as ReturnType<typeof eq>[];
  if (f.indexSymbol) conds.push(eq(fnoSignalReasoningTable.indexSymbol, f.indexSymbol));
  if (f.setupKey) conds.push(eq(fnoSignalReasoningTable.setupKey, f.setupKey));
  if (f.direction) conds.push(eq(fnoSignalReasoningTable.direction, f.direction));
  if (f.optionType) conds.push(eq(fnoSignalReasoningTable.optionType, f.optionType));
  if (f.tier) conds.push(eq(fnoSignalReasoningTable.tier, f.tier));
  if (f.decision) conds.push(eq(fnoSignalReasoningTable.decision, f.decision));
  if (f.reasonCode) conds.push(eq(fnoSignalReasoningTable.reasonCode, f.reasonCode));
  if (f.regime) conds.push(eq(fnoSignalReasoningTable.regime, f.regime));
  if (f.from) conds.push(gte(fnoSignalReasoningTable.signalDate, f.from));
  if (f.to) conds.push(lte(fnoSignalReasoningTable.signalDate, f.to));
  // Cast keeps the array element type compatible with `eq()` returns above —
  // drizzle SQL operators are uniformly assignable at the call site.
  if (f.exactOnly) conds.push(isNotNull(fnoSignalReasoningTable.signalFingerprint) as ReturnType<typeof eq>);
  return conds.length === 0 ? undefined : and(...conds);
}

/** Fetches the `latestN` most-recent rows matching the filters. */
export async function fetchReasoningRows(f: AnalyticsFilters): Promise<FnoSignalReasoningRow[]> {
  const where = whereClause(f);
  const q = db
    .select()
    .from(fnoSignalReasoningTable)
    .orderBy(desc(fnoSignalReasoningTable.capturedAt))
    .limit(f.latestN);
  return where ? await q.where(where) : await q;
}

/* ───────────────────────── Analytics shape ────────────────────────── */

export interface SetupBreakdown {
  setupKey: string;
  total: number;
  emitted: number;            // decision = EMITTED (incl. demoted)
  preEmissionRejected: number;
  opened: number;             // decision = OPENED
  skipped: number;            // decision = SKIPPED
  stopped: number;            // decision = CLOSED_STOPPED
  target1: number;            // decision = CLOSED_TARGET1
  target2: number;            // decision = CLOSED_TARGET2
  expired: number;            // decision = CLOSED_EXPIRED
  forceExit: number;          // decision = CLOSED_FORCE_EXIT
  manualClose: number;        // decision = CLOSED_MANUAL
  demoted: number;            // reasonCode = DEMOTED  (subset of emitted)
  avgConfidence: number | null;
  avgConfluence: number | null;
}

export interface IndexBreakdown {
  indexSymbol: string;
  total: number;
  emitted: number;
  opened: number;
  stopped: number;
  targetHit: number;          // CLOSED_TARGET1 + CLOSED_TARGET2
  expired: number;
}

export interface TierBreakdown {
  tier: string;
  total: number;
  emitted: number;
  opened: number;
  stopped: number;
  target1: number;
  target2: number;
  expired: number;
  realizedPnl: number;        // sum of realized_pnl across CLOSED_* rows
}

export interface KeyCount { key: string; count: number }

export interface ReasoningAnalytics {
  generatedAt: string;
  rowCount: number;
  windowFrom: string | null;
  windowTo: string | null;

  // Setup, index, tier breakdowns
  bySetup: SetupBreakdown[];
  byIndex: IndexBreakdown[];
  byTier: TierBreakdown[];

  // High-level histograms
  byDecision: KeyCount[];
  byReasonCode: KeyCount[];
  byRegime: KeyCount[];
  byDirection: KeyCount[];
  byOptionType: KeyCount[];

  // Snapshot-derived histograms (P14b)
  byDemotionTag: KeyCount[];
  byMissingData: KeyCount[];

  // Stop-loss focus
  stoppedBySetup: KeyCount[];
  stoppedByIndex: KeyCount[];
  stoppedByConfidenceBucket: KeyCount[];
  stoppedByRegime: KeyCount[];

  // Target / expiry / pre-emission focus
  targetBySetup: Array<{ setupKey: string; t1: number; t2: number }>;
  expiredBySetup: KeyCount[];
  rejectedReasonBySetup: Array<{ setupKey: string; reasonCode: string; count: number }>;

  // T1→stop reversal — P15b adds EXACT lifecycle linkage via
  // `signal_fingerprint`; the old 4-tuple proxy is preserved as a
  // fallback for legacy rows that pre-date the fingerprint column.
  t1ThenStoppedGroups: number; // legacy alias = exact when available, else proxy
  t1ThenStopped: {
    /** Distinct fingerprints that have BOTH a CLOSED_TARGET1 and a CLOSED_STOPPED row. */
    exact: number;
    /** Distinct proxy groups (no fingerprint) with BOTH a CLOSED_TARGET1 and a CLOSED_STOPPED row. */
    proxy: number;
    /** "exact" if every row in scope has a fingerprint, "proxy" if none do, "hybrid" otherwise. */
    mode: "exact" | "proxy" | "hybrid";
    rowsWithFingerprint: number;
    rowsWithoutFingerprint: number;
    proxyMethod: string;
    limitation: string;
  };

  // Win-rate sample shortfall (LOW_WINRATE demotions are a direct proxy
  // for "new setup bypassing proof because sample size < MIN_SAMPLE=10")
  lowWinRateDemotions: number;

  /**
   * Row-sample hint so a setup `total` is not misread as unique-signal
   * count. Each `fno_signal_reasoning` row is a decision-event row; one
   * signal can produce many rows (EMITTED + OPENED + SKIPPED-per-gate +
   * CLOSED_*).
   */
  rowSampleType: "event_rows_not_unique_signals";
}

/* ────────────────────── Pure compute helpers ─────────────────────── */

function num(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function sortDesc(map: Map<string, number>): KeyCount[] {
  return Array.from(map, ([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function confidenceBucket(c: number): string {
  if (c < 55) return "<55";
  if (c < 60) return "55-59";
  if (c < 65) return "60-64";
  if (c < 70) return "65-69";
  if (c < 75) return "70-74";
  return "75+";
}

/**
 * Pure analytics — given a list of reasoning rows, derive every
 * histogram / breakdown the P15 spec asks for. No I/O. Stable order.
 */
export function computeReasoningAnalytics(rows: FnoSignalReasoningRow[]): ReasoningAnalytics {
  const generatedAt = new Date().toISOString();

  const proxyMethod = "group_by(signalDate,index,setup,direction,strike)";
  const proxyLimitation =
    "Fallback for legacy rows lacking signal_fingerprint (pre-P15b). " +
    "Groups by (date,index,setup,direction,strike); approximate, not " +
    "guaranteed trade-level linkage.";

  if (rows.length === 0) {
    return {
      generatedAt,
      rowCount: 0,
      windowFrom: null,
      windowTo: null,
      bySetup: [], byIndex: [], byTier: [],
      byDecision: [], byReasonCode: [], byRegime: [],
      byDirection: [], byOptionType: [],
      byDemotionTag: [], byMissingData: [],
      stoppedBySetup: [], stoppedByIndex: [],
      stoppedByConfidenceBucket: [], stoppedByRegime: [],
      targetBySetup: [], expiredBySetup: [], rejectedReasonBySetup: [],
      t1ThenStoppedGroups: 0,
      t1ThenStopped: {
        exact: 0, proxy: 0, mode: "exact",
        rowsWithFingerprint: 0, rowsWithoutFingerprint: 0,
        proxyMethod, limitation: proxyLimitation,
      },
      lowWinRateDemotions: 0,
      rowSampleType: "event_rows_not_unique_signals",
    };
  }

  // window
  let windowFrom: string | null = null;
  let windowTo: string | null = null;
  for (const r of rows) {
    const d = r.signalDate;
    if (!d) continue;
    if (windowFrom === null || d < windowFrom) windowFrom = d;
    if (windowTo === null || d > windowTo) windowTo = d;
  }

  // ── per-setup ─────────────────────────────────────────────────────
  const setupAcc = new Map<string, SetupBreakdown & { _confSum: number; _confN: number; _cluxSum: number; _cluxN: number }>();
  const getSetup = (k: string) => {
    let s = setupAcc.get(k);
    if (!s) {
      s = {
        setupKey: k,
        total: 0, emitted: 0, preEmissionRejected: 0, opened: 0, skipped: 0,
        stopped: 0, target1: 0, target2: 0, expired: 0, forceExit: 0, manualClose: 0,
        demoted: 0, avgConfidence: null, avgConfluence: null,
        _confSum: 0, _confN: 0, _cluxSum: 0, _cluxN: 0,
      };
      setupAcc.set(k, s);
    }
    return s;
  };

  // ── per-index ─────────────────────────────────────────────────────
  const indexAcc = new Map<string, IndexBreakdown>();
  const getIndex = (k: string) => {
    let i = indexAcc.get(k);
    if (!i) {
      i = { indexSymbol: k, total: 0, emitted: 0, opened: 0, stopped: 0, targetHit: 0, expired: 0 };
      indexAcc.set(k, i);
    }
    return i;
  };

  // ── per-tier ──────────────────────────────────────────────────────
  const tierAcc = new Map<string, TierBreakdown>();
  const getTier = (k: string) => {
    let t = tierAcc.get(k);
    if (!t) {
      t = {
        tier: k, total: 0, emitted: 0, opened: 0, stopped: 0,
        target1: 0, target2: 0, expired: 0, realizedPnl: 0,
      };
      tierAcc.set(k, t);
    }
    return t;
  };

  // ── high-level histograms ─────────────────────────────────────────
  const byDecision = new Map<string, number>();
  const byReasonCode = new Map<string, number>();
  const byRegime = new Map<string, number>();
  const byDirection = new Map<string, number>();
  const byOptionType = new Map<string, number>();
  const byDemotionTag = new Map<string, number>();
  const byMissingData = new Map<string, number>();
  const stoppedBySetup = new Map<string, number>();
  const stoppedByIndex = new Map<string, number>();
  const stoppedByConfidenceBucket = new Map<string, number>();
  const stoppedByRegime = new Map<string, number>();
  const targetBySetup = new Map<string, { t1: number; t2: number }>();
  const expiredBySetup = new Map<string, number>();
  const rejectedReasonBySetup = new Map<string, number>(); // key = `${setup}::${reason}`

  // T1→stop reversal grouping — P15b uses signal_fingerprint when present
  // for EXACT lifecycle linkage; falls back to proxy 4-tuple for legacy rows.
  //
  // Why the 6-tuple key is safe for same-day collisions: the paper-trade
  // FO writer is gated by `paper_trade_fo_signal_uq UNIQUE(signal_date,
  // index_symbol, setup_key, direction)`, so a second OPENED row on the
  // same (date, index, setup, direction) is structurally impossible.
  // Adding optionType + strike to that tuple cannot weaken uniqueness.
  // The only residual collapse would be a same-day re-emission with
  // identical leg + strike, which the upstream HC emission floor +
  // missed-signal dedup ring also prevent in practice.
  //
  // `mode` is intentionally derived from the subset of rows that
  // PARTICIPATE in the T1→stop reversal computation
  // (CLOSED_TARGET1 / CLOSED_STOPPED only) so the badge reflects what
  // the displayed number actually used (architect note 2026-05-17).
  const proxyKeyOf = (r: FnoSignalReasoningRow): string =>
    `${r.signalDate}|${r.indexSymbol}|${r.setupKey ?? ""}|${r.direction ?? ""}|${r.selectedStrike ?? ""}`;
  const fpRow = (r: FnoSignalReasoningRow): string | null =>
    typeof r.signalFingerprint === "string" && r.signalFingerprint.length > 0 ? r.signalFingerprint : null;
  const t1Fingerprints = new Set<string>();
  const stopFingerprints = new Set<string>();
  const t1ProxyGroups = new Set<string>();
  const stopProxyGroups = new Set<string>();
  // Total-row fingerprint coverage (informational; surfaces dataset-wide
  // adoption of the column).
  let rowsWithFingerprint = 0;
  let rowsWithoutFingerprint = 0;
  // Lifecycle-only fingerprint coverage drives the `mode` flag below.
  let lifecycleRowsWithFingerprint = 0;
  let lifecycleRowsWithoutFingerprint = 0;

  let lowWinRateDemotions = 0;

  for (const r of rows) {
    const setupKey = r.setupKey ?? "UNKNOWN";
    const indexSymbol = r.indexSymbol ?? "UNKNOWN";
    const tier = r.tier ?? "UNKNOWN";
    const decision = r.decision ?? "UNKNOWN";
    const reasonCode = r.reasonCode ?? "UNKNOWN";

    const s = getSetup(setupKey);
    const i = getIndex(indexSymbol);
    const t = getTier(tier);

    s.total += 1;
    i.total += 1;
    t.total += 1;

    if (fpRow(r) != null) rowsWithFingerprint += 1;
    else rowsWithoutFingerprint += 1;

    bump(byDecision, decision);
    bump(byReasonCode, reasonCode);
    if (r.regime) bump(byRegime, r.regime);
    if (r.direction) bump(byDirection, r.direction);
    if (r.optionType) bump(byOptionType, r.optionType);

    // average confidence / confluence (every row that carries them)
    if (typeof r.confidence === "number") { s._confSum += r.confidence; s._confN += 1; }
    const cflux = num(r.confluenceScore);
    if (cflux != null) { s._cluxSum += cflux; s._cluxN += 1; }

    switch (decision) {
      case "EMITTED":
        s.emitted += 1; i.emitted += 1; t.emitted += 1;
        if (reasonCode === "DEMOTED") s.demoted += 1;
        break;
      case "PRE_EMISSION_REJECTED":
        s.preEmissionRejected += 1;
        bumpKey(rejectedReasonBySetup, `${setupKey}::${reasonCode}`);
        break;
      case "OPENED":
        s.opened += 1; i.opened += 1; t.opened += 1;
        break;
      case "SKIPPED":
        s.skipped += 1;
        break;
      case "CLOSED_STOPPED": {
        s.stopped += 1; t.stopped += 1; i.stopped += 1;
        bump(stoppedBySetup, setupKey);
        bump(stoppedByIndex, indexSymbol);
        if (typeof r.confidence === "number") bump(stoppedByConfidenceBucket, confidenceBucket(r.confidence));
        if (r.regime) bump(stoppedByRegime, r.regime);
        const pnl = num(r.realizedPnl); if (pnl != null) t.realizedPnl += pnl;
        const fpS = fpRow(r);
        if (fpS != null) { stopFingerprints.add(fpS); lifecycleRowsWithFingerprint += 1; }
        else { stopProxyGroups.add(proxyKeyOf(r)); lifecycleRowsWithoutFingerprint += 1; }
        break;
      }
      case "CLOSED_TARGET1": {
        s.target1 += 1; t.target1 += 1; i.targetHit += 1;
        const tb = targetBySetup.get(setupKey) ?? { t1: 0, t2: 0 };
        tb.t1 += 1; targetBySetup.set(setupKey, tb);
        const pnl = num(r.realizedPnl); if (pnl != null) t.realizedPnl += pnl;
        const fp1 = fpRow(r);
        if (fp1 != null) { t1Fingerprints.add(fp1); lifecycleRowsWithFingerprint += 1; }
        else { t1ProxyGroups.add(proxyKeyOf(r)); lifecycleRowsWithoutFingerprint += 1; }
        break;
      }
      case "CLOSED_TARGET2": {
        s.target2 += 1; t.target2 += 1; i.targetHit += 1;
        const tb = targetBySetup.get(setupKey) ?? { t1: 0, t2: 0 };
        tb.t2 += 1; targetBySetup.set(setupKey, tb);
        const pnl = num(r.realizedPnl); if (pnl != null) t.realizedPnl += pnl;
        break;
      }
      case "CLOSED_EXPIRED":
        s.expired += 1; t.expired += 1; i.expired += 1;
        bump(expiredBySetup, setupKey);
        { const pnl = num(r.realizedPnl); if (pnl != null) t.realizedPnl += pnl; }
        break;
      case "CLOSED_FORCE_EXIT":
        s.forceExit += 1;
        { const pnl = num(r.realizedPnl); if (pnl != null) t.realizedPnl += pnl; }
        break;
      case "CLOSED_MANUAL":
        s.manualClose += 1;
        { const pnl = num(r.realizedPnl); if (pnl != null) t.realizedPnl += pnl; }
        break;
      default:
        // unknown / future decision — counted only in byDecision
        break;
    }

    // Snapshot-derived: demotionTags + missing[]
    const snap = r.snapshot as Record<string, unknown> | null;
    if (snap && typeof snap === "object") {
      const dt = snap.demotionTags;
      if (Array.isArray(dt)) {
        for (const tag of dt) {
          if (typeof tag !== "string") continue;
          bump(byDemotionTag, tag);
          if (tag === "LOW_WINRATE") lowWinRateDemotions += 1;
        }
      }
      const miss = snap.missing;
      if (Array.isArray(miss)) {
        for (const m of miss) {
          if (typeof m === "string") bump(byMissingData, m);
        }
      }
    }
  }

  // finalise setup averages
  const bySetup: SetupBreakdown[] = Array.from(setupAcc.values()).map(s => {
    const { _confSum, _confN, _cluxSum, _cluxN, ...rest } = s;
    return {
      ...rest,
      avgConfidence: _confN > 0 ? round2(_confSum / _confN) : null,
      avgConfluence: _cluxN > 0 ? round2(_cluxSum / _cluxN) : null,
    };
  }).sort((a, b) => b.total - a.total || a.setupKey.localeCompare(b.setupKey));

  const byIndex = Array.from(indexAcc.values())
    .sort((a, b) => b.total - a.total || a.indexSymbol.localeCompare(b.indexSymbol));

  const byTier = Array.from(tierAcc.values())
    .map(t => ({ ...t, realizedPnl: round2(t.realizedPnl) }))
    .sort((a, b) => b.total - a.total || a.tier.localeCompare(b.tier));

  // T1→stop reversal — exact (fingerprint) + proxy (legacy 4-tuple)
  let t1ThenStoppedExact = 0;
  for (const fp of t1Fingerprints) if (stopFingerprints.has(fp)) t1ThenStoppedExact += 1;
  let t1ThenStoppedProxy = 0;
  for (const g of t1ProxyGroups) if (stopProxyGroups.has(g)) t1ThenStoppedProxy += 1;
  const t1ThenStoppedGroups = t1ThenStoppedExact + t1ThenStoppedProxy;
  // Mode reflects the rows that actually participate in the T1→stop
  // calculation. When there are no lifecycle rows yet the dataset is
  // trivially "exact" (no proxy fallback was needed).
  const fpMode: "exact" | "proxy" | "hybrid" =
    lifecycleRowsWithFingerprint === 0 && lifecycleRowsWithoutFingerprint === 0 ? "exact"
    : lifecycleRowsWithoutFingerprint === 0 ? "exact"
    : lifecycleRowsWithFingerprint === 0 ? "proxy"
    : "hybrid";

  // explode rejectedReasonBySetup
  const rejectedReasonList: Array<{ setupKey: string; reasonCode: string; count: number }> = [];
  for (const [k, count] of rejectedReasonBySetup) {
    const [setup, reason] = k.split("::");
    rejectedReasonList.push({ setupKey: setup ?? "UNKNOWN", reasonCode: reason ?? "UNKNOWN", count });
  }
  rejectedReasonList.sort((a, b) => b.count - a.count
    || a.setupKey.localeCompare(b.setupKey)
    || a.reasonCode.localeCompare(b.reasonCode));

  return {
    generatedAt,
    rowCount: rows.length,
    windowFrom,
    windowTo,
    bySetup,
    byIndex,
    byTier,
    byDecision: sortDesc(byDecision),
    byReasonCode: sortDesc(byReasonCode),
    byRegime: sortDesc(byRegime),
    byDirection: sortDesc(byDirection),
    byOptionType: sortDesc(byOptionType),
    byDemotionTag: sortDesc(byDemotionTag),
    byMissingData: sortDesc(byMissingData),
    stoppedBySetup: sortDesc(stoppedBySetup),
    stoppedByIndex: sortDesc(stoppedByIndex),
    stoppedByConfidenceBucket: sortDesc(stoppedByConfidenceBucket),
    stoppedByRegime: sortDesc(stoppedByRegime),
    targetBySetup: Array.from(targetBySetup, ([setupKey, v]) => ({ setupKey, ...v }))
      .sort((a, b) => (b.t1 + b.t2) - (a.t1 + a.t2) || a.setupKey.localeCompare(b.setupKey)),
    expiredBySetup: sortDesc(expiredBySetup),
    rejectedReasonBySetup: rejectedReasonList,
    t1ThenStoppedGroups,
    t1ThenStopped: {
      exact: t1ThenStoppedExact,
      proxy: t1ThenStoppedProxy,
      mode: fpMode,
      rowsWithFingerprint,
      rowsWithoutFingerprint,
      proxyMethod,
      limitation: proxyLimitation,
    },
    lowWinRateDemotions,
    rowSampleType: "event_rows_not_unique_signals",
  };
}

function bump(m: Map<string, number>, k: string): void {
  m.set(k, (m.get(k) ?? 0) + 1);
}
function bumpKey(m: Map<string, number>, k: string): void {
  m.set(k, (m.get(k) ?? 0) + 1);
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
