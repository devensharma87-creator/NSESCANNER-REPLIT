/**
 * Owner-only Strategy-Control route guard (Task #109).
 *
 * These routes decide which strategies the live F&O engine may emit, so a
 * regression here could silently disable a working setup or wrongly enable a
 * backtest-only research strategy on the live engine. This file pins, over real
 * HTTP against the verbatim router:
 *
 *   - every route is OWNER-ONLY (anonymous → 401, subscriber → 403, and in
 *     public-access mode writes are blocked while reads pass `requireOwner`);
 *   - PUT /engine rejects any id outside {engine builtins ∪ owner customs} with
 *     NOT_ENGINE_SELECTABLE (you can't toggle a backtest-only strategy live);
 *   - DELETE /custom/:id rejects non-`CUSTOM_*` ids with NOT_A_CUSTOM_STRATEGY
 *     (defense-in-depth: this endpoint must never touch a builtin's state row);
 *   - a valid DELETE calls the store's `deleteCustomSpec`, which removes BOTH
 *     the spec AND its engine-state row in one go.
 *
 * The `store` layer is mocked so the test is DB-free; `requireOwner` /
 * `getSession` and the pure catalog/spec modules run verbatim — the auth gate
 * and the selectable-id math are exactly what we're measuring.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import http from "node:http";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { CustomStrategySpec } from "../../lib/strategies/customSpec";

// ---------------------------------------------------------------------------
// Mocks. publicAccess is toggled per-test; the store is fully stubbed so no DB
// is touched. Everything else (requireOwner, getSession, catalog, customSpec
// validation) runs verbatim.
// ---------------------------------------------------------------------------

const publicAccessState = { enabled: false };

vi.mock("../../lib/publicAccess", () => ({
  isPublicAccessEnabled: () => publicAccessState.enabled,
  setPublicAccess: (v: boolean) => {
    publicAccessState.enabled = v;
  },
  logPublicAccessBootState: () => {},
}));

vi.mock("../../lib/logger", () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

const storeState = {
  customSpecs: [] as CustomStrategySpec[],
  engineState: new Map<string, boolean>(),
};

const setEngineState = vi.fn(async (id: string, enabled: boolean) => {
  storeState.engineState.set(id, enabled);
});
const upsertCustomSpec = vi.fn(async (spec: CustomStrategySpec) => {
  storeState.customSpecs = storeState.customSpecs.filter((s) => s.id !== spec.id);
  storeState.customSpecs.push(spec);
});
const deleteCustomSpec = vi.fn(async (id: string) => {
  storeState.customSpecs = storeState.customSpecs.filter((s) => s.id !== id);
  storeState.engineState.delete(id);
});

vi.mock("../../lib/strategies/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/strategies/store")>();
  return {
    ...actual,
    listCustomSpecs: async () => storeState.customSpecs,
    getEngineStateMap: async () => new Map(storeState.engineState),
    setEngineState: (id: string, enabled: boolean) => setEngineState(id, enabled),
    upsertCustomSpec: (spec: CustomStrategySpec) => upsertCustomSpec(spec),
    deleteCustomSpec: (id: string) => deleteCustomSpec(id),
  };
});

const strategyControlRouter = (await import("../strategyControl")).default;

// ---------------------------------------------------------------------------
// HTTP harness — same signed-cookie pattern as the other route tests.
// ---------------------------------------------------------------------------

const TEST_SECRET = "test-session-secret-strategy-control";

function signCookie(value: string): string {
  const sig = createHmac("sha256", TEST_SECRET).update(value).digest("base64").replace(/=+$/, "");
  return `s:${value}.${sig}`;
}
function cookieFor(value: string): string {
  return `scanner_session=${encodeURIComponent(signCookie(value))}`;
}

const OWNER_COOKIE = cookieFor("owner");
const SUBSCRIBER_COOKIE = cookieFor("u:42");

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app: Express = express();
  app.use(cookieParser(TEST_SECRET));
  app.use(express.json());
  app.use(strategyControlRouter);
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
  storeState.customSpecs = [];
  storeState.engineState = new Map();
  setEngineState.mockClear();
  upsertCustomSpec.mockClear();
  deleteCustomSpec.mockClear();
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

const VALID_CUSTOM_INPUT = {
  slug: "my_edge",
  name: "My Edge",
  category: "Custom",
  bull: [{ left: "close", op: "gt", right: { type: "feature", feature: "ema20" } }],
};

// ===========================================================================
// Owner-only auth matrix.
// ===========================================================================

interface Ep {
  name: string;
  method: string;
  path: string;
  body?: unknown;
}

const WRITE_ENDPOINTS: readonly Ep[] = [
  { name: "PUT engine", method: "PUT", path: "/strategy-control/engine", body: { items: [{ strategyId: "VWAP_RECLAIM", enabled: false }] } },
  { name: "POST custom", method: "POST", path: "/strategy-control/custom", body: VALID_CUSTOM_INPUT },
  { name: "DELETE custom", method: "DELETE", path: "/strategy-control/custom/CUSTOM_my_edge" },
];

describe("Strategy-Control routes — owner-only auth", () => {
  it("GET catalog: anonymous (public OFF) → 401", async () => {
    const r = await req("GET", "/strategy-control/catalog");
    expect(r.status).toBe(401);
  });

  it("GET catalog: subscriber → 403 OWNER_ONLY", async () => {
    const r = await req("GET", "/strategy-control/catalog", { cookie: SUBSCRIBER_COOKIE });
    expect(r.status).toBe(403);
    expect(r.body["code"]).toBe("OWNER_ONLY");
  });

  it("GET catalog: owner → 200 with engine flags", async () => {
    const r = await req("GET", "/strategy-control/catalog", { cookie: OWNER_COOKIE });
    expect(r.status).toBe(200);
    const entries = r.body["entries"] as Array<Json>;
    expect(Array.isArray(entries)).toBe(true);
    // Builtins default engine-ENABLED; backtest-only entries are not selectable.
    const vwap = entries.find((e) => e["id"] === "VWAP_RECLAIM")!;
    expect(vwap["engineSelectable"]).toBe(true);
    expect(vwap["engineEnabled"]).toBe(true);
    expect(typeof r.body["engineGatingActive"]).toBe("boolean");
  });

  describe.each(WRITE_ENDPOINTS)("$name (owner-only writes)", (ep) => {
    it("anonymous (public OFF) → 401", async () => {
      const r = await req(ep.method, ep.path, { body: ep.body });
      expect(r.status).toBe(401);
    });

    it("subscriber → 403 OWNER_ONLY", async () => {
      const r = await req(ep.method, ep.path, { cookie: SUBSCRIBER_COOKIE, body: ep.body });
      expect(r.status).toBe(403);
      expect(r.body["code"]).toBe("OWNER_ONLY");
    });

    it("public-access mode: anonymous write → 403 PUBLIC_MODE_READ_ONLY", async () => {
      publicAccessState.enabled = true;
      const r = await req(ep.method, ep.path, { body: ep.body });
      expect(r.status).toBe(403);
      expect(r.body["code"]).toBe("PUBLIC_MODE_READ_ONLY");
    });

    it("owner → gate passes (not 401/403)", async () => {
      const r = await req(ep.method, ep.path, { cookie: OWNER_COOKIE, body: ep.body });
      expect(r.status).not.toBe(401);
      expect(r.status).not.toBe(403);
    });
  });
});

// ===========================================================================
// PUT /engine — selectable-id guard.
// ===========================================================================

describe("PUT /strategy-control/engine — NOT_ENGINE_SELECTABLE guard", () => {
  it("accepts a builtin engine id", async () => {
    const r = await req("PUT", "/strategy-control/engine", {
      cookie: OWNER_COOKIE,
      body: { items: [{ strategyId: "VWAP_RECLAIM", enabled: false }] },
    });
    expect(r.status).toBe(200);
    expect(setEngineState).toHaveBeenCalledWith("VWAP_RECLAIM", false);
  });

  it("accepts an owner-defined custom id", async () => {
    storeState.customSpecs = [
      {
        id: "CUSTOM_my_edge",
        name: "My Edge",
        category: "Custom",
        description: "",
        bull: [{ left: "close", op: "gt", right: { type: "value", value: 1 } }],
        bear: [],
        params: { stopAtrMult: 1.5, target1R: 1, target2R: 2 },
        baseConfidence: 60,
      },
    ];
    const r = await req("PUT", "/strategy-control/engine", {
      cookie: OWNER_COOKIE,
      body: { items: [{ strategyId: "CUSTOM_my_edge", enabled: true }] },
    });
    expect(r.status).toBe(200);
    expect(setEngineState).toHaveBeenCalledWith("CUSTOM_my_edge", true);
  });

  it("rejects a backtest-only research id (not engine-selectable) → 400 NOT_ENGINE_SELECTABLE", async () => {
    const r = await req("PUT", "/strategy-control/engine", {
      cookie: OWNER_COOKIE,
      body: { items: [{ strategyId: "ORB_BREAKOUT", enabled: true }] },
    });
    expect(r.status).toBe(400);
    expect(r.body["error"]).toBe("NOT_ENGINE_SELECTABLE");
    expect(r.body["detail"]).toEqual(["ORB_BREAKOUT"]);
    // Nothing was persisted — the whole batch is rejected before any write.
    expect(setEngineState).not.toHaveBeenCalled();
  });

  it("rejects an unknown / typo'd custom id → 400 NOT_ENGINE_SELECTABLE", async () => {
    const r = await req("PUT", "/strategy-control/engine", {
      cookie: OWNER_COOKIE,
      body: { items: [{ strategyId: "CUSTOM_does_not_exist", enabled: true }] },
    });
    expect(r.status).toBe(400);
    expect(r.body["error"]).toBe("NOT_ENGINE_SELECTABLE");
    expect(setEngineState).not.toHaveBeenCalled();
  });

  it("rejects the whole batch if ANY id is not selectable (all-or-nothing)", async () => {
    const r = await req("PUT", "/strategy-control/engine", {
      cookie: OWNER_COOKIE,
      body: {
        items: [
          { strategyId: "VWAP_RECLAIM", enabled: false }, // valid
          { strategyId: "ORB_BREAKOUT", enabled: true }, // invalid
        ],
      },
    });
    expect(r.status).toBe(400);
    expect(r.body["error"]).toBe("NOT_ENGINE_SELECTABLE");
    expect(setEngineState).not.toHaveBeenCalled();
  });

  it("rejects a malformed body → 400 INVALID_BODY", async () => {
    const r = await req("PUT", "/strategy-control/engine", {
      cookie: OWNER_COOKIE,
      body: { items: [] },
    });
    expect(r.status).toBe(400);
    expect(r.body["error"]).toBe("INVALID_BODY");
  });
});

// ===========================================================================
// DELETE /custom/:id — CUSTOM_-only guard + dual-row removal.
// ===========================================================================

describe("DELETE /strategy-control/custom/:id — NOT_A_CUSTOM_STRATEGY guard", () => {
  it("rejects a builtin engine id (never touches a builtin's state row) → 400", async () => {
    const r = await req("DELETE", "/strategy-control/custom/VWAP_RECLAIM", { cookie: OWNER_COOKIE });
    expect(r.status).toBe(400);
    expect(r.body["error"]).toBe("NOT_A_CUSTOM_STRATEGY");
    expect(deleteCustomSpec).not.toHaveBeenCalled();
  });

  it("rejects a backtest-only research id → 400 NOT_A_CUSTOM_STRATEGY", async () => {
    const r = await req("DELETE", "/strategy-control/custom/ORB_BREAKOUT", { cookie: OWNER_COOKIE });
    expect(r.status).toBe(400);
    expect(r.body["error"]).toBe("NOT_A_CUSTOM_STRATEGY");
    expect(deleteCustomSpec).not.toHaveBeenCalled();
  });

  it("accepts a CUSTOM_ id and removes BOTH the spec and its engine-state row", async () => {
    storeState.customSpecs = [
      {
        id: "CUSTOM_my_edge",
        name: "My Edge",
        category: "Custom",
        description: "",
        bull: [{ left: "close", op: "gt", right: { type: "value", value: 1 } }],
        bear: [],
        params: { stopAtrMult: 1.5, target1R: 1, target2R: 2 },
        baseConfidence: 60,
      },
    ];
    storeState.engineState = new Map([["CUSTOM_my_edge", true]]);

    const r = await req("DELETE", "/strategy-control/custom/CUSTOM_my_edge", { cookie: OWNER_COOKIE });
    expect(r.status).toBe(200);
    expect(r.body["ok"]).toBe(true);
    expect(deleteCustomSpec).toHaveBeenCalledWith("CUSTOM_my_edge");
    // The mock removes from BOTH the spec list AND the engine-state map, the
    // same dual removal the real store performs (so a deleted strategy can
    // never linger enabled).
    expect(storeState.customSpecs).toEqual([]);
    expect(storeState.engineState.has("CUSTOM_my_edge")).toBe(false);
  });
});

// ===========================================================================
// POST /custom — engine-disabled by default (fail-closed opt-in).
// ===========================================================================

describe("POST /strategy-control/custom — created engine-DISABLED by default", () => {
  it("persists the spec and reports it engine-selectable but engine-DISABLED until opt-in", async () => {
    const r = await req("POST", "/strategy-control/custom", {
      cookie: OWNER_COOKIE,
      body: VALID_CUSTOM_INPUT,
    });
    expect(r.status).toBe(201);
    expect(r.body["id"]).toBe("CUSTOM_my_edge");
    expect(upsertCustomSpec).toHaveBeenCalledTimes(1);

    const catalog = r.body["catalog"] as Json;
    const entries = catalog["entries"] as Array<Json>;
    const custom = entries.find((e) => e["id"] === "CUSTOM_my_edge")!;
    expect(custom["engineSelectable"]).toBe(true);
    expect(custom["engineEnabled"]).toBe(false);
  });

  it("rejects a malformed custom input → 400 INVALID_BODY", async () => {
    const r = await req("POST", "/strategy-control/custom", {
      cookie: OWNER_COOKIE,
      body: { slug: "X", name: "Y" }, // slug too short, no bull/bear
    });
    expect(r.status).toBe(400);
    expect(r.body["error"]).toBe("INVALID_BODY");
    expect(upsertCustomSpec).not.toHaveBeenCalled();
  });
});
