/**
 * vitest.config.tripwire.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Vitest configuration for the P0.1B process-wide DB network tripwire run.
 *
 * IDENTICAL to vitest.config.ts (the authoritative non-DB suite) with one
 * addition: setupFiles loads dbNetworkTripwire.setup.ts in every worker thread.
 *
 * This config is used ONLY by tripwireHarness.ts.
 * It must NEVER replace vitest.config.ts as the default config.
 * Normal developer workflows (test:unit, test:full) are unaffected.
 *
 * Coverage is belt-and-suspenders:
 *   • NODE_OPTIONS --require  → main vitest process + workers (tinypool execArgv)
 *   • setupFiles              → any worker that does not inherit execArgv
 *   • INSTALLED_KEY guard     → prevents double-installation per V8 context
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'threads',

    // Same include/exclude as vitest.config.ts — identical suite scope.
    include: ['src/**/*.test.ts'],
    exclude: ['**/*.db.test.ts', '**/node_modules/**'],

    // Belt-and-suspenders preload installation in each worker thread.
    setupFiles: ['./src/test-infra/dbNetworkTripwire.setup.ts'],
  },
});
