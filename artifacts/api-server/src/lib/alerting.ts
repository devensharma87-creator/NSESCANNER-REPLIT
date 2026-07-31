/**
 * Owner-alert system — Phase 2: structured WARN log + Telegram delivery.
 *
 * Telegram is enabled only when BOTH TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID
 * are set as Replit secrets. Missing either → WARN-log stub only (fail-closed).
 *
 * Wire ONLY at cycle boundaries, never on per-tick hot paths.
 * NEVER log secrets, session tokens, or user data here.
 * Alert delivery is best-effort and MUST NOT crash the F&O signal cycle.
 */
import { logger } from "./logger";
import { claimSystemAlert } from "./systemAlertDedup";

// ── Skip diagnostics (T005: /alerts/system-health) ──────────────────────────
// In-memory only (per-process, resets on restart) — a lightweight companion
// to the DB-backed claim log so the diagnostics endpoint can show how often
// THIS worker's dedup is actually suppressing duplicates, not just the last
// successful send. Never persisted, never used for any dedup decision.

interface SkippedAlertStats {
  totalSkipped: number;
  lastSkipped: { dedupKey: string; family: string; at: number } | null;
}

const skippedAlertStats: SkippedAlertStats = { totalSkipped: 0, lastSkipped: null };

function recordSkippedAlert(dedupKey: string, family: string): void {
  skippedAlertStats.totalSkipped += 1;
  skippedAlertStats.lastSkipped = { dedupKey, family, at: Date.now() };
}

/** Owner-diagnostics snapshot of skipped (already-claimed-elsewhere) alerts. Test-resettable. */
export function getSkippedAlertStats(): SkippedAlertStats {
  return { totalSkipped: skippedAlertStats.totalSkipped, lastSkipped: skippedAlertStats.lastSkipped };
}

/** Reset in-memory skip counter — test-only. */
export function resetSkippedAlertStatsForTest(): void {
  skippedAlertStats.totalSkipped = 0;
  skippedAlertStats.lastSkipped = null;
}

// ── Telegram config ──────────────────────────────────────────────────────────

export type TelegramConfigStatus =
  | "TELEGRAM_ENABLED"
  | "TELEGRAM_DISABLED_MISSING_TOKEN"
  | "TELEGRAM_DISABLED_MISSING_CHAT_ID"
  | "TELEGRAM_DISABLED_MISSING_CONFIG";

type TelegramConfig =
  | { enabled: false; status: Exclude<TelegramConfigStatus, "TELEGRAM_ENABLED"> }
  | { enabled: true; status: "TELEGRAM_ENABLED"; token: string; chatId: string };

/**
 * Read Telegram config lazily from process.env so tests can stub env vars
 * without module resets, and a process restart picks up new secrets.
 * NEVER log or return token/chatId from this function.
 */
function getTelegramConfig(): TelegramConfig {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  const chatId = process.env["TELEGRAM_CHAT_ID"];
  if (!token && !chatId) return { enabled: false, status: "TELEGRAM_DISABLED_MISSING_CONFIG" };
  if (!token) return { enabled: false, status: "TELEGRAM_DISABLED_MISSING_TOKEN" };
  if (!chatId) return { enabled: false, status: "TELEGRAM_DISABLED_MISSING_CHAT_ID" };
  return { enabled: true, status: "TELEGRAM_ENABLED", token, chatId };
}

/** Returns Telegram config status — safe to expose publicly (no secrets). */
export function getTelegramStatus(): { enabled: boolean; status: TelegramConfigStatus } {
  const cfg = getTelegramConfig();
  return { enabled: cfg.enabled, status: cfg.status };
}

// ── Alert diagnostics (in-memory, non-sensitive) ─────────────────────────────

export type TelegramDeliveryStatus = "SENT" | "STUB_NO_CONFIG" | "SEND_FAILED";

export interface AlertRecord {
  event: string;
  at: number;
  telegramStatus: TelegramDeliveryStatus;
  errorCode?: string;
}

let lastAlertRecord: AlertRecord | null = null;

/** Returns a copy of the most recent alert record (no secrets). */
export function getLastAlertRecord(): AlertRecord | null {
  return lastAlertRecord ? { ...lastAlertRecord } : null;
}

