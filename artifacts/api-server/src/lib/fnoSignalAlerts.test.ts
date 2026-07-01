/**
 * Tests for fnoSignalAlerts.ts
 *
 * Covers:
 *  – shouldSendFnoTradeAlert() eligibility predicate (pure, side-effect-free)
 *  – buildFnoSignalAlertText() required wording + forbidden wording
 *  – alertFnoTradeableSignal() dedup, safe-fail, last-record tracking
 *  – buildFnoSampleAlertText() sample-labeling
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  shouldSendFnoTradeAlert,
  buildFnoSignalAlertText,
  buildFnoSampleAlertText,
  alertFnoTradeableSignal,
  getLastFnoSignalAlertRecord,
  resetFnoSignalAlertState,
  FNO_SIGNAL_ALERT_NEW_OPEN_MAX_MS,
  FNO_SIGNAL_DEDUP_MS,
  type FnoTradeAlertInput,
} from "./fnoSignalAlerts";
import { resetAlertDedup } from "./alerting";

// ── Helpers ───────────────────────────────────────────────────────────────────

function freshInput(overrides: Partial<FnoTradeAlertInput> = {}): FnoTradeAlertInput {
  const nowMs = Date.now();
  return {
    indexSymbol:    "NIFTY",
    direction:      "BULLISH",
    setupKey:       "NIFTY_MEAN_REVERSION",
    signalDate:     "2026-07-01",
    confidence:     72,
    entryPremium:   125.0,
    stopPremium:    80.0,
    target1Premium: 200.0,
    target2Premium: 280.0,
    lots:           10,
    lotSize:        75,
    strike:         24500,
    expiry:         "2026-07-03",
    optionType:     "CE",
    openedAt:       new Date(nowMs - 10_000), // opened 10 seconds ago
    ...overrides,
  };
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetAlertDedup();
  resetFnoSignalAlertState();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ── 1. shouldSendFnoTradeAlert — fresh open is eligible ───────────────────────

describe("shouldSendFnoTradeAlert — fresh open", () => {
  it("returns true for a valid fresh open (opened 10 seconds ago)", () => {
    expect(shouldSendFnoTradeAlert(freshInput())).toBe(true);
  });

  it("returns true at the boundary (exactly at the freshness limit)", () => {
    const nowMs = Date.now();
    const input = freshInput({ openedAt: new Date(nowMs - FNO_SIGNAL_ALERT_NEW_OPEN_MAX_MS) });
    // exactly at the limit → still fresh (not strictly greater than)
    expect(shouldSendFnoTradeAlert(input, nowMs)).toBe(true);
  });
});

// ── 2. shouldSendFnoTradeAlert — stale open is rejected ──────────────────────

describe("shouldSendFnoTradeAlert — existing/stale trade rejected", () => {
  it("returns false for a trade opened more than 5 minutes ago (idempotency path)", () => {
    const nowMs = Date.now();
    const staleMs = nowMs - FNO_SIGNAL_ALERT_NEW_OPEN_MAX_MS - 1;
    const input = freshInput({ openedAt: new Date(staleMs) });
    expect(shouldSendFnoTradeAlert(input, nowMs)).toBe(false);
  });

  it("returns false for a trade opened an hour ago (overnight hold)", () => {
    const nowMs = Date.now();
    const input = freshInput({ openedAt: new Date(nowMs - 60 * 60 * 1000) });
    expect(shouldSendFnoTradeAlert(input, nowMs)).toBe(false);
  });
});

// ── 3. shouldSendFnoTradeAlert — bad field values rejected ───────────────────

describe("shouldSendFnoTradeAlert — invalid fields rejected", () => {
  it("returns false when entryPremium is zero (missing option-chain)", () => {
    expect(shouldSendFnoTradeAlert(freshInput({ entryPremium: 0 }))).toBe(false);
  });

  it("returns false when entryPremium is negative", () => {
    expect(shouldSendFnoTradeAlert(freshInput({ entryPremium: -1 }))).toBe(false);
  });

  it("returns false when entryPremium is NaN", () => {
    expect(shouldSendFnoTradeAlert(freshInput({ entryPremium: NaN }))).toBe(false);
  });

  it("returns false when lots is zero", () => {
    expect(shouldSendFnoTradeAlert(freshInput({ lots: 0 }))).toBe(false);
  });

  it("returns false when lotSize is zero", () => {
    expect(shouldSendFnoTradeAlert(freshInput({ lotSize: 0 }))).toBe(false);
  });

  it("returns false when confidence is zero", () => {
    expect(shouldSendFnoTradeAlert(freshInput({ confidence: 0 }))).toBe(false);
  });
});

// ── 4. buildFnoSignalAlertText — required wording ────────────────────────────

describe("buildFnoSignalAlertText — required wording", () => {
  it("contains required broker-disabled wording", () => {
    const text = buildFnoSignalAlertText(freshInput());
    expect(text).toContain("Broker execution: DISABLED — no order placed");
  });

  it("contains required manual-review wording", () => {
    const text = buildFnoSignalAlertText(freshInput());
    expect(text).toContain("Manual review required. This is not auto-executed.");
  });

  it("contains index and direction label", () => {
    const text = buildFnoSignalAlertText(freshInput());
    expect(text).toContain("NIFTY");
    // BULLISH maps to CALL (CE) in the message — check the rendered label
    expect(text).toContain("CALL (CE)");
  });

  it("contains entry premium formatted to 2 dp", () => {
    const text = buildFnoSignalAlertText(freshInput({ entryPremium: 125.0 }));
    expect(text).toContain("₹125.00");
  });

  it("shows bearish signal as PUT (PE)", () => {
    const text = buildFnoSignalAlertText(freshInput({ direction: "BEARISH" }));
    expect(text).toContain("PUT (PE)");
  });
});

// ── 5. buildFnoSignalAlertText — forbidden wording ───────────────────────────

describe("buildFnoSignalAlertText — forbidden wording absent", () => {
  it("does not contain 'guaranteed profit'", () => {
    const text = buildFnoSignalAlertText(freshInput());
    expect(text.toLowerCase()).not.toContain("guaranteed profit");
  });

  it("does not contain 'sure shot'", () => {
    const text = buildFnoSignalAlertText(freshInput());
    expect(text.toLowerCase()).not.toContain("sure shot");
  });

  it("does not contain 'buy now'", () => {
    const text = buildFnoSignalAlertText(freshInput());
    expect(text.toLowerCase()).not.toContain("buy now");
  });

  it("does not contain 'auto order placed'", () => {
    const text = buildFnoSignalAlertText(freshInput());
    expect(text.toLowerCase()).not.toContain("auto order placed");
  });

  it("does not contain 'risk-free'", () => {
    const text = buildFnoSignalAlertText(freshInput());
    expect(text.toLowerCase()).not.toContain("risk-free");
  });
});

// ── 6. buildFnoSampleAlertText — sample label ────────────────────────────────

describe("buildFnoSampleAlertText — sample labeling", () => {
  it("contains [SAMPLE] label", () => {
    const text = buildFnoSampleAlertText();
    expect(text).toContain("[SAMPLE");
  });

  it("still contains broker-disabled wording even in sample", () => {
    const text = buildFnoSampleAlertText();
    expect(text).toContain("DISABLED — no order placed");
  });
});

// ── 7. alertFnoTradeableSignal — dedup prevents cycle spam ───────────────────

describe("alertFnoTradeableSignal — dedup", () => {
  it("calls fetch only once for the same signal within the dedup window", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot:test");
    vi.stubEnv("TELEGRAM_CHAT_ID", "12345");

    const input = freshInput();
    alertFnoTradeableSignal(input);
    alertFnoTradeableSignal(input); // same signal — should be deduped

    await new Promise(r => setTimeout(r, 80));
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("fires independently for different directions on same index", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot:test");
    vi.stubEnv("TELEGRAM_CHAT_ID", "12345");

    alertFnoTradeableSignal(freshInput({ direction: "BULLISH", setupKey: "KEY_A" }));
    alertFnoTradeableSignal(freshInput({ direction: "BEARISH", setupKey: "KEY_B" }));

    await new Promise(r => setTimeout(r, 80));
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

// ── 8. alertFnoTradeableSignal — safe-fail ────────────────────────────────────

describe("alertFnoTradeableSignal — safe-fail", () => {
  it("does not throw even when fetch rejects catastrophically", () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("CATASTROPHIC")));
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot:test");
    vi.stubEnv("TELEGRAM_CHAT_ID", "12345");

    expect(() => alertFnoTradeableSignal(freshInput())).not.toThrow();
  });

  it("does not throw when eligibility fails (stale open)", () => {
    const nowMs = Date.now();
    const input = freshInput({ openedAt: new Date(nowMs - 60 * 60 * 1000) });
    expect(() => alertFnoTradeableSignal(input)).not.toThrow();
  });

  it("does not throw when Telegram is not configured", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    vi.stubEnv("TELEGRAM_CHAT_ID", "");
    expect(() => alertFnoTradeableSignal(freshInput())).not.toThrow();
  });
});

// ── 9. alertFnoTradeableSignal — last-record tracking ────────────────────────

describe("alertFnoTradeableSignal — last-record tracking", () => {
  it("records the signal after a fresh eligible open", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    vi.stubEnv("TELEGRAM_CHAT_ID", "");

    expect(getLastFnoSignalAlertRecord()).toBeNull();
    alertFnoTradeableSignal(freshInput({ indexSymbol: "BANKNIFTY", confidence: 68 }));

    const rec = getLastFnoSignalAlertRecord();
    expect(rec).not.toBeNull();
    expect(rec?.indexSymbol).toBe("BANKNIFTY");
    expect(rec?.confidence).toBe(68);
    expect(rec?.direction).toBe("BULLISH");
    expect(typeof rec?.at).toBe("number");
  });

  it("does NOT update last-record when eligibility fails", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    vi.stubEnv("TELEGRAM_CHAT_ID", "");

    const staleInput = freshInput({ openedAt: new Date(Date.now() - 60 * 60 * 1000) });
    alertFnoTradeableSignal(staleInput);
    expect(getLastFnoSignalAlertRecord()).toBeNull();
  });
});

// ── 10. FNO_SIGNAL_DEDUP_MS constant sanity ───────────────────────────────────

describe("constants", () => {
  it("dedup window is 30 minutes", () => {
    expect(FNO_SIGNAL_DEDUP_MS).toBe(30 * 60 * 1000);
  });

  it("new-open freshness window is 5 minutes", () => {
    expect(FNO_SIGNAL_ALERT_NEW_OPEN_MAX_MS).toBe(5 * 60 * 1000);
  });
});
