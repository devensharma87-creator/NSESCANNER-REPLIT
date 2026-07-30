/**
 * P0.1B — DB Integration Test Configuration
 *
 * This config is used EXCLUSIVELY by the official DB test runner
 * (`pnpm run test:db` → dbTestPreflightRunner.ts). It MUST NOT be invoked
 * directly via `vitest run --config vitest.config.db.ts` without first passing
 * through the preflight runner, which validates the isolation environment and
 * replaces DATABASE_URL with the isolated TEST_DATABASE_URL.
 *
 * Convention: DB integration test files use the `.db.test.ts` suffix.
 * Pure unit test files use `.test.ts`. The two naming conventions are
 * mutually exclusive by file-system convention — no grep-based exclusion is
 * needed to keep them separated.
 *
 * DB integration test files included by this config:
 *   src/lib/swingOrderStaging.db.test.ts
 *   src/lib/paperTradingEqProvenance.db.test.ts
 *   (and any future *.db.test.ts files added under src/)
 *
 * Files NOT included (handled by vitest.config.unit.ts or not run at all):
 *   src/test-infra/dbTestGuard.test.ts       — pure unit (no DB)
 *   src/**\/*.test.ts (non-.db.test.ts)       — pure unit (no DB)
 *
 * NEVER add pure unit tests to this config; they have no DB access under the
 * isolated environment created by buildIsolatedChildEnv().
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "threads",

    // Only DB integration files — identified by the .db.test.ts suffix.
    include: [
      "src/**/*.db.test.ts",
    ],

    // Belt-and-suspenders: exclude the unit-only guard file in case a future
    // wildcard change accidentally includes it.
    exclude: [
      "src/test-infra/dbTestGuard.test.ts",
    ],
  },
});
