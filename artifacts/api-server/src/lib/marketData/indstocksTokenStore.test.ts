import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db, indstocksTokenTable, type IndstocksTokenRow } from "@workspace/db";
import {
  getIndstocksToken,
  setIndstocksToken,
  clearIndstocksToken,
  getIndstocksTokenStatus,
  _resetIndstocksTokenCacheForTests,
} from "./indstocksTokenStore";

/**
 * Live-DB round-trip for the hot-swap token store. Auto-skips when DATABASE_URL
 * is unset. Snapshots and restores the single active row so it never clobbers a
 * manually-set dev token.
 */
const hasDb = !!process.env["DATABASE_URL"];
const ACTIVE_ID = "active";

(hasDb ? describe : describe.skip)("indstocksTokenStore (live DB)", () => {
  let snapshot: IndstocksTokenRow | null = null;
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
