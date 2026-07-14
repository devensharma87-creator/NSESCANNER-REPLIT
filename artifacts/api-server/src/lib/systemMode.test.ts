import { describe, expect, it } from "vitest";
import { deriveSystemMode, combineWithOverride, isValidSystemMode, WS_DOWN_DEGRADE_MS } from "./systemMode";

const base = {
  sessionValid: true,
  feedConnected: true,
  feedDisconnectedForMs: 0,
  marketSession: "open" as const,
  dbLatencyMs: 20,
};

describe("deriveSystemMode (BUG-28)", () => {
  it("NORMAL when everything healthy", () => {
    const r = deriveSystemMode(base);
    expect(r.mode).toBe("NORMAL");
    expect(r.drivers).toEqual([]);
  });

  it("READ_ONLY when Kite session invalid", () => {
    const r = deriveSystemMode({ ...base, sessionValid: false });
    expect(r.mode).toBe("READ_ONLY");
    expect(r.drivers).toContain("KITE_SESSION_INVALID");
  });

  it("DEGRADED when WS down > 30s during market hours", () => {
    const r = deriveSystemMode({
      ...base,
      feedConnected: false,
      feedDisconnectedForMs: WS_DOWN_DEGRADE_MS + 1000,
    });
    expect(r.mode).toBe("DEGRADED");
  });

  it("stays NORMAL for a short WS blip (< 30s)", () => {
    const r = deriveSystemMode({ ...base, feedConnected: false, feedDisconnectedForMs: 5_000 });
    expect(r.mode).toBe("NORMAL");
  });

  it("WS down while market closed does not degrade", () => {
    const r = deriveSystemMode({
      ...base,
      marketSession: "closed",
      feedConnected: false,
      feedDisconnectedForMs: 120_000,
    });
    expect(r.mode).toBe("NORMAL");
  });

  it("DEGRADED on high DB latency", () => {
    const r = deriveSystemMode({ ...base, dbLatencyMs: 900 });
    expect(r.mode).toBe("DEGRADED");
    expect(r.drivers.some((d) => d.startsWith("DB_LATENCY"))).toBe(true);
  });

  it("DEGRADED when DB check failed (null latency)", () => {
    const r = deriveSystemMode({ ...base, dbLatencyMs: null });
    expect(r.mode).toBe("DEGRADED");
    expect(r.drivers).toContain("DB_HEALTH_CHECK_FAILED");
  });

  it("session invalid dominates DB degradation (READ_ONLY > DEGRADED)", () => {
    const r = deriveSystemMode({ ...base, sessionValid: false, dbLatencyMs: 900 });
    expect(r.mode).toBe("READ_ONLY");
  });
});

describe("combineWithOverride", () => {
  it("no override → derived", () => {
    expect(combineWithOverride("DEGRADED", null)).toBe("DEGRADED");
  });
  it("override escalates", () => {
    expect(combineWithOverride("NORMAL", "HALT")).toBe("HALT");
    expect(combineWithOverride("DEGRADED", "READ_ONLY")).toBe("READ_ONLY");
  });
  it("override can NEVER downgrade a derived problem", () => {
    expect(combineWithOverride("READ_ONLY", "NORMAL")).toBe("READ_ONLY");
    expect(combineWithOverride("DEGRADED", "NORMAL")).toBe("DEGRADED");
  });
});

describe("isValidSystemMode", () => {
  it("accepts the four modes only", () => {
    expect(isValidSystemMode("NORMAL")).toBe(true);
    expect(isValidSystemMode("HALT")).toBe(true);
    expect(isValidSystemMode("normal")).toBe(false);
    expect(isValidSystemMode("")).toBe(false);
    expect(isValidSystemMode(null)).toBe(false);
  });
});
