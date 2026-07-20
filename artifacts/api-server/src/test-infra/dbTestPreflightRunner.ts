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
 *   - EXPLICIT_ALLOWLIST: child env starts from an EMPTY object and inherits only
 *     a small set of ordinary process-launch keys (PATH, locale, temp dirs, etc.).
 *     All unknown, credential, preload, proxy, and secret variables are dropped
 *     automatically — no denylist to maintain.
 *   - EXTERNAL_NETWORK_RUNTIME_ISOLATION: UNPROVED — application modules that
 *     bypass env-var gating may still attempt outbound connections.
 *   - TEST_DATABASE_ISOLATION_RUNTIME_PROOF: NOT_RUN — no isolated DB was
 *     provisioned; runtime proof is pending owner provisioning.
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

// ── Explicit allowlist: ordinary process-launch keys only ─────────────────
//
// Policy: EXPLICIT_ALLOWLIST — child starts from an EMPTY object and inherits
// only keys present on this list. Every other parent-env key is dropped
// automatically, including unknown future credentials, NODE_OPTIONS, NODE_PATH,
// preload hooks (LD_PRELOAD, DYLD_INSERT_LIBRARIES), and proxy variables
// (HTTP_PROXY, HTTPS_PROXY, ALL_PROXY, etc.). No denylist to maintain.
//
// Each key is individually justified by static source evidence:

export const CHILD_PROCESS_ENV_ALLOWLIST: readonly string[] = [
  // ── Process launch ──────────────────────────────────────────────────────
  "PATH",          // locate node/vitest/pnpm executables
  "HOME",          // node/npm home; used for package resolution and .npmrc lookup
  // ── Temporary directories ───────────────────────────────────────────────
  "TMPDIR",        // macOS / Linux primary temp dir
  "TMP",           // cross-platform fallback (Windows, some Linux)
  "TEMP",          // Windows / cross-platform fallback
  // ── Locale / character encoding ─────────────────────────────────────────
  "LANG",          // system locale (e.g. en_US.UTF-8)
  "LC_ALL",        // overrides all LC_* locale categories
  "LC_CTYPE",      // character classification and encoding
  // ── Deterministic time zone ─────────────────────────────────────────────
  "TZ",            // time-zone for deterministic timestamp-sensitive tests
  // ── CI / terminal output ─────────────────────────────────────────────────
  "CI",            // vitest CI mode (compact output, exit on first failure)
  "TERM",          // terminal type for ANSI/formatting
  "FORCE_COLOR",   // force colour output even when not a TTY
  "NO_COLOR",      // disable colour output (takes precedence over FORCE_COLOR)
];

// ── Defence-in-depth: project-verified secret/credential env vars ──────────
//
// PRODUCTION_SECRETS is kept as documentation of known project credentials
// and for audit traceability. Security no longer depends on the completeness
// of this list — the EXPLICIT_ALLOWLIST policy drops all non-listed keys
// automatically. Extend when new operational secrets are introduced.

