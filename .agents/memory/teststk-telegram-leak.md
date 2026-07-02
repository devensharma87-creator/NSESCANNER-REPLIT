---
name: TESTSTK reaches real Telegram in tests
description: Existing unit tests with TESTSTK DO fire real Telegram alerts because swingAlerts.ts uses the real bot token; validateTradeEventForNotification guard must be wired in to block this.
---

## Rule
Test logs from `swingOrderStaging.test.ts` confirm: `Telegram alert delivered — alertEvent: "SWING_ORDER_STAGED:uuid" — telegramStatus: "SENT"` for TESTSTK orders. The test suite uses a real bot token and a real Telegram delivery path — NOT mocked.

## Why
`swingAlerts.ts` calls `alertOwnerRaw` which calls the real Telegram bot. Tests that exercise `stageSwingOrder()` and similar functions trigger real Telegram alerts with TESTSTK as the symbol.

## Impact
Any production Telegram channel receiving the bot's messages will see TESTSTK alerts whenever the test suite runs (if the bot token is the same as production). This explains historical "TESTSTK on Telegram" reports.

## Fix (Implemented)
`validateTradeEventForNotification()` in `tradeLifecycle/validateTradeEvent.ts` blocks any symbol matching `["TESTSTK", "TEST", "SAMPLE", "DUMMY"]` or `/^TEST/i` with reason code `TEST_SYMBOL_BLOCKED`.

**This guard is not yet wired into `swingAlerts.ts`** — that is a follow-up task. The guard must be called BEFORE `alertOwnerRaw` for canonical trade events.

## How to Apply
Before adding any test that calls staging/alert functions: either mock `alertOwnerRaw` or use a test-only bot token. The canonical path is: build `CanonicalTradeEvent` → call `validateTradeEventForNotification(event)` → if allowed, dispatch.
