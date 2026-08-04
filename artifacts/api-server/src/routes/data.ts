import { Router, type IRouter } from "express";
import { requireOwner, requireOwnerStrict } from "../lib/userAuth";
import {
  buildDataDiagnostics,
  buildSymbolDiagnostic,
  getEquityQuote,
  validateAgainstIndstocks,
  isIndstocksEnabled,
  getIndstocksTokenStatus,
  setIndstocksToken,
  clearIndstocksToken,
} from "../lib/marketData";
import fundamentalsRouter from "./fundamentals";
import { resolveInstrument } from "../lib/marketData/instrumentResolver";
import { getChartCandles } from "../lib/chartDatafeed";
import { UNIVERSE } from "../lib/universe";
import { INSTRUMENT_ASSET_CLASSES, type InstrumentAssetClass, db } from "@workspace/db";
import { portfolioHoldingsTable } from "@workspace/db/schema";

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
 * GET /api/data/diagnostics/portfolio-resolution — owner-only end-to-end proof
 * that the canonical resolver + central datafeed price any symbol that exists
 * in the full Kite instrument master, NOT just the curated scan-set.
 *
 * For each requested symbol it returns the full resolution path: the ordered
 * resolver attempts, the canonical instrument, whether a live quote was found
 * (and from which source), and an explicit `missing_reason` when not — never a
 * silent / generic "n/a".
 *
 * Query: `?symbols=TRIDENT,BDL,…` (comma-separated, max 50). With no symbols it
 * probes the eight user-reported tickers so the endpoint is self-demonstrating.
 */
const DEFAULT_RESOLUTION_PROBE = [
  "TRIDENT",
  "BDL",
  "CDSL",
  "ARE&M",
  "TMPV",
  "INDHOTEL",
  "BLS",
  "NSDL",
];

