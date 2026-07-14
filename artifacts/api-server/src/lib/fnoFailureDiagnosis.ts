/**
 * P16 — F&O Failure Diagnosis Report (2026-05-17).
 *
 * Pure, observational reporting layer over `fno_signal_reasoning` rows
 * (produced by P14 + P14b loggers; correlated by P15b
 * `signal_fingerprint`). Read-only. Does NOT touch:
 *   - F&O signal generation / gates / sizing / execution
 *   - stop-loss / target / setup definitions / confluence scoring
 *   - paper-trade execution / Kite order paths
 *   - swing scanner / paper-equity / scanner recommendations
 *   - strategy builder / combo lane
 *   - option-chain snapshot ingestion / candle warehouse ingestion
 *   - scheduler / Kite session lifecycle
 *
 * Produces a structured `FailureDiagnosisReport` with eight sections
 * (A–H) and a ranked hypothesis list (H1–H10). Every conclusion carries
 * a sample size; every claim has a status ∈ {proven, likely,
 * insufficient_data, undetermined}.
 *
 * Determinism: every list is sorted (count desc, key asc) so output is
 * stable for snapshot tests and UI cache keys.
 */

import type { FnoSignalReasoningRow } from "@workspace/db";

/* ───────────────────────── Public report shape ───────────────────── */

export interface FailureDiagnosisFiltersEcho {
  exactOnly: boolean;
  windowFrom: string | null;
  windowTo: string | null;
}

export interface SetupFailureRow {
  setupKey: string;
  total: number;
  emitted: number;
  preEmissionRejected: number;
  opened: number;
  skipped: number;        // SKIPPED + MISSED_WINDOW (untriggered / capacity)
  stopped: number;
  target1: number;
  target2: number;
  expired: number;
  demoted: number;        // EMITTED rows with reasonCode=DEMOTED
  /** stopped / opened — null when opened == 0. */
  stopRate: number | null;
  /** (target1 + target2) / opened — null when opened == 0. */
  targetHitRate: number | null;
}

export interface IndexFailureRow {
  indexSymbol: string;
  total: number;
  emitted: number;
  opened: number;
  stopped: number;
  targetHit: number;     // T1 + T2
  expired: number;
  realizedPnl: number;   // Σ realized_pnl over CLOSED_* rows
  /** stopped / opened — null when opened == 0. */
  stopRate: number | null;
  /** targetHit / opened — null when opened == 0. */
  targetHitRate: number | null;
}

export interface TierFailureRow {
  tier: string;
  total: number;
  emitted: number;
  opened: number;
  stopped: number;
  target1: number;
  target2: number;
  expired: number;
  realizedPnl: number;
  stopRate: number | null;
  targetHitRate: number | null;
}

export type LifecycleMode = "exact" | "proxy" | "hybrid";

export interface LifecycleFunnel {
  mode: LifecycleMode;
  rowsWithFingerprint: number;
  rowsWithoutFingerprint: number;
  emitted: number;
  opened: number;
  target1: number;
  target2: number;
  stopped: number;
  expired: number;
  forceExit1520: number;
  manualClose: number;
  preEmissionRejected: number;
  demoted: number;        // EMITTED+reasonCode=DEMOTED (already counted in emitted)
  /** EMITTED fingerprints never seen in OPENED (only available in exact/hybrid). */
  emittedNeverOpenedExact: number;
  /** OPENED fingerprints never seen in any CLOSED_* (exact subset). */
  openedNoExitExact: number;
  /** OPENED fingerprints that later hit CLOSED_TARGET1 (exact). */
  openedToTarget1Exact: number;
  /** OPENED fingerprints that later hit CLOSED_STOPPED (exact). */
  openedToStoppedExact: number;
  /** Fingerprints with BOTH CLOSED_TARGET1 and CLOSED_STOPPED (exact). */
  target1ThenStoppedExact: number;
  /** Fingerprints with CLOSED_TARGET1 → CLOSED_TARGET2 (exact). */
  target1ToTarget2Exact: number;
  conversion: {
    emittedToOpened: number | null;
    openedToTarget1: number | null;
    openedToStopped: number | null;
    target1ToTarget2: number | null;
    target1ToStopped: number | null;
  };
}

export interface KeyCount { key: string; count: number }

export interface StopLossDeepDive {
  totalStops: number;
  bySetup: KeyCount[];
  byIndex: KeyCount[];
  byConfidenceBucket: KeyCount[];
  byRegime: KeyCount[];
  /** Fingerprinted stops that occurred after a CLOSED_TARGET1 for the same trade. */
  afterT1Stops: number;
  afterT1Mode: LifecycleMode;
  concentration: {
    topSetup: { key: string; share: number } | null;
    topIndex: { key: string; share: number } | null;
    topRegime: { key: string; share: number } | null;
  };
}

export interface UntriggeredAnalysis {
  expired: number;
  /** EMITTED fingerprints never seen in OPENED (requires fingerprint). */
  emittedNeverOpenedExact: number;
  /** Decisions = SKIPPED + MISSED_WINDOW, with reason code histogram. */
  skipped: number;
  bySkipReason: KeyCount[];
  expiredBySetup: KeyCount[];
  /** EMITTED rows captured at IST hour ≥ 14 (late session). */
  lateSessionEmissions: number;
  /** lateSessionEmissions / total EMITTED — null when total emitted == 0. */
  lateSessionShare: number | null;
}

export interface MissingDataAnalysis {
  byMissingField: KeyCount[];
  byDemotionTag: KeyCount[];
  /** EMITTED+demoted fingerprints that subsequently appear in OPENED. */
  demotedThenOpenedExact: number;
  /** Subset of demotedThenOpenedExact that later appear in CLOSED_STOPPED. */
  demotedThenOpenedAndStoppedExact: number;
  /** Count of EMITTED rows whose `demotionTags` includes LOW_WINRATE. */
  lowWinRateDemotions: number;
  /** Per-missing-field stop-rate correlation (EXACT — fingerprint required). */
  missingFieldStopCorrelation: Array<{
    field: string;
    emittedSample: number;
    openedSample: number;
    stopped: number;
    stopRate: number | null;
  }>;
}

export type HypothesisStatus = "proven" | "likely" | "insufficient_data" | "undetermined";

export interface HypothesisFinding {
  id:
    | "H1" | "H2" | "H3" | "H4" | "H5"
    | "H6" | "H7" | "H8" | "H9" | "H10";
  label: string;
  status: HypothesisStatus;
  sampleSize: number;
  evidence: string;
  /** Optional structured pointers (counts, ratios) the UI can render. */
  metrics?: Record<string, number | string | null>;
}

export interface RecommendedNextStep {
  priority: number;
  label: string;
  rationale: string;
  /** Sample size of rows backing the recommendation. */
  sampleBacking: number;
}

export interface FailureDiagnosisReport {
  generatedAt: string;
  rowCount: number;
  windowFrom: string | null;
  windowTo: string | null;
  filters: FailureDiagnosisFiltersEcho;

  setupAnalysis: SetupFailureRow[];
  setupSuperlatives: {
    mostSignals: string | null;
    mostOpened: string | null;
    mostStopped: string | null;
    mostT1: string | null;
    mostT2: string | null;
    mostExpired: string | null;
    mostUntriggered: string | null;
    mostPreEmissionRejected: string | null;
    mostDemoted: string | null;
  };

