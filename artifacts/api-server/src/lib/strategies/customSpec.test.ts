/**
 * v2 custom-strategy spec: Zod validation, owner-input → spec, and the lossless
 * v1 → v2 migration. The same spec is consumed identically by the live F&O
 * engine and the Backtest Lab via the shared evaluator.
 */
import { describe, it, expect } from "vitest";
import {
  CustomStrategyInputSchema,
  CustomStrategySpecSchema,
  specFromInput,
  migrateV1ToV2,
  parsePersistedSpec,
  sideIsEmpty,
  emptySide,
  type CustomStrategyInput,
  type CustomStrategySpecV1,
} from "./customSpec";

function baseInput(over: Partial<CustomStrategyInput> = {}): CustomStrategyInput {
  return {
    slug: "trend_pull",
    name: "Trend Pullback",
    category: "Trend",
    bull: {
      market: { logic: "AND", blocks: [{ type: "ema_stack", order: "bull" }] },
      setup: { logic: "AND", blocks: [{ type: "price_vs_vwap", cmp: "above" }] },
    },
    bear: emptySide(),
    execution: { stop: { type: "atr", atrMult: 1.5 }, target1R: 1, target2R: 2 },
    ...over,
  } as CustomStrategyInput;
}

describe("CustomStrategyInputSchema / specFromInput", () => {
  it("accepts a valid layered input and builds a CUSTOM_<slug> v2 spec", () => {
    const parsed = CustomStrategyInputSchema.parse(baseInput());
    const spec = specFromInput(parsed);
    expect(spec.version).toBe(2);
    expect(spec.id).toBe("CUSTOM_trend_pull");
    expect(spec.direction).toBe("BOTH");
    expect(CustomStrategySpecSchema.safeParse(spec).success).toBe(true);
  });

  it("rejects a spec with no rules on either side", () => {
    const res = CustomStrategyInputSchema.safeParse(baseInput({ bull: emptySide(), bear: emptySide() }));
    expect(res.success).toBe(false);
  });

  it("rejects an invalid slug", () => {
    expect(CustomStrategyInputSchema.safeParse(baseInput({ slug: "Bad Slug" })).success).toBe(false);
  });

  it("rejects an ema_cross with identical fast/slow", () => {
    const res = CustomStrategyInputSchema.safeParse(
      baseInput({
        bull: {
          market: { logic: "AND", blocks: [{ type: "ema_cross", fast: "ema9", slow: "ema9", dir: "golden" }] },
          setup: emptySide().setup,
        },
      }),
    );
    expect(res.success).toBe(false);
  });

  it("rejects a fib_zone with lo >= hi", () => {
    const res = CustomStrategyInputSchema.safeParse(
      baseInput({
        bull: {
          market: emptySide().market,
          setup: { logic: "AND", blocks: [{ type: "fib_zone", side: "bull", lo: 0.618, hi: 0.382, swingSpan: 3 }] },
        },
      }),
    );
    expect(res.success).toBe(false);
  });

  it("accepts nested OR groups", () => {
    const res = CustomStrategyInputSchema.safeParse(
      baseInput({
        bull: {
          market: emptySide().market,
          setup: {
            logic: "OR",
            blocks: [{ type: "vwap_cross", dir: "reclaim" }],
            groups: [{ logic: "AND", blocks: [{ type: "price_vs_ema", ema: "ema20", cmp: "above" }] }],
          },
        },
      }),
    );
    expect(res.success).toBe(true);
  });
});

