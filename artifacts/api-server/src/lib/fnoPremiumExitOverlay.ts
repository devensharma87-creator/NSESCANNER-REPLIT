/**
 * F&O Premium Exit Strategy Overlay — SAFE PHASED v1 (premium-based).
 *
 * Background. The F&O paper-trader's exits are driven by the SPOT lifecycle
 * (`evaluateTransition` against the locked spot stop/targets). The option
 * PREMIUM is tracked for MTM only; it is NOT used as an active exit signal.
 * Replay of closed trades showed two failure modes this overlay addresses:
 *
 *   1. (LIVE, this file) A long option's PREMIUM can collapse far below its
 *      locked `stop_premium` WITHOUT the spot breaching the spot stop, so no
 *      spot-driven stop fires and the position rides to the 15:20 force-exit
 *      at a much worse premium than its own defined risk (observed: a leg
 *      whose premium fell to ~13 against a stop_premium of ~61, settling near
 *      -2.8R instead of the intended -1R). The PREMIUM HARD-STOP BACKSTOP
 *      closes such a row at the locked stop premium (reason STOPPED), capping
 *      a defined-risk trade at ~-1R.
 *
 *   2. (SIMULATION ONLY, this file) Profit round-tripping — trades reach a
 *      healthy MFE then give most of it back, sometimes flipping winner→loser.
 *      Profit-protection rules (arming / breakeven / max-giveback /
 *      time-tightening) are modelled here for DIAGNOSTIC/REPORTING purposes
 *      only. They are deliberately NOT wired into any live exit path: the
 *      usable replay sample is too small (~9 trades with MFE/MAE tracking) to
 *      tune thresholds without overfitting. See `simulateProfitProtection`.
 *
 * Contract safety. The live hard-stop reuses the EXISTING `STOPPED` close
 * reason — no new `exit_reason` enum value, no OpenAPI/Zod/codegen/report-UI
 * change. Granular provenance is recorded in the free-text `tags[]`/`journal`
 * columns (`PREMIUM_STOP_HIT` / `PREMIUM_BACKSTOP`), which are NOT enumerated.
 *
 * Isolation. Like `forceCloseAllOpenFnoFor1520` / `evaluateOrphanedOpenTrades`
 * this sweep only ever CLOSES existing trades, so it is intentionally NOT gated
 * by `isPaperAutoTradingEnabled()` (the dev/prod isolation rule gates OPENs,
 * not corrective exits). In dev there are no OPEN rows, so it is a no-op.
 *
 * Failure model. Per-row + top-level try/catch; always resolves. The
 * authoritative close goes through the existing `closePaperTradeForSignal`
 * (single-txn CAS + account credit + reasoning log), so account accounting is
 * never duplicated here. The tags/journal write is a best-effort follow-up: if
 * it fails the trade is still correctly CLOSED as STOPPED.
 */
import { and, eq } from "drizzle-orm";
import { db, paperTradeFoTable } from "@workspace/db";
import { logger } from "./logger";
import { closePaperTradeForSignal, type CloseReason } from "./paperTradingFO";

function num(v: string | number | null | undefined): number {
  if (v == null) return NaN;
  return typeof v === "number" ? v : Number(v);
}

// ───────────────────────────────────────────────────────────────────────────
// Pure decision — premium hard-stop backstop
// ───────────────────────────────────────────────────────────────────────────

/**
 * Freshness gate. The overlay runs immediately after the MTM sweeps
 * (`markOpenFnoTradesToMarket` → `markAllOpenFnoTradesToMarket`) which refresh
 * `last_premium` / `last_evaluated_at` for every OPEN row that has a live
 * quote. A row with NO live quote (deep-OTM / illiquid) keeps an older
 * `last_evaluated_at` and a frozen `last_premium` — exactly the case we must
 * NOT hard-stop on. 120s comfortably covers one ~30s sweep cycle while
 * rejecting genuinely stale premiums.
 */
export const PREMIUM_OVERLAY_FRESHNESS_WINDOW_MS = 120_000;

export type PremiumHardStopSkipReason =
  | "NOT_OPEN"
  | "MISSING_LAST_PREMIUM"
  | "MISSING_STOP_PREMIUM"
  | "MISSING_ENTRY_PREMIUM"
  | "INVALID_PREMIUM_RISK"
  | "STALE_MTM"
  | "ABOVE_STOP";