/** Reset last alert record (useful in tests). */
export function resetLastAlertRecord(): void {
  lastAlertRecord = null;
}

// ── Alert metadata ────────────────────────────────────────────────────────────

export interface AlertMetadata {
  affectedIndices?: string[];
  lastSignalAt?: string;
  gapTradingDays?: number;
  kiteSessionStatus?: string;
  dashboardPath?: string;
  isDataIssue?: boolean;
  recoveredAt?: string;
}

// ── Dedup ─────────────────────────────────────────────────────────────────────

/** Default dedup window: at most one alert per event per hour. */
const DEDUP_WINDOW_MS = 60 * 60 * 1000;

/** Track last-alert epoch-ms per event key. Resets on process restart. */
const lastAlerted = new Map<string, number>();

/** Reset dedup state for `event` (useful in tests). */
export function resetAlertDedup(event?: string): void {
  if (event) lastAlerted.delete(event);
  else lastAlerted.clear();
}

// ── Message formatting ────────────────────────────────────────────────────────

function formatIstTime(isoString: string): string {
  try {
    return new Date(isoString).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return isoString;
  }
}

// ── Priority tiers ────────────────────────────────────────────────────────────
// Every owner alert carries a priority. WARN is the historical default
// (all existing callers → WARN implicitly), so behaviour is unchanged for
// existing alerts. INFO is for success/recovery events; CRITICAL for
// severe threshold breaches. The prefix is prepended only for generic
// F&O alerts where it disambiguates severity inline.
export type AlertPriority = "CRITICAL" | "WARN" | "INFO";

const PRIORITY_PREFIX: Record<AlertPriority, string> = {
  CRITICAL: "🔴 [CRITICAL]",
  WARN: "⚠️ [WARN]",
  INFO: "ℹ️ [INFO]",
};

// ── Event-category routing ────────────────────────────────────────────────────

/**
 * Events whose alerts represent a resolved / successful state.
 * These receive a ✅ header and show message as completion text (no "Detail:" prefix).
 */
const SUCCESS_EVENTS = new Set([
  "EOD_RECONCILIATION_OK",
  "INSTRUMENTS_REFRESH_RECOVERED",
  "CLOCK_DRIFT_RECOVERED",
  "FNO_DATA_RECOVERED",
]);

/**
 * Per-event header. Generic F&O/Kite events fall through to the default
 * "🚨 F&O DATA ALERT" with a priority prefix, preserving the historical
 * visual identity for the Telegram client.
 */
function getAlertHeader(event: string, priority: AlertPriority): string {
  switch (event) {
    case "EOD_RECONCILIATION_OK":
      return "✅ EOD Reconciliation — OK";
    case "EOD_RECONCILIATION_MISMATCH":
      return "⚠️ EOD Reconciliation — MISMATCH";
    case "INSTRUMENTS_REFRESH_FAILED":
      return "⚠️ Instruments Refresh — FAILED";
    case "INSTRUMENTS_REFRESH_RECOVERED":
      return "✅ Instruments Refresh — RECOVERED";
    case "INSTRUMENTS_CONTRACT_CHANGED":
      return "ℹ️ Instruments Contract Changed";
    case "CLOCK_DRIFT_EXCEEDED":
      return priority === "CRITICAL"
        ? "🔴 Clock Drift — CRITICAL"
        : "⚠️ Clock Drift — ALERT";
    case "CLOCK_DRIFT_RECOVERED":
      return "✅ Clock Drift — RECOVERED";
    case "FNO_DATA_RECOVERED":
      return "✅ F&O DATA RECOVERED";
    default:
      // Generic F&O/Kite operational alerts (existing Telegram identity preserved).
      return `${PRIORITY_PREFIX[priority]} 🚨 F&O DATA ALERT`;
  }
}

/**
 * Per-event actionable instruction. Success events have no action line.
 * Generic events fall back to the historical "/fno-diagnostics" text.
 */
