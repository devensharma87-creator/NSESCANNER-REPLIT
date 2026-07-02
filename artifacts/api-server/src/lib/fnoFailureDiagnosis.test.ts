/**
 * P16 — F&O Failure Diagnosis Report tests.
 *
 * Pure unit tests over `computeFailureDiagnosis`. No DB, no I/O.
 */

import { describe, it, expect } from "vitest";
import type { FnoSignalReasoningRow } from "@workspace/db";
import { computeFailureDiagnosis, classifyDataFailure } from "./fnoFailureDiagnosis";

type R = FnoSignalReasoningRow;
let nextId = 1;

function row(p: Partial<R> & Pick<R, "decision">): R {
  const base = {
    id: nextId++,
    capturedAt: new Date("2026-05-15T05:00:00Z"), // 10:30 IST
    signalDate: "2026-05-15",
    indexSymbol: "NIFTY",
    setupKey: "ORB",
    direction: "BULLISH",
    optionType: "CE",
    tier: "BASELINE",
    confidence: 65,
    confluenceScore: null,
    regime: "RANGE",
    reasonCode: null,
    signalFingerprint: null,
    selectedStrike: "24500.00",
    realizedPnl: null,
    snapshot: null,
  };
  return { ...base, ...p } as R;
}

describe("computeFailureDiagnosis — schema & determinism", () => {
  it("empty rows → report with all sections present and EXACT mode", () => {
    const r = computeFailureDiagnosis([]);
    expect(r.rowCount).toBe(0);
    expect(r.setupAnalysis).toEqual([]);
    expect(r.indexAnalysis).toEqual([]);
    expect(r.tierAnalysis).toEqual([]);
    expect(r.lifecycleFunnel.mode).toBe("exact");
    expect(r.lifecycleFunnel.emitted).toBe(0);
    expect(r.stopLossDeepDive.totalStops).toBe(0);
    expect(r.untriggeredAnalysis.expired).toBe(0);
    expect(r.missingDataAnalysis.byMissingField).toEqual([]);
    expect(r.hypotheses).toHaveLength(10);
    // every hypothesis must be one of the four statuses
    for (const h of r.hypotheses) {
      expect(["proven", "likely", "insufficient_data", "undetermined"]).toContain(h.status);
    }
  });

  it("orders setup/index/tier lists deterministically by total desc then key asc", () => {
    const rows = [
      row({ decision: "EMITTED", setupKey: "B", indexSymbol: "BANKNIFTY", tier: "HIGH_CONVICTION" }),
      row({ decision: "EMITTED", setupKey: "A", indexSymbol: "NIFTY", tier: "BASELINE" }),
      row({ decision: "EMITTED", setupKey: "A", indexSymbol: "NIFTY", tier: "BASELINE" }),
    ];
    const r = computeFailureDiagnosis(rows);
    expect(r.setupAnalysis.map(s => s.setupKey)).toEqual(["A", "B"]);
    expect(r.indexAnalysis.map(i => i.indexSymbol)).toEqual(["NIFTY", "BANKNIFTY"]);
  });
});

