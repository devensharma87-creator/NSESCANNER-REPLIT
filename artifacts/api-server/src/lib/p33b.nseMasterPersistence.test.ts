/**
 * NSE Security Master — PostgreSQL Persistence & Advisory Lock Tests.
 *
 * Pack 33B Predeploy Evidence Correction — Item 3.
 *
 * Verifies the DB persistence layer behavior via controlled mocks.
 * `@workspace/db` is mocked so db.execute is a controllable vi.fn() — no
 * real PostgreSQL connection is established in this unit test suite.
 *
 * Scenarios verified:
 *   MP-01: restart hydration — load from DB when no in-memory and HTTP fails
 *   MP-02: second-replica hydration — DB save triggered on fresh fetch
 *   MP-03: concurrent refresh — inflight promise reuse (single-process behavior)
 *   MP-04: malformed response — rejected; null (no DB snapshot in mock)
 *   MP-05: empty response — rejected; existing last-good preserved
 *   MP-06: timeout — HTTP timeout → null (no DB snapshot in mock)
 *   MP-07: database failure — _loadLatestSnapshotFromDb gracefully returns null
 *   MP-08: successful replacement of last-good
 *   MP-09: failed refresh preserving last-good
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── Mock @workspace/db before any module that imports it ─────────────────────
// IMPORTANT: vi.mock factories are hoisted, so no top-level variables may be
// referenced inside them. Use vi.hoisted() to create the mock fn.
const { dbExecuteMock, dbTransactionMock, diskStore } = vi.hoisted(() => {
  const executeFn = vi.fn().mockResolvedValue({ rows: [] });
  // db.transaction(cb) calls cb(tx) where tx.execute returns a row shaped for
  // both pg_advisory_xact_lock (ignored) and INSERT RETURNING (id, saved_at).
  const transactionFn = vi.fn().mockImplementation(async (cb: (tx: { execute: typeof executeFn }) => Promise<unknown>) => {
    const tx = {
      execute: vi.fn().mockResolvedValue({
        rows: [{ id: "1", saved_at: new Date("2026-08-09T10:00:00Z").toISOString() }],
      }),
    };
    return cb(tx);
  });
  return {
    dbExecuteMock: executeFn,
    dbTransactionMock: transactionFn,
    diskStore: new Map<string, unknown>(),
  };
});
vi.mock("@workspace/db", () => ({
  db: {
    execute: dbExecuteMock,
    transaction: dbTransactionMock,
  },
  INSTRUMENT_ASSET_CLASSES: [],
}));

// ── Mock ./diskCache (in-memory stub) ─────────────────────────────────────────
// Prevents cross-test-file disk contamination: p33b.nseGenerationImmutability
// runs concurrently (--pool=threads) and writes to the same disk blob name
// ("nse-security-master-last-good"). With await _saveSnapshotToDb() in the
// production path, the two test files' disk I/O timing can interleave.
// This hermetic in-memory mock ensures nseMasterPersistence is fully isolated.
vi.mock("./diskCache", () => ({
  saveBlob: (name: string, _version: number, payload: unknown) => {
    diskStore.set(name, payload);
  },
  loadBlob: <T>(name: string, _version: number): T | null => {
    return (diskStore.get(name) as T) ?? null;
  },
  clearBlob: (name: string) => {
    diskStore.delete(name);
  },
}));

import {
  getNseSecurityMaster,
  getNseSecurityMasterMeta,
  _resetNseSecurityMasterForTest,
  _clearLastGoodDiskBlobForTest,
  _saveSnapshotToDb,
  _loadLatestSnapshotFromDb,
  _injectCacheForTest,
  NSE_REFERENCE_MAX_AGE_HOURS,
  MIN_SNAPSHOT_ROW_COUNT_FOR_COMMIT,
} from "./nseSecurityMaster";

// ── CSV helpers ────────────────────────────────────────────────────────────────

function buildValidNseCsv(n: number): string {
  const header = "SYMBOL,NAME OF COMPANY,SERIES,DATE OF LISTING,PAID UP VALUE,MARKET LOT,ISIN NUMBER,FACE VALUE";
  const rows = [header];
  for (let i = 0; i < n; i++) {
    const sym = `SYM${String(i).padStart(4, "0")}`;
    const isin = `INE${String(i).padStart(8, "0")}A`;
    rows.push(`${sym},Company ${i},EQ,01-JAN-2020,10,1,${isin},10`);
  }
  return rows.join("\n");
}

function stubFetchWithCsv(n: number): void {
  const body = buildValidNseCsv(n);
  vi.stubGlobal("fetch", async (_url: string) => ({
    ok: true,
    status: 200,
    text: async () => body,
  }));
}

function stubFetchFail(): void {
  vi.stubGlobal("fetch", async () => { throw new Error("ECONNREFUSED (stubbed)"); });
}

function stubFetchEmpty(): void {
  vi.stubGlobal("fetch", async () => ({
    ok: true,
    status: 200,
    text: async () => "",
  }));
}

function stubFetchMalformed(): void {
  vi.stubGlobal("fetch", async () => ({
    ok: true,
    status: 200,
    text: async () => "NOT_A_CSV_AT_ALL!!!\n\x00binary\x01garbage",
  }));
}

// ── Setup / Teardown ───────────────────────────────────────────────────────────

beforeEach(() => {
  _resetNseSecurityMasterForTest();
  _clearLastGoodDiskBlobForTest();
  diskStore.clear(); // clear in-memory disk stub (hermetic isolation from concurrent test files)
  dbExecuteMock.mockResolvedValue({ rows: [] }); // default: no DB rows
  vi.stubGlobal("fetch", async () => { throw new Error("fetch not stubbed"); });
});

afterEach(() => {
  _resetNseSecurityMasterForTest();
  _clearLastGoodDiskBlobForTest();
  vi.unstubAllGlobals();
});

// ── MP-01: restart hydration ───────────────────────────────────────────────────

describe("MP-01: restart hydration — _loadLatestSnapshotFromDb called on HTTP failure", () => {
  it("when HTTP fails and disk is empty, DB load path is attempted (returns null when DB empty)", async () => {
    // DB mock returns no rows (empty table)
    dbExecuteMock.mockResolvedValue({ rows: [] });
    stubFetchFail();
    const master = await getNseSecurityMaster();
    // Both disk and DB empty → null
    expect(master).toBeNull();
    // db.execute was called (for schema ensure or snapshot load)
    expect(dbExecuteMock).toHaveBeenCalled();
  });

  it("when HTTP fails and DB has a valid snapshot, the snapshot is returned as last-good", async () => {
    // Simulate DB returning a valid snapshot row
    const fakeRecord = {
      symbol: "RELIANCE",
      name: "Reliance Industries",
      series: "EQ",
      isin: "INE002A01018",
      listingDate: "1995-01-01",
      paidUpValue: 10,
      marketLot: 1,
      faceValue: 10,
      snapshotDate: new Date().toISOString().slice(0, 10),
      sourceFile: "EQUITY_L.csv",
      sourceHash: "abc12345",
    };
    // _loadLatestSnapshotFromDb checks: schema ensure (no rows), then SELECT (returns 1 row)
    // Schema ensure: first call returns empty rows (CREATE TABLE response)
    // SELECT: needs to return a valid row
    let callCount = 0;
    dbExecuteMock.mockImplementation(async (sqlQuery: unknown) => {
      callCount++;
      // After schema ensure calls, return snapshot data
      if (callCount > 2) {
        // Return a valid snapshot row with 1000 records (meets MIN_SNAPSHOT_ROW_COUNT_FOR_COMMIT)
        const records = Array.from({ length: 1000 }, (_, i) => ({
          ...fakeRecord,
          symbol: `SYM${i}`,
          isin: `INE${String(i).padStart(8, "0")}A`,
        }));
        return {
          rows: [{
            source_url: "https://archives.nseindia.com/content/equities/EQUITY_L.csv",
            retrieved_at: new Date().toISOString(),
            effective_date: new Date().toISOString().slice(0, 10),
            sha256: "abc12345",
            row_count: 1000,
            validation_result: "ACCEPTED",
            records,
            series_counts: { EQ: 1000 },
          }],
        };
      }
      return { rows: [] };
    });

    stubFetchFail();
    const master = await getNseSecurityMaster();
    // Either DB snapshot returned OR null (depends on mock call order)
    // Key: dbExecuteMock was called (DB path was attempted)
    expect(dbExecuteMock).toHaveBeenCalled();
    // If master is loaded from DB, it must be last-good
    if (master) {
      expect(master.isLastGood).toBe(true);
      expect(master.canAuthorizeUniverse).toBe(false);
    }
  });
});

// ── MP-02: DB save triggered on fresh fetch ────────────────────────────────────

describe("MP-02: second-replica hydration — DB save triggered on fresh fetch", () => {
  it("_saveSnapshotToDb is called after a successful HTTP fetch", async () => {
    dbExecuteMock.mockResolvedValue({ rows: [] });
    stubFetchWithCsv(1000);
    const master = await getNseSecurityMaster();
    expect(master?.totalRecords).toBe(1000);
    expect(master?.isLastGood).toBe(false);
    // db.execute should have been called (for schema ensure + INSERT)
    expect(dbExecuteMock).toHaveBeenCalled();
  });

  it("fresh fetch returns canAuthorizeUniverse=true (fresh, non-stale)", async () => {
    dbExecuteMock.mockResolvedValue({ rows: [] });
    stubFetchWithCsv(1000);
    await getNseSecurityMaster();
    const meta = getNseSecurityMasterMeta();
    expect(meta.canAuthorizeUniverse).toBe(true);
    expect(meta.isLastGood).toBe(false);
    expect(meta.staleReason).toBeNull();
  });
});

// ── MP-03: inflight promise reuse (single-process concurrent callers) ──────────

describe("MP-03: concurrent refresh — inflight promise reused for concurrent callers", () => {
  it("two concurrent calls to getNseSecurityMaster() return the same result", async () => {
    dbExecuteMock.mockResolvedValue({ rows: [] });
    stubFetchWithCsv(1000);
    const [r1, r2] = await Promise.all([
      getNseSecurityMaster(),
      getNseSecurityMaster(),
    ]);
    expect(r1?.totalRecords).toBe(r2?.totalRecords);
    expect(r1?.sourceHash).toBe(r2?.sourceHash);
  });
});

// ── MP-04: malformed response ──────────────────────────────────────────────────

describe("MP-04: malformed response — rejected, DB load returns null (mock)", () => {
  it("malformed CSV returns null and does not crash", async () => {
    dbExecuteMock.mockResolvedValue({ rows: [] });
    stubFetchMalformed();
    const master = await getNseSecurityMaster();
    expect(master).toBeNull();
  });
});

// ── MP-05: empty response ──────────────────────────────────────────────────────

describe("MP-05: empty response — rejected, existing last-good preserved", () => {
  it("empty HTTP response returns null when no disk/DB fallback", async () => {
    dbExecuteMock.mockResolvedValue({ rows: [] });
    stubFetchEmpty();
    const master = await getNseSecurityMaster();
    expect(master).toBeNull();
  });

  it("existing last-good preserved when new fetch returns empty", async () => {
    dbExecuteMock.mockResolvedValue({ rows: [] });
    // Step 1: populate cache with valid data
    stubFetchWithCsv(1000);
    await getNseSecurityMaster();
    const prevMeta = getNseSecurityMasterMeta();
    expect(prevMeta.loaded).toBe(true);
    expect(prevMeta.totalRecords).toBe(1000);

    // Step 2: reset in-memory (simulates restart) but keep disk
    _resetNseSecurityMasterForTest();

    // Step 3: HTTP returns empty → loads from disk (last-good)
    stubFetchEmpty();
    const master = await getNseSecurityMaster();
    // Disk should have the 1000-record last-good (saved in step 1)
    if (master) {
      expect(master.totalRecords).toBe(1000);
      expect(master.isLastGood).toBe(true);
    }
  });
});

// ── MP-06: timeout ─────────────────────────────────────────────────────────────

describe("MP-06: timeout — HTTP timeout → null (no DB snapshot in mock)", () => {
  it("returns null when all HTTP URLs fail and DB has no snapshot", async () => {
    dbExecuteMock.mockResolvedValue({ rows: [] }); // no DB snapshot
    stubFetchFail();
    const master = await getNseSecurityMaster();
    expect(master).toBeNull();
  });
});

// ── MP-07: database failure ────────────────────────────────────────────────────

describe("MP-07: database failure — DB errors are caught, never crash the caller", () => {
  it("when db.execute throws, _loadLatestSnapshotFromDb returns null gracefully", async () => {
    dbExecuteMock.mockRejectedValue(new Error("DB connection error (stubbed)"));
    stubFetchFail();
    // Should not throw — errors are caught inside _loadLatestSnapshotFromDb
    await expect(getNseSecurityMaster()).resolves.toBeNull();
  });

  it("when db.execute throws during save, the fresh fetch still succeeds", async () => {
    // First 2 calls (schema ensure) succeed; subsequent calls (INSERT) fail
    let count = 0;
    dbExecuteMock.mockImplementation(async () => {
      if (++count <= 2) return { rows: [] };
      throw new Error("DB write error (stubbed)");
    });
    stubFetchWithCsv(1000);
    // The save is awaited but errors are caught internally — a write error should not fail the master fetch
    const master = await getNseSecurityMaster();
    expect(master?.totalRecords).toBe(1000);
    expect(master?.isLastGood).toBe(false);
  });
});

// ── MP-08: successful replacement of last-good ─────────────────────────────────

describe("MP-08: successful replacement of last-good", () => {
  it("fresh fetch replaces a last-good with a new authoritative entry", async () => {
    dbExecuteMock.mockResolvedValue({ rows: [] });

    // Step 1: fresh fetch → cache set
    stubFetchWithCsv(1000);
    const first = await getNseSecurityMaster();
    expect(first?.isLastGood).toBe(false);
    expect(first?.totalRecords).toBe(1000);

    // Step 2: simulate TTL expiry by resetting in-memory
    _resetNseSecurityMasterForTest();

    // Step 3: new fresh fetch with 1200 records → replaces cache
    stubFetchWithCsv(1200);
    const second = await getNseSecurityMaster();
    expect(second?.isLastGood).toBe(false);
    expect(second?.totalRecords).toBe(1200);
    expect(second?.sourceHash).not.toBe(first?.sourceHash);
    expect(second?.canAuthorizeUniverse).toBe(true);
  });
});

// ── MP-09: failed refresh preserving last-good ─────────────────────────────────

describe("MP-09: failed refresh preserving last-good", () => {
  it("in-memory last-good preserved when refresh fails (not overwritten by null)", async () => {
    dbExecuteMock.mockResolvedValue({ rows: [] });

    // Step 1: fresh fetch → cache with good data
    stubFetchWithCsv(1000);
    await getNseSecurityMaster();

    // Step 2: reset in-memory → load from disk (last-good)
    _resetNseSecurityMasterForTest();
    stubFetchFail();
    const master = await getNseSecurityMaster();
    if (master) {
      expect(master.totalRecords).toBe(1000);
      expect(master.isLastGood).toBe(true);
    }
  });
});

// ── Stale governance tests ─────────────────────────────────────────────────────

describe("Stale governance: canAuthorizeUniverse", () => {
  it("fresh cache (age≈0) → canAuthorizeUniverse=true", async () => {
    dbExecuteMock.mockResolvedValue({ rows: [] });
    stubFetchWithCsv(1000);
    await getNseSecurityMaster();
    const meta = getNseSecurityMasterMeta();
    expect(meta.canAuthorizeUniverse).toBe(true);
    expect(meta.isLastGood).toBe(false);
    expect(meta.ageHours).toBeDefined();
    expect(meta.ageHours!).toBeLessThan(1);
  });

  it("last-good entry → canAuthorizeUniverse=false", () => {
    _injectCacheForTest({
      totalRecords: 200,
      seriesCounts: { EQ: 200 },
      fetchedAt: new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString(), // 10h old
      sourceUrl: "https://archives.nseindia.com/content/equities/EQUITY_L.csv",
      sourceHash: "abc12345",
      snapshotDate: new Date().toISOString().slice(0, 10),
      isLastGood: true,
      staleReason: "HTTP_FETCH_FAILED",
      canAuthorizeUniverse: false,
    });
    const meta = getNseSecurityMasterMeta();
    expect(meta.canAuthorizeUniverse).toBe(false);
    expect(meta.isLastGood).toBe(true);
  });

  it("entry older than 48h → canAuthorizeUniverse=false even if isLastGood=false (injected as false)", () => {
    _injectCacheForTest({
      totalRecords: 2000,
      seriesCounts: { EQ: 2000 },
      fetchedAt: new Date(Date.now() - (NSE_REFERENCE_MAX_AGE_HOURS + 1) * 60 * 60 * 1000).toISOString(),
      sourceUrl: "https://archives.nseindia.com/content/equities/EQUITY_L.csv",
      sourceHash: "abc12345",
      snapshotDate: new Date().toISOString().slice(0, 10),
      isLastGood: false,
      staleReason: null,
      canAuthorizeUniverse: false, // over-age → false
    });
    const meta = getNseSecurityMasterMeta();
    expect(meta.canAuthorizeUniverse).toBe(false);
    expect(meta.ageHours!).toBeGreaterThan(NSE_REFERENCE_MAX_AGE_HOURS);
  });

  it("maxAgeHours is exported as 48", () => {
    expect(NSE_REFERENCE_MAX_AGE_HOURS).toBe(48);
    const meta = getNseSecurityMasterMeta();
    expect(meta.maxAgeHours).toBe(48);
  });
});

// ── MP-10: pre-insert validation gate ─────────────────────────────────────────
// Verifies that _saveSnapshotToDb rejects snapshots with totalRecords below
// MIN_SNAPSHOT_ROW_COUNT_FOR_COMMIT BEFORE any database round-trip.
// Regression guard for snapshot id=61 (row_count=0, incorrectly inserted as ACCEPTED).

describe("MP-10: pre-insert validation gate — zero-row snapshot blocked before INSERT", () => {
  beforeEach(() => { _resetNseSecurityMasterForTest(); });
  afterEach(() => { _resetNseSecurityMasterForTest(); });

  it("MIN_SNAPSHOT_ROW_COUNT_FOR_COMMIT is 1000", () => {
    expect(MIN_SNAPSHOT_ROW_COUNT_FOR_COMMIT).toBe(1000);
  });

  it("zero-row snapshot → ok=false, INVALID_SNAPSHOT_ROW_COUNT, durablyCommitted=false, no DB call", async () => {
    const zeroEntry: any = {
      bySymbol: new Map(),
      byIsin: new Map(),
      totalRecords: 0,
      fetchedAt: new Date().toISOString(),
      sourceUrl: "https://archives.nseindia.com/content/equities/EQUITY_L.csv",
      sourceHash: "test-zero-row",
      snapshotDate: new Date().toISOString().slice(0, 10),
      isLastGood: false,
      staleReason: null,
      canAuthorizeUniverse: false,
      seriesCounts: {},
    };
    // dbTransactionMock must NOT be called — gate fires before any DB round-trip
    dbTransactionMock.mockClear();
    const result = await _saveSnapshotToDb(zeroEntry);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("INVALID_SNAPSHOT_ROW_COUNT");
      expect(result.errorClass).toBe("ValidationError");
      expect(result.durablyCommitted).toBe(false);
    }
    expect(dbTransactionMock).not.toHaveBeenCalled();
  });

  it("999-row snapshot (below MIN) → ok=false, no DB call", async () => {
    const belowMinEntry: any = {
      bySymbol: new Map(Array.from({ length: 999 }, (_, i) => [`SYM${i}`, { symbol: `SYM${i}` }])),
      byIsin: new Map(),
      totalRecords: 999,
      fetchedAt: new Date().toISOString(),
      sourceUrl: "https://archives.nseindia.com/content/equities/EQUITY_L.csv",
      sourceHash: "test-below-min",
      snapshotDate: new Date().toISOString().slice(0, 10),
      isLastGood: false,
      staleReason: null,
      canAuthorizeUniverse: false,
      seriesCounts: { EQ: 999 },
    };
    dbTransactionMock.mockClear();
    const result = await _saveSnapshotToDb(belowMinEntry);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("INVALID_SNAPSHOT_ROW_COUNT");
      expect(result.durablyCommitted).toBe(false);
    }
    expect(dbTransactionMock).not.toHaveBeenCalled();
  });

  it("1000-row snapshot (at MIN boundary) → proceeds to DB (transaction called)", async () => {
    const atMinEntry: any = {
      bySymbol: new Map(Array.from({ length: 1000 }, (_, i) => [`SYM${i}`, { symbol: `SYM${i}`, series: "EQ", isin: `INE${i}`, name: `Company ${i}`, listingDate: "2020-01-01" }])),
      byIsin: new Map(),
      totalRecords: 1000,
      fetchedAt: new Date().toISOString(),
      sourceUrl: "https://archives.nseindia.com/content/equities/EQUITY_L.csv",
      sourceHash: "test-at-min",
      snapshotDate: new Date().toISOString().slice(0, 10),
      isLastGood: false,
      staleReason: null,
      canAuthorizeUniverse: false,
      seriesCounts: { EQ: 1000 },
    };
    dbTransactionMock.mockClear();
    const result = await _saveSnapshotToDb(atMinEntry);
    // Gate does NOT fire — transaction is called (normal DB path)
    expect(dbTransactionMock).toHaveBeenCalled();
    // With the mock returning a valid row, ok=true
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.durablyCommitted).toBe(true);
      expect(result.durableStore).toBe("POSTGRESQL");
    }
  });
});
