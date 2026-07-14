import { Router, type IRouter } from "express";
import { fetchOptionChain } from "../lib/optionChain";
import { computeAnalytics, type OptionAnalytics } from "../lib/optionAnalytics";
import {
  buildStrategies,
  buildCustomStrategy,
  type StrategyBundle,
  type CustomLegSpec,
  type CustomScenario,
} from "../lib/optionStrategies";
import { computeLiveBias } from "../lib/liveBias";
import { computeMarketStatus } from "../lib/marketEvents";
import { getActiveSession } from "../lib/kiteAuth";
import { requireSubscriberOrOwner } from "../lib/userAuth";
import { logger } from "../lib/logger";
import { PostOptionStrategyCustomBody } from "@workspace/api-zod";

const router: IRouter = Router();

// Strategies tab is gated by the STRATEGIES tab — owner always allowed, plus
// active subscribers granted the tab via /admin/users.
// Path-scoped to /options/strategies/* (only route in this router).
router.use("/options/strategies", requireSubscriberOrOwner("STRATEGIES"));

// ─── Bundle-level cache ─────────────────────────────────────────────────────
// Building 13 strategies × Black-Scholes × 201 payoff samples × IV solver
// takes 80-200ms per call. The frontend polls every 30s, but the underlying
// option chain (`fetchOptionChain`) is itself cached for 30s — so back-to-back
// requests for the same underlying within the chain-cache window get
// IDENTICAL chain data and produce IDENTICAL bundles.
//
// We dedupe with a 5s TTL keyed on the chain timestamp. This is short enough
// that any chain refresh propagates immediately, and long enough that a tab
// switch + immediate refetch hits the cache cleanly.
interface CachedBundle { ts: number; chainTs: number; payload: StrategyBundle & { analytics: OptionAnalytics } }
const bundleCache = new Map<string, CachedBundle>();
const BUNDLE_TTL_MS = 5_000;

router.get("/options/strategies/:underlying", async (req, res): Promise<void> => {
  const underlying = String(req.params.underlying ?? "").trim();
  const expiry = typeof req.query.expiry === "string" ? req.query.expiry : undefined;
  if (!underlying) { res.status(400).json({ error: "underlying required" }); return; }

  try {
    const chain = await fetchOptionChain(underlying, expiry);
    if (!chain) {
      const kiteSession = await getActiveSession().catch(() => null);
      const detail = kiteSession
        ? `Both data sources returned no chain for ${underlying}. Either the symbol is not in NSE's F&O list, or your Kite session has expired (Kite tokens expire daily at ~07:30 IST). Try re-authenticating from the Live Feed page.`
        : `Live data is currently unavailable. NSE's option-chain API silently rejects non-Indian cloud IPs, and no Kite Connect session is active. Authenticate from the Live Feed page (works from any IP) to enable strategies.`;
      res.status(503).json({
        error: "Option chain unavailable",
        detail,
        kiteAuthenticated: !!kiteSession,
        underlying,
      });
      return;
    }

    const cacheKey = `${underlying.toUpperCase()}:${expiry ?? "_"}`;
    // `generatedAt` is set by `fetchOptionChain` whenever it produces a fresh
    // chain payload (either NSE or Kite source). Two calls within the chain's
    // 30s cache window return the SAME `generatedAt`, so this is the right
    // signal to dedupe Black-Scholes work on.
    const chainTs = chain.generatedAt ? Date.parse(chain.generatedAt) : 0;
    const cached = bundleCache.get(cacheKey);
    // Cache hit only when the chain itself is unchanged AND the bundle is
    // young enough — protects against quietly serving stale strategy math
    // even if `chainTs` happens to lag.
    if (cached && cached.chainTs === chainTs && Date.now() - cached.ts < BUNDLE_TTL_MS) {
      res.json(cached.payload);
      return;
    }

    const analytics = computeAnalytics(chain);
    {
      const { enrichAnalyticsWithIv } = await import("../lib/ivHistory");
      const ivMetrics = await enrichAnalyticsWithIv(analytics);
      analytics.ivRank = ivMetrics.ivRank;
      analytics.ivPercentile = ivMetrics.ivPercentile;
    }
    // Live intraday read for the underlying — Kite-first 15-min candles
    // (no Yahoo 15-min delay) for both indices and equity F&O. The blended
    // bias inside `buildStrategies` combines this with the option-chain's
    // structural bias so recommendations reflect *current* market action,
    // not just carry-over option positioning. Returns null when intraday
    // is unavailable; the builder falls through to structural-bias-only.
    const liveBias = await computeLiveBias(underlying, chain.kind).catch(err => {
      req.log.warn({ err: (err as Error).message, underlying }, "Live bias fetch failed — falling back to structural bias");
      return null;
    });
    const marketStatus = computeMarketStatus(new Date());
    const bundle = buildStrategies(chain, analytics, { liveBias, marketStatus });
    const payload = { ...bundle, analytics };
    bundleCache.set(cacheKey, { ts: Date.now(), chainTs, payload });
    res.json(payload);
  } catch (err) {
    logger.error({ err: (err as Error).message, underlying }, "Strategies handler crashed");
    res.status(500).json({ error: "Internal error building strategies" });
  }
});

// ─── POST /options/strategies/:underlying/custom ───────────────────────────
// Free-form strategy builder. Body: { expiry?, legs: CustomLegSpec[],
// scenarios?: CustomScenario[] }. Returns a single composed snapshot built
// from the user's legs + per-scenario re-prices. Reuses the same chain
// fetch + IV enrichment + `buildCustomStrategy` math the GET endpoint uses.
router.post("/options/strategies/:underlying/custom", async (req, res): Promise<void> => {
  const underlying = String(req.params.underlying ?? "").trim();
  if (!underlying) { res.status(400).json({ error: "underlying required" }); return; }

  // Strict OpenAPI/Zod validation — no silent coercion. Bad input is
  // rejected with the first parse error so the client can correct it.
  const parsed = PostOptionStrategyCustomBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first?.path?.join(".") || "body";
    res.status(400).json({ error: `Invalid request: ${path}: ${first?.message ?? "invalid"}` });
    return;
  }
  const expiry = parsed.data.expiry;
  const legs = parsed.data.legs as unknown as CustomLegSpec[];
  const scenarios = (parsed.data.scenarios ?? []) as unknown as CustomScenario[];

  try {
    const chain = await fetchOptionChain(underlying, expiry);
    if (!chain) {
      const kiteSession = await getActiveSession().catch(() => null);
      res.status(503).json({
        error: "Option chain unavailable",
        detail: kiteSession
          ? `Both data sources returned no chain for ${underlying}. Try re-authenticating Kite from the Live Feed page.`
          : "Live data unavailable and no Kite session is active. Authenticate from the Live Feed page.",
        kiteAuthenticated: !!kiteSession,
        underlying,
      });
      return;
    }

    const analytics = computeAnalytics(chain);
    {
      const { enrichAnalyticsWithIv } = await import("../lib/ivHistory");
      const ivMetrics = await enrichAnalyticsWithIv(analytics);
      analytics.ivRank = ivMetrics.ivRank;
      analytics.ivPercentile = ivMetrics.ivPercentile;
    }

    const result = buildCustomStrategy(chain, analytics, legs, { scenarios });
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json(result.response);
  } catch (err) {
    logger.error({ err: (err as Error).message, underlying }, "Custom strategy builder crashed");
    res.status(500).json({ error: "Internal error building custom strategy" });
  }
});

export default router;
