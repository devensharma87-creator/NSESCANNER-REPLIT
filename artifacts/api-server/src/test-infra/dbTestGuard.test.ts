/**
 * P0.1 — Pure unit tests for the DB Test Isolation Guard, Preflight Runner,
 *         and Child Environment Builder.
 *
 * INVARIANTS:
 *  - Imports ONLY: Vitest, Node standard-library, and the test-infrastructure
 *    modules under review (dbTestGuard.ts, dbTestPreflightRunner.ts).
 *  - No @workspace/*, drizzle-orm, pg, express, or application code.
 *  - All connection strings are dummy/non-routable (.invalid TLD, RFC 6761).
 *    No real DB connection is made at any point.
 *  - process.env is never read or mutated; all tests pass plain objects.
 *  - Fake spawn is the only spawn used; no real Vitest process is started.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { checkDbTestIsolation } from "./dbTestGuard.js";
import {
  runPreflightCheck,
  buildIsolatedChildEnv,
  PRODUCTION_SECRETS,
  EXECUTION_SWITCH_OVERRIDES,
} from "./dbTestPreflightRunner.js";

// ── Canonical valid dummy configuration ──────────────────────────────────────
//
// TEST_RUN_ID "run-abc123":  9 chars, [A-Za-z0-9_-]{8,64} — valid format.
// DB name "nse_vitest_run-abc123": contains isolation keyword "vitest"
//   AND the normalized run ID "run-abc123" — satisfies both checks.
// TEST_DATABASE_URL host ".invalid" — non-routable per RFC 6761.

const VALID_ENV = {
  NODE_ENV: "test",
  TEST_DATABASE_URL:
    "postgresql://ignored:ignored@test-db.invalid:5432/nse_vitest_run-abc123",
  DATABASE_URL:
    "postgresql://user:pass@prod-db.internal:5432/nse_scanner",
  TEST_RUN_ID: "run-abc123",
  TEST_DB_ISOLATION_CONFIRMED: "true",
  TEST_EXTERNAL_SERVICES_MOCKED: "true",
} as const;

// ── Dummy parent env for buildIsolatedChildEnv tests ────────────────────────
//
// All secret values are clearly labelled as dummy/non-functional.

const DUMMY_PARENT_ENV: Readonly<Record<string, string | undefined>> = {
  ...VALID_ENV,
  // Production secrets — must be stripped from child env
  APP_ACCESS_PASSWORD:            "dummy-app-password-not-real",
  GLOBAL_APP_ACCESS_PASSWORD:     "dummy-global-password-not-real",
  SESSION_SECRET:                  "dummy-session-secret-not-real",
  TRADINGVIEW_WEBHOOK_SECRET:      "dummy-tv-secret-not-real",
  KITE_API_KEY:                    "dummy-kite-key-not-real",
  KITE_API_SECRET:                 "dummy-kite-secret-not-real",
  TELEGRAM_BOT_TOKEN:              "dummy-tg-bot-token-not-real",
  TELEGRAM_CHAT_ID:                "dummy-tg-chat-id-not-real",
  PREPOST_TELEGRAM_BOT_TOKEN:      "dummy-prepost-bot-not-real",
  PREPOST_TELEGRAM_CHAT_ID:        "dummy-prepost-chat-not-real",
  INDSTOCKS_API_TOKEN:             "dummy-indstocks-token-not-real",
  PARITY_TEST_TELEGRAM_BOT_TOKEN:  "dummy-parity-tg-bot-not-real",
  PARITY_TEST_TELEGRAM_CHAT_ID:    "dummy-parity-tg-chat-not-real",
  // Execution switches — must be overridden to disabled
  PAPER_TRADING_ENABLED: "true",
  REPLIT_DEPLOYMENT:     "1",
  INDSTOCKS_ENABLED:     "1",
  // Ordinary runtime vars — should survive into child env
  PATH: "/usr/bin:/bin",
  HOME: "/home/runner",
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests 1–3: NOT_TEST_ENV
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Tests 4–6: TEST_DATABASE_URL_MISSING
// ─────────────────────────────────────────────────────────────────────────────

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

  it("rejects when TEST_DATABASE_URL is whitespace and no DATABASE_URL fallback", () => {
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

// ─────────────────────────────────────────────────────────────────────────────
// Test 7: OPERATIONAL_DATABASE_FALLBACK_FORBIDDEN
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Test 8: TEST_EQUALS_OPERATIONAL_TARGET
// ─────────────────────────────────────────────────────────────────────────────

describe("TEST_EQUALS_OPERATIONAL_TARGET", () => {
  it("rejects when TEST_DATABASE_URL and DATABASE_URL are textually identical", () => {
    const shared =
      "postgresql://user:pass@prod-db.internal:5432/nse_vitest_run-abc123";
    const result = checkDbTestIsolation({
      ...VALID_ENV,
      TEST_DATABASE_URL: shared,
      DATABASE_URL: shared,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TEST_EQUALS_OPERATIONAL_TARGET");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 9: TEST_EQUALS_OPERATIONAL_TARGET — port canonicalization
// ─────────────────────────────────────────────────────────────────────────────

describe("TEST_EQUALS_OPERATIONAL_TARGET — port canonicalization", () => {
  it("rejects when implicit port (omitted) and explicit port 5432 resolve to the same target", () => {
    const result = checkDbTestIsolation({
      ...VALID_ENV,
      TEST_DATABASE_URL:
        "postgresql://user:x@prod-db.internal/nse_vitest_run-abc123",
      DATABASE_URL:
        "postgresql://user:y@prod-db.internal:5432/nse_vitest_run-abc123",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TEST_EQUALS_OPERATIONAL_TARGET");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 10: TEST_EQUALS_OPERATIONAL_TARGET — hostname case
// ─────────────────────────────────────────────────────────────────────────────

describe("TEST_EQUALS_OPERATIONAL_TARGET — hostname case", () => {
  it("rejects when hostnames differ only in case (PROD-DB.INTERNAL vs prod-db.internal)", () => {
    const result = checkDbTestIsolation({
      ...VALID_ENV,
      TEST_DATABASE_URL:
        "postgresql://u:p@PROD-DB.INTERNAL:5432/nse_vitest_run-abc123",
      DATABASE_URL:
        "postgresql://u:p@prod-db.internal:5432/nse_vitest_run-abc123",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TEST_EQUALS_OPERATIONAL_TARGET");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests 11–13: TEST_DB_CONFIRMATION_MISSING
// ─────────────────────────────────────────────────────────────────────────────

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

  it("rejects when TEST_DB_ISOLATION_CONFIRMED is '1' (not exact 'true')", () => {
    const result = checkDbTestIsolation({
      ...VALID_ENV,
      TEST_DB_ISOLATION_CONFIRMED: "1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TEST_DB_CONFIRMATION_MISSING");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests 14–15: TEST_RUN_ID_MISSING
// ─────────────────────────────────────────────────────────────────────────────

describe("TEST_RUN_ID_MISSING", () => {
  it("rejects when TEST_RUN_ID is absent", () => {
    const result = checkDbTestIsolation({ ...VALID_ENV, TEST_RUN_ID: undefined });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TEST_RUN_ID_MISSING");
  });

  it("rejects when TEST_RUN_ID is whitespace only", () => {
    const result = checkDbTestIsolation({ ...VALID_ENV, TEST_RUN_ID: "  " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TEST_RUN_ID_MISSING");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests 16–18: TEST_TARGET_NOT_ISOLATED — denylist and keyword
// ─────────────────────────────────────────────────────────────────────────────

describe("TEST_TARGET_NOT_ISOLATED — denylist", () => {
  it("rejects when test DB name contains operational denylist fragment 'nse_scanner'", () => {
    const result = checkDbTestIsolation({
      ...VALID_ENV,
      TEST_DATABASE_URL:
        "postgresql://u:p@test-db.invalid:5432/nse_scanner_test_run-abc123",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TEST_TARGET_NOT_ISOLATED");
  });

  it("rejects when test DB name is exactly the operational name 'nse_scanner'", () => {
    const result = checkDbTestIsolation({
      ...VALID_ENV,
      TEST_DATABASE_URL:
        "postgresql://u:p@test-db.invalid:5432/nse_scanner",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TEST_TARGET_NOT_ISOLATED");
  });

  it("rejects when test DB name has no isolation keyword", () => {
    const result = checkDbTestIsolation({
      ...VALID_ENV,
      TEST_DATABASE_URL:
        "postgresql://u:p@test-db.invalid:5432/mydb_run-abc123",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TEST_TARGET_NOT_ISOLATED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests 19–20: VALID_ISOLATED_TEST_CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

describe("VALID_ISOLATED_TEST_CONFIGURATION", () => {
  it("accepts a structurally valid dummy isolated configuration without connecting", () => {
    const result = checkDbTestIsolation(VALID_ENV);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.code).toBe("VALID_ISOLATED_TEST_CONFIGURATION");
      expect(result.runId).toBe("run-abc123");
    }
  });

  it("accepts when DATABASE_URL is absent (offline CI without operational DB)", () => {
    const result = checkDbTestIsolation({ ...VALID_ENV, DATABASE_URL: undefined });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.code).toBe("VALID_ISOLATED_TEST_CONFIGURATION");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 21: Redacted fingerprint
// ─────────────────────────────────────────────────────────────────────────────

describe("Redacted fingerprint", () => {
  it("fingerprint contains no password, username, or query parameters", () => {
    const result = checkDbTestIsolation({
      ...VALID_ENV,
      TEST_DATABASE_URL:
        "postgresql://secret_user:hunter2@test-db.invalid:5432/nse_vitest_run-abc123?sslmode=require",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fingerprint).not.toContain("secret_user");
      expect(result.fingerprint).not.toContain("hunter2");
      expect(result.fingerprint).not.toContain("sslmode");
      expect(result.fingerprint).toBe(
        "test-db.invalid:5432/nse_vitest_run-abc123",
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests 22–23: runPreflightCheck — blocks when guard fails
// ─────────────────────────────────────────────────────────────────────────────

describe("runPreflightCheck — blocks when guard fails", () => {
  it("rejects with the failure code when NODE_ENV is not test; spawn is never called", async () => {
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

// ─────────────────────────────────────────────────────────────────────────────
// Test 24: runPreflightCheck — calls spawn sentinel on valid configuration
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Tests 25–26: TEST_EXTERNAL_SERVICES_NOT_MOCKED (NEW)
// ─────────────────────────────────────────────────────────────────────────────

describe("TEST_EXTERNAL_SERVICES_NOT_MOCKED", () => {
  it("rejects when TEST_EXTERNAL_SERVICES_MOCKED is absent", () => {
    const result = checkDbTestIsolation({
      ...VALID_ENV,
      TEST_EXTERNAL_SERVICES_MOCKED: undefined,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TEST_EXTERNAL_SERVICES_NOT_MOCKED");
  });

  it("rejects when TEST_EXTERNAL_SERVICES_MOCKED is '0' (not exact 'true')", () => {
    const result = checkDbTestIsolation({
      ...VALID_ENV,
      TEST_EXTERNAL_SERVICES_MOCKED: "0",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TEST_EXTERNAL_SERVICES_NOT_MOCKED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests 27–29: TEST_RUN_ID_FORMAT_INVALID (NEW)
// ─────────────────────────────────────────────────────────────────────────────

describe("TEST_RUN_ID_FORMAT_INVALID", () => {
  it("rejects when TEST_RUN_ID is fewer than 8 characters", () => {
    // "run-ab" = 6 chars — too short
    const result = checkDbTestIsolation({
      ...VALID_ENV,
      TEST_RUN_ID: "run-ab",
      TEST_DATABASE_URL:
        "postgresql://u:p@test-db.invalid:5432/nse_vitest_run-ab",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TEST_RUN_ID_FORMAT_INVALID");
  });

  it("rejects when TEST_RUN_ID contains an invalid character (space)", () => {
    const result = checkDbTestIsolation({
      ...VALID_ENV,
      TEST_RUN_ID: "run abc123",
      TEST_DATABASE_URL:
        "postgresql://u:p@test-db.invalid:5432/nse_vitest_run-abc123",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TEST_RUN_ID_FORMAT_INVALID");
  });

  it("rejects when TEST_RUN_ID is more than 64 characters", () => {
    const longId = "a".repeat(65);
    const result = checkDbTestIsolation({
      ...VALID_ENV,
      TEST_RUN_ID: longId,
      TEST_DATABASE_URL:
        `postgresql://u:p@test-db.invalid:5432/nse_vitest_${longId}`,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TEST_RUN_ID_FORMAT_INVALID");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 30: TEST_RUN_ID_TARGET_MISMATCH (NEW)
// ─────────────────────────────────────────────────────────────────────────────

describe("TEST_RUN_ID_TARGET_MISMATCH", () => {
  it("rejects when database name does not contain the normalized run ID", () => {
    // DB name "nse_vitest_other-run" does not contain "run-abc123"
    const result = checkDbTestIsolation({
      ...VALID_ENV,
      TEST_DATABASE_URL:
        "postgresql://u:p@test-db.invalid:5432/nse_vitest_other-run",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TEST_RUN_ID_TARGET_MISMATCH");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests 31–32: buildIsolatedChildEnv — database URL isolation (NEW)
// ─────────────────────────────────────────────────────────────────────────────

describe("buildIsolatedChildEnv — database URL isolation", () => {
  it("child DATABASE_URL equals the TEST_DATABASE_URL, not the operational URL", () => {
    const child = buildIsolatedChildEnv(DUMMY_PARENT_ENV);
    expect(child["DATABASE_URL"]).toBe(
      "postgresql://ignored:ignored@test-db.invalid:5432/nse_vitest_run-abc123",
    );
    expect(child["DATABASE_URL"]).not.toContain("nse_scanner");
    expect(child["DATABASE_URL"]).not.toContain("prod-db.internal");
  });

  it("the operational DATABASE_URL value does not appear in any child env entry", () => {
    const child = buildIsolatedChildEnv(DUMMY_PARENT_ENV);
    const opDbFragment = "nse_scanner";
    for (const [key, val] of Object.entries(child)) {
      expect(
        val.includes(opDbFragment),
        `child env key '${key}' must not contain operational DB fragment`,
      ).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests 33–35: buildIsolatedChildEnv — secrets stripped (NEW)
// ─────────────────────────────────────────────────────────────────────────────

describe("buildIsolatedChildEnv — production secrets stripped", () => {
  it("all PRODUCTION_SECRETS keys are absent from the child environment", () => {
    const child = buildIsolatedChildEnv(DUMMY_PARENT_ENV);
    for (const secretKey of PRODUCTION_SECRETS) {
      expect(
        secretKey in child,
        `PRODUCTION_SECRETS key '${secretKey}' must not appear in child env`,
      ).toBe(false);
    }
  });

  it("Kite broker API credentials are absent from child env values", () => {
    const child = buildIsolatedChildEnv(DUMMY_PARENT_ENV);
    const childValues = Object.values(child);
    expect(childValues.every((v) => !v.includes("dummy-kite"))).toBe(true);
  });

  it("Telegram credentials and parity harness tokens are absent from child env values", () => {
    const child = buildIsolatedChildEnv(DUMMY_PARENT_ENV);
    const childValues = Object.values(child);
    expect(childValues.every((v) => !v.includes("dummy-tg"))).toBe(true);
    expect(childValues.every((v) => !v.includes("dummy-prepost"))).toBe(true);
    expect(childValues.every((v) => !v.includes("dummy-parity"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests 36–38: buildIsolatedChildEnv — execution switches forced disabled (NEW)
// ─────────────────────────────────────────────────────────────────────────────

describe("buildIsolatedChildEnv — execution switches forced disabled", () => {
  it("PAPER_TRADING_ENABLED is forced to 'false' regardless of parent value", () => {
    // Parent has PAPER_TRADING_ENABLED=true (from DUMMY_PARENT_ENV)
    const child = buildIsolatedChildEnv(DUMMY_PARENT_ENV);
    expect(child["PAPER_TRADING_ENABLED"]).toBe(
      EXECUTION_SWITCH_OVERRIDES["PAPER_TRADING_ENABLED"],
    );
  });

  it("REPLIT_DEPLOYMENT is forced to '0' regardless of parent value", () => {
    // Parent has REPLIT_DEPLOYMENT=1
    const child = buildIsolatedChildEnv(DUMMY_PARENT_ENV);
    expect(child["REPLIT_DEPLOYMENT"]).toBe(
      EXECUTION_SWITCH_OVERRIDES["REPLIT_DEPLOYMENT"],
    );
  });

  it("INDSTOCKS_ENABLED is forced to '0' regardless of parent value", () => {
    // Parent has INDSTOCKS_ENABLED=1
    const child = buildIsolatedChildEnv(DUMMY_PARENT_ENV);
    expect(child["INDSTOCKS_ENABLED"]).toBe(
      EXECUTION_SWITCH_OVERRIDES["INDSTOCKS_ENABLED"],
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 39: runPreflightCheck — isolated child environment passed to spawn (NEW)
// ─────────────────────────────────────────────────────────────────────────────

describe("runPreflightCheck — spawn receives isolated child environment", () => {
  it("spawned vitest receives DATABASE_URL=TEST_DATABASE_URL and not the operational URL", async () => {
    const captured: Array<{
      cmd: string;
      args: string[];
      env: Record<string, string>;
    }> = [];

    const fakespawn = (
      cmd: string,
      args: string[],
      opts: { env?: Record<string, string> },
    ) => {
      captured.push({ cmd, args, env: opts.env ?? {} });
      const handlers: Record<string, ((code: number) => void)[]> = {};
      const child = {
        on: (event: string, cb: (code: number) => void) => {
          if (!handlers[event]) handlers[event] = [];
          handlers[event].push(cb);
          if (event === "close") setImmediate(() => cb(0));
          return child;
        },
      };
      return child;
    };

    await runPreflightCheck(DUMMY_PARENT_ENV, fakespawn as never);

    expect(captured).toHaveLength(1);
    const childEnv = captured[0]!.env;

    // DATABASE_URL in child must be the test URL
    expect(childEnv["DATABASE_URL"]).toBe(
      "postgresql://ignored:ignored@test-db.invalid:5432/nse_vitest_run-abc123",
    );
    // The operational value must not appear anywhere
    const opFragment = "nse_scanner";
    for (const [k, v] of Object.entries(childEnv)) {
      expect(
        v.includes(opFragment),
        `child env key '${k}' passed to spawn must not contain operational DB fragment`,
      ).toBe(false);
    }
    // PAPER_TRADING_ENABLED must be disabled
    expect(childEnv["PAPER_TRADING_ENABLED"]).toBe("false");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests 40–45: Package-script mandatory preflight enforcement (NEW)
// ─────────────────────────────────────────────────────────────────────────────

describe("Package-script mandatory preflight enforcement", () => {
  let pkg: { scripts: Record<string, string> };

  beforeAll(async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const dir = dirname(fileURLToPath(import.meta.url));
    const pkgPath = resolve(dir, "../../package.json");
    pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      scripts: Record<string, string>;
    };
  });

  it("'test' script routes through dbTestPreflightRunner", () => {
    const s = pkg.scripts["test"] ?? "";
    expect(s).toContain("dbTestPreflightRunner");
  });

  it("'test' script is not a raw vitest invocation", () => {
    const s = pkg.scripts["test"] ?? "";
    expect(s).not.toMatch(/^vitest\b/);
    expect(s).not.toMatch(/\bnode.*vitest\b/);
  });

  it("'test:db' script routes through dbTestPreflightRunner", () => {
    const s = pkg.scripts["test:db"] ?? "";
    expect(s).toContain("dbTestPreflightRunner");
  });

  it("'test:db' script is not a raw vitest invocation", () => {
    const s = pkg.scripts["test:db"] ?? "";
    expect(s).not.toMatch(/^vitest\b/);
  });

  it("'test:unit' uses the strict vitest.config.unit.ts configuration", () => {
    const s = pkg.scripts["test:unit"] ?? "";
    expect(s).toContain("vitest.config.unit.ts");
  });

  it("no package script other than 'test:unit' launches an unguarded vitest run", () => {
    // Only test:unit may call vitest directly (it uses the strict allowlist config).
    // All other scripts that run tests must go through the preflight runner.
    for (const [name, cmd] of Object.entries(pkg.scripts)) {
      if (name === "test:unit") continue;
      const isRawVitest = /\bvitest\s+run\b/.test(cmd);
      expect(
        isRawVitest,
        `script '${name}' = '${cmd}' must not be a raw vitest run bypass`,
      ).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests 46–47: Positive unit allowlist — strict one-file include (NEW)
// ─────────────────────────────────────────────────────────────────────────────

describe("Positive unit allowlist — strict one-file include", () => {
  it("vitest.config.unit.ts include contains only the guard test file, no wildcard", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const dir = dirname(fileURLToPath(import.meta.url));
    const configPath = resolve(dir, "../../vitest.config.unit.ts");
    const contents = readFileSync(configPath, "utf8");
    expect(contents).toContain('"src/test-infra/dbTestGuard.test.ts"');
    expect(contents).not.toContain('"src/**/*.test.ts"');
    expect(contents).not.toContain('"src/**/*.test.tsx"');
  });

  it("vitest.config.unit.ts does not contain a broad exclusion list", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const dir = dirname(fileURLToPath(import.meta.url));
    const configPath = resolve(dir, "../../vitest.config.unit.ts");
    const contents = readFileSync(configPath, "utf8");
    expect(contents).not.toContain('"src/lib/bootScheduler.test.ts"');
    expect(contents).not.toContain('"src/routes/**"');
  });
});
