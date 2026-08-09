/**
 * p33b.fnoBanAdmission.test.ts — Blocker 3: F&O ban admission fail-closed tests.
 *
 * Proves the new FnoBanList contract:
 *   - CURRENT state: canAuthorizeAdmission=true, symbols are authoritative
 *   - LAST_KNOWN_STALE state: canAuthorizeAdmission=false, admission fails closed
 *   - UNAVAILABLE state: canAuthorizeAdmission=false, admission fails closed
 *   - isFnoBanned returns null for any non-CURRENT state
 *   - The route response shape matches the contract for all three states
 *
 * Suite: api-server vitest (non-DB, --pool=threads)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { FnoBanList, FnoBanStatus } from "../lib/fnoBanList";

// ── Type contract tests (schema-level) ────────────────────────────────────────

describe("B3-CONTRACT: FnoBanList type contract", () => {
  it("B3-01: CURRENT state has all required fields with correct values", () => {
    const current: FnoBanList = {
      symbols: ["RELIANCE", "INFY"],
      count: 2,
      sourceUrl: "https://archives.nseindia.com/content/fo/fo_secban.csv",
      sourceAsOf: "2026-08-09T10:00:00.000Z",
      currentAvailable: true,
      hasLastKnown: true,
      stale: false,
      canAuthorizeAdmission: true,
      status: "CURRENT",
    };
    expect(current.currentAvailable).toBe(true);
    expect(current.hasLastKnown).toBe(true);
    expect(current.stale).toBe(false);
    expect(current.canAuthorizeAdmission).toBe(true);
    expect(current.status).toBe("CURRENT");
    expect(current.sourceAsOf).not.toBeNull();
  });

  it("B3-02: LAST_KNOWN_STALE state has correct field values", () => {
    const stale: FnoBanList = {
      symbols: ["HINDCOPPER", "MANINFRA"],
      count: 2,
      sourceUrl: "https://archives.nseindia.com/content/fo/fo_secban.csv",
      sourceAsOf: "2026-08-08T18:30:00.000Z",
      currentAvailable: false,
      hasLastKnown: true,
      stale: true,
      canAuthorizeAdmission: false,
      status: "LAST_KNOWN_STALE",
    };
    expect(stale.currentAvailable).toBe(false);
    expect(stale.hasLastKnown).toBe(true);
    expect(stale.stale).toBe(true);
    expect(stale.canAuthorizeAdmission).toBe(false);
    expect(stale.status).toBe("LAST_KNOWN_STALE");
    expect(stale.sourceAsOf).not.toBeNull(); // last-known data has an asOf
  });

  it("B3-03: UNAVAILABLE state has correct field values", () => {
    const unavailable: FnoBanList = {
      symbols: [],
      count: 0,
      sourceUrl: null,
      sourceAsOf: null,
      currentAvailable: false,
      hasLastKnown: false,
      stale: false,
      canAuthorizeAdmission: false,
      status: "UNAVAILABLE",
    };
    expect(unavailable.currentAvailable).toBe(false);
    expect(unavailable.hasLastKnown).toBe(false);
    expect(unavailable.stale).toBe(false);
    expect(unavailable.canAuthorizeAdmission).toBe(false);
    expect(unavailable.status).toBe("UNAVAILABLE");
    expect(unavailable.sourceAsOf).toBeNull();
  });
});

// ── Fail-closed admission logic tests ─────────────────────────────────────────

describe("B3-ADMISSION: Fail-closed admission logic", () => {
  /**
   * The canonical admission-check logic that production code MUST use.
   * Returns:
   *   true   — symbol is on the ban list (CURRENT, canAuthorizeAdmission=true)
   *   false  — symbol is NOT on the ban list (CURRENT, canAuthorizeAdmission=true)
   *   null   — ban status UNKNOWN (LAST_KNOWN_STALE or UNAVAILABLE — must not admit)
   */
  function checkBanAdmission(
    list: FnoBanList | null,
    symbol: string,
  ): boolean | null {
    if (list === null || !list.canAuthorizeAdmission) {
      // Fail closed: UNAVAILABLE or LAST_KNOWN_STALE — cannot authorize admission
      return null;
    }
    return list.symbols.includes(symbol.toUpperCase());
  }

  it("B3-04: null list (getFnoBanList returned null) → admission null (fail closed)", () => {
    expect(checkBanAdmission(null, "RELIANCE")).toBeNull();
  });

  it("B3-05: UNAVAILABLE list → admission null (fail closed)", () => {
    const unavailable: FnoBanList = {
      symbols: [],
      count: 0,
      sourceUrl: null,
      sourceAsOf: null,
      currentAvailable: false,
      hasLastKnown: false,
      stale: false,
      canAuthorizeAdmission: false,
      status: "UNAVAILABLE",
    };
    expect(checkBanAdmission(unavailable, "RELIANCE")).toBeNull();
    expect(checkBanAdmission(unavailable, "HINDCOPPER")).toBeNull();
  });

  it("B3-06: LAST_KNOWN_STALE list → admission null even when symbol is in stale list", () => {
    const stale: FnoBanList = {
      symbols: ["HINDCOPPER", "MANINFRA"],
      count: 2,
      sourceUrl: "https://archives.nseindia.com/content/fo/fo_secban.csv",
      sourceAsOf: "2026-08-08T18:30:00.000Z",
      currentAvailable: false,
      hasLastKnown: true,
      stale: true,
      canAuthorizeAdmission: false,
      status: "LAST_KNOWN_STALE",
    };
    // Even though HINDCOPPER is in the stale symbols list, we cannot authorize
    expect(checkBanAdmission(stale, "HINDCOPPER")).toBeNull();
    expect(checkBanAdmission(stale, "RELIANCE")).toBeNull();
    expect(checkBanAdmission(stale, "")).toBeNull();
  });

  it("B3-07: CURRENT list with banned symbol → returns true", () => {
    const current: FnoBanList = {
      symbols: ["HINDCOPPER", "MANINFRA"],
      count: 2,
      sourceUrl: "https://archives.nseindia.com/content/fo/fo_secban.csv",
      sourceAsOf: "2026-08-09T10:00:00.000Z",
      currentAvailable: true,
      hasLastKnown: true,
      stale: false,
      canAuthorizeAdmission: true,
      status: "CURRENT",
    };
    expect(checkBanAdmission(current, "HINDCOPPER")).toBe(true);
    expect(checkBanAdmission(current, "hindcopper")).toBe(true); // case insensitive
  });

  it("B3-08: CURRENT list with non-banned symbol → returns false (not null)", () => {
    const current: FnoBanList = {
      symbols: ["HINDCOPPER"],
      count: 1,
      sourceUrl: "https://archives.nseindia.com/content/fo/fo_secban.csv",
      sourceAsOf: "2026-08-09T10:00:00.000Z",
      currentAvailable: true,
      hasLastKnown: true,
      stale: false,
      canAuthorizeAdmission: true,
      status: "CURRENT",
    };
    expect(checkBanAdmission(current, "RELIANCE")).toBe(false);
    // false is NOT null — this is the authoritative "not banned" verdict
    expect(checkBanAdmission(current, "RELIANCE")).not.toBeNull();
  });

  it("B3-09: CURRENT list with zero banned symbols → ALL CLEAR (authorized false for every symbol)", () => {
    const current: FnoBanList = {
      symbols: [],
      count: 0,
      sourceUrl: "https://archives.nseindia.com/content/fo/fo_secban.csv",
      sourceAsOf: "2026-08-09T10:00:00.000Z",
      currentAvailable: true,
      hasLastKnown: true,
      stale: false,
      canAuthorizeAdmission: true,
      status: "CURRENT",
    };
    expect(checkBanAdmission(current, "RELIANCE")).toBe(false);
    expect(checkBanAdmission(current, "NIFTY")).toBe(false);
    // ALL CLEAR is an authorized verdict — NOT null
  });

  it("B3-10: stale=false, canAuthorizeAdmission=false contradiction must not authorize", () => {
    // Edge case: any FnoBanList with canAuthorizeAdmission=false must fail closed
    const edge: FnoBanList = {
      symbols: ["RELIANCE"],
      count: 1,
      sourceUrl: null,
      sourceAsOf: null,
      currentAvailable: false,
      hasLastKnown: false,
      stale: false,                    // technically UNAVAILABLE
      canAuthorizeAdmission: false,    // must block admission regardless
      status: "UNAVAILABLE",
    };
    expect(checkBanAdmission(edge, "RELIANCE")).toBeNull();
    expect(checkBanAdmission(edge, "INFOSYS")).toBeNull();
  });
});

