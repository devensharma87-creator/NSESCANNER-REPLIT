/**
 * F&O P25 Evidence Detail Panel (display-only).
 *
 * Explains the OFFICIAL P25 evidence count surfaced by the server's
 * `/paper/analytics/fo/shadow-exits` endpoint: the eligible eligible-trade
 * count (`mfeAvailableCount`), the threshold, remaining trades, gate status,
 * raw/processed row counts, the "excluded / not MFE-available" derivation, a
 * low-sample warning, and per-index / per-setup / per-tier breakdowns when the
 * payload carries them.
 *
 * This panel is EVIDENCE ONLY. It places NO orders and changes NO exit rule,
 * partial-booking, breakeven-trail, stop, target, sizing, gate, confluence, the
 * P25 tracker logic, or the P25 threshold. It reads the server's official
 * `mfeAvailableCount` exclusively — never a raw non-null MFE/MAE count — so it
 * can never display an inflated count such as "14/20" as official.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  classifyP25PanelError,
  type P25EvidenceDetail,
  type P25BreakdownRow,
} from "@/lib/foCockpitView";

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);

const signedInr = (n: number) => `${n >= 0 ? "+" : ""}${inr(n)}`;
const intOrDash = (n: number | null) =>
  n != null && Number.isFinite(n) ? String(n) : "—";

export function FoP25EvidencePanel({
  detail,
  loading,
  error,
  errorStatus = null,
}: {
  detail: P25EvidenceDetail;
  loading: boolean;
  error: string | null;
  errorStatus?: number | null;
}) {
  const errorKind = classifyP25PanelError({ status: errorStatus, message: error });
  const hasBreakdown =
    detail.byIndex.length > 0 ||
    detail.bySetup.length > 0 ||
    detail.byTier.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>F&amp;O P25 Evidence — Detail</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Headline detail={detail} />

        <SafetyLabels />

        {errorKind ? (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            {errorKind === "auth"
              ? "Evidence detail is owner-only — sign in as the owner to view P25 evidence."
              : "P25 evidence is temporarily unavailable (network error). Retrying automatically."}
          </div>
        ) : loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : detail.enabled === false ? (
          <div className="rounded-md border border-slate-700/60 bg-slate-900/40 px-3 py-2 text-xs text-slate-300">
            Shadow-exits reporting is disabled — P25 evidence is suppressed. No
            count, threshold, or gate change is implied.
          </div>
        ) : !detail.available ? (
          <div className="rounded-md border border-slate-700/60 bg-slate-900/40 px-3 py-2 text-xs text-slate-300">
            Awaiting shadow-exits data — the official eligible count is not yet
            available. Threshold remains {detail.threshold}.
          </div>
        ) : (
          <>
            <EvidenceMath detail={detail} />

            {hasBreakdown ? (
              <div className="space-y-3">
                <BreakdownTable title="By index" rows={detail.byIndex} />
                <BreakdownTable title="By setup" rows={detail.bySetup} />
                <BreakdownTable title="By tier" rows={detail.byTier} />
              </div>
            ) : (
              <div className="rounded-md border border-slate-700/60 bg-slate-900/40 px-3 py-2 text-xs text-slate-400">
                No eligible evidence rows yet — breakdowns will populate as
                closed F&amp;O paper trades accumulate real MFE/MAE movement.
              </div>
            )}
          </>
        )}

        <ExplanationBox />
      </CardContent>
    </Card>
  );
}

function Headline({ detail }: { detail: P25EvidenceDetail }) {
  const tone =
    detail.gateStatus === "THRESHOLD_MET"
      ? "border-emerald-500/30 bg-emerald-500/10"
      : detail.gateStatus === "OPEN"
        ? "border-amber-500/30 bg-amber-500/10"
        : "border-slate-700/60 bg-slate-900/40";

  const badgeTone =
    detail.gateStatus === "THRESHOLD_MET"
      ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-200"
      : detail.gateStatus === "OPEN"
        ? "border-amber-500/30 bg-amber-500/15 text-amber-200"
        : "border-slate-600/60 bg-slate-800/40 text-slate-300";

  const gateText =
    detail.gateStatus === "THRESHOLD_MET"
      ? "Gate: THRESHOLD MET"
      : detail.gateStatus === "OPEN"
        ? "Gate: OPEN"
        : "Gate: unavailable";

  return (
    <div className={`rounded-lg border ${tone} px-4 py-3`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Official P25 evidence (server-computed eligible count)
        </span>
        <span className="text-[11px] text-muted-foreground">
          Evidence only — no live exit change approved
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-2xl font-semibold tabular-nums text-foreground">
          {detail.ratioLabel}
        </span>
        <span className="text-sm text-muted-foreground">
          {detail.available
            ? `Remaining: ${detail.remaining} of ${detail.threshold}`
            : `awaiting data · threshold ${detail.threshold}`}
        </span>
        <span
          className={`rounded-full border px-2 py-0.5 text-[11px] ${badgeTone}`}
        >
          {gateText}
        </span>
      </div>
    </div>
  );
}

function SafetyLabels() {
  return (
    <div className="space-y-1 rounded-md border border-slate-700/60 bg-slate-900/40 px-3 py-2 text-[11px] text-slate-300">
      <p>P25 gate remains open until 20 eligible MFE/MAE trades are collected.</p>
      <p>
        This panel does not activate partial booking, breakeven trail, stop
        changes, or target changes.
      </p>
    </div>
  );
}

function EvidenceMath({ detail }: { detail: P25EvidenceDetail }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Tile
          label="Official eligible (P25)"
          value={intOrDash(detail.officialCount)}
          hint="server mfeAvailableCount"
        />
        <Tile label="Threshold" value={String(detail.threshold)} />
        <Tile label="Remaining" value={intOrDash(detail.remaining)} />
        <Tile label="Raw rows" value={intOrDash(detail.rawRowCount)} />
        <Tile label="Processed rows" value={intOrDash(detail.processedRowCount)} />
        <Tile
          label="Excluded / not MFE-available rows"
          value={intOrDash(detail.excludedNotMfeAvailable)}
          hint="processed − eligible"
        />
      </div>

      {detail.lowSampleWarning === true && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Low sample: fewer than{" "}
          {detail.lowSampleThreshold ?? detail.threshold} eligible trades — treat
          any shadow-exit signal as directional, not conclusive.
        </div>
      )}
    </div>
  );
}

function BreakdownTable({
  title,
  rows,
}: {
  title: string;
  rows: P25BreakdownRow[];
}) {
  if (rows.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-md border border-slate-700/60">
      <div className="bg-slate-800/40 px-3 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-slate-500">
            <th className="px-3 py-1.5 font-medium">Name</th>
            <th className="px-3 py-1.5 text-right font-medium">Trades</th>
            <th className="px-3 py-1.5 text-right font-medium">Eligible</th>
            <th className="px-3 py-1.5 text-right font-medium">Actual P&amp;L</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.name}-${i}`} className="border-t border-slate-800/60">
              <td className="px-3 py-1.5 text-slate-300">{r.name}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-slate-300">
                {intOrDash(r.trades)}
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums text-slate-300">
                {intOrDash(r.eligible)}
              </td>
              <td
                className={`px-3 py-1.5 text-right tabular-nums ${
                  r.pnl == null
                    ? "text-slate-400"
                    : r.pnl > 0
                      ? "text-emerald-300"
                      : r.pnl < 0
                        ? "text-rose-300"
                        : "text-slate-300"
                }`}
              >
                {r.pnl == null ? "—" : signedInr(r.pnl)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExplanationBox() {
  return (
    <div className="rounded-md border border-slate-700/60 bg-slate-900/40 px-3 py-2 text-[11px] leading-relaxed text-slate-400">
      A trade counts for P25 only when it is closed, has valid exit premium,
      valid entry premium, valid quantity, and real MFE/MAE movement. 0/0
      placeholder rows do not count.
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-md bg-slate-800/30 px-3 py-2">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-lg font-semibold tabular-nums text-foreground">
        {value}
      </span>
      {hint && <span className="text-[10px] text-slate-500">{hint}</span>}
    </div>
  );
}