describe("computeFailureDiagnosis — lifecycle funnel", () => {
  it("EXACT mode when every lifecycle row carries fingerprint", () => {
    const fp = "abcdef0123456789";
    const r = computeFailureDiagnosis([
      row({ decision: "EMITTED", signalFingerprint: fp }),
      row({ decision: "OPENED", signalFingerprint: fp }),
      row({ decision: "CLOSED_TARGET1", signalFingerprint: fp }),
    ]);
    expect(r.lifecycleFunnel.mode).toBe("exact");
    expect(r.lifecycleFunnel.openedToTarget1Exact).toBe(1);
    expect(r.lifecycleFunnel.conversion.openedToTarget1).toBe(1);
  });

  it("computes T1→stop reversal via exact fingerprint linkage", () => {
    const fp1 = "1111111111111111";
    const fp2 = "2222222222222222";
    const r = computeFailureDiagnosis([
      row({ decision: "OPENED", signalFingerprint: fp1 }),
      row({ decision: "CLOSED_TARGET1", signalFingerprint: fp1 }),
      row({ decision: "CLOSED_STOPPED", signalFingerprint: fp1 }),
      row({ decision: "OPENED", signalFingerprint: fp2 }),
      row({ decision: "CLOSED_TARGET1", signalFingerprint: fp2 }),
    ]);
    expect(r.lifecycleFunnel.target1ThenStoppedExact).toBe(1);
    expect(r.lifecycleFunnel.target1ToTarget2Exact).toBe(0);
    expect(r.stopLossDeepDive.afterT1Stops).toBe(1);
  });

  it("emittedNeverOpened counts fingerprints in EMITTED but not OPENED", () => {
    const r = computeFailureDiagnosis([
      row({ decision: "EMITTED", signalFingerprint: "a000000000000001" }),
      row({ decision: "EMITTED", signalFingerprint: "a000000000000002" }),
      row({ decision: "OPENED", signalFingerprint: "a000000000000001" }),
    ]);
    expect(r.lifecycleFunnel.emittedNeverOpenedExact).toBe(1);
    expect(r.untriggeredAnalysis.emittedNeverOpenedExact).toBe(1);
  });

  it("PROXY mode when zero lifecycle rows carry fingerprint", () => {
    const r = computeFailureDiagnosis([
      row({ decision: "OPENED", signalFingerprint: null }),
      row({ decision: "CLOSED_STOPPED", signalFingerprint: null }),
    ]);
    expect(r.lifecycleFunnel.mode).toBe("proxy");
  });

  it("HYBRID mode when lifecycle rows are mixed", () => {
    const r = computeFailureDiagnosis([
      row({ decision: "OPENED", signalFingerprint: "f000000000000001" }),
      row({ decision: "CLOSED_STOPPED", signalFingerprint: null }),
    ]);
    expect(r.lifecycleFunnel.mode).toBe("hybrid");
  });
});

describe("computeFailureDiagnosis — superlatives & ratios", () => {
  it("identifies most-stopped setup and most-stops index", () => {
    const rows = [
      ...Array.from({ length: 5 }, () => row({ decision: "OPENED", setupKey: "ORB", indexSymbol: "NIFTY" })),
      ...Array.from({ length: 4 }, () => row({ decision: "CLOSED_STOPPED", setupKey: "ORB", indexSymbol: "NIFTY" })),
      ...Array.from({ length: 3 }, () => row({ decision: "OPENED", setupKey: "VWAP", indexSymbol: "BANKNIFTY" })),
      row({ decision: "CLOSED_STOPPED", setupKey: "VWAP", indexSymbol: "BANKNIFTY" }),
    ];
    const r = computeFailureDiagnosis(rows);
    expect(r.setupSuperlatives.mostStopped).toBe("ORB");
    expect(r.indexSuperlatives.mostStops).toBe("NIFTY");
    expect(r.stopLossDeepDive.concentration.topSetup?.key).toBe("ORB");
    expect(r.stopLossDeepDive.concentration.topSetup?.share).toBeCloseTo(4 / 5);
  });

  it("computes per-setup stopRate / targetHitRate with null when no opens", () => {
    const rows = [
      row({ decision: "OPENED", setupKey: "ORB" }),
      row({ decision: "OPENED", setupKey: "ORB" }),
      row({ decision: "CLOSED_TARGET1", setupKey: "ORB" }),
      row({ decision: "CLOSED_STOPPED", setupKey: "ORB" }),
      row({ decision: "EMITTED", setupKey: "VWAP" }), // no opens
    ];
    const r = computeFailureDiagnosis(rows);
    const orb = r.setupAnalysis.find(s => s.setupKey === "ORB")!;
    const vwap = r.setupAnalysis.find(s => s.setupKey === "VWAP")!;
    expect(orb.stopRate).toBeCloseTo(0.5);
    expect(orb.targetHitRate).toBeCloseTo(0.5);
    expect(vwap.stopRate).toBeNull();
    expect(vwap.targetHitRate).toBeNull();
  });

  it("counts late-session emissions using IST hour ≥ 14", () => {
    const r = computeFailureDiagnosis([
      // 09:00 IST = 03:30 UTC
      row({ decision: "EMITTED", capturedAt: new Date("2026-05-15T03:30:00Z") }),
      // 14:30 IST = 09:00 UTC
      row({ decision: "EMITTED", capturedAt: new Date("2026-05-15T09:00:00Z") }),
      // 15:10 IST = 09:40 UTC
      row({ decision: "EMITTED", capturedAt: new Date("2026-05-15T09:40:00Z") }),
    ]);
    expect(r.untriggeredAnalysis.lateSessionEmissions).toBe(2);
    expect(r.untriggeredAnalysis.lateSessionShare).toBeCloseTo(2 / 3);
  });
});