describe("SMC blocks + smc stop validation", () => {
  const withSetupBlock = (block: unknown, over: Partial<CustomStrategyInput> = {}) =>
    CustomStrategyInputSchema.safeParse(
      baseInput({
        bull: { market: emptySide().market, setup: { logic: "AND", blocks: [block as never] } },
        ...over,
      }),
    );

  it("accepts every SMC block variant", () => {
    const blocks = [
      { type: "fvg", side: "bull", mode: "present" },
      { type: "fvg", side: "bear", mode: "fill" },
      { type: "fvg", side: "bull", mode: "retest" },
      { type: "bos", dir: "up" },
      { type: "choch", dir: "down" },
      { type: "liquidity_sweep", side: "buy" },
      { type: "order_block", side: "demand", mode: "test" },
      { type: "order_block", side: "supply", mode: "present" },
      { type: "displacement", dir: "up" },
    ];
    for (const b of blocks) expect(withSetupBlock(b).success).toBe(true);
  });

  it("rejects SMC blocks with invalid enum members", () => {
    expect(withSetupBlock({ type: "fvg", side: "bull", mode: "tap" }).success).toBe(false);
    expect(withSetupBlock({ type: "bos", dir: "sideways" }).success).toBe(false);
    expect(withSetupBlock({ type: "liquidity_sweep", side: "both" }).success).toBe(false);
    expect(withSetupBlock({ type: "order_block", side: "neutral", mode: "test" }).success).toBe(false);
  });

  it("accepts an smc-anchored stop for every source", () => {
    for (const source of ["fvg", "order_block", "swing"] as const) {
      const res = CustomStrategyInputSchema.safeParse(
        baseInput({ execution: { stop: { type: "smc", source, bufferAtrMult: 0.5 }, target1R: 1, target2R: 2 } }),
      );
      expect(res.success).toBe(true);
      if (res.success) expect(CustomStrategySpecSchema.safeParse(specFromInput(res.data)).success).toBe(true);
    }
  });

  it("rejects an smc stop with an unknown source or out-of-range buffer", () => {
    expect(
      CustomStrategyInputSchema.safeParse(
        baseInput({ execution: { stop: { type: "smc", source: "volume" as never, bufferAtrMult: 0.5 }, target1R: 1, target2R: 2 } }),
      ).success,
    ).toBe(false);
    expect(
      CustomStrategyInputSchema.safeParse(
        baseInput({ execution: { stop: { type: "smc", source: "fvg", bufferAtrMult: 9 }, target1R: 1, target2R: 2 } }),
      ).success,
    ).toBe(false);
  });
});

describe("sideIsEmpty", () => {
  it("treats a side with only empty nested groups as empty", () => {
    expect(sideIsEmpty({ market: { logic: "AND", blocks: [], groups: [{ logic: "AND", blocks: [] }] }, setup: emptySide().setup })).toBe(true);
  });
  it("is false once any block exists", () => {
    expect(sideIsEmpty({ market: { logic: "AND", blocks: [{ type: "price_vs_vwap", cmp: "above" }] }, setup: emptySide().setup })).toBe(false);
  });
});

describe("migrateV1ToV2", () => {
  const v1: CustomStrategySpecV1 = {
    id: "CUSTOM_legacy",
    name: "Legacy",
    category: "Old",
    description: "",
    bull: [
      { left: "close", op: "gt", right: { type: "feature", feature: "vwap" } },
      { left: "rsi14", op: "gt", right: { type: "value", value: 55 } },
    ],
    bear: [],
    params: { stopAtrMult: 2, target1R: 1, target2R: 3 },
    baseConfidence: 62,
  };

  it("maps a flat v1 condition list to an AND setup group of compare blocks", () => {
    const v2 = migrateV1ToV2(v1);
    expect(v2.version).toBe(2);
    expect(v2.id).toBe("CUSTOM_legacy");
    expect(v2.direction).toBe("BOTH");
    expect(v2.bull.setup.logic).toBe("AND");
    expect(v2.bull.setup.blocks).toHaveLength(2);
    expect(v2.bull.setup.blocks[0]).toMatchObject({ type: "compare", left: "close", op: "gt" });
    expect(sideIsEmpty(v2.bear)).toBe(true);
    expect(v2.execution.stop).toEqual({ type: "atr", atrMult: 2 });
    expect(v2.execution.target2R).toBe(3);
    expect(CustomStrategySpecSchema.safeParse(v2).success).toBe(true);
  });

  it("parsePersistedSpec accepts native v2", () => {
    const v2 = migrateV1ToV2(v1);
    const round = parsePersistedSpec(v2);
    expect(round?.version).toBe(2);
    expect(round?.id).toBe("CUSTOM_legacy");
  });

  it("parsePersistedSpec migrates a persisted v1 blob", () => {
    const out = parsePersistedSpec(v1);
    expect(out?.version).toBe(2);
    expect(out?.bull.setup.blocks).toHaveLength(2);
  });

  it("parsePersistedSpec returns null on garbage (caller skips it)", () => {
    expect(parsePersistedSpec({ foo: "bar" })).toBeNull();
    expect(parsePersistedSpec(null)).toBeNull();
  });
});
