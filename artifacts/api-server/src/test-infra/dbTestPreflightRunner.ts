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
 *     locale-category variables (LANG, LC_ALL, LC_CTYPE). All paths (HOME, PATH,
 *     TMPDIR, TMP, TEMP, XDG_*) are replaced with fresh isolated directories
 *     created under os.tmpdir(). All credentials, preload hooks, proxy variables,
 *     and unknown keys are dropped automatically — no denylist to maintain.
 *   - EXTERNAL_NETWORK_RUNTIME_ISOLATION: UNPROVEN — application modules that
 *     bypass env-var gating may still attempt outbound connections.
 *   - TEST_DATABASE_ISOLATION_RUNTIME_PROOF: NOT_EXECUTED — no isolated DB was
 *     provisioned; runtime proof is pending P0.1B owner provisioning.
 *
 * ── DB_TEST_RUNTIME_AUTHORIZED ────────────────────────────────────────────────
 * DB-backed test execution is hard-blocked pending P0.1B completion. The block
 * is a compile-time constant (not an env-var flag) and cannot be bypassed.
 * P0.1B prerequisites: owner-provisioned isolated cluster, restricted role,
 * test-server identity, TLS/URL policy, network isolation, explicit authorization.
 *
 * When authorized (post-P0.1B), this spawns:
 *   <canonical node> <canonical vitest.mjs> run --pool=threads
 * using fully-qualified executable paths resolved from the installed package,
 * with shell:false and an isolated child environment.
 *
 * When the guard fails (always, currently), this prints the failure reason and
 * exits with code 1, preventing Vitest from starting.
 */

import { spawn, type SpawnOptions } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { checkDbTestIsolation } from "./dbTestGuard.js";

// ── Spawn function type (injectable for unit testing) ──────────────────────

export type SpawnFn = (
  cmd: string,
  args: string[],
  opts: SpawnOptions,
) => { exitCode: number | null; on: (event: string, cb: (code: number) => void) => void };

// ── Run context directory prefix ───────────────────────────────────────────
//
// All isolated run roots created by createIsolatedRunContext() use this prefix
// and live as direct children of os.tmpdir(). safeCleanupRunRoot() requires
// this prefix — any directory lacking it is refused.

export const RUN_CONTEXT_DIR_PREFIX = "nsescanner-vitest-";

// ── Explicit allowlist: locale-only (all paths are isolated) ──────────────
//
// Policy: EXPLICIT_ALLOWLIST — child starts from an EMPTY object and inherits
// only the three locale-category variables listed here. Every other parent-env
// key is dropped automatically, including:
//   - PATH           — not needed; executables are located via canonical full paths
//   - HOME           — replaced by an isolated directory under runRoot
//   - TMPDIR/TMP/TEMP— replaced by an isolated directory under runRoot
//   - XDG_*          — replaced by isolated directories under runRoot
//   - NODE_OPTIONS, NODE_PATH, LD_PRELOAD, DYLD_INSERT_LIBRARIES — never inherited
//   - HTTP_PROXY, HTTPS_PROXY, ALL_PROXY, NO_PROXY, GRPC_PROXY, NPM_CONFIG_PROXY,
//     NPM_CONFIG_HTTPS_PROXY, http_proxy, https_proxy — never inherited
//   - all credentials, secrets, API keys — never inherited (no denylist needed)
//
// Locale vars are inheritable because they carry no credentials or path influence
// and maintaining a hardcoded UTF-8 value that works across all Replit environments
// would require a separate probe; inheriting the parent locale is strictly safer
// than silently substituting a locale the host may not support.

export const CHILD_PROCESS_ENV_ALLOWLIST: readonly string[] = [
  "LANG",     // system locale (e.g. en_US.UTF-8)
  "LC_ALL",   // overrides all LC_* locale categories
  "LC_CTYPE", // character classification and encoding
];

