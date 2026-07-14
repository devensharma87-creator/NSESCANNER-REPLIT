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
import {
  searchInstruments,
  mergeMasterHits,
  type ChartInstrumentDto,
} from "../lib/chartInstruments";
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
    // Dedupe master hits (NSE-ranked) behind curated so a ticker listed on more
    // than one exchange (TRIDENT/BDL/ARE&M/INDHOTEL/BLS exist on both NSE+BSE)
    // never appears twice; BSE-only names (NSDL) still survive. See helper.
    instruments = mergeMasterHits(curated, searchMaster(q, 60), 30);
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

// ── Chart Audit Endpoint ────────────────────────────────────────────────────
//
// GET /api/chart/audit?symbol=NIFTY&segment=index&tf=15m
//
// Returns a comprehensive diagnostic view of the chart data for an instrument:
// instrument identity, source provider, candle count, duplicate timestamps,
// missing timestamps during NSE session, volume source, and a 20-candle sample.

const AuditQuery = z.object({
  symbol: z.string().min(1).max(32),
  segment: SegmentEnum,
  tf: TimeframeEnum,
});

router.get("/chart/audit", async (req, res) => {
  const parsed = AuditQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid query", code: "BAD_QUERY" });
    return;
  }
  const { symbol, segment, tf } = parsed.data;
  try {
    const result = await getChartCandles(symbol, segment, tf);
    const candles = result.candles;

    // Detect duplicate timestamps
    const tsSet = new Set<number>();
    const duplicateTimestamps: number[] = [];
    for (const c of candles) {
      if (tsSet.has(c.t)) duplicateTimestamps.push(c.t);
      tsSet.add(c.t);
    }

    // Detect missing timestamps during NSE session (09:15-15:30 IST)
    // Only for intraday Indian instruments
    const missingTimestamps: number[] = [];
    const tfMinutes: Record<string, number> = {
      "1m": 1, "3m": 3, "5m": 5, "15m": 15, "30m": 30, "1h": 60,
    };
    const intervalMin = tfMinutes[tf];
    if (intervalMin && segment !== "global" && candles.length > 1) {
      const IST_OFFSET = 5.5 * 3600;
      for (let i = 1; i < candles.length; i++) {
        const prev = candles[i - 1]!;
        const curr = candles[i]!;
        const gap = curr.t - prev.t;
        const expectedGap = intervalMin * 60;
        // Only flag gaps that are within the same trading day
        const prevIst = new Date((prev.t + IST_OFFSET) * 1000);
        const currIst = new Date((curr.t + IST_OFFSET) * 1000);
        const sameDay = prevIst.toISOString().slice(0, 10) === currIst.toISOString().slice(0, 10);
        const prevHour = prevIst.getUTCHours();
        const prevMin = prevIst.getUTCMinutes();
        const inSession = prevHour >= 9 && (prevHour < 15 || (prevHour === 15 && prevMin <= 30));
        if (sameDay && inSession && gap > expectedGap * 1.5) {
          // There are missing bars
          const count = Math.floor(gap / expectedGap) - 1;
          for (let j = 1; j <= count; j++) {
            missingTimestamps.push(prev.t + j * expectedGap);
          }
        }
      }
    }

    // Weekend/holiday gaps (daily only)
    const weekendGaps: string[] = [];
    if (tf === "1D" && candles.length > 1) {
      for (let i = 1; i < candles.length; i++) {
        const gap = candles[i]!.t - candles[i - 1]!.t;
        if (gap > 4 * 86400) { // More than 4 days gap
          weekendGaps.push(
            `${new Date(candles[i - 1]!.t * 1000).toISOString().slice(0, 10)} → ${new Date(candles[i]!.t * 1000).toISOString().slice(0, 10)} (${Math.round(gap / 86400)}d)`,
          );
        }
      }
    }

    const firstCandle = candles[0] ?? null;
    const lastCandle = candles[candles.length - 1] ?? null;
    const last20 = candles.slice(-20);

    res.json({
      instrument: {
        symbol: result.symbol,
        segment: result.segment,
        timeframe: result.timeframe,
      },
      provenance: {
        sourceProvider: result.sourceProvider,
        sourceTier: result.sourceTier,
        live: result.live,
        delayed: result.delayed,
        stale: result.stale,
        fallbackUsed: result.fallbackUsed,
        synthetic: result.synthetic,
        visualOnly: result.visualOnly,
        lastUpdatedAt: result.lastUpdatedAt,
        volumeSource: result.volumeSource,
        volumeSourceInstrument: result.volumeSourceInstrument,
        volumeProxy: result.volumeProxy,
        warnings: result.warnings,
      },
      quality: {
        candleCount: candles.length,
        firstCandle: firstCandle
          ? { t: firstCandle.t, iso: new Date(firstCandle.t * 1000).toISOString(), o: firstCandle.o, h: firstCandle.h, l: firstCandle.l, c: firstCandle.c, v: firstCandle.v }
          : null,
        lastCandle: lastCandle
          ? { t: lastCandle.t, iso: new Date(lastCandle.t * 1000).toISOString(), o: lastCandle.o, h: lastCandle.h, l: lastCandle.l, c: lastCandle.c, v: lastCandle.v }
          : null,
        duplicateTimestamps: duplicateTimestamps.length,
        duplicateTimestampSamples: duplicateTimestamps.slice(0, 5).map(t => new Date(t * 1000).toISOString()),
        missingTimestampsDuringSession: missingTimestamps.length,
        missingTimestampSamples: missingTimestamps.slice(0, 10).map(t => new Date(t * 1000).toISOString()),
        weekendHolidayGaps: weekendGaps.slice(0, 5),
      },
      last20Sample: last20.map(c => ({
        t: c.t,
        iso: new Date(c.t * 1000).toISOString(),
        o: c.o,
        h: c.h,
        l: c.l,
        c: c.c,
        v: c.v,
      })),
    });
  } catch (err) {
    req.log?.warn({ err: (err as Error).message, symbol, segment, tf }, "chart audit failed");
    res.status(502).json({ error: "audit failed", code: "AUDIT_ERROR" });
  }
});

export default router;
