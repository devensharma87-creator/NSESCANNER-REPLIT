---
name: tradeLifecycle module — canonical foundation
description: CanonicalTradeEvent types + validate/format/dedup — additive foundation not yet wired into existing alert functions; follow-up task required to migrate swingAlerts and fnoSignalAlerts.
---

## Module Location
`artifacts/api-server/src/lib/tradeLifecycle/`

## What's In It
- `types.ts` — `CanonicalTradeEvent`, `TradeDomain`, `TradeLifecycleStatus`, `TradeAlertEventType`, `ValidationBlockReason`, `NotificationDeliveryEntry`
- `validateTradeEvent.ts` — `validateTradeEventForNotification(event, ctx)` — pure, sync, 12 reason codes
- `formatTelegramMessage.ts` — `formatTradeTelegramMessage(event)` — single canonical formatter, entry/exit for SWING_CASH and FNO_INTRADAY
- `notificationLog.ts` — DB-backed dedup: `notification_delivery_log` table (raw SQL), `hasAlreadyDelivered()`, `logNotificationDelivery()`, `gateAndLogDedup()`
- `index.ts` — barrel re-exports

## What It Is NOT (Yet)
The module is additive foundation. Existing `swingAlerts.ts`, `fnoSignalAlerts.ts`, and `alerting.ts` are unchanged. The canonical formatter and guard are not yet called from production alert paths.

**Why:** Migrating existing alert functions requires product decisions (which lifecycle events go to main trade channel vs. internal-only) and is a separate follow-up task.

## notification_delivery_log Table
Created via raw `CREATE TABLE IF NOT EXISTS` (not drizzle-kit — avoids DROP risk). Dedup index on `(domain, event_type, destination, COALESCE(order_id, signal_id, paper_trade_id, event_id))`.

## How to Apply
To wire a new alert through the canonical path:
1. Build a `CanonicalTradeEvent` with all required fields
2. Call `validateTradeEventForNotification(event, { destination: "telegram_main" })` — if `allowed: false`, log and skip
3. Call `const text = formatTradeTelegramMessage(event)` for the message text
4. Call `gateAndLogDedup(event, "telegram_main", text)` to check DB dedup
5. Send via existing `alertOwnerRaw(text)` if shouldSend
6. Log delivery with `logNotificationDelivery({ ..., status: "SENT" })`

## Why
`canDriveTradeAlerts` INVARIANT: must only be true when sourceStatus is TRADE_GRADE. Yahoo/delayed/stale/manual sources must never produce trade channel alerts.
