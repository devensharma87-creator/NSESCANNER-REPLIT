import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  useRunGlobalScreener,
  type GlobalAssetClass,
  type GlobalTimeframe,
} from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, Filter as FilterIcon, ArrowUpRight, ArrowDownRight,
  ArrowUp, ArrowDown,
} from "lucide-react";

const ASSET_CLASSES: { id: GlobalAssetClass; label: string }[] = [
  { id: "crypto", label: "Crypto" },
  { id: "commodity", label: "Commodities" },
  { id: "forex", label: "Forex" },
];

const TIMEFRAMES: GlobalTimeframe[] = ["15m", "1h", "4h", "1d"];

type Hit = {
  symbol: string;
  displayName: string;
  assetClass: string;
  price: number | null;
  changePct: number | null;
  volume: number | null;
  rsi14: number | null;
  trend: "up" | "down" | "mixed" | null;
  matched: string[];
};

type SortKey = "symbol" | "price" | "changePct" | "volume" | "rsi14";
type SortDir = "asc" | "desc";

function num(s: string): number | undefined {
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : undefined;
}

export function ScreenerPage() {
  const [classes, setClasses] = useState<Set<GlobalAssetClass>>(new Set(["crypto", "commodity", "forex"]));
  const [timeframe, setTimeframe] = useState<GlobalTimeframe>("1h");
  const [minChange, setMinChange] = useState<string>("");
  const [maxChange, setMaxChange] = useState<string>("");
  const [minVolume, setMinVolume] = useState<string>("");
  const [minRsi, setMinRsi] = useState<string>("");
  const [maxRsi, setMaxRsi] = useState<string>("");
  const [breakout, setBreakout] = useState<string>("");
  const [breakdown, setBreakdown] = useState<string>("");
  const [min1d, setMin1d] = useState<string>("");
  const [min1w, setMin1w] = useState<string>("");
  const [trendUp, setTrendUp] = useState(false);
  const [trendDown, setTrendDown] = useState(false);
  const [stUp, setStUp] = useState(false);
  const [stDown, setStDown] = useState(false);
  const [sma50Above, setSma50Above] = useState(false);
  const [sma50Below, setSma50Below] = useState(false);
  const [sma200Above, setSma200Above] = useState(false);
  const [sma200Below, setSma200Below] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "changePct", dir: "desc" });

  const screener = useRunGlobalScreener();

  function run() {
    screener.mutate({
      data: {
        assetClasses: Array.from(classes),
        timeframe,
        filters: {
          minChangePct: num(minChange),
          maxChangePct: num(maxChange),
          minVolume: num(minVolume),
          minRsi14: num(minRsi),
          maxRsi14: num(maxRsi),
          breakoutLookback: num(breakout),
          breakdownLookback: num(breakdown),
          min1dChangePct: num(min1d),
          min1wChangePct: num(min1w),
          trendUp: trendUp || undefined,
          trendDown: trendDown || undefined,
          requireSupertrendUp: stUp || undefined,
          requireSupertrendDown: stDown || undefined,
          priceAboveSma50: sma50Above || undefined,
          priceBelowSma50: sma50Below || undefined,
          priceAboveSma200: sma200Above || undefined,
          priceBelowSma200: sma200Below || undefined,
        },
        limit: 25,
      },
    });
  }

  const hits: Hit[] = useMemo(() => {
    const rows = (screener.data?.hits ?? []).slice() as Hit[];
    const mul = sort.dir === "asc" ? 1 : -1;
    const get = (h: Hit): number | string => {
      switch (sort.key) {
        case "symbol":    return h.symbol;
        case "price":     return h.price ?? Number.NEGATIVE_INFINITY;
        case "changePct": return h.changePct ?? Number.NEGATIVE_INFINITY;
        case "volume":    return h.volume ?? Number.NEGATIVE_INFINITY;
        case "rsi14":     return h.rsi14 ?? Number.NEGATIVE_INFINITY;
      }
    };
    rows.sort((a, b) => {
      const va = get(a), vb = get(b);
      if (typeof va === "string" && typeof vb === "string") return va.localeCompare(vb) * mul;
      return ((va as number) - (vb as number)) * mul;
    });
    return rows;
  }, [screener.data, sort]);

  function onSort(k: SortKey) {
    setSort(prev => prev.key === k ? { key: k, dir: prev.dir === "asc" ? "desc" : "asc" } : { key: k, dir: k === "symbol" ? "asc" : "desc" });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <FilterIcon className="h-5 w-5 text-primary" /> Screener
        </h1>
        <p className="text-sm text-muted-foreground">
          Find movers across the global universe by % change, volume, RSI, breakouts, trend, and price-vs-MA.
        </p>
      </div>

      <Card className="p-4 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <Label className="text-xs text-muted-foreground">Asset classes</Label>
            <div className="flex items-center gap-2 mt-1">
              {ASSET_CLASSES.map((c) => (
                <label key={c.id} className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <Checkbox
                    checked={classes.has(c.id)}
                    onCheckedChange={(v) => {
                      setClasses((prev) => {
                        const next = new Set(prev);
                        if (v) next.add(c.id); else next.delete(c.id);
                        return next;
                      });
                    }}
                    data-testid={`check-class-${c.id}`}
                  />
                  {c.label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Timeframe</Label>
            <div className="flex items-center gap-1 mt-1">
              {TIMEFRAMES.map((tf) => (
                <Button
                  key={tf}
                  size="sm"
                  variant={timeframe === tf ? "default" : "outline"}
                  onClick={() => setTimeframe(tf)}
                  className="h-7 px-2 text-xs"
                  data-testid={`btn-screener-tf-${tf}`}
                >{tf}</Button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <NumField label="Min Δ% (live)"  value={minChange} onChange={setMinChange} placeholder="e.g. 2" />
          <NumField label="Max Δ% (live)"  value={maxChange} onChange={setMaxChange} placeholder="e.g. -2" />
          <NumField label="Min volume"     value={minVolume} onChange={setMinVolume} placeholder="e.g. 1000000" />
          <NumField label="Min RSI(14)"    value={minRsi} onChange={setMinRsi} placeholder="0-100" />
          <NumField label="Max RSI(14)"    value={maxRsi} onChange={setMaxRsi} placeholder="0-100" />
          <NumField label="Min 1d Δ%"      value={min1d} onChange={setMin1d} placeholder="e.g. 5 or -5" />
          <NumField label="Min 1w Δ%"      value={min1w} onChange={setMin1w} placeholder="e.g. 10" />
          <NumField label="Breakout look-back (bars)"  value={breakout} onChange={setBreakout} placeholder="e.g. 20" />
          <NumField label="Breakdown look-back (bars)" value={breakdown} onChange={setBreakdown} placeholder="e.g. 20" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Trend (EMA cascade)</Label>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <Checkbox checked={trendUp} onCheckedChange={(v) => { setTrendUp(!!v); if (v) setTrendDown(false); }} data-testid="check-trendup" />
                Trend up (EMA 20 &gt; 50 &gt; 200)
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <Checkbox checked={trendDown} onCheckedChange={(v) => { setTrendDown(!!v); if (v) setTrendUp(false); }} data-testid="check-trenddown" />
                Trend down (EMA 20 &lt; 50 &lt; 200)
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <Checkbox checked={stUp} onCheckedChange={(v) => { setStUp(!!v); if (v) setStDown(false); }} data-testid="check-stup" />
                Supertrend up
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <Checkbox checked={stDown} onCheckedChange={(v) => { setStDown(!!v); if (v) setStUp(false); }} data-testid="check-stdown" />
                Supertrend down
              </label>
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Price vs moving average</Label>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <Checkbox checked={sma50Above} onCheckedChange={(v) => { setSma50Above(!!v); if (v) setSma50Below(false); }} data-testid="check-sma50-above" />
                Price &gt; SMA50
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <Checkbox checked={sma50Below} onCheckedChange={(v) => { setSma50Below(!!v); if (v) setSma50Above(false); }} data-testid="check-sma50-below" />
                Price &lt; SMA50
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <Checkbox checked={sma200Above} onCheckedChange={(v) => { setSma200Above(!!v); if (v) setSma200Below(false); }} data-testid="check-sma200-above" />
                Price &gt; SMA200
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <Checkbox checked={sma200Below} onCheckedChange={(v) => { setSma200Below(!!v); if (v) setSma200Above(false); }} data-testid="check-sma200-below" />
                Price &lt; SMA200
              </label>
            </div>
          </div>
        </div>

        <div>
          <Button onClick={run} disabled={screener.isPending || classes.size === 0} data-testid="button-run-screener">
            {screener.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Run screener
          </Button>
        </div>
      </Card>

      {screener.error && (
        <Card className="p-3 text-sm text-destructive">
          Screener failed: {(screener.error as Error)?.message ?? "unknown error"}
        </Card>
      )}

      {screener.data && (
        <Card className="overflow-hidden">
          <div className="px-4 py-2 border-b text-xs text-muted-foreground">
            {hits.length} hits · evaluated {screener.data.evaluatedCandidates} candidates
            {screener.data.indicatorEvaluated && " · indicators applied"}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <SortHeader label="Symbol" k="symbol" current={sort} onChange={onSort} />
                  <th className="text-left px-3 py-2 font-medium">Name</th>
                  <th className="text-left px-3 py-2 font-medium">Class</th>
                  <SortHeader label="Price" k="price" current={sort} onChange={onSort} align="right" />
                  <SortHeader label="Δ%" k="changePct" current={sort} onChange={onSort} align="right" />
                  <SortHeader label="Volume" k="volume" current={sort} onChange={onSort} align="right" />
                  <SortHeader label="RSI 14" k="rsi14" current={sort} onChange={onSort} align="right" />
                  <th className="text-left px-3 py-2 font-medium">Matched</th>
                </tr>
              </thead>
              <tbody>
                {hits.map((h) => {
                  const up = (h.changePct ?? 0) >= 0;
                  return (
                    <tr key={h.symbol} className="border-t hover:bg-accent/30" data-testid={`hit-${h.symbol}`}>
                      <td className="px-3 py-2 font-mono">
                        <Link href={`/i/${h.symbol}`} className="text-primary hover:underline" data-testid={`link-symbol-${h.symbol}`}>{h.symbol}</Link>
                      </td>
                      <td className="px-3 py-2">{h.displayName}</td>
                      <td className="px-3 py-2"><Badge variant="outline" className="text-xs">{h.assetClass}</Badge></td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{h.price?.toLocaleString(undefined, { maximumFractionDigits: 4 }) ?? "—"}</td>
                      <td className={`px-3 py-2 text-right font-mono tabular-nums ${up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                        <span className="inline-flex items-center gap-0.5 justify-end">
                          {h.changePct != null && (up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />)}
                          {h.changePct != null ? `${h.changePct >= 0 ? "+" : ""}${h.changePct.toFixed(2)}%` : "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">{fmtVol(h.volume)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{h.rsi14 != null ? h.rsi14.toFixed(1) : "—"}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{h.matched.join(" · ")}</td>
                    </tr>
                  );
                })}
                {hits.length === 0 && (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">No matches.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function fmtVol(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v === 0) return "—";
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}

function SortHeader(props: {
  label: string;
  k: SortKey;
  current: { key: SortKey; dir: SortDir };
  onChange: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = props.current.key === props.k;
  const Icon = active ? (props.current.dir === "asc" ? ArrowUp : ArrowDown) : null;
  return (
    <th className={`px-3 py-2 font-medium ${props.align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => props.onChange(props.k)}
        className={`inline-flex items-center gap-1 hover:text-foreground ${active ? "text-foreground" : ""}`}
        data-testid={`sort-${props.k}`}
      >
        {props.label}
        {Icon && <Icon className="h-3 w-3" />}
      </button>
    </th>
  );
}

function NumField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1"
        data-testid={`input-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
      />
    </div>
  );
}
