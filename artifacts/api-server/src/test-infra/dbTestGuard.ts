/**
 * P0.1 — DB Test Isolation Guard
 *
 * IMPORTANT: This module uses ONLY Node standard-library imports.
 * Do NOT add @workspace/*, drizzle-orm, pg, express, or any application package.
 *
 * Purpose: validate that the test environment is structurally isolated from
 * the operational database BEFORE any application module is loaded.
 *
 * This module validates configuration structure only. It does NOT open a
 * socket, execute SQL, or verify connectivity.
 */

import { URL } from "node:url";

// ── Typed reason codes ──────────────────────────────────────────────────────

export type IsolationFailureCode =
  | "NOT_TEST_ENV"
  | "TEST_DATABASE_URL_MISSING"
  | "OPERATIONAL_DATABASE_FALLBACK_FORBIDDEN"
  | "TEST_EQUALS_OPERATIONAL_TARGET"
  | "TEST_DB_CONFIRMATION_MISSING"
  | "TEST_RUN_ID_MISSING"
  | "TEST_TARGET_NOT_ISOLATED";

export type IsolationSuccessCode = "VALID_ISOLATED_TEST_CONFIGURATION";

export interface IsolationFailure {
  ok: false;
  code: IsolationFailureCode;
  reason: string;
}

export interface IsolationSuccess {
  ok: true;
  code: IsolationSuccessCode;
  /** Redacted: "host:port/dbname" only — no username, password or query params. */
  fingerprint: string;
  runId: string;
}

export type IsolationResult = IsolationFailure | IsolationSuccess;

// ── Denylist ────────────────────────────────────────────────────────────────
//
// Database name fragments that identify operational targets.
// Any test URL whose database name contains one of these is rejected,
// regardless of host. Extend this list when new operational databases are added.

const OPERATIONAL_DB_DENYLIST: readonly string[] = [
  "nse_scanner", // production + development operational database name
];

// Keywords a test database name must contain to be considered isolated.
// The database name must also NOT be solely composed of these words
// (e.g., a database literally named "test" with nothing else is acceptable
// here but the denylist and RUN_ID checks provide additional safeguards).
const ISOLATION_KEYWORDS: readonly string[] = [
  "vitest",
  "test",
  "ephemeral",
  "tmp",
  "spec",
  "sandbox",
];

// ── URL parsing + canonicalization ──────────────────────────────────────────

interface ParsedPgUrl {
  host: string;   // lowercase
  port: number;   // explicit, defaults to 5432
  database: string; // lowercase, leading slash stripped
}

function parsePgUrl(raw: string): ParsedPgUrl | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "postgres:" && u.protocol !== "postgresql:") return null;
    const host = (u.hostname || "localhost").toLowerCase();
    const port = u.port ? parseInt(u.port, 10) : 5432;
    const database = (u.pathname ?? "/").replace(/^\/+/, "").toLowerCase().trim();
    if (!database) return null;
    return { host, port, database };
  } catch {
    return null;
  }
}

function fingerprint(p: ParsedPgUrl): string {
  return `${p.host}:${p.port}/${p.database}`;
}

function sameTarget(a: ParsedPgUrl, b: ParsedPgUrl): boolean {
  return a.host === b.host && a.port === b.port && a.database === b.database;
}

// ── Core isolation check ────────────────────────────────────────────────────

/**
 * Validate DB-backed test isolation from the supplied environment object.
 *
 * Pass `process.env` for production use; pass a plain object for unit tests.
 * Never mutates the argument.
 */