  indexAnalysis: IndexFailureRow[];
  indexSuperlatives: {
    worstByRealizedPnl: string | null;
    mostStops: string | null;
    mostUntriggered: string | null;
    bestTargetHitRatio: string | null;
  };

  tierAnalysis: TierFailureRow[];
  tierVerdict: {
    mostStops: string | null;
    bestTargetHitRatio: string | null;
    hcOutperformsBaseline: boolean | null;
    hcStopRate: number | null;
    baselineStopRate: number | null;
    hcSampleSize: number;
    baselineSampleSize: number;
  };

  lifecycleFunnel: LifecycleFunnel;
  stopLossDeepDive: StopLossDeepDive;
  untriggeredAnalysis: UntriggeredAnalysis;
  missingDataAnalysis: MissingDataAnalysis;

  hypotheses: HypothesisFinding[];
  recommendedNextSteps: RecommendedNextStep[];
  notes: string[];
}

/* ──────────────────── Helpers (pure, no I/O) ────────────────────── */

function safeRatio(num: number, den: number): number | null {
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return null;
  return Math.round((num / den) * 10_000) / 10_000;
}

function bump(m: Map<string, number>, k: string, by = 1): void {
  m.set(k, (m.get(k) ?? 0) + by);
}

function keyCountsFromMap(m: Map<string, number>): KeyCount[] {
  return Array.from(m.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function topKey(m: Map<string, number>): string | null {
  let best: { k: string; v: number } | null = null;
  for (const [k, v] of m) {
    if (best == null || v > best.v || (v === best.v && k < best.k)) best = { k, v };
  }
  return best?.k ?? null;
}

function topShare(list: KeyCount[], total: number): { key: string; share: number } | null {
  if (list.length === 0 || total <= 0) return null;
  const top = list[0]!;
  return { key: top.key, share: Math.round((top.count / total) * 10_000) / 10_000 };
}

function numFromDecimal(v: string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fpOf(r: FnoSignalReasoningRow): string | null {
  return typeof r.signalFingerprint === "string" && r.signalFingerprint.length > 0
    ? r.signalFingerprint
    : null;
}

function confidenceBucket(c: number | null | undefined): string {
  if (c == null || !Number.isFinite(c)) return "unknown";
  if (c < 55) return "<55";
  if (c < 60) return "55-59";
  if (c < 65) return "60-64";
  if (c < 70) return "65-69";
  if (c < 75) return "70-74";
  if (c < 80) return "75-79";
  return "80+";
}

/** IST hour of capture (UTC+5:30). */
function istHourOf(d: Date | null | undefined): number | null {
  if (d == null) return null;
  const t = d.getTime();
  if (!Number.isFinite(t)) return null;
  const ist = new Date(t + 5.5 * 3600 * 1000);
  return ist.getUTCHours();
}

interface SnapshotShape {
  missing?: unknown;
  demotionTags?: unknown;
  tags?: unknown;
}

function snapshotOf(r: FnoSignalReasoningRow): SnapshotShape {
  const s = r.snapshot;
  if (s == null || typeof s !== "object") return {};
  return s as SnapshotShape;
}

function readStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) if (typeof x === "string" && x.length > 0) out.push(x);
  return out;
}

/* ─────────────────────── Main report builder ─────────────────────── */

export function computeFailureDiagnosis(
  rowsIn: FnoSignalReasoningRow[],
  opts: { exactOnly?: boolean } = {},
): FailureDiagnosisReport {
  const generatedAt = new Date().toISOString();
  const exactOnly = opts.exactOnly === true;
  const rows = exactOnly ? rowsIn.filter(r => fpOf(r) != null) : rowsIn;

  // ── window
  let windowFrom: string | null = null;
  let windowTo: string | null = null;
  for (const r of rows) {
    const d = r.signalDate;
    if (d == null) continue;
    if (windowFrom == null || d < windowFrom) windowFrom = d;
    if (windowTo == null || d > windowTo) windowTo = d;
  }

  // ── accumulators
  const setupMap = new Map<string, SetupFailureRow>();
  const indexMap = new Map<string, IndexFailureRow>();
  const tierMap = new Map<string, TierFailureRow>();
  const stopsBySetup = new Map<string, number>();
  const stopsByIndex = new Map<string, number>();
  const stopsByConfBucket = new Map<string, number>();
  const stopsByRegime = new Map<string, number>();
  const skipReasonHist = new Map<string, number>();
  const expiredBySetup = new Map<string, number>();
  const demotionTagHist = new Map<string, number>();
  const missingFieldHist = new Map<string, number>();

  // Fingerprint-keyed lifecycle sets
  const fpEmitted = new Set<string>();
  const fpOpened = new Set<string>();
  const fpTarget1 = new Set<string>();
  const fpTarget2 = new Set<string>();
  const fpStopped = new Set<string>();
  const fpExpired = new Set<string>();
  const fpDemoted = new Set<string>();
  const fpAnyClose = new Set<string>();
  // For missing-field correlation: track which emitted fingerprints carried each missing field.
  const emittedFpByMissingField = new Map<string, Set<string>>();

  // Counters for the funnel mode + lifecycle row coverage
  let lifecycleRowsWithFp = 0;
  let lifecycleRowsWithoutFp = 0;
  let rowsWithFp = 0;
  let rowsWithoutFp = 0;

  // Totals by decision (used both for funnel + skip section)
  let nEmitted = 0;
  let nOpened = 0;
  let nT1 = 0;
  let nT2 = 0;
  let nStopped = 0;
  let nExpired = 0;
  let nForceExit = 0;
  let nManual = 0;
  let nSkipped = 0;
  let nPreRejected = 0;
  let nDemoted = 0;
  let lateSessionEmissions = 0;
  let lowWinRateDemotions = 0;

  const getSetup = (key: string): SetupFailureRow => {
    let s = setupMap.get(key);
    if (s == null) {
      s = {
        setupKey: key, total: 0, emitted: 0, preEmissionRejected: 0, opened: 0,
        skipped: 0, stopped: 0, target1: 0, target2: 0, expired: 0, demoted: 0,
        stopRate: null, targetHitRate: null,
      };
      setupMap.set(key, s);
    }
    return s;
  };
  const getIndex = (key: string): IndexFailureRow => {
    let s = indexMap.get(key);
    if (s == null) {
      s = {
        indexSymbol: key, total: 0, emitted: 0, opened: 0, stopped: 0,
        targetHit: 0, expired: 0, realizedPnl: 0, stopRate: null, targetHitRate: null,
      };
      indexMap.set(key, s);
    }
    return s;
  };
  const getTier = (key: string): TierFailureRow => {
    let s = tierMap.get(key);
    if (s == null) {
      s = {
        tier: key, total: 0, emitted: 0, opened: 0, stopped: 0,
        target1: 0, target2: 0, expired: 0, realizedPnl: 0,
        stopRate: null, targetHitRate: null,
      };
      tierMap.set(key, s);
    }
    return s;
  };

  for (const r of rows) {
    const fp = fpOf(r);
    if (fp != null) rowsWithFp += 1; else rowsWithoutFp += 1;

    const setupKey = r.setupKey ?? "UNKNOWN";
    const indexSymbol = r.indexSymbol ?? "UNKNOWN";
    const tier = r.tier ?? "UNKNOWN";
    const decision = r.decision ?? "UNKNOWN";
    const reasonCode = r.reasonCode ?? "UNKNOWN";

    const sa = getSetup(setupKey);
    const ia = getIndex(indexSymbol);
    const ta = getTier(tier);
    sa.total += 1; ia.total += 1; ta.total += 1;

    switch (decision) {
      case "EMITTED": {
        sa.emitted += 1; ia.emitted += 1; ta.emitted += 1;
        nEmitted += 1;
        if (fp != null) fpEmitted.add(fp);
        if (reasonCode === "DEMOTED") {
          sa.demoted += 1; nDemoted += 1;
          if (fp != null) fpDemoted.add(fp);
        }
        const h = istHourOf(r.capturedAt);
        if (h != null && h >= 14) lateSessionEmissions += 1;
        // demotion tags + missing fields live in snapshot
        const snap = snapshotOf(r);
        const dtags = readStringArray(snap.demotionTags);
        for (const t of dtags) {
          bump(demotionTagHist, t);
          if (t === "LOW_WINRATE") lowWinRateDemotions += 1;
        }
        const miss = readStringArray(snap.missing);
        for (const m of miss) {
          bump(missingFieldHist, m);
          if (fp != null) {
            let set = emittedFpByMissingField.get(m);
            if (set == null) { set = new Set<string>(); emittedFpByMissingField.set(m, set); }
            set.add(fp);
          }
        }
        break;
      }
      case "PRE_EMISSION_REJECTED": {
        sa.preEmissionRejected += 1;
        nPreRejected += 1;
        break;
      }
      case "OPENED": {
        sa.opened += 1; ia.opened += 1; ta.opened += 1;
        nOpened += 1;
        if (fp != null) { fpOpened.add(fp); lifecycleRowsWithFp += 1; }
        else lifecycleRowsWithoutFp += 1;
        break;
      }
      case "SKIPPED":
      case "MISSED_WINDOW": {
        sa.skipped += 1;
        nSkipped += 1;
        bump(skipReasonHist, reasonCode);
        break;
      }
      case "CLOSED_STOPPED": {
        sa.stopped += 1; ia.stopped += 1; ta.stopped += 1;
        nStopped += 1;
        bump(stopsBySetup, setupKey);
        bump(stopsByIndex, indexSymbol);
        if (r.regime) bump(stopsByRegime, r.regime);
        bump(stopsByConfBucket, confidenceBucket(r.confidence));
        const pnl = numFromDecimal(r.realizedPnl); if (pnl != null) { ia.realizedPnl += pnl; ta.realizedPnl += pnl; }
        if (fp != null) { fpStopped.add(fp); fpAnyClose.add(fp); lifecycleRowsWithFp += 1; }
        else lifecycleRowsWithoutFp += 1;
        break;
      }
      case "CLOSED_TARGET1": {
        sa.target1 += 1; ta.target1 += 1; ia.targetHit += 1;
        nT1 += 1;
        const pnl = numFromDecimal(r.realizedPnl); if (pnl != null) { ia.realizedPnl += pnl; ta.realizedPnl += pnl; }
        if (fp != null) { fpTarget1.add(fp); fpAnyClose.add(fp); lifecycleRowsWithFp += 1; }
        else lifecycleRowsWithoutFp += 1;
        break;
      }
      case "CLOSED_TARGET2": {
        sa.target2 += 1; ta.target2 += 1; ia.targetHit += 1;
        nT2 += 1;
        const pnl = numFromDecimal(r.realizedPnl); if (pnl != null) { ia.realizedPnl += pnl; ta.realizedPnl += pnl; }
        if (fp != null) { fpTarget2.add(fp); fpAnyClose.add(fp); lifecycleRowsWithFp += 1; }
        else lifecycleRowsWithoutFp += 1;
        break;
      }
      case "CLOSED_EXPIRED": {
        sa.expired += 1; ia.expired += 1; ta.expired += 1;
        nExpired += 1;
        bump(expiredBySetup, setupKey);
        const pnl = numFromDecimal(r.realizedPnl); if (pnl != null) { ia.realizedPnl += pnl; ta.realizedPnl += pnl; }
        if (fp != null) { fpExpired.add(fp); fpAnyClose.add(fp); }
        break;
      }
      case "CLOSED_TIME_EXIT_1520": {
        nForceExit += 1;
        const pnl = numFromDecimal(r.realizedPnl); if (pnl != null) { ia.realizedPnl += pnl; ta.realizedPnl += pnl; }
        if (fp != null) fpAnyClose.add(fp);
        break;
      }
      case "CLOSED_MANUAL": {
        nManual += 1;
        const pnl = numFromDecimal(r.realizedPnl); if (pnl != null) { ia.realizedPnl += pnl; ta.realizedPnl += pnl; }
        if (fp != null) fpAnyClose.add(fp);
        break;
      }
      default:
        // unknown decision — counted in totals already; do not split.
        break;
    }
  }

  // ── finalise per-row ratios
  for (const s of setupMap.values()) {
    s.stopRate = safeRatio(s.stopped, s.opened);
    s.targetHitRate = safeRatio(s.target1 + s.target2, s.opened);
  }
  for (const i of indexMap.values()) {
    i.stopRate = safeRatio(i.stopped, i.opened);
    i.targetHitRate = safeRatio(i.targetHit, i.opened);
    i.realizedPnl = Math.round(i.realizedPnl * 100) / 100;
  }
  for (const t of tierMap.values()) {
    t.stopRate = safeRatio(t.stopped, t.opened);
    t.targetHitRate = safeRatio(t.target1 + t.target2, t.opened);
    t.realizedPnl = Math.round(t.realizedPnl * 100) / 100;
  }

  const setupAnalysis = Array.from(setupMap.values())
    .sort((a, b) => b.total - a.total || a.setupKey.localeCompare(b.setupKey));
  const indexAnalysis = Array.from(indexMap.values())
    .sort((a, b) => b.total - a.total || a.indexSymbol.localeCompare(b.indexSymbol));
  const tierAnalysis = Array.from(tierMap.values())
    .sort((a, b) => b.total - a.total || a.tier.localeCompare(b.tier));

  // ── superlatives
  const mapBy = <T>(
    rows: T[], key: keyof T, value: keyof T,
  ): Map<string, number> => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = r[key];
      const v = r[value];
      if (typeof k === "string" && typeof v === "number") m.set(k, v);
    }
    return m;
  };

  const setupSuperlatives = {
    mostSignals: topKey(mapBy(setupAnalysis, "setupKey", "emitted")),
    mostOpened: topKey(mapBy(setupAnalysis, "setupKey", "opened")),
    mostStopped: topKey(mapBy(setupAnalysis, "setupKey", "stopped")),
    mostT1: topKey(mapBy(setupAnalysis, "setupKey", "target1")),
    mostT2: topKey(mapBy(setupAnalysis, "setupKey", "target2")),
    mostExpired: topKey(mapBy(setupAnalysis, "setupKey", "expired")),
    mostUntriggered: topKey(mapBy(setupAnalysis, "setupKey", "skipped")),
    mostPreEmissionRejected: topKey(mapBy(setupAnalysis, "setupKey", "preEmissionRejected")),
    mostDemoted: topKey(mapBy(setupAnalysis, "setupKey", "demoted")),
  };

  // Best target-hit ratio: only consider indices/setups with ≥ 5 OPENED
  // so the ratio is meaningful.
  const indexHitRateMap = new Map<string, number>();
  for (const i of indexAnalysis) {
    if (i.opened >= 5 && i.targetHitRate != null) indexHitRateMap.set(i.indexSymbol, i.targetHitRate);
  }
  const indexWorstPnl = (() => {
    let worst: { k: string; v: number } | null = null;
    for (const i of indexAnalysis) {
      if (worst == null || i.realizedPnl < worst.v) worst = { k: i.indexSymbol, v: i.realizedPnl };
    }
    return worst?.k ?? null;
  })();
  const indexSuperlatives = {
    worstByRealizedPnl: indexWorstPnl,
    mostStops: topKey(mapBy(indexAnalysis, "indexSymbol", "stopped")),
    mostUntriggered: topKey(mapBy(indexAnalysis, "indexSymbol", "expired")),
    bestTargetHitRatio: topKey(indexHitRateMap),
  };

  // Tier verdict — HC vs BASELINE comparison
  const hc = tierAnalysis.find(t => t.tier === "HIGH_CONVICTION");
  const baseline = tierAnalysis.find(t => t.tier === "BASELINE");
  const hcStopRate = hc?.stopRate ?? null;
  const baselineStopRate = baseline?.stopRate ?? null;
  let hcOutperformsBaseline: boolean | null = null;
  if (
    hc != null && baseline != null &&
    hc.opened >= 5 && baseline.opened >= 5 &&
    hc.targetHitRate != null && baseline.targetHitRate != null
  ) {
    hcOutperformsBaseline = hc.targetHitRate > baseline.targetHitRate;
  }
  const tierHitRateMap = new Map<string, number>();
  for (const t of tierAnalysis) if (t.opened >= 5 && t.targetHitRate != null) tierHitRateMap.set(t.tier, t.targetHitRate);
  const tierVerdict = {
    mostStops: topKey(mapBy(tierAnalysis, "tier", "stopped")),
    bestTargetHitRatio: topKey(tierHitRateMap),
    hcOutperformsBaseline,
    hcStopRate,
    baselineStopRate,
    hcSampleSize: hc?.opened ?? 0,
    baselineSampleSize: baseline?.opened ?? 0,
  };

  // ── Lifecycle funnel (D)
  const emittedToOpenedExact = (() => {
    let n = 0; for (const fp of fpEmitted) if (fpOpened.has(fp)) n += 1; return n;
  })();
  const openedToTarget1Exact = (() => {
    let n = 0; for (const fp of fpOpened) if (fpTarget1.has(fp)) n += 1; return n;
  })();
  const openedToStoppedExact = (() => {
    let n = 0; for (const fp of fpOpened) if (fpStopped.has(fp)) n += 1; return n;
  })();
  const target1ThenStoppedExact = (() => {
    let n = 0; for (const fp of fpTarget1) if (fpStopped.has(fp)) n += 1; return n;
  })();
  const target1ToTarget2Exact = (() => {
    let n = 0; for (const fp of fpTarget1) if (fpTarget2.has(fp)) n += 1; return n;
  })();
  const emittedNeverOpenedExact = (() => {
    let n = 0; for (const fp of fpEmitted) if (!fpOpened.has(fp)) n += 1; return n;
  })();
  const openedNoExitExact = (() => {
    let n = 0; for (const fp of fpOpened) if (!fpAnyClose.has(fp)) n += 1; return n;
  })();

  const funnelMode: LifecycleMode =
    lifecycleRowsWithFp === 0 && lifecycleRowsWithoutFp === 0 ? "exact"
    : lifecycleRowsWithoutFp === 0 ? "exact"
    : lifecycleRowsWithFp === 0 ? "proxy"
    : "hybrid";

  const lifecycleFunnel: LifecycleFunnel = {
    mode: funnelMode,
    rowsWithFingerprint: rowsWithFp,
    rowsWithoutFingerprint: rowsWithoutFp,
    emitted: nEmitted,
    opened: nOpened,
    target1: nT1,
    target2: nT2,
    stopped: nStopped,
    expired: nExpired,
    forceExit1520: nForceExit,
    manualClose: nManual,
    preEmissionRejected: nPreRejected,
    demoted: nDemoted,
    emittedNeverOpenedExact,
    openedNoExitExact,
    openedToTarget1Exact,
    openedToStoppedExact,
    target1ThenStoppedExact,
    target1ToTarget2Exact,
    conversion: {
      emittedToOpened: safeRatio(emittedToOpenedExact, fpEmitted.size),
      openedToTarget1: safeRatio(openedToTarget1Exact, fpOpened.size),
      openedToStopped: safeRatio(openedToStoppedExact, fpOpened.size),
      target1ToTarget2: safeRatio(target1ToTarget2Exact, fpTarget1.size),
      target1ToStopped: safeRatio(target1ThenStoppedExact, fpTarget1.size),
    },
  };

  // ── Stop-loss deep dive (E)
  const bySetupKC = keyCountsFromMap(stopsBySetup);
  const byIndexKC = keyCountsFromMap(stopsByIndex);
  const byRegimeKC = keyCountsFromMap(stopsByRegime);
  const byConfBucketKC = keyCountsFromMap(stopsByConfBucket);
  const stopLossDeepDive: StopLossDeepDive = {
    totalStops: nStopped,
    bySetup: bySetupKC,
    byIndex: byIndexKC,
    byConfidenceBucket: byConfBucketKC,
    byRegime: byRegimeKC,
    afterT1Stops: target1ThenStoppedExact,
    afterT1Mode: funnelMode,
    concentration: {
      topSetup: topShare(bySetupKC, nStopped),
      topIndex: topShare(byIndexKC, nStopped),
      topRegime: topShare(byRegimeKC, nStopped),
    },
  };

  // ── Untriggered (F)
  const untriggeredAnalysis: UntriggeredAnalysis = {
    expired: nExpired,
    emittedNeverOpenedExact,
    skipped: nSkipped,
    bySkipReason: keyCountsFromMap(skipReasonHist),
    expiredBySetup: keyCountsFromMap(expiredBySetup),
    lateSessionEmissions,
    lateSessionShare: safeRatio(lateSessionEmissions, nEmitted),
  };

  // ── Missing data / demotion (G)
  const demotedThenOpenedExact = (() => {
    let n = 0; for (const fp of fpDemoted) if (fpOpened.has(fp)) n += 1; return n;
  })();
  const demotedThenOpenedAndStoppedExact = (() => {
    let n = 0; for (const fp of fpDemoted) if (fpOpened.has(fp) && fpStopped.has(fp)) n += 1; return n;
  })();
  const missingFieldStopCorrelation: MissingDataAnalysis["missingFieldStopCorrelation"] = [];
  for (const [field, fpSet] of emittedFpByMissingField) {
    let opened = 0, stopped = 0;
    for (const fp of fpSet) {
      if (fpOpened.has(fp)) opened += 1;
      if (fpStopped.has(fp)) stopped += 1;
    }
    missingFieldStopCorrelation.push({
      field,
      emittedSample: fpSet.size,
      openedSample: opened,
      stopped,
      stopRate: safeRatio(stopped, opened),
    });
  }
  missingFieldStopCorrelation.sort(
    (a, b) => b.emittedSample - a.emittedSample || a.field.localeCompare(b.field),
  );

  const missingDataAnalysis: MissingDataAnalysis = {
    byMissingField: keyCountsFromMap(missingFieldHist),
    byDemotionTag: keyCountsFromMap(demotionTagHist),
    demotedThenOpenedExact,
    demotedThenOpenedAndStoppedExact,
    lowWinRateDemotions,
    missingFieldStopCorrelation,
  };

  // ── Hypothesis ranking (H)
  const closedSample = nT1 + nT2 + nStopped + nExpired + nForceExit + nManual;
  const hypotheses = buildHypotheses({
    closedSample,
    nEmitted,
    nOpened, nT1, nT2, nStopped, nExpired,
    target1ThenStoppedExact,
    fpOpenedSize: fpOpened.size,
    fpTarget1Size: fpTarget1.size,
    stoppedByRegimeKC: byRegimeKC,
    stoppedBySetupKC: bySetupKC,
    stoppedByIndexKC: byIndexKC,
    indexAnalysis,
    setupAnalysis,
    lateSessionShare: untriggeredAnalysis.lateSessionShare,
    lateSessionEmissions,
    missingFieldStopCorrelation,
    lowWinRateDemotions,
    demotedThenOpenedExact,
    demotedThenOpenedAndStoppedExact,
    hcOutperformsBaseline,
    hcSampleSize: tierVerdict.hcSampleSize,
    baselineSampleSize: tierVerdict.baselineSampleSize,
    hcStopRate, baselineStopRate,
  });

  const recommendedNextSteps = buildRecommendations(hypotheses);

  const notes = [
    "Diagnostics-only report. No trading behaviour changed.",
    "Sample sizes < 30 are 'insufficient_data' by convention.",
    funnelMode === "proxy"
      ? "Lifecycle funnel in PROXY mode — exact conversions unavailable; numbers come from 4-tuple grouping."
      : funnelMode === "hybrid"
        ? "Lifecycle funnel in HYBRID mode — counts use exact fingerprint where present, fallback otherwise."
        : "Lifecycle funnel in EXACT mode — every lifecycle row carried a signal_fingerprint.",
  ];

  return {
    generatedAt,
    rowCount: rows.length,
    windowFrom,
    windowTo,
    filters: { exactOnly, windowFrom, windowTo },
    setupAnalysis,
    setupSuperlatives,
    indexAnalysis,
    indexSuperlatives,
    tierAnalysis,
    tierVerdict,
    lifecycleFunnel,
    stopLossDeepDive,
    untriggeredAnalysis,
    missingDataAnalysis,
    hypotheses,
    recommendedNextSteps,
    notes,
  };
}

