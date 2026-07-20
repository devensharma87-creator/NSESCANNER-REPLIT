/**
 * P0.1 — Strict positive-allowlist unit configuration.
 *
 * This config uses a POSITIVE ALLOWLIST: only the explicitly named file(s)
 * are included. No wildcard admits unreviewed application tests.
 *
 * PURE_UNIT_CONFIRMED = 1 (for this configuration):
 *   src/test-infra/dbTestGuard.test.ts
 *
 * All other test files remain unclassified (DB_DIRECT, DB_TRANSITIVE,
 * EXTERNAL_SERVICE, or UNKNOWN_REQUIRES_TRACE) until individually reviewed
 * via full module-graph tracing. "Not matched by grep" does not mean pure.
 *
 * HOW TO ADD A FILE:
 *   1. Trace its full import graph — confirm it does not transitively import
 *      @workspace/db, drizzle-orm, pg.Pool, or any external network adapter.
 *   2. Add its exact path to the include array below.
 *   3. Update PURE_UNIT_CONFIRMED count here and in
 *      memory/P0_1_TEST_COUPLING_INVENTORY_2026-07-20.md.
 *   4. Run this config to verify the file passes.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "threads",

    // Positive allowlist only — no wildcards, no exclude list.
    include: [
      "src/test-infra/dbTestGuard.test.ts",
    ],
  },
});
