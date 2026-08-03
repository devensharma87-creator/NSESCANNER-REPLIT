/**
 * Pack 3 / Prompt 21A — Gate 3: Registered route execution.
 *
 * Creates a real Express app, mounts the swing staging router, and fires live
 * HTTP requests through it.  All service-layer functions are replaced with
 * vi.mock stubs so the tests exercise route registration, middleware ordering,
 * Zod schema validation, and response shape — not the service business logic.
 *
 * Pattern: express app + http.createServer on port 0 + global fetch.
 * No PostgreSQL connection.  No live Kite or Telegram calls.
 */

import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

// ---------------------------------------------------------------------------
// Per-test auth control
// ---------------------------------------------------------------------------

const authCtrl = vi.hoisted(() => ({ isOwner: { value: true } }));

// ---------------------------------------------------------------------------
// Service-layer mocks
// ---------------------------------------------------------------------------

vi.mock("../../lib/userAuth", () => ({
  requireOwner: (
    _req: unknown,
    res: { status: (n: number) => { json: (b: unknown) => void }; json?: (b: unknown) => void },
    next: () => void,
  ) => {
    if (authCtrl.isOwner.value) return next();
    (res as { status: (n: number) => { json: (b: unknown) => void } })
      .status(401).json({ error: "AUTH_REQUIRED", code: "AUTH_REQUIRED" });
  },
  requireOwnerStrict: (
    _req: unknown,
    res: { status: (n: number) => { json: (b: unknown) => void } },
    next: () => void,
  ) => {
    if (authCtrl.isOwner.value) return next();
    res.status(401).json({ error: "AUTH_REQUIRED", code: "AUTH_REQUIRED" });
  },
  requireSubscriberOrOwner: () => (
    _req: unknown,
    res: { status: (n: number) => { json: (b: unknown) => void } },
    next: () => void,
  ) => {
    if (authCtrl.isOwner.value) return next();
    res.status(401).json({ error: "AUTH_REQUIRED", code: "AUTH_REQUIRED" });
  },
  getSession: (_req: unknown) =>
    authCtrl.isOwner.value
      ? { role: "owner" as const, userId: "test-user", ownerKey: "owner" }
      : null,
  isOwner: (_req: unknown) => authCtrl.isOwner.value,
}));

vi.mock("../../lib/swingLiveExecutionConfig", () => ({
  getSwingExecutionMode: () => "paper_only",
  getSwingCashBookCapital: () => 1_000_000,
  isLiveCashSwingOrderEnabled: () => false,
  getSwingExecutionStatus: async () => ({
    mode: "paper_only",
    killSwitchActive: false,
    liveCashSwingOrderEnabled: false,
    brokerExecutionEnabled: false,
    brokerStatus: "DISABLED",
    summary: "Paper-only. No live orders.",
    autoTradingEnabled: false,
    environment: { env: "paper", autoTradingEnabled: false, reason: "paper_only" },
  }),
}));

vi.mock("../../lib/swingKillSwitch", () => ({
  isKillSwitchActive: async () => false,
  getKillSwitch: async () => ({ enabled: false, reason: null, updatedAt: null, updatedBy: null }),
  setKillSwitch: async (enabled: boolean) => ({ enabled }),
}));

vi.mock("../../lib/swingAlerts", () => ({
  alertSwingOrderStaged: () => {},
  alertSwingOrderExpired: () => {},
  alertSwingOrderRejected: () => {},
  alertSwingOrderApprovedDryRun: () => {},
  alertSwingOrderBlockedByRisk: () => {},
  buildSwingOrderText: () => "mock-text",
  buildSwingBlockedText: () => "mock-text",
}));

vi.mock("../../lib/publicAccess", () => ({
  isPublicAccessEnabled: () => false,
}));

vi.mock("../../lib/swingTtlSweep", () => ({
  getSwingTtlSweepState: () => ({
    isRunning: false,
    lastRunAt: null,
    lastRunResult: null,
    nextRunAt: null,
  }),
  runSwingTtlSweepOnce: async () => ({
    expired: 0,
    scanned: 0,
    owners: [],
    durationMs: 0,
  }),
}));

vi.mock("../../lib/swingCashLiveCandidateAdapter", () => ({
  createKiteSwingQuoteFetcher: () => async (_symbol: string) => ({
    symbol: _symbol,
    ltp: 1005,
    ltpAsOfMs: Date.now() - 30_000,
    ohlc: { open: 990, high: 1010, low: 985, close: 1000 },
    dailyCandleAsOfMs: Date.now() - 2 * 3_600_000,
    source: "kite",
  }),
  rebuildCandidateForRecheck: (candidate: unknown, quote: unknown) => ({
    candidate: { ...((candidate ?? {}) as Record<string, unknown>), _quote: quote },
    availability: { hasKiteSession: true },
  }),
  buildSnapshotCandidate: (b: unknown, _nowMs: number) => b,
}));

