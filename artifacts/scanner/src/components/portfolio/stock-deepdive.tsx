import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  useGetStockDetail,
  useGetNews,
  getGetStockDetailQueryKey,
  getGetNewsQueryKey,
  getChartCandles,
} from "@workspace/api-client-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ExternalLink } from "lucide-react";
import type { EnrichedRow } from "@/lib/portfolio/types";
import { sma } from "@/lib/portfolio/indicators";
import {
  lookupEtfReference,
  etfCategory,
  describeEtfTrend,
  ETF_REFERENCE_AS_OF,
} from "@/lib/portfolio/etf";
import { fmtINR, fmtPct, fmtSignedINR, fmtNum, pnlClass, actionViewClass } from "./format";

const numOrNull = (v: number | null | undefined): number | null =>
  v != null && Number.isFinite(v) ? v : null;

function Stat({
  label,
  value,
  hint,
  unavailableLabel,
}: {
  label: string;
  value: string;
  hint?: string;
  unavailableLabel?: string;
}) {
  const unavailable = value === "—";
  return (
    <div className="rounded-md border border-border bg-muted/20 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      {unavailable ? (
        <div
          className="font-mono text-sm text-muted-foreground/70"
          title={hint ?? "Not reported by the data source for this symbol."}
        >
          {unavailableLabel ?? "n/a"}
        </div>
      ) : (
        <div className="font-mono text-sm">{value}</div>
      )}
    </div>
  );
}