// ── Defence-in-depth: project-verified secret/credential env vars ──────────
//
// PRODUCTION_SECRETS is documentation of known project credentials and provides
// audit traceability. Security no longer depends on the completeness of this list —
// the EXPLICIT_ALLOWLIST policy drops all non-listed keys automatically. Extend
// when new operational secrets are introduced.

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
// Parser semantics (static inspection 2026-07-20 / 2026-07-21):
//   PAPER_TRADING_ENABLED       : TRUTHY/FALSY set; "false" → FALSY → disabled.
//   REPLIT_DEPLOYMENT            : strict === "1"; "0" → false at all 7 read sites.
//   INDSTOCKS_ENABLED            : envFlag() FALSY set; "0" → disabled.
//   CANDLE_WAREHOUSE_ENABLED     : same TRUTHY/FALSY as PAPER_TRADING_ENABLED; "0" → disabled.
//   OPTION_SNAPSHOT_ENABLED      : same TRUTHY/FALSY; "0" → disabled.
//   REASONING_WRITER_V2_ENABLED  : strict === "1"; "0" → false.
//   LIVE_CASH_SWING_ORDER_ENABLED: TRUTHY set; "false" → not in TRUTHY → disabled.
//   ALLOW_TEST_DB_WRITES         : strict === "1"; "0" → DB write guard blocks writes.
//   LOG_LEVEL                    : pino-level string; "silent" → no log output.
//   SWING_CASH_EXECUTION_MODE    : "paper_only" → safe default; no live broker call.
//
// Intentionally absent (provably safe when absent, or pure-calculation only):
//   PAPER_FO_COSTS_SHADOW_ENABLED : absent → true; pure shadow/reporting, no external call.
//   PAPER_FO_SHADOW_EXITS_ENABLED : absent → true; pure shadow/reporting, no external call.
//   FNO_SIGNAL_HYGIENE_V2         : absent → true (ON blocks bad trades); pure signal gate.
//   SWING_SHADOW_DIAG_ENABLED     : absent → true; owner-only diagnostic, no external call.

export const EXECUTION_SWITCH_OVERRIDES: Readonly<Record<string, string>> = {
  PAPER_TRADING_ENABLED:         "false",      // paper auto-trade kill switch
  REPLIT_DEPLOYMENT:             "0",          // deployment detector (paperAutoTradeFlag.ts et al.)
  INDSTOCKS_ENABLED:             "0",          // INDstocks secondary-source toggle (policy.ts)
  CANDLE_WAREHOUSE_ENABLED:      "0",          // candle warehouse scheduler
  OPTION_SNAPSHOT_ENABLED:       "0",          // option-chain snapshot scheduler
  REASONING_WRITER_V2_ENABLED:   "0",          // FNO reasoning-writer v2 flag
  LIVE_CASH_SWING_ORDER_ENABLED: "false",      // hard broker flag for live swing orders
  ALLOW_TEST_DB_WRITES:          "0",          // DB write guard (candleWarehouseIngestor.ts et al.)
  LOG_LEVEL:                     "silent",     // suppress pino log output during tests
  SWING_CASH_EXECUTION_MODE:     "paper_only", // ensure no live cash swing broker calls
};

// ── Isolated paths struct ──────────────────────────────────────────────────

export interface IsolatedPaths {
  home: string;
  tmp: string;
  xdgConfigHome: string;
  xdgCacheHome: string;
  xdgDataHome: string;
  xdgRuntimeDir: string;
}

// ── Resolved Vitest executable info ───────────────────────────────────────

export interface ResolvedVitest {
  /** Canonical path to the vitest package root directory. */
  packageRoot: string;
  /** Canonical path to the vitest JavaScript CLI entry (e.g. vitest.mjs). */
  cliPath: string;
  /** Raw bin entry from vitest/package.json (e.g. "./vitest.mjs"). */
  binEntry: string;
  /** Vitest version string from package.json, or "unknown". */
  version: string;
}

// ── Isolated run context ───────────────────────────────────────────────────

export interface RunContext {
  /** Canonical path to the unique run root created under os.tmpdir(). */
  runRoot: string;
  /** Isolated filesystem paths for this run, all beneath runRoot. */
  isolatedPaths: IsolatedPaths;
  /** Sanitized child environment built from validated values and isolated paths. */
  childEnv: Record<string, string>;
  /** Resolved executable information for spawning. */
  execInfo: {
    /** Canonical path to the Node.js executable (fs.realpathSync(process.execPath)). */
    nodePath: string;
    /** Canonical path to the vitest JavaScript CLI (within vitestPackageRoot). */
    vitestCliPath: string;
    /** Canonical path to the vitest package root (containment check already passed). */
    vitestPackageRoot: string;
  };
}

