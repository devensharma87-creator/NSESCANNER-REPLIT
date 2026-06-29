/**
 * F&O Paper Auto-Open Risk Guards — pure module.
 *
 * Adds a controlled risk layer on top of the existing paper auto-open path
 * based on evidence from the production F&O Real Replay Diagnostics report.
 *
 * ABSOLUTE RULES:
 *   - Pure function, no DB, no network, no side effects.
 *   - Does NOT modify signal scoring, setup detection, confluence logic,
 *     recovery-veto, chase-veto, anti-flip, P25, premiumTrusted, risk sizing,
 *     dynamic lots, heat cap, DD latches, capital ledger, or option-chain math.
 *   - Guards affect PAPER AUTO-OPEN only. Signals still appear in UI.
 *   - Shadow mode: never blocks, only surfaces what would have been blocked.
 *   - Paper-block mode: blocks only if a hard-block reason fires.
 *
 * Evidence base (production replay, May 19 – Jun 29 2026, 49 priced trades):
 *   - BANKNIFTY: +₹36,527 net, 60% WR (PROCEED)
 *   - NIFTY: −₹6,348 net, 86% spread/premium ratio (CONDITIONAL)
 *   - SENSEX: −₹45,908 net, 0% STOP win rate (DO NOT PROCEED)
 *   - Near-expiry theta trades destroyed ₹39,737 (BNF May26 + SX May27)
 *   - ₹100–199 premium bucket: −₹55,819 net on 8 trades
 *   - Re-entry same-strike Jun17: −₹11,935 combined net
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FnoPaperRiskGuardReason =
  /** SENSEX paper auto-open disabled by replay diagnostics evidence. */
  | "SENSEX_DISABLED_BY_REPLAY_DIAGNOSTICS"
  /** Entry premium below minimum threshold for this underlying. */
  | "LOW_ENTRY_PREMIUM"
  /** DTE ≤ configured max AND premium below threshold → theta-trap risk. */
  | "NEAR_EXPIRY_THETA_RISK"
  /** Same underlying+direction+optionType+strike had a STOP within cooldown window. */
  | "SAME_STRIKE_DIRECTION_STOP_COOLDOWN"
  /** Entry during high-noise time window. Shadow observation only — never blocks. */
  | "BAD_TIME_WINDOW_SHADOW_ONLY"
  /** Estimated costs exceed 50% of expected gross edge. Shadow observation only. */
  | "HIGH_COST_TO_EDGE_RATIO_SHADOW_ONLY";

/** Reasons that actually block the open (not shadow-only). */
const HARD_BLOCK_REASONS = new Set<FnoPaperRiskGuardReason>([
  "SENSEX_DISABLED_BY_REPLAY_DIAGNOSTICS",
  "LOW_ENTRY_PREMIUM",
  "NEAR_EXPIRY_THETA_RISK",
  "SAME_STRIKE_DIRECTION_STOP_COOLDOWN",
]);

export interface FnoPaperRiskGuardInput {
  underlying: "NIFTY" | "BANKNIFTY" | "SENSEX";
  direction: "BULLISH" | "BEARISH";
  optionType: "CALL" | "PUT";
  strike: number;
  /** Null when pricing is unavailable (UNAVAILABLE mode). */
  entryPremium: number | null;
  /** ISO timestamp string (UTC) or any string parseable by `new Date()`. */
  entryTime: string;
  /** YYYY-MM-DD expiry. Null when unknown. */
  expiry: string | null;
  pricingMode?: string | null;
  setupKey?: string | null;
  setupName?: string | null;
  candidateTier?: string | null;
  premiumTrusted?: boolean | null;
  /** Expected gross P&L edge (optional; used for cost-to-edge shadow check). */
  expectedGrossEdge?: number | null;
  /** Estimated transaction costs (optional; used for cost-to-edge shadow check). */
  estimatedCosts?: number | null;
}

export interface RecentStoppedTrade {
  underlying: string;
  direction: string;
  optionType: string;
  strike: number;
  /** ISO timestamp string of the STOP exit. */
  exitTime: string;
  exitReason: string;
}

