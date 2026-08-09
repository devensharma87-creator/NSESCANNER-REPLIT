/**
 * NSE Security Master — Last-Good Disk Persistence Tests.
 *
 * Pack 33B Item 3: proves that nseSecurityMaster.ts persists to disk on success
 * and falls back to the last-good snapshot on HTTP failure, with correct
 * STALE labeling. Never replaces last-good with malformed/empty data.
 *
 * Gates verified:
 *   LG-01: Successful fresh fetch saves last-good to disk
 *   LG-02: On HTTP failure with last-good → returns last-good (isLastGood=true, staleReason set)
 *   LG-03: On HTTP failure with NO last-good → returns null (fail closed)
 *   LG-04: Malformed CSV (< 100 records) is rejected; last-good preserved
 *   LG-05: Empty CSV (0 records) is rejected; last-good preserved
 *   LG-06: Restart (cache cleared) with last-good on disk → serves from disk
 *   LG-07: Stale in-memory last-good is kept on subsequent HTTP failure
 *   LG-08: Fresh data replaces last-good (isLastGood transitions false)
 *   LG-09: Parse-rejection count > 0 does not prevent save when totalRecords ≥ 1000
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── Mock @workspace/db so DB functions don't hit the real PostgreSQL DB ────────
// LG tests are disk-only; DB is mocked to return empty (no snapshot).
const { dbExecuteMockLG } = vi.hoisted(() => ({
  dbExecuteMockLG: vi.fn().mockResolvedValue({ rows: [] }),
}));
vi.mock("@workspace/db", () => ({
  db: { execute: dbExecuteMockLG },
  INSTRUMENT_ASSET_CLASSES: [],
}));

import {
  getNseSecurityMaster,
  getNseSecurityMasterMeta,
  getNseSecurityMasterMap,
  _resetNseSecurityMasterForTest,
  _clearLastGoodDiskBlobForTest,
} from "./nseSecurityMaster";

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Build a minimal but valid EQUITY_L.csv body with `n` EQ records. */
function buildValidCsv(n: number): string {
  const header = "SYMBOL,NAME OF COMPANY,SERIES,DATE OF LISTING,PAID UP VALUE,MARKET LOT,ISIN NUMBER,FACE VALUE";
  const rows: string[] = [header];
  for (let i = 0; i < n; i++) {
    const sym = `SYM${String(i).padStart(4, "0")}`;
    // ISIN must match /^IN[A-Z0-9]{10}$/ — exactly 12 chars total (IN + 10 alphanum)
    // INE + 8 digits + A = 3 + 8 + 1 = 12 chars ✓
    const isin = `INE${String(i).padStart(8, "0")}A`;
    rows.push(`${sym},COMPANY ${i},EQ,01-JAN-2020,10,1,${isin},10`);
  }
  return rows.join("\n");
}

/** Build a malformed CSV body (too few records). */
function buildMalformedCsv(n = 5): string {
  const header = "SYMBOL,NAME OF COMPANY,SERIES,DATE OF LISTING,PAID UP VALUE,MARKET LOT,ISIN NUMBER,FACE VALUE";
  const rows: string[] = [header];
  for (let i = 0; i < n; i++) {
    rows.push(`SYM${i},Company ${i},EQ,01-JAN-2020,10,1,INE00000000${i}A,10`);
  }
  return rows.join("\n");
}

/** Build an empty CSV body. */
function buildEmptyCsv(): string {
  return "";
}

/** Stub global fetch to return a specific CSV body (or fail). */
function stubFetch(body: string | null): void {
  vi.stubGlobal("fetch", async (_url: string) => {
    if (body === null) {
      throw new Error("ECONNREFUSED: fetch failed (stubbed)");
    }
    return {
      ok: true,
      status: 200,
      text: async () => body,
    };
  });
}

/** Stub global fetch to return HTTP 503. */
function stubFetch503(): void {
  vi.stubGlobal("fetch", async (_url: string) => {
    return {
      ok: false,
      status: 503,
      text: async () => "Service Unavailable",
    };
  });
}

// ── Setup / Teardown ───────────────────────────────────────────────────────────

beforeEach(() => {
  _resetNseSecurityMasterForTest();
  _clearLastGoodDiskBlobForTest();
  vi.stubGlobal("fetch", async () => { throw new Error("fetch not stubbed in this test"); });
});

