/**
 * READ-ONLY F&O exit-clarity helpers.
 *
 * Pure, deterministic, side-effect free. Given the data the cockpit ALREADY
 * fetches for an open or closed F&O paper trade — the option-premium plan
 * (entry / stop / target1 / target2 premiums), the recorded MFE/MAE, and the
 * read-only spot lifecycle joined from `option_signal_history` (spot
 * entry/stop/target1/target2/lastSpot + max-favourable-excursion) — these
 * functions classify which spot and premium targets were touched, compute the
 * peak-premium and giveback, flag spot↔premium divergence, and build an honest
 * plain-language explanation of a closed trade's exit.
 *
 * STRICTLY reporting. Nothing here computes or changes an entry, stop, target,
 * exit, size, or gate. It NEVER claims an exit mechanism it cannot prove — it
 * reports observed values only, and degrades to `"unknown"` / null whenever the
 * underlying data is missing, rather than fabricating a status.
 */
import { toNum, type Num } from "../foCockpitView";

/** Structural shape of the read-only spot lifecycle DTO (all fields nullable). */
export interface SpotLifecycleLike {
  status?: string | null;
  spotEntry?: number | null;
  spotStop?: number | null;
  spotTarget1?: number | null;
  spotTarget2?: number | null;
  lastSpot?: number | null;
  maxFavorableExcursionPts?: number | null;
}

export type TouchState = "touched" | "not_touched" | "unknown";

/** +1 for BULLISH, -1 for BEARISH, null for anything else. */
export function directionSign(direction: string | null | undefined): 1 | -1 | null {
  const d = (direction ?? "").trim().toUpperCase();
  if (d === "BULLISH") return 1;
  if (d === "BEARISH") return -1;
  return null;
}

/** Did an upward-favourable level get reached by `peak`? Long-option premium plan. */
function touchUp(peak: number | null, level: number | null): TouchState {
  if (peak == null || level == null || !Number.isFinite(level)) return "unknown";
  return peak >= level ? "touched" : "not_touched";
}

/** Did a downward (stop) level get reached by `trough`? */
function touchDown(trough: number | null, level: number | null): TouchState {
  if (trough == null || level == null || !Number.isFinite(level)) return "unknown";
  return trough <= level ? "touched" : "not_touched";
}

// ── Spot-side target status ──────────────────────────────────────────────────

export interface SpotTargetStatus {
  available: boolean;
  direction: "BULLISH" | "BEARISH" | null;
  /** Most-favourable spot reached: entry + sign·MFE, or lastSpot fallback. */
  peakSpot: number | null;
  peakSource: "mfe" | "last_spot" | null;
  target1: TouchState;
  target2: TouchState;
  /** Verbatim signal lifecycle status when present (e.g. "TARGET1_HIT"), else null. */
  signalStatus: string | null;
}

/**
 * Classify whether the SPOT underlying reached its target1/target2 levels, using
 * the recorded max-favourable-excursion (preferred) or the last spot as a floor.
 * Direction-aware. Honest: a target the spot never reached by `peak` is only
 * `"not_touched"` when computed from the true MFE; a last-spot fallback that
 * falls short returns `"unknown"` (it may have been touched and retraced).
 */
export function deriveSpotTargetStatus(
  spot: SpotLifecycleLike | null | undefined,
  direction: string | null | undefined,
): SpotTargetStatus {
  const sign = directionSign(direction);
  const dir = sign === 1 ? "BULLISH" : sign === -1 ? "BEARISH" : null;
  const signalStatus =
    spot?.status == null || String(spot.status).trim() === ""
      ? null
      : String(spot.status).trim();

  const entry = spot?.spotEntry;
  const t1 = spot?.spotTarget1 ?? null;
  const t2 = spot?.spotTarget2 ?? null;
  const mfe = spot?.maxFavorableExcursionPts;
  const last = spot?.lastSpot;

  if (sign == null || entry == null || !Number.isFinite(entry)) {
    return {
      available: false,
      direction: dir,
      peakSpot: null,
      peakSource: null,
      target1: "unknown",
      target2: "unknown",
      signalStatus,
    };
  }

  // Favourable progress in points (always ≥ 0 for a valid MFE).
  let peakSpot: number | null = null;
  let peakSource: "mfe" | "last_spot" | null = null;
  if (mfe != null && Number.isFinite(mfe)) {
    peakSpot = entry + sign * Math.abs(mfe);
    peakSource = "mfe";
  } else if (last != null && Number.isFinite(last)) {
    peakSpot = last;
    peakSource = "last_spot";
  }

  // For a target on the favourable side, "touched" iff the favourable peak
  // reached it. sign·(target − entry) is the favourable distance to the target.
  const classify = (target: number | null): TouchState => {
    if (target == null || !Number.isFinite(target) || peakSpot == null) return "unknown";
    const favProgress = sign * (peakSpot - entry);
    const favTarget = sign * (target - entry);
    if (favTarget <= 0) return "unknown"; // target not on favourable side — cannot reason
    if (favProgress >= favTarget) return "touched";
    // Fell short: only assert "not_touched" when peak came from the true MFE.
    return peakSource === "mfe" ? "not_touched" : "unknown";
  };

  return {
    available: true,
    direction: dir,
    peakSpot,
    peakSource,
    target1: classify(t1),
    target2: classify(t2),
    signalStatus,
  };
}

