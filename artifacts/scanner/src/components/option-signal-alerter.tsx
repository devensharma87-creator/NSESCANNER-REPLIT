/**
 * OptionSignalAlerter — owner-only global watcher that pops a centred modal
 * the moment an intraday option signal transitions to TRIGGERED (entry hit)
 * or STOPPED (stop-loss hit). Mounts once at app root and runs on every
 * page so the owner is alerted no matter where they are in the app.
 *
 * Detection strategy
 * ------------------
 * 1. Polls GET /api/options/signal-history every 10 s using TanStack Query.
 * 2. Each signal is identified by its DB primary-key tuple:
 *      ${signalDate}:${indexSymbol}:${setupKey}:${direction}
 *    The "event" we deduplicate against is `${signalKey}:${status}`.
 * 3. On first successful fetch we silently prime the seen-set with every
 *    current (signal, status) pair — so reloading the page does NOT replay
 *    historic alerts. From that moment on, any new TRIGGERED or STOPPED
 *    event fires a modal + beep.
 * 4. Seen-set is mirrored to localStorage so a hard refresh keeps memory.
 *
 * Owner gate
 * ----------
 * useAuth().role must be "owner". Subscribers and logged-out visitors get
 * nothing. The /options/signal-history endpoint is itself gated on the
 * server, but we double-check on the client to avoid useless polls.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  useGetOptionSignalHistory,
  getGetOptionSignalHistoryQueryKey,
} from "@workspace/api-client-react";
import type { OptionSignalHistoryItem } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "scanner.optionSignalAlerter.seenEvents.v1";
const POLL_MS = 10_000;

type AlertKind = Milestone;

interface QueuedAlert {
  kind: AlertKind;
  signal: OptionSignalHistoryItem;
  firedAt: number; // ms
}

function signalKey(s: OptionSignalHistoryItem): string {
  return `${s.signalDate}:${s.indexSymbol}:${s.setupKey}:${s.direction}`;
}

/**
 * One lifecycle event we may alert on per signal. We key by the lifecycle
 * milestone (TRIGGERED / STOPPED) rather than the current status, because
 * a fast-moving market could push a signal PENDING -> TRIGGERED -> STOPPED
 * inside a single 10 s poll window. Comparing only against the snapshot
 * status would silently swallow the ENTRY alert in that case. By tracking
 * the existence of `triggeredAt` and `exitedAt` independently we can
 * always backfill a missed entry-hit alert from the timestamps.
 */
type Milestone = "TRIGGERED" | "STOPPED";

function eventKey(s: OptionSignalHistoryItem, milestone: Milestone): string {
  return `${signalKey(s)}:${milestone}`;
}

/** Returns the milestones a server snapshot has reached (in chronological order). */
function reachedMilestones(s: OptionSignalHistoryItem): Milestone[] {
  const out: Milestone[] = [];
  if (s.triggeredAt) out.push("TRIGGERED");
  // Only treat STOPPED as a stop-loss hit; do NOT alert when a PENDING
  // signal merely expires unfilled at 15:30 IST (exitReason EXPIRED_PENDING).
  if (s.exitedAt && s.exitReason === "STOPPED") out.push("STOPPED");
  return out;
}

function loadSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

function saveSeen(set: Set<string>): void {
  try {
    // Cap the set so localStorage doesn't grow unbounded across days. We
    // only need today's events to dedup, so keep the last ~500 entries.
    const arr = Array.from(set).slice(-500);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
  } catch {
    /* localStorage may be full or unavailable — silently degrade */
  }
}

/**
 * Plays a short two-tone beep. Different pattern for entry vs stop so the
 * owner can distinguish without looking at the screen. Web Audio API only,
 * no audio asset bundled. Browsers require a prior user gesture for audio
 * to play; if the page hasn't been clicked yet the call simply no-ops.
 */
function beep(kind: AlertKind): void {
  try {
    const AC: typeof AudioContext | undefined =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const now = ctx.currentTime;
    // Two short pings. TRIGGERED = ascending (good news = entry executed);
    // STOPPED = descending (stop-loss hit, urgent).
    const tones = kind === "TRIGGERED" ? [880, 1320] : [880, 440];
    tones.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.18, now + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.18);
      osc.stop(now + i * 0.18 + 0.18);
    });
    // Close after the sound finishes so we don't leak audio contexts.
    setTimeout(() => { void ctx.close().catch(() => undefined); }, 600);
  } catch {
    /* audio context can throw on some locked-down browsers — ignore */
  }
}

