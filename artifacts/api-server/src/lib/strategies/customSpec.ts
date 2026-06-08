/**
 * Declarative, config/parameter-driven custom-strategy spec + pure evaluator.
 *
 * This module is intentionally CONTEXT-AGNOSTIC: it imports neither the live
 * F&O engine (`optionSignals.ts`) nor the Backtest Lab (`backtest/strategies/*`).
 * Both surfaces feed it a `FeatureSnapshot` (the small set of indicator values
 * available in BOTH the live engine `Ctx` and the historical backtest
 * `StrategyContext`) and get back an identical, honest evaluation. That common
 * subset is the contract that lets a single custom strategy behave the same way
 * live and in backtests.
 *
 * Honesty rules:
 *  - A condition referencing a feature that is null / NaN FAILS (never assumed
 *    true, never fabricated).
 *  - Geometry requires a finite, positive ATR; without it the evaluator returns
 *    null rather than inventing a stop distance.
 */
import { z } from "zod";

/** Indicator values available in BOTH the live engine and backtest contexts. */
export const FEATURE_KEYS = [
  "close",
  "ema9",
  "ema20",
  "ema50",
  "rsi14",
  "atr14",
  "vwap",
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

/** A single bar's worth of features. Any value may be null during warm-up. */
export type FeatureSnapshot = Record<FeatureKey, number | null>;

export const CONDITION_OPS = ["gt", "lt", "gte", "lte"] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

/** Right-hand operand: another feature, or a literal constant. */
export type ConditionOperand =
  | { type: "feature"; feature: FeatureKey }
  | { type: "value"; value: number };

export interface CustomCondition {
  left: FeatureKey;
  op: ConditionOp;
  right: ConditionOperand;
}

export interface CustomStrategyParams {
  /** Stop distance = stopAtrMult × ATR(14). */
  stopAtrMult: number;
  /** Target 1 as a multiple of the risk (stop distance). */
  target1R: number;
  /** Target 2 as a multiple of the risk (stop distance). */
  target2R: number;
}

export interface CustomStrategySpec {
  /** Stable id, always `CUSTOM_<slug>`. */
  id: string;
  name: string;
  category: string;
  description: string;
  /** ALL conditions must pass to take the bull side. Empty = side disabled. */
  bull: CustomCondition[];
  /** ALL conditions must pass to take the bear side. Empty = side disabled. */
  bear: CustomCondition[];
  params: CustomStrategyParams;
  /** Transparent base confidence (0–100) carried into both surfaces. */
  baseConfidence: number;
}

export const DEFAULT_CUSTOM_PARAMS: CustomStrategyParams = {
  stopAtrMult: 1.5,
  target1R: 1,
  target2R: 2,
};
export const DEFAULT_BASE_CONFIDENCE = 60;

// ---------------------------------------------------------------------------
// Zod schema (route input validation; fail-closed on anything unrecognised)
// ---------------------------------------------------------------------------

const featureKeySchema = z.enum(FEATURE_KEYS);
const opSchema = z.enum(CONDITION_OPS);

const operandSchema: z.ZodType<ConditionOperand> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("feature"), feature: featureKeySchema }),
  z.object({ type: z.literal("value"), value: z.number().finite() }),
]);

const conditionSchema: z.ZodType<CustomCondition> = z.object({
  left: featureKeySchema,
  op: opSchema,
  right: operandSchema,
});

const paramsSchema: z.ZodType<CustomStrategyParams> = z.object({
  stopAtrMult: z.number().finite().min(0.5).max(5),
  target1R: z.number().finite().min(0.25).max(10),
  target2R: z.number().finite().min(0.25).max(10),
});

/** Slug used inside the `CUSTOM_<slug>` id. */
export const SLUG_RE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

/** Input accepted from the owner UI when creating/updating a custom strategy. */
export const CustomStrategyInputSchema = z
  .object({
    slug: z
      .string()
      .min(2)
      .max(40)
      .regex(SLUG_RE, "slug must be lowercase alphanumeric words separated by underscores"),
    name: z.string().min(2).max(80),
    category: z.string().min(2).max(40),
    description: z.string().max(400).default(""),
    bull: z.array(conditionSchema).max(8).default([]),
    bear: z.array(conditionSchema).max(8).default([]),
    params: paramsSchema.default(DEFAULT_CUSTOM_PARAMS),
    baseConfidence: z.number().finite().min(0).max(100).default(DEFAULT_BASE_CONFIDENCE),
  })
  .refine((v) => v.bull.length > 0 || v.bear.length > 0, {
    message: "at least one of bull / bear must have a condition",
    path: ["bull"],
  });

