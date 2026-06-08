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
 * REAL_REPLAY (modeled=false) is covered separately, lower down. Those trades
 * carry GENUINE captured `triggered_at` / `exited_at` instants from
 * `option_signal_history` that can LEGITIMATELY fall outside 09:15–15:30 IST
 * (e.g. an after-close force-exit), so the in-session assertion does NOT apply.
 * What DOES still apply is that those real instants must round-trip through the
 * exact same persist/serialize path (`new Date(iso)` on insert → `.toISOString()`
 * on read) WITHOUT offset corruption. The REAL_REPLAY test therefore reads the
 * genuine source instants straight out of `option_signal_history`, drives a
 * replay run, reads the trades back over HTTP, and asserts every persisted
 * entry/exit is a valid canonical-UTC ISO that round-trips byte-for-byte against
 * the source instant — never forcing it into the in-session window.
 *
 * Auto-skips cleanly (mirroring the other live-DB tests) when either:
 *   - `DATABASE_URL` is unset (no DB to persist into), or
 *   - the real 15-min candle CSV is absent (nothing to backtest on) for the
 *     modeled-mode tests, or
 *   - no captured REAL_REPLAY history (a taken signal) exists for the
 *     REAL_REPLAY test.
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

/**
 * Runs now compute in a detached background task (POST returns 201 RUNNING
 * immediately to dodge the autoscale request-timeout). Poll GET /:id until the
 * row settles to COMPLETE/FAILED before reading the persisted children back.
 */
