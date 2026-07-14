/**
 * GET /build-info — route-level contract test.
 *
 * Verifies:
 *  A) anonymous (public-mode OFF) → 200   (PUBLIC_ROUTES bypass)
 *  B) anonymous (public-mode ON)  → 200   (already passes; belt-and-suspenders)
 *  C) response shape has all expected fields
 *  D) no secret keys in response
 *  E) checkpointMarkers all true
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import http from "node:http";
import type { AddressInfo } from "node:net";

const publicAccessState = { enabled: false };

vi.mock("../../lib/publicAccess", () => ({
  isPublicAccessEnabled: () => publicAccessState.enabled,
  setPublicAccess: (v: boolean) => { publicAccessState.enabled = v; },
  logPublicAccessBootState: () => {},
}));

vi.mock("@workspace/db", () => ({
  db: { execute: vi.fn(async () => ({ rows: [] })) },
}));

vi.mock("../../lib/logger", () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

const SECRET_PATTERNS = [
  "password", "token", "secret", "apikey", "api_key", "private",
  "bearer", "DATABASE_URL", "SESSION_SECRET",
];

let app: Express;
let server: http.Server;
let base: string;

async function get(path: string, cookies = ""): Promise<{ status: number; body: unknown }> {
  const url = `${base}${path}`;
  const headers: Record<string, string> = {};
  if (cookies) headers["Cookie"] = cookies;
  const r = await fetch(url, { headers });
  const body = await r.json().catch(() => null);
  return { status: r.status, body };
}

beforeAll(async () => {
  const { requireAuth } = await import("../../lib/auth");
  const buildInfoRouter = (await import("../buildInfo")).default;

  app = express();
  app.use(cookieParser());
  app.use(requireAuth);
  app.use("/api", buildInfoRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address() as AddressInfo;
  base = `http://127.0.0.1:${addr.port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
});

describe("GET /api/build-info", () => {
  it("A) anonymous, public-mode OFF → 200 (public route bypass)", async () => {
    publicAccessState.enabled = false;
    const { status } = await get("/build-info");
    expect(status).toBe(200);
  });

  it("B) anonymous, public-mode ON → 200", async () => {
    publicAccessState.enabled = true;
    const { status } = await get("/build-info");
    expect(status).toBe(200);
    publicAccessState.enabled = false;
  });

  it("C) response has all expected top-level fields", async () => {
    const { status, body } = await get("/build-info");
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    const required = [
      "app", "environment", "commitSha", "commitShort", "branch",
      "buildTime", "bootTime", "deploymentId", "apiBuildId",
      "frontendBuildId", "frontendBundleFile", "frontendBundleHash",
      "nodeEnv", "checkpointMarkers",
    ];
    for (const field of required) {
      expect(b, `field "${field}" must exist`).toHaveProperty(field);
    }
  });

  it("D) response does not contain secret-pattern keys", async () => {
    const { body } = await get("/build-info");
    const json = JSON.stringify(body ?? {}).toLowerCase();
    for (const pat of SECRET_PATTERNS) {
      expect(json, `must not contain "${pat}"`).not.toContain(pat.toLowerCase());
    }
  });

  it("E) all checkpointMarkers are true", async () => {
    const { body } = await get("/build-info");
    const b = body as Record<string, unknown>;
    const markers = b["checkpointMarkers"] as Record<string, boolean>;
    expect(markers).toBeDefined();
    for (const [key, val] of Object.entries(markers)) {
      expect(val, `checkpointMarkers.${key} must be true`).toBe(true);
    }
  });

  it("F) app field is 'marketscanner'", async () => {
    const { body } = await get("/build-info");
    expect((body as any)?.app).toBe("marketscanner");
  });
});
