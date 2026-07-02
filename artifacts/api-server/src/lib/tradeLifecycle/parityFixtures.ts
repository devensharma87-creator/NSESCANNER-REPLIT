/**
 * parityFixtures — deterministic canonical trade event fixtures.
 *
 * Part E of the Deterministic Parity Verification Harness.
 *
 * All fixtures are clearly marked:
 *   fixtureOnly: true
 *   environment: "test"
 *   sendTelegram: false
 *
 * ABSOLUTE RULES:
 *   - No fixture may use a real production Telegram destination.
 *   - No fixture may create a real paper trade.
 *   - All events use environment: "test" — DEV_ENV_BLOCKED blocks production Telegram.
 *   - No real Kite session, no real prices (all synthetic/known values).
 *   - Fixtures are for testing compareTradeEventParity, validateTradeEventForNotification,
 *     formatTradeTelegramMessage, and projectTradeEventForUi only.
 */

import type { CanonicalTradeEvent } from "./types";

// ── Fixture metadata ──────────────────────────────────────────────────────────

export interface FixtureMetadata {
  fixtureOnly:   true;
  environment:   "test";
  sendTelegram:  false;
  description:   string;
  expectedBlock: string | null;
}

export interface Fixture {
  meta:  FixtureMetadata;
  event: CanonicalTradeEvent;
}

// ── Shared base event helpers ─────────────────────────────────────────────────

function swingBase(overrides: Partial<CanonicalTradeEvent> = {}): CanonicalTradeEvent {
  return {
    id:                    "fixture-swing-001",
    domain:                "SWING_CASH",
    eventType:             "ENTRY_READY",
    lifecycleStatus:       "ENTRY_READY",
    signalId:              null,
    orderId:               "ord-fixture-001",
    paperTradeId:          null,
    symbol:                "RELIANCE",
    tradingSymbol:         "NSE:RELIANCE",
    exchange:              "NSE",
    instrumentToken:       738561,
    assetType:             "equity",
    side:                  "BUY",
    setupName:             "Breakout_Pullback",
    confidence:            null,
    entryPrice:            1400.00,
    stopLoss:              1344.00,
    target1:               1512.00,
    target2:               1568.00,
    exitPrice:             null,
    exitReason:            null,
    quantity:              3,
    capitalRequired:       4200.00,
    maxRisk:               168.00,
    riskPercent:           0.168,
    riskReward:            2.00,
    source:                "kite",
    sourceStatus:          "TRADE_GRADE",
    sourceAsOf:            "2026-07-01T09:03:00.000Z",
    canDriveSignals:       true,
    canDriveTradeAlerts:   true,
    brokerExecutionStatus: "DISABLED",
    paperTradeStatus:      "STAGED",
    environment:           "test",
    createdAt:             "2026-07-01T09:03:30.000Z",
    entryTime:             null,
    exitTime:              null,
    appUrl:                "/swing-queue",
    warnings:              [],
    ...overrides,
  };
}

function fnoBase(overrides: Partial<CanonicalTradeEvent> = {}): CanonicalTradeEvent {
  return {
    id:                    "fixture-fno-001",
    domain:                "FNO_INTRADAY",
    eventType:             "ENTRY_OPENED",
    lifecycleStatus:       "OPEN",
    signalId:              "sig-fixture-001",
    orderId:               null,
    paperTradeId:          "pt-fixture-001",
    symbol:                "NIFTY",
    tradingSymbol:         "NFO:NIFTY26JUL25000CE",
    exchange:              "NFO",
    instrumentToken:       12345678,
    assetType:             "option",
    side:                  "CALL",
    setupName:             "EMA_TREND_RETEST",
    confidence:            72,
    entryPrice:            125.00,
    stopLoss:               80.00,
    target1:               200.00,
    target2:               280.00,
    exitPrice:             null,
    exitReason:            null,
    quantity:              75,
    capitalRequired:       9375.00,
    maxRisk:               3375.00,
    riskPercent:           0.3375,
    riskReward:            1.67,
    source:                "kite",
    sourceStatus:          "TRADE_GRADE",
    sourceAsOf:            "2026-07-01T09:30:00.000Z",
    canDriveSignals:       true,
    canDriveTradeAlerts:   true,
    brokerExecutionStatus: "DISABLED",
    paperTradeStatus:      "OPEN",
    environment:           "test",
    createdAt:             "2026-07-01T09:30:15.000Z",
    entryTime:             "2026-07-01T09:30:15.000Z",
    exitTime:              null,
    appUrl:                "/fno",
    warnings:              [],
    ...overrides,
  };
}

