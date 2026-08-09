// directionalScorer.ts
// Dual-model directional scorer with TWO MODES: pre/post (EOD) and intraday (live).
// One scoring engine, two weight sets + two input-mapping regimes + two grading regimes.
// Pure, deterministic, side-effect-free. All tunables live in SCORER_CONFIG.
// House rule: missing input => null (fail closed), NEVER 0.

export type Dir = -1 | 0 | 1;
export type IndexSymbol = "NIFTY" | "BANKNIFTY" | "SENSEX";
export type Mode = "PREPOST" | "INTRADAY";
export type Verdict =
  | "STRONG_BULL" | "MILD_BULL" | "NO_EDGE" | "MILD_BEAR" | "STRONG_BEAR"
  | "NO_TRADE" | "INSUFFICIENT_DATA";

export type FactorId = "f1"|"f2"|"f3"|"f4"|"f5"|"f6"|"f7"|"f8"|"f9";
export type GateReason = "binary" | "pin" | "cas" | "shock";

// direction is null when the input is missing (fail-closed, NOT 0)
export type FactorInputs = Record<FactorId, Dir | null>;

export interface ScoreResult {
  mode: Mode;
  balScore: number | null;
  wtdScore: number | null;
  balVerdict: Verdict;
  wtdVerdict: Verdict;
  coverage: "FULL" | "PARTIAL";
  missingFactors: FactorId[];
  proxyFactors: FactorId[];      // factors served by a labelled proxy (intraday F1/F2)
  gateArmed: boolean;
  gateReasons: GateReason[];
  status: "SCORED" | "INSUFFICIENT_DATA" | "GATED_NO_TRADE";
}

// ---- Single source of truth for all tunables ---------------------------
export const SCORER_CONFIG = {
  // Weights per mode. Same 4-pillar balanced logic; intraday re-tilts toward
  // live-meaningful factors (price/structure up, participant-OI proxy down).
  weights: {
    PREPOST: {
      f1: { bal: 13, wtd: 22 }, // Participant OI: FII + Pro options (EOD, real split)
      f2: { bal: 12, wtd: 18 }, // FII index-futures OI (EOD)
      f3: { bal: 13, wtd: 14 }, // Price action (synthetic spot)
      f4: { bal: 12, wtd: 12 }, // Option-chain OI walls + new-vs-old OI
      f5: { bal: 13, wtd: 8  }, // India VIX / IV regime
      f6: { bal: 12, wtd: 8  }, // PCR banded
      f7: { bal: 9,  wtd: 7  }, // Commodity/macro (crude-led)
      f8: { bal: 8,  wtd: 5  }, // FII/DII cash
      f9: { bal: 8,  wtd: 4  }, // Global cues
    },
    INTRADAY: {
      // Rationale: intraday, participant split is NOT live (proxy only, down-weighted),
      // live PRICE STRUCTURE is the dominant signal, VIX/PCR are live and noisy,
      // FII/DII cash is stale (frozen EOD -> near-zero weight, label only).
      f1: { bal: 8,  wtd: 12 }, // Aggregate OI-change proxy (LABELLED, not FII/Pro split)
      f2: { bal: 10, wtd: 14 }, // Live futures OI change (aggregate)
      f3: { bal: 20, wtd: 22 }, // LIVE price action vs ORB/VWAP/prior-day — dominant intraday
      f4: { bal: 14, wtd: 12 }, // Live OI walls (built-today vs at-open)
      f5: { bal: 13, wtd: 9  }, // VIX change-from-prev-close + spike detect
      f6: { bal: 11, wtd: 8  }, // Intraday PCR (wider bands)
      f7: { bal: 8,  wtd: 6  }, // Crude/global live-ish
      f8: { bal: 3,  wtd: 2  }, // FII/DII cash — EOD, stale intraday (label 'prev day')
      f9: { bal: 13, wtd: 15 }, // Global/US futures live during session
    },
  } as Record<Mode, Record<FactorId, { bal: number; wtd: number }>>,

  bands: { strong: 50, mild: 20 },
  convictionFloor: 60,

  // Neutral band for grading. Pre/post grades close-to-close.
  // Intraday grades a forward move from the score timestamp; the band is smaller
  // because the horizon is shorter (per index, % of price).
  neutralBandPct: {
    PREPOST:  { NIFTY: 0.30, SENSEX: 0.30, BANKNIFTY: 0.45 },
    INTRADAY: { NIFTY: 0.15, SENSEX: 0.15, BANKNIFTY: 0.22 },
  } as Record<Mode, Record<IndexSymbol, number>>,

  // Intraday only: do not score before this many minutes after open (opening
  // auction noise / no range yet). And freeze/label these factors as non-live.
  intraday: {
    warmupMinutes: 15,               // no verdict in first N min; status stays INSUFFICIENT_DATA
    proxyFactors: ["f1", "f2"] as FactorId[], // served by labelled aggregate proxy, not real split
    staleEodFactors: ["f8"] as FactorId[],    // frozen EOD value, must be labelled 'prev day'
    forwardHorizonMin: 60,           // fixed-horizon grade in addition to close grade
  },
} as const;

