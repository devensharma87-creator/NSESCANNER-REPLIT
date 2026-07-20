/**
 * P0-C: Test isolation guard — enforces that DB-backed tests
 * cannot run against the operational database.
 *
 * RULES (§6.6 of superseding Phase 0 prompt):
 *  1. DB-backed tests require explicit TEST_DATABASE_URL.
 *  2. Test startup fingerprints the host/database/schema and refuses known
 *     operational targets.
 *  3. Absence of TEST_DATABASE_URL causes DB tests to skip/fail clearly —
 *     they NEVER fall back to DATABASE_URL.
 *  4. If TEST_DATABASE_URL equals DATABASE_URL, refuse immediately.
 *
 * USAGE IN TEST FILES:
 *   import { requireIsolatedTestDb, SKIP_NO_ISOLATED_DB } from "../lib/testIsolationGuard";
 *
 *   // At the top of any DB-backed test suite:
 *   beforeAll(async () => {
 *     await requireIsolatedTestDb();   // throws if not isolated
 *   });
 *
 *   // Or use the vitest describe.skipIf pattern:
 *   describe.skipIf(await isIsolatedTestDbAvailable())("Suite name", () => { ... });
 */

/**
 * Pattern list of known operational database names/hosts that are
 * NEVER permitted as test targets. Case-insensitive partial match.
 */
const OPERATIONAL_DB_PATTERNS: RegExp[] = [
  /neondb/i,
  /nse_prod/i,
  /nse_live/i,
  /nse_dev(?!.*test)/i,  // "nse_dev" matches, but "nse_dev_test" does not
  /nse_scanner(?!.*test)/i,
];

/**
 * Patterns that ARE acceptable as test database names.
 * At least one must match for the fingerprint check to pass.
 */
const APPROVED_TEST_DB_PATTERNS: RegExp[] = [
  /test/i,       // any name containing "test"
  /nse_test/i,   // canonical test db name
  /vitest/i,     // vitest-specific
  /ephemeral/i,  // disposable schema
  /tmp/i,        // temporary
];

export const SKIP_NO_ISOLATED_DB = "NOT_RUN_NO_ISOLATED_DB";

/**
 * Parse a Postgres connection string and return {host, database}.
 * Returns null for unrecognised formats.
 */
function parseConnectionTarget(url: string): { host: string; database: string } | null {
  try {
    const u = new URL(url);
    const database = u.pathname.replace(/^\//, "");
    return { host: u.hostname, database };
  } catch {
    return null;
  }
}

/**
 * Return true if TEST_DATABASE_URL is set, non-empty, different from
 * DATABASE_URL, and its database name matches an approved test pattern.
 *
 * Does NOT throw — use this for describe.skipIf().
 */
export async function isIsolatedTestDbAvailable(): Promise<boolean> {
  try {
    await requireIsolatedTestDb();
    return true;
  } catch {
    return false;
  }
}

/**
 * Assert that TEST_DATABASE_URL is properly isolated before any DB operation.
 *
 * Throws a descriptive error when:
 *  - TEST_DATABASE_URL is absent or empty
 *  - TEST_DATABASE_URL === DATABASE_URL
 *  - The target database name matches an operational pattern
 *  - The target database name does not match any approved test pattern
 *
 * Safe to call multiple times (idempotent — no DB connections opened here).
 */
export function requireIsolatedTestDb(): void {
  const testUrl = process.env["TEST_DATABASE_URL"];
  const operationalUrl = process.env["DATABASE_URL"];

  // Rule 1: TEST_DATABASE_URL must be set.
  if (!testUrl) {
    throw new Error(
      `[testIsolationGuard] TEST_DATABASE_URL is not set.\n` +
      `DB-backed tests cannot run — they would fall back to DATABASE_URL and ` +
      `mutate the operational database.\n` +
      `Status: ${SKIP_NO_ISOLATED_DB}\n` +
      `Action: provision a disposable test database and set TEST_DATABASE_URL.`,
    );
  }

  // Rule 2: TEST_DATABASE_URL must not equal DATABASE_URL.
  if (operationalUrl && testUrl === operationalUrl) {
    throw new Error(
      `[testIsolationGuard] TEST_DATABASE_URL equals DATABASE_URL.\n` +
      `DB-backed tests MUST use a separate disposable database.\n` +
      `Running against the operational database is forbidden.`,
    );
  }

  // Rule 3: Fingerprint the target.
  const target = parseConnectionTarget(testUrl);
  if (!target) {
    throw new Error(
      `[testIsolationGuard] Cannot parse TEST_DATABASE_URL as a Postgres connection string.\n` +
      `URL format must be: postgresql://user:pass@host/dbname`,
    );
  }

  // Rule 4: Reject known operational patterns.
  for (const pattern of OPERATIONAL_DB_PATTERNS) {
    if (pattern.test(target.database) || pattern.test(target.host)) {
      throw new Error(
        `[testIsolationGuard] TEST_DATABASE_URL target '${target.database}' on '${target.host}' ` +
        `matches a known operational database pattern (${pattern.source}).\n` +
        `Tests cannot run against an operational database.`,
      );
    }
  }

  // Rule 5: Require at least one approved test pattern.
  const approved = APPROVED_TEST_DB_PATTERNS.some(
    (p) => p.test(target.database) || p.test(target.host),
  );
  if (!approved) {
    throw new Error(
      `[testIsolationGuard] TEST_DATABASE_URL target '${target.database}' on '${target.host}' ` +
      `does not match any approved test pattern (${APPROVED_TEST_DB_PATTERNS.map((p) => p.source).join(", ")}).\n` +
      `Rename the test database to include 'test' or set a vitest/ephemeral/tmp name.`,
    );
  }
}

/**
 * Sentinel test helper — call this from a dedicated sentinel test file.
 *
 * Temporarily injects the provided DATABASE_URL and (optional) TEST_DATABASE_URL
 * into the process environment, then calls requireIsolatedTestDb().
 *
 * Returns:
 *   "CORRECTLY_BLOCKED"  — guard threw, correctly refusing the configuration
 *   "CORRECTLY_ALLOWED"  — guard passed without throwing (valid isolated test URL)
 *
 * The semantics are purely descriptive: if the guard allows a URL that should
 * be blocked, that is a bug in the guard — the sentinel itself cannot detect
 * this beyond returning "CORRECTLY_ALLOWED" for something you know is wrong.
 * Use the individual test cases for "blocks when X" / "allows when Y" to
 * assert the correct outcome per scenario.
 */
export function sentinelCheckWithOnlyOperationalUrl(
  databaseUrl: string,
  testDatabaseUrl?: string,
): "CORRECTLY_BLOCKED" | "CORRECTLY_ALLOWED" {
  const origTest = process.env["TEST_DATABASE_URL"];
  const origDb = process.env["DATABASE_URL"];
  try {
    process.env["DATABASE_URL"] = databaseUrl;
    if (testDatabaseUrl !== undefined) {
      process.env["TEST_DATABASE_URL"] = testDatabaseUrl;
    } else {
      delete process.env["TEST_DATABASE_URL"];
    }
    try {
      requireIsolatedTestDb();
      return "CORRECTLY_ALLOWED";
    } catch {
      return "CORRECTLY_BLOCKED";
    }
  } finally {
    if (origTest !== undefined) process.env["TEST_DATABASE_URL"] = origTest;
    else delete process.env["TEST_DATABASE_URL"];
    if (origDb !== undefined) process.env["DATABASE_URL"] = origDb;
    else delete process.env["DATABASE_URL"];
  }
}
