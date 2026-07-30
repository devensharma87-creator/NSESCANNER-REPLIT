/**
 * P0.1B — Full non-DB test configuration (FULL_NON_DB_API_SUITE)
 *
 * Includes all *.test.ts files while explicitly excluding all DB integration
 * files (*.db.test.ts). This is the safe replacement for a bare
 * `vitest run --pool=threads` invocation that discovers DB files.
 *
 * Usage (never add to package.json — see note below):
 *   pnpm --filter @workspace/api-server exec vitest run \
 *     --config vitest.config.noDb.ts --pool=threads
 *
 * Why no package.json script: the guard test ("no package script other than
 * test:unit launches an unguarded vitest run") prevents any non-test:unit
 * script from containing a raw `vitest run` invocation. This config is
 * invoked directly for non-DB full-suite verification during development.
 *
 * DB integration files excluded (*.db.test.ts):
 *   src/lib/swingOrderStaging.db.test.ts
 *   src/lib/paperTradingEqProvenance.db.test.ts
 *
 * To run DB integration tests, use: pnpm run test:db
 * (requires a provisioned isolated test database — see P0.1B docs)
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "threads",

    // All test files under src/, except DB integration files.
    include: [
      "src/**/*.test.ts",
    ],

    // Explicit exclusion of DB integration files — machine-enforced boundary.
    // DB tests connect to a real PostgreSQL database and MUST only run via
    // dbTestPreflightRunner (pnpm run test:db) with an isolated test database.
    exclude: [
      "**/*.db.test.ts",
      "**/node_modules/**",
    ],
  },
});