export interface FnoPaperRiskGuardDecision {
  /** True when the open is allowed (always true in shadow mode). */
  allowed: boolean;
  /** "block" if any hard-block reason fires, "warn" for shadow-only, "info" if clean. */
  severity: "info" | "warn" | "block";
  reasons: FnoPaperRiskGuardReason[];
  explanation: string[];
  metrics: {
    dteCalendarDays: number | null;
    entryPremium: number | null;
    minPremiumRequired: number | null;
    minutesSinceSameStrikeStop: number | null;
    costToEdgeRatio: number | null;
  };
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface FnoPaperRiskGuardConfig {
  /**
   * "shadow": evaluates guards but never blocks. Logs what would be blocked.
   * "paper_block": blocks paper auto-open when a hard-block guard fires.
   */
  mode: "shadow" | "paper_block";

  /**
   * When true (paper_block mode only) SENSEX paper auto-open is disabled.
   * SENSEX signals still appear in UI. Backtest/replay unchanged.
   */
  disableSensexPaperAutoOpen: boolean;

  /**
   * G2: Blanket low-premium gate — blocks ANY trade below this threshold
   * regardless of DTE. Set to false to isolate G1 in scenario testing.
   */
  lowPremiumGateEnabled: boolean;

  /** Per-underlying minimum entry premium thresholds. */
  minEntryPremium: {
    NIFTY: number;
    BANKNIFTY: number;
    SENSEX: number;
  };

  thetaRisk: {
    /** Enable G1 near-expiry theta guard. */
    enabled: boolean;
    /**
     * Block only when DTE ≤ this value (calendar days from entry to expiry).
     * The May-26 BNF disaster was DTE=2, May-27 SX was DTE=1.
     */
    maxDteCalendarDays: number;
    /**
     * When true: G1 fires only when DTE ≤ maxDte AND premium < threshold
     * (prevents blanket DTE block damaging profitable near-expiry high-premium trades).
     * When false: G1 blocks every DTE ≤ maxDte trade (not recommended).
     */
    onlyWhenPremiumBelowThreshold: boolean;
  };

  sameStrikeStopCooldown: {
    /** Enable G3 re-entry cooldown after a STOP on same strike/direction. */
    enabled: boolean;
    /** Minutes of cooldown after a STOP exit on the same underlying+direction+strike. */
    minutes: number;
  };

  badTimeWindowShadowOnly: {
    /** Enable shadow-only bad-time-window observation (10:00–11:00 IST worst slot). */
    enabled: boolean;
    /** HH:MM windows in IST. `from` inclusive, `to` exclusive. */
    windowsIST: Array<{ from: string; to: string }>;
  };
}

/**
 * Live default config — paper_block mode.
 *
 * Activated 2026-06-29 after production replay simulation (May 19 – Jun 29 2026,
 * 49 priced trades) confirmed all 7 acceptance thresholds with the corrected
 * netImprovement formula:
 *   G1 THETA_RISK alone:     +₹56,029 improvement, 0 BNF winners blocked
 *   G1+G2+G3+G4 combined:   +₹61,451 improvement, BNF +₹36,527 → +₹45,723 (+25.2%)
 *   Remaining priced P&L:   +₹45,723 (was −₹15,728 at baseline)
 *   May-26 BNF theta disaster (−₹24,495 DTE=0) blocked ✅
 *   Jun-17 same-strike STOP re-entry caught by G3 ✅
 *   SENSEX: 28.6% WR, 0% STOP win rate, −₹45,908 eliminated by G4 ✅
 * To revert to shadow mode set mode: "shadow" and disableSensexPaperAutoOpen: false.
 */
export const FNO_GUARD_CONFIG: FnoPaperRiskGuardConfig = {
  mode: "paper_block",
  disableSensexPaperAutoOpen: true,
  lowPremiumGateEnabled: true,
  minEntryPremium: {
    NIFTY: 250,
    BANKNIFTY: 500,
    SENSEX: 250,
  },
  thetaRisk: {
    enabled: true,
    maxDteCalendarDays: 5,
    onlyWhenPremiumBelowThreshold: true,
  },
  sameStrikeStopCooldown: {
    enabled: true,
    minutes: 90,
  },
  badTimeWindowShadowOnly: {
    enabled: true,
    windowsIST: [{ from: "10:00", to: "11:00" }],
  },
};

// ---------------------------------------------------------------------------
// Internal helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Compute calendar days from the IST calendar date of `entryTimeIso`
 * to the expiry date `expiryYmd` ("YYYY-MM-DD").
 *
 * Returns null on any parse error (fail-open: DTE gate won't fire).
 */
export function computeDteCalendarDays(
  entryTimeIso: string,
  expiryYmd: string,
): number | null {
  if (!entryTimeIso || !expiryYmd) return null;
  try {
    // Shift entry timestamp to IST (+05:30) to get the calendar date.
    const entryUtcMs = new Date(entryTimeIso).getTime();
    if (Number.isNaN(entryUtcMs)) return null;
    const entryIstMs = entryUtcMs + 5.5 * 3600 * 1000;
    const ist = new Date(entryIstMs);
    const ey = ist.getUTCFullYear();
    const em = String(ist.getUTCMonth() + 1).padStart(2, "0");
    const ed = String(ist.getUTCDate()).padStart(2, "0");
    const entryDayMs = Date.UTC(ey, ist.getUTCMonth(), ist.getUTCDate());

    // Parse expiry as UTC midnight.
    const expiryMs = Date.UTC(
      Number(expiryYmd.slice(0, 4)),
      Number(expiryYmd.slice(5, 7)) - 1,
      Number(expiryYmd.slice(8, 10)),
    );
    if (Number.isNaN(expiryMs) || Number.isNaN(entryDayMs)) return null;

    const dte = Math.floor((expiryMs - entryDayMs) / 86_400_000);
    void em; void ed; // used for IST date construction above
    return dte;
  } catch {
    return null;
  }
}

/**
 * Returns true if the entry timestamp falls within any of the given IST windows.
 * Window `from` is inclusive, `to` is exclusive.
 */
export function isInBadTimeWindowIST(
  entryTimeIso: string,
  windows: Array<{ from: string; to: string }>,
): boolean {
  if (!windows.length) return false;
  try {
    const ms = new Date(entryTimeIso).getTime();
    if (Number.isNaN(ms)) return false;
    const istMs = ms + 5.5 * 3600 * 1000;
    const d = new Date(istMs);
    const hhmm = d.getUTCHours() * 60 + d.getUTCMinutes();
    for (const w of windows) {
      const [fh, fm] = w.from.split(":").map(Number);
      const [th, tm] = w.to.split(":").map(Number);
      const fromMin = (fh ?? 0) * 60 + (fm ?? 0);
      const toMin = (th ?? 0) * 60 + (tm ?? 0);
      if (hhmm >= fromMin && hhmm < toMin) return true;
    }
  } catch {
    return false;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Core evaluation function
// ---------------------------------------------------------------------------

/**
 * Evaluate all F&O paper risk guards for a candidate open.
 *
 * @param input          Candidate trade details.
 * @param recentStoppedTrades  Recent STOP exits to check re-entry cooldown.
 * @param config         Guard configuration.
 * @returns              Decision: allowed/blocked, reasons, explanation, metrics.
 */
export function evaluateFnoPaperRiskGuards(
  input: FnoPaperRiskGuardInput,
  recentStoppedTrades: RecentStoppedTrade[],
  config: FnoPaperRiskGuardConfig,
): FnoPaperRiskGuardDecision {
  const reasons: FnoPaperRiskGuardReason[] = [];
  const explanation: string[] = [];

  const underlying = input.underlying;
  const minPrem: number = config.minEntryPremium[underlying] ?? 0;

  // ── Compute DTE ──────────────────────────────────────────────────────────
  let dteCalendarDays: number | null = null;
  if (input.expiry) {
    dteCalendarDays = computeDteCalendarDays(input.entryTime, input.expiry);
  }

  // ── G4: SENSEX paper auto-open disable ───────────────────────────────────
  // Only blocks in paper_block mode to avoid accidentally toggling at config init.
  if (
    config.disableSensexPaperAutoOpen &&
    config.mode === "paper_block" &&
    underlying === "SENSEX"
  ) {
    reasons.push("SENSEX_DISABLED_BY_REPLAY_DIAGNOSTICS");
    explanation.push(
      "SENSEX paper auto-open disabled by replay diagnostics: 28.6% WR, \u2212\u20b945,908 net on latest real-premium replay.",
    );
  }

  // ── G2: Low entry premium gate ───────────────────────────────────────────
  if (
    config.lowPremiumGateEnabled &&
    minPrem > 0 &&
    input.entryPremium !== null &&
    input.entryPremium < minPrem
  ) {
    reasons.push("LOW_ENTRY_PREMIUM");
    explanation.push(
      `Entry premium \u20b9${input.entryPremium.toFixed(2)} < minimum \u20b9${minPrem} for ${underlying}. Low-premium entries have \u221285.7% spread/premium ratio and \u221255,819 net P&L in the replay dataset.`,
    );
  }

  // ── G1: Near-expiry theta risk ───────────────────────────────────────────
  // Only triggers when DTE ≤ maxDte AND premium below threshold (or edge < costs).
  // Does NOT blanket-block all DTE ≤ 5 trades — BANKNIFTY has profitable near-expiry trades.
  if (config.thetaRisk.enabled && dteCalendarDays !== null) {
    const dteViolated = dteCalendarDays <= config.thetaRisk.maxDteCalendarDays;
    if (dteViolated) {
      let thetaBlock = false;
      const premBelowThreshold =
        input.entryPremium === null || (minPrem > 0 && input.entryPremium < minPrem);

      if (config.thetaRisk.onlyWhenPremiumBelowThreshold) {
        if (premBelowThreshold) thetaBlock = true;
        // Also block when edge < costs (if both are available)
        if (
          input.expectedGrossEdge != null &&
          input.estimatedCosts != null &&
          input.expectedGrossEdge > 0 &&
          input.expectedGrossEdge < input.estimatedCosts
        ) {
          thetaBlock = true;
        }
      } else {
        // Blanket DTE block — not the default; user explicitly opted in.
        thetaBlock = true;
      }

      if (thetaBlock) {
        reasons.push("NEAR_EXPIRY_THETA_RISK");
        explanation.push(
          `DTE ${dteCalendarDays} \u2264 ${config.thetaRisk.maxDteCalendarDays} days and premium \u20b9${input.entryPremium?.toFixed(2) ?? "null"} < threshold \u20b9${minPrem}. Near-expiry theta trap: BNF May-26 lost \u221224,495 (DTE=2, \u20b9141 \u2192 \u20b95.50).`,
        );
      }
    }
  }

  // ── G3: Same-strike direction stop cooldown ──────────────────────────────
  let minutesSinceSameStrikeStop: number | null = null;
  if (config.sameStrikeStopCooldown.enabled && recentStoppedTrades.length > 0) {
    let entryMs: number;
    try {
      entryMs = new Date(input.entryTime).getTime();
    } catch {
      entryMs = NaN;
    }
    if (!Number.isNaN(entryMs)) {
      const cooldownMs = config.sameStrikeStopCooldown.minutes * 60_000;

      const matchingStop = recentStoppedTrades.find((s) => {
        let stopMs: number;
        try {
          stopMs = new Date(s.exitTime).getTime();
        } catch {
          return false;
        }
        if (Number.isNaN(stopMs)) return false;
        const withinWindow = stopMs > entryMs - cooldownMs && stopMs <= entryMs;
        return (
          withinWindow &&
          s.underlying === underlying &&
          s.direction === input.direction &&
          s.optionType === input.optionType &&
          Math.abs(s.strike - input.strike) < 0.5
        );
      });

      if (matchingStop) {
        let stopMs: number;
        try {
          stopMs = new Date(matchingStop.exitTime).getTime();
        } catch {
          stopMs = NaN;
        }
        if (!Number.isNaN(stopMs)) {
          minutesSinceSameStrikeStop = Math.round((entryMs - stopMs) / 60_000);
        }
        reasons.push("SAME_STRIKE_DIRECTION_STOP_COOLDOWN");
        explanation.push(
          `Same ${underlying} ${input.direction} ${input.optionType} strike ${input.strike} had a STOP exit ${minutesSinceSameStrikeStop ?? "?"} min ago (cooldown: ${config.sameStrikeStopCooldown.minutes} min). Jun-17 re-entry cost \u221211,935 combined net.`,
        );
      }
    }
  }

  // ── Shadow-only: Bad time window ─────────────────────────────────────────
  if (
    config.badTimeWindowShadowOnly.enabled &&
    isInBadTimeWindowIST(input.entryTime, config.badTimeWindowShadowOnly.windowsIST)
  ) {
    reasons.push("BAD_TIME_WINDOW_SHADOW_ONLY");
    explanation.push(
      "Entry during 10:00\u201311:00 IST high-noise window (27.3% WR, \u221230,962 net on 11 replay trades). Shadow observation only \u2014 never blocks.",
    );
  }

  // ── Shadow-only: High cost-to-edge ratio ─────────────────────────────────
  const costToEdgeRatio =
    input.estimatedCosts != null &&
    input.expectedGrossEdge != null &&
    input.expectedGrossEdge > 0
      ? input.estimatedCosts / input.expectedGrossEdge
      : null;

  if (costToEdgeRatio !== null && costToEdgeRatio > 0.5) {
    reasons.push("HIGH_COST_TO_EDGE_RATIO_SHADOW_ONLY");
    explanation.push(
      `Costs (${costToEdgeRatio.toFixed(2)}\u00d7 edge) exceed 50% of expected gross P&L. Shadow observation only.`,
    );
  }

  // ── Severity ─────────────────────────────────────────────────────────────
  const hardBlocks = reasons.filter((r) => HARD_BLOCK_REASONS.has(r));
  let severity: "info" | "warn" | "block" = "info";
  if (hardBlocks.length > 0) severity = "block";
  else if (reasons.length > 0) severity = "warn";

  // ── Allowed decision ─────────────────────────────────────────────────────
  // Shadow mode: ALWAYS allowed (guard is observational only).
  // Paper-block mode: blocked when any hard-block reason fires.
  const allowed = config.mode === "shadow" ? true : hardBlocks.length === 0;

  return {
    allowed,
    severity,
    reasons,
    explanation,
    metrics: {
      dteCalendarDays,
      entryPremium: input.entryPremium,
      minPremiumRequired: minPrem > 0 ? minPrem : null,
      minutesSinceSameStrikeStop,
      costToEdgeRatio,
    },
  };
}