/* ──────────────────── Hypothesis builder (pure) ──────────────────── */

interface HypothesisInputs {
  closedSample: number;
  nEmitted: number;
  nOpened: number;
  nT1: number;
  nT2: number;
  nStopped: number;
  nExpired: number;
  target1ThenStoppedExact: number;
  fpOpenedSize: number;
  fpTarget1Size: number;
  stoppedByRegimeKC: KeyCount[];
  stoppedBySetupKC: KeyCount[];
  stoppedByIndexKC: KeyCount[];
  indexAnalysis: IndexFailureRow[];
  setupAnalysis: SetupFailureRow[];
  lateSessionShare: number | null;
  lateSessionEmissions: number;
  missingFieldStopCorrelation: Array<{ field: string; stopRate: number | null; openedSample: number }>;
  lowWinRateDemotions: number;
  demotedThenOpenedExact: number;
  demotedThenOpenedAndStoppedExact: number;
  hcOutperformsBaseline: boolean | null;
  hcSampleSize: number;
  baselineSampleSize: number;
  hcStopRate: number | null;
  baselineStopRate: number | null;
}

const MIN_SAMPLE = 30;

function buildHypotheses(x: HypothesisInputs): HypothesisFinding[] {
  const out: HypothesisFinding[] = [];

  // H1 — Slippage / charges / spread not modelled
  // We cannot prove or disprove this from reasoning logs alone (the
  // logs record decisions, not P&L vs. broker-fill realism).
  out.push({
    id: "H1",
    label: "Slippage / charges / spread are not modelled, so realised edge is weaker than reasoning logs suggest.",
    status: "undetermined",
    sampleSize: 0,
    evidence: "fno_signal_reasoning does not capture broker-fill realism; this hypothesis cannot be evaluated from current logs. Decide separately via order-vs-fill audit.",
  });

  // H2 — No partial booking / no trail to BE after T1
  // EVIDENCE: target1ThenStoppedExact — fingerprinted trades that hit
  // T1 and later got stopped (i.e. gave back gains because there is no
  // partial / breakeven move).
  if (x.fpTarget1Size >= 5) {
    const share = safeRatio(x.target1ThenStoppedExact, x.fpTarget1Size);
    // Require both a meaningful reversal share AND a denominator before
    // promoting to 'likely' / 'proven'. A tiny denominator with 0%
    // reversal must NOT be reported as 'likely'.
    const meetsRatio = share != null && share >= 0.25;
    const status: HypothesisStatus =
      !meetsRatio ? "insufficient_data"
      : x.fpTarget1Size >= MIN_SAMPLE ? "proven"
      : "likely";
    out.push({
      id: "H2",
      label: "No partial booking / no trail-to-breakeven after T1 — winners reverse into stops.",
      status,
      sampleSize: x.fpTarget1Size,
      evidence: `${x.target1ThenStoppedExact}/${x.fpTarget1Size} fingerprinted T1 trades subsequently hit CLOSED_STOPPED (${share == null ? "n/a" : (share * 100).toFixed(1) + "%"}).`,
      metrics: { target1ThenStoppedExact: x.target1ThenStoppedExact, fpTarget1Size: x.fpTarget1Size, share: share },
    });
  } else {
    out.push({
      id: "H2",
      label: "No partial booking / no trail-to-breakeven after T1 — winners reverse into stops.",
      status: "insufficient_data",
      sampleSize: x.fpTarget1Size,
      evidence: `Only ${x.fpTarget1Size} fingerprinted T1 trades observed; need ≥ 5 to draw a signal and ≥ ${MIN_SAMPLE} for 'proven'.`,
    });
  }

  // H3 — No option-chain confirmation before entry.
  // We can't fully prove this from reasoning logs but we can flag it
  // as 'likely' when stops are heavily concentrated in setups with no
  // OI confluence gate involvement (we have only OI_ATM_CONFLICT
  // demotions to look at — beyond scope to attribute precisely).
  out.push({
    id: "H3",
    label: "No option-chain confirmation gate before entry (entries fire purely on spot setup).",
    status: "undetermined",
    sampleSize: 0,
    evidence: "Reasoning logs show OI_ATM_CONFLICT only on demotion path; whether a confirmation gate would have rejected the open is not observable from these rows.",
  });

  // H4 — Stop loss is too tight for certain index / setup / regime.
  // EVIDENCE: a single setup or index dominates the stop histogram (≥
  // 40 % share) OR an index has stopRate ≥ 0.5 over ≥ 10 trades.
  {
    let proven = false;
    const topSetupShare = x.stoppedBySetupKC.length > 0 && x.nStopped > 0
      ? x.stoppedBySetupKC[0]!.count / x.nStopped : null;
    const topIndexShare = x.stoppedByIndexKC.length > 0 && x.nStopped > 0
      ? x.stoppedByIndexKC[0]!.count / x.nStopped : null;
    const worstIndex = x.indexAnalysis.find(i => i.opened >= 10 && (i.stopRate ?? 0) >= 0.5);
    if (worstIndex != null) proven = true;
    if (topSetupShare != null && topSetupShare >= 0.4 && x.nStopped >= 20) proven = true;
    const status: HypothesisStatus =
      x.nStopped < 10 ? "insufficient_data"
      : proven ? "proven"
      : (topSetupShare != null && topSetupShare >= 0.3) || (topIndexShare != null && topIndexShare >= 0.5) ? "likely"
      : "undetermined";
    out.push({
      id: "H4",
      label: "Stop loss is too tight for certain index / setup / regime.",
      status,
      sampleSize: x.nStopped,
      evidence: `Top setup share of stops: ${topSetupShare == null ? "n/a" : (topSetupShare * 100).toFixed(1) + "%"} (${x.stoppedBySetupKC[0]?.key ?? "—"}); top index share: ${topIndexShare == null ? "n/a" : (topIndexShare * 100).toFixed(1) + "%"} (${x.stoppedByIndexKC[0]?.key ?? "—"}); worst-stop-rate index ≥10 trades: ${worstIndex == null ? "none" : `${worstIndex.indexSymbol} (${(worstIndex.stopRate! * 100).toFixed(1)}%)`}.`,
      metrics: {
        topSetupShare, topIndexShare,
        worstIndex: worstIndex?.indexSymbol ?? null,
      },
    });
  }

  // H5 — Win-rate gate fails open below minimum sample
  // EVIDENCE: lowWinRateDemotions > 0 confirms gate triggered; but
  // whether it 'fails open' (lets weak setups through anyway) needs
  // demotedThenOpenedAndStopped > 0.
  {
    const status: HypothesisStatus =
      x.lowWinRateDemotions === 0 ? "insufficient_data"
      : x.demotedThenOpenedAndStoppedExact > 0 ? "likely"
      : "undetermined";
    out.push({
      id: "H5",
      label: "Win-rate gate fails open below minimum sample (low-WR setups still trade and lose).",
      status,
      sampleSize: x.lowWinRateDemotions,
      evidence: `${x.lowWinRateDemotions} EMITTED rows carried LOW_WINRATE tag; ${x.demotedThenOpenedExact} demoted fingerprints later OPENED; ${x.demotedThenOpenedAndStoppedExact} of those were subsequently STOPPED.`,
      metrics: {
        lowWinRateDemotions: x.lowWinRateDemotions,
        demotedThenOpenedExact: x.demotedThenOpenedExact,
        demotedThenOpenedAndStoppedExact: x.demotedThenOpenedAndStoppedExact,
      },
    });
  }

  // H6 — Mean-reversion / counter-trend setups fail in trending regimes
  // EVIDENCE: regime histogram of stops dominated by TRENDING when the
  // worst-stop setup is mean-reversion-flavoured.
  {
    const regimeTotal = x.stoppedByRegimeKC.reduce((a, b) => a + b.count, 0);
    const topRegime = x.stoppedByRegimeKC[0] ?? null;
    const status: HypothesisStatus =
      regimeTotal < 10 ? "insufficient_data"
      : (topRegime != null && /TREND/i.test(topRegime.key) && topRegime.count / regimeTotal >= 0.5) ? "likely"
      : "undetermined";
    out.push({
      id: "H6",
      label: "Mean-reversion / counter-trend setups fail during trending regimes.",
      status,
      sampleSize: regimeTotal,
      evidence: `Top regime for stops: ${topRegime?.key ?? "n/a"} (${topRegime == null || regimeTotal === 0 ? "—" : ((topRegime.count / regimeTotal) * 100).toFixed(1) + "%"}).`,
      metrics: { topRegime: topRegime?.key ?? null, regimeTotal, topRegimeShare: topRegime != null && regimeTotal > 0 ? topRegime.count / regimeTotal : null },
    });
  }

  // H7 — Entry triggers are late / stale
  // EVIDENCE: lateSessionShare ≥ 0.25 over ≥ MIN_SAMPLE EMITTED rows.
  // Denominator MUST be total EMITTED, not lateSessionEmissions, so a
  // tiny "1/1 late" cannot be promoted to 'likely'.
  {
    const share = x.lateSessionShare ?? 0;
    const status: HypothesisStatus =
      x.nEmitted < MIN_SAMPLE ? "insufficient_data"
      : share >= 0.25 ? "likely"
      : "undetermined";
    out.push({
      id: "H7",
      label: "Entry triggers are late / stale (signals fire in the last 1.5 hours).",
      status,
      sampleSize: x.nEmitted,
      evidence: `${x.lateSessionEmissions}/${x.nEmitted} EMITTED rows at IST hour ≥ 14:00; share = ${x.lateSessionShare == null ? "n/a" : (x.lateSessionShare * 100).toFixed(1) + "%"}.`,
      metrics: { lateSessionEmissions: x.lateSessionEmissions, lateSessionShare: x.lateSessionShare, nEmitted: x.nEmitted },
    });
  }

  // H8 — Signals emitted without enough data quality
  // EVIDENCE: a missing field correlates with a meaningfully higher
  // stop rate than the baseline.
  {
    const flagged = x.missingFieldStopCorrelation.filter(c => c.openedSample >= 5 && c.stopRate != null);
    const worst = flagged.reduce<{ field: string; stopRate: number } | null>(
      (best, c) => best == null || (c.stopRate ?? 0) > best.stopRate ? { field: c.field, stopRate: c.stopRate ?? 0 } : best,
      null,
    );
    const status: HypothesisStatus =
      flagged.length === 0 ? "insufficient_data"
      : worst != null && worst.stopRate >= 0.6 ? "likely"
      : "undetermined";
    out.push({
      id: "H8",
      label: "Signals are emitted without enough data quality (missing IVR/IVP/VIX/spread correlates with stops).",
      status,
      sampleSize: flagged.reduce((a, c) => a + c.openedSample, 0),
      evidence: `Worst missing-field stop-rate: ${worst == null ? "n/a" : `${worst.field} → ${(worst.stopRate * 100).toFixed(1)}%`}.`,
      metrics: { worstField: worst?.field ?? null, worstStopRate: worst?.stopRate ?? null },
    });
  }

  // H9 — Certain indices should have different thresholds
  // EVIDENCE: stopRate spread between worst and best index ≥ 0.2 over
  // ≥ 10 trades each.
  {
    const eligible = x.indexAnalysis.filter(i => i.opened >= 10 && i.stopRate != null);
    if (eligible.length < 2) {
      out.push({
        id: "H9",
        label: "Certain indices should have different thresholds (stop / target / confidence).",
        status: "insufficient_data",
        sampleSize: eligible.reduce((a, i) => a + i.opened, 0),
        evidence: `Need ≥ 2 indices with ≥ 10 OPENED rows; only ${eligible.length} qualify.`,
      });
    } else {
      const best = eligible.reduce((b, c) => (c.stopRate! < b.stopRate! ? c : b));
      const worst = eligible.reduce((b, c) => (c.stopRate! > b.stopRate! ? c : b));
      const spread = (worst.stopRate ?? 0) - (best.stopRate ?? 0);
      const status: HypothesisStatus = spread >= 0.2 ? "proven" : spread >= 0.1 ? "likely" : "undetermined";
      out.push({
        id: "H9",
        label: "Certain indices should have different thresholds (stop / target / confidence).",
        status,
        sampleSize: eligible.reduce((a, i) => a + i.opened, 0),
        evidence: `Best index stopRate=${(best.stopRate! * 100).toFixed(1)}% (${best.indexSymbol}); worst stopRate=${(worst.stopRate! * 100).toFixed(1)}% (${worst.indexSymbol}); spread=${(spread * 100).toFixed(1)}%.`,
        metrics: { best: best.indexSymbol, worst: worst.indexSymbol, spread },
      });
    }
  }

  // H10 — Certain setups should be disabled / demoted
  // EVIDENCE: any setup with ≥ 10 opened AND stopRate ≥ 0.7 AND
  // targetHitRate ≤ 0.2.
  {
    const losers = x.setupAnalysis.filter(s =>
      s.opened >= 10 && (s.stopRate ?? 0) >= 0.7 && (s.targetHitRate ?? 0) <= 0.2,
    );
    const status: HypothesisStatus =
      losers.length > 0 ? "proven"
      : x.nOpened < MIN_SAMPLE ? "insufficient_data"
      : "undetermined";
    out.push({
      id: "H10",
      label: "Certain setups should be disabled or demoted (loss-dominated setups identified by data).",
      status,
      sampleSize: losers.reduce((a, s) => a + s.opened, 0),
      evidence: losers.length > 0
        ? `Loss-dominated setups (opened ≥ 10, stopRate ≥ 70 %, hitRate ≤ 20 %): ${losers.map(s => `${s.setupKey} (op=${s.opened}, st=${(s.stopRate! * 100).toFixed(1)}%, hit=${(s.targetHitRate! * 100).toFixed(1)}%)`).join("; ")}.`
        : `No setup hit the loss-dominated threshold over ${x.nOpened} total OPENED.`,
      metrics: { losingSetups: losers.map(s => s.setupKey).join(",") || null },
    });
  }

  return out;
}

