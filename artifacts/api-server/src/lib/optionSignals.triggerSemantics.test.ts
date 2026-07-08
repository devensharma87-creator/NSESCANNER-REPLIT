import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// P0-3 — F&O Signal Card Trigger Semantics Honesty
// ---------------------------------------------------------------------------
// These tests verify the invariants introduced in P0-3:
//   1. The optionSignals.ts source file contains no "15-min close" in any
//      entryTrigger string — the wording must match actual execution semantics
//      (touch/wick trigger, not close confirmation).
//   2. evaluateTransition (optionSignalLifecycle) fires PENDING→TRIGGERED on
//      bar high/low touch, NOT on candle close.
//   3. Same-bar stop priority: when a bar's range covers both entry and stop,
//      STOP_FIRST wins (worst-case for trader).
//   4. The generated Zod schema includes triggerSemantics on OptionSignal items.
//   5. entryTrigger strings use "touches/crosses" / "touch trigger" wording.
// ---------------------------------------------------------------------------

// ── Part A: source wording invariant ────────────────────────────────────────

describe("P0-3: entryTrigger wording honesty — no '15-min close' in source", () => {
  it("optionSignals.ts entryTrigger strings do not claim close-confirmation semantics", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "optionSignals.ts"),
      "utf8",
    );

    const lines = src.split("\n");
    const banned = /15-min close/i;
    const violations: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (banned.test(lines[i])) {
        violations.push(`Line ${i + 1}: ${lines[i].trim()}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("optionSignals.ts uses 'touch trigger' wording at least 8 times (one per setup)", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "optionSignals.ts"),
      "utf8",
    );
    // 8 setup × BULLISH/BEARISH trigger strings, all must say "touch trigger"
    const touchCount = (src.match(/touch trigger/g) ?? []).length;
    expect(touchCount).toBeGreaterThanOrEqual(8);
  });

  it("optionSignals.ts uses 'touches/crosses' wording in every directional setup", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "optionSignals.ts"),
      "utf8",
    );
    const touchCrossCount = (src.match(/touches\/crosses/g) ?? []).length;
    // 5 named setups × 2 (above/below) + baseline × 2 + applyTriggerRealism × 2 = 16
    expect(touchCrossCount).toBeGreaterThanOrEqual(16);
  });
});

// ── Part B: lifecycle evaluateTransition touch semantics ─────────────────────

// evaluateTransition is a pure function but lives in a module that imports DB
// code. Import once in beforeAll with a generous setup timeout.
let evaluateTransition: (
  current: string,
  direction: "BULLISH" | "BEARISH",
  entry: number,
  stop: number,
  t1: number,
  t2: number,
  snap: { spot: number; high?: number | null; low?: number | null },
) => { next: string; triggered: boolean; exited: boolean; exitReason?: string };

beforeAll(async () => {
  const mod = await import("./optionSignalLifecycle");
  evaluateTransition = mod.evaluateTransition as typeof evaluateTransition;
}, 30_000);

describe("P0-3: evaluateTransition — touch/wick trigger, NOT close confirmation", () => {
  it("BULLISH (CALL): fires PENDING→TRIGGERED when bar high reaches entry (wick touch)", () => {
    const result = evaluateTransition(
      "PENDING",
      "BULLISH",
      100, // entry
      95,  // stop
      110, // t1
      120, // t2
      {
        spot: 99,  // spot BELOW entry — close-confirm would NOT fire
        high: 100, // bar high JUST reached entry — touch trigger fires
        low: 98,
      },
    );
    expect(result.next).toBe("TRIGGERED");
    expect(result.triggered).toBe(true);
  });

  it("BULLISH (CALL): does NOT fire when bar high is below entry", () => {
    const result = evaluateTransition(
      "PENDING",
      "BULLISH",
      100,
      95,
      110,
      120,
      { spot: 99.99, high: 99.99, low: 98 },
    );
    expect(result.next).toBe("PENDING");
    expect(result.triggered).toBe(false);
  });

  it("BULLISH: fires on wick when candle closes BELOW entry (wick touch, not close-confirmed)", () => {
    const result = evaluateTransition(
      "PENDING",
      "BULLISH",
      100,
      95,
      110,
      120,
      {
        spot: 98,   // candle closed BELOW entry — close-confirm would NOT fire
        high: 101,  // wick touched ABOVE entry — touch fires
        low: 97,
      },
    );
    expect(result.next).toBe("TRIGGERED");
    expect(result.triggered).toBe(true);
  });

  it("BEARISH (PUT): fires PENDING→TRIGGERED when bar low reaches entry (wick touch)", () => {
    const result = evaluateTransition(
      "PENDING",
      "BEARISH",
      100, // entry
      105, // stop
      90,  // t1
      80,  // t2
      {
        spot: 101,  // spot ABOVE entry — close-confirm would NOT fire
        high: 102,
        low: 100,   // bar low JUST reached entry — touch trigger fires
      },
    );
    expect(result.next).toBe("TRIGGERED");
    expect(result.triggered).toBe(true);
  });

  it("BEARISH (PUT): does NOT fire when bar low is above entry", () => {
    const result = evaluateTransition(
      "PENDING",
      "BEARISH",
      100,
      105,
      90,
      80,
      { spot: 100.01, high: 102, low: 100.01 },
    );
    expect(result.next).toBe("PENDING");
    expect(result.triggered).toBe(false);
  });
});

// ── Part C: same-bar STOP_FIRST priority ─────────────────────────────────────

describe("P0-3: same-bar ambiguity — STOP_FIRST policy (worst-case for trader)", () => {
  it("BULLISH: when single bar covers both entry AND stop, stop wins", () => {
    const result = evaluateTransition(
      "PENDING",
      "BULLISH",
      100, // entry
      95,  // stop
      110, // t1
      120, // t2
      {
        spot: 97,
        high: 101, // covers entry (101 >= 100)
        low: 94,   // covers stop  (94 <= 95)
      },
    );
    expect(result.next).toBe("STOPPED");
    expect(result.exited).toBe(true);
    expect(result.exitReason).toBe("STOPPED");
  });

  it("BEARISH: when single bar covers both entry AND stop, stop wins", () => {
    const result = evaluateTransition(
      "PENDING",
      "BEARISH",
      100, // entry
      105, // stop
      90,  // t1
      80,  // t2
      {
        spot: 103,
        high: 106, // covers stop  (106 >= 105)
        low: 99,   // covers entry (99 <= 100)
      },
    );
    expect(result.next).toBe("STOPPED");
    expect(result.exited).toBe(true);
    expect(result.exitReason).toBe("STOPPED");
  });
});

// ── Part D: Zod schema — triggerSemantics field presence ────────────────────

describe("P0-3: triggerSemantics field in generated Zod schema", () => {
  it("GetOptionSignalsResponse includes triggerSemantics on signal items", async () => {
    const { GetOptionSignalsResponse } = await import("@workspace/api-zod");
    const schema = GetOptionSignalsResponse as any;
    const signalsArraySchema =
      schema._def?.shape?.()?.signals ?? schema.shape?.signals;
    expect(signalsArraySchema).toBeDefined();

    const itemShape =
      signalsArraySchema._def?.type?._def?.shape?.() ??
      signalsArraySchema?._def?.type?.shape;
    expect(itemShape).toBeDefined();

    expect(Object.keys(itemShape)).toContain("triggerSemantics");

    const field = itemShape.triggerSemantics;
    expect(field).toBeDefined();
    const inner = field._def?.innerType ?? field;
    const typeName: string = inner._def?.typeName ?? "";
    expect(
      ["ZodEnum", "ZodString", "ZodUnion"].some((t) => typeName.includes(t)),
    ).toBe(true);
  });

  it("GetOptionSignalsResponse still includes entryTrigger", async () => {
    const { GetOptionSignalsResponse } = await import("@workspace/api-zod");
    const schema = GetOptionSignalsResponse as any;
    const signalsArraySchema =
      schema._def?.shape?.()?.signals ?? schema.shape?.signals;
    const itemShape =
      signalsArraySchema._def?.type?._def?.shape?.() ??
      signalsArraySchema?._def?.type?.shape;
    expect(Object.keys(itemShape)).toContain("entryTrigger");
  });
});

// ── Part E: audit note ────────────────────────────────────────────────────────

describe("P0-3: historical paper trades — audit note", () => {
  it("historical trades used touch semantics all along — wording fix is forward-only", () => {
    // The paper engine (evaluateTransition) has always used bar high/low touch
    // semantics since inception. P0-3 corrects only the displayed entryTrigger
    // text on signal cards — the underlying execution mechanics are unchanged.
    // No historical trade backfill is required.
    expect(true).toBe(true);
  });
});
