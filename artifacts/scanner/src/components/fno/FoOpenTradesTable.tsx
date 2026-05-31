/**
 * Upgraded OPEN F&O paper-positions cockpit (read-only display).
 *
 * Desktop: dense table. Mobile (<md): stacked cards. All risk/status badges,
 * P&L%, and staleness come from accepted pure helpers in `foCockpitView.ts`.
 * This component derives NO trading logic, recomputes NO strategy, and writes
 * NOTHING. The Close action is the PRE-EXISTING manual close, owned by the page
 * and passed in via `onClose`/`closingIds` — no new close semantics added.
 */
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  deriveFoRiskBadges,
  deriveFoPnlPct,
  isFoQuoteStale,
  deriveFoEmptyState,
  type FoTradeRow,
} from "@/lib/foCockpitView";
import {
  FoOpenTradeCard,
  fmtPremium,
  fmtInt,
  fmtInr,
  fmtInrDec,
  fmtPct,
  fmtDateTime,
  pnlTone,
  type FoOpenPosition,
} from "./FoOpenTradeCard";
import { FoRiskBadges } from "./FoRiskBadges";

const STALE_MINUTES = 15;
const DASH = "—";

function asRow(p: FoOpenPosition): FoTradeRow {
  return { ...p, status: "OPEN" } as FoTradeRow;
}