vi.mock("../../lib/swingOrderStaging", () => ({
  stageSwingOrder: async () => ({
    staged: true,
    status: "STAGED",
    reason: null,
    decision: {
      allowed: true,
      reviewRequired: false,
      blockedReasons: [],
      sizing: { qty: 5, capitalRequired: 5000, maxLoss: 500, riskPct: 0.05 },
      eventClassification: null,
    },
    row: {
      id: "row-001",
      ownerKey: "owner",
      symbol: "RELIANCE",
      exchange: "NSE",
      tradingSymbol: null,
      instrumentToken: null,
      status: "STAGED",
      approvalStatus: "PENDING",
      side: "BUY",
      productType: "CNC",
      orderType: "LIMIT",
      entryPrice: 1000,
      limitPrice: 1000,
      stopLoss: 900,
      target1: 1200,
      target2: 1400,
      quantity: 5,
      capitalRequired: 5000,
      maxRisk: 500,
      riskPercent: 0.05,
      executionMode: "paper_only",
      brokerStatus: "BROKER_DISABLED",
      expiresAt: new Date(Date.now() + 8 * 3_600_000),
      createdAt: new Date(),
      updatedAt: new Date(),
      manualReviewRequired: false,
      sector: "OIL",
      signalId: null,
      setupKey: null,
      dataSource: "kite",
      dataAsOf: null,
      candidateSnapshotJson: {},
      riskDecisionJson: {},
      recheckDecisionJson: null,
      resultDateKnown: null,
      resultDate: null,
      corporateActionRisk: null,
      eventRiskStatus: null,
      brokerOrderId: null,
      brokerErrorMessage: null,
    },
  }),
  listSwingOrders: async () => [],  // Route does rows.map(toOrder) — needs array
  getSwingOrder: async (_id: string, _ownerKey: string) => null,
  approveSwingOrder: async (_ownerKey: string, id: string) => ({
    approved: true,
    row: { id, status: "APPROVED" },
    paperTradeResult: { opened: false, blockedReason: "MOCK" },
    availability: {},
  }),
  rejectSwingOrder: async () => ({ rejected: true }),
  watchSwingOrder: async () => ({ watched: true }),
  expireSwingOrder: async () => ({ expired: true }),
  expireStaleSwingOrders: async () => ({ expired: 0, scanned: 0 }),
  previewStaleSwingOrders: async () => ({ staleOrders: [] }),
  buildSwingPortfolioState: async () => ({
    availableCash: 500_000,
    openSwingCount: 0,
    totalSwingCapitalDeployed: 0,
    totalSwingCapital: 1_000_000,
    openPositionsBySector: {},
    openPositionsBySymbol: {},
    seedCapital: 1_000_000,
  }),
  refreshSwingOrder: async (_ownerKey: string, id: string) => ({
    refreshed: true,
    id,
    decision: { allowed: true, reviewRequired: false },
  }),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [], orderBy: () => ({ limit: async () => [] }) }),
        limit: async () => [],
        orderBy: () => ({ limit: async () => [] }),
      }),
    }),
    execute: async () => ({ rows: [] }),
    transaction: async (fn: (...args: unknown[]) => unknown) => fn({
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [] }),
          limit: async () => [],
        }),
      }),
      execute: async () => ({ rows: [] }),
    }),
  },
}));

vi.mock("@workspace/db/schema", async () => {
  const real = await vi.importActual<typeof import("@workspace/db/schema")>("@workspace/db/schema");
  return real;
});

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

let server: http.Server;
let base: string;

beforeAll(async () => {
  const express = (await import("express")).default;
  const { default: swingStagingRouter } = await import("../swingStaging.js");

  const app = express();
  app.use(express.json());
  app.use("/api", swingStagingRouter);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  base = `http://127.0.0.1:${addr.port}/api`;
});