export function StockDeepDive({
  row,
  open,
  onOpenChange,
}: {
  row: EnrichedRow | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const symbol = row?.resolution.resolvedSymbol ?? row?.raw.symbol ?? "";
  const fundamentalsApplicable = row?.resolution.fundamentalsApplicable ?? true;
  const detailQ = useGetStockDetail(symbol, {
    query: { enabled: open && !!symbol, queryKey: getGetStockDetailQueryKey(symbol) },
  });
  const newsQ = useGetNews(
    { symbol },
    { query: { enabled: open && !!symbol, queryKey: getGetNewsQueryKey({ symbol }) } },
  );

  const detail = detailQ.data;
  const profile = detail?.profile;
  const keyStats = profile?.keyStats;
  const indicators = detail?.indicators;
  const quote = detail?.quote;
  const news = newsQ.data ?? [];

  // DMA sourcing hierarchy: enriched/keyStats first, then a candle-derived
  // fallback computed from real daily closes (never fabricated). When neither
  // resolves we label why (insufficient history vs not reported).
  const dma50Detail = numOrNull(row?.live.dma50) ?? numOrNull(keyStats?.fiftyDayAverage);
  const dma200Detail = numOrNull(row?.live.dma200) ?? numOrNull(keyStats?.twoHundredDayAverage);
  const segment = (row?.resolution.segment ?? "equity") as "index" | "equity" | "global";
  const needDma = open && !!symbol && (dma50Detail == null || dma200Detail == null);
  const candlesQ = useQuery({
    queryKey: ["portfolio-dma-candles", symbol, segment],
    enabled: needDma,
    staleTime: 60_000,
    queryFn: () => getChartCandles({ symbol, segment, tf: "1D" }),
  });
  const closes = (candlesQ.data?.candles ?? [])
    .map(c => c.c)
    .filter((c): c is number => Number.isFinite(c));
  const dma50 = dma50Detail ?? sma(closes, 50);
  const dma200 = dma200Detail ?? sma(closes, 200);

  // ETF-relevant context (only used when fundamentals are not applicable).
  const isEtf = !fundamentalsApplicable;
  const etfRef = isEtf ? lookupEtfReference(symbol) : null;
  const etfCat = isEtf
    ? etfCategory(symbol, row?.resolution.instrumentType ?? "ETF")
    : null;
  const etfTrend = isEtf ? describeEtfTrend(numOrNull(row?.live.cmp), dma50, dma200) : null;

  function dmaProps(
    val: number | null,
    fromDetail: number | null,
    period: number,
  ): { value: string; hint?: string; unavailableLabel?: string } {
    if (val != null) {
      return {
        value: fmtINR(val, 2),
        hint:
          fromDetail != null
            ? undefined
            : `Computed from ${closes.length} real daily closes — not reported by the data source.`,
      };
    }
    if (needDma && candlesQ.isLoading) {
      return { value: "—", unavailableLabel: "Loading…", hint: "Fetching candle history…" };
    }
    if (closes.length > 0 && closes.length < period) {
      return {
        value: "—",
        unavailableLabel: "Insufficient history",
        hint: `Only ${closes.length} daily bars available; ${period} needed for this average.`,
      };
    }
    return {
      value: "—",
      unavailableLabel: "n/a",
      hint: "Not reported by the data source and no candle history available.",
    };
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-xl"
        data-testid="deepdive"
      >
        {row && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2 font-mono">
                {row.raw.symbol}
                {row.analytics.label && (
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] ${actionViewClass(
                      row.analytics.label,
                    )}`}
                  >
                    {row.analytics.label}
                  </span>
                )}
              </SheetTitle>
              <SheetDescription>
                {profile?.name ?? row.raw.name} · {profile?.sector ?? row.live.sector ?? "—"}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-4 space-y-5 px-4 pb-8">
              {/* Position */}
              <section>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Your Position
                </h4>
                <div className="grid grid-cols-3 gap-2">
                  <Stat label="Qty" value={fmtNum(row.raw.qty, 0)} />
                  <Stat label="Avg Cost" value={fmtINR(row.raw.rate, 2)} />
                  <Stat label="CMP" value={fmtINR(row.live.cmp, 2)} />
                  <Stat label="Invested" value={fmtINR(row.metrics.invested)} />
                  <Stat label="Current" value={fmtINR(row.metrics.currentValue)} />
                  <Stat label="Weight" value={fmtPct(row.metrics.weightPct, 1)} />
                </div>
                <div className="mt-2 flex items-center gap-3 text-sm">
                  <span className={pnlClass(row.metrics.totalReturn)}>
                    {fmtSignedINR(row.metrics.totalReturn)} ({fmtPct(row.metrics.totalReturnPct)})
                  </span>
                  {row.raw.purchaseDate && (
                    <span className="text-xs text-muted-foreground">
                      since {row.raw.purchaseDate}
                    </span>
                  )}
                </div>
              </section>

              {/* Structure analytics (neutral) */}
              <section>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Structure Analytics
                </h4>
                {row.analytics.score == null ? (
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
                    {row.resolution.reason
                      ? `${row.resolution.reason} — composite structure score not computed.`
                      : "Live data unavailable — composite structure score not computed."}
                  </div>
                ) : (
                  <>
                    <div className="mb-2 flex items-center gap-2">
                      <div className="font-mono text-2xl font-semibold">{row.analytics.score}</div>
                      <div
                        className="cursor-help text-xs text-muted-foreground"
                        title="0–100 transparent blend of available objective signals (price-vs-DMA structure, RSI, realised-return quality, concentration). Bands: 0–39 weak · 40–59 mixed · 60–79 constructive · 80–100 strong. Fundamentals are NOT scored. Analytics, not advice."
                      >
                        / 100 structure score ⓘ
                      </div>
                    </div>
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {row.analytics.reasons.map((r, i) => (
                        <li key={i}>• {r}</li>
                      ))}
                    </ul>
                  </>
                )}
                {row.analytics.riskFlags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {row.analytics.riskFlags.map(f => (
                      <span
                        key={f.code}
                        className={`rounded-full border px-2 py-0.5 text-[10px] ${
                          f.severity === "high"
                            ? "border-red-500/30 bg-red-500/15 text-red-400"
                            : f.severity === "warn"
                              ? "border-amber-500/30 bg-amber-500/15 text-amber-400"
                              : "border-border bg-muted text-muted-foreground"
                        }`}
                      >
                        {f.message}
                      </span>
                    ))}
                  </div>
                )}
                {row.analytics.unavailable.length > 0 && (
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    Not included in score: {row.analytics.unavailable.join(", ")}.
                  </p>
                )}
              </section>

              {/* Technical zones (NOT targets/stops) */}
              <section>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Technical Zones
                </h4>
                {detailQ.isLoading ? (
                  <div className="text-xs text-muted-foreground">Loading…</div>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    <Stat label="RSI (14)" value={fmtNum(indicators?.rsi14, 0)} />
                    <Stat label="50-DMA" {...dmaProps(dma50, dma50Detail, 50)} />
                    <Stat label="200-DMA" {...dmaProps(dma200, dma200Detail, 200)} />
                    <Stat label="Support zone" value={fmtINR(indicators?.supportLevel, 2)} />
                    <Stat label="Resistance zone" value={fmtINR(indicators?.resistanceLevel, 2)} />
                    <Stat label="Trend strength" value={fmtNum(indicators?.trendStrength, 0)} />
                  </div>
                )}
                <p className="mt-1.5 text-[10px] text-muted-foreground">
                  Zones are objective technical levels for context — not buy/sell targets or
                  stop-losses.
                </p>
              </section>

              {/* ETF profile (shown instead of equity fundamentals for baskets) */}
              {isEtf && (
                <section>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    ETF Profile
                  </h4>
                  <div className="grid grid-cols-3 gap-2">
                    <Stat label="Category" value={etfCat ?? "—"} />
                    <Stat
                      label="Tracks"
                      value={etfRef?.trackedIndex ?? "—"}
                      unavailableLabel="not identified"
                      hint="The index/benchmark this ETF is mandated to track. Not in the curated reference table."
                    />
                    <Stat
                      label="Asset class"
                      value={etfRef?.assetClass ?? "—"}
                      unavailableLabel="not identified"
                      hint="Resolved from the curated ETF reference table."
                    />
                    <Stat
                      label="Trend (CMP vs DMA)"
                      value={etfTrend?.text ?? "—"}
                      unavailableLabel="Insufficient history"
                      hint="Derived from this ETF's own real daily closes. Descriptive structure context — not a target or stop."
                    />
                  </div>
                  {etfRef && (
                    <p className="mt-1.5 text-[10px] text-muted-foreground">
                      Reference verified {ETF_REFERENCE_AS_OF}. NAV and expense ratio are not
                      tracked by this app.
                    </p>
                  )}
                  <div className="mt-2 rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-400">
                    Equity fundamentals not applicable for{" "}
                    {row.resolution.instrumentType.toLowerCase()} — ratios like P/E, RoE and D/E
                    describe individual companies, not baskets.
                  </div>
                </section>
              )}

              {/* Fundamentals (display only) — equities only */}
              {!isEtf && (
              <section>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Fundamentals <span className="font-normal normal-case">(display only)</span>
                </h4>
                {detailQ.isLoading ? (
                  <div className="text-xs text-muted-foreground">Loading…</div>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    <Stat label="P/E" value={fmtNum(keyStats?.peRatio, 1)} />
                    <Stat label="P/B" value={fmtNum(keyStats?.pbRatio, 1)} />
                    <Stat label="RoE %" value={fmtNum(keyStats?.roe, 1)} />
                    <Stat label="RoCE %" value={fmtNum(keyStats?.roce, 1)} />
                    <Stat label="D/E" value={fmtNum(keyStats?.debtToEquity, 2)} />
                    <Stat label="Beta" value={fmtNum(keyStats?.beta, 2)} />
                  </div>
                )}
                {quote && (
                  <div className="mt-2 text-[10px] text-muted-foreground">
                    52W range: {fmtINR(quote.fiftyTwoWeekLow, 2)} – {fmtINR(quote.fiftyTwoWeekHigh, 2)}
                  </div>
                )}
              </section>
              )}

              {/* News */}
              <section>
                <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Recent News
                  <span className="rounded bg-muted px-1 text-[9px] font-normal normal-case text-muted-foreground">
                    {row.raw.symbol} only
                  </span>
                </h4>
                {newsQ.isLoading ? (
                  <div className="text-xs text-muted-foreground">Loading…</div>
                ) : news.length === 0 ? (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <AlertTriangle className="h-3 w-3" /> No recent news found for this symbol.
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {news.slice(0, 6).map(n => (
                      <li key={n.id} className="text-xs">
                        <a
                          href={n.url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium hover:text-primary"
                        >
                          {n.title}
                        </a>
                        <div className="text-[10px] text-muted-foreground">
                          {n.source} · {new Date(n.publishedAt).toLocaleDateString()}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <Link
                href={`/stock/${row.raw.symbol}`}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                Open full stock analysis <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