export type CustomStrategyInput = z.input<typeof CustomStrategyInputSchema>;

/** Persisted spec shape (the `spec` JSONB column). */
export const CustomStrategySpecSchema: z.ZodType<CustomStrategySpec> = z
  .object({
    id: z.string().regex(/^CUSTOM_[a-z0-9_]+$/),
    name: z.string().min(2).max(80),
    category: z.string().min(2).max(40),
    description: z.string().max(400),
    bull: z.array(conditionSchema).max(8),
    bear: z.array(conditionSchema).max(8),
    params: paramsSchema,
    baseConfidence: z.number().finite().min(0).max(100),
  })
  .refine((v) => v.bull.length > 0 || v.bear.length > 0, {
    message: "at least one of bull / bear must have a condition",
  });

/** Build the canonical id for a slug. */
export function customIdForSlug(slug: string): string {
  return `CUSTOM_${slug}`;
}

/** Turn validated owner input into a persisted spec. */
export function specFromInput(input: z.output<typeof CustomStrategyInputSchema>): CustomStrategySpec {
  return {
    id: customIdForSlug(input.slug),
    name: input.name,
    category: input.category,
    description: input.description,
    bull: input.bull,
    bear: input.bear,
    params: input.params,
    baseConfidence: input.baseConfidence,
  };
}

// ---------------------------------------------------------------------------
// Pure evaluator
// ---------------------------------------------------------------------------

export interface CustomEvalResult {
  direction: "BULL" | "BEAR";
  entrySpot: number;
  stop: number;
  target1: number;
  target2: number;
  confidence: number;
  /** Human-readable descriptions of the conditions that fired. */
  passed: string[];
}

function isFinitePos(n: number | null): n is number {
  return n != null && Number.isFinite(n) && n > 0;
}

function readOperand(f: FeatureSnapshot, op: ConditionOperand): number | null {
  if (op.type === "value") return Number.isFinite(op.value) ? op.value : null;
  const v = f[op.feature];
  return v != null && Number.isFinite(v) ? v : null;
}

function compare(l: number, op: ConditionOp, r: number): boolean {
  switch (op) {
    case "gt":
      return l > r;
    case "lt":
      return l < r;
    case "gte":
      return l >= r;
    case "lte":
      return l <= r;
  }
}

const OP_SYMBOL: Record<ConditionOp, string> = { gt: ">", lt: "<", gte: ">=", lte: "<=" };

function describeCondition(c: CustomCondition): string {
  const right = c.right.type === "feature" ? c.right.feature : String(c.right.value);
  return `${c.left} ${OP_SYMBOL[c.op]} ${right}`;
}

/** All conditions must hold; a null/NaN operand makes that condition (and the side) fail. */
function sidePasses(f: FeatureSnapshot, conds: CustomCondition[]): boolean {
  if (conds.length === 0) return false;
  for (const c of conds) {
    const l = f[c.left];
    if (l == null || !Number.isFinite(l)) return false;
    const r = readOperand(f, c.right);
    if (r == null) return false;
    if (!compare(l, c.op, r)) return false;
  }
  return true;
}

/**
 * Evaluate a custom spec against a single feature snapshot. Returns null when no
 * side fires, or when geometry cannot be honestly derived (non-finite close /
 * ATR). Bull is checked first; the two sides are mutually exclusive by design.
 */
export function evaluateCustomSpec(
  f: FeatureSnapshot,
  spec: CustomStrategySpec,
): CustomEvalResult | null {
  const bull = sidePasses(f, spec.bull);
  const bear = !bull && sidePasses(f, spec.bear);
  if (!bull && !bear) return null;

  const entry = f.close;
  const atr = f.atr14;
  if (entry == null || !Number.isFinite(entry)) return null;
  if (!isFinitePos(atr)) return null;

  const risk = spec.params.stopAtrMult * atr;
  if (!isFinitePos(risk)) return null;

  const direction: "BULL" | "BEAR" = bull ? "BULL" : "BEAR";
  const sign = direction === "BULL" ? 1 : -1;
  const stop = entry - sign * risk;
  const target1 = entry + sign * spec.params.target1R * risk;
  const target2 = entry + sign * spec.params.target2R * risk;

  const conds = direction === "BULL" ? spec.bull : spec.bear;
  return {
    direction,
    entrySpot: entry,
    stop,
    target1,
    target2,
    confidence: Math.max(0, Math.min(100, spec.baseConfidence)),
    passed: conds.map(describeCondition),
  };
}
