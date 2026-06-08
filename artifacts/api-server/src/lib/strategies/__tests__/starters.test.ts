import { describe, it, expect } from "vitest";
import { STARTER_SPECS, SMC_STARTER_SPECS } from "../starters";
import { CustomStrategySpecSchema, sideIsEmpty } from "../customSpec";

describe("starter strategies", () => {
  it("ships exactly 5 starters with unique CUSTOM_ ids", () => {
    expect(STARTER_SPECS).toHaveLength(5);
    const ids = STARTER_SPECS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^CUSTOM_[a-z0-9_]+$/);
  });

  it("every starter validates against the canonical v2 schema", () => {
    for (const spec of STARTER_SPECS) {
      const parsed = CustomStrategySpecSchema.safeParse(spec);
      expect(parsed.success, `${spec.id} should be valid`).toBe(true);
    }
  });

  it("every starter is v2 and defines at least one tradable side", () => {
    for (const spec of STARTER_SPECS) {
      expect(spec.version).toBe(2);
      expect(sideIsEmpty(spec.bull) && sideIsEmpty(spec.bear)).toBe(false);
    }
  });
});

describe("SMC starter strategies", () => {
  const ALL_BLOCK_TYPES = new Set<string>();
  for (const spec of SMC_STARTER_SPECS) {
    for (const sideRules of [spec.bull, spec.bear]) {
      for (const grp of [sideRules.market, sideRules.setup]) {
        for (const b of grp.blocks) ALL_BLOCK_TYPES.add(b.type);
      }
    }
  }

  it("ships SMC starters with unique CUSTOM_starter_smc_ ids, distinct from Phase-1 starters", () => {
    expect(SMC_STARTER_SPECS.length).toBeGreaterThanOrEqual(4);
    const ids = SMC_STARTER_SPECS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^CUSTOM_starter_smc_[a-z0-9_]+$/);
    // No id collision with the Phase-1 starters.
    const phase1 = new Set(STARTER_SPECS.map((s) => s.id));
    for (const id of ids) expect(phase1.has(id)).toBe(false);
  });

  it("every SMC starter validates against the canonical v2 schema", () => {
    for (const spec of SMC_STARTER_SPECS) {
      const parsed = CustomStrategySpecSchema.safeParse(spec);
      expect(parsed.success, `${spec.id} should be valid`).toBe(true);
    }
  });

  it("every SMC starter is v2 and defines at least one tradable side", () => {
    for (const spec of SMC_STARTER_SPECS) {
      expect(spec.version).toBe(2);
      expect(sideIsEmpty(spec.bull) && sideIsEmpty(spec.bear)).toBe(false);
    }
  });

  it("actually exercises the SMC block family", () => {
    for (const t of ["fvg", "bos", "choch", "liquidity_sweep", "order_block", "displacement"]) {
      expect(ALL_BLOCK_TYPES.has(t), `expected at least one SMC starter to use ${t}`).toBe(true);
    }
  });

  it("uses SMC-anchored stops where applicable (honest zone anchoring)", () => {
    const smcStopSpecs = SMC_STARTER_SPECS.filter((s) => s.execution.stop.type === "smc");
    expect(smcStopSpecs.length).toBeGreaterThanOrEqual(1);
    for (const s of smcStopSpecs) {
      const stop = s.execution.stop;
      if (stop.type === "smc") expect(["fvg", "order_block", "swing"]).toContain(stop.source);
    }
  });
});
