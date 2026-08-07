/**
 * Swing-equity signal source.
 *
 * Filters STRONG_BUY recommendations from the existing fullNseScanner
 * cache down to the NSE F&O 200 universe (the stocks the broker
 * actually allows derivatives on, which all have deep cash-market
 * liquidity), then attaches an ATR-based entry/stop/target plan that
 * the equity paper-trader executes against.
 *
 * Why F&O 200? Two reasons:
 *   1. Liquidity floor — F&O eligibility implies high cash volume and
 *      tight spreads, so paper fills mirror what a real fill would be.
 *   2. Stop quality — ATR(14) and a 20-bar swing low are only
 *      meaningful on liquid daily charts; for thin small-caps the
 *      ATR is dominated by upper-circuit gaps and the swing low is
 *      effectively random.
 *
 * Note on the "200" in the name: the colloquial moniker "F&O 200"
 * comes from the historical size of the NSE F&O list (~200 names).
 * The actual NSE FNO eligible universe today is ~225-240 stocks
 * (currently 236 below). We curate the FULL eligible list, NOT a
 * fixed top-200, because trimming arbitrarily would exclude legit
 * F&O names that meet the liquidity floor we're trying to enforce.
 *
 * The risk plan mirrors a textbook swing setup:
 *   stop   = max(entry − 1.5 × ATR(14), 20-bar swing low)
 *            (whichever is HIGHER → tighter stop, smaller risk)
 *   T1     = entry + 2 × (entry − stop)     (~2R)
 *   T2     = entry + 3 × (entry − stop)     (~3R)
 * The equity executor then trails the stop up to T1 once T1 is hit,
 * so a winner never becomes a loser past the first reaction high.
 *
 * NO synthetic data. We never invent ATR or a swing low when the bars
 * aren't there — the symbol is rejected and logged.
 */
import type { StockRow } from "@workspace/api-zod";
import { atr } from "./indicators";
import { fetchChart } from "./marketData/analyticsYahoo";
import { logger } from "./logger";
import { getEntry } from "./universe";

interface SectorStrength {
  avgChangePercent: number;
  rank: number;
  totalSectors: number;
  isBottomQuartile: boolean;
}

function buildSectorStrengthMap(rows: readonly StockRow[]): Map<string, SectorStrength> {
  const bySector = new Map<string, number[]>();
  for (const r of rows) {
    if (!r.sector) continue;
    const arr = bySector.get(r.sector) ?? [];
    arr.push(r.quote.changePercent);
    bySector.set(r.sector, arr);
  }
  const sectorAvgs: Array<{ sector: string; avg: number }> = [];
  for (const [sector, changes] of bySector) {
    if (changes.length === 0) continue;
    const avg = changes.reduce((a, b) => a + b, 0) / changes.length;
    sectorAvgs.push({ sector, avg });
  }
  sectorAvgs.sort((a, b) => b.avg - a.avg);
  const total = sectorAvgs.length;
  const bottomQuartileCutoff = Math.ceil(total * 0.75);
  const result = new Map<string, SectorStrength>();
  for (let i = 0; i < sectorAvgs.length; i++) {
    const s = sectorAvgs[i]!;
    result.set(s.sector, {
      avgChangePercent: +s.avg.toFixed(2),
      rank: i + 1,
      totalSectors: total,
      isBottomQuartile: i + 1 > bottomQuartileCutoff,
    });
  }
  return result;
}

/**
 * Volume confirmation floor for a swing entry. The signal-bar volume must
 * be at least this multiple of the 20-day average — without confirming
 * participation, a "STRONG_BUY" technical setup is just price action
 * without follow-through. 1.3× matches the conventional retail breakout
 * filter (Chartink, TradingView's "Relative Volume" preset).
 */
const VOL_CONFIRM_FLOOR = 1.3;

