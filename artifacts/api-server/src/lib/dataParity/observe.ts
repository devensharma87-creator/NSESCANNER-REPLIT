/**
 * Checkpoint 3 — Data Parity observation collectors.
 *
 * Each `observe*` function reads ONE existing module's already-computed view
 * of a symbol/index and maps it into a `DataParityObservation`. Every
 * collector:
 *   - NEVER throws — any failure is caught and reported as `status:
 *     "UNAVAILABLE"` with an honest reason, never a fabricated value.
 *   - NEVER calls a mutating/network-triggering function that would change
 *     state (no `scanAll`, no `runEquityPaperTradingTick`, no
 *     `listSwingOrders` (which expires stale rows), no report-send
 *     functions). Only pure reads / already-cached data / the same trusted
 *     read paths the real consumer uses.
 *   - Does NOT change any consumer's data path — this is diagnostic-only.
 */

import { desc, eq } from "drizzle-orm";
import { db, swingOrderStagingTable } from "@workspace/db";
import {
  getEquityQuoteResolved,
  getIndexQuote,
} from "../marketData/router";
import {
  centralIndexQuotes,
  centralActiveSessionStatus as getActiveSessionStatus,
  centralFeedStatus as feedStatus,
  type ActiveSessionStatus,
} from "../marketData/compat";
import { getReportGradeIndexQuotes } from "../marketData/reportGradeIndexQuotes";
import { pointFromMeta, type DataMeta, type SourceStatus } from "../marketData/types";
import { buildSymbolDiagnostic } from "../marketData/diagnostics";
import { getChartCandles } from "../chartDatafeed";
import { getAllScannedRows } from "../fullNseScanner";
import { getSpotForUnderlying, fetchOptionChain } from "../optionChain";
import { buildGlobalDataHealth } from "../globalDataHealth";
import { OPTION_INDICES } from "../optionSignals";
import { FNO_LIQUIDITY } from "../paperAccount";
import {
  classifyFreshness,
  atmSpreadPct,
  deriveSignalReadiness,
  type SignalReadinessInput,
} from "../fnoDiagnosticsFacade";
import {
  DATA_PARITY_MODULE_LABELS,
  INDEX_KEY_MAP,
  type DataParityAssetType,
  type DataParityModuleId,
  type DataParityObservation,
  type DataParityObservationKind,
} from "./types";
import { TRADE_GRADE_FRESH_BUDGET_SEC } from "./classify";

const OPTION_INDEX_SYMBOLS = new Set(OPTION_INDICES.map((c) => c.symbol));

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function unavailable(
  moduleId: DataParityModuleId,
  symbol: string,
  assetType: DataParityAssetType,
  capturedAt: string,
  reason: string,
  kind: DataParityObservationKind = "quote",
): DataParityObservation {
  return {
    moduleId,
    moduleLabel: DATA_PARITY_MODULE_LABELS[moduleId],
    symbol,
    assetType,
    status: "UNAVAILABLE",
    reason,
    kind,
    freshnessClass: "not_applicable",
    price: null,
    asOf: null,
    freshnessSec: null,
    source: "n/a",
    trustTier: null,
    tradeGrade: null,
    capturedAt,
  };
}

function freshnessClassFromSourceStatus(s: SourceStatus): DataParityObservation["freshnessClass"] {
  switch (s) {
    case "TRADE_GRADE":
      return "trade_grade";
    case "DELAYED":
      return "report_grade";
    case "INFO_ONLY":
    case "STALE":
      return "cache";
    default:
      return "not_applicable";
  }
}

