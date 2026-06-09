/**
 * Consolidating F&O diagnostics namespace `/api/fno/*` (READ-ONLY,
 * additive — 2026-06-05).
 *
 * Owner-only operator views that DELEGATE to existing real data sources:
 *   - `fno_signal_reasoning` audit analytics (fnoReasoningAnalytics.ts)
 *   - Kite session / WebSocket feed health (kiteAuth, kiteFeed)
 *   - live index quotes + option chain + option analytics
 *   - the in-process missed-signal ring (paperTradingFO)
 *   - reasoning-logger health counters
 *
 * Zero new analytics math (pure re-shaping lives in
 * fnoDiagnosticsFacade.ts). Does NOT change signal generation, gates,
 * sizing, execution, scheduler, Kite auth, scanner, swing, paper
 * equity/F&O writes, schema, or auto-trading. Mirrors the existing
 * `/paper/diagnostics/*` convention (raw res.json, not OpenAPI-typed).
 */

import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, paperTradeFoTable } from "@workspace/db";
import { requireOwner } from "../lib/userAuth";
import {
  analyticsFiltersFromQuery,
  fetchReasoningRows,
  computeReasoningAnalytics,
  buildBlockedSignalsReview,
  resolveBlockedWindow,
  BLOCKED_EVENTS_DEFAULT_CAP,
} from "../lib/fnoReasoningAnalytics";
import {
  buildGateWaterfall,
  buildSetupPerformance,
  buildNoTradeReasons,
  classifyFreshness,
  atmSpreadPct,
  deriveSignalReadiness,
  computeAtmStraddle,
  type HealthSeverity,
} from "../lib/fnoDiagnosticsFacade";
import { FNO_LIQUIDITY } from "../lib/paperAccount";
import { getMissedSignals } from "../lib/paperTradingFO";
import { getEnvironmentLabel } from "../lib/paperAutoTradeFlag";
import { getReasoningLoggerHealth } from "../lib/fnoSignalReasoningLogger";
import { feedStatus } from "../lib/kiteFeed";
import { getActiveSession, getKiteCreds } from "../lib/kiteAuth";
import { getKiteIndexQuotes } from "../lib/kiteIndexQuotes";
import { fetchOptionChain } from "../lib/optionChain";
import { computeAnalytics } from "../lib/optionAnalytics";
import { OPTION_INDICES } from "../lib/optionSignals";
import { istDateOf } from "../lib/paperDailySummaryFo";

const router: IRouter = Router();

/* Freshness thresholds (ms). Spot ticks should be sub-15s during market
 * hours; option-chain caches refresh on a 15-30s cadence so a 60s warn /
 * 5min fail band is generous and avoids false alarms when the market is
 * closed (stale-but-expected). */
const SPOT_WARN_MS = 15_000;
const SPOT_FAIL_MS = 60_000;
const CHAIN_WARN_MS = 60_000;
const CHAIN_FAIL_MS = 300_000;

async function loadAnalytics(rawQuery: Record<string, unknown>) {
  const filters = analyticsFiltersFromQuery(rawQuery);
  const rows = await fetchReasoningRows(filters);
  return { filters, analytics: computeReasoningAnalytics(rows) };
}

/**
 * GET /fno/data-health — single F&O-scoped live health snapshot.
 *
 * Consolidates Kite session/feed status, per-index spot + option-chain
 * freshness, ATM-leg liquidity, and market-context analytics (PCR, max
 * pain, ATM IV, bias) that today require hitting several endpoints. Every
 * section fails soft and explicitly labels unavailable/stale data.
 *
 * Optional `?index=NIFTY` scopes to one index.
 */
