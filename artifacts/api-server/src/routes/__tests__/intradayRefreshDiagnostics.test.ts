/**
 * S2a — Owner-Only Swing Intraday Refresh Diagnostics Endpoint
 *
 * Verifies the dedicated contract of
 *   GET /api/stocks-to-watch/diagnostics/intraday-refresh
 *
 * Auth-matrix cases (anon / subscriber / owner × public-mode on/off) are
 * covered by the shared `diagnosticRouteAuth.test.ts` regression suite —
 * this file is single-endpoint and focuses on:
 *
 *   3. Response shape contains all expected top-level keys.
 *   4. `lastCycle` shape is correct when present.
 *   5. Repeated reads do not mutate counters.
 *   6. Endpoint does not call Kite.
 *   7. Endpoint does not trigger refresh (`runIntradayRefresh` not called).
 *   8. Endpoint does not query or mutate DB (no `db.select`/`update`/`execute`).
 *   9. Route is registered exactly once.
 *  10. Route uses the same strict owner-only middleware as peer
 *      diagnostics — verified via static source inspection.
 *
 * Strict scope: no Kite, no DB writes, no refresh trigger, no scoring/
 * trading/scheduler/schema/workflow/`replit.md` changes.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import http from "node:http";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Mocks — wired BEFORE the route module import so the gate is what we measure.
// ---------------------------------------------------------------------------

const publicAccessState = { enabled: false };
vi.mock("../../lib/publicAccess", () => ({
  isPublicAccessEnabled: () => publicAccessState.enabled,
  setPublicAccess: (v: boolean) => {
    publicAccessState.enabled = v;
  },
  logPublicAccessBootState: () => {},
}));

// Hard-fail DB: any access from the endpoint would throw "db_must_not_be_used"
// — the assertion is that this test never observes such a failure.
const dbForbidden = {
  select: vi.fn(() => {
    throw new Error("db.select_must_not_be_used");
  }),
  update: vi.fn(() => {
    throw new Error("db.update_must_not_be_used");
  }),
  execute: vi.fn(() => {
    throw new Error("db.execute_must_not_be_used");
  }),
  insert: vi.fn(() => {
    throw new Error("db.insert_must_not_be_used");
  }),
};
vi.mock("@workspace/db", () => ({
  db: dbForbidden,
  swingScanResultTable: { symbol: { name: "symbol" } },
}));

vi.mock("../../lib/stocksToWatch", () => ({
  getStocksToWatch: vi.fn(async () => ({ items: [] })),
}));

// Stub the store with the exact same fixed health snapshot every read.
// `runIntradayRefresh` is stubbed to throw — the endpoint must never call it.
const healthSnapshot = {
  cyclesTotal: 7,
  rowsUpdatedTotal: 1234,
  triggerHitsLatchedTotal: 9,
  lastCycle: {
    scanDate: "2026-05-27",
    considered: 500,
    quotesReturned: 498,
    updated: 498,
    triggerHitsLatched: 2,
    skippedNoQuote: 1,
    skippedBadLtp: 1,
    errors: 0,
    durationMs: 845,
  },
  lastSuccessAt: "2026-05-27T09:45:12.000Z",
  lastErrorAt: null,
  lastErrorClass: null,
  lastErrorMessage: null,
  bootedAt: "2026-05-27T03:30:00.000Z",
};

const getIntradayRefreshHealthMock = vi.fn(() => ({ ...healthSnapshot }));
const runIntradayRefreshMock = vi.fn(() => {
  throw new Error("runIntradayRefresh_must_not_be_called_by_diagnostics_endpoint");
});

vi.mock("../../lib/swingScannerStore", () => ({
  getLatestSwingScan: vi.fn(async () => ({ rows: [], generatedAt: null })),
  getSchedulerState: () => ({}),
  startSwingScanScheduler: () => {},
  getIntradayRefreshHealth: getIntradayRefreshHealthMock,
  runIntradayRefresh: runIntradayRefreshMock,
}));

// Silence pino.
vi.mock("../../lib/logger", () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

// Also assert no Kite loader is touched by the route. If the source ever
// referenced one we'd see it called.
const loadKiteQuotesMock = vi.fn(() => {
  throw new Error("kite_must_not_be_used_by_diagnostics_endpoint");
});
vi.mock("../../lib/kiteScanner", () => ({
  loadKiteQuotes: loadKiteQuotesMock,
}));

// ---------------------------------------------------------------------------
const stocksToWatchRouter = (await import("../stocksToWatch")).default;

const TEST_SECRET = "test-session-secret-for-s2a-intraday-diag-test";
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
const ENDPOINT = "/api/stocks-to-watch/diagnostics/intraday-refresh";

beforeAll(async () => {
  const app: Express = express();
  app.use(cookieParser(TEST_SECRET));
  app.use(express.json());
  app.use("/api", stocksToWatchRouter);
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
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

async function get(cookie?: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${ENDPOINT}`, {
    method: "GET",
    headers: cookie ? { cookie } : {},
  });
  const text = await res.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------
describe("S2a — GET /api/stocks-to-watch/diagnostics/intraday-refresh", () => {
  it("test 3: owner read returns 200 with all expected top-level keys", async () => {
    publicAccessState.enabled = false;
    const r = await get(OWNER_COOKIE);
    expect(r.status).toBe(200);
    const b = r.body as Record<string, unknown>;
    for (const key of [
      "cyclesTotal",
      "rowsUpdatedTotal",
      "triggerHitsLatchedTotal",
      "lastCycle",
      "lastSuccessAt",
      "lastErrorAt",
      "lastErrorClass",
      "lastErrorMessage",
      "bootedAt",
    ]) {
      expect(b).toHaveProperty(key);
    }
    expect(b["cyclesTotal"]).toBe(7);
    expect(b["rowsUpdatedTotal"]).toBe(1234);
    expect(b["triggerHitsLatchedTotal"]).toBe(9);
  });

  it("test 4: lastCycle shape contains all required fields", async () => {
    publicAccessState.enabled = false;
    const r = await get(OWNER_COOKIE);
    expect(r.status).toBe(200);
    const lc = (r.body as Record<string, unknown>)["lastCycle"] as Record<string, unknown>;
    for (const key of [
      "scanDate",
      "considered",
      "quotesReturned",
      "updated",
      "triggerHitsLatched",
      "skippedNoQuote",
      "skippedBadLtp",
      "errors",
      "durationMs",
    ]) {
      expect(lc).toHaveProperty(key);
    }
    expect(lc["scanDate"]).toBe("2026-05-27");
    expect(lc["updated"]).toBe(498);
  });

  it("test 4b: lastCycle may be null on cold boot — endpoint must tolerate it", async () => {
    publicAccessState.enabled = false;
    getIntradayRefreshHealthMock.mockReturnValueOnce({
      cyclesTotal: 0,
      rowsUpdatedTotal: 0,
      triggerHitsLatchedTotal: 0,
      lastCycle: null as unknown as typeof healthSnapshot.lastCycle,
      lastSuccessAt: null as unknown as string,
      lastErrorAt: null,
      lastErrorClass: null,
      lastErrorMessage: null,
      bootedAt: "2026-05-27T03:30:00.000Z",
    });
    const r = await get(OWNER_COOKIE);
    expect(r.status).toBe(200);
    expect((r.body as Record<string, unknown>)["lastCycle"]).toBeNull();
  });

  it("test 5: repeated reads do not mutate counters (idempotent)", async () => {
    publicAccessState.enabled = false;
    const a = (await get(OWNER_COOKIE)).body as Record<string, unknown>;
    const b = (await get(OWNER_COOKIE)).body as Record<string, unknown>;
    const c = (await get(OWNER_COOKIE)).body as Record<string, unknown>;
    for (const k of ["cyclesTotal", "rowsUpdatedTotal", "triggerHitsLatchedTotal"]) {
      expect(a[k]).toBe(b[k]);
      expect(b[k]).toBe(c[k]);
    }
  });

  it("test 6: endpoint does NOT call Kite (loadKiteQuotes never invoked)", async () => {
    publicAccessState.enabled = false;
    loadKiteQuotesMock.mockClear();
    await get(OWNER_COOKIE);
    await get(OWNER_COOKIE);
    expect(loadKiteQuotesMock).not.toHaveBeenCalled();
  });

  it("test 7: endpoint does NOT trigger a refresh (runIntradayRefresh never invoked)", async () => {
    publicAccessState.enabled = false;
    runIntradayRefreshMock.mockClear();
    await get(OWNER_COOKIE);
    await get(OWNER_COOKIE);
    expect(runIntradayRefreshMock).not.toHaveBeenCalled();
  });

  it("test 8: endpoint does NOT query or mutate DB (db.* throws would surface as 500)", async () => {
    publicAccessState.enabled = false;
    dbForbidden.select.mockClear();
    dbForbidden.update.mockClear();
    dbForbidden.execute.mockClear();
    dbForbidden.insert.mockClear();
    const r = await get(OWNER_COOKIE);
    expect(r.status).toBe(200);
    expect(dbForbidden.select).not.toHaveBeenCalled();
    expect(dbForbidden.update).not.toHaveBeenCalled();
    expect(dbForbidden.execute).not.toHaveBeenCalled();
    expect(dbForbidden.insert).not.toHaveBeenCalled();
  });

  it("test 9: route is registered exactly once (no double-mount on the router)", () => {
    type LayerLike = { route?: { path?: string }; name?: string };
    const stack = (stocksToWatchRouter as unknown as { stack: LayerLike[] }).stack ?? [];
    const matches = stack.filter(
      (l) => l.route?.path === "/stocks-to-watch/diagnostics/intraday-refresh",
    );
    expect(matches.length).toBe(1);
  });

  it("test 10: route uses the same strict owner-only middleware as the peer sector-coverage diagnostic (static-source check)", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(path.join(here, "..", "stocksToWatch.ts"), "utf8");
    const block = src.split('"/stocks-to-watch/diagnostics/intraday-refresh"')[1] ?? "";
    // The same four signals that gate the peer /sector-coverage route.
    expect(block).toContain("getSession(req)");
    expect(block).toContain('s?.role === "owner"');
    expect(block).toContain("isPublicAccessEnabled()");
    expect(block).toContain("OWNER_ONLY_DIAGNOSTIC");
    expect(block).toContain("AUTH_REQUIRED");
    // And confirm the handler body is literally `getIntradayRefreshHealth()`.
    expect(block).toContain("getIntradayRefreshHealth()");
  });

  it("test 11: handler body references NO forbidden side-effect tokens (Kite/DB/refresh)", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(path.join(here, "..", "stocksToWatch.ts"), "utf8");
    const block = src.split('"/stocks-to-watch/diagnostics/intraday-refresh"')[1] ?? "";
    // Tokens built at runtime so this test file itself can't satisfy the match.
    const forbidden = [
      ["run", "IntradayRefresh"].join(""),
      ["loadKite", "Quotes"].join(""),
      ["fetchOption", "Chain"].join(""),
      ["openPaper", "Trade"].join(""),
      ["placeKite", "Order"].join(""),
      ["db.", "update"].join(""),
      ["db.", "insert"].join(""),
      ["db.", "delete"].join(""),
    ];
    for (const token of forbidden) {
      expect(block).not.toContain(token);
    }
  });
});
