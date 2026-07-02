/**
 * tradeEventParity.test.ts — Deterministic Parity Verification Harness tests.
 *
 * Parts E, F, and I of the harness specification.
 *
 * Test coverage (20 tests):
 *   T01–T06  Part E fixtures: validation block reasons
 *   T07–T08  Part E fixtures: F&O valid signal path
 *   T09–T12  Part B: projectTradeEventForUi field accuracy
 *   T13–T16  Part C: compareTradeEventParity mismatch detection
 *   T17–T18  Part F: dry-run parity run (no DB, no Telegram)
 *   T19–T20  Part I: formatter determinism + hash stability
 *
 * ABSOLUTE RULES:
 *   - No real DB writes. No Telegram sends. No paper trades.
 *   - All events use environment: "test".
 *   - Fixtures use fixtureOnly: true, sendTelegram: false.
 *   - Tests are deterministic: same fixture → same result every run.
 */

import { describe, it, expect } from "vitest";
import { validateTradeEventForNotification } from "./validateTradeEvent";
import { formatTradeTelegramMessage } from "./formatTelegramMessage";
import { projectTradeEventForUi } from "./projectTradeEvent";
import { compareTradeEventParity } from "./compareTradeEventParity";
import { hashMessage } from "./notificationLog";
import { runDryRunParity } from "./parityHarness";
import {
  FIXTURE_SWING_ENTRY_READY,
  FIXTURE_SWING_EXIT_SL,
  FIXTURE_SWING_EXIT_TARGET,
  FIXTURE_FNO_ENTRY_OPENED,
  FIXTURE_FNO_SUPPRESSED,
  FIXTURE_FNO_EXIT_SL,
  FIXTURE_FNO_EXIT_TARGET,
  FIXTURE_TESTSTK_BLOCKED,
  FIXTURE_YAHOO_BLOCKED,
  FIXTURE_STALE_BLOCKED,
  FIXTURE_DEV_ENV_BLOCKED,
  FIXTURE_DUPLICATE_BLOCKED,
  ALL_FIXTURES,
} from "./parityFixtures";
import type { CanonicalTradeEvent } from "./types";

// ── T01–T06: Validation block reasons (Part E) ───────────────────────────────

