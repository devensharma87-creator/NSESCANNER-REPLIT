import {
  useGetGlobalIndices, getGetGlobalIndicesQueryKey,
  useGetFiiDii, getGetFiiDiiQueryKey,
} from "@workspace/api-client-react";
import { Shield, Calendar, TrendingUp, TrendingDown } from "lucide-react";

function fmtCr(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 100) return `${(n / 100).toFixed(0)}B`;
  return `${n.toFixed(0)}Cr`;
}

function getNextExpiry(): { label: string; daysLeft: number } {
  const now = new Date();
  const day = now.getDay();
  let daysUntilThurs = (4 - day + 7) % 7;
  if (daysUntilThurs === 0 && now.getHours() >= 15) daysUntilThurs = 7;
  if (daysUntilThurs === 0) daysUntilThurs = 0;
  const expiry = new Date(now);
  expiry.setDate(expiry.getDate() + daysUntilThurs);
  return {
    label: expiry.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
    daysLeft: daysUntilThurs,
  };
}

export default function SentimentBar() {
  const { data: globals } = useGetGlobalIndices({
    query: { refetchInterval: 30000, queryKey: getGetGlobalIndicesQueryKey() },
  });
  const { data: fiiDiiData } = useGetFiiDii(
    { months: 1 },
    { query: { refetchInterval: 120000, queryKey: getGetFiiDiiQueryKey({ months: 1 }) } },
  );

  const indiaVix = globals?.indices?.find(i => i.symbol === "^INDIAVIX");
  const expiry = getNextExpiry();

  const latestMonth = fiiDiiData?.months?.[0];
  const latestDay = latestMonth?.days?.[latestMonth.days.length - 1];

  return (
    <div className="flex items-stretch gap-2 flex-wrap">
      {indiaVix && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card/50 px-3 py-1.5">
          <Shield className="h-3.5 w-3.5 text-amber-500" />
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">India VIX</span>
          <span className="text-sm font-mono font-bold tabular-nums">{indiaVix.price?.toFixed(2)}</span>
          <span className={`text-[11px] font-mono tabular-nums font-semibold ${
            (indiaVix.changePercent ?? 0) <= 0 ? "text-emerald-500" : "text-rose-500"
          }`}>
            {(indiaVix.changePercent ?? 0) >= 0 ? "+" : ""}{(indiaVix.changePercent ?? 0).toFixed(2)}%
          </span>
        </div>
      )}

      {latestDay && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card/50 px-3 py-1.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">FII</span>
            <span className={`text-sm font-mono font-bold tabular-nums ${
              latestDay.fiiNet >= 0 ? "text-emerald-500" : "text-rose-500"
            }`}>
              {latestDay.fiiNet >= 0 ? "+" : ""}{fmtCr(latestDay.fiiNet)}
            </span>
            {latestDay.fiiNet >= 0
              ? <TrendingUp className="h-3 w-3 text-emerald-500" />
              : <TrendingDown className="h-3 w-3 text-rose-500" />}
          </div>
          <div className="w-px h-4 bg-border" />
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">DII</span>
            <span className={`text-sm font-mono font-bold tabular-nums ${
              latestDay.diiNet >= 0 ? "text-emerald-500" : "text-rose-500"
            }`}>
              {latestDay.diiNet >= 0 ? "+" : ""}{fmtCr(latestDay.diiNet)}
            </span>
            {latestDay.diiNet >= 0
              ? <TrendingUp className="h-3 w-3 text-emerald-500" />
              : <TrendingDown className="h-3 w-3 text-rose-500" />}
          </div>
          <span className="text-[9px] font-mono text-muted-foreground/60 ml-1">{latestDay.date}</span>
        </div>
      )}

      <div className="flex items-center gap-2 rounded-lg border border-border bg-card/50 px-3 py-1.5">
        <Calendar className="h-3.5 w-3.5 text-primary" />
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Expiry</span>
        <span className="text-sm font-mono font-bold tabular-nums">{expiry.label}</span>
        <span className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded ${
          expiry.daysLeft <= 1 ? "bg-rose-500/15 text-rose-500" :
          expiry.daysLeft <= 3 ? "bg-amber-500/15 text-amber-500" :
          "bg-muted text-muted-foreground"
        }`}>
          {expiry.daysLeft === 0 ? "TODAY" : `${expiry.daysLeft}D`}
        </span>
      </div>
    </div>
  );
}
