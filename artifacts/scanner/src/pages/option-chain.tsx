import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useLocation } from "wouter";
import {
  useGetOptionChain,
  useGetOptionAnalytics,
  getGetOptionChainQueryKey,
  getGetOptionAnalyticsQueryKey,
  type OptionChainStrikeRow,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Activity, Target, Search, ChevronDown, ChevronUp } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  FNO_ALL,
  QUICK_PRESETS,
  groupBySector,
  findFno,
  type FnoEntry,
} from "@/data/fnoUniverse";

function fmt(n: number | null | undefined, dp = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
function fmtInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-IN");
}
function fmtKL(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e7) return `${(n / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `${(n / 1e5).toFixed(2)}L`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return `${n}`;
}
function buildupTone(b: string | undefined): string {
  switch (b) {
    case "LONG_BUILDUP":   return "bg-signal-strong-buy/20 text-signal-strong-buy";
    case "SHORT_COVERING": return "bg-signal-buy/15 text-signal-buy";
    case "SHORT_BUILDUP":  return "bg-signal-strong-sell/20 text-signal-strong-sell";
    case "LONG_UNWINDING": return "bg-signal-sell/15 text-signal-sell";
    default:               return "bg-secondary/40 text-muted-foreground";
  }
}
function buildupShort(b: string | undefined): string {
  switch (b) {
    case "LONG_BUILDUP":   return "LB";
    case "SHORT_COVERING": return "SC";
    case "SHORT_BUILDUP":  return "SB";
    case "LONG_UNWINDING": return "LU";
    default:               return "—";
  }
}
function fmtGreek(n: number | null | undefined, dp = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(dp);
}

export default function OptionChainPage() {
  const params = useParams<{ underlying?: string }>();
  const [, setLocation] = useLocation();
  const underlying = (params.underlying ?? "NIFTY").toUpperCase();
  const [expiry, setExpiry] = useState<string | undefined>(undefined);

  // Reset expiry when underlying changes so we re-fetch the nearest one
  useEffect(() => { setExpiry(undefined); }, [underlying]);

  const chainParams = expiry ? { expiry } : undefined;
  const chainQ = useGetOptionChain(
    underlying,
    chainParams,
    { query: {
        // 60s (was 30s) — Greeks computation + IV solve adds CPU load on every
        // tick, and the human eye can't read changes faster than this anyway.
        refetchInterval: 60_000,
        // Pause polling while the user has switched to another browser tab so
        // we're not burning Kite quota and CPU on a hidden chart.
        refetchIntervalInBackground: false,
        retry: 0,
        queryKey: getGetOptionChainQueryKey(underlying, chainParams),
      } },
  );
  const analyticsQ = useGetOptionAnalytics(
    underlying,
    chainParams,
    { query: {
        refetchInterval: 60_000,
        refetchIntervalInBackground: false,
        retry: 0,
        queryKey: getGetOptionAnalyticsQueryKey(underlying, chainParams),
      } },
  );

  const chain = chainQ.data;
  const analytics = analyticsQ.data;
  const [showGreeks, setShowGreeks] = useState(false);

  const maxOi = useMemo(() => {
    if (!chain) return 0;
    let m = 0;
    for (const r of chain.rows) {
      if (r.ce?.oi && r.ce.oi > m) m = r.ce.oi;
      if (r.pe?.oi && r.pe.oi > m) m = r.pe.oi;
    }
    return m;
  }, [chain]);

  const status: "loading" | "error" | "ready" =
    chain ? "ready"
      : chainQ.isError || chainQ.isFetched ? "error"
      : "loading";

  // ── Picker state ────────────────────────────────────────────────
  const currentEntry = findFno(underlying);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Close picker when clicking outside or pressing Esc
  useEffect(() => {
    if (!pickerOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { setPickerOpen(false); setSearchQ(""); }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pickerOpen]);

  const filteredEntries = useMemo<FnoEntry[]>(() => {
    const q = searchQ.trim().toUpperCase();
    if (!q) return FNO_ALL;
    return FNO_ALL.filter(
      e => e.sym.includes(q) || e.label.toUpperCase().includes(q) || e.sector.toUpperCase().includes(q),
    );
  }, [searchQ]);

  const groupedEntries = useMemo(() => groupBySector(filteredEntries), [filteredEntries]);

  function go(sym: string) {
    setLocation(`/option-chain/${sym}`);
    setPickerOpen(false);
    setSearchQ("");
  }

  return (
    <div className="w-full px-4 py-4 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-end gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight font-mono">
            Option Chain
            <span className="ml-3 px-2 py-0.5 text-[11px] rounded border border-primary/40 bg-primary/10 text-primary uppercase tracking-wider">
              {currentEntry?.kind ?? "—"}
            </span>
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Live NSE OI for <b className="text-foreground/90 font-mono">{currentEntry?.label ?? underlying}</b>
            {currentEntry?.sector ? <> · <span className="text-foreground/70">{currentEntry.sector}</span></> : null}
            {" · "}auto-refresh 30s · OI per strike (CE left, PE right) · ATM highlighted
          </p>
        </div>

        {/* Search picker trigger */}
        <div className="relative w-full sm:w-[340px]">
          <button
            onClick={() => { setPickerOpen(o => !o); setTimeout(() => searchRef.current?.focus(), 30); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-mono rounded border border-border bg-card hover-row text-left"
          >
            <Search className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="flex-1 text-foreground/80 truncate">
              Search any of <b className="text-primary">{FNO_ALL.length}</b> F&amp;O underlyings…
            </span>
            {pickerOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          {pickerOpen && (
            <div className="absolute z-50 right-0 mt-1.5 w-[min(640px,95vw)] max-h-[70vh] overflow-y-auto rounded-md border border-border bg-popover shadow-2xl">
              <div className="sticky top-0 bg-popover border-b border-border p-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2 top-1/2 -translate-y-1/2" />
                  <input
                    ref={searchRef}
                    value={searchQ}
                    onChange={e => setSearchQ(e.target.value)}
                    placeholder="Type symbol, name or sector (e.g. RELIANCE / banking / pharma)…"
                    className="w-full pl-7 pr-2 py-1.5 text-xs font-mono bg-background border border-border rounded focus:outline-none focus:border-primary"
                  />
                </div>
                <div className="text-[10px] text-muted-foreground font-mono mt-1.5 uppercase">
                  {filteredEntries.length} results · ESC to close
                </div>
              </div>

              <div className="p-2 space-y-3">
                {groupedEntries.map(([sector, entries]) => (
                  <div key={sector}>
                    <div className="text-[10px] uppercase font-mono text-muted-foreground/80 px-1 mb-1 sticky top-[46px]">
                      {sector} <span className="text-muted-foreground/50">· {entries.length}</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
                      {entries.map(e => (
                        <button
                          key={e.sym}
                          onClick={() => go(e.sym)}
                          className={`text-left px-2 py-1.5 rounded text-[11px] font-mono border transition-colors ${
                            underlying === e.sym
                              ? "border-primary bg-primary/15 text-primary"
                              : "border-transparent hover:border-border hover-row text-foreground/85"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-bold truncate">{e.sym}</span>
                            <span className={`text-[9px] px-1 rounded ${e.kind === "INDEX" ? "bg-primary/15 text-primary" : "bg-secondary/40 text-muted-foreground"}`}>
                              {e.kind === "INDEX" ? "IDX" : "EQ"}
                            </span>
                          </div>
                          <div className="text-[10px] text-muted-foreground truncate">{e.label}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {filteredEntries.length === 0 && (
                  <div className="text-xs text-muted-foreground font-mono text-center py-6">
                    No F&amp;O underlying matches "{searchQ}".
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Quick presets row */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase font-mono text-muted-foreground mr-1">Quick:</span>
        {QUICK_PRESETS.map(p => (
          <button
            key={p.sym}
            onClick={() => go(p.sym)}
            className={`px-2.5 py-1 text-[11px] font-mono rounded border transition-colors ${
              underlying === p.sym
                ? "border-primary bg-primary/15 text-primary font-bold"
                : "border-border bg-card hover-row text-foreground/70"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Spot + Analytics summary */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <Card className="bg-card border-border">
          <CardContent className="p-3">
            <div className="text-[10px] uppercase text-muted-foreground font-mono">Spot</div>
            <div className="text-xl font-bold font-mono tabular-nums">
              {chain ? fmt(chain.spot) : <Skeleton className="h-6 w-20" />}
            </div>
            {chain && (
              <div className="text-[11px] text-muted-foreground font-mono">
                ATM {fmt(chain.atmStrike, 0)} · step {chain.strikeStep}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-3">
            <div className="text-[10px] uppercase text-muted-foreground font-mono">PCR (OI)</div>
            <div className={`text-xl font-bold font-mono tabular-nums ${
              !analytics ? "" :
              analytics.pcrOi >= 1.3 ? "text-signal-strong-buy" :
              analytics.pcrOi <= 0.7 ? "text-signal-strong-sell" : "text-foreground"
            }`}>
              {analytics ? analytics.pcrOi.toFixed(2) : <Skeleton className="h-6 w-12" />}
            </div>
            <div className="text-[11px] text-muted-foreground font-mono">
              Vol PCR {analytics ? analytics.pcrVolume.toFixed(2) : "—"}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-3">
            <div className="text-[10px] uppercase text-muted-foreground font-mono">Max Pain</div>
            <div className="text-xl font-bold font-mono tabular-nums">
              {analytics ? fmt(analytics.maxPain, 0) : <Skeleton className="h-6 w-16" />}
            </div>
            {analytics && chain && (
              <div className={`text-[11px] font-mono ${chain.spot > analytics.maxPain ? "text-signal-strong-buy" : "text-signal-strong-sell"}`}>
                {chain.spot > analytics.maxPain ? "+" : ""}
                {(((chain.spot - analytics.maxPain) / analytics.maxPain) * 100).toFixed(2)}% vs spot
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-3">
            <div className="text-[10px] uppercase text-muted-foreground font-mono">ATM IV</div>
            <div className="text-xl font-bold font-mono tabular-nums">
              {analytics?.atmIv != null ? `${analytics.atmIv.toFixed(2)}%` : (analytics ? "—" : <Skeleton className="h-6 w-12" />)}
            </div>
            <div className="text-[11px] text-muted-foreground font-mono">
              {analytics?.ivPercentile != null ? `IV%ile ${analytics.ivPercentile}` : "Building IV history…"}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-3">
            <div className="text-[10px] uppercase text-muted-foreground font-mono">Total OI</div>
            <div className="text-sm font-bold font-mono tabular-nums leading-tight">
              <span className="text-signal-strong-buy">{analytics ? fmtKL(analytics.totalCallOi) : "—"}</span>
              <span className="text-muted-foreground"> / </span>
              <span className="text-signal-strong-sell">{analytics ? fmtKL(analytics.totalPutOi) : "—"}</span>
            </div>
            <div className="text-[10px] text-muted-foreground font-mono">CE / PE</div>
            {analytics && (
              <div className="text-[11px] font-mono mt-1">
                <span className={(analytics.callOiAdded ?? 0) >= 0 ? "text-signal-strong-buy" : "text-signal-strong-sell"}>
                  CE Δ {fmtKL(analytics.callOiAdded)}
                </span>
                <span className="text-muted-foreground"> · </span>
                <span className={(analytics.putOiAdded ?? 0) >= 0 ? "text-signal-strong-buy" : "text-signal-strong-sell"}>
                  PE Δ {fmtKL(analytics.putOiAdded)}
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-3">
            <div className="text-[10px] uppercase text-muted-foreground font-mono">Bias</div>
            {analytics ? (
              <Badge className={
                analytics.bias === "BULLISH" ? "bg-signal-strong-buy/20 text-signal-strong-buy border-signal-strong-buy/40" :
                analytics.bias === "BEARISH" ? "bg-signal-strong-sell/20 text-signal-strong-sell border-signal-strong-sell/40" :
                "bg-secondary/40 text-muted-foreground border-border/40"
              }>
                {analytics.bias === "BULLISH" && <TrendingUp className="w-3 h-3 mr-1 inline" />}
                {analytics.bias === "BEARISH" && <TrendingDown className="w-3 h-3 mr-1 inline" />}
                {analytics.bias === "NEUTRAL" && <Activity className="w-3 h-3 mr-1 inline" />}
                {analytics.bias}
              </Badge>
            ) : <Skeleton className="h-6 w-20" />}
            {analytics?.topResistance?.[0] && (
              <div className="text-[11px] text-muted-foreground font-mono mt-1">
                <Target className="w-3 h-3 inline mr-1" />
                R {fmt(analytics.topResistance[0].strike, 0)} · S {fmt(analytics.topSupport?.[0]?.strike ?? 0, 0)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Interpretation */}
      {analytics?.interpretation && (
        <Card className="bg-card/50 border-border">
          <CardContent className="p-3 text-xs font-mono text-foreground/80">
            {analytics.interpretation}
          </CardContent>
        </Card>
      )}

      {/* Expiry selector */}
      {chain && chain.expiries.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase text-muted-foreground font-mono">Expiry:</span>
          {chain.expiries.slice(0, 8).map(e => (
            <button
              key={e}
              onClick={() => setExpiry(e)}
              className={`px-2.5 py-1 text-[11px] font-mono rounded border transition-colors ${
                e === chain.expiry
                  ? "border-primary bg-primary/15 text-primary font-bold"
                  : "border-border bg-card hover-row text-foreground/70"
              }`}
            >
              {e}
            </button>
          ))}
        </div>
      )}

      {/* Status messages */}
      {status === "error" && (() => {
        const errAny = chainQ.error as { response?: { data?: { detail?: string; kiteAuthenticated?: boolean } } } | undefined;
        const detail = errAny?.response?.data?.detail;
        const kiteOn = errAny?.response?.data?.kiteAuthenticated;
        return (
          <Card className="bg-card border-signal-strong-sell/30">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-mono text-signal-strong-sell">
                Option chain unavailable for <b>{underlying}</b>
                <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase ${kiteOn ? "bg-signal-strong-buy/20 text-signal-strong-buy" : "bg-signal-strong-sell/20 text-signal-strong-sell"}`}>
                  Kite: {kiteOn ? "connected" : "not connected"}
                </span>
              </div>
              {detail && <div className="text-xs text-foreground/80">{detail}</div>}
              {!kiteOn && (
                <ul className="text-xs text-muted-foreground list-disc list-inside space-y-0.5">
                  <li>Open the <b>Live Feed</b> tab and click <b>Connect Kite</b> (daily login, ~30 seconds).</li>
                  <li>If you see "Not a valid https redirect URL" in Kite, publish this app first so the redirect URL becomes a real subdomain (replace <code className="px-1 bg-secondary/40 rounded">&lt;your-app&gt;</code> with your actual Replit subdomain in your Kite app settings).</li>
                  <li>Alternative: deploy to an Indian-region host (Mumbai/Bengaluru) — NSE will then respond directly.</li>
                </ul>
              )}
              <div className="text-[11px] text-muted-foreground font-mono pt-1">
                Page auto-refreshes every 30s · use the search above to try a different underlying.
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Chain table */}
      {status === "loading" && (
        <div className="space-y-2">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      )}

      {chain && (
        <>
          {/* Greeks toggle + summary */}
          <div className="flex flex-wrap items-center justify-between gap-2 -mb-1">
            <div className="flex items-center gap-2 text-[11px] font-mono">
              <button
                onClick={() => setShowGreeks(g => !g)}
                className={`px-2.5 py-1 rounded border transition-colors ${
                  showGreeks
                    ? "border-primary bg-primary/15 text-primary font-bold"
                    : "border-border bg-card hover-row text-foreground/70"
                }`}
              >
                {showGreeks ? "Hide Greeks" : "Show Greeks (Δ Γ Θ V)"}
              </button>
              <span className="text-muted-foreground">
                Black-Scholes · r=6.75% · IV solved from market price
              </span>
              {/* Download — credentialed by cookie. Includes the active expiry
                  so the file matches what's currently on screen. */}
              <a
                href={`/api/options/chain/${underlying}/export?format=csv${chain.expiry ? `&expiry=${encodeURIComponent(chain.expiry)}` : ""}`}
                className="px-2.5 py-1 rounded border border-border bg-card hover:border-primary/60 hover:text-primary transition-colors"
                download
                title="Download the current chain (with Greeks) as CSV"
              >
                ↓ CSV
              </a>
              <a
                href={`/api/options/chain/${underlying}/export?format=json${chain.expiry ? `&expiry=${encodeURIComponent(chain.expiry)}` : ""}`}
                className="px-2.5 py-1 rounded border border-border bg-card hover:border-primary/60 hover:text-primary transition-colors"
                download
                title="Download the current chain as JSON"
              >
                ↓ JSON
              </a>
            </div>
            {chain && (() => {
              const atmRow = chain.rows.find(r => r.strike === chain.atmStrike);
              if (!atmRow) return null;
              return (
                <div className="text-[11px] font-mono text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-0.5">
                  <span>ATM Δ:
                    <span className="text-signal-strong-buy ml-1">CE {fmtGreek(atmRow.ce?.delta, 3)}</span>
                    <span className="text-signal-strong-sell ml-1">PE {fmtGreek(atmRow.pe?.delta, 3)}</span>
                  </span>
                  <span>Θ/day:
                    <span className="text-signal-strong-sell ml-1">CE {fmtGreek(atmRow.ce?.theta, 2)}</span>
                    <span className="text-signal-strong-sell ml-1">PE {fmtGreek(atmRow.pe?.theta, 2)}</span>
                  </span>
                  <span>V:
                    <span className="text-foreground/70 ml-1">CE {fmtGreek(atmRow.ce?.vega, 2)}</span>
                    <span className="text-foreground/70 ml-1">PE {fmtGreek(atmRow.pe?.vega, 2)}</span>
                  </span>
                </div>
              );
            })()}
          </div>

          <div className="overflow-x-auto rounded border border-border">
            <table className="w-full text-[11px] font-mono">
              <thead className="bg-card/80 sticky top-0">
                <tr className="text-muted-foreground border-b border-border">
                  <th colSpan={showGreeks ? 10 : 6} className="text-center text-signal-strong-buy py-1 border-r border-border bg-signal-strong-buy/[0.04]">
                    CALLS
                  </th>
                  <th className="text-center text-foreground py-1 px-3">STRIKE</th>
                  <th colSpan={showGreeks ? 10 : 6} className="text-center text-signal-strong-sell py-1 border-l border-border bg-signal-strong-sell/[0.04]">
                    PUTS
                  </th>
                </tr>
                <tr className="text-muted-foreground border-b border-border bg-card/50">
                  <th className="px-2 py-1 text-right">OI</th>
                  <th className="px-2 py-1 text-right">Δ OI</th>
                  <th className="px-2 py-1 text-right">Vol</th>
                  <th className="px-2 py-1 text-right">IV</th>
                  {showGreeks && <th className="px-2 py-1 text-right" title="Delta">Δ</th>}
                  {showGreeks && <th className="px-2 py-1 text-right" title="Gamma">Γ</th>}
                  {showGreeks && <th className="px-2 py-1 text-right" title="Theta per day">Θ</th>}
                  {showGreeks && <th className="px-2 py-1 text-right" title="Vega per 1% IV">V</th>}
                  <th className="px-2 py-1 text-right">LTP</th>
                  <th className="px-2 py-1 text-center border-r border-border">B</th>
                  <th className="px-3 py-1 text-center">Strike</th>
                  <th className="px-2 py-1 text-center border-l border-border">B</th>
                  <th className="px-2 py-1 text-right">LTP</th>
                  {showGreeks && <th className="px-2 py-1 text-right" title="Delta">Δ</th>}
                  {showGreeks && <th className="px-2 py-1 text-right" title="Gamma">Γ</th>}
                  {showGreeks && <th className="px-2 py-1 text-right" title="Theta per day">Θ</th>}
                  {showGreeks && <th className="px-2 py-1 text-right" title="Vega per 1% IV">V</th>}
                  <th className="px-2 py-1 text-right">IV</th>
                  <th className="px-2 py-1 text-right">Vol</th>
                  <th className="px-2 py-1 text-right">Δ OI</th>
                  <th className="px-2 py-1 text-right">OI</th>
                </tr>
              </thead>
              <tbody>
                {chain.rows.map((r) => <Row key={r.strike} row={r} atm={chain.atmStrike} spot={chain.spot} maxOi={maxOi} showGreeks={showGreeks} />)}
              </tbody>
            </table>
          </div>

          {/* Buildup legend */}
          <div className="flex flex-wrap gap-3 text-[11px] font-mono">
            <span className="text-muted-foreground">OI Buildup:</span>
            <span className={`px-1.5 py-0.5 rounded ${buildupTone("LONG_BUILDUP")}`}>LB · Long Buildup</span>
            <span className={`px-1.5 py-0.5 rounded ${buildupTone("SHORT_COVERING")}`}>SC · Short Covering</span>
            <span className={`px-1.5 py-0.5 rounded ${buildupTone("SHORT_BUILDUP")}`}>SB · Short Buildup</span>
            <span className={`px-1.5 py-0.5 rounded ${buildupTone("LONG_UNWINDING")}`}>LU · Long Unwinding</span>
          </div>

          <div className="text-[11px] text-muted-foreground font-mono">
            Source: {chain.source} ·{" "}
            {analytics && `Updated ${formatDistanceToNow(new Date(analytics.generatedAt), { addSuffix: true })}`}
            {chain.lotSize && ` · Lot size ${chain.lotSize}`}
          </div>
        </>
      )}
    </div>
  );
}

function Row({ row, atm, spot, maxOi, showGreeks }: { row: OptionChainStrikeRow; atm: number; spot: number; maxOi: number; showGreeks: boolean }) {
  const isAtm = row.strike === atm;
  const ce = row.ce, pe = row.pe;

  // CE OI bar (greenish, anchored right)
  const ceBar = ce?.oi && maxOi > 0 ? (ce.oi / maxOi) * 100 : 0;
  const peBar = pe?.oi && maxOi > 0 ? (pe.oi / maxOi) * 100 : 0;

  // ITM tint: CE in-the-money when strike < spot; PE in-the-money when strike > spot
  const ceItm = row.strike < spot;
  const peItm = row.strike > spot;

  return (
    <tr className={`border-b border-border/30 hover-row ${isAtm ? "bg-primary/[0.07] font-bold" : ""}`}>
      {/* ── CALL side ─────────────────────────── */}
      <td className={`px-2 py-1 text-right tabular-nums relative ${ceItm ? "bg-signal-strong-buy/[0.04]" : ""}`}>
        <div
          className="absolute right-0 top-0 bottom-0 bg-signal-strong-buy/15"
          style={{ width: `${ceBar}%` }}
          aria-hidden
        />
        <span className="relative">{fmtKL(ce?.oi)}</span>
      </td>
      <td className={`px-2 py-1 text-right tabular-nums ${ceItm ? "bg-signal-strong-buy/[0.04]" : ""} ${(ce?.chgOi ?? 0) > 0 ? "text-signal-strong-buy" : (ce?.chgOi ?? 0) < 0 ? "text-signal-strong-sell" : ""}`}>
        {ce?.chgOi != null && ce.chgOi > 0 ? "+" : ""}{fmtKL(ce?.chgOi)}
      </td>
      <td className={`px-2 py-1 text-right tabular-nums ${ceItm ? "bg-signal-strong-buy/[0.04]" : ""}`}>{fmtKL(ce?.volume)}</td>
      <td className={`px-2 py-1 text-right tabular-nums ${ceItm ? "bg-signal-strong-buy/[0.04]" : ""}`}>{ce?.iv ? ce.iv.toFixed(1) : "—"}</td>
      {showGreeks && <td className={`px-2 py-1 text-right tabular-nums ${ceItm ? "bg-signal-strong-buy/[0.04]" : ""}`}>{fmtGreek(ce?.delta, 3)}</td>}
      {showGreeks && <td className={`px-2 py-1 text-right tabular-nums ${ceItm ? "bg-signal-strong-buy/[0.04]" : ""}`}>{fmtGreek(ce?.gamma, 5)}</td>}
      {showGreeks && <td className={`px-2 py-1 text-right tabular-nums text-signal-strong-sell ${ceItm ? "bg-signal-strong-buy/[0.04]" : ""}`}>{fmtGreek(ce?.theta, 2)}</td>}
      {showGreeks && <td className={`px-2 py-1 text-right tabular-nums ${ceItm ? "bg-signal-strong-buy/[0.04]" : ""}`}>{fmtGreek(ce?.vega, 2)}</td>}
      <td className={`px-2 py-1 text-right tabular-nums font-bold ${ceItm ? "bg-signal-strong-buy/[0.04]" : ""}`}>{fmt(ce?.ltp)}</td>
      <td className={`px-2 py-1 text-center border-r border-border ${ceItm ? "bg-signal-strong-buy/[0.04]" : ""}`}>
        <span className={`px-1 rounded text-[9px] font-bold ${buildupTone(ce?.oiBuildup)}`}>{buildupShort(ce?.oiBuildup)}</span>
      </td>

      {/* ── Strike ─────────────────────────── */}
      <td className={`px-3 py-1 text-center tabular-nums font-bold ${isAtm ? "text-primary" : "text-foreground"}`}>
        {row.strike}
        {isAtm && <span className="ml-1 text-[9px] text-primary/80">ATM</span>}
      </td>

      {/* ── PUT side ─────────────────────────── */}
      <td className={`px-2 py-1 text-center border-l border-border ${peItm ? "bg-signal-strong-sell/[0.04]" : ""}`}>
        <span className={`px-1 rounded text-[9px] font-bold ${buildupTone(pe?.oiBuildup)}`}>{buildupShort(pe?.oiBuildup)}</span>
      </td>
      <td className={`px-2 py-1 text-right tabular-nums font-bold ${peItm ? "bg-signal-strong-sell/[0.04]" : ""}`}>{fmt(pe?.ltp)}</td>
      {showGreeks && <td className={`px-2 py-1 text-right tabular-nums ${peItm ? "bg-signal-strong-sell/[0.04]" : ""}`}>{fmtGreek(pe?.delta, 3)}</td>}
      {showGreeks && <td className={`px-2 py-1 text-right tabular-nums ${peItm ? "bg-signal-strong-sell/[0.04]" : ""}`}>{fmtGreek(pe?.gamma, 5)}</td>}
      {showGreeks && <td className={`px-2 py-1 text-right tabular-nums text-signal-strong-sell ${peItm ? "bg-signal-strong-sell/[0.04]" : ""}`}>{fmtGreek(pe?.theta, 2)}</td>}
      {showGreeks && <td className={`px-2 py-1 text-right tabular-nums ${peItm ? "bg-signal-strong-sell/[0.04]" : ""}`}>{fmtGreek(pe?.vega, 2)}</td>}
      <td className={`px-2 py-1 text-right tabular-nums ${peItm ? "bg-signal-strong-sell/[0.04]" : ""}`}>{pe?.iv ? pe.iv.toFixed(1) : "—"}</td>
      <td className={`px-2 py-1 text-right tabular-nums ${peItm ? "bg-signal-strong-sell/[0.04]" : ""}`}>{fmtKL(pe?.volume)}</td>
      <td className={`px-2 py-1 text-right tabular-nums ${peItm ? "bg-signal-strong-sell/[0.04]" : ""} ${(pe?.chgOi ?? 0) > 0 ? "text-signal-strong-buy" : (pe?.chgOi ?? 0) < 0 ? "text-signal-strong-sell" : ""}`}>
        {pe?.chgOi != null && pe.chgOi > 0 ? "+" : ""}{fmtKL(pe?.chgOi)}
      </td>
      <td className={`px-2 py-1 text-right tabular-nums relative ${peItm ? "bg-signal-strong-sell/[0.04]" : ""}`}>
        <div
          className="absolute left-0 top-0 bottom-0 bg-signal-strong-sell/15"
          style={{ width: `${peBar}%` }}
          aria-hidden
        />
        <span className="relative">{fmtKL(pe?.oi)}</span>
      </td>
    </tr>
  );
}
