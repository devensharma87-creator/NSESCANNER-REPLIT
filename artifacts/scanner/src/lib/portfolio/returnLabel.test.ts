import { describe, it, expect } from "vitest";
import { returnLabel } from "./returnLabel";

describe("returnLabel", () => {
  it("labels a full XIRR when nothing was excluded", () => {
    const r = returnLabel({ approxXirr: 0.18, xirrExcluded: 0, holdingsCount: 5 });
    expect(r.kind).toBe("XIRR");
    expect(r.label).toBe("XIRR");
    expect(r.value).toBe(0.18);
  });

  it("labels a partial estimate when some holdings were excluded", () => {
    const r = returnLabel({ approxXirr: 0.12, xirrExcluded: 2, holdingsCount: 5 });
    expect(r.kind).toBe("ESTIMATE");
    expect(r.label).toBe("Annualised Return Estimate");
    expect(r.value).toBe(0.12);
    expect(r.tooltip).toContain("3 of 5");
  });

  it("labels unavailable when no XIRR was computed", () => {
    const r = returnLabel({ approxXirr: null, xirrExcluded: 5, holdingsCount: 5 });
    expect(r.kind).toBe("UNAVAILABLE");
    expect(r.label).toBe("XIRR unavailable");
    expect(r.value).toBeNull();
  });
});
