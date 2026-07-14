/**
 * GET /api/data-health/backbone — access-control regression test.
 *
 * Verifies that the backbone health endpoint is gated by `requireOwnerStrict`,
 * NOT `requireOwner`. `requireOwner` would let anonymous GET requests through
 * when public-access mode is enabled — exactly the wrong behaviour for an
 * internal diagnostic that exposes signal-pipeline readiness detail.
 *
 * Auth cases:
 *   A) anonymous, public-mode OFF  → 401 AUTH_REQUIRED
 *   B) anonymous, public-mode ON   → 401 AUTH_REQUIRED  ← CRITICAL: no bypass
 *   C) owner cookie                → 2xx (gate passes)
 *
 * GET /api/data-health/market (public route on the same router) is also tested
 * to confirm `requireOwnerStrict` was NOT accidentally applied there.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import http from "node:http";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// Mocks — only what the route modules import transitively.
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

// backboneHealth — stub so handler never throws and the gate is what we measure.
vi.mock("../../lib/backboneHealth", () => ({
  buildBackboneReport: vi.fn(async () => ({
    generatedAt: new Date().toISOString(),
    modules: [],
  })),
}));

// marketDataHealth — for the public /market route on the same router.
vi.mock("../../lib/marketDataHealth", () => ({
  buildMarketDataHealth: vi.fn(async () => ({
    status: "UNAVAILABLE",
    generatedAt: new Date().toISOString(),
  })),
}));

// ---------------------------------------------------------------------------
// Imports AFTER vi.mock() so hoisted mocks apply.
// ---------------------------------------------------------------------------
const dataHealthRouter = (await import("../dataHealth")).default;

// ---------------------------------------------------------------------------
// Test harness.
// ---------------------------------------------------------------------------

const TEST_SECRET = "test-session-secret-for-backbone-auth-tests";

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
  app.use("/api", dataHealthRouter);
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
  let body: unknown = null;
  const text = await res.text();
  if (text.length > 0) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

describe("GET /api/data-health/backbone — requireOwnerStrict (no public-mode bypass)", () => {
  it("Case A: anonymous + public-mode OFF → 401 AUTH_REQUIRED", async () => {
    publicAccessState.enabled = false;
    const r = await get("/api/data-health/backbone");
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("Case B: anonymous + public-mode ON → still 401 (CRITICAL: strict gate, no bypass)", async () => {
    publicAccessState.enabled = true;
    const r = await get("/api/data-health/backbone");
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("Case C: owner cookie → 200 (gate passes through)", async () => {
    publicAccessState.enabled = false;
    const r = await get("/api/data-health/backbone", OWNER_COOKIE);
    expect(r.status).toBe(200);
  });

  it("Case C public-mode: owner cookie + public-mode ON → 200", async () => {
    publicAccessState.enabled = true;
    const r = await get("/api/data-health/backbone", OWNER_COOKIE);
    expect(r.status).toBe(200);
  });
});

describe("GET /api/data-health/market — public route on same router is unaffected", () => {
  it("anonymous + public-mode OFF → 200 (public endpoint, no auth required)", async () => {
    publicAccessState.enabled = false;
    const r = await get("/api/data-health/market");
    expect(r.status).toBe(200);
  });

  it("anonymous + public-mode ON → 200 (still public)", async () => {
    publicAccessState.enabled = true;
    const r = await get("/api/data-health/market");
    expect(r.status).toBe(200);
  });
});
