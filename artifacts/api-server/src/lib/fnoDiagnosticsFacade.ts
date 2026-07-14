/**
 * F&O Diagnostics Facade (READ-ONLY, additive — 2026-06-05).
 *
 * Pure reshaping helpers that power the consolidating `/api/fno/*`
 * operator namespace. This module owns ZERO new analytics math: it
 * re-shapes the output of the existing `computeReasoningAnalytics`
 * (over the `fno_signal_reasoning` audit table) plus the in-process
 * missed-signal ring into operator-friendly views (gate waterfall,
 * setup performance, no-trade reasons) and provides two tiny pure
 * data-health classifiers (freshness severity + ATM spread).
 *
 * It does NOT touch signal generation, gates, sizing, execution,
 * scheduler, Kite, scanner, swing, paper-equity, strategy builder,
 * combo lane, snapshot/candle ingestion, or any schema. No I/O.
 *
 * Why a facade instead of new endpoints with new math: an extensive
 * F&O diagnostics surface already exists under `/paper/diagnostics/*`.
 * These helpers deliberately delegate so the new namespace cannot drift
 * from the source-of-truth analytics.
 */

import type { ReasoningAnalytics } from "./fnoReasoningAnalytics";
import type { OcSide } from "./optionChain";

export type HealthSeverity = "ok" | "warn" | "fail" | "unavailable";

/* ───────────────────────── small helpers ─────────────────────────── */

function round(n: number, dp = 3): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function toMap(arr: ReadonlyArray<{ key: string; count: number }>): Map<string, number> {
  return new Map(arr.map((k) => [k.key, k.count]));
}

/**
 * Classify a freshness age (ms since last good update) into a severity.
 * `null` age => "unavailable" (we never had a timestamp). Negative ages
 * (clock skew) are treated as fresh.
 */
export function classifyFreshness(
  ageMs: number | null,
  warnMs: number,
  failMs: number,
): HealthSeverity {
  if (ageMs == null || !Number.isFinite(ageMs)) return "unavailable";
  const a = ageMs < 0 ? 0 : ageMs;
  if (a >= failMs) return "fail";
  if (a >= warnMs) return "warn";
  return "ok";
}

/**
 * ATM option-leg quoted spread as a percent of mid. Honest nulls when
 * bid/ask are missing or non-positive (cannot fabricate a spread).
 */
export function atmSpreadPct(side: OcSide | undefined | null): number | null {
  if (!side) return null;
  const bid = side.bid;
  const ask = side.ask;
  if (typeof bid !== "number" || typeof ask !== "number") return null;
  if (!Number.isFinite(bid) || !Number.isFinite(ask)) return null;
  if (bid <= 0 || ask <= 0 || ask < bid) return null;
  const mid = (bid + ask) / 2;
  if (mid <= 0) return null;
  return round(((ask - bid) / mid) * 100, 4);
}

/* ───────────────── signal-readiness verdict (READ-ONLY) ──────────────
 *
 * Pure data-readiness classifiers for `/fno/data-health`. They answer a
 * single honest question per underlying: "is there fresh, live Kite spot +
 * Kite option data right now, sufficient to TRUST an F&O signal?" — and, if
 * not, exactly why. NOTHING in the trading path consumes these; they are
 * an operator visibility surface only. The classifiers NEVER infer
 * tradability when data is missing and NEVER treat non-Kite (NSE/Yahoo)
 * option data as F&O-live.
 *
 * Liquidity thresholds are passed IN by the route (which owns the single
 * source of truth, `FNO_LIQUIDITY` in paperAccount.ts) so this module stays
 * pure/no-import and the constants never drift.
 */

export type SignalBlockSeverity = "OK" | "WARN" | "FAIL";
export type DataSourceVerdict =
  | "LIVE_KITE"
  | "KITE_STALE"
  | "KITE_OFFLINE"
  | "PARTIAL"
  | "UNAVAILABLE";
export type SpotProvider = "KITE_WS" | "KITE_REST" | "CACHE" | "UNAVAILABLE";
export type OptionChainProvider = "KITE" | "NSE" | "YAHOO" | "UNAVAILABLE";

export interface SignalBlock {
  code: string;
  severity: "WARN" | "FAIL";
  detail: string;
}

export interface SignalReadiness {
  signalAllowed: boolean;
  blockingReasons: SignalBlock[];
  blockingSeverity: SignalBlockSeverity;
  dataSourceVerdict: DataSourceVerdict;
  spotProvider: SpotProvider;
  optionChainProvider: OptionChainProvider;
  freshEnoughForSignal: boolean;
  missingFields: string[];
}

