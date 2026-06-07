/**
 * Backtest Lab — PERSISTED trade-time session guard (regression).
 *
 * The 2026-06-05 bug stored `modeled` DIRECTIONAL/STRATEGY trade `entry_at` /
 * `exit_at` +05:30 ahead, so they rendered off-session ("07:00 pm"). The same
 * +05:30 offset also corrupted the persisted `summary.equityCurve[].t` points
 * (each is a trade `exitAt`). The in-memory engines are already guarded by
 * `lib/backtest/time.test.ts`, but that test asserts the values the engine
 * RETURNS — it never proves that what is actually PERSISTED to `backtest_trades`
 * / `backtest_runs.summary` and then handed back by the GET endpoints still maps
 * to the 09:15–15:30 IST window. A regression in the persistence/serialization
 * layer alone (column type, `new Date(iso)` round trip, `.toISOString()` on
 * read), or one specific to a strategy-engine code path, would slip past the
 * engine test.
 *
 * This file closes that gap end-to-end across EVERY mode that persists modeled
 * trades. For each of DIRECTIONAL, STRATEGY_RESEARCH and
 * COMPARE_OFFICIAL_VS_STRATEGIES it drives a real backtest through the verbatim
 * router (POST /backtest/fno/runs), then:
 *   - reads the trades back over HTTP (GET /backtest/fno/runs/:id/trades) and
 *     asserts every persisted modeled entry/exit re-derives to an in-session IST
 *     clock via `isSessionValidUtcIso`, and
 *   - reads the run back (GET /backtest/fno/runs/:id) and asserts every
 *     persisted `summary.equityCurve[].t` point is in-session too.
 * Each run is deleted afterwards so the dev DB keeps zero net footprint.
 *
 * Auto-skips cleanly (mirroring the other live-DB tests) when either:
 *   - `DATABASE_URL` is unset (no DB to persist into), or
 *   - the real 15-min candle CSV is absent (nothing to backtest on).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import http from "node:http";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";

// Match the engine regression window — a real ~3-month span keeps this fast
// under suite contention while exercising the genuine persisted path.
const FROM = "2026-03-01";
const CANDIDATE_SYMBOLS = ["NIFTY", "BANKNIFTY", "SENSEX"] as const;

// Generic strategy registry ids exercised by STRATEGY_RESEARCH / COMPARE.
const STRATEGY_IDS = [
  "ORB_BREAKOUT",
  "VWAP_PULLBACK",
  "EMA_TREND_RETEST",
  "RANGE_REVERSAL",
  "COMPRESSION_BREAKOUT",
  "FAILED_BREAKOUT_REVERSAL",
] as const;

// With the default confirmation filters, the generic strategies never qualify a
// single trade on the real SPOT candles in this environment — so a strategy run
// would persist ZERO trades and the in-session assertion would pass vacuously.
// Relaxing the confirmation filters lets the strategies actually emit persisted
// modeled trades, which is the whole point of this guard. (Option/spread/volume
// filters are auto-disabled server-side regardless — no historical data.)
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
// `@workspace/db`, `userAuth`, and the candle source are all REAL.
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
const { isSessionValidUtcIso } = await import("../../lib/backtest/time");
const { pool } = await import("@workspace/db");

// ---------------------------------------------------------------------------
// HTTP harness — same signed-cookie owner-session pattern as the other route
// tests. The owner cookie value "owner" decodes to { role: "owner" }.
// ---------------------------------------------------------------------------

const TEST_SECRET = "test-session-secret-backtest-trade-times";

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

type PersistedTrade = {
  entryAt: string | null;
  exitAt: string | null;
  modeled: boolean;
};

/**
 * Create a run, read its persisted trades + equity curve back over HTTP, assert
 * every modeled entry/exit and every equity-curve point maps in-session, then
 * delete the run. Returns the number of modeled trades actually checked so the
 * caller can prove the assertion was non-vacuous.
 */