describe("T01-T06 Part E: validateTradeEventForNotification block reasons", () => {

  it("T01 TEST_SYMBOL_BLOCKED — TESTSTK must be blocked at any destination", () => {
    const result = validateTradeEventForNotification(FIXTURE_TESTSTK_BLOCKED.event, {
      destination: "telegram_main",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("TEST_SYMBOL_BLOCKED");
    expect(FIXTURE_TESTSTK_BLOCKED.meta.expectedBlock).toBe("TEST_SYMBOL_BLOCKED");
  });

  it("T02 YAHOO_NOT_ALLOWED — DELAYED sourceStatus must be blocked", () => {
    const result = validateTradeEventForNotification(FIXTURE_YAHOO_BLOCKED.event, {
      destination: "telegram_main",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("YAHOO_NOT_ALLOWED");
    expect(FIXTURE_YAHOO_BLOCKED.meta.expectedBlock).toBe("YAHOO_NOT_ALLOWED");
  });

  it("T03 STALE_DATA_NOT_ALLOWED — STALE sourceStatus must be blocked", () => {
    const result = validateTradeEventForNotification(FIXTURE_STALE_BLOCKED.event, {
      destination: "telegram_main",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("STALE_DATA_NOT_ALLOWED");
    expect(FIXTURE_STALE_BLOCKED.meta.expectedBlock).toBe("STALE_DATA_NOT_ALLOWED");
  });

  it("T04 DEV_ENV_BLOCKED — development environment must be blocked for telegram_main", () => {
    const result = validateTradeEventForNotification(FIXTURE_DEV_ENV_BLOCKED.event, {
      destination: "telegram_main",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("DEV_ENV_BLOCKED");
    expect(FIXTURE_DEV_ENV_BLOCKED.meta.expectedBlock).toBe("DEV_ENV_BLOCKED");
  });

  it("T05 DUPLICATE_EVENT — isDuplicate=true must be blocked", () => {
    const result = validateTradeEventForNotification(FIXTURE_DUPLICATE_BLOCKED.event, {
      destination: "telegram_main",
      isDuplicate: true,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("DUPLICATE_EVENT");
    expect(FIXTURE_DUPLICATE_BLOCKED.meta.expectedBlock).toBe("DUPLICATE_EVENT");
  });

  it("T06 SOURCE_NOT_TRADE_GRADE — INFO_ONLY sourceStatus must be blocked", () => {
    const result = validateTradeEventForNotification(FIXTURE_FNO_SUPPRESSED.event, {
      destination: "telegram_main",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("SOURCE_NOT_TRADE_GRADE");
    expect(FIXTURE_FNO_SUPPRESSED.meta.expectedBlock).toBe("SOURCE_NOT_TRADE_GRADE");
  });
});

// ── T07–T08: Valid signal paths (Part E) ─────────────────────────────────────

describe("T07-T08 Part E: valid signal paths pass internal_only validation", () => {

  it("T07 Swing ENTRY_READY passes internal_only validation", () => {
    const result = validateTradeEventForNotification(FIXTURE_SWING_ENTRY_READY.event, {
      destination: "internal_only",
    });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeNull();
    expect(FIXTURE_SWING_ENTRY_READY.meta.expectedBlock).toBeNull();
  });

  it("T08 F&O ENTRY_OPENED passes internal_only validation", () => {
    const result = validateTradeEventForNotification(FIXTURE_FNO_ENTRY_OPENED.event, {
      destination: "internal_only",
    });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeNull();
    expect(FIXTURE_FNO_ENTRY_OPENED.meta.expectedBlock).toBeNull();
  });
});

// ── T09–T12: projectTradeEventForUi field accuracy (Part B) ──────────────────

describe("T09-T12 Part B: projectTradeEventForUi field accuracy", () => {

  it("T09 Swing projection carries entry, stopLoss, target1 from canonical event", () => {
    const ev = FIXTURE_SWING_ENTRY_READY.event;
    const proj = projectTradeEventForUi(ev);
    expect(proj.entry).toBe(ev.entryPrice);
    expect(proj.stopLoss).toBe(ev.stopLoss);
    expect(proj.target1).toBe(ev.target1);
    expect(proj.target2).toBe(ev.target2);
    expect(proj.symbol).toBe(ev.symbol);
    expect(proj.orderId).toBe(ev.orderId);
    expect(proj.brokerExecutionStatus).toBe("DISABLED");
  });

  it("T10 Swing projection: underlying=null, strike=null, lots=null for equity", () => {
    const proj = projectTradeEventForUi(FIXTURE_SWING_ENTRY_READY.event);
    expect(proj.underlying).toBeNull();
    expect(proj.strike).toBeNull();
    expect(proj.optionType).toBeNull();
    expect(proj.lots).toBeNull();
  });

  it("T11 F&O projection: underlying=NIFTY, optionType=CE, lots=1 (75 shares ÷ 75)", () => {
    const ev = FIXTURE_FNO_ENTRY_OPENED.event;
    const proj = projectTradeEventForUi(ev);
    expect(proj.underlying).toBe("NIFTY");
    expect(proj.optionType).toBe("CE");
    expect(proj.lots).toBe(1);
    expect(proj.strike).toBe(25000);
    expect(proj.entry).toBe(ev.entryPrice);
    expect(proj.confidence).toBe(72);
  });

  it("T12 F&O exit projection carries exitPrice and exitReason", () => {
    const ev = FIXTURE_FNO_EXIT_SL.event;
    const proj = projectTradeEventForUi(ev);
    expect(proj.exitPrice).toBe(ev.exitPrice);
    expect(proj.exitReason).toBe(ev.exitReason);
    expect(proj.paperTradeStatus).toBe("CLOSED");
  });
});

// ── T13–T16: compareTradeEventParity mismatch detection (Part C) ─────────────

describe("T13-T16 Part C: compareTradeEventParity mismatch detection", () => {

  it("T13 No mismatches on clean fixture — ok=true", () => {
    const result = compareTradeEventParity({
      canonicalEvent: FIXTURE_SWING_ENTRY_READY.event,
    });
    expect(result.ok).toBe(true);
    expect(result.mismatches).toHaveLength(0);
    expect(result.blockedReasons).toHaveLength(0);
    expect(result.telegramMessageHash).toMatch(/^[a-f0-9]{16}$/);
  });

  it("T14 UI symbol mismatch is detected as P0 severity", () => {
    const ev = FIXTURE_SWING_ENTRY_READY.event;
    const badProjection = { ...projectTradeEventForUi(ev), symbol: "WRONGSYMBOL" };
    const result = compareTradeEventParity({
      canonicalEvent: ev,
      uiProjection:   badProjection,
    });
    expect(result.ok).toBe(false);
    const mm = result.mismatches.find((m) => m.field === "symbol");
    expect(mm).toBeDefined();
    expect(mm!.severity).toBe("P0");
    expect(mm!.canonical).toBe("RELIANCE");
    expect(mm!.ui).toBe("WRONGSYMBOL");
  });

  it("T15 UI entry price mismatch is detected as P0 severity", () => {
    const ev = FIXTURE_SWING_ENTRY_READY.event;
    const badProjection = { ...projectTradeEventForUi(ev), entry: 9999 };
    const result = compareTradeEventParity({
      canonicalEvent: ev,
      uiProjection:   badProjection,
    });
    expect(result.ok).toBe(false);
    const mm = result.mismatches.find((m) => m.field === "entry");
    expect(mm).toBeDefined();
    expect(mm!.severity).toBe("P0");
  });

  it("T16 DB message hash mismatch adds a warning (not a mismatch field)", () => {
    const ev = FIXTURE_FNO_ENTRY_OPENED.event;
    const result = compareTradeEventParity({
      canonicalEvent: ev,
      dbSnapshot: { messageHash: "deadbeef12345678" },
    });
    // hash mismatch → warning added, but ok may still be true (no field mismatches)
    expect(result.hashMatch).toBe(false);
    expect(result.warnings.some((w) => w.includes("hash mismatch"))).toBe(true);
  });
});

// ── T17–T18: dry-run parity run (Part F) ─────────────────────────────────────

describe("T17-T18 Part F: runDryRunParity — no Telegram, no DB, no paper trade", () => {

  it("T17 dry_run on valid swing fixture returns ok=true, telegramSent=false", async () => {
    const result = await runDryRunParity(FIXTURE_SWING_ENTRY_READY.event, "dry_run");
    expect(result.mode).toBe("dry_run");
    expect(result.telegramSent).toBe(false);
    expect(result.telegramDestination).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.parity.mismatches).toHaveLength(0);
    expect(result.validationResult.allowed).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("T18 dry_run on F&O exit fixture returns ok=true, parity clean", async () => {
    const result = await runDryRunParity(FIXTURE_FNO_EXIT_SL.event, "dry_run");
    expect(result.mode).toBe("dry_run");
    expect(result.telegramSent).toBe(false);
    expect(result.ok).toBe(true);
    expect(result.parity.mismatches).toHaveLength(0);
    expect(result.parity.telegramText).toContain("STOP-LOSS");
    expect(result.parity.telegramText).toContain("NIFTY");
  });
});

// ── T19–T20: Formatter determinism + hash stability (Part I) ─────────────────

describe("T19-T20 Part I: Telegram formatter determinism and hash stability", () => {

  it("T19 Same canonical event produces identical Telegram text across two calls", () => {
    const ev = FIXTURE_FNO_ENTRY_OPENED.event;
    const text1 = formatTradeTelegramMessage(ev);
    const text2 = formatTradeTelegramMessage(ev);
    expect(text1).toBe(text2);
    expect(hashMessage(text1)).toBe(hashMessage(text2));
  });

  it("T20 All 14 fixtures produce a non-empty Telegram message and a 16-hex hash", () => {
    for (const fixture of ALL_FIXTURES) {
      const text = formatTradeTelegramMessage(fixture.event);
      expect(text.length).toBeGreaterThan(10);
      const h = hashMessage(text);
      expect(h).toMatch(/^[a-f0-9]{16}$/);
    }
  });
});

// ── Bonus: meta invariants ────────────────────────────────────────────────────

describe("Bonus: fixture meta invariants", () => {

  it("All 14 fixtures have fixtureOnly=true, environment=test, sendTelegram=false", () => {
    for (const fixture of ALL_FIXTURES) {
      expect(fixture.meta.fixtureOnly).toBe(true);
      expect(fixture.meta.environment).toBe("test");
      expect(fixture.meta.sendTelegram).toBe(false);
    }
  });

  it("All 14 fixture canonical events use a known harness environment value", () => {
    const ALLOWED_ENVS = new Set(["test", "development", "production"]);
    // DEV_ENV_BLOCKED fixture must be "development" (tests env isolation).
    // Fixtures testing data-trust gates use "production" so DEV_ENV_BLOCKED
    // doesn't fire before the targeted check. All remaining fixtures use "test".
    const DEV_ENV_BLOCK_CODES = new Set(["DEV_ENV_BLOCKED"]);
    const DATA_TRUST_BLOCK_CODES = new Set([
      "YAHOO_NOT_ALLOWED", "STALE_DATA_NOT_ALLOWED",
      "SOURCE_NOT_TRADE_GRADE", "DUPLICATE_EVENT",
    ]);
    for (const fixture of ALL_FIXTURES) {
      expect(ALLOWED_ENVS.has(fixture.event.environment)).toBe(true);
      if (DEV_ENV_BLOCK_CODES.has(fixture.meta.expectedBlock ?? "")) {
        expect(fixture.event.environment).toBe("development");
      } else if (DATA_TRUST_BLOCK_CODES.has(fixture.meta.expectedBlock ?? "")) {
        expect(fixture.event.environment).toBe("production");
      } else {
        expect(fixture.event.environment).toBe("test");
      }
    }
  });

  it("All 14 fixture canonical events have brokerExecutionStatus=DISABLED", () => {
    for (const fixture of ALL_FIXTURES) {
      expect(fixture.event.brokerExecutionStatus).toBe("DISABLED");
    }
  });

  it("Swing exit fixtures carry exitPrice and exitReason", () => {
    for (const fixture of [FIXTURE_SWING_EXIT_SL, FIXTURE_SWING_EXIT_TARGET]) {
      expect(fixture.event.exitPrice).not.toBeNull();
      expect(fixture.event.exitReason).not.toBeNull();
    }
  });

  it("F&O exit fixtures carry exitPrice and exitReason", () => {
    for (const fixture of [FIXTURE_FNO_EXIT_SL, FIXTURE_FNO_EXIT_TARGET]) {
      expect(fixture.event.exitPrice).not.toBeNull();
      expect(fixture.event.exitReason).not.toBeNull();
    }
  });
});