function fmt(n: number, d = 2): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function formatTime(iso: string | undefined | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return "—";
  }
}

export function OptionSignalAlerter() {
  const { role } = useAuth();
  const isOwner = role === "owner";

  // Seen-events dedup set — survives across renders + page reloads.
  const seenRef = useRef<Set<string>>(loadSeen());
  const primedRef = useRef<boolean>(false);

  // Queue of alerts to show. We display them one at a time so a burst of
  // simultaneous triggers doesn't stack into chaos.
  const [queue, setQueue] = useState<QueuedAlert[]>([]);
  const [dismissedNonce, setDismissedNonce] = useState<number>(0);

  const { data } = useGetOptionSignalHistory({
    query: {
      enabled: isOwner,
      refetchInterval: isOwner ? POLL_MS : false,
      refetchIntervalInBackground: false,
      queryKey: getGetOptionSignalHistoryQueryKey(),
    },
  });

  useEffect(() => {
    if (!isOwner || !data) return;
    const signals: OptionSignalHistoryItem[] = data.signals ?? [];

    // First load: silently mark every milestone that's already been
    // reached as "seen", so reloading the page doesn't replay alerts
    // for events that fired before the user even opened the app.
    if (!primedRef.current) {
      for (const s of signals) {
        for (const m of reachedMilestones(s)) {
          seenRef.current.add(eventKey(s, m));
        }
      }
      saveSeen(seenRef.current);
      primedRef.current = true;
      return;
    }

    // Subsequent polls: any milestone that's reached but not in the
    // seen set fires a fresh alert. Iterating per milestone (rather
    // than per current status) means a signal that flipped PENDING ->
    // TRIGGERED -> STOPPED inside a single 10s window will fire BOTH
    // the entry and stop-loss alerts, not just the latter.
    const newAlerts: QueuedAlert[] = [];
    const now = Date.now();
    for (const s of signals) {
      for (const m of reachedMilestones(s)) {
        const k = eventKey(s, m);
        if (seenRef.current.has(k)) continue;
        seenRef.current.add(k);
        newAlerts.push({ kind: m, signal: s, firedAt: now });
      }
    }

    if (newAlerts.length > 0) {
      saveSeen(seenRef.current);
      // Beep once per batch (not once per alert) so it's not deafening.
      // Prefer the more urgent STOPPED tone if a stop is in the batch.
      const tone: AlertKind = newAlerts.some(a => a.kind === "STOPPED") ? "STOPPED" : "TRIGGERED";
      beep(tone);
      setQueue(prev => [...prev, ...newAlerts]);
    }
  }, [data, isOwner]);

  const current = queue[0];
  const open = !!current;

  const onDismiss = () => {
    setQueue(prev => prev.slice(1));
    setDismissedNonce(n => n + 1);
  };
  const onDismissAll = () => {
    setQueue([]);
    setDismissedNonce(n => n + 1);
  };

  // Compose UI bits derived from the current alert.
  // EXECUTION TRUTH: uses backend `execution` fields (from paper_trade_fo /
  // skip ring), NEVER derives paper-trade status from tier alone.
  const ui = useMemo(() => {
    if (!current) return null;
    const s = current.signal;
    const isEntry = current.kind === "TRIGGERED";
    const tier = (s.tier ?? "BASELINE").toUpperCase();

    // --- Execution truth from backend (additive fields) ---
    // The backend sends `execution` on signal-history rows. For the
    // Orval-generated OptionSignalHistoryItem type we cast to access
    // the additive field without touching codegen.
    const exec = (s as Record<string, unknown>).execution as {
      signalTier?: string;
      signalTradeable?: boolean;
      executionStatus?: string;
      executionBlockedReason?: string | null;
      paperTradeOpened?: boolean;
      paperTradePositionId?: string | null;
      paperTradeLots?: number | null;
      paperTradeEntryPremium?: number | null;
      finalAlertClass?: string;
    } | undefined;

    const execStatus = exec?.executionStatus ?? "NOT_CONFIRMED";
    const isOpened = execStatus === "OPENED";
    const isBlocked = execStatus === "BLOCKED";
    const isInfoOnly = execStatus === "NOT_APPLICABLE";
    const isNotConfirmed = execStatus === "NOT_CONFIRMED";
    const blockReason = exec?.executionBlockedReason ?? null;

    // --- Paper trade badge (4-state, never YES) ---
    let paperBadgeLabel: string;
    let paperBadgeTone: "opened" | "blocked" | "info" | "notconfirmed";
    if (isOpened) {
      paperBadgeLabel = "PAPER TRADE: OPENED";
      paperBadgeTone = "opened";
    } else if (isBlocked) {
      paperBadgeLabel = "PAPER TRADE: BLOCKED";
      paperBadgeTone = "blocked";
    } else if (isInfoOnly) {
      paperBadgeLabel = "PAPER TRADE: NO";
      paperBadgeTone = "info";
    } else {
      paperBadgeLabel = "PAPER TRADE: NOT CONFIRMED";
      paperBadgeTone = "notconfirmed";
    }

    // --- Paper trade reason text ---
    let paperReason: string | null = null;
    if (isBlocked && blockReason) {
      const friendlyReasons: Record<string, string> = {
        DAILY_DD_CAP: "Blocked — daily drawdown cap latched",
        WEEKLY_DD_CAP: "Blocked — weekly drawdown cap latched",
        PORTFOLIO_HEAT: "Blocked — portfolio heat cap exceeded",
        PORTFOLIO_HEAT_CAP: "Blocked — portfolio heat cap exceeded",
        RISK_TOO_WIDE_FOR_MIN_LOT: "Blocked — risk too wide for minimum lot sizing",
        PREMIUM_UNTRUSTED: "Blocked — option premium is not Kite-trusted",
        DUPLICATE_POSITION: "Blocked — duplicate open position exists",
        MARKET_CLOSED: "Blocked — market is closed",
        CONSECUTIVE_STOPS: "Blocked — consecutive stops circuit breaker",
        DAILY_TRADE_CAP: "Blocked — daily trade cap reached",
        BASELINE_DAILY_CAP: "Blocked — baseline daily trade cap reached",
        BASELINE_DAILY_DD_CAP: "Blocked — baseline daily DD cap latched",
        BASELINE_CONSECUTIVE_LOSSES: "Blocked — baseline consecutive losses",
        BASELINE_GUARDRAIL_STATS_UNAVAILABLE: "Blocked — guardrail stats unavailable",
        INSUFFICIENT_BALANCE: "Blocked — insufficient paper account balance",
        BUDGET_TOO_TIGHT: "Blocked — budget too tight for minimum position",
        TIME_FILTER_LATE: "Blocked — too late in the session for new entries",
        BASELINE_LATE: "Blocked — too late for baseline entries",
        LIQUIDITY_LTP: "Blocked — option LTP liquidity check failed",
        LIQUIDITY_SPREAD: "Blocked — option bid-ask spread too wide",
        LIQUIDITY_OI: "Blocked — option open interest too low",
        LIQUIDITY_CHAIN_MISSING: "Blocked — live option chain unavailable",
        INVALID_PREMIUM_PLAN: "Blocked — premium plan validation failed",
        DATA_QUALITY_DELAYED: "Blocked — data quality is delayed (not live Kite)",
        DATA_QUALITY_STALE: "Blocked — data quality is stale",
        MISSED_WINDOW: "Blocked — signal already exited before paper trade could open",
        INFO_ONLY_NOT_TRADEABLE: "Info-only — not eligible for auto-trade",
        BASELINE_NOT_TRADEABLE: "Baseline — lower conviction, not auto-traded",
        CONFIDENCE_FLOOR: "Blocked — confidence below minimum floor",
      };
      paperReason = friendlyReasons[blockReason] ?? `Blocked — ${blockReason}`;
    } else if (isInfoOnly) {
      paperReason = tier === "BASELINE"
        ? "BASELINE tier — lower conviction, not auto-traded"
        : tier === "INFO_ONLY"
          ? "INFO_ONLY tier — informational outlook, not auto-traded"
          : `${tier} tier — not eligible for auto-trade`;
    } else if (isNotConfirmed) {
      paperReason = "Execution not confirmed — no paper trade record found for this signal. "
        + "This may indicate a server restart or timing gap.";
    }

    let headerBg: string;
    let headerText: string;
    let title: string;

    if (!isEntry) {
      // Stop-loss hit — always urgent
      headerBg = "bg-red-500/10 border-red-500/40";
      headerText = "text-red-300";
      title = "STOP LOSS HIT";
    } else if (isOpened) {
      // Execution confirmed — paper trade was actually opened
      headerBg = "bg-cyan-500/10 border-cyan-500/40";
      headerText = "text-cyan-300";
      title = "TRADEABLE ENTRY TRIGGERED";
    } else if (isBlocked) {
      // Tradeable signal but execution was blocked by a guardrail
      headerBg = "bg-amber-500/10 border-amber-500/40";
      headerText = "text-amber-300";
      title = "TRADEABLE SETUP — EXECUTION BLOCKED";
    } else if (isNotConfirmed && (tier === "HIGH_CONVICTION" || tier === "STANDARD")) {
      // HC/STANDARD but no evidence of execution
      headerBg = "bg-amber-500/10 border-amber-500/40";
      headerText = "text-amber-300";
      title = "TRADEABLE SETUP — EXECUTION NOT CONFIRMED";
    } else {
      // INFO_ONLY / BASELINE / demoted — entry level reached but not auto-traded
      headerBg = "bg-amber-500/10 border-amber-500/40";
      headerText = "text-amber-300";
      title = "INFO ALERT — ENTRY LEVEL REACHED";
    }

    const optionLabel = `${s.indexName} ${s.strike} ${s.optionType}`;
    const signalId = `${s.signalDate}:${s.indexSymbol}:${s.setupKey}:${s.direction}`;
    return {
      s, isEntry, headerBg, headerText, title, optionLabel, tier,
      paperBadgeLabel, paperBadgeTone, paperReason, signalId,
      exec, isOpened, isBlocked,
    };
  }, [current]);

  if (!isOwner) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={openNext => { if (!openNext) onDismiss(); }}
      // The nonce key forces full remount per alert so animations replay.
      key={`alert-${dismissedNonce}-${current ? eventKey(current.signal, current.kind) : "none"}`}
    >
      <DialogContent className={`max-w-md ${ui?.headerBg ?? ""} border-2`}>
        <DialogHeader>
          <DialogTitle className={`font-mono uppercase tracking-wider text-lg ${ui?.headerText ?? ""}`}>
            {ui?.title ?? ""}
            {queue.length > 1 ? (
              <span className="ml-2 text-xs text-muted-foreground normal-case tracking-normal">
                (+{queue.length - 1} more)
              </span>
            ) : null}
          </DialogTitle>
          <DialogDescription className="font-mono text-xs text-muted-foreground">
            {ui?.s.setupName ?? ui?.s.setupKey ?? "Setup"} · {ui?.s.direction}
          </DialogDescription>
          {ui ? (
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider ${
                ui.exec?.signalTradeable
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                  : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
              }`}>
                {ui.tier}
              </span>
              <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider bg-zinc-700/50 text-zinc-400 border border-zinc-600/30">
                Historical snapshot · {ui.isEntry ? "triggered" : "stopped"} at {formatTime(ui.isEntry ? ui.s.triggeredAt : ui.s.exitedAt)}
              </span>
              <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider ${
                ui.paperBadgeTone === "opened"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  : ui.paperBadgeTone === "blocked"
                    ? "bg-red-500/20 text-red-300 border border-red-500/30"
                    : ui.paperBadgeTone === "notconfirmed"
                      ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                      : "bg-zinc-700/50 text-zinc-500 border border-zinc-600/30"
              }`}>
                {ui.paperBadgeLabel}
              </span>
            </div>
          ) : null}
        </DialogHeader>

        {ui ? (
          <div className="space-y-3 font-mono text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-xs uppercase tracking-wider">Instrument</span>
              <span className="text-base font-semibold">{ui.optionLabel}</span>
            </div>

            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Spot levels
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded border border-border/50 p-2">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Entry</div>
                  <div className="text-sm tabular-nums">{fmt(ui.s.entry)}</div>
                </div>
                <div className="rounded border border-border/50 p-2">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Stop loss</div>
                  <div className="text-sm tabular-nums text-signal-strong-sell">{fmt(ui.s.stopLoss)}</div>
                </div>
                <div className="rounded border border-border/50 p-2">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Target 1</div>
                  <div className="text-sm tabular-nums text-signal-strong-buy">{fmt(ui.s.target1)}</div>
                </div>
                <div className="rounded border border-border/50 p-2">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Target 2</div>
                  <div className="text-sm tabular-nums text-signal-strong-buy">{fmt(ui.s.target2)}</div>
                </div>
              </div>
            </div>

            {ui.s.optionEntry != null
              || ui.s.optionStopLoss != null
              || ui.s.optionTarget1 != null
              || ui.s.optionTarget2 != null ? (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                  Option premium ({ui.s.optionType})
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded border border-border/50 p-2">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Entry</div>
                    <div className="text-sm tabular-nums">
                      {ui.s.optionEntry != null ? fmt(ui.s.optionEntry) : "—"}
                    </div>
                  </div>
                  <div className="rounded border border-border/50 p-2">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Stop loss</div>
                    <div className="text-sm tabular-nums text-signal-strong-sell">
                      {ui.s.optionStopLoss != null ? fmt(ui.s.optionStopLoss) : "—"}
                    </div>
                  </div>
                  <div className="rounded border border-border/50 p-2">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Target 1</div>
                    <div className="text-sm tabular-nums text-signal-strong-buy">
                      {ui.s.optionTarget1 != null ? fmt(ui.s.optionTarget1) : "—"}
                    </div>
                  </div>
                  <div className="rounded border border-border/50 p-2">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Target 2</div>
                    <div className="text-sm tabular-nums text-signal-strong-buy">
                      {ui.s.optionTarget2 != null ? fmt(ui.s.optionTarget2) : "—"}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {/* Paper trade details when OPENED */}
            {ui.isOpened && ui.exec ? (
              <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-2 text-xs space-y-1">
                <div className="text-emerald-300 uppercase tracking-wider text-[10px] font-bold">Paper trade opened</div>
                {ui.exec.paperTradeLots != null && (
                  <div className="text-muted-foreground">Lots: <span className="text-foreground">{ui.exec.paperTradeLots}</span></div>
                )}
                {ui.exec.paperTradeEntryPremium != null && (
                  <div className="text-muted-foreground">Entry premium: <span className="text-foreground tabular-nums">₹{ui.exec.paperTradeEntryPremium.toFixed(2)}</span></div>
                )}
                {ui.exec.paperTradePositionId && (
                  <div className="text-muted-foreground/60 text-[10px] break-all">ID: {ui.exec.paperTradePositionId}</div>
                )}
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-border/40">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Generated</div>
                <div className="tabular-nums">{formatTime(ui.s.generatedAt)} IST</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {ui.isEntry ? "Triggered" : "Stopped"}
                </div>
                <div className="tabular-nums">
                  {formatTime(ui.isEntry ? ui.s.triggeredAt : ui.s.exitedAt)} IST
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Spot</div>
                <div className="tabular-nums">{fmt(ui.s.lastSpot)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Confidence</div>
                <div className="tabular-nums">{ui.s.confidence}%</div>
              </div>
            </div>

            {/* Signal ID for traceability */}
            <div className="text-[10px] font-mono text-muted-foreground/60 pt-1 border-t border-border/20 break-all">
              Signal: {ui.signalId}
            </div>

            {/* Execution block reason */}
            {(ui.isBlocked || ui.paperBadgeTone === "info" || ui.paperBadgeTone === "notconfirmed") && ui.paperReason ? (
              <div className={`rounded border p-2 text-xs ${
                ui.isBlocked
                  ? "border-red-500/30 bg-red-500/5 text-red-300/80"
                  : ui.paperBadgeTone === "notconfirmed"
                    ? "border-amber-500/30 bg-amber-500/5 text-amber-300/80"
                    : "border-amber-500/30 bg-amber-500/5 text-amber-300/80"
              }`}>
                {ui.paperReason}
              </div>
            ) : null}

            {!ui.isEntry && ui.s.exitPrice != null ? (
              <div className="rounded border border-red-500/40 bg-red-500/5 p-2 text-xs">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Exit price</div>
                <div className="text-sm tabular-nums text-red-300">{fmt(ui.s.exitPrice)}</div>
              </div>
            ) : null}
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:gap-2">
          {queue.length > 1 ? (
            <Button variant="ghost" size="sm" onClick={onDismissAll} className="font-mono text-xs uppercase">
              Dismiss all
            </Button>
          ) : null}
          <Button onClick={onDismiss} className="font-mono text-xs uppercase">
            OK
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