// ── Trusted Vitest executable resolver ────────────────────────────────────
//
// Resolves the Vitest package and CLI entry without relying on PATH.
// Accepts an injectable resolver (createRequire().resolve by default) so
// the containment and metadata checks can be exercised in unit tests.
//
// Guarantees:
//   - vitest/package.json is resolved via Node module resolution, not PATH.
//   - All paths are canonicalized with fs.realpathSync before use.
//   - The CLI binary is verified to exist, be a regular file, and have a
//     JavaScript extension (.mjs, .js, .cjs).
//   - The CLI path must lie within the canonical vitest package root; checked
//     via path.relative(), not startsWith().
//   - Any failure throws with message prefix "VitestResolutionFailed:".

export function resolveVitestExecutable(
  requireResolve?: (id: string) => string,
): ResolvedVitest {
  const resolve =
    requireResolve ?? createRequire(import.meta.url).resolve;

  // ── Step 1: Resolve vitest/package.json ─────────────────────────────────
  let rawPkgJsonPath: string;
  try {
    rawPkgJsonPath = resolve("vitest/package.json");
  } catch (e) {
    throw new Error(
      `VitestResolutionFailed: cannot resolve 'vitest/package.json': ${String(e)}`,
    );
  }

  // ── Step 2: Canonicalize package.json path ───────────────────────────────
  let canonicalPkgJson: string;
  try {
    canonicalPkgJson = fs.realpathSync(rawPkgJsonPath);
  } catch (e) {
    throw new Error(
      `VitestResolutionFailed: cannot canonicalize vitest package.json path '${rawPkgJsonPath}': ${String(e)}`,
    );
  }

  const pkgRoot = path.dirname(canonicalPkgJson);

  // ── Step 3: Read and parse package.json ─────────────────────────────────
  let pkgRaw: string;
  try {
    pkgRaw = fs.readFileSync(canonicalPkgJson, "utf8");
  } catch (e) {
    throw new Error(
      `VitestResolutionFailed: cannot read vitest/package.json: ${String(e)}`,
    );
  }

  let pkg: unknown;
  try {
    pkg = JSON.parse(pkgRaw);
  } catch (e) {
    throw new Error(
      `VitestResolutionFailed: cannot parse vitest/package.json: ${String(e)}`,
    );
  }

  if (typeof pkg !== "object" || pkg === null || Array.isArray(pkg)) {
    throw new Error(
      `VitestResolutionFailed: vitest/package.json root is not an object`,
    );
  }

  const pkgObj = pkg as Record<string, unknown>;

  // ── Step 4: Extract and validate the bin.vitest entry ───────────────────
  const bin = pkgObj["bin"];
  if (typeof bin !== "object" || bin === null || Array.isArray(bin)) {
    throw new Error(
      `VitestResolutionFailed: 'bin' field is missing or not an object in vitest/package.json`,
    );
  }

  const binEntry = (bin as Record<string, unknown>)["vitest"];
  if (typeof binEntry !== "string" || !binEntry.trim()) {
    throw new Error(
      `VitestResolutionFailed: 'bin.vitest' entry is missing or not a non-empty string in vitest/package.json`,
    );
  }

  // ── Step 5: Resolve CLI path from package root ───────────────────────────
  const rawCliPath = path.resolve(pkgRoot, binEntry);

  // ── Step 6: Verify CLI exists and is a regular file ─────────────────────
  let stat: fs.Stats;
  try {
    stat = fs.statSync(rawCliPath);
  } catch (e) {
    throw new Error(
      `VitestResolutionFailed: CLI path not accessible '${rawCliPath}': ${String(e)}`,
    );
  }

  if (!stat.isFile()) {
    throw new Error(
      `VitestResolutionFailed: CLI path is not a regular file: '${rawCliPath}'`,
    );
  }

  // ── Step 7: Verify CLI is a JavaScript module ────────────────────────────
  const ext = path.extname(rawCliPath).toLowerCase();
  if (ext !== ".mjs" && ext !== ".js" && ext !== ".cjs") {
    throw new Error(
      `VitestResolutionFailed: CLI path does not appear to be a JavaScript module ` +
      `(extension '${ext}'): '${rawCliPath}'`,
    );
  }

  // ── Step 8: Canonicalize the CLI path ────────────────────────────────────
  let cliPath: string;
  try {
    cliPath = fs.realpathSync(rawCliPath);
  } catch (e) {
    throw new Error(
      `VitestResolutionFailed: cannot canonicalize CLI path '${rawCliPath}': ${String(e)}`,
    );
  }

  // ── Step 9: Containment check — CLI must be within the package root ──────
  //
  // Use path.relative(), NOT startsWith() — startsWith() produces false
  // positives when package root is a prefix of an unrelated sibling path.
  const rel = path.relative(pkgRoot, cliPath);
  if (!rel || path.isAbsolute(rel) || rel.startsWith("..")) {
    throw new Error(
      `VitestResolutionFailed: resolved CLI path escapes the vitest package root ` +
      `(cli='${cliPath}', pkgRoot='${pkgRoot}', rel='${rel}')`,
    );
  }

  const version =
    typeof pkgObj["version"] === "string" ? pkgObj["version"] : "unknown";

  return { packageRoot: pkgRoot, cliPath, binEntry, version };
}

