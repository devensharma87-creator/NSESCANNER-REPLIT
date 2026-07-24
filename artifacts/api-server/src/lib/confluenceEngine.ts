/**
 * F&O Confluence Engine (Phase-3 replacement, ships 2026-05-06).
 *
 * REPLACES the previous policy in which the detector's raw `confidence`
 * value (with only a vol-regime haircut) was the sole emission score.
 * The pre-Phase-3 logic is preserved verbatim in `optionSignals.legacyEmit.bak.ts`.
 *
 * Inputs are the trader's chosen confluence stack:
 *   1. EMA 9 / 20 / 50 alignment (intraday)         — trend agreement
 *   2. VWAP relation                                 — institutional fair value
 *   3. Fixed Volume Profile zone (intraday 60-bar)   — auction context
 *   4. Regime (Phase-1 classifier)                   — trending / ranging / volatile
 *   5. IV Rank (Phase-1 IV history)                  — premium richness
 *
 * Each factor returns a signed score in roughly [-10, +10] for the
 * detector's bias direction. The engine sums them into a `confluenceScore`
 * and adds it to the detector's raw confidence (clamped to [0,100]).
 *
 * Reasons array is surfaced verbatim on the signal card so the user can
 * see exactly why the score moved up or down — no black-box scoring.
 */

export type Direction = "BULLISH" | "BEARISH";

export interface ConfluenceVp {
  pointOfControl: number;
  valueAreaHigh: number;
  valueAreaLow: number;
}

export interface ConfluenceInputs {
  direction: Direction;
  setupTrendClass: boolean;       // true for TC/VR/VB/EP, false for MR
  spot: number;
  ema9: number;
  ema20: number;
  ema50: number;
  vwap: number;
  /**
   * Whether `vwap` is a real volume-weighted average price.
   * False for cash indices (NIFTY/BANKNIFTY/SENSEX) whose Kite candles
   * carry zero volume — `vwap` will be set to `spot` as a geometric
   * placeholder but must NOT be scored as institutional fair value.
   * When false, scoreVwap returns weight=0 / polarity="neutral".
   */
  vwapAvailable?: boolean;
  /** intraday volume profile (last 60 15-min bars). null when warm-up or zero volume. */
  vp: ConfluenceVp | null;
  regime:
    | "TRENDING_BULL"
    | "TRENDING_BEAR"
    | "RANGING"
    | "VOLATILE"
    | "EXPIRY_DAY";
  ivRank: number | null;
  /** Detector's raw confidence (0..100) before confluence adjustment. */
  rawConfidence: number;
}

/**
 * Polarity of a confluence factor — drives the colour/icon the UI shows
 * on the driver chip.
 *   "supports" — factor agrees with the signal direction (green ↑/↓)
 *   "opposes"  — factor disagrees with the signal direction (red ↑/↓)
 *   "risk"     — factor is direction-AGNOSTIC execution risk
 *                (VOLATILE regime, EXPIRY_DAY theta, IV-rich premium).
 *                Always rendered as a warning regardless of bias —
 *                fixes the pre-fix bug where a -5 risk on a BEARISH
 *                signal was rendered as `bullish: true` (green).
 *   "neutral"  — factor weight is 0; caller filters these out.
 */
export type FactorPolarity = "supports" | "opposes" | "risk" | "neutral";

export interface ConfluenceFactor {
  label:
    | "EMA_STACK"
    | "VWAP"
    | "VOLUME_PROFILE"
    | "REGIME"
    | "IV_RANK";
  weight: number;
  /** Direction-relative polarity. See FactorPolarity for semantics. */
  polarity: FactorPolarity;
  detail: string;
}

