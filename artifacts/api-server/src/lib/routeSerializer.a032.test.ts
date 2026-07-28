/**
 * Phase A0.3.2 — §11 Route Serializer Tests: all six /options/signals response states.
 *
 * Calls the ACTUAL production Zod schema (`GetOptionSignalsResponse.parse(...)`)
 * with inputs matching the six structural states the scanner route can produce.
 * This proves the serializer accepts valid inputs and rejects invalid ones.
 *
 * Route under test: artifacts/api-server/src/routes/scanner.ts lines 221–265.
 * Schema under test: GetOptionSignalsResponse from lib/api-zod/src/generated/api.ts.
 *
 * Required signal fields (from Zod schema): index, indexName, spot, bias, confidence.
 * diagnostics field is .optional() (NOT nullable — passing null fails).
 *
 * Six response states:
 *   State 1 — Signal-present, market open (normal cycle with live setups)
 *   State 2 — No signal, market open (cycle ran, no high-conviction setup)
 *   State 3 — Market closed (after-hours)
 *   State 4 — Full diagnostics present (gates fired, suppressed signals)
 *   State 5 — No diagnostics (field absent — pre-warmup or data-blocked)
 *   State 6 — Degraded/stale (empty signals, noSetupReason set)
 *
 * Validator rejection proof (R1–R9):
 *   R1 — Empty availability array [] (length 0 violates .length(9))
 *   R2 — 3-record single-index payload (old A0.3.1 design)
 *   R3 — Duplicate composite key documented (domain-enforced uniqueness)
 *   R4 — Missing an index/setup combination (8 records)
 *   R5 — Invalid status enum
 *   R6 — reasonCode validation (domain-enforced vs Zod structural)
 *   R7 — eligibleForEmission: true
 *   R8 — Missing indexSymbol field
 *   R9 — Invalid indexSymbol value
 */

import { describe, it, expect } from "vitest";
import { GetOptionSignalsResponse } from "@workspace/api-zod";
import {
  computeAllIndexFnoSetupAvailability,
  computeIndexFnoSetupAvailability,
  type IndexFnoSetupAvailability,
} from "./optionSignals.js";

// ─── Shared fixtures ─────────────────────────────────────────────────────────

/** Minimal valid FnoMarketStatus (required fields only — from Zod schema). */
function makeMarketStatus(marketOpen: boolean) {
  return {
    isTradingDay: true,
    marketOpen,
    reason: marketOpen ? "OPEN" : "AFTER_CLOSE",
    serverUtc: new Date().toISOString(),
    serverIst: "10:30 28-Jul-2026",
    exchangeTimezone: "Asia/Kolkata",
    openTimeIst: "09:15",
    closeTimeIst: "15:30",
    calendarSource: "NSE_HOLIDAYS_2026",
    calendarAsOf: "2026-12-31",
  };
}

/** Nine canonical availability entries from the production domain function. */
const NINE_ENTRIES = computeAllIndexFnoSetupAvailability();

/**
 * Minimal valid signal for route-state tests.
 * Required Zod fields (from GetOptionSignalsResponse schema):
 *   index, indexName, spot, bias, confidence,
 *   leg { type, strike, action, entry, stopLoss, target1 },
 *   drivers [{ label, weight, bullish }],
 *   generatedAt (coerce.date).
 */
const SAMPLE_SIGNAL = {
  index: "NIFTY",
  indexName: "NIFTY 50",
  spot: 24650,
  bias: "BULLISH" as const,
  confidence: 72,
  generatedAt: new Date().toISOString(),
  leg: {
    type: "CALL" as const,
    strike: 24700,
    action: "BUY" as const,
    entry: 24650,
    stopLoss: 24500,
    target1: 24850,
  },
  drivers: [
    { label: "EMA alignment", weight: 0.6, bullish: true },
  ],
  vwapAvailable: false,
};

