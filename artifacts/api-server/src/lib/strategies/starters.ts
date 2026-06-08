/**
 * Starter custom strategies (Task #113, Phase 1).
 *
 * Five ready-made v2 custom strategies the owner can study, backtest, edit, or
 * enable. They demonstrate the three-layer rule language (market → setup →
 * execution/risk) with EMA / VWAP / Fibonacci blocks.
 *
 * Honesty / safety:
 *   - Every starter is seeded ENGINE-DISABLED (custom strategies default OFF; we
 *     never write an engine-state row for them), so none of them can auto-trade
 *     until the owner explicitly opts in via the Strategy Control allow-list.
 *   - Seeding is ONE-TIME and idempotent: a sentinel engine-state marker records
 *     that the starters were seeded, so a starter the owner later deletes is
 *     NEVER resurrected on the next restart.
 *   - Each spec is validated against the canonical Zod schema before it is
 *     written; an invalid spec is skipped (logged), never silently coerced.
 */
import { logger } from "../logger";
import {
  type CustomStrategySpec,
  type RuleBlock,
  type RuleGroup,
  type SideRules,
  type ExecutionConfig,
  type GroupLogic,
  type EmaKey,
  CustomStrategySpecSchema,
} from "./customSpec";
import {
  OWNER_KEY,
  listCustomSpecs,
  getEngineStateMap,
  upsertCustomSpec,
  setEngineState,
} from "./store";

/** Sentinel engine-state id used solely as a one-time "starters seeded" marker. */
const STARTER_SENTINEL = "__starters_seeded_v1__";

// --- tiny block/group builders (keep the spec literals readable) ------------
const g = (logic: GroupLogic, ...blocks: RuleBlock[]): RuleGroup => ({ logic, blocks });
const side = (market: RuleGroup, setup: RuleGroup): SideRules => ({ market, setup });

const priceVsEma = (ema: EmaKey, cmp: "above" | "below"): RuleBlock => ({ type: "price_vs_ema", ema, cmp });
const emaStack = (order: "bull" | "bear"): RuleBlock => ({ type: "ema_stack", order });
const emaCross = (fast: EmaKey, slow: EmaKey, dir: "golden" | "death"): RuleBlock => ({ type: "ema_cross", fast, slow, dir });
const emaSlope = (ema: EmaKey, dir: "rising" | "falling", lookback: number): RuleBlock => ({ type: "ema_slope", ema, dir, lookback });
const emaPullback = (ema: EmaKey, s: "bull" | "bear", tolPct: number): RuleBlock => ({ type: "ema_pullback", ema, side: s, tolPct });
const priceVsVwap = (cmp: "above" | "below"): RuleBlock => ({ type: "price_vs_vwap", cmp });
const vwapCross = (dir: "reclaim" | "reject"): RuleBlock => ({ type: "vwap_cross", dir });
const fibZone = (s: "bull" | "bear", lo: number, hi: number, swingSpan: number): RuleBlock => ({ type: "fib_zone", side: s, lo, hi, swingSpan });

const atrStop = (atrMult: number): ExecutionConfig["stop"] => ({ type: "atr", atrMult });
const swingStop = (swingSpan: number, bufferAtrMult: number): ExecutionConfig["stop"] => ({ type: "swing", swingSpan, bufferAtrMult });

function exec(stop: ExecutionConfig["stop"], target1R: number, target2R: number, minRR = 1): ExecutionConfig {
  return { stop, target1R, target2R, minRR };
}

/**
 * The five starter specs. Built as fully-typed literals (so the compiler checks
 * block shapes) and validated at seed time against `CustomStrategySpecSchema`.
 */
