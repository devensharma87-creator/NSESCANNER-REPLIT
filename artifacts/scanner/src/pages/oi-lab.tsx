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
} from "recharts";
import { Download, Play, Square, RefreshCw, AlertTriangle, TrendingUp, TrendingDown, Activity, Layers } from "lucide-react";

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
  if (Math.abs(n) >= 1e3) return n.toLocaleString("en-IN");
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

      <Tabs defaultValue="snapshot" className="space-y-4">
        <TabsList>
          <TabsTrigger value="snapshot"><Download className="w-4 h-4 mr-2" />Bulk Snapshot</TabsTrigger>
          <TabsTrigger value="heatmap"><Layers className="w-4 h-4 mr-2" />OI Heatmap</TabsTrigger>
          <TabsTrigger value="tracker"><Activity className="w-4 h-4 mr-2" />Delta Tracker</TabsTrigger>
        </TabsList>

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
                        <td className="py-2 pr-3 text-right">{it.spot?.toFixed(2)}</td>
                        <td className={`py-2 pr-3 text-right ${(it.changePercent ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}>{fmtPct(it.changePercent)}</td>
                        <td className="py-2 pr-3 text-right">{it.atmStrike}</td>
                        <td className="py-2 pr-3 text-right">{it.maxPain}</td>
                        <td className="py-2 pr-3 text-right font-medium">{it.pcrOi?.toFixed(2)}</td>
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
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
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
                        <td className="py-1.5 pr-3 text-right">{r.ltp.toFixed(2)}</td>
                        <td className={`py-1.5 pr-3 text-right ${r.priceChgPct >= 0 ? "text-green-400" : "text-red-400"}`}>
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
              <Label className="text-xs">Interval (minutes)</Label>
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
          {trackedSymbols.length > 0 && (
            <Select value={chartUnderlying} onValueChange={setChartUnderlying}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                {trackedSymbols.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
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
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
