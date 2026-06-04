import { describe, expect, it } from "vitest";
import {
  buildClosedExplanation,
  deriveDivergence,
  deriveFoTargetStatus,
  derivePremiumTargetStatus,
  deriveSpotTargetStatus,
  directionSign,
} from "./targetStatus";

describe("directionSign", () => {
  it("maps BULLISH/BEARISH and rejects others", () => {
    expect(directionSign("BULLISH")).toBe(1);
    expect(directionSign("bearish")).toBe(-1);
    expect(directionSign("")).toBeNull();
    expect(directionSign(null)).toBeNull();
    expect(directionSign("LONG")).toBeNull();
  });
});

describe("deriveSpotTargetStatus", () => {
  it("uses MFE to mark a touched bullish target and a not-touched higher one", () => {
    const s = deriveSpotTargetStatus(
      {
        spotEntry: 22000,
        spotTarget1: 22100,
        spotTarget2: 22300,
        maxFavorableExcursionPts: 150,
        status: "TARGET1_HIT",
      },
      "BULLISH",
    );
    expect(s.available).toBe(true);
    expect(s.peakSpot).toBe(22150);
    expect(s.peakSource).toBe("mfe");
    expect(s.target1).toBe("touched");
    expect(s.target2).toBe("not_touched");
    expect(s.signalStatus).toBe("TARGET1_HIT");
  });

  it("is direction-aware for BEARISH (targets below entry)", () => {
    const s = deriveSpotTargetStatus(
      {
        spotEntry: 22000,
        spotTarget1: 21900,
        spotTarget2: 21700,
        maxFavorableExcursionPts: 120,
      },
      "BEARISH",
    );
    expect(s.peakSpot).toBe(21880);
    expect(s.target1).toBe("touched");
    expect(s.target2).toBe("not_touched");
  });

  it("falls back to lastSpot but returns unknown when it falls short (could have retraced)", () => {
    const s = deriveSpotTargetStatus(
      { spotEntry: 22000, spotTarget1: 22100, lastSpot: 22050 },
      "BULLISH",
    );
    expect(s.peakSource).toBe("last_spot");
    // last spot did not reach T1 — but it may have touched and retraced → unknown
    expect(s.target1).toBe("unknown");
  });

  it("marks touched via lastSpot when it has reached the target", () => {
    const s = deriveSpotTargetStatus(
      { spotEntry: 22000, spotTarget1: 22100, lastSpot: 22150 },
      "BULLISH",
    );
    expect(s.target1).toBe("touched");
  });

  it("is unavailable without direction or entry", () => {
    expect(deriveSpotTargetStatus({ spotEntry: 22000 }, null).available).toBe(false);
    expect(deriveSpotTargetStatus(null, "BULLISH").available).toBe(false);
  });
});

describe("derivePremiumTargetStatus", () => {
  const base = {
    entryPremium: 100,
    target1Premium: 120,
    target2Premium: 150,
    stopPremium: 90,
    lots: 1,
    lotSize: 50,
  };

  it("computes peak premium from maxRunup and marks targets", () => {
    const p = derivePremiumTargetStatus({
      ...base,
      maxRunup: 50 * 25, // ₹1250 over 50 qty → +25 premium → peak 125
      maxDrawdown: 0,
      lastPremium: 110,
    });
    expect(p.peakPremium).toBe(125);
    expect(p.target1).toBe("touched");
    expect(p.target2).toBe("not_touched");
    expect(p.stop).toBe("not_touched");
  });

  it("treats the final/exit premium as a floor on the peak", () => {
    const p = derivePremiumTargetStatus({
      ...base,
      exitPremium: 155, // exit above T2, no MFE recorded
    });
    expect(p.peakPremium).toBe(155);
    expect(p.target1).toBe("touched");
    expect(p.target2).toBe("touched");
    expect(p.finalPremium).toBe(155);
  });

  it("marks stop touched when exitReason is STOPPED even without trough data", () => {
    const p = derivePremiumTargetStatus({
      entryPremium: 100,
      stopPremium: 90,
      exitReason: "STOPPED",
    });
    expect(p.stop).toBe("touched");
  });

  it("computes giveback in points and rupees", () => {
    const p = derivePremiumTargetStatus({
      ...base,
      maxRunup: 40 * 50, // +40 premium → peak 140
      exitPremium: 120,
    });
    expect(p.peakPremium).toBe(140);
    expect(p.givebackPremium).toBe(20);
    expect(p.givebackValue).toBe(20 * 50);
  });

  it("is unavailable without a finite entry premium", () => {
    const p = derivePremiumTargetStatus({ entryPremium: null });
    expect(p.available).toBe(false);
    expect(p.peakPremium).toBeNull();
  });
});

