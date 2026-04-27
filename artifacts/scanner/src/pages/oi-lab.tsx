import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid, Legend, ReferenceLine,
  BarChart, Bar, Cell, PieChart, Pie, ComposedChart,
} from "recharts";
import { Download, Play, Square, RefreshCw, AlertTriangle, TrendingUp, TrendingDown, Activity, Layers, Sparkles, Search, Target } from "lucide-react";

const base = (import.meta as { env: { BASE_URL: string } }).env.BASE_URL;

type Bucket = "LONG_BUILDUP" | "SHORT_BUILDUP" | "SHORT_COVERING" | "LONG_UNWINDING" | "NEUTRAL";

interface SnapshotItem {
  underlying: string;
  ok: boolean;
  error?: string;
  spot?: number;
  changePercent?: number;
  expiry?: string;
  atmStrike?: number;
  pcrOi?: number;
  pcrVolume?: number;
  maxPain?: number;
  atmIv?: number | null;
  bias?: "BULLISH" | "BEARISH" | "NEUTRAL";
  totalCallOi?: number;
  totalPutOi?: number;
  callOiAdded?: number;
  putOiAdded?: number;
  topResistance?: { strike: number; oi: number }[];
  topSupport?: { strike: number; oi: number }[];
  interpretation?: string;
  source?: string;
}
interface SnapshotResp {
  generatedAt: string;
  okCount: number;
  failCount: number;
  items: SnapshotItem[];
}

interface HeatmapRow {
  symbol: string;
  fut: string;
  expiry: string;
  ltp: number;
  prevClose: number;
  priceChgPct: number;
  oi: number;
  baselineOi: number;
  oiChgAbs: number;
  oiChgPct: number;
  bucket: Bucket;
  notional: number;
  lotSize: number;
  volume: number;
}
interface HeatmapResp {
  generatedAt: string;
  baselineEstablishedAt: string;
  rows: HeatmapRow[];
  buckets: Record<Bucket, number>;
  totalNotional: number;
}

interface TrackerSnap {
  ts: string;
  underlying: string;
  spot: number;
  changePercent: number;
  atmStrike: number;
  pcrOi: number;
  pcrVolume: number;
  maxPain: number;
  atmIv: number | null;
  totalCallOi: number;
  totalPutOi: number;
  callOiAdded: number;
  putOiAdded: number;
  bias: "BULLISH" | "BEARISH" | "NEUTRAL";
}
interface TrackerStatus {
  running: boolean;
  startedAt: string | null;
  lastTickAt: string | null;
  nextTickAt: string | null;
  intervalMs: number;
  underlyings: string[];
  snapshotCount: number;
  errors: { ts: string; underlying: string; error: string }[];
}

