import {
  useListStocks,
  getListStocksQueryKey,
} from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SignalBadge } from "@/components/ui/signal-badge";
import { ScoreBar } from "@/components/ui/score-bar";
import { ArrowUp, ArrowDown, ArrowUpDown, RefreshCw, Download } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState, useMemo, useEffect, useDeferredValue, useRef, memo } from "react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { DataSourceBadge } from "@/components/ui/data-source-badge";
import type { StockRow } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";

interface FullNseResponse {
  rows: StockRow[];
  total: number;
  universeSize: number;
  sourceDate: string;
  /** ISO timestamp of when the cached rows were produced — drives the freshness pill. */
  lastUpdated?: string;
  scanMs: number;
  failures: number;
  rested: number;
  /** True when the most recent scan ran without an authenticated Kite session — coverage will be limited to whatever Yahoo can supply. */
  kiteOffline?: boolean;
}

interface FullNseStatus {
  hasCache: boolean;
  rows: number;
  total: number;
  progress: { running: boolean; scanned: number; total: number; startedAt: number | null };
  // Best-known universe size — server-reported, falls back to in-flight
  // scan total during a cold start so the loading UI can show a real
  // number instead of "0 of 0".
  universeEstimate: number;
}

const FULL_NSE_QS = "limit=5000&sortBy=changePct&order=desc";

/**
 * React-Query backed full NSE EQ universe (~2486 symbols). Switching to a
 * shared QueryClient cache means navigating away from /scanner and back no
 * longer drops the rows back to undefined — which was the root cause of the
 * "after I switch tabs only 199 stocks show up again" bug. The data lives
 * in the QueryClient for the lifetime of the app session.
 */
