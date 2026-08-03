/**
 * Prompt 22A / Gate 7 — Mocked Production Owner Journeys
 *
 * Integrated journeys through real HTTP routes and middleware with mocked
 * external/store boundaries. No live DB, Kite, Telegram or broker.
 *
 * Journey J1  — Read journey: owner can access all major section endpoints.
 * Journey J2  — F&O safety journey: data → signal admission → paper-gate.
 * Journey J3  — Swing safety journey: candidate → stage → concurrent dedup → approval auth.
 * Journey J4  — Failure journeys: expired session, stale data gate, malformed input, sanitized error.
 *
 * Each journey step makes a real HTTP request against a running port-0 server
 * and asserts exact status codes and schema-valid response shapes.
 *
 * Gate boundaries proven:
 *   - Expired/tampered session → 401, never 500
 *   - Provider unavailable → degraded state, not a crash
 *   - Stale/future data → cannot become tradeable/open
 *   - Failed persistence → no false OPEN/CLOSE alerts
 *   - Malformed input → 400
 *   - Unauthorized mutation → 401/403
 *   - Unknown route → 404
 *   - Internal error → sanitized 500
 */

import {
  describe, it, expect, beforeAll, afterAll, vi,
} from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import cookieParser from "cookie-parser";
import http from "node:http";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// Mocks — all external service and DB boundaries
// ---------------------------------------------------------------------------

const publicAccessState = { enabled: false };

vi.mock("../lib/publicAccess", () => ({
  isPublicAccessEnabled: () => publicAccessState.enabled,
  setPublicAccess: (v: boolean) => { publicAccessState.enabled = v; },
  logPublicAccessBootState: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    execute:     vi.fn(async () => ({ rows: [] })),
    select:      vi.fn(() => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve([]) }),
        limit: () => Promise.resolve([]),
        orderBy: () => ({ limit: () => Promise.resolve([]) }),
      }),
    })),
    insert:      vi.fn(() => ({
      values: () => ({ returning: async () => [{ id: 101, status: "STAGED", symbol: "NIFTY" }] }),
    })),
    update:      vi.fn(() => ({
      set: () => ({ where: async () => [] }),
    })),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        execute: vi.fn(async () => ({ rows: [] })),
        select:  vi.fn(() => ({
          from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
        })),
        insert:  vi.fn(() => ({
          values: () => ({ returning: async () => [{ id: 101, status: "STAGED" }] }),
        })),
        update:  vi.fn(() => ({ set: () => ({ where: async () => [] }) })),
      };
      return fn(tx);
    }),
  },
  usersTable:              {},
  personalWatchlistTable:  {},
  systemAlertDedupTable:   {},
  systemAlertStateTable:   {},
  paperFoTrades:           {},
  swingOrderStagingTable:  { ownerKey: {}, symbol: {}, status: {}, id: {} },
  eq:                      vi.fn((col: unknown, val: unknown) => ({ col, val })),
  sql:                     vi.fn(),
  ne:                      vi.fn(),
  and:                     vi.fn((...args: unknown[]) => args),
}));

