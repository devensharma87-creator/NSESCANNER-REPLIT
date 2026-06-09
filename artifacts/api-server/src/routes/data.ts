import { Router, type IRouter } from "express";
import { requireOwner } from "../lib/userAuth";
import {
  buildDataDiagnostics,
  buildSymbolDiagnostic,
  getEquityQuote,
  validateAgainstIndstocks,
  isIndstocksEnabled,
} from "../lib/marketData";
import { INSTRUMENT_ASSET_CLASSES, type InstrumentAssetClass } from "@workspace/db";

/**
 * /api/data/* — owner-only diagnostics for the central market-data layer.
 *
 * Surfaces the trust-tier policy and honest provider health (Kite authoritative,
 * INDstocks disabled scaffold, Yahoo analytics-only) plus a per-symbol probe
 * showing exactly what the trusted router would return for a symbol.
 *
 * Read-only. Does not place orders, mutate state, or feed any trading decision.
 */
const router: IRouter = Router();

router.use("/data", requireOwner);

router.get("/data/diagnostics", async (_req, res, next) => {
  try {
    res.json(await buildDataDiagnostics());
  } catch (err) {
    next(err);
  }
});

router.get("/data/diagnostics/symbol/:symbol", async (req, res, next) => {
  try {
    const raw = req.params["symbol"];
    const symbol = Array.isArray(raw) ? raw[0] : raw;
    if (!symbol || !symbol.trim()) {
      res.status(400).json({ error: "symbol is required" });
      return;
    }
    res.json(await buildSymbolDiagnostic(symbol.trim()));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/data/compare — owner-only side-by-side Kite-vs-INDstocks probe.
 *
 * Body: { symbols: string[]; assetClass?: InstrumentAssetClass }.
 * For each symbol it shows the authoritative Kite quote and (when INDstocks is
 * enabled with a VERIFIED mapping + secondary quote) the cross-validation
 * verdict. Read-only; never places orders or feeds a trading decision. When
 * INDstocks is disabled every row reports it honestly.
 */
router.post("/data/compare", async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as {
      symbols?: unknown;
      assetClass?: unknown;
    };
    const rawSymbols = Array.isArray(body.symbols) ? body.symbols : [];
    const symbols = Array.from(
      new Set(
        rawSymbols
          .filter((s): s is string => typeof s === "string")
          .map((s) => s.trim().toUpperCase())
          .filter((s) => s.length > 0),
      ),
    ).slice(0, 50);

    if (symbols.length === 0) {
      res.status(400).json({ error: "symbols must be a non-empty string array" });
      return;
    }

    const assetClass: InstrumentAssetClass =
      typeof body.assetClass === "string" &&
      (INSTRUMENT_ASSET_CLASSES as readonly string[]).includes(body.assetClass)
        ? (body.assetClass as InstrumentAssetClass)
        : "EQUITY";

    const enabled = isIndstocksEnabled();

    const rows = await Promise.all(
      symbols.map(async (symbol) => {
        const k = await getEquityQuote(symbol).catch((e) => {
          void e;
          return null;
        });
        const kiteOk = !!k && k.ok && !!k.data;
        const kite = kiteOk ? k!.data : null;

        let indstocks: {
          mappingOk: boolean;
          reason: string | null;
          quote: unknown;
          validation: unknown;
        } | null = null;

        if (enabled && kiteOk && kite) {
          const cv = await validateAgainstIndstocks(symbol, kite, assetClass).catch(
            (e) => {
              void e;
              return null;
            },
          );
          if (cv) {
            indstocks = {
              mappingOk: cv.mappingOk,
              reason: cv.reason,
              quote: cv.indstocks,
              validation: cv.result,
            };
          }
        }

        return {
          symbol,
          kite: kite ? { ...kite, tradeable: true } : null,
          kiteReason: kiteOk ? null : (k?.reason ?? "Unavailable."),
          indstocks,
        };
      }),
    );

    res.json({
      generatedAt: new Date().toISOString(),
      indstocksEnabled: enabled,
      assetClass,
      authoritative: "kite",
      rows,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