afterAll(() => {
  server?.close();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Pack3/21A/Gate3 — Registered route execution", () => {

  it("R1: anonymous GET /swing/status returns 401", async () => {
    authCtrl.isOwner.value = false;
    const r = await fetch(`${base}/swing/status`);
    authCtrl.isOwner.value = true;
    expect(r.status).toBe(401);
    const body = await r.json() as Record<string, unknown>;
    expect(body).toHaveProperty("error");
  });

  it("R2: anonymous POST /swing/staged-orders returns 401", async () => {
    authCtrl.isOwner.value = false;
    const r = await fetch(`${base}/swing/staged-orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: "RELIANCE", entry: 1000, stop: 900, target1: 1200 }),
    });
    authCtrl.isOwner.value = true;
    expect(r.status).toBe(401);
  });

  it("R3: anonymous GET /swing/staged-orders returns 401", async () => {
    authCtrl.isOwner.value = false;
    const r = await fetch(`${base}/swing/staged-orders`);
    authCtrl.isOwner.value = true;
    expect(r.status).toBe(401);
  });

  it("R4: owner GET /swing/status returns 200 with schema-valid body", async () => {
    authCtrl.isOwner.value = true;
    const r = await fetch(`${base}/swing/status`);
    expect(r.status).toBe(200);
    const body = await r.json() as Record<string, unknown>;
    // Status route returns { execution, killSwitch, ttlSweep }.
    expect(body).toHaveProperty("execution");
    expect(body).toHaveProperty("killSwitch");
  });

  it("R5: owner GET /swing/staged-orders returns 200 with items array", async () => {
    authCtrl.isOwner.value = true;
    const r = await fetch(`${base}/swing/staged-orders`);
    expect(r.status).toBe(200);
    const body = await r.json() as Record<string, unknown>;
    expect(body).toHaveProperty("items");
    expect(Array.isArray(body["items"])).toBe(true);
  });

  it("R6: owner POST /swing/staged-orders with all required fields returns 2xx or 409", async () => {
    authCtrl.isOwner.value = true;
    // StageSwingStagedOrderBody requires: symbol, entry, stop, target1.
    const payload = {
      symbol: "RELIANCE",
      exchange: "NSE",
      entry: 1000,
      stop: 900,
      target1: 1200,
      atr: 20,
      rr: 2,
      sectorAvailable: true,
      benchmarkAvailable: true,
      eventDataAvailable: true,
      triggered: true,
      avgTradedValue: 500_000_000,
      volume: 100_000,
      spreadPct: 0.05,
      deliveryPct: 50,
    };
    const r = await fetch(`${base}/swing/staged-orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect([200, 201, 409]).toContain(r.status);
  });

  it("R7: POST /swing/staged-orders with missing required fields returns 400", async () => {
    authCtrl.isOwner.value = true;
    const r = await fetch(`${base}/swing/staged-orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(400);
  });

  it("R8: owner GET /swing/staged-orders/:id for unknown id returns 404", async () => {
    authCtrl.isOwner.value = true;
    const r = await fetch(`${base}/swing/staged-orders/nonexistent-id-xyz`);
    expect(r.status).toBe(404);
  });

  it("R9: anonymous POST /swing/staged-orders/:id/approve returns 401", async () => {
    authCtrl.isOwner.value = false;
    const r = await fetch(`${base}/swing/staged-orders/row-001/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    authCtrl.isOwner.value = true;
    expect(r.status).toBe(401);
  });

  it("R10: owner POST /swing/staged-orders/:id/approve returns 200 or 404 (not 500)", async () => {
    authCtrl.isOwner.value = true;
    const r = await fetch(`${base}/swing/staged-orders/row-001/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect([200, 404]).toContain(r.status);
  });

  it("R11: anonymous POST /swing/staged-orders/:id/reject returns 401", async () => {
    authCtrl.isOwner.value = false;
    const r = await fetch(`${base}/swing/staged-orders/row-001/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "OWNER_VETO" }),
    });
    authCtrl.isOwner.value = true;
    expect(r.status).toBe(401);
  });

  it("R12: anonymous POST /swing/kill-switch returns 401", async () => {
    authCtrl.isOwner.value = false;
    const r = await fetch(`${base}/swing/kill-switch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    authCtrl.isOwner.value = true;
    expect(r.status).toBe(401);
  });

  it("R13: owner POST /swing/kill-switch returns 200", async () => {
    authCtrl.isOwner.value = true;
    const r = await fetch(`${base}/swing/kill-switch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(r.status).toBe(200);
  });

  it("R14: anonymous POST /swing/staged-orders/expire-stale returns 401", async () => {
    authCtrl.isOwner.value = false;
    const r = await fetch(`${base}/swing/staged-orders/expire-stale`, {
      method: "POST",
    });
    authCtrl.isOwner.value = true;
    expect(r.status).toBe(401);
  });

  it("R15: owner POST /swing/staged-orders/expire-stale returns 200", async () => {
    authCtrl.isOwner.value = true;
    const r = await fetch(`${base}/swing/staged-orders/expire-stale`, {
      method: "POST",
    });
    expect(r.status).toBe(200);
  });

  it("R16: owner GET /swing/ttl-sweep/status returns 200 with isRunning field", async () => {
    authCtrl.isOwner.value = true;
    const r = await fetch(`${base}/swing/ttl-sweep/status`);
    expect(r.status).toBe(200);
    const body = await r.json() as Record<string, unknown>;
    expect(body).toHaveProperty("isRunning");
  });

  it("R17: anonymous POST /swing/staged-orders/:id/refresh returns 401", async () => {
    authCtrl.isOwner.value = false;
    const r = await fetch(`${base}/swing/staged-orders/row-001/refresh`, {
      method: "POST",
    });
    authCtrl.isOwner.value = true;
    expect(r.status).toBe(401);
  });

  it("R18: all owner-accessible read routes return non-5xx status codes", async () => {
    authCtrl.isOwner.value = true;
    const routes = [
      { method: "GET", path: "/swing/status" },
      { method: "GET", path: "/swing/staged-orders" },
      { method: "GET", path: "/swing/ttl-sweep/status" },
    ];
    for (const { method, path } of routes) {
      const r = await fetch(`${base}${path}`, { method });
      expect(r.status).toBeLessThan(500);
    }
  });
});