export interface ConfluenceResult {
  /** Sum of all factor weights. Roughly [-30, +20]. */
  confluenceScore: number;
  /** rawConfidence + confluenceScore, clamped to [0, 100]. */
  adjustedConfidence: number;
  factors: ConfluenceFactor[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function scoreEmaStack(i: ConfluenceInputs): ConfluenceFactor {
  const stackedUp = i.ema9 > i.ema20 && i.ema20 > i.ema50;
  const stackedDown = i.ema9 < i.ema20 && i.ema20 < i.ema50;
  const aligned =
    (i.direction === "BULLISH" && stackedUp) ||
    (i.direction === "BEARISH" && stackedDown);
  const opposed =
    (i.direction === "BULLISH" && stackedDown) ||
    (i.direction === "BEARISH" && stackedUp);
  if (aligned) {
    return {
      label: "EMA_STACK", weight: +5, polarity: "supports",
      detail: `EMA 9/20/50 stacked ${i.direction === "BULLISH" ? "↑" : "↓"} — trend agrees`,
    };
  }
  if (opposed) {
    return {
      label: "EMA_STACK", weight: -8, polarity: "opposes",
      detail: `EMA 9/20/50 stacked ${stackedUp ? "↑" : "↓"} AGAINST ${i.direction} bias`,
    };
  }
  return {
    label: "EMA_STACK", weight: 0, polarity: "neutral",
    detail: "EMA 9/20/50 not cleanly stacked — no edge from trend",
  };
}

function scoreVwap(i: ConfluenceInputs): ConfluenceFactor {
  // Cash indices (NIFTY/BANKNIFTY/SENSEX) carry zero candle volume — their
  // VWAP is structurally unavailable. The `vwap` field is set to `spot` as
  // a geometric placeholder. Scoring it would give a spurious "at VWAP"
  // reading on every bar, so we return weight=0 with an honest label.
  if (i.vwapAvailable === false) {
    return {
      label: "VWAP", weight: 0, polarity: "neutral",
      detail: "VWAP unavailable — index spot candles carry zero volume; cannot compute volume-weighted price",
    };
  }
  const above = i.spot > i.vwap;
  const aligned =
    (i.direction === "BULLISH" && above) ||
    (i.direction === "BEARISH" && !above);
  // Distance in % of spot — neutral zone of ±0.05% is treated as "at VWAP".
  const distPct = Math.abs(((i.spot - i.vwap) / i.spot) * 100);
  if (distPct < 0.05) {
    return {
      label: "VWAP", weight: 0, polarity: "neutral",
      detail: "Spot within 5bps of VWAP — at institutional fair value",
    };
  }
  if (aligned) {
    return {
      label: "VWAP", weight: +3, polarity: "supports",
      detail: `Spot ${above ? "above" : "below"} VWAP (${round1(distPct)}%) — agrees with ${i.direction}`,
    };
  }
  return {
    label: "VWAP", weight: -6, polarity: "opposes",
    detail: `Spot ${above ? "above" : "below"} VWAP (${round1(distPct)}%) — counter to ${i.direction}; institutional flow opposing`,
  };
}

function scoreVolumeProfile(i: ConfluenceInputs): ConfluenceFactor {
  // D-FAB-03 structural invariant: for cash indices (NIFTY/BANKNIFTY/SENSEX),
  // i.vp is ALWAYS null because vpIntraday is derived from zero-volume candles
  // (volumeProfile returns null when totalVol=0). The null guard below therefore
  // returns weight=0 for all index calls — no VP-derived directional points
  // ever affect the confluence score for those instruments.
  if (!i.vp) {
    return {
      label: "VOLUME_PROFILE", weight: 0, polarity: "neutral",
      detail: "Volume Profile warm-up — insufficient bars",
    };
  }
  const { valueAreaHigh: vah, valueAreaLow: val, pointOfControl: poc } = i.vp;
  const aboveVah = i.spot > vah;
  const belowVal = i.spot < val;
  if (aboveVah) {
    return i.direction === "BULLISH"
      ? { label: "VOLUME_PROFILE", weight: +3, polarity: "supports",
          detail: `Spot above VAH ${round1(vah)} — vacuum higher; supports BULLISH continuation` }
      : { label: "VOLUME_PROFILE", weight: -3, polarity: "opposes",
          detail: `Spot above VAH ${round1(vah)} — counter-VP for BEARISH (price has accepted higher)` };
  }
  if (belowVal) {
    return i.direction === "BEARISH"
      ? { label: "VOLUME_PROFILE", weight: +3, polarity: "supports",
          detail: `Spot below VAL ${round1(val)} — vacuum lower; supports BEARISH continuation` }
      : { label: "VOLUME_PROFILE", weight: -3, polarity: "opposes",
          detail: `Spot below VAL ${round1(val)} — counter-VP for BULLISH (price has accepted lower)` };
  }
  // Inside value area. Mean-reversion setups get a small boost; trend
  // setups get docked — direction-agnostic execution-quality risk
  // (whipsaw), not a directional vote against the trade.
  if (i.setupTrendClass) {
    return {
      label: "VOLUME_PROFILE", weight: -3, polarity: "risk",
      detail: `Spot inside value (${round1(val)}–${round1(vah)}, POC ${round1(poc)}) — balance area; trend setups whipsaw here`,
    };
  }
  return {
    label: "VOLUME_PROFILE", weight: +2, polarity: "supports",
    detail: `Spot inside value (POC ${round1(poc)}) — balance area; mean-reversion preferred`,
  };
}

function scoreRegime(i: ConfluenceInputs): ConfluenceFactor {
  switch (i.regime) {
    case "TRENDING_BULL":
      return i.direction === "BULLISH"
        ? { label: "REGIME", weight: +5,  polarity: "supports", detail: "Regime TRENDING_BULL — bias agrees" }
        : { label: "REGIME", weight: -10, polarity: "opposes",  detail: "Regime TRENDING_BULL — fading the trend" };
    case "TRENDING_BEAR":
      return i.direction === "BEARISH"
        ? { label: "REGIME", weight: +5,  polarity: "supports", detail: "Regime TRENDING_BEAR — bias agrees" }
        : { label: "REGIME", weight: -10, polarity: "opposes",  detail: "Regime TRENDING_BEAR — fading the trend" };
    case "VOLATILE":
      // Direction-agnostic execution risk — applies equally to BULL/BEAR.
      return { label: "REGIME", weight: -3, polarity: "risk",
        detail: "Regime VOLATILE — whipsaw risk on directional plans" };
    case "RANGING":
      return i.setupTrendClass
        ? { label: "REGIME", weight: -5, polarity: "risk",
            detail: "Regime RANGING — trend setups historically fail to extend" }
        : { label: "REGIME", weight: +2, polarity: "supports",
            detail: "Regime RANGING — favours mean-reversion" };
    case "EXPIRY_DAY":
      return { label: "REGIME", weight: -2, polarity: "risk",
        detail: "EXPIRY_DAY — theta crush distorts intraday geometry" };
  }
}

function scoreIvRank(i: ConfluenceInputs): ConfluenceFactor {
  if (i.ivRank == null) {
    return { label: "IV_RANK", weight: 0, polarity: "neutral",
      detail: "IV Rank warm-up — insufficient sample" };
  }
  if (i.ivRank >= 75) {
    // Rich premium = direction-agnostic cost-of-entry risk.
    return { label: "IV_RANK", weight: -2, polarity: "risk",
      detail: `IV Rank ${Math.round(i.ivRank)} (rich) — option premium expensive; defenders favoured` };
  }
  if (i.ivRank <= 25) {
    return { label: "IV_RANK", weight: +2, polarity: "supports",
      detail: `IV Rank ${Math.round(i.ivRank)} (cheap) — premium attractive for directional buy` };
  }
  return { label: "IV_RANK", weight: 0, polarity: "neutral",
    detail: `IV Rank ${Math.round(i.ivRank)} (mid)` };
}

/**
 * Score a detector's bias against the confluence stack. Returns the
 * adjusted confidence + per-factor breakdown. Pure function; no I/O.
 */
export function scoreConfluence(i: ConfluenceInputs): ConfluenceResult {
  const factors: ConfluenceFactor[] = [
    scoreEmaStack(i),
    scoreVwap(i),
    scoreVolumeProfile(i),
    scoreRegime(i),
    scoreIvRank(i),
  ];
  const confluenceScore = factors.reduce((a, f) => a + f.weight, 0);
  const adjusted = i.rawConfidence + confluenceScore;
  const adjustedConfidence = Math.max(0, Math.min(100, Math.round(adjusted)));
  return { confluenceScore, adjustedConfidence, factors };
}
