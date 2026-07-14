/**
 * Telegram bot commands (BUG-85/86 — Phase 4).
 *
 * Long-polls `getUpdates` at BOT_POLL_INTERVAL_MS and processes messages
 * arriving on the owner's chat. Command allowlist (whitelist only —
 * anything else is ignored and logged, never replied to):
 *
 *   /help        — list commands
 *   /status      — SystemMode + Kite readiness snapshot
 *   /clock       — server clock drift snapshot
 *   /positions   — count of OPEN paper-FO positions
 *   /pnl         — today's realised P&L across paper accounts
 *   /pause       — flip SystemMode override to READ_ONLY (blocks auto-opens)
 *   /resume      — clear the SystemMode override (return to derived mode)
 *
 * Security posture:
 *   - Commands are accepted ONLY from `TELEGRAM_CHAT_ID` (single-owner).
 *     Any other chat_id is dropped without a reply.
 *   - No parameters accepted for any command — keeps the surface small.
 *   - `/pause` and `/resume` are the ONLY commands with side effects; they
 *     write to `app_state.system_mode_override` (the same key the UI
 *     override buttons use — same audit trail).
 *   - Long-poll offset is persisted in `app_state.telegram_bot_last_update_id`
 *     so a restart doesn't re-process backlog commands. First boot on a
 *     fresh key starts at "now" (backlog is skipped).
 *   - Fail-closed: if TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing,
 *     the poll loop is not started (log-only info line).
 *
 * Cadence and cost:
 *   - Poll every BOT_POLL_INTERVAL_MS with `timeout=25` (long poll). Telegram
 *     holds the request open until an update arrives OR the timeout fires,
 *     so this is ~free at rest (one open request, no traffic).
 *   - fetch AbortController timeout is BOT_POLL_INTERVAL_MS + 5s.
 */
import { logger } from "./logger";
import { getAppState, setAppState } from "./appStateStore";
import {
  getSystemModeSnapshot,
  setSystemModeOverride,
} from "./systemMode";
import { getKiteReadiness } from "./kiteReadiness";
import { getClockDriftSnapshot } from "./clockDrift";

// Poll cadence (ms) — long-poll timeout is `timeout=25` so at rest this
// runs one open request every ~25s. Under command traffic, response is
// immediate. Cheap and rate-limit-safe.
export const BOT_POLL_INTERVAL_MS = 5_000;
const LONG_POLL_TIMEOUT_S = 25;
const FETCH_TIMEOUT_MS = (LONG_POLL_TIMEOUT_S + 5) * 1000;
const LAST_UPDATE_ID_KEY = "telegram_bot_last_update_id";

// Command whitelist. Anything not on this list is silently dropped
// (logged at info; never replied to).
const COMMANDS = new Set([
  "/help",
  "/status",
  "/clock",
  "/positions",
  "/pnl",
  "/pause",
  "/resume",
]);

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; first_name?: string; username?: string };
    chat: { id: number };
    date: number;
    text?: string;
  };
}

interface BotConfig {
  token: string;
  ownerChatId: string;
}

function readBotConfig(): BotConfig | null {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  const ownerChatId = process.env["TELEGRAM_CHAT_ID"];
  if (!token || !ownerChatId) return null;
  return { token, ownerChatId };
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function sendReply(cfg: BotConfig, chatId: string, text: string): Promise<void> {
  try {
    // Never send to an unexpected chat_id (defense in depth — matches
    // the caller's ownerChatId whitelist gate).
    if (chatId !== cfg.ownerChatId) return;
    const url = `https://api.telegram.org/bot${cfg.token}/sendMessage`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    });
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      "telegramBotCommands: sendReply failed (best-effort, ignored)",
    );
  }
}

// ── Command handlers (pure — return the reply text) ─────────────────────────

async function handleHelp(): Promise<string> {
  return [
    "MarketScanner bot commands:",
    "/status     — SystemMode + Kite readiness",
    "/clock      — server clock drift",
    "/positions  — OPEN paper-FO position count",
    "/pnl        — today's realised P&L (paper)",
    "/pause      — block new auto-opens (READ_ONLY override)",
    "/resume     — clear override (return to derived mode)",
    "/help       — this help",
  ].join("\n");
}

