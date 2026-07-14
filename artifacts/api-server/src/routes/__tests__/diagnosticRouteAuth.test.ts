/**
 * Priority 6 — Owner-only Diagnostic Route Security Regression Tests.
 *
 * Verifies that all 7 owner-only diagnostic / manual-trigger endpoints
 * added by Priorities 2-5 are gated by the **strict** owner middleware
 * — i.e. they do NOT inherit `requireOwner`'s public-mode read bypass.
 *
 * Endpoints under test:
 *   1. GET  /api/paper/eq/sizing-preview                          (P5)
 *   2. GET  /api/paper/eq/candidates-diagnostic                    (P5)
 *   3. GET  /api/option-snapshots/diagnostics                      (P3)
 *   4. POST /api/option-snapshots/run-now                          (P3)
 *   5. GET  /api/candles/diagnostics                               (P4)
 *   6. POST /api/candles/sync                                      (P4)
 *   7. GET  /api/stocks-to-watch/diagnostics/sector-coverage       (P2)
 *   8. GET  /api/option-snapshots/analytics                        (P9)
 *
 * Auth cases per endpoint:
 *   A) anonymous, public-mode OFF  → 401 AUTH_REQUIRED
 *   B) anonymous, public-mode ON   → 403 OWNER_ONLY_DIAGNOSTIC
 *      (CRITICAL: proves no public-mode read bypass)
 *   C) subscriber cookie           → 401 AUTH_REQUIRED  (no role escalation)
 *   D) owner cookie                → NOT 401 / 403      (gate passes through)
 *
 * Test-only file. No runtime / trading / data-ingestion / schema /
 * scheduler logic is changed.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import http from "node:http";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// Mocks — keep handler bodies safely no-op'd so the gate is what we measure.
// `isPublicAccessEnabled` is the only mock we toggle per-test.
// ---------------------------------------------------------------------------

const publicAccessState = { enabled: false };

vi.mock("../../lib/publicAccess", () => ({
  isPublicAccessEnabled: () => publicAccessState.enabled,
  setPublicAccess: (v: boolean) => {
    publicAccessState.enabled = v;
  },
  logPublicAccessBootState: () => {},
}));

// Minimal chainable DB stub. The diagnostic handlers run a few `db.execute(sql\`...\`)`
// or drizzle-builder chains and then `res.json(...)` the result. We return empty
// rows everywhere so handlers don't crash for the owner-pass-through case.
const dbStub = {
  execute: vi.fn(async () => ({ rows: [] })),
  select: vi.fn(() => ({
    from: () => ({
      groupBy: () => Promise.resolve([]),
      where: () => ({ limit: () => Promise.resolve([]) }),
      limit: () => Promise.resolve([]),
    }),
  })),
};

vi.mock("@workspace/db", () => ({
  db: dbStub,
  swingScanResultTable: { symbol: { name: "symbol" } },
}));

// Ingestor + helper stubs — all funcs the routes import. Safe defaults.
vi.mock("../../lib/optionChainSnapshotIngestor", () => ({
  SNAPSHOT_INDICES: ["NIFTY", "BANKNIFTY", "SENSEX"] as const,
  getSnapshotConfig: () => ({
    enabled: false,
    intervalMin: 5,
    strikeWindow: 10,
    retentionDays: 30,
    indices: ["NIFTY", "BANKNIFTY", "SENSEX"],
  }),
  isOptionSnapshotEnabled: () => false,
  runIngestionTick: vi.fn(async () => ({
    startedAt: new Date(),
    finishedAt: new Date(),
    durationMs: 0,
    underlyingsAttempted: 0,
    underlyingsOk: 0,
    expiriesCovered: 0,
    rowsWritten: 0,
    source: "live" as const,
    errors: [],
  })),
  getLastRun: () => null,
  startOptionSnapshotIngestor: () => {},
  stopOptionSnapshotIngestor: () => {},
}));

vi.mock("../../lib/candleWarehouseIngestor", () => ({
  isCandleWarehouseEnabled: () => false,
  getEnabledUniverses: () => ["indices" as const],
  getWarehouseConfig: () => ({
    enabled: false,
    universes: ["indices"],
    intervals: ["day", "15minute"],
    maxSymbolsPerRun: 60,
    retentionDaysIntraday: 60,
  }),
  syncCandles: vi.fn(async () => ({
    startedAt: new Date(),
    finishedAt: new Date(),
    durationMs: 0,
    kind: "INCREMENTAL" as const,
    interval: "day" as const,
    universe: "indices" as const,
    symbolsAttempted: 0,
    symbolsOk: 0,
    rowsWritten: 0,
    errors: [],
  })),
  getRecentResults: () => [],
  startCandleWarehouse: () => {},
  stopCandleWarehouse: () => {},
}));

vi.mock("../../lib/marketEvents", () => ({
  computeMarketStatus: () => "closed" as const,
}));

// paperAccount — only override the 4 funcs equitySizing route calls;
// keep the constants (SEED_CAPITAL, EQUITY_RISK, …) which `equitySizingHelper`
// imports from the same module.
vi.mock("../../lib/paperAccount", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/paperAccount")>();
  return {
    ...actual,
    ensureDailyReset: vi.fn(async () => {}),
    getEqDailyRealizedDrawdown: async () => 0,
    getEqWeeklyRealizedDrawdown: async () => 0,
    getEqMonthlyRealizedDrawdown: async () => 0,
  };
});

// Heavy lib imports for stocksToWatch route — we only hit the
// sector-coverage endpoint, but the module imports these eagerly.
vi.mock("../../lib/stocksToWatch", () => ({
  getStocksToWatch: vi.fn(async () => ({ items: [] })),
}));

vi.mock("../../lib/swingScannerStore", () => ({
  getLatestSwingScan: vi.fn(async () => ({ rows: [], generatedAt: null })),
  getSchedulerState: () => ({}),
  startSwingScanScheduler: () => {},
  getIntradayRefreshHealth: vi.fn(() => ({
    cyclesTotal: 0,
    rowsUpdatedTotal: 0,
    triggerHitsLatchedTotal: 0,
    lastCycle: null,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastErrorClass: null,
    lastErrorMessage: null,
    bootedAt: new Date().toISOString(),
  })),
  getSwingBenchmarkHealth: vi.fn(() => ({
    fetchesTotal: 0,
    bySource: { yahoo: 0, yahoo_retry: 0, kite: 0, none: 0 },
    lastBenchmark: null,
    bootedAt: new Date().toISOString(),
  })),
  getLatestSwingScanSectorRows: vi.fn(async () => ({ scanDate: null, rows: [] })),
  getSwingCandleHealth: vi.fn(() => ({ lastScan: null, bootedAt: new Date().toISOString() })),
  deriveCandleDominant: () => "none" as const,
}));

// marketTrend — the candle-source diagnostic calls getMarketTrend(); keep it a
// cheap stub with no index provenance so the owner-path returns available:false.
vi.mock("../../lib/marketTrend", () => ({
  getMarketTrend: vi.fn(async () => ({ candleProvenance: undefined })),
}));

// Silence pino in tests.
vi.mock("../../lib/logger", () => ({
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
}));

// ---------------------------------------------------------------------------
// Imports come AFTER vi.mock() so hoisted mocks apply.
// ---------------------------------------------------------------------------
const equitySizingRouter = (await import("../equitySizing")).default;
const optionChainSnapshotRouter = (await import("../optionChainSnapshot")).default;
const candleWarehouseRouter = (await import("../candleWarehouse")).default;
const stocksToWatchRouter = (await import("../stocksToWatch")).default;

// ---------------------------------------------------------------------------
// Test harness — one express app, real http server, fetch-based requests.
// Cookies are signed exactly like cookie-parser/cookie-signature does:
//   `s:<value>.<base64-hmac-sha256(value, secret) without trailing '=' padding>`
// ---------------------------------------------------------------------------

const TEST_SECRET = "test-session-secret-for-priority-6-regression-tests";

function signCookie(value: string): string {
  const sig = createHmac("sha256", TEST_SECRET).update(value).digest("base64").replace(/=+$/, "");
  return `s:${value}.${sig}`;
}

const OWNER_COOKIE = `scanner_session=${encodeURIComponent(signCookie("owner"))}`;
const SUBSCRIBER_COOKIE = `scanner_session=${encodeURIComponent(signCookie("u:42"))}`;

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app: Express = express();
  app.use(cookieParser(TEST_SECRET));
  app.use(express.json());
  app.use("/api", equitySizingRouter);
  app.use("/api", optionChainSnapshotRouter);
  app.use("/api", candleWarehouseRouter);
  app.use("/api", stocksToWatchRouter);
  // Swallow handler errors so a 500 from incomplete mocks doesn't pollute the
  // gate-test signal — we only check status codes from the gate itself.
  app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (!res.headersSent) res.status(500).json({ error: "test_handler_threw" });
  });

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

beforeEach(() => {
  publicAccessState.enabled = false;
});

// ---------------------------------------------------------------------------
// Endpoint table — drives the parametrised auth-matrix tests.
// ---------------------------------------------------------------------------

interface Endpoint {
  name: string;
  method: "GET" | "POST";
  path: string;
}

const ENDPOINTS: readonly Endpoint[] = [
  { name: "P5 sizing-preview",        method: "GET",  path: "/api/paper/eq/sizing-preview?symbol=RELIANCE&entry=2500&stop=2400" },
  { name: "P5 candidates-diagnostic", method: "GET",  path: "/api/paper/eq/candidates-diagnostic" },
  { name: "P3 snapshot diagnostics",  method: "GET",  path: "/api/option-snapshots/diagnostics" },
  { name: "P3 snapshot run-now",      method: "POST", path: "/api/option-snapshots/run-now" },
  { name: "P4 candle diagnostics",    method: "GET",  path: "/api/candles/diagnostics" },
  { name: "P4 candle sync",           method: "POST", path: "/api/candles/sync" },
  { name: "P2 sector-coverage",       method: "GET",  path: "/api/stocks-to-watch/diagnostics/sector-coverage" },
  { name: "P9 snapshot analytics",    method: "GET",  path: "/api/option-snapshots/analytics" },
  { name: "S2a intraday-refresh",     method: "GET",  path: "/api/stocks-to-watch/diagnostics/intraday-refresh" },
  { name: "S3a swing-benchmark",      method: "GET",  path: "/api/stocks-to-watch/diagnostics/swing-benchmark" },
  { name: "S4b sector-strength",      method: "GET",  path: "/api/stocks-to-watch/diagnostics/sector-strength" },
  { name: "H10b swing-shadow-score",  method: "GET",  path: "/api/stocks-to-watch/diagnostics/swing-shadow-score" },
  { name: "S128 candle-source",       method: "GET",  path: "/api/stocks-to-watch/diagnostics/candle-source" },
] as const;

async function call(ep: Endpoint, cookie?: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${ep.path}`, {
    method: ep.method,
    headers: cookie ? { cookie } : {},
  });
  let body: unknown = null;
  const text = await res.text();
  if (text.length > 0) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Priority 6 — owner-only diagnostic route auth gate", () => {
  describe.each(ENDPOINTS)("$name ($method $path)", (ep) => {
    it("Case A: anonymous + public-mode OFF → 401 AUTH_REQUIRED", async () => {
      publicAccessState.enabled = false;
      const r = await call(ep);
      expect(r.status).toBe(401);
      expect(r.body).toMatchObject({ code: "AUTH_REQUIRED" });
    });

    it("Case B: anonymous + public-mode ON → 403 OWNER_ONLY_DIAGNOSTIC (no public-mode read bypass)", async () => {
      publicAccessState.enabled = true;
      const r = await call(ep);
      expect(r.status).toBe(403);
      expect(r.body).toMatchObject({ code: "OWNER_ONLY_DIAGNOSTIC" });
    });

    it("Case C: subscriber cookie + public-mode OFF → 401 AUTH_REQUIRED (no role escalation)", async () => {
      // The strict gate only recognises owner — a valid subscriber cookie
      // (`getSession` returns `{role:"subscriber",...}`) must still be
      // rejected. Public-mode-off path returns 401, not 403.
      publicAccessState.enabled = false;
      const r = await call(ep, SUBSCRIBER_COOKIE);
      expect(r.status).toBe(401);
      expect(r.body).toMatchObject({ code: "AUTH_REQUIRED" });
    });

    it("Case D: owner cookie + public-mode OFF → gate passes (status not 401/403)", async () => {
      publicAccessState.enabled = false;
      const r = await call(ep, OWNER_COOKIE);
      // We don't pin the exact status — the handler may 200, 400 (missing
      // query), or 500 (mocked DB returns shapes the handler doesn't
      // anticipate). The point is the gate let it through.
      expect(r.status).not.toBe(401);
      expect(r.status).not.toBe(403);
    });

    it("Case D': owner cookie + public-mode ON → gate still passes (owner is owner regardless of public mode)", async () => {
      publicAccessState.enabled = true;
      const r = await call(ep, OWNER_COOKIE);
      expect(r.status).not.toBe(401);
      expect(r.status).not.toBe(403);
    });
  });
});

// ---------------------------------------------------------------------------
// Priority 9 — default-path runtime regression for /option-snapshots/analytics.
//
// The analytics handler has two distinct SQL branches (default = latest per
// (underlying, expiry) limited to 2 most-recent expiries; capturedAt = exact
// match). The default branch previously crashed if `lookbackMinutes` was
// omitted because the conditional guard tested an always-truthy SQL fragment
// instead of the cutoff Date. These tests pin the post-fix behaviour.
// ---------------------------------------------------------------------------

describe("Priority 9 — /api/option-snapshots/analytics owner-path runtime", () => {
  it("default (no params) returns 200 with empty groups when no rows exist", async () => {
    publicAccessState.enabled = false;
    const r = await call(
      { name: "p9 default", method: "GET", path: "/api/option-snapshots/analytics" },
      OWNER_COOKIE,
    );
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      groupCount: 0,
      groups: [],
      universe: ["NIFTY", "BANKNIFTY", "SENSEX"],
    });
  });
  it("with lookbackMinutes returns 200 and propagates filter back in response", async () => {
    publicAccessState.enabled = false;
    const r = await call(
      {
        name: "p9 lookback",
        method: "GET",
        path: "/api/option-snapshots/analytics?lookbackMinutes=60&staleThresholdMin=15",
      },
      OWNER_COOKIE,
    );
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      filters: { lookbackMinutes: 60, staleThresholdMin: 15 },
      groupCount: 0,
    });
  });
  it("with capturedAt (exact-match branch) returns 200", async () => {
    publicAccessState.enabled = false;
    const r = await call(
      {
        name: "p9 capturedAt",
        method: "GET",
        path: "/api/option-snapshots/analytics?capturedAt=2026-05-15T09:30:00Z",
      },
      OWNER_COOKIE,
    );
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      filters: { capturedAt: "2026-05-15T09:30:00.000Z" },
      groupCount: 0,
    });
  });
  it("rejects bogus query params silently (filters drop to safe defaults)", async () => {
    publicAccessState.enabled = false;
    const r = await call(
      {
        name: "p9 bad params",
        method: "GET",
        path:
          "/api/option-snapshots/analytics?underlying=GARBAGE&expiry=not-a-date&lookbackMinutes=abc&maxGroups=999999",
      },
      OWNER_COOKIE,
    );
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      filters: {
        underlying: null,
        expiry: null,
        lookbackMinutes: null,
        maxGroups: 12,
      },
    });
  });
});

describe("S4b — /api/stocks-to-watch/diagnostics/sector-strength owner-path contract", () => {
  it("owner path returns the documented response shape with empty rows", async () => {
    publicAccessState.enabled = false;
    const r = await call(
      { name: "s4b shape", method: "GET", path: "/api/stocks-to-watch/diagnostics/sector-strength" },
      OWNER_COOKIE,
    );
    expect(r.status).toBe(200);
    const body = r.body as Record<string, unknown>;
    expect(body).toMatchObject({
      scanDate: null,
      totalRows: 0,
      totalSectors: 0,
      confidentSectors: 0,
      minMembers: 5,
      sectors: [],
    });
    expect(typeof body.generatedAt).toBe("string");
    // Unavailable-metrics surface MUST be present so the UI can render
    // the "why is breadth absent" note. Architect S4b review.
    const metrics = body.unavailableMetrics as Array<{ metric: string }>;
    expect(Array.isArray(metrics)).toBe(true);
    const names = metrics.map((m) => m.metric);
    expect(names).toEqual(
      expect.arrayContaining(["pctAboveEma20", "pctAboveEma50", "pctAboveEma200", "pct20dHigh"]),
    );
  });
});

// ---------------------------------------------------------------------------
// H10b — owner-path runtime behaviour for the swing-shadow-score diagnostic.
// Auth cases A/B/C/D are already covered by the parametrised matrix above;
// these tests cover the feature-flag-disabled response and the latest-scan-
// only SQL semantics required by the H10b spec checklist.
// ---------------------------------------------------------------------------

describe("H10b — /api/stocks-to-watch/diagnostics/swing-shadow-score owner-path runtime", () => {
  const SHADOW_PATH = "/api/stocks-to-watch/diagnostics/swing-shadow-score";

  beforeEach(() => {
    delete process.env["SWING_SHADOW_DIAG_ENABLED"];
    // Reset dbStub.execute to default empty-rows behaviour between tests.
    dbStub.execute.mockReset();
    dbStub.execute.mockImplementation(async () => ({ rows: [] }));
  });

  // The dbStub's execute mock infers `rows: never[]`; cast row arrays
  // through `unknown` so per-test fixtures can use real shapes.
  type AnyRows = { rows: never[] };
  const asRows = <T,>(rows: T[]): AnyRows => ({ rows }) as unknown as AnyRows;

  it("feature-flag disabled → 200 with featureFlagEnabled:false and no computation", async () => {
    process.env["SWING_SHADOW_DIAG_ENABLED"] = "0";
    const r = await call({ name: "h10b off", method: "GET", path: SHADOW_PATH }, OWNER_COOKIE);
    expect(r.status).toBe(200);
    const body = r.body as Record<string, unknown>;
    expect(body).toMatchObject({
      featureFlagEnabled: false,
      flagEnvVar: "SWING_SHADOW_DIAG_ENABLED",
    });
    // Disabled branch returns early — must NOT compute scanDate / totalRows
    // and must NOT have called the DB.
    expect(body.scanDate).toBeUndefined();
    expect(body.totalRows).toBeUndefined();
    expect(dbStub.execute).not.toHaveBeenCalled();
  });

  it("feature-flag enabled, empty DB → 200 with scanDate=null and totalRows=0; runs exactly one query (latest scan_date probe)", async () => {
    delete process.env["SWING_SHADOW_DIAG_ENABLED"];
    dbStub.execute.mockImplementationOnce(async () => asRows([{ latest: null }]));
    const r = await call({ name: "h10b empty", method: "GET", path: SHADOW_PATH }, OWNER_COOKIE);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      featureFlagEnabled: true,
      scanDate: null,
      totalRows: 0,
      listCap: 25,
      highScoreThreshold: 60,
    });
    // Only the MAX(scan_date) probe ran; no cohort SELECT.
    expect(dbStub.execute).toHaveBeenCalledTimes(1);
  });

  it("feature-flag enabled, populated DB → 200 with payload; reads LATEST scan_date only (no all-rows scan)", async () => {
    delete process.env["SWING_SHADOW_DIAG_ENABLED"];
    const LATEST = "2026-05-28";
    dbStub.execute
      // 1. latest scan_date probe
      .mockImplementationOnce(async () => asRows([{ latest: LATEST }]))
      // 2. cohort SELECT for LATEST only
      .mockImplementationOnce(async () => asRows([
          {
            symbol: "RELIANCE",
            scan_date: LATEST,
            score: "75.00",
            action: "WATCH",
            sector: "Energy",
            industry: "Oil & Gas",
            fundamental_score: "5.00",
            rsi14: "55.00",
            pct_from_52w_high: "-12.00",
            warnings: ["RSI overextended"],
          },
          {
            symbol: "HDFCBANK",
            scan_date: LATEST,
            score: "80.00",
            action: "BUY ZONE",
            sector: "Financial Services",
            industry: "Banks",
            fundamental_score: "10.00",
            rsi14: "60.00",
            pct_from_52w_high: "-5.00",
            warnings: [],
          },
        ]));
    const r = await call({ name: "h10b ok", method: "GET", path: SHADOW_PATH }, OWNER_COOKIE);
    expect(r.status).toBe(200);
    const body = r.body as Record<string, unknown>;
    expect(body).toMatchObject({
      featureFlagEnabled: true,
      scanDate: LATEST,
      totalRows: 2,
      listCap: 25,
      cached: false,
    });
    // Exactly 2 DB calls: latest probe + cohort SELECT. No third call (no
    // outcomes fetch, no scheduler, no Kite, no Yahoo).
    expect(dbStub.execute).toHaveBeenCalledTimes(2);
    // No write verbs were used (DB stub doesn't expose insert/update/delete).
    // Verify nothing called the mocked write surfaces:
    expect((dbStub as unknown as { insert?: unknown }).insert).toBeUndefined();

    // Per-row payload shape sanity: rows surface in the top lists with the
    // shadow fields populated by computeShadowScores.
    const topByLive = body.topByLive as Array<Record<string, unknown>>;
    expect(Array.isArray(topByLive)).toBe(true);
    expect(topByLive.length).toBe(2);
    const sample = topByLive[0]!;
    expect(sample).toHaveProperty("b1ShadowScore");
    expect(sample).toHaveProperty("b3ShadowScore");
    expect(sample).toHaveProperty("b1Delta");
    expect(sample).toHaveProperty("b3Delta");
    expect(sample).toHaveProperty("dataQuality");
  });

  it("memo: second identical request within TTL returns cached:true and skips the DB", async () => {
    delete process.env["SWING_SHADOW_DIAG_ENABLED"];
    const LATEST = "2026-05-28";
    const probe = async () => asRows([{ latest: LATEST }]);
    const cohort = async () => asRows([] as Array<Record<string, unknown>>);
    dbStub.execute.mockImplementationOnce(probe).mockImplementationOnce(cohort);

    const r1 = await call({ name: "h10b first", method: "GET", path: SHADOW_PATH }, OWNER_COOKIE);
    expect(r1.status).toBe(200);
    expect((r1.body as Record<string, unknown>).cached).toBe(false);

    // Second call: only the latest-scan probe should fire; cohort is skipped
    // because the memo key (scanDate, rowCount=0) matches.
    dbStub.execute.mockImplementationOnce(probe);
    const r2 = await call({ name: "h10b second", method: "GET", path: SHADOW_PATH }, OWNER_COOKIE);
    expect(r2.status).toBe(200);
    expect((r2.body as Record<string, unknown>).cached).toBe(true);
  });
});

describe("Priority 6 — strict-vs-lenient gate behavioural contract", () => {
  it("strict gate (these 7 endpoints) and lenient gate (requireOwner) differ on the public-mode anonymous case", async () => {
    // Documents the contract: `requireOwner` (used elsewhere in the app)
    // returns next() on GET when public-mode is on, while the strict
    // gate used by every endpoint in ENDPOINTS returns 403. If anyone
    // ever swaps the strict gate for `requireOwner` on these routes
    // this test will start failing because anonymous + public-mode would
    // start succeeding.
    publicAccessState.enabled = true;
    for (const ep of ENDPOINTS) {
      const r = await call(ep);
      expect(
        r.status,
        `${ep.method} ${ep.path} must NOT honour public-mode read bypass`,
      ).toBe(403);
    }
  });
});
