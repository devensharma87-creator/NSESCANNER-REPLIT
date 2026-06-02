/**
 * F&O Exit Safety Observability — Owner-only Exit-Safety Diagnostics Route.
 *
 * Verifies the new `GET /api/paper/diagnostics/fo/exit-safety` endpoint:
 *
 *   - is owner-only (anon = 401, subscriber = 403, owner = 200),
 *   - matches the lenient `requireOwner` semantics used by every other
 *     `/paper/diagnostics/*` route (public-mode GET → 200 read bypass),
 *   - returns the aggregated roll-up of the four existing in-process
 *     exit-safety health snapshots (premiumOverlay / orphanExit / mtmSweep /
 *     timeExit1520) exactly as exposed by their getters,
 *   - returns safe zero/null values when counters are unpopulated,
 *   - does NOT mutate any counter (idempotent reads),
 *   - does NOT trigger any sweep, query Kite, or touch the DB.
 *
 * Plus a source-level wiring assertion proves `paper.ts` registers the
 * route exactly once, with `requireOwner`, on the documented path.
 *
 * Test-only file. No runtime / trading / data-ingestion / schema /
 * scheduler logic is changed.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import http from "node:http";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// Mocks. We mount ONLY the new endpoint into a tiny express app so the rest
// of paper.ts (with its large import surface) does not get loaded. The handler
// under test assembles four health getters — the same four pieces paper.ts
// wires together. We import all from source so any change drifts here too.
// A separate source-level assertion below catches the case where paper.ts
// stops registering the route or swaps `requireOwner`.
// ---------------------------------------------------------------------------

const publicAccessState = { enabled: false };

vi.mock("../../lib/publicAccess", () => ({
  isPublicAccessEnabled: () => publicAccessState.enabled,
  setPublicAccess: (v: boolean) => {
    publicAccessState.enabled = v;
  },
  logPublicAccessBootState: () => {},
}));

// Stub @workspace/db so userAuth's subscriber-cookie branch can resolve
// without hitting Postgres. We never reach this path with `OWNER_COOKIE`,
// but the SUBSCRIBER case below does — and `getUserById` does a SELECT.
vi.mock("@workspace/db", () => ({
  db: {
    execute: vi.fn(async () => ({ rows: [] })),
    select: vi.fn(() => ({
      from: () => ({
        where: () => ({ limit: async () => [] }),
        limit: async () => [],
      }),
    })),
  },
  usersTable: { id: { name: "id" } },
}));

vi.mock("../../lib/logger", () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

// Imports AFTER mocks so hoisting applies.
const { requireOwner } = await import("../../lib/userAuth");
const {
  getMtmSweepHealth,
  getOrphanExitSweepHealth,
  getTimeExit1520Health,
  __resetMtmSweepHealthForTests,
  __resetOrphanExitSweepHealthForTests,
  __resetTimeExit1520HealthForTests,
} = await import("../../lib/paperTradingFO");
const {
  getPremiumOverlayHealth,
  __resetPremiumOverlayHealthForTests,
} = await import("../../lib/fnoPremiumExitOverlay");

// ---------------------------------------------------------------------------
// HTTP harness — same cookie-signing pattern as the mtm-sweep route test.
// ---------------------------------------------------------------------------

const TEST_SECRET = "test-session-secret-exit-safety";

function signCookie(value: string): string {
  const sig = createHmac("sha256", TEST_SECRET).update(value).digest("base64").replace(/=+$/, "");
  return `s:${value}.${sig}`;
}

const OWNER_COOKIE = `scanner_session=${encodeURIComponent(signCookie("owner"))}`;
const SUBSCRIBER_COOKIE = `scanner_session=${encodeURIComponent(signCookie("u:42"))}`;

const ROUTE = "/api/paper/diagnostics/fo/exit-safety";

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app: Express = express();
  app.use(cookieParser(TEST_SECRET));
  app.use(express.json());

  // Mirror paper.ts wiring exactly: GET + requireOwner + a passthrough that
  // assembles the four health getters. The source-level assertion below pins
  // that paper.ts still wires it the same way.
  app.get(ROUTE, requireOwner, (_req, res) => {
    res.json({
      generatedAt: new Date().toISOString(),
      premiumOverlay: getPremiumOverlayHealth(),
      orphanExit: getOrphanExitSweepHealth(),
      mtmSweep: getMtmSweepHealth(),
      timeExit1520: getTimeExit1520Health(),
    });
  });

  app.use(
    (_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
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

beforeEach(() => {
  publicAccessState.enabled = false;
  __resetMtmSweepHealthForTests();
  __resetOrphanExitSweepHealthForTests();
  __resetTimeExit1520HealthForTests();
  __resetPremiumOverlayHealthForTests();
});

async function call(cookie?: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${ROUTE}`, {
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
// Auth gate matrix.
// ---------------------------------------------------------------------------

describe("Exit-safety — GET /api/paper/diagnostics/fo/exit-safety auth gate", () => {
  it("anonymous + public-mode OFF → 401 AUTH_REQUIRED", async () => {
    publicAccessState.enabled = false;
    const r = await call();
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("anonymous + public-mode ON → 200 (lenient requireOwner read-bypass, matches other /paper/diagnostics/* routes)", async () => {
    publicAccessState.enabled = true;
    const r = await call();
    expect(r.status).toBe(200);
    const body = r.body as Record<string, unknown>;
    expect(body).toHaveProperty("premiumOverlay");
    expect(body).toHaveProperty("orphanExit");
    expect(body).toHaveProperty("mtmSweep");
    expect(body).toHaveProperty("timeExit1520");
  });

  it("subscriber cookie + public-mode OFF → 403 OWNER_ONLY (no role escalation)", async () => {
    publicAccessState.enabled = false;
    const r = await call(SUBSCRIBER_COOKIE);
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ code: "OWNER_ONLY" });
  });

  it("owner cookie + public-mode OFF → 200 OK", async () => {
    publicAccessState.enabled = false;
    const r = await call(OWNER_COOKIE);
    expect(r.status).toBe(200);
  });

  it("owner cookie + public-mode ON → 200 OK", async () => {
    publicAccessState.enabled = true;
    const r = await call(OWNER_COOKIE);
    expect(r.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Response shape contract.
// ---------------------------------------------------------------------------

describe("Exit-safety — response shape", () => {
  it("returns the four-section roll-up plus generatedAt", async () => {
    const r = await call(OWNER_COOKIE);
    expect(r.status).toBe(200);
    const body = r.body as Record<string, unknown>;

    expect(body).toHaveProperty("generatedAt");
    expect(typeof body.generatedAt).toBe("string");
    expect(body).toHaveProperty("premiumOverlay");
    expect(body).toHaveProperty("orphanExit");
    expect(body).toHaveProperty("mtmSweep");
    expect(body).toHaveProperty("timeExit1520");
  });

  it("premiumOverlay exposes the stable PremiumOverlayHealth shape with safe zero/null defaults", async () => {
    const r = await call(OWNER_COOKIE);
    const po = (r.body as Record<string, Record<string, unknown>>).premiumOverlay;
    for (const k of [
      "cyclesTotal",
      "stoppedTotal",
      "lastCycle",
      "lastSuccessAt",
      "lastErrorAt",
      "lastErrorClass",
      "lastErrorMessage",
      "bootedAt",
    ]) {
      expect(po).toHaveProperty(k);
    }
    expect(po.cyclesTotal).toBe(0);
    expect(po.stoppedTotal).toBe(0);
    expect(po.lastCycle).toBeNull();
    expect(po.lastSuccessAt).toBeNull();
    expect(po.lastErrorAt).toBeNull();
    expect(po.lastErrorClass).toBeNull();
    expect(po.lastErrorMessage).toBeNull();
    expect(typeof po.bootedAt).toBe("string");
  });

  it("orphanExit exposes the stable OrphanExitSweepHealth shape with safe zero/null defaults", async () => {
    const r = await call(OWNER_COOKIE);
    const oe = (r.body as Record<string, Record<string, unknown>>).orphanExit;
    for (const k of [
      "cyclesTotal",
      "closedTotal",
      "lifecycleAdvanceFailures",
      "lastCycle",
      "lastSuccessAt",
      "lastErrorAt",
      "lastErrorClass",
      "lastErrorMessage",
    ]) {
      expect(oe).toHaveProperty(k);
    }
    expect(oe.cyclesTotal).toBe(0);
    expect(oe.closedTotal).toBe(0);
    expect(oe.lifecycleAdvanceFailures).toBe(0);
    expect(oe.lastCycle).toBeNull();
    expect(oe.lastSuccessAt).toBeNull();
    expect(oe.lastErrorAt).toBeNull();
  });

  it("mtmSweep exposes the stable MtmSweepHealth shape with safe zero/null defaults", async () => {
    const r = await call(OWNER_COOKIE);
    const ms = (r.body as Record<string, Record<string, unknown>>).mtmSweep;
    for (const k of [
      "cyclesTotal",
      "rowsUpdatedTotal",
      "lastCycle",
      "lastSuccessAt",
      "lastErrorAt",
      "lastErrorClass",
      "lastErrorMessage",
    ]) {
      expect(ms).toHaveProperty(k);
    }
    expect(ms.cyclesTotal).toBe(0);
    expect(ms.rowsUpdatedTotal).toBe(0);
    expect(ms.lastCycle).toBeNull();
  });

  it("timeExit1520 exposes the stable TimeExit1520Health shape with safe zero/null defaults", async () => {
    const r = await call(OWNER_COOKIE);
    const te = (r.body as Record<string, Record<string, unknown>>).timeExit1520;
    for (const k of [
      "runsTotal",
      "rowsClosedTotal",
      "lastRunAt",
      "lastRunDate",
      "lastRowsClosed",
      "lastErrorAt",
      "lastErrorClass",
      "lastErrorMessage",
    ]) {
      expect(te).toHaveProperty(k);
    }
    expect(te.runsTotal).toBe(0);
    expect(te.rowsClosedTotal).toBe(0);
    expect(te.lastRunAt).toBeNull();
    expect(te.lastRunDate).toBeNull();
    expect(te.lastRowsClosed).toBeNull();
    expect(te.lastErrorAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Idempotence / no-mutation contract.
// ---------------------------------------------------------------------------

describe("Exit-safety — read-only, no side effects", () => {
  it("calling the endpoint twice yields identical counters (no mutation; generatedAt aside)", async () => {
    const r1 = await call(OWNER_COOKIE);
    const r2 = await call(OWNER_COOKIE);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const b1 = r1.body as Record<string, unknown>;
    const b2 = r2.body as Record<string, unknown>;
    expect(b1.premiumOverlay).toEqual(b2.premiumOverlay);
    expect(b1.orphanExit).toEqual(b2.orphanExit);
    expect(b1.mtmSweep).toEqual(b2.mtmSweep);
    expect(b1.timeExit1520).toEqual(b2.timeExit1520);
  });

  it("calling the endpoint does not advance any source counter", async () => {
    const before = {
      premiumOverlay: getPremiumOverlayHealth(),
      orphanExit: getOrphanExitSweepHealth(),
      mtmSweep: getMtmSweepHealth(),
      timeExit1520: getTimeExit1520Health(),
    };
    await call(OWNER_COOKIE);
    await call(OWNER_COOKIE);
    await call(OWNER_COOKIE);
    const after = {
      premiumOverlay: getPremiumOverlayHealth(),
      orphanExit: getOrphanExitSweepHealth(),
      mtmSweep: getMtmSweepHealth(),
      timeExit1520: getTimeExit1520Health(),
    };
    expect(after.premiumOverlay).toEqual(before.premiumOverlay);
    expect(after.orphanExit).toEqual(before.orphanExit);
    expect(after.mtmSweep).toEqual(before.mtmSweep);
    expect(after.timeExit1520).toEqual(before.timeExit1520);
  });
});

// ---------------------------------------------------------------------------
// Source-level wiring assertion — paper.ts must register the route exactly
// once with `requireOwner` on the agreed path. If anyone removes the route,
// retypes the path, or swaps in a stricter/looser gate, this fails loudly.
// ---------------------------------------------------------------------------

describe("Exit-safety — paper.ts wiring", () => {
  it("registers GET /paper/diagnostics/fo/exit-safety with requireOwner exactly once", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const paperSrc = readFileSync(path.join(here, "..", "paper.ts"), "utf8");
    const re = /router\.get\(\s*"\/paper\/diagnostics\/fo\/exit-safety"\s*,\s*requireOwner\s*,/g;
    const matches = paperSrc.match(re) ?? [];
    expect(matches.length).toBe(1);
    expect(paperSrc).toContain("getPremiumOverlayHealth");
    expect(paperSrc).toContain("getOrphanExitSweepHealth");
    expect(paperSrc).toContain("getTimeExit1520Health");
    expect(paperSrc).toContain("getMtmSweepHealth");
  });

  it("imports the four health getters from their lib modules", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const paperSrc = readFileSync(path.join(here, "..", "paper.ts"), "utf8");
    expect(paperSrc).toMatch(
      /import\s*\{[^}]*getTimeExit1520Health[^}]*\}\s*from\s*"\.\.\/lib\/paperTradingFO"/,
    );
    expect(paperSrc).toMatch(
      /import\s*\{[^}]*getPremiumOverlayHealth[^}]*\}\s*from\s*"\.\.\/lib\/fnoPremiumExitOverlay"/,
    );
  });
});