/* ─────────────────── Recommendation builder (pure) ──────────────── */

function buildRecommendations(hyps: HypothesisFinding[]): RecommendedNextStep[] {
  // Ordering: proven > likely > undetermined > insufficient_data.
  const priorityForStatus: Record<HypothesisStatus, number> = {
    proven: 1, likely: 2, undetermined: 3, insufficient_data: 4,
  };
  const ordered = [...hyps].sort((a, b) =>
    priorityForStatus[a.status] - priorityForStatus[b.status]
    || b.sampleSize - a.sampleSize
    || a.id.localeCompare(b.id),
  );
  const out: RecommendedNextStep[] = [];
  let p = 1;
  for (const h of ordered) {
    if (h.status === "insufficient_data" || h.status === "undetermined") continue;
    out.push({
      priority: p++,
      label: h.label,
      rationale: h.evidence,
      sampleBacking: h.sampleSize,
    });
  }
  if (out.length === 0) {
    out.push({
      priority: 1,
      label: "Collect more data before changing strategy.",
      rationale: "No hypothesis crossed the proven/likely threshold in the current window.",
      sampleBacking: 0,
    });
  }
  return out;
}

/* ────────────────── Data-failure classification (Task #131) ─────────────────
 *
 * PURE classifier. Turns a raw error / the F&O cycle's existing suppression
 * reason strings into an EXACT, honest failure code + recovery action — so the
 * diagnostics surface shows "Kite session expired" or "history warming up"
 * instead of a generic "unavailable".
 *
 * Consumed ONLY by the read-only backbone/diagnostics surface. It is NOT wired
 * into optionSignals' emission/suppression state machine — that code is left
 * byte-for-byte unchanged so signal behavior cannot shift.
 * ------------------------------------------------------------------------- */