// ── The 14 deterministic fixtures ─────────────────────────────────────────────

/**
 * Fixture 1 — Valid Swing ENTRY_READY
 * Kite source, TRADE_GRADE, production-safe symbol, valid risk fields.
 * Expected: validateTradeEventForNotification({destination:"internal_only"}) → allowed
 */
export const FIXTURE_SWING_ENTRY_READY: Fixture = {
  meta: {
    fixtureOnly:   true,
    environment:   "test",
    sendTelegram:  false,
    description:   "Valid Swing ENTRY_READY — Kite TRADE_GRADE, RELIANCE",
    expectedBlock: null,
  },
  event: swingBase(),
};

/**
 * Fixture 2 — Swing ENTRY_APPROVAL_REQUIRED (treated as ENTRY_READY by alerter)
 * Both STAGED and APPROVAL_REQUIRED rows emit a single ENTRY_READY canonical event.
 * Expected: allowed (same pipeline as ENTRY_READY)
 */
export const FIXTURE_SWING_APPROVAL_REQUIRED: Fixture = {
  meta: {
    fixtureOnly:   true,
    environment:   "test",
    sendTelegram:  false,
    description:   "Swing ENTRY_APPROVAL_REQUIRED — still a valid canonical event",
    expectedBlock: null,
  },
  event: swingBase({ lifecycleStatus: "ENTRY_APPROVAL_REQUIRED" }),
};

/**
 * Fixture 3 — Swing DRY_RUN after approval
 * paperTradeStatus = "DRY_RUN" — not a real position, but still a valid event.
 * No Telegram in the lifecycle (alertSwingOrderApprovedDryRun is logger.info only).
 * This fixture is used to verify the dry-run path sends no Telegram.
 * Expected: allowed from validation perspective, but not dispatched by swingAlerts.ts
 */
export const FIXTURE_SWING_DRY_RUN: Fixture = {
  meta: {
    fixtureOnly:   true,
    environment:   "test",
    sendTelegram:  false,
    description:   "Swing DRY_RUN — validated but never reaches Telegram (lifecycle-only)",
    expectedBlock: null,
  },
  event: swingBase({
    id:               "fixture-swing-dryrun",
    paperTradeStatus: "DRY_RUN",
    lifecycleStatus:  "ENTRY_APPROVED",
  }),
};

/**
 * Fixture 4 — Swing EXIT_STOP_LOSS
 * Exit event with exitPrice, exitReason, exitTime set.
 * Expected: allowed (exit events are trade-channel-worthy)
 */
export const FIXTURE_SWING_EXIT_SL: Fixture = {
  meta: {
    fixtureOnly:   true,
    environment:   "test",
    sendTelegram:  false,
    description:   "Swing EXIT_STOP_LOSS — valid exit event",
    expectedBlock: null,
  },
  event: swingBase({
    id:              "fixture-swing-exit-sl",
    eventType:       "EXIT_STOP_LOSS",
    lifecycleStatus: "EXITED_STOP_LOSS",
    exitPrice:       1344.00,
    exitReason:      "Stop-loss triggered",
    exitTime:        "2026-07-01T11:30:00.000Z",
    entryTime:       "2026-07-01T09:03:30.000Z",
    paperTradeStatus: "CLOSED",
  }),
};