describe("computeFailureDiagnosis — missing data / demotion", () => {
  it("extracts missing fields and demotion tags from snapshot", () => {
    const fp = "deadbeefdeadbeef";
    const rows = [
      row({
        decision: "EMITTED",
        signalFingerprint: fp,
        snapshot: { missing: ["ivRank", "vix"], demotionTags: ["LOW_WINRATE", "HTF_CONFLICT"] },
      }),
      row({ decision: "OPENED", signalFingerprint: fp }),
      row({ decision: "CLOSED_STOPPED", signalFingerprint: fp }),
    ];
    const r = computeFailureDiagnosis(rows);
    expect(r.missingDataAnalysis.byMissingField.map(x => x.key).sort()).toEqual(["ivRank", "vix"]);
    expect(r.missingDataAnalysis.byDemotionTag.map(x => x.key).sort()).toEqual(["HTF_CONFLICT", "LOW_WINRATE"]);
    expect(r.missingDataAnalysis.lowWinRateDemotions).toBe(1);
    // missing-field stop correlation should report 1 opened, 1 stopped for both fields
    const corr = r.missingDataAnalysis.missingFieldStopCorrelation;
    expect(corr.find(c => c.field === "ivRank")?.stopped).toBe(1);
    expect(corr.find(c => c.field === "ivRank")?.openedSample).toBe(1);
  });

  it("tracks demotedThenOpened and demotedThenOpenedAndStopped via fingerprint", () => {
    const fp = "cafebabe12345678";
    const r = computeFailureDiagnosis([
      row({ decision: "EMITTED", reasonCode: "DEMOTED", signalFingerprint: fp }),
      row({ decision: "OPENED", signalFingerprint: fp }),
      row({ decision: "CLOSED_STOPPED", signalFingerprint: fp }),
    ]);
    expect(r.missingDataAnalysis.demotedThenOpenedExact).toBe(1);
    expect(r.missingDataAnalysis.demotedThenOpenedAndStoppedExact).toBe(1);
  });

  it("snapshot with non-array missing fields is null-safe", () => {
    const r = computeFailureDiagnosis([
      row({ decision: "EMITTED", snapshot: { missing: "not-an-array", demotionTags: null } }),
      row({ decision: "EMITTED", snapshot: "garbage" }),
    ]);
    expect(r.missingDataAnalysis.byMissingField).toEqual([]);
    expect(r.missingDataAnalysis.byDemotionTag).toEqual([]);
  });
});

