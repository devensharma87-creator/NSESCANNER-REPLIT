/**
 * Backtest Lab — COMPARE_OFFICIAL_VS_STRATEGIES `ignoredFilters` honesty column
 * over the LIVE HTTP endpoint (regression).
 *
 * Task #96 added a per-strategy `ignoredFilters` column so the UI can be honest
 * about which confirmation filters a strategy skips by design, and a unit/engine
 * test (`comparison.config-flow.test.ts`) proved the value flows from a strategy
 * module's `meta.ignoredFilters` through a route-shaped `ComparisonUnit` into
 * `buildComparison`'s emitted rows + aggregates. BUT that test MIRRORS the
 * route's construction — it builds the ComparisonUnits itself. A regression in
 * the actual request handler (auth, body parsing, the three ComparisonUnit build
 * sites in `routes/backtest.ts`, or the `runToDto` response shaping that
 * serializes `strategyComparison`) could still drop the ignored-filter column
 * from what users actually receive WITHOUT failing a single existing test.
 *
 * This file closes that gap end-to-end: it drives a real authenticated
 * COMPARE_OFFICIAL_VS_STRATEGIES backtest through the VERBATIM router
 * (POST /backtest/fno/runs), then asserts the JSON response's
 * `strategyComparison.rows[]` AND `strategyComparison.byStrategy[]` each carry
 * the SELECTED strategies' real `meta.ignoredFilters` (sourced from the live
 * registry, not hard-coded), and that the Official Engine — a real engine, not a
 * hand-tuned strategy that skips filters — always carries `[]`. It also re-reads
 * the persisted run over HTTP (GET /backtest/fno/runs/:id) and re-asserts the
 * same contract, covering the read-path serialization too. The run is deleted
 * afterwards so the dev DB keeps zero net footprint.
 *
 * Auto-skips cleanly (mirroring the other live-DB / candle-regression tests in
 * this suite) when either:
 *   - `DATABASE_URL` is unset (no DB to persist the run into), or
 *   - no real 15-min candle CSV is present for any F&O index (nothing to
 *     backtest on).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import http from "node:http";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";

const FROM = "2026-03-01";
const CANDIDATE_SYMBOLS = ["NIFTY", "BANKNIFTY", "SENSEX"] as const;

const OFFICIAL_STRATEGY_ID = "OFFICIAL_ENGINE";

// The two strategies that genuinely ignore confirmation filters by design — a
// 3-filter case (RANGE_REVERSAL) and a 1-filter case (FAILED_BREAKOUT_REVERSAL).
// Asserting against these makes the honesty column's preservation meaningful.
const STRATEGY_IDS = ["RANGE_REVERSAL", "FAILED_BREAKOUT_REVERSAL"] as const;

// Relax the confirmation filters so the strategies actually emit trades (the
// honesty column is preserved regardless of trade count, but relaxing keeps the
// run representative of real usage). Option/spread/volume filters are
// auto-disabled server-side regardless — no historical option data.
const RELAXED_FILTERS = {
  vwapFilter: false,
  emaTrendFilter: false,
  avoidChopZone: false,
  avoidLast15Minutes: false,
  minimumRiskReward: 0,
} as const;

// ---------------------------------------------------------------------------
// Mocks. The router is exercised verbatim; only `isPublicAccessEnabled` is
// stubbed (off — we authenticate as the real owner) and the logger silenced.
// `@workspace/db`, `userAuth`, the candle source and the strategy registry are
// all REAL — the contract being guarded is a property of the real handler.
// ---------------------------------------------------------------------------

vi.mock("../../lib/publicAccess", () => ({
  isPublicAccessEnabled: () => false,
  setPublicAccess: () => {},
  logPublicAccessBootState: () => {},
}));

vi.mock("../../lib/logger", () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

const backtestRouter = (await import("../backtest")).default;
const { isSupportedInstrument, loadHistoricalCandles } = await import(
  "../../lib/backtest/candleSource"
);
const { getStrategy } = await import("../../lib/backtest/strategies");
const { pool } = await import("@workspace/db");

// ---------------------------------------------------------------------------
// HTTP harness — same signed-cookie owner-session pattern as the other route
// tests. The owner cookie value "owner" decodes to { role: "owner" }.
// ---------------------------------------------------------------------------

const TEST_SECRET = "test-session-secret-backtest-comparison-ignored-filters";

function signCookie(value: string): string {
  const sig = createHmac("sha256", TEST_SECRET)
    .update(value)
    .digest("base64")
    .replace(/=+$/, "");
  return `s:${value}.${sig}`;
}

const OWNER_COOKIE = `scanner_session=${encodeURIComponent(signCookie("owner"))}`;

let server: http.Server;
let baseUrl: string;

type Json = Record<string, unknown>;

async function req(
  method: string,
  path: string,
  opts: { cookie?: string; body?: unknown } = {},
): Promise<{ status: number; body: Json }> {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers["cookie"] = opts.cookie;
  let payload: string | undefined;
  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(opts.body);
  }
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: payload });
  let body: Json = {};
  try {
    body = (await res.json()) as Json;
  } catch {
    body = {};
  }
  return { status: res.status, body };
}

/** First supported symbol whose real candle CSV is present for the window. */
async function firstAvailableSymbol(): Promise<string | null> {
  for (const sym of CANDIDATE_SYMBOLS) {
    if (!isSupportedInstrument(sym)) continue;
    const { available, candles } = await loadHistoricalCandles(sym, FROM, null);
    if (available && candles.length > 0) return sym;
  }
  return null;
}