export type PremiumHardStopDecision =
  | { action: "STOP"; reasonTag: "PREMIUM_STOP_HIT" }
  | { action: "SKIP"; skipReason: PremiumHardStopSkipReason };

export interface PremiumHardStopInput {
  status: string;
  /** Live option premium (refreshed by the MTM sweep). */
  lastPremium: number;
  /** Locked stop premium frozen at open. */
  stopPremium: number;
  /** Locked entry premium frozen at open. */
  entryPremium: number;
  /** ms epoch of `last_evaluated_at`. */
  lastEvaluatedAtMs: number;
  /** ms epoch "now". */
  nowMs: number;
  freshnessWindowMs?: number;
}

/**
 * Decide whether a single OPEN long-option row should be closed by the premium
 * hard-stop backstop. Both CE and PE legs are LONG (premium up = profit), so
 * the rule is identical for both: close when `last_premium <= stop_premium`.
 *
 * Conservative & fail-safe: every malformed / stale / above-stop case returns
 * SKIP — the existing spot lifecycle, orphan sweep and 15:20 force-exit remain
 * the backstops for anything this overlay declines to act on.
 */
export function decidePremiumHardStop(
  i: PremiumHardStopInput,
): PremiumHardStopDecision {
  const win = i.freshnessWindowMs ?? PREMIUM_OVERLAY_FRESHNESS_WINDOW_MS;
  if (i.status !== "OPEN") return { action: "SKIP", skipReason: "NOT_OPEN" };
  if (!Number.isFinite(i.lastPremium) || i.lastPremium <= 0)
    return { action: "SKIP", skipReason: "MISSING_LAST_PREMIUM" };
  if (!Number.isFinite(i.stopPremium) || i.stopPremium <= 0)
    return { action: "SKIP", skipReason: "MISSING_STOP_PREMIUM" };
  if (!Number.isFinite(i.entryPremium) || i.entryPremium <= 0)
    return { action: "SKIP", skipReason: "MISSING_ENTRY_PREMIUM" };
  // premiumRisk must be strictly positive (stop below entry) — always true for
  // a long option; a non-positive value means a malformed plan → never act.
  const premiumRisk = i.entryPremium - i.stopPremium;
  if (!(premiumRisk > 0))
    return { action: "SKIP", skipReason: "INVALID_PREMIUM_RISK" };
  if (
    !Number.isFinite(i.lastEvaluatedAtMs) ||
    i.nowMs - i.lastEvaluatedAtMs > win
  )
    return { action: "SKIP", skipReason: "STALE_MTM" };
  if (i.lastPremium <= i.stopPremium)
    return { action: "STOP", reasonTag: "PREMIUM_STOP_HIT" };
  return { action: "SKIP", skipReason: "ABOVE_STOP" };
}

export const PREMIUM_STOP_TAGS = ["PREMIUM_STOP_HIT", "PREMIUM_BACKSTOP"] as const;

