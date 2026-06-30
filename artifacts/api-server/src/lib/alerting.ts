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

function buildTelegramText(event: string, message: string, metadata?: AlertMetadata): string {
  const isRecovery = event === "FNO_DATA_RECOVERED";
  const header = isRecovery ? "✅ F&O DATA RECOVERED" : "🚨 F&O DATA ALERT";
  const lines: string[] = [header, ""];
  lines.push(`Event: ${event}`);
  if (!isRecovery) {
    lines.push(`Detail: ${message}`);
  }
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
  if (isRecovery) {
    lines.push("Signal cycle resumed.");
  } else {
    const action = event.includes("KITE_SESSION")
      ? "Action: Reconnect Kite/Zerodha"
      : "Action: Check /fno-diagnostics";
    lines.push(action);
  }
  if (metadata?.dashboardPath) {
    lines.push(`Dashboard: ${metadata.dashboardPath}`);
  }
  return lines.join("\n");
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

function dispatchTelegramBackground(event: string, text: string): void {
  void sendTelegramText(text).then(result => {
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
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Lower-level alert sender for alert types that build their own Telegram text.
 * Caller supplies pre-built `telegramText`; `buildTelegramText` is NOT called.
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
  logger.warn({ alertEvent: dedupKey }, `OWNER_ALERT [${dedupKey}]: ${logMessage}`);
  dispatchTelegramBackground(dedupKey, telegramText);
}

/**
 * Fire an owner alert for `event` at most once per DEDUP_WINDOW_MS.
 *
 * Always logs at WARN level. If Telegram is configured, delivers via Telegram
 * in the background — best-effort, never blocks the caller, never throws.
 */
export function alertOwner(event: string, message: string, metadata?: AlertMetadata): void {
  const now = Date.now();
  if (now - (lastAlerted.get(event) ?? 0) < DEDUP_WINDOW_MS) return;
  lastAlerted.set(event, now);
  logger.warn({ alertEvent: event }, `OWNER_ALERT [${event}]: ${message}`);
  const text = buildTelegramText(event, message, metadata);
  dispatchTelegramBackground(event, text);
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
