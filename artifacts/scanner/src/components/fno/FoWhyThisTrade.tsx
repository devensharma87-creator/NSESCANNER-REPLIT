/**
 * Read-only "Why this trade?" detail drawer for a CLOSED F&O paper trade.
 *
 * Shows ONLY fields that already exist on the trade payload, plus the accepted
 * display-only P25 chip. It derives NO trading decisions, fabricates NO signal
 * reasoning, and recomputes NO strategy. Reasoning / gate / data-source notes
 * are NOT safely joinable from `/paper/trades/fo` (which omits MFE/MAE and the
 * reasoning fingerprint), so they render as honest "not available" placeholders
 * rather than guessed values.
 */
import type { P25Display, FoTradeRow } from "@/lib/foCockpitView";
import { toNum } from "@/lib/foCockpitView";
import { P25Badge, fmtExitReason, type FoClosedTrade } from "./FoClosedTradeCard";
import { fmtPremium, fmtInt, fmtInr, fmtInrDec, fmtDateTime, pnlTone } from "./FoOpenTradeCard";

const DASH = "—";

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className={`text-sm text-right tabular-nums ${tone ?? ""}`}>{value}</span>
    </div>
  );
}

export function FoWhyThisTrade({
  t,
  p25,
  pnlPct,
  timeInTrade,
}: {
  t: FoClosedTrade;
  p25: P25Display;
  pnlPct: number | null;
  timeInTrade: string;
}) {
  const row = { ...t, status: "CLOSED" } as FoTradeRow;
  const confidence = toNum((row as { confidence?: unknown }).confidence as never);
  const totalQty =
    Number.isFinite(t.lots) && Number.isFinite(t.lotSize) ? t.lots * t.lotSize : NaN;
  const tags = (t.tags ?? []).filter((x) => typeof x === "string" && x.trim() !== "");

  return (
    <div className="mt-2 rounded-md border border-border bg-background/60 p-3 space-y-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Why this trade?
      </div>

      {/* Contract & setup */}
      <div className="grid gap-x-6 sm:grid-cols-2">
        <Row label="Index" value={t.indexSymbol || DASH} />
        <Row label="Setup" value={t.setupKey || DASH} />
        <Row label="Direction" value={t.direction || DASH} />
        <Row label="Option" value={`${t.optionType ?? DASH} ${fmtInt(t.strike)}`} />
        <Row
          label="Lots / Qty"
          value={`${fmtInt(t.lots)}×${fmtInt(t.lotSize)} = ${fmtInt(totalQty)}`}
        />
        <Row label="Capital" value={fmtInr(t.capitalDeployed)} />
      </div>

      {/* Pricing & outcome */}
      <div className="grid gap-x-6 sm:grid-cols-2 border-t border-border/60 pt-2">
        <Row label="Entry premium" value={fmtPremium(t.entryPremium)} />
        <Row label="Exit premium" value={fmtPremium(t.exitPremium)} />
        <Row
          label="Realised P&L"
          value={`${fmtInrDec(t.realizedPnl)}${pnlPct == null ? "" : ` (${(pnlPct * 100).toFixed(2)}%)`}`}
          tone={pnlTone(t.realizedPnl)}
        />
        <Row label="Exit reason" value={fmtExitReason(t.exitReason)} />
        <Row label="Opened" value={fmtDateTime(t.openedAt)} />
        <Row label="Exited" value={fmtDateTime(t.exitedAt)} />
        <Row label="Time in trade" value={timeInTrade} />
        <Row
          label="Confidence"
          value={Number.isFinite(confidence) ? confidence.toFixed(0) : DASH}
        />
      </div>

      {/* Evidence & journal */}
      <div className="border-t border-border/60 pt-2 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            P25 eligibility
          </span>
          <P25Badge display={p25} />
        </div>
        {p25.status === "unavailable_from_payload" && (
          <p className="text-[11px] text-muted-foreground">
            MFE/MAE is not part of this endpoint, so per-trade P25 eligibility
            cannot be determined here. The official P25 count comes only from the
            server's shadow-exits analytics.
          </p>
        )}

        <Row
          label="Journal"
          value={
            t.journal && t.journal.trim() !== "" ? (
              <span className="font-normal text-foreground/90 normal-case">{t.journal}</span>
            ) : (
              DASH
            )
          }
        />
        <Row
          label="Tags"
          value={
            tags.length > 0 ? (
              <span className="flex flex-wrap justify-end gap-1">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-slate-600/50 bg-slate-700/30 px-2 py-0.5 text-[10px] text-slate-300"
                  >
                    {tag}
                  </span>
                ))}
              </span>
            ) : (
              DASH
            )
          }
        />
      </div>

      {/* Honest placeholders for data this endpoint cannot supply */}
      <div className="border-t border-border/60 pt-2">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Signal reasoning, gate/skip notes, and data-source notes are not
          joinable from this endpoint and are not shown to avoid fabricating
          decisions. They remain available in the diagnostics surfaces.
        </p>
      </div>
    </div>
  );
}
