import { describe, it, expect } from "vitest";
import { VERIFICATION_STATUS } from "./verificationStatus";
import { gateStateToSeverity } from "@/lib/infraHealth";

describe("VERIFICATION_STATUS config", () => {
  it("has unique ids", () => {
    const ids = VERIFICATION_STATUS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("records the agreed human sign-off states", () => {
    const byId = Object.fromEntries(VERIFICATION_STATUS.map((e) => [e.id, e]));
    expect(byId.S2b?.state).toBe("verified");
    expect(byId.S3b?.state).toBe("verified");
    expect(byId.H10b?.state).toBe("partial");
    expect(byId.H10d?.state).toBe("pending");
    for (const id of ["S4c", "S4d", "S4e", "S4f"]) {
      expect(byId[id]?.state).toBe("not_approved");
    }
  });

  it("does NOT list the live P25 gate (it is derived live, never static)", () => {
    const ids = VERIFICATION_STATUS.map((e) => e.id.toUpperCase());
    expect(ids).not.toContain("P25");
  });

  it("every entry maps to a renderable severity", () => {
    for (const e of VERIFICATION_STATUS) {
      expect(["ok", "warn", "disabled", "stale", "fail"]).toContain(gateStateToSeverity(e.state));
    }
  });
});