export function checkDbTestIsolation(
  env: Readonly<Record<string, string | undefined>> = process.env,
): IsolationResult {
  // ── 1. NODE_ENV must be "test" ─────────────────────────────────────────
  if (env["NODE_ENV"] !== "test") {
    return {
      ok: false,
      code: "NOT_TEST_ENV",
      reason:
        `NODE_ENV is '${env["NODE_ENV"] ?? "(unset)"}'; must be 'test' for DB-backed test mode. ` +
        `Set NODE_ENV=test before running DB-backed tests.`,
    };
  }

  // ── 2. TEST_DATABASE_URL must be present and non-empty ────────────────
  const testRaw = env["TEST_DATABASE_URL"]?.trim() ?? "";
  const operationalRaw = env["DATABASE_URL"]?.trim() ?? "";

  if (!testRaw) {
    // Explicitly block fallback to DATABASE_URL even when it is set
    if (operationalRaw) {
      return {
        ok: false,
        code: "OPERATIONAL_DATABASE_FALLBACK_FORBIDDEN",
        reason:
          "TEST_DATABASE_URL is not set but DATABASE_URL is present. " +
          "DB-backed tests MUST NOT use the operational database as a fallback. " +
          "Provision an isolated TEST_DATABASE_URL pointing to a disposable database.",
      };
    }
    return {
      ok: false,
      code: "TEST_DATABASE_URL_MISSING",
      reason:
        "TEST_DATABASE_URL is not set. " +
        "DB-backed tests require a disposable isolated PostgreSQL database. " +
        "Set TEST_DATABASE_URL to a non-routable test database URL and also set " +
        "TEST_RUN_ID and TEST_DB_ISOLATION_CONFIRMED=true.",
    };
  }

  // ── 3. TEST_DATABASE_URL must be a valid Postgres URL ─────────────────
  const testParsed = parsePgUrl(testRaw);
  if (!testParsed) {
    return {
      ok: false,
      code: "TEST_DATABASE_URL_MISSING",
      reason:
        "TEST_DATABASE_URL is not a valid PostgreSQL connection URL. " +
        "It must start with 'postgres://' or 'postgresql://' and include a database name.",
    };
  }

  // ── 4. TEST_DATABASE_URL must not resolve to the same target as DATABASE_URL
  if (operationalRaw) {
    const opParsed = parsePgUrl(operationalRaw);
    if (opParsed && sameTarget(testParsed, opParsed)) {
      return {
        ok: false,
        code: "TEST_EQUALS_OPERATIONAL_TARGET",
        reason:
          `TEST_DATABASE_URL resolves to the same target as DATABASE_URL ` +
          `(${fingerprint(testParsed)}). ` +
          "DB-backed tests must use a completely separate database instance and name.",
      };
    }
  }

  // ── 5. Denylist: reject known operational database name fragments ──────
  for (const fragment of OPERATIONAL_DB_DENYLIST) {
    if (testParsed.database.includes(fragment)) {
      return {
        ok: false,
        code: "TEST_TARGET_NOT_ISOLATED",
        reason:
          `TEST_DATABASE_URL database name '${testParsed.database}' contains the operational ` +
          `denylist fragment '${fragment}'. ` +
          "Use a database name that is clearly isolated, e.g. 'nse_vitest_<run-id>'.",
      };
    }
  }

  // ── 6. TEST_RUN_ID must be present and non-empty ──────────────────────
  const runId = env["TEST_RUN_ID"]?.trim() ?? "";
  if (!runId) {
    return {
      ok: false,
      code: "TEST_RUN_ID_MISSING",
      reason:
        "TEST_RUN_ID is not set. " +
        "Set TEST_RUN_ID to a unique identifier for this test run " +
        "(e.g. a UUID or CI build number) to enable per-run isolation tracking.",
    };
  }

  // ── 7. Owner confirmation must be explicitly set ──────────────────────
  if (env["TEST_DB_ISOLATION_CONFIRMED"] !== "true") {
    return {
      ok: false,
      code: "TEST_DB_CONFIRMATION_MISSING",
      reason:
        "TEST_DB_ISOLATION_CONFIRMED is not set to 'true'. " +
        "Explicitly set TEST_DB_ISOLATION_CONFIRMED=true to confirm you intend to run " +
        "DB-backed tests against the specified isolated database. " +
        "This confirmation must be provided each run; it cannot be inherited from a .env file.",
    };
  }

  // ── 8. Database name must contain an isolation keyword ────────────────
  const hasIsolationKeyword = ISOLATION_KEYWORDS.some((kw) =>
    testParsed.database.includes(kw),
  );
  if (!hasIsolationKeyword) {
    return {
      ok: false,
      code: "TEST_TARGET_NOT_ISOLATED",
      reason:
        `TEST_DATABASE_URL database name '${testParsed.database}' does not contain a recognized ` +
        `isolation keyword (${ISOLATION_KEYWORDS.join(", ")}). ` +
        "Use a name that clearly identifies the database as a disposable test target, " +
        "e.g. 'nse_vitest_20260720_abc123'.",
    };
  }

  // ── All checks passed ──────────────────────────────────────────────────
  return {
    ok: true,
    code: "VALID_ISOLATED_TEST_CONFIGURATION",
    fingerprint: fingerprint(testParsed),
    runId,
  };
}
