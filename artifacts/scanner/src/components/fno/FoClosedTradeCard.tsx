/**
 * Mobile-friendly card for a single CLOSED F&O paper trade (read-only display).
 *
 * Pure presentational. All risk/status badges, the P25 eligibility chip, the
 * P&L%, and the time-in-trade come from accepted pure helpers in
 * `foCockpitView.ts` and are passed in / computed from existing fields only.
 * This component derives NO trading logic and recomputes NO strategy. It places
 * NO orders and exposes NO close/modify action — closed trades are immutable.
 */
import type { FoBadge, FoBadgeTone, P25Display, FoTradeRow } from "@/lib/foCockpitView";
import { FoRiskBadges } from "./FoRiskBadges";
import {
  fmtPremium,
  fmtInt,
  fmtInr,
  fmtInrDec,
  fmtDateTime,
  pnlTone,
} from "./FoOpenTradeCard";

const DASH = "—";

/** Closed F&O paper trade as returned by `/paper/trades/fo` (MFE/MAE omitted). */
export interface FoClosedTrade {
  id: string;
  signalDate: string;
  indexSymbol: string;
  indexName: string;
  setupKey: string;
  direction: "BULLISH" | "BEARISH";
  optionType: "CALL" | "PUT";
  strike: number;
  lots: number;
  lotSize: number;
  entryPremium: number;
  exitPremium: number;
  capitalDeployed: number;
  realizedPnl: number;
  exitReason: "TARGET1_HIT" | "TARGET2_HIT" | "STOPPED" | "EXPIRED" | "MANUAL_OVERRIDE" | "TIME_EXIT_1520";
  openedAt: string;
  exitedAt: string;
  journal?: string | null;
  tags?: string[];
}

/** Map a closed-trade payload row to the shared `FoTradeRow` shape. */
export function asClosedRow(t: FoClosedTrade): FoTradeRow {
  return { ...t, status: "CLOSED" } as FoTradeRow;
}

const P25_TONE_CLASS: Record<FoBadgeTone, string> = {
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
  danger: "border-rose-500/30 bg-rose-500/10 text-rose-200",
  warn: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  info: "border-sky-500/30 bg-sky-500/10 text-sky-200",
  muted: "border-slate-600/50 bg-slate-700/30 text-slate-300",
};

/**
 * Compact P25 eligibility chip. `compact` truncates the long
 * "unavailable from this payload" string for dense table cells, keeping the
 * full text in the `title` tooltip — the full sentence is always shown verbatim
 * in the card body and the "Why this trade?" drawer.
 */
export function P25Badge({
  display,
  compact = false,
}: {
  display: P25Display;
  compact?: boolean;
}) {
  const text =
    compact && display.status === "unavailable_from_payload"
      ? "P25 n/a from payload"
      : display.label;
  return (
    <span
      title={display.label}
      className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium leading-tight ${P25_TONE_CLASS[display.tone]}`}
    >
      {text}
    </span>
  );
}

function Field({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className={`tabular-nums ${tone ?? ""}`}>{value}</span>
    </div>
  );
}

const REASON_LABEL: Record<FoClosedTrade["exitReason"], string> = {
  TARGET1_HIT: "Target 1 hit",
  TARGET2_HIT: "Target 2 hit",
  STOPPED: "Stopped out",
  EXPIRED: "Expired",
  MANUAL_OVERRIDE: "Manual close",
  TIME_EXIT_1520: "Time exit 1520",
};

export function fmtExitReason(reason: string | null | undefined): string {
  if (!reason) return DASH;
  return REASON_LABEL[reason as FoClosedTrade["exitReason"]] ?? reason;
}

export function FoClosedTradeCard({
  t,
  badges,
  p25,
  pnlPct,
  timeInTrade,
  expanded,
  onToggle,
  children,
}: {
  t: FoClosedTrade;
  badges: FoBadge[];
  p25: P25Display;
  pnlPct: number | null;
  timeInTrade: string;
  expanded: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  const totalQty =
    Number.isFinite(t.lots) && Number.isFinite(t.lotSize) ? t.lots * t.lotSize : NaN;
  return (
    <div className="rounded-lg border border-border bg-card/40 p-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium">{t.indexSymbol || DASH}</div>
          <div className="text-[11px] text-muted-foreground">
            {t.optionType} {fmtInt(t.strike)} · {t.setupKey || DASH}
          </div>
        </div>
        <span
          className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
            t.direction === "BULLISH"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
              : "border-rose-500/30 bg-rose-500/10 text-rose-200"
          }`}
        >
          {t.direction || DASH}
        </span>
      </div>

      <FoRiskBadges badges={badges} />
      <div>
        <P25Badge display={p25} />
      </div>

      <div className="grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
        <Field label="Entry" value={fmtPremium(t.entryPremium)} />
        <Field label="Exit" value={fmtPremium(t.exitPremium)} />
        <Field label="Qty" value={`${fmtInt(t.lots)}×${fmtInt(t.lotSize)} = ${fmtInt(totalQty)}`} />
        <Field label="Capital" value={fmtInr(t.capitalDeployed)} />
        <Field
          label="Realised P&L"
          value={`${fmtInrDec(t.realizedPnl)}${pnlPct == null ? "" : ` (${(pnlPct * 100).toFixed(2)}%)`}`}
          tone={pnlTone(t.realizedPnl)}
        />
        <Field label="Exit reason" value={fmtExitReason(t.exitReason)} />
        <Field label="Opened" value={fmtDateTime(t.openedAt)} />
        <Field label="Exited" value={fmtDateTime(t.exitedAt)} />
        <Field label="Time in trade" value={timeInTrade} />
      </div>

      <button
        type="button"
        onClick={onToggle}
        className="text-[12px] font-medium text-sky-300 hover:text-sky-200"
        aria-expanded={expanded}
      >
        {expanded ? "Hide details" : "Why this trade?"}
      </button>

      {expanded && children}
    </div>
  );
}