const ALL_FACTORS: FactorId[] = ["f1","f2","f3","f4","f5","f6","f7","f8","f9"];

function verdictFor(score: number): Verdict {
  const { strong, mild } = SCORER_CONFIG.bands;
  if (score >= strong) return "STRONG_BULL";
  if (score >= mild)   return "MILD_BULL";
  if (score <= -strong) return "STRONG_BEAR";
  if (score <= -mild)   return "MILD_BEAR";
  return "NO_EDGE";
}

/**
 * Score both models for one index, in the given mode.
 * @param inputs  per-factor direction, null = missing (fail closed)
 * @param gate    event-gate reasons
 * @param mode    PREPOST | INTRADAY (selects weights + rules)
 * @param proxyActive  which factors are currently served by a labelled proxy
 *                     (intraday F1/F2). Purely informational for the UI; does
 *                     NOT change scoring — a proxy value is still a real -1/0/1.
 * @param minutesSinceOpen intraday only; below warmup => INSUFFICIENT_DATA
 */
export function scoreIndex(
  inputs: FactorInputs,
  gate: Record<GateReason, boolean>,
  mode: Mode,
  proxyActive: FactorId[] = [],
  minutesSinceOpen: number | null = null,
): ScoreResult {
  const weights = SCORER_CONFIG.weights[mode];
  const missing = ALL_FACTORS.filter((f) => inputs[f] === null);
  const gateReasons = (Object.keys(gate) as GateReason[]).filter((k) => gate[k]);
  const gateArmed = gateReasons.length > 0;

  // Intraday warmup: refuse to score until a range exists.
  if (mode === "INTRADAY" && minutesSinceOpen !== null &&
      minutesSinceOpen < SCORER_CONFIG.intraday.warmupMinutes) {
    return {
      mode, balScore: null, wtdScore: null,
      balVerdict: "INSUFFICIENT_DATA", wtdVerdict: "INSUFFICIENT_DATA",
      coverage: "PARTIAL", missingFactors: ALL_FACTORS.slice(), proxyFactors: proxyActive,
      gateArmed, gateReasons, status: "INSUFFICIENT_DATA",
    };
  }

  // Fail closed on any missing input.
  if (missing.length > 0) {
    return {
      mode, balScore: null, wtdScore: null,
      balVerdict: "INSUFFICIENT_DATA", wtdVerdict: "INSUFFICIENT_DATA",
      coverage: "PARTIAL", missingFactors: missing, proxyFactors: proxyActive,
      gateArmed, gateReasons, status: "INSUFFICIENT_DATA",
    };
  }

  let bal = 0, wtd = 0;
  for (const f of ALL_FACTORS) {
    const d = inputs[f] as Dir;
    bal += d * weights[f].bal;
    wtd += d * weights[f].wtd;
  }

  // Model B conviction override: F1 & F2 agreement floors the magnitude.
  // Note: intraday F1/F2 are aggregate proxies, so the override still applies
  // but its weight is lower by construction (see INTRADAY weights).
  const f1 = inputs.f1 as Dir, f2 = inputs.f2 as Dir;
  if (f1 !== 0 && f1 === f2) {
    const floor = SCORER_CONFIG.convictionFloor;
    if (f1 > 0 && wtd < floor)  wtd = floor;
    if (f1 < 0 && wtd > -floor) wtd = -floor;
  }

  if (gateArmed) {
    return {
      mode, balScore: bal, wtdScore: wtd,
      balVerdict: "NO_TRADE", wtdVerdict: "NO_TRADE",
      coverage: "FULL", missingFactors: [], proxyFactors: proxyActive,
      gateArmed, gateReasons, status: "GATED_NO_TRADE",
    };
  }

  return {
    mode, balScore: bal, wtdScore: wtd,
    balVerdict: verdictFor(bal), wtdVerdict: verdictFor(wtd),
    coverage: "FULL", missingFactors: [], proxyFactors: proxyActive,
    gateArmed: false, gateReasons: [], status: "SCORED",
  };
}