// ── Premium-side (the actual paper trade) target status ──────────────────────

export interface PremiumTargetStatus {
  available: boolean;
  /** Peak option premium = entryPremium + maxRunup ÷ qty (long option). */
  peakPremium: number | null;
  /** Trough option premium = entryPremium + maxDrawdown ÷ qty. */
  troughPremium: number | null;
  /** Final premium considered: exit premium (closed) or last premium (open). */
  finalPremium: number | null;
  target1: TouchState;
  target2: TouchState;
  stop: TouchState;
  /** Premium given back from the peak to the final mark (points), ≥ 0 or null. */
  givebackPremium: number | null;
  /** Giveback in rupees (givebackPremium × qty), ≥ 0 or null. */
  givebackValue: number | null;
}

export interface PremiumStatusInput {
  entryPremium?: Num;
  /** OPEN: current premium. CLOSED: pass exit premium here too if no exit field. */
  lastPremium?: Num;
  exitPremium?: Num;
  stopPremium?: Num;
  target1Premium?: Num;
  target2Premium?: Num;
  maxRunup?: Num;
  maxDrawdown?: Num;
  lots?: Num;
  lotSize?: Num;
  exitReason?: string | null;
}

/**
 * Classify the OPTION-PREMIUM plan: did the premium reach target1/target2, did
 * it reach the stop, what was the peak premium and how much was given back to
 * the final mark. Long-option convention (favourable = premium up). Uses the
 * recorded MFE/MAE (rupees) converted to premium points via quantity; falls back
 * to the final/last premium when MFE/MAE is absent. Honest nulls throughout.
 */
export function derivePremiumTargetStatus(
  input: PremiumStatusInput,
): PremiumTargetStatus {
  const entry = toNum(input.entryPremium);
  const t1 = toNum(input.target1Premium);
  const t2 = toNum(input.target2Premium);
  const stop = toNum(input.stopPremium);
  const lots = toNum(input.lots);
  const lotSize = toNum(input.lotSize);
  const qty = Number.isFinite(lots) && Number.isFinite(lotSize) ? lots * lotSize : NaN;
  const runup = toNum(input.maxRunup);
  const draw = toNum(input.maxDrawdown);

  const exitP = toNum(input.exitPremium);
  const lastP = toNum(input.lastPremium);
  const finalPremium = Number.isFinite(exitP) ? exitP : Number.isFinite(lastP) ? lastP : null;

  if (!Number.isFinite(entry)) {
    return {
      available: false,
      peakPremium: null,
      troughPremium: null,
      finalPremium,
      target1: "unknown",
      target2: "unknown",
      stop: "unknown",
      givebackPremium: null,
      givebackValue: null,
    };
  }

  // Peak/trough premium from MFE/MAE (rupees) when quantity is known.
  let peakPremium: number | null = null;
  let troughPremium: number | null = null;
  if (Number.isFinite(qty) && qty > 0) {
    if (Number.isFinite(runup)) peakPremium = entry + runup / qty;
    if (Number.isFinite(draw)) troughPremium = entry + draw / qty;
  }
  // The final/last premium is itself a lower bound on the peak (it was reached).
  if (finalPremium != null) {
    peakPremium = peakPremium == null ? finalPremium : Math.max(peakPremium, finalPremium);
    troughPremium =
      troughPremium == null ? finalPremium : Math.min(troughPremium, finalPremium);
  }

  // Target touch: peak reached the (above-entry) target.
  const t1Touch = touchUp(peakPremium, Number.isFinite(t1) ? t1 : null);
  const t2Touch = touchUp(peakPremium, Number.isFinite(t2) ? t2 : null);

  // Stop touch: trough fell to the (below-entry) stop, OR exit reason says so.
  let stopTouch = touchDown(troughPremium, Number.isFinite(stop) ? stop : null);
  if ((input.exitReason ?? "").trim().toUpperCase() === "STOPPED") stopTouch = "touched";

  // Giveback from peak to the final mark (only meaningful when both known).
  let givebackPremium: number | null = null;
  let givebackValue: number | null = null;
  if (peakPremium != null && finalPremium != null) {
    givebackPremium = Math.max(0, peakPremium - finalPremium);
    if (Number.isFinite(qty) && qty > 0) givebackValue = givebackPremium * qty;
  }

  return {
    available: true,
    peakPremium,
    troughPremium,
    finalPremium,
    target1: t1Touch,
    target2: t2Touch,
    stop: stopTouch,
    givebackPremium,
    givebackValue,
  };
}