function getActionText(event: string): string {
  if (event === "INSTRUMENTS_REFRESH_FAILED") {
    return "Action: Admin → Live Feed → Refresh Instruments (ensure Kite session is active first)";
  }
  if (event === "INSTRUMENTS_CONTRACT_CHANGED") {
    return "Action: Review changed contract parameters before next F&O trade; verify lot sizes in /fno-diagnostics";
  }
  if (event === "EOD_RECONCILIATION_MISMATCH") {
    return "Action: Review today's paper-trade records via the EOD Reconciliation report";
  }
  if (event === "CLOCK_DRIFT_EXCEEDED") {
    return "Action: Verify host NTP daemon is running; inspect clock drift at /fno-diagnostics → System Health";
  }
  if (event.includes("KITE_SESSION")) {
    return "Action: Reconnect Kite/Zerodha (session expired or unreachable)";
  }
  if (event.includes("DAILY_HISTORY")) {
    return "Action: Kite session is active — F&O daily bars unavailable. Check /fno-diagnostics";
  }
  return "Action: Check /fno-diagnostics";
}

/**
 * Build the full Telegram message text for an alert event.
 *
 * Exported as a PURE function so it is directly unit-testable without
 * any delivery infrastructure. Never call Telegram or modify state here.
 *
 * Design principles:
 *  - SUCCESS_EVENTS receive a ✅ header; their `message` is shown as the
 *    completion summary (no "Detail:" prefix).
 *  - Failure/warning events receive an event-specific header and action line.
 *  - Generic F&O/Kite events keep the historical "🚨 F&O DATA ALERT" brand
 *    with a priority prefix so the Telegram client shows severity inline.
 *  - A priority prefix is NEVER combined with a contradictory ✅ header.
 *  - A priority prefix is ONLY prepended for generic F&O events; all
 *    named operational events have their own header that encodes severity.
 */
export function buildAlertText(
  event: string,
  message: string,
  metadata?: AlertMetadata,
  priority: AlertPriority = "WARN",
): string {
  const isSuccess = SUCCESS_EVENTS.has(event);
  const header = getAlertHeader(event, priority);
  const lines: string[] = [header, ""];

  lines.push(`Event: ${event}`);

  // Failure events: show detail labeled as "Detail:"
  // Success events: the summary goes at the bottom as the completion line
  if (!isSuccess && message) lines.push(`Detail: ${message}`);

  if (metadata?.affectedIndices?.length) {
    lines.push(`Affected: ${metadata.affectedIndices.join(", ")}`);
  }
  if (metadata?.recoveredAt) {
    lines.push(`Recovered: ${formatIstTime(metadata.recoveredAt)} IST`);
  }
  if (metadata?.lastSignalAt) {
    lines.push(`Last signal: ${formatIstTime(metadata.lastSignalAt)} IST`);
  }
  if (typeof metadata?.gapTradingDays === "number") {
    lines.push(`Gap: ${metadata.gapTradingDays} trading day${metadata.gapTradingDays !== 1 ? "s" : ""}`);
  }
  if (metadata?.kiteSessionStatus) {
    lines.push(`Kite session: ${metadata.kiteSessionStatus}`);
  }
  if (typeof metadata?.isDataIssue === "boolean") {
    lines.push(
      metadata.isDataIssue
        ? "Type: DATA ISSUE (not market condition)"
        : "Type: Market condition (not data issue)",
    );
  }

  lines.push("");

  if (isSuccess) {
    // For FNO_DATA_RECOVERED the existing "Signal cycle resumed." is preserved
    // for backward readability; all other success events show their message.
    lines.push(event === "FNO_DATA_RECOVERED" ? "Signal cycle resumed." : (message || "Incident resolved."));
  } else {
    lines.push(getActionText(event));
  }

  if (!isSuccess && metadata?.dashboardPath) {
    lines.push(`Dashboard: ${metadata.dashboardPath}`);
  }

  return lines.join("\n");
}

// Internal alias kept for naming continuity — all production paths now go
// through the exported buildAlertText.
function buildTelegramText(
  event: string,
  message: string,
  metadata?: AlertMetadata,
  priority: AlertPriority = "WARN",
): string {
  return buildAlertText(event, message, metadata, priority);
}

// ── Telegram send ─────────────────────────────────────────────────────────────

const TELEGRAM_SEND_TIMEOUT_MS = 5_000;

/**
 * Low-level Telegram send. At most 1 retry for transient network errors.
 * No retry for 4xx (invalid token/chat_id). Returns "SENT" or an error code.
 * Never throws.
 */