// ---- Grading -----------------------------------------------------------
export type Realized = "up" | "down" | "flat" | "AWAITING_SPOT";
export type Grade = "hit" | "miss" | "avoid" | "skip";

/**
 * Realized direction from a synthetic-futures return %, using the per-mode,
 * per-index neutral band. Never grades off cash (caller must pass synthetic).
 */
export function realizedDirection(
  retPct: number | null,
  index: IndexSymbol,
  mode: Mode,
): { dir: Realized; band: number } {
  const band = SCORER_CONFIG.neutralBandPct[mode][index];
  if (retPct === null || Number.isNaN(retPct)) return { dir: "AWAITING_SPOT", band };
  const dir: Realized = retPct > band ? "up" : retPct < -band ? "down" : "flat";
  return { dir, band };
}

function verdictDir(v: Verdict): "up" | "down" | "flat" {
  if (v === "STRONG_BULL" || v === "MILD_BULL") return "up";
  if (v === "STRONG_BEAR" || v === "MILD_BEAR") return "down";
  return "flat";
}

export function gradeVerdict(v: Verdict, realized: Realized): Grade | null {
  if (realized === "AWAITING_SPOT") return null;
  const vd = verdictDir(v);
  if (vd === "flat") return realized === "flat" ? "avoid" : "skip";
  return vd === realized ? "hit" : "miss";
}

/**
 * Intraday dual grade: one call is graded against BOTH a fixed forward horizon
 * (e.g. +60 min) and the session close. Returns both grades; caller stores both
 * and tracks two hit rates. Either leg may be AWAITING_SPOT independently.
 */
export function gradeIntradayDual(
  v: Verdict,
  fwdRetPct: number | null,
  closeRetPct: number | null,
  index: IndexSymbol,
): { horizon: Grade | null; close: Grade | null; horizonBand: number; closeBand: number } {
  const h = realizedDirection(fwdRetPct, index, "INTRADAY");
  const c = realizedDirection(closeRetPct, index, "INTRADAY");
  return {
    horizon: gradeVerdict(v, h.dir),
    close: gradeVerdict(v, c.dir),
    horizonBand: h.band,
    closeBand: c.band,
  };
}

/** Hit rate over graded rows: counts hit/miss only (avoid/skip excluded). */
export function hitRate(grades: (Grade | null)[]): { rate: number | null; hits: number; n: number } {
  const directional = grades.filter((g) => g === "hit" || g === "miss");
  const hits = directional.filter((g) => g === "hit").length;
  const n = directional.length;
  return { rate: n ? Math.round((hits / n) * 100) : null, hits, n };
}
