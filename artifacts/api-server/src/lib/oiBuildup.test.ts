/**
 * OI buildup classifier — pure-function tests.
 *
 * Locks in the full price×OI matrix, epsilon flat-zone handling, the
 * DATA_UNAVAILABLE path for null/NaN inputs, and determinism.
 *
 * REPORTING ONLY — no trading-decision path consumes this module.
 */
import { describe, expect, it } from "vitest";

import { classifyOiBuildup } from "./oiBuildup";

describe("classifyOiBuildup matrix", () => {
  it("price up + OI up → long buildup (bullish)", () => {
    const r = classifyOiBuildup(1.2, 5);
    expect(r.classification).toBe("LONG_BUILDUP");
    expect(r.bias).toBe("BULLISH");
  });

  it("price down + OI up → short buildup (bearish)", () => {
    const r = classifyOiBuildup(-1.2, 5);
    expect(r.classification).toBe("SHORT_BUILDUP");
    expect(r.bias).toBe("BEARISH");
  });

  it("price up + OI down → short covering (bullish)", () => {
    const r = classifyOiBuildup(1.2, -5);
    expect(r.classification).toBe("SHORT_COVERING");
    expect(r.bias).toBe("BULLISH");
  });

  it("price down + OI down → long unwinding (bearish)", () => {
    const r = classifyOiBuildup(-1.2, -5);
    expect(r.classification).toBe("LONG_UNWINDING");
    expect(r.bias).toBe("BEARISH");
  });
});

describe("flat / epsilon zone", () => {
  it("tiny price move → neutral", () => {
    expect(classifyOiBuildup(0.01, 5).classification).toBe("NEUTRAL");
  });
  it("tiny OI move → neutral", () => {
    expect(classifyOiBuildup(1.2, 0.1).classification).toBe("NEUTRAL");
  });
  it("both flat → neutral", () => {
    expect(classifyOiBuildup(0, 0).classification).toBe("NEUTRAL");
  });
  it("custom epsilons respected", () => {
    // 0.3% price treated as flat when priceEps raised to 0.5
    expect(classifyOiBuildup(0.3, 5, { priceEpsPct: 0.5 }).classification).toBe("NEUTRAL");
    // ...but decisive at default eps
    expect(classifyOiBuildup(0.3, 5).classification).toBe("LONG_BUILDUP");
  });
});

describe("data-unavailable path", () => {
  it("null price → DATA_UNAVAILABLE", () => {
    const r = classifyOiBuildup(null, 5);
    expect(r.classification).toBe("DATA_UNAVAILABLE");
    expect(r.bias).toBe("UNKNOWN");
  });
  it("null OI → DATA_UNAVAILABLE", () => {
    expect(classifyOiBuildup(1.2, null).classification).toBe("DATA_UNAVAILABLE");
  });
  it("undefined inputs → DATA_UNAVAILABLE", () => {
    expect(classifyOiBuildup(undefined, undefined).classification).toBe("DATA_UNAVAILABLE");
  });
  it("NaN inputs → DATA_UNAVAILABLE", () => {
    expect(classifyOiBuildup(NaN, 5).classification).toBe("DATA_UNAVAILABLE");
    expect(classifyOiBuildup(1.2, NaN).classification).toBe("DATA_UNAVAILABLE");
  });
});

describe("determinism", () => {
  it("identical inputs → identical output", () => {
    expect(classifyOiBuildup(1.2, 5)).toEqual(classifyOiBuildup(1.2, 5));
  });
});