const BUCKET_META: Record<Bucket, { label: string; color: string; tone: string; desc: string }> = {
  LONG_BUILDUP:    { label: "Long Buildup",    color: "#16a34a", tone: "bg-green-500/15 text-green-300 border-green-500/30",   desc: "Price ↑  OI ↑  ·  Bullish — fresh longs" },
  SHORT_BUILDUP:   { label: "Short Buildup",   color: "#dc2626", tone: "bg-red-500/15 text-red-300 border-red-500/30",         desc: "Price ↓  OI ↑  ·  Bearish — fresh shorts" },
  SHORT_COVERING:  { label: "Short Covering",  color: "#0ea5e9", tone: "bg-sky-500/15 text-sky-300 border-sky-500/30",         desc: "Price ↑  OI ↓  ·  Bullish — shorts exiting" },
  LONG_UNWINDING:  { label: "Long Unwinding",  color: "#f59e0b", tone: "bg-amber-500/15 text-amber-300 border-amber-500/30",   desc: "Price ↓  OI ↓  ·  Bearish — longs exiting" },
  NEUTRAL:         { label: "Neutral",         color: "#6b7280", tone: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",      desc: "No meaningful directional change" },
};

function fmtNum(n: number | undefined | null, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1e7) return (n / 1e7).toFixed(2) + " Cr";
  if (Math.abs(n) >= 1e5) return (n / 1e5).toFixed(2) + " L";
  // Round whole-number magnitudes (OI, volume, contracts) before locale-format
  // so any IEEE-754 noise from upstream math doesn't bleed through as
  // "268.6000000000006".
  if (Math.abs(n) >= 1e3) return Math.round(n).toLocaleString("en-IN");
  return n.toFixed(digits);
}
function fmtPct(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export default function OiLab() {
  return (
    <div className="container mx-auto py-6 space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">OI Lab</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Bulk option-chain snapshots, futures OI buildup heatmap, and intraday OI delta tracking.
          All live from Kite — no caching beyond a few seconds.
        </p>
      </div>

      <Tabs defaultValue="insights" className="space-y-4">
        <TabsList>
          <TabsTrigger value="insights"><Sparkles className="w-4 h-4 mr-2" />OI Insights</TabsTrigger>
          <TabsTrigger value="snapshot"><Download className="w-4 h-4 mr-2" />Bulk Snapshot</TabsTrigger>
          <TabsTrigger value="heatmap"><Layers className="w-4 h-4 mr-2" />OI Heatmap</TabsTrigger>
          <TabsTrigger value="tracker"><Activity className="w-4 h-4 mr-2" />Delta Tracker</TabsTrigger>
        </TabsList>

        <TabsContent value="insights"><InsightsTab /></TabsContent>
        <TabsContent value="snapshot"><SnapshotTab /></TabsContent>
        <TabsContent value="heatmap"><HeatmapTab /></TabsContent>
        <TabsContent value="tracker"><TrackerTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Snapshot tab ────────────────────────────────────────────────────────────
function SnapshotTab() {
  const [universe, setUniverse] = useState<{ indices: string[]; stocks: string[] }>({ indices: [], stocks: [] });
  const [selected, setSelected] = useState<Set<string>>(new Set(["NIFTY", "BANKNIFTY", "FINNIFTY"]));
  const [stockSearch, setStockSearch] = useState("");
  const [snap, setSnap] = useState<SnapshotResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${base}api/options/oi-lab/universe`, { credentials: "include" })
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(setUniverse)
      .catch(() => {});
  }, []);

  const toggle = (sym: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(sym)) next.delete(sym); else next.add(sym);
      return next;
    });
  };

  const filteredStocks = useMemo(
    () => universe.stocks.filter(s => s.toLowerCase().includes(stockSearch.toLowerCase())).slice(0, 40),
    [universe.stocks, stockSearch],
  );

  const capture = async (format: "json" | "csv") => {
    if (selected.size === 0) { setError("Select at least one underlying"); return; }
    setError(null); setLoading(true);
    try {
      const r = await fetch(`${base}api/options/oi-lab/snapshot`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ underlyings: Array.from(selected), format }),
      });
      if (format === "csv") {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `oi-snapshot-${new Date().toISOString().slice(0, 19)}.csv`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
      } else {
        const j = await r.json();
        if (!r.ok) throw new Error(j.detail || j.error || r.statusText);
        setSnap(j);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const downloadJson = () => {
    if (!snap) return;
    const blob = new Blob([JSON.stringify(snap, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `oi-snapshot-${new Date().toISOString().slice(0, 19)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Pick underlyings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-xs uppercase text-muted-foreground">Indices</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {universe.indices.map(i => (
                <button key={i} onClick={() => toggle(i)}
                  className={`px-3 py-1 rounded text-xs border transition ${
                    selected.has(i)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-muted-foreground border-border hover:border-primary/50"
                  }`}>
                  {i}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between gap-3 mb-2">
              <Label className="text-xs uppercase text-muted-foreground">Stocks ({selected.size - Array.from(selected).filter(s => universe.indices.includes(s)).length} selected)</Label>
              <Input value={stockSearch} onChange={e => setStockSearch(e.target.value)}
                placeholder="Search stocks…" className="max-w-xs h-8" />
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-2 border rounded bg-background/50">
              {filteredStocks.map(s => (
                <button key={s} onClick={() => toggle(s)}
                  className={`px-2 py-0.5 rounded text-[11px] border transition ${
                    selected.has(s)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-muted-foreground border-border hover:border-primary/50"
                  }`}>
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 pt-2">
            <Button onClick={() => capture("json")} disabled={loading || selected.size === 0}>
              {loading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Activity className="w-4 h-4 mr-2" />}
              Capture {selected.size} {selected.size === 1 ? "chain" : "chains"}
            </Button>
            <Button variant="outline" onClick={() => capture("csv")} disabled={loading || selected.size === 0}>
              <Download className="w-4 h-4 mr-2" /> Download CSV
            </Button>
            {snap && (
              <Button variant="outline" onClick={downloadJson}>
                <Download className="w-4 h-4 mr-2" /> Download JSON
              </Button>
            )}
            <Button variant="ghost" onClick={() => setSelected(new Set(universe.indices))} className="ml-auto">
              All indices
            </Button>
            <Button variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded p-3">
              <AlertTriangle className="w-4 h-4" /> {error}
            </div>
          )}
        </CardContent>
      </Card>

      {snap && (
        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Snapshot results</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {snap.okCount} ok · {snap.failCount} failed · captured {new Date(snap.generatedAt).toLocaleTimeString()}
              </p>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground border-b">
                <tr>
                  <th className="py-2 pr-3">Underlying</th>
                  <th className="py-2 pr-3 text-right">Spot</th>
                  <th className="py-2 pr-3 text-right">Chg%</th>
                  <th className="py-2 pr-3 text-right">ATM</th>
                  <th className="py-2 pr-3 text-right">Max Pain</th>
                  <th className="py-2 pr-3 text-right">PCR (OI)</th>
                  <th className="py-2 pr-3 text-right">ATM IV</th>
                  <th className="py-2 pr-3 text-right">Call OI</th>
                  <th className="py-2 pr-3 text-right">Put OI</th>
                  <th className="py-2 pr-3 text-right">Δ Call</th>
                  <th className="py-2 pr-3 text-right">Δ Put</th>
                  <th className="py-2 pr-3">Bias</th>
                  <th className="py-2 pr-3">Top R / S</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {snap.items.map(it => (
                  <tr key={it.underlying} className={!it.ok ? "opacity-50" : ""}>
                    <td className="py-2 pr-3 font-medium">{it.underlying}</td>
                    {!it.ok ? (
                      <td colSpan={12} className="py-2 text-red-400">{it.error}</td>
                    ) : (
                      <>
                        <td className="py-2 pr-3 text-right">{it.spot != null ? it.spot.toFixed(2) : "—"}</td>
                        <td className={`py-2 pr-3 text-right ${(it.changePercent ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}>{fmtPct(it.changePercent)}</td>
                        <td className="py-2 pr-3 text-right">{it.atmStrike ?? "—"}</td>
                        <td className="py-2 pr-3 text-right">{it.maxPain ?? "—"}</td>
                        <td className="py-2 pr-3 text-right font-medium">{it.pcrOi != null ? it.pcrOi.toFixed(2) : "—"}</td>
                        <td className="py-2 pr-3 text-right">{it.atmIv != null ? it.atmIv.toFixed(1) : "—"}</td>
                        <td className="py-2 pr-3 text-right">{fmtNum(it.totalCallOi)}</td>
                        <td className="py-2 pr-3 text-right">{fmtNum(it.totalPutOi)}</td>
                        <td className={`py-2 pr-3 text-right ${(it.callOiAdded ?? 0) >= 0 ? "text-amber-400" : "text-green-400"}`}>{fmtNum(it.callOiAdded)}</td>
                        <td className={`py-2 pr-3 text-right ${(it.putOiAdded ?? 0) >= 0 ? "text-green-400" : "text-amber-400"}`}>{fmtNum(it.putOiAdded)}</td>
                        <td className="py-2 pr-3">
                          <Badge variant={it.bias === "BULLISH" ? "default" : it.bias === "BEARISH" ? "destructive" : "secondary"}>
                            {it.bias}
                          </Badge>
                        </td>
                        <td className="py-2 pr-3 text-muted-foreground">
                          R: {it.topResistance?.[0]?.strike ?? "—"} · S: {it.topSupport?.[0]?.strike ?? "—"}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Heatmap tab ─────────────────────────────────────────────────────────────
function HeatmapTab() {
  const [data, setData] = useState<HeatmapResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [bucketFilter, setBucketFilter] = useState<Bucket | "ALL">("ALL");

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`${base}api/options/oi-lab/heatmap`, { credentials: "include" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || j.error || r.statusText);
      setData(j);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    return bucketFilter === "ALL" ? data.rows : data.rows.filter(r => r.bucket === bucketFilter);
  }, [data, bucketFilter]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Futures OI Buildup — All F&O Stocks</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              {data
                ? <>Baseline established at {new Date(data.baselineEstablishedAt).toLocaleTimeString()} · refreshed {new Date(data.generatedAt).toLocaleTimeString()} · {data.rows.length} contracts</>
                : loading ? "Loading…" : "—"}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <a
              href={`${base}api/options/oi-lab/heatmap/export?format=csv`}
              className="inline-flex items-center gap-1 px-3 h-9 rounded-md border border-border bg-card hover:border-primary/60 hover:text-primary text-xs font-mono"
              download
              title="Download every futures row in this heatmap as CSV"
            >
              <Download className="w-3.5 h-3.5" /> CSV
            </a>
            <a
              href={`${base}api/options/oi-lab/heatmap/export?format=json`}
              className="inline-flex items-center gap-1 px-3 h-9 rounded-md border border-border bg-card hover:border-primary/60 hover:text-primary text-xs font-mono"
              download
              title="Download every futures row in this heatmap as JSON"
            >
              <Download className="w-3.5 h-3.5" /> JSON
            </a>
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded p-3 mb-4">
              <AlertTriangle className="w-4 h-4" /> {error}
            </div>
          )}
          {/* Bucket cards */}
          {data && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
              {(Object.keys(BUCKET_META) as Bucket[]).map(b => {
                const meta = BUCKET_META[b];
                const count = data.buckets[b];
                const active = bucketFilter === b;
                return (
                  <button key={b} onClick={() => setBucketFilter(active ? "ALL" : b)}
                    className={`text-left p-3 rounded border transition ${meta.tone} ${active ? "ring-2 ring-offset-2 ring-offset-background ring-current" : "opacity-90 hover:opacity-100"}`}>
                    <div className="text-xs uppercase font-medium">{meta.label}</div>
                    <div className="text-2xl font-semibold mt-1">{count}</div>
                    <div className="text-[10px] text-muted-foreground mt-1 leading-tight">{meta.desc}</div>
                  </button>
                );
              })}
            </div>
          )}

          {loading && <Skeleton className="h-64 w-full" />}

          {!loading && data && (
            // Container scrolls in BOTH directions internally so the sticky
            // thead has a real scroll-ancestor to anchor against. Without the
            // height clamp the whole page becomes the scroll context and
            // `top-0` has nothing to stick within (the same root cause we
            // fixed on the Option Chain table).
            <div className="overflow-auto max-h-[calc(100vh-280px)]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-20 bg-card text-left text-muted-foreground shadow-[0_1px_0_0_hsl(var(--border))]">
                  <tr>
                    <th className="py-2 pr-3">Stock</th>
                    <th className="py-2 pr-3 text-right">LTP</th>
                    <th className="py-2 pr-3 text-right">Price Δ%</th>
                    <th className="py-2 pr-3 text-right">OI</th>
                    <th className="py-2 pr-3 text-right">OI baseline</th>
                    <th className="py-2 pr-3 text-right">OI Δ%</th>
                    <th className="py-2 pr-3 text-right">Notional ₹</th>
                    <th className="py-2 pr-3">Bucket</th>
                    <th className="py-2 pr-3">Expiry</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {filtered.slice(0, 200).map(r => {
                    const meta = BUCKET_META[r.bucket];
                    return (
                      <tr key={r.symbol}>
                        <td className="py-1.5 pr-3 font-medium">{r.symbol}</td>
                        <td className="py-1.5 pr-3 text-right">{r.ltp != null ? r.ltp.toFixed(2) : "—"}</td>
                        <td className={`py-1.5 pr-3 text-right ${(r.priceChgPct ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
                          {fmtPct(r.priceChgPct)}
                        </td>
                        <td className="py-1.5 pr-3 text-right">{fmtNum(r.oi)}</td>
                        <td className="py-1.5 pr-3 text-right text-muted-foreground">{fmtNum(r.baselineOi)}</td>
                        <td className={`py-1.5 pr-3 text-right ${r.oiChgPct >= 0 ? "text-amber-400" : "text-sky-400"}`}>
                          {fmtPct(r.oiChgPct)}
                        </td>
                        <td className="py-1.5 pr-3 text-right text-muted-foreground">{fmtNum(r.notional)}</td>
                        <td className="py-1.5 pr-3">
                          <span className={`inline-block px-2 py-0.5 rounded text-[10px] border ${meta.tone}`}>{meta.label}</span>
                        </td>
                        <td className="py-1.5 pr-3 text-muted-foreground">{r.expiry}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filtered.length > 200 && (
                <p className="text-xs text-muted-foreground mt-2">Showing top 200 of {filtered.length} (sorted by abs OI Δ%).</p>
              )}
              {filtered.length === 0 && (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No contracts in this bucket yet — try refresh, or switch back to "All".
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Tracker tab ─────────────────────────────────────────────────────────────
function TrackerTab() {
  const [universe, setUniverse] = useState<{ indices: string[]; stocks: string[] }>({ indices: [], stocks: [] });
  const [selected, setSelected] = useState<Set<string>>(new Set(["NIFTY", "BANKNIFTY"]));
  const [intervalMin, setIntervalMin] = useState(5);
  const [status, setStatus] = useState<TrackerStatus | null>(null);
  const [series, setSeries] = useState<TrackerSnap[]>([]);
  const [chartUnderlying, setChartUnderlying] = useState<string>("NIFTY");
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const r = await fetch(`${base}api/options/oi-lab/tracker/series`, { credentials: "include" });
      const j = await r.json() as { status: TrackerStatus; series: TrackerSnap[] };
      setStatus(j.status);
      setSeries(j.series);
    } catch (e) {
      // silent — UI shows last good state
    }
  };

  useEffect(() => {
    fetch(`${base}api/options/oi-lab/universe`, { credentials: "include" })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(setUniverse).catch(() => {});
    void load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  const start = async () => {
    setError(null);
    try {
      const r = await fetch(`${base}api/options/oi-lab/tracker/start`, {
        method: "POST", credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ underlyings: Array.from(selected), intervalMinutes: intervalMin }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || j.error || r.statusText);
      setStatus(j);
      setTimeout(load, 2000); // pick up first tick
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const stop = async (clear = false) => {
    setError(null);
    try {
      const r = await fetch(`${base}api/options/oi-lab/tracker/stop?clear=${clear}`, {
        method: "POST", credentials: "include",
      });
      const j = await r.json();
      setStatus(j);
      if (clear) setSeries([]);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const toggleSel = (sym: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(sym)) next.delete(sym); else next.add(sym);
      return next;
    });
  };

  const trackedSymbols = useMemo(() => Array.from(new Set(series.map(s => s.underlying))), [series]);
  const chartData = useMemo(() => {
    return series
      .filter(s => s.underlying === chartUnderlying)
      .map(s => ({
        ts: new Date(s.ts).getTime(),
        label: new Date(s.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        spot: s.spot,
        pcrOi: s.pcrOi,
        callOi: s.totalCallOi,
        putOi: s.totalPutOi,
        atmIv: s.atmIv,
        maxPain: s.maxPain,
        callOiAdded: s.callOiAdded ?? 0,
        putOiAdded:  s.putOiAdded  ?? 0,
        // Net flow: positive = puts being written more than calls (bullish)
        netFlow: (s.putOiAdded ?? 0) - (s.callOiAdded ?? 0),
      }));
  }, [series, chartUnderlying]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Intraday OI Tracker</CardTitle>
          <p className="text-xs text-muted-foreground">
            Snapshots option-chain analytics every N minutes while running. In-memory only — auto-clears when Kite session ends.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-xs uppercase text-muted-foreground">Track these underlyings</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {[...universe.indices, ...universe.stocks.slice(0, 30)].map(s => (
                <button key={s} onClick={() => toggleSel(s)}
                  className={`px-2.5 py-1 rounded text-xs border transition ${
                    selected.has(s)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-muted-foreground border-border hover:border-primary/50"
                  }`}>
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-xs">
                Interval (minutes)
                {intervalMin > 5 && (
                  <span className="ml-2 text-[10px] text-amber-400">
                    Tip: 2–3 min gives the cleanest intraday signal
                  </span>
                )}
              </Label>
              <Input type="number" min={1} max={60} value={intervalMin}
                onChange={e => setIntervalMin(Math.max(1, Math.min(60, Number(e.target.value) || 5)))}
                className="w-24 h-9" />
            </div>
            {!status?.running ? (
              <Button onClick={start} disabled={selected.size === 0}>
                <Play className="w-4 h-4 mr-2" /> Start tracking
              </Button>
            ) : (
              <>
                <Button variant="destructive" onClick={() => stop(false)}>
                  <Square className="w-4 h-4 mr-2" /> Stop
                </Button>
                <Button variant="outline" onClick={() => stop(true)}>
                  Stop & clear data
                </Button>
              </>
            )}
            <div className="ml-auto text-xs text-muted-foreground space-y-0.5 text-right">
              <div>
                Status: <Badge variant={status?.running ? "default" : "secondary"}>{status?.running ? "RUNNING" : "STOPPED"}</Badge>
              </div>
              <div>{status?.snapshotCount ?? 0} snapshots collected</div>
              {status?.lastTickAt && <div>Last tick: {new Date(status.lastTickAt).toLocaleTimeString()}</div>}
              {status?.nextTickAt && <div>Next tick: {new Date(status.nextTickAt).toLocaleTimeString()}</div>}
            </div>
          </div>
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded p-3">
              <AlertTriangle className="w-4 h-4" /> {error}
            </div>
          )}
          {status?.errors && status.errors.length > 0 && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Recent tick errors ({status.errors.length})</summary>
              <ul className="mt-2 space-y-0.5">
                {status.errors.map((e, i) => (
                  <li key={i}>{new Date(e.ts).toLocaleTimeString()} · {e.underlying}: {e.error}</li>
                ))}
              </ul>
            </details>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Time-series</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              {trackedSymbols.length === 0
                ? "No data yet — start the tracker to collect snapshots."
                : `${series.length} total snapshots across ${trackedSymbols.length} symbols.`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {trackedSymbols.length > 0 && (
              <Select value={chartUnderlying} onValueChange={setChartUnderlying}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {trackedSymbols.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {series.length > 0 && (
              <>
                {/* Download — exports either the selected underlying (when a chip is
                    chosen) or every recorded snapshot. Cookie-credentialed. */}
                <a
                  href={`${base}api/options/oi-lab/tracker/export?format=csv${chartUnderlying ? `&underlying=${encodeURIComponent(chartUnderlying)}` : ""}`}
                  className="inline-flex items-center gap-1 px-2.5 h-9 rounded-md border border-border bg-card hover:border-primary/60 hover:text-primary text-xs font-mono"
                  download
                  title={`Download ${chartUnderlying || "all"} tracker snapshots as CSV`}
                >
                  <Download className="w-3.5 h-3.5" /> CSV
                </a>
                <a
                  href={`${base}api/options/oi-lab/tracker/export?format=json${chartUnderlying ? `&underlying=${encodeURIComponent(chartUnderlying)}` : ""}`}
                  className="inline-flex items-center gap-1 px-2.5 h-9 rounded-md border border-border bg-card hover:border-primary/60 hover:text-primary text-xs font-mono"
                  download
                  title={`Download ${chartUnderlying || "all"} tracker snapshots as JSON`}
                >
                  <Download className="w-3.5 h-3.5" /> JSON
                </a>
              </>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center text-sm text-muted-foreground gap-2">
              <Activity className="w-6 h-6 opacity-50" />
              {status?.running ? "Waiting for first tick…" : "No data — start the tracker above."}
            </div>
          ) : (
            <div className="space-y-6">
              {/*
                "Latest snapshot" summary card — fixes the perceived "zero
                values" problem the user reported. With only 2 snapshots the
                line charts below render as thin 2-point segments that read
                as flat / empty even though the data is fine; surfacing the
                most-recent numbers as readable text means the page is
                actionable from snapshot 1, not snapshot 20.
              */}
              {(() => {
                const latest = chartData[chartData.length - 1]!;
                const prev = chartData.length >= 2 ? chartData[chartData.length - 2] : null;
                const tone = (n: number) =>
                  n > 0 ? "text-emerald-400" : n < 0 ? "text-rose-400" : "text-zinc-400";
                const Tile = ({ label, value, sub, accent = "text-foreground" }:
                  { label: string; value: string; sub?: { text: string; cls: string } | null; accent?: string }) => (
                  <div className="rounded border border-border bg-card/60 p-2.5">
                    <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-mono">{label}</div>
                    <div className={`text-lg font-bold tabular-nums ${accent}`}>{value}</div>
                    {sub && <div className={`text-[10px] font-mono ${sub.cls}`}>{sub.text}</div>}
                  </div>
                );
                const spotDelta = prev ? latest.spot - prev.spot : 0;
                const pcrDelta  = prev ? latest.pcrOi - prev.pcrOi : 0;
                return (
                  <div>
                    <div className="text-xs font-medium mb-2 flex items-center gap-2">
                      <Sparkles className="w-3 h-3" /> Latest snapshot — {chartUnderlying}
                      <span className="ml-auto text-[10px] text-muted-foreground font-mono">{latest.label}</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                      <Tile
                        label="Spot"
                        value={latest.spot.toFixed(2)}
                        sub={prev ? { text: `${spotDelta >= 0 ? "+" : ""}${spotDelta.toFixed(2)} vs prev`, cls: tone(spotDelta) } : null}
                      />
                      <Tile
                        label="PCR (OI)"
                        value={latest.pcrOi.toFixed(2)}
                        accent={latest.pcrOi >= 1.3 ? "text-emerald-400" : latest.pcrOi <= 0.7 ? "text-rose-400" : "text-foreground"}
                        sub={prev ? { text: `${pcrDelta >= 0 ? "+" : ""}${pcrDelta.toFixed(2)} vs prev`, cls: tone(pcrDelta) } : null}
                      />
                      <Tile label="Max Pain" value={String(latest.maxPain)} accent="text-orange-400" />
                      <Tile
                        label="ATM IV"
                        value={latest.atmIv != null ? `${latest.atmIv.toFixed(1)}%` : "—"}
                      />
                      <Tile
                        label="Total Call OI"
                        value={fmtNum(latest.callOi)}
                        accent="text-rose-400"
                        sub={{ text: `Δ ${latest.callOiAdded >= 0 ? "+" : ""}${fmtNum(latest.callOiAdded)}`, cls: tone(latest.callOiAdded) }}
                      />
                      <Tile
                        label="Total Put OI"
                        value={fmtNum(latest.putOi)}
                        accent="text-emerald-400"
                        sub={{ text: `Δ ${latest.putOiAdded >= 0 ? "+" : ""}${fmtNum(latest.putOiAdded)}`, cls: tone(latest.putOiAdded) }}
                      />
                      <Tile
                        label="Net Flow (PE−CE)"
                        value={`${latest.netFlow >= 0 ? "+" : ""}${fmtNum(latest.netFlow)}`}
                        accent={latest.netFlow > 0 ? "text-emerald-400" : latest.netFlow < 0 ? "text-rose-400" : "text-foreground"}
                        sub={{ text: latest.netFlow > 0 ? "put writers ahead (bullish)" : latest.netFlow < 0 ? "call writers ahead (bearish)" : "balanced", cls: "text-muted-foreground" }}
                      />
                    </div>
                  </div>
                );
              })()}

              <div>
                <div className="text-xs font-medium mb-1 flex items-center gap-2">
                  <TrendingUp className="w-3 h-3" /> Spot vs Max Pain — {chartUnderlying}
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  {/* dot={{ r: 2 }} on every series so even a 2-snapshot chart
                      reads as concrete data points instead of a barely-visible
                      line segment. */}
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
                    <RTooltip contentStyle={{ background: "#0a0a0a", border: "1px solid #27272a", fontSize: 11 }}
                      labelStyle={{ color: "#fafafa", fontWeight: 600 }}
                      itemStyle={{ color: "#e4e4e7" }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="spot" stroke="#22c55e" strokeWidth={2} dot={{ r: 2 }} name="Spot" />
                    <Line type="monotone" dataKey="maxPain" stroke="#f97316" strokeWidth={2} strokeDasharray="4 4" dot={{ r: 2 }} name="Max Pain" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div>
                <div className="text-xs font-medium mb-1 flex items-center gap-2">
                  <Activity className="w-3 h-3" /> PCR (OI) over time
                </div>
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} domain={[0, "auto"]} />
                    <RTooltip contentStyle={{ background: "#0a0a0a", border: "1px solid #27272a", fontSize: 11 }}
                      labelStyle={{ color: "#fafafa", fontWeight: 600 }}
                      itemStyle={{ color: "#e4e4e7" }} />
                    <ReferenceLine y={1} stroke="#71717a" strokeDasharray="3 3" label={{ value: "Neutral 1.0", fill: "#71717a", fontSize: 10 }} />
                    <Line type="monotone" dataKey="pcrOi" stroke="#a855f7" strokeWidth={2} dot={{ r: 2.5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div>
                <div className="text-xs font-medium mb-1 flex items-center gap-2">
                  <TrendingDown className="w-3 h-3" /> Total Call OI vs Put OI
                </div>
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => fmtNum(v)} />
                    <RTooltip contentStyle={{ background: "#0a0a0a", border: "1px solid #27272a", fontSize: 11 }}
                      labelStyle={{ color: "#fafafa", fontWeight: 600 }}
                      itemStyle={{ color: "#e4e4e7" }}
                      formatter={(v: number) => fmtNum(v)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="callOi" stroke="#ef4444" strokeWidth={2} dot={{ r: 2 }} name="Call OI" />
                    <Line type="monotone" dataKey="putOi" stroke="#22c55e" strokeWidth={2} dot={{ r: 2 }} name="Put OI" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div>
                <div className="text-xs font-medium mb-1 flex items-center gap-2">
                  <Activity className="w-3 h-3" /> OI Added Flow (CE vs PE) — net = put writers ahead
                </div>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => fmtNum(v)} />
                    <RTooltip
                      contentStyle={{ background: "#0a0a0a", border: "1px solid #27272a", fontSize: 11 }}
                      labelStyle={{ color: "#fafafa", fontWeight: 600 }}
                      itemStyle={{ color: "#e4e4e7" }}
                      formatter={(v: number) => fmtNum(v)}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <ReferenceLine y={0} stroke="#71717a" strokeDasharray="3 3" />
                    <Line type="monotone" dataKey="callOiAdded" stroke="#ef4444" strokeWidth={2}   dot={{ r: 2 }} name="CE OI added" />
                    <Line type="monotone" dataKey="putOiAdded"  stroke="#22c55e" strokeWidth={2}   dot={{ r: 2 }} name="PE OI added" />
                    <Line type="monotone" dataKey="netFlow"     stroke="#a855f7" strokeWidth={2.5} dot={{ r: 2.5 }} name="Net flow (PE−CE)" />
                  </LineChart>
                </ResponsiveContainer>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Positive net flow = put writers stepping in (bullish). Negative = call writers in control (bearish).
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── OI Insights tab ─────────────────────────────────────────────────────────

interface InsightStrike {
  strike: number;
  isAtm: boolean;
  ceOi: number; ceOiChg: number; ceVolume: number; ceLtp: number; ceIv: number | null; ceBuildup: string;
  ceDelta?: number; ceGamma?: number; ceTheta?: number; ceVega?: number;
  peOi: number; peOiChg: number; peVolume: number; peLtp: number; peIv: number | null; peBuildup: string;
  peDelta?: number; peGamma?: number; peTheta?: number; peVega?: number;
  pcr: number;
  painValue: number;
}
type SentimentBand = "STRONGLY_BEARISH" | "MILDLY_BEARISH" | "NEUTRAL" | "MILDLY_BULLISH" | "STRONGLY_BULLISH";
interface InsightResp {
  underlying: string;
  kind: "INDEX" | "EQUITY";
  spot: number;
  prevClose: number;
  changePercent: number;
  expiry: string;
  expiries: string[];
  atmStrike: number;
  strikeStep: number;
  lotSize: number | null;
  source: string;
  generatedAt: string;
  pcrOi: number;
  intradayFlow: number;       // [-1, +1], + = bullish put-write flow
  intradayOiTrue: false;      // marker: OI Δ comes from a session-range proxy, not tick data
  pcrVolume: number;
  maxPain: number;
  maxPainDeviation: number;
  atmIv: number | null;
  totalCallOi: number;
  totalPutOi: number;
  callOiAdded: number;
  putOiAdded: number;
  topResistance: { strike: number; oi: number }[];
  topSupport: { strike: number; oi: number }[];
  sentiment: SentimentBand;
  sentimentScore: number;
  sentimentLabel: string;
  marketInsight: string;
  analysis: string;
  strikes: InsightStrike[];
}

const SENTIMENT_TONE: Record<SentimentBand, { color: string; bg: string; border: string }> = {
  STRONGLY_BEARISH: { color: "#dc2626", bg: "bg-red-500/15",   border: "border-red-500/40"   },
  MILDLY_BEARISH:   { color: "#f97316", bg: "bg-orange-500/15", border: "border-orange-500/40" },
  NEUTRAL:          { color: "#a3a3a3", bg: "bg-zinc-500/15",  border: "border-zinc-500/40"  },
  MILDLY_BULLISH:   { color: "#84cc16", bg: "bg-lime-500/15",  border: "border-lime-500/40"  },
  STRONGLY_BULLISH: { color: "#16a34a", bg: "bg-green-500/15", border: "border-green-500/40" },
};

/**
 * Custom tooltip for the main "OI Insights" chart.
 *
 * Goal: when hovering a strike, show the same per-strike breakdown a trader
 * would expect from a Sensibull-/StockMojo-style chart — open OI at market
 * open (9:15 AM), intraday change, and current OI for both Call and Put,
 * along with view-specific extras (PCR / Pain).
 *
 * Open OI is derived from the row itself:  openOi = currentOi − intradayΔ.
 */
type OiBarRow = {
  strike: number;
  strikeLabel: string;
  ceOi: number;
  peOi: number;
  ceOiChg: number;
  peOiChg: number;
  pcr: number;
  pain: number;
  isAtm: boolean;
};
function OiInsightsTooltip(props: {
  active?: boolean;
  payload?: Array<{ payload: OiBarRow & { missingBaseline?: boolean } }>;
  label?: string | number;
  view: "oi" | "oichg" | "pcr" | "pain";
  nowTime: string;
  // Timeframe context — when finite-window mode is active, the baseline row
  // and Δ row need to label themselves as "at HH:MM:SS / since HH:MM:SS",
  // NOT "at 9:15 AM / since 9:15 AM" (the prior bug). Passed-in so the
  // tooltip's labels can never disagree with what the chart computed.
  tfMode: "all" | "exact" | "approx" | "fallback_open";
  tfWindowLabel: string;            // e.g. "Last 5 min"
  tfBaselineTime: string | null;    // e.g. "10:42:30" — null when "all" / fallback_open
}) {
  const { active, payload, label, view, nowTime, tfMode, tfWindowLabel, tfBaselineTime } = props;
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  if (!row) return null;

  // Decide what the baseline row actually represents:
  //   - "all" / "fallback_open" → broker since-open Δ → 9:15 AM
  //   - "exact" / "approx"      → user-selected window → baseline timestamp
  const useWindow = tfMode === "exact" || tfMode === "approx";
  const baselineLabel = useWindow && tfBaselineTime
    ? `at ${tfBaselineTime} (${tfWindowLabel})`
    : "at 9:15 AM";
  const chgLabel = useWindow ? `chg in ${tfWindowLabel.toLowerCase()}` : "chg";

  const openCe = row.ceOi - row.ceOiChg;
  const openPe = row.peOi - row.peOiChg;
  const fmtSigned = (n: number): string => {
    if (!Number.isFinite(n) || n === 0) return "0";
    return (n > 0 ? "+" : "") + fmtNum(n);
  };
  const sign = (n: number): string =>
    n === 0 ? "text-zinc-400" : n > 0 ? "text-emerald-300" : "text-rose-300";

  const Row = ({
    label: l,
    value,
    valueClass = "text-zinc-100",
    dotClass,
  }: {
    label: string;
    value: string;
    valueClass?: string;
    dotClass: string;
  }) => (
    <div className="flex items-center justify-between gap-6 py-[2px]">
      <span className="flex items-center gap-1.5 text-zinc-300">
        <span className={`inline-block w-2 h-2 rounded-full ${dotClass}`} />
        {l}
      </span>
      <span className={`font-mono text-[11px] tabular-nums ${valueClass}`}>{value}</span>
    </div>
  );

  return (
    <div
      className="rounded-md border border-zinc-700 bg-zinc-950/95 px-3 py-2 shadow-xl"
      style={{ minWidth: 220, fontSize: 11 }}
    >
      <div className="text-zinc-100 font-semibold text-xs mb-1.5 flex items-center gap-2">
        Strike {label}
        {row.isAtm && (
          <span className="text-[9px] uppercase tracking-wide bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded">ATM</span>
        )}
      </div>

      {/* Put block — green */}
      <div className="space-y-0">
        <Row label={`Put OI ${baselineLabel}`} value={fmtNum(openPe)} dotClass="bg-emerald-500" />
        <Row label={`Put OI ${chgLabel}`}      value={fmtSigned(row.peOiChg)} valueClass={`font-mono tabular-nums ${sign(row.peOiChg)}`} dotClass="bg-emerald-500/60" />
        <Row label={`Put OI at ${nowTime}`} value={fmtNum(row.peOi)} dotClass="bg-emerald-500" />
      </div>

      <div className="h-px bg-zinc-800 my-1.5" />

      {/* Call block — red */}
      <div className="space-y-0">
        <Row label={`Call OI ${baselineLabel}`} value={fmtNum(openCe)} dotClass="bg-rose-500" />
        {/*
          Color the change row purely by the sign of the number:
          negative = red (OI shed), positive = green (OI added),
          zero = neutral. We deliberately do NOT invert for the Call leg —
          the user wants a literal "negative number → red" reading
          everywhere in the OI change rows.
        */}
        <Row label={`Call OI ${chgLabel}`}      value={fmtSigned(row.ceOiChg)} valueClass={`font-mono tabular-nums ${sign(row.ceOiChg)}`} dotClass="bg-rose-500/60" />
        <Row label={`Call OI at ${nowTime}`} value={fmtNum(row.ceOi)} dotClass="bg-rose-500" />
      </div>

      {useWindow && row.missingBaseline && (
        <div className="mt-1.5 text-[10px] text-amber-300/90 font-mono leading-tight">
          ⚠ baseline missing for this strike — added mid-window, Δ shown as 0
        </div>
      )}

      {/* View-specific extras */}
      {view === "pcr" && (
        <>
          <div className="h-px bg-zinc-800 my-1.5" />
          <Row label="PCR (this strike)" value={row.pcr.toFixed(2)} dotClass="bg-zinc-400" />
        </>
      )}
      {view === "pain" && (
        <>
          <div className="h-px bg-zinc-800 my-1.5" />
          <Row label="Total writer pain" value={fmtNum(row.pain)} dotClass="bg-orange-400" />
        </>
      )}
    </div>
  );
}

/**
 * Intraday timeframe selector for the main "OI by Strike" chart.
 *
 * "All" = use the broker's since-open Δ (the existing `ceOiChg` / `peOiChg`
 *  fields, which are intraday change since 9:15 AM).
 *
 * Any finite window = recompute per-strike Δ as
 *  `currentOi - earliestOiInWindow` from the client-side rolling buffer of
 *  insights snapshots (see `oiHistoryRef` below). The buffer is keyed by
 *  underlying+expiry and grows by 1 entry every 30s (the existing poll
 *  cadence), so the 3-hour pill needs ~360 entries — well within any
 *  reasonable memory budget.
 */
type TimeFrame = "3m" | "5m" | "10m" | "15m" | "30m" | "1h" | "2h" | "3h" | "all";
const TIMEFRAMES: { v: TimeFrame; l: string; ms: number | null }[] = [
  { v: "3m",  l: "Last 3 min",  ms: 3 * 60_000 },
  { v: "5m",  l: "Last 5 min",  ms: 5 * 60_000 },
  { v: "10m", l: "Last 10 min", ms: 10 * 60_000 },
  { v: "15m", l: "Last 15 min", ms: 15 * 60_000 },
  { v: "30m", l: "Last 30 min", ms: 30 * 60_000 },
  { v: "1h",  l: "Last 1 hr",   ms: 60 * 60_000 },
  { v: "2h",  l: "Last 2 hr",   ms: 120 * 60_000 },
  { v: "3h",  l: "Last 3 hr",   ms: 180 * 60_000 },
  { v: "all", l: "All",         ms: null },
];

interface OiHistorySnap {
  ts: number;                          // epoch ms
  ce: Record<number, number>;          // strike -> ceOi
  pe: Record<number, number>;          // strike -> peOi
}

function InsightsTab() {
  const [universe, setUniverse] = useState<{ indices: string[]; stocks: string[]; source?: string; count?: number; note?: string }>({ indices: [], stocks: [] });
  const [underlying, setUnderlying] = useState("NIFTY");
  const [strikesAround, setStrikesAround] = useState<"atm" | "5" | "10" | "20" | "all">("10");
  const [expiry, setExpiry] = useState<string | undefined>(undefined);
  const [data, setData] = useState<InsightResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [chartView, setChartView] = useState<"oi" | "oichg" | "pcr" | "pain">("oi");
  const [timeframe, setTimeframe] = useState<TimeFrame>("all");
  // Per-(underlying|expiry) rolling buffer of OI snapshots so we can compute
  // Δ over an arbitrary window (Last 5m / 1h / etc) on the client without
  // additional server round-trips. Stored in a ref because we don't want
  // every push to re-render the whole InsightsTab — only the oiBars memo
  // needs the data, and it's gated behind `data` (which IS state) and
  // `timeframe` (also state), so any meaningful change is already a render.
  const oiHistoryRef = useRef<Record<string, OiHistorySnap[]>>({});
  // Bumped on every successful fetch so the oiBars useMemo re-evaluates
  // against the freshly-pushed snapshot (refs alone don't trigger memos).
  const [historyTick, setHistoryTick] = useState(0);

  // Load universe once
  useEffect(() => {
    fetch(`${base}api/options/oi-lab/universe`, { credentials: "include" })
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(setUniverse)
      .catch(() => {});
  }, []);

  // Monotonic request id — only the most-recently-issued fetch is allowed
  // to commit `setData`/buffer-push, so a stale in-flight response from a
  // previous symbol cannot overwrite the current one (the cross-symbol
  // leakage path the reviewer flagged).
  const reqIdRef = useRef(0);

  // Load insights — re-fetches on underlying / expiry / strikes change + every 30s
  const load = async () => {
    setError(null);
    const myId = ++reqIdRef.current;
    try {
      const qs = new URLSearchParams();
      qs.set("strikes", strikesAround);
      if (expiry) qs.set("expiry", expiry);
      const r = await fetch(`${base}api/options/oi-lab/insights/${encodeURIComponent(underlying)}?${qs}`, { credentials: "include" });
      const j: InsightResp = await r.json();
      // Drop the response if a newer request has already been issued (or
      // the buffer was reset by a symbol switch in the meantime).
      if (myId !== reqIdRef.current) return;
      if (!r.ok) throw new Error((j as unknown as { detail?: string; error?: string }).detail || (j as unknown as { error?: string }).error || r.statusText);
      setData(j);
      // Push per-strike snapshot into the rolling buffer for THIS
      // underlying+expiry. Trim to the longest configured window (3h) +
      // a small slack so a fresh "Last 3h" pill always has its baseline.
      const key = `${j.underlying}|${j.expiry}`;
      const snap: OiHistorySnap = {
        ts: new Date(j.generatedAt).getTime(),
        ce: Object.fromEntries(j.strikes.map(s => [s.strike, s.ceOi])),
        pe: Object.fromEntries(j.strikes.map(s => [s.strike, s.peOi])),
      };
      const buf = oiHistoryRef.current[key] ?? [];
      buf.push(snap);
      const cutoff = snap.ts - (3 * 60 + 5) * 60_000; // 3h + 5min slack
      while (buf.length > 0 && buf[0]!.ts < cutoff) buf.shift();
      oiHistoryRef.current[key] = buf;
      setHistoryTick(t => t + 1);
    } catch (e) {
      if (myId !== reqIdRef.current) return;
      setError((e as Error).message);
      setData(null);
    } finally {
      if (myId === reqIdRef.current) setLoading(false);
    }
  };
  useEffect(() => {
    setLoading(true);
    void load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [underlying, expiry, strikesAround]);

  // Reset expiry AND drop any buffered history that no longer matches the
  // new underlying so a "Last 30 min" pill can never compare strikes from
  // two different symbols. Also reset the timeframe back to "All" — keeping
  // a finite-window pill active across symbols would briefly render a
  // misleading title until the buffer caught up (the silent-mismatch bug
  // the reviewer flagged).
  useEffect(() => {
    setExpiry(undefined);
    oiHistoryRef.current = {};
    setHistoryTick(0);
    setTimeframe("all");
  }, [underlying]);

  const allUnderlyings = useMemo(
    () => [...universe.indices, ...universe.stocks],
    [universe.indices, universe.stocks],
  );
  const filteredUnderlyings = useMemo(() => {
    const q = searchQ.trim().toUpperCase();
    if (!q) return allUnderlyings.slice(0, 200);
    return allUnderlyings.filter(s => s.includes(q)).slice(0, 200);
  }, [allUnderlyings, searchQ]);

  // ── Chart data ─────────────────────────────────────────────────────────────
  // Defensive: coerce every numeric to a real Number (never NaN/undefined) so
  // Recharts can compute its YAxis domain. A single bad row used to leave the
  // whole BarChart blank.
  const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  // Resolve the active timeframe and its baseline snapshot (if any) from the
  // rolling history. The `mode` discriminator is the source of truth that
  // every consumer (title, pills, oiBars, badge) reads from — so the pill
  // label, the chart title, and the actual computed Δ can never disagree
  // (the silent-mismatch bug the reviewer flagged). Possible modes:
  //   - "all"          : All / since-open Δ from broker (default)
  //   - "exact"        : finite window AND we have a snap inside [cutoff, now)
  //   - "approx"       : finite window AND nearest available snap is OUTSIDE
  //                      the requested window (older or newer-than-cutoff
  //                      mismatch) — surfaced as "approx" badge
  //   - "fallback_open": finite window selected BUT no usable baseline
  //                      exists — Δ silently uses broker since-open AND the
  //                      title shows "since open" so the user is never lied
  //                      to about what the chart represents.
  type TfMode = "all" | "exact" | "approx" | "fallback_open";
  const tfResolved = useMemo<{
    tf: TimeFrame;
    mode: TfMode;
    windowMs: number | null;
    baseline: OiHistorySnap | null;
    baselineUsedAt: number | null;
    bufferLen: number;
  }>(() => {
    if (!data) return { tf: timeframe, mode: "all", windowMs: null, baseline: null, baselineUsedAt: null, bufferLen: 0 };
    const meta = TIMEFRAMES.find(t => t.v === timeframe)!;
    const key = `${data.underlying}|${data.expiry}`;
    const buf = oiHistoryRef.current[key] ?? [];
    if (meta.ms == null) {
      return { tf: timeframe, mode: "all", windowMs: null, baseline: null, baselineUsedAt: null, bufferLen: buf.length };
    }
    if (buf.length < 2) {
      // No usable baseline at all. Compute Δ via since-open fallback so the
      // chart isn't blank, but flag the mode so the title and pill render
      // honestly as "since open".
      return { tf: timeframe, mode: "fallback_open", windowMs: meta.ms, baseline: null, baselineUsedAt: null, bufferLen: buf.length };
    }
    const nowMs = new Date(data.generatedAt).getTime();
    const cutoff = nowMs - meta.ms;
    // Pick the snap whose ts is closest to `cutoff` AND is strictly older
    // than `nowMs`. Closest-to-cutoff (rather than first-in-window) gives a
    // baseline that best approximates "exactly N min ago" even when the
    // sampling is sparse (tab throttled, network hiccup) — far better than
    // the previous "first snap in window" rule which could pick a sample
    // only ~1s old when the window was 5min.
    const candidates = buf.filter(s => s.ts < nowMs);
    if (candidates.length === 0) {
      return { tf: timeframe, mode: "fallback_open", windowMs: meta.ms, baseline: null, baselineUsedAt: null, bufferLen: buf.length };
    }
    let best = candidates[0]!;
    let bestDist = Math.abs(best.ts - cutoff);
    for (const s of candidates) {
      const d = Math.abs(s.ts - cutoff);
      if (d < bestDist) { best = s; bestDist = d; }
    }
    // "Exact" only when the chosen baseline lies inside ±20% of the
    // requested window (i.e. close enough that calling it "Last N min" is
    // honest). Otherwise classify as "approx" and surface a warning.
    const tolMs = meta.ms * 0.2;
    const mode: TfMode = bestDist <= tolMs ? "exact" : "approx";
    return {
      tf: timeframe,
      mode,
      windowMs: meta.ms,
      baseline: best,
      baselineUsedAt: best.ts,
      bufferLen: buf.length,
    };
    // historyTick re-evaluates this memo each time the buffer grows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, timeframe, historyTick]);

  const oiBars = useMemo(() => {
    if (!data) return [];
    const { baseline, mode } = tfResolved;
    // mode === "fallback_open" or "all" → broker since-open Δ
    // mode === "exact" or "approx"      → diff vs baseline snapshot
    const useBaseline = (mode === "exact" || mode === "approx") && baseline != null;
    return data.strikes.map(s => {
      let ceOiChg = num(s.ceOiChg);
      let peOiChg = num(s.peOiChg);
      let missingBaseline = false;
      if (useBaseline && baseline) {
        const baseCe = baseline.ce[s.strike];
        const basePe = baseline.pe[s.strike];
        // Strict semantics: in a finite-window mode, EITHER both legs of
        // the strike have a baseline (Δ is honest) OR neither does and Δ
        // renders as 0 (no change attributable to this window). We never
        // mix window-Δ and since-open Δ in the same chart — that mixing
        // was the silent-mismatch bug the reviewer flagged.
        if (baseCe != null && basePe != null) {
          ceOiChg = num(s.ceOi) - num(baseCe);
          peOiChg = num(s.peOi) - num(basePe);
        } else {
          ceOiChg = 0;
          peOiChg = 0;
          missingBaseline = true;
        }
      }
      return {
        strike: num(s.strike),
        // strikeLabel forces a stable string category on the X axis — Recharts'
        // categorical scale gets confused when numeric `strike` values look
        // like a continuous scale, which (combined with the Fragment-wrapped
        // Bars below) sometimes drops every bar from the plot.
        strikeLabel: String(s.strike),
        ceOi: num(s.ceOi),
        peOi: num(s.peOi),
        ceOiChg,
        peOiChg,
        missingBaseline,
        pcr: num(s.pcr),
        // Per-strike PCR is unbounded above — at deep ITM-call strikes (well
        // below spot) call OI is tiny and the ratio explodes to 30..100+. The
        // chart's YAxis auto-scales to that extreme, which makes the genuinely
        // meaningful PCR values for high strikes (~0.1..0.5, where call OI
        // dominates) appear as essentially zero-height bars — i.e. visually
        // missing from the right half of the chart. Cap the rendered value at
        // 3 (well above the 1.3/0.7 bullish/bearish thresholds we shade
        // against) so every strike's bar is visible at a useful scale; the
        // tooltip still surfaces the true uncapped `pcr` so extreme readings
        // are never hidden from the trader.
        pcrCapped: Math.min(num(s.pcr), 3),
        pain: num(s.painValue),
        isAtm: s.isAtm,
      };
    });
  }, [data, tfResolved]);
  // Windowed Δ totals — sum the per-strike windowed Δ across the visible
  // strike set so the small "Open Interest Change" / "Total OI Δ" cards
  // stay in sync with the timeframe pill above the main chart. In "all"
  // and "fallback_open" modes these match the broker since-open totals
  // exactly (oiBars retains s.ceOiChg / s.peOiChg unchanged); in finite
  // window modes they sum the recomputed Δ (with missingBaseline strikes
  // contributing 0, exactly as the chart shows them). Single source of
  // truth — no possibility of card and chart disagreeing.
  const windowedTotals = useMemo(() => {
    let call = 0, put = 0, missing = 0;
    for (const r of oiBars) {
      call += r.ceOiChg;
      put  += r.peOiChg;
      if (r.missingBaseline) missing++;
    }
    return { call, put, missing };
  }, [oiBars]);

  const pcrPie = useMemo(() => {
    if (!data) return [];
    const total = data.totalCallOi + data.totalPutOi;
    if (total === 0) return [];
    return [
      { name: "Put OI",  value: data.totalPutOi,  pct: (data.totalPutOi  / total) * 100 },
      { name: "Call OI", value: data.totalCallOi, pct: (data.totalCallOi / total) * 100 },
    ];
  }, [data]);

  const sentTone = data ? SENTIMENT_TONE[data.sentiment] : SENTIMENT_TONE.NEUTRAL;

  return (
    <div className="space-y-4">
      {/* Top bar — underlying + spot + meta */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Underlying picker */}
            <div className="relative">
              <button
                onClick={() => { setPickerOpen(o => !o); setSearchQ(""); }}
                className="flex items-center gap-2 px-3 py-1.5 rounded border border-border bg-background hover-row text-sm font-mono min-w-[180px]"
              >
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="font-bold">{underlying}</span>
                <span className="text-xs text-muted-foreground ml-auto">
                  {universe.source === "kite" ? `${universe.count}` : "live ↗"}
                </span>
              </button>
              {pickerOpen && (
                <div className="absolute z-50 left-0 mt-1.5 w-[320px] max-h-[60vh] overflow-y-auto rounded-md border border-border bg-popover shadow-2xl">
                  <div className="sticky top-0 bg-popover border-b border-border p-2">
                    <Input
                      autoFocus
                      value={searchQ}
                      onChange={e => setSearchQ(e.target.value)}
                      placeholder="Search F&O underlying…"
                      className="h-8 text-xs"
                    />
                    {universe.note && (
                      <div className="text-[10px] text-amber-400 mt-1.5">{universe.note}</div>
                    )}
                  </div>
                  <div className="p-1">
                    {filteredUnderlyings.map(s => (
                      <button
                        key={s}
                        onClick={() => { setUnderlying(s); setPickerOpen(false); }}
                        className={`w-full text-left px-2 py-1 text-xs rounded hover-row font-mono ${
                          underlying === s ? "bg-primary/15 text-primary" : ""
                        } ${universe.indices.includes(s) ? "font-bold" : ""}`}
                      >
                        {s}
                        {universe.indices.includes(s) && (
                          <span className="ml-2 px-1 rounded text-[9px] bg-primary/20 text-primary">IDX</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Spot */}
            {data && (
              <>
                <div className="flex items-baseline gap-2">
                  <div className="text-2xl font-bold tabular-nums">{data.spot.toFixed(2)}</div>
                  <Badge variant={data.changePercent >= 0 ? "default" : "destructive"} className="text-[11px]">
                    {fmtPct(data.changePercent)}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  ATM <b className="text-foreground">{data.atmStrike}</b> · step {data.strikeStep}
                  {data.lotSize ? <> · lot {data.lotSize}</> : null}
                </div>
              </>
            )}

            <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
              <span className="px-2 py-0.5 rounded bg-green-500/15 text-green-400 border border-green-500/30">LIVE</span>
              {data && <span>{new Date(data.generatedAt).toLocaleTimeString()}</span>}
              <Button variant="ghost" size="sm" onClick={() => { setLoading(true); void load(); }} disabled={loading}>
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>

          {/* Expiry + strikes-around chips */}
          {data && (
            <div className="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t border-border">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] uppercase text-muted-foreground font-mono">Expiry:</span>
                {data.expiries.slice(0, 6).map(e => (
                  <button
                    key={e}
                    onClick={() => setExpiry(e)}
                    className={`px-2 py-0.5 text-[11px] font-mono rounded border transition ${
                      e === data.expiry
                        ? "border-primary bg-primary/15 text-primary font-bold"
                        : "border-border bg-card hover-row text-foreground/70"
                    }`}
                  >
                    {e}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap ml-auto">
                <span className="text-[10px] uppercase text-muted-foreground font-mono">Strikes ATM ±:</span>
                {(["atm", "5", "10", "20", "all"] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => setStrikesAround(s)}
                    className={`px-2 py-0.5 text-[11px] font-mono rounded border uppercase transition ${
                      s === strikesAround
                        ? "border-primary bg-primary/15 text-primary font-bold"
                        : "border-border bg-card hover-row text-foreground/70"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded p-3">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}

      {/*
        At-a-glance KPI strip — duplicates a couple of values shown in the
        header on purpose, so traders scanning the page get every key
        decision-input in one horizontal sweep without needing to look at
        three different cards. Tinted by sentiment / threshold so glance =
        signal.
      */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {(() => {
            const pcrTone = data.pcrOi >= 1.3 ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/10"
              : data.pcrOi <= 0.7 ? "text-rose-300 border-rose-500/30 bg-rose-500/10"
              : "text-foreground border-border bg-card";
            const painDist = data.spot - data.maxPain;
            const painPct = data.spot > 0 ? (painDist / data.spot) * 100 : 0;
            const painTone = Math.abs(painPct) < 0.3 ? "text-amber-300 border-amber-500/30 bg-amber-500/10"
              : "text-foreground border-border bg-card";
            const ivTone = data.atmIv != null && data.atmIv > 25 ? "text-rose-300 border-rose-500/30 bg-rose-500/10"
              : data.atmIv != null && data.atmIv < 12 ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/10"
              : "text-foreground border-border bg-card";
            const sentClass = `${sentTone.bg} ${sentTone.border}`;
            const Tile = ({ label, value, sub, cls }: { label: string; value: string; sub?: string; cls: string }) => (
              <div className={`rounded border px-3 py-2 ${cls}`}>
                <div className="text-[9px] uppercase tracking-wider font-mono opacity-80">{label}</div>
                <div className="text-lg font-bold tabular-nums">{value}</div>
                {sub && <div className="text-[10px] font-mono opacity-80">{sub}</div>}
              </div>
            );
            return (
              <>
                <Tile
                  label="PCR (OI)"
                  value={data.pcrOi.toFixed(2)}
                  sub={data.pcrOi >= 1.3 ? "bullish bias" : data.pcrOi <= 0.7 ? "bearish bias" : "neutral"}
                  cls={pcrTone}
                />
                <Tile
                  label="Max Pain"
                  value={String(data.maxPain)}
                  sub={`${painDist >= 0 ? "+" : ""}${painDist.toFixed(0)} from spot (${painPct >= 0 ? "+" : ""}${painPct.toFixed(2)}%)`}
                  cls={painTone}
                />
                <Tile
                  label="ATM IV"
                  value={data.atmIv != null ? `${data.atmIv.toFixed(1)}%` : "—"}
                  sub={data.atmIv != null ? (data.atmIv > 25 ? "elevated" : data.atmIv < 12 ? "subdued" : "normal") : undefined}
                  cls={ivTone}
                />
                <Tile
                  label="Sentiment"
                  value={data.sentiment.replace("_", " ")}
                  sub={`${data.sentimentScore >= 0 ? "+" : ""}${data.sentimentScore.toFixed(0)} score`}
                  cls={sentClass}
                />
              </>
            );
          })()}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
        {/* ── LEFT: Sentiment + Insight ─────────────────────────────────────── */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs uppercase font-mono tracking-wider flex items-center gap-2">
                <Activity className="w-3.5 h-3.5" /> Market Sentiment
                <span className="text-[9px] text-muted-foreground normal-case font-normal">(based on OI)</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {!data ? (
                <Skeleton className="h-44 w-full" />
              ) : (
                <SentimentGauge band={data.sentiment} score={data.sentimentScore} label={data.sentimentLabel} />
              )}
              {data && (
                <div className="mt-3 pt-3 border-t border-border space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">PCR (OI)</span>
                    <span className="font-mono font-bold">{data.pcrOi.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span
                      className="text-muted-foreground cursor-help underline decoration-dotted underline-offset-2"
                      title="Intraday flow polarity (-1..+1). Positive = puts being accumulated heavier than calls (bullish). Derived from Kite REST session-range OI proxy — for tick-level Δ OI, use the Delta Tracker tab."
                    >
                      Intraday Flow
                    </span>
                    <span className={`font-mono ${data.intradayFlow >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {data.intradayFlow >= 0 ? "+" : ""}{data.intradayFlow.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">PCR (Volume)</span>
                    <span className="font-mono">{data.pcrVolume.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Max Pain</span>
                    <span className="font-mono font-bold">{data.maxPain}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Pain Δ vs Spot</span>
                    <span className={`font-mono ${data.maxPainDeviation >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {data.maxPainDeviation >= 0 ? "+" : ""}{data.maxPainDeviation.toFixed(2)}%
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">ATM IV</span>
                    <span className="font-mono">{data.atmIv != null ? `${data.atmIv.toFixed(1)}%` : "—"}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {data && (
            <Card className={`${sentTone.bg} ${sentTone.border}`}>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center gap-2 text-xs uppercase font-mono tracking-wider" style={{ color: sentTone.color }}>
                  <Sparkles className="w-3.5 h-3.5" /> Market Insight
                </div>
                <p className="text-xs text-foreground/90 leading-relaxed">{data.marketInsight}</p>
              </CardContent>
            </Card>
          )}

          {data && (
            <Card>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center gap-2 text-xs uppercase font-mono tracking-wider text-muted-foreground">
                  <Target className="w-3.5 h-3.5" /> Analysis
                </div>
                <p className="text-xs text-foreground/85 leading-relaxed">{data.analysis}</p>
              </CardContent>
            </Card>
          )}

          {(() => {
            const atm = data?.strikes.find(s => s.isAtm);
            const hasGreeks = !!atm && (
              atm.ceDelta != null || atm.peDelta != null ||
              atm.ceTheta != null || atm.peTheta != null
            );
            if (!atm || !hasGreeks) return null;
            const fmt = (v: number | undefined | null, d = 3) =>
              v == null || !isFinite(v) ? "—" : v.toFixed(d);
            return (
              <Card>
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs uppercase font-mono tracking-wider text-muted-foreground">
                    <span className="flex items-center gap-2">
                      <Sparkles className="w-3.5 h-3.5" /> ATM Greeks
                    </span>
                    <span className="normal-case font-normal text-[10px]">Strike {atm.strike}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[11px] font-mono">
                    <div></div>
                    <div className="text-center text-red-400 font-bold">CE</div>
                    <div className="text-center text-green-400 font-bold">PE</div>

                    <div className="text-muted-foreground">Δ Delta</div>
                    <div className="text-right">{fmt(atm.ceDelta)}</div>
                    <div className="text-right">{fmt(atm.peDelta)}</div>

                    <div className="text-muted-foreground">Γ Gamma</div>
                    <div className="text-right">{fmt(atm.ceGamma, 4)}</div>
                    <div className="text-right">{fmt(atm.peGamma, 4)}</div>

                    <div className="text-muted-foreground">Θ Theta</div>
                    <div className="text-right text-red-400">{fmt(atm.ceTheta, 2)}</div>
                    <div className="text-right text-red-400">{fmt(atm.peTheta, 2)}</div>

                    <div className="text-muted-foreground">V Vega</div>
                    <div className="text-right">{fmt(atm.ceVega, 2)}</div>
                    <div className="text-right">{fmt(atm.peVega, 2)}</div>
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-snug pt-1 border-t border-border">
                    Theta is the rupee value lost per day (long options bleed time).
                  </p>
                </CardContent>
              </Card>
            );
          })()}
        </div>

        {/* ── RIGHT: Charts ────────────────────────────────────────────────── */}
        <div className="space-y-4">
          {/* Big chart card with view switcher */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Layers className="w-4 h-4" />
                  {(() => {
                    // Title text reads from tfResolved.mode (the same source
                    // the chart computes its bars from), so the title and
                    // the data cannot drift apart — even if the user picks
                    // "Last 5 min" before the buffer is warm.
                    const meta = TIMEFRAMES.find(t => t.v === timeframe)!;
                    const subForChange = (() => {
                      if (tfResolved.mode === "all") return "intraday Δ since 9:15 AM";
                      if (tfResolved.mode === "fallback_open")
                        return `${meta.l} requested · using since-open Δ until buffer fills`;
                      if (tfResolved.mode === "approx") return `~${meta.l} (approx baseline)`;
                      return meta.l; // exact
                    })();
                    if (chartView === "oi") {
                      return (
                        <>
                          Open Interest by Strike
                          {timeframe !== "all" && (
                            <span className={`text-[10px] font-mono font-normal ${tfResolved.mode === "exact" ? "text-muted-foreground" : "text-amber-300"}`}>
                              · ΔOI window: {subForChange}
                            </span>
                          )}
                        </>
                      );
                    }
                    if (chartView === "oichg") {
                      return (
                        <>
                          OI Change by Strike
                          <span className={`text-[10px] font-mono font-normal ${tfResolved.mode === "exact" || tfResolved.mode === "all" ? "text-muted-foreground" : "text-amber-300"}`}>
                            ({subForChange})
                          </span>
                        </>
                      );
                    }
                    if (chartView === "pcr") return "Put/Call Ratio by Strike";
                    return "Max Pain Curve";
                  })()}
                </CardTitle>
                <div className="flex items-center gap-1">
                  {([
                    { v: "oi",    l: "OI Total" },
                    { v: "oichg", l: "OI Change" },
                    { v: "pcr",   l: "PCR" },
                    { v: "pain",  l: "Max Pain" },
                  ] as const).map(b => (
                    <button
                      key={b.v}
                      onClick={() => setChartView(b.v)}
                      className={`px-2.5 py-1 text-[11px] font-mono rounded border transition ${
                        chartView === b.v
                          ? "border-primary bg-primary/15 text-primary font-bold"
                          : "border-border bg-card hover-row text-foreground/70"
                      }`}
                    >
                      {b.l}
                    </button>
                  ))}
                </div>
              </div>
              {/*
                Intraday timeframe pills — only relevant when the chart is
                actually showing OI Δ (the OI Change view, or the dotted ΔOI
                overlay rendered on top of OI Total). For PCR / Max Pain we
                hide the row entirely so the user isn't tempted to click a
                control that wouldn't change the chart.
              */}
              {(chartView === "oi" || chartView === "oichg") && (() => {
                const nowMs = data ? new Date(data.generatedAt).getTime() : Date.now();
                return (
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono mr-1">
                      Δ window
                    </span>
                    {TIMEFRAMES.map(t => {
                      const buf = data ? oiHistoryRef.current[`${data.underlying}|${data.expiry}`] ?? [] : [];
                      const oldestAge = buf.length > 0 ? nowMs - buf[0]!.ts : 0;
                      // A finite window has a usable baseline only once the
                      // buffer reaches back at least that far (otherwise we
                      // fall back to the "since you opened" mode and the
                      // pill renders as semi-active with a tooltip).
                      const haveBaseline = t.ms == null ? true : oldestAge >= t.ms * 0.8;
                      const isActive = timeframe === t.v;
                      const partial = !isActive && t.ms != null && !haveBaseline && buf.length >= 2;
                      const empty = t.ms != null && buf.length < 2;
                      const title = empty
                        ? `Need at least 2 buffered snapshots — currently have ${buf.length}. Buffer fills at ~30s cadence.`
                        : t.ms != null && !haveBaseline
                        ? `Buffer only goes back ${(oldestAge / 60_000).toFixed(1)} min — comparison will use the oldest snapshot we have.`
                        : t.ms == null
                        ? "Use broker's intraday Δ since 9:15 AM"
                        : `Compare current OI to a snapshot from ~${t.l.toLowerCase().replace("last ", "")} ago`;
                      return (
                        <button
                          key={t.v}
                          onClick={() => !empty && setTimeframe(t.v)}
                          disabled={empty}
                          title={title}
                          className={`px-2 py-0.5 text-[10px] font-mono rounded border transition ${
                            isActive
                              ? "border-amber-400 bg-amber-400/15 text-amber-300 font-bold"
                              : empty
                              ? "border-border/50 bg-card/40 text-muted-foreground/50 cursor-not-allowed"
                              : partial
                              ? "border-border bg-card text-muted-foreground hover-row"
                              : "border-border bg-card text-foreground/80 hover-row"
                          }`}
                        >
                          {t.l.replace("Last ", "")}
                        </button>
                      );
                    })}
                    {timeframe !== "all" && (
                      <span className="ml-2 text-[10px] font-mono">
                        {tfResolved.mode === "fallback_open" ? (
                          <span className="text-amber-400/90">
                            buffer warming up — falling back to broker since-open Δ
                          </span>
                        ) : tfResolved.baselineUsedAt ? (
                          <>
                            <span className="text-muted-foreground">
                              baseline: {new Date(tfResolved.baselineUsedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
                            </span>
                            {tfResolved.mode === "approx" && (
                              <span className="ml-1 text-amber-400/90">
                                (Δ vs nearest available, not exactly {TIMEFRAMES.find(t => t.v === timeframe)!.l.toLowerCase()})
                              </span>
                            )}
                            {(() => {
                              const missing = oiBars.filter(r => r.missingBaseline).length;
                              if (missing === 0) return null;
                              return (
                                <span className="ml-1 text-amber-400/90">
                                  · {missing} strike{missing === 1 ? "" : "s"} added mid-window (Δ shown as 0)
                                </span>
                              );
                            })()}
                          </>
                        ) : null}
                      </span>
                    )}
                  </div>
                );
              })()}
            </CardHeader>
            <CardContent>
              {!data ? (
                <Skeleton className="h-80 w-full" />
              ) : oiBars.length === 0 ? (
                <div className="h-80 flex flex-col items-center justify-center text-sm text-muted-foreground gap-2 px-6 text-center">
                  <AlertTriangle className="w-6 h-6 opacity-50" />
                  <div>No strikes returned by the broker for <b>{underlying}</b>{data?.expiry ? <> · expiry <b>{data.expiry}</b></> : null}.</div>
                  <div className="text-xs">
                    Likely causes:
                    <ul className="mt-1 space-y-0.5 text-left list-disc list-inside">
                      <li>Broker session has expired — re-connect from the Live Feed tab.</li>
                      <li>Selected expiry has no liquid strikes around the spot — pick a closer one above.</li>
                      <li>Underlying is illiquid in the F&amp;O segment — try NIFTY / BANKNIFTY / FINNIFTY first.</li>
                    </ul>
                  </div>
                </div>
              ) : (() => {
                // The broker returned strikes but every CE/PE OI value is zero.
                // Recharts would render an "empty" plot (axes + reference lines
                // but no visible bars) — surface that explicitly so the chart
                // doesn't look broken.
                const allZero =
                  (chartView === "oi"    && oiBars.every(r => (r.ceOi ?? 0) === 0 && (r.peOi ?? 0) === 0)) ||
                  (chartView === "oichg" && oiBars.every(r => (r.ceOiChg ?? 0) === 0 && (r.peOiChg ?? 0) === 0)) ||
                  (chartView === "pcr"   && oiBars.every(r => (r.pcr ?? 0) === 0)) ||
                  (chartView === "pain"  && oiBars.every(r => (r.pain ?? 0) === 0));
                if (allZero) {
                  const metricLabel =
                    chartView === "oichg" ? "intraday OI changes" :
                    chartView === "pcr"   ? "put/call ratios" :
                    chartView === "pain"  ? "pain values" :
                                            "open interest values";
                  return (
                    <div className="h-80 flex flex-col items-center justify-center text-sm text-muted-foreground gap-2 px-6 text-center">
                      <AlertTriangle className="w-6 h-6 opacity-50" />
                      <div>Strikes loaded for <b>{underlying}</b>, but all {metricLabel} in this view are zero.</div>
                      <div className="text-xs">
                        This usually means the broker hasn't published this metric for this expiry yet
                        (newly listed contract, weekend snapshot, or session just opened).
                        Try a nearer expiry, switch the chart view above, or check back in a few minutes.
                      </div>
                    </div>
                  );
                }
                // Snap reference lines to a real X-axis category (string label)
                // — Recharts categorical XAxis only renders ReferenceLines whose
                // `x` matches a tick value exactly.
                const closestStrike = oiBars.reduce((closest, r) =>
                  Math.abs(r.strike - data.spot) < Math.abs(closest - data.spot) ? r.strike : closest,
                  oiBars[0]!.strike,
                );
                const spotLabel = String(closestStrike);
                // Tolerant match: a tiny floating-point drift in strike values
                // shouldn't suppress the Max Pain reference line. Snap to the
                // nearest strike within half a strike-step.
                const maxPainNearest = oiBars.reduce((closest, r) =>
                  Math.abs(r.strike - data.maxPain) < Math.abs(closest - data.maxPain) ? r.strike : closest,
                  oiBars[0]!.strike,
                );
                const halfStep = (data.strikeStep ?? 50) / 2;
                const maxPainLabel = Math.abs(maxPainNearest - data.maxPain) <= halfStep
                  ? String(maxPainNearest) : null;
                return (
                <ResponsiveContainer width="100%" height={360}>
                  {/*
                    ComposedChart so the OI view can overlay dotted ΔOI lines
                    on top of the Total OI bars (same scale — both are OI
                    contract counts). Other views (oichg / pcr / pain) keep the
                    same single-metric bar behavior they had before.
                  */}
                  <ComposedChart data={oiBars} barCategoryGap={2} margin={{ top: 16, right: 16, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                    <XAxis
                      dataKey="strikeLabel"
                      type="category"
                      tick={{ fontSize: 10 }}
                      interval={oiBars.length > 25 ? 1 : 0}
                    />
                    <YAxis
                      width={64}
                      tick={{ fontSize: 10 }}
                      tickFormatter={chartView === "pcr" ? (v) => v.toFixed(2) : (v) => fmtNum(v)}
                      // For "oi" view we now overlay ΔOI lines that go negative
                      // when contracts unwind, so the axis must auto-extend
                      // below zero (otherwise negative ΔOI gets clipped at the
                      // baseline and reads as flat).
                      domain={
                        chartView === "oichg" || chartView === "oi"
                          ? ["auto", "auto"]
                          : [0, "auto"]
                      }
                      allowDataOverflow={false}
                    />
                    <RTooltip
                      cursor={{ fill: "rgba(255,255,255,0.04)" }}
                      // Custom tooltip — shows full per-strike OI breakdown:
                      // open OI (9:15 AM), intraday change, current OI for both
                      // Call and Put, plus view-specific extras (PCR / Pain).
                      // Open OI is computed inline as currentOi - intradayΔ.
                      content={
                        <OiInsightsTooltip
                          view={chartView}
                          nowTime={new Date(data.generatedAt).toLocaleTimeString("en-IN", {
                            hour: "numeric",
                            minute: "2-digit",
                            hour12: true,
                            timeZone: "Asia/Kolkata",
                          })}
                          tfMode={tfResolved.mode}
                          tfWindowLabel={TIMEFRAMES.find(t => t.v === timeframe)!.l}
                          tfBaselineTime={
                            tfResolved.baselineUsedAt
                              ? new Date(tfResolved.baselineUsedAt).toLocaleTimeString("en-IN", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                  second: "2-digit",
                                  hour12: false,
                                  timeZone: "Asia/Kolkata",
                                })
                              : null
                          }
                        />
                      }
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {/* Spot reference line */}
                    <ReferenceLine
                      x={spotLabel}
                      stroke="#22c55e"
                      strokeDasharray="2 2"
                      label={{ value: `Spot ${data.spot.toFixed(0)}`, position: "top", fill: "#22c55e", fontSize: 10 }}
                    />
                    {/* Max-pain reference line — only render when it lines up with a real strike */}
                    {maxPainLabel && (
                      <ReferenceLine
                        x={maxPainLabel}
                        stroke="#f97316"
                        strokeDasharray="4 2"
                        label={{ value: `Max Pain ${data.maxPain}`, position: "insideTopRight", fill: "#f97316", fontSize: 10 }}
                      />
                    )}
                    {/*
                      Each chart series MUST be a direct child of the chart —
                      Recharts walks `props.children` to discover Bar/Line
                      components, and a surrounding <>…</> Fragment hides them
                      from that walk. Symptom (production): bars and Y-axis
                      ticks vanish while reference lines and X-axis labels
                      still render. So every conditional below is a single
                      inline expression returning a series element or false.
                    */}
                    {chartView === "oi" && <Bar dataKey="ceOi" fill="#dc2626" name="Call OI" />}
                    {chartView === "oi" && <Bar dataKey="peOi" fill="#16a34a" name="Put OI" />}
                    {/* Zero baseline so positive vs negative ΔOI is unambiguous */}
                    {chartView === "oi" && (
                      <ReferenceLine y={0} stroke="#52525b" strokeWidth={1} />
                    )}
                    {/* Dotted overlay: ΔOI on the same axis as Total OI */}
                    {chartView === "oi" && (
                      <Line
                        type="monotone"
                        dataKey="ceOiChg"
                        name="Δ Call OI"
                        stroke="#fca5a5"
                        strokeWidth={1.5}
                        strokeDasharray="4 3"
                        dot={false}
                        activeDot={{ r: 3 }}
                        isAnimationActive={false}
                      />
                    )}
                    {chartView === "oi" && (
                      <Line
                        type="monotone"
                        dataKey="peOiChg"
                        name="Δ Put OI"
                        stroke="#86efac"
                        strokeWidth={1.5}
                        strokeDasharray="4 3"
                        dot={false}
                        activeDot={{ r: 3 }}
                        isAnimationActive={false}
                      />
                    )}
                    {chartView === "oichg" && (
                      <Bar dataKey="ceOiChg" name="Δ Call OI">
                        {oiBars.map((d, i) => (
                          <Cell key={i} fill={d.ceOiChg >= 0 ? "#dc2626" : "#fca5a5"} />
                        ))}
                      </Bar>
                    )}
                    {chartView === "oichg" && (
                      <Bar dataKey="peOiChg" name="Δ Put OI">
                        {oiBars.map((d, i) => (
                          <Cell key={i} fill={d.peOiChg >= 0 ? "#16a34a" : "#86efac"} />
                        ))}
                      </Bar>
                    )}
                    {chartView === "pcr" && (
                      // dataKey is `pcrCapped` (capped at 3) so high-strike
                      // bars are visible at a meaningful scale; cell color
                      // and tooltip continue to read the true `pcr`.
                      <Bar dataKey="pcrCapped" name="PCR">
                        {oiBars.map((d, i) => (
                          <Cell key={i} fill={d.pcr >= 1.3 ? "#16a34a" : d.pcr <= 0.7 ? "#dc2626" : "#a3a3a3"} />
                        ))}
                      </Bar>
                    )}
                    {chartView === "pain" && (
                      <Bar dataKey="pain" name="Pain">
                        {oiBars.map((d, i) => (
                          // Float-tolerant match — `data.maxPain` can drift by
                          // a fraction of a strike-step due to upstream math,
                          // so a strict `===` would silently fail to highlight
                          // the actual max-pain bar even when the reference
                          // line snaps correctly.
                          <Cell
                            key={i}
                            fill={Math.abs(d.strike - data.maxPain) <= halfStep ? "#f97316" : "#525252"}
                          />
                        ))}
                      </Bar>
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
                );
              })()}
            </CardContent>
          </Card>

          {/* Bottom strip: 3 small cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* OI Change — windowed to match the timeframe pill above the
                main chart. In "all" / "fallback_open" mode this is the
                broker since-open Δ; in "exact" / "approx" mode it's the
                sum of per-strike windowed Δ over the visible strike set,
                so card and chart can never disagree. */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs uppercase font-mono flex items-center gap-1.5 justify-between">
                  <span className="flex items-center gap-1.5">
                    <TrendingUp className="w-3.5 h-3.5" /> Open Interest Change
                  </span>
                  {data && (
                    <span className="text-[9px] normal-case font-normal text-muted-foreground">
                      {tfResolved.mode === "all" || tfResolved.mode === "fallback_open"
                        ? "since 9:15"
                        : `last ${TIMEFRAMES.find(t => t.v === timeframe)!.l.replace(/^Last\s+/i, "")}`}
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!data ? <Skeleton className="h-32" /> : (
                  <ResponsiveContainer width="100%" height={140}>
                    {/*
                      Two separate Bar series (one Call, one Put) keyed off the
                      same single-row dataset so the tooltip naturally shows
                      BOTH values together on hover with proper "Call ΔOI" /
                      "Put ΔOI" labels — instead of a generic "value : N" entry
                      that doesn't tell you which side the number belongs to.
                    */}
                    <BarChart data={[{ name: "OI Δ", call: windowedTotals.call, put: windowedTotals.put }]}>
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                      <YAxis hide />
                      <RTooltip
                        contentStyle={{ background: "#0a0a0a", border: "1px solid #27272a", borderRadius: 4, fontSize: 11, padding: "6px 10px" }}
                        labelStyle={{ color: "#fafafa", fontWeight: 600, marginBottom: 4 }}
                        itemStyle={{ color: "#e4e4e7", padding: 0, lineHeight: 1.6 }}
                        cursor={{ fill: "rgba(255,255,255,0.04)" }}
                        formatter={(v: number, name: string) => [fmtNum(v), name]}
                        labelFormatter={() =>
                          tfResolved.mode === "all" || tfResolved.mode === "fallback_open"
                            ? "Intraday change (since 9:15)"
                            : `Change in last ${TIMEFRAMES.find(t => t.v === timeframe)!.l.replace(/^Last\s+/i, "")}`
                        }
                      />
                      <Bar dataKey="call" name="Call ΔOI" radius={[4, 4, 0, 0]}
                        fill={windowedTotals.call >= 0 ? "#dc2626" : "#fca5a5"} />
                      <Bar dataKey="put" name="Put ΔOI" radius={[4, 4, 0, 0]}
                        fill={windowedTotals.put >= 0 ? "#16a34a" : "#86efac"} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
                {data && (
                  <>
                    <div className="flex justify-between text-[10px] font-mono mt-1">
                      <span className={windowedTotals.call >= 0 ? "text-red-400" : "text-red-300"}>CALL {fmtNum(windowedTotals.call)}</span>
                      <span className={windowedTotals.put  >= 0 ? "text-green-400" : "text-green-300"}>PUT {fmtNum(windowedTotals.put)}</span>
                    </div>
                    {(tfResolved.mode === "exact" || tfResolved.mode === "approx") && windowedTotals.missing > 0 && (
                      <div className="text-[9px] font-mono mt-0.5 text-amber-300/80 leading-tight">
                        {windowedTotals.missing} strike{windowedTotals.missing === 1 ? "" : "s"} excluded (no baseline yet)
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            {/* Total OI */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs uppercase font-mono flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5" /> Total Open Interest
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!data ? <Skeleton className="h-32" /> : (
                  <ResponsiveContainer width="100%" height={140}>
                    <BarChart data={[{ name: "Total OI", call: data.totalCallOi, put: data.totalPutOi }]}>
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                      <YAxis hide />
                      <RTooltip
                        contentStyle={{ background: "#0a0a0a", border: "1px solid #27272a", borderRadius: 4, fontSize: 11, padding: "6px 10px" }}
                        labelStyle={{ color: "#fafafa", fontWeight: 600, marginBottom: 4 }}
                        itemStyle={{ color: "#e4e4e7", padding: 0, lineHeight: 1.6 }}
                        cursor={{ fill: "rgba(255,255,255,0.04)" }}
                        formatter={(v: number, name: string) => [fmtNum(v), name]}
                        labelFormatter={() => "Outstanding OI"}
                      />
                      <Bar dataKey="call" name="Call OI" radius={[4, 4, 0, 0]} fill="#dc2626" />
                      <Bar dataKey="put"  name="Put OI"  radius={[4, 4, 0, 0]} fill="#16a34a" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
                {data && (
                  // Below each total, show the signed Δ for the active
                  // timeframe (since-open in "all"/"fallback_open" mode,
                  // window Δ in "exact"/"approx" mode) so this card stays
                  // consistent with the chart and the OI Change card.
                  // Δ color is purely sign-based: green = OI added,
                  // red = OI shed.
                  <div className="flex justify-between text-[10px] font-mono mt-1">
                    <div className="flex flex-col">
                      <span className="text-red-400">CALL {fmtNum(data.totalCallOi)}</span>
                      <span className={
                        !Number.isFinite(windowedTotals.call) || windowedTotals.call === 0 ? "text-zinc-500"
                          : windowedTotals.call > 0 ? "text-emerald-400" : "text-rose-400"
                      }>
                        Δ {Number.isFinite(windowedTotals.call) && windowedTotals.call > 0 ? "+" : ""}{fmtNum(windowedTotals.call)}
                      </span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-green-400">PUT {fmtNum(data.totalPutOi)}</span>
                      <span className={
                        !Number.isFinite(windowedTotals.put) || windowedTotals.put === 0 ? "text-zinc-500"
                          : windowedTotals.put > 0 ? "text-emerald-400" : "text-rose-400"
                      }>
                        Δ {Number.isFinite(windowedTotals.put) && windowedTotals.put > 0 ? "+" : ""}{fmtNum(windowedTotals.put)}
                      </span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* PCR donut */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs uppercase font-mono flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5" /> Put/Call Ratio
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!data || pcrPie.length === 0 ? <Skeleton className="h-32" /> : (
                  <div className="relative h-[140px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pcrPie}
                          dataKey="value"
                          innerRadius={38}
                          outerRadius={60}
                          startAngle={90}
                          endAngle={-270}
                          stroke="none"
                        >
                          <Cell fill="#fca5a5" />
                          <Cell fill="#86efac" />
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <div className="text-[10px] uppercase text-muted-foreground font-mono">PCR</div>
                      <div className="text-2xl font-bold tabular-nums">{data.pcrOi.toFixed(2)}</div>
                    </div>
                  </div>
                )}
                {data && pcrPie.length > 0 && (
                  <div className="flex justify-between text-[10px] font-mono mt-1">
                    <span className="text-red-400">{pcrPie[1]!.pct.toFixed(0)}% Call OI</span>
                    <span className="text-green-400">{pcrPie[0]!.pct.toFixed(0)}% Put OI</span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Top R / S strip */}
          {data && (
            <Card>
              <CardContent className="p-3 grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[10px] uppercase font-mono text-muted-foreground mb-1.5">Top Resistance (Call OI)</div>
                  <div className="flex flex-wrap gap-1.5">
                    {data.topResistance.map(r => (
                      <span key={r.strike} className="px-2 py-0.5 text-[11px] font-mono rounded bg-red-500/15 text-red-300 border border-red-500/30">
                        {r.strike} <span className="text-[9px] text-muted-foreground">{fmtNum(r.oi)}</span>
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase font-mono text-muted-foreground mb-1.5">Top Support (Put OI)</div>
                  <div className="flex flex-wrap gap-1.5">
                    {data.topSupport.map(r => (
                      <span key={r.strike} className="px-2 py-0.5 text-[11px] font-mono rounded bg-green-500/15 text-green-300 border border-green-500/30">
                        {r.strike} <span className="text-[9px] text-muted-foreground">{fmtNum(r.oi)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

// Half-donut sentiment gauge — pure SVG, no extra deps.
function SentimentGauge({ band, score, label }: { band: SentimentBand; score: number; label: string }) {
  const tone = SENTIMENT_TONE[band];
  // Map score (-100..+100) to angle (180..0)
  const angle = 180 - ((score + 100) / 200) * 180;
  const cx = 90, cy = 90, r = 70;
  const rad = (angle * Math.PI) / 180;
  const needleX = cx + r * Math.cos(rad);
  const needleY = cy - r * Math.sin(rad);
  // Arc segments — 5 bands
  const bands: Array<{ from: number; to: number; color: string }> = [
    { from: 180, to: 144, color: "#dc2626" },
    { from: 144, to: 108, color: "#f97316" },
    { from: 108, to: 72,  color: "#a3a3a3" },
    { from:  72, to: 36,  color: "#84cc16" },
    { from:  36, to:  0,  color: "#16a34a" },
  ];
  function arcPath(fromDeg: number, toDeg: number): string {
    const f = (fromDeg * Math.PI) / 180;
    const t = (toDeg * Math.PI) / 180;
    const x1 = cx + r * Math.cos(f), y1 = cy - r * Math.sin(f);
    const x2 = cx + r * Math.cos(t), y2 = cy - r * Math.sin(t);
    const large = Math.abs(fromDeg - toDeg) > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  }
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 180 110" className="w-full max-w-[220px]">
        {bands.map((b, i) => (
          <path key={i} d={arcPath(b.from, b.to)} stroke={b.color} strokeWidth="14" fill="none" strokeLinecap="butt" opacity={band === ["STRONGLY_BEARISH", "MILDLY_BEARISH", "NEUTRAL", "MILDLY_BULLISH", "STRONGLY_BULLISH"][i] ? 1 : 0.35} />
        ))}
        <line x1={cx} y1={cy} x2={needleX} y2={needleY} stroke={tone.color} strokeWidth="2.5" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="4" fill={tone.color} />
      </svg>
      <div className="text-center -mt-2">
        <div className="text-base font-bold" style={{ color: tone.color }}>{label}</div>
        <div className="text-[10px] text-muted-foreground font-mono">
          score {score >= 0 ? "+" : ""}{score} / ±100
        </div>
      </div>
    </div>
  );
}