// ── Spot ↔ premium divergence ────────────────────────────────────────────────

export type DivergenceKind = "none" | "spot_ahead" | "premium_ahead" | "unknown";

export interface Divergence {
  kind: DivergenceKind;
  /** True only for an actionable, fully-determined divergence (spot_ahead/premium_ahead). */
  warn: boolean;
  message: string | null;
}

/**
 * Compare the strongest target each side reached. `spot_ahead` = the spot hit a
 * target the option premium did not (theta / IV drag held the premium back);
 * `premium_ahead` = the premium hit a target the spot did not (IV expansion).
 * Only flags when BOTH sides are determined; otherwise `unknown`/none. Honest
 * description only — no recommendation, no mechanism claim.
 */
export function deriveDivergence(
  spot: SpotTargetStatus,
  prem: PremiumTargetStatus,
): Divergence {
  const rank = (s: { target1: TouchState; target2: TouchState }): number | null => {
    if (s.target2 === "touched") return 2;
    if (s.target1 === "touched") return 1;
    if (s.target1 === "not_touched") return 0;
    return null; // unknown
  };
  const sRank = rank(spot);
  const pRank = rank(prem);
  if (sRank == null || pRank == null) {
    return { kind: "unknown", warn: false, message: null };
  }
  if (sRank === pRank) return { kind: "none", warn: false, message: null };
  if (sRank > pRank) {
    return {
      kind: "spot_ahead",
      warn: true,
      message:
        "Spot reached a higher target than the option premium did — premium lagged the move (theta / IV drag).",
    };
  }
  return {
    kind: "premium_ahead",
    warn: true,
    message:
      "Option premium reached a higher target than the spot did — premium outran the move (IV expansion).",
  };
}

// ── Combined status + closed-trade explanation ───────────────────────────────

export interface FoTargetStatus {
  spot: SpotTargetStatus;
  premium: PremiumTargetStatus;
  divergence: Divergence;
}

export interface FoTargetStatusInput extends PremiumStatusInput {
  direction?: string | null;
  spot?: SpotLifecycleLike | null;
}

/** One-shot: spot status + premium status + divergence for a trade row. */
export function deriveFoTargetStatus(input: FoTargetStatusInput): FoTargetStatus {
  const spot = deriveSpotTargetStatus(input.spot, input.direction);
  const premium = derivePremiumTargetStatus(input);
  return { spot, premium, divergence: deriveDivergence(spot, premium) };
}

const EXIT_REASON_PHRASE: Record<string, string> = {
  TARGET1_HIT: "exited at Target 1",
  TARGET2_HIT: "exited at Target 2",
  STOPPED: "stopped out",
  EXPIRED: "held to expiry",
  MANUAL_OVERRIDE: "manually closed",
  TIME_EXIT_1520: "force-closed at the 15:20 IST time-exit",
};

/** Format a premium points value for prose (2dp), or "—" when absent. */
function fmtP(n: number | null): string {
  return n != null && Number.isFinite(n) ? n.toFixed(2) : "—";
}

/**
 * Build honest, plain-language lines explaining a CLOSED trade: why it exited,
 * and (when the data shows it) why it was not booked earlier. Pure facts only —
 * peak premium, target levels, giveback — with NO claim about the exit mechanism
 * and NO recommendation. Returns `[]` when there is nothing factual to say.
 */
export function buildClosedExplanation(args: {
  exitReason?: string | null;
  status: FoTargetStatus;
}): string[] {
  const { exitReason, status } = args;
  const lines: string[] = [];
  const reasonKey = (exitReason ?? "").trim().toUpperCase();
  const phrase = EXIT_REASON_PHRASE[reasonKey];
  if (phrase) {
    lines.push(`This trade ${phrase}.`);
  }

  const prem = status.premium;
  const reachedT1 = prem.target1 === "touched";
  const reachedT2 = prem.target2 === "touched";
  const bookedAtTarget = reasonKey === "TARGET1_HIT" || reasonKey === "TARGET2_HIT";

  // "Why not earlier" — only when the premium provably reached a target the trade
  // was NOT booked at, and there is a measurable giveback. Stated as observation.
  if (!bookedAtTarget && (reachedT1 || reachedT2) && prem.peakPremium != null) {
    const targetLabel = reachedT2 ? "Target 2" : "Target 1";
    let line = `Peak option premium reached ${fmtP(prem.peakPremium)} (${targetLabel} level).`;
    if (prem.givebackPremium != null && prem.givebackPremium > 0) {
      line += ` It then gave back ${fmtP(prem.givebackPremium)} points to the exit mark of ${fmtP(prem.finalPremium)}.`;
    }
    lines.push(line);
  }

  // Divergence note (already honest, no mechanism claim).
  if (status.divergence.warn && status.divergence.message) {
    lines.push(status.divergence.message);
  }

  return lines;
}