/** Build minimal valid setupState with 9 availability records. */
function makeSetupState(overrides: Record<string, unknown> = {}) {
  return {
    indicesEvaluated: 3,
    liveSetupsCount: 0,
    tradeableCount: 0,
    suppressedCount: 0,
    noSetupReason: null,
    indexFnoSetupAvailability: NINE_ENTRIES,
    ...overrides,
  };
}

/**
 * Build minimal valid outer payload for GetOptionSignalsResponse.parse().
 * diagnostics is omitted by default (field is .optional(), NOT nullable).
 */
function makePayload(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    signals: [],
    generatedAt: now,
    lastUpdated: now,
    marketState: "open",
    marketStatus: makeMarketStatus(true),
    setupState: makeSetupState(),
    // diagnostics intentionally omitted — it is .optional() not nullable
    ...overrides,
  };
}

// ─── §11.1 State 1 — Signal-present, market open ─────────────────────────────

describe("§11 Route serializer — State 1: signal-present, market open", () => {
  it("parses successfully with live signal and valid 9-record availability", () => {
    const result = GetOptionSignalsResponse.safeParse(makePayload({
      signals: [SAMPLE_SIGNAL],
      marketStatus: makeMarketStatus(true),
      setupState: makeSetupState({ liveSetupsCount: 1, tradeableCount: 1 }),
    }));
    expect(result.success, !result.success ? JSON.stringify(result.error.issues[0]) : "OK").toBe(true);
  });

  it("parsed result has exactly 9 availability records", () => {
    const result = GetOptionSignalsResponse.safeParse(makePayload({
      signals: [SAMPLE_SIGNAL],
      setupState: makeSetupState({ liveSetupsCount: 1, tradeableCount: 1 }),
    }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data.setupState as any)?.indexFnoSetupAvailability).toHaveLength(9);
    }
  });

  it("availability composite keys match domain function output exactly", () => {
    const result = GetOptionSignalsResponse.safeParse(makePayload({
      signals: [SAMPLE_SIGNAL],
      setupState: makeSetupState({ liveSetupsCount: 1 }),
    }));
    expect(result.success).toBe(true);
    if (result.success) {
      const parsedKeys = (result.data.setupState as any)?.indexFnoSetupAvailability
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ?.map((e: any) => `${e.indexSymbol}:${e.setupKey}`) ?? [];
      const domainKeys = NINE_ENTRIES.map(e => `${e.indexSymbol}:${e.setupKey}`);
      expect(parsedKeys).toEqual(domainKeys);
    }
  });

  it("all 9 parsed entries have eligibleForEmission=false", () => {
    const result = GetOptionSignalsResponse.safeParse(makePayload({
      signals: [SAMPLE_SIGNAL],
      setupState: makeSetupState({ liveSetupsCount: 1 }),
    }));
    expect(result.success).toBe(true);
    if (result.success) {
      for (const e of (result.data.setupState as any)?.indexFnoSetupAvailability ?? []) {
        expect(e.eligibleForEmission).toBe(false);
      }
    }
  });
});

// ─── §11.2 State 2 — No signal, market open ──────────────────────────────────

describe("§11 Route serializer — State 2: no signal, market open", () => {
  it("parses with empty signals and noSetupReason populated", () => {
    const result = GetOptionSignalsResponse.safeParse(makePayload({
      signals: [],
      marketStatus: makeMarketStatus(true),
      setupState: makeSetupState({
        liveSetupsCount: 0,
        noSetupReason: "No high-conviction setup generated this cycle",
      }),
    }));
    expect(result.success, !result.success ? JSON.stringify(result.error.issues[0]) : "OK").toBe(true);
  });

  it("noSetupReason is preserved in parsed output", () => {
    const result = GetOptionSignalsResponse.safeParse(makePayload({
      setupState: makeSetupState({ noSetupReason: "Regime suppression active" }),
    }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.setupState?.noSetupReason).toBe("Regime suppression active");
    }
  });

  it("availability still has 9 records when signals array is empty", () => {
    const result = GetOptionSignalsResponse.safeParse(makePayload({
      signals: [],
      setupState: makeSetupState({ noSetupReason: "No setup" }),
    }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data.setupState as any)?.indexFnoSetupAvailability).toHaveLength(9);
    }
  });
});

