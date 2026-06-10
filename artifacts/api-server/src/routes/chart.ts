/**
 * `/api/chart/*` — read-only datafeed for the Charting tab.
 *
 * Two endpoints, both behind the shared `requireAuth` gate (mounted in
 * routes/index.ts), so they honour public-mode read access exactly like
 * the rest of the scanner's data surface. They NEVER mutate state and are
 * fully isolated from signal generation / paper trading / schema.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { searchInstruments, type ChartInstrumentDto } from "../lib/chartInstruments";
import { searchMaster } from "../lib/marketData/instrumentResolver";
import {
  getChartCandles,
  ALL_TIMEFRAMES,
  type ChartTimeframe,
} from "../lib/chartDatafeed";

const router: IRouter = Router();

const SegmentEnum = z.enum(["index", "equity", "global"]);
const TimeframeEnum = z.enum(ALL_TIMEFRAMES as [ChartTimeframe, ...ChartTimeframe[]]);

const InstrumentsQuery = z.object({
  q: z.string().max(64).optional(),
  segment: SegmentEnum.optional(),
});

router.get("/chart/instruments", (req, res) => {
  const parsed = InstrumentsQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid query", code: "BAD_QUERY" });
    return;
  }
  const q = parsed.data.q ?? "";
  const segment = parsed.data.segment;
  const curated = searchInstruments(q, segment);

  // Merge the full Kite master so any real NSE/BSE equity or ETF — not just the
  // curated ~280-name UNIVERSE — is searchable everywhere this endpoint feeds
  // (Charting picker, Portfolio Add-Holdings autocomplete, etc.). Curated
  // indices/global/equities rank first; master hits fill the long tail.
  let instruments: ChartInstrumentDto[] = curated;
  if (q.trim().length > 0 && (segment === undefined || segment === "equity")) {
    const seen = new Set(curated.map(i => i.symbol.toUpperCase()));
    const masterHits: ChartInstrumentDto[] = searchMaster(q, 30)
      .filter(h => !seen.has(h.symbol.toUpperCase()))
      .map(h => ({
        symbol: h.symbol,
        name: h.name,
        segment: "equity" as const,
        exchange: h.exchange,
        type: h.type,
      }));
    instruments = [...curated, ...masterHits];
  }
  res.json({ query: q, instruments });
});

const CandlesQuery = z.object({
  symbol: z.string().min(1).max(32),
  segment: SegmentEnum,
  tf: TimeframeEnum,
});

router.get("/chart/candles", async (req, res) => {
  const parsed = CandlesQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid query", code: "BAD_QUERY" });
    return;
  }
  const { symbol, segment, tf } = parsed.data;
  try {
    const result = await getChartCandles(symbol, segment, tf);
    res.json(result);
  } catch (err) {
    req.log?.warn({ err: (err as Error).message, symbol, segment, tf }, "chart candles failed");
    res.status(502).json({ error: "datafeed error", code: "DATAFEED_ERROR" });
  }
});

export default router;