export const STARTER_SPECS: readonly CustomStrategySpec[] = [
  {
    version: 2,
    id: "CUSTOM_starter_ema_pullback_trend",
    name: "Trend Pullback to EMA20",
    category: "Starter",
    description:
      "Trend-following pullback: in a stacked-EMA uptrend (downtrend) with a rising (falling) EMA20, enter on a pullback that taps the EMA20.",
    direction: "BOTH",
    bull: side(g("AND", emaStack("bull"), emaSlope("ema20", "rising", 5)), g("AND", emaPullback("ema20", "bull", 0.5))),
    bear: side(g("AND", emaStack("bear"), emaSlope("ema20", "falling", 5)), g("AND", emaPullback("ema20", "bear", 0.5))),
    execution: exec(atrStop(1.5), 1, 2),
    baseConfidence: 60,
  },
  {
    version: 2,
    id: "CUSTOM_starter_vwap_reclaim",
    name: "VWAP Reclaim Continuation",
    category: "Starter",
    description:
      "Above (below) the 50-EMA, enter when price reclaims (rejects) VWAP and holds on the same side. Uses the labeled session-mean VWAP substitute on index candles.",
    direction: "BOTH",
    bull: side(g("AND", priceVsEma("ema50", "above")), g("AND", vwapCross("reclaim"), priceVsVwap("above"))),
    bear: side(g("AND", priceVsEma("ema50", "below")), g("AND", vwapCross("reject"), priceVsVwap("below"))),
    execution: exec(atrStop(1.5), 1, 2),
    baseConfidence: 58,
  },
  {
    version: 2,
    id: "CUSTOM_starter_fib_retracement",
    name: "Fib Retracement Bounce",
    category: "Starter",
    description:
      "In a stacked-EMA trend, enter when price sits inside the 0.382–0.618 Fibonacci retracement of the recent causal swing. Swing-based defined-risk stop.",
    direction: "BOTH",
    bull: side(g("AND", emaStack("bull")), g("AND", fibZone("bull", 0.382, 0.618, 8))),
    bear: side(g("AND", emaStack("bear")), g("AND", fibZone("bear", 0.382, 0.618, 8))),
    execution: exec(swingStop(10, 0.25), 1, 2),
    baseConfidence: 57,
  },
  {
    version: 2,
    id: "CUSTOM_starter_ema_golden_cross",
    name: "EMA 9/20 Cross with Trend",
    category: "Starter",
    description:
      "With a rising (falling) EMA50 regime, enter on a 9/20 EMA golden (death) cross confirmed by price above (below) VWAP.",
    direction: "BOTH",
    bull: side(g("AND", emaSlope("ema50", "rising", 5)), g("AND", emaCross("ema9", "ema20", "golden"), priceVsVwap("above"))),
    bear: side(g("AND", emaSlope("ema50", "falling", 5)), g("AND", emaCross("ema9", "ema20", "death"), priceVsVwap("below"))),
    execution: exec(atrStop(2), 1, 2.5),
    baseConfidence: 60,
  },
  {
    version: 2,
    id: "CUSTOM_starter_vwap_trend_pullback",
    name: "VWAP Trend Pullback",
    category: "Starter",
    description:
      "Above (below) VWAP with a stacked-EMA trend, enter on a shallow pullback that taps the EMA9.",
    direction: "BOTH",
    bull: side(g("AND", priceVsVwap("above"), emaStack("bull")), g("AND", emaPullback("ema9", "bull", 0.4))),
    bear: side(g("AND", priceVsVwap("below"), emaStack("bear")), g("AND", emaPullback("ema9", "bear", 0.4))),
    execution: exec(atrStop(1.5), 1, 2),
    baseConfidence: 58,
  },
];

/**
 * One-time, idempotent seed of the starter strategies for an owner.
 *
 * - Skips entirely once the sentinel marker exists (no resurrection of deleted
 *   starters).
 * - Only inserts a starter whose id does not already exist (never clobbers an
 *   owner edit that happens to share an id).
 * - Validates each spec; an invalid one is skipped and logged, never coerced.
 * - Never writes an engine-state row for a starter, so all stay engine-DISABLED.
 */
export async function seedStarterStrategies(
  ownerKey: string = OWNER_KEY,
): Promise<{ seeded: boolean; ids: string[] }> {
  const state = await getEngineStateMap(ownerKey);
  if (state.has(STARTER_SENTINEL)) return { seeded: false, ids: [] };

  const existing = new Set((await listCustomSpecs(ownerKey)).map((s) => s.id));
  const ids: string[] = [];
  for (const spec of STARTER_SPECS) {
    if (existing.has(spec.id)) continue;
    const parsed = CustomStrategySpecSchema.safeParse(spec);
    if (!parsed.success) {
      logger.warn({ id: spec.id, issues: parsed.error.flatten() }, "Skipping invalid starter strategy");
      continue;
    }
    await upsertCustomSpec(parsed.data, ownerKey);
    ids.push(spec.id);
  }
  // Mark seeded regardless, so the one-time seed never runs again for this owner.
  await setEngineState(STARTER_SENTINEL, false, ownerKey);
  return { seeded: true, ids };
}