/** Bridges an existing `DataMeta` envelope into a `DataParityObservation`. */
function observationFromMeta(
  moduleId: DataParityModuleId,
  symbol: string,
  assetType: DataParityAssetType,
  capturedAt: string,
  price: number | null,
  meta: DataMeta,
  reasonWhenMissing: string | undefined,
  kind: DataParityObservationKind = "quote",
): DataParityObservation {
  if (price == null) {
    return unavailable(
      moduleId,
      symbol,
      assetType,
      capturedAt,
      reasonWhenMissing ?? meta.warnings.at(-1) ?? "No data returned.",
      kind,
    );
  }
  const point = pointFromMeta({
    key: `${moduleId}:${symbol}`,
    assetType: assetType === "index" ? "index" : "equity",
    symbol,
    value: price,
    meta,
  });
  return {
    moduleId,
    moduleLabel: DATA_PARITY_MODULE_LABELS[moduleId],
    symbol,
    assetType,
    status: "OK",
    reason: null,
    kind,
    freshnessClass: freshnessClassFromSourceStatus(point.sourceStatus),
    price,
    asOf: meta.asOf,
    freshnessSec: meta.freshnessSec,
    source: meta.source,
    trustTier: meta.trustTier,
    tradeGrade: point.canDriveSignals,
    capturedAt,
  };
}

// ── 1. Canonical Router ─────────────────────────────────────────────────────

async function observeRouter(
  symbol: string,
  assetType: DataParityAssetType,
  capturedAt: string,
): Promise<DataParityObservation> {
  try {
    if (assetType === "index") {
      const key = INDEX_KEY_MAP[symbol];
      if (!key) return unavailable("router", symbol, assetType, capturedAt, `No index key mapping for ${symbol}.`);
      const r = await getIndexQuote(key);
      return observationFromMeta("router", symbol, assetType, capturedAt, r.ok ? r.data!.lastPrice : null, r.meta, r.reason);
    }
    const r = await getEquityQuoteResolved(symbol);
    return observationFromMeta("router", symbol, assetType, capturedAt, r.ok ? r.data!.lastPrice : null, r.meta, r.reason);
  } catch (e) {
    return unavailable("router", symbol, assetType, capturedAt, errMsg(e));
  }
}

// ── 2. Report-Grade Index Quotes ────────────────────────────────────────────

async function observeReportGrade(
  symbol: string,
  assetType: DataParityAssetType,
  capturedAt: string,
): Promise<DataParityObservation> {
  if (assetType !== "index") {
    return unavailable("reportGrade", symbol, assetType, capturedAt, "Report-grade facade covers indices only.");
  }
  try {
    const key = INDEX_KEY_MAP[symbol];
    if (!key) return unavailable("reportGrade", symbol, assetType, capturedAt, `No index key mapping for ${symbol}.`);
    const quotes = await getReportGradeIndexQuotes("DISPLAY_ONLY");
    const q = quotes.get(key);
    if (!q || q.ltp == null) {
      return unavailable("reportGrade", symbol, assetType, capturedAt, q?.reason ?? "No report-grade quote available.");
    }
    return {
      moduleId: "reportGrade",
      moduleLabel: DATA_PARITY_MODULE_LABELS.reportGrade,
      symbol,
      assetType,
      status: "OK",
      reason: null,
      kind: "quote",
      freshnessClass: "report_grade",
      price: q.ltp,
      asOf: q.sourceAsOf,
      freshnessSec: q.freshnessSec,
      source: q.source === "KITE" ? "kite" : "none",
      trustTier: q.source === "KITE" ? "authoritative" : null,
      tradeGrade: q.tradeGrade, // always false by design — see reportGradeIndexQuotes.ts
      capturedAt,
    };
  } catch (e) {
    return unavailable("reportGrade", symbol, assetType, capturedAt, errMsg(e));
  }
}

// ── 12. Pre/Post-Market Reports (reuses the SAME report-grade facade the
//        real report builders call — see dailyReports.ts) ──────────────────

async function observeDailyReports(
  symbol: string,
  assetType: DataParityAssetType,
  capturedAt: string,
): Promise<DataParityObservation> {
  if (assetType !== "index") {
    return unavailable("dailyReports", symbol, assetType, capturedAt, "Daily reports index section covers indices only.");
  }
  try {
    const key = INDEX_KEY_MAP[symbol];
    if (!key) return unavailable("dailyReports", symbol, assetType, capturedAt, `No index key mapping for ${symbol}.`);
    const quotes = await getReportGradeIndexQuotes("REPORT_POST_MARKET");
    const q = quotes.get(key);
    if (!q || q.ltp == null) {
      return unavailable("dailyReports", symbol, assetType, capturedAt, q?.reason ?? "No report-grade quote available.");
    }
    return {
      moduleId: "dailyReports",
      moduleLabel: DATA_PARITY_MODULE_LABELS.dailyReports,
      symbol,
      assetType,
      status: "OK",
      reason: null,
      kind: "quote",
      freshnessClass: "report_grade",
      price: q.ltp,
      asOf: q.sourceAsOf,
      freshnessSec: q.freshnessSec,
      source: q.source === "KITE" ? "kite" : "none",
      trustTier: q.source === "KITE" ? "authoritative" : null,
      tradeGrade: q.tradeGrade,
      capturedAt,
    };
  } catch (e) {
    return unavailable("dailyReports", symbol, assetType, capturedAt, errMsg(e));
  }
}

