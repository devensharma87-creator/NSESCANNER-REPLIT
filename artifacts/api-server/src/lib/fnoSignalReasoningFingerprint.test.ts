/**
 * P15b — signal_fingerprint correlation-ID tests.
 *
 * Pure-function tests on `computeSignalFingerprint` and the auto-derive
 * branch inside `buildReasoningRow`. These prove:
 *
 *   - same lifecycle (EMITTED/OPENED/CLOSED_*) of the same signal share an ID,
 *   - different signals (any of the 6 fields differs) produce different IDs,
 *   - missing identity fields → null (no crash, no fake ID),
 *   - operator-supplied valid-shape fingerprint is honoured verbatim,
 *   - the fingerprint input set is restricted to whitelisted fields (no
 *     token / secret / session / premium / timestamp / PII),
 *   - normalisation is case + whitespace + strike-precision tolerant,
 *   - the SHA-256(hex)[:16] shape is stable.
 */
import { describe, it, expect } from "vitest";
import {
  buildReasoningRow,
  computeSignalFingerprint,
  FINGERPRINT_INPUT_FIELDS,
  type FnoReasoningPayload,
} from "./fnoSignalReasoningLogger";

const FULL = {
  signalDate: "2026-05-15",
  indexSymbol: "NIFTY",
  setupKey: "TREND_CONTINUATION",
  direction: "BULLISH",
  optionType: "CE",
  selectedStrike: 24500,
} as const;

describe("computeSignalFingerprint — shape and determinism", () => {
  it("returns a 16-char lowercase hex string when all 6 fields are present", () => {
    const fp = computeSignalFingerprint(FULL);
    expect(fp).not.toBeNull();
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is deterministic — identical inputs always yield the same hash", () => {
    expect(computeSignalFingerprint(FULL)).toBe(computeSignalFingerprint(FULL));
  });

  it("normalises case and whitespace on identity-ish fields", () => {
    const a = computeSignalFingerprint(FULL);
    const b = computeSignalFingerprint({
      ...FULL,
      indexSymbol: "  nifty  ",
      setupKey: "trend_continuation",
      direction: "bullish",
      optionType: "ce",
    });
    expect(a).toBe(b);
  });

  it("normalises strike precision (24500 == 24500.00 == 24500.001)", () => {
    expect(computeSignalFingerprint({ ...FULL, selectedStrike: 24500 }))
      .toBe(computeSignalFingerprint({ ...FULL, selectedStrike: 24500.0 }));
    expect(computeSignalFingerprint({ ...FULL, selectedStrike: 24500.001 }))
      .toBe(computeSignalFingerprint({ ...FULL, selectedStrike: 24500 }));
  });
});

describe("computeSignalFingerprint — same-signal lifecycle sharing", () => {
  it("EMITTED / OPENED / TARGET1 / STOPPED of the same trade share one ID", () => {
    // Lifecycle stages don't change identity fields; only `decision` changes.
    // Fingerprint is derived from identity, so all four must collide.
    const fp = computeSignalFingerprint(FULL);
    const stages = ["EMITTED", "OPENED", "CLOSED_TARGET1", "CLOSED_STOPPED"] as const;
    for (const _ of stages) {
      expect(computeSignalFingerprint(FULL)).toBe(fp);
    }
  });
});

describe("computeSignalFingerprint — collision separation", () => {
  it("different signalDate → different fingerprint", () => {
    expect(computeSignalFingerprint({ ...FULL, signalDate: "2026-05-16" }))
      .not.toBe(computeSignalFingerprint(FULL));
  });
  it("different indexSymbol → different fingerprint", () => {
    expect(computeSignalFingerprint({ ...FULL, indexSymbol: "BANKNIFTY" }))
      .not.toBe(computeSignalFingerprint(FULL));
  });
  it("different setupKey → different fingerprint", () => {
    expect(computeSignalFingerprint({ ...FULL, setupKey: "VWAP_RECLAIM" }))
      .not.toBe(computeSignalFingerprint(FULL));
  });
  it("different direction → different fingerprint", () => {
    expect(computeSignalFingerprint({ ...FULL, direction: "BEARISH" }))
      .not.toBe(computeSignalFingerprint(FULL));
  });
  it("different optionType → different fingerprint", () => {
    expect(computeSignalFingerprint({ ...FULL, optionType: "PE" }))
      .not.toBe(computeSignalFingerprint(FULL));
  });
  it("different strike → different fingerprint", () => {
    expect(computeSignalFingerprint({ ...FULL, selectedStrike: 24600 }))
      .not.toBe(computeSignalFingerprint(FULL));
  });
});

