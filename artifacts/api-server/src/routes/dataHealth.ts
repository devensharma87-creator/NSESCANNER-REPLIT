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
import {
  getActiveGenerationAuthority,
  getRegistryRestorationDiagnostics,
} from "../lib/registry/manifestStore";

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

/**
 * GET /api/data-health/registry — OWNER-ONLY instrument-registry boot state.
 *
 * PHASE 0.7B. Reports what the boot-time restoration actually concluded:
 * whether it has settled, which durable layer answered, the generation identity
 * and record count that were verified, whether that generation may speak for
 * NOW (integrity and current authority are separate facts), and the machine
 * readable blocker code when it may not.
 *
 * Pure in-memory read — no DB query, no provider call, no mutation. Carries no
 * manifest payload, no record contents and no credentials.
 */
router.get("/data-health/registry", requireOwnerStrict, (req, res) => {
  try {
    const restoration = getRegistryRestorationDiagnostics();
    const { authority, mayAuthorize } = getActiveGenerationAuthority();
    res.json({
      restoration,
      // Re-evaluated at read time; it expires at a calendar boundary, not on a
      // timer, so this is deliberately not the same fact as `restoration.state`.
      currentAuthority: {
        state: authority?.state ?? null,
        mayAuthorize,
        reasons: authority?.reasons ?? [],
        evaluatedAt: authority ? new Date(authority.evaluatedAtMs).toISOString() : null,
      },
    });
  } catch (err) {
    req.log.error({ err }, "data-health/registry failed");
    res.status(500).json({ error: "registry health check failed" });
  }
});

export default router;