// ── Trusted Node.js executable resolver ───────────────────────────────────
//
// Canonicalizes process.execPath and verifies it is a regular file.
// Throws "NodeResolutionFailed:" on any failure.

export function resolveNodeExecutable(): string {
  let nodePath: string;
  try {
    nodePath = fs.realpathSync(process.execPath);
  } catch (e) {
    throw new Error(
      `NodeResolutionFailed: cannot canonicalize process.execPath '${process.execPath}': ${String(e)}`,
    );
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(nodePath);
  } catch (e) {
    throw new Error(
      `NodeResolutionFailed: cannot stat canonicalized execPath '${nodePath}': ${String(e)}`,
    );
  }

  if (!stat.isFile()) {
    throw new Error(
      `NodeResolutionFailed: canonicalized execPath is not a regular file: '${nodePath}'`,
    );
  }

  return nodePath;
}

// ── Isolated child environment builder ───────────────────────────────────
//
// Builds a sanitized child environment from:
//   - `validated`    : already-checked DB URL + run ID (from checkDbTestIsolation)
//   - `isolatedPaths`: fresh isolated directory paths beneath a unique run root
//   - `parentEnv`    : optional parent env (only LANG/LC_ALL/LC_CTYPE are inherited)
//
// The resulting Record starts from EMPTY. PATH is never included. HOME, TMPDIR,
// TMP, TEMP, and all XDG_* vars are set to the provided isolated paths instead of
// inherited from the parent. All other parent keys are silently dropped.
//
// MUST be called only after checkDbTestIsolation() returns ok:true.
//
// Guarantees (configuration-level):
//   - NODE_ENV is forced to "test".
//   - DATABASE_URL is set to the validated TEST_DATABASE_URL.
//   - PATH is absent — executables use canonical full paths.
//   - HOME, TMPDIR, TMP, TEMP, XDG_* are isolated paths beneath the run root.
//   - TZ, CI, TERM, NO_COLOR are set to deterministic values.
//   - All production secrets are absent (by allowlist + no PATH/HOME inheritance).
//   - All execution switches are overridden to their safest disabled values.
//
// Does NOT guarantee:
//   - EXTERNAL_NETWORK_RUNTIME_ISOLATION — application modules may bypass env gating.
//   - TEST_DATABASE_ISOLATION_RUNTIME_PROOF — requires P0.1B provisioning.

