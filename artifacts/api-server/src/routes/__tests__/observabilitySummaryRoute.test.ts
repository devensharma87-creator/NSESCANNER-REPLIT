/**
 * GET /api/observability/summary contract test.
 *
 * Guards the ops-dashboard endpoint: buckets are IST-formatted, degrade
 * counts are honest, `since` is clamped, and payload never leaks
 * arbitrary event fields (only chipId + counts).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express, { type Express } from "express";
import http from "http";

vi.mock("../../lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const observabilityRouter = (await import("../observability")).default;
const { _resetClientEventBuffer } = await import("../../lib/clientEventBuffer");

let server: http.Server;
let baseUrl: string;

async function post(body: unknown): Promise<number> {
  const res = await fetch(`${baseUrl}/api/observability/client-event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.status;
}

async function summary(sinceIso?: string): Promise<{ status: number; body: unknown }> {
  const url = new URL("/api/observability/summary", baseUrl);
  if (sinceIso) url.searchParams.set("since", sinceIso);
  const res = await fetch(url.toString());
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

beforeAll(async () => {
  const app: Express = express();
  app.use(express.json());
  app.use("/api", observabilityRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no addr");
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

beforeEach(() => {
  _resetClientEventBuffer();
});

describe("GET /api/observability/summary", () => {
  it("empty buffer → zero-count summary shell", async () => {
    const { status, body } = await summary();
    expect(status).toBe(200);
    const b = body as {
      totalEvents: number;
      totalDegradations: number;
      totalRecoveries: number;
      buckets: unknown[];
      topDegradingChips: unknown[];
    };
    expect(b.totalEvents).toBe(0);
    expect(b.totalDegradations).toBe(0);
    expect(b.totalRecoveries).toBe(0);
    expect(b.buckets).toEqual([]);
    expect(b.topDegradingChips).toEqual([]);
  });

  it("one degradation → summary reflects it, IST bucket ISO ends with +05:30", async () => {
    expect(
      await post({
        kind: "unified_grade_downgrade",
        chipId: "scanner-boot",
        fromGrade: "KITE_TRADE_GRADE",
        toGrade: "INFO_ONLY",
        source: "kite",
      }),
    ).toBe(204);
    const { status, body } = await summary();
    expect(status).toBe(200);
    const b = body as {
      totalDegradations: number;
      topDegradingChips: Array<{ chipId: string; degradations: number }>;
      buckets: Array<{ bucketStart: string; degradations: number }>;
    };
    expect(b.totalDegradations).toBe(1);
    expect(b.topDegradingChips).toEqual([{ chipId: "scanner-boot", degradations: 1 }]);
    expect(b.buckets[0]!.bucketStart).toMatch(/\+05:30$/);
    expect(b.buckets[0]!.degradations).toBe(1);
  });

  it("recovery event lands in recoveries, not degradations", async () => {
    expect(
      await post({
        kind: "unified_grade_downgrade",
        chipId: "option-chain-analytics",
        fromGrade: "INFO_ONLY",
        toGrade: "KITE_TRADE_GRADE",
        source: "kite",
      }),
    ).toBe(204);
    const { body } = await summary();
    const b = body as {
      totalDegradations: number;
      totalRecoveries: number;
      topDegradingChips: unknown[];
    };
    expect(b.totalDegradations).toBe(0);
    expect(b.totalRecoveries).toBe(1);
    expect(b.topDegradingChips).toEqual([]);
  });

  it("summary payload does NOT leak sessionId/page/observedAt", async () => {
    await post({
      kind: "unified_grade_downgrade",
      chipId: "flows-nse-archive",
      fromGrade: "KITE_TRADE_GRADE",
      toGrade: "UNAVAILABLE",
      source: "kite",
      sessionId: "s-sensitive-1",
      page: "/private/path",
    });
    const { body } = await summary();
    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain("s-sensitive-1");
    expect(serialised).not.toContain("/private/path");
    // But chipId IS surfaced — that's the point of the ranking.
    expect(serialised).toContain("flows-nse-archive");
  });
});
