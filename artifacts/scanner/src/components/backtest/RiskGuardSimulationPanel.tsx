/**
 * F&O Paper Risk Guard Simulation Panel.
 *
 * Shows simulation results for the 7 guard scenarios against historical
 * replay trades. All outputs clearly labelled SIMULATION ONLY.
 *
 * These guards affect paper auto-open only. They do not change signal generation.
 */
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Info,
} from "lucide-react";
import {
  useRiskGuardSimulation,
  type GuardScenarioResult,
  type SimulatedBlockedTrade,
  type RiskGuardSimulationOut,
} from "@/lib/backtest/useRiskGuardSimulation";

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function money(v: number | null, fallback = "n/a"): string {
  if (v === null || v === undefined) return fallback;
  const sign = v < 0 ? "\u2212" : v > 0 ? "+" : "";
  return `${sign}\u20b9${Math.abs(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function netColor(v: number | null): string {
  if (v === null) return "text-muted-foreground";
  if (v > 0) return "text-emerald-400";
  if (v < 0) return "text-rose-400";
  return "text-muted-foreground";
}

function improvColor(v: number): string {
  if (v > 1000) return "text-emerald-400";
  if (v < -1000) return "text-rose-400";
  return "text-muted-foreground";
}

function formatDate(iso: string | null): string {
  if (!iso) return "n/a";
  try {
    return new Date(iso).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Micro components
// ---------------------------------------------------------------------------

function SimOnly() {
  return (
    <span className="ml-1 rounded bg-amber-500/15 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-400">
      simulation only
    </span>
  );
}

function ShadowBadge({ mode }: { mode: string }) {
  if (mode === "shadow") {
    return (
      <Badge className="gap-1 bg-blue-500/20 text-blue-300 hover:bg-blue-500/20">
        <Shield className="h-3 w-3" />
        SHADOW MODE — observing only
      </Badge>
    );
  }
  return (
    <Badge className="gap-1 bg-orange-500/20 text-orange-300 hover:bg-orange-500/20">
      <ShieldAlert className="h-3 w-3" />
      PAPER-BLOCK MODE — active guards
    </Badge>
  );
}

function GuardReasonBadge({ reason }: { reason: string }) {
  const colors: Record<string, string> = {
    SENSEX_DISABLED_BY_REPLAY_DIAGNOSTICS: "bg-rose-500/20 text-rose-300",
    LOW_ENTRY_PREMIUM: "bg-orange-500/20 text-orange-300",
    NEAR_EXPIRY_THETA_RISK: "bg-amber-500/20 text-amber-300",
    SAME_STRIKE_DIRECTION_STOP_COOLDOWN: "bg-purple-500/20 text-purple-300",
    BAD_TIME_WINDOW_SHADOW_ONLY: "bg-blue-500/20 text-blue-300",
    HIGH_COST_TO_EDGE_RATIO_SHADOW_ONLY: "bg-slate-500/20 text-slate-300",
  };
  const cls = colors[reason] ?? "bg-muted/40 text-muted-foreground";
  const short: Record<string, string> = {
    SENSEX_DISABLED_BY_REPLAY_DIAGNOSTICS: "G4:SENSEX",
    LOW_ENTRY_PREMIUM: "G2:LOW-PREM",
    NEAR_EXPIRY_THETA_RISK: "G1:THETA",
    SAME_STRIKE_DIRECTION_STOP_COOLDOWN: "G3:COOLDOWN",
    BAD_TIME_WINDOW_SHADOW_ONLY: "BAD-TIME",
    HIGH_COST_TO_EDGE_RATIO_SHADOW_ONLY: "COST-EDGE",
  };
  return (
    <span className={`rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider ${cls}`}>
      {short[reason] ?? reason}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Blocked trade row
// ---------------------------------------------------------------------------

function BlockedTradeRow({ t }: { t: SimulatedBlockedTrade }) {
  const [open, setOpen] = useState(false);
  const priced = t.pricingMode === "REAL_CAPTURED_PREMIUM";
  return (
    <div className="rounded border border-border/30 bg-card/50">
      <button
        className="flex w-full items-start gap-2 px-3 py-2 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="mt-0.5 text-muted-foreground">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold">{t.underlying}</span>
            <span className="text-xs text-muted-foreground">{t.direction}</span>
            <span className="text-xs text-muted-foreground">{t.optionType}</span>
            {t.strike !== null && (
              <span className="text-xs font-mono">{t.strike.toLocaleString("en-IN")}</span>
            )}
            {t.dteCalendarDays !== null && (
              <span className="text-[10px] text-muted-foreground">DTE={t.dteCalendarDays}</span>
            )}
            {t.entryPremium !== null && (
              <span className="text-[10px] text-muted-foreground">
                \u20b9{t.entryPremium.toFixed(0)}
              </span>
            )}
            {!priced && (
              <Badge variant="outline" className="h-4 px-1 py-0 text-[9px] text-muted-foreground">
                UNAVAIL
              </Badge>
            )}
            {t.netPnl !== null && (
              <span className={`text-xs font-semibold tabular-nums ${netColor(t.netPnl)}`}>
                {money(t.netPnl)}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground">{t.exitReason ?? "?"}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap gap-1">
            {t.guardReasons.map((r) => (
              <GuardReasonBadge key={r} reason={r} />
            ))}
          </div>
        </div>
        {t.entryAt && (
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {formatDate(t.entryAt)}
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-border/30 px-3 py-2 space-y-1">
          {t.explanation.map((line, i) => (
            <p key={i} className="text-[11px] text-muted-foreground">
              {line}
            </p>
          ))}
          <div className="mt-1 grid grid-cols-3 gap-2 text-[10px]">
            <div>
              <span className="text-muted-foreground">Gross P&L</span>
              <div className={netColor(t.grossPnl)}>{money(t.grossPnl)}</div>
            </div>
            <div>
              <span className="text-muted-foreground">Net P&L</span>
              <div className={netColor(t.netPnl)}>{money(t.netPnl)}</div>
            </div>
            <div>
              <span className="text-muted-foreground">Expiry</span>
              <div className="font-mono">{t.expiry ?? "n/a"}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scenario card
// ---------------------------------------------------------------------------

function ScenarioCard({ s }: { s: GuardScenarioResult }) {
  const [open, setOpen] = useState(false);

  const improved = s.netImprovement > 0;
  const hasPricedData = s.pricedBlocked > 0;

  return (
    <Card className={`border ${improved ? "border-emerald-500/30" : "border-rose-500/20"}`}>
      <CardHeader className="pb-2 pt-3 px-4">
        <button
          className="flex w-full items-start justify-between gap-2 text-left"
          onClick={() => setOpen((o) => !o)}
        >
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-sm">{s.label}</CardTitle>
              <SimOnly />
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{s.description}</p>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            {improved ? (
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
            ) : (
              <ShieldX className="h-4 w-4 text-rose-400" />
            )}
            <span className={`text-sm font-bold tabular-nums ${improvColor(s.netImprovement)}`}>
              {money(s.netImprovement)}
            </span>
            {open ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </button>
      </CardHeader>

      <CardContent className="px-4 pb-3">
        {/* Summary grid */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-4 mb-2">
          <div className="text-[10px]">
            <span className="text-muted-foreground">Blocked</span>
            <div className="font-semibold">
              {s.tradesBlocked}
              {" "}
              <span className="text-muted-foreground font-normal">
                ({s.pricedBlocked} priced)
              </span>
            </div>
          </div>
          <div className="text-[10px]">
            <span className="text-muted-foreground">Winners blocked</span>
            <div className={`font-semibold ${s.winnersBlocked > 0 ? "text-rose-400" : "text-muted-foreground"}`}>
              {s.winnersBlocked}
            </div>
          </div>
          <div className="text-[10px]">
            <span className="text-muted-foreground">Losses avoided</span>
            <div className={`font-semibold tabular-nums ${s.losersBlocked > 0 ? "text-emerald-400" : "text-muted-foreground"}`}>
              {s.losersBlocked}
            </div>
          </div>
          <div className="text-[10px]">
            <span className="text-muted-foreground">Net improvement</span>
            <div className={`font-bold tabular-nums ${improvColor(s.netImprovement)}`}>
              {money(s.netImprovement)}
            </div>
          </div>
        </div>

        {/* P&L breakdown */}
        <div className="rounded bg-muted/20 p-2 text-[10px] space-y-0.5">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Net P&L saved (avoided losses)</span>
            <span className={netColor(-s.netPnlAvoided)}>{money(-s.netPnlAvoided)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Net P&L lost (blocked winners)</span>
            <span className={s.netPnlLostFromBlockedWinners > 0 ? "text-rose-400" : "text-muted-foreground"}>
              {s.netPnlLostFromBlockedWinners > 0 ? `\u2212${money(s.netPnlLostFromBlockedWinners).replace(/^[+\u2212]/, "")}` : "nil"}
            </span>
          </div>
        </div>

        {/* Per-underlying breakdown */}
        {Object.keys(s.byUnderlying).length > 0 && (
          <div className="mt-2 flex gap-2 flex-wrap">
            {Object.entries(s.byUnderlying).map(([ul, d]) => (
              <div key={ul} className="rounded border border-border/30 bg-card/40 px-2 py-1 text-[10px]">
                <div className="font-semibold">{ul}</div>
                <div className="text-muted-foreground">
                  {d.blocked} blocked · {d.winnersBlocked} winners
                </div>
                <div className={netColor(d.netPnlAvoided)}>
                  {money(-d.netPnlAvoided)} saved
                </div>
              </div>
            ))}
          </div>
        )}

        {!hasPricedData && (
          <p className="mt-2 text-[10px] text-amber-400">
            No priced (REAL_CAPTURED_PREMIUM) trades blocked — P&L impact unquantified for unpriced blocks.
          </p>
        )}

        {/* Expand: blocked trade list */}
        {open && s.blockedTrades.length > 0 && (
          <div className="mt-3 space-y-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Exact blocked trades ({s.blockedTrades.length})
            </div>
            {s.blockedTrades.map((t) => (
              <BlockedTradeRow key={t.tradeId} t={t} />
            ))}
          </div>
        )}
        {open && s.blockedTrades.length === 0 && (
          <div className="mt-3 rounded border border-border/30 p-3 text-[11px] text-muted-foreground">
            No trades blocked by this scenario.
          </div>
        )}

        {!open && s.blockedTrades.length > 0 && (
          <button
            className="mt-2 text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"
            onClick={() => setOpen(true)}
          >
            <ChevronRight className="h-3 w-3" />
            Show {s.blockedTrades.length} exact blocked trade{s.blockedTrades.length !== 1 ? "s" : ""}
          </button>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Active config summary
// ---------------------------------------------------------------------------

function ConfigRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-border/30 py-1 last:border-0">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className="text-[10px] font-medium tabular-nums">{value}</span>
    </div>
  );
}

function ActiveConfigCard({ cfg }: { cfg: RiskGuardSimulationOut["activeConfig"] }) {
  return (
    <div className="rounded border border-border/40 bg-card/40 p-3 space-y-0.5">
      <ConfigRow label="Mode" value={<ShadowBadge mode={cfg.mode} />} />
      <ConfigRow label="Low premium gate" value={cfg.lowPremiumGateEnabled ? "enabled" : "disabled"} />
      <ConfigRow
        label="Min entry premium"
        value={`NIFTY \u20b9${cfg.minEntryPremium.NIFTY} · BNF \u20b9${cfg.minEntryPremium.BANKNIFTY} · SX \u20b9${cfg.minEntryPremium.SENSEX}`}
      />
      <ConfigRow
        label="Theta risk guard"
        value={
          cfg.thetaRisk.enabled
            ? `DTE \u2264 ${cfg.thetaRisk.maxDteCalendarDays} + premium below threshold`
            : "disabled"
        }
      />
      <ConfigRow
        label="Re-entry cooldown"
        value={
          cfg.sameStrikeStopCooldown.enabled
            ? `${cfg.sameStrikeStopCooldown.minutes} min after STOP`
            : "disabled"
        }
      />
      <ConfigRow
        label="SENSEX paper auto-open"
        value={cfg.disableSensexPaperAutoOpen ? "DISABLED" : "enabled"}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function RiskGuardSimulationPanel({ runId }: { runId: string | null }) {
  const { data, isLoading, isError, error, isFetching, refetch } =
    useRiskGuardSimulation(runId);

  if (!runId) {
    return (
      <div className="rounded border border-border/40 p-6 text-center text-sm text-muted-foreground">
        Select a replay run to view risk guard simulation.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded border border-border/40 p-4 text-sm text-muted-foreground">
        <RefreshCw className="h-4 w-4 animate-spin" />
        Running simulation scenarios…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-400">
        Simulation failed: {(error as Error).message}
      </div>
    );
  }

  if (!data) return null;

  const combined = data.scenarios.find((s) => s.scenarioId === "COMBINED_G1_G2_G3");
  const bnfCheck = data.scenarios.find((s) => s.scenarioId === "BANKNIFTY_PROTECTION_CHECK");

  // Acceptance thresholds evaluation
  const acceptance = {
    combinedImproves: (combined?.netImprovement ?? 0) > 0,
    bnfNotDamaged: bnfCheck
      ? (bnfCheck.netPnlLostFromBlockedWinners) < 0.2 * 36527
      : true,
    thetaBlocked: (data.scenarios.find((s) => s.scenarioId === "THETA_RISK_ONLY")?.tradesBlocked ?? 0) >= 1,
    sensexDisableJustified: (data.scenarios.find((s) => s.scenarioId === "SENSEX_DISABLE_ONLY")?.netImprovement ?? 0) > 0,
  };
  const allPass = Object.values(acceptance).every(Boolean);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-400" />
            F&O Paper Auto-Open Risk Guard Simulation
            <SimOnly />
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            These guards affect paper auto-open only. They do not change signal generation, scoring, or sizing.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-auto gap-1 px-2 py-1 text-[10px]"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Disclaimer */}
      <div className="rounded border border-amber-500/30 bg-amber-500/5 p-3 text-[11px] text-amber-300 flex gap-2">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <span>
          <strong>Shadow mode is active.</strong> No paper trade is currently blocked.
          All output is retrospective simulation over {data.pricedTrades} priced + {data.unavailableTrades} unavailable replay trades.
          Enable paper-block mode only after simulation passes all acceptance thresholds.
        </span>
      </div>

      {/* Dataset overview */}
      <div className="grid grid-cols-3 gap-2 text-[10px]">
        <div className="rounded border border-border/30 bg-card/40 p-2">
          <div className="text-muted-foreground">Total trades</div>
          <div className="text-lg font-bold">{data.totalTrades}</div>
        </div>
        <div className="rounded border border-border/30 bg-card/40 p-2">
          <div className="text-muted-foreground">Priced (REAL_CAPTURED)</div>
          <div className="text-lg font-bold text-emerald-400">{data.pricedTrades}</div>
        </div>
        <div className="rounded border border-border/30 bg-card/40 p-2">
          <div className="text-muted-foreground">Unavailable</div>
          <div className="text-lg font-bold text-muted-foreground">{data.unavailableTrades}</div>
        </div>
      </div>

      {/* Active config */}
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Live Guard Configuration
        </div>
        <ActiveConfigCard cfg={data.activeConfig} />
      </div>

      {/* Acceptance thresholds */}
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Acceptance Thresholds (Part E)
          <SimOnly />
        </div>
        <div className="rounded border border-border/40 bg-card/40 p-3 space-y-1">
          {[
            { label: "Combined G1+G2+G3 improves net P&L", pass: acceptance.combinedImproves },
            { label: "BANKNIFTY winners blocked < 20% of +₹36,527 edge", pass: acceptance.bnfNotDamaged },
            { label: "Theta guard blocks ≥ 1 near-expiry disaster", pass: acceptance.thetaBlocked },
            { label: "SENSEX disable is net positive", pass: acceptance.sensexDisableJustified },
          ].map(({ label, pass }) => (
            <div key={label} className="flex items-center gap-2 text-[11px]">
              <span className={pass ? "text-emerald-400" : "text-rose-400"}>
                {pass ? "✓" : "✗"}
              </span>
              <span className={pass ? "text-foreground" : "text-rose-300"}>{label}</span>
            </div>
          ))}
          <div className="mt-2 pt-2 border-t border-border/30 text-[11px] font-semibold">
            {allPass ? (
              <span className="text-emerald-400">
                All thresholds pass — paper-block mode may be enabled after manual review.
              </span>
            ) : (
              <span className="text-amber-400">
                Some thresholds not yet met — keep all guards in shadow mode.
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Scenario cards */}
      <div>
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Simulation Scenarios (7)
        </div>
        <div className="space-y-3">
          {data.scenarios.map((s) => (
            <ScenarioCard key={s.scenarioId} s={s} />
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-border/40 pt-2 text-[10px] text-muted-foreground">
        <span>Simulated at {new Date(data.generatedAt).toLocaleString("en-IN")}</span>
        <span className="text-amber-400">SIMULATION ONLY — no live trading rules changed</span>
      </div>
    </div>
  );
}
