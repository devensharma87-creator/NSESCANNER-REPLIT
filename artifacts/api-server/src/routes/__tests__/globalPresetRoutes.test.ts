/**
 * Global screener-preset routes — duplicate-name protection (live DB).
 *
 * The global router scopes presets per browser session and enforces a unique
 * (session_key, name) index. A duplicate insert raises a Postgres
 * unique-violation (SQLSTATE 23505) that drizzle WRAPS — the `23505` code can
 * sit one or more `.cause` levels down on the thrown error. The route's
 * `isUniqueViolation` walks that whole chain so a duplicate surfaces as a clean
 * 409 ("preset name already exists") instead of a generic 500.
 *
 * This file proves, over real HTTP against the verbatim router, that:
 *   - creating a preset with a name that already exists for the SAME session
 *     → 409, and the duplicate never lands a second row
 *   - the SAME name is allowed for a DIFFERENT session (uniqueness is
 *     per-sessionKey)
 *   - renaming (PATCH) onto an existing name → 409, original name preserved
 *
 * DB pattern mirrors portfolioRouteLimits.test.ts: the handlers use the
 * module-level `db` singleton with autocommit, so we keep ZERO net footprint
 * by scoping every row under run-unique session cookies and deleting them in
 * afterEach/afterAll. The whole suite auto-skips when `DATABASE_URL` is unset.
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
import { createHmac, createHash, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// Mocks — public access OFF so requireSessionKey reads the cookie, and the
// logger silenced. `@workspace/db` stays REAL so the unique constraint we
// assert is a property of the real schema/constraint layer.
// ---------------------------------------------------------------------------

vi.mock("../../lib/publicAccess", () => ({
  isPublicAccessEnabled: () => false,
  setPublicAccess: () => {},
  logPublicAccessBootState: () => {},
}));

vi.mock("../../lib/logger", () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

const globalRouter = (await import("../global")).default;
const { db, globalScreenerPresetsTable } = await import("@workspace/db");
const { inArray } = await import("drizzle-orm");

// ---------------------------------------------------------------------------
// HTTP harness — sign the `global_session` cookie the same way cookie-parser
// verifies it, then derive the sessionKey exactly as the route does so our
// cleanup can target the rows we created.
// ---------------------------------------------------------------------------

const TEST_SECRET = "test-session-secret-global-presets";

function signCookie(value: string): string {
  const sig = createHmac("sha256", TEST_SECRET)
    .update(value)
    .digest("base64")
    .replace(/=+$/, "");
  return `s:${value}.${sig}`;
}

function cookieFor(sessionValue: string): string {
  return `global_session=${encodeURIComponent(signCookie(sessionValue))}`;
}

// Mirror of sessionKeyFromCookie() in lib/global/auth.ts.
function sessionKeyFor(cookieValue: string): string {
  return createHash("sha256").update(cookieValue).digest("hex").slice(0, 32);
}

let server: http.Server;
let baseUrl: string;
let originalGlobalPassword: string | undefined;

beforeAll(async () => {
  // requireGlobalAuth (mounted inside globalRouter as `router.use("/global",
  // requireGlobalAuth)`) short-circuits with 503 when GLOBAL_APP_ACCESS_PASSWORD
  // is unset. In the test harness we don't hit the login path — we forge signed
  // cookies directly — so we just need the env var set to *something* so the
  // "configured?" gate passes. The signed cookie we mint below still supplies
  // the identity requireGlobalAuth needs.
  originalGlobalPassword = process.env["GLOBAL_APP_ACCESS_PASSWORD"];
  process.env["GLOBAL_APP_ACCESS_PASSWORD"] = "test-global-password";

  const app: Express = express();
  app.use(cookieParser(TEST_SECRET));
  app.use(express.json({ limit: "5mb" }));
  app.use(globalRouter);
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
  if (originalGlobalPassword === undefined) {
    delete process.env["GLOBAL_APP_ACCESS_PASSWORD"];
  } else {
    process.env["GLOBAL_APP_ACCESS_PASSWORD"] = originalGlobalPassword;
  }
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
// Duplicate-name tests — require a real DB. Auto-skip without one.
// ===========================================================================

const hasDb = Boolean(process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("dummy"));
const describeDb = hasDb ? describe : describe.skip;

describeDb("Global screener-preset routes — duplicate name (live DB)", () => {
  const RUN = randomBytes(4).toString("hex");
  const sessionA = `gsess-${RUN}-a`;
  const sessionB = `gsess-${RUN}-b`;
  const cookieA = cookieFor(sessionA);
  const cookieB = cookieFor(sessionB);
  const sessionKeys = [sessionKeyFor(sessionA), sessionKeyFor(sessionB)];

  const PRESET_BODY = { assetClasses: ["crypto"] };

  async function createPreset(
    cookie: string,
    name: string,
  ): Promise<{ status: number; body: Json }> {
    return req("POST", "/global/screener-presets", {
      cookie,
      body: { name, body: PRESET_BODY },
    });
  }

  afterEach(async () => {
    await db
      .delete(globalScreenerPresetsTable)
      .where(inArray(globalScreenerPresetsTable.sessionKey, sessionKeys));
  });

  it("rejects a duplicate name for the SAME session with 409", async () => {
    const first = await createPreset(cookieA, "Momentum");
    expect(first.status).toBe(201);

    const dup = await createPreset(cookieA, "Momentum");
    expect(dup.status).toBe(409);
    expect(dup.body["error"]).toBe("preset name already exists");

    // Only one "Momentum" exists for A — the duplicate never landed a row.
    const list = await req("GET", "/global/screener-presets", { cookie: cookieA });
    const items = (list.body["items"] as Array<{ name: string }>) ?? [];
    expect(items.filter((p) => p.name === "Momentum")).toHaveLength(1);
  });

  it("allows the SAME name for a DIFFERENT session (uniqueness is per-session)", async () => {
    const a = await createPreset(cookieA, "Shared");
    expect(a.status).toBe(201);

    const b = await createPreset(cookieB, "Shared");
    expect(b.status).toBe(201);
  });

  it("rejects a rename (PATCH) onto an existing name with 409", async () => {
    const p1 = await createPreset(cookieA, "First");
    expect(p1.status).toBe(201);
    const p2 = await createPreset(cookieA, "Second");
    expect(p2.status).toBe(201);

    const clash = await req("PATCH", `/global/screener-presets/${p2.body["id"]}`, {
      cookie: cookieA,
      body: { name: "First" },
    });
    expect(clash.status).toBe(409);
    expect(clash.body["error"]).toBe("preset name already exists");

    // p2 keeps its original name — the failed rename did not partially apply.
    const list = await req("GET", "/global/screener-presets", { cookie: cookieA });
    const items =
      (list.body["items"] as Array<{ id: string; name: string }>) ?? [];
    expect(items.find((p) => p.id === p2.body["id"])?.name).toBe("Second");
  });
});