// Note: a NIFTY-vs-50-EMA macro-regime gate previously sat here and
// vetoed every equity entry whenever the index was below its 50-EMA.
// At the user's explicit direction (2026-05-04) equity entries are
// now taken purely on per-stock technical analysis (STRONG_BUY +
// MIN_SCORE + volume confirmation + ATR-based stop). The gate, its
// cache and its supporting helper have been removed.

/**
 * Curated NSE F&O underlyings (stocks that have derivative contracts
 * on NSE, FY 2025-26). The list is hand-maintained because:
 *   - the official NSE FO_MKTLOTS file changes ~quarterly and the
 *     scanner's startup must not depend on a third-party request that
 *     could fail and silently widen the universe to all 2,500 stocks;
 *   - keeping this static makes paper-trade behaviour reproducible
 *     between deploys.
 *
 * To update: refresh from
 *   https://nsearchives.nseindia.com/content/fo/fo_mktlots.csv
 * keep only stock underlyings (ignore index futures), and replace the
 * Set below. Any name change must also be reflected in YAHOO_TICKER_OVERRIDES
 * inside universe.ts so historical bars still resolve.
 */
export const FNO_EQUITY_UNIVERSE: ReadonlySet<string> = new Set([
  // Banking & Financials
  "HDFCBANK", "ICICIBANK", "SBIN", "AXISBANK", "KOTAKBANK", "INDUSINDBK",
  "BANKBARODA", "PNB", "CANBK", "UNIONBANK", "BANKINDIA", "IDFCFIRSTB",
  "FEDERALBNK", "AUBANK", "BANDHANBNK", "RBLBANK", "YESBANK", "IOB",
  "BAJFINANCE", "BAJAJFINSV", "SBILIFE", "HDFCLIFE", "ICICIPRULI",
  "ICICIGI", "MFSL", "LICHSGFIN", "CHOLAFIN", "SHRIRAMFIN", "MUTHOOTFIN",
  "MANAPPURAM", "PFC", "RECLTD", "HDFCAMC", "IRFC", "ABCAPITAL", "POONAWALLA",
  "M&MFIN", "L&TFH", "PEL", "PAYTM", "POLICYBZR", "ANGELONE", "BSE", "CDSL",
  "PNBHOUSING", "IIFL", "JIOFIN",
  // IT
  "TCS", "INFY", "WIPRO", "HCLTECH", "TECHM", "LTIM", "PERSISTENT",
  "COFORGE", "MPHASIS", "OFSS", "TATAELXSI",
  // Energy / Power / Oil & Gas
  "RELIANCE", "ONGC", "IOC", "BPCL", "HPCL", "GAIL", "POWERGRID", "NTPC",
  "TATAPOWER", "ADANIGREEN", "ADANIENSOL", "ADANIPOWER", "JSWENERGY",
  "NHPC", "SJVN", "TORNTPOWER", "CESC", "OIL", "PETRONET", "IGL", "MGL",
  "GUJGASLTD", "GSPL",
  // Auto & Auto Ancillary
  "MARUTI", "TATAMOTORS", "M&M", "BAJAJ-AUTO", "HEROMOTOCO", "EICHERMOT",
  "ASHOKLEY", "TVSMOTOR", "BOSCHLTD", "MOTHERSON", "MRF", "APOLLOTYRE",
  "BALKRISIND", "EXIDEIND", "BHARATFORG", "TIINDIA", "ABFRL",
  // Pharma & Healthcare
  "SUNPHARMA", "DRREDDY", "CIPLA", "DIVISLAB", "APOLLOHOSP", "LUPIN",
  "AUROPHARMA", "TORNTPHARM", "BIOCON", "ZYDUSLIFE", "ALKEM", "GLENMARK",
  "LAURUSLABS", "GRANULES", "IPCALAB", "ABBOTINDIA", "MAXHEALTH", "FORTIS",
  "SYNGENE", "GLAND", "SANOFI", "PFIZER",
  // FMCG & Consumer
  "HINDUNILVR", "ITC", "NESTLEIND", "BRITANNIA", "DABUR", "MARICO",
  "GODREJCP", "COLPAL", "TATACONSUM", "UNITDSPR", "UBL", "VBL",
  "PIDILITIND", "PGHH", "EMAMILTD", "JUBLFOOD",
  // Cement & Construction
  "ULTRACEMCO", "GRASIM", "AMBUJACEM", "ACC", "SHREECEM", "DALBHARAT",
  "JKCEMENT", "RAMCOCEM", "INDIACEM",
  // Metals & Mining
  "TATASTEEL", "JSWSTEEL", "HINDALCO", "VEDL", "JINDALSTEL", "SAIL",
  "NMDC", "COALINDIA", "HINDZINC", "NATIONALUM", "APLAPOLLO", "JSL",
  // Telecom & Media
  "BHARTIARTL", "VODAIDEA", "INDUSTOWER", "TATACOMM", "ZEEL", "PVRINOX",
  "SUNTV",
  // Capital Goods / Industrials / Defence
  "LT", "SIEMENS", "ABB", "BHEL", "BEL", "HAL", "BDL", "MAZDOCK",
  "CUMMINSIND", "POLYCAB", "HAVELLS", "VOLTAS", "BLUESTARCO", "CGPOWER",
  "ASTRAL", "KEI", "SUPREMEIND", "DIXON", "CROMPTON", "WHIRLPOOL",
  // Real Estate / Building Materials / Paints
  "DLF", "GODREJPROP", "OBEROIRLTY", "PRESTIGE", "LODHA", "BRIGADE",
  "PHOENIXLTD", "ASIANPAINT", "BERGEPAINT", "KANSAINER", "INDIGOPNTS",
  // Chemicals / Specialty / Agri
  "PIIND", "UPL", "SRF", "DEEPAKNTR", "ATUL", "AARTIIND", "NAVINFLUOR",
  "TATACHEM", "CHAMBLFERT", "COROMANDEL", "GNFC", "FACT", "BASF", "PCBL",
  "SOLARINDS",
  // Logistics / Transport
  "ADANIPORTS", "CONCOR", "INDIGO", "DELHIVERY", "GMRAIRPORT", "GMRINFRA",
  // Retail / Consumer Discretionary / Misc
  "TRENT", "TITAN", "DMART", "BATAINDIA", "PAGEIND",
  "ZOMATO", "NYKAA", "HONAUT", "ESCORTS",
  // Misc large-cap FNO regulars
  "ADANIENT", "BHARTIHEXA", "IDEA", "IRCTC", "RAILTEL", "MAPMYINDIA",
  "MCX", "CAMS", "KPITTECH", "LTTS", "LICI",
]);

