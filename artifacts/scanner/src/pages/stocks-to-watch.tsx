import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, TrendingUp, TrendingDown, RefreshCw, Calendar, Newspaper, BarChart3, ArrowUpDown } from "lucide-react";
import { DataSourceBadge } from "@/components/ui/data-source-badge";
import { format, formatDistanceToNow, parseISO } from "date-fns";

interface WatchSignal {
  symbol: string;
  name?: string;
  sector?: string;
  side: "watch" | "avoid";
  catalyst: string;
  confidence: number;
  headline: string;
  summary?: string;
  source: string;
  url: string;
  publishedAt: string;
  evidence: { headline: string; source: string; url: string; publishedAt: string }[];
}

interface Payload {
  asOf: string;
  lookbackHours: number;
  watch: WatchSignal[];
  avoid: WatchSignal[];
  scanned: number;
  matched: number;
  sources: { source: string; count: number }[];
}

interface SwingRow {
  symbol: string;
  scanDate: string;
  action: string;
  setup: string;
  qualityGrade: string;
  potential: string;
  score: string;
  technicalScore: string; smcScore: string; volumeScore: string;
  momentumScore: string; fundamentalScore: string; riskScore: string;
  contextScore: string; rsScore: string | null;
  closePrice: string; entry: string; stopLoss: string;
  target1: string; target2: string;
  rrToT1: string | null;
  buyZoneLower: string; buyZoneUpper: string; buyZoneBasis: string;
  triggerText: string; triggerPrice: string;
  stopBasis: string; targetBasis: string;
  rsi14: string | null; adx14: string | null; atr14: string | null;
  atrPct: string | null; volRatio: string | null; avgValueLakhs: string | null;
  pctFrom52wLow: string | null; pctFrom52wHigh: string | null;
  weeklyTrend: string; candleSignal: string; marketStructure: string;
  rs20: string | null; rs50: string | null; rs120: string | null;
  sector: string | null; industry: string | null; fundamentalStatus: string | null;
  reasons: string[]; warnings: string[];
  intradayLast: string | null; intradayChangePct: string | null;
  triggerHit: boolean | null; intradayUpdatedAt: string | null;
}

interface AnalysisPayload {
  asOf: string;
  scanDate: string | null;
  runMeta: { scannedCount: number; errorCount: number; durationMs: number; startedAt: string; finishedAt: string } | null;
  scheduler: { lastDeepScanDate: string | null; lastDeepScanError: string | null; deepScanInflight: boolean };
  rows: SwingRow[];
}

