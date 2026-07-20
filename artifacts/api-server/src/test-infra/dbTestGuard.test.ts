/**
 * P0.1 — Pure unit tests for the DB Test Isolation Guard and Preflight Runner.
 *
 * INVARIANTS:
 *  - This file imports ONLY the guard module, the preflight runner, and Node stdlib.
 *  - No @workspace/*, drizzle-orm, pg, express, or application code.
 *  - All connection strings are dummy/non-routable. No real DB connection is made.
 *  - These tests do NOT read or write process.env; they pass plain objects.
 */

import { describe, it, expect } from "vitest";
import { checkDbTestIsolation } from "./dbTestGuard.js";
import { runPreflightCheck } from "./dbTestPreflightRunner.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** A structurally valid dummy isolated configuration that must always pass the guard. */
const VALID_ENV = {
  NODE_ENV: "test",
  TEST_DATABASE_URL: "postgresql://ignored:ignored@test-db.invalid:5432/nse_vitest_abc123",
  DATABASE_URL: "postgresql://user:pass@prod-db.internal:5432/nse_scanner",
  TEST_RUN_ID: "run-20260720-abc123",
  TEST_DB_ISOLATION_CONFIRMED: "true",
} as const;

// ── Test 1: missing NODE_ENV=test is rejected ─────────────────────────────

