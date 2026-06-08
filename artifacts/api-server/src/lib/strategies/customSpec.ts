/**
 * Declarative, versioned custom-strategy spec (v2) + the legacy v1 shape and a
 * lossless v1→v2 migration.
 *
 * This module is intentionally CONTEXT-AGNOSTIC: it imports neither the live
 * F&O engine (`optionSignals.ts`) nor the Backtest Lab (`backtest/strategies/*`).
 * The single shared evaluator (`customEval.ts`) consumes a `FeatureSeries`
 * (`customFeatures.ts`) that BOTH surfaces build from their own bar windows, so
 * one custom strategy behaves identically live and in backtests.
 *
 * v2 introduces a three-layer rule language:
 *   - market  : the regime/context filter (e.g. EMA stack, EMA slope).
 *   - setup   : the trigger (e.g. VWAP reclaim, pullback to EMA, Fib zone).
 *   - execution: stop (ATR or swing), R-targets, session window, direction,
 *                min-RR / max-stop sanity. Stateful caps (dailyCap, trailing)
 *                are carried honestly as metadata and enforced by the runner —
 *                the pure evaluator never fakes stateful behaviour.
 *
 * Honesty rules (enforced in the evaluator):
 *   - a block referencing a null/NaN feature FAILS (never assumed favourable);
 *   - swing-based geometry without a confirmed swing FAILS (no fabrication);
 *   - geometry requires a finite positive ATR.
 */
import { z } from "zod";
import {
  FIB_RETRACE_RATIOS,
  FIB_EXTENSION_RATIOS,
} from "@workspace/indicators";

// ===========================================================================
// Scalar feature vocabulary (shared by the v2 `compare` block and v1 specs)
// ===========================================================================

/** Indicator scalars available at a single bar in BOTH surfaces. */
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

export const EMA_KEYS = ["ema9", "ema20", "ema50"] as const;
export type EmaKey = (typeof EMA_KEYS)[number];

export const CONDITION_OPS = ["gt", "lt", "gte", "lte"] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

/** Right-hand operand of a `compare` block: another feature, or a constant. */
export type ConditionOperand =
  | { type: "feature"; feature: FeatureKey }
  | { type: "value"; value: number };

// ===========================================================================
// v1 (legacy) shape — retained ONLY so persisted v1 specs can be migrated.
// ===========================================================================

export interface CustomConditionV1 {
  left: FeatureKey;
  op: ConditionOp;
  right: ConditionOperand;
}

export interface CustomStrategyParamsV1 {
  stopAtrMult: number;
  target1R: number;
  target2R: number;
}

export interface CustomStrategySpecV1 {
  id: string;
  name: string;
  category: string;
  description: string;
  bull: CustomConditionV1[];
  bear: CustomConditionV1[];
  params: CustomStrategyParamsV1;
  baseConfidence: number;
}

// ===========================================================================
// v2 rule language
// ===========================================================================

export type GroupLogic = "AND" | "OR";

/** A single rule block. Discriminated by `type`. */
export type RuleBlock =
  // --- EMA blocks --------------------------------------------------------
  | { type: "price_vs_ema"; ema: EmaKey; cmp: "above" | "below" }
  | { type: "ema_stack"; order: "bull" | "bear" }
  | { type: "ema_cross"; fast: EmaKey; slow: EmaKey; dir: "golden" | "death" }
  | { type: "ema_slope"; ema: EmaKey; dir: "rising" | "falling"; lookback: number }
  | { type: "ema_pullback"; ema: EmaKey; side: "bull" | "bear"; tolPct: number }
  | { type: "ema_distance_max"; ema: EmaKey; maxPct: number }
  // --- VWAP blocks -------------------------------------------------------
  | { type: "price_vs_vwap"; cmp: "above" | "below" }
  | { type: "vwap_cross"; dir: "reclaim" | "reject" }
  | { type: "vwap_distance_max"; maxPct: number }
  // --- Fibonacci blocks --------------------------------------------------
  | { type: "fib_zone"; side: "bull" | "bear"; lo: number; hi: number; swingSpan: number }
  // --- generic scalar comparison (back-compat with v1) -------------------
  | { type: "compare"; left: FeatureKey; op: ConditionOp; right: ConditionOperand };

export type RuleBlockType = RuleBlock["type"];

