/**
 * B0 alerting tests — event-specific message format, priority, and
 * recovery event handling.
 *
 * Focused on buildAlertText (pure, exported) and the alert contract
 * around EOD, instruments, clock drift, and F&O recovery.
 * Delivery tests (Telegram, dedup, retry) remain in alerting.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./systemAlertDedup", () => ({
  claimSystemAlert: vi.fn().mockResolvedValue(true),
}));

import {
  buildAlertText,
  alertOwner,
  resetAlertDedup,
  resetLastAlertRecord,
  resetSkippedAlertStatsForTest,
} from "./alerting";

beforeEach(() => {
  resetAlertDedup();
  resetLastAlertRecord();
  resetSkippedAlertStatsForTest();
  vi.clearAllMocks();
});

// ── §1 EOD_RECONCILIATION_OK formatting ──────────────────────────────────────

describe("buildAlertText — EOD_RECONCILIATION_OK", () => {
  it("does NOT contain '[WARN]' or '⚠️' in the header", () => {
    const text = buildAlertText("EOD_RECONCILIATION_OK", "All 5 checks passed.");
    expect(text).not.toContain("[WARN]");
    expect(text).not.toContain("⚠️");
  });

  it("does NOT contain 'CRITICAL' or '🔴'", () => {
    const text = buildAlertText("EOD_RECONCILIATION_OK", "All 5 checks passed.");
    expect(text).not.toContain("CRITICAL");
    expect(text).not.toContain("🔴");
  });

  it("does NOT contain '🚨 F&O DATA ALERT' or similar F&O branding", () => {
    const text = buildAlertText("EOD_RECONCILIATION_OK", "All 5 checks passed.");
    expect(text).not.toContain("🚨");
    expect(text).not.toContain("F&O DATA ALERT");
  });

  it("contains a ✅ success indicator", () => {
    const text = buildAlertText("EOD_RECONCILIATION_OK", "5 of 5 checks passed.");
    expect(text).toContain("✅");
  });

  it("includes the message content", () => {
    const text = buildAlertText("EOD_RECONCILIATION_OK", "5 of 5 checks passed. Ledgers consistent.");
    expect(text).toContain("5 of 5 checks passed");
  });

  it("does NOT contain a 'Detail:' prefix (success events show message directly)", () => {
    const text = buildAlertText("EOD_RECONCILIATION_OK", "All checks passed.");
    expect(text).not.toContain("Detail:");
  });

  it("priority: INFO produces no contradictory label prefix", () => {
    const text = buildAlertText("EOD_RECONCILIATION_OK", "ok", undefined, "INFO");
    expect(text).not.toContain("[WARN]");
    expect(text).not.toContain("⚠️ [WARN]");
  });
});

// ── §2 INSTRUMENTS_REFRESH_FAILED formatting ─────────────────────────────────

describe("buildAlertText — INSTRUMENTS_REFRESH_FAILED", () => {
  it("contains actionable admin instruction — not just '/fno-diagnostics'", () => {
    const text = buildAlertText("INSTRUMENTS_REFRESH_FAILED", "no Kite session by 09:20 IST");
    // Must mention admin → live feed path specifically
    expect(text.toLowerCase()).toContain("admin");
    expect(text.toLowerCase()).toContain("refresh instruments");
  });

  it("action text references Kite session requirement", () => {
    const text = buildAlertText("INSTRUMENTS_REFRESH_FAILED", "refresh failed");
    expect(text.toLowerCase()).toContain("kite session");
  });

  it("contains '⚠️' severity indicator", () => {
    const text = buildAlertText("INSTRUMENTS_REFRESH_FAILED", "reason");
    expect(text).toContain("⚠️");
  });

  it("does NOT use '🚨 F&O DATA ALERT' header", () => {
    const text = buildAlertText("INSTRUMENTS_REFRESH_FAILED", "reason");
    expect(text).not.toContain("🚨 F&O DATA ALERT");
  });
});

// ── §3 INSTRUMENTS_REFRESH_RECOVERED formatting ───────────────────────────────

describe("buildAlertText — INSTRUMENTS_REFRESH_RECOVERED", () => {
  it("contains ✅ success indicator", () => {
    const text = buildAlertText("INSTRUMENTS_REFRESH_RECOVERED", "Instruments refreshed.", undefined, "INFO");
    expect(text).toContain("✅");
  });

  it("does NOT contain [WARN] or 🚨", () => {
    const text = buildAlertText("INSTRUMENTS_REFRESH_RECOVERED", "ok", undefined, "INFO");
    expect(text).not.toContain("[WARN]");
    expect(text).not.toContain("🚨");
  });
});

// ── §4 CLOCK_DRIFT_EXCEEDED formatting ───────────────────────────────────────

describe("buildAlertText — CLOCK_DRIFT_EXCEEDED", () => {
  it("header is clock-specific, not 'F&O DATA ALERT'", () => {
    const text = buildAlertText("CLOCK_DRIFT_EXCEEDED", "drift 1500ms vs worldtimeapi.org");
    expect(text).not.toContain("F&O DATA ALERT");
    expect(text.toLowerCase()).toContain("clock drift");
  });

  it("action text mentions NTP and diagnostics", () => {
    const text = buildAlertText("CLOCK_DRIFT_EXCEEDED", "drift 1500ms");
    expect(text.toLowerCase()).toContain("ntp");
    expect(text.toLowerCase()).toContain("fno-diagnostics");
  });

  it("CRITICAL priority → 🔴 header", () => {
    const text = buildAlertText("CLOCK_DRIFT_EXCEEDED", "drift 5000ms", undefined, "CRITICAL");
    expect(text).toContain("🔴");
  });
});

// ── §5 CLOCK_DRIFT_RECOVERED formatting ──────────────────────────────────────

describe("buildAlertText — CLOCK_DRIFT_RECOVERED", () => {
  it("contains ✅ indicator", () => {
    const text = buildAlertText("CLOCK_DRIFT_RECOVERED", "drift 50ms — recovered", undefined, "INFO");
    expect(text).toContain("✅");
  });

  it("does NOT contain WARN or CRITICAL markers", () => {
    const text = buildAlertText("CLOCK_DRIFT_RECOVERED", "recovered", undefined, "INFO");
    expect(text).not.toContain("[WARN]");
    expect(text).not.toContain("🔴");
    expect(text).not.toContain("🚨");
  });
});

// ── §6 FNO_DATA_RECOVERED formatting ─────────────────────────────────────────

describe("buildAlertText — FNO_DATA_RECOVERED", () => {
  it("contains ✅ indicator", () => {
    const text = buildAlertText("FNO_DATA_RECOVERED", "restored");
    expect(text).toContain("✅");
  });

  it("does NOT use WARN prefix or 🚨 header", () => {
    const text = buildAlertText("FNO_DATA_RECOVERED", "restored");
    expect(text).not.toContain("[WARN] 🚨");
    expect(text).not.toContain("⚠️ [WARN] 🚨");
  });

  it("includes 'Signal cycle resumed.'", () => {
    const text = buildAlertText("FNO_DATA_RECOVERED", "restored");
    expect(text).toContain("Signal cycle resumed.");
  });
});

// ── §7 Generic F&O events preserve existing branding ──────────────────────────

describe("buildAlertText — generic F&O events", () => {
  it("unknown F&O event uses '🚨 F&O DATA ALERT' with priority prefix", () => {
    const text = buildAlertText("FNO_KITE_SESSION_MISSING", "session gone");
    expect(text).toContain("🚨 F&O DATA ALERT");
  });

  it("WARN priority prefix is present for generic WARN events", () => {
    const text = buildAlertText("SOME_FNO_EVENT", "detail", undefined, "WARN");
    expect(text).toContain("[WARN]");
    expect(text).toContain("🚨 F&O DATA ALERT");
  });

  it("CRITICAL priority for generic event → 🔴 [CRITICAL] prefix", () => {
    const text = buildAlertText("SOME_FNO_CRITICAL", "critical", undefined, "CRITICAL");
    expect(text).toContain("[CRITICAL]");
    expect(text).toContain("🚨 F&O DATA ALERT");
  });
});

// ── §8 No contradictory labels ────────────────────────────────────────────────

describe("buildAlertText — no contradictory labels", () => {
  const successEvents = [
    "EOD_RECONCILIATION_OK",
    "INSTRUMENTS_REFRESH_RECOVERED",
    "CLOCK_DRIFT_RECOVERED",
    "FNO_DATA_RECOVERED",
  ];

  for (const event of successEvents) {
    it(`${event}: no ⚠️ [WARN] combined with ✅`, () => {
      const text = buildAlertText(event, "resolved", undefined, "INFO");
      // Should not have both WARN prefix and a success indicator
      const hasWarnPrefix = text.includes("[WARN]");
      const hasSuccessIcon = text.includes("✅");
      // If it has a success icon, it must NOT also have a WARN prefix
      if (hasSuccessIcon) expect(hasWarnPrefix).toBe(false);
    });

    it(`${event}: no 🚨 in success message`, () => {
      const text = buildAlertText(event, "resolved", undefined, "INFO");
      expect(text).not.toContain("🚨");
    });
  }

  it("EOD_RECONCILIATION_MISMATCH: WARN is present, ✅ is absent", () => {
    const text = buildAlertText("EOD_RECONCILIATION_MISMATCH", "1 mismatch", undefined, "WARN");
    expect(text).toContain("⚠️");
    expect(text).not.toContain("✅");
  });
});

// ── §9 alertOwner wires INFO priority correctly ───────────────────────────────

describe("alertOwner — INFO priority delivery", () => {
  it("fires for INFO events without suppression by default WARN window", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot:t");
    vi.stubEnv("TELEGRAM_CHAT_ID", "1");

    alertOwner("EOD_RECONCILIATION_OK", "All checks passed.", undefined, 60_000, "EOD_RECON::2026-07-31", "INFO");

    await new Promise((r) => setTimeout(r, 50));
    expect(mockFetch).toHaveBeenCalledTimes(1);
    // Verify the message body sent to Telegram does NOT contain [WARN] or 🚨
    const body = JSON.parse((mockFetch.mock.calls[0]?.[1] as { body: string }).body) as { text: string };
    expect(body.text).not.toContain("[WARN]");
    expect(body.text).not.toContain("🚨");
    expect(body.text).toContain("✅");
  });
});
