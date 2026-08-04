/**
 * Gate E — Canonical IndianAPI fundamentals endpoint.
 *
 * GET /data/fundamentals/:symbol
 *
 * Owner-only (via parent router.use("/data", requireOwner)).
 * Returns company profile and financial ratios from IndianAPI.
 * All nulls preserved — never fabricated. No raw upstream error body exposed.
 * Never exposes the API key, plan details beyond plan name, or upstream URLs.
 *
 * UI must never call IndianAPI directly — this is the single canonical server path.
 */

import { Router, type IRouter } from "express";
import {
  isIndianApiConfigured,
  getStockProfile,
  getStockRatios,
  indianApiHealth,
} from "../lib/marketData/indianApiProvider";
import type { DataMeta } from "../lib/marketData/types";

const router: IRouter = Router();

// GET /data/fundamentals/:symbol
router.get("/data/fundamentals/:symbol", async (req, res, next) => {
  try {
    const symbol   = (req.params["symbol"] ?? "").toUpperCase().trim();
    const fetchedAt = new Date().toISOString();

    if (!symbol || !/^[A-Z0-9.&-]{1,20}$/.test(symbol)) {
      res.status(400).json({
        ok:     false,
        error:  "INVALID_SYMBOL",
        symbol: symbol || null,
        fetchedAt,
      });
      return;
    }

    // Fast-path: report NOT_CONFIGURED cleanly without HTTP 500
    if (!isIndianApiConfigured()) {
      const health = indianApiHealth();
      res.json({
        ok:          false,
        symbol,
        fetchedAt,
        providerState: "NOT_CONFIGURED",
        // plan is always safe to surface
        plan:        null,
        profile:     null,
        ratios:      null,
        warnings:    ["IndianAPI key absent — fundamentals unavailable."],
        meta: buildUnavailableMeta(fetchedAt, ["IndianAPI not configured."]),
      });
      return;
    }

    // Parallel fetch — profile and ratios are independent
    const [profileResult, ratiosResult] = await Promise.all([
      getStockProfile(symbol),
      getStockRatios(symbol),
    ]);

    // Determine overall state
    const providerState = profileResult.ok && ratiosResult.ok
      ? "AVAILABLE"
      : (!profileResult.ok ? (profileResult.reason ?? "ERROR") : (ratiosResult.reason ?? "ERROR"));

    const warnings: string[] = [
      ...(profileResult.meta.warnings ?? []),
      ...(ratiosResult.meta.warnings ?? []),
    ];
    const uniqueWarnings = [...new Set(warnings)];

    // Build canonical response — nulls always preserved
    res.json({
      ok:          profileResult.ok || ratiosResult.ok,
      symbol,
      fetchedAt,
      providerState,
      plan:        "INDIVIDUAL", // safe to surface; never expose key
      profile:     profileResult.ok ? profileResult.data ?? null : null,
      ratios:      ratiosResult.ok  ? ratiosResult.data  ?? null : null,
      warnings:    uniqueWarnings,
      meta: {
        source:               "indianapi",
        trustTier:            "secondary_analytics",
        asOf:                 profileResult.meta.asOf ?? fetchedAt,
        fetchedAt,
        notForSignals:        true,
        notForTradeDecisions: true,
        validationStatus:     profileResult.ok ? "validated" : "unavailable",
        warnings:             uniqueWarnings,
      } satisfies Partial<DataMeta> & Record<string, unknown>,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildUnavailableMeta(fetchedAt: string, warnings: string[]): Record<string, unknown> {
  return {
    source:               "indianapi",
    trustTier:            "secondary_analytics",
    asOf:                 null,
    fetchedAt,
    notForSignals:        true,
    notForTradeDecisions: true,
    validationStatus:     "unavailable",
    warnings,
  };
}

export default router;