describe("NOT_TEST_ENV", () => {
  it("rejects when NODE_ENV is absent", () => {
    const result = checkDbTestIsolation({ ...VALID_ENV, NODE_ENV: undefined });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_TEST_ENV");
  });

  it("rejects when NODE_ENV is 'development'", () => {
    const result = checkDbTestIsolation({ ...VALID_ENV, NODE_ENV: "development" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_TEST_ENV");
  });

  it("rejects when NODE_ENV is 'production'", () => {
    const result = checkDbTestIsolation({ ...VALID_ENV, NODE_ENV: "production" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_TEST_ENV");
  });
});

// ── Test 2: missing TEST_DATABASE_URL is rejected ────────────────────────

describe("TEST_DATABASE_URL_MISSING", () => {
  it("rejects when TEST_DATABASE_URL is absent and DATABASE_URL is also absent", () => {
    const result = checkDbTestIsolation({
      ...VALID_ENV,
      TEST_DATABASE_URL: undefined,
      DATABASE_URL: undefined,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TEST_DATABASE_URL_MISSING");
  });

  it("rejects when TEST_DATABASE_URL is an empty string and no DATABASE_URL fallback", () => {
    // No DATABASE_URL present — only the empty TEST_DATABASE_URL case
    const result = checkDbTestIsolation({
      ...VALID_ENV,
      TEST_DATABASE_URL: "   ",
      DATABASE_URL: undefined,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TEST_DATABASE_URL_MISSING");
  });

  it("rejects when TEST_DATABASE_URL is not a valid postgres URL", () => {
    const result = checkDbTestIsolation({
      ...VALID_ENV,
      TEST_DATABASE_URL: "mysql://localhost/mydb",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TEST_DATABASE_URL_MISSING");
  });
});

// ── Test 3: only ordinary DATABASE_URL is rejected ───────────────────────

describe("OPERATIONAL_DATABASE_FALLBACK_FORBIDDEN", () => {
  it("rejects when TEST_DATABASE_URL is absent but DATABASE_URL is present", () => {
    const result = checkDbTestIsolation({
      ...VALID_ENV,
      TEST_DATABASE_URL: undefined,
      DATABASE_URL: "postgresql://user:pass@prod-db.internal:5432/nse_scanner",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("OPERATIONAL_DATABASE_FALLBACK_FORBIDDEN");
  });
});

// ── Test 4: identical operational/test URLs are rejected ─────────────────

describe("TEST_EQUALS_OPERATIONAL_TARGET", () => {
  it("rejects when TEST_DATABASE_URL and DATABASE_URL are textually identical", () => {
    const shared = "postgresql://user:pass@prod-db.internal:5432/nse_vitest_abc123";
    const result = checkDbTestIsolation({
      ...VALID_ENV,
      TEST_DATABASE_URL: shared,
      DATABASE_URL: shared,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TEST_EQUALS_OPERATIONAL_TARGET");
  });
});

// ── Test 5: equivalent URLs with implicit/explicit port 5432 are rejected ─

describe("TEST_EQUALS_OPERATIONAL_TARGET — port canonicalization", () => {
  it("rejects when implicit port (omitted) and explicit port 5432 resolve to the same target", () => {
    const result = checkDbTestIsolation({
      ...VALID_ENV,
      TEST_DATABASE_URL: "postgresql://user:x@prod-db.internal/nse_vitest_abc123",
      DATABASE_URL: "postgresql://user:y@prod-db.internal:5432/nse_vitest_abc123",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TEST_EQUALS_OPERATIONAL_TARGET");
  });
});

// ── Test 6: hostname case differences do not bypass comparison ─────────────

describe("TEST_EQUALS_OPERATIONAL_TARGET — hostname case", () => {
  it("rejects when hostnames differ only in case (PROD-DB.INTERNAL vs prod-db.internal)", () => {
    const result = checkDbTestIsolation({
      ...VALID_ENV,
      TEST_DATABASE_URL: "postgresql://u:p@PROD-DB.INTERNAL:5432/nse_vitest_abc123",
      DATABASE_URL: "postgresql://u:p@prod-db.internal:5432/nse_vitest_abc123",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TEST_EQUALS_OPERATIONAL_TARGET");
  });
});

// ── Test 7: missing owner confirmation is rejected ────────────────────────

describe("TEST_DB_CONFIRMATION_MISSING", () => {
  it("rejects when TEST_DB_ISOLATION_CONFIRMED is absent", () => {
    const result = checkDbTestIsolation({
      ...VALID_ENV,
      TEST_DB_ISOLATION_CONFIRMED: undefined,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TEST_DB_CONFIRMATION_MISSING");
  });

  it("rejects when TEST_DB_ISOLATION_CONFIRMED is 'false'", () => {
    const result = checkDbTestIsolation({
      ...VALID_ENV,
      TEST_DB_ISOLATION_CONFIRMED: "false",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TEST_DB_CONFIRMATION_MISSING");
  });

  it("rejects when TEST_DB_ISOLATION_CONFIRMED is '1' (not 'true')", () => {
    const result = checkDbTestIsolation({
      ...VALID_ENV,
      TEST_DB_ISOLATION_CONFIRMED: "1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TEST_DB_CONFIRMATION_MISSING");
  });
});

// ── Test 8: missing/invalid TEST_RUN_ID is rejected ──────────────────────

describe("TEST_RUN_ID_MISSING", () => {
  it("rejects when TEST_RUN_ID is absent", () => {
    const result = checkDbTestIsolation({ ...VALID_ENV, TEST_RUN_ID: undefined });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TEST_RUN_ID_MISSING");
  });

  it("rejects when TEST_RUN_ID is an empty string", () => {
    const result = checkDbTestIsolation({ ...VALID_ENV, TEST_RUN_ID: "  " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TEST_RUN_ID_MISSING");
  });
});

// ── Test 9: production/development denylist is rejected ──────────────────

describe("TEST_TARGET_NOT_ISOLATED — denylist", () => {
  it("rejects when test DB name contains operational denylist fragment 'nse_scanner'", () => {
    const result = checkDbTestIsolation({
      ...VALID_ENV,
      TEST_DATABASE_URL: "postgresql://u:p@test-db.invalid:5432/nse_scanner_test",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TEST_TARGET_NOT_ISOLATED");
  });

  it("rejects when test DB name contains the exact operational name 'nse_scanner'", () => {
    const result = checkDbTestIsolation({
      ...VALID_ENV,
      TEST_DATABASE_URL: "postgresql://u:p@test-db.invalid:5432/nse_scanner",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TEST_TARGET_NOT_ISOLATED");
  });

  it("rejects when test DB name has no isolation keyword", () => {
    const result = checkDbTestIsolation({
      ...VALID_ENV,
      TEST_DATABASE_URL: "postgresql://u:p@test-db.invalid:5432/mydb_isolated",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TEST_TARGET_NOT_ISOLATED");
  });
});

// ── Test 10: a structurally valid dummy isolated configuration is accepted ─

describe("VALID_ISOLATED_TEST_CONFIGURATION", () => {
  it("accepts a structurally valid dummy isolated configuration without connecting", () => {
    const result = checkDbTestIsolation(VALID_ENV);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.code).toBe("VALID_ISOLATED_TEST_CONFIGURATION");
      expect(result.runId).toBe("run-20260720-abc123");
    }
  });

  it("accepts when DATABASE_URL is absent (offline CI without operational DB)", () => {
    const result = checkDbTestIsolation({ ...VALID_ENV, DATABASE_URL: undefined });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.code).toBe("VALID_ISOLATED_TEST_CONFIGURATION");
  });
});

// ── Test 11: redacted fingerprint contains no password, username, or secrets ──

describe("Redacted fingerprint", () => {
  it("fingerprint contains no password, username, or query parameters", () => {
    const result = checkDbTestIsolation({
      ...VALID_ENV,
      TEST_DATABASE_URL:
        "postgresql://secret_user:hunter2@test-db.invalid:5432/nse_vitest_abc123?sslmode=require",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fingerprint).not.toContain("secret_user");
      expect(result.fingerprint).not.toContain("hunter2");
      expect(result.fingerprint).not.toContain("sslmode");
      expect(result.fingerprint).toBe("test-db.invalid:5432/nse_vitest_abc123");
    }
  });
});

// ── Test 12: preflight wrapper blocks when guard fails ───────────────────

describe("runPreflightCheck — blocks when guard fails", () => {
  it("rejects with the failure code when NODE_ENV is not test", async () => {
    const sentinelCalled: string[] = [];
    const fakespawn = () => {
      sentinelCalled.push("SPAWN_CALLED");
      return { on: () => {} };
    };

    await expect(
      runPreflightCheck({ ...VALID_ENV, NODE_ENV: "development" }, fakespawn as never),
    ).rejects.toBe("NOT_TEST_ENV");

    expect(sentinelCalled).toHaveLength(0);
  });

  it("rejects without calling spawn when TEST_DATABASE_URL is missing", async () => {
    const sentinelCalled: string[] = [];
    const fakespawn = () => {
      sentinelCalled.push("SPAWN_CALLED");
      return { on: () => {} };
    };

    await expect(
      runPreflightCheck(
        { ...VALID_ENV, TEST_DATABASE_URL: undefined },
        fakespawn as never,
      ),
    ).rejects.toBe("OPERATIONAL_DATABASE_FALLBACK_FORBIDDEN");

    expect(sentinelCalled).toHaveLength(0);
  });
});

// ── Test 13: preflight calls the injected spawn sentinel on valid config ──

describe("runPreflightCheck — calls spawn sentinel on valid configuration", () => {
  it("invokes spawnFn with vitest args when guard passes, without connecting to a DB", async () => {
    const spawned: Array<{ cmd: string; args: string[] }> = [];

    const fakespawn = (cmd: string, args: string[]) => {
      spawned.push({ cmd, args });
      const handlers: Record<string, ((code: number) => void)[]> = {};
      const child = {
        on: (event: string, cb: (code: number) => void) => {
          if (!handlers[event]) handlers[event] = [];
          handlers[event].push(cb);
          if (event === "close") {
            setImmediate(() => cb(0));
          }
          return child;
        },
      };
      return child;
    };

    const code = await runPreflightCheck(VALID_ENV, fakespawn as never);

    expect(code).toBe(0);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]!.cmd).toBe("vitest");
    expect(spawned[0]!.args).toContain("run");
  });
});

// ── Test 14: default test script does not use DATABASE_URL as fallback ───

describe("Default test-script wiring", () => {
  it("package.json 'test' script does not reference TEST_DATABASE_URL or DATABASE_URL", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const dir = dirname(fileURLToPath(import.meta.url));
    // src/test-infra/ → ../../ → artifacts/api-server/package.json
    const pkgPath = resolve(dir, "../../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      scripts: Record<string, string>;
    };

    const testScript = pkg.scripts["test"] ?? "";
    expect(testScript).not.toContain("DATABASE_URL");
    expect(testScript).not.toContain("TEST_DATABASE_URL");
  });

  it("'test:db' script requires the preflight runner (not a raw vitest call)", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const dir = dirname(fileURLToPath(import.meta.url));
    // src/test-infra/ → ../../ → artifacts/api-server/package.json
    const pkgPath = resolve(dir, "../../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      scripts: Record<string, string>;
    };

    const dbScript = pkg.scripts["test:db"] ?? "";
    expect(dbScript).toContain("dbTestPreflightRunner");
    expect(dbScript).not.toMatch(/^vitest\s/);
  });
});
