import { useEffect, useMemo, useState } from "react";
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
import { TrendingUp, TrendingDown, Activity, Target } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const PRESETS = [
  { sym: "NIFTY", label: "NIFTY 50" },
  { sym: "BANKNIFTY", label: "BANK NIFTY" },
  { sym: "FINNIFTY", label: "FIN NIFTY" },
  { sym: "MIDCPNIFTY", label: "MIDCP NIFTY" },
  { sym: "RELIANCE", label: "RELIANCE" },
  { sym: "HDFCBANK", label: "HDFC BANK" },
  { sym: "TCS", label: "TCS" },
  { sym: "ICICIBANK", label: "ICICI BANK" },
];

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
    { query: { refetchInterval: 30_000, retry: 0, queryKey: getGetOptionChainQueryKey(underlying, chainParams) } },
  );
  const analyticsQ = useGetOptionAnalytics(
    underlying,
    chainParams,
    { query: { refetchInterval: 30_000, retry: 0, queryKey: getGetOptionAnalyticsQueryKey(underlying, chainParams) } },
  );

  const chain = chainQ.data;
  const analytics = analyticsQ.data;

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

  return (
    <div className="w-full px-4 py-4 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight font-mono">Option Chain</h1>
          <p className="text-xs text-muted-foreground">
            Live NSE OI · auto-refreshes every 30s · CE on left, PE on right · ATM strike highlighted.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map(p => (
            <button
              key={p.sym}
              onClick={() => setLocation(`/option-chain/${p.sym}`)}
              className={`px-3 py-1.5 text-xs font-mono font-bold rounded border transition-colors ${
                underlying === p.sym
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border bg-card hover:bg-white/5 text-foreground/70"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
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
                  : "border-border bg-card hover:bg-white/5 text-foreground/70"
              }`}
            >
              {e}
            </button>
          ))}
        </div>
      )}

      {/* Status messages */}
      {status === "error" && (
        <Card className="bg-card border-signal-strong-sell/30">
          <CardContent className="p-4 space-y-2">
            <div className="text-sm font-mono text-signal-strong-sell">
              Option chain unavailable for <b>{underlying}</b>.
            </div>
            <div className="text-xs text-foreground/80">
              NSE&apos;s public option-chain API is geo-restricted and silently rejects requests from non-Indian
              cloud IPs. To enable live data:
            </div>
            <ul className="text-xs text-muted-foreground list-disc list-inside space-y-0.5">
              <li>Deploy this app to an Indian-region host (Mumbai, Bengaluru), <b>or</b></li>
              <li>Complete the daily Zerodha Kite Connect login from the <b>Live Feed</b> tab — Kite gives full
                option-chain access from any IP.</li>
              <li>If <b>{underlying}</b> is an equity, also confirm it is in NSE&apos;s F&amp;O list.</li>
            </ul>
            <div className="text-[11px] text-muted-foreground font-mono pt-1">
              Page auto-refreshes every 30s · presets above try other underlyings.
            </div>
          </CardContent>
        </Card>
      )}

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
          <div className="overflow-x-auto rounded border border-border">
            <table className="w-full text-[11px] font-mono">
              <thead className="bg-card/80 sticky top-0">
                <tr className="text-muted-foreground border-b border-border">
                  <th colSpan={6} className="text-center text-signal-strong-buy py-1 border-r border-border bg-signal-strong-buy/[0.04]">
                    CALLS
                  </th>
                  <th className="text-center text-foreground py-1 px-3">STRIKE</th>
                  <th colSpan={6} className="text-center text-signal-strong-sell py-1 border-l border-border bg-signal-strong-sell/[0.04]">
                    PUTS
                  </th>
                </tr>
                <tr className="text-muted-foreground border-b border-border bg-card/50">
                  <th className="px-2 py-1 text-right">OI</th>
                  <th className="px-2 py-1 text-right">Δ OI</th>
                  <th className="px-2 py-1 text-right">Vol</th>
                  <th className="px-2 py-1 text-right">IV</th>
                  <th className="px-2 py-1 text-right">LTP</th>
                  <th className="px-2 py-1 text-center border-r border-border">B</th>
                  <th className="px-3 py-1 text-center">Strike</th>
                  <th className="px-2 py-1 text-center border-l border-border">B</th>
                  <th className="px-2 py-1 text-right">LTP</th>
                  <th className="px-2 py-1 text-right">IV</th>
                  <th className="px-2 py-1 text-right">Vol</th>
                  <th className="px-2 py-1 text-right">Δ OI</th>
                  <th className="px-2 py-1 text-right">OI</th>
                </tr>
              </thead>
              <tbody>
                {chain.rows.map((r) => <Row key={r.strike} row={r} atm={chain.atmStrike} spot={chain.spot} maxOi={maxOi} />)}
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

function Row({ row, atm, spot, maxOi }: { row: OptionChainStrikeRow; atm: number; spot: number; maxOi: number }) {
  const isAtm = row.strike === atm;
  const ce = row.ce, pe = row.pe;

  // CE OI bar (greenish, anchored right)
  const ceBar = ce?.oi && maxOi > 0 ? (ce.oi / maxOi) * 100 : 0;
  const peBar = pe?.oi && maxOi > 0 ? (pe.oi / maxOi) * 100 : 0;

  // ITM tint: CE in-the-money when strike < spot; PE in-the-money when strike > spot
  const ceItm = row.strike < spot;
  const peItm = row.strike > spot;

  return (
    <tr className={`border-b border-border/30 hover:bg-white/[0.03] ${isAtm ? "bg-primary/[0.07] font-bold" : ""}`}>
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
