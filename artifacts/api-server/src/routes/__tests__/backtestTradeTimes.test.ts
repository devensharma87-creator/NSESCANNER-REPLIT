/**
 * Backtest Lab — PERSISTED trade-time session guard (regression).
 *
 * The 2026-06-05 bug stored `modeled` DIRECTIONAL/STRATEGY trade `entry_at` /
 * `exit_at` +05:30 ahead, so they rendered off-session ("07:00 pm"). The
 * in-memory engines are already guarded by `lib/backtest/time.test.ts`, but
 * that test asserts the values the engine RETURNS — it never proves that what
 * is actually PERSISTED to `backtest_trades` and then handed back by the trades
 * GET endpoint still maps to the 09:15–15:30 IST window. A regression in the
 * persistence/serialization layer alone (column type, `new Date(iso)` round
 * trip, `.toISOString()` on read) would slip past the engine test.
 *
 * This file closes that gap end-to-end: it drives a real DIRECTIONAL backtest
 * through the verbatim router (POST /backtest/fno/runs), reads the trades back
 * over HTTP (GET /backtest/fno/runs/:id/trades), and asserts every persisted
 * entry/exit re-derives to an in-session IST clock via `isSessionValidUtcIso`.
 * The run is deleted afterwards so the dev DB keeps zero net footprint.
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
    "every PERSISTED DIRECTIONAL entry/exit re-derives to a 09:15–15:30 IST clock",
    async () => {
      if (!availableSymbol) {
        // Honest skip: no real candle CSV in this environment to backtest on.
        return;
      }

      // 1. Run a real DIRECTIONAL backtest through the route layer (persists).
      const create = await req("POST", "/backtest/fno/runs", {
        cookie: OWNER_COOKIE,
        body: {
          mode: "DIRECTIONAL",
          instrument: availableSymbol,
          fromDate: FROM,
          toDate: null,
          startingCapital: 1_000_000,
          riskPerTradePct: 1,
        },
      });
      expect(create.status, JSON.stringify(create.body)).toBe(201);
      const runId = create.body["id"] as string;
      expect(typeof runId).toBe("string");

      try {
        // 2. Read the trades back over HTTP (the serialized, persisted shape).
        const list = await req("GET", `/backtest/fno/runs/${runId}/trades`, {
          cookie: OWNER_COOKIE,
        });
        expect(list.status).toBe(200);
        const trades = (list.body["items"] as Array<{
          entryAt: string | null;
          exitAt: string | null;
          modeled: boolean;
        }>) ?? [];

        // 3. Every persisted modeled entry/exit must map back in-session.
        //    (DIRECTIONAL trades are always modeled with real timestamps.)
        let checked = 0;
        for (const t of trades) {
          expect(
            isSessionValidUtcIso(t.entryAt),
            `persisted entry ${t.entryAt} (run ${runId}) out of 09:15–15:30 IST`,
          ).toBe(true);
          expect(
            isSessionValidUtcIso(t.exitAt),
            `persisted exit ${t.exitAt} (run ${runId}) out of 09:15–15:30 IST`,
          ).toBe(true);
          checked++;
        }
        // The window reliably yields trades; assert we actually exercised the
        // persisted path rather than vacuously passing on an empty result.
        expect(checked).toBeGreaterThan(0);
      } finally {
        // 4. Zero net footprint — delete the run (trades cascade).
        await req("DELETE", `/backtest/fno/runs/${runId}`, { cookie: OWNER_COOKIE });
      }
    },
    60000,
  );
});
