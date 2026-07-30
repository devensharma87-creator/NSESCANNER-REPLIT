/**
 * P0.1B — Authoritative default non-DB test configuration.
 *
 * This is the DEFAULT Vitest configuration for the api-server package.
 * Any bare `vitest run` (without --config) automatically picks up this file,
 * making accidental DB test discovery structurally impossible.
 *
 * TAXONOMY (P0.1B):
 *   *.db.test.ts  — DB integration tests; run ONLY via `pnpm run test:db`
 *                   (dbTestPreflightRunner) with an isolated test database.
 *   *.test.ts     — pure unit tests or DB-transitive functional tests with no
 *                   actual DB queries; included by this config.
 *
 * Included:
 *   src/**\/*.test.ts   (includes *.pure.test.ts, named test files, etc.)
 *
 * Explicitly excluded:
 *   **\/*.db.test.ts    (DB integration files — NEVER run without provisioning)
 *
 * Normal developer invocations:
 *   pnpm run test:full          — full non-DB suite via this config
 *   vitest run                  — same; picks up this file automatically
 *   pnpm run test:unit          — strict guard-file-only allowlist (vitest.config.unit.ts)
 *   pnpm run test:db            — DB integration suite (guarded preflight runner)
 *
 * Single authoritative non-DB config — do NOT create a competing vitest.config.noDb.ts.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "threads",

    // Includes all normal test files.
    include: [
      "src/**/*.test.ts",
    ],

    // Belt-and-suspenders: explicitly exclude DB integration files.
    // DB tests connect to a real PostgreSQL database and MUST only run via
    // dbTestPreflightRunner (pnpm run test:db) with an isolated test database.
    // This exclusion makes the normal suite safe BY CONSTRUCTION — not by
    // relying on in-file skips that could be bypassed.
    exclude: [
      "**/*.db.test.ts",
      "**/node_modules/**",
    ],
  },
});