export function buildIsolatedChildEnv(
  validated: { testDatabaseUrl: string; testRunId: string },
  isolatedPaths: IsolatedPaths,
  parentEnv: Readonly<Record<string, string | undefined>> = {},
): Record<string, string> {
  // ── EXPLICIT_ALLOWLIST: start from EMPTY, copy only locale vars ──────────
  const child: Record<string, string> = {};
  for (const key of CHILD_PROCESS_ENV_ALLOWLIST) {
    const v = parentEnv[key];
    if (v !== undefined) {
      child[key] = v;
    }
  }

  // ── Deterministic runtime values (always set explicitly) ─────────────────
  child["NODE_ENV"] = "test";
  child["TZ"] = "Asia/Kolkata"; // IST-locked: tests must not drift with system TZ
  child["CI"] = "true";         // vitest CI mode: compact output, exit on first failure
  child["TERM"] = "dumb";       // no ANSI escape codes in test output
  child["NO_COLOR"] = "1";      // disable colour; takes precedence over FORCE_COLOR

  // ── Isolated filesystem paths (never inherited from parent) ───────────────
  child["HOME"] = isolatedPaths.home;
  child["TMPDIR"] = isolatedPaths.tmp;
  child["TMP"] = isolatedPaths.tmp;
  child["TEMP"] = isolatedPaths.tmp;
  child["XDG_CONFIG_HOME"] = isolatedPaths.xdgConfigHome;
  child["XDG_CACHE_HOME"] = isolatedPaths.xdgCacheHome;
  child["XDG_DATA_HOME"] = isolatedPaths.xdgDataHome;
  child["XDG_RUNTIME_DIR"] = isolatedPaths.xdgRuntimeDir;

  // ── Internally generated test-only keys ──────────────────────────────────
  // DATABASE_URL is replaced with the validated isolated test URL.
  // Existing DB modules read DATABASE_URL; this ensures they cannot connect
  // to the operational database even if they bypass NODE_ENV gating.
  child["DATABASE_URL"] = validated.testDatabaseUrl;
  child["TEST_DATABASE_URL"] = validated.testDatabaseUrl;
  child["TEST_RUN_ID"] = validated.testRunId;

  // Confirmation flags so the child's own guard check passes without
  // inheriting them from the (untrusted) parent environment.
  child["TEST_DB_ISOLATION_CONFIRMED"] = "true";
  child["TEST_EXTERNAL_SERVICES_CONFIGURED_DISABLED"] = "true";

  // ── Force project-verified execution switches to disabled values ──────────
  for (const [k, v] of Object.entries(EXECUTION_SWITCH_OVERRIDES)) {
    child[k] = v;
  }

  return child;
}

// ── Isolated run context creator ─────────────────────────────────────────
//
// Creates a unique run root beneath os.tmpdir() with prefix RUN_CONTEXT_DIR_PREFIX,
// creates all isolated subdirectories (mode 0o700), resolves the Node and Vitest
// executables, and builds the child environment.
//
// Call safeCleanupRunRoot(ctx.runRoot) after the child process exits.
// Caller is responsible for cleanup on spawn failure.

export function createIsolatedRunContext(
  validated: { testDatabaseUrl: string; testRunId: string },
  resolvedVitest?: ResolvedVitest,
): RunContext {
  const vitest = resolvedVitest ?? resolveVitestExecutable();
  const nodePath = resolveNodeExecutable();

  const canonicalTmpParent = fs.realpathSync(os.tmpdir());
  const runRoot = fs.mkdtempSync(
    path.join(canonicalTmpParent, RUN_CONTEXT_DIR_PREFIX),
  );

  const isolatedPaths: IsolatedPaths = {
    home:           path.join(runRoot, "home"),
    tmp:            path.join(runRoot, "tmp"),
    xdgConfigHome:  path.join(runRoot, "xdg-config"),
    xdgCacheHome:   path.join(runRoot, "xdg-cache"),
    xdgDataHome:    path.join(runRoot, "xdg-data"),
    xdgRuntimeDir:  path.join(runRoot, "xdg-runtime"),
  };

  for (const dir of Object.values(isolatedPaths)) {
    fs.mkdirSync(dir, { recursive: false, mode: 0o700 });
  }

  // Pass process.env for locale inheritance only (LANG/LC_ALL/LC_CTYPE).
  // All other process.env values are blocked by CHILD_PROCESS_ENV_ALLOWLIST.
  const childEnv = buildIsolatedChildEnv(validated, isolatedPaths, process.env);

  return {
    runRoot,
    isolatedPaths,
    childEnv,
    execInfo: {
      nodePath,
      vitestCliPath:     vitest.cliPath,
      vitestPackageRoot: vitest.packageRoot,
    },
  };
}