export function buildPremiumStopJournal(
  lastPremium: number,
  stopPremium: number,
): string {
  return (
    `Closed by premium hard-stop backstop: last_premium (${lastPremium}) <= ` +
    `stop_premium (${stopPremium}). Existing STOPPED reason reused to preserve ` +
    `API/report compatibility; granular provenance in tags[].`
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Process-local sweep-health counters (diagnostics only)
// ───────────────────────────────────────────────────────────────────────────

export interface PremiumOverlayCycleStats {
  considered: number;
  stopped: number;
  skippedAboveStop: number;
  skippedStaleMtm: number;
  skippedMissingData: number;
  skippedInvalidRisk: number;
  /** Rows that WOULD have hard-stopped but were skipped because MTM was stale.
   *  The genuinely actionable diagnostic (data gap masking a real stop). */
  wouldStopButStale: number;
  /** Best-effort tags/journal write failures (trade still CLOSED). */
  tagWriteFailures: number;
  errors: number;
}

export interface PremiumOverlayHealth {
  cyclesTotal: number;
  stoppedTotal: number;
  lastCycle: PremiumOverlayCycleStats | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorClass: string | null;
  lastErrorMessage: string | null;
  bootedAt: string;
}

let premiumOverlayCyclesTotal = 0;
let premiumOverlayStoppedTotal = 0;
let premiumOverlayLastCycle: PremiumOverlayCycleStats | null = null;
let premiumOverlayLastSuccessAt: Date | null = null;
let premiumOverlayLastErrorAt: Date | null = null;
let premiumOverlayLastErrorClass: string | null = null;
let premiumOverlayLastErrorMessage: string | null = null;
const premiumOverlayBootedAt = new Date();

export function getPremiumOverlayHealth(): PremiumOverlayHealth {
  return {
    cyclesTotal: premiumOverlayCyclesTotal,
    stoppedTotal: premiumOverlayStoppedTotal,
    lastCycle: premiumOverlayLastCycle,
    lastSuccessAt: premiumOverlayLastSuccessAt
      ? premiumOverlayLastSuccessAt.toISOString()
      : null,
    lastErrorAt: premiumOverlayLastErrorAt
      ? premiumOverlayLastErrorAt.toISOString()
      : null,
    lastErrorClass: premiumOverlayLastErrorClass,
    lastErrorMessage: premiumOverlayLastErrorMessage,
    bootedAt: premiumOverlayBootedAt.toISOString(),
  };
}

/** Test-only reset of the premium-overlay sweep-health counters. */
export function __resetPremiumOverlayHealthForTests(): void {
  premiumOverlayCyclesTotal = 0;
  premiumOverlayStoppedTotal = 0;
  premiumOverlayLastCycle = null;
  premiumOverlayLastSuccessAt = null;
  premiumOverlayLastErrorAt = null;
  premiumOverlayLastErrorClass = null;
  premiumOverlayLastErrorMessage = null;
}

// ───────────────────────────────────────────────────────────────────────────
// Live sweep — premium hard-stop backstop ONLY
// ───────────────────────────────────────────────────────────────────────────

type CloserFn = (
  signalDate: string,
  indexSymbol: string,
  setupKey: string,
  direction: "BULLISH" | "BEARISH",
  reason: CloseReason,
) => Promise<unknown>;

/**
 * Sweep every OPEN paper_trade_fo row for the IST day and close any whose live
 * premium has fallen to/through its locked stop premium, settling at the locked
 * stop premium via `closePaperTradeForSignal(..., "STOPPED")`. Granular
 * provenance (`PREMIUM_STOP_HIT` / `PREMIUM_BACKSTOP`) is appended to
 * `tags[]`/`journal` after a successful close (best-effort).
 *
 * Wired into `getOptionSignals` AFTER `evaluateOrphanedOpenTrades` and BEFORE
 * the 15:20 force-exit: spot-driven exits get first claim on a row, the premium
 * backstop catches what they miss, and any survivor still hits the 15:20 net.
 *
 * `dbHandle` / `closer` / `nowMs` are injectable for tests (mirrors the
 * `evaluateOrphanedOpenTrades` seam); production passes nothing.
 */
export async function runPremiumHardStopSweep(
  signalDate: string,
  dbHandle: Pick<typeof db, "select" | "update"> = db,
  closer: CloserFn = closePaperTradeForSignal,
  nowMs: number = Date.now(),
): Promise<PremiumOverlayCycleStats> {
  const stats: PremiumOverlayCycleStats = {
    considered: 0,
    stopped: 0,
    skippedAboveStop: 0,
    skippedStaleMtm: 0,
    skippedMissingData: 0,
    skippedInvalidRisk: 0,
    wouldStopButStale: 0,
    tagWriteFailures: 0,
    errors: 0,
  };
  premiumOverlayCyclesTotal += 1;
  try {
    const openRows = await dbHandle
      .select({
        id: paperTradeFoTable.id,
        signalDate: paperTradeFoTable.signalDate,
        indexSymbol: paperTradeFoTable.indexSymbol,
        setupKey: paperTradeFoTable.setupKey,
        direction: paperTradeFoTable.direction,
        entryPremium: paperTradeFoTable.entryPremium,
        stopPremium: paperTradeFoTable.stopPremium,
        lastPremium: paperTradeFoTable.lastPremium,
        lastEvaluatedAt: paperTradeFoTable.lastEvaluatedAt,
        status: paperTradeFoTable.status,
        tags: paperTradeFoTable.tags,
        journal: paperTradeFoTable.journal,
      })
      .from(paperTradeFoTable)
      .where(
        and(
          eq(paperTradeFoTable.signalDate, signalDate),
          eq(paperTradeFoTable.status, "OPEN"),
        ),
      );

    stats.considered = openRows.length;
    if (openRows.length === 0) {
      premiumOverlayLastCycle = stats;
      premiumOverlayLastSuccessAt = new Date();
      return stats;
    }

    for (const row of openRows) {
      try {
        const lastPremium = num(row.lastPremium);
        const stopPremium = num(row.stopPremium);
        const entryPremium = num(row.entryPremium);
        const lastEvalMs = row.lastEvaluatedAt
          ? new Date(row.lastEvaluatedAt).getTime()
          : NaN;
        const dir: "BULLISH" | "BEARISH" =
          row.direction === "BEARISH" ? "BEARISH" : "BULLISH";

        const decision = decidePremiumHardStop({
          status: row.status,
          lastPremium,
          stopPremium,
          entryPremium,
          lastEvaluatedAtMs: lastEvalMs,
          nowMs,
        });

        if (decision.action === "SKIP") {
          switch (decision.skipReason) {
            case "ABOVE_STOP":
              stats.skippedAboveStop += 1;
              break;
            case "STALE_MTM":
              stats.skippedStaleMtm += 1;
              // Surface the dangerous case: a row that WOULD hard-stop on the
              // last-known premium but whose MTM is stale. Logged so a data gap
              // masking a real stop is visible rather than silent.
              if (
                Number.isFinite(lastPremium) &&
                Number.isFinite(stopPremium) &&
                lastPremium > 0 &&
                stopPremium > 0 &&
                lastPremium <= stopPremium
              ) {
                stats.wouldStopButStale += 1;
                logger.warn(
                  {
                    id: row.id,
                    idx: row.indexSymbol,
                    setup: row.setupKey,
                    dir,
                    lastPremium,
                    stopPremium,
                  },
                  "PREMIUM_HARD_STOP_SKIPPED_STALE — premium at/below stop but MTM is stale; not closing (spot/orphan/15:20 nets remain)",
                );
              }
              break;
            case "INVALID_PREMIUM_RISK":
              stats.skippedInvalidRisk += 1;
              break;
            default:
              stats.skippedMissingData += 1;
              break;
          }
          continue;
        }

        // STOP: settle at the locked stop premium via the authoritative close.
        const out = await closer(
          row.signalDate,
          row.indexSymbol,
          row.setupKey,
          dir,
          "STOPPED",
        );
        if (!out) {
          // Lost the CAS race (already closed by spot/orphan path this cycle)
          // or nothing OPEN — not an error.
          continue;
        }
        stats.stopped += 1;
        premiumOverlayStoppedTotal += 1;
        logger.info(
          {
            id: row.id,
            idx: row.indexSymbol,
            setup: row.setupKey,
            dir,
            lastPremium,
            stopPremium,
            entryPremium,
          },
          "PREMIUM_HARD_STOP — closed at locked stop premium (premium backstop); exit_reason=STOPPED, tags+=PREMIUM_STOP_HIT/PREMIUM_BACKSTOP",
        );

        // Best-effort provenance write — the trade is already CLOSED, so a
        // failure here is cosmetic and must not surface as a row error.
        try {
          const existingTags = Array.isArray(row.tags) ? row.tags : [];
          const mergedTags = Array.from(
            new Set([...existingTags, ...PREMIUM_STOP_TAGS]),
          );
          const note = buildPremiumStopJournal(lastPremium, stopPremium);
          const journal = row.journal ? `${row.journal}\n${note}` : note;
          await dbHandle
            .update(paperTradeFoTable)
            .set({ tags: mergedTags, journal })
            .where(
              and(
                eq(paperTradeFoTable.id, row.id),
                eq(paperTradeFoTable.status, "CLOSED"),
              ),
            );
        } catch (tagErr) {
          stats.tagWriteFailures += 1;
          logger.warn(
            { id: row.id, err: (tagErr as Error).message },
            "PREMIUM_HARD_STOP — tags/journal write failed (trade already CLOSED, cosmetic)",
          );
        }
      } catch (rowErr) {
        stats.errors += 1;
        premiumOverlayLastErrorAt = new Date();
        premiumOverlayLastErrorClass = (rowErr as Error).name ?? "Error";
        premiumOverlayLastErrorMessage = String(
          (rowErr as Error).message ?? "",
        ).slice(0, 200);
        logger.warn(
          { err: (rowErr as Error).message, id: row.id },
          "runPremiumHardStopSweep: per-row failure, continuing",
        );
      }
    }

    premiumOverlayLastCycle = stats;
    premiumOverlayLastSuccessAt = new Date();
    return stats;
  } catch (err) {
    stats.errors += 1;
    premiumOverlayLastCycle = stats;
    premiumOverlayLastErrorAt = new Date();
    premiumOverlayLastErrorClass = (err as Error).name ?? "Error";
    premiumOverlayLastErrorMessage = String((err as Error).message ?? "").slice(
      0,
      200,
    );
    logger.warn(
      { err: (err as Error).message },
      "runPremiumHardStopSweep: top-level failure, swallowed (safety-net)",
    );
    return stats;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// SIMULATION ONLY — profit-protection what-if model (NOT a live exit path)
// ───────────────────────────────────────────────────────────────────────────
//
// Modelling note & limitations. Only the persisted peak (`max_runup`, MFE),
// worst (`max_drawdown`, MAE) and final (`realized_pnl`) are available per
// closed trade — the intra-session premium PATH is not persisted. Each rule's
// fill is therefore approximated from these three samples:
//   • A rule "arms" when MFE crosses the arming threshold.
//   • A GIVEBACK rule's trigger sits at `MFE_R * (1 - givebackPct)`; it is
//     treated as having fired only if the trade demonstrably fell to/through
//     that level (final OR worst <= trigger), and the fill is assumed AT the
//     trigger (no overshoot/slippage).
//   • A BREAKEVEN rule changes the outcome only when an armed trade ended
//     negative (round-tripped through entry); fill assumed at 0R.
// These are deliberately conservative: they never credit a protection rule for
// a giveback the data cannot confirm. Time-tightening (13:30 / 14:45) is NOT
// modelled here — it needs the intra-session path; the report surfaces a
// separate late-session proxy instead. Sample size (~9 usable trades) is too
// small to TUNE thresholds; this is diagnostic, not a calibration.

const EPS = 1e-6;

export interface SimTradeInput {
  id: string;
  index: string;
  setup: string;
  entryPremium: number;
  stopPremium: number;
  lots: number;
  lotSize: number;
  /** Actual realised P&L (₹). */
  realizedPnl: number;
  /** Best unrealised P&L observed while open (₹, >= 0). */
  maxRunup: number;
  /** Worst unrealised P&L observed while open (₹, <= 0). */
  maxDrawdown: number;
}

export interface ArmingConfig {
  kind: "R" | "PREMIUM_PCT";
  /** R multiple (e.g. 0.75, 1) when kind==="R"; premium-gain fraction (e.g.
   *  0.20) when kind==="PREMIUM_PCT". */
  threshold: number;
  label: string;
}

export interface ProtectionRuleConfig {
  arming: ArmingConfig;
  mode: "BREAKEVEN" | "GIVEBACK";
  /** Fraction of MFE given back that triggers the exit (GIVEBACK only). */
  givebackPct?: number;
  label: string;
}

export interface SimPerTradeResult {
  id: string;
  index: string;
  setup: string;
  riskRupees: number;
  mfeR: number;
  maeR: number;
  actualR: number;
  armed: boolean;
  alternativeR: number;
  deltaR: number;
  deltaRupees: number;
}

export interface SimRuleAggregate {
  ruleLabel: string;
  tradesEvaluated: number;
  armedCount: number;
  improved: number;
  worsened: number;
  unchanged: number;
  /** Winners (actualR>0) the rule cut short. */
  exitedTooEarly: number;
  /** Round-trippers (actualR<0) the rule rescued to >= 0R. */
  winnersProtected: number;
  /** Big trend winners (actualR >= TREND_WINNER_R) the rule damaged. */
  trendWinnersDamaged: number;
  netDeltaR: number;
  netDeltaRupees: number;
  perTrade: SimPerTradeResult[];
}

/** Threshold above which a winner is considered a "trend winner" for damage
 *  accounting in the report. */
export const TREND_WINNER_R = 2;

/** The exact arming / giveback / breakeven knobs the owner requested. */
export const DEFAULT_PROTECTION_RULES: ProtectionRuleConfig[] = (() => {
  const armings: ArmingConfig[] = [
    { kind: "R", threshold: 0.75, label: "+0.75R" },
    { kind: "R", threshold: 1, label: "+1R" },
    { kind: "PREMIUM_PCT", threshold: 0.2, label: "+20% prem" },
    { kind: "PREMIUM_PCT", threshold: 0.25, label: "+25% prem" },
  ];
  const rules: ProtectionRuleConfig[] = [];
  for (const arming of armings) {
    rules.push({
      arming,
      mode: "BREAKEVEN",
      label: `arm ${arming.label} → breakeven`,
    });
    for (const g of [0.4, 0.5, 0.6]) {
      rules.push({
        arming,
        mode: "GIVEBACK",
        givebackPct: g,
        label: `arm ${arming.label} → giveback ${Math.round(g * 100)}%`,
      });
    }
  }
  return rules;
})();

function evalRuleForTrade(
  t: SimTradeInput,
  rule: ProtectionRuleConfig,
): SimPerTradeResult | null {
  const unitRisk = t.entryPremium - t.stopPremium; // premium points
  const riskRupees = unitRisk * t.lots * t.lotSize;
  if (!(riskRupees > 0) || !Number.isFinite(riskRupees)) return null;

  const mfeR = t.maxRunup / riskRupees;
  const maeR = t.maxDrawdown / riskRupees;
  const actualR = t.realizedPnl / riskRupees;

  // Arming check.
  let armed: boolean;
  if (rule.arming.kind === "R") {
    armed = mfeR >= rule.arming.threshold;
  } else {
    const mfePremiumPts = t.maxRunup / (t.lots * t.lotSize);
    const mfeGainPct = mfePremiumPts / t.entryPremium;
    armed = mfeGainPct >= rule.arming.threshold;
  }

  let alternativeR = actualR;
  if (armed) {
    if (rule.mode === "BREAKEVEN") {
      // Only changes the outcome when the armed trade ended negative.
      if (actualR < 0) alternativeR = 0;
    } else {
      const trigger = mfeR * (1 - (rule.givebackPct ?? 0));
      // Fire ONLY when the realised result ended at/below the trigger — the
      // only sample that PROVES a give-back from the peak. MAE is deliberately
      // NOT used: a trade's worst point can precede its peak, so MAE cannot
      // confirm a post-peak give-back. Consequence (documented in the report):
      // give-back damage to a trend winner that later recovered is NOT provable
      // from peak/final-only data — quantifying it needs path instrumentation.
      if (actualR <= trigger + EPS) {
        alternativeR = trigger;
      }
    }
  }

  const deltaR = alternativeR - actualR;
  return {
    id: t.id,
    index: t.index,
    setup: t.setup,
    riskRupees,
    mfeR,
    maeR,
    actualR,
    armed,
    alternativeR,
    deltaR,
    deltaRupees: deltaR * riskRupees,
  };
}

export function simulateProtectionRule(
  trades: SimTradeInput[],
  rule: ProtectionRuleConfig,
): SimRuleAggregate {
  const perTrade: SimPerTradeResult[] = [];
  for (const t of trades) {
    const r = evalRuleForTrade(t, rule);
    if (r) perTrade.push(r);
  }
  const agg: SimRuleAggregate = {
    ruleLabel: rule.label,
    tradesEvaluated: perTrade.length,
    armedCount: perTrade.filter((r) => r.armed).length,
    improved: perTrade.filter((r) => r.deltaR > EPS).length,
    worsened: perTrade.filter((r) => r.deltaR < -EPS).length,
    unchanged: perTrade.filter((r) => Math.abs(r.deltaR) <= EPS).length,
    exitedTooEarly: perTrade.filter((r) => r.actualR > 0 && r.deltaR < -EPS)
      .length,
    winnersProtected: perTrade.filter(
      (r) => r.armed && r.actualR < 0 && r.alternativeR >= -EPS,
    ).length,
    trendWinnersDamaged: perTrade.filter(
      (r) => r.actualR >= TREND_WINNER_R && r.deltaR < -EPS,
    ).length,
    netDeltaR: perTrade.reduce((s, r) => s + r.deltaR, 0),
    netDeltaRupees: perTrade.reduce((s, r) => s + r.deltaRupees, 0),
    perTrade,
  };
  return agg;
}

export function simulateProfitProtection(
  trades: SimTradeInput[],
  rules: ProtectionRuleConfig[] = DEFAULT_PROTECTION_RULES,
): SimRuleAggregate[] {
  return rules.map((rule) => simulateProtectionRule(trades, rule));
}
