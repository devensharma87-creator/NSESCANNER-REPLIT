/**
 * Mobile-friendly card for a single OPEN F&O paper position.
 *
 * Pure presentational. All risk/status badges and P&L% are computed upstream by
 * accepted pure helpers (`deriveFoRiskBadges`, `deriveFoPnlPct`) and passed in.
 * This component derives NO trading logic and recomputes NO strategy. The Close
 * action is the pre-existing manual close (lifted into the container), passed in
 * via `onClose`/`closing` — no new close semantics are introduced here.
 */
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { FoBadge } from "@/lib/foCockpitView";
import { FoRiskBadges } from "./FoRiskBadges";

export interface FoOpenPosition {
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
  stopPremium: number;
  target1Premium: number;
  target2Premium: number;
  capitalDeployed: number;
  lastPremium: number;
  unrealizedPnl: number;
  maxRunup?: number | null;
  maxDrawdown?: number | null;
  openedAt: string;
  lastEvaluatedAt: string;
}

const DASH = "—";

export function fmtPremium(n: number | null | undefined): string {
  return Number.isFinite(n as number) ? (n as number).toFixed(2) : DASH;
}
export function fmtInt(n: number | null | undefined): string {
  return Number.isFinite(n as number) ? String(Math.round(n as number)) : DASH;
}
export function fmtInr(n: number | null | undefined): string {
  if (!Number.isFinite(n as number)) return DASH;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n as number);
}
export function fmtInrDec(n: number | null | undefined): string {
  if (!Number.isFinite(n as number)) return DASH;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n as number);
}
export function fmtPct(frac: number | null | undefined): string {
  if (frac == null || !Number.isFinite(frac)) return DASH;
  const sign = frac > 0 ? "+" : "";
  return `${sign}${(frac * 100).toFixed(2)}%`;
}
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return DASH;
  return new Date(ms).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
export function pnlTone(n: number | null | undefined): string {
  if (!Number.isFinite(n as number) || (n as number) === 0) return "text-foreground";
  return (n as number) > 0 ? "text-emerald-300" : "text-rose-300";
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

export function FoOpenTradeCard({
  p,
  badges,
  pnlPct,
  stale,
  onClose,
  closing,
}: {
  p: FoOpenPosition;
  badges: FoBadge[];
  pnlPct: number | null;
  stale: boolean;
  onClose: () => void;
  closing: boolean;
}) {
  const totalQty = Number.isFinite(p.lots) && Number.isFinite(p.lotSize)
    ? p.lots * p.lotSize
    : NaN;
  const hasMfe = Number.isFinite(p.maxRunup as number);
  const hasMae = Number.isFinite(p.maxDrawdown as number);
  return (
    <div className="rounded-lg border border-border bg-card/40 p-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium">{p.indexSymbol || DASH}</div>
          <div className="text-[11px] text-muted-foreground">
            {p.optionType} {fmtInt(p.strike)} · {p.setupKey || DASH}
          </div>
        </div>
        <Badge variant={p.direction === "BULLISH" ? "default" : "destructive"}>
          {p.direction}
        </Badge>
      </div>

      <FoRiskBadges badges={badges} />

      <div className="grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
        <Field label="Entry" value={fmtPremium(p.entryPremium)} />
        <Field label="Current" value={fmtPremium(p.lastPremium)} />
        <Field label="Stop" value={fmtPremium(p.stopPremium)} tone="text-rose-300" />
        <Field label="Target 1" value={fmtPremium(p.target1Premium)} tone="text-emerald-300" />
        <Field label="Target 2" value={fmtPremium(p.target2Premium)} tone="text-emerald-300" />
        <Field label="Qty" value={`${fmtInt(p.lots)}×${fmtInt(p.lotSize)} = ${fmtInt(totalQty)}`} />
        <Field label="Capital" value={fmtInr(p.capitalDeployed)} />
        <Field
          label="U. P&L"
          value={`${fmtInrDec(p.unrealizedPnl)}${pnlPct == null ? "" : ` (${fmtPct(pnlPct)})`}`}
          tone={pnlTone(p.unrealizedPnl)}
        />
        <Field
          label="MFE / MAE"
          value={hasMfe || hasMae ? `${fmtInrDec(p.maxRunup)} / ${fmtInrDec(p.maxDrawdown)}` : DASH}
        />
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        <span className="text-[11px] text-muted-foreground">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full mr-1.5 ${
              stale ? "bg-amber-400" : "bg-emerald-400"
            }`}
          />
          Last eval {fmtDateTime(p.lastEvaluatedAt)}
        </span>
        <Button size="sm" variant="outline" disabled={closing} onClick={onClose}>
          {closing ? "Closing…" : "Close"}
        </Button>
      </div>
    </div>
  );
}