export type DataFailureCode =
  | "SESSION_MISSING"
  | "KITE_SESSION_EXPIRED"
  | "TOKEN_MISSING"
  | "EXCHANGE_UNSUPPORTED"
  | "THROTTLED"
  | "DATE_RANGE"
  | "MARKET_JUST_OPENED"
  | "MARKET_CLOSED"
  | "DAILY_BARS_MISSING"
  | "INTRADAY_BARS_MISSING"
  | "WEBSOCKET_NO_TICKS"
  | "OPTION_CHAIN_STALE"
  | "WARMUP"
  | "UNKNOWN";

export interface DataFailureContext {
  /** Kite session validity at the time, when known. */
  sessionValid?: boolean;
  /**
   * True when the session is KNOWN to be present but expired (distinct from
   * never having had one). Callers with an explicit expiry signal (e.g. a
   * TTL check) should set this instead of relying on message-text sniffing.
   */
  sessionExpired?: boolean;
  /** Market phase at the time, when known. */
  marketSession?: "open" | "closed" | "pre_open";
  /** Seconds since the 09:15 IST open (null/undefined when unknown). */
  secondsSinceOpen?: number | null;
  /**
   * Which warmup step produced this failure, when known — lets the
   * classifier attribute a known-cause step failure instead of falling back
   * to UNKNOWN.
   */
  failedStep?: "quote" | "dailyBars" | "intradayBars" | "optionChain";
  /** Live tick feed (KiteTicker WebSocket) connectivity, when known. */
  feedConnected?: boolean;
}

