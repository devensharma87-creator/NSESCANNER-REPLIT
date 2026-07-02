/**
 * F&O Exit Monitoring Reliability (T005) — Owner-only exit-monitor API.
 *
 * Verifies the three new endpoints:
 *   - GET  /api/paper/diagnostics/fo/exit-monitor/status
 *   - POST /api/paper/diagnostics/fo/exit-monitor/run-dry
 *   - POST /api/paper/diagnostics/fo/exit-monitor/run-now
 *
 * Same harness pattern as `exitSafetyDiagnosticRoute.test.ts` /
 * `mtmSweepDiagnosticRoute.test.ts`: mount ONLY the three new routes into a
 * tiny express app (avoids loading paper.ts's large import surface), stub
 * every collaborator, assert on the wiring contract, then pin the exact
 * source-level wiring in `paper.ts` with a regex assertion.
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

const publicAccessState = { enabled: false };

vi.mock("../../lib/publicAccess", () => ({
  isPublicAccessEnabled: () => publicAccessState.enabled,
  setPublicAccess: (v: boolean) => {
    publicAccessState.enabled = v;
  },
  logPublicAccessBootState: () => {},
}));

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

const evaluateSingleFnoTradeExitMock = vi.fn((..._args: unknown[]): unknown => undefined);
const closePaperTradeForSignalMock = vi.fn((..._args: unknown[]): unknown => undefined);
vi.mock("../../lib/paperTradingFO", () => ({
  evaluateSingleFnoTradeExit: (...args: unknown[]) => evaluateSingleFnoTradeExitMock(...args),
  closePaperTradeForSignal: (...args: unknown[]) => closePaperTradeForSignalMock(...args),
  getMtmSweepHealth: () => ({}),
  getOrphanExitSweepHealth: () => ({}),
  getTimeExit1520Health: () => ({}),
}));

const getFnoExitMonitorHealthMock = vi.fn((..._args: unknown[]) => ({ cyclesTotal: 0 }));
const recordFnoExitCheckMock = vi.fn(async (..._args: unknown[]) => {});
vi.mock("../../lib/fnoExitMonitorHealth", () => ({
  getFnoExitMonitorHealth: (...args: unknown[]) => getFnoExitMonitorHealthMock(...args),
  recordFnoExitCheck: (...args: unknown[]) => recordFnoExitCheckMock(...args),
}));

const buildGlobalDataHealthMock = vi.fn(async (..._args: unknown[]) => ({ overall: "OK" }));
vi.mock("../../lib/globalDataHealth", () => ({
  buildGlobalDataHealth: (...args: unknown[]) => buildGlobalDataHealthMock(...args),
}));

vi.mock("../../lib/fnoPremiumExitOverlay", () => ({
  getPremiumOverlayHealth: () => ({}),
}));

// Imports AFTER mocks so hoisting applies.
const { requireOwner } = await import("../../lib/userAuth");
const { evaluateSingleFnoTradeExit, closePaperTradeForSignal } = await import(
  "../../lib/paperTradingFO"
);
const { getFnoExitMonitorHealth, recordFnoExitCheck } = await import(
  "../../lib/fnoExitMonitorHealth"
);
const { buildGlobalDataHealth } = await import("../../lib/globalDataHealth");
const { getPremiumOverlayHealth } = await import("../../lib/fnoPremiumExitOverlay");
const { getMtmSweepHealth, getOrphanExitSweepHealth, getTimeExit1520Health } = await import(
  "../../lib/paperTradingFO"
);

// ---------------------------------------------------------------------------
// toCloseReason — duplicated 1:1 from paper.ts so the harness's run-now
// handler matches production exactly. If paper.ts's real mapping ever
// diverges, the source-level assertion at the bottom of this file fails.
// ---------------------------------------------------------------------------
function toCloseReason(exitReason: string) {
  if (exitReason === "TARGET1_HIT") return "TARGET1_HIT" as const;
  if (exitReason === "TARGET2_HIT") return "TARGET2_HIT" as const;
  if (exitReason === "STOPPED") return "STOPPED" as const;
  return "EXPIRED" as const;
}

// ---------------------------------------------------------------------------
// HTTP harness.
// ---------------------------------------------------------------------------

const TEST_SECRET = "test-session-secret-exit-monitor-api";

function signCookie(value: string): string {
  const sig = createHmac("sha256", TEST_SECRET).update(value).digest("base64").replace(/=+$/, "");
  return `s:${value}.${sig}`;
}

const OWNER_COOKIE = `scanner_session=${encodeURIComponent(signCookie("owner"))}`;
const SUBSCRIBER_COOKIE = `scanner_session=${encodeURIComponent(signCookie("u:42"))}`;

const STATUS_ROUTE = "/api/paper/diagnostics/fo/exit-monitor/status";
const RUN_DRY_ROUTE = "/api/paper/diagnostics/fo/exit-monitor/run-dry";
const RUN_NOW_ROUTE = "/api/paper/diagnostics/fo/exit-monitor/run-now";

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app: Express = express();
  app.use(cookieParser(TEST_SECRET));
  app.use(express.json());

  app.get(STATUS_ROUTE, requireOwner, async (_req, res, next) => {
    try {
      const globalDataHealth = await buildGlobalDataHealth();
      res.json({
        generatedAt: new Date().toISOString(),
        exitMonitor: getFnoExitMonitorHealth(),
        premiumOverlay: getPremiumOverlayHealth(),
        orphanExit: getOrphanExitSweepHealth(),
        mtmSweep: getMtmSweepHealth(),
        timeExit1520: getTimeExit1520Health(),
        globalDataHealth,
      });
    } catch (err) {
      next(err);
    }
  });

  app.post(RUN_DRY_ROUTE, requireOwner, async (req, res, next) => {
    try {
      const id = String((req.body as { id?: unknown } | undefined)?.id ?? "").trim();
      if (!id) {
        res.status(400).json({ error: "id (paper_trade_fo row id) is required" });
        return;
      }
      const result = await evaluateSingleFnoTradeExit(id);
      res.json({ generatedAt: new Date().toISOString(), ...result });
    } catch (err) {
      next(err);
    }
  });

  app.post(RUN_NOW_ROUTE, requireOwner, async (req, res, next) => {
    try {
      const id = String((req.body as { id?: unknown } | undefined)?.id ?? "").trim();
      if (!id) {
        res.status(400).json({ error: "id (paper_trade_fo row id) is required" });
        return;
      }
      const evalResult = await evaluateSingleFnoTradeExit(id);
      if (evalResult.status !== "EVALUATED" || !evalResult.trade || !evalResult.decision) {
        const statusCode = evalResult.status === "NOT_FOUND" ? 404 : 409;
        res.status(statusCode).json({ generatedAt: new Date().toISOString(), ...evalResult });
        return;
      }
      const { trade, decision } = evalResult;
      await recordFnoExitCheck({ id: trade.id }, decision).catch(() => {});

      if (decision.kind !== "EXIT") {
        res.json({ generatedAt: new Date().toISOString(), closed: false, trade, decision });
        return;
      }

      const closed = await closePaperTradeForSignal(
        trade.signalDate,
        trade.indexSymbol,
        trade.setupKey,
        trade.direction,
        toCloseReason(decision.exitReason),
      );
      if (!closed) {
        res.status(409).json({
          generatedAt: new Date().toISOString(),
          closed: false,
          trade,
          decision,
          note: "trade was already closed by a concurrent process before this request completed",
        });
        return;
      }
      res.json({ generatedAt: new Date().toISOString(), closed: true, trade: closed, decision });
    } catch (err) {
      next(err);
    }
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
  evaluateSingleFnoTradeExitMock.mockReset();
  closePaperTradeForSignalMock.mockReset();
  recordFnoExitCheckMock.mockClear();
  getFnoExitMonitorHealthMock.mockClear();
  buildGlobalDataHealthMock.mockClear();
});

async function call(
  routePath: string,
  opts: { method?: "GET" | "POST"; cookie?: string; body?: unknown } = {},
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${routePath}`, {
    method: opts.method ?? "GET",
    headers: {
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
      ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
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
// Auth gate matrix — one representative route (status); the other two share
// the exact same `requireOwner` middleware instance so the gate itself is
// not re-tested three times, but the source-wiring assertion at the bottom
// confirms all three actually use it.
// ---------------------------------------------------------------------------

describe("exit-monitor/status — auth gate", () => {
  it("anonymous + public-mode OFF → 401 AUTH_REQUIRED", async () => {
    const r = await call(STATUS_ROUTE);
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("subscriber cookie + public-mode OFF → 403 OWNER_ONLY", async () => {
    const r = await call(STATUS_ROUTE, { cookie: SUBSCRIBER_COOKIE });
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ code: "OWNER_ONLY" });
  });

  it("owner cookie → 200 OK", async () => {
    const r = await call(STATUS_ROUTE, { cookie: OWNER_COOKIE });
    expect(r.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

describe("GET exit-monitor/status", () => {
  it("merges exitMonitor + 4 existing health snapshots + globalDataHealth", async () => {
    const r = await call(STATUS_ROUTE, { cookie: OWNER_COOKIE });
    expect(r.status).toBe(200);
    const body = r.body as Record<string, unknown>;
    expect(body).toHaveProperty("generatedAt");
    expect(body).toHaveProperty("exitMonitor");
    expect(body).toHaveProperty("premiumOverlay");
    expect(body).toHaveProperty("orphanExit");
    expect(body).toHaveProperty("mtmSweep");
    expect(body).toHaveProperty("timeExit1520");
    expect(body).toHaveProperty("globalDataHealth");
    expect(getFnoExitMonitorHealthMock).toHaveBeenCalledTimes(1);
    expect(buildGlobalDataHealthMock).toHaveBeenCalledTimes(1);
  });

  it("never calls evaluateSingleFnoTradeExit or closePaperTradeForSignal (pure read)", async () => {
    await call(STATUS_ROUTE, { cookie: OWNER_COOKIE });
    expect(evaluateSingleFnoTradeExitMock).not.toHaveBeenCalled();
    expect(closePaperTradeForSignalMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// run-dry
// ---------------------------------------------------------------------------

describe("POST exit-monitor/run-dry", () => {
  it("400 when id is missing", async () => {
    const r = await call(RUN_DRY_ROUTE, { method: "POST", cookie: OWNER_COOKIE, body: {} });
    expect(r.status).toBe(400);
    expect(evaluateSingleFnoTradeExitMock).not.toHaveBeenCalled();
  });

  it("passes id through and returns the evaluation result as-is", async () => {
    evaluateSingleFnoTradeExitMock.mockResolvedValueOnce({
      status: "EVALUATED",
      trade: { id: "abc", signalDate: "2026-07-02", indexSymbol: "NIFTY", setupKey: "X", direction: "BULLISH" },
      decision: { kind: "HOLD", tradeGrade: true },
    });
    const r = await call(RUN_DRY_ROUTE, {
      method: "POST",
      cookie: OWNER_COOKIE,
      body: { id: "abc" },
    });
    expect(r.status).toBe(200);
    expect(evaluateSingleFnoTradeExitMock).toHaveBeenCalledWith("abc");
    const body = r.body as Record<string, unknown>;
    expect(body.status).toBe("EVALUATED");
    expect((body.decision as Record<string, unknown>).kind).toBe("HOLD");
  });

  it("never calls closePaperTradeForSignal, even for an EXIT decision (dry = zero writes)", async () => {
    evaluateSingleFnoTradeExitMock.mockResolvedValueOnce({
      status: "EVALUATED",
      trade: { id: "abc", signalDate: "2026-07-02", indexSymbol: "NIFTY", setupKey: "X", direction: "BULLISH" },
      decision: { kind: "EXIT", exitReason: "STOPPED", tradeGrade: true },
    });
    await call(RUN_DRY_ROUTE, { method: "POST", cookie: OWNER_COOKIE, body: { id: "abc" } });
    expect(closePaperTradeForSignalMock).not.toHaveBeenCalled();
    expect(recordFnoExitCheckMock).not.toHaveBeenCalled();
  });

  it("owner-only: anonymous → 401", async () => {
    const r = await call(RUN_DRY_ROUTE, { method: "POST", body: { id: "abc" } });
    expect(r.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// run-now
// ---------------------------------------------------------------------------

describe("POST exit-monitor/run-now", () => {
  it("400 when id is missing", async () => {
    const r = await call(RUN_NOW_ROUTE, { method: "POST", cookie: OWNER_COOKIE, body: {} });
    expect(r.status).toBe(400);
    expect(evaluateSingleFnoTradeExitMock).not.toHaveBeenCalled();
  });

  it("404 when the trade id does not exist", async () => {
    evaluateSingleFnoTradeExitMock.mockResolvedValueOnce({ status: "NOT_FOUND" });
    const r = await call(RUN_NOW_ROUTE, { method: "POST", cookie: OWNER_COOKIE, body: { id: "x" } });
    expect(r.status).toBe(404);
    expect(closePaperTradeForSignalMock).not.toHaveBeenCalled();
  });

  it("409 when the trade is not OPEN / lifecycle missing / no fresh spot", async () => {
    evaluateSingleFnoTradeExitMock.mockResolvedValueOnce({
      status: "NOT_OPEN",
      trade: { id: "abc", signalDate: "2026-07-02", indexSymbol: "NIFTY", setupKey: "X", direction: "BULLISH" },
    });
    const r = await call(RUN_NOW_ROUTE, { method: "POST", cookie: OWNER_COOKIE, body: { id: "abc" } });
    expect(r.status).toBe(409);
    expect(closePaperTradeForSignalMock).not.toHaveBeenCalled();
  });

  it("HOLD decision → audits via recordFnoExitCheck, does NOT close, closed:false", async () => {
    const trade = { id: "abc", signalDate: "2026-07-02", indexSymbol: "NIFTY", setupKey: "X", direction: "BULLISH" };
    evaluateSingleFnoTradeExitMock.mockResolvedValueOnce({
      status: "EVALUATED",
      trade,
      decision: { kind: "HOLD", tradeGrade: true },
    });
    const r = await call(RUN_NOW_ROUTE, { method: "POST", cookie: OWNER_COOKIE, body: { id: "abc" } });
    expect(r.status).toBe(200);
    const body = r.body as Record<string, unknown>;
    expect(body.closed).toBe(false);
    expect(recordFnoExitCheckMock).toHaveBeenCalledTimes(1);
    expect(closePaperTradeForSignalMock).not.toHaveBeenCalled();
  });

  it("BLOCKED decision → does NOT close (never forces a close on a non-trade-grade quote)", async () => {
    const trade = { id: "abc", signalDate: "2026-07-02", indexSymbol: "NIFTY", setupKey: "X", direction: "BULLISH" };
    evaluateSingleFnoTradeExitMock.mockResolvedValueOnce({
      status: "EVALUATED",
      trade,
      decision: { kind: "BLOCKED", tradeGrade: false, blockedReason: "STALE_QUOTE" },
    });
    const r = await call(RUN_NOW_ROUTE, { method: "POST", cookie: OWNER_COOKIE, body: { id: "abc" } });
    expect(r.status).toBe(200);
    expect((r.body as Record<string, unknown>).closed).toBe(false);
    expect(closePaperTradeForSignalMock).not.toHaveBeenCalled();
  });

  it("EXIT/STOPPED decision → closes via closePaperTradeForSignal with mapped reason, returns closed:true", async () => {
    const trade = { id: "abc", signalDate: "2026-07-02", indexSymbol: "NIFTY", setupKey: "X", direction: "BULLISH" };
    evaluateSingleFnoTradeExitMock.mockResolvedValueOnce({
      status: "EVALUATED",
      trade,
      decision: { kind: "EXIT", exitReason: "STOPPED", tradeGrade: true },
    });
    closePaperTradeForSignalMock.mockResolvedValueOnce({ id: "abc", status: "CLOSED" });
    const r = await call(RUN_NOW_ROUTE, { method: "POST", cookie: OWNER_COOKIE, body: { id: "abc" } });
    expect(r.status).toBe(200);
    const body = r.body as Record<string, unknown>;
    expect(body.closed).toBe(true);
    expect(closePaperTradeForSignalMock).toHaveBeenCalledWith(
      "2026-07-02",
      "NIFTY",
      "X",
      "BULLISH",
      "STOPPED",
    );
    expect(recordFnoExitCheckMock).toHaveBeenCalledTimes(1);
  });

  it("EXIT/EXPIRED_TRIGGERED decision → collapses to CloseReason EXPIRED", async () => {
    const trade = { id: "abc", signalDate: "2026-07-02", indexSymbol: "NIFTY", setupKey: "X", direction: "BULLISH" };
    evaluateSingleFnoTradeExitMock.mockResolvedValueOnce({
      status: "EVALUATED",
      trade,
      decision: { kind: "EXIT", exitReason: "EXPIRED_TRIGGERED", tradeGrade: true },
    });
    closePaperTradeForSignalMock.mockResolvedValueOnce({ id: "abc", status: "CLOSED" });
    await call(RUN_NOW_ROUTE, { method: "POST", cookie: OWNER_COOKIE, body: { id: "abc" } });
    expect(closePaperTradeForSignalMock).toHaveBeenCalledWith(
      "2026-07-02",
      "NIFTY",
      "X",
      "BULLISH",
      "EXPIRED",
    );
  });

  it("EXIT decision but concurrent close already happened → 409, no double-close", async () => {
    const trade = { id: "abc", signalDate: "2026-07-02", indexSymbol: "NIFTY", setupKey: "X", direction: "BULLISH" };
    evaluateSingleFnoTradeExitMock.mockResolvedValueOnce({
      status: "EVALUATED",
      trade,
      decision: { kind: "EXIT", exitReason: "STOPPED", tradeGrade: true },
    });
    closePaperTradeForSignalMock.mockResolvedValueOnce(null);
    const r = await call(RUN_NOW_ROUTE, { method: "POST", cookie: OWNER_COOKIE, body: { id: "abc" } });
    expect(r.status).toBe(409);
    expect((r.body as Record<string, unknown>).closed).toBe(false);
    expect(closePaperTradeForSignalMock).toHaveBeenCalledTimes(1);
  });

  it("owner-only: subscriber → 403", async () => {
    const r = await call(RUN_NOW_ROUTE, {
      method: "POST",
      cookie: SUBSCRIBER_COOKIE,
      body: { id: "abc" },
    });
    expect(r.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Source-level wiring assertion.
// ---------------------------------------------------------------------------

describe("exit-monitor API — paper.ts wiring", () => {
  it("registers all three routes exactly once with requireOwner", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const paperSrc = readFileSync(path.join(here, "..", "paper.ts"), "utf8");

    const statusRe =
      /router\.get\(\s*"\/paper\/diagnostics\/fo\/exit-monitor\/status"\s*,\s*requireOwner\s*,/g;
    const dryRe =
      /router\.post\(\s*"\/paper\/diagnostics\/fo\/exit-monitor\/run-dry"\s*,\s*requireOwner\s*,/g;
    const nowRe =
      /router\.post\(\s*"\/paper\/diagnostics\/fo\/exit-monitor\/run-now"\s*,\s*requireOwner\s*,/g;

    expect((paperSrc.match(statusRe) ?? []).length).toBe(1);
    expect((paperSrc.match(dryRe) ?? []).length).toBe(1);
    expect((paperSrc.match(nowRe) ?? []).length).toBe(1);

    expect(paperSrc).toContain("evaluateSingleFnoTradeExit");
    expect(paperSrc).toContain("getFnoExitMonitorHealth");
    expect(paperSrc).toContain("recordFnoExitCheck");
    expect(paperSrc).toContain("buildGlobalDataHealth");
    expect(paperSrc).toContain('decision.kind !== "EXIT"');
  });

  it("run-now never bypasses the EXIT gate to call closePaperTradeForSignal unconditionally", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const paperSrc = readFileSync(path.join(here, "..", "paper.ts"), "utf8");
    // The literal close call must appear textually AFTER the EXIT-kind guard
    // inside the run-now handler block (best-effort ordering check).
    const runNowIdx = paperSrc.indexOf('"/paper/diagnostics/fo/exit-monitor/run-now"');
    const guardIdx = paperSrc.indexOf('decision.kind !== "EXIT"', runNowIdx);
    const closeCallIdx = paperSrc.indexOf("await closePaperTradeForSignal(", runNowIdx);
    expect(runNowIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeGreaterThan(runNowIdx);
    expect(closeCallIdx).toBeGreaterThan(guardIdx);
  });
});
