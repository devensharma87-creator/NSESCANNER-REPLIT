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
  alertFnoExitSignal,
  buildFnoExitCanonicalEvent,
  alertWarmupFailures,
  getLastFnoSignalAlertRecord,
  resetFnoSignalAlertState,
  FNO_SIGNAL_ALERT_NEW_OPEN_MAX_MS,
  FNO_SIGNAL_DEDUP_MS,
  type FnoTradeAlertInput,
  type FnoExitAlertInput,
} from "./fnoSignalAlerts";
import { alertOwnerRaw, resetAlertDedup } from "./alerting";
import { hasAlreadyDelivered, logNotificationDelivery } from "./tradeLifecycle/notificationLog";

vi.mock("./alerting", () => ({
  alertOwnerRaw: vi.fn(),
  resetAlertDedup: vi.fn(),
  resetLastAlertRecord: vi.fn(),
}));

vi.mock("./tradeLifecycle/notificationLog", () => ({
  hasAlreadyDelivered: vi.fn(() => Promise.resolve(false)),
  logNotificationDelivery: vi.fn(() => Promise.resolve(undefined)),
  hashMessage: vi.fn(() => "mock-hash"),
}));

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
  vi.mocked(alertOwnerRaw).mockClear();
  vi.mocked(resetAlertDedup).mockClear();
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

// ── 5b. buildFnoSignalAlertText — real alert source precision ─────────────────