export const PRODUCTION_SECRETS: readonly string[] = [
  "APP_ACCESS_PASSWORD",             // owner auth (auth.ts, kiteAuth.ts)
  "GLOBAL_APP_ACCESS_PASSWORD",      // global artifact auth (global/auth.ts)
  "SESSION_SECRET",                  // session signing
  "TRADINGVIEW_WEBHOOK_SECRET",      // webhook auth (systemStatus.ts)
  "KITE_API_KEY",                    // Kite broker API key (kiteAuth.ts)
  "KITE_API_SECRET",                 // Kite broker API secret (kiteAuth.ts)
  "KITE_TOKEN_ENC_KEY",              // Kite token encryption key (kiteCrypto.ts)
  "KITE_TOKEN_ENC_KEY_OLD",          // Kite key rotation old key (rotateKiteTokenEncKey.ts)
  "KITE_TOKEN_ENC_KEY_NEW",          // Kite key rotation new key (rotateKiteTokenEncKey.ts)
  "KITE_MIRROR_URL",                 // Kite mirror endpoint URL (kiteAuth.ts)
  "KITE_MIRROR_ALLOWED_HOSTS",       // Kite mirror host allowlist (kiteAuth.ts, routes/kite.ts)
  "TELEGRAM_BOT_TOKEN",              // F&O/swing alert bot (alerting.ts)
  "TELEGRAM_CHAT_ID",                // F&O/swing alert chat (alerting.ts)
  "PREPOST_TELEGRAM_BOT_TOKEN",      // daily report bot (alerting.ts)
  "PREPOST_TELEGRAM_CHAT_ID",        // daily report chat (alerting.ts)
  "INDSTOCKS_API_TOKEN",             // INDstocks secondary data (indstocksClient.ts)
  "METRICS_TOKEN",                   // metrics API bearer token (routes/systemStatus.ts)
  "RESEND_API_KEY",                  // Resend email API key (deadSymbolNotifier.ts)
  "SENDGRID_API_KEY",                // SendGrid email API key (deadSymbolNotifier.ts)
  "DEAD_SYMBOL_WEBHOOK_URL",         // dead-symbol alert webhook URL (deadSymbolNotifier.ts)
  "ENV_FILE_PATH",                   // path to .env credential file (routes/secretsVault.ts)
  "PARITY_TEST_TELEGRAM_BOT_TOKEN",  // parity harness test-only token (parityHarness.ts)
  "PARITY_TEST_TELEGRAM_CHAT_ID",    // parity harness test-only chat (parityHarness.ts)
];

// ── Execution switches forced to disabled/safe values ─────────────────────
//
// Applied after the allowlist copy to guarantee test isolation regardless of
// parent values. Values chosen so every flag defaults to its safest
// non-executing state in the test child process.
//
// Parser semantics (static inspection 2026-07-20):
//   PAPER_TRADING_ENABLED       : TRUTHY/FALSY set; "false" → FALSY → disabled.
//   REPLIT_DEPLOYMENT            : strict === "1"; "0" → false at all 7 read sites.
//   INDSTOCKS_ENABLED            : envFlag() FALSY set; "0" → disabled.
//   CANDLE_WAREHOUSE_ENABLED     : same TRUTHY/FALSY as PAPER_TRADING_ENABLED; "0" → disabled.
//   OPTION_SNAPSHOT_ENABLED      : same TRUTHY/FALSY; "0" → disabled.
//   REASONING_WRITER_V2_ENABLED  : strict === "1"; "0" → false.
//   LIVE_CASH_SWING_ORDER_ENABLED: TRUTHY set; "false" → not in TRUTHY → disabled.
//
// Intentionally absent (provably safe when absent, or pure-calculation only):
//   PAPER_FO_COSTS_SHADOW_ENABLED : absent → true; pure shadow/reporting, no external call.
//   PAPER_FO_SHADOW_EXITS_ENABLED : absent → true; pure shadow/reporting, no external call.
//   FNO_SIGNAL_HYGIENE_V2         : absent → true (ON blocks bad trades); pure signal gate.
//   SWING_CASH_EXECUTION_MODE     : absent → "paper_only" (safe default); no external call.
//   SWING_SHADOW_DIAG_ENABLED     : absent → true; owner-only diagnostic, no external call.

export const EXECUTION_SWITCH_OVERRIDES: Readonly<Record<string, string>> = {
  PAPER_TRADING_ENABLED:        "false", // paper auto-trade kill switch (paperAutoTradeFlag.ts)
  REPLIT_DEPLOYMENT:            "0",     // deployment detector (paperAutoTradeFlag.ts et al.)
  INDSTOCKS_ENABLED:            "0",     // INDstocks secondary-source toggle (policy.ts)
  CANDLE_WAREHOUSE_ENABLED:     "0",     // candle warehouse scheduler (candleWarehouseIngestor.ts)
  OPTION_SNAPSHOT_ENABLED:      "0",     // option-chain snapshot scheduler (optionChainSnapshotIngestor.ts)
  REASONING_WRITER_V2_ENABLED:  "0",     // FNO reasoning-writer v2 flag (fnoCanonicalTaxonomy.ts)
  LIVE_CASH_SWING_ORDER_ENABLED:"false", // hard broker flag for live swing orders (swingLiveExecutionConfig.ts)
};

