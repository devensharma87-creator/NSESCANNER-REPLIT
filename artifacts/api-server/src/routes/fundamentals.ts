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
 *
 * Gate A/B/C/E (23B): INVALID_PROVIDER_CONFIG state; single /stock endpoint;
 * capability-gated; exported handler for direct route testing.
 */

import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import {
  isIndianApiConfigured,
  getFundamentals,
  indianApiHealth,
} from "../lib/marketData/indianApiProvider";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Handler (exported for unit testing without HTTP stack)
// ---------------------------------------------------------------------------

export async function handleGetFundamentals(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const symbol    = String(req.params["symbol"] ?? "").toUpperCase().trim();
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

    const health = indianApiHealth();

    // Fast-path: INVALID_PROVIDER_CONFIG — return sanitized state, zero provider calls
    if (health.configState === "INVALID_PROVIDER_CONFIG") {
      res.json({
        ok:            false,
        symbol,
        fetchedAt,
        providerState: "INVALID_PROVIDER_CONFIG",
        plan:          health.plan,       // plan name is safe to surface (may be null on fully invalid config)
        profile:       null,
        ratios:        null,
        warnings:      ["IndianAPI provider configuration is invalid. Check INDIANAPI_PLAN and INDIANAPI_BASE_URL."],
        meta:          buildUnavailableMeta(fetchedAt, ["INVALID_PROVIDER_CONFIG"]),
      });
      return;
    }

    // Fast-path: NOT_CONFIGURED — clean HTTP 200 with descriptive state
    if (!isIndianApiConfigured()) {
      const health = indianApiHealth();
      void health; // used for diagnostics in future
      res.json({
        ok:            false,
        symbol,
        fetchedAt,
        providerState: "NOT_CONFIGURED",
        plan:          null,
        profile:       null,
        ratios:        null,
        warnings:      ["IndianAPI key absent — fundamentals unavailable."],
        meta:          buildUnavailableMeta(fetchedAt, ["IndianAPI not configured."]),
      });
      return;
    }

    // Single /stock call via getFundamentals
    const result = await getFundamentals(symbol);

    if (!result.ok) {
      // Distinguish RATE_LIMITED from generic errors for the UI
      const isRateLimited = result.reason === "RATE_LIMITED"
        || (result.reason ?? "").toLowerCase().includes("rate_limit");

      res.json({
        ok:            false,
        symbol,
        fetchedAt,
        providerState: isRateLimited ? "RATE_LIMITED" : (result.reason ?? "ERROR"),
        plan:          health.plan,
        profile:       null,
        ratios:        null,
        warnings:      result.meta.warnings ?? [],
        meta:          buildUnavailableMeta(fetchedAt, result.meta.warnings ?? []),
      });
      return;
    }

    const warnings: string[] = (result.meta.warnings ?? []);
    const uniqueWarnings = [...new Set(warnings)];

    res.json({
      ok:            true,
      symbol,
      fetchedAt,
      providerState: "AVAILABLE",
      plan:          health.plan,  // plan name is safe to surface; never expose key
      profile:       result.profile,
      ratios:        result.ratios,
      providerAsOf:  result.providerAsOf ?? null,
      warnings:      uniqueWarnings,
      meta: {
        source:               "indianapi",
        trustTier:            "secondary_analytics",
        asOf:                 result.providerAsOf ?? fetchedAt,
        fetchedAt,
        notForSignals:        true,
        notForTradeDecisions: true,
        validationStatus:     "validated",
        warnings:             uniqueWarnings,
      },
    });
  } catch (err) {
    next(err);
  }
}

// Register route
router.get("/data/fundamentals/:symbol", handleGetFundamentals);

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
