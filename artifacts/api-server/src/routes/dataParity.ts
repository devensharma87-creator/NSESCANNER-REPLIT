/**
 * Data Parity API — Checkpoint 3.
 *
 * Owner-only, diagnostic-first, stateless comparison of how each of 13
 * already-existing modules currently sees the SAME symbol/index right now.
 * Restricted to the five canonical Checkpoint-3 test symbols
 * (INDUSINDBK, RELIANCE, NIFTY, BANKNIFTY, SENSEX) to keep the surface small
 * and production-safe.
 *
 * Endpoints:
 *   GET  /api/data-parity/symbol/:symbol   — single-symbol parity snapshot
 *   POST /api/data-parity/check            — batch (cap 10 symbols)
 *
 * ABSOLUTE RULES:
 *   - requireOwnerStrict (NOT requireOwner) — no public-mode GET bypass.
 *   - Every collector is a read-only observation; nothing here mutates any
 *     module's state, places an order, sends a Telegram message, or changes
 *     trading/strategy/threshold logic.
 *   - Never fabricates a price/asOf — unreadable modules surface as an
 *     explicit UNAVAILABLE observation.
 */
import { Router, type IRouter } from "express";
import { requireOwnerStrict } from "../lib/userAuth";
import { observeAllModules } from "../lib/dataParity/observe";
import { buildDataParityResult } from "../lib/dataParity/classify";
import {
  DATA_PARITY_TEST_SYMBOLS,
  modulesFor,
  type DataParityAssetType,
} from "../lib/dataParity/types";

const router: IRouter = Router();

const MAX_BATCH_SYMBOLS = 10;

const SYMBOL_ASSET_TYPE: ReadonlyMap<string, DataParityAssetType> = new Map(
  DATA_PARITY_TEST_SYMBOLS.map((s) => [s.symbol, s.assetType]),
);

async function computeParityForSymbol(rawSymbol: string) {
  const symbol = String(rawSymbol ?? "").trim().toUpperCase();
  const assetType = SYMBOL_ASSET_TYPE.get(symbol);
  if (!assetType) return null;

  const capturedAt = new Date().toISOString();
  const moduleIds = modulesFor(assetType);
  const observations = await observeAllModules(moduleIds, symbol, assetType, capturedAt);
  return buildDataParityResult(symbol, assetType, observations, capturedAt);
}

/**
 * GET /api/data-parity/symbol/:symbol
 *
 * Owner-only single-symbol parity snapshot. `:symbol` must be one of the
 * five canonical Checkpoint-3 test symbols (case-insensitive).
 */
router.get("/data-parity/symbol/:symbol", requireOwnerStrict, async (req, res, next) => {
  try {
    const rawParam = req.params["symbol"];
    const symbolParam = Array.isArray(rawParam) ? (rawParam[0] ?? "") : (rawParam ?? "");
    const result = await computeParityForSymbol(symbolParam);
    if (!result) {
      res.status(400).json({
        ok: false,
        error: "UNKNOWN_SYMBOL",
        message: "symbol must be one of: " + DATA_PARITY_TEST_SYMBOLS.map((s) => s.symbol).join(", "),
      });
      return;
    }
    res.json({ ok: true, result });
  } catch (err) {
    req.log.error({ err }, "data-parity/symbol failed");
    next(err);
  }
});

/**
 * POST /api/data-parity/check
 *
 * Owner-only batch parity snapshot. Body: `{ symbols: string[] }`, capped at
 * 10 symbols per request (only 5 valid symbols exist, so this is a hard
 * ceiling against a malformed/oversized payload, not an expected limit).
 */
router.post("/data-parity/check", requireOwnerStrict, async (req, res, next) => {
  try {
    const body = (req.body as Record<string, unknown>) ?? {};
    const rawSymbols = body["symbols"];
    if (!Array.isArray(rawSymbols) || rawSymbols.length === 0) {
      res.status(400).json({ ok: false, error: "SYMBOLS_REQUIRED", message: "Body must include a non-empty symbols array." });
      return;
    }
    if (rawSymbols.length > MAX_BATCH_SYMBOLS) {
      res.status(400).json({ ok: false, error: "TOO_MANY_SYMBOLS", message: `Max ${MAX_BATCH_SYMBOLS} symbols per request.` });
      return;
    }

    const requested = rawSymbols.map((s) => String(s ?? "").trim().toUpperCase());
    const unknown = requested.filter((s) => !SYMBOL_ASSET_TYPE.has(s));
    if (unknown.length > 0) {
      res.status(400).json({
        ok: false,
        error: "UNKNOWN_SYMBOL",
        message: `Unknown symbol(s): ${unknown.join(", ")}. Allowed: ${DATA_PARITY_TEST_SYMBOLS.map((s) => s.symbol).join(", ")}`,
      });
      return;
    }

    const results = await Promise.all(requested.map((s) => computeParityForSymbol(s)));
    res.json({
      ok: true,
      capturedAt: new Date().toISOString(),
      results,
    });
  } catch (err) {
    req.log.error({ err }, "data-parity/check failed");
    next(err);
  }
});

export default router;
