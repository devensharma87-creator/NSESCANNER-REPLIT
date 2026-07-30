/**
 * P0.1 — Pure unit tests for the DB Test Isolation Guard, Preflight Runner,
 *         and Child Environment Builder.
 *
 * Stages covered: 1-9 (guard logic, env isolation, executable resolution,
 *   cleanup safety, runtime lock, terminology).
 *
 * INVARIANTS:
 *  - Imports ONLY: Vitest, Node standard-library, and the test-infrastructure
 *    modules under review (dbTestGuard.ts, dbTestPreflightRunner.ts).
 *  - No @workspace/*, drizzle-orm, pg, express, or application code.
 *  - All connection strings are dummy/non-routable (.invalid TLD, RFC 6761).
 *    No real DB connection is made at any point.
 *  - process.env is never read or mutated; all tests pass plain objects.
 *  - Fake spawn is the only spawn used; no real Vitest process is started.
 *  - Temporary filesystem activity (cleanup tests) uses uniquely generated
 *    directories beneath os.tmpdir() and is cleaned in each test's finally block.
 */

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { checkDbTestIsolation } from "./dbTestGuard.js";
import {
  runPreflightCheck,
  buildIsolatedChildEnv,
  PRODUCTION_SECRETS,
  EXECUTION_SWITCH_OVERRIDES,
  CHILD_PROCESS_ENV_ALLOWLIST,
  RUN_CONTEXT_DIR_PREFIX,
  resolveVitestExecutable,
  safeCleanupRunRoot,
  type IsolatedPaths,
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
  TEST_EXTERNAL_SERVICES_CONFIGURED_DISABLED: "true",
} as const;

// ── Dummy isolated paths for buildIsolatedChildEnv tests ─────────────────────
//
// These are static non-existent paths under a plausible run root. They share
// a common parent (the run root) to enable the "all beneath one run root" test.
// They do NOT need to exist on disk for pure env-builder tests.

const DUMMY_ISOLATED_PATHS: IsolatedPaths = {
  home:          "/tmp/nsescanner-vitest-dummy-test/home",
  tmp:           "/tmp/nsescanner-vitest-dummy-test/tmp",
  xdgConfigHome: "/tmp/nsescanner-vitest-dummy-test/xdg-config",
  xdgCacheHome:  "/tmp/nsescanner-vitest-dummy-test/xdg-cache",
  xdgDataHome:   "/tmp/nsescanner-vitest-dummy-test/xdg-data",
  xdgRuntimeDir: "/tmp/nsescanner-vitest-dummy-test/xdg-runtime",
};

// ── Pre-validated values matching VALID_ENV ───────────────────────────────────

const DUMMY_VALIDATED = {
  testDatabaseUrl:
    "postgresql://ignored:ignored@test-db.invalid:5432/nse_vitest_run-abc123",
  testRunId: "run-abc123",
};

// ── Dummy parent env for buildIsolatedChildEnv tests ────────────────────────
//
// All secret values are clearly labelled as dummy/non-functional.

const DUMMY_PARENT_ENV: Readonly<Record<string, string | undefined>> = {
  ...VALID_ENV,
  // Production secrets — must be absent from child env (by allowlist policy)
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
  // Previously-leaked keys (now caught by allowlist) — must be absent from child env
  KITE_TOKEN_ENC_KEY:              "dummy-kite-enc-key-not-real",
  KITE_TOKEN_ENC_KEY_OLD:          "dummy-kite-enc-old-not-real",
  KITE_TOKEN_ENC_KEY_NEW:          "dummy-kite-enc-new-not-real",
  KITE_MIRROR_URL:                 "https://dummy-kite-mirror.invalid",
  KITE_MIRROR_ALLOWED_HOSTS:       "dummy-allowed-hosts.invalid",
  METRICS_TOKEN:                   "dummy-metrics-token-not-real",
  RESEND_API_KEY:                  "dummy-resend-key-not-real",
  SENDGRID_API_KEY:                "dummy-sendgrid-key-not-real",
  DEAD_SYMBOL_WEBHOOK_URL:         "https://dummy-webhook.invalid/hook",
  ENV_FILE_PATH:                   "/dummy/.env.not-real",
  // Preload / Node internals — must be dropped
  NODE_OPTIONS:                    "--require dummy-hook-not-real.js",
  NODE_PATH:                       "/dummy/node/path",
  // Injection variables — must be dropped
  LD_PRELOAD:                      "/dummy/lib-not-real.so",
  DYLD_INSERT_LIBRARIES:           "/dummy/lib-not-real.dylib",
  // Proxy variables — must be dropped (uppercase)
  HTTP_PROXY:                      "http://proxy.invalid:3128",
  HTTPS_PROXY:                     "https://proxy.invalid:3128",
  ALL_PROXY:                       "socks5://proxy.invalid:1080",
  NO_PROXY:                        "localhost,127.0.0.1",
  GRPC_PROXY:                      "http://proxy.invalid:3128",
  // Proxy variables — must be dropped (lowercase)
  http_proxy:                      "http://proxy.invalid:3128",
  https_proxy:                     "https://proxy.invalid:3128",
  // Package-manager proxy variables — must be dropped
  NPM_CONFIG_PROXY:                "http://proxy.invalid:3128",
  NPM_CONFIG_HTTPS_PROXY:          "https://proxy.invalid:3128",
  // Completely unknown future key — must be dropped without changing any list
  FUTURE_PROVIDER_API_KEY:         "dummy-future-secret-not-real",
  RANDOM_UNKNOWN_KEY_XYZ_789:      "dummy-unknown-value-not-real",
  // Execution switches — must be overridden to disabled regardless of parent value
  PAPER_TRADING_ENABLED:           "true",
  REPLIT_DEPLOYMENT:               "1",
  INDSTOCKS_ENABLED:               "1",
  CANDLE_WAREHOUSE_ENABLED:        "true",
  OPTION_SNAPSHOT_ENABLED:         "true",
  REASONING_WRITER_V2_ENABLED:     "1",
  LIVE_CASH_SWING_ORDER_ENABLED:   "true",
  // PATH and HOME: NOT on the new CHILD_PROCESS_ENV_ALLOWLIST — they will be
  // dropped by the explicit allowlist policy and replaced with isolated paths.
  // Kept here to enable tests that explicitly verify they are absent from child env.
  PATH: "/usr/bin:/bin",
  HOME: "/home/runner",
};