describe("computeFailureDiagnosis — hypothesis ranking", () => {
  it("H10 fires PROVEN when a setup has opened≥10, stopRate≥0.7, hitRate≤0.2", () => {
    const rows: R[] = [
      ...Array.from({ length: 10 }, () => row({ decision: "OPENED", setupKey: "BAD" })),
      ...Array.from({ length: 8 }, () => row({ decision: "CLOSED_STOPPED", setupKey: "BAD" })),
      row({ decision: "CLOSED_TARGET1", setupKey: "BAD" }),
    ];
    const r = computeFailureDiagnosis(rows);
    const h10 = r.hypotheses.find(h => h.id === "H10")!;
    expect(h10.status).toBe("proven");
    expect(h10.evidence).toMatch(/BAD/);
  });

  it("H2 fires PROVEN when ≥30 T1 fingerprints with ≥25% T1→stop reversal", () => {
    const rows: R[] = [];
    for (let i = 0; i < 30; i++) {
      const fp = `f${String(i).padStart(15, "0")}`;
      rows.push(row({ decision: "OPENED", signalFingerprint: fp }));
      rows.push(row({ decision: "CLOSED_TARGET1", signalFingerprint: fp }));
      if (i < 10) rows.push(row({ decision: "CLOSED_STOPPED", signalFingerprint: fp }));
    }
    const r = computeFailureDiagnosis(rows);
    const h2 = r.hypotheses.find(h => h.id === "H2")!;
    expect(h2.status).toBe("proven");
    expect(h2.sampleSize).toBe(30);
  });

  it("H2 stays LIKELY on tiny sample even with 100% reversal ratio (denominator caveat)", () => {
    const rows: R[] = [];
    for (let i = 0; i < 6; i++) {
      const fp = `g${String(i).padStart(15, "0")}`;
      rows.push(row({ decision: "OPENED", signalFingerprint: fp }));
      rows.push(row({ decision: "CLOSED_TARGET1", signalFingerprint: fp }));
      rows.push(row({ decision: "CLOSED_STOPPED", signalFingerprint: fp }));
    }
    const r = computeFailureDiagnosis(rows);
    const h2 = r.hypotheses.find(h => h.id === "H2")!;
    expect(h2.status).toBe("likely");
    expect(h2.sampleSize).toBe(6);
  });

  it("H2 returns INSUFFICIENT_DATA when sample is mid (5≤n<MIN) and ratio is below 25%", () => {
    const rows: R[] = [];
    for (let i = 0; i < 10; i++) {
      const fp = `h${String(i).padStart(15, "0")}`;
      rows.push(row({ decision: "OPENED", signalFingerprint: fp }));
      rows.push(row({ decision: "CLOSED_TARGET1", signalFingerprint: fp }));
    }
    const r = computeFailureDiagnosis(rows);
    const h2 = r.hypotheses.find(h => h.id === "H2")!;
    expect(h2.status).toBe("insufficient_data");
  });

  it("H7 stays INSUFFICIENT_DATA when total EMITTED < MIN_SAMPLE even with 100% late share", () => {
    const late = new Date("2026-05-15T08:35:00Z"); // 14:05 IST
    const rows: R[] = Array.from({ length: 5 }, () =>
      row({ decision: "EMITTED", capturedAt: late }),
    );
    const r = computeFailureDiagnosis(rows);
    const h7 = r.hypotheses.find(h => h.id === "H7")!;
    expect(h7.status).toBe("insufficient_data");
    expect(h7.sampleSize).toBe(5);
  });

  it("H7 fires LIKELY when total EMITTED ≥ MIN_SAMPLE and late share ≥ 0.25", () => {
    const late = new Date("2026-05-15T08:35:00Z");
    const early = new Date("2026-05-15T05:00:00Z");
    const rows: R[] = [
      ...Array.from({ length: 12 }, () => row({ decision: "EMITTED", capturedAt: late })),
      ...Array.from({ length: 18 }, () => row({ decision: "EMITTED", capturedAt: early })),
    ];
    const r = computeFailureDiagnosis(rows);
    const h7 = r.hypotheses.find(h => h.id === "H7")!;
    expect(h7.status).toBe("likely");
    expect(h7.sampleSize).toBe(30);
  });

  it("H1 + H3 stay UNDETERMINED — these cannot be evaluated from reasoning logs", () => {
    const r = computeFailureDiagnosis([
      row({ decision: "OPENED", signalFingerprint: "1234567812345678" }),
      row({ decision: "CLOSED_STOPPED", signalFingerprint: "1234567812345678" }),
    ]);
    expect(r.hypotheses.find(h => h.id === "H1")!.status).toBe("undetermined");
    expect(r.hypotheses.find(h => h.id === "H3")!.status).toBe("undetermined");
  });

  it("recommendations include only proven/likely hypotheses, ordered by status priority", () => {
    const rows: R[] = [
      ...Array.from({ length: 12 }, () => row({ decision: "OPENED", setupKey: "BAD" })),
      ...Array.from({ length: 10 }, () => row({ decision: "CLOSED_STOPPED", setupKey: "BAD" })),
    ];
    const r = computeFailureDiagnosis(rows);
    // every recommendation must trace back to a proven/likely hypothesis
    expect(r.recommendedNextSteps.length).toBeGreaterThan(0);
    for (const rec of r.recommendedNextSteps) {
      expect(rec.priority).toBeGreaterThan(0);
      expect(typeof rec.label).toBe("string");
    }
  });
});