// ─── §11.3 State 3 — Market closed ───────────────────────────────────────────

describe("§11 Route serializer — State 3: market closed", () => {
  it("parses with market closed and noSetupReason=null", () => {
    const result = GetOptionSignalsResponse.safeParse(makePayload({
      signals: [],
      marketState: "closed",
      marketStatus: makeMarketStatus(false),
      setupState: makeSetupState({ noSetupReason: null }),
    }));
    expect(result.success, !result.success ? JSON.stringify(result.error.issues[0]) : "OK").toBe(true);
  });

  it("9 availability records required even in market-closed state", () => {
    const result = GetOptionSignalsResponse.safeParse(makePayload({
      signals: [],
      marketStatus: makeMarketStatus(false),
    }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data.setupState as any)?.indexFnoSetupAvailability).toHaveLength(9);
    }
  });

  it("market-closed with indexFnoSetupAvailability omitted fails schema", () => {
    const badSetupState = {
      indicesEvaluated: 3,
      liveSetupsCount: 0,
      tradeableCount: 0,
      suppressedCount: 0,
      noSetupReason: null,
      // indexFnoSetupAvailability intentionally omitted
    };
    const result = GetOptionSignalsResponse.safeParse(makePayload({
      signals: [],
      marketStatus: makeMarketStatus(false),
      setupState: badSetupState,
    }));
    expect(result.success).toBe(false);
  });
});

// ─── §11.4 State 4 — Full diagnostics present ────────────────────────────────

describe("§11 Route serializer — State 4: full diagnostics", () => {
  it("parses with full diagnostics object including all required gate fields", () => {
    const result = GetOptionSignalsResponse.safeParse(makePayload({
      signals: [],
      setupState: makeSetupState({ suppressedCount: 2 }),
      diagnostics: {
        indicesConfigured: 3,
        indicesWithBars: 2,
        highConvictionCount: 0,
        baselineCount: 1,
        suppressed: [{ index: "NIFTY", reasons: ["Correlation gate"] }],
        gates: {
          circuitBreakerActive: false,
          stoppedToday: 0,
          stopLimit: 2,
          vixSpike: false,
          correlationDroppedCount: 1,
          oiVetoCount: 1,
          staleExpiredCount: 0,
          notes: ["Correlation gate fired for NIFTY"],
        },
      },
    }));
    expect(result.success, !result.success ? JSON.stringify(result.error.issues[0]) : "OK").toBe(true);
  });

  it("availability is preserved alongside full diagnostics", () => {
    const result = GetOptionSignalsResponse.safeParse(makePayload({
      setupState: makeSetupState({ suppressedCount: 1 }),
      diagnostics: {
        indicesConfigured: 3,
        indicesWithBars: 3,
        highConvictionCount: 0,
        baselineCount: 0,
        suppressed: [],
        gates: {
          circuitBreakerActive: false,
          stoppedToday: 0,
          stopLimit: 2,
          vixSpike: false,
          correlationDroppedCount: 0,
          oiVetoCount: 0,
          staleExpiredCount: 0,
          notes: [],
        },
      },
    }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data.setupState as any)?.indexFnoSetupAvailability).toHaveLength(9);
    }
  });
});

// ─── §11.5 State 5 — No diagnostics (field absent) ───────────────────────────