/**
 * Fixture 5 — Swing EXIT_TARGET_1
 * Expected: allowed (target exit is trade-channel-worthy)
 */
export const FIXTURE_SWING_EXIT_TARGET: Fixture = {
  meta: {
    fixtureOnly:   true,
    environment:   "test",
    sendTelegram:  false,
    description:   "Swing EXIT_TARGET_1 — valid target exit event",
    expectedBlock: null,
  },
  event: swingBase({
    id:              "fixture-swing-exit-t1",
    eventType:       "EXIT_TARGET_1",
    lifecycleStatus: "EXITED_TARGET_1",
    exitPrice:       1512.00,
    exitReason:      "Target 1 hit",
    exitTime:        "2026-07-02T10:00:00.000Z",
    entryTime:       "2026-07-01T09:03:30.000Z",
    paperTradeStatus: "CLOSED",
  }),
};

/**
 * Fixture 6 — Valid F&O ENTRY_OPENED
 * NIFTY CALL option, lots=1, lotSize=75, confidence=72.
 * Expected: allowed (F&O tradeable paper-opened signal)
 */
export const FIXTURE_FNO_ENTRY_OPENED: Fixture = {
  meta: {
    fixtureOnly:   true,
    environment:   "test",
    sendTelegram:  false,
    description:   "Valid F&O ENTRY_OPENED — NIFTY CALL, Kite TRADE_GRADE",
    expectedBlock: null,
  },
  event: fnoBase(),
};

/**
 * Fixture 7 — F&O suppressed / info-only (shouldSendFnoTradeAlert → false)
 * sourceStatus = INFO_ONLY — canDriveTradeAlerts false.
 * environment="production" so DEV_ENV_BLOCKED does NOT fire first; this
 * fixture specifically tests the SOURCE_NOT_TRADE_GRADE data-trust gate.
 * Expected: blocked by SOURCE_NOT_TRADE_GRADE in validateTradeEventForNotification
 */
export const FIXTURE_FNO_SUPPRESSED: Fixture = {
  meta: {
    fixtureOnly:   true,
    environment:   "test",
    sendTelegram:  false,
    description:   "F&O suppressed/info-only — sourceStatus INFO_ONLY → SOURCE_NOT_TRADE_GRADE",
    expectedBlock: "SOURCE_NOT_TRADE_GRADE",
  },
  event: fnoBase({
    id:                   "fixture-fno-suppressed",
    sourceStatus:         "INFO_ONLY",
    canDriveSignals:      false,
    canDriveTradeAlerts:  false,
    environment:          "production",
  }),
};

/**
 * Fixture 8 — F&O EXIT_STOP_LOSS
 * Mirrors buildFnoExitCanonicalEvent's real production shape (2026-07-02
 * canonical Telegram migration): a close reports a committed DB premium,
 * not a live quote — sourceStatus INFO_ONLY, canDriveSignals/canDriveTradeAlerts
 * false, source "computed_from_kite". isEntryEvent-gated checks (#8-#12 in
 * validateTradeEvent.ts) do not apply to EXIT_* events, so this still passes.
 * Expected: allowed (F&O exit event after close transaction)
 */
export const FIXTURE_FNO_EXIT_SL: Fixture = {
  meta: {
    fixtureOnly:   true,
    environment:   "test",
    sendTelegram:  false,
    description:   "F&O EXIT_STOP_LOSS — valid exit event after close tx (INFO_ONLY, honest)",
    expectedBlock: null,
  },
  event: fnoBase({
    id:                  "fixture-fno-exit-sl",
    eventType:           "EXIT_STOP_LOSS",
    lifecycleStatus:     "EXITED_STOP_LOSS",
    exitPrice:            80.00,
    exitReason:          "Stop-loss triggered",
    entryTime:           "2026-07-01T09:30:15.000Z",
    exitTime:            "2026-07-01T11:00:00.000Z",
    paperTradeStatus:    "CLOSED",
    source:              "computed_from_kite",
    sourceStatus:        "INFO_ONLY",
    canDriveSignals:     false,
    canDriveTradeAlerts: false,
    instrumentToken:     null,
    exchange:            "INDEX",
  }),
};