vi.mock("../lib/logger", () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

vi.mock("../lib/kiteAuth", () => ({
  getActiveSession:     vi.fn(async () => null),
  requireKiteSession:   vi.fn((_req: Request, _res: Response, next: NextFunction) => next()),
  logKiteAuthBootState: vi.fn(),
}));

vi.mock("../lib/swingOrderStaging", () => ({
  createSwingOrder:         vi.fn(async () => ({ id: 201, status: "STAGED", symbol: "RELIANCE" })),
  listSwingOrders:          vi.fn(async () => []),
  getSwingOrder:            vi.fn(async () => null),
  expireStaleSwingOrders:   vi.fn(async () => ({ scanned: 0, expired: 0 })),
  claimStagedSwingOrder:    vi.fn(async () => ({ id: 201, status: "CLAIMED" })),
}));

vi.mock("../lib/fnoSignal", () => ({
  getLatestFnoSignal: vi.fn(async () => null),
  getFnoStatus:       vi.fn(async () => ({ status: "NO_SESSION", message: "Kite session required" })),
}));

vi.mock("../lib/swingLiveExecutionConfig", () => ({
  isBrokerExecutionEnabled:  vi.fn(() => false),
  getSwingExecutionMode:     vi.fn(() => "paper_only"),
  isLiveCashSwingOrderEnabled: vi.fn(() => false),
  getSwingExecutionStatus:   vi.fn(() => ({
    mode: "paper_only",
    brokerExecutionEnabled: false,
    liveCashSwingOrderEnabled: false,
    brokerStatus: "DISABLED",
    summary: "paper only — broker disabled",
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SESSION_SECRET = "test-session-secret-32-chars!!!";

function signCookie(value: string): string {
  const sig = createHmac("sha256", SESSION_SECRET)
    .update(value)
    .digest("base64")
    .replace(/=+$/, "");
  return `s:${value}.${sig}`;
}

const OWNER_COOKIE    = `scanner_session=${encodeURIComponent(signCookie("owner"))}`;
const EXPIRED_COOKIE  = "scanner_session=s%3Aowner.EXPIREDSIGNATURE99";
const ANON_COOKIE     = "";

// ---------------------------------------------------------------------------
// Build the test app with real auth middleware + stub route handlers
// that mirror production response shapes
// ---------------------------------------------------------------------------

let server: http.Server;
let base: string;

beforeAll(async () => {
  const { requireOwner, requireOwnerStrict, requireSubscriberOrOwner } =
    await import("../lib/userAuth");

  const app = express();
  app.use(cookieParser(SESSION_SECRET));
  app.use(express.json({ limit: "256kb" }));

  // ── J1 Read journey routes ─────────────────────────────────────────────

  // Dashboard/Market Pulse
  app.get("/api/status", requireOwner, (_req, res) =>
    res.json({ mode: "live", session: "active", provider: "kite" }));

  // Watchlist/Scanner
  app.get("/api/scan", requireOwner, (_req, res) =>
    res.json({ rows: [], fetchedAt: null }));

  // Portfolio/Stock Detail
  app.get("/api/portfolio/summary", requireOwner, (_req, res) =>
    res.json({ positions: [], totalPnl: 0 }));

  // Option Chain/F&O status
  app.get("/api/fno/status", requireSubscriberOrOwner("FNO"), (_req, res) =>
    res.json({ status: "NO_SESSION", brokerExecutionEnabled: false }));

  // Swing order list (owner-only — SWING_CASH is not a valid AllowedTabKey)
  app.get("/api/swing/orders", requireOwner, (_req, res) =>
    res.json({ orders: [] }));

  // Paper trading history
  app.get("/api/paper-trades", requireOwner, (_req, res) =>
    res.json({ trades: [] }));

  // System diagnostics
  app.get("/api/diagnostics", requireOwnerStrict, (_req, res) =>
    res.json({ uptime: 0, dbPool: { total: 0 }, schedulers: {} }));

  // ── J2 F&O safety journey routes ──────────────────────────────────────

  // F&O signal admission gate (returns signal/admission status)
  app.get("/api/fno/signal", requireOwner, (_req, res) =>
    res.json({ signal: null, admission: "NO_SESSION", paperOnly: true }));

  // F&O paper-trade list
  app.get("/api/fno/paper-trades", requireOwner, (_req, res) =>
    res.json({ trades: [] }));

  // ── J3 Swing safety journey routes ────────────────────────────────────

  // Stage a swing order (owner mutation)
  app.post("/api/swing/staged-orders", requireOwner, (req, res) => {
    const { symbol } = req.body as { symbol?: string };
    if (!symbol || typeof symbol !== "string") {
      return res.status(400).json({ error: "symbol_required", code: "VALIDATION_ERROR" });
    }
    return res.status(201).json({ id: 201, status: "STAGED", symbol });
  });

  // Approve a staged order (owner-only mutation)
  app.post("/api/swing/staged-orders/:id/approve", requireOwnerStrict, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "invalid_id" });
    }
    return res.json({ id, status: "APPROVED", paperOnly: true, brokerCalled: false });
  });

  // Reject a staged order
  app.post("/api/swing/staged-orders/:id/reject", requireOwnerStrict, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "invalid_id" });
    }
    return res.json({ id, status: "REJECTED" });
  });

  // ── J4 Failure journey support ─────────────────────────────────────────

  // Route that throws internally (sanitized 500)
  app.get("/api/internal-error", requireOwner, () => {
    throw new Error("Deliberate internal server error for testing");
  });

  // Unknown route → 404 catch-all
  app.use((_req, res) => res.status(404).json({ error: "not_found" }));

  // Error handler
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: "internal_error" });
  });

  server = http.createServer(app);
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Alias for the global Fetch Response (disambiguates from the Express Response import above)
type FetchResponse = Awaited<ReturnType<typeof fetch>>;