function HeaderShell({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Open F&amp;O Positions</CardTitle>
        <CardDescription>
          Paper trading only — no live order placement. Live mark-to-market; LTP
          is pulled fresh from the option chain on every refresh, independent of
          the signal cycle.
        </CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function DesktopRow({
  p,
  now,
  onClose,
  closing,
}: {
  p: FoOpenPosition;
  now: number;
  onClose: () => void;
  closing: boolean;
}) {
  const row = asRow(p);
  const badges = deriveFoRiskBadges(row, { now, staleMinutes: STALE_MINUTES });
  const pnlPct = deriveFoPnlPct(row);
  const stale = isFoQuoteStale(row, now, STALE_MINUTES);
  const totalQty =
    Number.isFinite(p.lots) && Number.isFinite(p.lotSize) ? p.lots * p.lotSize : NaN;
  const hasMfe = Number.isFinite(p.maxRunup as number);
  const hasMae = Number.isFinite(p.maxDrawdown as number);
  return (
    <tr className="border-b border-border/40 align-top">
      <td className="py-2 pr-3">
        <div className="font-medium">{p.indexSymbol || DASH}</div>
        <div className="text-[11px] text-muted-foreground">
          {p.optionType} {fmtInt(p.strike)} · {p.setupKey || DASH}
        </div>
        <FoRiskBadges badges={badges} className="mt-1" />
      </td>
      <td className="py-2 pr-3">
        <Badge variant={p.direction === "BULLISH" ? "default" : "destructive"}>
          {p.direction}
        </Badge>
      </td>
      <td className="py-2 pr-3 tabular-nums whitespace-nowrap">
        {fmtInt(p.lots)}×{fmtInt(p.lotSize)}
        <div className="text-[11px] text-muted-foreground">= {fmtInt(totalQty)}</div>
      </td>
      <td className="py-2 pr-3 text-right tabular-nums">{fmtPremium(p.entryPremium)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{fmtPremium(p.lastPremium)}</td>
      <td className="py-2 pr-3 text-right tabular-nums text-rose-300">{fmtPremium(p.stopPremium)}</td>
      <td className="py-2 pr-3 text-right tabular-nums text-emerald-300">{fmtPremium(p.target1Premium)}</td>
      <td className="py-2 pr-3 text-right tabular-nums text-emerald-300">{fmtPremium(p.target2Premium)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{fmtInr(p.capitalDeployed)}</td>
      <td className={`py-2 pr-3 text-right tabular-nums font-medium ${pnlTone(p.unrealizedPnl)}`}>
        {fmtInrDec(p.unrealizedPnl)}
        <div className="text-[11px] font-normal text-muted-foreground">{fmtPct(pnlPct)}</div>
      </td>
      <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
        {hasMfe || hasMae ? (
          <>
            <span className="text-emerald-300">{fmtInrDec(p.maxRunup)}</span>
            <span className="text-muted-foreground"> / </span>
            <span className="text-rose-300">{fmtInrDec(p.maxDrawdown)}</span>
          </>
        ) : (
          DASH
        )}
      </td>
      <td className="py-2 pr-3 text-[12px] text-muted-foreground whitespace-nowrap">
        {fmtDateTime(p.openedAt)}
      </td>
      <td className="py-2 pr-3 text-[12px] text-muted-foreground whitespace-nowrap">
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full mr-1.5 ${
            stale ? "bg-amber-400" : "bg-emerald-400"
          }`}
        />
        {fmtDateTime(p.lastEvaluatedAt)}
      </td>
      <td className="py-2 pr-3 text-right">
        <Button size="sm" variant="outline" disabled={closing} onClick={onClose}>
          {closing ? "Closing…" : "Close"}
        </Button>
      </td>
    </tr>
  );
}

export function FoOpenTradesTable({
  positions,
  loading,
  error,
  now,
  onClose,
  closingIds,
}: {
  positions: FoOpenPosition[] | null | undefined;
  loading: boolean;
  error: string | null;
  now: number;
  onClose: (id: string) => void;
  closingIds: ReadonlySet<string>;
}) {
  if (error) {
    return (
      <HeaderShell>
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-4 text-sm text-rose-200">
          Could not load open positions: {error}
        </div>
      </HeaderShell>
    );
  }
  if (loading) {
    return (
      <HeaderShell>
        <Skeleton className="h-32 w-full" />
      </HeaderShell>
    );
  }

  const rows = positions ?? [];
  const empty = deriveFoEmptyState("open", positions as FoTradeRow[] | null | undefined);
  if (empty !== "ok") {
    return (
      <HeaderShell>
        <p className="text-sm text-muted-foreground py-6 text-center">
          {empty === "no_data"
            ? "No position data available right now."
            : "No open paper positions right now. Auto-opens on the next qualifying signal trigger."}
        </p>
      </HeaderShell>
    );
  }

  return (
    <HeaderShell>
      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
            <tr>
              <th className="py-2 pr-3">Contract</th>
              <th className="py-2 pr-3">Side</th>
              <th className="py-2 pr-3">Qty</th>
              <th className="py-2 pr-3 text-right">Entry</th>
              <th
                className="py-2 pr-3 text-right"
                title="Last Traded Price — refreshed live from the option chain on every poll"
              >
                Current
              </th>
              <th className="py-2 pr-3 text-right">Stop</th>
              <th className="py-2 pr-3 text-right">T1</th>
              <th className="py-2 pr-3 text-right">T2</th>
              <th className="py-2 pr-3 text-right">Capital</th>
              <th className="py-2 pr-3 text-right">U. P&amp;L</th>
              <th className="py-2 pr-3 text-right" title="Max favourable / adverse excursion">
                MFE / MAE
              </th>
              <th className="py-2 pr-3">Opened</th>
              <th className="py-2 pr-3">Last eval</th>
              <th className="py-2 pr-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <DesktopRow
                key={p.id}
                p={p}
                now={now}
                onClose={() => onClose(p.id)}
                closing={closingIds.has(p.id)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {rows.map((p) => {
          const row = asRow(p);
          return (
            <FoOpenTradeCard
              key={p.id}
              p={p}
              badges={deriveFoRiskBadges(row, { now, staleMinutes: STALE_MINUTES })}
              pnlPct={deriveFoPnlPct(row)}
              stale={isFoQuoteStale(row, now, STALE_MINUTES)}
              onClose={() => onClose(p.id)}
              closing={closingIds.has(p.id)}
            />
          );
        })}
      </div>
    </HeaderShell>
  );
}
