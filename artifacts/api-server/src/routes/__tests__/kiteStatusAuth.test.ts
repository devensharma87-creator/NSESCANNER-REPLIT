/**
 * Kite owner-metadata route security regression tests.
 *
 * `GET /api/kite/status` returns owner-only session metadata (api-key preview,
 * Kite user id/name, login/expiry times, feed status, and the Stage-1 readiness
 * object incl. kiteOfflineSince). `GET /api/kite/login-url` returns the Zerodha
 * login URL embedding the api_key. Neither may ever be readable on a public
 * shared link.
 *
 * These two endpoints are gated by the **strict** owner middleware
 * (`requireOwnerStrict`) — they do NOT inherit `requireOwner`'s public-mode
 * GET/HEAD read bypass. By contrast `GET /api/kite/quotes` keeps the ordinary
 * `requireOwner` gate, so this file also pins that the strict gate is *selective*
 * (generic market-data reads still bypass in public mode).
 *
 * Test-only file. No runtime / trading / data-ingestion / schema / scheduler
 * logic is changed.
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

// userAuth imports `db` from @workspace/db at module load; getSession itself
// only reads cookies, so an empty stub is enough.
vi.mock("@workspace/db", () => ({
  db: { execute: vi.fn(async () => ({ rows: [] })) },
}));

vi.mock("../../lib/logger", () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

// kiteAuth — only the funcs the routes under test touch need real-ish returns.
vi.mock("../../lib/kiteAuth", () => ({
  getKiteCreds: () => ({ apiKey: "abcd1234", apiSecret: "secret" }),
  getActiveSession: vi.fn(async () => null),
  buildLoginUrl: (apiKey: string) => `https://kite.zerodha.com/connect/login?api_key=${apiKey}`,
  clearSession: vi.fn(async () => {}),
  completeLogin: vi.fn(async () => {}),
  forceRefreshInstruments: vi.fn(async () => ({})),
  storeImportedSession: vi.fn(async () => {}),
  exportInstrumentsCache: vi.fn(() => ({})),
}));

vi.mock("../../lib/kiteFeed", () => ({
  feedStatus: () => ({ connected: false }),
  addTickListener: vi.fn(),
  getAllLiveQuotes: () => ({}),
  getLiveQuote: () => null,
  startTicker: vi.fn(async () => {}),
  stopTicker: vi.fn(() => {}),
  subscribe: vi.fn(),
}));

vi.mock("../../lib/kiteReadiness", () => ({
  getKiteReadiness: vi.fn(async () => ({ state: "READY", isHealthy: true })),
}));

// ---------------------------------------------------------------------------
// Imports come AFTER vi.mock() so hoisted mocks apply.
// ---------------------------------------------------------------------------
const kiteRouter = (await import("../kite")).default;

// ---------------------------------------------------------------------------
// Test harness — mirrors diagnosticRouteAuth.test.ts cookie signing.
// ---------------------------------------------------------------------------

const TEST_SECRET = "test-session-secret-for-kite-status-auth-tests";

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
  app.use("/api", kiteRouter);
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
// Strict-gated owner-metadata reads.
// ---------------------------------------------------------------------------

const STRICT_ENDPOINTS = [
  { name: "kite status", path: "/api/kite/status" },
  { name: "kite login-url", path: "/api/kite/login-url" },
] as const;

describe("kite owner-metadata reads use the strict owner gate (no public read bypass)", () => {
  describe.each(STRICT_ENDPOINTS)("$name ($path)", (ep) => {
    it("Case A: anonymous + public-mode OFF → 401 AUTH_REQUIRED", async () => {
      publicAccessState.enabled = false;
      const r = await get(ep.path);
      expect(r.status).toBe(401);
      expect(r.body).toMatchObject({ code: "AUTH_REQUIRED" });
    });

    it("Case B: anonymous + public-mode ON → still 401 (CRITICAL: no public-mode read bypass)", async () => {
      publicAccessState.enabled = true;
      const r = await get(ep.path);
      expect(r.status).toBe(401);
      expect(r.body).toMatchObject({ code: "AUTH_REQUIRED" });
    });

    it("Case C: subscriber cookie → 403 OWNER_ONLY (no role escalation)", async () => {
      publicAccessState.enabled = false;
      const r = await get(ep.path, SUBSCRIBER_COOKIE);
      expect(r.status).toBe(403);
      expect(r.body).toMatchObject({ code: "OWNER_ONLY" });
    });

    it("Case D: owner cookie + public-mode OFF → gate passes (not 401/403)", async () => {
      publicAccessState.enabled = false;
      const r = await get(ep.path, OWNER_COOKIE);
      expect(r.status).not.toBe(401);
      expect(r.status).not.toBe(403);
    });

    it("Case D': owner cookie + public-mode ON → gate still passes (not 401/403)", async () => {
      publicAccessState.enabled = true;
      const r = await get(ep.path, OWNER_COOKIE);
      expect(r.status).not.toBe(401);
      expect(r.status).not.toBe(403);
    });
  });
});

// ---------------------------------------------------------------------------
// Selectivity — generic market-data reads keep the ordinary requireOwner gate,
// which DOES bypass GET in public mode. This proves the strict gate was applied
// only to the owner-metadata endpoints, not blanket-tightened.
// ---------------------------------------------------------------------------

describe("kite generic market-data read keeps the ordinary public-mode read bypass", () => {
  it("GET /api/kite/quotes: anonymous + public-mode OFF → 401", async () => {
    publicAccessState.enabled = false;
    const r = await get("/api/kite/quotes");
    expect(r.status).toBe(401);
  });

  it("GET /api/kite/quotes: anonymous + public-mode ON → gate passes (not 401/403)", async () => {
    publicAccessState.enabled = true;
    const r = await get("/api/kite/quotes");
    expect(r.status).not.toBe(401);
    expect(r.status).not.toBe(403);
  });
});