export interface DataFailureDiagnosis {
  code: DataFailureCode;
  message: string;
  recoveryAction: string;
  /** True when the condition is expected to self-resolve (retry helps). */
  transient: boolean;
}

const RECOVERY: Record<DataFailureCode, string> = {
  SESSION_MISSING: "Reconnect Zerodha (Kite session expired or missing).",
  KITE_SESSION_EXPIRED: "Reconnect Zerodha (Kite session expired).",
  TOKEN_MISSING: "Configure Kite API credentials (api_key / access_token).",
  EXCHANGE_UNSUPPORTED: "Instrument/exchange not covered — verify the instrument mapping.",
  THROTTLED: "Kite rate-limited or timed out — retries automatically next cycle.",
  DATE_RANGE: "Invalid historical date range — check the requested from/to window.",
  MARKET_JUST_OPENED: "Market just opened — first bars form shortly; retries automatically.",
  MARKET_CLOSED: "Market is closed — data refreshes automatically next session.",
  DAILY_BARS_MISSING: "Daily historical bars unavailable — trigger a Kite warmup or check /fno-diagnostics.",
  INTRADAY_BARS_MISSING: "Intraday historical bars unavailable — trigger a Kite warmup or check /fno-diagnostics.",
  WEBSOCKET_NO_TICKS: "Live tick feed (KiteTicker WebSocket) disconnected — check the feed connection; retries automatically.",
  OPTION_CHAIN_STALE: "Option-chain data is stale or unavailable — display-only, does not block signals; check /option-chain.",
  WARMUP: "Kite historical API is warming up after login — retries automatically next cycle.",
  UNKNOWN: "Check /fno-diagnostics data-health; trigger a Kite warmup if the session is active.",
};