/** A boolean group of blocks plus (optionally) nested groups. */
export interface RuleGroup {
  logic: GroupLogic;
  blocks: RuleBlock[];
  groups?: RuleGroup[];
}

/** One direction's two gating layers. Empty layers are pass-through. */
export interface SideRules {
  market: RuleGroup;
  setup: RuleGroup;
}

export type StopConfig =
  | { type: "atr"; atrMult: number }
  | { type: "swing"; swingSpan: number; bufferAtrMult: number };

export interface ExecutionConfig {
  stop: StopConfig;
  target1R: number;
  target2R: number;
  /** Reject if the planned target-1 reward (in R) is below this. */
  minRR?: number;
  /** Reject if the stop distance exceeds this multiple of ATR (swing sanity). */
  maxStopAtrMult?: number;
  /**
   * Anti-chase execution gate: reject the entry if the entry price is more than
   * this multiple of ATR away from the EMA20 trend reference. Honest: if EMA20 or
   * ATR is unavailable the gate FAILS the entry rather than passing it through.
   */
  maxEntryDistanceAtrMult?: number;
  /** IST minute-of-day window [start,end] inclusive within which entries fire. */
  sessionWindow?: { startMin: number; endMin: number };
  /** Runner-enforced metadata (honest): trail to breakeven after +1R. */
  trailingToBreakeven?: boolean;
  /** Runner-enforced metadata (honest): max entries/day for this strategy. */
  dailyCap?: number;
}

export type StrategyDirectionMode = "BOTH" | "CALL_ONLY" | "PUT_ONLY";

export const CUSTOM_SPEC_VERSION = 2 as const;

/** The canonical, in-memory custom-strategy spec (always v2). */
export interface CustomStrategySpec {
  version: 2;
  id: string;
  name: string;
  category: string;
  description: string;
  direction: StrategyDirectionMode;
  bull: SideRules;
  bear: SideRules;
  execution: ExecutionConfig;
  baseConfidence: number;
}

export const DEFAULT_EXECUTION: ExecutionConfig = {
  stop: { type: "atr", atrMult: 1.5 },
  target1R: 1,
  target2R: 2,
};
export const DEFAULT_BASE_CONFIDENCE = 60;

export function emptyGroup(logic: GroupLogic = "AND"): RuleGroup {
  return { logic, blocks: [] };
}
export function emptySide(): SideRules {
  return { market: emptyGroup("AND"), setup: emptyGroup("AND") };
}

/** True when a side has no rules anywhere (recursively) — i.e. it is disabled. */
export function sideIsEmpty(side: SideRules): boolean {
  return groupIsEmpty(side.market) && groupIsEmpty(side.setup);
}
export function groupIsEmpty(g: RuleGroup): boolean {
  if (g.blocks.length > 0) return false;
  return (g.groups ?? []).every(groupIsEmpty);
}

/** Total number of blocks in a side (for size limits). */
export function countBlocks(g: RuleGroup): number {
  return g.blocks.length + (g.groups ?? []).reduce((a, sub) => a + countBlocks(sub), 0);
}

// ===========================================================================
// Zod schemas (route input + persisted JSONB validation; fail-closed)
// ===========================================================================

const featureKeySchema = z.enum(FEATURE_KEYS);
const emaKeySchema = z.enum(EMA_KEYS);
const opSchema = z.enum(CONDITION_OPS);

const operandSchema: z.ZodType<ConditionOperand> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("feature"), feature: featureKeySchema }),
  z.object({ type: z.literal("value"), value: z.number().finite() }),
]);

const ratio = z.number().finite().min(0).max(3);

