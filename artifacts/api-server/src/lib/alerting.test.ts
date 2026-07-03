/**
 * Tests for alerting.ts — Phase 2 Telegram delivery.
 *
 * Uses vi.stubEnv for env-var-dependent behaviour (getTelegramConfig reads lazily)
 * and vi.stubGlobal for fetch mocking.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The DB-backed cross-process claim (systemAlertDedup.ts) has its own dedicated
// test file with real ON CONFLICT / CAS coverage. Mocking it here keeps these
// Telegram-delivery tests fast and hermetic (no real DB round-trip, no writes
// to the dev database from unit tests) — always "claims" so delivery proceeds.
vi.mock("./systemAlertDedup", () => ({
  claimSystemAlert: vi.fn().mockResolvedValue(true),
}));

import {
  getTelegramStatus,
  alertOwner,
  sendTestTelegramMessage,
  doSendTelegramMessage,
  resetAlertDedup,
  resetLastAlertRecord,
  getLastAlertRecord,
  getSkippedAlertStats,
  resetSkippedAlertStatsForTest,
} from "./alerting";

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetAlertDedup();
  resetLastAlertRecord();
  resetSkippedAlertStatsForTest();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ── Config status ─────────────────────────────────────────────────────────────

describe("getTelegramStatus — config detection", () => {
  it("returns TELEGRAM_DISABLED_MISSING_CONFIG when both secrets absent", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    vi.stubEnv("TELEGRAM_CHAT_ID", "");
    const s = getTelegramStatus();
    expect(s.enabled).toBe(false);
    expect(s.status).toBe("TELEGRAM_DISABLED_MISSING_CONFIG");
  });

  it("returns TELEGRAM_DISABLED_MISSING_TOKEN when only CHAT_ID set", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    vi.stubEnv("TELEGRAM_CHAT_ID", "123456");
    const s = getTelegramStatus();
    expect(s.enabled).toBe(false);
    expect(s.status).toBe("TELEGRAM_DISABLED_MISSING_TOKEN");
  });

  it("returns TELEGRAM_DISABLED_MISSING_CHAT_ID when only BOT_TOKEN set", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot:abc123");
    vi.stubEnv("TELEGRAM_CHAT_ID", "");
    const s = getTelegramStatus();
    expect(s.enabled).toBe(false);
    expect(s.status).toBe("TELEGRAM_DISABLED_MISSING_CHAT_ID");
  });

  it("returns TELEGRAM_ENABLED when both secrets are set", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot:abc123");
    vi.stubEnv("TELEGRAM_CHAT_ID", "999888");
    const s = getTelegramStatus();
    expect(s.enabled).toBe(true);
    expect(s.status).toBe("TELEGRAM_ENABLED");
  });
});

// ── Dedup ─────────────────────────────────────────────────────────────────────

describe("alertOwner — dedup prevents spam", () => {
  it("does not call fetch twice for the same event within dedup window", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot:t");
    vi.stubEnv("TELEGRAM_CHAT_ID", "1");

    alertOwner("DEDUP_TEST", "msg 1");
    alertOwner("DEDUP_TEST", "msg 2 — should be suppressed");

    await new Promise(r => setTimeout(r, 50));
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("fires for different event keys independently", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot:t");
    vi.stubEnv("TELEGRAM_CHAT_ID", "1");

    alertOwner("EVENT_A", "msg");
    alertOwner("EVENT_B", "msg");

    await new Promise(r => setTimeout(r, 50));
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("passes (dedupKey, windowMs, family) to the DB claim layer for cross-process dedup", async () => {
    const { claimSystemAlert } = await import("./systemAlertDedup");
    vi.mocked(claimSystemAlert).mockClear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot:t");
    vi.stubEnv("TELEGRAM_CHAT_ID", "1");

    alertOwner("CLAIM_WIRING_TEST", "msg", undefined, 12345, "CLAIM_WIRING_TEST::2026-07-03");
    await new Promise(r => setTimeout(r, 20));

    expect(claimSystemAlert).toHaveBeenCalledWith(
      "CLAIM_WIRING_TEST::2026-07-03",
      12345,
      "CLAIM_WIRING_TEST",
    );
  });

  it("does not send Telegram when the DB claim layer reports another worker already claimed it", async () => {
    const { claimSystemAlert } = await import("./systemAlertDedup");
    vi.mocked(claimSystemAlert).mockResolvedValueOnce(false);
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot:t");
    vi.stubEnv("TELEGRAM_CHAT_ID", "1");

    alertOwner("CROSS_PROCESS_DEDUP_TEST", "msg");
    await new Promise(r => setTimeout(r, 20));

    expect(mockFetch).not.toHaveBeenCalled();
    expect(getLastAlertRecord()?.event).not.toBe("CROSS_PROCESS_DEDUP_TEST");
  });

  it("records a skipped-alert stat when the DB claim layer reports another worker already claimed it", async () => {
    const { claimSystemAlert } = await import("./systemAlertDedup");
    vi.mocked(claimSystemAlert).mockResolvedValueOnce(false);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot:t");
    vi.stubEnv("TELEGRAM_CHAT_ID", "1");

    expect(getSkippedAlertStats().totalSkipped).toBe(0);
    alertOwner("SKIP_STAT_TEST", "msg");
    await new Promise(r => setTimeout(r, 20));

    const stats = getSkippedAlertStats();
    expect(stats.totalSkipped).toBe(1);
    expect(stats.lastSkipped?.dedupKey).toBe("SKIP_STAT_TEST");
    expect(stats.lastSkipped?.family).toBe("SKIP_STAT_TEST");
  });

  it("does not record a skipped-alert stat on a successful (claimed) send", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot:t");
    vi.stubEnv("TELEGRAM_CHAT_ID", "1");

    alertOwner("NO_SKIP_STAT_TEST", "msg");
    await new Promise(r => setTimeout(r, 20));

    expect(getSkippedAlertStats().totalSkipped).toBe(0);
  });
});

// ── Telegram delivery ─────────────────────────────────────────────────────────

describe("sendTestTelegramMessage", () => {
  it("returns STUB_NO_CONFIG when secrets are missing", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    vi.stubEnv("TELEGRAM_CHAT_ID", "");
    const result = await sendTestTelegramMessage();
    expect(result.enabled).toBe(false);
    expect(result.telegramStatus).toMatch(/TELEGRAM_DISABLED/);
  });

  it("returns SENT when fetch succeeds", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot:abc");
    vi.stubEnv("TELEGRAM_CHAT_ID", "9999");

    const result = await sendTestTelegramMessage();
    expect(result.enabled).toBe(true);
    expect(result.telegramStatus).toBe("SENT");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("handles timeout without throwing", async () => {
    const mockFetch = vi.fn().mockRejectedValue(
      Object.assign(new Error("Aborted"), { name: "AbortError" }),
    );
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot:abc");
    vi.stubEnv("TELEGRAM_CHAT_ID", "9999");

    const result = await sendTestTelegramMessage();
    expect(result.enabled).toBe(true);
    expect(result.telegramStatus).toBe("TIMEOUT");
  });

  it("handles HTTP failure without throwing", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot:abc");
    vi.stubEnv("TELEGRAM_CHAT_ID", "9999");

    const result = await sendTestTelegramMessage();
    expect(result.enabled).toBe(true);
    expect(result.telegramStatus).not.toBe("SENT");
    expect(result.telegramStatus).not.toMatch(/TELEGRAM_DISABLED/);
  });
});

// ── Retry behaviour ───────────────────────────────────────────────────────────

describe("doSendTelegramMessage — retry logic", () => {
  it("does not retry on 4xx (invalid token/chat_id)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    vi.stubGlobal("fetch", mockFetch);

    const result = await doSendTelegramMessage("tok", "chat", "hi");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result).toBe("HTTP_401");
  });

  it("retries once on 5xx server error", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal("fetch", mockFetch);

    const result = await doSendTelegramMessage("tok", "chat", "hi");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result).toBe("HTTP_503");
  });

  it("retries once on network error", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("Network error"));
    vi.stubGlobal("fetch", mockFetch);

    const result = await doSendTelegramMessage("tok", "chat", "hi");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result).toBe("NETWORK_ERROR");
  });
});

// ── No secrets in logs ────────────────────────────────────────────────────────

describe("alertOwner — no secrets in log arguments", () => {
  it("does not include bot token or chat_id in logger.warn arguments", async () => {
    const TOKEN = "MY_SECRET_BOT_TOKEN_XYZZY";
    const CHAT_ID = "MY_SECRET_CHAT_12345";

    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", TOKEN);
    vi.stubEnv("TELEGRAM_CHAT_ID", CHAT_ID);

    const warnCalls: unknown[][] = [];
    const infoCalls: unknown[][] = [];

    vi.spyOn(
      await import("./logger").then(m => m.logger),
      "warn",
    ).mockImplementation((...args) => { warnCalls.push(args); });
    vi.spyOn(
      await import("./logger").then(m => m.logger),
      "info",
    ).mockImplementation((...args) => { infoCalls.push(args); });

    alertOwner("SECRET_TEST", "test message");
    await new Promise(r => setTimeout(r, 50));

    const allLogs = JSON.stringify([...warnCalls, ...infoCalls]);
    expect(allLogs).not.toContain(TOKEN);
    expect(allLogs).not.toContain(CHAT_ID);
  });
});

// ── F&O cycle safety ──────────────────────────────────────────────────────────

describe("alertOwner — F&O cycle safety", () => {
  it("does not throw even when fetch rejects unexpectedly", () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("Catastrophic failure"));
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot:x");
    vi.stubEnv("TELEGRAM_CHAT_ID", "1");

    expect(() => alertOwner("CYCLE_SAFE_TEST", "msg")).not.toThrow();
  });
});

// ── Last-alert record ─────────────────────────────────────────────────────────

describe("getLastAlertRecord", () => {
  it("returns null before any alert fires", () => {
    expect(getLastAlertRecord()).toBeNull();
  });

  it("records SENT status after successful delivery", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot:x");
    vi.stubEnv("TELEGRAM_CHAT_ID", "1");

    alertOwner("RECORD_TEST", "msg");
    await new Promise(r => setTimeout(r, 50));

    const rec = getLastAlertRecord();
    expect(rec).not.toBeNull();
    expect(rec?.event).toBe("RECORD_TEST");
    expect(rec?.telegramStatus).toBe("SENT");
  });

  it("records STUB_NO_CONFIG when secrets are missing", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    vi.stubEnv("TELEGRAM_CHAT_ID", "");
    alertOwner("STUB_TEST", "msg without secrets");
    await new Promise(r => setTimeout(r, 50));

    const rec = getLastAlertRecord();
    expect(rec?.telegramStatus).toBe("STUB_NO_CONFIG");
  });
});