// ── 3/4/6. Scanner / Watchlist / Paper EQ — all three currently draw from
//           the SAME NSE-500 scan cache (no separate live pull path exists
//           for watchlist indicators or paper-EQ candidate pricing). ───────

function observeFromScanCache(
  moduleId: "scanner" | "watchlist" | "paperEq",
  symbol: string,
  assetType: DataParityAssetType,
  capturedAt: string,
): DataParityObservation {
  if (assetType !== "equity") {
    return unavailable(moduleId, symbol, assetType, capturedAt, "Scanner cache covers NSE 500 equities only.");
  }
  try {
    const { rows } = getAllScannedRows();
    const row = rows.find((r) => r.symbol.toUpperCase() === symbol.toUpperCase());
    if (!row) {
      return unavailable(moduleId, symbol, assetType, capturedAt, `${symbol} not present in the current scan cache.`);
    }
    const rs = row.rowSource;
    if (rs) {
      const freshnessClass: DataParityObservation["freshnessClass"] =
        rs.sourceStatus === "TRADE_GRADE" ? "trade_grade" : "cache";
      const source = rs.source === "kite" ? "kite" : rs.source === "yahoo" ? "yahoo" : rs.source === "none" ? "none" : "cache";
      return {
        moduleId,
        moduleLabel: DATA_PARITY_MODULE_LABELS[moduleId],
        symbol,
        assetType,
        status: "OK",
        reason: null,
        kind: "quote",
        freshnessClass,
        price: row.quote.price,
        asOf: rs.asOf,
        freshnessSec: rs.freshnessSec,
        source,
        trustTier: rs.source === "kite" ? "authoritative" : rs.source === "yahoo" ? "secondary_analytics" : null,
        tradeGrade: rs.canDriveSignals,
        capturedAt,
      };
    }
    // No rowSource attached (older cache shape) — surface honestly as unknown trust.
    return {
      moduleId,
      moduleLabel: DATA_PARITY_MODULE_LABELS[moduleId],
      symbol,
      assetType,
      status: "OK",
      reason: null,
      kind: "quote",
      freshnessClass: "cache",
      price: row.quote.price,
      asOf: row.quote.updatedAt ? new Date(row.quote.updatedAt).toISOString() : null,
      freshnessSec: null,
      source: "none",
      trustTier: null,
      tradeGrade: null,
      capturedAt,
    };
  } catch (e) {
    return unavailable(moduleId, symbol, assetType, capturedAt, errMsg(e));
  }
}

// ── 5. Portfolio — no server-side pricing path exists (holdings are priced
//      client-side); an honest UNAVAILABLE stub, not a fabricated value. ───

function observePortfolio(symbol: string, assetType: DataParityAssetType, capturedAt: string): DataParityObservation {
  return unavailable(
    "portfolio",
    symbol,
    assetType,
    capturedAt,
    "Portfolio holdings are priced client-side; no server-side pricing path exists to observe.",
    "not_applicable",
  );
}

// ── 7. Swing Queue — direct read-only latest-row select. Deliberately does
//      NOT call listSwingOrders(), which mutates via expireStaleSwingOrders(). ─