type ComparisonShape = {
  rows?: Array<{ strategyId?: string; ignoredFilters?: string[] }>;
  byStrategy?: Array<{ strategyId?: string; ignoredFilters?: string[] }>;
};

/** Expected ignoredFilters for a strategyId: the official engine ignores none. */
function expectedIgnored(strategyId: string): string[] {
  if (strategyId === OFFICIAL_STRATEGY_ID) return [];
  return getStrategy(strategyId as Parameters<typeof getStrategy>[0]).meta.ignoredFilters;
}

/**
 * Assert every comparison row + per-strategy aggregate carries exactly its
 * strategy's real ignoredFilters, that the Official Engine carries [], and that
 * the selected strategies were actually present (non-vacuous). Returns counts.
 */
function assertHonestyColumn(
  label: string,
  comparison: ComparisonShape | null | undefined,
): { rowsChecked: number; aggsChecked: number } {
  expect(comparison, `[${label}] strategyComparison present`).toBeTruthy();
  const rows = comparison?.rows ?? [];
  const byStrategy = comparison?.byStrategy ?? [];

  // Every emitted row carries exactly its strategy's declared ignored filters.
  for (const row of rows) {
    expect(
      row.ignoredFilters,
      `[${label}] row ${row.strategyId} ignoredFilters`,
    ).toEqual(expectedIgnored(row.strategyId ?? ""));
  }
  for (const agg of byStrategy) {
    expect(
      agg.ignoredFilters,
      `[${label}] aggregate ${agg.strategyId} ignoredFilters`,
    ).toEqual(expectedIgnored(agg.strategyId ?? ""));
  }

  // The Official Engine must be present and carry an empty list (it is a real
  // engine, not a filter-skipping strategy).
  const officialRow = rows.find((r) => r.strategyId === OFFICIAL_STRATEGY_ID);
  const officialAgg = byStrategy.find((a) => a.strategyId === OFFICIAL_STRATEGY_ID);
  expect(officialRow, `[${label}] official row present`).toBeTruthy();
  expect(officialAgg, `[${label}] official aggregate present`).toBeTruthy();
  expect(officialRow!.ignoredFilters, `[${label}] official row ignoredFilters`).toEqual([]);
  expect(officialAgg!.ignoredFilters, `[${label}] official aggregate ignoredFilters`).toEqual([]);

  // Non-vacuous: each selected strategy must appear in BOTH rows + aggregates,
  // and at least one must genuinely ignore filters (the column is meaningful).
  for (const id of STRATEGY_IDS) {
    expect(
      rows.some((r) => r.strategyId === id),
      `[${label}] selected strategy ${id} missing from rows`,
    ).toBe(true);
    expect(
      byStrategy.some((a) => a.strategyId === id),
      `[${label}] selected strategy ${id} missing from aggregates`,
    ).toBe(true);
    expect(
      expectedIgnored(id).length,
      `[${label}] selected strategy ${id} is expected to ignore filters`,
    ).toBeGreaterThan(0);
  }

  return { rowsChecked: rows.length, aggsChecked: byStrategy.length };
}