async function runAndVerifyInSession(
  label: string,
  body: Record<string, unknown>,
): Promise<{ tradesChecked: number; curveChecked: number }> {
  const create = await req("POST", "/backtest/fno/runs", {
    cookie: OWNER_COOKIE,
    body,
  });
  expect(create.status, `[${label}] create: ${JSON.stringify(create.body)}`).toBe(201);
  const runId = create.body["id"] as string;
  expect(typeof runId, `[${label}] run id`).toBe("string");

  let tradesChecked = 0;
  let curveChecked = 0;
  try {
    // --- Persisted trades: the serialized backtest_trades shape. -----------
    const list = await req("GET", `/backtest/fno/runs/${runId}/trades`, {
      cookie: OWNER_COOKIE,
    });
    expect(list.status, `[${label}] trades GET`).toBe(200);
    const trades = (list.body["items"] as PersistedTrade[]) ?? [];
    for (const t of trades) {
      // Only modeled trades carry engine-derived timestamps (the bug surface).
      if (!t.modeled) continue;
      expect(
        isSessionValidUtcIso(t.entryAt),
        `[${label}] persisted entry ${t.entryAt} (run ${runId}) out of 09:15–15:30 IST`,
      ).toBe(true);
      expect(
        isSessionValidUtcIso(t.exitAt),
        `[${label}] persisted exit ${t.exitAt} (run ${runId}) out of 09:15–15:30 IST`,
      ).toBe(true);
      tradesChecked++;
    }

    // --- Persisted summary.equityCurve[].t (each point is a trade exitAt). --
    const detail = await req("GET", `/backtest/fno/runs/${runId}`, {
      cookie: OWNER_COOKIE,
    });
    expect(detail.status, `[${label}] run GET`).toBe(200);
    const summary = detail.body["summary"] as
      | { equityCurve?: Array<{ t?: string | null }> }
      | null;
    const curve = summary?.equityCurve ?? [];
    for (const pt of curve) {
      expect(
        isSessionValidUtcIso(pt.t),
        `[${label}] persisted equityCurve point ${pt.t} (run ${runId}) out of 09:15–15:30 IST`,
      ).toBe(true);
      curveChecked++;
    }
  } finally {
    // Zero net footprint — delete the run (trades cascade).
    await req("DELETE", `/backtest/fno/runs/${runId}`, { cookie: OWNER_COOKIE });
  }
  return { tradesChecked, curveChecked };
}

const hasDb = Boolean(process.env.DATABASE_URL);
const describeDb = hasDb ? describe : describe.skip;

describeDb("Backtest Lab — persisted trade times stay in-session (live DB)", () => {
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
    "every PERSISTED DIRECTIONAL entry/exit + equity-curve point re-derives in-session",
    async () => {
      if (!availableSymbol) return; // Honest skip: no real candle CSV here.

      const { tradesChecked, curveChecked } = await runAndVerifyInSession("DIRECTIONAL", {
        mode: "DIRECTIONAL",
        instrument: availableSymbol,
        fromDate: FROM,
        toDate: null,
        startingCapital: 1_000_000,
        riskPerTradePct: 1,
      });
      // The window reliably yields trades; assert we actually exercised the
      // persisted path rather than vacuously passing on an empty result.
      expect(tradesChecked, "no DIRECTIONAL modeled trades were persisted").toBeGreaterThan(0);
      expect(curveChecked, "no DIRECTIONAL equity-curve points were persisted").toBeGreaterThan(0);
    },
    60000,
  );

  it(
    "every PERSISTED STRATEGY_RESEARCH entry/exit + equity-curve point re-derives in-session",
    async () => {
      if (!availableSymbol) return; // Honest skip: no real candle CSV here.

      const { tradesChecked, curveChecked } = await runAndVerifyInSession("STRATEGY_RESEARCH", {
        // `mode` enum is REAL_REPLAY|DIRECTIONAL; the V2 `backtestMode` selector
        // is what actually drives the strategy registry.
        mode: "DIRECTIONAL",
        backtestMode: "STRATEGY_RESEARCH",
        strategies: [...STRATEGY_IDS],
        filters: { ...RELAXED_FILTERS },
        instrument: availableSymbol,
        fromDate: FROM,
        toDate: null,
        startingCapital: 1_000_000,
      });
      expect(tradesChecked, "no STRATEGY_RESEARCH modeled trades were persisted").toBeGreaterThan(0);
      expect(curveChecked, "no STRATEGY_RESEARCH equity-curve points were persisted").toBeGreaterThan(0);
    },
    60000,
  );

  it(
    "every PERSISTED COMPARE entry/exit + equity-curve point re-derives in-session",
    async () => {
      if (!availableSymbol) return; // Honest skip: no real candle CSV here.

      // COMPARE persists BOTH the Official-Engine (directional) trades AND the
      // strategy-registry trades through the same insert/serialize path.
      const { tradesChecked, curveChecked } = await runAndVerifyInSession(
        "COMPARE_OFFICIAL_VS_STRATEGIES",
        {
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
      );
      expect(tradesChecked, "no COMPARE modeled trades were persisted").toBeGreaterThan(0);
      expect(curveChecked, "no COMPARE equity-curve points were persisted").toBeGreaterThan(0);
    },
    60000,
  );
});
