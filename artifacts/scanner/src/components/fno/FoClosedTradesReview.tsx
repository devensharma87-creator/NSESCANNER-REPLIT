/**
 * Read-only review of the day's CLOSED F&O paper trades.
 *
 * Desktop: dense table with an expandable "Why this trade?" detail row.
 * Mobile (<md): stacked cards with the same expandable drawer.
 *
 * Every badge, P&L%, time-in-trade, and P25 eligibility chip comes from accepted
 * pure helpers in `foCockpitView.ts`. This component derives NO trading logic,
 * recomputes NO strategy, joins NO reasoning, and places/modifies NO orders.
 *
 * P25 NOTE: `/paper/trades/fo` now carries read-only `maxRunup`/`maxDrawdown`
 * (added for the exit-clarity UI), but per-trade P25 eligibility is intentionally
 * still treated as unknowable here — flipping that is a separate, out-of-scope
 * behaviour change. We keep passing `mfeMaeInPayload: false` to `deriveP25Display`,
 * which honestly renders "unavailable from this payload" instead of guessing. The
 * OFFICIAL P25 count remains the server's
 * `mfeAvailableCount` shown by the separate evidence panel — never recomputed
 * from these rows.
 */
import { Fragment, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  deriveFoRiskBadges,
  deriveFoPnlPct,
  deriveP25Display,
  getTimeInTradeMs,
  formatDurationShort,
  type FoTradeRow,
} from "@/lib/foCockpitView";
import { FoRiskBadges } from "./FoRiskBadges";
import {
  FoClosedTradeCard,
  P25Badge,
  fmtExitReason,
  asClosedRow,
  type FoClosedTrade,
} from "./FoClosedTradeCard";
import { FoWhyThisTrade } from "./FoWhyThisTrade";
import {
  fmtPremium,
  fmtInt,
  fmtInr,
  fmtInrDec,
  fmtDateTime,
  pnlTone,
  ExitMonitorBadge,
  TelegramStatusBadge,
} from "./FoOpenTradeCard";

const DASH = "—";

// `/paper/trades/fo` does not include MFE/MAE — eligibility is unknowable here.
const MFE_MAE_IN_PAYLOAD = false;
const WHY_COLSPAN = 11;