// ── Isolated child environment builder ───────────────────────────────────

/**
 * Build a sanitized child environment for DB-backed test runs.
 *
 * MUST be called only after checkDbTestIsolation() returns ok:true so that
 * TEST_DATABASE_URL and TEST_RUN_ID are already validated.
 *
 * Policy: EXPLICIT_ALLOWLIST
 *   - Starts from an EMPTY object.
 *   - Copies only keys present in CHILD_PROCESS_ENV_ALLOWLIST.
 *   - Sets all required test-only keys explicitly (DATABASE_URL, NODE_ENV,
 *     run ID, isolation confirmations, execution switches).
 *   - All other parent keys — including unknown future credentials, NODE_OPTIONS,
 *     NODE_PATH, preload hooks (LD_PRELOAD, DYLD_INSERT_LIBRARIES), proxy
 *     variables (HTTP_PROXY, HTTPS_PROXY, ALL_PROXY, etc.), and any variable not
 *     on the allowlist — are dropped automatically. No denylist to maintain.
 *
 * Guarantees (configuration-level):
 *   - NODE_ENV is forced to "test".
 *   - DATABASE_URL is set to the validated TEST_DATABASE_URL value.
 *   - All project-verified production secrets are absent (by allowlist policy).
 *   - Project-verified execution switches are forced to disabled values.
 *   - NODE_OPTIONS, NODE_PATH, and all preload/proxy variables are absent (by policy).
 *
 * Does NOT guarantee:
 *   - EXTERNAL_NETWORK_RUNTIME_ISOLATION — existing application modules may
 *     still attempt outbound connections if they bypass env-var gating.
 *   - TEST_DATABASE_ISOLATION_RUNTIME_PROOF — no isolated DB provisioned.
 *
 * @param parentEnv  The parent process environment (pass process.env or a mock).
 *                   Must already contain a valid TEST_DATABASE_URL and TEST_RUN_ID.
 * @returns  A clean Record<string, string> safe to pass as child process env.
 *           Never logs real URLs or secrets.
 */
export function buildIsolatedChildEnv(
  parentEnv: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const testDatabaseUrl = (parentEnv["TEST_DATABASE_URL"] ?? "").trim();
  const testRunId = (parentEnv["TEST_RUN_ID"] ?? "").trim();

  // ── EXPLICIT_ALLOWLIST: start from EMPTY, copy only approved keys ─────────
  // Every other parent key — credentials, NODE_OPTIONS, NODE_PATH, LD_PRELOAD,
  // DYLD_INSERT_LIBRARIES, HTTP_PROXY, HTTPS_PROXY, ALL_PROXY, NO_PROXY, GRPC_PROXY,
  // NPM_CONFIG_PROXY, and any unknown future variable — is automatically excluded.
  const child: Record<string, string> = {};
  for (const key of CHILD_PROCESS_ENV_ALLOWLIST) {
    const v = parentEnv[key];
    if (v !== undefined) {
      child[key] = v;
    }
  }

  // ── Internally generated test-only keys ──────────────────────────────────
  // These are set explicitly; none are inherited blindly from the parent.
  child["NODE_ENV"] = "test";

  // Replace DATABASE_URL with the validated isolated test database URL.
  // Existing DB modules read DATABASE_URL; this ensures they cannot connect
  // to the operational database even if they bypass NODE_ENV gating.
  child["DATABASE_URL"] = testDatabaseUrl;

  // Keep TEST_DATABASE_URL for test infrastructure that reads it explicitly.
  child["TEST_DATABASE_URL"] = testDatabaseUrl;

  // Forward validated run ID (already checked by checkDbTestIsolation).
  child["TEST_RUN_ID"] = testRunId;

  // Set explicit confirmation flags so the child's own guard check passes
  // without needing to inherit them from the (untrusted) parent env.
  child["TEST_DB_ISOLATION_CONFIRMED"] = "true";
  child["TEST_EXTERNAL_SERVICES_MOCKED"] = "true";

  // ── Force project-verified execution switches to disabled values ──────────
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
