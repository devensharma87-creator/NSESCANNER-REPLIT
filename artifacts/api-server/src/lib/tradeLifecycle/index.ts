/**
 * tradeLifecycle — canonical trade event types, validation, formatting, and
 * notification idempotency for the Indian Stock Market Scanner.
 *
 * Public surface:
 *   types.ts             — CanonicalTradeEvent, TradeDomain, TradeLifecycleStatus, etc.
 *   validateTradeEvent   — validateTradeEventForNotification() guard (pure, sync)
 *   formatTelegramMessage — formatTradeTelegramMessage() canonical formatter
 *   notificationLog      — DB-backed dedup: initNotificationLog(), gateAndLogDedup(), etc.
 */

export type {
  TradeDomain,
  TradeLifecycleStatus,
  TradeAlertEventType,
  CanonicalTradeEvent,
  ValidationBlockReason,
  ValidationResult,
  NotificationDestination,
  NotificationDeliveryEntry,
} from "./types";

export {
  validateTradeEventForNotification,
  isTradeEventAllowed,
  type ValidationContext,
} from "./validateTradeEvent";

export { formatTradeTelegramMessage } from "./formatTelegramMessage";

export {
  initNotificationLog,
  hashMessage,
  buildDedupKey,
  hasAlreadyDelivered,
  logNotificationDelivery,
  markDeliveryFailed,
  gateAndLogDedup,
} from "./notificationLog";

export { projectTradeEventForUi, type TradeEventUiProjection } from "./projectTradeEvent";

export {
  compareTradeEventParity,
  type ParityResult,
  type ParityMismatch,
  type ParityCompareInput,
  type DbNotificationSnapshot,
  type PaperTradeSnapshot,
} from "./compareTradeEventParity";

export {
  runDryRunParity,
  replayFromNotificationLog,
  loadLatestNotificationLogRecords,
  buildParityStatusSummary,
  runAllFixtureParity,
  type ParityMode,
  type ParityRunResult,
  type ReplayRecord,
  type ReplayResult,
  type ParityStatusSummary,
} from "./parityHarness";

export {
  ALL_FIXTURES,
  FIXTURE_SWING_ENTRY_READY,
  FIXTURE_FNO_ENTRY_OPENED,
  type Fixture,
  type FixtureMetadata,
} from "./parityFixtures";
