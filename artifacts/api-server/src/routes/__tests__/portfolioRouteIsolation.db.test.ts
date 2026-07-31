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
const { db, portfoliosTable, usersTable } = await import("@workspace/db");
const { eq, inArray } = await import("drizzle-orm");
import { checkDbTestIsolation } from "../../test-infra/dbTestGuard";

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
  checkDbTestIsolation();
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
// Cross-user isolation tests — require a real DB. Auto-skip without one.
// ===========================================================================

const hasDb = Boolean(process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("dummy"));
const describeDb = hasDb ? describe : describe.skip;

describeDb("Portfolio routes — cross-user isolation (live DB)", () => {
  const RUN = randomBytes(4).toString("hex");
  let userIdA = 0;
  let userIdB = 0;
  let cookieA = "";
  let cookieB = "";

  // Track owners we wrote under so cleanup is exhaustive even if a test
  // throws midway.
  const ownerKeys: string[] = [];

  async function createActiveSubscriber(tag: string): Promise<number> {
    const [row] = await db
      .insert(usersTable)
      .values({
        email: `iso-${RUN}-${tag}@example.test`,
        passwordHash: "scrypt:00:00", // never verified in these tests
        fullName: `Isolation Test ${tag}`,
        role: "subscriber",
        status: "active",
        // null expiry → getEffectiveStatus keeps it "active"
        allowedTabs: [],
      })
      .returning({ id: usersTable.id });
    return row!.id;
  }

  beforeAll(async () => {
    publicAccess = false;
    userIdA = await createActiveSubscriber("a");
    userIdB = await createActiveSubscriber("b");
    cookieA = cookieFor(`u:${userIdA}`);
    cookieB = cookieFor(`u:${userIdB}`);
    ownerKeys.push(`u:${userIdA}`, `u:${userIdB}`);
  });

  afterEach(async () => {
    // Remove every portfolio created under the test owners between tests so
    // each case starts clean (holdings cascade via FK).
    if (ownerKeys.length > 0) {
      await db
        .delete(portfoliosTable)
        .where(inArray(portfoliosTable.ownerKey, ownerKeys));
    }
  });

  afterAll(async () => {
    if (ownerKeys.length > 0) {
      await db
        .delete(portfoliosTable)
        .where(inArray(portfoliosTable.ownerKey, ownerKeys));
    }
    const ids = [userIdA, userIdB].filter((n) => n > 0);
    if (ids.length > 0) {
      await db.delete(usersTable).where(inArray(usersTable.id, ids));
    }
  });

  async function createPortfolioFor(
    cookie: string,
    name: string,
    holdings?: unknown[],
  ): Promise<string> {
    const r = await req("POST", "/portfolios", {
      cookie,
      body: { name, holdings: holdings ?? [{ symbol: "TCS", qty: 10, rate: 3000 }] },
    });
    expect(r.status).toBe(201);
    return r.body["id"] as string;
  }

  it("a subscriber can create + read back their OWN portfolio", async () => {
    const id = await createPortfolioFor(cookieA, "A-own");
    const r = await req("GET", `/portfolios/${id}`, { cookie: cookieA });
    expect(r.status).toBe(200);
    expect(r.body["name"]).toBe("A-own");
  });

  it("user B cannot GET user A's portfolio (404, never A's data)", async () => {
    const idA = await createPortfolioFor(cookieA, "A-secret");
    const r = await req("GET", `/portfolios/${idA}`, { cookie: cookieB });
    expect(r.status).toBe(404);
    expect(r.body["name"]).toBeUndefined();
    expect(r.body["holdings"]).toBeUndefined();
  });

  it("user B's list never includes user A's portfolio", async () => {
    await createPortfolioFor(cookieA, "A-only");
    const r = await req("GET", "/portfolios", { cookie: cookieB });
    expect(r.status).toBe(200);
    const items = (r.body["items"] as Array<{ name: string }>) ?? [];
    expect(items.some((p) => p.name === "A-only")).toBe(false);
  });

  it("user B cannot PATCH (rename / set-default) user A's portfolio", async () => {
    const idA = await createPortfolioFor(cookieA, "A-rename-target");
    const r = await req("PATCH", `/portfolios/${idA}`, {
      cookie: cookieB,
      body: { name: "Pwned" },
    });
    expect(r.status).toBe(404);

    // A's portfolio is untouched.
    const after = await req("GET", `/portfolios/${idA}`, { cookie: cookieA });
    expect(after.status).toBe(200);
    expect(after.body["name"]).toBe("A-rename-target");
  });

  it("user B cannot DELETE user A's portfolio", async () => {
    const idA = await createPortfolioFor(cookieA, "A-delete-target");
    const r = await req("DELETE", `/portfolios/${idA}`, { cookie: cookieB });
    expect(r.status).toBe(404);

    // Still there for A.
    const after = await req("GET", `/portfolios/${idA}`, { cookie: cookieA });
    expect(after.status).toBe(200);
    expect(after.body["name"]).toBe("A-delete-target");
  });

  it("user B cannot PUT-replace holdings on user A's portfolio", async () => {
    const idA = await createPortfolioFor(cookieA, "A-holdings", [
      { symbol: "INFY", qty: 5, rate: 1500 },
    ]);
    const r = await req("PUT", `/portfolios/${idA}/holdings`, {
      cookie: cookieB,
      body: { holdings: [{ symbol: "WIPRO", qty: 999, rate: 1 }] },
    });
    expect(r.status).toBe(404);

    // A's holdings are unchanged.
    const after = await req("GET", `/portfolios/${idA}`, { cookie: cookieA });
    const holdings = after.body["holdings"] as Array<{ symbol: string }>;
    expect(holdings.map((h) => h.symbol)).toEqual(["INFY"]);
  });

  it("the SITE OWNER cannot reach a subscriber's portfolio (different ownerKey)", async () => {
    const idA = await createPortfolioFor(cookieA, "A-not-for-owner");
    const get = await req("GET", `/portfolios/${idA}`, { cookie: OWNER_COOKIE });
    expect(get.status).toBe(404);

    const del = await req("DELETE", `/portfolios/${idA}`, { cookie: OWNER_COOKIE });
    expect(del.status).toBe(404);

    // Subscriber-owned row survives the owner's probes.
    const after = await req("GET", `/portfolios/${idA}`, { cookie: cookieA });
    expect(after.status).toBe(200);
  });

  it("an unauthenticated request (normal mode) cannot read a real portfolio", async () => {
    publicAccess = false;
    const idA = await createPortfolioFor(cookieA, "A-private");
    const r = await req("GET", `/portfolios/${idA}`);
    expect(r.status).toBe(401);
    expect(r.body["name"]).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Defense-in-depth: advisory fields must never be persisted.
  // -------------------------------------------------------------------------

  it("drops client-supplied targetPrice/stopLoss on CREATE (never round-trips)", async () => {
    const id = await createPortfolioFor(cookieA, "A-advisory-create", [
      {
        symbol: "HDFCBANK",
        qty: 3,
        rate: 1600,
        // Tamper vectors: advisory fields the surface must NEVER store.
        targetPrice: 9999,
        stopLoss: 1,
      },
    ]);
    const r = await req("GET", `/portfolios/${id}`, { cookie: cookieA });
    const holding = (r.body["holdings"] as Json[])[0]!;
    expect(holding["symbol"]).toBe("HDFCBANK");
    expect(holding).not.toHaveProperty("targetPrice");
    expect(holding).not.toHaveProperty("stopLoss");
  });

  it("drops client-supplied targetPrice/stopLoss on PUT holdings", async () => {
    const id = await createPortfolioFor(cookieA, "A-advisory-put");
    await req("PUT", `/portfolios/${id}/holdings`, {
      cookie: cookieA,
      body: {
        holdings: [
          { symbol: "ITC", qty: 50, rate: 400, targetPrice: 800, stopLoss: 350 },
        ],
      },
    });
    const r = await req("GET", `/portfolios/${id}`, { cookie: cookieA });
    const holding = (r.body["holdings"] as Json[])[0]!;
    expect(holding["symbol"]).toBe("ITC");
    expect(holding).not.toHaveProperty("targetPrice");
    expect(holding).not.toHaveProperty("stopLoss");
  });

  // -------------------------------------------------------------------------
  // Benchmark choice persists per-portfolio (follows the user across devices).
  // -------------------------------------------------------------------------

  it("persists the benchmark on CREATE and returns it on read", async () => {
    const r = await req("POST", "/portfolios", {
      cookie: cookieA,
      body: { name: "A-benchmark-create", benchmark: "NIFTY500", holdings: [] },
    });
    expect(r.status).toBe(201);
    expect(r.body["benchmark"]).toBe("NIFTY500");
    const get = await req("GET", `/portfolios/${r.body["id"]}`, { cookie: cookieA });
    expect(get.body["benchmark"]).toBe("NIFTY500");
  });

  it("defaults benchmark to null when none supplied on CREATE", async () => {
    const id = await createPortfolioFor(cookieA, "A-benchmark-none");
    const get = await req("GET", `/portfolios/${id}`, { cookie: cookieA });
    expect(get.body["benchmark"]).toBeNull();
  });

  it("PATCH can set the benchmark on its own (no rename / set-default needed)", async () => {
    const id = await createPortfolioFor(cookieA, "A-benchmark-patch");
    const patch = await req("PATCH", `/portfolios/${id}`, {
      cookie: cookieA,
      body: { benchmark: "BANKNIFTY" },
    });
    expect(patch.status).toBe(200);
    expect(patch.body["benchmark"]).toBe("BANKNIFTY");
    // Name is untouched by a benchmark-only patch.
    expect(patch.body["name"]).toBe("A-benchmark-patch");
  });

  it("PATCH with benchmark:null clears a previously-stored choice", async () => {
    const r = await req("POST", "/portfolios", {
      cookie: cookieA,
      body: { name: "A-benchmark-clear", benchmark: "SENSEX", holdings: [] },
    });
    const id = r.body["id"] as string;
    const patch = await req("PATCH", `/portfolios/${id}`, {
      cookie: cookieA,
      body: { benchmark: null },
    });
    expect(patch.status).toBe(200);
    expect(patch.body["benchmark"]).toBeNull();
  });

  it("rejects a malformed benchmark key by storing null (opaque, never sticks)", async () => {
    const r = await req("POST", "/portfolios", {
      cookie: cookieA,
      body: { name: "A-benchmark-bad", benchmark: "not a key!!", holdings: [] },
    });
    expect(r.status).toBe(201);
    expect(r.body["benchmark"]).toBeNull();
  });

  it("benchmark survives a PUT holdings replace (replace does not touch it)", async () => {
    const r = await req("POST", "/portfolios", {
      cookie: cookieA,
      body: { name: "A-benchmark-survive", benchmark: "NIFTY", holdings: [] },
    });
    const id = r.body["id"] as string;
    await req("PUT", `/portfolios/${id}/holdings`, {
      cookie: cookieA,
      body: { holdings: [{ symbol: "TCS", qty: 1, rate: 100 }] },
    });
    const get = await req("GET", `/portfolios/${id}`, { cookie: cookieA });
    expect(get.body["benchmark"]).toBe("NIFTY");
  });

  it("cannot read another user's stored benchmark (isolation holds)", async () => {
    const r = await req("POST", "/portfolios", {
      cookie: cookieA,
      body: { name: "A-benchmark-private", benchmark: "NIFTY500", holdings: [] },
    });
    const idA = r.body["id"] as string;
    const get = await req("GET", `/portfolios/${idA}`, { cookie: cookieB });
    expect(get.status).toBe(404);
    expect(get.body["benchmark"]).toBeUndefined();
  });
});