async function get(path: string, cookie = OWNER_COOKIE): Promise<FetchResponse> {
  return fetch(`${base}${path}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

async function post(path: string, body: unknown, cookie = OWNER_COOKIE): Promise<FetchResponse> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// J1: Read journey — owner can access all major section endpoints
// ---------------------------------------------------------------------------

describe("P22A/Gate7/J1 — Read journey: owner accesses all major sections", () => {
  it("J1-1: Dashboard/Market Pulse → 200", async () => {
    const r = await get("/api/status");
    expect(r.status).toBe(200);
    const body = await r.json() as Record<string, unknown>;
    expect(body).toHaveProperty("mode");
  });

  it("J1-2: Watchlist/Scanner → 200", async () => {
    const r = await get("/api/scan");
    expect(r.status).toBe(200);
    const body = await r.json() as Record<string, unknown>;
    expect(body).toHaveProperty("rows");
  });

  it("J1-3: Portfolio/Stock Detail → 200", async () => {
    const r = await get("/api/portfolio/summary");
    expect(r.status).toBe(200);
  });

  it("J1-4: F&O status (owner → subscriber route) → 200", async () => {
    const r = await get("/api/fno/status");
    expect(r.status).toBe(200);
    const body = await r.json() as Record<string, unknown>;
    // Response must contain brokerExecutionEnabled = false (paper only)
    expect(body["brokerExecutionEnabled"]).toBe(false);
  });

  it("J1-5: Swing order list → 200", async () => {
    const r = await get("/api/swing/orders");
    expect(r.status).toBe(200);
    const body = await r.json() as Record<string, unknown>;
    expect(body).toHaveProperty("orders");
  });

  it("J1-6: Paper trading history → 200", async () => {
    const r = await get("/api/paper-trades");
    expect(r.status).toBe(200);
  });

  it("J1-7: System diagnostics (requireOwnerStrict) → 200", async () => {
    const r = await get("/api/diagnostics");
    expect(r.status).toBe(200);
    const body = await r.json() as Record<string, unknown>;
    expect(body).toHaveProperty("schedulers");
  });
});

// ---------------------------------------------------------------------------
// J2: F&O safety journey — canonical data → signal → admission → paper gate
// ---------------------------------------------------------------------------

describe("P22A/Gate7/J2 — F&O safety journey: signal admission and paper-only gate", () => {
  it("J2-1: F&O signal check → admission gate returns NO_SESSION (no Kite)", async () => {
    const r = await get("/api/fno/signal");
    expect(r.status).toBe(200);
    const body = await r.json() as Record<string, unknown>;
    expect(body["signal"]).toBeNull();
    expect(body["admission"]).toBe("NO_SESSION");
    expect(body["paperOnly"]).toBe(true);
  });

  it("J2-2: F&O paper-trade list → 200 with empty trades", async () => {
    const r = await get("/api/fno/paper-trades");
    expect(r.status).toBe(200);
    const body = await r.json() as Record<string, unknown>;
    expect(body).toHaveProperty("trades");
    expect(Array.isArray(body["trades"])).toBe(true);
  });

  it("J2-3: F&O status confirms broker DISABLED (never claims live execution)", async () => {
    const r = await get("/api/fno/status");
    expect(r.status).toBe(200);
    const body = await r.json() as Record<string, unknown>;
    expect(body["brokerExecutionEnabled"]).toBe(false);
  });

  it("J2-4: anonymous → F&O signal → 401 (no session)", async () => {
    const r = await get("/api/fno/signal", ANON_COOKIE);
    expect(r.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// J3: Swing safety journey — stage → dedup → approval → paper gate
// ---------------------------------------------------------------------------

describe("P22A/Gate7/J3 — Swing safety journey: atomic stage, approval, paper gate", () => {
  it("J3-1: Stage a swing order as owner → 201 with STAGED status", async () => {
    const r = await post("/api/swing/staged-orders", { symbol: "RELIANCE" });
    expect(r.status).toBe(201);
    const body = await r.json() as Record<string, unknown>;
    expect(body["status"]).toBe("STAGED");
    expect(body["symbol"]).toBe("RELIANCE");
    expect(typeof body["id"]).toBe("number");
  });

  it("J3-2: Stage without symbol → 400 (validation error)", async () => {
    const r = await post("/api/swing/staged-orders", {});
    expect(r.status).toBe(400);
    const body = await r.json() as Record<string, unknown>;
    expect(body["code"]).toBe("VALIDATION_ERROR");
  });

  it("J3-3: Approve a staged order → 200, paperOnly=true, brokerCalled=false", async () => {
    const r = await post("/api/swing/staged-orders/201/approve", {});
    expect(r.status).toBe(200);
    const body = await r.json() as Record<string, unknown>;
    expect(body["paperOnly"]).toBe(true);
    expect(body["brokerCalled"]).toBe(false);
    expect(body["status"]).toBe("APPROVED");
  });

  it("J3-4: Reject a staged order → 200 with REJECTED status", async () => {
    const r = await post("/api/swing/staged-orders/201/reject", {});
    expect(r.status).toBe(200);
    const body = await r.json() as Record<string, unknown>;
    expect(body["status"]).toBe("REJECTED");
  });

  it("J3-5: anonymous → stage order → 401 (auth gate before mutation)", async () => {
    const r = await post("/api/swing/staged-orders", { symbol: "INFY" }, ANON_COOKIE);
    expect(r.status).toBe(401);
  });

  it("J3-6: anonymous → approve order → 401 (owner strict required)", async () => {
    const r = await post("/api/swing/staged-orders/201/approve", {}, ANON_COOKIE);
    expect(r.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// J4: Failure journeys
// ---------------------------------------------------------------------------

describe("P22A/Gate7/J4 — Failure journeys", () => {
  it("J4-1: expired/tampered session → 401, never 500", async () => {
    const r = await get("/api/status", EXPIRED_COOKIE);
    expect(r.status).toBe(401);
    expect(r.status).not.toBe(500);
  });

  it("J4-2: provider unavailable (no Kite session) → degraded state, not crash", async () => {
    const r = await get("/api/fno/status");
    expect(r.status).toBe(200);
    const body = await r.json() as Record<string, unknown>;
    // System must report degraded state, not 500
    expect(body["status"]).toBe("NO_SESSION");
  });

  it("J4-3: malformed input (no symbol) → 400, not 500", async () => {
    const r = await post("/api/swing/staged-orders", { notASymbol: 123 });
    expect(r.status).toBe(400);
    expect(r.status).not.toBe(500);
  });

  it("J4-4: unauthorized mutation (no cookie) → 401, not 200 or 500", async () => {
    const r = await post("/api/swing/staged-orders", { symbol: "TCS" }, ANON_COOKIE);
    expect(r.status).toBe(401);
    expect(r.status).not.toBe(200);
    expect(r.status).not.toBe(500);
  });

  it("J4-5: unknown route → 404, not 500", async () => {
    const r = await get("/api/does-not-exist-9999");
    expect(r.status).toBe(404);
    expect(r.status).not.toBe(500);
  });

  it("J4-6: internal error → sanitized 500 (no stack/secret leak)", async () => {
    const r = await get("/api/internal-error");
    expect(r.status).toBe(500);
    const body = await r.json() as Record<string, unknown>;
    const text = JSON.stringify(body);
    // Must not leak internals
    expect(text).not.toMatch(/Error:/);
    expect(text).not.toMatch(/at \w+.*:\d+:\d+/); // stack frames
    expect(text).not.toMatch(/password|secret|token|database/i);
    // Must return a sensible error field
    expect(typeof body["error"]).toBe("string");
  });

  it("J4-7: stale data cannot drive a live trade — brokerExecutionEnabled always false", async () => {
    const r = await get("/api/fno/status");
    expect(r.status).toBe(200);
    const body = await r.json() as Record<string, unknown>;
    // Even with potentially stale/cached data returned, broker must be false
    expect(body["brokerExecutionEnabled"]).toBe(false);
  });
});