// ── Safe run-root cleanup ──────────────────────────────────────────────────
//
// Deletes a run root directory created by createIsolatedRunContext() with
// multiple safety invariants to prevent accidental deletion of unrelated paths.
//
// Safety invariants (all checked before any deletion):
//   1. lstat() the path — do NOT follow symlinks at the top level.
//   2. Reject if it is a symbolic link.
//   3. Require it to be a directory.
//   4. Canonicalize with realpathSync.
//   5. Verify it lies beneath the canonical OS tmp directory using path.relative()
//      (not startsWith()).
//   6. Verify it is a DIRECT child of the OS tmp directory (exactly one path segment).
//   7. Verify the basename starts with RUN_CONTEXT_DIR_PREFIX.
//   8. Only then call fs.rmSync with recursive:true on the canonicalized path.
//
// Throws "CleanupSafetyError:" on any violation. Callers should wrap in try/catch
// and log the error rather than crashing. This function is NOT idempotent — a
// second call after successful deletion will throw because the directory no longer
// exists. Callers should guard with a boolean latch.

export function safeCleanupRunRoot(runRoot: string): void {
  const canonicalTmpParent = fs.realpathSync(os.tmpdir());

  // ── 1-2: lstat + symlink check (do NOT follow symlinks) ─────────────────
  let lstated: fs.Stats;
  try {
    lstated = fs.lstatSync(runRoot);
  } catch (e) {
    throw new Error(
      `CleanupSafetyError: lstat failed for '${runRoot}': ${String(e)}`,
    );
  }

  if (lstated.isSymbolicLink()) {
    throw new Error(
      `CleanupSafetyError: run root is a symbolic link — refusing cleanup: '${runRoot}'`,
    );
  }

  // ── 3: Must be a directory ───────────────────────────────────────────────
  if (!lstated.isDirectory()) {
    throw new Error(
      `CleanupSafetyError: run root is not a directory — refusing cleanup: '${runRoot}'`,
    );
  }

  // ── 4: Canonicalize ──────────────────────────────────────────────────────
  let canonicalRunRoot: string;
  try {
    canonicalRunRoot = fs.realpathSync(runRoot);
  } catch (e) {
    throw new Error(
      `CleanupSafetyError: cannot canonicalize run root '${runRoot}': ${String(e)}`,
    );
  }

  // ── 5: Containment check via path.relative() ─────────────────────────────
  const rel = path.relative(canonicalTmpParent, canonicalRunRoot);

  if (!rel) {
    throw new Error(
      `CleanupSafetyError: run root is identical to the OS temp parent — refusing: '${canonicalRunRoot}'`,
    );
  }
  if (path.isAbsolute(rel)) {
    throw new Error(
      `CleanupSafetyError: run root lies outside OS temp parent (rel='${rel}'): '${canonicalRunRoot}'`,
    );
  }
  if (rel.startsWith("..")) {
    throw new Error(
      `CleanupSafetyError: path traversal detected (rel='${rel}') — refusing cleanup`,
    );
  }

  // ── 6: Exactly one path segment (direct child of tmp parent) ────────────
  if (path.dirname(rel) !== ".") {
    throw new Error(
      `CleanupSafetyError: run root is not a direct child of OS temp parent ` +
      `(rel='${rel}') — refusing nested deletion`,
    );
  }

  // ── 7: Basename must start with the safe prefix ──────────────────────────
  const basename = path.basename(rel);
  if (!basename.startsWith(RUN_CONTEXT_DIR_PREFIX)) {
    throw new Error(
      `CleanupSafetyError: run root basename '${basename}' does not start with ` +
      `'${RUN_CONTEXT_DIR_PREFIX}'`,
    );
  }

  // ── 8: All checks passed — delete only the validated canonical run root ───
  fs.rmSync(canonicalRunRoot, { recursive: true, force: false });
}

// ── Core preflight logic (injectable environment + spawn for testability) ──

/**
 * Validate isolation, build isolated child env, then spawn Vitest.
 *
 * @param env     Environment to validate (default: process.env).
 * @param spawnFn Child-process spawn (default: node:child_process spawn).
 *                Inject a sentinel in unit tests to verify guard behaviour
 *                without actually starting Vitest.
 * @returns Promise resolving to the Vitest exit code, or rejecting with
 *          the IsolationFailureCode string when the guard blocks, or with
 *          "DB_TEST_RUNTIME_NOT_AUTHORIZED" (hard block pending P0.1B).
 */