export interface ReadinessLeg {
  ltp: number | null;
  oi: number | null;
  spreadPct: number | null;
}

export interface SignalReadinessInput {
  sessionPresent: boolean;
  feedConnected: boolean;
  spot: { present: boolean; ageMs: number | null; status: HealthSeverity };
  chain: {
    present: boolean;
    status: HealthSeverity;
    /** Raw `oc.source` ("kite" | "NSE" | "yahoo" | ...). null when absent. */
    source: string | null;
    atm: { ce: ReadinessLeg | null; pe: ReadinessLeg | null } | null;
  };
}

/** Liquidity thresholds (mirrors FNO_LIQUIDITY); maxSpreadPct in PERCENT. */
export interface LiquidityThresholds {
  minOptionLtp: number;
  minOptionOi: number;
  maxSpreadPct: number;
}

/**
 * Classify how the live spot quote was sourced. `getKiteIndexQuotes` is
 * Kite-only (returns null without a Kite session — never Yahoo), so a
 * present quote is always Kite-origin; the WS/REST/CACHE distinction is a
 * freshness heuristic (WS fast-path ticks are <3s; REST batch ≤60s; older
 * is served from cache).
 */
export function deriveSpotProvider(
  present: boolean,
  ageMs: number | null,
  feedConnected: boolean,
): SpotProvider {
  if (!present) return "UNAVAILABLE";
  if (feedConnected && ageMs != null && Number.isFinite(ageMs) && ageMs <= 3_000) return "KITE_WS";
  if (ageMs != null && Number.isFinite(ageMs) && ageMs <= 60_000) return "KITE_REST";
  return "CACHE";
}

/** Map raw option-chain source to an honest provider label. */
export function mapOptionChainProvider(source: string | null | undefined): OptionChainProvider {
  if (!source) return "UNAVAILABLE";
  const s = source.toLowerCase();
  if (s.includes("kite")) return "KITE";
  if (s.includes("yahoo")) return "YAHOO";
  // Any other present source (NSE direct, unknown live fallback) is non-Kite.
  return "NSE";
}

/**
 * Derive the read-only signal-readiness verdict for one underlying.
 * `signalAllowed` is true ONLY when there is an active Kite session AND
 * fresh live Kite spot AND fresh live Kite option chain. Liquidity issues
 * surface as WARN reasons (informational — the binding gate is at trade
 * time) and never silently imply tradability.
 */