/**
 * Fixture 9 — F&O EXIT_TARGET_2
 * Same honest INFO_ONLY shape as Fixture 8 — see its comment.
 * Expected: allowed (F&O target exit event)
 */
export const FIXTURE_FNO_EXIT_TARGET: Fixture = {
  meta: {
    fixtureOnly:   true,
    environment:   "test",
    sendTelegram:  false,
    description:   "F&O EXIT_TARGET_2 — valid target exit event (INFO_ONLY, honest)",
    expectedBlock: null,
  },
  event: fnoBase({
    id:                  "fixture-fno-exit-t2",
    eventType:           "EXIT_TARGET_2",
    lifecycleStatus:     "EXITED_TARGET_2",
    exitPrice:           280.00,
    exitReason:          "Target 2 hit",
    entryTime:           "2026-07-01T09:30:15.000Z",
    exitTime:            "2026-07-01T14:00:00.000Z",
    paperTradeStatus:    "CLOSED",
    source:              "computed_from_kite",
    sourceStatus:        "INFO_ONLY",
    canDriveSignals:     false,
    canDriveTradeAlerts: false,
    instrumentToken:     null,
    exchange:            "INDEX",
  }),
};

/**
 * Fixture 15 — F&O EXIT_MANUAL (owner-initiated close)
 * source="manual" per buildFnoExitCanonicalEvent's MANUAL_OVERRIDE branch.
 * Expected: allowed (F&O manual exit event)
 */
export const FIXTURE_FNO_EXIT_MANUAL: Fixture = {
  meta: {
    fixtureOnly:   true,
    environment:   "test",
    sendTelegram:  false,
    description:   "F&O EXIT_MANUAL — owner-initiated close, source=manual (INFO_ONLY, honest)",
    expectedBlock: null,
  },
  event: fnoBase({
    id:                  "fixture-fno-exit-manual",
    eventType:           "EXIT_MANUAL",
    lifecycleStatus:     "EXITED_MANUAL",
    exitPrice:           140.00,
    exitReason:          "MANUAL_OVERRIDE",
    entryTime:           "2026-07-01T09:30:15.000Z",
    exitTime:            "2026-07-01T12:15:00.000Z",
    paperTradeStatus:    "CLOSED",
    source:              "manual",
    sourceStatus:        "INFO_ONLY",
    canDriveSignals:     false,
    canDriveTradeAlerts: false,
    instrumentToken:     null,
    exchange:            "INDEX",
  }),
};

/**
 * Fixture 10 — TESTSTK blocked
 * Expected: blocked by TEST_SYMBOL_BLOCKED (exact match in blocklist)
 */
export const FIXTURE_TESTSTK_BLOCKED: Fixture = {
  meta: {
    fixtureOnly:   true,
    environment:   "test",
    sendTelegram:  false,
    description:   "TESTSTK — must be blocked by TEST_SYMBOL_BLOCKED",
    expectedBlock: "TEST_SYMBOL_BLOCKED",
  },
  event: swingBase({
    id:     "fixture-teststk",
    symbol: "TESTSTK",
    tradingSymbol: "NSE:TESTSTK",
  }),
};

/**
 * Fixture 11 — Yahoo source blocked (sourceStatus = DELAYED)
 * environment="production" so DEV_ENV_BLOCKED does NOT fire first; this
 * fixture specifically tests the YAHOO_NOT_ALLOWED data-trust gate.
 * Expected: blocked by YAHOO_NOT_ALLOWED
 */