async function observeSwingQueue(
  symbol: string,
  assetType: DataParityAssetType,
  capturedAt: string,
): Promise<DataParityObservation> {
  if (assetType !== "equity") {
    return unavailable("swingQueue", symbol, assetType, capturedAt, "Swing queue covers NSE equities only.");
  }
  try {
    const rows = await db
      .select({
        entryPrice: swingOrderStagingTable.entryPrice,
        createdAt: swingOrderStagingTable.createdAt,
        status: swingOrderStagingTable.status,
        dataSource: swingOrderStagingTable.dataSource,
      })
      .from(swingOrderStagingTable)
      .where(eq(swingOrderStagingTable.symbol, symbol.toUpperCase()))
      .orderBy(desc(swingOrderStagingTable.createdAt))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return unavailable("swingQueue", symbol, assetType, capturedAt, `No staged swing order found for ${symbol}.`, "frozen_plan");
    }
    return {
      moduleId: "swingQueue",
      moduleLabel: DATA_PARITY_MODULE_LABELS.swingQueue,
      symbol,
      assetType,
      status: "OK",
      reason: null,
      kind: "frozen_plan",
      freshnessClass: "frozen",
      price: row.entryPrice,
      asOf: row.createdAt.toISOString(),
      freshnessSec: null,
      source: "cache",
      trustTier: null,
      tradeGrade: null,
      capturedAt,
    };
  } catch (e) {
    return unavailable("swingQueue", symbol, assetType, capturedAt, errMsg(e), "frozen_plan");
  }
}

// ── 8. Charting — last daily candle close (1D timeframe, read-only). ───────

async function observeCharting(
  symbol: string,
  assetType: DataParityAssetType,
  capturedAt: string,
): Promise<DataParityObservation> {
  try {
    const segment = assetType === "index" ? "index" : "equity";
    const result = await getChartCandles(symbol, segment, "1D");
    const last = result.candles.at(-1);
    if (!result.candles.length || !last) {
      return unavailable(
        "charting",
        symbol,
        assetType,
        capturedAt,
        result.message ?? `No candles returned for ${symbol}.`,
        "candle_close",
      );
    }
    const freshnessClass: DataParityObservation["freshnessClass"] =
      result.sourceTier === "authoritative" && !result.stale ? "trade_grade" : "cache";
    return {
      moduleId: "charting",
      moduleLabel: DATA_PARITY_MODULE_LABELS.charting,
      symbol,
      assetType,
      status: "OK",
      reason: null,
      kind: "candle_close",
      freshnessClass,
      price: last.c,
      asOf: result.asOf != null ? new Date(result.asOf).toISOString() : null,
      freshnessSec: null,
      source: result.source,
      trustTier: result.sourceTier === "unavailable" ? null : result.sourceTier,
      tradeGrade: result.sourceTier === "authoritative" && !result.stale && !result.visualOnly,
      capturedAt,
    };
  } catch (e) {
    return unavailable("charting", symbol, assetType, capturedAt, errMsg(e), "candle_close");
  }
}

// ── 9. Stock Intelligence diagnostics (equity-only; uses getEquityQuoteResolved
//      via buildSymbolDiagnostic, same as the real /data/diagnostics route). ─

async function observeDiagnostics(
  symbol: string,
  assetType: DataParityAssetType,
  capturedAt: string,
): Promise<DataParityObservation> {
  if (assetType !== "equity") {
    return unavailable("diagnostics", symbol, assetType, capturedAt, "Stock Intelligence diagnostics covers equities only.");
  }
  try {
    const d = await buildSymbolDiagnostic(symbol, "EQUITY");
    if (!d.quote) {
      return unavailable("diagnostics", symbol, assetType, capturedAt, d.reason ?? "No diagnostic quote available.");
    }
    return observationFromMeta("diagnostics", symbol, assetType, capturedAt, d.quote.lastPrice, d.quote.meta, undefined);
  } catch (e) {
    return unavailable("diagnostics", symbol, assetType, capturedAt, errMsg(e));
  }
}

// ── 10. F&O Diagnostics — index-only (NIFTY/BANKNIFTY/SENSEX). Assembles the
//       SAME `deriveSignalReadiness` verdict as `/api/fno/data-health`
//       (session + feed + spot + option-chain), read-only, no order/broker
//       path touched. Freshness thresholds mirror routes/fno.ts exactly. ───

const FNO_SPOT_WARN_MS = 15_000;
const FNO_SPOT_FAIL_MS = 60_000;
const FNO_CHAIN_WARN_MS = 60_000;
const FNO_CHAIN_FAIL_MS = 300_000;