export function deriveSignalReadiness(
  input: SignalReadinessInput,
  thresholds: LiquidityThresholds,
): SignalReadiness {
  const reasons: SignalBlock[] = [];
  const missing: string[] = [];

  if (!input.sessionPresent) {
    reasons.push({ code: "KITE_SESSION_ABSENT", severity: "FAIL", detail: "No active Kite session" });
  }

  // Spot
  if (!input.spot.present) {
    reasons.push({ code: "SPOT_UNAVAILABLE", severity: "FAIL", detail: "No live index quote" });
    missing.push("spot");
  } else if (input.spot.status === "fail") {
    reasons.push({ code: "SPOT_STALE", severity: "FAIL", detail: "Index quote older than fail threshold" });
  } else if (input.spot.status === "warn") {
    reasons.push({ code: "SPOT_AGING", severity: "WARN", detail: "Index quote aging" });
  }

  // Option chain provenance + freshness
  const optionChainProvider = input.chain.present
    ? mapOptionChainProvider(input.chain.source)
    : "UNAVAILABLE";

  if (!input.chain.present) {
    reasons.push({ code: "OPTION_CHAIN_UNAVAILABLE", severity: "FAIL", detail: "Option chain unavailable" });
    missing.push("optionChain");
  } else {
    if (optionChainProvider !== "KITE") {
      reasons.push({
        code: "NON_KITE_OPTION_DATA",
        severity: "FAIL",
        detail: `Option chain sourced from ${optionChainProvider}, not Kite live — not treated as F&O-live`,
      });
    }
    if (input.chain.status === "fail") {
      reasons.push({ code: "OPTION_CHAIN_STALE", severity: "FAIL", detail: "Option chain older than fail threshold" });
    } else if (input.chain.status === "warn") {
      reasons.push({ code: "OPTION_CHAIN_AGING", severity: "WARN", detail: "Option chain aging" });
    }

    // ATM liquidity (informational; thresholds mirror FNO_LIQUIDITY)
    if (!input.chain.atm) {
      reasons.push({ code: "ATM_LEG_MISSING", severity: "WARN", detail: "ATM strike row not found in chain" });
      missing.push("atmLeg");
    } else {
      const sides: Array<["CE" | "PE", ReadinessLeg | null]> = [
        ["CE", input.chain.atm.ce],
        ["PE", input.chain.atm.pe],
      ];
      for (const [label, leg] of sides) {
        if (!leg || leg.ltp == null || leg.oi == null) {
          reasons.push({ code: `ATM_${label}_INCOMPLETE`, severity: "WARN", detail: `ATM ${label} LTP/OI not reported` });
          missing.push(`atm${label}`);
          continue;
        }
        if (leg.ltp < thresholds.minOptionLtp) {
          reasons.push({ code: `ATM_${label}_LTP_BELOW_MIN`, severity: "WARN", detail: `ATM ${label} LTP ${leg.ltp} < ₹${thresholds.minOptionLtp}` });
        }
        if (leg.oi < thresholds.minOptionOi) {
          reasons.push({ code: `ATM_${label}_OI_LOW`, severity: "WARN", detail: `ATM ${label} OI ${leg.oi} < ${thresholds.minOptionOi}` });
        }
        if (leg.spreadPct != null && leg.spreadPct > thresholds.maxSpreadPct) {
          reasons.push({ code: `ATM_${label}_SPREAD_WIDE`, severity: "WARN", detail: `ATM ${label} spread ${leg.spreadPct}% > ${thresholds.maxSpreadPct}%` });
        }
      }
    }
  }

  const hasFail = reasons.some((r) => r.severity === "FAIL");
  const hasWarn = reasons.some((r) => r.severity === "WARN");
  const blockingSeverity: SignalBlockSeverity = hasFail ? "FAIL" : hasWarn ? "WARN" : "OK";

  const freshEnoughForSignal =
    input.spot.present &&
    input.spot.status === "ok" &&
    input.chain.present &&
    input.chain.status === "ok" &&
    optionChainProvider === "KITE";

  const signalAllowed = !hasFail && freshEnoughForSignal && input.sessionPresent;

  // Data-source verdict (independent of liquidity warnings)
  let dataSourceVerdict: DataSourceVerdict;
  if (!input.spot.present && !input.chain.present) {
    dataSourceVerdict = "UNAVAILABLE";
  } else if (!input.sessionPresent) {
    dataSourceVerdict = "KITE_OFFLINE";
  } else if (
    input.chain.present &&
    optionChainProvider === "KITE" &&
    input.chain.status === "ok" &&
    input.spot.present &&
    input.spot.status === "ok"
  ) {
    dataSourceVerdict = "LIVE_KITE";
  } else if (
    input.chain.present &&
    optionChainProvider === "KITE" &&
    (input.chain.status === "warn" || input.chain.status === "fail")
  ) {
    dataSourceVerdict = "KITE_STALE";
  } else {
    dataSourceVerdict = "PARTIAL";
  }

  return {
    signalAllowed,
    blockingReasons: reasons,
    blockingSeverity,
    dataSourceVerdict,
    spotProvider: deriveSpotProvider(input.spot.present, input.spot.ageMs, input.feedConnected),
    optionChainProvider,
    freshEnoughForSignal,
    missingFields: missing,
  };
}

/* ───────────────── ATM straddle / expected move (READ-ONLY) ───────────
 *
 * ATM straddle price is a DIRECT SUM of the two ATM-leg LTPs already
 * fetched for data-health — not an approximation. The expected-move fields
 * apply the standard "ATM straddle ≈ ±1σ" convention and carry an explicit
 * `formulaLabel` so the derivation is never silent. When either leg is
 * missing/invalid everything returns null with reason "UNAVAILABLE" — we
 * never fabricate a straddle.
 */

export interface AtmStraddle {
  atmStraddlePremium: number | null;
  expectedMovePoints: number | null;
  expectedMovePercent: number | null;
  formulaLabel: string | null;
  source: string | null;
  freshnessSec: number | null;
  reason: string | null;
}

export function computeAtmStraddle(input: {
  ceLtp: number | null | undefined;
  peLtp: number | null | undefined;
  spot: number | null | undefined;
  source: string | null;
  freshnessSec: number | null;
}): AtmStraddle {
  const ce = input.ceLtp;
  const pe = input.peLtp;
  const ok =
    typeof ce === "number" && Number.isFinite(ce) && ce > 0 &&
    typeof pe === "number" && Number.isFinite(pe) && pe > 0;
  if (!ok) {
    return {
      atmStraddlePremium: null,
      expectedMovePoints: null,
      expectedMovePercent: null,
      formulaLabel: null,
      source: null,
      freshnessSec: null,
      reason: "UNAVAILABLE",
    };
  }
  const straddle = round(ce + pe, 2);
  const spot = input.spot;
  const pct =
    typeof spot === "number" && Number.isFinite(spot) && spot > 0
      ? round((straddle / spot) * 100, 2)
      : null;
  return {
    atmStraddlePremium: straddle,
    expectedMovePoints: straddle,
    expectedMovePercent: pct,
    formulaLabel: "ATM straddle = ATM CE LTP + ATM PE LTP; expected move ≈ ±straddle (1σ daily convention)",
    source: input.source,
    freshnessSec: input.freshnessSec,
    reason: null,
  };
}