/**
 * Trading universe for the swing book — derived once from the curated
 * set above. Exported as a sorted array for any UI / debug callers.
 */
export const FNO_EQUITY_LIST: readonly string[] = Object.freeze(
  Array.from(FNO_EQUITY_UNIVERSE).sort(),
);

export interface SwingSignal {
  symbol: string;
  name: string;
  exchange: string;
  triggeredAt: Date;
  /** IST date string YYYY-MM-DD when the signal fired. */
  signalDate: string;
  /** STRONG_BUY score reported by the scanner, 0-100 (null for NOT_EVALUATED rows, which never reach here). */
  score: number | null;
  /** LTP at signal-detection time → entry price (paper fill). */
  entryPrice: number;
  /** ATR-driven swing stop. */
  stopPrice: number;
  /** entry + 2R. */
  target1Price: number;
  /** entry + 3R. */
  target2Price: number;
  /** Per-share planned risk = entry − stop. */
  perShareRisk: number;
  /** ATR(14) used to size the stop, for log/UI traceability. */
  atr14: number;
  /** 20-bar swing low actually used in the stop calc. */
  swing20Low: number;
  /**
   * Source of the ATR/swing levels.
   * Currently always "yahoo" — daily bars from Yahoo Finance (delayed).
   * These levels are NOT trade-grade until migrated to Kite historical.
   */
  levelsSource: "yahoo" | "kite";
  /** Warnings about the data provenance of this signal. */
  levelsWarnings: string[];
}