function HeaderShell({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Closed F&amp;O Trades — Today</CardTitle>
        <CardDescription>
          Paper trading only — read-only review of trades closed today. Expand any
          row for the full "Why this trade?" detail. Per-trade P25 eligibility is
          not derivable from this endpoint; the official count lives in the
          evidence panel above.
        </CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function deriveView(t: FoClosedTrade) {
  const row: FoTradeRow = asClosedRow(t);
  return {
    row,
    badges: deriveFoRiskBadges(row),
    p25: deriveP25Display(row, { mfeMaeInPayload: MFE_MAE_IN_PAYLOAD }),
    pnlPct: deriveFoPnlPct(row),
    timeInTrade: formatDurationShort(getTimeInTradeMs(row)),
  };
}

function DesktopRow({
  t,
  expanded,
  onToggle,
}: {
  t: FoClosedTrade;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { badges, p25, pnlPct, timeInTrade } = deriveView(t);
  const totalQty =
    Number.isFinite(t.lots) && Number.isFinite(t.lotSize) ? t.lots * t.lotSize : NaN;
  return (
    <>
      <tr className="border-b border-border/40 align-top">
        <td className="py-2 pr-3">
          <div className="font-medium">{t.indexSymbol || DASH}</div>
          <div className="text-[11px] text-muted-foreground">
            {t.optionType} {fmtInt(t.strike)} · {t.setupKey || DASH}
          </div>
          <FoRiskBadges badges={badges} className="mt-1" />
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <P25Badge display={p25} compact />
            <ExitMonitorBadge
              status={t.exitMonitorStatus}
              tradeGrade={t.exitTradeGrade}
              quoteSource={t.exitQuoteSource}
              freshnessSec={t.exitQuoteFreshnessSec}
              lastCheckAt={t.lastExitCheckAt}
              lastCheckError={t.lastExitCheckError}
            />
            <TelegramStatusBadge status={t.telegramStatus} />
          </div>
        </td>
        <td className="py-2 pr-3">
          <span
            className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
              t.direction === "BULLISH"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                : "border-rose-500/30 bg-rose-500/10 text-rose-200"
            }`}
          >
            {t.direction || DASH}
          </span>
        </td>
        <td className="py-2 pr-3 tabular-nums whitespace-nowrap">
          {fmtInt(t.lots)}×{fmtInt(t.lotSize)}
          <div className="text-[11px] text-muted-foreground">= {fmtInt(totalQty)}</div>
        </td>
        <td className="py-2 pr-3 text-right tabular-nums">{fmtPremium(t.entryPremium)}</td>
        <td className="py-2 pr-3 text-right tabular-nums">{fmtPremium(t.exitPremium)}</td>
        <td className="py-2 pr-3 text-right tabular-nums">{fmtInr(t.capitalDeployed)}</td>
        <td className={`py-2 pr-3 text-right tabular-nums font-medium ${pnlTone(t.realizedPnl)}`}>
          {fmtInrDec(t.realizedPnl)}
          <div className="text-[11px] font-normal text-muted-foreground">
            {pnlPct == null ? DASH : `${(pnlPct * 100).toFixed(2)}%`}
          </div>
        </td>
        <td className="py-2 pr-3 text-[12px] whitespace-nowrap">{fmtExitReason(t.exitReason)}</td>
        <td className="py-2 pr-3 text-[12px] text-muted-foreground whitespace-nowrap">
          <div>{fmtDateTime(t.openedAt)}</div>
          <div>{fmtDateTime(t.exitedAt)}</div>
        </td>
        <td className="py-2 pr-3 text-[12px] text-muted-foreground whitespace-nowrap">
          {timeInTrade}
        </td>
        <td className="py-2 pr-3 text-right">
          <button
            type="button"
            onClick={onToggle}
            className="text-[12px] font-medium text-sky-300 hover:text-sky-200"
            aria-expanded={expanded}
          >
            {expanded ? "Hide" : "Why?"}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-border/40">
          <td colSpan={WHY_COLSPAN} className="pb-3">
            <FoWhyThisTrade t={t} p25={p25} pnlPct={pnlPct} timeInTrade={timeInTrade} />
          </td>
        </tr>
      )}
    </>
  );
}

export interface FoClosedGroup {
  key: string;
  trades: FoClosedTrade[];
}

export function FoClosedTradesReview({
  groups,
  grouped,
  rawCount,
  isNoData,
  loading,
  error,
}: {
  /** Filtered + sorted trades, partitioned into display groups (empty groups omitted). */
  groups: FoClosedGroup[];
  /** Render group sub-headers (true) or a single flat list (false). */
  grouped: boolean;
  /** Count of closed trades BEFORE filtering — distinguishes "none today" from "filtered out". */
  rawCount: number;
  /** The `/paper/trades/fo` query returned null/undefined (no data yet). */
  isNoData: boolean;
  loading: boolean;
  error: string | null;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const toggle = (id: string) => setExpandedId((cur) => (cur === id ? null : id));

  if (error) {
    return (
      <HeaderShell>
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-4 text-sm text-rose-200">
          Could not load closed trades: {error}
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

  const shown = groups.reduce((n, g) => n + g.trades.length, 0);
  if (shown === 0) {
    const message = isNoData
      ? "No closed-trade data available right now."
      : rawCount === 0
        ? "No F&O paper trades have closed today yet."
        : "No F&O rows match the selected filters. Reset filters to view all.";
    return (
      <HeaderShell>
        <p className="text-sm text-muted-foreground py-6 text-center">{message}</p>
      </HeaderShell>
    );
  }

  const visibleGroups = groups.filter((g) => g.trades.length > 0);

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
              <th className="py-2 pr-3 text-right">Exit</th>
              <th className="py-2 pr-3 text-right">Capital</th>
              <th className="py-2 pr-3 text-right">Realised P&amp;L</th>
              <th className="py-2 pr-3">Exit reason</th>
              <th className="py-2 pr-3">Opened / Exited</th>
              <th className="py-2 pr-3">In trade</th>
              <th className="py-2 pr-3"></th>
            </tr>
          </thead>
          <tbody>
            {visibleGroups.map((g) => (
              <Fragment key={g.key}>
                {grouped && (
                  <tr className="bg-muted/30">
                    <td
                      colSpan={WHY_COLSPAN}
                      className="py-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      {g.key} · {g.trades.length}
                    </td>
                  </tr>
                )}
                {g.trades.map((t) => (
                  <DesktopRow
                    key={t.id}
                    t={t}
                    expanded={expandedId === t.id}
                    onToggle={() => toggle(t.id)}
                  />
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {visibleGroups.map((g) => (
          <div key={g.key} className="space-y-3">
            {grouped && (
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {g.key} · {g.trades.length}
              </div>
            )}
            {g.trades.map((t) => {
              const { badges, p25, pnlPct, timeInTrade } = deriveView(t);
              const expanded = expandedId === t.id;
              return (
                <FoClosedTradeCard
                  key={t.id}
                  t={t}
                  badges={badges}
                  p25={p25}
                  pnlPct={pnlPct}
                  timeInTrade={timeInTrade}
                  expanded={expanded}
                  onToggle={() => toggle(t.id)}
                >
                  <FoWhyThisTrade t={t} p25={p25} pnlPct={pnlPct} timeInTrade={timeInTrade} />
                </FoClosedTradeCard>
              );
            })}
          </div>
        ))}
      </div>
    </HeaderShell>
  );
}
