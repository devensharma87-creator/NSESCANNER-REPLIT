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
} from "../lib/fnoReasoningAnalytics";
import {
  buildGateWaterfall,
  buildSetupPerformance,
  buildNoTradeReasons,
  classifyFreshness,
  atmSpreadPct,
  type HealthSeverity,
} from "../lib/fnoDiagnosticsFacade";
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

        let chain:
          | { status: HealthSeverity; reason: string }
          | Record<string, unknown>;
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
            chain = {
              status: classifyFreshness(chainAgeMs, CHAIN_WARN_MS, CHAIN_FAIL_MS),
              source: oc.source,
              generatedAt: oc.generatedAt,
              ageSec: chainAgeMs != null ? Math.round(chainAgeMs / 1000) : null,
              expiry: oc.expiry,
              atmStrike: oc.atmStrike,
              rowCount: oc.rows.length,
              atmLeg: atmRow
                ? {
                    ce: { oi: atmRow.ce?.oi ?? null, ltp: atmRow.ce?.ltp ?? null, spreadPct: atmSpreadPct(atmRow.ce) },
                    pe: { oi: atmRow.pe?.oi ?? null, ltp: atmRow.pe?.ltp ?? null, spreadPct: atmSpreadPct(atmRow.pe) },
                  }
                : null,
              analytics,
            };
          }
        } catch (e) {
          chain = {
            status: "unavailable" as HealthSeverity,
            reason: e instanceof Error ? e.message : "chain fetch failed",
          };
        }

        return {
          indexSymbol: cfg.symbol,
          display: cfg.display,
          spot: q
            ? {
                status: classifyFreshness(spotAgeMs, SPOT_WARN_MS, SPOT_FAIL_MS),
                price: q.price,
                asOf: new Date(q.asOf).toISOString(),
                ageSec: spotAgeMs != null ? Math.round(spotAgeMs / 1000) : null,
              }
            : { status: "unavailable" as HealthSeverity, reason: "no live index quote" },
          chain,
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

export default router;
