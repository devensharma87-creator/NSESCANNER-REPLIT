/**
 * /api/observability/client-event contract test.
 *
 * Guards the small, opinionated client-event drain used by
 * `UnifiedGradeChip` to report grade transitions. The endpoint is
 * intentionally strict: any deviation from the discriminated union
 * schema must 400, and Kite-live-degrading transitions must land as
 * WARN in the log tier so ops can trigger an alert.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "http";

vi.mock("../../lib/logger", () => {
  return {
    logger: {
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    },
  };
});

// Import AFTER vi.mock so router picks up mocked logger.
const observabilityRouter = (
  await import("../observability")
).default;
const { logger } = (await import("../../lib/logger")) as unknown as {
  logger: { warn: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn> };
};

let server: http.Server;
let baseUrl: string;

async function post(body: unknown): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}/api/observability/client-event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed };
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

describe("POST /api/observability/client-event", () => {
  it("KITE_TRADE_GRADE → INFO_ONLY: 204 + logger.warn fires", async () => {
    logger.warn.mockClear();
    logger.info.mockClear();
    const res = await post({
      kind: "unified_grade_downgrade",
      chipId: "scanner-boot",
      fromGrade: "KITE_TRADE_GRADE",
      toGrade: "INFO_ONLY",
      source: "kite",
      sessionId: "s-test-1",
      observedAt: "2026-07-15T09:30:00.000Z",
    });
    expect(res.status).toBe(204);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.info).not.toHaveBeenCalled();
    const call = logger.warn.mock.calls[0]![0] as { chipId: string; toGrade: string };
    expect(call.chipId).toBe("scanner-boot");
    expect(call.toGrade).toBe("INFO_ONLY");
  });

  it("KITE_TRADE_GRADE → UNAVAILABLE: warn (hard degradation)", async () => {
    logger.warn.mockClear();
    logger.info.mockClear();
    const res = await post({
      kind: "unified_grade_downgrade",
      chipId: "option-chain-analytics",
      fromGrade: "KITE_TRADE_GRADE",
      toGrade: "UNAVAILABLE",
      source: "kite",
    });
    expect(res.status).toBe(204);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("INFO_ONLY → KITE_TRADE_GRADE: info tier (recovery)", async () => {
    logger.warn.mockClear();
    logger.info.mockClear();
    const res = await post({
      kind: "unified_grade_downgrade",
      chipId: "scanner-boot",
      fromGrade: "INFO_ONLY",
      toGrade: "KITE_TRADE_GRADE",
      source: "kite",
    });
    expect(res.status).toBe(204);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  it("INFO_ONLY → PROVIDER_NOT_CONFIGURED: info (non-Kite baseline)", async () => {
    logger.warn.mockClear();
    logger.info.mockClear();
    const res = await post({
      kind: "unified_grade_downgrade",
      chipId: "flows-nse-archive",
      fromGrade: "INFO_ONLY",
      toGrade: "PROVIDER_NOT_CONFIGURED",
      source: "missing",
    });
    expect(res.status).toBe(204);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  it("invalid kind: 400 with structured error, nothing logged", async () => {
    logger.warn.mockClear();
    logger.info.mockClear();
    const res = await post({
      kind: "arbitrary_debug_log",
      message: "hello",
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe("invalid_event");
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("invalid grade enum: 400", async () => {
    const res = await post({
      kind: "unified_grade_downgrade",
      chipId: "x",
      fromGrade: "WHATEVER",
      toGrade: "INFO_ONLY",
      source: "kite",
    });
    expect(res.status).toBe(400);
  });

  it("chipId too long: 400 (payload size clamp)", async () => {
    const res = await post({
      kind: "unified_grade_downgrade",
      chipId: "x".repeat(200),
      fromGrade: "KITE_TRADE_GRADE",
      toGrade: "INFO_ONLY",
      source: "kite",
    });
    expect(res.status).toBe(400);
  });
});
