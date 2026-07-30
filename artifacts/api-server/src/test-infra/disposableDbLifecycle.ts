/**
 * P0.1B — Disposable Test Database Lifecycle
 *
 * Implements the per-run disposable database orchestration behind injectable
 * adapters. No real database connection is made here — all database operations
 * are delegated to the ProvisioningAdapter and MigrationAdapter interfaces.
 *
 * Privilege separation contract:
 *   - The provisioning URL lives only in the ProvisioningAdapter. It is never
 *     passed to the VitestSpawnAdapter or emitted in diagnostic output.
 *   - ProvisioningAdapter.createRestrictedRole() returns a per-run runtime URL
 *     using restricted credentials (no CREATEDB/CREATEROLE/superuser/etc.).
 *   - VitestSpawnAdapter.spawnVitest() receives only the restricted runtime URL
 *     and the run ID — never the provisioning URL or credentials.
 *
 * Identifier safety:
 *   - Database names: `nsc_vitest_<normalizedRunId>` (prefix-validated before any drop)
 *   - Role names: `nsc_vitest_role_<normalizedRunId>` (prefix-validated before any drop)
 *   - Both are identifier-quote-safe: only lowercase alphanumeric + underscore + hyphen
 *
 * All imports here are Node standard-library only (no @workspace/*, drizzle-orm,
 * pg, or any network-touching package). This keeps the module unit-test friendly.
 */

import { randomBytes } from "node:crypto";

// ── Constants ──────────────────────────────────────────────────────────────

export const DB_NAME_PREFIX    = "nsc_vitest_";
export const ROLE_NAME_PREFIX  = "nsc_vitest_role_";

// PostgreSQL identifier length limit.
const PG_IDENTIFIER_MAX_LENGTH = 63;

// Valid normalized run ID: lowercase alphanumeric + hyphen + underscore, 8–64 chars.
const NORMALIZED_RUN_ID_RE = /^[a-z0-9_-]{8,64}$/;

// ── Adapter interfaces ─────────────────────────────────────────────────────

/**
 * Adapter that holds the provisioning credential and performs admin operations.
 * Injected by the caller — the lifecycle module never sees the actual URL.
 */
export interface ProvisioningAdapter {
  /**
   * Create a new empty database. The name has already been validated to start
   * with DB_NAME_PREFIX.
   */
  createDatabase(dbName: string): Promise<void>;

  /**
   * Create a restricted runtime role with minimal privileges for the given
   * database only (no CREATEDB, no CREATEROLE, no superuser). Returns a
   * connection URL for the restricted role — this is the ONLY URL passed to
   * the Vitest child process.
   */
  createRestrictedRole(roleName: string, dbName: string): Promise<string>;

  /**
   * Drop the database. The lifecycle validates the name starts with
   * DB_NAME_PREFIX and contains the run ID before calling this.
   */
  dropDatabase(dbName: string): Promise<void>;

  /**
   * Drop the restricted runtime role. The lifecycle validates the role name
   * starts with ROLE_NAME_PREFIX before calling this.
   */
  dropRole(roleName: string): Promise<void>;
}

/**
 * Adapter that migrates the schema onto the provisioned test database.
 * Receives only the restricted runtime URL — never the provisioning URL.
 */
export interface MigrationAdapter {
  /**
   * Apply the application schema to the target database URL.
   * Must be idempotent for a fresh empty database.
   * Must not use the operational DATABASE_URL.
   */
  bootstrapSchema(testDatabaseUrl: string): Promise<void>;
}

/**
 * Adapter that spawns Vitest with the isolated child environment.
 * Receives only the restricted runtime URL and run ID.
 */
export interface VitestSpawnAdapter {
  /**
   * Spawn Vitest with the test-only runtime URL and run ID.
   * Must not receive the provisioning URL.
   */
  spawnVitest(params: {
    testDatabaseUrl: string;  // restricted runtime URL only
    testRunId: string;        // normalized run ID
  }): Promise<number>;        // Vitest exit code
}

// ── Identifier helpers ─────────────────────────────────────────────────────