/* ─────────────────────────── gate waterfall ──────────────────────── */

export interface FunnelStage {
  stage: string;
  count: number;
}

export interface GateWaterfall {
  generatedAt: string;
  rowCount: number;
  windowFrom: string | null;
  windowTo: string | null;
  /** Ordered decision funnel (event-row counts, not unique signals). */
  funnel: FunnelStage[];
  /** Demotion tags that knocked HIGH_CONVICTION down to BASELINE. */
  demotionTags: Array<{ key: string; count: number }>;
  /** Pre-emission hard rejections, by setup + reason. */
  rejectionReasonsBySetup: Array<{ setupKey: string; reasonCode: string; count: number }>;
  /** Conversion rates (null when denominator is 0 — never fabricated). */
  conversion: {
    /** opened / (opened + skipped) */
    openRate: number | null;
    /** (target1 + target2) / decisive closes (target vs stop) */
    decisiveWinRate: number | null;
  };
  rowSampleType: "event_rows_not_unique_signals";
}

/**
 * Re-shape the existing reasoning analytics into an ordered gate
 * waterfall. Pure: derives everything from `a.byDecision`,
 * `a.byDemotionTag`, `a.rejectedReasonBySetup`.
 */
export function buildGateWaterfall(a: ReasoningAnalytics): GateWaterfall {
  const d = toMap(a.byDecision);
  const get = (k: string): number => d.get(k) ?? 0;

  const emitted = get("EMITTED");
  const preRej = get("PRE_EMISSION_REJECTED");
  const opened = get("OPENED");
  const skipped = get("SKIPPED");
  const t1 = get("CLOSED_TARGET1");
  const t2 = get("CLOSED_TARGET2");
  const stopped = get("CLOSED_STOPPED");
  const expired = get("CLOSED_EXPIRED");
  const force = get("CLOSED_FORCE_EXIT");
  const manual = get("CLOSED_MANUAL");

  const funnel: FunnelStage[] = [
    { stage: "EMITTED", count: emitted },
    { stage: "PRE_EMISSION_REJECTED", count: preRej },
    { stage: "OPENED", count: opened },
    { stage: "SKIPPED", count: skipped },
    { stage: "CLOSED_TARGET1", count: t1 },
    { stage: "CLOSED_TARGET2", count: t2 },
    { stage: "CLOSED_STOPPED", count: stopped },
    { stage: "CLOSED_EXPIRED", count: expired },
    { stage: "CLOSED_FORCE_EXIT", count: force },
    { stage: "CLOSED_MANUAL", count: manual },
  ];

  const openDenom = opened + skipped;
  const decisive = t1 + t2 + stopped;

  return {
    generatedAt: a.generatedAt,
    rowCount: a.rowCount,
    windowFrom: a.windowFrom,
    windowTo: a.windowTo,
    funnel,
    demotionTags: a.byDemotionTag.map((k) => ({ key: k.key, count: k.count })),
    rejectionReasonsBySetup: a.rejectedReasonBySetup.map((r) => ({
      setupKey: r.setupKey,
      reasonCode: r.reasonCode,
      count: r.count,
    })),
    conversion: {
      openRate: openDenom > 0 ? round(opened / openDenom) : null,
      decisiveWinRate: decisive > 0 ? round((t1 + t2) / decisive) : null,
    },
    rowSampleType: "event_rows_not_unique_signals",
  };
}

/* ───────────────────────── setup performance ─────────────────────── */

export interface SetupPerfRow {
  setupKey: string;
  total: number;
  emitted: number;
  opened: number;
  demoted: number;
  wins: number; // target1 + target2
  stopped: number;
  expired: number;
  /** wins / (wins + stopped) — decisive outcomes only. null when none. */
  decisiveWinRate: number | null;
  avgConfidence: number | null;
  avgConfluence: number | null;
}

export interface SetupPerformance {
  generatedAt: string;
  rowCount: number;
  windowFrom: string | null;
  windowTo: string | null;
  rows: SetupPerfRow[];
  note: string;
  rowSampleType: "event_rows_not_unique_signals";
}