router.get("/fno/data-health", requireOwner, async (req, res, next) => {
  try {
    const now = Date.now();
    const creds = getKiteCreds();
    const session = await getActiveSession().catch(() => null);
    const feed = feedStatus();

    const kite = {
      credsConfigured: !!creds,
      session: session
        ? {
            present: true as const,
            user: session.userName ?? session.userId ?? null,
            loginTime: session.loginTime?.toISOString() ?? null,
            expiresAt: session.expiresAt?.toISOString() ?? null,
            minsToExpiry: session.expiresAt
              ? Math.floor((new Date(session.expiresAt).getTime() - now) / 60000)
              : null,
          }
        : { present: false as const },
      feed,
    };

    const wanted = typeof req.query["index"] === "string" ? req.query["index"].toUpperCase() : null;
    const indices = OPTION_INDICES.filter((c) => !wanted || c.symbol === wanted);
    const quotes = await getKiteIndexQuotes().catch(() => null);

    const perIndex = await Promise.all(
      indices.map(async (cfg) => {
        const q = quotes?.get(cfg.yahoo) ?? null;
        const spotAgeMs = q ? now - q.asOf : null;
        const spotStatus: HealthSeverity = q
          ? classifyFreshness(spotAgeMs, SPOT_WARN_MS, SPOT_FAIL_MS)
          : "unavailable";

        let chain:
          | { status: HealthSeverity; reason: string }
          | Record<string, unknown>;
        // Captured for the read-only signal-readiness + straddle helpers.
        let chainPresent = false;
        let chainStatus: HealthSeverity = "unavailable";
        let chainSource: string | null = null;
        let chainAgeSec: number | null = null;
        let atmCe: { ltp: number | null; oi: number | null; spreadPct: number | null } | null = null;
        let atmPe: { ltp: number | null; oi: number | null; spreadPct: number | null } | null = null;
        let atmPresent = false;
        try {
          const oc = await fetchOptionChain(cfg.symbol);
          if (!oc) {
            chain = { status: "unavailable" as HealthSeverity, reason: "option chain fetch returned null" };
          } else {
            const genMs = Date.parse(oc.generatedAt);
            const chainAgeMs = Number.isFinite(genMs) ? now - genMs : null;
            const atmRow = oc.rows.find((r) => r.strike === oc.atmStrike) ?? null;
            let analytics: Record<string, unknown> | null = null;
            try {
              const an = computeAnalytics(oc);
              analytics = {
                pcrOi: an.pcrOi,
                pcrVolume: an.pcrVolume,
                maxPain: an.maxPain,
                atmIv: an.atmIv,
                bias: an.bias,
                confidenceScore: an.confidenceScore,
              };
            } catch {
              analytics = null;
            }
            chainPresent = true;
            chainStatus = classifyFreshness(chainAgeMs, CHAIN_WARN_MS, CHAIN_FAIL_MS);
            chainSource = oc.source;
            chainAgeSec = chainAgeMs != null ? Math.round(chainAgeMs / 1000) : null;
            if (atmRow) {
              atmPresent = true;
              atmCe = { oi: atmRow.ce?.oi ?? null, ltp: atmRow.ce?.ltp ?? null, spreadPct: atmSpreadPct(atmRow.ce) };
              atmPe = { oi: atmRow.pe?.oi ?? null, ltp: atmRow.pe?.ltp ?? null, spreadPct: atmSpreadPct(atmRow.pe) };
            }
            chain = {
              status: chainStatus,
              source: oc.source,
              generatedAt: oc.generatedAt,
              ageSec: chainAgeSec,
              expiry: oc.expiry,
              atmStrike: oc.atmStrike,
              rowCount: oc.rows.length,
              atmLeg: atmPresent ? { ce: atmCe, pe: atmPe } : null,
              analytics,
            };
          }
        } catch (e) {
          chain = {
            status: "unavailable" as HealthSeverity,
            reason: e instanceof Error ? e.message : "chain fetch failed",
          };
        }

        // Read-only verdict + ATM straddle/expected-move (consumed by NO
        // trading path — operator visibility only).
        const readiness = deriveSignalReadiness(
          {
            sessionPresent: kite.session.present,
            feedConnected: feed.connected,
            spot: { present: !!q, ageMs: spotAgeMs, status: spotStatus },
            chain: {
              present: chainPresent,
              status: chainStatus,
              source: chainSource,
              atm: atmPresent ? { ce: atmCe, pe: atmPe } : null,
            },
          },
          {
            minOptionLtp: FNO_LIQUIDITY.MIN_OPTION_LTP,
            minOptionOi: FNO_LIQUIDITY.MIN_OPTION_OI,
            maxSpreadPct: FNO_LIQUIDITY.MAX_BID_ASK_SPREAD_PCT * 100,
          },
        );
        const expectedMove = computeAtmStraddle({
          ceLtp: atmCe?.ltp ?? null,
          peLtp: atmPe?.ltp ?? null,
          spot: q?.price ?? null,
          source: chainSource,
          freshnessSec: chainAgeSec,
        });

        return {
          indexSymbol: cfg.symbol,
          display: cfg.display,
          spot: q
            ? {
                status: spotStatus,
                price: q.price,
                asOf: new Date(q.asOf).toISOString(),
                ageSec: spotAgeMs != null ? Math.round(spotAgeMs / 1000) : null,
              }
            : { status: "unavailable" as HealthSeverity, reason: "no live index quote" },
          chain,
          // ── READ-ONLY signal-readiness verdict (additive) ──
          signalAllowed: readiness.signalAllowed,
          blockingReasons: readiness.blockingReasons,
          blockingSeverity: readiness.blockingSeverity,
          dataSourceVerdict: readiness.dataSourceVerdict,
          spotProvider: readiness.spotProvider,
          optionChainProvider: readiness.optionChainProvider,
          freshEnoughForSignal: readiness.freshEnoughForSignal,
          missingFields: readiness.missingFields,
          expectedMove,
        };
      }),
    );

    return res.json({
      generatedAt: new Date().toISOString(),
      environment: getEnvironmentLabel(),
      universe: OPTION_INDICES.map((c) => c.symbol),
      kite,
      perIndex,
      reasoningLogger: getReasoningLoggerHealth(),
      note:
        "Read-only F&O data-source health. ATM option-leg liquidity shown here " +
        "is informational; the binding liquidity gate (FNO_LIQUIDITY: LTP>=20, " +
        "spread<=1.5%, OI>=50k) is enforced at trade time, not from this view.",
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /fno/diagnostics/today — today's (IST) F&O operating snapshot:
 * decisions funnel, demotions, no-trade reasons, open positions, and
 * logger health, in one call.
 */
router.get("/fno/diagnostics/today", requireOwner, async (_req, res, next) => {
  try {
    const today = istDateOf();
    const filters = analyticsFiltersFromQuery({ from: today, to: today, limit: 10000 });
    const analytics = computeReasoningAnalytics(await fetchReasoningRows(filters));
    const waterfall = buildGateWaterfall(analytics);
    const noTrade = buildNoTradeReasons(analytics, getMissedSignals());
    const openRows = await db
      .select()
      .from(paperTradeFoTable)
      .where(eq(paperTradeFoTable.status, "OPEN"));

    return res.json({
      generatedAt: new Date().toISOString(),
      signalDate: today,
      environment: getEnvironmentLabel(),
      decisions: analytics.byDecision,
      funnel: waterfall.funnel,
      conversion: waterfall.conversion,
      demotionTags: analytics.byDemotionTag,
      noTradeReasons: noTrade,
      openPositions: {
        count: openRows.length,
        indices: openRows.map((r) => r.indexSymbol),
      },
      reasoningLogger: getReasoningLoggerHealth(),
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /fno/diagnostics/gate-waterfall — ordered decision funnel +
 * demotion/rejection breakdown. Accepts the standard reasoning-analytics
 * filters (index, setup, direction, tier, decision, reason, regime,
 * from, to, latestN).
 */
router.get("/fno/diagnostics/gate-waterfall", requireOwner, async (req, res, next) => {
  try {
    const { filters, analytics } = await loadAnalytics(req.query as Record<string, unknown>);
    return res.json({ filters, waterfall: buildGateWaterfall(analytics) });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /fno/diagnostics/no-trade-reasons — durable (persisted) rejections
 * and demotions merged with the ephemeral (process-local) missed-signal
 * ring, each tagged with explicit provenance.
 */
router.get("/fno/diagnostics/no-trade-reasons", requireOwner, async (req, res, next) => {
  try {
    const { filters, analytics } = await loadAnalytics(req.query as Record<string, unknown>);
    return res.json({ filters, noTradeReasons: buildNoTradeReasons(analytics, getMissedSignals()) });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /fno/diagnostics/setup-performance — per-setup outcome view
 * (emitted/opened/wins/stops/expiry + decisive win-rate + avg
 * confidence/confluence). Realized P&L per setup is intentionally not
 * here — see /paper/analytics/fo/shadow-costs.
 */
router.get("/fno/diagnostics/setup-performance", requireOwner, async (req, res, next) => {
  try {
    const { filters, analytics } = await loadAnalytics(req.query as Record<string, unknown>);
    return res.json({ filters, setupPerformance: buildSetupPerformance(analytics) });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /fno/diagnostics/blocked-signals — the BLOCKED / DEMOTED population
 * (Task #117). Isolates signals demoted to INFO_ONLY and those carrying the
 * 2026-06-09 hygiene vetoes (RECOVERY_MODE_VETO / CHASE_RISK_VETO) so the
 * owner can judge across sessions whether the vetoes are correctly blocking
 * bad trades or are too strict. Read-only / diagnostics-only.
 *
 * Defaults to the last `days` (7, ~5 sessions) ending today IST when no
 * explicit `from`/`to` is supplied. Accepts the standard analytics filters
 * plus `days` (≤60) and `cap` (event-list cap).
 */
router.get("/fno/diagnostics/blocked-signals", requireOwner, async (req, res, next) => {
  try {
    const raw = { ...(req.query as Record<string, unknown>) };
    const window = resolveBlockedWindow(raw, istDateOf());
    raw.from = window.from;
    raw.to = window.to;
    if (raw.latestN == null && raw.limit == null) raw.latestN = 10000;
    const filters = analyticsFiltersFromQuery(raw);
    const rows = await fetchReasoningRows(filters);
    const capN = Number((req.query as Record<string, unknown>).cap);
    const cap = Number.isFinite(capN) && capN > 0 ? Math.floor(capN) : BLOCKED_EVENTS_DEFAULT_CAP;
    return res.json({ filters, blocked: buildBlockedSignalsReview(rows, cap) });
  } catch (err) {
    return next(err);
  }
});

export default router;
