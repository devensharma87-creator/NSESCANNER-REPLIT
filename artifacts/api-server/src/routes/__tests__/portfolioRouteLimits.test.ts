/**
 * Portfolio Analyser — limit & integrity route guards (Phase 2).
 *
 * The isolation guard (portfolioRouteIsolation.test.ts) proves cross-user
 * privacy. This file proves the OTHER safety rules in routes/portfolio.ts
 * actually hold, so a regression can't silently let a user exceed limits,
 * create confusingly-duplicated portfolios, end up with two "default"
 * portfolios, or persist a partially-saved holdings list.
 *
 * It asserts, over real HTTP against the verbatim router:
 *   - duplicate name (same owner) → 409 duplicate_name, but the SAME name
 *     is allowed for a DIFFERENT owner (unique index is per-ownerKey)
 *   - exceeding MAX_PORTFOLIOS_PER_OWNER (50) → 409 too_many_portfolios_*
 *   - exceeding MAX_HOLDINGS (500) → 400 too_many_holdings_*
 *   - "at most one default per user": setting a new default via POST or
 *     PATCH clears the previous default for THAT user only (other users'
 *     defaults untouched)
 *   - invalid rows (bad symbol / qty<=0 / negative rate) reject the whole
 *     bulk save atomically — no partial / silently-dropped holdings
 *
 * DB pattern: identical to the isolation guard. The route handlers use the
 * module-level `db` singleton with autocommit, so an injected `tx` is not
 * observable over real HTTP; instead we keep ZERO net footprint with scoped
 * cleanup under run-unique ownerKeys, deleting every row in
 * afterEach/afterAll (portfolios cascade to holdings). The whole DB suite
 * auto-skips when `DATABASE_URL` is unset.
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
// Mocks — mirror the isolation guard exactly. Only `isPublicAccessEnabled`
// and the logger are stubbed; `@workspace/db` and `userAuth` stay REAL so the
// limits we assert are properties of the real query/constraint layer.
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

const portfolioRouter = (await import("../portfolio")).default;
const { db, portfoliosTable, usersTable } = await import("@workspace/db");
const { inArray } = await import("drizzle-orm");

// ---------------------------------------------------------------------------
// HTTP harness — same cookie-signing pattern as the other route tests.
// ---------------------------------------------------------------------------

const TEST_SECRET = "test-session-secret-portfolio-limits";

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

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app: Express = express();
  app.use(cookieParser(TEST_SECRET));
  app.use(express.json({ limit: "5mb" }));
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
// Limit & integrity tests — require a real DB. Auto-skip without one.
// ===========================================================================

const hasDb = Boolean(process.env.DATABASE_URL);
const describeDb = hasDb ? describe : describe.skip;

describeDb("Portfolio routes — limits & integrity (live DB)", () => {
  const RUN = randomBytes(4).toString("hex");
  let userIdA = 0;
  let userIdB = 0;
  let cookieA = "";
  let cookieB = "";

  const ownerKeys: string[] = [];

  async function createActiveSubscriber(tag: string): Promise<number> {
    const [row] = await db
      .insert(usersTable)
      .values({
        email: `lim-${RUN}-${tag}@example.test`,
        passwordHash: "scrypt:00:00", // never verified in these tests
        fullName: `Limits Test ${tag}`,
        role: "subscriber",
        status: "active",
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

  async function createPortfolio(
    cookie: string,
    name: string,
    body: Record<string, unknown> = {},
  ): Promise<{ status: number; body: Json }> {
    return req("POST", "/portfolios", {
      cookie,
      body: { name, holdings: [{ symbol: "TCS", qty: 10, rate: 3000 }], ...body },
    });
  }

  // -------------------------------------------------------------------------
  // Duplicate-name protection (unique-per-owner index).
  // -------------------------------------------------------------------------

  it("rejects a duplicate name for the SAME owner with 409 duplicate_name", async () => {
    const first = await createPortfolio(cookieA, "Growth");
    expect(first.status).toBe(201);

    const dup = await createPortfolio(cookieA, "Growth");
    expect(dup.status).toBe(409);
    expect(dup.body["error"]).toBe("duplicate_name");

    // Only the first portfolio exists for A — the dup never landed a row.
    const list = await req("GET", "/portfolios", { cookie: cookieA });
    const items = (list.body["items"] as Array<{ name: string }>) ?? [];
    expect(items.filter((p) => p.name === "Growth")).toHaveLength(1);
  });

  it("allows the SAME name for a DIFFERENT owner (uniqueness is per-ownerKey)", async () => {
    const a = await createPortfolio(cookieA, "Shared Name");
    expect(a.status).toBe(201);

    const b = await createPortfolio(cookieB, "Shared Name");
    expect(b.status).toBe(201);

    // Each owner sees exactly their own "Shared Name".
    const listA = await req("GET", "/portfolios", { cookie: cookieA });
    const listB = await req("GET", "/portfolios", { cookie: cookieB });
    expect(
      ((listA.body["items"] as Array<{ name: string }>) ?? []).map((p) => p.name),
    ).toContain("Shared Name");
    expect(
      ((listB.body["items"] as Array<{ name: string }>) ?? []).map((p) => p.name),
    ).toContain("Shared Name");
  });

  it("rejects a rename onto an existing name (PATCH) with 409 duplicate_name", async () => {
    const p1 = await createPortfolio(cookieA, "First");
    expect(p1.status).toBe(201);
    const p2 = await createPortfolio(cookieA, "Second");
    expect(p2.status).toBe(201);

    const clash = await req("PATCH", `/portfolios/${p2.body["id"]}`, {
      cookie: cookieA,
      body: { name: "First" },
    });
    expect(clash.status).toBe(409);
    expect(clash.body["error"]).toBe("duplicate_name");

    // p2 keeps its original name — the failed rename did not partially apply.
    const after = await req("GET", `/portfolios/${p2.body["id"]}`, { cookie: cookieA });
    expect(after.body["name"]).toBe("Second");
  });

  // -------------------------------------------------------------------------
  // Per-owner portfolio cap.
  // -------------------------------------------------------------------------

  it("rejects creating beyond MAX_PORTFOLIOS_PER_OWNER (50) with 409", async () => {
    // Seed exactly 50 portfolios for A directly (fast — bypasses 50 HTTP POSTs)
    // under run-unique names so cleanup by ownerKey still catches them.
    const seed = Array.from({ length: 50 }, (_, i) => ({
      ownerKey: `u:${userIdA}`,
      name: `cap-${RUN}-${i}`,
      isDefault: i === 0,
    }));
    await db.insert(portfoliosTable).values(seed);

    const over = await createPortfolio(cookieA, "one-too-many");
    expect(over.status).toBe(409);
    expect(String(over.body["error"])).toContain("too_many_portfolios");

    // The cap is per-owner: B (with zero portfolios) can still create.
    const bOk = await createPortfolio(cookieB, "b-fits-fine");
    expect(bOk.status).toBe(201);
  });

  // -------------------------------------------------------------------------
  // Per-portfolio holdings cap.
  // -------------------------------------------------------------------------

  it("rejects creating with more than MAX_HOLDINGS (500) holdings with 400", async () => {
    const tooMany = Array.from({ length: 501 }, (_, i) => ({
      symbol: `SYM${i}`,
      qty: 1,
      rate: 100,
    }));
    const r = await createPortfolio(cookieA, "huge", { holdings: tooMany });
    expect(r.status).toBe(400);
    expect(String(r.body["error"])).toContain("too_many_holdings");

    // Nothing persisted for the rejected create.
    const list = await req("GET", "/portfolios", { cookie: cookieA });
    const items = (list.body["items"] as Array<{ name: string }>) ?? [];
    expect(items.some((p) => p.name === "huge")).toBe(false);
  });

  it("rejects a PUT-holdings of more than MAX_HOLDINGS (500) with 400", async () => {
    const p = await createPortfolio(cookieA, "put-cap", {
      holdings: [{ symbol: "INFY", qty: 5, rate: 1500 }],
    });
    expect(p.status).toBe(201);

    const tooMany = Array.from({ length: 501 }, (_, i) => ({
      symbol: `SYM${i}`,
      qty: 1,
      rate: 100,
    }));
    const r = await req("PUT", `/portfolios/${p.body["id"]}/holdings`, {
      cookie: cookieA,
      body: { holdings: tooMany },
    });
    expect(r.status).toBe(400);
    expect(String(r.body["error"])).toContain("too_many_holdings");

    // Original holding is untouched — the over-cap replace was rejected wholesale.
    const after = await req("GET", `/portfolios/${p.body["id"]}`, { cookie: cookieA });
    const holdings = (after.body["holdings"] as Array<{ symbol: string }>) ?? [];
    expect(holdings.map((h) => h.symbol)).toEqual(["INFY"]);
  });

  // -------------------------------------------------------------------------
  // "At most one default per user" invariant.
  // -------------------------------------------------------------------------

  function defaultsOf(items: Array<{ name: string; isDefault: boolean }>) {
    return items.filter((p) => p.isDefault).map((p) => p.name);
  }

  it("the first portfolio for a user is the default", async () => {
    const p1 = await createPortfolio(cookieA, "Only");
    expect(p1.status).toBe(201);
    expect(p1.body["isDefault"]).toBe(true);
  });

  it("creating a new default (isDefault) clears the previous default for that user", async () => {
    const p1 = await createPortfolio(cookieA, "DefA"); // first → default
    expect(p1.body["isDefault"]).toBe(true);

    const p2 = await createPortfolio(cookieA, "DefB", { isDefault: true });
    expect(p2.body["isDefault"]).toBe(true);

    const list = await req("GET", "/portfolios", { cookie: cookieA });
    const items =
      (list.body["items"] as Array<{ name: string; isDefault: boolean }>) ?? [];
    // Exactly one default, and it's the newest one.
    expect(defaultsOf(items)).toEqual(["DefB"]);
  });

  it("PATCH set-default clears the previous default for that user only", async () => {
    const a1 = await createPortfolio(cookieA, "A1"); // A's default
    const a2 = await createPortfolio(cookieA, "A2");
    const b1 = await createPortfolio(cookieB, "B1"); // B's default
    expect(a1.body["isDefault"]).toBe(true);
    expect(b1.body["isDefault"]).toBe(true);

    // Promote A2 to default via PATCH.
    const patch = await req("PATCH", `/portfolios/${a2.body["id"]}`, {
      cookie: cookieA,
      body: { isDefault: true },
    });
    expect(patch.status).toBe(200);
    expect(patch.body["isDefault"]).toBe(true);

    // A now has exactly one default (A2); A1 was cleared.
    const listA = await req("GET", "/portfolios", { cookie: cookieA });
    const itemsA =
      (listA.body["items"] as Array<{ name: string; isDefault: boolean }>) ?? [];
    expect(defaultsOf(itemsA)).toEqual(["A2"]);

    // B's default is completely untouched by A's toggle.
    const listB = await req("GET", "/portfolios", { cookie: cookieB });
    const itemsB =
      (listB.body["items"] as Array<{ name: string; isDefault: boolean }>) ?? [];
    expect(defaultsOf(itemsB)).toEqual(["B1"]);
  });

  // -------------------------------------------------------------------------
  // DB-level guarantee: the partial unique index makes two defaults for the
  // SAME owner physically impossible — even if the route-layer clear-then-set
  // toggle were ever bypassed (concurrent set-default / multi-replica race).
  // -------------------------------------------------------------------------

  it("rejects a forced double-default insert at the DB level (unique violation)", async () => {
    // First default lands fine via the normal route.
    const first = await createPortfolio(cookieA, "Primary"); // first → default
    expect(first.status).toBe(201);
    expect(first.body["isDefault"]).toBe(true);

    // Bypass the route's clear-then-set toggle entirely and try to write a
    // SECOND is_default row directly for the same owner. The partial unique
    // index on (owner_key) WHERE is_default must reject it (SQLSTATE 23505).
    await expect(
      db.insert(portfoliosTable).values({
        ownerKey: `u:${userIdA}`,
        name: `forced-default-${RUN}`,
        isDefault: true,
      }),
    ).rejects.toMatchObject({});

    // The owner still has exactly one default — the forced insert never landed.
    const list = await req("GET", "/portfolios", { cookie: cookieA });
    const items =
      (list.body["items"] as Array<{ name: string; isDefault: boolean }>) ?? [];
    expect(defaultsOf(items)).toEqual(["Primary"]);
  });

  it("allows a forced default for a DIFFERENT owner (index is partial per-ownerKey)", async () => {
    const a = await createPortfolio(cookieA, "A-default"); // A's default
    expect(a.body["isDefault"]).toBe(true);

    // A non-default extra for A is always fine (index only covers is_default rows).
    await db.insert(portfoliosTable).values({
      ownerKey: `u:${userIdA}`,
      name: `a-extra-${RUN}`,
      isDefault: false,
    });

    // A default for B coexists — the index scopes uniqueness per owner_key.
    await db.insert(portfoliosTable).values({
      ownerKey: `u:${userIdB}`,
      name: `b-default-${RUN}`,
      isDefault: true,
    });

    const listA = await req("GET", "/portfolios", { cookie: cookieA });
    const itemsA =
      (listA.body["items"] as Array<{ name: string; isDefault: boolean }>) ?? [];
    expect(defaultsOf(itemsA)).toEqual(["A-default"]);

    const listB = await req("GET", "/portfolios", { cookie: cookieB });
    const itemsB =
      (listB.body["items"] as Array<{ name: string; isDefault: boolean }>) ?? [];
    expect(defaultsOf(itemsB)).toEqual([`b-default-${RUN}`]);
  });

  // -------------------------------------------------------------------------
  // Atomic validation — invalid rows reject the whole bulk save.
  // -------------------------------------------------------------------------

  it("rejects a CREATE with a bad symbol — no portfolio is persisted", async () => {
    const r = await createPortfolio(cookieA, "bad-symbol", {
      holdings: [
        { symbol: "INFY", qty: 5, rate: 1500 },
        { symbol: "not a symbol!", qty: 1, rate: 100 },
      ],
    });
    expect(r.status).toBe(400);
    expect(String(r.body["error"])).toContain("invalid_symbol");

    const list = await req("GET", "/portfolios", { cookie: cookieA });
    const items = (list.body["items"] as Array<{ name: string }>) ?? [];
    expect(items.some((p) => p.name === "bad-symbol")).toBe(false);
  });

  it("rejects a CREATE with qty <= 0", async () => {
    const r = await createPortfolio(cookieA, "bad-qty", {
      holdings: [{ symbol: "INFY", qty: 0, rate: 1500 }],
    });
    expect(r.status).toBe(400);
    expect(String(r.body["error"])).toContain("invalid_qty");
  });

  it("rejects a CREATE with a negative rate", async () => {
    const r = await createPortfolio(cookieA, "bad-rate", {
      holdings: [{ symbol: "INFY", qty: 5, rate: -1 }],
    });
    expect(r.status).toBe(400);
    expect(String(r.body["error"])).toContain("invalid_rate");
  });

  it("a PUT-holdings with one invalid row rejects atomically — existing holdings survive", async () => {
    const p = await createPortfolio(cookieA, "atomic", {
      holdings: [
        { symbol: "INFY", qty: 5, rate: 1500 },
        { symbol: "TCS", qty: 3, rate: 3000 },
      ],
    });
    expect(p.status).toBe(201);

    // A bulk replace where the 2nd row is invalid (qty<=0) must NOT delete
    // the existing holdings nor insert the valid first row.
    const r = await req("PUT", `/portfolios/${p.body["id"]}/holdings`, {
      cookie: cookieA,
      body: {
        holdings: [
          { symbol: "WIPRO", qty: 100, rate: 400 },
          { symbol: "HDFCBANK", qty: -5, rate: 1600 },
        ],
      },
    });
    expect(r.status).toBe(400);
    expect(String(r.body["error"])).toContain("invalid_qty");

    // Original two holdings are intact — no partial replacement happened.
    const after = await req("GET", `/portfolios/${p.body["id"]}`, { cookie: cookieA });
    const holdings = (after.body["holdings"] as Array<{ symbol: string }>) ?? [];
    expect(holdings.map((h) => h.symbol)).toEqual(["INFY", "TCS"]);
  });
});