function useFullNseStocks() {
  const q = useQuery({
    queryKey: ["full-nse", FULL_NSE_QS],
    queryFn: async (): Promise<FullNseResponse> => {
      const r = await fetch(`/api/scan/full-nse?${FULL_NSE_QS}`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
    // Keep the previous payload in cache forever within the session — never
    // replace good data with `undefined`. This is what kills the "now I only
    // see 199 stocks again" flash on tab switch.
    gcTime: Infinity,
  });
  return {
    data: q.data?.rows,
    isLoading: q.isLoading && !q.data,
    meta: q.data ? {
      universeSize: q.data.universeSize,
      sourceDate: q.data.sourceDate,
      lastUpdated: q.data.lastUpdated,
      scanMs: q.data.scanMs,
      failures: q.data.failures,
      rested: q.data.rested,
      kiteOffline: q.data.kiteOffline,
    } : null,
  };
}

/**
 * Lightweight cold-scan progress poll — separate query so progress can update
 * frequently without re-fetching the heavyweight rows payload. Polls fast
 * (3s) while a scan is running so the X/Y counter ticks live, and slows
 * down (30s) when idle so we don't keep slamming the server doing nothing.
 * Returns the FULL status payload (not just `progress`) so the caller can
 * show a real universe-size estimate during the very first cold scan
 * before any rows have arrived.
 */
function useFullNseStatus() {
  const q = useQuery({
    queryKey: ["full-nse-status"],
    queryFn: async (): Promise<FullNseStatus> => {
      const r = await fetch(`/api/scan/full-nse/status`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: (query) => {
      // Adaptive cadence: tight loop while scanning, lazy when idle.
      const running = query.state.data?.progress.running;
      return running ? 3_000 : 30_000;
    },
    refetchIntervalInBackground: false,
    staleTime: 0,
    gcTime: 60_000,
  });
  return q.data ?? null;
}

type SortKey = "symbol" | "price" | "change" | "changePct" | "open" | "high" | "low" | "prev" | "vwap" | "ema20" | "ema50" | "ema100" | "ema200" | "rsi" | "yrHi" | "yrLo" | "fromYrHi" | "fromYrLo" | "vol" | "delivery" | "score" | "futOi";
type SortDir = "asc" | "desc";

function getSortValue(s: StockRow, key: SortKey): number | string {
  switch (key) {
    case "symbol": return s.symbol;
    case "price": return s.quote.price;
    case "change": return s.quote.change;
    case "changePct": return s.quote.changePercent;
    case "open": return s.quote.open;
    case "high": return s.quote.high;
    case "low": return s.quote.low;
    case "prev": return s.quote.previousClose;
    case "vwap": return s.indicators?.vwap ?? -Infinity;
    case "ema20": return s.indicators?.ema20 ?? -Infinity;
    case "ema50": return s.indicators?.ema50 ?? -Infinity;
    case "ema100": return s.indicators?.ema100 ?? -Infinity;
    case "ema200": return s.indicators?.ema200 ?? -Infinity;
    case "rsi": return s.indicators?.rsi14 ?? -Infinity;
    case "yrHi": return s.quote.fiftyTwoWeekHigh ?? -Infinity;
    case "yrLo": return s.quote.fiftyTwoWeekLow ?? -Infinity;
    case "fromYrHi": {
      const hi = s.quote.fiftyTwoWeekHigh;
      return hi != null && hi > 0 ? ((s.quote.price - hi) / hi) * 100 : -Infinity;
    }
    case "fromYrLo": {
      const lo = s.quote.fiftyTwoWeekLow;
      return lo != null && lo > 0 ? ((s.quote.price - lo) / lo) * 100 : -Infinity;
    }
    case "vol": return s.indicators?.volumeRatio ?? -Infinity;
    case "delivery": return s.indicators?.deliveryPct ?? -Infinity;
    case "futOi": { const b = (s.indicators as Record<string, unknown> | undefined)?.futOiBuildup as string | undefined; return b === "LONG_BUILDUP" ? 4 : b === "SHORT_COVERING" ? 3 : b === "NEUTRAL" ? 2 : b === "LONG_UNWINDING" ? 1 : b === "SHORT_BUILDUP" ? 0 : -1; }
    case "score": return s.recommendation.score;
  }
}

function SortHead({ k, label, sort, setSort, align = "right" }: { k: SortKey; label: string; sort: { key: SortKey; dir: SortDir }; setSort: (s: { key: SortKey; dir: SortDir }) => void; align?: "left" | "right"; }) {
  const active = sort.key === k;
  const Icon = !active ? ArrowUpDown : sort.dir === "desc" ? ArrowDown : ArrowUp;
  const click = () => setSort({ key: k, dir: active && sort.dir === "desc" ? "asc" : "desc" });
  // For right-aligned columns we render [icon][label] (icon on the LEFT of the
  // label) so the label's right edge sits flush with the data digits below it.
  // The previous [label][icon] layout pushed the label ~16px left of every
  // numeric value, making the header look misaligned with its column data.
  return (
    <button
      onClick={click}
      className={`inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider hover:text-foreground transition-colors ${active ? "text-foreground" : "text-muted-foreground"}`}
    >
      {align === "right" ? (
        <>
          <Icon className="w-3 h-3 opacity-70" />
          {label}
        </>
      ) : (
        <>
          {label}
          <Icon className="w-3 h-3 opacity-70" />
        </>
      )}
    </button>
  );
}

function fmtIN(n: number) {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

function buildReasonsTitle(s: StockRow): string {
  const top = (s.recommendation.reasons ?? [])
    .slice()
    .sort((a: { weight: number }, b: { weight: number }) => b.weight - a.weight)
    .slice(0, 5);
  return top.map((r: { bullish: boolean; label: string; weight: number; detail: string }) =>
    `${r.bullish ? "+" : "–"} ${r.label} (w${r.weight}): ${r.detail}`
  ).join("\n");
}

const SCREENS = [
  { id: "none", label: "All" },
  { id: "rsiOversold", label: "RSI < 30" },
  { id: "rsiOverbought", label: "RSI > 70" },
  { id: "aboveVwap", label: "Above VWAP" },
  { id: "belowVwap", label: "Below VWAP" },
  { id: "volSpike", label: "Vol > 2×" },
  { id: "near52wHigh", label: "Near 52W High" },
  { id: "near52wLow", label: "Near 52W Low" },
  { id: "goldenCross", label: "Golden Stack" },
  { id: "deathCross", label: "Death Stack" },
  { id: "topBuys", label: "Strong Bullish" },
  { id: "topSells", label: "Strong Bearish" },
];

const ROW_HEIGHT = 48;
// CSS Grid template for the 19-column NSE table. Every column is `minmax(min,
// fr)` — `min` is the smallest readable width for that column's typical
// content, `fr` is its share of the leftover space when the viewport is wider
// than the sum of all minima. This auto-fits the table to any viewport
// (1280 px laptop → 2560 px monitor) without leaving a dead band on the
// right edge or forcing horizontal scroll on standard widths. Header and
// rows BOTH use this exact template via `display: grid`, so column
// boundaries align perfectly — no per-cell width styles required.
const GRID_TEMPLATE = [
  "minmax(110px, 130px)",   // SYMBOL    — stock + sector, sticky left
  "minmax(74px, 1.2fr)",    // CMP       — bold price, slightly wider
  "minmax(60px, 1fr)",      // CHG
  "minmax(64px, 1fr)",      // %CHG
  "minmax(60px, 1fr)",      // OPEN
  "minmax(60px, 1fr)",      // HIGH
  "minmax(60px, 1fr)",      // LOW
  "minmax(60px, 1fr)",      // PREV
  "minmax(60px, 1fr)",      // VWAP
  "minmax(60px, 1fr)",      // EMA20
  "minmax(60px, 1fr)",      // EMA50
  "minmax(60px, 1fr)",      // EMA100
  "minmax(60px, 1fr)",      // EMA200
  "minmax(46px, 0.8fr)",    // RSI       — 2-digit decimal, narrowest
  "minmax(76px, 1.2fr)",    // 52W H + distance below
  "minmax(76px, 1.2fr)",    // 52W L + distance below
  "minmax(52px, 0.9fr)",    // VOL×
  "minmax(60px, 1fr)",      // DEL%      — delivery % (cash-market conviction)
  "minmax(80px, 1fr)",      // FUT OI    — buildup classification
  "minmax(112px, 1.6fr)",   // SCORE     — visualisation bar (ScoreBar inner min-w-[90px] + cell px-2 ≈ 106 px), rounded up
  "minmax(118px, 130px)",   // SIGNAL    — pill, capped; min sized to clear "STRONG BEARISH" label at the badge's text-[10px] font-mono
].join(" ");
const TOTAL_WIDTH = 110 + 74 + 60 + 64 + 60*5 + 60*4 + 46 + 76*2 + 52 + 60 + 80 + 112 + 100;

const formatPct = (p: number) => `${p > 0 ? '+' : ''}${p.toFixed(2)}%`;
const fmt = (n: number | undefined | null, dp = 2) => n == null ? "—" : n.toFixed(dp);

const OI_BUILDUP_STYLE: Record<string, { label: string; cls: string }> = {
  LONG_BUILDUP:   { label: "Long",   cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  SHORT_BUILDUP:  { label: "Short",  cls: "bg-rose-500/15 text-rose-300 border-rose-500/30" },
  SHORT_COVERING: { label: "SC",     cls: "bg-sky-500/15 text-sky-300 border-sky-500/30" },
  LONG_UNWINDING: { label: "LU",     cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  NEUTRAL:        { label: "Flat",   cls: "bg-slate-500/10 text-slate-400 border-slate-500/20" },
};
function OiBuildupBadge({ buildup }: { buildup: string | undefined }) {
  if (!buildup) return <span className="text-xs text-muted-foreground">—</span>;
  const s = OI_BUILDUP_STYLE[buildup] ?? { label: buildup, cls: "bg-slate-500/10 text-slate-400 border-slate-500/20" };
  return <span className={`px-1.5 py-0.5 rounded border text-[10px] font-mono ${s.cls}`}>{s.label}</span>;
}

/**
 * Memoized row component — referentially stable so the virtualizer can skip
 * re-renders for rows that didn't change. Each row is a flex row of <div>s
 * (NOT a <tr>) because virtualization requires absolute positioning, which
 * the browser doesn't apply correctly inside <table> markup.
 */
const Row = memo(function Row({ stock, top }: { stock: StockRow; top: number }) {
  const q = stock.quote;
  const ind = stock.indicators;
  const chgClass = q.changePercent >= 0 ? 'text-signal-strong-buy' : 'text-signal-strong-sell';
  const cmpVsVwap = ind?.vwap != null ? (q.price >= ind.vwap ? 'text-signal-strong-buy' : 'text-signal-strong-sell') : '';
  return (
    <div
      role="row"
      className="absolute left-0 right-0 grid items-center border-b border-border/50 hover:bg-accent/40 group"
      style={{ top, height: ROW_HEIGHT, minWidth: TOTAL_WIDTH, gridTemplateColumns: GRID_TEMPLATE }}
      title={buildReasonsTitle(stock)}
    >
      <div className="sticky left-0 bg-card group-hover:bg-accent/40 z-10 px-3 py-1.5 flex flex-col justify-center min-w-0">
        <Link href={`/stock/${stock.symbol}`} className="font-mono font-bold hover:underline text-sm leading-tight truncate">
          {stock.symbol}
        </Link>
        <div className="text-[10px] text-muted-foreground truncate">{stock.sector}</div>
      </div>
      <div className={`text-right font-mono text-sm font-bold tabular-nums px-2 ${cmpVsVwap}`}>{fmtIN(q.price)}</div>
      <div className={`text-right font-mono text-xs tabular-nums px-2 ${chgClass}`}>{q.change >= 0 ? "+" : ""}{fmt(q.change)}</div>
      <div className={`text-right font-mono text-xs font-medium tabular-nums px-2 ${chgClass}`}>{formatPct(q.changePercent)}</div>
      <div className="text-right font-mono text-xs tabular-nums px-2">{fmt(q.open)}</div>
      <div className="text-right font-mono text-xs tabular-nums px-2">{fmt(q.high)}</div>
      <div className="text-right font-mono text-xs tabular-nums px-2">{fmt(q.low)}</div>
      <div className="text-right font-mono text-xs text-muted-foreground tabular-nums px-2">{fmt(q.previousClose)}</div>
      <div className="text-right font-mono text-xs tabular-nums px-2">{fmt(ind?.vwap)}</div>
      <div className="text-right font-mono text-xs tabular-nums px-2">{fmt(ind?.ema20)}</div>
      <div className="text-right font-mono text-xs tabular-nums px-2">{fmt(ind?.ema50)}</div>
      <div className="text-right font-mono text-xs tabular-nums px-2">{fmt(ind?.ema100)}</div>
      <div className="text-right font-mono text-xs tabular-nums px-2">{fmt(ind?.ema200)}</div>
      <div className={`text-right font-mono text-xs tabular-nums px-2 ${ind?.rsi14 != null && ind.rsi14 > 70 ? 'text-signal-strong-sell' : ind?.rsi14 != null && ind.rsi14 < 30 ? 'text-signal-strong-buy' : ''}`}>{fmt(ind?.rsi14, 1)}</div>
      <div className="text-right font-mono px-2 leading-tight" title={q.fiftyTwoWeekHigh != null ? `52-week high: ₹${q.fiftyTwoWeekHigh.toFixed(2)}` : undefined}>
        <div className="text-xs text-muted-foreground tabular-nums">{fmt(q.fiftyTwoWeekHigh)}</div>
        {q.fiftyTwoWeekHigh != null && q.fiftyTwoWeekHigh > 0 && (() => {
          const d = ((q.price - q.fiftyTwoWeekHigh) / q.fiftyTwoWeekHigh) * 100;
          // <-3% = comfortably below high; >-1% = "near high" (potential breakout); 0/+ = at/above (rare).
          const tone = d >= -1 ? 'text-signal-strong-buy font-bold' : d >= -10 ? 'text-amber-400' : 'text-muted-foreground';
          return <div className={`text-[10px] tabular-nums ${tone}`}>{d > 0 ? '+' : ''}{d.toFixed(1)}%</div>;
        })()}
      </div>
      <div className="text-right font-mono px-2 leading-tight" title={q.fiftyTwoWeekLow != null ? `52-week low: ₹${q.fiftyTwoWeekLow.toFixed(2)}` : undefined}>
        <div className="text-xs text-muted-foreground tabular-nums">{fmt(q.fiftyTwoWeekLow)}</div>
        {q.fiftyTwoWeekLow != null && q.fiftyTwoWeekLow > 0 && (() => {
          const d = ((q.price - q.fiftyTwoWeekLow) / q.fiftyTwoWeekLow) * 100;
          // Distance from the 52-week low. Normally ≥0 since price > low,
          // but stale highs/lows during corporate actions can briefly push
          // price below the recorded low — must render a signed value
          // ("-1.2%") in that case rather than a malformed "+-1.2%".
          const tone = d <= 5 ? 'text-signal-strong-sell font-bold' : d <= 25 ? 'text-amber-400' : 'text-muted-foreground';
          const sign = d > 0 ? '+' : '';
          return <div className={`text-[10px] tabular-nums ${tone}`}>{sign}{d.toFixed(1)}%</div>;
        })()}
      </div>
      <div className="text-right font-mono text-xs tabular-nums px-2">{ind?.volumeRatio != null ? `${ind.volumeRatio.toFixed(1)}×` : '—'}</div>
      <div
        className={`text-right font-mono text-xs tabular-nums px-2 ${
          ind?.deliveryPct == null ? 'text-muted-foreground'
          : ind.deliveryPct >= 60 ? 'text-signal-strong-buy font-bold'
          : ind.deliveryPct >= 45 ? 'text-emerald-300'
          : ind.deliveryPct < 25 ? 'text-amber-400'
          : ''
        }`}
        title="Delivery % from NSE bhavcopy — share of today's volume that resulted in actual delivery to demat (vs. intraday churn). High = conviction-led move, low = speculative."
      >{ind?.deliveryPct != null ? `${ind.deliveryPct.toFixed(0)}%` : '—'}</div>
      <div className="px-2"><OiBuildupBadge buildup={(ind as Record<string, unknown> | undefined)?.futOiBuildup as string | undefined} /></div>
      <div className="px-2 min-w-0"><ScoreBar score={stock.recommendation.score} /></div>
      <div className="px-2 flex items-center justify-end"><SignalBadge signal={stock.recommendation.signal} /></div>
    </div>
  );
});

export default function ScannerPage() {
  const [location] = useLocation();

  const initialSearch = useMemo(() => {
    const idx = location.indexOf("?");
    return idx >= 0 ? new URLSearchParams(location.slice(idx + 1)).get("search") || "" : "";
  }, [location]);
  const initialSector = useMemo(() => {
    const idx = location.indexOf("?");
    return idx >= 0 ? new URLSearchParams(location.slice(idx + 1)).get("sector") || "all" : "all";
  }, [location]);

  const [sectorFilter, setSectorFilter] = useState<string>(initialSector);
  const [signalFilter, setSignalFilter] = useState<string>("all");
  const [searchFilter, setSearchFilter] = useState<string>(initialSearch);

  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "score", dir: "desc" });
  const [screen, setScreen] = useState<string>("none");

  useEffect(() => { setSearchFilter(initialSearch); }, [initialSearch]);
  useEffect(() => { setSectorFilter(initialSector); }, [initialSector]);

  // Always pull BOTH datasets and merge on the client. The Scanner table is
  // expected to show every NSE-listed stock the system knows about — so we
  // need the curated F&O universe (rich indicators: ema100/ema200/52W highs,
  // sector tagging) AND the full bhavcopy-derived universe (~2486 EQ names
  // with lighter indicators). Curated data wins on overlap because it has
  // strictly more fields populated.
  //
  // The curated query refreshes much more lazily than the full-NSE query —
  // /api/scan/full-nse already covers every symbol curated does, and the
  // curated payload exists only to enrich indicator coverage on the F&O
  // names. Polling it every minute was wasteful (200-row response, every
  // tab in the app pays the cost). 5-minute interval is plenty.
  const { data: curatedStocks, isLoading: curatedLoading } = useListStocks(undefined, {
    query: {
      refetchInterval: 300_000,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: false,
      staleTime: 120_000,
      gcTime: Infinity,
      queryKey: getListStocksQueryKey(undefined),
    },
  });
  const { data: fullStocks, isLoading: fullLoading, meta: fullMeta } = useFullNseStocks();
  const status = useFullNseStatus();
  const fullProgress = status?.progress ?? null;

  // useDeferredValue keeps the input responsive while the expensive 2,500-row
  // filter+sort recomputes on a lower-priority render pass.
  const deferredSearch = useDeferredValue(searchFilter);

  const mergedStocks = useMemo(() => {
    const bySymbol = new Map<string, StockRow>();
    for (const r of fullStocks ?? []) bySymbol.set(r.symbol, r);
    for (const r of curatedStocks ?? []) bySymbol.set(r.symbol, r);
    return Array.from(bySymbol.values());
  }, [fullStocks, curatedStocks]);

  // Spinner only when literally nothing has arrived yet. Once EITHER source
  // returns rows we hide the loading state — even if the other is still
  // refetching in the background — so the table never blanks out on every
  // 60s refresh.
  const stocksLoading = mergedStocks.length === 0 && (curatedLoading || fullLoading);

  // Best-known universe size during a cold start: prefer the cache total
  // once it lands, else the in-flight scan total (post-dedup), else the
  // raw progress count. Lets the UI show "Scanning ~2,486 stocks…"
  // instead of "0 of 0" while the very first /api/scan/full-nse call
  // is still running.
  const universeEstimate =
    fullMeta?.universeSize
    ?? status?.universeEstimate
    ?? fullProgress?.total
    ?? 0;

  const sectors = useMemo(() => {
    const set = new Set<string>();
    mergedStocks.forEach(s => set.add(s.sector));
    return Array.from(set).sort();
  }, [mergedStocks]);

  const sortedStocks = useMemo(() => {
    if (!mergedStocks || mergedStocks.length === 0) return [] as StockRow[];
    let arr = mergedStocks;
    if (sectorFilter !== "all") arr = arr.filter(s => s.sector === sectorFilter);
    if (signalFilter !== "all") arr = arr.filter(s => s.recommendation.signal === signalFilter);
    if (deferredSearch.trim()) {
      const q = deferredSearch.trim().toUpperCase();
      arr = arr.filter(s => s.symbol.toUpperCase().includes(q) || (s.name ?? "").toUpperCase().includes(q));
    }
    arr = arr.filter(s => {
      const ind = s.indicators;
      const q = s.quote;
      switch (screen) {
        case "rsiOversold": return ind?.rsi14 != null && ind.rsi14 < 30;
        case "rsiOverbought": return ind?.rsi14 != null && ind.rsi14 > 70;
        case "aboveVwap": return ind?.vwap != null && q.price > ind.vwap;
        case "belowVwap": return ind?.vwap != null && q.price < ind.vwap;
        case "volSpike": return ind?.volumeRatio != null && ind.volumeRatio > 2;
        case "near52wHigh": return q.fiftyTwoWeekHigh != null && q.price >= q.fiftyTwoWeekHigh * 0.95;
        case "near52wLow": return q.fiftyTwoWeekLow != null && q.price <= q.fiftyTwoWeekLow * 1.05;
        case "goldenCross": return ind?.ema20 != null && ind?.ema50 != null && ind?.ema200 != null && ind.ema20 > ind.ema50 && ind.ema50 > ind.ema200;
        case "deathCross": return ind?.ema20 != null && ind?.ema50 != null && ind?.ema200 != null && ind.ema20 < ind.ema50 && ind.ema50 < ind.ema200;
        case "topBuys": return s.recommendation.signal === "STRONG_BUY";
        case "topSells": return s.recommendation.signal === "STRONG_SELL";
        default: return true;
      }
    });
    arr = arr.slice().sort((a, b) => {
      const av = getSortValue(a, sort.key);
      const bv = getSortValue(b, sort.key);
      let cmp = 0;
      if (typeof av === "string" && typeof bv === "string") cmp = av.localeCompare(bv);
      else cmp = (av as number) - (bv as number);
      return sort.dir === "desc" ? -cmp : cmp;
    });
    return arr;
  }, [mergedStocks, sort, screen, sectorFilter, signalFilter, deferredSearch]);

  // --- Virtualization ----------------------------------------------------
  // Render only the visible rows — so 2,500 stocks feel as snappy as 25.
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: sortedStocks.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  return (
    <div className="w-full max-w-none px-4 py-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold font-mono tracking-tight">FULL SCANNER</h1>
            <DataSourceBadge
              source={fullMeta?.kiteOffline ? "yahoo" : "kite"}
              status={fullMeta?.kiteOffline ? "delayed" : "live"}
              fallbackActive={!!fullMeta?.kiteOffline}
              // Real wall-clock of the last successful scan (ISO from
              // server). Previously we were passing `sourceDate` which is
              // the bhavcopy date (no time component) — that always
              // parsed to midnight UTC and made the pill read "15h ago"
              // even on a fresh scan.
              lastUpdated={fullMeta?.lastUpdated}
              refreshMs={60_000}
              autoStaleAfterMs={120_000}
              note={fullMeta?.kiteOffline ? "Kite session offline — Yahoo backup active" : undefined}
              compact
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {(() => {
              // Honest universe / coverage breakdown — addresses the audit
              // finding that the old copy ("All NSE stocks tracked live")
              // overstates reality whenever the broker session is offline
              // or upstream rate-limits cull a portion of each cycle.
              const universe = fullMeta?.universeSize ?? 0;
              const failures = fullMeta?.failures ?? 0;
              const live = Math.max(0, universe - failures);
              return (
                <>
                  Universe <span className="font-mono text-foreground">{universe ? universe.toLocaleString("en-IN") : "…"}</span>
                  {" · "}live feed <span className="font-mono text-foreground">{universe ? live.toLocaleString("en-IN") : "…"}</span>
                  {" · "}no feed this cycle <span className="font-mono text-foreground">{failures.toLocaleString("en-IN")}</span>
                  {" · "}sortable column headers · screen presets narrow the view · hover any row for the top reasons behind its signal.
                </>
              );
            })()}
            {fullMeta && <span className="block mt-0.5 text-[11px]">Last full scan: <span className="font-mono">{(fullMeta.scanMs / 1000).toFixed(1)}s</span> · {fullMeta.failures} no-feed · {fullMeta.rested} rested · source {fullMeta.sourceDate}.</span>}
          </p>
          {fullMeta?.kiteOffline && (
            <div className="mt-2 inline-flex items-start gap-2 px-3 py-2 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-300 text-[11px] font-mono max-w-2xl">
              <span className="font-bold uppercase tracking-wider">Kite session offline</span>
              <span className="text-amber-200/80">
                — primary broker feed isn't authenticated. Quotes are coming from the chart provider as a backup, so a portion of the universe may be missing each cycle.
                {" "}
                <a href="/kite" className="underline hover:text-amber-100">Reconnect Kite</a> for full coverage.
              </span>
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          {fullProgress?.running && fullProgress.total > 0 && (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-primary/40 bg-primary/10 font-mono text-[11px] text-primary">
              <RefreshCw className="h-3 w-3 animate-spin" />
              Scanning {fullProgress.scanned.toLocaleString("en-IN")} of {fullProgress.total.toLocaleString("en-IN")}
              <span className="text-primary/60">·</span>
              <span>{Math.round((fullProgress.scanned / Math.max(1, fullProgress.total)) * 100)}%</span>
            </div>
          )}
          <div className="inline-flex items-center gap-1.5">
            <a
              href="/api/scan/full-nse/export?format=csv"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-card hover:border-primary/60 hover:text-primary font-mono text-[11px] uppercase tracking-wider transition-colors"
              download
            >
              <Download className="h-3 w-3" /> CSV
            </a>
            <a
              href="/api/scan/full-nse/export?format=json"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-card hover:border-primary/60 hover:text-primary font-mono text-[11px] uppercase tracking-wider transition-colors"
              download
            >
              <Download className="h-3 w-3" /> JSON
            </a>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader className="border-b border-border pb-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base font-mono">
                {(() => {
                  if (stocksLoading) {
                    return `Loading first scan${universeEstimate > 0 ? ` of ~${universeEstimate.toLocaleString("en-IN")} stocks` : ""}…`;
                  }
                  const fmt = (n: number) => n.toLocaleString("en-IN");
                  const shown = sortedStocks.length;
                  const scanned = mergedStocks.length;
                  const universe = Math.max(universeEstimate, scanned);
                  const filtered = shown < scanned;
                  const stillScanning = scanned < universe;
                  if (filtered && stillScanning) return `Showing ${fmt(shown)} of ${fmt(scanned)} scanned · ${fmt(universe)} in universe`;
                  if (filtered) return `Showing ${fmt(shown)} of ${fmt(scanned)} stocks`;
                  if (stillScanning) return `${fmt(scanned)} of ${fmt(universe)} stocks scanned`;
                  return `All ${fmt(scanned)} stocks scanned`;
                })()}
              </CardTitle>
              <div className="flex flex-wrap gap-1.5 mt-3">
                {SCREENS.map(p => (
                  <button
                    key={p.id}
                    onClick={() => setScreen(p.id)}
                    className={`text-[11px] font-mono px-2.5 py-1 rounded border transition-colors ${screen === p.id ? "bg-primary/15 border-primary/60 text-primary" : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Input
                placeholder="Filter symbol/name..."
                className="w-[180px] font-mono text-sm h-9 bg-background"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
              />
              <Select value={sectorFilter} onValueChange={setSectorFilter}>
                <SelectTrigger className="w-[170px] h-9 bg-background"><SelectValue placeholder="Sector" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sectors</SelectItem>
                  {sectors.map(sec => (
                    <SelectItem key={sec} value={sec}>{sec}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={signalFilter} onValueChange={setSignalFilter}>
                <SelectTrigger className="w-[150px] h-9 bg-background"><SelectValue placeholder="Signal" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Signals</SelectItem>
                  <SelectItem value="STRONG_BUY">Strong Bullish</SelectItem>
                  <SelectItem value="BUY">Bullish</SelectItem>
                  <SelectItem value="NEUTRAL">Neutral</SelectItem>
                  <SelectItem value="SELL">Bearish</SelectItem>
                  <SelectItem value="STRONG_SELL">Strong Bearish</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {/* Virtualized table — windowed rendering keeps the page snappy
              even at 2,500 rows. Header is a plain flex row outside the
              virtualizer. */}
          <div ref={scrollRef} className="overflow-auto max-h-[calc(100vh-260px)] relative" role="grid" aria-label="NSE stocks scanner">
            <div className="w-full" style={{ minWidth: TOTAL_WIDTH }}>
              {/* Header row — uses the same CSS-grid template as every data
                  row, so columns stay aligned at every viewport width and
                  the table auto-fits the screen with no dead band on the
                  right. Below TOTAL_WIDTH the parent scrolls horizontally. */}
              <div role="row" className="sticky top-0 z-30 grid items-center bg-card border-b border-border h-10" style={{ minWidth: TOTAL_WIDTH, gridTemplateColumns: GRID_TEMPLATE }}>
                <div className="sticky left-0 bg-card z-10 px-3"><SortHead k="symbol" label="SYMBOL" sort={sort} setSort={setSort} align="left" /></div>
                <div className="text-right px-2"><SortHead k="price" label="CMP" sort={sort} setSort={setSort} /></div>
                <div className="text-right px-2"><SortHead k="change" label="CHG" sort={sort} setSort={setSort} /></div>
                <div className="text-right px-2"><SortHead k="changePct" label="%CHG" sort={sort} setSort={setSort} /></div>
                <div className="text-right px-2"><SortHead k="open" label="OPEN" sort={sort} setSort={setSort} /></div>
                <div className="text-right px-2"><SortHead k="high" label="HIGH" sort={sort} setSort={setSort} /></div>
                <div className="text-right px-2"><SortHead k="low" label="LOW" sort={sort} setSort={setSort} /></div>
                <div className="text-right px-2"><SortHead k="prev" label="PREV" sort={sort} setSort={setSort} /></div>
                <div className="text-right px-2"><SortHead k="vwap" label="VWAP" sort={sort} setSort={setSort} /></div>
                <div className="text-right px-2"><SortHead k="ema20" label="EMA20" sort={sort} setSort={setSort} /></div>
                <div className="text-right px-2"><SortHead k="ema50" label="EMA50" sort={sort} setSort={setSort} /></div>
                <div className="text-right px-2"><SortHead k="ema100" label="EMA100" sort={sort} setSort={setSort} /></div>
                <div className="text-right px-2"><SortHead k="ema200" label="EMA200" sort={sort} setSort={setSort} /></div>
                <div className="text-right px-2"><SortHead k="rsi" label="RSI" sort={sort} setSort={setSort} /></div>
                <div className="text-right px-2" title="52-week high; bottom value = current price's distance from that high"><SortHead k="fromYrHi" label="52W H" sort={sort} setSort={setSort} /></div>
                <div className="text-right px-2" title="52-week low; bottom value = current price's distance above that low"><SortHead k="fromYrLo" label="52W L" sort={sort} setSort={setSort} /></div>
                <div className="text-right px-2"><SortHead k="vol" label="VOL×" sort={sort} setSort={setSort} /></div>
                <div className="text-right px-2" title="Delivery % — share of today's traded volume that took actual delivery (NSE bhavcopy). Above 60% = strong conviction; below 25% = mostly intraday churn."><SortHead k="delivery" label="DEL%" sort={sort} setSort={setSort} /></div>
                <div className="px-2"><SortHead k="futOi" label="FUT OI" sort={sort} setSort={setSort} align="left" /></div>
                <div className="px-2"><SortHead k="score" label="SCORE" sort={sort} setSort={setSort} align="left" /></div>
                <div className="text-right px-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">SIGNAL</div>
              </div>

              {stocksLoading ? (
                <div className="p-4 space-y-2">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <Skeleton key={i} className="h-8 w-full" />
                  ))}
                </div>
              ) : sortedStocks.length === 0 ? (
                <div className="h-24 flex items-center justify-center text-muted-foreground font-mono text-sm">
                  NO MATCHING STOCKS FOUND
                </div>
              ) : (
                <div className="relative" style={{ height: rowVirtualizer.getTotalSize(), minWidth: TOTAL_WIDTH }}>
                  {rowVirtualizer.getVirtualItems().map(v => {
                    const stock = sortedStocks[v.index];
                    return <Row key={stock.symbol} stock={stock} top={v.start} />;
                  })}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
