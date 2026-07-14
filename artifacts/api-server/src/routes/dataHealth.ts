/**
 * Data-health routes:
 *
 * GET /api/data-health/market   — PUBLIC, MarketDataHealth (session + feed + market)
 * GET /api/data-health/global   — PUBLIC, GlobalDataHealth (unified global contract)
 * GET /api/data-health/backbone — OWNER-ONLY, BackboneReport (per-module readiness)
 *
 * SAFETY (all routes):
 *   - No secrets, API keys, access tokens, chat IDs, or user PII.
 *   - No trading mutations.
 *   - Reads existing in-process state only (no new DB or network calls beyond
 *     what getKiteReadiness() / getActiveSession() already do in the chain).
 */
import { Router, type IRouter } from "express";
import { buildMarketDataHealth } from "../lib/marketDataHealth";
import { buildBackboneReport } from "../lib/backboneHealth";
import { buildGlobalDataHealth } from "../lib/globalDataHealth";
import { requireOwnerStrict } from "../lib/userAuth";

const router: IRouter = Router();

router.get("/data-health/market", async (req, res) => {
  try {
    const health = await buildMarketDataHealth();
    res.json(health);
  } catch (err) {
    req.log.error({ err }, "data-health/market failed");
    res.status(500).json({ error: "health check failed" });
  }
});

/**
 * GET /api/data-health/global — PUBLIC unified GlobalDataHealth contract.
 *
 * Single endpoint covering session, feed, market session, and per-module
 * readiness. Safe for public access — no secrets, no tokens, no API keys,
 * no user PII. Boolean `accessTokenPresent` instead of the raw token.
 *
 * Consumed by:
 *   - GlobalStatusBanner (DATA_DEGRADED chip)
 *   - Infra Health page — GlobalHealthSection
 */
router.get("/data-health/global", async (req, res) => {
  try {
    const health = await buildGlobalDataHealth();
    res.json(health);
  } catch (err) {
    req.log.error({ err }, "data-health/global failed");
    res.status(500).json({ error: "global health check failed" });
  }
});

/**
 * GET /api/data-health/backbone — OWNER-ONLY unified backbone health roll-up.
 *
 * Per-module data readiness ("given what F&O / swing / option-chain / … each
 * REQUIRE, is their data actually trade-grade right now?"), composed from
 * existing in-process state only (no new network). No secrets, no mutations.
 */
router.get("/data-health/backbone", requireOwnerStrict, async (req, res) => {
  try {
    const report = await buildBackboneReport();
    res.json(report);
  } catch (err) {
    req.log.error({ err }, "data-health/backbone failed");
    res.status(500).json({ error: "backbone health check failed" });
  }
});

export default router;
