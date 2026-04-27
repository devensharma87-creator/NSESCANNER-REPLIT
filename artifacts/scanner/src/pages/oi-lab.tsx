import { useEffect, useMemo, useState } from "react";
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
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-muted-foreground border-b">
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
              <div>
                <div className="text-xs font-medium mb-1 flex items-center gap-2">
                  <TrendingUp className="w-3 h-3" /> Spot vs Max Pain — {chartUnderlying}
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
                    <RTooltip contentStyle={{ background: "#0a0a0a", border: "1px solid #27272a", fontSize: 11 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="spot" stroke="#22c55e" strokeWidth={2} dot={false} name="Spot" />
                    <Line type="monotone" dataKey="maxPain" stroke="#f97316" strokeWidth={1} strokeDasharray="4 4" dot={false} name="Max Pain" />
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
                    <RTooltip contentStyle={{ background: "#0a0a0a", border: "1px solid #27272a", fontSize: 11 }} />
                    <ReferenceLine y={1} stroke="#71717a" strokeDasharray="3 3" label={{ value: "Neutral 1.0", fill: "#71717a", fontSize: 10 }} />
                    <Line type="monotone" dataKey="pcrOi" stroke="#a855f7" strokeWidth={2} dot={{ r: 2 }} />
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
                      formatter={(v: number) => fmtNum(v)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="callOi" stroke="#ef4444" strokeWidth={2} dot={false} name="Call OI" />
                    <Line type="monotone" dataKey="putOi" stroke="#22c55e" strokeWidth={2} dot={false} name="Put OI" />
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
                      formatter={(v: number) => fmtNum(v)}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <ReferenceLine y={0} stroke="#71717a" strokeDasharray="3 3" />
                    <Line type="monotone" dataKey="callOiAdded" stroke="#ef4444" strokeWidth={1.5} dot={false} name="CE OI added" />
                    <Line type="monotone" dataKey="putOiAdded"  stroke="#22c55e" strokeWidth={1.5} dot={false} name="PE OI added" />
                    <Line type="monotone" dataKey="netFlow"     stroke="#a855f7" strokeWidth={2}   dot={{ r: 2 }} name="Net flow (PE−CE)" />
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
  payload?: Array<{ payload: OiBarRow }>;
  label?: string | number;
  view: "oi" | "oichg" | "pcr" | "pain";
  nowTime: string;
}) {
  const { active, payload, label, view, nowTime } = props;
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  if (!row) return null;

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
        <Row label="Put OI at 9:15 AM" value={fmtNum(openPe)} dotClass="bg-emerald-500" />
        <Row label="Put OI chg"        value={fmtSigned(row.peOiChg)} valueClass={`font-mono tabular-nums ${sign(row.peOiChg)}`} dotClass="bg-emerald-500/60" />
        <Row label={`Put OI at ${nowTime}`} value={fmtNum(row.peOi)} dotClass="bg-emerald-500" />
      </div>

      <div className="h-px bg-zinc-800 my-1.5" />

      {/* Call block — red */}
      <div className="space-y-0">
        <Row label="Call OI at 9:15 AM" value={fmtNum(openCe)} dotClass="bg-rose-500" />
        {/*
          Color the change row purely by the sign of the number:
          negative = red (OI shed), positive = green (OI added),
          zero = neutral. We deliberately do NOT invert for the Call leg —
          the user wants a literal "negative number → red" reading
          everywhere in the OI change rows.
        */}
        <Row label="Call OI chg"        value={fmtSigned(row.ceOiChg)} valueClass={`font-mono tabular-nums ${sign(row.ceOiChg)}`} dotClass="bg-rose-500/60" />
        <Row label={`Call OI at ${nowTime}`} value={fmtNum(row.ceOi)} dotClass="bg-rose-500" />
      </div>

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

  // Load universe once
  useEffect(() => {
    fetch(`${base}api/options/oi-lab/universe`, { credentials: "include" })
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(setUniverse)
      .catch(() => {});
  }, []);

  // Load insights — re-fetches on underlying / expiry / strikes change + every 30s
  const load = async () => {
    setError(null);
    try {
      const qs = new URLSearchParams();
      qs.set("strikes", strikesAround);
      if (expiry) qs.set("expiry", expiry);
      const r = await fetch(`${base}api/options/oi-lab/insights/${encodeURIComponent(underlying)}?${qs}`, { credentials: "include" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || j.error || r.statusText);
      setData(j);
    } catch (e) {
      setError((e as Error).message);
      setData(null);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    setLoading(true);
    void load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [underlying, expiry, strikesAround]);

  // Reset expiry when underlying changes (re-pick nearest)
  useEffect(() => { setExpiry(undefined); }, [underlying]);

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
  const oiBars = useMemo(() => {
    if (!data) return [];
    return data.strikes.map(s => ({
      strike: num(s.strike),
      // strikeLabel forces a stable string category on the X axis — Recharts'
      // categorical scale gets confused when numeric `strike` values look like
      // a continuous scale, which (combined with the Fragment-wrapped Bars
      // below) sometimes drops every bar from the plot.
      strikeLabel: String(s.strike),
      ceOi: num(s.ceOi),
      peOi: num(s.peOi),
      ceOiChg: num(s.ceOiChg),
      peOiChg: num(s.peOiChg),
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
    }));
  }, [data]);
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
                  {chartView === "oi" && "Open Interest by Strike"}
                  {chartView === "oichg" && "OI Change by Strike (intraday Δ)"}
                  {chartView === "pcr" && "Put/Call Ratio by Strike"}
                  {chartView === "pain" && "Max Pain Curve"}
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
            {/* OI Change */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs uppercase font-mono flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5" /> Open Interest Change
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
                    <BarChart data={[{ name: "OI Δ", call: data.callOiAdded, put: data.putOiAdded }]}>
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                      <YAxis hide />
                      <RTooltip
                        contentStyle={{ background: "#0a0a0a", border: "1px solid #27272a", borderRadius: 4, fontSize: 11, padding: "6px 10px" }}
                        labelStyle={{ color: "#fafafa", fontWeight: 600, marginBottom: 4 }}
                        itemStyle={{ color: "#e4e4e7", padding: 0, lineHeight: 1.6 }}
                        cursor={{ fill: "rgba(255,255,255,0.04)" }}
                        formatter={(v: number, name: string) => [fmtNum(v), name]}
                        labelFormatter={() => "Intraday change"}
                      />
                      <Bar dataKey="call" name="Call ΔOI" radius={[4, 4, 0, 0]}
                        fill={data.callOiAdded >= 0 ? "#dc2626" : "#fca5a5"} />
                      <Bar dataKey="put" name="Put ΔOI" radius={[4, 4, 0, 0]}
                        fill={data.putOiAdded >= 0 ? "#16a34a" : "#86efac"} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
                {data && (
                  <div className="flex justify-between text-[10px] font-mono mt-1">
                    <span className={data.callOiAdded >= 0 ? "text-red-400" : "text-red-300"}>CALL {fmtNum(data.callOiAdded)}</span>
                    <span className={data.putOiAdded  >= 0 ? "text-green-400" : "text-green-300"}>PUT {fmtNum(data.putOiAdded)}</span>
                  </div>
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
                  // Below each total, show the signed intraday Δ so the user
                  // can read the absolute outstanding OI AND how much of it
                  // was added/shed today, in one glance — without having to
                  // cross-reference the OI Change card. Δ color is purely
                  // sign-based: green = OI added, red = OI shed.
                  <div className="flex justify-between text-[10px] font-mono mt-1">
                    <div className="flex flex-col">
                      <span className="text-red-400">CALL {fmtNum(data.totalCallOi)}</span>
                      <span className={
                        !Number.isFinite(data.callOiAdded) || data.callOiAdded === 0 ? "text-zinc-500"
                          : data.callOiAdded > 0 ? "text-emerald-400" : "text-rose-400"
                      }>
                        Δ {Number.isFinite(data.callOiAdded) && data.callOiAdded > 0 ? "+" : ""}{fmtNum(data.callOiAdded)}
                      </span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-green-400">PUT {fmtNum(data.totalPutOi)}</span>
                      <span className={
                        !Number.isFinite(data.putOiAdded) || data.putOiAdded === 0 ? "text-zinc-500"
                          : data.putOiAdded > 0 ? "text-emerald-400" : "text-rose-400"
                      }>
                        Δ {Number.isFinite(data.putOiAdded) && data.putOiAdded > 0 ? "+" : ""}{fmtNum(data.putOiAdded)}
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
