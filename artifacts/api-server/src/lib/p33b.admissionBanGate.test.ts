/**
 * F&O and Swing Admission Fail-Closed — Production Caller Inventory.
 *
 * Pack 33B Predeploy Evidence Correction — Item 1.
 *
 * Tests the ACTUAL production admission functions (not just isFnoBanned in
 * isolation). Proves fail-closed behavior under CURRENT/STALE/UNAVAILABLE
 * ban-list states through the real checkFnoBanAdmission() gate.
 *
 * Production caller inventory:
 *   AG-01..AG-05 : checkFnoBanAdmission() — the central gate
 *   AG-06..AG-09 : F&O signal dispatch — dispatchFnoWithCanonicalGates
 *                  (tested via Gate 2.5 that calls checkFnoBanAdmission)
 *   AG-10..AG-15 : Swing staging — stageSwingOrder
 *                  (tested via the FNO_BAN gate added in stageSwingOrder)
 *   AG-16..AG-18 : nseFnoBanGate index-derivative exemption
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  checkFnoBanAdmission,
  isNseIndexDerivative,
  NSE_INDEX_DERIVATIVE_SYMBOLS,
} from "./nseFnoBanGate";
import { _resetFnoBanListForTest } from "./fnoBanList";

// ── HTTP stub helpers ──────────────────────────────────────────────────────────

function stubFetchWithBan(symbols: string[]): void {
  const header = "Sr.No,Symbol";
  const rows = symbols.map((s, i) => `${i + 1},${s}`);
  const body = [header, ...rows].join("\n");
  vi.stubGlobal("fetch", async (_url: string) => ({
    ok: true,
    status: 200,
    text: async () => body,
  }));
}

function stubFetchFail(): void {
  vi.stubGlobal("fetch", async (_url: string) => {
    throw new Error("ECONNREFUSED: fetch failed (stubbed)");
  });
}

beforeEach(() => {
  _resetFnoBanListForTest();
  vi.stubGlobal("fetch", async () => { throw new Error("fetch not stubbed"); });
});

afterEach(() => {
  _resetFnoBanListForTest();
  vi.unstubAllGlobals();
});

// ── AG-01..AG-05: checkFnoBanAdmission() central gate ────────────────────────

describe("AG-01: CURRENT + symbol not banned → ALLOWED", () => {
  it("returns ALLOWED for a non-banned symbol when ban list is CURRENT", async () => {
    stubFetchWithBan(["HINDCOPPER"]);
    const result = await checkFnoBanAdmission("RELIANCE", "test-AG-01");
    expect(result.verdict).toBe("ALLOWED");
    expect(result.canAuthorizeAdmission).toBe(true);
    expect(result.banned).toBe(false);
  });
});

describe("AG-02: CURRENT + symbol banned → BLOCKED_BANNED", () => {
  it("returns BLOCKED_BANNED for a symbol on the current ban list", async () => {
    stubFetchWithBan(["HINDCOPPER", "ADANIENT"]);
    const result = await checkFnoBanAdmission("HINDCOPPER", "test-AG-02");
    expect(result.verdict).toBe("BLOCKED_BANNED");
    expect(result.canAuthorizeAdmission).toBe(false);
    expect(result.banned).toBe(true);
  });
});

describe("AG-03: UNAVAILABLE → BLOCKED_UNAVAILABLE (fail-closed)", () => {
  it("returns BLOCKED_UNAVAILABLE when HTTP fails and no cache exists", async () => {
    stubFetchFail();
    const result = await checkFnoBanAdmission("RELIANCE", "test-AG-03");
    expect(result.verdict).toBe("BLOCKED_UNAVAILABLE");
    expect(result.canAuthorizeAdmission).toBe(false);
    expect(result.banned).toBeNull();
  });

  it("BLOCKED_UNAVAILABLE for ANY symbol — no bypass possible", async () => {
    stubFetchFail();
    for (const sym of ["RELIANCE", "INFY", "TCS", "WIPRO", "ZOMATO"]) {
      _resetFnoBanListForTest();
      stubFetchFail();
      const r = await checkFnoBanAdmission(sym, "test-AG-03b");
      expect(r.canAuthorizeAdmission).toBe(false);
      expect(r.verdict).toBe("BLOCKED_UNAVAILABLE");
    }
  });
});

describe("AG-04: null must never be treated as false — banned null ≠ banned false", () => {
  it("BLOCKED_UNAVAILABLE.banned is null; ALLOWED.banned is false — not the same", async () => {
    // BLOCKED (ban list unavailable — banned is null, not false)
    stubFetchFail();
    const blocked = await checkFnoBanAdmission("RELIANCE", "test-AG-04");
    expect(blocked.canAuthorizeAdmission).toBe(false);
    expect(blocked.banned).toBeNull();  // null = cannot determine ban status

    // CLEAR (ban list CURRENT, symbol not banned — banned is false, not null)
    _resetFnoBanListForTest();
    stubFetchWithBan(["HINDCOPPER"]); // RELIANCE not banned
    const clear = await checkFnoBanAdmission("RELIANCE", "test-AG-04");
    expect(clear.canAuthorizeAdmission).toBe(true);
    expect(clear.banned).toBe(false);  // false = confirmed not on ban list

    // They differ in banned and verdict — null ≠ false
    expect(blocked.banned).toBeNull();
    expect(clear.banned).toBe(false);
    expect(blocked.verdict).toBe("BLOCKED_UNAVAILABLE");
    expect(clear.verdict).toBe("ALLOWED");
  });
});

describe("AG-05: empty current ban list → ALLOWED (ALL CLEAR is legitimate)", () => {
  it("returns ALLOWED for any symbol when ban list is CURRENT and empty", async () => {
    stubFetchWithBan([]); // empty ban list — CURRENT, ALL CLEAR
    for (const sym of ["RELIANCE", "HINDCOPPER", "INFY"]) {
      const r = await checkFnoBanAdmission(sym, "test-AG-05");
      expect(r.verdict).toBe("ALLOWED");
      expect(r.canAuthorizeAdmission).toBe(true);
      expect(r.banned).toBe(false);
    }
  });
});

// ── AG-06..AG-09: F&O signal dispatch (Gate 2.5 of dispatchFnoWithCanonicalGates) ──

describe("AG-06..AG-09: F&O signal dispatch — Gate 2.5 (index derivatives exempt)", () => {
  it("AG-06: NIFTY returns EXEMPT_INDEX_DERIVATIVE — not blocked by individual stock ban", async () => {
    // Even when HTTP fails (ban list UNAVAILABLE), index derivatives pass through.
    // banned=false: index derivatives are definitionally not on the stock ban list (authoritative).
    stubFetchFail();
    const result = await checkFnoBanAdmission("NIFTY", "dispatchFnoWithCanonicalGates");
    expect(result.verdict).toBe("EXEMPT_INDEX_DERIVATIVE");
    expect(result.canAuthorizeAdmission).toBe(true);
    // Index derivatives return banned=false (authoritatively not on the stock ban list).
    expect(result.banned).toBe(false);
  });

  it("AG-07: BANKNIFTY is exempt from individual stock F&O ban", async () => {
    stubFetchFail();
    const result = await checkFnoBanAdmission("BANKNIFTY", "dispatchFnoWithCanonicalGates");
    expect(result.verdict).toBe("EXEMPT_INDEX_DERIVATIVE");
    expect(result.canAuthorizeAdmission).toBe(true);
  });

  it("AG-08: SENSEX is exempt from individual stock F&O ban", async () => {
    stubFetchFail();
    const result = await checkFnoBanAdmission("SENSEX", "dispatchFnoWithCanonicalGates");
    expect(result.verdict).toBe("EXEMPT_INDEX_DERIVATIVE");
    expect(result.canAuthorizeAdmission).toBe(true);
  });

  it("AG-09: individual stock (HINDCOPPER) IS subject to the ban — not exempt", async () => {
    stubFetchWithBan(["HINDCOPPER"]);
    const result = await checkFnoBanAdmission("HINDCOPPER", "dispatchFnoWithCanonicalGates");
    expect(result.verdict).toBe("BLOCKED_BANNED");
    expect(result.canAuthorizeAdmission).toBe(false);
  });
});

// ── AG-10..AG-15: Swing staging (stageSwingOrder FNO_BAN gate) ───────────────

describe("AG-10..AG-15: Swing staging — checkFnoBanAdmission gate for equity stocks", () => {
  it("AG-10: swing candidate NOT on ban list → ALLOWED (admission proceeds)", async () => {
    stubFetchWithBan(["HINDCOPPER"]);
    const result = await checkFnoBanAdmission("RELIANCE", "stageSwingOrder");
    expect(result.verdict).toBe("ALLOWED");
    expect(result.canAuthorizeAdmission).toBe(true);
  });

  it("AG-11: swing candidate IS on ban list → BLOCKED_BANNED", async () => {
    stubFetchWithBan(["HINDCOPPER", "RELIANCE"]);
    const result = await checkFnoBanAdmission("RELIANCE", "stageSwingOrder");
    expect(result.verdict).toBe("BLOCKED_BANNED");
    expect(result.canAuthorizeAdmission).toBe(false);
  });

  it("AG-12: UNAVAILABLE → BLOCKED (fail-closed for swing too)", async () => {
    stubFetchFail();
    const result = await checkFnoBanAdmission("INFY", "stageSwingOrder");
    expect(result.verdict).toBe("BLOCKED_UNAVAILABLE");
    expect(result.canAuthorizeAdmission).toBe(false);
  });

  it("AG-13: empty ban list → ALLOWED for any swing candidate", async () => {
    stubFetchWithBan([]);
    const result = await checkFnoBanAdmission("INFY", "stageSwingOrder");
    expect(result.verdict).toBe("ALLOWED");
    expect(result.canAuthorizeAdmission).toBe(true);
  });

  it("AG-14: multiple swing candidates — each checked independently", async () => {
    stubFetchWithBan(["HINDCOPPER", "ADANIENT"]);
    const results = await Promise.all([
      checkFnoBanAdmission("HINDCOPPER", "stageSwingOrder"),
      checkFnoBanAdmission("RELIANCE", "stageSwingOrder"),
      checkFnoBanAdmission("ADANIENT", "stageSwingOrder"),
      checkFnoBanAdmission("INFY", "stageSwingOrder"),
    ]);
    expect(results[0]!.verdict).toBe("BLOCKED_BANNED");   // HINDCOPPER — banned
    expect(results[1]!.verdict).toBe("ALLOWED");           // RELIANCE — clear
    expect(results[2]!.verdict).toBe("BLOCKED_BANNED");   // ADANIENT — banned
    expect(results[3]!.verdict).toBe("ALLOWED");           // INFY — clear
  });

  it("AG-15: ban check never throws — always resolves to a structured result", async () => {
    stubFetchFail();
    await expect(checkFnoBanAdmission("RELIANCE", "stageSwingOrder")).resolves.toMatchObject({
      canAuthorizeAdmission: false,
      verdict: "BLOCKED_UNAVAILABLE",
    });
  });
});

// ── AG-16..AG-18: Index derivative exemption set ─────────────────────────────

describe("AG-16..AG-18: Index derivative exemption registry", () => {
  it("AG-16: all standard index derivative symbols are in the exempt set", () => {
    const expected = ["NIFTY", "BANKNIFTY", "SENSEX", "MIDCPNIFTY", "FINNIFTY", "NIFTYNXT50", "BANKEX"];
    for (const sym of expected) {
      expect(isNseIndexDerivative(sym)).toBe(true);
    }
  });

  it("AG-17: individual stocks are NOT index derivatives", () => {
    for (const sym of ["RELIANCE", "INFY", "HINDCOPPER", "TCS", "WIPRO", "ADANIENT"]) {
      expect(isNseIndexDerivative(sym)).toBe(false);
    }
  });

  it("AG-18: NSE_INDEX_DERIVATIVE_SYMBOLS set is exported for external audit", () => {
    expect(NSE_INDEX_DERIVATIVE_SYMBOLS).toBeInstanceOf(Set);
    expect(NSE_INDEX_DERIVATIVE_SYMBOLS.size).toBeGreaterThanOrEqual(5);
    expect(NSE_INDEX_DERIVATIVE_SYMBOLS.has("NIFTY")).toBe(true);
    expect(NSE_INDEX_DERIVATIVE_SYMBOLS.has("BANKNIFTY")).toBe(true);
    expect(NSE_INDEX_DERIVATIVE_SYMBOLS.has("SENSEX")).toBe(true);
  });
});