async function fetchPayload(): Promise<Payload> {
  const r = await fetch("/api/stocks-to-watch", { credentials: "include" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function fetchAnalysis(): Promise<AnalysisPayload> {
  const r = await fetch("/api/stocks-to-watch/analysis?limit=500", { credentials: "include" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function ConfidenceDots({ confidence }: { confidence: number }) {
  const dots = Math.max(1, Math.min(3, Math.round(confidence * 3)));
  return (
    <span className="inline-flex gap-0.5 ml-1.5 align-middle">
      {[0, 1, 2].map(i => (
        <span key={i} className={`h-1.5 w-1.5 rounded-full ${i < dots ? "bg-current" : "bg-current/20"}`} />
      ))}
    </span>
  );
}

/* ---------- Tech-scan helpers ---------- */
const num = (s: string | null | undefined): number => (s == null ? NaN : Number(s));
const fmtN = (s: string | null | undefined, dp = 2): string => {
  const n = num(s);
  return Number.isFinite(n) ? n.toFixed(dp) : "—";
};

function actionEmoji(action: string): string {
  if (action.includes("BUY ZONE")) return "🟢";
  if (action.includes("BREAKOUT")) return "🔵";
  if (action.includes("PULLBACK") || action.includes("RECLAIM")) return "🟡";
  if (action.includes("CONFIRMATION")) return "⏳";
  if (action.includes("WATCH")) return "👀";
  if (action.includes("AVOID")) return "🔴";
  return "⚪";
}
function actionTone(action: string): string {
  if (action.includes("BUY ZONE")) return "text-emerald-500 bg-emerald-500/10 border-emerald-500/30";
  if (action.includes("BREAKOUT")) return "text-sky-500 bg-sky-500/10 border-sky-500/30";
  if (action.includes("PULLBACK") || action.includes("RECLAIM")) return "text-amber-500 bg-amber-500/10 border-amber-500/30";
  if (action.includes("CONFIRMATION")) return "text-violet-400 bg-violet-500/10 border-violet-500/30";
  if (action.includes("WATCH")) return "text-slate-400 bg-slate-500/10 border-slate-500/30";
  if (action.includes("AVOID")) return "text-rose-500 bg-rose-500/10 border-rose-500/30";
  return "text-muted-foreground bg-muted/30 border-border";
}
function gradeTone(g: string): string {
  if (g === "A") return "text-emerald-500 border-emerald-500/40 bg-emerald-500/10";
  if (g === "B+") return "text-sky-500 border-sky-500/40 bg-sky-500/10";
  if (g === "B") return "text-amber-500 border-amber-500/40 bg-amber-500/10";
  if (g.startsWith("C")) return "text-slate-400 border-slate-500/40 bg-slate-500/10";
  return "text-rose-500 border-rose-500/40 bg-rose-500/10";
}

const ACTION_FILTERS: Array<{ key: string; label: string; matches: (a: string) => boolean }> = [
  { key: "ALL", label: "All", matches: () => true },
  { key: "BUY_ZONE", label: "Buy Zone", matches: a => a.includes("BUY ZONE") },
  { key: "BREAKOUT", label: "Breakout", matches: a => a.includes("BREAKOUT") },
  { key: "PULLBACK", label: "Pullback / Reclaim", matches: a => a.includes("PULLBACK") || a.includes("RECLAIM") },
  { key: "CONFIRM", label: "Wait for Confirmation", matches: a => a.includes("CONFIRMATION") },
  { key: "WATCH", label: "Watchlist", matches: a => a.includes("WATCH") },
  { key: "AVOID", label: "Avoid", matches: a => a.includes("AVOID") },
];
const GRADE_FILTERS = ["ALL", "A", "B+", "B", "C / Watch Only", "D / Avoid"];

type SortKey = "score" | "symbol" | "rrToT1" | "rsi14" | "atrPct";

function ScoreBar({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score));
  const tone = pct >= 75 ? "bg-emerald-500" : pct >= 60 ? "bg-sky-500" : pct >= 50 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="flex items-center gap-2 min-w-[110px]">
      <div className="flex-1 h-1.5 rounded-full bg-muted/40 overflow-hidden">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-xs tabular-nums w-9 text-right">{pct.toFixed(1)}</span>
    </div>
  );
}

function SortHeader({ label, k, sortKey, setSort, dir, alignRight }: { label: string; k: SortKey; sortKey: SortKey; setSort: (k: SortKey) => void; dir: "asc" | "desc"; alignRight?: boolean }) {
  const active = k === sortKey;
  return (
    <button
      onClick={() => setSort(k)}
      className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${active ? "text-foreground" : "text-muted-foreground"} ${alignRight ? "justify-end w-full" : ""}`}
    >
      {label}
      <ArrowUpDown className={`h-3 w-3 ${active ? "opacity-100" : "opacity-40"}`} />
      {active && <span className="text-[10px] opacity-70">{dir === "desc" ? "↓" : "↑"}</span>}
    </button>
  );
}

function TechScanSection({ data, isLoading, error, scoreBySymbol: _scoreBySymbol }: {
  data: AnalysisPayload | undefined;
  isLoading: boolean;
  error: Error | null;
  scoreBySymbol: Map<string, number>;
}) {
  const [actionFilter, setActionFilter] = useState<string>("ALL");
  const [gradeFilter, setGradeFilter] = useState<string>("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const setSort = (k: SortKey) => {
    if (k === sortKey) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortKey(k); setSortDir(k === "symbol" ? "asc" : "desc"); }
  };

  const rows = useMemo(() => {
    if (!data?.rows) return [] as SwingRow[];
    const af = ACTION_FILTERS.find(f => f.key === actionFilter) ?? ACTION_FILTERS[0]!;
    let rs = data.rows.filter(r => af.matches(r.action));
    if (gradeFilter !== "ALL") rs = rs.filter(r => r.qualityGrade === gradeFilter);
    rs = [...rs].sort((a, b) => {
      const av = sortKey === "symbol" ? a.symbol : num((a as unknown as Record<string, string | null>)[sortKey] ?? null);
      const bv = sortKey === "symbol" ? b.symbol : num((b as unknown as Record<string, string | null>)[sortKey] ?? null);
      if (typeof av === "string" || typeof bv === "string") {
        const cmp = String(av).localeCompare(String(bv));
        return sortDir === "asc" ? cmp : -cmp;
      }
      const aN = Number.isFinite(av) ? av : -Infinity;
      const bN = Number.isFinite(bv) ? bv : -Infinity;
      return sortDir === "desc" ? bN - aN : aN - bN;
    });
    return rs;
  }, [data, actionFilter, gradeFilter, sortKey, sortDir]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-md font-mono text-sm font-semibold uppercase tracking-wider text-primary bg-primary/10 border border-primary/30">
        <BarChart3 className="h-4 w-4" />
        Technical Analysis — NIFTY 500
        <span className="ml-auto text-xs opacity-80 font-mono">
          {data?.scanDate ? `Scan ${data.scanDate}` : "—"} · {rows.length} shown
        </span>
      </div>

      {data?.runMeta && (
        <div className="text-[11px] font-mono text-muted-foreground">
          Last full scan: {data.runMeta.scannedCount}/{data.runMeta.scannedCount + data.runMeta.errorCount} priced ·
          {" "}{Math.round(data.runMeta.durationMs / 1000)}s · finished {formatDistanceToNow(parseISO(data.runMeta.finishedAt), { addSuffix: true })}
          {data.scheduler.deepScanInflight && <span className="ml-2 text-amber-500">· deep scan in progress</span>}
        </div>
      )}

      {error && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 text-sm text-destructive">
            Couldn't load the technical scan — {error.message}.
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
        <span className="text-muted-foreground uppercase tracking-wider">Action:</span>
        {ACTION_FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setActionFilter(f.key)}
            className={`px-2.5 py-1 rounded-md border transition-colors ${actionFilter === f.key ? "border-primary bg-primary/15 text-primary" : "border-border hover:bg-accent"}`}
          >{f.label}</button>
        ))}
        <span className="text-muted-foreground uppercase tracking-wider ml-3">Quality:</span>
        {GRADE_FILTERS.map(g => (
          <button
            key={g}
            onClick={() => setGradeFilter(g)}
            className={`px-2.5 py-1 rounded-md border transition-colors ${gradeFilter === g ? "border-primary bg-primary/15 text-primary" : "border-border hover:bg-accent"}`}
          >{g === "ALL" ? "All" : g}</button>
        ))}
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead className="bg-muted/30 border-b border-border">
              <tr className="text-muted-foreground uppercase tracking-wider">
                <th className="px-3 py-2 text-left"><SortHeader label="Symbol" k="symbol" sortKey={sortKey} setSort={setSort} dir={sortDir} /></th>
                <th className="px-3 py-2 text-left">Action</th>
                <th className="px-3 py-2 text-left">Setup</th>
                <th className="px-3 py-2 text-left">Quality</th>
                <th className="px-3 py-2 text-left"><SortHeader label="Score" k="score" sortKey={sortKey} setSort={setSort} dir={sortDir} /></th>
                <th className="px-3 py-2 text-right">Close</th>
                <th className="px-3 py-2 text-right">Entry</th>
                <th className="px-3 py-2 text-right">Stop</th>
                <th className="px-3 py-2 text-right">T1</th>
                <th className="px-3 py-2 text-right">T2</th>
                <th className="px-3 py-2 text-right"><SortHeader label="R:R" k="rrToT1" sortKey={sortKey} setSort={setSort} dir={sortDir} alignRight /></th>
                <th className="px-3 py-2 text-right"><SortHeader label="RSI" k="rsi14" sortKey={sortKey} setSort={setSort} dir={sortDir} alignRight /></th>
                <th className="px-3 py-2 text-right"><SortHeader label="ATR%" k="atrPct" sortKey={sortKey} setSort={setSort} dir={sortDir} alignRight /></th>
                <th className="px-3 py-2 text-left">Buy Zone</th>
                <th className="px-3 py-2 text-left">Weekly</th>
                <th className="px-3 py-2 text-right">Live</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && new Array(8).fill(0).map((_, i) => (
                <tr key={i} className="border-b border-border/40">
                  <td colSpan={16} className="px-3 py-2"><Skeleton className="h-5 w-full" /></td>
                </tr>
              ))}
              {!isLoading && rows.length === 0 && (
                <tr><td colSpan={16} className="px-3 py-6 text-center text-muted-foreground">
                  {data?.scanDate ? "No rows match these filters." : "No scan available yet — the first deep scan runs after 15:35 IST or on next boot."}
                </td></tr>
              )}
              {rows.map(r => {
                const live = num(r.intradayLast);
                const pct = num(r.intradayChangePct);
                return (
                  <tr key={r.symbol} className="border-b border-border/30 hover:bg-accent/30 transition-colors">
                    <td className="px-3 py-1.5">
                      <Link href={`/stock/${r.symbol}`} className="font-semibold text-primary hover:underline">{r.symbol}</Link>
                    </td>
                    <td className="px-3 py-1.5">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] uppercase tracking-wider ${actionTone(r.action)}`}>
                        <span>{actionEmoji(r.action)}</span>{r.action}
                      </span>
                      {r.triggerHit && <span className="ml-1.5 text-[10px] text-emerald-500">★ trigger hit</span>}
                    </td>
                    <td className="px-3 py-1.5 text-foreground/80 max-w-[180px] truncate" title={r.setup}>{r.setup}</td>
                    <td className="px-3 py-1.5">
                      <span className={`inline-flex px-1.5 py-0.5 rounded border text-[10px] ${gradeTone(r.qualityGrade)}`}>{r.qualityGrade}</span>
                    </td>
                    <td className="px-3 py-1.5"><ScoreBar score={num(r.score)} /></td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtN(r.closePrice)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtN(r.entry)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-rose-500/80">{fmtN(r.stopLoss)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-emerald-500/80">{fmtN(r.target1)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-emerald-500/60">{fmtN(r.target2)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtN(r.rrToT1)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtN(r.rsi14, 1)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtN(r.atrPct, 2)}</td>
                    <td className="px-3 py-1.5 text-foreground/70 tabular-nums">
                      {fmtN(r.buyZoneLower)} – {fmtN(r.buyZoneUpper)}
                      <span className="block text-[10px] text-muted-foreground truncate max-w-[160px]" title={r.buyZoneBasis}>{r.buyZoneBasis}</span>
                    </td>
                    <td className="px-3 py-1.5 text-foreground/70">{r.weeklyTrend}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {Number.isFinite(live) ? (
                        <>
                          {live.toFixed(2)}
                          <span className={`block text-[10px] ${pct >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                            {Number.isFinite(pct) ? (pct >= 0 ? "+" : "") + pct.toFixed(2) + "%" : ""}
                          </span>
                        </>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

/* ---------- Existing news cards (preserved) ---------- */

function SignalCard({ s, techScore }: { s: WatchSignal; techScore?: number }) {
  const isWatch = s.side === "watch";
  const accent = isWatch
    ? "border-l-4 border-l-signal-strong-buy"
    : "border-l-4 border-l-signal-strong-sell";
  const tickerColor = isWatch ? "text-signal-strong-buy" : "text-signal-strong-sell";

  return (
    <Card className={`${accent} bg-card hover:bg-accent/40 transition-colors shadow-sm`}>
      <CardContent className="p-4 space-y-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <Link href={`/stock/${s.symbol}`} className={`font-mono font-semibold text-base tracking-tight ${tickerColor} hover:underline`}>
              {s.symbol}
            </Link>
            {s.name && (
              <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                {s.name}{s.sector ? ` · ${s.sector}` : ""}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {techScore !== undefined && (
              <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wider text-primary border-primary/40 bg-primary/5" title="Technical Analysis score (NIFTY 500)">
                Tech {techScore.toFixed(0)}
              </Badge>
            )}
            <Badge variant="outline" className={`font-mono text-[10px] uppercase tracking-wider ${tickerColor} border-current/40 bg-current/5`}>
              {s.catalyst}
              <ConfidenceDots confidence={s.confidence} />
            </Badge>
          </div>
        </div>

        <div className="text-[14px] leading-relaxed text-foreground/90">{s.headline}</div>

        <div className="flex items-center justify-between gap-2 pt-1.5 text-[11px] text-muted-foreground font-mono border-t border-border/40">
          <span className="truncate">{s.source} · {formatDistanceToNow(parseISO(s.publishedAt), { addSuffix: true })}</span>
          <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-foreground shrink-0 uppercase tracking-wider">
            Read <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        {s.evidence.length > 1 && (
          <details className="text-[11px] text-muted-foreground pt-1">
            <summary className="cursor-pointer hover:text-foreground font-mono uppercase tracking-wider">
              +{s.evidence.length - 1} more headline{s.evidence.length - 1 > 1 ? "s" : ""}
            </summary>
            <ul className="mt-2 space-y-1.5 pl-3 border-l border-border/60">
              {s.evidence.slice(1).map((e, i) => (
                <li key={i}>
                  <a href={e.url} target="_blank" rel="noopener noreferrer" className="hover:text-foreground">
                    <span className="text-foreground/80">{e.headline}</span>
                    <span className="ml-1 opacity-60">· {e.source}</span>
                  </a>
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

function ColumnHeader({ side, count }: { side: "watch" | "avoid"; count: number }) {
  const isWatch = side === "watch";
  return (
    <div className={`flex items-center gap-2 px-4 py-2.5 rounded-md font-mono text-sm font-semibold uppercase tracking-wider ${
      isWatch
        ? "text-signal-strong-buy bg-signal-strong-buy/10 border border-signal-strong-buy/30"
        : "text-signal-strong-sell bg-signal-strong-sell/10 border border-signal-strong-sell/30"
    }`}>
      {isWatch ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
      {isWatch ? "Green — Stocks to Watch" : "Red — Negative Catalyst Watchlist"}
      <span className="ml-auto text-xs opacity-80 font-mono">{count}</span>
    </div>
  );
}

export default function StocksToWatchPage() {
  const { data, isLoading, isFetching, error, refetch } = useQuery<Payload>({
    queryKey: ["stocks-to-watch"],
    queryFn: fetchPayload,
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60 * 1000,
  });
  const analysis = useQuery<AnalysisPayload>({
    queryKey: ["stocks-to-watch-analysis"],
    queryFn: fetchAnalysis,
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60 * 1000,
  });

  const today = new Date();
  const dateLabel = format(today, "EEEE · d MMM yyyy").toUpperCase();

  // Cross-reference: tech score by symbol for the news cards' tiny badge.
  const scoreBySymbol = useMemo(() => {
    const m = new Map<string, number>();
    analysis.data?.rows.forEach(r => m.set(r.symbol, num(r.score)));
    return m;
  }, [analysis.data]);

  return (
    <div className="w-full px-4 lg:px-6 py-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap pb-4 border-b border-border">
        <div className="space-y-1.5 min-w-0">
          <h1 className="text-2xl lg:text-3xl font-bold font-mono tracking-tight flex items-center gap-2.5">
            <Calendar className="h-6 w-6 text-primary" />
            Stocks To Watch
          </h1>
          <p className="text-sm text-muted-foreground max-w-3xl leading-relaxed">
            Daily catalyst deck — NSE stocks with positive (orders, projects, beats, approvals) or negative (probes, downgrades, misses, recalls) news from the last {data?.lookbackHours ?? 24}h.
            {data && (
              <>{" "}Scanned <span className="font-mono text-foreground">{data.scanned}</span> headlines, matched <span className="font-mono text-foreground">{data.matched}</span> · last refresh {formatDistanceToNow(parseISO(data.asOf), { addSuffix: true })}.</>
            )}
          </p>
          <p className="text-[11px] text-muted-foreground font-mono uppercase tracking-wider">{dateLabel}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <DataSourceBadge source="mixed" status="delayed" lastUpdated={data?.asOf} refreshMs={5 * 60 * 1000} note="news feeds · 30m cache" />
          <button
            onClick={() => { refetch(); analysis.refetch(); }}
            disabled={isFetching}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-md border border-border bg-card hover:bg-accent font-mono text-xs uppercase tracking-wider disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 text-sm text-destructive">
            Couldn't load the catalyst deck — {(error as Error).message}. The news feeds may be temporarily unavailable; click Refresh to retry.
          </CardContent>
        </Card>
      )}

      {/* Two-column news grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-3">
          <ColumnHeader side="watch" count={data?.watch.length ?? 0} />
          {isLoading && (<div className="space-y-3">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-32 w-full" />)}</div>)}
          {!isLoading && data?.watch.length === 0 && (
            <Card><CardContent className="p-6 text-sm text-muted-foreground text-center">
              No clear positive catalysts in the last {data.lookbackHours}h. Check back later — feeds refresh every 5 minutes.
            </CardContent></Card>
          )}
          {data?.watch.map(s => <SignalCard key={`w-${s.symbol}`} s={s} techScore={scoreBySymbol.get(s.symbol)} />)}
        </div>

        <div className="space-y-3">
          <ColumnHeader side="avoid" count={data?.avoid.length ?? 0} />
          {isLoading && (<div className="space-y-3">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-32 w-full" />)}</div>)}
          {!isLoading && data?.avoid.length === 0 && (
            <Card><CardContent className="p-6 text-sm text-muted-foreground text-center">
              No clear negative catalysts in the last {data.lookbackHours}h.
            </CardContent></Card>
          )}
          {data?.avoid.map(s => <SignalCard key={`a-${s.symbol}`} s={s} techScore={scoreBySymbol.get(s.symbol)} />)}
        </div>
      </div>

      {/* Sources strip */}
      {data && data.sources.length > 0 && (
        <Card className="bg-card/60">
          <CardContent className="p-3.5 flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground font-mono">
            <Newspaper className="h-3.5 w-3.5" />
            <span className="uppercase tracking-wider">Sources:</span>
            {data.sources.map(s => (<Badge key={s.source} variant="outline" className="text-[10px]">{s.source} <span className="opacity-60 ml-1">{s.count}</span></Badge>))}
          </CardContent>
        </Card>
      )}

      {/* NEW: Technical Analysis section (NIFTY 500) */}
      <TechScanSection
        data={analysis.data}
        isLoading={analysis.isLoading}
        error={(analysis.error as Error | null) ?? null}
        scoreBySymbol={scoreBySymbol}
      />
    </div>
  );
}