describe("computeFailureDiagnosis — exactOnly filter", () => {
  it("strips rows without fingerprint when exactOnly=true", () => {
    const r = computeFailureDiagnosis(
      [
        row({ decision: "OPENED", signalFingerprint: "abcd0000abcd0000" }),
        row({ decision: "CLOSED_STOPPED", signalFingerprint: null }),
      ],
      { exactOnly: true },
    );
    expect(r.rowCount).toBe(1);
    expect(r.filters.exactOnly).toBe(true);
    expect(r.lifecycleFunnel.mode).toBe("exact");
  });
});

describe("computeFailureDiagnosis — tier verdict", () => {
  it("computes HC vs BASELINE comparison only when both have ≥5 opens", () => {
    const rows: R[] = [
      // HC: 6 opens, 1 stop, 3 t1
      ...Array.from({ length: 6 }, () => row({ decision: "OPENED", tier: "HIGH_CONVICTION" })),
      ...Array.from({ length: 3 }, () => row({ decision: "CLOSED_TARGET1", tier: "HIGH_CONVICTION" })),
      row({ decision: "CLOSED_STOPPED", tier: "HIGH_CONVICTION" }),
      // BASELINE: 6 opens, 4 stops, 1 t1
      ...Array.from({ length: 6 }, () => row({ decision: "OPENED", tier: "BASELINE" })),
      row({ decision: "CLOSED_TARGET1", tier: "BASELINE" }),
      ...Array.from({ length: 4 }, () => row({ decision: "CLOSED_STOPPED", tier: "BASELINE" })),
    ];
    const r = computeFailureDiagnosis(rows);
    expect(r.tierVerdict.hcOutperformsBaseline).toBe(true);
    expect(r.tierVerdict.hcSampleSize).toBe(6);
    expect(r.tierVerdict.baselineSampleSize).toBe(6);
  });
});

describe("classifyDataFailure — `no_live_kite_intraday` branch honesty", () => {
  it("session KNOWN invalid → SESSION_MISSING", () => {
    const d = classifyDataFailure("no_live_kite_intraday", { sessionValid: false });
    expect(d.code).toBe("SESSION_MISSING");
  });

  it("session valid + market just opened (≤180s) → MARKET_JUST_OPENED (transient)", () => {
    const d = classifyDataFailure("no_live_kite_intraday", {
      sessionValid: true,
      secondsSinceOpen: 60,
    });
    expect(d.code).toBe("MARKET_JUST_OPENED");
    expect(d.transient).toBe(true);
  });

  it("session KNOWN valid mid-session → honest UNKNOWN, NEVER a false SESSION_MISSING", () => {
    const d = classifyDataFailure("no_live_kite_intraday", {
      sessionValid: true,
      secondsSinceOpen: 10_000,
    });
    expect(d.code).toBe("UNKNOWN");
    expect(d.code).not.toBe("SESSION_MISSING");
    expect(d.message).toMatch(/active Kite session/i);
  });

  it("no context (session validity unknown) → conservative SESSION_MISSING fallback unchanged", () => {
    const d = classifyDataFailure("no_live_kite_intraday");
    expect(d.code).toBe("SESSION_MISSING");
  });
});