describe("buildFnoSignalAlertText — source precision (real alert)", () => {
  it("says Paper trade snapshot for price source", () => {
    const text = buildFnoSignalAlertText(freshInput());
    expect(text).toContain("Paper trade snapshot");
  });

  it("says Kite trusted option-chain for premium source", () => {
    const text = buildFnoSignalAlertText(freshInput());
    expect(text).toContain("Kite trusted option-chain");
  });

  it("includes snapshot-time staleness note", () => {
    const text = buildFnoSignalAlertText(freshInput());
    expect(text).toContain("Entry premium is the snapshot at open");
  });

  it("does NOT have bare 'Data source: Kite' label (replaced by precision lines)", () => {
    const text = buildFnoSignalAlertText(freshInput());
    expect(text).not.toContain("Data source: Kite");
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

// ── 6b. buildFnoSampleAlertText — source-honesty guards (the real fix) ────────

describe("buildFnoSampleAlertText — source honesty (must not imply real Kite data)", () => {
  it("does NOT contain 'Data source: Kite'", () => {
    const text = buildFnoSampleAlertText();
    expect(text).not.toContain("Data source: Kite");
  });

  it("does NOT contain 'trusted option-chain' (only real alerts may say that)", () => {
    const text = buildFnoSampleAlertText();
    expect(text.toLowerCase()).not.toContain("trusted option-chain");
  });

  it("does NOT say 'F&O TRADEABLE SIGNAL' (that header is reserved for real signals)", () => {
    const text = buildFnoSampleAlertText();
    expect(text).not.toContain("F&O TRADEABLE SIGNAL");
  });

  it("says 'SAMPLE DATA — not Kite, not live market price'", () => {
    const text = buildFnoSampleAlertText();
    expect(text).toContain("SAMPLE DATA — not Kite, not live market price");
  });

  it("says 'NOT QUERIED — no Kite API call made'", () => {
    const text = buildFnoSampleAlertText();
    expect(text).toContain("NOT QUERIED");
  });

  it("says 'F&O TRADE ALERT FORMAT TEST' as the header", () => {
    const text = buildFnoSampleAlertText();
    expect(text).toContain("F&O TRADE ALERT FORMAT TEST");
  });

  it("says 'Paper trade created: NO'", () => {
    const text = buildFnoSampleAlertText();
    expect(text).toContain("Paper trade created: NO");
  });

  it("says 'Real order placed: NO'", () => {
    const text = buildFnoSampleAlertText();
    expect(text).toContain("Real order placed:   NO");
  });

  it("marks sample values clearly with '(sample)'", () => {
    const text = buildFnoSampleAlertText();
    expect(text).toContain("(sample");
  });

  it("still starts with [SAMPLE — NOT A REAL TRADE]", () => {
    const text = buildFnoSampleAlertText();
    expect(text.trimStart()).toMatch(/^\[SAMPLE — NOT A REAL TRADE\]/);
  });
});

// ── 7. alertFnoTradeableSignal — dedup prevents cycle spam ───────────────────

describe("alertFnoTradeableSignal — dedup", () => {
  it("calls alertOwnerRaw only once for the same signal within the dedup window", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const input = freshInput();
    alertFnoTradeableSignal(input);
    alertFnoTradeableSignal(input); // same signal — alertOwnerRaw internal dedup fires
    await new Promise(r => setTimeout(r, 100));
    expect(vi.mocked(alertOwnerRaw)).toHaveBeenCalledTimes(1);
  });

  it("fires independently for different directions on same index", async () => {
    vi.stubEnv("NODE_ENV", "production");
    alertFnoTradeableSignal(freshInput({ direction: "BULLISH", setupKey: "KEY_A" }));
    alertFnoTradeableSignal(freshInput({ direction: "BEARISH", setupKey: "KEY_B" }));
    await new Promise(r => setTimeout(r, 100));
    expect(vi.mocked(alertOwnerRaw)).toHaveBeenCalledTimes(2);
  });
});

// ── 8. alertFnoTradeableSignal — safe-fail ────────────────────────────────────

describe("alertFnoTradeableSignal — safe-fail", () => {
  it("does not throw even when alertOwnerRaw throws catastrophically", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.mocked(alertOwnerRaw).mockImplementationOnce(() => { throw new Error("CATASTROPHIC"); });
    expect(() => alertFnoTradeableSignal(freshInput())).not.toThrow();
  });

  it("does not throw when eligibility fails (stale open)", () => {
    const input = freshInput({ openedAt: new Date(Date.now() - 60 * 60 * 1000) });
    expect(() => alertFnoTradeableSignal(input)).not.toThrow();
  });

  it("does not throw when NODE_ENV is not production (DEV_ENV_BLOCKED suppresses cleanly)", () => {
    // Default NODE_ENV=test in vitest — alert is safely suppressed, must not throw
    expect(() => alertFnoTradeableSignal(freshInput())).not.toThrow();
  });
});

// ── 9. alertFnoTradeableSignal — last-record tracking ────────────────────────

describe("alertFnoTradeableSignal — last-record tracking", () => {
  it("records the signal after a fresh eligible open dispatched in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(getLastFnoSignalAlertRecord()).toBeNull();
    alertFnoTradeableSignal(freshInput({ indexSymbol: "BANKNIFTY", confidence: 68 }));
    await new Promise(r => setTimeout(r, 100));
    const rec = getLastFnoSignalAlertRecord();
    expect(rec).not.toBeNull();
    expect(rec?.indexSymbol).toBe("BANKNIFTY");
    expect(rec?.confidence).toBe(68);
    expect(rec?.direction).toBe("BULLISH");
    expect(typeof rec?.at).toBe("number");
  });

  it("does NOT update last-record when eligibility fails (stale open)", () => {
    const staleInput = freshInput({ openedAt: new Date(Date.now() - 60 * 60 * 1000) });
    alertFnoTradeableSignal(staleInput);
    expect(getLastFnoSignalAlertRecord()).toBeNull();
  });

  it("does NOT update last-record in non-production environment (DEV_ENV_BLOCKED)", async () => {
    // NODE_ENV=test → pipeline blocks before updating the record
    alertFnoTradeableSignal(freshInput({ indexSymbol: "BANKNIFTY", confidence: 68 }));
    await new Promise(r => setTimeout(r, 100));
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

// ── 11. buildFnoExitCanonicalEvent — canonical Telegram migration (2026-07-02) ──

function freshExitInput(overrides: Partial<FnoExitAlertInput> = {}): FnoExitAlertInput {
  const nowMs = Date.now();
  return {
    paperTradeId:   "pt-exit-001",
    indexSymbol:    "NIFTY",
    direction:      "BULLISH",
    setupKey:       "NIFTY_MEAN_REVERSION",
    signalDate:     "2026-07-01",
    optionType:     "CE",
    entryPremium:   125.0,
    exitPremium:    80.0,
    stopPremium:    80.0,
    target1Premium: 200.0,
    lots:           10,
    lotSize:        75,
    realizedPnl:    -33750,
    reason:         "STOPPED",
    openedAt:       new Date(nowMs - 60 * 60 * 1000),
    exitedAt:       new Date(nowMs),
    ...overrides,
  };
}

describe("buildFnoExitCanonicalEvent — honest INFO_ONLY exit shape", () => {
  it("maps STOPPED reason to EXIT_STOP_LOSS / EXITED_STOP_LOSS", () => {
    const ev = buildFnoExitCanonicalEvent(freshExitInput({ reason: "STOPPED" }));
    expect(ev.eventType).toBe("EXIT_STOP_LOSS");
    expect(ev.lifecycleStatus).toBe("EXITED_STOP_LOSS");
  });

  it("maps TARGET1_HIT reason to EXIT_TARGET_1 / EXITED_TARGET_1", () => {
    const ev = buildFnoExitCanonicalEvent(freshExitInput({ reason: "TARGET1_HIT" }));
    expect(ev.eventType).toBe("EXIT_TARGET_1");
    expect(ev.lifecycleStatus).toBe("EXITED_TARGET_1");
  });

  it("maps TARGET2_HIT reason to EXIT_TARGET_2 / EXITED_TARGET_2", () => {
    const ev = buildFnoExitCanonicalEvent(freshExitInput({ reason: "TARGET2_HIT" }));
    expect(ev.eventType).toBe("EXIT_TARGET_2");
    expect(ev.lifecycleStatus).toBe("EXITED_TARGET_2");
  });

  it("maps MANUAL_OVERRIDE reason to EXIT_MANUAL / EXITED_MANUAL and source=manual", () => {
    const ev = buildFnoExitCanonicalEvent(freshExitInput({ reason: "MANUAL_OVERRIDE" }));
    expect(ev.eventType).toBe("EXIT_MANUAL");
    expect(ev.lifecycleStatus).toBe("EXITED_MANUAL");
    expect(ev.source).toBe("manual");
  });

  it("maps TIME_EXIT_1520/EXPIRED (any other reason) to EXIT_TIME / EXITED_TIME", () => {
    const ev = buildFnoExitCanonicalEvent(freshExitInput({ reason: "TIME_EXIT_1520" }));
    expect(ev.eventType).toBe("EXIT_TIME");
    expect(ev.lifecycleStatus).toBe("EXITED_TIME");
  });

  it("non-manual closes are sourced as computed_from_kite (locked DB premium, not a live quote)", () => {
    const ev = buildFnoExitCanonicalEvent(freshExitInput({ reason: "TARGET1_HIT" }));
    expect(ev.source).toBe("computed_from_kite");
  });

  it("is stamped honestly INFO_ONLY / non-signal-driving", () => {
    const ev = buildFnoExitCanonicalEvent(freshExitInput());
    expect(ev.sourceStatus).toBe("INFO_ONLY");
    expect(ev.canDriveSignals).toBe(false);
    expect(ev.canDriveTradeAlerts).toBe(false);
  });

  it("BULLISH direction maps to side=CALL, BEARISH maps to side=PUT", () => {
    expect(buildFnoExitCanonicalEvent(freshExitInput({ direction: "BULLISH" })).side).toBe("CALL");
    expect(buildFnoExitCanonicalEvent(freshExitInput({ direction: "BEARISH" })).side).toBe("PUT");
  });

  it("uses stopPremium directly when present (no fallback warning)", () => {
    const ev = buildFnoExitCanonicalEvent(freshExitInput({ stopPremium: 80.0 }));
    expect(ev.stopLoss).toBe(80.0);
    expect(ev.warnings.some((w) => w.includes("StopLossUnavailable"))).toBe(false);
  });

  it("falls back stopLoss to entryPremium and records a warning when stopPremium is null", () => {
    const ev = buildFnoExitCanonicalEvent(freshExitInput({ stopPremium: null, entryPremium: 125.0 }));
    expect(ev.stopLoss).toBe(125.0);
    expect(ev.warnings.some((w) => w.includes("StopLossUnavailable"))).toBe(true);
  });

  it("computes quantity as lots * lotSize", () => {
    const ev = buildFnoExitCanonicalEvent(freshExitInput({ lots: 10, lotSize: 75 }));
    expect(ev.quantity).toBe(750);
  });

  it("has instrumentToken=null and exchange=INDEX", () => {
    const ev = buildFnoExitCanonicalEvent(freshExitInput());
    expect(ev.instrumentToken).toBeNull();
    expect(ev.exchange).toBe("INDEX");
  });

  it("carries exitReason and exitPrice from input", () => {
    const ev = buildFnoExitCanonicalEvent(freshExitInput({ reason: "STOPPED", exitPremium: 80.0 }));
    expect(ev.exitReason).toBe("STOPPED");
    expect(ev.exitPrice).toBe(80.0);
  });

  it("brokerExecutionStatus is always DISABLED and paperTradeStatus is always CLOSED", () => {
    const ev = buildFnoExitCanonicalEvent(freshExitInput());
    expect(ev.brokerExecutionStatus).toBe("DISABLED");
    expect(ev.paperTradeStatus).toBe("CLOSED");
  });
});

// ── 12. alertFnoExitSignal — canonical dispatch pipeline ─────────────────────

describe("alertFnoExitSignal — canonical pipeline dispatch", () => {
  it("sends exactly once for a valid production exit", async () => {
    vi.stubEnv("NODE_ENV", "production");
    alertFnoExitSignal(freshExitInput());
    await new Promise((r) => setTimeout(r, 50));
    expect(vi.mocked(alertOwnerRaw)).toHaveBeenCalledTimes(1);
  });

  it("is blocked in non-production environment (DEV_ENV_BLOCKED)", async () => {
    // Default NODE_ENV=test in vitest
    alertFnoExitSignal(freshExitInput());
    await new Promise((r) => setTimeout(r, 50));
    expect(vi.mocked(alertOwnerRaw)).not.toHaveBeenCalled();
  });

  it("is blocked for TESTSTK-style test symbols even in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    alertFnoExitSignal(freshExitInput({ indexSymbol: "TESTSTK" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(vi.mocked(alertOwnerRaw)).not.toHaveBeenCalled();
  });

  it("skips sending when hasAlreadyDelivered resolves true (DB dedup)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.mocked(hasAlreadyDelivered).mockResolvedValueOnce(true);
    alertFnoExitSignal(freshExitInput());
    await new Promise((r) => setTimeout(r, 50));
    expect(vi.mocked(alertOwnerRaw)).not.toHaveBeenCalled();
  });

  it("logs delivery to notification_delivery_log on successful send", async () => {
    vi.stubEnv("NODE_ENV", "production");
    alertFnoExitSignal(freshExitInput());
    await new Promise((r) => setTimeout(r, 50));
    expect(vi.mocked(logNotificationDelivery)).toHaveBeenCalled();
  });

  it("does not throw even when alertOwnerRaw throws catastrophically", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.mocked(alertOwnerRaw).mockImplementationOnce(() => { throw new Error("CATASTROPHIC"); });
    expect(() => alertFnoExitSignal(freshExitInput())).not.toThrow();
    await new Promise((r) => setTimeout(r, 50));
  });

  it("does not throw when buildFnoExitCanonicalEvent input is malformed", () => {
    expect(() => alertFnoExitSignal(freshExitInput({ lots: NaN as unknown as number }))).not.toThrow();
  });

  it("sent Telegram text contains the index symbol and STOP-LOSS wording for a STOPPED exit", async () => {
    vi.stubEnv("NODE_ENV", "production");
    alertFnoExitSignal(freshExitInput({ reason: "STOPPED", indexSymbol: "BANKNIFTY" }));
    await new Promise((r) => setTimeout(r, 50));
    const call = vi.mocked(alertOwnerRaw).mock.calls[0];
    expect(call?.[2]).toContain("BANKNIFTY");
    expect(call?.[2]?.toUpperCase()).toContain("STOP-LOSS");
  });
});

// ── alertWarmupFailures — Checkpoint 1 Part A/F: known reasons, market-closed
//    suppression, and a single consolidated digest ────────────────────────────
describe("alertWarmupFailures — Checkpoint 1 known-reason digest", () => {
  function stepResult(step: string, code: string | null, message: string | null = "detail") {
    return { step, ok: code === null, code, message: code === null ? null : message };
  }

  it("does not alert when the outcome is OK", () => {
    alertWarmupFailures({ outcome: "OK", indices: [{ index: "NIFTY", ok: true, steps: [] }] });
    expect(vi.mocked(alertOwnerRaw)).not.toHaveBeenCalled();
  });

  it("does not alert on any SKIPPED_* outcome", () => {
    alertWarmupFailures({ outcome: "SKIPPED_NO_SESSION", indices: [] });
    expect(vi.mocked(alertOwnerRaw)).not.toHaveBeenCalled();
  });

  it("does not alert when the only failure is MARKET_CLOSED (not a data-health problem)", () => {
    alertWarmupFailures({
      outcome: "PARTIAL",
      indices: [
        {
          index: "NIFTY",
          ok: false,
          steps: [stepResult("dailyBars", "MARKET_CLOSED", "Market is closed.")],
        },
      ],
    });
    expect(vi.mocked(alertOwnerRaw)).not.toHaveBeenCalled();
  });

  it("does not alert when the only failure is SESSION_MISSING or TOKEN_MISSING (unchanged)", () => {
    alertWarmupFailures({
      outcome: "FAILED",
      indices: [
        { index: "NIFTY", ok: false, steps: [stepResult("quote", "SESSION_MISSING", "no session")] },
        { index: "BANKNIFTY", ok: false, steps: [stepResult("quote", "TOKEN_MISSING", "no token")] },
      ],
    });
    expect(vi.mocked(alertOwnerRaw)).not.toHaveBeenCalled();
  });

  it("alerts with the KNOWN reason code (e.g. INTRADAY_BARS_MISSING) — never UNKNOWN when the code is known", () => {
    alertWarmupFailures({
      outcome: "PARTIAL",
      indices: [
        {
          index: "NIFTY",
          ok: false,
          steps: [stepResult("intradayBars", "INTRADAY_BARS_MISSING", "Live intraday bars missing.")],
        },
      ],
    });
    expect(vi.mocked(alertOwnerRaw)).toHaveBeenCalledTimes(1);
    const text = vi.mocked(alertOwnerRaw).mock.calls[0]?.[2] as string;
    expect(text).toContain("INTRADAY_BARS_MISSING");
    expect(text).not.toContain("UNKNOWN");
  });

  it("fires exactly ONE digest alert covering all three indices (no per-index spam)", () => {
    alertWarmupFailures({
      outcome: "FAILED",
      indices: [
        { index: "NIFTY", ok: false, steps: [stepResult("intradayBars", "INTRADAY_BARS_MISSING")] },
        { index: "BANKNIFTY", ok: false, steps: [stepResult("dailyBars", "DAILY_BARS_MISSING")] },
        { index: "SENSEX", ok: false, steps: [stepResult("quote", "WEBSOCKET_NO_TICKS")] },
      ],
    });
    expect(vi.mocked(alertOwnerRaw)).toHaveBeenCalledTimes(1);
    const text = vi.mocked(alertOwnerRaw).mock.calls[0]?.[2] as string;
    expect(text).toContain("NIFTY");
    expect(text).toContain("BANKNIFTY");
    expect(text).toContain("SENSEX");
    expect(text).toContain("Indices affected: 3");
  });

  it("does not throw even when alertOwnerRaw throws catastrophically", () => {
    vi.mocked(alertOwnerRaw).mockImplementationOnce(() => { throw new Error("CATASTROPHIC"); });
    expect(() =>
      alertWarmupFailures({
        outcome: "FAILED",
        indices: [{ index: "NIFTY", ok: false, steps: [stepResult("quote", "KITE_SESSION_EXPIRED")] }],
      }),
    ).not.toThrow();
  });
});
