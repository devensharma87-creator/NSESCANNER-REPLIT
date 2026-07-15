import {
  useGetOptionSignals,
  getGetOptionSignalsQueryKey,
  useGetOptionSignalHistory,
  getGetOptionSignalHistoryQueryKey,
  useGetOptionSignalReport,
  getGetOptionSignalReportQueryKey,
  useGetOptionSignalReportDates,
  getGetOptionSignalReportDatesQueryKey,
  getExportOptionSignalReportUrl,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { DataSourceBadge } from "@/components/ui/data-source-badge";
import { StatusChip, type StatusChipVariant } from "@/components/ui/status-chip";
import { TradingViewAlerts } from "@/components/tradingview-alerts";
import { SignalGateBanner } from "@/components/signal-gate-banner";
import { FnoReasonCategoriesStrip } from "@/components/fno-reason-categories-strip";
import { useToast } from "@/hooks/use-toast";
import {
  TrendingUp, TrendingDown, Target, ShieldAlert, Crosshair, Zap, Activity, Layers, Repeat, RotateCcw,
  Clock, CheckCircle2, XCircle, Hourglass, BarChart3, IndianRupee, Eye,
  Download, FileSpreadsheet, CalendarDays, ChevronLeft, ChevronRight,
  ShieldCheck, Ban, Info, AlertTriangle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  OptionSignal,
  OptionSignalHistoryItem,
} from "@workspace/api-client-react";
import { deriveSetupExplanation } from "@/lib/setupExplanation";
import { useKiteReadiness } from "@/components/global-status-banner";
import { deriveFnoEmptyReason, buildFnoIndexRows, deriveSessionBannerState, type FnoIndexRow, type FnoBannerState } from "@/lib/fnoEmptyState";
import { useFnoNoSignalGap } from "@/lib/fno/diagnostics-fetch";

const API_BASE = import.meta.env.BASE_URL;

async function reconnectKite(): Promise<void> {
  try {
    const r = await fetch(`${API_BASE}api/kite/login-url`, { credentials: "include" });
    if (r.ok) {
      const j = (await r.json()) as { url?: string };
      if (j?.url) { window.location.href = j.url; return; }
    }
  } catch { /* fall through */ }
  window.location.href = `${API_BASE}kite`;
}

/**
 * Owner-only banner shown when all F&O indices are suppressed due to a
 * Kite data issue (session expired, history warming up, etc.).
 * Explicitly labels data issues so the owner doesn't mistake them for
 * a quiet market day.
 */
function FnoKiteSessionBanner({ state }: { state: FnoBannerState }) {
  if (!state.show) return null;
  const { kind, gapTradingDays, lastSignalAt, isDataIssue } = state;

  type K = "KITE_SESSION_EXPIRED" | "FNO_DATA_WARMING_UP" | "FNO_ALL_SUPPRESSED";
  const config: Record<K, { title: string; body: string; tone: string; icon: React.ReactNode }> = {
    KITE_SESSION_EXPIRED: {
      title: "Kite session expired — no F&O signals",
      body: "Signals require a live Kite intraday connection. All F&O indices are suppressed. Renew the session to resume.",
      tone: "border-rose-500/40 bg-rose-500/10",
      icon: <XCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />,
    },
    FNO_DATA_WARMING_UP: {
      title: "F&O data warming up after login",
      body: "Kite historical API is initialising after session renewal. Signals resume automatically in the next cycle (~30 s).",
      tone: "border-amber-500/40 bg-amber-500/10",
      icon: <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />,
    },
    FNO_ALL_SUPPRESSED: {
      title: "All F&O indices suppressed",
      body: "Risk gates, circuit breaker, or market conditions are suppressing all setups right now.",
      tone: "border-amber-500/40 bg-amber-500/10",
      icon: <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />,
    },
  };

  const { title, body, tone, icon } = config[kind];

  return (
    <div className={`rounded-md border px-4 py-3 text-sm ${tone}`}>
      <div className="flex items-start gap-2">
        {icon}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">{title}</span>
            {isDataIssue && (
              <span className="text-[11px] font-mono font-normal text-muted-foreground px-1.5 py-0.5 rounded border border-border/50 shrink-0">
                DATA ISSUE · NOT MARKET CONDITION
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{body}</p>
          <div className="flex items-center gap-4 text-xs mt-1.5 flex-wrap">
            {typeof gapTradingDays === "number" && gapTradingDays > 0 && (
              <span className="font-mono">
                <span className="font-bold">{gapTradingDays}</span>
                {" "}trading day{gapTradingDays !== 1 ? "s" : ""} without a signal
              </span>
            )}
            {lastSignalAt && (
              <span className="text-muted-foreground">
                Last signal {formatDistanceToNow(new Date(lastSignalAt), { addSuffix: true })}
              </span>
            )}
            {kind === "KITE_SESSION_EXPIRED" && (
              <button
                onClick={() => void reconnectKite()}
                className="ml-auto underline font-semibold shrink-0 hover:opacity-80"
              >
                Reconnect Kite →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const SETUP_ICON: Record<string, React.ReactNode> = {
  TREND_CONTINUATION: <Zap className="w-4 h-4" />,
  VWAP_RECLAIM: <Repeat className="w-4 h-4" />,
  VOLUME_BREAKOUT: <Layers className="w-4 h-4" />,
  EMA_PULLBACK: <Activity className="w-4 h-4" />,
  MEAN_REVERSION: <RotateCcw className="w-4 h-4" />,
};

function fmt(n: number | undefined | null) {
  if (n == null) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

function ConfidencePill({ confidence }: { confidence: number }) {
  const tone =
    confidence >= 80 ? "bg-signal-strong-buy/20 text-signal-strong-buy border-signal-strong-buy/40"
      : confidence >= 70 ? "bg-yellow-500/15 text-yellow-400 border-yellow-500/40"
        : "bg-secondary/40 text-muted-foreground border-border/40";
  return <span className={`px-2 py-0.5 rounded border text-[10px] font-mono font-bold ${tone}`}>{confidence}% conf</span>;
}

type LifecycleStatus =
  | "PENDING" | "TRIGGERED" | "TARGET1_HIT" | "TARGET2_HIT" | "STOPPED" | "EXPIRED";

function statusMeta(status: LifecycleStatus | string | undefined): {
  label: string;
  variant: StatusChipVariant;
  icon: React.ReactNode;
} {
  switch (status) {
    case "TRIGGERED":   return { label: "Triggered",    variant: "active",  icon: <Zap className="w-3 h-3" /> };
    case "TARGET1_HIT": return { label: "Target 1 hit", variant: "ok",      icon: <Target className="w-3 h-3" /> };
    case "TARGET2_HIT": return { label: "Target 2 hit", variant: "ok",      icon: <CheckCircle2 className="w-3 h-3" /> };
    case "STOPPED":     return { label: "Stopped out",  variant: "err",     icon: <XCircle className="w-3 h-3" /> };
    case "EXPIRED":     return { label: "Expired",      variant: "info",    icon: <Clock className="w-3 h-3" /> };
    case "PENDING":
    default:            return { label: "Waiting trigger", variant: "pending", icon: <Hourglass className="w-3 h-3" /> };
  }
}

function StatusPill({ status }: { status?: LifecycleStatus | string }) {
  const m = statusMeta(status);
  return (
    <StatusChip
      variant={m.variant}
      icon={m.icon}
      label={m.label}
      testId={`signal-status-${String(status ?? "PENDING").toLowerCase()}`}
    />
  );
}

function fmtIstTime(d: Date | string | undefined | null): string {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  });
}

function fmtRelative(d: Date | string | undefined | null): string {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  return formatDistanceToNow(date, { addSuffix: true });
}

function exitReasonLabel(r?: string | null): string {
  switch (r) {
    case "TARGET1_HIT":      return "T1 hit";
    case "TARGET2_HIT":      return "T2 hit";
    case "STOPPED":          return "stop hit";
    case "EXPIRED_TRIGGERED": return "session ended (trade open)";
    case "EXPIRED_PENDING":  return "session ended (never triggered)";
    case "STALE_TRIGGER":    return "stale (45m flat — trigger expired)";
    default:                 return r ?? "—";
  }
}

// Phase-1 chips. Pure read-only labels — no behaviour change to setup
// emission, just visibility for the trader. Tooltips carry the full
// regimeReason / IVR explanation so the chip stays compact.
const REGIME_TONE: Record<string, string> = {
  TRENDING_BULL: "bg-emerald-500/15 text-emerald-200 border-emerald-500/30",
  TRENDING_BEAR: "bg-rose-500/15 text-rose-200 border-rose-500/30",
  RANGING:       "bg-slate-500/15 text-slate-200 border-slate-500/30",
  VOLATILE:      "bg-amber-500/15 text-amber-200 border-amber-500/30",
  EXPIRY_DAY:    "bg-violet-500/15 text-violet-200 border-violet-500/30",
};
const REGIME_LABEL: Record<string, string> = {
  TRENDING_BULL: "Trending↑",
  TRENDING_BEAR: "Trending↓",
  RANGING:       "Ranging",
  VOLATILE:      "Volatile",
  EXPIRY_DAY:    "Expiry",
};
function RegimeChip({ regime, reason }: { regime: string; reason?: string | null }) {
  const tone = REGIME_TONE[regime] ?? "bg-slate-500/15 text-slate-200 border-slate-500/30";
  const label = REGIME_LABEL[regime] ?? regime;
  return (
    <span
      className={`text-[10px] font-mono uppercase tracking-wider rounded px-1.5 py-0.5 border ${tone}`}
      title={reason ?? `Regime: ${regime}`}
    >
      {label}
    </span>
  );
}

function IvChip({ ivRank, ivPercentile }: { ivRank?: number | null; ivPercentile?: number | null }) {
  // Single chip surfaces both IVR and IVP when available. Colour ramps:
  //   ≥75 → red (rich premiums; long-options bias is expensive),
  //   ≤25 → green (cheap premiums; long-options friendly),
  //   else neutral.
  const primary = ivRank ?? ivPercentile;
  if (primary == null) return null;
  const tone =
    primary >= 75 ? "bg-rose-500/15 text-rose-200 border-rose-500/30" :
    primary <= 25 ? "bg-emerald-500/15 text-emerald-200 border-emerald-500/30" :
                    "bg-slate-500/15 text-slate-200 border-slate-500/30";
  const parts: string[] = [];
  if (ivRank != null) parts.push(`IVR ${Math.round(ivRank)}`);
  if (ivPercentile != null) parts.push(`IVP ${Math.round(ivPercentile)}`);
  return (
    <span
      className={`text-[10px] font-mono uppercase tracking-wider rounded px-1.5 py-0.5 border ${tone}`}
      title={`Trailing-252 ATM IV: rank ${ivRank ?? "—"}, percentile ${ivPercentile ?? "—"}. ≥75 = expensive premium; ≤25 = cheap.`}
    >
      {parts.join(" · ")}
    </span>
  );
}

/**
 * Contract master identity badge — surfaces on the F&O signal card to show
 * whether contract data came from the live Kite instrument dump (trade-grade)
 * or a static fallback. Purely read-only, does not affect signal logic.
 */
function ContractMasterBadge({ leg }: { leg: OptionSignal["leg"] }) {
  const grade = leg.contractGrade;
  const expSrc = leg.expirySource;

  if (!grade && !expSrc) return null;

  const isTradeGrade = grade === "trade_grade";
  const isInfoOnly = grade === "info_only";
  const isFallback = grade === "fallback";
  const isUnavailable = expSrc === "unavailable";

  const containerCls = "mt-1 flex flex-wrap items-center gap-1.5";

  if (isTradeGrade) {
    return (
      <div className={containerCls} data-testid="contract-master-badge">
        <span
          className="inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider rounded px-1.5 py-0.5 border bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
          title={`Contract identity verified in Kite instrument master (${leg.exchange ?? "NFO"}). Trading symbol: ${leg.tradingSymbol ?? "—"}. Token: ${leg.contractInstrumentToken ?? "—"}.`}
        >
          <ShieldCheck className="w-2.5 h-2.5" />
          TRADE-GRADE CONTRACT MASTER
        </span>
        {leg.tradingSymbol && (
          <span className="text-[9px] font-mono text-muted-foreground" title="Kite trading symbol for this contract">
            {leg.tradingSymbol}
          </span>
        )}
        {leg.exchange && (
          <span className="text-[9px] font-mono text-muted-foreground/60">
            {leg.exchange} {leg.expiryType ? `· ${leg.expiryType}` : ""}
          </span>
        )}
      </div>
    );
  }

  if (isInfoOnly) {
    return (
      <div className={containerCls} data-testid="contract-master-badge">
        <span
          className="inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider rounded px-1.5 py-0.5 border bg-amber-500/10 text-amber-300 border-amber-500/30"
          title={`Expiry confirmed in Kite master but this specific strike is not listed. Exchange: ${leg.exchange ?? "—"}. No instrument token available.`}
        >
          <Info className="w-2.5 h-2.5" />
          CONFIRMED EXPIRY · STRIKE UNVERIFIED
        </span>
        {leg.exchange && (
          <span className="text-[9px] font-mono text-muted-foreground/60">
            {leg.exchange}
          </span>
        )}
      </div>
    );
  }

  if (isUnavailable || isFallback) {
    return (
      <div className={containerCls} data-testid="contract-master-badge">
        <span
          className="inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider rounded px-1.5 py-0.5 border bg-rose-500/10 text-rose-400 border-rose-500/30"
          title={isUnavailable
            ? "Kite instrument cache is cold — contract identity unavailable. All lot/strike sizes from static maps."
            : "Contract data from static fallback maps — instrument master not consulted. Expiry/strike may differ from actual listed contract."}
        >
          <AlertTriangle className="w-2.5 h-2.5" />
          {isUnavailable ? "UNAVAILABLE CONTRACT MASTER" : "FALLBACK CONTRACT DATA"}
        </span>
      </div>
    );
  }

  return null;
}

function SetupCard({ sig, planNumber, totalPlans }: { sig: OptionSignal; planNumber: number; totalPlans: number }) {
  const isCall = sig.leg.type === "CALL";
  const tone = isCall ? "border-signal-strong-buy/30 bg-signal-strong-buy/[0.04]" : "border-signal-strong-sell/30 bg-signal-strong-sell/[0.04]";
  const accent = isCall ? "text-signal-strong-buy" : "text-signal-strong-sell";

  // Levels-on-bar: visualise stop / entry / spot / target1 / target2 on a horizontal scale
  const lvls = [sig.leg.stopLoss, sig.leg.entry, sig.spot, sig.leg.target1, sig.leg.target2].filter(
    (n): n is number => typeof n === "number",
  );
  const min = Math.min(...lvls);
  const max = Math.max(...lvls);
  const span = Math.max(1e-6, max - min);
  const pct = (v: number | undefined | null) => (v == null ? null : ((v - min) / span) * 100);

  const risk = sig.leg.stopLoss != null && sig.leg.entry != null ? Math.abs(sig.leg.entry - sig.leg.stopLoss) : null;
  const reward = sig.leg.target1 != null && sig.leg.entry != null ? Math.abs(sig.leg.target1 - sig.leg.entry) : null;

  return (
    <div className={`rounded-md border ${tone} p-3 space-y-3`}>
      {/* Header — setup is the primary identifier; strike is secondary because it's
          shared across every plan for this index. */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider">
            <span className="px-1.5 py-0.5 rounded bg-secondary/60 text-foreground border border-border/40">
              Plan {planNumber} of {totalPlans}
            </span>
            <span className="flex items-center gap-1 text-muted-foreground">
              {SETUP_ICON[sig.setupKey ?? ""] ?? <Crosshair className="w-3 h-3" />}
              {sig.setupName ?? "Setup"}
            </span>
          </div>
          <div className={`mt-1.5 font-bold font-mono text-base flex items-center gap-2 ${accent}`}>
            {isCall ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
            <span>BUY {sig.leg.type} · {sig.index} {fmt(sig.leg.strike)}</span>
          </div>
          <div className="text-[10px] font-mono text-muted-foreground mt-0.5">
            {sig.leg.expiry ? <>expiry {sig.leg.expiry} · </> : null}
            ATM strike (same across plans)
          </div>
          <ContractMasterBadge leg={sig.leg} />
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <ConfidencePill confidence={sig.confidence} />
          <StatusPill status={sig.status} />
          {sig.leg.riskRewardRatio != null && (
            <span className="text-[10px] font-mono text-muted-foreground">RR {sig.leg.riskRewardRatio}:1</span>
          )}
          {sig.regime && <RegimeChip regime={sig.regime} reason={sig.regimeReason} />}
          {(sig.ivRank != null || sig.ivPercentile != null) && (
            <IvChip ivRank={sig.ivRank} ivPercentile={sig.ivPercentile} />
          )}
          {/* Live signal recalculation badge — shows the timestamp of the latest
              server-side re-evaluation so the trader knows data freshness. */}
          {sig.generatedAt && (
            <span
              className="text-[10px] font-mono text-muted-foreground/70 flex items-center gap-1"
              title={`Signal re-evaluated at ${fmtIstTime(sig.generatedAt)} IST`}
              data-testid="badge-live-signal"
            >
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live signal · {fmtIstTime(sig.generatedAt)}
            </span>
          )}
        </div>
      </div>

      {/* Trade thesis */}
      {sig.setupSummary && (
        <p className="text-xs text-muted-foreground leading-relaxed">{sig.setupSummary}</p>
      )}

      {/* Entry trigger */}
      {sig.entryTrigger && (
        <div className="rounded bg-background/60 border border-border/40 px-2 py-1.5 text-[11px] font-mono">
          <span className="text-muted-foreground uppercase tracking-wider mr-1">Trigger:</span>
          <span className="text-foreground">{sig.entryTrigger}</span>
        </div>
      )}

      {/* Levels grid — labelled "SPOT …" so it's unmistakable these are index levels,
          not option premium. Each plan computes its own levels from a different formula
          (swing-high vs VWAP offset vs VAH vs EMA21), which is why two plans on the same
          strike show different numbers. */}
      <div>
        <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
          Underlying ({sig.index}) levels — manage by spot, not by option price
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
          <Cell label="Spot Entry" value={fmt(sig.leg.entry)} icon={<Crosshair className="w-3 h-3" />} bold />
          <Cell label="Spot Stop" value={fmt(sig.leg.stopLoss)} icon={<ShieldAlert className="w-3 h-3 text-signal-strong-sell" />} />
          <Cell label="Spot T1" value={fmt(sig.leg.target1)} icon={<Target className="w-3 h-3 text-signal-strong-buy" />} />
          <Cell label="Spot T2" value={fmt(sig.leg.target2)} icon={<Target className="w-3 h-3 text-signal-strong-buy/60" />} />
        </div>
      </div>

      {/* P0-00 — Option premiums are rendered as TWO honestly-separated
          sections:
            1. LOCKED PLAN — the immutable plan of record from the DB row
               (premiums lock once at first enrichment and never change).
            2. LIVE MTM — this cycle's re-projection for the CURRENT ATM
               strike; display-only, explicitly NOT the plan.
          Before P0-00 the card showed only the live re-projection labelled as
          the plan, so "the plan" silently drifted every 30s poll. When the
          server composition is unavailable (planSnapshot missing) we fall
          back to the legacy single grid rather than hide premiums. */}
      {sig.planSnapshot ? (
        <div className="space-y-2">
          <div data-testid="plan-locked-section">
            <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1.5 flex-wrap">
              <IndianRupee className="w-3 h-3" />
              <span>
                Locked plan ({sig.leg.type === "CALL" ? "CE" : "PE"} {fmt(sig.planSnapshot.strike)}) — plan of record
              </span>
              {sig.planSnapshot.premiumLockedAt && (
                <span className="text-foreground/70 normal-case tracking-normal">
                  · premiums locked {fmtIstTime(sig.planSnapshot.premiumLockedAt)} IST
                </span>
              )}
              {sig.planRevised && (
                <span
                  className="inline-flex items-center gap-1 rounded bg-amber-500/15 text-amber-500 px-1.5 py-0.5 normal-case tracking-normal"
                  title="This plan has a sanctioned correction in the plan-audit ledger. The values shown are the revised plan of record."
                  data-testid="plan-revised-badge"
                >
                  <AlertTriangle className="w-3 h-3" /> Plan revised
                </span>
              )}
            </div>
            {sig.planSnapshot.legacyPlanFields ? (
              <div
                className="text-[10px] font-mono text-amber-500/90 border border-dashed border-amber-500/40 rounded px-2 py-1.5 leading-relaxed"
                data-testid="plan-legacy-warning"
              >
                <span className="uppercase tracking-wider mr-1">Premium plan not locked:</span>
                the option chain was unavailable (or the ATM strike had drifted) every cycle since emission, so no premium plan was ever locked for this row. The spot plan above is the plan of record — do not treat the live premiums below as a plan.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs font-mono" data-testid="plan-locked-grid">
                  <Cell label="Plan Entry" value={`₹${fmt(sig.planSnapshot.entryPremiumPlanned)}`} icon={<Crosshair className="w-3 h-3" />} bold />
                  <Cell label="Plan T1" value={`₹${fmt(sig.planSnapshot.target1PremiumPlanned)}`} icon={<Target className="w-3 h-3 text-signal-strong-buy" />} />
                  <Cell label="Plan SL" value={`₹${fmt(sig.planSnapshot.stopPremiumPlanned)}`} icon={<ShieldAlert className="w-3 h-3 text-signal-strong-sell" />} />
                </div>
                {sig.planSnapshot.target2PremiumPlanned != null && (
                  <div className="text-[10px] font-mono text-muted-foreground mt-1">
                    Plan T2 <span className="text-foreground">₹{fmt(sig.planSnapshot.target2PremiumPlanned)}</span>
                  </div>
                )}
              </>
            )}
            {sig.paperFill && (
              <div className="text-[10px] font-mono text-muted-foreground mt-1" data-testid="paper-fill-line">
                Paper fill <span className="text-foreground">₹{fmt(sig.paperFill.entryPremium)}</span>
                {" "}at {fmtIstTime(sig.paperFill.openedAt)} IST · {sig.paperFill.status}
                {sig.planSnapshot.entryPremiumPlanned != null && (
                  <span className="ml-1 text-muted-foreground/70">
                    (plan ₹{fmt(sig.planSnapshot.entryPremiumPlanned)} — fill happens at the live premium of the trigger tick, divergence is expected)
                  </span>
                )}
              </div>
            )}
          </div>
          <div data-testid="live-mtm-section">
            <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1.5">
              <Activity className="w-3 h-3" />
              <span>Live MTM — updates every poll · NOT the plan</span>
              {sig.optionDelta != null && (
                <span className="text-foreground/70 normal-case tracking-normal">· δ {sig.optionDelta.toFixed(2)}</span>
              )}
            </div>
            {sig.liveMtm?.strikeDrift ? (
              <div
                className="text-[10px] font-mono text-amber-500/90 border border-dashed border-amber-500/40 rounded px-2 py-1.5 leading-relaxed"
                data-testid="strike-drift-warning"
              >
                <span className="uppercase tracking-wider mr-1">ATM strike drifted:</span>
                the live ATM is now {fmt(sig.liveMtm.liveStrike)} vs the locked plan's {fmt(sig.planSnapshot.strike)}. Live premium projections would price a different contract than the plan, so they are hidden. Manage the plan by the locked spot levels above.
              </div>
            ) : sig.optionLtp != null && sig.optionEntry != null ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono" data-testid="live-mtm-grid">
                  <Cell label="Opt LTP" value={`₹${fmt(sig.optionLtp)}`} icon={<Activity className="w-3 h-3" />} />
                  <Cell label="Live Entry" value={`₹${fmt(sig.optionEntry)}`} icon={<Crosshair className="w-3 h-3" />} />
                  <Cell label="Live T1" value={`₹${fmt(sig.optionTarget1)}`} icon={<Target className="w-3 h-3 text-signal-strong-buy" />} />
                  <Cell label="Live SL" value={`₹${fmt(sig.optionStopLoss)}`} icon={<ShieldAlert className="w-3 h-3 text-signal-strong-sell" />} />
                </div>
                {sig.optionTarget2 != null && (
                  <div className="text-[10px] font-mono text-muted-foreground mt-1">
                    Live T2 <span className="text-foreground">₹{fmt(sig.optionTarget2)}</span>
                    {sig.optionTheta != null && (
                      <span className="ml-3">θ <span className="text-foreground">{sig.optionTheta.toFixed(2)}</span>/day</span>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="text-[10px] font-mono text-muted-foreground/80 border border-dashed border-border/40 rounded px-2 py-1.5 leading-relaxed">
                live chain unavailable right now (broker session offline / NSE blocked) — the locked plan above is unaffected.
              </div>
            )}
          </div>
        </div>
      ) : sig.optionLtp != null && sig.optionEntry != null ? (
        <div>
          <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1.5">
            <IndianRupee className="w-3 h-3" />
            <span>Option premium ({sig.leg.type === "CALL" ? "CE" : "PE"} {fmt(sig.leg.strike)}) — live projection (plan lock unavailable)</span>
            {sig.optionDelta != null && (
              <span className="text-foreground/70 normal-case tracking-normal">· δ {sig.optionDelta.toFixed(2)}</span>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
            <Cell label="Opt LTP" value={`₹${fmt(sig.optionLtp)}`} icon={<Activity className="w-3 h-3" />} />
            <Cell label="Opt Entry" value={`₹${fmt(sig.optionEntry)}`} icon={<Crosshair className="w-3 h-3" />} bold />
            <Cell label="Opt T1" value={`₹${fmt(sig.optionTarget1)}`} icon={<Target className="w-3 h-3 text-signal-strong-buy" />} />
            <Cell label="Opt SL" value={`₹${fmt(sig.optionStopLoss)}`} icon={<ShieldAlert className="w-3 h-3 text-signal-strong-sell" />} />
          </div>
          {sig.optionTarget2 != null && (
            <div className="text-[10px] font-mono text-muted-foreground mt-1">
              Opt T2 <span className="text-foreground">₹{fmt(sig.optionTarget2)}</span>
              {sig.optionTheta != null && (
                <span className="ml-3">θ <span className="text-foreground">{sig.optionTheta.toFixed(2)}</span>/day</span>
              )}
            </div>
          )}
        </div>
      ) : (
        // Visible fallback so a missing option row isn't mistaken for a UI bug.
        // The spot plan above is still actionable — only the option-premium
        // projection is unavailable until the broker chain is reachable.
        <div className="text-[10px] font-mono text-muted-foreground/80 border border-dashed border-border/40 rounded px-2 py-1.5 leading-relaxed">
          <span className="uppercase tracking-wider mr-1">Option premium:</span>
          live chain unavailable right now (broker session offline / NSE blocked) — spot plan above is still actionable; check the option chain manually before trading.
        </div>
      )}

      {risk != null && reward != null && (
        <div className="text-[10px] font-mono text-muted-foreground -mt-1">
          Risk {fmt(risk)} pts · Reward {fmt(reward)} pts (T1)
        </div>
      )}

      {/* Levels-on-bar visualisation */}
      <div className="space-y-1">
        <div
          className="relative h-2 rounded-full bg-secondary/40 overflow-hidden"
          role="img"
          aria-label={`Spot levels for this plan. Stop ${fmt(sig.leg.stopLoss)}, Entry ${fmt(sig.leg.entry)}, current Spot ${fmt(sig.spot)}, Target 1 ${fmt(sig.leg.target1)}, Target 2 ${fmt(sig.leg.target2)}.`}
        >
          {sig.leg.stopLoss != null && (
            <div className="absolute top-0 bottom-0 w-1 bg-signal-strong-sell/80" style={{ left: `calc(${pct(sig.leg.stopLoss)}% - 2px)` }} title={`Stop ${fmt(sig.leg.stopLoss)}`} />
          )}
          {sig.leg.entry != null && (
            <div className="absolute top-0 bottom-0 w-1 bg-foreground" style={{ left: `calc(${pct(sig.leg.entry)}% - 2px)` }} title={`Entry ${fmt(sig.leg.entry)}`} />
          )}
          <div className="absolute -top-1 -bottom-1 w-2 rounded-full bg-primary border-2 border-background"
            style={{ left: `calc(${pct(sig.spot)}% - 4px)` }} title={`Spot ${fmt(sig.spot)}`} />
          {sig.leg.target1 != null && (
            <div className="absolute top-0 bottom-0 w-1 bg-signal-strong-buy" style={{ left: `calc(${pct(sig.leg.target1)}% - 2px)` }} title={`T1 ${fmt(sig.leg.target1)}`} />
          )}
          {sig.leg.target2 != null && (
            <div className="absolute top-0 bottom-0 w-1 bg-signal-strong-buy/60" style={{ left: `calc(${pct(sig.leg.target2)}% - 2px)` }} title={`T2 ${fmt(sig.leg.target2)}`} />
          )}
        </div>
        <div className="flex justify-between text-[9px] font-mono text-muted-foreground">
          <span>SL</span><span>Entry</span><span className="text-primary">Spot</span><span>T1</span><span>T2</span>
        </div>
      </div>

      {/* Confluences */}
      <div className="space-y-1 border-t border-border/40 pt-2">
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Confluences</div>
        {sig.drivers.slice(0, 4).map((d, i) => (
          <div key={i} className="flex items-start gap-2 text-xs">
            {d.bullish ? <TrendingUp className="w-3 h-3 mt-0.5 text-signal-strong-buy shrink-0" /> : <TrendingDown className="w-3 h-3 mt-0.5 text-signal-strong-sell shrink-0" />}
            <div>
              <span className="font-semibold">{d.label}</span>
              {d.detail && <span className="text-muted-foreground"> — {d.detail}</span>}
            </div>
          </div>
        ))}
      </div>

      {sig.invalidation && (
        <div className="text-[11px] text-muted-foreground border-t border-border/40 pt-2">
          <span className="uppercase tracking-wider mr-1 font-mono text-signal-strong-sell">Invalidation:</span>{sig.invalidation}
        </div>
      )}

      <WhyThisSetup sig={sig} />

      <SetupLifecycleFooter sig={sig} />
    </div>
  );
}

/**
 * "Why this setup" — a transparent, display-only explanation built purely from
 * fields the signal already carries (see `deriveSetupExplanation`). It re-runs
 * no gate and fabricates nothing; the paper-trade verdict is the server's own
 * `tradeClass`. Lets the owner see at a glance the tier/regime/direction/
 * trigger/veto/data-quality/premium-source/RR and whether the auto-trader may
 * open it — and if not, exactly why.
 */
function WhyThisSetup({ sig }: { sig: OptionSignal }) {
  const e = deriveSetupExplanation(sig);
  const allowTone = e.paperTradeAllowed
    ? "border-signal-strong-buy/40 bg-signal-strong-buy/[0.06] text-signal-strong-buy"
    : "border-amber-500/40 bg-amber-500/[0.06] text-amber-300";
  return (
    <div className="border-t border-border/40 pt-2 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          Why this setup
        </span>
        <span
          className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-mono font-bold ${allowTone}`}
          title={e.paperTradeReasonText}
        >
          {e.paperTradeAllowed ? <ShieldCheck className="w-3 h-3" /> : <Ban className="w-3 h-3" />}
          {e.paperTradeAllowed ? "Auto-trade: YES" : "Auto-trade: NO"}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5 text-[10px] font-mono">
        <ExplainChip label="Tier" value={e.tier} />
        <ExplainChip label="Dir" value={e.direction.replace(/ \(.*\)$/, "")} />
        {e.regime && <ExplainChip label="Regime" value={e.regime} title={e.regimeReason ?? undefined} />}
        {e.riskReward != null && <ExplainChip label="RR" value={`${e.riskReward}:1`} />}
        {e.dataQuality && <ExplainChip label="Data" value={e.dataQuality} />}
        <ExplainChip
          label="Premium"
          value={e.premiumSource ? `${e.premiumSource}${e.premiumTrusted ? " ✓" : " ⚠"}` : "—"}
          title={e.premiumWarning ?? undefined}
          tone={e.premiumTrusted ? undefined : "warn"}
        />
        {e.vetoStatus && <ExplainChip label="Veto" value={e.vetoStatus} tone="warn" />}
      </div>

      {e.trigger && (
        <div className="text-[10px] font-mono text-muted-foreground">
          <span className="uppercase tracking-wider mr-1">Trigger:</span>
          <span className="text-foreground">{e.trigger}</span>
        </div>
      )}

      <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
        <Info className="w-3 h-3 mt-0.5 shrink-0" />
        <span>{e.paperTradeReasonText}</span>
      </div>
    </div>
  );
}

function ExplainChip({
  label, value, title, tone,
}: { label: string; value: string; title?: string; tone?: "warn" }) {
  const toneCls = tone === "warn"
    ? "border-amber-500/40 bg-amber-500/[0.06] text-amber-300"
    : "border-border/40 bg-secondary/40 text-foreground";
  return (
    <span className={`rounded border px-1.5 py-0.5 ${toneCls}`} title={title}>
      <span className="text-muted-foreground mr-1">{label}</span>
      {value}
    </span>
  );
}

function SetupLifecycleFooter({ sig }: { sig: OptionSignal }) {
  // Prefer the persisted firstSeenAt if available — it's frozen at first
  // emission so the "signaled at" timestamp doesn't drift on every refresh.
  const seen = sig.firstSeenAt ?? sig.generatedAt;
  return (
    <div className="text-[10px] font-mono text-muted-foreground border-t border-border/40 pt-2 space-y-0.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        <Clock className="w-3 h-3 shrink-0" />
        <span>signaled at <span className="text-foreground tabular-nums">{fmtIstTime(seen)} IST</span></span>
        <span className="text-muted-foreground/70">· {fmtRelative(seen)}</span>
      </div>
      {sig.triggeredAt && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <Zap className="w-3 h-3 text-cyan-400 shrink-0" />
          <span>triggered at <span className="text-foreground tabular-nums">{fmtIstTime(sig.triggeredAt)} IST</span></span>
          <span className="text-muted-foreground/70">· {fmtRelative(sig.triggeredAt)}</span>
        </div>
      )}
      {sig.exitedAt && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {sig.status === "STOPPED"
            ? <XCircle className="w-3 h-3 text-signal-strong-sell shrink-0" />
            : <CheckCircle2 className="w-3 h-3 text-signal-strong-buy shrink-0" />}
          <span>
            exited <span className="text-foreground tabular-nums">{fmtIstTime(sig.exitedAt)} IST</span>
            <span className="text-muted-foreground/70"> — {exitReasonLabel(sig.exitReason)}</span>
          </span>
        </div>
      )}
      {(sig.maxFavorableExcursionPts != null || sig.maxAdverseExcursionPts != null) && (
        <div className="flex items-center gap-3 flex-wrap pt-0.5">
          <span>MFE <span className="text-signal-strong-buy tabular-nums">+{(sig.maxFavorableExcursionPts ?? 0).toFixed(2)}</span> pts</span>
          <span>MAE <span className="text-signal-strong-sell tabular-nums">-{(sig.maxAdverseExcursionPts ?? 0).toFixed(2)}</span> pts</span>
          {sig.lastSpot != null && (
            <span className="text-muted-foreground/70">last spot {sig.lastSpot.toFixed(2)}</span>
          )}
        </div>
      )}
      {sig.lastEvaluatedAt && (
        // Trust signal: shows that the trigger pipeline IS evaluating this
        // plan against live spot. If this stops advancing, the user knows
        // immediately that something is wrong with the data feed — they
        // don't have to wonder whether the level was missed.
        <div className="flex items-center gap-1.5 flex-wrap pt-0.5 text-muted-foreground/70">
          <Eye className="w-3 h-3 shrink-0" />
          <span>last checked <span className="text-foreground tabular-nums">{fmtIstTime(sig.lastEvaluatedAt)} IST</span></span>
          <span className="text-muted-foreground/60">· {fmtRelative(sig.lastEvaluatedAt)}</span>
        </div>
      )}
    </div>
  );
}

function Cell({ label, value, icon, bold }: { label: string; value?: string; icon?: React.ReactNode; bold?: boolean }) {
  return (
    <div className="rounded bg-background/60 border border-border/30 p-1.5">
      <div className="flex items-center gap-1 text-[10px] uppercase text-muted-foreground tracking-wider">{icon}{label}</div>
      <div className={`font-mono ${bold ? "text-base font-bold" : "text-sm"}`}>{value ?? "—"}</div>
    </div>
  );
}

type Tab = "live" | "report";

// Composite identity for a signal — same key the backend uses to dedupe in
// option_signal_history (date + index + setupKey + bias). This keeps a single
// triggered signal from re-firing the popup across refreshes / reloads.
function signalKey(s: OptionSignal): string {
  const day = (s.firstSeenAt ?? s.generatedAt)?.toString().slice(0, 10) ?? "";
  return `${day}|${s.index}|${s.setupKey ?? "BASELINE"}|${s.bias}`;
}

const TRIGGER_TOAST_SEEN_LS_KEY = "fno.triggerToast.seen.v1";

function loadSeenTriggers(): Set<string> {
  try {
    const raw = localStorage.getItem(TRIGGER_TOAST_SEEN_LS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function saveSeenTriggers(set: Set<string>) {
  try {
    // Cap the set so it doesn't grow forever — keep the most recent 500 keys.
    const arr = Array.from(set).slice(-500);
    localStorage.setItem(TRIGGER_TOAST_SEEN_LS_KEY, JSON.stringify(arr));
  } catch { /* ignore quota errors */ }
}

// Pop a top-right toast every time a CE/PE signal flips from PENDING to
// TRIGGERED (or shows up already TRIGGERED for the first time after the user
// loaded the page mid-session). Persists "seen" keys in localStorage so the
// same trigger doesn't fire again on every 30-second refresh.
function useTriggerToasts(signals: OptionSignal[] | undefined) {
  const { toast } = useToast();
  const seenRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!signals || signals.length === 0) return;
    if (seenRef.current === null) {
      seenRef.current = loadSeenTriggers();
    }
    const seen = seenRef.current;

    // Per the user's final spec: pop ONLY when a CE/PE actually triggers
    // (PENDING → TRIGGERED). Exit events (T1/T2/STOPPED) and EXPIRED are
    // already shown on the card and in the scoreboard tab; firing toasts for
    // them would flood the screen at session-end.
    const TRIGGER_STATES = new Set(["TRIGGERED", "TARGET1_HIT", "TARGET2_HIT"]);
    let changed = false;

    for (const s of signals) {
      // We accept TARGET1/TARGET2_HIT here too because lifecycle can jump
      // straight from PENDING through TRIGGERED to a target-hit between two
      // 30-sec polls — without this the user would silently miss the entry
      // event. We still dedupe by signalKey so each plan only ever fires once.
      if (!s.status || !TRIGGER_STATES.has(s.status)) continue;
      const key = signalKey(s);
      if (seen.has(key)) continue;
      seen.add(key);
      changed = true;

      const side = s.leg.type === "CALL" ? "CE" : "PE";
      const dirIcon = s.leg.type === "CALL" ? "BUY CALL" : "BUY PUT";
      const optBlock = s.optionEntry != null
        ? `Opt entry ₹${s.optionEntry.toFixed(2)} · T1 ₹${(s.optionTarget1 ?? 0).toFixed(2)} · SL ₹${(s.optionStopLoss ?? 0).toFixed(2)}`
        : "";
      toast({
        title: `${s.indexName} — ${dirIcon} ${s.leg.strike} ${side} triggered`,
        description: [
          `${s.setupName ?? s.setupKey ?? "Setup"} fired`,
          `Spot entry ${s.leg.entry.toFixed(2)} · T1 ${s.leg.target1.toFixed(2)} · SL ${s.leg.stopLoss.toFixed(2)}`,
          optBlock,
        ].filter(Boolean).join(" · "),
      });
    }

    if (changed) saveSeenTriggers(seen);
  }, [signals, toast]);
}

function FnoIndexStatusTable({ rows }: { rows: FnoIndexRow[] }) {
  return (
    <div className="overflow-x-auto" data-testid="fno-index-table">
      <table className="w-full text-[11px] font-mono border-collapse">
        <thead>
          <tr className="text-muted-foreground border-b border-border/60 text-left">
            <th className="py-1.5 pr-3 font-medium">Index</th>
            <th className="py-1.5 pr-3 font-medium">Live Kite Data</th>
            <th className="py-1.5 pr-3 font-medium">Last Candle</th>
            <th className="py-1.5 pr-3 font-medium">Option Chain</th>
            <th className="py-1.5 pr-3 font-medium">Candidate?</th>
            <th className="py-1.5 pr-3 font-medium">State</th>
            <th className="py-1.5 font-medium">Reason</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.index} className="border-b border-border/30 align-top" data-testid={`fno-index-row-${r.index}`}>
              <td className="py-1.5 pr-3 font-bold text-foreground">{r.index}</td>
              <td className={`py-1.5 pr-3 ${r.liveKiteData === "Live" ? "text-emerald-400" : r.liveKiteData === "Offline" ? "text-red-400" : "text-muted-foreground"}`}>{r.liveKiteData}</td>
              <td className="py-1.5 pr-3 text-muted-foreground">{r.lastCandle}</td>
              <td className={`py-1.5 pr-3 ${r.optionChain === "Available" ? "text-emerald-400" : r.optionChain === "Unavailable" ? "text-red-400" : "text-muted-foreground"}`}>{r.optionChain}</td>
              <td className={`py-1.5 pr-3 ${r.candidate.startsWith("Yes") ? "text-emerald-400" : "text-muted-foreground"}`}>{r.candidate}</td>
              <td className="py-1.5 pr-3 text-muted-foreground">{r.state}</td>
              <td className="py-1.5 text-muted-foreground/90 whitespace-normal break-words">{r.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function OptionsPage() {
  const [tab, setTab] = useState<Tab>("live");
  const { data, isLoading, refetch } = useGetOptionSignals({
    query: { refetchInterval: 30000, queryKey: getGetOptionSignalsQueryKey() },
  });

  // Legacy-payload guard: if the cached payload predates the marketStatus field
  // (React Query stale-while-revalidate can serve an old pre-fix entry that has
  // marketStatus=undefined), immediately request a fresh fetch. This ensures the
  // market-closed gate never relies on absent marketStatus for more than one cycle.
  useEffect(() => {
    if (data != null && data.marketStatus == null) {
      void refetch();
    }
  }, [data, refetch]);

  const readiness = useKiteReadiness();
  const noSignalGap = useFnoNoSignalGap(readiness !== null);
  const bannerState = deriveSessionBannerState(
    data,
    readiness,
    noSignalGap.data?.gapTradingDays,
    noSignalGap.data?.lastSignal?.any,
  );
  useTriggerToasts(data?.signals);

  const grouped = useMemo(() => {
    const groups = new Map<string, OptionSignal[]>();
    for (const s of data?.signals ?? []) {
      const arr = groups.get(s.index) ?? [];
      arr.push(s);
      groups.set(s.index, arr);
    }
    return Array.from(groups.entries()).map(([index, signals]) => ({
      index,
      indexName: signals[0]?.indexName ?? index,
      // `?? 0` previously claimed the index was trading at zero whenever the
      // spot snapshot hadn't landed — visibly misleading on the F&O page. Pass
      // null through; the renderer's `fmt(grp.spot)` already prints "—".
      spot: signals[0]?.spot ?? null,
      spotChangePercent: signals[0]?.spotChangePercent,
      spotChangePctVsPrevClose: signals[0]?.spotChangePctVsPrevClose,
      spotPrevClose: signals[0]?.spotPrevClose,
      vwap: signals[0]?.vwap,
      ema9: signals[0]?.ema9,
      ema21: signals[0]?.ema21,
      rsi: (signals[0] as { rsi?: number } | undefined)?.rsi,
      pointOfControl: signals[0]?.pointOfControl,
      valueAreaHigh: signals[0]?.valueAreaHigh,
      valueAreaLow: signals[0]?.valueAreaLow,
      signals,
    }));
  }, [data]);

  const totalSignals = data?.signals?.length ?? 0;
  const generatedAt = data?.generatedAt;

  return (
    <div className="w-full max-w-none px-4 py-6 space-y-6">
      <div>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold font-mono tracking-tight flex items-center gap-2">
            <Crosshair className="w-6 h-6 text-primary" />
            INTRADAY F&O TRADE
          </h1>
          <DataSourceBadge
            source="kite"
            status="live"
            lastUpdated={generatedAt}
            refreshMs={30_000}
            note="F&O setups derived from live Kite ticks"
            compact
          />
        </div>
        <p className="text-muted-foreground text-sm max-w-3xl mt-1">
          Up to 3 high-conviction CALL/PUT setups per index — built from <span className="text-foreground">Price Action · RSI · Fixed Volume Profile · VWAP · EMA 9/21</span>.
          Higher-conviction setups (≥50% with multi-indicator confluence) appear first; an always-on baseline directional read is also shown for every index.
        </p>
        <p className="text-xs text-muted-foreground max-w-3xl mt-2 leading-relaxed border-l-2 border-primary/40 pl-3">
          <span className="text-foreground font-mono uppercase tracking-wider">How to read this:</span> the strike (e.g. NIFTY 25500 CE) is the same across every plan for an index because it's the nearest ATM. The Entry / Stop / Target numbers are <span className="text-foreground">underlying spot</span> levels (where NIFTY itself needs to trade), not option premium. Different plans show different spot levels because each one is a different technical setup with its own trigger formula — they are alternative ways to take the same directional view.
        </p>
        <div className="text-[11px] font-mono text-muted-foreground mt-2 flex items-center gap-3">
          <span>{totalSignals} live setups across {grouped.length} indices</span>
          <span>·</span>
          <span>auto-refresh 30s</span>
          {generatedAt && <><span>·</span><span>updated {formatDistanceToNow(new Date(generatedAt))} ago</span></>}
        </div>
      </div>

      <TradingViewAlerts />

      {/* Kite session / data-gap banner — owner-only, shows when all F&O
          indices are suppressed due to a data issue so the owner knows
          immediately it is NOT a market condition. Non-owners see nothing
          (readiness is null → bannerState.show is false). */}
      <FnoKiteSessionBanner state={bannerState} />

      {/* Phase-1 quality-gate status banner. Honest explanation for why
          the live tab may be empty (or thinned out) on the current
          session: circuit breaker after consecutive stops, India VIX
          spike, correlated-exposure dedupe, OI hard veto. Hidden when
          no gate is active so the UI doesn't get noisy on a normal day. */}
      {data?.diagnostics?.gates && (
        <SignalGateBanner gates={data.diagnostics.gates} />
      )}

      {/* G — reason-category chips. Bucket the per-index suppressed reasons
          into the seven owner-facing categories (data / risk / signal-quality
          / market-closed / no-setup / capital / broker) with counts and
          tooltip samples. Hidden on a fully-clean session. */}
      <FnoReasonCategoriesStrip suppressed={data?.diagnostics?.suppressed} />

      {/* BUG-80 / F.2 — Expiry-day banner. Shown when at least one index
          on the current session is in EXPIRY_DAY regime. Explains the
          three mode changes (MEAN_REVERSION only, ½ size, 14:30 IST
          auto-close) so the owner never wonders why setups look thinner.
          Sourced from the same signal.regime data the RegimeChip uses —
          no new API surface. */}
      {(() => {
        const expiringIdx = Array.from(
          new Set(
            (data?.signals ?? [])
              .filter((s) => (s as { regime?: string }).regime === "EXPIRY_DAY")
              .map((s) => s.indexName ?? s.index),
          ),
        );
        if (expiringIdx.length === 0) return null;
        return (
          <div
            className="rounded border border-violet-500/40 bg-violet-500/10 px-4 py-2 text-[12px] font-mono text-violet-200 flex items-start gap-2"
            data-testid="expiry-day-banner"
          >
            <span className="uppercase tracking-wider text-violet-300">Expiry Day</span>
            <span className="text-violet-200/80">·</span>
            <span>
              {expiringIdx.join(", ")} — MEAN_REVERSION only, position size × 0.5, auto-close 14:30 IST.
              Trend detectors are gated to avoid pin/unwind dynamics.
            </span>
          </div>
        );
      })()}

      {/* Tab toggle: live setups vs report */}
      <div className="inline-flex rounded-md border border-border bg-secondary/30 p-0.5 text-xs font-mono">
        <button
          onClick={() => setTab("live")}
          className={`px-3 py-1.5 rounded inline-flex items-center gap-1.5 transition-colors ${
            tab === "live"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
          aria-pressed={tab === "live"}
        >
          <Crosshair className="w-3 h-3" /> Live setups
        </button>
        <button
          onClick={() => setTab("report")}
          className={`px-3 py-1.5 rounded inline-flex items-center gap-1.5 transition-colors ${
            tab === "report"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
          aria-pressed={tab === "report"}
        >
          <FileSpreadsheet className="w-3 h-3" /> Report
        </button>
      </div>

      {tab === "report" ? (
        <ReportTab />
      ) : isLoading ? (
        <div className="space-y-6">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-96 w-full" />)}
        </div>
      ) : (data?.marketStatus != null && !data.marketStatus.marketOpen) ? (
        <Card>
          <CardContent className="py-12 text-center space-y-2">
            <Clock className="w-8 h-8 text-muted-foreground mx-auto" />
            <div className="text-muted-foreground font-mono text-sm">
              {/* Gate guarantees marketStatus is non-null here */}
              {data?.marketStatus?.reason === "PRE_OPEN"
                ? "Market is in pre-open session (09:00 – 09:15 IST)"
                : data?.marketStatus?.reason === "BEFORE_OPEN"
                  ? "Market opens at 09:15 IST"
                  : data?.marketStatus?.reason === "AFTER_CLOSE"
                    ? "Market closed at 15:30 IST"
                    : data?.marketStatus?.reason === "WEEKEND"
                      ? "Weekend — next session resumes Monday"
                      : data?.marketStatus?.reason === "HOLIDAY"
                        ? "NSE holiday — market is closed today"
                        : "Market is closed"}
            </div>
            <div className="text-xs text-muted-foreground/70">
              Live signals are only generated during market hours (09:15 — 15:30 IST).
              Check the <button onClick={() => setTab("report")} className="underline text-primary hover:text-primary/80">Report</button> tab for historical performance.
            </div>
            {data?.marketStatus?.serverIst && (
              <div className="text-xs text-muted-foreground/50 font-mono pt-1">{data.marketStatus.serverIst} IST</div>
            )}
          </CardContent>
        </Card>
      ) : grouped.length === 0 ? (
        <Card>
          <CardContent className="py-8 space-y-4">
            <div className="text-center space-y-1">
              <div className="text-muted-foreground font-mono text-sm" data-testid="fno-empty-reason">
                {deriveFnoEmptyReason(data, readiness)}
              </div>
              <div className="text-xs text-muted-foreground/70">
                Per-index live-data &amp; gate status below. (High-conviction filters: ≥60% confidence, multi-indicator alignment.)
              </div>
            </div>
            <FnoIndexStatusTable rows={buildFnoIndexRows(data, readiness)} />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {grouped.map(grp => {
            const changePctDisplay = grp.spotChangePctVsPrevClose ?? grp.spotChangePercent;
            const up = (changePctDisplay ?? 0) >= 0;
            return (
              <Card key={grp.index} className="border-border">
                <CardContent className="p-4 space-y-4">
                  {/* Index header */}
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <div className="font-mono font-bold text-lg flex items-center gap-2">
                        {grp.indexName}
                        <Badge variant="outline" className="font-mono text-[10px] border-border">{grp.signals.length} setup{grp.signals.length === 1 ? "" : "s"}</Badge>
                      </div>
                      <div className="text-xs font-mono mt-0.5">
                        <span className="text-foreground tabular-nums">Spot {fmt(grp.spot)}</span>
                        {grp.spotChangePctVsPrevClose != null ? (
                          <span className={`ml-2 ${up ? "text-signal-strong-buy" : "text-signal-strong-sell"}`}>
                            {up ? "+" : ""}{grp.spotChangePctVsPrevClose.toFixed(2)}%
                          </span>
                        ) : grp.spotChangePercent != null ? (
                          <span className={`ml-2 ${up ? "text-signal-strong-buy" : "text-signal-strong-sell"}`} title="vs open">
                            {up ? "+" : ""}{grp.spotChangePercent.toFixed(2)}%{" "}
                            <span className="opacity-60 text-[9px]">(vs open)</span>
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-x-3 gap-y-1 text-[11px] font-mono">
                      <Stat label="VWAP" value={fmt(grp.vwap)} />
                      <Stat label="EMA9" value={fmt(grp.ema9)} />
                      <Stat label="EMA21" value={fmt(grp.ema21)} />
                      <Stat label="RSI14" value={grp.rsi != null ? grp.rsi.toFixed(1) : "—"} />
                      <Stat label="VAH" value={fmt(grp.valueAreaHigh)} />
                      <Stat label="POC" value={fmt(grp.pointOfControl)} sub={`VAL ${fmt(grp.valueAreaLow)}`} />
                    </div>
                  </div>

                  {/* Disambiguation banner — explains why same-strike plans show
                      different entry/SL/target. The UNDERLYING is the same; each plan
                      is a different technical setup with its own trigger formula. */}
                  {grp.signals.length > 1 && (
                    <div className="rounded border border-border/40 bg-secondary/20 px-3 py-2 text-[11px] text-muted-foreground leading-relaxed">
                      <span className="text-foreground font-mono uppercase tracking-wider mr-1">Why {grp.signals.length} plans on the same strike?</span>
                      Each plan below is an <span className="text-foreground">independent intraday setup</span> (Trend Continuation, VWAP Reclaim, Volume Breakout, Baseline, etc.) with its own trigger condition. They all point at the same ATM strike because that's the natural directional play on {grp.indexName}. The Spot Entry / Stop / Target levels differ because each setup uses a different formula (swing high vs VWAP offset vs Value Area vs EMA21). Pick the plan whose trigger fires first or whose style suits you — don't trade more than one at a time on the same instrument.
                    </div>
                  )}

                  {/* Setups grid */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                    {grp.signals.map((s, i) => (
                      <SetupCard
                        key={`${s.index}-${s.setupKey}-${i}`}
                        sig={s}
                        planNumber={i + 1}
                        totalPlans={grp.signals.length}
                      />
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground border-t border-border/40 pt-3">
        Educational analysis only. Strikes are nearest ATM for the next weekly expiry. Entry / SL / Targets are spot levels — pick the corresponding ATM CE/PE on your broker terminal and manage by underlying. Always verify with the live option chain before trading.
      </p>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-foreground tabular-nums">{value}</div>
      {sub && <div className="text-[9px] text-muted-foreground/70 tabular-nums">{sub}</div>}
    </div>
  );
}

// ---------------- Scoreboard / Analytics tab ----------------

interface KpiBucket {
  total: number;
  triggered: number;
  t1Hit: number;
  t2Hit: number;
  stopped: number;
  expired: number;
  pending: number;
  /** EXPIRED_TRIGGERED rows that finished above entry in trade direction. */
  expiredWin: number;
  /** EXPIRED_TRIGGERED rows that finished below entry in trade direction. */
  expiredLoss: number;
  /** EXPIRED_TRIGGERED rows whose exit was within ±5 bps of entry — neither win nor loss. */
  expiredScratch: number;
  totalMfe: number;
  totalMae: number;
  /** Sum of realised points-in-trade across all decided rows (wins + losses).
   *  Bullish: exitPrice − entry. Bearish: entry − exitPrice. */
  realisedPts: number;
}

const EMPTY_KPI: KpiBucket = {
  total: 0, triggered: 0, t1Hit: 0, t2Hit: 0, stopped: 0, expired: 0, pending: 0,
  expiredWin: 0, expiredLoss: 0, expiredScratch: 0,
  totalMfe: 0, totalMae: 0, realisedPts: 0,
};

/** Realised point P&L for a row that has an exitPrice and an entry, in the
 *  trade direction. Returns null if either is missing. */
function realisedPtsFor(item: OptionSignalHistoryItem): number | null {
  if (item.exitPrice == null || item.entry == null) return null;
  return item.direction === "BULLISH"
    ? item.exitPrice - item.entry
    : item.entry - item.exitPrice;
}

/** Scratch threshold: ±5 bps of entry. Below this we don't claim a directional
 *  outcome — the trade was effectively flat at the close. */
function isScratch(entry: number, exitPrice: number): boolean {
  if (entry <= 0) return false;
  return Math.abs(exitPrice - entry) / entry < 0.0005;
}

function addToBucket(b: KpiBucket, item: OptionSignalHistoryItem): KpiBucket {
  const next = { ...b };
  next.total += 1;
  if (item.triggeredAt) next.triggered += 1;
  if (item.status === "TARGET1_HIT") next.t1Hit += 1;
  if (item.status === "TARGET2_HIT") next.t2Hit += 1;
  if (item.status === "STOPPED") next.stopped += 1;
  if (item.status === "EXPIRED") next.expired += 1;
  if (item.status === "PENDING") next.pending += 1;
  next.totalMfe += item.maxFavorableExcursionPts ?? 0;
  next.totalMae += item.maxAdverseExcursionPts ?? 0;

  // Classify EXPIRED_TRIGGERED into realised win / loss / scratch using the
  // direction-signed gap between exitPrice and entry. The previous
  // scoreboard excluded these entirely from win-rate, which made a day with
  // 5 real losers (every triggered trade closed below entry) display as
  // "no decided trades" — silently masking poor signal quality. EXPIRED
  // without a triggeredAt (PENDING-only that aged out) is NOT counted; it
  // had no position so it has no P&L.
  const realised = realisedPtsFor(item);
  if (
    item.status === "EXPIRED" &&
    item.exitReason === "EXPIRED_TRIGGERED" &&
    item.exitPrice != null &&
    item.entry != null &&
    realised != null
  ) {
    if (isScratch(item.entry, item.exitPrice)) next.expiredScratch += 1;
    else if (realised > 0) next.expiredWin += 1;
    else next.expiredLoss += 1;
  }

  // Realised P&L sum: every row that has an exitPrice contributes,
  // including T1_HIT (settled at T1 by EOD sweep), T2_HIT, STOPPED, and
  // EXPIRED_TRIGGERED. PENDING and pre-trigger expirations have no P&L.
  if (realised != null && (item.triggeredAt || item.status === "STOPPED")) {
    next.realisedPts += realised;
  }
  return next;
}

function winRate(b: KpiBucket): number | null {
  // Wins  = T1 hit + T2 hit + EXPIRED_TRIGGERED that closed above entry.
  // Losses= STOPPED + EXPIRED_TRIGGERED that closed below entry.
  // Scratch (EXPIRED_TRIGGERED at ~entry) and pre-trigger EXPIRED rows are
  // excluded — neither win nor loss. Including expired-triggered outcomes
  // is the honest accounting: those positions WERE entered and DID realise
  // a P&L at session close, even though they didn't tag a target.
  const wins = b.t1Hit + b.t2Hit + b.expiredWin;
  const losses = b.stopped + b.expiredLoss;
  const decided = wins + losses;
  if (decided === 0) return null;
  return Math.round((wins / decided) * 100);
}

function avgMfe(b: KpiBucket): number {
  return b.total > 0 ? b.totalMfe / b.total : 0;
}
function avgMae(b: KpiBucket): number {
  return b.total > 0 ? b.totalMae / b.total : 0;
}

function todayIST(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}
function currentMonthIST(): string {
  return todayIST().slice(0, 7);
}

type ReportMode = "daily" | "monthly";

type StatusFilter = "triggered" | "all";

function ReportTab() {
  const [mode, setMode] = useState<ReportMode>("daily");
  const [selectedDate, setSelectedDate] = useState(todayIST);
  const [selectedMonth, setSelectedMonth] = useState(currentMonthIST);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("triggered");

  const { data: datesData } = useGetOptionSignalReportDates({
    query: { queryKey: getGetOptionSignalReportDatesQueryKey(), staleTime: 60_000 },
  });
  const availableDates = datesData?.dates ?? [];

  const reportParams = mode === "daily" ? { date: selectedDate } : { month: selectedMonth };
  const { data, isLoading } = useGetOptionSignalReport(reportParams, {
    query: {
      queryKey: getGetOptionSignalReportQueryKey(reportParams),
      staleTime: 30_000,
    },
  });

  const allItems = data?.signals ?? [];
  const items = useMemo(
    () =>
      statusFilter === "triggered"
        ? allItems.filter((s) => {
            if (s.status === "PENDING") return false;
            if (s.status === "EXPIRED" && !s.triggeredAt) return false;
            return true;
          })
        : allItems,
    [allItems, statusFilter],
  );

  const overall = useMemo(() => items.reduce(addToBucket, EMPTY_KPI), [items]);
  const bySetup = useMemo(() => {
    const m = new Map<string, KpiBucket>();
    for (const it of items) {
      const k = it.setupName ?? it.setupKey;
      m.set(k, addToBucket(m.get(k) ?? EMPTY_KPI, it));
    }
    return Array.from(m.entries()).sort((a, b) => b[1].total - a[1].total);
  }, [items]);
  const byIndex = useMemo(() => {
    const m = new Map<string, KpiBucket>();
    for (const it of items) {
      m.set(it.indexName, addToBucket(m.get(it.indexName) ?? EMPTY_KPI, it));
    }
    return Array.from(m.entries()).sort((a, b) => b[1].total - a[1].total);
  }, [items]);

  const handleExport = useCallback(() => {
    const url = getExportOptionSignalReportUrl(reportParams);
    window.open(url, "_blank");
  }, [mode, selectedDate, selectedMonth]);

  const navigateDate = useCallback(
    (dir: -1 | 1) => {
      if (availableDates.length === 0) return;
      const idx = availableDates.indexOf(selectedDate);
      if (dir === -1) {
        const next = idx === -1 ? availableDates[0] : availableDates[Math.min(idx + 1, availableDates.length - 1)];
        if (next) setSelectedDate(next);
      } else {
        const next = idx <= 0 ? availableDates[0] : availableDates[idx - 1];
        if (next) setSelectedDate(next);
      }
    },
    [availableDates, selectedDate],
  );

  const navigateMonth = useCallback(
    (dir: -1 | 1) => {
      const [y, m] = selectedMonth.split("-").map(Number) as [number, number];
      const nm = m + dir;
      const newY = nm < 1 ? y - 1 : nm > 12 ? y + 1 : y;
      const newM = nm < 1 ? 12 : nm > 12 ? 1 : nm;
      setSelectedMonth(`${newY}-${String(newM).padStart(2, "0")}`);
    },
    [selectedMonth],
  );

  const monthLabel = useMemo(() => {
    const [y, m] = selectedMonth.split("-").map(Number) as [number, number];
    const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${names[m - 1]} ${y}`;
  }, [selectedMonth]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md border border-border bg-secondary/30 p-0.5 text-xs font-mono">
          <button
            onClick={() => setMode("daily")}
            className={`px-3 py-1.5 rounded transition-colors ${
              mode === "daily" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Daily
          </button>
          <button
            onClick={() => setMode("monthly")}
            className={`px-3 py-1.5 rounded transition-colors ${
              mode === "monthly" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Monthly
          </button>
        </div>

        {mode === "daily" ? (
          <div className="inline-flex items-center gap-1 text-xs font-mono">
            <button
              onClick={() => navigateDate(-1)}
              className="p-1 rounded hover:bg-secondary/50 text-muted-foreground hover:text-foreground"
              title="Previous date"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="relative">
              <CalendarDays className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-secondary/40 border border-border rounded px-2 py-1.5 pl-7 text-xs font-mono text-foreground w-[150px]"
              />
            </div>
            <button
              onClick={() => navigateDate(1)}
              className="p-1 rounded hover:bg-secondary/50 text-muted-foreground hover:text-foreground"
              title="Next date"
              disabled={selectedDate >= todayIST()}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => setSelectedDate(todayIST())}
              className="ml-1 px-2 py-1 rounded text-[10px] bg-secondary/50 hover:bg-secondary text-muted-foreground hover:text-foreground border border-border/40"
            >
              Today
            </button>
          </div>
        ) : (
          <div className="inline-flex items-center gap-1 text-xs font-mono">
            <button
              onClick={() => navigateMonth(-1)}
              className="p-1 rounded hover:bg-secondary/50 text-muted-foreground hover:text-foreground"
              title="Previous month"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="bg-secondary/40 border border-border rounded px-2 py-1.5 text-xs font-mono text-foreground w-[150px]"
            />
            <button
              onClick={() => navigateMonth(1)}
              className="p-1 rounded hover:bg-secondary/50 text-muted-foreground hover:text-foreground"
              title="Next month"
              disabled={selectedMonth >= currentMonthIST()}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="inline-flex rounded-md border border-border bg-secondary/30 p-0.5 text-xs font-mono">
          <button
            onClick={() => setStatusFilter("triggered")}
            className={`px-3 py-1.5 rounded transition-colors ${
              statusFilter === "triggered" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Triggered only
          </button>
          <button
            onClick={() => setStatusFilter("all")}
            className={`px-3 py-1.5 rounded transition-colors ${
              statusFilter === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            All signals
          </button>
        </div>

        <button
          onClick={handleExport}
          disabled={items.length === 0}
          className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono border border-border bg-secondary/40 hover:bg-secondary text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          Export CSV
        </button>
      </div>

      {isLoading ? (
        <Skeleton className="h-72 w-full" />
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <div className="text-muted-foreground font-mono text-sm">
              No signals recorded for {mode === "daily" ? selectedDate : monthLabel}.
            </div>
            <div className="text-xs text-muted-foreground/70 mt-1">
              {mode === "daily"
                ? "Try selecting a different date, or switch to monthly view for a broader overview."
                : "Try selecting a different month, or switch to daily view."}
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <ReportKpiCards
            overall={overall}
            label={mode === "daily" ? selectedDate : monthLabel}
            mode={mode}
          />

          <Card>
            <CardContent className="p-4">
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-3">
                Performance by setup
              </div>
              <BucketTable rows={bySetup} keyLabel="Setup" />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-3">
                Performance by index
              </div>
              <BucketTable rows={byIndex} keyLabel="Index" />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-3">
                Signal log ({items.length})
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/40">
                      {mode === "monthly" && <th className="text-left py-1.5 px-2">Date</th>}
                      <th className="text-left py-1.5 px-2">Status</th>
                      <th className="text-left py-1.5 px-2">Index</th>
                      <th className="text-left py-1.5 px-2">Setup</th>
                      <th className="text-left py-1.5 px-2">Side</th>
                      <th className="text-right py-1.5 px-2">Strike</th>
                      <th className="text-right py-1.5 px-2">Entry</th>
                      <th className="text-right py-1.5 px-2">Stop</th>
                      <th className="text-right py-1.5 px-2">T1</th>
                      <th className="text-right py-1.5 px-2">T2</th>
                      <th className="text-left py-1.5 px-2">Signaled</th>
                      <th className="text-left py-1.5 px-2">Triggered</th>
                      <th className="text-left py-1.5 px-2">Exit</th>
                      <th className="text-right py-1.5 px-2">MFE</th>
                      <th className="text-right py-1.5 px-2">MAE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it) => (
                      <tr
                        key={`${it.signalDate}-${it.indexSymbol}-${it.setupKey}-${it.direction}`}
                        className="border-b border-border/20 hover:bg-secondary/20"
                      >
                        {mode === "monthly" && <td className="py-1.5 px-2 text-muted-foreground tabular-nums">{it.signalDate}</td>}
                        <td className="py-1.5 px-2"><StatusPill status={it.status} /></td>
                        <td className="py-1.5 px-2">{it.indexName}</td>
                        <td className="py-1.5 px-2">{it.setupName ?? it.setupKey}</td>
                        <td className={`py-1.5 px-2 ${it.direction === "BULLISH" ? "text-signal-strong-buy" : "text-signal-strong-sell"}`}>
                          {it.optionType} {it.direction === "BULLISH" ? "↑" : "↓"}
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums">{fmt(it.strike)}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums">{fmt(it.entry)}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums">{fmt(it.stopLoss)}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums">{fmt(it.target1)}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums">{fmt(it.target2)}</td>
                        <td className="py-1.5 px-2 text-muted-foreground">{fmtIstTime(it.generatedAt)}</td>
                        <td className="py-1.5 px-2 text-muted-foreground">{it.triggeredAt ? fmtIstTime(it.triggeredAt) : "—"}</td>
                        <td className="py-1.5 px-2 text-muted-foreground">
                          {it.exitedAt
                            ? `${fmtIstTime(it.exitedAt)} (${exitReasonLabel(it.exitReason)})`
                            : "—"}
                        </td>
                        <td className="py-1.5 px-2 text-right text-signal-strong-buy tabular-nums">
                          +{(it.maxFavorableExcursionPts ?? 0).toFixed(2)}
                        </td>
                        <td className="py-1.5 px-2 text-right text-signal-strong-sell tabular-nums">
                          -{(it.maxAdverseExcursionPts ?? 0).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
                <strong className="text-foreground">Triggered</strong> means the market reached this signal's entry level in the signal-history feed — it is <em>not</em> a paper trade the system took. Trades the system actually risked capital on (and <strong className="text-foreground">Closed</strong>) live under <span className="text-foreground">Paper Trading</span>. Win rate here counts only decided trades (T1/T2 hit vs stopped). Signals that ran past 15:30 IST without resolving are tagged EXPIRED and excluded from the rate. MFE / MAE are the maximum points the underlying moved in your favour / against you from the locked entry.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function ReportKpiCards({ overall, label, mode }: { overall: KpiBucket; label: string; mode: ReportMode }) {
  const overallWin = winRate(overall);
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-3">
          {mode === "daily" ? "Daily" : "Monthly"} report · {label}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 text-xs font-mono">
          <KpiCell label="Signals" value={overall.total.toString()} />
          <KpiCell label="Triggered" value={overall.triggered.toString()} />
          <KpiCell label="T1 hit" value={overall.t1Hit.toString()} tone="text-signal-strong-buy" />
          <KpiCell label="T2 hit" value={overall.t2Hit.toString()} tone="text-signal-strong-buy" />
          <KpiCell label="Stopped" value={overall.stopped.toString()} tone="text-signal-strong-sell" />
          <KpiCell
            label="Expired (open)"
            value={(overall.expiredWin + overall.expiredLoss + overall.expiredScratch).toString()}
            sub={`${overall.expiredWin}W / ${overall.expiredLoss}L${overall.expiredScratch > 0 ? ` / ${overall.expiredScratch}≈` : ""}`}
          />
          <KpiCell
            label="Win rate"
            value={overallWin == null ? "—" : `${overallWin}%`}
            tone={
              overallWin == null
                ? undefined
                : overallWin >= 50
                ? "text-signal-strong-buy"
                : "text-signal-strong-sell"
            }
            sub={
              overallWin == null
                ? "no decided trades"
                : `${overall.t1Hit + overall.t2Hit + overall.expiredWin}W / ${overall.stopped + overall.expiredLoss}L`
            }
          />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono mt-3 pt-3 border-t border-border/40">
          <KpiCell label="Avg MFE / signal" value={`+${avgMfe(overall).toFixed(2)} pts`} tone="text-signal-strong-buy" />
          <KpiCell label="Avg MAE / signal" value={`-${avgMae(overall).toFixed(2)} pts`} tone="text-signal-strong-sell" />
          <KpiCell
            label="Realised P&L"
            value={`${overall.realisedPts >= 0 ? "+" : ""}${overall.realisedPts.toFixed(2)} pts`}
            tone={overall.realisedPts >= 0 ? "text-signal-strong-buy" : "text-signal-strong-sell"}
            sub="sum across decided trades"
          />
          <KpiCell label="Pending" value={overall.pending.toString()} sub="awaiting trigger" />
        </div>
      </CardContent>
    </Card>
  );
}

function KpiCell({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded bg-background/60 border border-border/30 p-2">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-base font-bold tabular-nums ${tone ?? "text-foreground"}`}>{value}</div>
      {sub && <div className="text-[9px] text-muted-foreground/70 tabular-nums mt-0.5">{sub}</div>}
    </div>
  );
}

function BucketTable({ rows, keyLabel }: { rows: Array<[string, KpiBucket]>; keyLabel: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/40">
            <th className="text-left py-1.5 px-2">{keyLabel}</th>
            <th className="text-right py-1.5 px-2">Signals</th>
            <th className="text-right py-1.5 px-2">Triggered</th>
            <th className="text-right py-1.5 px-2">T1</th>
            <th className="text-right py-1.5 px-2">T2</th>
            <th className="text-right py-1.5 px-2">Stopped</th>
            <th className="text-right py-1.5 px-2" title="Trades that triggered but didn't tag T1 or stop before 15:30 IST. W/L split by exit price vs entry.">Expired (open)</th>
            <th className="text-right py-1.5 px-2">Win rate</th>
            <th className="text-right py-1.5 px-2" title="Sum of points realised across all decided trades (T1/T2 + stops + expired-triggered).">Realised pts</th>
            <th className="text-right py-1.5 px-2">Avg MFE</th>
            <th className="text-right py-1.5 px-2">Avg MAE</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, b]) => {
            const wr = winRate(b);
            const expDecided = b.expiredWin + b.expiredLoss + b.expiredScratch;
            return (
              <tr key={name} className="border-b border-border/20 hover:bg-secondary/20">
                <td className="py-1.5 px-2 text-foreground">{name}</td>
                <td className="py-1.5 px-2 text-right tabular-nums">{b.total}</td>
                <td className="py-1.5 px-2 text-right tabular-nums">{b.triggered}</td>
                <td className="py-1.5 px-2 text-right tabular-nums text-signal-strong-buy">{b.t1Hit}</td>
                <td className="py-1.5 px-2 text-right tabular-nums text-signal-strong-buy">{b.t2Hit}</td>
                <td className="py-1.5 px-2 text-right tabular-nums text-signal-strong-sell">{b.stopped}</td>
                <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground" title={expDecided > 0 ? `${b.expiredWin}W / ${b.expiredLoss}L${b.expiredScratch > 0 ? ` / ${b.expiredScratch} scratch` : ""}` : undefined}>
                  {expDecided}
                  {expDecided > 0 && (
                    <span className="ml-1 text-[9px] opacity-70">
                      ({b.expiredWin}W/{b.expiredLoss}L)
                    </span>
                  )}
                </td>
                <td className={`py-1.5 px-2 text-right tabular-nums font-bold ${wr == null ? "text-muted-foreground" : wr >= 50 ? "text-signal-strong-buy" : "text-signal-strong-sell"}`}>
                  {wr == null ? "—" : `${wr}%`}
                </td>
                <td className={`py-1.5 px-2 text-right tabular-nums font-bold ${b.realisedPts >= 0 ? "text-signal-strong-buy" : "text-signal-strong-sell"}`}>
                  {b.realisedPts >= 0 ? "+" : ""}{b.realisedPts.toFixed(2)}
                </td>
                <td className="py-1.5 px-2 text-right tabular-nums text-signal-strong-buy">+{avgMfe(b).toFixed(2)}</td>
                <td className="py-1.5 px-2 text-right tabular-nums text-signal-strong-sell">-{avgMae(b).toFixed(2)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