async function waitForRun(runId: string, label: string): Promise<Json> {
  const deadline = Date.now() + 55_000;
  for (;;) {
    const detail = await req("GET", `/backtest/fno/runs/${runId}`, { cookie: OWNER_COOKIE });
    expect(detail.status, `[${label}] run GET`).toBe(200);
    const status = detail.body["status"] as string;
    if (status === "COMPLETE") return detail.body;
    expect(
      status === "FAILED",
      `[${label}] run ${runId} failed: ${String(detail.body["error"] ?? "")}`,
    ).toBe(false);
    if (Date.now() > deadline) {
      throw new Error(`[${label}] run ${runId} did not complete within the deadline (status=${status})`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
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
    // Background compute now persists the trades — wait for it to settle first.
    await waitForRun(runId, label);

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

// ---------------------------------------------------------------------------
// REAL_REPLAY helpers (modeled=false; genuine captured instants).
// ---------------------------------------------------------------------------

/** Canonical UTC ISO for a value that round-trips: `new Date(iso).toISOString() === iso`. */
function isCanonicalUtcIso(iso: unknown): iso is string {
  if (typeof iso !== "string" || iso.length === 0) return false;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return false;
  // A canonical UTC ISO is byte-for-byte stable through Date — a `+05:30`-stamped
  // (offset-corrupted) string would NOT equal its own re-serialization.
  return new Date(ms).toISOString() === iso;
}

type ReplaySourceInstants = {
  /** Number of taken (triggered) source signals — proves the run is non-vacuous. */
  taken: number;
  /** Canonical-UTC ISO of every source `triggered_at` (the engine's `entryAt`). */
  entryIsos: Set<string>;
  /** Canonical-UTC ISO of every source `exited_at` (the engine's `exitAt`). */
  exitIsos: Set<string>;
};

/**
 * Read the GENUINE captured instants straight out of `option_signal_history`
 * for one instrument — the source of truth the persisted REAL_REPLAY trades
 * must round-trip against. Mirrors `buildReplayTrades` exactly: a trade is
 * "taken" iff `triggered_at` is present; its `entryAt` is `triggered_at`'s
 * canonical UTC ISO and its `exitAt` is `exited_at`'s (when present). Returns
 * null on any DB error so the caller can skip honestly.
 */
async function loadReplaySourceInstants(
  instrument: string,
): Promise<ReplaySourceInstants | null> {
  try {
    const r = await pool.query<{ triggered_at: Date | null; exited_at: Date | null }>(
      `SELECT triggered_at, exited_at
         FROM option_signal_history
        WHERE index_symbol = $1 AND triggered_at IS NOT NULL`,
      [instrument],
    );
    const entryIsos = new Set<string>();
    const exitIsos = new Set<string>();
    for (const row of r.rows) {
      if (row.triggered_at) entryIsos.add(new Date(row.triggered_at).toISOString());
      if (row.exited_at) exitIsos.add(new Date(row.exited_at).toISOString());
    }
    return { taken: r.rows.length, entryIsos, exitIsos };
  } catch {
    return null;
  }
}

/** Candidate instrument with the most captured REAL_REPLAY history, or null. */
async function firstReplayInstrument(): Promise<string | null> {
  let best: { sym: string; taken: number } | null = null;
  for (const sym of CANDIDATE_SYMBOLS) {
    const src = await loadReplaySourceInstants(sym);
    if (src && src.taken > 0 && (!best || src.taken > best.taken)) {
      best = { sym, taken: src.taken };
    }
  }
  return best?.sym ?? null;
}

const hasDb = Boolean(process.env.DATABASE_URL);
const describeDb = hasDb ? describe : describe.skip;

describeDb("Backtest Lab — persisted trade times stay in-session (live DB)", () => {
  let availableSymbol: string | null = null;
  let replayInstrument: string | null = null;

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
    replayInstrument = await firstReplayInstrument();
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

  it(
    "every PERSISTED REAL_REPLAY entry/exit + equity-curve point round-trips against the genuine captured instant (no offset corruption)",
    async () => {
      if (!replayInstrument) return; // Honest skip: no captured REAL_REPLAY history.

      // The source of truth: the genuine captured instants the replay reads from.
      const src = await loadReplaySourceInstants(replayInstrument);
      if (!src || src.taken === 0) return; // Honest skip: nothing to replay.

      // Drive a REAL_REPLAY over the FULL captured span (fromDate/toDate null),
      // which mirrors exactly what `loadReplaySourceInstants` queried.
      const create = await req("POST", "/backtest/fno/runs", {
        cookie: OWNER_COOKIE,
        body: {
          mode: "REAL_REPLAY",
          instrument: replayInstrument,
          fromDate: null,
          toDate: null,
          riskPerTradePct: 1,
        },
      });
      expect(create.status, `REAL_REPLAY create: ${JSON.stringify(create.body)}`).toBe(201);
      const runId = create.body["id"] as string;
      expect(typeof runId, "REAL_REPLAY run id").toBe("string");

      let tradesChecked = 0;
      let curveChecked = 0;
      try {
        // Background compute now persists the trades — wait for it to settle first.
        await waitForRun(runId, "REAL_REPLAY");

        // --- Persisted trades: the serialized backtest_trades shape. ----------
        const list = await req("GET", `/backtest/fno/runs/${runId}/trades`, {
          cookie: OWNER_COOKIE,
        });
        expect(list.status, "REAL_REPLAY trades GET").toBe(200);
        const trades = (list.body["items"] as PersistedTrade[]) ?? [];
        for (const t of trades) {
          // REAL_REPLAY trades are NOT modeled — they carry real captured instants.
          expect(t.modeled, "REAL_REPLAY trade unexpectedly flagged modeled").toBe(false);

          // entryAt is always present (triggered_at, never null for a taken trade).
          // It must be a canonical UTC ISO that round-trips byte-for-byte AND must
          // be one of the GENUINE source instants — proving the persist/serialize
          // layer introduced no +05:30 (or any) offset corruption. We deliberately
          // do NOT assert it falls inside 09:15–15:30 IST.
          expect(
            isCanonicalUtcIso(t.entryAt),
            `REAL_REPLAY persisted entry ${t.entryAt} (run ${runId}) is not a canonical UTC instant`,
          ).toBe(true);
          expect(
            src.entryIsos.has(t.entryAt as string),
            `REAL_REPLAY persisted entry ${t.entryAt} (run ${runId}) does not match any captured triggered_at (offset corruption?)`,
          ).toBe(true);

          // exitAt is present only for decided/exited signals.
          if (t.exitAt !== null) {
            expect(
              isCanonicalUtcIso(t.exitAt),
              `REAL_REPLAY persisted exit ${t.exitAt} (run ${runId}) is not a canonical UTC instant`,
            ).toBe(true);
            expect(
              src.exitIsos.has(t.exitAt as string),
              `REAL_REPLAY persisted exit ${t.exitAt} (run ${runId}) does not match any captured exited_at (offset corruption?)`,
            ).toBe(true);
          }
          tradesChecked++;
        }

        // --- Persisted summary.equityCurve[].t (each point is a trade exitAt). -
        const detail = await req("GET", `/backtest/fno/runs/${runId}`, {
          cookie: OWNER_COOKIE,
        });
        expect(detail.status, "REAL_REPLAY run GET").toBe(200);
        const summary = detail.body["summary"] as
          | { equityCurve?: Array<{ t?: string | null }> }
          | null;
        const curve = summary?.equityCurve ?? [];
        for (const pt of curve) {
          if (!pt.t) continue; // undated exits are stored as "" — nothing to check.
          expect(
            isCanonicalUtcIso(pt.t),
            `REAL_REPLAY persisted equityCurve point ${pt.t} (run ${runId}) is not a canonical UTC instant`,
          ).toBe(true);
          expect(
            src.exitIsos.has(pt.t),
            `REAL_REPLAY persisted equityCurve point ${pt.t} (run ${runId}) does not match any captured exited_at (offset corruption?)`,
          ).toBe(true);
          curveChecked++;
        }
      } finally {
        // Zero net footprint — delete the run (trades cascade).
        await req("DELETE", `/backtest/fno/runs/${runId}`, { cookie: OWNER_COOKIE });
      }

      // Non-vacuous: captured taken history exists, so the replay must persist trades.
      expect(
        tradesChecked,
        "no REAL_REPLAY trades were persisted despite captured taken history",
      ).toBeGreaterThan(0);
      // equityCurve points are best-effort: a point exists only for decided trades
      // (those with a captured option exit premium), which may be zero — but any
      // point that DOES exist must round-trip, asserted in the loop above.
    },
    60000,
  );
});