async function handleStatus(): Promise<string> {
  const snap = getSystemModeSnapshot();
  const kite = await getKiteReadiness();
  const lines: string[] = ["ℹ️ SystemMode"];
  if (snap) {
    lines.push(`  effective: ${snap.effective}`);
    lines.push(`  derived:   ${snap.derived}`);
    lines.push(`  override:  ${snap.override ?? "none"}`);
    if (snap.drivers.length) lines.push(`  drivers:   ${snap.drivers.join(", ")}`);
  } else {
    lines.push("  (not yet computed — monitor not warmed up)");
  }
  lines.push("");
  const kiteReady = (kite as { ready?: boolean }).ready;
  const kiteReason =
    (kite as { reason?: string }).reason ??
    (kite as { readinessReason?: string }).readinessReason ??
    "-";
  lines.push(`Kite: ${kiteReady ? "READY" : "NOT READY"} — ${kiteReason}`);
  return lines.join("\n");
}

async function handleClock(): Promise<string> {
  const snap = getClockDriftSnapshot();
  if (snap.status === "UNKNOWN") return "clock: no drift check has run yet";
  return [
    "🕐 Clock drift",
    `  drift:    ${snap.driftMs ?? "?"} ms`,
    `  status:   ${snap.status}`,
    `  source:   ${snap.source ?? "?"}`,
    `  checked:  ${snap.checkedAt ?? "?"}`,
    `  thresholds: WARN>${snap.thresholdWarnMs}ms  ALERT>${snap.thresholdAlertMs}ms`,
  ].join("\n");
}

async function handlePositions(): Promise<string> {
  const { db } = await import("@workspace/db");
  const { sql } = await import("drizzle-orm");
  const res = await db.execute(sql`
    SELECT index_symbol, COUNT(*)::int AS n
      FROM paper_trade_fo
     WHERE status = 'OPEN'
  GROUP BY index_symbol
  ORDER BY index_symbol
  `);
  const rows = (res as unknown as {
    rows: Array<{ index_symbol: string; n: number }>;
  }).rows;
  if (rows.length === 0) return "📈 OPEN paper-FO positions: 0";
  const total = rows.reduce((a, r) => a + r.n, 0);
  return [
    `📈 OPEN paper-FO positions: ${total}`,
    ...rows.map((r) => `  ${r.index_symbol}: ${r.n}`),
  ].join("\n");
}

async function handlePnl(): Promise<string> {
  const { db } = await import("@workspace/db");
  const { sql } = await import("drizzle-orm");
  // IST calendar day boundaries for today's realised P&L.
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const istDay = ist.toISOString().slice(0, 10);
  const startUtc = new Date(new Date(`${istDay}T00:00:00+05:30`).toISOString());
  const res = await db.execute(sql`
    SELECT COALESCE(SUM(realized_pnl), 0)::float AS pnl,
           COUNT(*)::int AS n
      FROM paper_trade_fo
     WHERE status = 'CLOSED'
       AND exited_at >= ${startUtc.toISOString()}
  `);
  const row = (res as unknown as {
    rows: Array<{ pnl: number; n: number }>;
  }).rows[0] ?? { pnl: 0, n: 0 };
  return [
    `💰 Today's realised P&L (paper F&O)`,
    `  P&L:    ₹${row.pnl.toFixed(2)}`,
    `  trades: ${row.n}`,
    `  date:   ${istDay} IST`,
  ].join("\n");
}

async function handlePause(): Promise<string> {
  await setSystemModeOverride("READ_ONLY");
  return "⏸ SystemMode override set to READ_ONLY — no new auto-opens will be accepted. Use /resume to clear.";
}

async function handleResume(): Promise<string> {
  await setSystemModeOverride(null);
  return "▶ SystemMode override cleared — effective mode returns to derived.";
}

/** Route a raw text message to a command handler.
 *  Returns null when the message is not a recognized command. */
export async function routeCommand(text: string): Promise<string | null> {
  const trimmed = text.trim().split(/\s+/)[0] ?? "";
  // Support `/command@bot_username`.
  const cmd = trimmed.split("@")[0]?.toLowerCase() ?? "";
  if (!COMMANDS.has(cmd)) return null;
  try {
    switch (cmd) {
      case "/help":      return await handleHelp();
      case "/status":    return await handleStatus();
      case "/clock":     return await handleClock();
      case "/positions": return await handlePositions();
      case "/pnl":       return await handlePnl();
      case "/pause":     return await handlePause();
      case "/resume":    return await handleResume();
    }
  } catch (err) {
    logger.warn(
      { cmd, err: (err as Error).message },
      "telegramBotCommands: handler threw",
    );
    return `⚠️ ${cmd} failed: ${(err as Error).message}`;
  }
  return null;
}

// ── Long-poll loop ──────────────────────────────────────────────────────────

let botPollTimer: ReturnType<typeof setTimeout> | null = null;
let botPollInFlight = false;
let botLastPollAt: Date | null = null;
let botLastError: string | null = null;
let botCommandsProcessed = 0;

export interface TelegramBotHealth {
  enabled: boolean;
  lastPollAt: string | null;
  commandsProcessed: number;
  lastError: string | null;
}