export async function runPreflightCheck(
  env: Readonly<Record<string, string | undefined>> = process.env,
  spawnFn: SpawnFn = spawn as unknown as SpawnFn,
): Promise<number> {
  // ── Step 1: Guard check ──────────────────────────────────────────────────
  const result = checkDbTestIsolation(env);

  if (!result.ok) {
    process.stderr.write(
      `\n[dbTestPreflight] DB-backed test launch BLOCKED\n` +
      `  Code:   ${result.code}\n` +
      `  Reason: ${result.reason}\n\n`,
    );
    return Promise.reject(result.code);
  }

  // ── Step 2: HARD RUNTIME BLOCK — P0.1B not yet authorized ────────────────
  //
  // This is a compile-time constant, not an env-var flag.
  // It cannot be bypassed by setting DB_TEST_RUNTIME_AUTHORIZED,
  // P0_1B_AUTHORIZED, BYPASS_DB_RUNTIME_LOCK, FORCE_DB_TESTS, or any
  // other environment variable.
  //
  // To unlock: complete all P0.1B prerequisites listed in
  // docs/paper-trader-architecture.md, then change this constant.
  // DO NOT replace `false as boolean` with an env-var read.
  const DB_TEST_RUNTIME_AUTHORIZED = false as boolean;

  if (!DB_TEST_RUNTIME_AUTHORIZED) {
    process.stderr.write(
      `\n[dbTestPreflight] DB_TEST_RUNTIME_NOT_AUTHORIZED\n` +
      `  DB-backed test execution is hard-blocked pending P0.1B completion.\n` +
      `  P0.1B requires:\n` +
      `    - owner-provisioned isolated test database/cluster\n` +
      `    - restricted non-production role with no access to operational data\n` +
      `    - test-server identity verification\n` +
      `    - safe TLS and URL-parameter policy\n` +
      `    - runtime network/side-effect isolation\n` +
      `    - explicit owner authorization\n` +
      `  This block is a compile-time constant (not an env-var flag). It cannot\n` +
      `  be bypassed by setting any environment variable. To unlock, complete\n` +
      `  P0.1B and change DB_TEST_RUNTIME_AUTHORIZED in this file.\n\n`,
    );
    return Promise.reject("DB_TEST_RUNTIME_NOT_AUTHORIZED");
  }

  // ── Unreachable until P0.1B is complete ──────────────────────────────────
  //
  // The code below documents the intended post-P0.1B spawn path. It is
  // structurally correct and will become reachable once the hard block above
  // is changed. Do not delete or move it.

  const validated = {
    testDatabaseUrl: (env["TEST_DATABASE_URL"] ?? "").trim(),
    testRunId: (env["TEST_RUN_ID"] ?? "").trim(),
  };

  const runCtx = createIsolatedRunContext(validated);
  let cleanupDone = false;

  const cleanup = () => {
    if (cleanupDone) return;
    cleanupDone = true;
    try {
      safeCleanupRunRoot(runCtx.runRoot);
    } catch (e) {
      process.stderr.write(
        `[dbTestPreflight] cleanup error: ${String(e)}\n`,
      );
    }
  };

  process.stdout.write(
    `\n[dbTestPreflight] Isolation confirmed\n` +
    `  Target:  ${result.fingerprint}\n` +
    `  Run ID:  ${result.runId}\n` +
    `  RunRoot: ${runCtx.runRoot}\n` +
    `  Spawning vitest via canonical Node...\n\n`,
  );

  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawnFn(
        runCtx.execInfo.nodePath,
        [runCtx.execInfo.vitestCliPath, "run", "--pool=threads"],
        {
          env:   runCtx.childEnv as NodeJS.ProcessEnv,
          stdio: "inherit",
          shell: false,
        } as SpawnOptions,
      ) as ReturnType<typeof spawn>;
    } catch (err) {
      cleanup();
      reject(err as Error);
      return;
    }

    child.on("close", (code: number | null) => {
      cleanup();
      resolve(code ?? 1);
    });

    child.on("error", (err: Error) => {
      cleanup();
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
      process.stderr.write(
        `[dbTestPreflight] Unexpected error: ${String(err)}\n`,
      );
      process.exit(2);
    });
}