describe("§11 Route serializer — State 5: diagnostics absent (pre-warmup/data-blocked)", () => {
  it("parses with diagnostics omitted (field is .optional(), not nullable)", () => {
    // diagnostics: null would FAIL — it is .optional() not .nullish()
    // Omitting the field entirely (undefined) is the correct no-diagnostics state.
    const result = GetOptionSignalsResponse.safeParse(makePayload({
      // diagnostics not included — makePayload omits it by default
    }));
    expect(result.success, !result.success ? JSON.stringify(result.error.issues[0]) : "OK").toBe(true);
  });

  it("diagnostics: null fails (field is .optional() not .nullish())", () => {
    // This documents the schema boundary: null is not accepted, undefined is.
    const result = GetOptionSignalsResponse.safeParse({
      ...makePayload(),
      diagnostics: null,
    });
    expect(result.success).toBe(false);
  });

  it("availability still required when diagnostics is absent", () => {
    const result = GetOptionSignalsResponse.safeParse(makePayload({}));
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data.setupState as any)?.indexFnoSetupAvailability).toHaveLength(9);
    }
  });
});

// ─── §11.6 State 6 — Degraded/stale state ────────────────────────────────────

describe("§11 Route serializer — State 6: degraded/stale state", () => {
  it("parses with empty signals, market closed, all 9 entries structurally unavailable", () => {
    const result = GetOptionSignalsResponse.safeParse(makePayload({
      signals: [],
      marketState: "closed",
      marketStatus: makeMarketStatus(false),
      setupState: makeSetupState({
        noSetupReason: null,
        liveSetupsCount: 0,
        tradeableCount: 0,
        suppressedCount: 0,
      }),
    }));
    expect(result.success, !result.success ? JSON.stringify(result.error.issues[0]) : "OK").toBe(true);
  });

  it("route ?? [] fallback produces [] — fails .length(9) (fail-closed behaviour)", () => {
    // Proves that if getOptionSignals() returned null/undefined for indexFnoSetupAvailability,
    // the route's `?? []` fallback would cause a Zod parse failure, not silent empty output.
    const withEmptyFallback = {
      ...makeSetupState(),
      indexFnoSetupAvailability: [] as unknown as IndexFnoSetupAvailability[],
    };
    const result = GetOptionSignalsResponse.safeParse(makePayload({
      setupState: withEmptyFallback,
    }));
    expect(result.success).toBe(false);
  });

  it("the domain function computeAllIndexFnoSetupAvailability() always prevents the ?? [] fallback path", () => {
    // getOptionSignals() now always returns computeAllIndexFnoSetupAvailability() (9 records).
    // The ?? [] path is now dead code — this test proves the domain function is non-null.
    const entries = computeAllIndexFnoSetupAvailability();
    expect(entries).not.toBeNull();
    expect(entries).not.toBeUndefined();
    expect(entries).toHaveLength(9);
  });
});

// ─── §11.R — Validator rejection proof ───────────────────────────────────────