describe("computeSignalFingerprint — null-safe / partial inputs", () => {
  it("returns null when signalDate is missing", () => {
    expect(computeSignalFingerprint({ ...FULL, signalDate: null })).toBeNull();
  });
  it("returns null when indexSymbol is missing", () => {
    expect(computeSignalFingerprint({ ...FULL, indexSymbol: null })).toBeNull();
  });
  it("returns null when setupKey is missing (SKIPPED / PRE_EMISSION_REJECTED case)", () => {
    expect(computeSignalFingerprint({ ...FULL, setupKey: null })).toBeNull();
  });
  it("returns null when optionType is missing (no-leg case)", () => {
    expect(computeSignalFingerprint({ ...FULL, optionType: null })).toBeNull();
  });
  it("returns null when selectedStrike is missing or non-finite", () => {
    expect(computeSignalFingerprint({ ...FULL, selectedStrike: null })).toBeNull();
    expect(computeSignalFingerprint({ ...FULL, selectedStrike: NaN })).toBeNull();
    expect(computeSignalFingerprint({ ...FULL, selectedStrike: Infinity })).toBeNull();
  });
});

describe("buildReasoningRow — auto-derive branch", () => {
  it("auto-derives fingerprint from payload when not supplied", () => {
    const payload: FnoReasoningPayload = {
      decision: "EMITTED",
      signalDate: FULL.signalDate,
      indexSymbol: FULL.indexSymbol,
      setupKey: FULL.setupKey,
      direction: FULL.direction,
      optionType: FULL.optionType,
      selectedStrike: FULL.selectedStrike,
    };
    const row = buildReasoningRow(payload);
    expect(row.signalFingerprint).toBe(computeSignalFingerprint(FULL));
  });

  it("auto-derived fingerprint matches across EMITTED / OPENED / CLOSED_STOPPED rows", () => {
    const common = {
      signalDate: FULL.signalDate,
      indexSymbol: FULL.indexSymbol,
      setupKey: FULL.setupKey,
      direction: FULL.direction,
      optionType: FULL.optionType,
      selectedStrike: FULL.selectedStrike,
    };
    const emitted = buildReasoningRow({ decision: "EMITTED", ...common });
    const opened = buildReasoningRow({ decision: "OPENED", ...common });
    const stopped = buildReasoningRow({ decision: "CLOSED_STOPPED", ...common });
    expect(emitted.signalFingerprint).not.toBeNull();
    expect(emitted.signalFingerprint).toBe(opened.signalFingerprint);
    expect(emitted.signalFingerprint).toBe(stopped.signalFingerprint);
  });

  it("auto-derive yields null when fields are missing (SKIPPED / PRE_EMISSION_REJECTED)", () => {
    const skipped = buildReasoningRow({
      decision: "SKIPPED",
      signalDate: FULL.signalDate,
      indexSymbol: FULL.indexSymbol,
      setupKey: FULL.setupKey,
      direction: FULL.direction,
      // no optionType / no strike — gate-rejection before leg picked
    });
    expect(skipped.signalFingerprint).toBeNull();
  });

  it("trusts operator-supplied fingerprint of valid shape", () => {
    const supplied = "0123456789abcdef";
    const row = buildReasoningRow({
      decision: "EMITTED",
      signalDate: FULL.signalDate,
      indexSymbol: FULL.indexSymbol,
      signalFingerprint: supplied,
    });
    expect(row.signalFingerprint).toBe(supplied);
  });

  it("rejects malformed operator-supplied fingerprint and falls back to auto-derive (null when insufficient)", () => {
    const row = buildReasoningRow({
      decision: "EMITTED",
      signalDate: FULL.signalDate,
      indexSymbol: FULL.indexSymbol,
      signalFingerprint: "NOT-A-HEX-STRING!" as unknown as string,
    });
    // Bad-shape input rejected → auto-derive runs → null because missing setupKey/direction/optionType/strike.
    expect(row.signalFingerprint).toBeNull();
  });
});

describe("security — fingerprint input whitelist", () => {
  it("FINGERPRINT_INPUT_FIELDS is the exact 6-tuple from the design and contains no secret-shaped keys", () => {
    expect(FINGERPRINT_INPUT_FIELDS).toEqual([
      "signalDate", "indexSymbol", "setupKey", "direction", "optionType", "selectedStrike",
    ]);
    const secretRe = /(token|secret|password|cookie|session|auth|bearer|api[_-]?key|access[_-]?key|premium|pnl|user|email|ip)/i;
    for (const f of FINGERPRINT_INPUT_FIELDS) {
      expect(f).not.toMatch(secretRe);
    }
  });
});
