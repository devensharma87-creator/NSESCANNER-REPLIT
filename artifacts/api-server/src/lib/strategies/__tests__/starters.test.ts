import { describe, it, expect } from "vitest";
import { STARTER_SPECS } from "../starters";
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
