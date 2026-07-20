/**
 * P0.1 — DB Test Preflight Runner
 *
 * This module is the enforcement wrapper that executes BEFORE any Vitest
 * process is spawned for DB-backed test commands (package scripts "test" and "test:db").
 *
 * IMPORTANT: This module imports ONLY the guard module and Node standard-library.
 * It MUST NOT import @workspace/*, drizzle-orm, pg, express, or any application
 * package — if it did, application modules would load before the guard fires,
 * defeating the purpose.
 *
 * CHILD ENVIRONMENT ISOLATION BOUNDARY:
 *   - Configuration-level isolation is enforced (secrets stripped, kill switches set).
 *   - EXTERNAL_NETWORK_RUNTIME_ISOLATION: UNPROVED — application modules that
 *     bypass env-var gating may still attempt outbound connections.
 *
 * When the guard passes, this builds an isolated child environment and spawns:
 *   vitest run --pool=threads
 *
 * When the guard fails, this prints the failure reason and exits with code 1,
 * preventing Vitest from starting.
 */

import { spawn, type SpawnOptions } from "node:child_process";
import { checkDbTestIsolation } from "./dbTestGuard.js";

// ── Spawn function type (injectable for unit testing) ──────────────────────

export type SpawnFn = (
  cmd: string,
  args: string[],
  opts: SpawnOptions,
) => { exitCode: number | null; on: (event: string, cb: (code: number) => void) => void };

// ── Project-verified secret/credential env vars ────────────────────────────
//
// Stripped from the child environment before spawning Vitest.
// Source: static grep of artifacts/api-server/src/ for process.env["VAR_NAME"].
// Extend this list when new operational secrets are introduced.

export const PRODUCTION_SECRETS: readonly string[] = [
  "APP_ACCESS_PASSWORD",             // owner auth (auth.ts, kiteAuth.ts)
  "GLOBAL_APP_ACCESS_PASSWORD",      // global artifact auth (global/auth.ts)
  "SESSION_SECRET",                  // session signing
  "TRADINGVIEW_WEBHOOK_SECRET",      // webhook auth (systemStatus.ts)
  "KITE_API_KEY",                    // Kite broker API key (kiteAuth.ts)
  "KITE_API_SECRET",                 // Kite broker API secret (kiteAuth.ts)
  "TELEGRAM_BOT_TOKEN",              // F&O/swing alert bot (alerting.ts)
  "TELEGRAM_CHAT_ID",                // F&O/swing alert chat (alerting.ts)
  "PREPOST_TELEGRAM_BOT_TOKEN",      // daily report bot (alerting.ts)
  "PREPOST_TELEGRAM_CHAT_ID",        // daily report chat (alerting.ts)
  "INDSTOCKS_API_TOKEN",             // INDstocks secondary data (indstocksClient.ts)
  "PARITY_TEST_TELEGRAM_BOT_TOKEN",  // parity harness test-only token (parityHarness.ts)
  "PARITY_TEST_TELEGRAM_CHAT_ID",    // parity harness test-only chat (parityHarness.ts)
];

// ── Project-verified execution switches forced to disabled values ──────────
//
// Source: static grep of artifacts/api-server/src/ for process.env["SWITCH_NAME"].
// These are named constants in the project; do not invent new switch names here.

export const EXECUTION_SWITCH_OVERRIDES: Readonly<Record<string, string>> = {
  PAPER_TRADING_ENABLED: "false",  // paper auto-trade kill switch (paperAutoTradeFlag.ts)
  REPLIT_DEPLOYMENT:     "0",      // deployment detector (paperAutoTradeFlag.ts, candleWarehouseIngestor.ts)
  INDSTOCKS_ENABLED:     "0",      // INDstocks secondary-source toggle (indstocksRouter.ts)
};

// ── Isolated child environment builder ────────────────────────────────────