// ── Convenience builder ───────────────────────────────────────────────────────
//
// bb() wraps buildIsolatedChildEnv with the canonical dummy validated values and
// isolated paths, accepting optional extra parent env overrides (merged on top
// of DUMMY_PARENT_ENV). Use throughout to reduce call-site verbosity.

const bb = (extraParent?: Record<string, string | undefined>): Record<string, string> =>
  buildIsolatedChildEnv(
    DUMMY_VALIDATED,
    DUMMY_ISOLATED_PATHS,
    extraParent !== undefined
      ? { ...DUMMY_PARENT_ENV, ...extraParent }
      : DUMMY_PARENT_ENV,
  );

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
// Test 24: runPreflightCheck — DB_TEST_RUNTIME_NOT_AUTHORIZED on valid config
// (Stage 7: hard runtime block — replaces old "calls spawn sentinel" test)
// ─────────────────────────────────────────────────────────────────────────────

describe("runPreflightCheck — DB_TEST_RUNTIME_NOT_AUTHORIZED on valid configuration", () => {
  it("rejects with DB_TEST_RUNTIME_NOT_AUTHORIZED even when all guard checks pass; spawn not called", async () => {
    const sentinelCalled: string[] = [];
    const fakeSpawn = () => {
      sentinelCalled.push("SPAWN_CALLED");
      return { on: () => ({}) };
    };

    await expect(
      runPreflightCheck(VALID_ENV, fakeSpawn as never),
    ).rejects.toBe("DB_TEST_RUNTIME_NOT_AUTHORIZED");

    // The hard block must prevent any spawn attempt.
    expect(sentinelCalled).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests 25–26: TEST_EXTERNAL_SERVICES_NOT_CONFIGURED_DISABLED
// (Stage 6: terminology update — was TEST_EXTERNAL_SERVICES_NOT_MOCKED)
// ─────────────────────────────────────────────────────────────────────────────

describe("TEST_EXTERNAL_SERVICES_NOT_CONFIGURED_DISABLED", () => {
  it("rejects when TEST_EXTERNAL_SERVICES_CONFIGURED_DISABLED is absent", () => {
    const result = checkDbTestIsolation({
      ...VALID_ENV,
      TEST_EXTERNAL_SERVICES_CONFIGURED_DISABLED: undefined,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TEST_EXTERNAL_SERVICES_NOT_CONFIGURED_DISABLED");
  });

  it("rejects when TEST_EXTERNAL_SERVICES_CONFIGURED_DISABLED is '0' (not exact 'true')", () => {
    const result = checkDbTestIsolation({
      ...VALID_ENV,
      TEST_EXTERNAL_SERVICES_CONFIGURED_DISABLED: "0",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TEST_EXTERNAL_SERVICES_NOT_CONFIGURED_DISABLED");
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
    const child = bb();
    expect(child["DATABASE_URL"]).toBe(
      "postgresql://ignored:ignored@test-db.invalid:5432/nse_vitest_run-abc123",
    );
    expect(child["DATABASE_URL"]).not.toContain("nse_scanner");
    expect(child["DATABASE_URL"]).not.toContain("prod-db.internal");
  });

  it("the operational DATABASE_URL value does not appear in any child env entry", () => {
    const child = bb();
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
    const child = bb();
    for (const secretKey of PRODUCTION_SECRETS) {
      expect(
        secretKey in child,
        `PRODUCTION_SECRETS key '${secretKey}' must not appear in child env`,
      ).toBe(false);
    }
  });

  it("Kite broker API credentials are absent from child env values", () => {
    const child = bb();
    const childValues = Object.values(child);
    expect(childValues.every((v) => !v.includes("dummy-kite"))).toBe(true);
  });

  it("Telegram credentials and parity harness tokens are absent from child env values", () => {
    const child = bb();
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
    const child = bb();
    expect(child["PAPER_TRADING_ENABLED"]).toBe(
      EXECUTION_SWITCH_OVERRIDES["PAPER_TRADING_ENABLED"],
    );
  });

  it("REPLIT_DEPLOYMENT is forced to '0' regardless of parent value", () => {
    // Parent has REPLIT_DEPLOYMENT=1
    const child = bb();
    expect(child["REPLIT_DEPLOYMENT"]).toBe(
      EXECUTION_SWITCH_OVERRIDES["REPLIT_DEPLOYMENT"],
    );
  });

  it("INDSTOCKS_ENABLED is forced to '0' regardless of parent value", () => {
    // Parent has INDSTOCKS_ENABLED=1
    const child = bb();
    expect(child["INDSTOCKS_ENABLED"]).toBe(
      EXECUTION_SWITCH_OVERRIDES["INDSTOCKS_ENABLED"],
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 39: runPreflightCheck — hard block: spawn sentinel is never called
// (Stage 7: replaces old "spawn receives isolated child environment" test)
// ─────────────────────────────────────────────────────────────────────────────

describe("runPreflightCheck — hard block: spawn sentinel is never called", () => {
  it("spawn sentinel remains untouched even when all isolation checks pass", async () => {
    const sentinelCalled: string[] = [];
    const fakeSpawn = () => {
      sentinelCalled.push("SPAWN_CALLED");
      return { on: () => ({}) };
    };

    // Even with a fully valid environment, the hard block must fire.
    await expect(
      runPreflightCheck(DUMMY_PARENT_ENV, fakeSpawn as never),
    ).rejects.toBe("DB_TEST_RUNTIME_NOT_AUTHORIZED");

    // Spawn sentinel must remain untouched.
    expect(sentinelCalled).toHaveLength(0);
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

// ─────────────────────────────────────────────────────────────────────────────
// Tests 48–50: EXPLICIT_ALLOWLIST policy — only approved keys survive
// ─────────────────────────────────────────────────────────────────────────────

// The complete set of keys that may lawfully appear in the child env:
// allowlisted runtime keys (LANG/LC_ALL/LC_CTYPE, if present in parent)
// + explicitly set isolated-path keys
// + deterministic runtime keys
// + internally generated test-only keys.

const GENERATED_TEST_KEYS = new Set([
  "NODE_ENV",
  "DATABASE_URL",
  "TEST_DATABASE_URL",
  "TEST_RUN_ID",
  "TEST_DB_ISOLATION_CONFIRMED",
  "TEST_EXTERNAL_SERVICES_CONFIGURED_DISABLED",
  // Isolated filesystem paths — set explicitly from isolatedPaths, not from parent
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "XDG_RUNTIME_DIR",
  // Deterministic runtime values — always set explicitly
  "TZ",
  "CI",
  "TERM",
  "NO_COLOR",
  ...Object.keys(EXECUTION_SWITCH_OVERRIDES),
]);

const PERMITTED_CHILD_KEYS = new Set([
  ...CHILD_PROCESS_ENV_ALLOWLIST,
  ...GENERATED_TEST_KEYS,
]);

describe("buildIsolatedChildEnv — explicit allowlist policy", () => {
  it("every child key is either on the allowlist or is a generated test-only key", () => {
    const child = bb();
    for (const key of Object.keys(child)) {
      expect(
        PERMITTED_CHILD_KEYS.has(key),
        `child env key '${key}' is not in CHILD_PROCESS_ENV_ALLOWLIST nor a generated test key`,
      ).toBe(true);
    }
  });

  it("a random unknown parent key is dropped", () => {
    const child = bb();
    expect("RANDOM_UNKNOWN_KEY_XYZ_789" in child).toBe(false);
  });

  it("FUTURE_PROVIDER_API_KEY is dropped without modifying any denylist", () => {
    const child = bb();
    expect("FUTURE_PROVIDER_API_KEY" in child).toBe(false);
    // Verify by policy: the key is not on the allowlist
    expect(CHILD_PROCESS_ENV_ALLOWLIST).not.toContain("FUTURE_PROVIDER_API_KEY");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests 51–60: Previously-leaked keys are now dropped by allowlist policy
// ─────────────────────────────────────────────────────────────────────────────

describe("buildIsolatedChildEnv — previously-leaked keys dropped by allowlist", () => {
  it("KITE_TOKEN_ENC_KEY is absent from child env", () => {
    expect("KITE_TOKEN_ENC_KEY" in bb()).toBe(false);
  });

  it("KITE_TOKEN_ENC_KEY_OLD is absent from child env", () => {
    expect("KITE_TOKEN_ENC_KEY_OLD" in bb()).toBe(false);
  });

  it("KITE_TOKEN_ENC_KEY_NEW is absent from child env", () => {
    expect("KITE_TOKEN_ENC_KEY_NEW" in bb()).toBe(false);
  });

  it("KITE_MIRROR_URL is absent from child env", () => {
    expect("KITE_MIRROR_URL" in bb()).toBe(false);
  });

  it("KITE_MIRROR_ALLOWED_HOSTS is absent from child env", () => {
    expect("KITE_MIRROR_ALLOWED_HOSTS" in bb()).toBe(false);
  });

  it("METRICS_TOKEN is absent from child env", () => {
    expect("METRICS_TOKEN" in bb()).toBe(false);
  });

  it("RESEND_API_KEY is absent from child env", () => {
    expect("RESEND_API_KEY" in bb()).toBe(false);
  });

  it("SENDGRID_API_KEY is absent from child env", () => {
    expect("SENDGRID_API_KEY" in bb()).toBe(false);
  });

  it("DEAD_SYMBOL_WEBHOOK_URL is absent from child env", () => {
    expect("DEAD_SYMBOL_WEBHOOK_URL" in bb()).toBe(false);
  });

  it("ENV_FILE_PATH is absent from child env", () => {
    expect("ENV_FILE_PATH" in bb()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests 61–64: Preload and Node internals dropped
// ─────────────────────────────────────────────────────────────────────────────

describe("buildIsolatedChildEnv — NODE_OPTIONS / NODE_PATH / preload dropped", () => {
  it("NODE_OPTIONS is absent from child env", () => {
    expect("NODE_OPTIONS" in bb()).toBe(false);
  });

  it("NODE_PATH is absent from child env", () => {
    expect("NODE_PATH" in bb({ NODE_PATH: "/dummy/path" })).toBe(false);
  });

  it("LD_PRELOAD is absent from child env", () => {
    expect("LD_PRELOAD" in bb()).toBe(false);
  });

  it("DYLD_INSERT_LIBRARIES is absent from child env", () => {
    expect("DYLD_INSERT_LIBRARIES" in bb()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests 65–73: Proxy variables dropped (uppercase, lowercase, npm variants)
// ─────────────────────────────────────────────────────────────────────────────

describe("buildIsolatedChildEnv — proxy variables dropped", () => {
  it("HTTP_PROXY (uppercase) is absent from child env", () => {
    expect("HTTP_PROXY" in bb()).toBe(false);
  });

  it("HTTPS_PROXY (uppercase) is absent from child env", () => {
    expect("HTTPS_PROXY" in bb()).toBe(false);
  });

  it("ALL_PROXY is absent from child env", () => {
    expect("ALL_PROXY" in bb()).toBe(false);
  });

  it("NO_PROXY is absent from child env", () => {
    expect("NO_PROXY" in bb()).toBe(false);
  });

  it("GRPC_PROXY is absent from child env", () => {
    expect("GRPC_PROXY" in bb()).toBe(false);
  });

  it("http_proxy (lowercase) is absent from child env", () => {
    expect("http_proxy" in bb()).toBe(false);
  });

  it("https_proxy (lowercase) is absent from child env", () => {
    expect("https_proxy" in bb()).toBe(false);
  });

  it("NPM_CONFIG_PROXY is absent from child env", () => {
    expect("NPM_CONFIG_PROXY" in bb()).toBe(false);
  });

  it("NPM_CONFIG_HTTPS_PROXY is absent from child env", () => {
    expect("NPM_CONFIG_HTTPS_PROXY" in bb()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests 74–77: Additional execution switches forced to disabled values
// ─────────────────────────────────────────────────────────────────────────────

describe("buildIsolatedChildEnv — additional execution switches forced disabled", () => {
  it("CANDLE_WAREHOUSE_ENABLED is forced to '0' regardless of parent value", () => {
    const child = bb();
    expect(child["CANDLE_WAREHOUSE_ENABLED"]).toBe(
      EXECUTION_SWITCH_OVERRIDES["CANDLE_WAREHOUSE_ENABLED"],
    );
  });

  it("OPTION_SNAPSHOT_ENABLED is forced to '0' regardless of parent value", () => {
    const child = bb();
    expect(child["OPTION_SNAPSHOT_ENABLED"]).toBe(
      EXECUTION_SWITCH_OVERRIDES["OPTION_SNAPSHOT_ENABLED"],
    );
  });

  it("REASONING_WRITER_V2_ENABLED is forced to '0' regardless of parent value", () => {
    const child = bb();
    expect(child["REASONING_WRITER_V2_ENABLED"]).toBe(
      EXECUTION_SWITCH_OVERRIDES["REASONING_WRITER_V2_ENABLED"],
    );
  });

  it("LIVE_CASH_SWING_ORDER_ENABLED is forced to 'false' regardless of parent value", () => {
    const child = bb();
    expect(child["LIVE_CASH_SWING_ORDER_ENABLED"]).toBe(
      EXECUTION_SWITCH_OVERRIDES["LIVE_CASH_SWING_ORDER_ENABLED"],
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests 78–80: Generated test-only keys are set internally, not inherited
// ─────────────────────────────────────────────────────────────────────────────

describe("buildIsolatedChildEnv — generated test-only keys set explicitly", () => {
  it("TEST_RUN_ID is set from the validated value, not inherited blindly from parent", () => {
    const child = bb();
    expect(child["TEST_RUN_ID"]).toBe("run-abc123");
  });

  it("TEST_DB_ISOLATION_CONFIRMED is forced to 'true' in child env", () => {
    const child = bb({ TEST_DB_ISOLATION_CONFIRMED: "false" });
    expect(child["TEST_DB_ISOLATION_CONFIRMED"]).toBe("true");
  });

  it("TEST_EXTERNAL_SERVICES_CONFIGURED_DISABLED is forced to 'true' in child env", () => {
    const child = bb({ TEST_EXTERNAL_SERVICES_CONFIGURED_DISABLED: "0" });
    expect(child["TEST_EXTERNAL_SERVICES_CONFIGURED_DISABLED"]).toBe("true");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 81: Property test — 100 arbitrary non-allowlisted keys all dropped
// ─────────────────────────────────────────────────────────────────────────────

describe("buildIsolatedChildEnv — property test: arbitrary non-allowlisted keys dropped", () => {
  it("100 arbitrary non-allowlisted parent keys are all dropped from child env", () => {
    // Generate 100 keys that are guaranteed to be off the allowlist.
    const arbitraryKeys: string[] = [];
    for (let i = 0; i < 100; i++) {
      arbitraryKeys.push(`ARBITRARY_NON_ALLOWLISTED_KEY_${i.toString().padStart(3, "0")}`);
    }

    // Verify none of the generated keys are on the allowlist (test precondition).
    const allowlistSet = new Set(CHILD_PROCESS_ENV_ALLOWLIST);
    for (const key of arbitraryKeys) {
      expect(allowlistSet.has(key)).toBe(false);
    }

    // Build parent env with all 100 arbitrary keys.
    const parentWithArbitrary: Record<string, string | undefined> = { ...DUMMY_PARENT_ENV };
    for (const key of arbitraryKeys) {
      parentWithArbitrary[key] = `dummy-value-for-${key}`;
    }

    const child = buildIsolatedChildEnv(DUMMY_VALIDATED, DUMMY_ISOLATED_PATHS, parentWithArbitrary);

    // Every arbitrary key must be absent.
    for (const key of arbitraryKeys) {
      expect(
        key in child,
        `arbitrary key '${key}' must be dropped by the allowlist policy`,
      ).toBe(false);
    }

    // No key in child that is not in PERMITTED_CHILD_KEYS.
    for (const key of Object.keys(child)) {
      expect(
        PERMITTED_CHILD_KEYS.has(key),
        `child key '${key}' is not an approved allowlisted or generated key`,
      ).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests 82–86: PATH, HOME, TMPDIR, and XDG paths — isolated, not inherited
// (Stage 4/5: path isolation tests)
// ─────────────────────────────────────────────────────────────────────────────

describe("buildIsolatedChildEnv — PATH absent (not on allowlist)", () => {
  it("parent PATH is completely absent from child env", () => {
    // DUMMY_PARENT_ENV has PATH=/usr/bin:/bin; it must NOT appear in child.
    // Executables are located via canonical full paths — PATH is never needed.
    const child = bb();
    expect("PATH" in child).toBe(false);
  });
});

describe("buildIsolatedChildEnv — HOME is isolated, not inherited from parent", () => {
  it("child HOME equals the isolated path, not the parent HOME", () => {
    // DUMMY_PARENT_ENV has HOME=/home/runner; must NOT appear in child.
    const child = bb();
    expect(child["HOME"]).toBe(DUMMY_ISOLATED_PATHS.home);
    expect(child["HOME"]).not.toBe("/home/runner");
  });
});

describe("buildIsolatedChildEnv — TMPDIR/TMP/TEMP are isolated, not inherited", () => {
  it("TMPDIR is set to the isolated tmp path", () => {
    const child = bb();
    expect(child["TMPDIR"]).toBe(DUMMY_ISOLATED_PATHS.tmp);
  });

  it("TMP is set to the isolated tmp path", () => {
    const child = bb();
    expect(child["TMP"]).toBe(DUMMY_ISOLATED_PATHS.tmp);
  });

  it("TEMP is set to the isolated tmp path", () => {
    const child = bb();
    expect(child["TEMP"]).toBe(DUMMY_ISOLATED_PATHS.tmp);
  });
});

describe("buildIsolatedChildEnv — XDG paths are isolated", () => {
  it("XDG_CONFIG_HOME is set to the isolated xdgConfigHome path", () => {
    expect(bb()["XDG_CONFIG_HOME"]).toBe(DUMMY_ISOLATED_PATHS.xdgConfigHome);
  });

  it("XDG_CACHE_HOME is set to the isolated xdgCacheHome path", () => {
    expect(bb()["XDG_CACHE_HOME"]).toBe(DUMMY_ISOLATED_PATHS.xdgCacheHome);
  });

  it("XDG_DATA_HOME is set to the isolated xdgDataHome path", () => {
    expect(bb()["XDG_DATA_HOME"]).toBe(DUMMY_ISOLATED_PATHS.xdgDataHome);
  });

  it("XDG_RUNTIME_DIR is set to the isolated xdgRuntimeDir path", () => {
    expect(bb()["XDG_RUNTIME_DIR"]).toBe(DUMMY_ISOLATED_PATHS.xdgRuntimeDir);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests 87–90: Deterministic runtime values always set explicitly
// ─────────────────────────────────────────────────────────────────────────────

describe("buildIsolatedChildEnv — deterministic runtime values", () => {
  it("TZ is forced to 'Asia/Kolkata' regardless of parent value", () => {
    const child = bb({ TZ: "UTC" });
    expect(child["TZ"]).toBe("Asia/Kolkata");
  });

  it("CI is forced to 'true' regardless of parent value", () => {
    const child = bb({ CI: "false" });
    expect(child["CI"]).toBe("true");
  });

  it("TERM is forced to 'dumb' regardless of parent value", () => {
    const child = bb({ TERM: "xterm-256color" });
    expect(child["TERM"]).toBe("dumb");
  });

  it("NO_COLOR is forced to '1' regardless of parent value", () => {
    const child = bb({ NO_COLOR: "0" });
    expect(child["NO_COLOR"]).toBe("1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 91: All isolated paths share one common run root
// ─────────────────────────────────────────────────────────────────────────────

describe("buildIsolatedChildEnv — all isolated paths beneath one run root", () => {
  it("HOME, TMPDIR, and all XDG paths share a common parent directory with the correct prefix", () => {
    const child = bb();
    const isolatedPathValues = [
      child["HOME"]!,
      child["TMPDIR"]!,
      child["XDG_CONFIG_HOME"]!,
      child["XDG_CACHE_HOME"]!,
      child["XDG_DATA_HOME"]!,
      child["XDG_RUNTIME_DIR"]!,
    ];

    // All isolated paths must share exactly one parent directory (the run root).
    const parents = new Set(isolatedPathValues.map((p) => path.dirname(p)));
    expect(parents.size).toBe(1);

    const [runRoot] = [...parents];
    // The shared run root basename must start with the expected prefix.
    expect(path.basename(runRoot!)).toMatch(
      new RegExp(`^${RUN_CONTEXT_DIR_PREFIX.replace(/-/g, "\\-")}`),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests 92–94: resolveVitestExecutable — fail-closed on bad input
// (Stage 3: trusted executable resolver)
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveVitestExecutable — fail-closed on bad resolver", () => {
  it("throws VitestResolutionFailed when the resolver throws (package not found)", () => {
    const badResolver = (_id: string): string => {
      throw new Error("Cannot find module 'vitest/package.json'");
    };
    expect(() => resolveVitestExecutable(badResolver)).toThrow(/VitestResolutionFailed/);
  });

  it("throws VitestResolutionFailed when package.json has no bin field", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nse-guard-restest-"));
    try {
      const fakePkg = path.join(tmpDir, "package.json");
      fs.writeFileSync(
        fakePkg,
        JSON.stringify({ name: "vitest", version: "0.0.0" }),
      );
      expect(() => resolveVitestExecutable(() => fakePkg)).toThrow(/VitestResolutionFailed/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("throws VitestResolutionFailed when resolved CLI path escapes the package root", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nse-guard-restest-"));
    try {
      const pkgDir = path.join(tmpDir, "vitest-pkg");
      fs.mkdirSync(pkgDir);
      // A real file outside the package root
      const outsideFile = path.join(tmpDir, "outside.mjs");
      fs.writeFileSync(outsideFile, "#!/usr/bin/env node\n");
      const fakePkg = path.join(pkgDir, "package.json");
      fs.writeFileSync(
        fakePkg,
        JSON.stringify({
          name: "vitest",
          version: "0.0.0",
          bin: { vitest: "../outside.mjs" }, // escapes pkgDir
        }),
      );
      expect(() => resolveVitestExecutable(() => fakePkg)).toThrow(/VitestResolutionFailed/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests 95–99: safeCleanupRunRoot — safety invariants
// (Stage 8: safe cleanup)
// ─────────────────────────────────────────────────────────────────────────────

describe("safeCleanupRunRoot — deletes a valid generated run root", () => {
  it("accepts and deletes a directory with the correct prefix that is a direct child of tmpdir", () => {
    const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), RUN_CONTEXT_DIR_PREFIX));
    expect(fs.existsSync(runRoot)).toBe(true);
    safeCleanupRunRoot(runRoot);
    expect(fs.existsSync(runRoot)).toBe(false);
  });
});

describe("safeCleanupRunRoot — refuses unsafe paths", () => {
  it("throws CleanupSafetyError when run root is a symbolic link", () => {
    const tmpDir = os.tmpdir();
    const realDir = fs.mkdtempSync(path.join(tmpDir, "nse-guard-real-"));
    const symlinkPath = path.join(
      tmpDir,
      `${RUN_CONTEXT_DIR_PREFIX}symlink-${Date.now()}`,
    );
    fs.symlinkSync(realDir, symlinkPath);
    try {
      expect(() => safeCleanupRunRoot(symlinkPath)).toThrow(/CleanupSafetyError/);
    } finally {
      fs.unlinkSync(symlinkPath);
      fs.rmdirSync(realDir);
    }
  });

  it("throws CleanupSafetyError when run root lacks the required prefix", () => {
    const wrongPrefixDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "nse-guard-wrong-prefix-"),
    );
    try {
      expect(() => safeCleanupRunRoot(wrongPrefixDir)).toThrow(/CleanupSafetyError/);
    } finally {
      // Must clean up manually because safeCleanupRunRoot correctly refused.
      fs.rmdirSync(wrongPrefixDir);
    }
  });

  it("throws CleanupSafetyError when run root is a nested path (not a direct child of tmpdir)", () => {
    const runRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), RUN_CONTEXT_DIR_PREFIX),
    );
    const nestedDir = path.join(runRoot, "subdir");
    fs.mkdirSync(nestedDir, { mode: 0o700 });
    try {
      expect(() => safeCleanupRunRoot(nestedDir)).toThrow(/CleanupSafetyError/);
    } finally {
      fs.rmSync(runRoot, { recursive: true });
    }
  });

  it("throws on second cleanup attempt (enforces delete-once semantics)", () => {
    const runRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), RUN_CONTEXT_DIR_PREFIX),
    );
    safeCleanupRunRoot(runRoot); // First call: succeeds, directory deleted.
    // Second call: must throw because the directory no longer exists.
    expect(() => safeCleanupRunRoot(runRoot)).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests 100–103: DB_TEST_RUNTIME_NOT_AUTHORIZED — hard runtime lock
// (Stage 7: runtime lock)
// ─────────────────────────────────────────────────────────────────────────────

describe("DB_TEST_RUNTIME_NOT_AUTHORIZED — hard runtime lock", () => {
  it("rejects with DB_TEST_RUNTIME_NOT_AUTHORIZED when guard passes; spawn never called", async () => {
    const sentinelCalled: string[] = [];
    const fakeSpawn = () => {
      sentinelCalled.push("SPAWN_CALLED");
      return { on: () => ({}) };
    };
    await expect(
      runPreflightCheck(VALID_ENV, fakeSpawn as never),
    ).rejects.toBe("DB_TEST_RUNTIME_NOT_AUTHORIZED");
    expect(sentinelCalled).toHaveLength(0);
  });

  it("cannot be bypassed via DB_TEST_RUNTIME_AUTHORIZED env var", async () => {
    const sentinelCalled: string[] = [];
    const fakeSpawn = () => {
      sentinelCalled.push("SPAWN_CALLED");
      return { on: () => ({}) };
    };
    const envWithBypass = { ...VALID_ENV, DB_TEST_RUNTIME_AUTHORIZED: "true" };
    await expect(
      runPreflightCheck(envWithBypass, fakeSpawn as never),
    ).rejects.toBe("DB_TEST_RUNTIME_NOT_AUTHORIZED");
    expect(sentinelCalled).toHaveLength(0);
  });

  it("cannot be bypassed via any other environment variable", async () => {
    const sentinelCalled: string[] = [];
    const fakeSpawn = () => {
      sentinelCalled.push("SPAWN_CALLED");
      return { on: () => ({}) };
    };
    const bypassAttempts = [
      { ...VALID_ENV, P0_1B_AUTHORIZED: "true" },
      { ...VALID_ENV, BYPASS_DB_RUNTIME_LOCK: "true" },
      { ...VALID_ENV, FORCE_DB_TESTS: "1" },
      { ...VALID_ENV, OVERRIDE_RUNTIME_BLOCK: "yes" },
    ];
    for (const env of bypassAttempts) {
      await expect(
        runPreflightCheck(env, fakeSpawn as never),
      ).rejects.toBe("DB_TEST_RUNTIME_NOT_AUTHORIZED");
    }
    expect(sentinelCalled).toHaveLength(0);
  });

  it("ALLOW_TEST_DB_WRITES is forced to '0' in child env regardless of parent", () => {
    const child = bb({ ALLOW_TEST_DB_WRITES: "1" });
    expect(child["ALLOW_TEST_DB_WRITES"]).toBe(
      EXECUTION_SWITCH_OVERRIDES["ALLOW_TEST_DB_WRITES"],
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests 104–107: Terminology — TEST_EXTERNAL_SERVICES_CONFIGURED_DISABLED
// (Stage 6: honest terminology for external-service configuration)
// ─────────────────────────────────────────────────────────────────────────────

describe("Terminology — TEST_EXTERNAL_SERVICES_CONFIGURED_DISABLED", () => {
  it("old TEST_EXTERNAL_SERVICES_MOCKED key does not appear in child env", () => {
    const child = bb();
    expect("TEST_EXTERNAL_SERVICES_MOCKED" in child).toBe(false);
  });

  it("TEST_EXTERNAL_SERVICES_CONFIGURED_DISABLED is set to 'true' in child env", () => {
    const child = bb();
    expect(child["TEST_EXTERNAL_SERVICES_CONFIGURED_DISABLED"]).toBe("true");
  });

  it("guard rejects when TEST_EXTERNAL_SERVICES_CONFIGURED_DISABLED is absent and code is correct", () => {
    const result = checkDbTestIsolation({
      ...VALID_ENV,
      TEST_EXTERNAL_SERVICES_CONFIGURED_DISABLED: undefined,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("TEST_EXTERNAL_SERVICES_NOT_CONFIGURED_DISABLED");
    }
  });

  it("guard failure reason does not use the word 'mocked'; uses 'disabled' and 'UNPROVEN'", () => {
    const result = checkDbTestIsolation({
      ...VALID_ENV,
      TEST_EXTERNAL_SERVICES_CONFIGURED_DISABLED: undefined,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.toLowerCase()).not.toContain("mock");
      expect(result.reason.toLowerCase()).toContain("disabled");
      expect(result.reason.toUpperCase()).toContain("UNPROVEN");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests 108–121: Zero-connection safety — P0.1B taxonomy and isolation proof
//
// These static-analysis tests verify the DB/unit naming boundary, config
// exclusion rules, and absence of the weak DATABASE_URL guard pattern without
// making any DB connection or loading any application module.
// ─────────────────────────────────────────────────────────────────────────────

describe("Test taxonomy — DB integration files use .db.test.ts suffix", () => {
  const apiServerRoot = (() => {
    const { fileURLToPath } = require("node:url");
    const { resolve, dirname } = require("node:path");
    return resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  })();

  it("swingOrderStaging.db.test.ts exists (DB integration file has correct suffix)", () => {
    expect(
      fs.existsSync(path.join(apiServerRoot, "src/lib/swingOrderStaging.db.test.ts")),
    ).toBe(true);
  });

  it("paperTradingEqProvenance.db.test.ts exists (DB integration file has correct suffix)", () => {
    expect(
      fs.existsSync(path.join(apiServerRoot, "src/lib/paperTradingEqProvenance.db.test.ts")),
    ).toBe(true);
  });

  it("swingOrderStaging.test.ts has been renamed (legacy non-suffixed file absent)", () => {
    expect(
      fs.existsSync(path.join(apiServerRoot, "src/lib/swingOrderStaging.test.ts")),
    ).toBe(false);
  });

  it("paperTradingEqProvenance.test.ts has been renamed (legacy non-suffixed file absent)", () => {
    expect(
      fs.existsSync(path.join(apiServerRoot, "src/lib/paperTradingEqProvenance.test.ts")),
    ).toBe(false);
  });
});

describe("Unit config excludes DB integration files", () => {
  let unitConfigContents: string;

  beforeAll(async () => {
    const { fileURLToPath } = await import("node:url");
    const { resolve, dirname } = await import("node:path");
    const { readFileSync } = await import("node:fs");
    const dir = dirname(fileURLToPath(import.meta.url));
    unitConfigContents = readFileSync(resolve(dir, "../../vitest.config.unit.ts"), "utf8");
  });

  it("unit config include: array does not contain any .db.test.ts path or pattern", () => {
    // Extract just the array body of `include: [...]` — excludes surrounding comments.
    // The intermediate comment may mention ".db.test.ts"; only the array items matter.
    const includeArrayMatch = unitConfigContents.match(/\binclude:\s*\[([\s\S]*?)\]/);
    const includeArrayContent = includeArrayMatch ? includeArrayMatch[1] : "";
    expect(includeArrayContent).not.toContain(".db.test.ts");
  });

  it("unit config has an explicit exclude: entry for **/*.db.test.ts", () => {
    expect(unitConfigContents).toContain("**/*.db.test.ts");
    // The pattern must appear inside the exclude: section (after "exclude:").
    const excludeStart = unitConfigContents.indexOf("exclude:");
    const dbPatternIdx = unitConfigContents.indexOf("**/*.db.test.ts");
    expect(excludeStart).toBeGreaterThan(-1);
    expect(dbPatternIdx).toBeGreaterThan(excludeStart);
  });
});

describe("DB config exists and scopes only *.db.test.ts files", () => {
  let dbConfigContents: string;

  beforeAll(async () => {
    const { fileURLToPath } = await import("node:url");
    const { resolve, dirname } = await import("node:path");
    const { readFileSync } = await import("node:fs");
    const dir = dirname(fileURLToPath(import.meta.url));
    dbConfigContents = readFileSync(resolve(dir, "../../vitest.config.db.ts"), "utf8");
  });

  it("vitest.config.db.ts exists", () => {
    expect(dbConfigContents.length).toBeGreaterThan(0);
  });

  it("DB config include pattern targets *.db.test.ts, not bare *.test.ts", () => {
    expect(dbConfigContents).toContain("*.db.test.ts");
    // Must not include a wildcard that admits pure unit tests.
    expect(dbConfigContents).not.toMatch(/"src\/\*\*\/\*\.test\.ts"/);
    expect(dbConfigContents).not.toMatch(/"src\/\*\.test\.ts"/);
  });

  it("DB config does not include the pure-unit guard file in its include: array", () => {
    // dbTestGuard.test.ts may appear in a comment or exclude: — check only include:.
    const includeStart = dbConfigContents.indexOf("include:");
    const excludeStart = dbConfigContents.indexOf("exclude:");
    const includeSection = includeStart === -1
      ? ""
      : dbConfigContents.slice(includeStart, excludeStart === -1 ? undefined : excludeStart);
    expect(includeSection).not.toContain("dbTestGuard.test.ts");
  });
});

describe("DB integration files use checkDbTestIsolation — not weak DATABASE_URL guard", () => {
  let swingSrc: string;
  let provenanceSrc: string;

  beforeAll(async () => {
    const { fileURLToPath } = await import("node:url");
    const { resolve, dirname } = await import("node:path");
    const { readFileSync } = await import("node:fs");
    const dir = dirname(fileURLToPath(import.meta.url));
    const libDir = resolve(dir, "../lib");
    swingSrc = readFileSync(resolve(libDir, "swingOrderStaging.db.test.ts"), "utf8");
    provenanceSrc = readFileSync(resolve(libDir, "paperTradingEqProvenance.db.test.ts"), "utf8");
  });

  it("swingOrderStaging.db.test.ts imports checkDbTestIsolation", () => {
    expect(swingSrc).toContain("checkDbTestIsolation");
  });

  it("swingOrderStaging.db.test.ts does not use the weak describe.skipIf(!DATABASE_URL) guard", () => {
    expect(swingSrc).not.toContain("describe.skipIf(!process.env.DATABASE_URL)");
    expect(swingSrc).not.toContain("describe.skipIf(!DATABASE_URL)");
  });

  it("paperTradingEqProvenance.db.test.ts imports checkDbTestIsolation", () => {
    expect(provenanceSrc).toContain("checkDbTestIsolation");
  });

  it("paperTradingEqProvenance.db.test.ts does not use the weak describe.skipIf(!DATABASE_URL) guard", () => {
    expect(provenanceSrc).not.toContain("describe.skipIf(!process.env.DATABASE_URL)");
    expect(provenanceSrc).not.toContain("describe.skipIf(!DATABASE_URL)");
  });
});

describe("pg.Pool is lazy — no TCP connection at DB client module evaluation", () => {
  it("lib/db/src/index.ts does not call pool.connect() or pool.query() at the module top level", async () => {
    const { fileURLToPath } = await import("node:url");
    const { resolve, dirname } = await import("node:path");
    const { readFileSync } = await import("node:fs");
    const dir = dirname(fileURLToPath(import.meta.url));
    const dbIndexPath = resolve(dir, "../../../../lib/db/src/index.ts");
    const src = readFileSync(dbIndexPath, "utf8");

    // Strip function/method bodies — keep only top-level statements.
    // Top-level connection calls (pool.connect, pool.query) at module scope
    // would open a TCP connection immediately on import.
    // The Pool constructor itself is lazy and does not open connections.
    expect(src).not.toMatch(/^pool\.connect\s*\(/m);
    expect(src).not.toMatch(/^pool\.query\s*\(/m);
    expect(src).not.toMatch(/^db\.execute\s*\(/m);

    // The Pool constructor must be present (lazy instantiation is OK).
    expect(src).toContain("new Pool(");
  });
});

describe("Preflight runner spawn uses DB-scoped config", () => {
  it("dbTestPreflightRunner.ts spawn args include --config vitest.config.db.ts", async () => {
    const { fileURLToPath } = await import("node:url");
    const { resolve, dirname } = await import("node:path");
    const { readFileSync } = await import("node:fs");
    const dir = dirname(fileURLToPath(import.meta.url));
    const runnerSrc = readFileSync(resolve(dir, "dbTestPreflightRunner.ts"), "utf8");
    expect(runnerSrc).toContain("vitest.config.db.ts");
  });
});
