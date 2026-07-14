import { describe, it, expect } from "vitest";
import { deriveCandleDominant } from "../swingScannerStore";

describe("deriveCandleDominant", () => {
  it("kite only → kite", () => {
    expect(deriveCandleDominant({ kite: 480, yahoo: 0 })).toBe("kite");
  });
  it("yahoo only → yahoo", () => {
    expect(deriveCandleDominant({ kite: 0, yahoo: 470 })).toBe("yahoo");
  });
  it("both present → mixed", () => {
    expect(deriveCandleDominant({ kite: 300, yahoo: 180 })).toBe("mixed");
  });
  it("neither → none (never fabricated)", () => {
    expect(deriveCandleDominant({ kite: 0, yahoo: 0 })).toBe("none");
  });
});