/**
 * Generate a cryptographically random run ID (96 bits → 24 hex chars).
 * The result is already lowercase alphanumeric and satisfies NORMALIZED_RUN_ID_RE.
 */
export function generateRunId(): string {
  return randomBytes(12).toString("hex"); // 96 bits, hex-encoded, length=24
}

/**
 * Normalize a raw run ID: lowercase, keep only safe characters.
 * The result must then be validated with validateNormalizedRunId.
 */
export function normalizeRunId(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

/**
 * Validate a normalized run ID. Returns void if valid, throws otherwise.
 */
export function validateNormalizedRunId(normalizedRunId: string): void {
  if (!NORMALIZED_RUN_ID_RE.test(normalizedRunId)) {
    throw new Error(
      `InvalidRunId: normalized run ID '${normalizedRunId}' does not match ` +
      `${NORMALIZED_RUN_ID_RE}. Must be 8–64 chars, lowercase alphanumeric, ` +
      `underscore, or hyphen only.`,
    );
  }
}

/**
 * Derive the database name for a validated run ID.
 * Throws if the run ID is invalid or the resulting name would be unsafe.
 */
export function deriveDatabaseName(normalizedRunId: string): string {
  validateNormalizedRunId(normalizedRunId);
  const name = `${DB_NAME_PREFIX}${normalizedRunId}`;
  if (name.length > PG_IDENTIFIER_MAX_LENGTH) {
    throw new Error(
      `DatabaseNameTooLong: '${name}' (${name.length} chars) exceeds the ` +
      `PostgreSQL identifier limit of ${PG_IDENTIFIER_MAX_LENGTH} chars. ` +
      `Shorten the run ID.`,
    );
  }
  return name;
}

/**
 * Derive the restricted runtime role name for a validated run ID.
 * Throws if the run ID is invalid or the resulting name would be unsafe.
 */
export function deriveRoleName(normalizedRunId: string): string {
  validateNormalizedRunId(normalizedRunId);
  const name = `${ROLE_NAME_PREFIX}${normalizedRunId}`;
  if (name.length > PG_IDENTIFIER_MAX_LENGTH) {
    throw new Error(
      `RoleNameTooLong: '${name}' (${name.length} chars) exceeds the ` +
      `PostgreSQL identifier limit of ${PG_IDENTIFIER_MAX_LENGTH} chars. ` +
      `Shorten the run ID.`,
    );
  }
  return name;
}

// ── Endpoint separation validator ──────────────────────────────────────────

function extractHostPort(url: string): string {
  // Returns "host:port" for comparison. Does not expose credentials.
  try {
    const u = new URL(url);
    const host = (u.hostname || "localhost").toLowerCase();
    const port = u.port || (u.protocol === "postgres:" || u.protocol === "postgresql:" ? "5432" : "5432");
    return `${host}:${port}`;
  } catch {
    return "";
  }
}

/**
 * Validate that the provisioning URL targets a DIFFERENT host:port than the
 * operational DATABASE_URL. Throws if they resolve to the same endpoint.
 *
 * This is a defence-in-depth check — the provisioning cluster must be
 * physically separate from the operational cluster.
 */
export function validateEndpointSeparation(
  provisioningUrl: string,
  operationalUrl: string | undefined,
): void {
  if (!provisioningUrl || !operationalUrl) return;
  const provEndpoint = extractHostPort(provisioningUrl);
  const opEndpoint   = extractHostPort(operationalUrl);
  if (!provEndpoint || !opEndpoint) return; // parse failure — let adapter handle it
  if (provEndpoint === opEndpoint) {
    throw new Error(
      `EndpointCollision: the provisioning URL resolves to the same host:port ` +
      `as the operational DATABASE_URL (${opEndpoint}). ` +
      `The provisioning credential MUST point to a dedicated test-only cluster ` +
      `that has no access to operational data.`,
    );
  }
}

// ── Cleanup safety ─────────────────────────────────────────────────────────

/**
 * Validate that a database name is safe to drop.
 * The name must start with DB_NAME_PREFIX and contain the expected run ID.
 * Throws if either check fails.
 */
export function validateDatabaseNameForDrop(dbName: string, expectedRunId: string): void {
  if (!dbName.startsWith(DB_NAME_PREFIX)) {
    throw new Error(
      `CleanupSafetyError: database name '${dbName}' does not start with ` +
      `'${DB_NAME_PREFIX}' — refusing to drop.`,
    );
  }
  const norm = normalizeRunId(expectedRunId);
  if (!dbName.includes(norm)) {
    throw new Error(
      `CleanupSafetyError: database name '${dbName}' does not contain the ` +
      `normalized run ID '${norm}' — refusing to drop.`,
    );
  }
}

/**
 * Validate that a role name is safe to drop.
 */
export function validateRoleNameForDrop(roleName: string): void {
  if (!roleName.startsWith(ROLE_NAME_PREFIX)) {
    throw new Error(
      `CleanupSafetyError: role name '${roleName}' does not start with ` +
      `'${ROLE_NAME_PREFIX}' — refusing to drop.`,
    );
  }
}

// ── Lifecycle config and result ────────────────────────────────────────────

export interface DisposableDbLifecycleConfig {
  /** Must be true for the lifecycle to proceed past the authorization check. */
  authorized: boolean;
  /**
   * Admin/provisioning URL for the test-only cluster.
   * NEVER passed to the Vitest child or migration adapter.
   */
  provisioningUrl: string;
  /**
   * The operational DATABASE_URL for endpoint-separation validation.
   * Optional — if absent, the separation check is skipped.
   */
  operationalUrl?: string;
  /**
   * Override the auto-generated run ID. Must satisfy NORMALIZED_RUN_ID_RE
   * after normalization. Useful for deterministic testing.
   */
  runIdOverride?: string;
  /**
   * When true, retain the test database and role on Vitest failure to enable
   * post-mortem debugging. The database TTL and janitor pathway must be managed
   * externally. Default: false (always clean up).
   */
  retainOnFailure?: boolean;
}

export interface DisposableDbLifecycleResult {
  /** Vitest exit code. 0 = success. */
  exitCode: number;
  /** The normalized run ID used for this run. */
  runId: string;
  /** The disposable database name (nsc_vitest_<runId>). */
  databaseName: string;
  /** The restricted runtime role name (nsc_vitest_role_<runId>). */
  roleName: string;
  /** Whether cleanup was performed. */
  cleanedUp: boolean;
  /** Whether the database was retained for debugging on failure. */
  retainedForDebugging: boolean;
}

// ── Main lifecycle orchestration ──────────────────────────────────────────

/**
 * Run the full disposable-DB lifecycle:
 *
 *  1. Validate authorization.
 *  2. Validate endpoint separation (provisioning ≠ operational).
 *  3. Generate / normalize run ID.
 *  4. Derive database and role names.
 *  5. Create database.
 *  6. Create restricted runtime role.
 *  7. Bootstrap schema (before Vitest).
 *  8. Spawn Vitest with restricted runtime URL.
 *  9. Capture exit status.
 * 10. Clean up (drop database and role) per the cleanup policy.
 * 11. Return exit status.
 *
 * The provisioning URL is held only inside `adapters.provisioning`. It is
 * NEVER passed to `adapters.spawn` or `adapters.migration`.
 */
export async function runDisposableDbLifecycle(
  config: DisposableDbLifecycleConfig,
  adapters: {
    provisioning: ProvisioningAdapter;
    migration:    MigrationAdapter;
    spawn:        VitestSpawnAdapter;
  },
): Promise<DisposableDbLifecycleResult> {
  // ── 1. Authorization check ────────────────────────────────────────────────
  if (!config.authorized) {
    throw new Error(
      "DisposableDbLifecycle: execution not authorized. " +
      "Set `authorized: true` only after completing all P0.1B prerequisites.",
    );
  }

  // ── 2. Provisioning URL presence ─────────────────────────────────────────
  if (!config.provisioningUrl) {
    throw new Error(
      "DisposableDbLifecycle: provisioningUrl is required. " +
      "Set the TEST_DB_PROVISIONING_URL Replit Secret to the admin URL of a " +
      "dedicated test-only PostgreSQL cluster.",
    );
  }

  // ── 3. Endpoint separation validation ────────────────────────────────────
  validateEndpointSeparation(config.provisioningUrl, config.operationalUrl);

  // ── 4. Run ID generation and normalization ────────────────────────────────
  const rawRunId     = config.runIdOverride ?? generateRunId();
  const normalizedId = normalizeRunId(rawRunId);
  validateNormalizedRunId(normalizedId);

  // ── 5. Derive identifiers ─────────────────────────────────────────────────
  const databaseName = deriveDatabaseName(normalizedId);
  const roleName     = deriveRoleName(normalizedId);

  // Tracking for cleanup invariants
  let databaseCreated = false;
  let roleCreated     = false;
  let runtimeUrl      = "";

  const retainOnFailure = config.retainOnFailure ?? false;

  const cleanup = async (isFailure: boolean): Promise<boolean> => {
    const shouldRetain = isFailure && retainOnFailure;
    if (shouldRetain) {
      return false; // retained — not cleaned up
    }

    let cleanedUp = true;

    // Drop role first (role has grants on the database; drop DB first would fail)
    if (roleCreated) {
      try {
        validateRoleNameForDrop(roleName);
        await adapters.provisioning.dropRole(roleName);
      } catch {
        cleanedUp = false;
      }
    }

    // Drop database after role
    if (databaseCreated) {
      try {
        validateDatabaseNameForDrop(databaseName, normalizedId);
        await adapters.provisioning.dropDatabase(databaseName);
      } catch {
        cleanedUp = false;
      }
    }

    return cleanedUp;
  };

  // ── 6. Create database ────────────────────────────────────────────────────
  try {
    await adapters.provisioning.createDatabase(databaseName);
    databaseCreated = true;
  } catch (err) {
    // Database creation failed — no drop attempt needed (nothing was created).
    // Role was never created. Safe to propagate immediately.
    throw new Error(
      `DisposableDbLifecycle: createDatabase failed for '${databaseName}': ${String(err)}`,
    );
  }

  // ── 7. Create restricted runtime role ─────────────────────────────────────
  try {
    runtimeUrl = await adapters.provisioning.createRestrictedRole(roleName, databaseName);
    roleCreated = true;
  } catch (err) {
    // Role creation failed — clean up the database we just created.
    await cleanup(true);
    throw new Error(
      `DisposableDbLifecycle: createRestrictedRole failed for '${roleName}': ${String(err)}`,
    );
  }

  // ── 8. Bootstrap schema ───────────────────────────────────────────────────
  // The migration adapter receives only the restricted runtime URL — never
  // the provisioning URL.
  try {
    await adapters.migration.bootstrapSchema(runtimeUrl);
  } catch (err) {
    // Schema bootstrap failed — clean up and block Vitest.
    await cleanup(true);
    throw new Error(
      `DisposableDbLifecycle: bootstrapSchema failed: ${String(err)}`,
    );
  }

  // ── 9. Spawn Vitest ───────────────────────────────────────────────────────
  // The spawn adapter receives only the restricted runtime URL and run ID.
  // The provisioning URL NEVER enters the child process.
  let exitCode: number;
  try {
    exitCode = await adapters.spawn.spawnVitest({
      testDatabaseUrl: runtimeUrl,
      testRunId:       normalizedId,
    });
  } catch (err) {
    await cleanup(true);
    throw new Error(
      `DisposableDbLifecycle: Vitest spawn failed: ${String(err)}`,
    );
  }

  // ── 10. Cleanup ───────────────────────────────────────────────────────────
  const isFailure  = exitCode !== 0;
  const cleanedUp  = await cleanup(isFailure);
  const retained   = isFailure && retainOnFailure && !cleanedUp;

  return {
    exitCode,
    runId:       normalizedId,
    databaseName,
    roleName,
    cleanedUp,
    retainedForDebugging: retained,
  };
}