function istDateKey(d: Date = new Date()): string {
  return new Date(d.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Recompute ATR(14) and the 20-bar swing low for a single symbol from
 * Yahoo daily bars. Re-fetched per signal because the scanner cache
 * stores derived indicators only — not the raw OHLC needed to find a
 * swing low. Cost is bounded: STRONG_BUY firings are rare (0-5 per
 * minute on the full NSE) so this is well under the Yahoo budget.
 *
 * Returns null if the bars are insufficient or the upstream is paused.
 * NEVER fabricates a level — a missing bar means no signal.
 */
export async function computeSwingLevels(
  symbol: string,
): Promise<{ atr14: number; swing20Low: number } | null> {
  // 6 months of daily bars ≈ 125 sessions: enough headroom for
  // 14-period ATR warm-up and a true 20-bar swing low.
  const chart = await fetchChart(symbol, "6mo", "1d");
  if (!chart) return null;
  const highs = chart.high.filter((v): v is number => v != null);
  const lows = chart.low.filter((v): v is number => v != null);
  const closes = chart.close.filter((v): v is number => v != null);
  if (highs.length < 21 || lows.length < 21 || closes.length < 21) return null;

  const atrSeries = atr(highs, lows, closes, 14);
  const atr14 = atrSeries[atrSeries.length - 1];
  if (atr14 == null || !(atr14 > 0)) return null;

  // 20-bar swing low excludes today's bar — we want the lowest low of
  // the prior 20 sessions so a trade triggered on a green-day breakout
  // is never stopped at its own intraday low.
  const recent = lows.slice(-21, -1);
  if (recent.length < 20) return null;
  let swing20Low = Infinity;
  for (const lo of recent) if (lo < swing20Low) swing20Low = lo;
  if (!Number.isFinite(swing20Low)) return null;

  return { atr14, swing20Low };
}

/**
 * Translate one STRONG_BUY scanner row into a fully-planned SwingSignal.
 * Returns null on any rejection (missing bars, degenerate stop, etc.)
 * with a structured log so the user can audit "why didn't we buy this?"
 *
 * Only the levels are computed here; concurrency, capital sizing and
 * persistence live in paperTradingEq.ts.
 */
export async function buildSwingSignalFromRow(
  row: StockRow,
  /** Optional minimum scanner score floor (defensive, atop STRONG_BUY). */
  minScore: number,
  sectorMap?: Map<string, SectorStrength>,
): Promise<SwingSignal | null> {
  if (!FNO_EQUITY_UNIVERSE.has(row.symbol)) return null;
  if (row.recommendation.signal !== "STRONG_BUY") return null;
  if ((row.recommendation.score ?? 0) < minScore) return null;

  const sector = row.sector || getEntry(row.symbol)?.sector;
  if (sector && sectorMap) {
    const strength = sectorMap.get(sector);
    if (strength && strength.isBottomQuartile) {
      logger.info(
        { symbol: row.symbol, sector, sectorRank: strength.rank, totalSectors: strength.totalSectors, sectorAvgChg: strength.avgChangePercent },
        "Swing skip: sector in bottom quartile — not entering longs in weak sectors",
      );
      return null;
    }
  }

  const ltp = row.quote.price;
  if (!(ltp > 0)) {
    logger.info({ symbol: row.symbol, ltp }, "Swing skip: invalid LTP");
    return null;
  }

  const openPrice = row.quote.open;
  const entryPrice = (openPrice != null && openPrice > 0) ? openPrice : ltp;

  // Volume confirmation: require the signal-bar volume to be ≥ 1.3× the
  // 20-day average. We never paper-trade a STRONG_BUY that fired on weak
  // participation — institutional buying leaves a volume footprint, and
  // a setup without one is far more likely to fail. If volumeRatio is
  // undefined (Kite-only row, no daily-bar history yet) we skip — no
  // confirmation, no trade.
  const volRatio = row.indicators?.volumeRatio;
  if (volRatio == null || volRatio < VOL_CONFIRM_FLOOR) {
    logger.info(
      { symbol: row.symbol, volRatio, floor: VOL_CONFIRM_FLOOR },
      "Swing skip: insufficient volume confirmation",
    );
    return null;
  }

  const levels = await computeSwingLevels(row.symbol);
  if (!levels) {
    logger.info({ symbol: row.symbol }, "Swing skip: insufficient bars for ATR/swing-low");
    return null;
  }

  const { atr14, swing20Low } = levels;
  // Pick the TIGHTER of the two stops (higher = closer to entry =
  // smaller per-share risk). Reject if even the tighter stop is at or
  // above entry — that means the bar pattern is degenerate (flat-day
  // + tiny ATR on a stock that's already stretched).
  //
  // Use the open-price-based entry (not LTP) so the stop distance and
  // R-multiples are measured from the realistic fill, matching how a
  // swing trader would size risk from a market-open order.
  const atrStop = entryPrice - 1.5 * atr14;
  const stopPrice = Math.max(atrStop, swing20Low);
  if (!(stopPrice > 0) || stopPrice >= entryPrice) {
    logger.info(
      { symbol: row.symbol, entryPrice, ltp, atrStop, swing20Low, stopPrice },
      "Swing skip: degenerate stop (>= entry)",
    );
    return null;
  }

  const r = entryPrice - stopPrice;
  const target1Price = entryPrice + 2 * r;
  const target2Price = entryPrice + 3 * r;
  const now = new Date();

  if (entryPrice !== ltp) {
    logger.info(
      { symbol: row.symbol, openEntry: entryPrice, ltp, diff: +(ltp - entryPrice).toFixed(2) },
      "Swing entry: using day open price instead of current LTP",
    );
  }

  return {
    symbol: row.symbol,
    name: row.name,
    exchange: "NSE",
    triggeredAt: now,
    signalDate: istDateKey(now),
    score: row.recommendation.score,
    entryPrice,
    stopPrice,
    target1Price,
    target2Price,
    perShareRisk: r,
    atr14,
    swing20Low,
    levelsSource: "yahoo",
    levelsWarnings: [
      "ATR(14) and swing-20-low derived from delayed Yahoo daily candles — not Kite trade-grade.",
    ],
  };
}

/**
 * Build SwingSignals for every STRONG_BUY scanner row that passes the
 * universe + score filter. Concurrent Yahoo fetches for the level
 * computation are allowed because the count is naturally tiny — the
 * full NSE rarely emits more than ~10 STRONG_BUYs in a single tick.
 */
export async function buildAllSwingSignals(
  rows: readonly StockRow[],
  minScore: number,
): Promise<SwingSignal[]> {
  const candidates = rows.filter(
    (r) =>
      FNO_EQUITY_UNIVERSE.has(r.symbol) &&
      r.recommendation.signal === "STRONG_BUY" &&
      (r.recommendation.score ?? 0) >= minScore,
  );
  if (candidates.length === 0) return [];

  const sectorMap = buildSectorStrengthMap(rows);
  if (sectorMap.size > 0) {
    const bottomQuartile = [...sectorMap.entries()]
      .filter(([, s]) => s.isBottomQuartile)
      .map(([sec, s]) => `${sec}(${s.avgChangePercent}%)`);
    if (bottomQuartile.length > 0) {
      logger.info(
        { bottomQuartileSectors: bottomQuartile },
        "Swing: sector-strength gate active — bottom-quartile sectors will be skipped",
      );
    }
  }
  const built = await Promise.all(
    candidates.map((r) => buildSwingSignalFromRow(r, minScore, sectorMap)),
  );
  return built.filter((s): s is SwingSignal => s != null);
}