// Zod v3 requires every discriminatedUnion option to be a bare ZodObject, so the
// cross-field constraints (ema_cross fast≠slow, fib_zone lo<hi) are enforced in a
// superRefine on the union rather than per-option .refine().
const ruleBlockUnion = z.discriminatedUnion("type", [
  z.object({ type: z.literal("price_vs_ema"), ema: emaKeySchema, cmp: z.enum(["above", "below"]) }),
  z.object({ type: z.literal("ema_stack"), order: z.enum(["bull", "bear"]) }),
  z.object({
    type: z.literal("ema_cross"),
    fast: emaKeySchema,
    slow: emaKeySchema,
    dir: z.enum(["golden", "death"]),
  }),
  z.object({
    type: z.literal("ema_slope"),
    ema: emaKeySchema,
    dir: z.enum(["rising", "falling"]),
    lookback: z.number().int().min(1).max(20),
  }),
  z.object({
    type: z.literal("ema_pullback"),
    ema: emaKeySchema,
    side: z.enum(["bull", "bear"]),
    tolPct: z.number().finite().min(0).max(5),
  }),
  z.object({ type: z.literal("ema_distance_max"), ema: emaKeySchema, maxPct: z.number().finite().min(0).max(20) }),
  z.object({ type: z.literal("price_vs_vwap"), cmp: z.enum(["above", "below"]) }),
  z.object({ type: z.literal("vwap_cross"), dir: z.enum(["reclaim", "reject"]) }),
  z.object({ type: z.literal("vwap_distance_max"), maxPct: z.number().finite().min(0).max(20) }),
  z.object({
    type: z.literal("fib_zone"),
    side: z.enum(["bull", "bear"]),
    lo: ratio,
    hi: ratio,
    swingSpan: z.number().int().min(2).max(10),
  }),
  z.object({ type: z.literal("compare"), left: featureKeySchema, op: opSchema, right: operandSchema }),
]);

const ruleBlockSchema: z.ZodType<RuleBlock> = ruleBlockUnion.superRefine((b, ctx) => {
  if (b.type === "ema_cross" && b.fast === b.slow) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "ema_cross fast and slow must differ" });
  }
  if (b.type === "fib_zone" && !(b.lo < b.hi)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "fib_zone lo must be < hi" });
  }
}) as z.ZodType<RuleBlock>;

// Recursive group schema (bounded). z.lazy lets `groups` reference itself.
const ruleGroupSchema: z.ZodType<RuleGroup> = z.lazy(() =>
  z.object({
    logic: z.enum(["AND", "OR"]),
    blocks: z.array(ruleBlockSchema).max(12),
    groups: z.array(ruleGroupSchema).max(4).optional(),
  }),
);

const sideRulesSchema: z.ZodType<SideRules> = z.object({
  market: ruleGroupSchema,
  setup: ruleGroupSchema,
});

const stopSchema: z.ZodType<StopConfig> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("atr"), atrMult: z.number().finite().min(0.25).max(8) }),
  z.object({
    type: z.literal("swing"),
    swingSpan: z.number().int().min(2).max(10),
    bufferAtrMult: z.number().finite().min(0).max(3),
  }),
]);

const executionSchema: z.ZodType<ExecutionConfig> = z.object({
  stop: stopSchema,
  target1R: z.number().finite().min(0.25).max(10),
  target2R: z.number().finite().min(0.25).max(20),
  minRR: z.number().finite().min(0).max(10).optional(),
  maxStopAtrMult: z.number().finite().min(0.5).max(10).optional(),
  maxEntryDistanceAtrMult: z.number().finite().min(0.5).max(20).optional(),
  sessionWindow: z
    .object({
      startMin: z.number().int().min(0).max(1439),
      endMin: z.number().int().min(0).max(1439),
    })
    .refine((w) => w.startMin <= w.endMin, { message: "sessionWindow startMin must be <= endMin" })
    .optional(),
  trailingToBreakeven: z.boolean().optional(),
  dailyCap: z.number().int().min(1).max(50).optional(),
});

const directionSchema = z.enum(["BOTH", "CALL_ONLY", "PUT_ONLY"]);

const MAX_BLOCKS_PER_SIDE = 24;

function sideWithinLimits(side: SideRules): boolean {
  return countBlocks(side.market) + countBlocks(side.setup) <= MAX_BLOCKS_PER_SIDE;
}

/** Persisted v2 spec shape (the `spec` JSONB column once migrated). */
export const CustomStrategySpecSchema: z.ZodType<CustomStrategySpec> = z
  .object({
    version: z.literal(2),
    id: z.string().regex(/^CUSTOM_[a-z0-9_]+$/),
    name: z.string().min(2).max(80),
    category: z.string().min(2).max(40),
    description: z.string().max(400),
    direction: directionSchema,
    bull: sideRulesSchema,
    bear: sideRulesSchema,
    execution: executionSchema,
    baseConfidence: z.number().finite().min(0).max(100),
  })
  .refine((v) => !sideIsEmpty(v.bull) || !sideIsEmpty(v.bear), {
    message: "at least one of bull / bear must contain a rule",
  })
  .refine((v) => sideWithinLimits(v.bull) && sideWithinLimits(v.bear), {
    message: `each side may contain at most ${MAX_BLOCKS_PER_SIDE} blocks`,
  });

