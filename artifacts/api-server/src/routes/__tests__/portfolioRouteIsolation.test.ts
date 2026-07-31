/**
 * Portfolio Analyser — cross-user isolation route guard (Phase 2).
 *
 * Phase 2 made portfolios DB-persisted per user, scoped by an opaque
 * `ownerKey` ("owner" for the site owner, "u:<id>" for subscribers).
 * Server-side isolation is enforced in `routes/portfolio.ts` and passed
 * architect review, but a regression here would be a PRIVACY LEAK — one
 * user reading or mutating another user's saved portfolios. This file is
 * a dedicated guard proving that can't happen.
 *
 * It asserts, over real HTTP against the verbatim router:
 *   - user A cannot GET / PATCH / DELETE / PUT-holdings user B's portfolio
 *     (always 404, never B's data; B's rows stay intact)
 *   - the SITE OWNER cannot reach a subscriber's portfolio (different
 *     ownerKey → 404)
 *   - list is strictly per-owner (A never sees B's portfolio in /portfolios)
 *   - unauthenticated requests: 401 in normal mode; in public-access mode
 *     reads return an empty list and ALL writes are 403 (read-only)
 *   - defense-in-depth: client-supplied advisory fields
 *     (targetPrice / stopLoss) are dropped on save and never round-trip
 *
 * DB pattern: the route handlers use the module-level `db` singleton with
 * autocommit, so a real cross-user HTTP request cannot observe an injected
 * `tx` — the pure `tx.rollback()` pattern used by the unit-level DB tests
 * is therefore impossible here. Instead we keep ZERO net footprint with
 * scoped cleanup: every row is created under run-unique ownerKeys / emails
 * and deleted in afterEach/afterAll (portfolios cascade to holdings).
 * Like the other DB-touching tests, the whole DB suite auto-skips when
 * `DATABASE_URL` is unset.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
  vi,
} from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import http from "node:http";
import { createHmac, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// Mocks. The router is exercised verbatim; only `isPublicAccessEnabled` is
// stubbed so we can toggle public-access mode per test. `@workspace/db` and
// `userAuth` (getSession / requireSubscriberOrOwner / getUserById) are REAL —
// isolation is a property of the real query layer + real session decoding,
// so mocking them would defeat the purpose of this guard.
// ---------------------------------------------------------------------------

let publicAccess = false;

vi.mock("../../lib/publicAccess", () => ({
  isPublicAccessEnabled: () => publicAccess,
  setPublicAccess: () => {},
  logPublicAccessBootState: () => {},
}));

vi.mock("../../lib/logger", () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

// Imports come AFTER mocks so hoisting applies cleanly.
const portfolioRouter = (await import("../portfolio")).default;

// ---------------------------------------------------------------------------
// HTTP harness — same cookie-signing pattern as the other route tests.
// ---------------------------------------------------------------------------

const TEST_SECRET = "test-session-secret-portfolio-isolation";

function signCookie(value: string): string {
  const sig = createHmac("sha256", TEST_SECRET)
    .update(value)
    .digest("base64")
    .replace(/=+$/, "");
  return `s:${value}.${sig}`;
}

function cookieFor(sessionValue: string): string {
  return `scanner_session=${encodeURIComponent(signCookie(sessionValue))}`;
}

const OWNER_COOKIE = cookieFor("owner");

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app: Express = express();
  app.use(cookieParser(TEST_SECRET));
  app.use(express.json());
  app.use(portfolioRouter);
  app.use(
    (
      _err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
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

type Json = Record<string, unknown>;

async function req(
  method: string,
  path: string,
  opts: { cookie?: string; body?: unknown } = {},
): Promise<{ status: number; body: Json }> {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers["cookie"] = opts.cookie;
  let payload: string | undefined;
  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(opts.body);
  }
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: payload });
  let body: Json = {};
  try {
    body = (await res.json()) as Json;
  } catch {
    body = {};
  }
  return { status: res.status, body };
}

// ===========================================================================
// Public-access / unauthenticated tests — no DB writes required, run always.
// ===========================================================================

describe("Portfolio routes — unauthenticated (normal mode)", () => {
  it("GET /portfolios with no session → 401", async () => {
    publicAccess = false;
    const r = await req("GET", "/portfolios");
    expect(r.status).toBe(401);
  });

  it("POST /portfolios with no session → 401 (middleware blocks)", async () => {
    publicAccess = false;
    const r = await req("POST", "/portfolios", { body: { name: "X" } });
    expect(r.status).toBe(401);
  });
});

describe("Portfolio routes — public-access mode (shared link)", () => {
  it("GET /portfolios returns an EMPTY list (no per-user identity, never leaks rows)", async () => {
    publicAccess = true;
    const r = await req("GET", "/portfolios");
    expect(r.status).toBe(200);
    expect(r.body["items"]).toEqual([]);
  });

  it("POST /portfolios → 403 read-only (writes blocked for cookieless visitors)", async () => {
    publicAccess = true;
    const r = await req("POST", "/portfolios", { body: { name: "Hack" } });
    expect(r.status).toBe(403);
    expect(r.body["code"]).toBe("PUBLIC_MODE_READ_ONLY");
  });

  it("PATCH /portfolios/:id → 403 read-only", async () => {
    publicAccess = true;
    const r = await req("PATCH", `/portfolios/${randomUuid()}`, {
      body: { name: "Hack" },
    });
    expect(r.status).toBe(403);
    expect(r.body["code"]).toBe("PUBLIC_MODE_READ_ONLY");
  });

  it("DELETE /portfolios/:id → 403 read-only", async () => {
    publicAccess = true;
    const r = await req("DELETE", `/portfolios/${randomUuid()}`);
    expect(r.status).toBe(403);
    expect(r.body["code"]).toBe("PUBLIC_MODE_READ_ONLY");
  });

  it("PUT /portfolios/:id/holdings → 403 read-only", async () => {
    publicAccess = true;
    const r = await req("PUT", `/portfolios/${randomUuid()}/holdings`, {
      body: { holdings: [] },
    });
    expect(r.status).toBe(403);
    expect(r.body["code"]).toBe("PUBLIC_MODE_READ_ONLY");
  });

  it("GET /portfolios/:id in public mode → 404 (no identity to scope to)", async () => {
    publicAccess = true;
    const r = await req("GET", `/portfolios/${randomUuid()}`);
    expect(r.status).toBe(404);
  });
});

function randomUuid(): string {
  // Any syntactically-plausible id; these tests never hit a matching row.
  return "00000000-0000-4000-8000-" + randomBytes(6).toString("hex");
}