describe("§11 Route serializer — Validator rejection proof (R1–R9)", () => {

  it("R1 — empty availability array [] is rejected (length must be 9)", () => {
    const result = GetOptionSignalsResponse.safeParse(makePayload({
      setupState: { ...makeSetupState(), indexFnoSetupAvailability: [] },
    }));
    expect(result.success).toBe(false);
  });

  it("R2 — 3-record single-index payload (old A0.3.1 design) is rejected", () => {
    const threeRecords = computeIndexFnoSetupAvailability("NIFTY");
    const result = GetOptionSignalsResponse.safeParse(makePayload({
      setupState: { ...makeSetupState(), indexFnoSetupAvailability: threeRecords },
    }));
    expect(result.success).toBe(false);
  });

  it("R3 — domain function never produces duplicate composite keys (uniqueness source-of-truth)", () => {
    // Zod .length(9) catches under/over-count but not duplicate identity keys.
    // The domain function computeAllIndexFnoSetupAvailability() is the uniqueness guard.
    const domainKeys = NINE_ENTRIES.map(e => `${e.indexSymbol}:${e.setupKey}`);
    expect(new Set(domainKeys).size).toBe(9);
    expect(domainKeys.length).toBe(9);
  });

  it("R4 — 8 records (one missing combination) is rejected by .length(9) guard", () => {
    const eightRecords = NINE_ENTRIES.slice(0, 8);
    const result = GetOptionSignalsResponse.safeParse(makePayload({
      setupState: { ...makeSetupState(), indexFnoSetupAvailability: eightRecords },
    }));
    expect(result.success).toBe(false);
  });

  it("R5 — invalid status enum on one entry is rejected", () => {
    const entries = NINE_ENTRIES.map((e, i) =>
      i === 0 ? { ...e, status: "UNKNOWN_STATUS" } : e,
    );
    const result = GetOptionSignalsResponse.safeParse(makePayload({
      setupState: { ...makeSetupState(), indexFnoSetupAvailability: entries },
    }));
    expect(result.success).toBe(false);
  });

  it("R6 — reasonCode is z.string() in Zod; authorised-code constraint is domain-enforced (setupAvailability.test.ts §10)", () => {
    // The Zod schema uses z.string() for reasonCode — structural validation only.
    // Semantic validation (authorised codes) is domain-enforced in optionSignals.ts
    // and tested in setupAvailability.test.ts §10. This is an intentional schema boundary:
    // z.enum() for reasonCode would force a schema migration on every new reason code.
    // The domain authorised-code set is: INDEX_VOLUME_UNAVAILABLE, SESSION_VWAP_UNAVAILABLE,
    // SETUP_RETIRED_UNDER_CURRENT_INDEX_FNO_POLICY.
    const entries = NINE_ENTRIES.map((e, i) =>
      i === 0 ? { ...e, reasonCode: "THIS_IS_PROSE_TEXT_NOT_A_CODE" } : e,
    );
    const result = GetOptionSignalsResponse.safeParse(makePayload({
      setupState: { ...makeSetupState(), indexFnoSetupAvailability: entries },
    }));
    // Zod accepts (string field) — domain tests assert authorised codes separately
    expect(result.success).toBe(true);
    // Verify domain function never produces unauthorised codes:
    const domainCodes = new Set(NINE_ENTRIES.map(e => e.reasonCode));
    expect(domainCodes).toContain("INDEX_VOLUME_UNAVAILABLE");
    expect(domainCodes).toContain("SESSION_VWAP_UNAVAILABLE");
    expect(domainCodes).toContain("SETUP_RETIRED_UNDER_CURRENT_INDEX_FNO_POLICY");
    expect(domainCodes.size).toBe(3);
  });

  it("R7 — eligibleForEmission: true on one entry is rejected (z.literal(false))", () => {
    const entries = NINE_ENTRIES.map((e, i) =>
      i === 0 ? { ...e, eligibleForEmission: true } : e,
    );
    const result = GetOptionSignalsResponse.safeParse(makePayload({
      setupState: { ...makeSetupState(), indexFnoSetupAvailability: entries },
    }));
    expect(result.success).toBe(false);
  });

  it("R8 — missing indexSymbol on one entry is rejected (field is required)", () => {
    const entries = NINE_ENTRIES.map((e, i) => {
      if (i !== 0) return e;
      const { indexSymbol: _, ...without } = e;
      return without as unknown as IndexFnoSetupAvailability;
    });
    const result = GetOptionSignalsResponse.safeParse(makePayload({
      setupState: { ...makeSetupState(), indexFnoSetupAvailability: entries },
    }));
    expect(result.success).toBe(false);
  });

  it("R9 — invalid indexSymbol (FINNIFTY — not in supported set) is rejected", () => {
    const entries = NINE_ENTRIES.map((e, i) =>
      i === 0 ? { ...e, indexSymbol: "FINNIFTY" } : e,
    );
    const result = GetOptionSignalsResponse.safeParse(makePayload({
      setupState: { ...makeSetupState(), indexFnoSetupAvailability: entries },
    }));
    expect(result.success).toBe(false);
  });
});