async function observeFno(
  symbol: string,
  assetType: DataParityAssetType,
  capturedAt: string,
): Promise<DataParityObservation> {
  if (assetType !== "index" || !OPTION_INDEX_SYMBOLS.has(symbol)) {
    return unavailable("fno", symbol, assetType, capturedAt, "F&O diagnostics is NIFTY/BANKNIFTY/SENSEX-only.");
  }
  try {
    const cfg = OPTION_INDICES.find((c) => c.symbol === symbol);
    if (!cfg) return unavailable("fno", symbol, assetType, capturedAt, `${symbol} is not in the F&O universe.`);

    const now = Date.now();
    const [sessionStatus, quotes] = await Promise.all([
      getActiveSessionStatus().catch((): ActiveSessionStatus => ({ session: null, code: "DB_SESSION_READ_FAILED" })),
      centralIndexQuotes().catch(() => null),
    ]);
    const feed = feedStatus();
    const q = quotes?.get(cfg.yahoo) ?? null;
    if (!q) {
      return unavailable("fno", symbol, assetType, capturedAt, "No F&O spot quote available (Kite offline or index missing).");
    }

    const spotAgeMs = q.asOf != null ? now - q.asOf : null;
    const spotStatus = classifyFreshness(spotAgeMs, FNO_SPOT_WARN_MS, FNO_SPOT_FAIL_MS);

    let chainInput: SignalReadinessInput["chain"] = { present: false, status: "unavailable", source: null, atm: null };
    try {
      const oc = await fetchOptionChain(cfg.symbol);
      if (oc) {
        const genMs = Date.parse(oc.generatedAt);
        const chainAgeMs = Number.isFinite(genMs) ? now - genMs : null;
        const atmRow = oc.rows.find((r) => r.strike === oc.atmStrike) ?? null;
        chainInput = {
          present: true,
          status: classifyFreshness(chainAgeMs, FNO_CHAIN_WARN_MS, FNO_CHAIN_FAIL_MS),
          source: oc.source ?? null,
          atm: atmRow
            ? {
                ce: atmRow.ce ? { ltp: atmRow.ce.ltp ?? null, oi: atmRow.ce.oi ?? null, spreadPct: atmSpreadPct(atmRow.ce) } : null,
                pe: atmRow.pe ? { ltp: atmRow.pe.ltp ?? null, oi: atmRow.pe.oi ?? null, spreadPct: atmSpreadPct(atmRow.pe) } : null,
              }
            : null,
        };
      }
    } catch {
      // Option-chain fetch failed — fail-OPEN into "unavailable" chain,
      // mirroring routes/fno.ts's own try/catch behaviour.
    }

    const readiness = deriveSignalReadiness(
      {
        sessionPresent: !!sessionStatus.session,
        feedConnected: feed.connected,
        spot: { present: true, ageMs: spotAgeMs, status: spotStatus },
        chain: chainInput,
      },
      {
        minOptionLtp: FNO_LIQUIDITY.MIN_OPTION_LTP,
        minOptionOi: FNO_LIQUIDITY.MIN_OPTION_OI,
        maxSpreadPct: FNO_LIQUIDITY.MAX_BID_ASK_SPREAD_PCT * 100,
      },
    );

    const freshnessClass: DataParityObservation["freshnessClass"] =
      readiness.dataSourceVerdict === "LIVE_KITE"
        ? "trade_grade"
        : readiness.dataSourceVerdict === "UNAVAILABLE"
          ? "not_applicable"
          : "cache";

    return {
      moduleId: "fno",
      moduleLabel: DATA_PARITY_MODULE_LABELS.fno,
      symbol,
      assetType,
      status: "OK",
      reason: null,
      kind: "quote",
      freshnessClass,
      price: q.price,
      asOf: q.asOf != null ? new Date(q.asOf).toISOString() : null,
      freshnessSec: spotAgeMs != null ? Math.max(0, Math.round(spotAgeMs / 1000)) : null,
      source: "kite",
      trustTier: "authoritative",
      tradeGrade: readiness.signalAllowed,
      capturedAt,
    };
  } catch (e) {
    return unavailable("fno", symbol, assetType, capturedAt, errMsg(e));
  }
}