/** Read-only observability snapshot for the bot poll loop. */
export function getTelegramBotHealth(): TelegramBotHealth {
  return {
    enabled: readBotConfig() !== null,
    lastPollAt: botLastPollAt ? botLastPollAt.toISOString() : null,
    commandsProcessed: botCommandsProcessed,
    lastError: botLastError,
  };
}

async function loadLastUpdateId(): Promise<number> {
  const raw = await getAppState(LAST_UPDATE_ID_KEY);
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

async function saveLastUpdateId(id: number): Promise<void> {
  await setAppState(LAST_UPDATE_ID_KEY, String(id));
}

async function pollOnce(cfg: BotConfig): Promise<void> {
  const lastId = await loadLastUpdateId();
  const offset = lastId + 1;
  const url =
    `https://api.telegram.org/bot${cfg.token}/getUpdates` +
    `?offset=${offset}&timeout=${LONG_POLL_TIMEOUT_S}`;
  const resp = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
  if (!resp.ok) {
    throw new Error(`HTTP_${resp.status}`);
  }
  const body = (await resp.json()) as {
    ok: boolean;
    result?: TelegramUpdate[];
  };
  if (!body.ok || !Array.isArray(body.result) || body.result.length === 0) {
    return;
  }
  for (const upd of body.result) {
    try {
      const msg = upd.message;
      if (msg && typeof msg.text === "string") {
        const chatId = String(msg.chat.id);
        // Owner-only whitelist. Anything else is dropped silently.
        if (chatId === cfg.ownerChatId) {
          const reply = await routeCommand(msg.text);
          if (reply != null) {
            await sendReply(cfg, chatId, reply);
            botCommandsProcessed += 1;
          }
        } else {
          logger.info(
            { chatId, from: msg.from?.username ?? msg.from?.id },
            "telegramBotCommands: dropped non-owner message",
          );
        }
      }
    } catch (err) {
      logger.warn(
        { err: (err as Error).message, update_id: upd.update_id },
        "telegramBotCommands: per-update handler threw",
      );
    }
    // Advance offset regardless of handler outcome — a poison message
    // must never wedge the loop.
    await saveLastUpdateId(upd.update_id);
  }
}

async function pollTick(): Promise<void> {
  if (botPollInFlight) return;
  const cfg = readBotConfig();
  if (!cfg) return; // config removed at runtime — go quiet.
  botPollInFlight = true;
  botLastPollAt = new Date();
  try {
    await pollOnce(cfg);
    botLastError = null;
  } catch (err) {
    botLastError = String((err as Error)?.message ?? err).slice(0, 200);
    logger.warn(
      { err: botLastError },
      "telegramBotCommands: poll cycle failed (retrying)",
    );
  } finally {
    botPollInFlight = false;
    // schedule next tick — long-poll already blocked for up to ~25s
    // internally, so a short BOT_POLL_INTERVAL_MS here is fine.
    botPollTimer = setTimeout(() => void pollTick(), BOT_POLL_INTERVAL_MS);
  }
}

/** Start the poll loop. No-op if TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID
 *  are not configured; safe to call multiple times (subsequent calls
 *  are ignored while a timer is already active). */
export async function startTelegramBotCommands(): Promise<void> {
  if (botPollTimer) return;
  const cfg = readBotConfig();
  if (!cfg) {
    logger.info(
      "telegramBotCommands: not started — TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set",
    );
    return;
  }
  // First boot on a fresh install — skip existing backlog by fast-forwarding
  // the offset to Telegram's latest update_id. This prevents replaying
  // days-old commands after a long outage.
  const lastId = await loadLastUpdateId();
  if (lastId === 0) {
    try {
      const url =
        `https://api.telegram.org/bot${cfg.token}/getUpdates?offset=-1&timeout=0`;
      const resp = await fetchWithTimeout(url, 10_000);
      if (resp.ok) {
        const body = (await resp.json()) as {
          ok: boolean;
          result?: TelegramUpdate[];
        };
        if (body.ok && Array.isArray(body.result) && body.result.length > 0) {
          const maxId = Math.max(...body.result.map((u) => u.update_id));
          await saveLastUpdateId(maxId);
        }
      }
    } catch {
      // best-effort — first tick will just process from 0, harmless.
    }
  }
  logger.info("telegramBotCommands: started");
  botPollTimer = setTimeout(() => void pollTick(), BOT_POLL_INTERVAL_MS);
}

/** Stop the poll loop — test/shutdown helper. */
export function stopTelegramBotCommands(): void {
  if (botPollTimer) {
    clearTimeout(botPollTimer);
    botPollTimer = null;
  }
}