// ===========================================================================
// Owner input (UI → route) and id helpers
// ===========================================================================

/** Slug used inside the `CUSTOM_<slug>` id. */
export const SLUG_RE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

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
    direction: directionSchema.default("BOTH"),
    bull: sideRulesSchema.default(emptySide()),
    bear: sideRulesSchema.default(emptySide()),
    execution: executionSchema.default(DEFAULT_EXECUTION),
    baseConfidence: z.number().finite().min(0).max(100).default(DEFAULT_BASE_CONFIDENCE),
  })
  .refine((v) => !sideIsEmpty(v.bull) || !sideIsEmpty(v.bear), {
    message: "at least one of bull / bear must contain a rule",
    path: ["bull"],
  })
  .refine((v) => sideWithinLimits(v.bull) && sideWithinLimits(v.bear), {
    message: `each side may contain at most ${MAX_BLOCKS_PER_SIDE} blocks`,
    path: ["bull"],
  });

export type CustomStrategyInput = z.input<typeof CustomStrategyInputSchema>;

export function customIdForSlug(slug: string): string {
  return `CUSTOM_${slug}`;
}

export function specFromInput(input: z.output<typeof CustomStrategyInputSchema>): CustomStrategySpec {
  return {
    version: CUSTOM_SPEC_VERSION,
    id: customIdForSlug(input.slug),
    name: input.name,
    category: input.category,
    description: input.description,
    direction: input.direction,
    bull: input.bull,
    bear: input.bear,
    execution: input.execution,
    baseConfidence: input.baseConfidence,
  };
}

// ===========================================================================
// v1 → v2 migration (lossless)
// ===========================================================================

const v1ConditionSchema: z.ZodType<CustomConditionV1> = z.object({
  left: featureKeySchema,
  op: opSchema,
  right: operandSchema,
});

const v1SpecSchema: z.ZodType<CustomStrategySpecV1> = z.object({
  id: z.string().regex(/^CUSTOM_[a-z0-9_]+$/),
  name: z.string().min(2).max(80),
  category: z.string().min(2).max(40),
  description: z.string().max(400),
  bull: z.array(v1ConditionSchema).max(8),
  bear: z.array(v1ConditionSchema).max(8),
  params: z.object({
    stopAtrMult: z.number().finite().min(0.25).max(8),
    target1R: z.number().finite().min(0.25).max(10),
    target2R: z.number().finite().min(0.25).max(20),
  }),
  baseConfidence: z.number().finite().min(0).max(100),
});

function v1ConditionsToSide(conds: CustomConditionV1[]): SideRules {
  const side = emptySide();
  // v1 was implicit-AND across a flat list → a single AND setup group.
  side.setup = {
    logic: "AND",
    blocks: conds.map((c): RuleBlock => ({ type: "compare", left: c.left, op: c.op, right: c.right })),
  };
  return side;
}

/** Upgrade a legacy v1 spec to the canonical v2 shape (semantics preserved). */
export function migrateV1ToV2(v1: CustomStrategySpecV1): CustomStrategySpec {
  return {
    version: CUSTOM_SPEC_VERSION,
    id: v1.id,
    name: v1.name,
    category: v1.category,
    description: v1.description,
    direction: "BOTH",
    bull: v1ConditionsToSide(v1.bull),
    bear: v1ConditionsToSide(v1.bear),
    execution: {
      stop: { type: "atr", atrMult: v1.params.stopAtrMult },
      target1R: v1.params.target1R,
      target2R: v1.params.target2R,
    },
    baseConfidence: v1.baseConfidence,
  };
}

/**
 * Parse an unknown persisted `spec` JSONB blob into the canonical v2 shape.
 * Accepts native v2; falls back to v1 + migration. Returns null when neither
 * validates (caller SKIPS malformed rows — never fabricates a strategy).
 */
export function parsePersistedSpec(raw: unknown): CustomStrategySpec | null {
  const v2 = CustomStrategySpecSchema.safeParse(raw);
  if (v2.success) return v2.data;
  const v1 = v1SpecSchema.safeParse(raw);
  if (v1.success) return migrateV1ToV2(v1.data);
  return null;
}

/** Re-export the canonical fib ratios so the UI/spec authors share one list. */
export { FIB_RETRACE_RATIOS, FIB_EXTENSION_RATIOS };