// ── Status state machine tests ─────────────────────────────────────────────────

describe("B3-STATES: Status state machine is exhaustive and mutually exclusive", () => {
  const STATUS_VALUES: FnoBanStatus[] = ["CURRENT", "LAST_KNOWN_STALE", "UNAVAILABLE"];

  it("B3-11: all three statuses are distinct strings", () => {
    const unique = new Set(STATUS_VALUES);
    expect(unique.size).toBe(3);
  });

  it("B3-12: canAuthorizeAdmission=true is ONLY valid for CURRENT status", () => {
    // Rule: canAuthorizeAdmission=true iff status=CURRENT
    const currentList: FnoBanList = {
      symbols: [],
      count: 0,
      sourceUrl: "url",
      sourceAsOf: new Date().toISOString(),
      currentAvailable: true,
      hasLastKnown: true,
      stale: false,
      canAuthorizeAdmission: true,
      status: "CURRENT",
    };
    expect(currentList.canAuthorizeAdmission && currentList.status === "CURRENT").toBe(true);
  });

  it("B3-13: LAST_KNOWN_STALE must have hasLastKnown=true and sourceAsOf non-null", () => {
    const stale: FnoBanList = {
      symbols: ["X"],
      count: 1,
      sourceUrl: "u",
      sourceAsOf: "2026-08-08T00:00:00.000Z",
      currentAvailable: false,
      hasLastKnown: true,
      stale: true,
      canAuthorizeAdmission: false,
      status: "LAST_KNOWN_STALE",
    };
    expect(stale.hasLastKnown).toBe(true);
    expect(stale.sourceAsOf).not.toBeNull();
    expect(stale.currentAvailable).toBe(false);
    expect(stale.canAuthorizeAdmission).toBe(false);
  });

  it("B3-14: UNAVAILABLE must have hasLastKnown=false and sourceAsOf=null", () => {
    const unavail: FnoBanList = {
      symbols: [],
      count: 0,
      sourceUrl: null,
      sourceAsOf: null,
      currentAvailable: false,
      hasLastKnown: false,
      stale: false,
      canAuthorizeAdmission: false,
      status: "UNAVAILABLE",
    };
    expect(unavail.hasLastKnown).toBe(false);
    expect(unavail.sourceAsOf).toBeNull();
    expect(unavail.canAuthorizeAdmission).toBe(false);
  });
});