/**
 * Build a sanitized child environment for DB-backed test runs.
 *
 * MUST be called only after checkDbTestIsolation() returns ok:true so that
 * TEST_DATABASE_URL is known valid.
 *
 * Guarantees (configuration-level):
 *   - NODE_ENV is forced to "test".
 *   - DATABASE_URL is set to the validated TEST_DATABASE_URL value;
 *     the original operational DATABASE_URL value is removed.
 *   - All project-verified production secrets are stripped.
 *   - Project-verified execution switches are forced to disabled values.
 *
 * Does NOT guarantee:
 *   - EXTERNAL_NETWORK_RUNTIME_ISOLATION — existing application modules may
 *     still attempt outbound connections if they bypass env-var gating.
 *
 * @param parentEnv  The parent process environment (pass process.env or a mock).
 *                   Must already contain a valid TEST_DATABASE_URL.
 * @returns  A clean Record<string, string> safe to pass as child process env.
 *           Never logs real URLs or secrets.
 */
export function buildIsolatedChildEnv(
  parentEnv: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const testDatabaseUrl = (parentEnv["TEST_DATABASE_URL"] ?? "").trim();

  // Start with all defined parent env entries, stripping production secrets.
  // DATABASE_URL is in PRODUCTION_SECRETS so it is excluded here and replaced below.
  const secretSet = new Set<string>(PRODUCTION_SECRETS);
  secretSet.add("DATABASE_URL"); // always replace with isolated target

  const child: Record<string, string> = {};
  for (const [k, v] of Object.entries(parentEnv)) {
    if (v !== undefined && !secretSet.has(k)) {
      child[k] = v;
    }
  }

  // Force test mode.
  child["NODE_ENV"] = "test";

  // Replace DATABASE_URL with the validated isolated test database URL.
  // Existing DB modules read DATABASE_URL; this prevents them from connecting
  // to the operational database.
  child["DATABASE_URL"] = testDatabaseUrl;

  // Keep TEST_DATABASE_URL for test infrastructure that reads it explicitly.
  child["TEST_DATABASE_URL"] = testDatabaseUrl;

  // Force project-verified execution switches to disabled values.
  for (const [k, v] of Object.entries(EXECUTION_SWITCH_OVERRIDES)) {
    child[k] = v;
  }

  return child;
}

// ── Core preflight logic (injectable environment + spawn for testability) ──

/**
 * Validate isolation, build isolated child env, then spawn Vitest.
 *
 * @param env     Environment to validate (default: process.env).
 * @param spawnFn Child-process spawn (default: node:child_process spawn).
 *                Inject a sentinel in unit tests to verify guard behaviour
 *                without actually starting Vitest.
 * @returns Promise resolving to the Vitest exit code, or rejecting with the
 *          IsolationFailureCode string when the guard blocks.
 */
export async function runPreflightCheck(
  env: Readonly<Record<string, string | undefined>> = process.env,
  spawnFn: SpawnFn = spawn as unknown as SpawnFn,
): Promise<number> {
  const result = checkDbTestIsolation(env);

  if (!result.ok) {
    process.stderr.write(
      `\n[dbTestPreflight] DB-backed test launch BLOCKED\n` +
      `  Code:   ${result.code}\n` +
      `  Reason: ${result.reason}\n\n`,
    );
    return Promise.reject(result.code);
  }

  // Guard passed — build isolated child environment before spawn.
  const childEnv = buildIsolatedChildEnv(env);

  process.stdout.write(
    `\n[dbTestPreflight] Isolation confirmed\n` +
    `  Target:  ${result.fingerprint}\n` +
    `  Run ID:  ${result.runId}\n` +
    `  Spawning vitest...\n\n`,
  );

  return new Promise((resolve, reject) => {
    const child = spawnFn("vitest", ["run", "--pool=threads"], {
      env: childEnv as NodeJS.ProcessEnv,
      stdio: "inherit",
      shell: false,
    } as SpawnOptions);

    (child as ReturnType<typeof spawn>).on("close", (code: number | null) => {
      resolve(code ?? 1);
    });

    (child as ReturnType<typeof spawn>).on("error", (err: Error) => {
      reject(err);
    });
  });
}

// ── CLI entry point ────────────────────────────────────────────────────────

if (process.argv[1] && process.argv[1].includes("dbTestPreflightRunner")) {
  runPreflightCheck(process.env)
    .then((code) => process.exit(code))
    .catch((err) => {
      if (typeof err === "string") {
        process.exit(1);
      }
      process.stderr.write(`[dbTestPreflight] Unexpected error: ${String(err)}\n`);
      process.exit(2);
    });
}