function has(hay: string, ...needles: string[]): boolean {
  return needles.some((n) => hay.includes(n));
}

/**
 * Classify a data failure. Pure. Accepts an Error, a raw string (including the
 * F&O cycle's suppression reason strings such as `no_live_kite_intraday`,
 * `daily_history_warmup_kite`, `daily_history_unavailable_kite`, `exception: …`),
 * or null. Context refines ambiguous cases without ever fabricating certainty.
 */
export function classifyDataFailure(
  input: unknown,
  context: DataFailureContext = {},
): DataFailureDiagnosis {
  let raw =
    input == null
      ? ""
      : input instanceof Error
        ? input.message
        : typeof input === "string"
          ? input
          : String(input);

  // Unwrap the F&O cycle's `exception: <msg>` wrapper so the inner message is classified.
  const exMatch = /^exception:\s*/i.exec(raw);
  if (exMatch) raw = raw.slice(exMatch[0].length);

  const hay = raw.toLowerCase();
  const mk = (code: DataFailureCode, message?: string, transient?: boolean): DataFailureDiagnosis => ({
    code,
    message: message ?? raw ?? code,
    recoveryAction: RECOVERY[code],
    transient: transient ?? (code === "WARMUP" || code === "MARKET_JUST_OPENED" || code === "THROTTLED"),
  });

  // 1) Post-login history warmup (transient) — explicit reason string wins.
  if (has(hay, "warmup", "warming up", "daily_history_warmup")) {
    return mk("WARMUP", "Kite daily-history API is warming up after login.");
  }

  // 2) Credentials not configured (distinct from an expired session).
  if (has(hay, "api_key", "apikey", "access_token", "no credentials", "creds missing", "not configured")) {
    return mk("TOKEN_MISSING");
  }

  // 3) Explicit session-expiry signal — either a caller-known TTL expiry or
  // an explicit "expired" in the error text. Distinct from a session that is
  // simply missing/never established.
  if (
    context.sessionExpired === true ||
    has(hay, "session expired") ||
    (has(hay, "session") && has(hay, "expired"))
  ) {
    return mk("KITE_SESSION_EXPIRED");
  }

  // 3b) Session missing / unauthorised (never established, or generically invalid).
  if (
    has(hay, "tokenexception", "no session", "logged out", "unauthor", "401", "403") ||
    (has(hay, "session") && has(hay, "missing", "invalid", "unreachable"))
  ) {
    return mk("SESSION_MISSING");
  }

  // 4) Throttle / network timeout.
  if (has(hay, "throttl", "rate limit", "ratelimit", "429", "too many requests", "econnaborted", "etimedout", "timeout", "networkexception")) {
    return mk("THROTTLED");
  }

  // 5) Bad historical date range.
  if (
    has(hay, "date range", "invalid `from`", "invalid `to`", "invalid from", "invalid to") ||
    (has(hay, "inputexception") && has(hay, "date", "from", "to")) ||
    (has(hay, "range") && has(hay, "date"))
  ) {
    return mk("DATE_RANGE");
  }

  // 6) Instrument / exchange not covered.
  if (has(hay, "unsupported", "uncovered", "instrument not found", "not found", "segment", "exchange")) {
    return mk("EXCHANGE_UNSUPPORTED");
  }

  // 6.5) Option-chain step failure — the option chain surface has its own
  // failure vocabulary (staleness / empty chain) rather than a fixed message
  // string, so this is keyed on the caller-supplied step, not `hay`.
  // Option-chain data is display-only reporting; it never feeds trade
  // decisions, so this classification cannot change any signal path.
  if (context.failedStep === "optionChain") {
    // Note: KITE_SESSION_EXPIRED is already handled above (branch 3) before
    // any hay/step-based classification runs, so it never reaches here.
    if (context.sessionValid === false) return mk("SESSION_MISSING");
    if (context.marketSession === "closed") {
      return mk(
        "MARKET_CLOSED",
        "Market is closed — option chain will refresh next session.",
        true,
      );
    }
    return mk(
      "OPTION_CHAIN_STALE",
      raw || "Kite session active but option-chain data is stale or unavailable.",
      false,
    );
  }

  // 7) `no_live_kite_intraday` — ambiguous by design; refine with context.
  if (has(hay, "no_live_kite_intraday", "no live kite intraday")) {
    // Note: KITE_SESSION_EXPIRED is already handled above (branch 3) before
    // any hay/step-based classification runs, so it never reaches here.
    if (context.sessionValid === false) return mk("SESSION_MISSING");
    if (context.marketSession === "closed") {
      return mk(
        "MARKET_CLOSED",
        "Market is closed — intraday bars will resume next session.",
        true,
      );
    }
    if (
      context.secondsSinceOpen != null &&
      context.secondsSinceOpen >= 0 &&
      context.secondsSinceOpen <= 180
    ) {
      return mk("MARKET_JUST_OPENED");
    }
    if (context.feedConnected === false || context.failedStep === "quote") {
      return mk(
        "WEBSOCKET_NO_TICKS",
        "Kite session active but the live tick feed (KiteTicker WebSocket) is disconnected — no ticks received.",
        false,
      );
    }
    if (context.sessionValid === true) {
      if (context.failedStep === "intradayBars") {
        return mk(
          "INTRADAY_BARS_MISSING",
          "Kite session active but intraday bars are unavailable for this instrument.",
          false,
        );
      }
      // Session is KNOWN active — claiming SESSION_MISSING here would be a
      // false diagnosis. Honest UNKNOWN with the real observation instead.
      return mk(
        "UNKNOWN",
        "Live intraday bars missing despite an active Kite session — feed may not cover this instrument or ticks have not arrived yet.",
        false,
      );
    }
    // Session validity unknown (no context) — most common historical cause.
    return mk("SESSION_MISSING");
  }

  // 8) `daily_history_unavailable_kite` — session active but no daily bars.
  if (has(hay, "daily_history_unavailable", "daily history unavailable")) {
    // Note: KITE_SESSION_EXPIRED is already handled above (branch 3) before
    // any hay/step-based classification runs, so it never reaches here.
    if (context.sessionValid === false) return mk("SESSION_MISSING");
    if (context.marketSession === "closed") {
      return mk(
        "MARKET_CLOSED",
        "Market is closed — daily bars will refresh next session.",
        true,
      );
    }
    return mk(
      "DAILY_BARS_MISSING",
      "Kite session active but daily bars unavailable — history not yet fetched or upstream returned empty.",
      false,
    );
  }

  // 9) Market-just-opened, when no error text but context says so.
  if (
    raw === "" &&
    context.marketSession === "open" &&
    context.secondsSinceOpen != null &&
    context.secondsSinceOpen >= 0 &&
    context.secondsSinceOpen <= 180
  ) {
    return mk("MARKET_JUST_OPENED", "Market just opened — first intraday bars are still forming.");
  }

  return mk("UNKNOWN", raw === "" ? "No error detail available." : raw, false);
}