describe("deriveDivergence", () => {
  it("flags spot_ahead when spot reached a higher target than premium", () => {
    const d = deriveDivergence(
      { target1: "touched", target2: "touched" } as never,
      { target1: "touched", target2: "not_touched" } as never,
    );
    expect(d.kind).toBe("spot_ahead");
    expect(d.warn).toBe(true);
    expect(d.message).toMatch(/premium lagged/i);
  });

  it("flags premium_ahead the other way", () => {
    const d = deriveDivergence(
      { target1: "touched", target2: "not_touched" } as never,
      { target1: "touched", target2: "touched" } as never,
    );
    expect(d.kind).toBe("premium_ahead");
    expect(d.warn).toBe(true);
  });

  it("returns none when both reached the same target", () => {
    const d = deriveDivergence(
      { target1: "touched", target2: "not_touched" } as never,
      { target1: "touched", target2: "not_touched" } as never,
    );
    expect(d.kind).toBe("none");
    expect(d.warn).toBe(false);
  });

  it("returns unknown when either side is undetermined", () => {
    const d = deriveDivergence(
      { target1: "unknown", target2: "unknown" } as never,
      { target1: "touched", target2: "not_touched" } as never,
    );
    expect(d.kind).toBe("unknown");
    expect(d.warn).toBe(false);
  });
});

describe("buildClosedExplanation", () => {
  it("states the exit and the unrealised-peak observation when not booked at target", () => {
    const status = deriveFoTargetStatus({
      direction: "BULLISH",
      entryPremium: 100,
      target1Premium: 120,
      target2Premium: 150,
      stopPremium: 90,
      lots: 1,
      lotSize: 50,
      maxRunup: 30 * 50, // peak 130 → reached T1
      exitPremium: 95,
      exitReason: "STOPPED",
      spot: {
        spotEntry: 22000,
        spotTarget1: 22100,
        spotTarget2: 22300,
        maxFavorableExcursionPts: 150,
      },
    });
    const lines = buildClosedExplanation({ exitReason: "STOPPED", status });
    expect(lines[0]).toMatch(/stopped out/i);
    expect(lines.some((l) => /Peak option premium reached 130/.test(l))).toBe(true);
    expect(lines.some((l) => /gave back/i.test(l))).toBe(true);
  });

  it("does not add a peak observation when the trade was booked at its target", () => {
    const status = deriveFoTargetStatus({
      direction: "BULLISH",
      entryPremium: 100,
      target1Premium: 120,
      lots: 1,
      lotSize: 50,
      exitPremium: 120,
      exitReason: "TARGET1_HIT",
    });
    const lines = buildClosedExplanation({ exitReason: "TARGET1_HIT", status });
    expect(lines[0]).toMatch(/exited at Target 1/i);
    expect(lines.some((l) => /Peak option premium/.test(l))).toBe(false);
  });

  it("returns an empty array when there is no recognised reason and nothing factual", () => {
    const status = deriveFoTargetStatus({ entryPremium: null });
    expect(buildClosedExplanation({ exitReason: null, status })).toEqual([]);
  });
});