export async function doSendTelegramMessage(
  token: string,
  chatId: string,
  text: string,
): Promise<string> {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true });

  const attempt = async (): Promise<Response> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TELEGRAM_SEND_TIMEOUT_MS);
    try {
      return await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  let lastErr = "UNKNOWN_ERROR";
  for (let i = 0; i < 2; i++) {
    try {
      const resp = await attempt();
      if (resp.ok) return "SENT";
      if (resp.status >= 400 && resp.status < 500) return `HTTP_${resp.status}`; // no retry on 4xx
      lastErr = `HTTP_${resp.status}`;
    } catch (err) {
      lastErr = err instanceof Error && err.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR";
    }
  }
  return lastErr;
}

async function sendTelegramText(text: string): Promise<string> {
  const cfg = getTelegramConfig();
  if (!cfg.enabled) return "STUB_NO_CONFIG";
  try {
    return await doSendTelegramMessage(cfg.token, cfg.chatId, text);
  } catch {
    return "UNEXPECTED_ERROR";
  }
}

/**
 * Fire the actual WARN log + Telegram send, gated on a DB-backed claim so
 * multiple replicas/workers racing the same in-memory dedup key still send
 * at most one Telegram message per (dedupKey, windowMs).
 */
function dispatchTelegramBackground(
  event: string,
  text: string,
  dedupKey: string,
  dedupWindowMs: number,
  family: string,
  logMessage: string,
): void {
  void (async () => {
    const claimed = await claimSystemAlert(dedupKey, dedupWindowMs, family);
    if (!claimed) {
      recordSkippedAlert(dedupKey, family);
      logger.info(
        { alertEvent: event, dedupKey, family },
        "OWNER_ALERT skipped — already claimed by another worker/replica within dedup window",
      );
      return;
    }
    logger.warn({ alertEvent: event }, `OWNER_ALERT [${event}]: ${logMessage}`);
    const result = await sendTelegramText(text);
    const status: TelegramDeliveryStatus =
      result === "SENT"
        ? "SENT"
        : result === "STUB_NO_CONFIG"
          ? "STUB_NO_CONFIG"
          : "SEND_FAILED";
    lastAlertRecord = {
      event,
      at: Date.now(),
      telegramStatus: status,
      ...(status === "SEND_FAILED" ? { errorCode: result } : {}),
    };
    if (status === "SEND_FAILED") {
      logger.warn(
        { alertEvent: event, telegramStatus: "SEND_FAILED", errorCode: result },
        "Telegram alert delivery failed (safe-fail — F&O cycle unaffected)",
      );
    } else if (status === "SENT") {
      logger.info({ alertEvent: event, telegramStatus: "SENT" }, "Telegram alert delivered");
    }
  })();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Lower-level alert sender for alert types that build their own Telegram text.
 * Caller supplies pre-built `telegramText`; `buildAlertText` is NOT called.
 * Supports an optional custom dedup window (defaults to DEDUP_WINDOW_MS = 1h).
 * Never throws. Best-effort Telegram delivery in the background.
 */
export function alertOwnerRaw(
  dedupKey: string,
  logMessage: string,
  telegramText: string,
  dedupWindowMs: number = DEDUP_WINDOW_MS,
): void {
  const now = Date.now();
  if (now - (lastAlerted.get(dedupKey) ?? 0) < dedupWindowMs) return;
  lastAlerted.set(dedupKey, now);
  dispatchTelegramBackground(dedupKey, telegramText, dedupKey, dedupWindowMs, dedupKey, logMessage);
}

/**
 * Fire an owner alert for `event` at most once per dedup window.
 *
 * Always logs at WARN level. If Telegram is configured, delivers via Telegram
 * in the background — best-effort, never blocks the caller, never throws.
 *
 * @param dedupWindowMs  Override the 1-hour default dedup window.
 * @param customDedupKey Override the dedup map key. Use this to scope dedup to a trading date
 *                       (e.g. `FNO_DAILY_HISTORY_UNAVAILABLE::2026-07-01`).
 * @param priority       CRITICAL / WARN (default) / INFO.
 *                       INFO is appropriate for success/recovery events.
 *                       CRITICAL escalates the header for the most urgent alerts.
 */
export function alertOwner(
  event: string,
  message: string,
  metadata?: AlertMetadata,
  dedupWindowMs: number = DEDUP_WINDOW_MS,
  customDedupKey?: string,
  priority: AlertPriority = "WARN",
): void {
  const key = customDedupKey ?? event;
  const now = Date.now();
  if (now - (lastAlerted.get(key) ?? 0) < dedupWindowMs) return;
  lastAlerted.set(key, now);
  const text = buildTelegramText(event, message, metadata, priority);
  dispatchTelegramBackground(event, text, key, dedupWindowMs, event, message);
}

/**
 * Send a test Telegram message, bypassing dedup.
 * For use by the owner test endpoint only. Returns delivery result.
 */
export async function sendTestTelegramMessage(): Promise<{
  telegramStatus: string;
  enabled: boolean;
  configStatus: TelegramConfigStatus;
}> {
  const cfg = getTelegramConfig();
  if (!cfg.enabled) {
    return { telegramStatus: cfg.status, enabled: false, configStatus: cfg.status };
  }
  const text =
    "✅ Telegram alert test from Market Scanner.\nBroker execution remains disabled.";
  const result = await sendTelegramText(text);
  return {
    telegramStatus: result,
    enabled: true,
    configStatus: "TELEGRAM_ENABLED",
  };
}

// ── Pre/Post Analysis Telegram bot ───────────────────────────────────────────
// Dedicated bot for daily pre-market and post-market analysis reports.
// COMPLETELY SEPARATE from the default urgent/operational bot.
// Default bot: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID → F&O alerts, swing alerts, urgent ops.
// Pre/Post bot: PREPOST_TELEGRAM_BOT_TOKEN + PREPOST_TELEGRAM_CHAT_ID → daily analysis only.

export type PrePostTelegramConfigStatus =
  | "PREPOST_TELEGRAM_ENABLED"
  | "PREPOST_TELEGRAM_DISABLED_MISSING_TOKEN"
  | "PREPOST_TELEGRAM_DISABLED_MISSING_CHAT_ID"
  | "PREPOST_TELEGRAM_DISABLED_MISSING_CONFIG";

type PrePostTelegramConfig =
  | { enabled: false; status: Exclude<PrePostTelegramConfigStatus, "PREPOST_TELEGRAM_ENABLED"> }
  | { enabled: true; status: "PREPOST_TELEGRAM_ENABLED"; token: string; chatId: string };

/**
 * Lazy reader for Pre/Post bot config.
 * NEVER logs or returns token/chatId.
 */
function getPrePostTelegramConfig(): PrePostTelegramConfig {
  const token = process.env["PREPOST_TELEGRAM_BOT_TOKEN"];
  const chatId = process.env["PREPOST_TELEGRAM_CHAT_ID"];
  if (!token && !chatId) return { enabled: false, status: "PREPOST_TELEGRAM_DISABLED_MISSING_CONFIG" };
  if (!token) return { enabled: false, status: "PREPOST_TELEGRAM_DISABLED_MISSING_TOKEN" };
  if (!chatId) return { enabled: false, status: "PREPOST_TELEGRAM_DISABLED_MISSING_CHAT_ID" };
  return { enabled: true, status: "PREPOST_TELEGRAM_ENABLED", token, chatId };
}

/** Returns Pre/Post Telegram config status — safe to expose publicly (no secrets). */
export function getPrePostTelegramStatus(): { enabled: boolean; status: PrePostTelegramConfigStatus } {
  const cfg = getPrePostTelegramConfig();
  return { enabled: cfg.enabled, status: cfg.status };
}

/**
 * Send a message to the dedicated Pre/Post Analysis Telegram bot.
 * NEVER falls back to the default urgent/operational bot.
 * If Pre/Post bot config is missing: returns the missing-config status string.
 * Never throws.
 */
export async function sendPrePostTelegramMessage(text: string): Promise<string> {
  const cfg = getPrePostTelegramConfig();
  if (!cfg.enabled) return cfg.status;
  try {
    return await doSendTelegramMessage(cfg.token, cfg.chatId, text);
  } catch {
    return "UNEXPECTED_ERROR";
  }
}
