/**
 * Pack 5 — Provider Diagnostics Route
 *
 * Owner-only. Exposes safe configuration/capability/parity state for all
 * canonical providers. NEVER exposes tokens, keys, raw credential URLs,
 * account identifiers, or complete upstream error bodies.
 *
 * Endpoints:
 *   GET /api/providers/diagnostics     — full capability + shadow state snapshot
 *   GET /api/providers/shadow-parity   — shadow comparison sample summary
 *   GET /api/providers/indianapi/capabilities — IndianAPI capability manifest
 *   POST /api/providers/probe           — owner-triggered connectivity probe
 */

import { Router, type IRouter } from "express";
import { requireOwnerStrict } from "../lib/userAuth";
import { getProviderCapabilities } from "../lib/marketData/providerCapability";
import { getPolicy } from "../lib/marketData/policy";
import {
  upstoxHealth,
  probeUpstoxConnection,
} from "../lib/marketData/upstoxProvider";
import { resolveUpstoxConfig } from "../lib/marketData/upstoxClient";
import {
  indianApiHealth,
  probeIndianApiConnection,
  getIndianApiCapabilityManifest,
} from "../lib/marketData/indianApiProvider";
import {
  getParitySummary,
  getShadowRoutingState,
} from "../lib/marketData/shadowState";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// GET /api/providers/diagnostics
// ---------------------------------------------------------------------------

router.get("/providers/diagnostics", requireOwnerStrict, (_req, res, next) => {
  try {
    const capabilities = getProviderCapabilities();
    const policy       = getPolicy();
    const upstox       = upstoxHealth();
    const indianApi    = indianApiHealth();

    // Shadow provider data has no trading impact — monitoring only.
    // authMode is safe to surface (no raw token exposed).
    const upstoxCfg = resolveUpstoxConfig();

    res.json({
      ok:          true,
      evaluatedAt: capabilities.evaluatedAt,
      authoritative: capabilities.authoritative,
      tradeAvailableProviders: capabilities.tradeAvailableProviders,
      capabilities: capabilities.capabilities,
      // Shadow observations have no impact on trading, signals, paper trades, P&L, or broker.
      shadowImpactStatement: "Shadow provider data has no trading, signalling, paper-trading, P&L or broker impact.",
      shadowState: {
        upstox: {
          configured:    upstox.configured,
          authMode:      upstoxCfg.authMode,  // safe — not the token itself
          routingState:  upstox.routingState,
          circuitState:  upstox.circuitState,
          lastProbeAt:   upstox.lastProbeAt,
          // lastError: sanitized — only include kind prefix, not full message
          lastErrorKind: upstox.lastError
            ? upstox.lastError.split(":")[0] ?? "error"
            : null,
        },
        indianapi: {
          configured:    indianApi.configured,
          plan:          indianApi.plan,
          configState:   indianApi.configState,
          lastProbeAt:   indianApi.lastProbeAt,
          lastErrorKind: indianApi.lastError
            ? indianApi.lastError.split(":")[0] ?? "error"
            : null,
        },
      },
      policy: {
        upstoxShadowEnabled: policy.upstoxShadowEnabled,
        indianApiEnabled:    policy.indianApiEnabled,
        indstocksEnabled:    policy.indstocksEnabled,
        strictFreshness:     policy.strictFreshness,
        strictMismatch:      policy.strictMismatch,
        freshnessBudgetSec:  policy.freshnessBudgetSec,
        staleBudgetSec:      policy.staleBudgetSec,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/providers/shadow-parity
// ---------------------------------------------------------------------------

router.get("/providers/shadow-parity", requireOwnerStrict, (_req, res, next) => {
  try {
    const upstoxSummary = getParitySummary("upstox");
    res.json({
      ok:            true,
      evaluatedAt:   new Date().toISOString(),
      upstox: {
        routingState:           upstoxSummary.routingState,
        sampleCount:            upstoxSummary.sampleCount,
        lastSampleAt:           upstoxSummary.lastSampleAt,
        overallWithinTolerance: upstoxSummary.overallWithinTolerance,
        promotionEligible:      upstoxSummary.promotionEligible,
        recentQuoteSamples:     upstoxSummary.quoteSamples.map((s) => ({
          symbol:           s.symbol,
          sampledAt:        s.sampledAt,
          canonicalLtp:     s.canonicalLtp,
          shadowLtp:        s.shadowLtp,
          ltpRelDiff:       s.ltpRelDiff !== null ? Number(s.ltpRelDiff.toFixed(5)) : null,
          shadowAgeSec:     s.shadowAgeSec,
          shadowLatencyMs:  s.shadowLatencyMs,
          withinTolerance:  s.withinTolerance,
          // reason: included but shadow LTP value is not re-emitted
        })),
        recentCandleSamples:    upstoxSummary.candleSamples.map((s) => ({
          symbol:          s.symbol,
          interval:        s.interval,
          sampledAt:       s.sampledAt,
          canonicalCount:  s.canonicalCount,
          shadowCount:     s.shadowCount,
          countMatch:      s.countMatch,
          closeRelDiff:    s.closeRelDiff !== null ? Number(s.closeRelDiff.toFixed(5)) : null,
          withinTolerance: s.withinTolerance,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/providers/indianapi/capabilities
// ---------------------------------------------------------------------------

router.get("/providers/indianapi/capabilities", requireOwnerStrict, (_req, res, next) => {
  try {
    const manifest = getIndianApiCapabilityManifest();
    res.json({
      ok:          true,
      evaluatedAt: new Date().toISOString(),
      configured:  manifest.some((e) => e.state !== "NOT_CONFIGURED"),
      manifest,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/providers/probe
// ---------------------------------------------------------------------------

router.post("/providers/probe", requireOwnerStrict, async (_req, res, next) => {
  try {
    const [upstoxResult, indianApiResult] = await Promise.all([
      probeUpstoxConnection(),
      probeIndianApiConnection(),
    ]);

    res.json({
      ok:          true,
      probedAt:    new Date().toISOString(),
      upstox: {
        ok:          upstoxResult.ok,
        // reason: included but sanitized (no token content)
        reasonKind:  upstoxResult.reason.split(":")[0] ?? "unknown",
        routingState: getShadowRoutingState("upstox"),
      },
      indianapi: {
        ok:         indianApiResult.ok,
        reasonKind: indianApiResult.reason.split(":")[0] ?? "unknown",
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