const hasDb = Boolean(process.env.DATABASE_URL);
const describeDb = hasDb ? describe : describe.skip;

describeDb("Backtest Lab — COMPARE ignoredFilters honesty column over HTTP (live DB)", () => {
  let availableSymbol: string | null = null;

  beforeAll(async () => {
    const app: Express = express();
    app.use(cookieParser(TEST_SECRET));
    app.use(express.json());
    app.use(backtestRouter);
    app.use(
      (
        _err: unknown,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => {
        if (!res.headersSent) res.status(500).json({ error: "test_handler_threw" });
      },
    );
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    availableSymbol = await firstAvailableSymbol();
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
    // Release the shared pool so vitest can exit cleanly.
    await pool.end().catch(() => {});
  });

  it(
    "the COMPARE endpoint response carries each strategy's ignoredFilters on rows + aggregates (official = [])",
    async () => {
      if (!availableSymbol) return; // Honest skip: no real candle CSV here.

      const create = await req("POST", "/backtest/fno/runs", {
        cookie: OWNER_COOKIE,
        body: {
          // `mode` enum is REAL_REPLAY|DIRECTIONAL; the V2 `backtestMode`
          // selector drives the COMPARE path.
          mode: "DIRECTIONAL",
          backtestMode: "COMPARE_OFFICIAL_VS_STRATEGIES",
          strategies: [...STRATEGY_IDS],
          filters: { ...RELAXED_FILTERS },
          instrument: availableSymbol,
          fromDate: FROM,
          toDate: null,
          startingCapital: 1_000_000,
          riskPerTradePct: 1,
        },
      });
      // Fresh (201) on first run; an identical idempotent re-run would be cached
      // (200). Either way the comparison must be fully shaped in the response.
      expect(
        [200, 201].includes(create.status),
        `create: ${JSON.stringify(create.body)}`,
      ).toBe(true);
      const runId = create.body["id"] as string;
      expect(typeof runId, "run id").toBe("string");

      try {
        // --- POST response: the endpoint's own serialized output. ------------
        const postCheck = assertHonestyColumn(
          "POST response",
          create.body["strategyComparison"] as ComparisonShape | null,
        );
        expect(postCheck.rowsChecked, "POST response had no comparison rows").toBeGreaterThan(0);
        expect(postCheck.aggsChecked, "POST response had no aggregates").toBeGreaterThan(0);

        // --- GET read-back: the persisted-then-serialized path. --------------
        const detail = await req("GET", `/backtest/fno/runs/${runId}`, {
          cookie: OWNER_COOKIE,
        });
        expect(detail.status, "run GET").toBe(200);
        const getCheck = assertHonestyColumn(
          "GET response",
          detail.body["strategyComparison"] as ComparisonShape | null,
        );
        expect(getCheck.rowsChecked, "GET response had no comparison rows").toBeGreaterThan(0);
        expect(getCheck.aggsChecked, "GET response had no aggregates").toBeGreaterThan(0);
      } finally {
        // Zero net footprint — delete the run (children cascade).
        await req("DELETE", `/backtest/fno/runs/${runId}`, { cookie: OWNER_COOKIE });
      }
    },
    60000,
  );
});