/**
 * Per-setup outcome view from `a.bySetup`. Realized P&L per setup is NOT
 * derivable here (analytics only carries P&L at tier granularity) — the
 * note points the operator at the shadow-costs report for that.
 */
export function buildSetupPerformance(a: ReasoningAnalytics): SetupPerformance {
  const rows: SetupPerfRow[] = a.bySetup.map((s) => {
    const wins = s.target1 + s.target2;
    const decisive = wins + s.stopped;
    return {
      setupKey: s.setupKey,
      total: s.total,
      emitted: s.emitted,
      opened: s.opened,
      demoted: s.demoted,
      wins,
      stopped: s.stopped,
      expired: s.expired,
      decisiveWinRate: decisive > 0 ? round(wins / decisive) : null,
      avgConfidence: s.avgConfidence,
      avgConfluence: s.avgConfluence,
    };
  });
  rows.sort((x, y) => y.opened - x.opened || y.total - x.total || x.setupKey.localeCompare(y.setupKey));

  return {
    generatedAt: a.generatedAt,
    rowCount: a.rowCount,
    windowFrom: a.windowFrom,
    windowTo: a.windowTo,
    rows,
    note:
      "Decisive win-rate = (target1+target2) / (targets+stops); EXPIRED and " +
      "force/manual closes are excluded from the denominator. Realized P&L " +
      "per setup is not available at this granularity — see " +
      "/api/paper/analytics/fo/shadow-costs for gross/net P&L by setup.",
    rowSampleType: "event_rows_not_unique_signals",
  };
}

/* ───────────────────────── no-trade reasons ──────────────────────── */

export interface MissedLite {
  indexSymbol: string;
  skipReason?: string | null;
  tier?: string | null;
}

export interface NoTradeReasons {
  generatedAt: string;
  /** Durable, persisted in fno_signal_reasoning. */
  durable: {
    source: "fno_signal_reasoning";
    rejectionReasonsBySetup: Array<{ setupKey: string; reasonCode: string; count: number }>;
    demotionTags: Array<{ key: string; count: number }>;
    rowCount: number;
    windowFrom: string | null;
    windowTo: string | null;
  };
  /** Ephemeral, process-local ring buffer (lost on restart). */
  ephemeral: {
    source: "in_memory_missed_signal_ring";
    total: number;
    byReason: Array<{ key: string; count: number }>;
    byIndex: Array<{ key: string; count: number }>;
    byTier: Array<{ key: string; count: number }>;
  };
  note: string;
}

function sortDesc(rec: Record<string, number>): Array<{ key: string; count: number }> {
  return Object.entries(rec)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, count]) => ({ key, count }));
}

/**
 * Merge durable rejection/demotion records (from analytics) with the
 * ephemeral missed-signal ring, each tagged with explicit provenance so
 * the operator never confuses persisted history with restart-volatile
 * state.
 */
export function buildNoTradeReasons(
  a: ReasoningAnalytics,
  missed: ReadonlyArray<MissedLite>,
): NoTradeReasons {
  const byReason: Record<string, number> = {};
  const byIndex: Record<string, number> = {};
  const byTier: Record<string, number> = {};
  for (const m of missed) {
    const r = m.skipReason ?? "UNKNOWN";
    byReason[r] = (byReason[r] ?? 0) + 1;
    byIndex[m.indexSymbol] = (byIndex[m.indexSymbol] ?? 0) + 1;
    const t = m.tier ?? "UNKNOWN";
    byTier[t] = (byTier[t] ?? 0) + 1;
  }

  return {
    generatedAt: a.generatedAt,
    durable: {
      source: "fno_signal_reasoning",
      rejectionReasonsBySetup: a.rejectedReasonBySetup.map((r) => ({
        setupKey: r.setupKey,
        reasonCode: r.reasonCode,
        count: r.count,
      })),
      demotionTags: a.byDemotionTag.map((k) => ({ key: k.key, count: k.count })),
      rowCount: a.rowCount,
      windowFrom: a.windowFrom,
      windowTo: a.windowTo,
    },
    ephemeral: {
      source: "in_memory_missed_signal_ring",
      total: missed.length,
      byReason: sortDesc(byReason),
      byIndex: sortDesc(byIndex),
      byTier: sortDesc(byTier),
    },
    note:
      "Durable rejections/demotions persist in the fno_signal_reasoning " +
      "audit table and survive restarts. The ephemeral ring is process-local " +
      "and resets on every server restart; counts are not directly comparable.",
  };
}