export const FIXTURE_YAHOO_BLOCKED: Fixture = {
  meta: {
    fixtureOnly:   true,
    environment:   "test",
    sendTelegram:  false,
    description:   "Yahoo DELAYED source — must be blocked by YAHOO_NOT_ALLOWED",
    expectedBlock: "YAHOO_NOT_ALLOWED",
  },
  event: swingBase({
    id:                   "fixture-yahoo",
    source:               "kite",
    sourceStatus:         "DELAYED",
    canDriveSignals:      false,
    canDriveTradeAlerts:  false,
    environment:          "production",
  }),
};

/**
 * Fixture 12 — Stale source blocked (sourceStatus = STALE)
 * environment="production" so DEV_ENV_BLOCKED does NOT fire first; this
 * fixture specifically tests the STALE_DATA_NOT_ALLOWED data-trust gate.
 * Expected: blocked by STALE_DATA_NOT_ALLOWED
 */
export const FIXTURE_STALE_BLOCKED: Fixture = {
  meta: {
    fixtureOnly:   true,
    environment:   "test",
    sendTelegram:  false,
    description:   "Stale source — must be blocked by STALE_DATA_NOT_ALLOWED",
    expectedBlock: "STALE_DATA_NOT_ALLOWED",
  },
  event: swingBase({
    id:                   "fixture-stale",
    source:               "kite",
    sourceStatus:         "STALE",
    canDriveSignals:      false,
    canDriveTradeAlerts:  false,
    environment:          "production",
  }),
};

/**
 * Fixture 13 — Dev environment blocked (environment = "development")
 * Expected: blocked by DEV_ENV_BLOCKED when destination = "telegram_main"
 */
export const FIXTURE_DEV_ENV_BLOCKED: Fixture = {
  meta: {
    fixtureOnly:   true,
    environment:   "test",
    sendTelegram:  false,
    description:   "Dev environment — blocked by DEV_ENV_BLOCKED for telegram_main",
    expectedBlock: "DEV_ENV_BLOCKED",
  },
  event: swingBase({
    id:          "fixture-dev-env",
    environment: "development",
  }),
};

/**
 * Fixture 14 — Duplicate lifecycle event
 * Same orderId as Fixture 1 — caller sets isDuplicate:true in context.
 * environment="production" so DEV_ENV_BLOCKED does NOT fire first; all
 * data-trust checks pass so the DUPLICATE_EVENT check is reached.
 * Expected: blocked by DUPLICATE_EVENT
 */
export const FIXTURE_DUPLICATE_BLOCKED: Fixture = {
  meta: {
    fixtureOnly:   true,
    environment:   "test",
    sendTelegram:  false,
    description:   "Duplicate event — blocked by DUPLICATE_EVENT when isDuplicate=true",
    expectedBlock: "DUPLICATE_EVENT",
  },
  event: swingBase({
    id:          "fixture-duplicate",
    orderId:     "ord-fixture-001",
    environment: "production",
  }),
};

// ── All fixtures export ────────────────────────────────────────────────────────

export const ALL_FIXTURES: Fixture[] = [
  FIXTURE_SWING_ENTRY_READY,
  FIXTURE_SWING_APPROVAL_REQUIRED,
  FIXTURE_SWING_DRY_RUN,
  FIXTURE_SWING_EXIT_SL,
  FIXTURE_SWING_EXIT_TARGET,
  FIXTURE_FNO_ENTRY_OPENED,
  FIXTURE_FNO_SUPPRESSED,
  FIXTURE_FNO_EXIT_SL,
  FIXTURE_FNO_EXIT_TARGET,
  FIXTURE_FNO_EXIT_MANUAL,
  FIXTURE_TESTSTK_BLOCKED,
  FIXTURE_YAHOO_BLOCKED,
  FIXTURE_STALE_BLOCKED,
  FIXTURE_DEV_ENV_BLOCKED,
  FIXTURE_DUPLICATE_BLOCKED,
];
