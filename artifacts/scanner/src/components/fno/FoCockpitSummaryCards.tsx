/**
 * F&O cockpit summary cards (display-only).
 *
 * Aggregates already-fetched open/closed F&O paper-trade data via the pure
 * `summarizeFoCockpit` helper, plus the official P25 evidence headline derived
 * from the server-computed shadow-exits eligible count. Renders summary tiles
 * ONLY — no open-trades table, no closed-trade review, no filters/sort/group.
 *
 * This component places NO orders and changes NO exit rule, sizing, gate, or the
 * P25 threshold. Average MFE/MAE are sourced from per-trade maxRunup/maxDrawdown,
 * which the `/paper/trades/fo` closed payload does not carry — those tiles show a
 * clean "—" placeholder rather than fabricating a value.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toNum, type FoCockpitSummary, type P25Headline, type FoTradeRow } from "@/lib/foCockpitView";

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency", currency: "INR", maximumFractionDigits: 0,
  }).format(n);

const signed = (n: number) => `${n >= 0 ? "+" : ""}${inr(n)}`;
const toneOf = (n: number): "pos" | "neg" | undefined =>
  n > 0 ? "pos" : n < 0 ? "neg" : undefined;

const tradeLabel = (t: FoTradeRow | null): string => {
  if (!t) return "—";
  const idx = t.indexSymbol ?? "—";
  const strike = t.strike != null ? ` ${t.strike}` : "";
  const opt = t.optionType ? ` ${t.optionType}` : "";
  return `${idx}${strike}${opt}`.trim();
};

export function FoCockpitSummaryCards({
  summary,
  p25,
  loading,
  error,
}: {
  summary: FoCockpitSummary | null;
  p25: P25Headline;
  loading: boolean;
  error: string | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>F&amp;O Cockpit — Summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <P25Headline25 p25={p25} />

        {error ? (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            Summary metrics unavailable: {error}
          </div>
        ) : loading || !summary ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Tile
                label="Open positions"
                value={String(summary.openCount)}
                title="F&O paper positions currently open."
              />
              <Tile
                label="Closed today"
                value={String(summary.closedTodayCount ?? summary.closedCount)}
                title="F&O paper trades closed today (IST)."
              />
              <Tile
                label="Realised P&L"
                value={signed(summary.realizedPnl)}
                tone={toneOf(summary.realizedPnl)}
                title="Net booked profit/loss from F&O paper trades closed today (IST). Locked in — no longer moves with price."
              />
              <Tile
                label="Unrealised MTM"
                value={signed(summary.unrealizedPnl)}
                tone={toneOf(summary.unrealizedPnl)}
                title="Mark-to-market profit/loss of still-open F&O positions at the latest live premium. Not yet booked — moves with price until close."
              />
              <Tile label="Wins" value={String(summary.winCount)} tone={summary.winCount > 0 ? "pos" : undefined} />
              <Tile label="Losses" value={String(summary.lossCount)} tone={summary.lossCount > 0 ? "neg" : undefined} />
              <Tile label="Avg MFE" value="—" hint="not in closed payload" />
              <Tile label="Avg MAE" value="—" hint="not in closed payload" />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <BestWorst
                label="Best closed"
                name={tradeLabel(summary.bestTrade)}
                value={summary.bestTrade ? signed(toNum(summary.bestTrade.realizedPnl)) : "—"}
                tone="pos"
              />
              <BestWorst
                label="Worst closed"
                name={tradeLabel(summary.worstTrade)}
                value={summary.worstTrade ? signed(toNum(summary.worstTrade.realizedPnl)) : "—"}
                tone="neg"
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function P25Headline25({ p25 }: { p25: P25Headline }) {
  const tone = p25.thresholdMet
    ? "border-emerald-500/30 bg-emerald-500/10"
    : "border-slate-700/60 bg-slate-900/40";
  return (
    <div className={`rounded-lg border ${tone} px-4 py-3`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
          P25 evidence — eligible closed trades (official rule)
        </span>
        <span className="text-[11px] text-muted-foreground">
          Evidence only — no live exit change approved
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-2xl font-semibold tabular-nums text-foreground">
          {p25.ratioLabel}
        </span>
        <span className="text-sm text-muted-foreground">
          {p25.available
            ? `${p25.remaining} more to reach threshold of ${p25.threshold}`
            : `awaiting shadow-exits data · threshold ${p25.threshold}`}
        </span>
        <span
          className={`rounded-full border px-2 py-0.5 text-[11px] ${
            p25.thresholdMet
              ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-200"
              : "border-slate-600/60 bg-slate-800/40 text-slate-300"
          }`}
        >
          {p25.gateLabel}
        </span>
      </div>
    </div>
  );
}

function Tile({
  label, value, tone, hint, title,
}: { label: string; value: string; tone?: "pos" | "neg"; hint?: string; title?: string }) {
  const color =
    tone === "pos" ? "text-emerald-300" :
    tone === "neg" ? "text-rose-300" :
    "text-foreground";
  return (
    <div className="flex flex-col gap-1 rounded-md bg-slate-800/30 px-3 py-2" title={title}>
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={`text-lg font-semibold tabular-nums ${color}`}>{value}</span>
      {hint && <span className="text-[10px] text-slate-500">{hint}</span>}
    </div>
  );
}

function BestWorst({
  label, name, value, tone,
}: { label: string; name: string; value: string; tone: "pos" | "neg" }) {
  const color = tone === "pos" ? "text-emerald-300" : "text-rose-300";
  return (
    <div className="flex items-center justify-between rounded-md bg-slate-800/30 px-3 py-2">
      <div className="flex flex-col gap-0.5">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className="text-sm text-slate-300">{name}</span>
      </div>
      <span className={`text-lg font-semibold tabular-nums ${color}`}>{value}</span>
    </div>
  );
}