router.get("/data/diagnostics/portfolio-resolution", async (req, res, next) => {
  try {
    const raw = req.query["symbols"];
    const rawStr = Array.isArray(raw) ? raw.join(",") : typeof raw === "string" ? raw : "";
    const requested = rawStr.trim()
      ? rawStr.split(",").map((s) => s.trim()).filter((s) => s.length > 0)
      : DEFAULT_RESOLUTION_PROBE;
    const symbols = Array.from(
      new Set(requested.map((s) => s.toUpperCase())),
    ).slice(0, 50);

    const universe = new Set(UNIVERSE.map((u) => u.symbol.toUpperCase()));

    const holdings = await Promise.all(
      symbols.map(async (raw_symbol) => {
        const r = resolveInstrument(raw_symbol);

        if (!r.resolved || !r.instrument) {
          return {
            raw_symbol,
            resolved: false,
            canonical_symbol: null,
            exchange: null,
            kite_key: null,
            instrument_token: null,
            instrument_type: null,
            bse_code: null,
            matched_via: null,
            quote_found: false,
            quote_source: null,
            last_price: null,
            valuation_status: "UNPRICED" as const,
            recommendation_status: "UNAVAILABLE" as const,
            missing_reason:
              r.reason ?? "Not found in the Kite instrument master (NSE/BSE).",
            recommendation_reason: "Instrument unresolved.",
            resolver_attempts: r.attempts,
          };
        }

        const inst = r.instrument;
        let quote_found = false;
        let last_price: number | null = null;
        let quote_source: string | null = null;
        try {
          const c = await getChartCandles(inst.canonical_symbol, "equity", "1D");
          const closes = c.candles.filter((p) => Number.isFinite(p.c));
          if (closes.length > 0) {
            quote_found = true;
            last_price = closes[closes.length - 1]!.c;
            quote_source = c.source;
          }
        } catch {
          // fail-open: leave quote_found=false with an explicit reason below.
        }

        const inUniverse = universe.has(inst.canonical_symbol.toUpperCase());

        return {
          raw_symbol,
          resolved: true,
          canonical_symbol: inst.canonical_symbol,
          display_name: inst.display_name,
          exchange: inst.exchange,
          kite_key: inst.kite_key,
          instrument_token: inst.instrument_token,
          instrument_type: inst.instrument_type,
          bse_code: inst.bse_code,
          matched_via: r.matched_via,
          quote_found,
          quote_source,
          last_price,
          valuation_status: quote_found ? ("PRICED" as const) : ("UNPRICED" as const),
          recommendation_status: inUniverse
            ? ("AVAILABLE" as const)
            : ("NO_SCANNER_ROW" as const),
          missing_reason: quote_found
            ? null
            : "Resolved to a canonical instrument but neither Kite nor Yahoo returned a daily quote.",
          recommendation_reason: inUniverse
            ? null
            : "Not in the curated scanner scan-set; the structure score/recommendation is computed only for curated NIFTY-500 names.",
          resolver_attempts: r.attempts,
        };
      }),
    );

    res.json({
      generatedAt: new Date().toISOString(),
      authoritative: "kite",
      note: "Valuation uses Kite as authoritative with a Yahoo fallback for instruments Kite cannot serve (quote_source is surfaced per row).",
      count: holdings.length,
      holdings,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/data/diagnostics/portfolio", async (req, res, next) => {
  try {
    const holdings = await db.select().from(portfolioHoldingsTable);
    const uniqueSymbols = Array.from(new Set(holdings.map(h => h.symbol.toUpperCase())));

    const resolved = await Promise.all(
      uniqueSymbols.map(async (raw_symbol) => {
        const r = resolveInstrument(raw_symbol);
        let quote_status = "UNAVAILABLE";
        let priceState = "PRICE UNAVAILABLE";
        let resolvedSymbol = null;
        let exchange = null;
        let instrumentToken = null;
        let reason: string | null = r.reason ?? "Not found in master";

        if (r.resolved && r.instrument) {
          const inst = r.instrument;
          resolvedSymbol = inst.canonical_symbol;
          exchange = inst.exchange;
          instrumentToken = inst.instrument_token;
          reason = null;

          try {
            const c = await getChartCandles(inst.canonical_symbol, "equity", "1D");
            if (c.source === "kite" && c.candles.length > 0) {
              quote_status = "FOUND";
              priceState = c.fresh ? "KITE LIVE" : "KITE STALE";
            } else {
              quote_status = "MISSING";
              priceState = "KITE QUOTE UNAVAILABLE";
              reason = "Kite returned no candles for token";
            }
          } catch (err) {
            quote_status = "ERROR";
            priceState = "PRICE UNAVAILABLE";
            reason = (err as Error).message;
          }
        } else {
          priceState = "UNRESOLVED SYMBOL";
        }

        const isIncluded = priceState === "KITE LIVE" || priceState === "KITE STALE";

        return {
          original_symbol: raw_symbol,
          normalized_symbol: r.normalized,
          exchange,
          resolver_status: r.resolved ? "RESOLVED" : "UNRESOLVED",
          instrumentToken,
          quote_status,
          priceState,
          unavailable_reason: reason,
          valuation_inclusion: isIncluded ? "INCLUDED" : "EXCLUDED",
        };
      })
    );

    res.json({
      generatedAt: new Date().toISOString(),
      uniqueHoldingsCount: uniqueSymbols.length,
      holdings: resolved,
    });
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

/**
 * INDstocks daily token — owner-only hot-swap so the operator never has to edit
 * the INDSTOCKS_API_TOKEN secret + restart/redeploy each day. The token is stored
 * encrypted in the DB (DB-first → env fallback). The value is NEVER echoed back.
 */
router.get("/data/indstocks/token/status", requireOwnerStrict, async (_req, res, next) => {
  try {
    res.json(await getIndstocksTokenStatus());
  } catch (err) {
    next(err);
  }
});

router.post("/data/indstocks/token", requireOwnerStrict, async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as { token?: unknown; expiresAt?: unknown };
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token) {
      res.status(400).json({ error: "token is required" });
      return;
    }
    if (token.length < 8 || token.length > 8192) {
      res.status(400).json({ error: "token length looks invalid" });
      return;
    }
    let expiresAt: Date | undefined;
    if (typeof body.expiresAt === "string" && body.expiresAt.trim()) {
      const d = new Date(body.expiresAt.trim());
      if (!Number.isNaN(d.getTime())) expiresAt = d;
    }
    await setIndstocksToken(token, { expiresAt, updatedBy: "owner" });
    res.json(await getIndstocksTokenStatus());
  } catch (err) {
    next(err);
  }
});

router.delete("/data/indstocks/token", requireOwnerStrict, async (_req, res, next) => {
  try {
    await clearIndstocksToken();
    res.json(await getIndstocksTokenStatus());
  } catch (err) {
    next(err);
  }
});

// Gate E — canonical IndianAPI fundamentals (owner-only via parent requireOwner middleware)
router.use(fundamentalsRouter);

export default router;
