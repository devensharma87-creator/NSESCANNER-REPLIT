import {
  useGetOptionSignals,
  getGetOptionSignalsQueryKey,
  useGetOptionSignalHistory,
  getGetOptionSignalHistoryQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { TradingViewAlerts } from "@/components/tradingview-alerts";
import { useToast } from "@/hooks/use-toast";
import {
  TrendingUp, TrendingDown, Target, ShieldAlert, Crosshair, Zap, Activity, Layers, Repeat, RotateCcw,
  Clock, CheckCircle2, XCircle, Hourglass, BarChart3, IndianRupee, Eye,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  OptionSignal,
  OptionSignalHistoryItem,
} from "@workspace/api-client-react";

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

function statusMeta(status: LifecycleStatus | string | undefined) {
  switch (status) {
    case "TRIGGERED":   return { label: "Triggered",   tone: "bg-cyan-500/20 text-cyan-300 border-cyan-500/40",                icon: <Zap className="w-3 h-3" /> };
    case "TARGET1_HIT": return { label: "Target 1 hit", tone: "bg-signal-strong-buy/20 text-signal-strong-buy border-signal-strong-buy/40", icon: <Target className="w-3 h-3" /> };
    case "TARGET2_HIT": return { label: "Target 2 hit", tone: "bg-signal-strong-buy/30 text-signal-strong-buy border-signal-strong-buy/60", icon: <CheckCircle2 className="w-3 h-3" /> };
    case "STOPPED":     return { label: "Stopped out",  tone: "bg-signal-strong-sell/20 text-signal-strong-sell border-signal-strong-sell/40", icon: <XCircle className="w-3 h-3" /> };
    case "EXPIRED":     return { label: "Expired",      tone: "bg-secondary/40 text-muted-foreground border-border/40",         icon: <Clock className="w-3 h-3" /> };
    case "PENDING":
    default:            return { label: "Waiting trigger", tone: "bg-amber-500/15 text-amber-300 border-amber-500/40",          icon: <Hourglass className="w-3 h-3" /> };
  }
}

function StatusPill({ status }: { status?: LifecycleStatus | string }) {
  const m = statusMeta(status);
  return (
    <span className={`px-2 py-0.5 rounded border text-[10px] font-mono font-bold inline-flex items-center gap-1 ${m.tone}`}>
      {m.icon}
      {m.label}
    </span>
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
    default:                 return r ?? "—";
  }
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
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <ConfidencePill confidence={sig.confidence} />
          <StatusPill status={sig.status} />
          {sig.leg.riskRewardRatio != null && (
            <span className="text-[10px] font-mono text-muted-foreground">RR {sig.leg.riskRewardRatio}:1</span>
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

      {/* Option-premium grid — what you actually pay / book on the broker. Derived
          from the chosen strike's live LTP and delta:
            optionEntry = optionLtp + delta × (spotEntry − spot)
            optionT1/T2 = optionEntry + delta × (spotT1/T2 − spotEntry)
            optionSL    = optionEntry + delta × (spotSL    − spotEntry), floored at ₹0.05
          Sign cancels for puts (delta<0 with target<entry), so values stay sensible
          for both CALL and PUT. Section is hidden when the option chain wasn't
          available at signal time (NSE block / no broker session). */}
      {sig.optionLtp != null && sig.optionEntry != null ? (
        <div>
          <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1.5">
            <IndianRupee className="w-3 h-3" />
            <span>Option premium ({sig.leg.type === "CALL" ? "CE" : "PE"} {fmt(sig.leg.strike)}) — what you pay & book</span>
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

      <SetupLifecycleFooter sig={sig} />
    </div>
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

type Tab = "live" | "scoreboard";

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

export default function OptionsPage() {
  const [tab, setTab] = useState<Tab>("live");
  const { data, isLoading } = useGetOptionSignals({
    query: { refetchInterval: 30000, queryKey: getGetOptionSignalsQueryKey() },
  });
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
      spot: signals[0]?.spot ?? 0,
      spotChangePercent: signals[0]?.spotChangePercent,
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
        <h1 className="text-2xl font-bold font-mono tracking-tight flex items-center gap-2">
          <Crosshair className="w-6 h-6 text-primary" />
          INTRADAY F&O TRADE
        </h1>
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

      {/* Tab toggle: live setups vs today's scoreboard */}
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
          onClick={() => setTab("scoreboard")}
          className={`px-3 py-1.5 rounded inline-flex items-center gap-1.5 transition-colors ${
            tab === "scoreboard"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
          aria-pressed={tab === "scoreboard"}
        >
          <BarChart3 className="w-3 h-3" /> Today&apos;s scoreboard
        </button>
      </div>

      {tab === "scoreboard" ? (
        <ScoreboardTab />
      ) : isLoading ? (
        <div className="space-y-6">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-96 w-full" />)}
        </div>
      ) : grouped.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <div className="text-muted-foreground font-mono text-sm">No high-conviction setups right now — all indices in chop / between confluences.</div>
            <div className="text-xs text-muted-foreground/70 mt-1">Check back as the session develops. (Filters: ≥60% confidence, multi-indicator alignment required.)</div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {grouped.map(grp => {
            const up = (grp.spotChangePercent ?? 0) >= 0;
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
                        {grp.spotChangePercent != null && (
                          <span className={`ml-2 ${up ? "text-signal-strong-buy" : "text-signal-strong-sell"}`}>
                            {up ? "+" : ""}{grp.spotChangePercent.toFixed(2)}%
                          </span>
                        )}
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
  totalMfe: number;
  totalMae: number;
}

const EMPTY_KPI: KpiBucket = {
  total: 0, triggered: 0, t1Hit: 0, t2Hit: 0, stopped: 0, expired: 0, pending: 0,
  totalMfe: 0, totalMae: 0,
};

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
  return next;
}

function winRate(b: KpiBucket): number | null {
  // Win = T1_HIT or T2_HIT. Loss = STOPPED. EXPIRED counted as no-decision
  // (not a win, not a loss) — they aren't included in the denominator so
  // the rate isn't artificially deflated by signals that simply ran out
  // of session time.
  const wins = b.t1Hit + b.t2Hit;
  const losses = b.stopped;
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

function ScoreboardTab() {
  const { data, isLoading } = useGetOptionSignalHistory({
    query: {
      refetchInterval: 30000,
      queryKey: getGetOptionSignalHistoryQueryKey(),
    },
  });

  const items = data?.signals ?? [];

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

  if (isLoading) {
    return <Skeleton className="h-72 w-full" />;
  }
  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <div className="text-muted-foreground font-mono text-sm">
            No signals recorded for today yet.
          </div>
          <div className="text-xs text-muted-foreground/70 mt-1">
            As setups fire on the Live tab, they&apos;ll appear here with
            triggered / target / stop status and a running win-rate.
          </div>
        </CardContent>
      </Card>
    );
  }

  const overallWin = winRate(overall);

  return (
    <div className="space-y-6">
      {/* Headline KPIs */}
      <Card>
        <CardContent className="p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-3">
            Today&apos;s scoreboard · {data?.signalDate}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 text-xs font-mono">
            <KpiCell label="Signals" value={overall.total.toString()} />
            <KpiCell label="Triggered" value={overall.triggered.toString()} />
            <KpiCell label="T1 hit" value={overall.t1Hit.toString()} tone="text-signal-strong-buy" />
            <KpiCell label="T2 hit" value={overall.t2Hit.toString()} tone="text-signal-strong-buy" />
            <KpiCell label="Stopped" value={overall.stopped.toString()} tone="text-signal-strong-sell" />
            <KpiCell label="Expired" value={overall.expired.toString()} />
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
              sub={overallWin == null ? "no decided trades" : `${overall.t1Hit + overall.t2Hit}W / ${overall.stopped}L`}
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs font-mono mt-3 pt-3 border-t border-border/40">
            <KpiCell label="Avg MFE / signal" value={`+${avgMfe(overall).toFixed(2)} pts`} tone="text-signal-strong-buy" />
            <KpiCell label="Avg MAE / signal" value={`-${avgMae(overall).toFixed(2)} pts`} tone="text-signal-strong-sell" />
            <KpiCell label="Pending" value={overall.pending.toString()} sub="awaiting trigger" />
          </div>
        </CardContent>
      </Card>

      {/* By setup */}
      <Card>
        <CardContent className="p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-3">
            Performance by setup
          </div>
          <BucketTable rows={bySetup} keyLabel="Setup" />
        </CardContent>
      </Card>

      {/* By index */}
      <Card>
        <CardContent className="p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-3">
            Performance by index
          </div>
          <BucketTable rows={byIndex} keyLabel="Index" />
        </CardContent>
      </Card>

      {/* Detailed signal log */}
      <Card>
        <CardContent className="p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-3">
            Signal log ({items.length})
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/40">
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
                    key={`${it.indexSymbol}-${it.setupKey}-${it.direction}`}
                    className="border-b border-border/20 hover:bg-secondary/20"
                  >
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
          <p className="text-[10px] text-muted-foreground mt-3 leading-relaxed">
            Win rate counts only decided trades (T1/T2 hit vs stopped). Signals that ran past 15:30 IST without resolving are tagged EXPIRED and excluded from the rate. MFE / MAE are the maximum points the underlying moved in your favour / against you from the locked entry, observed during today&apos;s session.
          </p>
        </CardContent>
      </Card>
    </div>
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
            <th className="text-right py-1.5 px-2">Expired</th>
            <th className="text-right py-1.5 px-2">Win rate</th>
            <th className="text-right py-1.5 px-2">Avg MFE</th>
            <th className="text-right py-1.5 px-2">Avg MAE</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, b]) => {
            const wr = winRate(b);
            return (
              <tr key={name} className="border-b border-border/20 hover:bg-secondary/20">
                <td className="py-1.5 px-2 text-foreground">{name}</td>
                <td className="py-1.5 px-2 text-right tabular-nums">{b.total}</td>
                <td className="py-1.5 px-2 text-right tabular-nums">{b.triggered}</td>
                <td className="py-1.5 px-2 text-right tabular-nums text-signal-strong-buy">{b.t1Hit}</td>
                <td className="py-1.5 px-2 text-right tabular-nums text-signal-strong-buy">{b.t2Hit}</td>
                <td className="py-1.5 px-2 text-right tabular-nums text-signal-strong-sell">{b.stopped}</td>
                <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">{b.expired}</td>
                <td className={`py-1.5 px-2 text-right tabular-nums font-bold ${wr == null ? "text-muted-foreground" : wr >= 50 ? "text-signal-strong-buy" : "text-signal-strong-sell"}`}>
                  {wr == null ? "—" : `${wr}%`}
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