// ── 11. Option Chain Spot — getSpotForUnderlying (index-only underlyings). ─

async function observeOptionChain(
  symbol: string,
  assetType: DataParityAssetType,
  capturedAt: string,
): Promise<DataParityObservation> {
  try {
    const spot = await getSpotForUnderlying(symbol);
    if (!spot) {
      return unavailable("optionChain", symbol, assetType, capturedAt, `No option-chain spot available for ${symbol}.`);
    }
    return {
      moduleId: "optionChain",
      moduleLabel: DATA_PARITY_MODULE_LABELS.optionChain,
      symbol,
      assetType,
      status: "OK",
      reason: null,
      kind: "quote",
      freshnessClass: spot.source === "kite" ? "trade_grade" : "cache",
      price: spot.price,
      asOf: null, // getSpotForUnderlying does not surface a per-call asOf.
      freshnessSec: null,
      source: spot.source === "unavailable" ? "none" : spot.source,
      trustTier: spot.source === "kite" ? "authoritative" : spot.source === "nse" ? "secondary_analytics" : null,
      tradeGrade: spot.source === "kite",
      capturedAt,
    };
  } catch (e) {
    return unavailable("optionChain", symbol, assetType, capturedAt, errMsg(e));
  }
}

// ── 13. Global Data Health — a system-level rollup, not a per-symbol price.
//       Only participates in MODULE_UNAVAILABLE checks (price stays null so
//       it can never spuriously trigger a price/staleness mismatch). ──────

async function observeGlobalHealth(
  symbol: string,
  assetType: DataParityAssetType,
  capturedAt: string,
): Promise<DataParityObservation> {
  try {
    const health = await buildGlobalDataHealth();
    return {
      moduleId: "globalHealth",
      moduleLabel: DATA_PARITY_MODULE_LABELS.globalHealth,
      symbol,
      assetType,
      status: "OK",
      reason: null,
      kind: "health",
      freshnessClass: "not_applicable",
      price: null,
      asOf: health.checkedAt,
      freshnessSec: null,
      source: health.kite.tradeGrade ? "kite" : "none",
      trustTier: null,
      tradeGrade: null,
      capturedAt,
    };
  } catch (e) {
    return unavailable("globalHealth", symbol, assetType, capturedAt, errMsg(e), "health");
  }
}

const COLLECTORS: Record<
  DataParityModuleId,
  (symbol: string, assetType: DataParityAssetType, capturedAt: string) => Promise<DataParityObservation>
> = {
  router: observeRouter,
  reportGrade: observeReportGrade,
  scanner: (s, a, c) => Promise.resolve(observeFromScanCache("scanner", s, a, c)),
  watchlist: (s, a, c) => Promise.resolve(observeFromScanCache("watchlist", s, a, c)),
  portfolio: (s, a, c) => Promise.resolve(observePortfolio(s, a, c)),
  paperEq: (s, a, c) => Promise.resolve(observeFromScanCache("paperEq", s, a, c)),
  swingQueue: observeSwingQueue,
  charting: observeCharting,
  diagnostics: observeDiagnostics,
  fno: observeFno,
  optionChain: observeOptionChain,
  dailyReports: observeDailyReports,
  globalHealth: observeGlobalHealth,
};

/**
 * Observes a single module for a symbol. Never throws — the collector
 * contract guarantees a well-formed observation (OK or UNAVAILABLE), but this
 * wraps once more defensively in case a future collector regresses that.
 */
export async function observeModule(
  moduleId: DataParityModuleId,
  symbol: string,
  assetType: DataParityAssetType,
  capturedAt: string,
): Promise<DataParityObservation> {
  try {
    return await COLLECTORS[moduleId](symbol, assetType, capturedAt);
  } catch (e) {
    return unavailable(moduleId, symbol, assetType, capturedAt, errMsg(e));
  }
}

/** Observes every module applicable to this asset type, in parallel. */
export async function observeAllModules(
  moduleIds: readonly DataParityModuleId[],
  symbol: string,
  assetType: DataParityAssetType,
  capturedAt: string = new Date().toISOString(),
): Promise<DataParityObservation[]> {
  return Promise.all(moduleIds.map((m) => observeModule(m, symbol, assetType, capturedAt)));
}