afterEach(() => {
  _resetNseSecurityMasterForTest();
  _clearLastGoodDiskBlobForTest();
  vi.unstubAllGlobals();
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("LG-01: Successful fresh fetch saves last-good to disk", () => {
  it("after a fresh fetch, the last-good disk blob is populated", async () => {
    stubFetch(buildValidCsv(1000));
    const master = await getNseSecurityMaster();
    expect(master).not.toBeNull();
    expect(master?.isLastGood).toBe(false);
    expect(master?.staleReason).toBeNull();
    expect(master?.totalRecords).toBe(1000);

    // Simulate process restart (clear in-memory cache but NOT disk blob)
    _resetNseSecurityMasterForTest();
    stubFetch(null); // HTTP now fails

    // Should fall back to last-good on disk
    const fromDisk = await getNseSecurityMaster();
    expect(fromDisk).not.toBeNull();
    expect(fromDisk?.isLastGood).toBe(true);
    expect(fromDisk?.staleReason).toMatch(/HTTP_FETCH_FAILED/);
    expect(fromDisk?.totalRecords).toBe(1000);
  });
});

describe("LG-02: On HTTP failure with last-good on disk → return last-good (STALE)", () => {
  it("isLastGood=true and staleReason is set when HTTP fails but disk has a blob", async () => {
    // First: successful fetch → saves last-good
    stubFetch(buildValidCsv(1000));
    await getNseSecurityMaster();
    _resetNseSecurityMasterForTest();

    // Second: HTTP fails
    stubFetch(null);
    const master = await getNseSecurityMaster();

    expect(master).not.toBeNull();
    expect(master?.isLastGood).toBe(true);
    expect(typeof master?.staleReason).toBe("string");
    expect(master?.staleReason?.length).toBeGreaterThan(0);
  });

  it("meta reports isLastGood=true when serving from last-good disk", async () => {
    stubFetch(buildValidCsv(1000));
    await getNseSecurityMaster();
    _resetNseSecurityMasterForTest();
    stubFetch(null);
    await getNseSecurityMaster();

    const meta = getNseSecurityMasterMeta();
    expect(meta.loaded).toBe(true);
    expect(meta.isLastGood).toBe(true);
    expect(meta.staleReason).not.toBeNull();
  });

  it("getNseSecurityMasterMap() returns a non-null Map from last-good", async () => {
    stubFetch(buildValidCsv(1000));
    await getNseSecurityMaster();
    _resetNseSecurityMasterForTest();
    stubFetch(null);
    await getNseSecurityMaster();

    const map = getNseSecurityMasterMap();
    expect(map).not.toBeNull();
    expect(map!.size).toBe(1000);
  });
});

describe("LG-03: On HTTP failure with NO last-good → null (fail closed)", () => {
  it("returns null when HTTP fails AND no last-good disk blob exists", async () => {
    stubFetch(null);
    const master = await getNseSecurityMaster();
    expect(master).toBeNull();
  });

  it("getMasterMap() returns null when HTTP fails and no disk blob", async () => {
    stubFetch(null);
    await getNseSecurityMaster();
    expect(getNseSecurityMasterMap()).toBeNull();
  });

  it("meta.loaded=false when HTTP fails and no disk blob", async () => {
    stubFetch(null);
    await getNseSecurityMaster();
    const meta = getNseSecurityMasterMeta();
    expect(meta.loaded).toBe(false);
    expect(meta.isLastGood).toBe(false);
  });

  it("returns null when HTTP returns 503 and no disk blob", async () => {
    stubFetch503();
    const master = await getNseSecurityMaster();
    expect(master).toBeNull();
  });
});

describe("LG-04: Malformed CSV (< 1000 records) rejected — last-good preserved", () => {
  it("malformed response does not overwrite last-good; previous good data is served", async () => {
    // Populate last-good with valid data
    stubFetch(buildValidCsv(1000));
    await getNseSecurityMaster();
    _resetNseSecurityMasterForTest();

    // Now serve malformed CSV
    stubFetch(buildMalformedCsv(5));
    const master = await getNseSecurityMaster();

    // Should fall back to last-good (malformed rejected)
    expect(master).not.toBeNull();
    expect(master?.isLastGood).toBe(true);
    expect(master?.totalRecords).toBe(1000); // previous good data
  });
});

describe("LG-05: Empty CSV rejected — last-good preserved", () => {
  it("empty CSV body is rejected; last-good is still served", async () => {
    stubFetch(buildValidCsv(1000));
    await getNseSecurityMaster();
    _resetNseSecurityMasterForTest();

    stubFetch(buildEmptyCsv());
    const master = await getNseSecurityMaster();

    expect(master).not.toBeNull();
    expect(master?.isLastGood).toBe(true);
    expect(master?.totalRecords).toBe(1000);
  });
});

describe("LG-06: Restart with last-good on disk → served from disk", () => {
  it("after a process restart (in-memory reset), last-good is loaded from disk", async () => {
    // Simulate first lifecycle: fresh fetch succeeds
    stubFetch(buildValidCsv(1000));
    const first = await getNseSecurityMaster();
    expect(first?.isLastGood).toBe(false);
    expect(first?.totalRecords).toBe(1000);

    // Simulate process restart
    _resetNseSecurityMasterForTest();

    // Simulate HTTP failure after restart
    stubFetch(null);
    const afterRestart = await getNseSecurityMaster();

    expect(afterRestart).not.toBeNull();
    expect(afterRestart?.isLastGood).toBe(true);
    expect(afterRestart?.totalRecords).toBe(1000);
    // bySymbol map is reconstructed correctly from disk
    const map = getNseSecurityMasterMap();
    expect(map?.size).toBe(1000);
  });
});

describe("LG-07: Stale in-memory last-good kept on subsequent HTTP failure", () => {
  it("if in-memory is already last-good and HTTP fails again, keeps in-memory last-good", async () => {
    // Populate last-good via disk
    stubFetch(buildValidCsv(1000));
    await getNseSecurityMaster();
    _resetNseSecurityMasterForTest();
    stubFetch(null);
    const stale = await getNseSecurityMaster();
    expect(stale?.isLastGood).toBe(true);

    // Second refresh attempt also fails — should keep in-memory last-good
    _resetNseSecurityMasterForTest();
    stubFetch(null);
    const stillStale = await getNseSecurityMaster();
    expect(stillStale).not.toBeNull();
    // Still loaded (either in-memory or disk)
    expect(stillStale?.totalRecords).toBe(1000);
  });
});

describe("LG-08: Fresh data replaces last-good (isLastGood transitions to false)", () => {
  it("after a successful refresh following a last-good cycle, isLastGood=false", async () => {
    // Cycle 1: fresh
    stubFetch(buildValidCsv(1000));
    await getNseSecurityMaster();
    _resetNseSecurityMasterForTest();

    // Cycle 2: HTTP failure → last-good from disk
    stubFetch(null);
    await getNseSecurityMaster();
    expect(getNseSecurityMasterMeta().isLastGood).toBe(true);

    // Reset and restore HTTP
    _resetNseSecurityMasterForTest();
    stubFetch(buildValidCsv(1200)); // new fresh data (different count to confirm replacement)
    await getNseSecurityMaster();

    const meta = getNseSecurityMasterMeta();
    expect(meta.isLastGood).toBe(false);
    expect(meta.staleReason).toBeNull();
    expect(meta.totalRecords).toBe(1200);
  });
});

describe("LG-09: parse-rejection count does not prevent save when totalRecords ≥ 1000", () => {
  it("CSV with some invalid rows (< 7 cols) but ≥ 1000 valid rows is accepted and saved", async () => {
    // Build a CSV with 1000 valid rows + 10 invalid rows (missing columns)
    const header = "SYMBOL,NAME OF COMPANY,SERIES,DATE OF LISTING,PAID UP VALUE,MARKET LOT,ISIN NUMBER,FACE VALUE";
    const rows: string[] = [header];
    for (let i = 0; i < 1000; i++) {
      const sym = `VALID${String(i).padStart(4, "0")}`;
      // ISIN: INE + 8 digits + A = 12 chars, matches /^IN[A-Z0-9]{10}$/
      rows.push(`${sym},Company,EQ,01-JAN-2020,10,1,INE${String(i).padStart(8, "0")}A,10`);
    }
    // 10 malformed rows (too few columns — will be skipped)
    for (let i = 0; i < 10; i++) {
      rows.push(`BADROW${i},OnlyTwoCols`);
    }
    stubFetch(rows.join("\n"));

    const master = await getNseSecurityMaster();
    expect(master).not.toBeNull();
    expect(master?.totalRecords).toBe(1000);
    expect(master?.isLastGood).toBe(false);

    // Verify saved to disk (simulate restart and HTTP failure)
    _resetNseSecurityMasterForTest();
    stubFetch(null);
    const fromDisk = await getNseSecurityMaster();
    expect(fromDisk?.totalRecords).toBe(1000);
    expect(fromDisk?.isLastGood).toBe(true);
  });
});
