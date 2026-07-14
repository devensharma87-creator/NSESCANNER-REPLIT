/**
 * GET/POST /api/data-parity/* — access-control regression test.
 *
 * Verifies the Checkpoint 3 Data Parity API is gated by `requireOwnerStrict`,
 * NOT `requireOwner`. `requireOwner` would let anonymous GET requests through
 * when public-access mode is enabled — exactly the wrong behaviour for an
 * internal diagnostic that exposes per-module data-source detail.
 *
 * Also exercises the route's own input-validation (unknown symbol, oversized
 * batch) with the underlying observe/classify collectors mocked out — this
 * is a route-contract test, not a collector-correctness test (collectors are
 * covered by T003's typecheck-green + no-mutating-call acceptance).
 *
 * Auth cases:
 *   A) anonymous, public-mode OFF  → 401 AUTH_REQUIRED
 *   B) anonymous, public-mode ON   → 401 AUTH_REQUIRED  ← CRITICAL: no bypass
 *   C) owner cookie                → 2xx (gate passes)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import http from "node:http";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// Mocks — only what the route module imports transitively.
// ---------------------------------------------------------------------------

const publicAccessState = { enabled: false };

vi.mock("../../lib/publicAccess", () => ({
  isPublicAccessEnabled: () => publicAccessState.enabled,
  setPublicAccess: (v: boolean) => { publicAccessState.enabled = v; },
  logPublicAccessBootState: () => {},
}));

// userAuth reads db to validate sessions.
vi.mock("@workspace/db", () => ({
  db: { execute: vi.fn(async () => ({ rows: [] })) },
}));

vi.mock("../../lib/logger", () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

// Collectors are stubbed so the auth/validation gate is what we measure —
// no live Kite/DB reads happen in this test.
vi.mock("../../lib/dataParity/observe", () => ({
  observeAllModules: vi.fn(async () => []),
}));

vi.mock("../../lib/dataParity/classify", () => ({
  buildDataParityResult: vi.fn((symbol: string, assetType: string, observations: unknown[], capturedAt: string) => ({
    symbol,
    assetType,
    capturedAt,
    observations,
    mismatches: [],
    overallSeverity: "OK",
  })),
}));

// ---------------------------------------------------------------------------
// Imports AFTER vi.mock() so hoisted mocks apply.
// ---------------------------------------------------------------------------
const dataParityRouter = (await import("../dataParity")).default;

// ---------------------------------------------------------------------------
// Test harness.
// ---------------------------------------------------------------------------

const TEST_SECRET = "test-session-secret-for-data-parity-auth-tests";

function signCookie(value: string): string {
  const sig = createHmac("sha256", TEST_SECRET).update(value).digest("base64").replace(/=+$/, "");
  return `s:${value}.${sig}`;
}

const OWNER_COOKIE = `scanner_session=${encodeURIComponent(signCookie("owner"))}`;

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app: Express = express();
  app.use(cookieParser(TEST_SECRET));
  app.use(express.json());
  app.use("/api", dataParityRouter);
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

async function get(path: string, cookie?: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, { headers: cookie ? { cookie } : {} });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function post(path: string, payload: unknown, cookie?: string): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie) headers["cookie"] = cookie;
  const res = await fetch(`${baseUrl}${path}`, { method: "POST", headers, body: JSON.stringify(payload) });
  return { status: res.status, body: await res.json().catch(() => null) };
}

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

describe("GET /api/data-parity/symbol/:symbol — requireOwnerStrict (no public-mode bypass)", () => {
  it("Case A: anonymous + public-mode OFF → 401 AUTH_REQUIRED", async () => {
    publicAccessState.enabled = false;
    const r = await get("/api/data-parity/symbol/NIFTY");
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("Case B: anonymous + public-mode ON → still 401 (CRITICAL: strict gate, no bypass)", async () => {
    publicAccessState.enabled = true;
    const r = await get("/api/data-parity/symbol/NIFTY");
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("Case C: owner cookie + valid symbol → 200", async () => {
    publicAccessState.enabled = false;
    const r = await get("/api/data-parity/symbol/NIFTY", OWNER_COOKIE);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, result: { symbol: "NIFTY", assetType: "index" } });
  });

  it("Case C, unknown symbol + owner cookie → 400 UNKNOWN_SYMBOL", async () => {
    publicAccessState.enabled = false;
    const r = await get("/api/data-parity/symbol/DOGECOIN", OWNER_COOKIE);
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ ok: false, error: "UNKNOWN_SYMBOL" });
  });
});

describe("POST /api/data-parity/check — requireOwnerStrict (no public-mode bypass)", () => {
  it("Case A: anonymous + public-mode OFF → 401 AUTH_REQUIRED", async () => {
    publicAccessState.enabled = false;
    const r = await post("/api/data-parity/check", { symbols: ["NIFTY"] });
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("Case B: anonymous + public-mode ON → still 401 (CRITICAL: strict gate, no bypass)", async () => {
    publicAccessState.enabled = true;
    const r = await post("/api/data-parity/check", { symbols: ["NIFTY"] });
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("Case C: owner cookie + valid batch → 200 with per-symbol results", async () => {
    publicAccessState.enabled = false;
    const r = await post("/api/data-parity/check", { symbols: ["NIFTY", "RELIANCE"] }, OWNER_COOKIE);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true });
    const results = (r.body as { results: Array<{ symbol: string }> }).results;
    expect(results).toHaveLength(2);
    expect(results.map((x) => x.symbol)).toEqual(["NIFTY", "RELIANCE"]);
  });

  it("owner cookie + oversized batch (11 symbols) → 400 TOO_MANY_SYMBOLS", async () => {
    publicAccessState.enabled = false;
    const symbols = Array.from({ length: 11 }, (_, i) => `SYM${i}`);
    const r = await post("/api/data-parity/check", { symbols }, OWNER_COOKIE);
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ ok: false, error: "TOO_MANY_SYMBOLS" });
  });

  it("owner cookie + unknown symbol in batch → 400 UNKNOWN_SYMBOL", async () => {
    publicAccessState.enabled = false;
    const r = await post("/api/data-parity/check", { symbols: ["NIFTY", "DOGECOIN"] }, OWNER_COOKIE);
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ ok: false, error: "UNKNOWN_SYMBOL" });
  });

  it("owner cookie + empty symbols array → 400 SYMBOLS_REQUIRED", async () => {
    publicAccessState.enabled = false;
    const r = await post("/api/data-parity/check", { symbols: [] }, OWNER_COOKIE);
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ ok: false, error: "SYMBOLS_REQUIRED" });
  });
});
