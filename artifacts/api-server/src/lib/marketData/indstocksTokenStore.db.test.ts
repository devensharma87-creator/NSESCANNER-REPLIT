import { checkDbTestIsolation } from "../../test-infra/dbTestGuard.js";

// ── dynamic module handles (loaded after isolation check) ──────────────────
let db: Awaited<typeof import("@workspace/db")>["db"];
let pool: Awaited<typeof import("@workspace/db")>["pool"];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let indstocksTokenTable: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let eq: any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let getIndstocksToken: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let setIndstocksToken: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let clearIndstocksToken: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let getIndstocksTokenStatus: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _resetIndstocksTokenCacheForTests: any;

let _loaded = false;
async function loadDbModules(): Promise<void> {
  if (_loaded) return;
  _loaded = true;
  checkDbTestIsolation();
  const [dbMod, ormMod, tokenMod] = await Promise.all([
    import("@workspace/db"),
    import("drizzle-orm"),
    import("./indstocksTokenStore.js"),
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const _db = dbMod as any;
  db = _db.db;
  pool = _db.pool;
  indstocksTokenTable = _db.indstocksTokenTable;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const _orm = ormMod as any;
  eq = _orm.eq;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const _tokenMod = tokenMod as any;
  getIndstocksToken = _tokenMod.getIndstocksToken;
  setIndstocksToken = _tokenMod.setIndstocksToken;
  clearIndstocksToken = _tokenMod.clearIndstocksToken;
  getIndstocksTokenStatus = _tokenMod.getIndstocksTokenStatus;
  _resetIndstocksTokenCacheForTests = _tokenMod._resetIndstocksTokenCacheForTests;
}

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

/**
 * Live-DB round-trip for the hot-swap token store. Auto-skips when DATABASE_URL
 * is unset. Snapshots and restores the single active row so it never clobbers a
 * manually-set dev token.
 */
const ACTIVE_ID = "active";

describe("indstocksTokenStore (live DB)", () => {
  beforeAll(loadDbModules);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let snapshot: any = null;
  const prevEnv = process.env["INDSTOCKS_API_TOKEN"];

  beforeAll(async () => {
    const rows = await db
      .select()
      .from(indstocksTokenTable)
      .where(eq(indstocksTokenTable.id, ACTIVE_ID))
      .limit(1);
    snapshot = rows[0] ?? null;
  });

  beforeEach(async () => {
    await clearIndstocksToken();
    _resetIndstocksTokenCacheForTests();
  });

  afterAll(async () => {
    if (snapshot) {
      await db
        .insert(indstocksTokenTable)
        .values(snapshot)
        .onConflictDoUpdate({ target: indstocksTokenTable.id, set: snapshot });
    } else {
      await clearIndstocksToken();
    }
    if (prevEnv === undefined) delete process.env["INDSTOCKS_API_TOKEN"];
    else process.env["INDSTOCKS_API_TOKEN"] = prevEnv;
    _resetIndstocksTokenCacheForTests();
  });

  it("persists and reads back a token (DB-first)", async () => {
    await setIndstocksToken("ROUND_TRIP_TOKEN", { updatedBy: "test" });
    _resetIndstocksTokenCacheForTests();
    expect(await getIndstocksToken()).toBe("ROUND_TRIP_TOKEN");

    const status = await getIndstocksTokenStatus();
    expect(status.present).toBe(true);
    expect(status.source).toBe("db");
    expect(status.updatedBy).toBe("test");
    // status NEVER leaks the value
    expect(JSON.stringify(status)).not.toContain("ROUND_TRIP_TOKEN");
  });

  it("clears the DB token and falls back to the env secret", async () => {
    await setIndstocksToken("WILL_BE_CLEARED");
    await clearIndstocksToken();
    _resetIndstocksTokenCacheForTests();

    process.env["INDSTOCKS_API_TOKEN"] = "ENV_FALLBACK";
    _resetIndstocksTokenCacheForTests();
    expect(await getIndstocksToken()).toBe("ENV_FALLBACK");
    const status = await getIndstocksTokenStatus();
    expect(status.source).toBe("env");
    expect(status.present).toBe(true);
  });

  it("reports absent when neither DB nor env has a token", async () => {
    delete process.env["INDSTOCKS_API_TOKEN"];
    _resetIndstocksTokenCacheForTests();
    expect(await getIndstocksToken()).toBeNull();
    const status = await getIndstocksTokenStatus();
    expect(status.present).toBe(false);
    expect(status.source).toBe("none");
  });

  it("rejects an empty token", async () => {
    await expect(setIndstocksToken("   ")).rejects.toThrow();
  });
});