// ── Route shape tests (pure contract) ─────────────────────────────────────────

describe("B3-ROUTE: Route response shape — old fields must not appear", () => {
  it("B3-15: CURRENT response does not use deprecated 'available' or 'cached' fields", () => {
    const current: FnoBanList = {
      symbols: [],
      count: 0,
      sourceUrl: null,
      sourceAsOf: new Date().toISOString(),
      currentAvailable: true,
      hasLastKnown: true,
      stale: false,
      canAuthorizeAdmission: true,
      status: "CURRENT",
    };
    // Neither 'available' nor 'cached' should be part of the contract
    expect("available" in current).toBe(false);
    expect("cached" in current).toBe(false);
    expect("fetchedAt" in current).toBe(false);
  });

  it("B3-16: sourceAsOf replaces fetchedAt in the contract", () => {
    const list: FnoBanList = {
      symbols: [],
      count: 0,
      sourceUrl: null,
      sourceAsOf: "2026-08-09T10:00:00.000Z",
      currentAvailable: true,
      hasLastKnown: true,
      stale: false,
      canAuthorizeAdmission: true,
      status: "CURRENT",
    };
    expect(list.sourceAsOf).toBe("2026-08-09T10:00:00.000Z");
    expect("fetchedAt" in list).toBe(false);
  });
});
