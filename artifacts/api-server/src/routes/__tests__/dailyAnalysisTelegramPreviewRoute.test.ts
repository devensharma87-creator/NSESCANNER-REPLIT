/**
 * GET /daily-analysis/telegram/preview — Checkpoint 1 Part E preview endpoint.
 *
 * Verifies the dry-run contract from the spec:
 *   – calls the pure gatherer + builder directly (never sendPreMarketReport/
 *     sendPostMarketReport) so Telegram is never sent and DB dedup state is
 *     never touched.
 *   – gated by requireOwnerStrict — NOT requireOwner — so anonymous access
 *     is blocked even when public-access mode is enabled.
 *   – always renders with isManualTest=true so it can never be confused with
 *     a live scheduled send.
 *   – returns both the rendered text and the underlying data contract JSON.
 *   – rejects an invalid/missing `type` query param.
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

vi.mock("../../lib/alerting", () => ({
  getTelegramStatus: vi.fn(() => ({ status: "CONFIGURED" })),
  getPrePostTelegramStatus: vi.fn(() => ({ status: "CONFIGURED" })),
}));

const gatherPreMarketData = vi.fn(async () => ({
  isManualTest: true,
  istDatetime: "01 Jul 2026 08:50",
  isWeekend: false,
  kite: { sessionPresent: true, user: "owner", expiresAt: null, minsToExpiry: null, feedConnected: true, feedSubscribed: 10 },
  canonicalFno: null,
  swing: null,
}));
const gatherPostMarketData = vi.fn(async () => ({
  isManualTest: true,
  istDate: "2026-07-01",
  isWeekend: false,
  canonicalFno: null,
  fno: null,
  swing: null,
  indexPerformance: null,
  optionChainEod: null,
  exitMonitorVerified: false,
}));
const buildPreMarketReport = vi.fn(() => "PRE-MARKET STATUS [MANUAL TEST]\nStub preview text");
const buildPostMarketReport = vi.fn(() => "POST-MARKET SUMMARY [MANUAL TEST]\nStub preview text");
const sendPreMarketReport = vi.fn(async () => "SENT");
const sendPostMarketReport = vi.fn(async () => "SENT");

vi.mock("../../lib/dailyReports", () => ({
  getLastPreMarketReportRecord: vi.fn(() => null),
  getLastPostMarketReportRecord: vi.fn(() => null),
  getReportHistory: vi.fn(async () => []),
  DAILY_ANALYSIS_COVERAGE: {},
  gatherPreMarketData,
  gatherPostMarketData,
  buildPreMarketReport,
  buildPostMarketReport,
  sendPreMarketReport,
  sendPostMarketReport,
}));

// ---------------------------------------------------------------------------
// Imports AFTER vi.mock() so hoisted mocks apply.
// ---------------------------------------------------------------------------
const dailyAnalysisRouter = (await import("../dailyAnalysis")).default;

// ---------------------------------------------------------------------------
// Test harness.
// ---------------------------------------------------------------------------

const TEST_SECRET = "test-session-secret-for-daily-analysis-preview-tests";

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
  app.use("/api", dailyAnalysisRouter);
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
  gatherPreMarketData.mockClear();
  gatherPostMarketData.mockClear();
  buildPreMarketReport.mockClear();
  buildPostMarketReport.mockClear();
  sendPreMarketReport.mockClear();
  sendPostMarketReport.mockClear();
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
// Auth gate tests — requireOwnerStrict, no public-mode bypass.
// ---------------------------------------------------------------------------

describe("GET /api/daily-analysis/telegram/preview — auth gate (requireOwnerStrict)", () => {
  it("anonymous + public-mode OFF → 401 AUTH_REQUIRED", async () => {
    publicAccessState.enabled = false;
    const r = await get("/api/daily-analysis/telegram/preview?type=pre");
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("anonymous + public-mode ON → still 401 (CRITICAL: strict gate, no bypass)", async () => {
    publicAccessState.enabled = true;
    const r = await get("/api/daily-analysis/telegram/preview?type=pre");
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("owner cookie → 200 (gate passes)", async () => {
    const r = await get("/api/daily-analysis/telegram/preview?type=pre", OWNER_COOKIE);
    expect(r.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Preview contract tests.
// ---------------------------------------------------------------------------

describe("GET /api/daily-analysis/telegram/preview — pre-market", () => {
  it("returns rendered text and the data contract, labelled as manual/preview", async () => {
    const r = await get("/api/daily-analysis/telegram/preview?type=pre", OWNER_COOKIE);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      type: "pre-market",
      isManualTest: true,
      preview: true,
      telegramSent: false,
      dedupStateChanged: false,
      brokerExecution: "DISABLED",
    });
    expect((r.body as { text: string }).text).toContain("PRE-MARKET STATUS");
    expect((r.body as { data: unknown }).data).toBeTruthy();
  });

  it("calls the pure gatherer/builder, never the real send function", async () => {
    await get("/api/daily-analysis/telegram/preview?type=pre", OWNER_COOKIE);
    expect(gatherPreMarketData).toHaveBeenCalledTimes(1);
    expect(buildPreMarketReport).toHaveBeenCalledTimes(1);
    expect(sendPreMarketReport).not.toHaveBeenCalled();
  });

  it("gathers with isManualTest=true", async () => {
    await get("/api/daily-analysis/telegram/preview?type=pre", OWNER_COOKIE);
    const call = gatherPreMarketData.mock.calls[0] as unknown[];
    expect(call[1]).toBe(true);
  });
});

describe("GET /api/daily-analysis/telegram/preview — post-market", () => {
  it("returns rendered text and the data contract, labelled as manual/preview", async () => {
    const r = await get("/api/daily-analysis/telegram/preview?type=post", OWNER_COOKIE);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      type: "post-market",
      isManualTest: true,
      preview: true,
      telegramSent: false,
      dedupStateChanged: false,
      brokerExecution: "DISABLED",
    });
    expect((r.body as { text: string }).text).toContain("POST-MARKET SUMMARY");
  });

  it("calls the pure gatherer/builder, never the real send function", async () => {
    await get("/api/daily-analysis/telegram/preview?type=post", OWNER_COOKIE);
    expect(gatherPostMarketData).toHaveBeenCalledTimes(1);
    expect(buildPostMarketReport).toHaveBeenCalledTimes(1);
    expect(sendPostMarketReport).not.toHaveBeenCalled();
  });

  it("gathers with isManualTest=true", async () => {
    await get("/api/daily-analysis/telegram/preview?type=post", OWNER_COOKIE);
    const call = gatherPostMarketData.mock.calls[0] as unknown[];
    expect(call[1]).toBe(true);
  });
});

describe("GET /api/daily-analysis/telegram/preview — invalid type", () => {
  it("rejects a missing type param with 400", async () => {
    const r = await get("/api/daily-analysis/telegram/preview", OWNER_COOKIE);
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ error: "invalid_type" });
  });

  it("rejects an unrecognized type value with 400", async () => {
    const r = await get("/api/daily-analysis/telegram/preview?type=bogus", OWNER_COOKIE);
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ error: "invalid_type" });
  });

  it("does not call any gatherer on an invalid type", async () => {
    await get("/api/daily-analysis/telegram/preview?type=bogus", OWNER_COOKIE);
    expect(gatherPreMarketData).not.toHaveBeenCalled();
    expect(gatherPostMarketData).not.toHaveBeenCalled();
  });
});

describe("GET /api/daily-analysis/telegram/preview — no secrets exposed", () => {
  it("response body has no Telegram token/chat-id fields", async () => {
    const r = await get("/api/daily-analysis/telegram/preview?type=pre", OWNER_COOKIE);
    const raw = JSON.stringify(r.body);
    expect(raw).not.toMatch(/bot[0-9]{9,}/i);
    expect(raw).not.toMatch(/TELEGRAM_BOT_TOKEN/);
    expect(raw).not.toMatch(/TELEGRAM_CHAT_ID/);
    expect(raw).not.toMatch(/PREPOST_TELEGRAM_BOT_TOKEN/);
    expect(raw).not.toMatch(/PREPOST_TELEGRAM_CHAT_ID/);
  });
});
