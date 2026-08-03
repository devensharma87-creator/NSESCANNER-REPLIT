/**
 * Minimal bootstrap probe for G3 exact configuration-rejection tests.
 *
 * Imports ONLY productionConfigValidator — zero routes, zero schedulers,
 * zero providers, zero DB, zero modules with __dirname references.
 * No HTTP listener is ever opened.
 *
 * Exit codes:
 *   0  CONFIG_VALID written to stdout
 *   1  One or more PROD_CONFIG_INVALID:* codes written to stderr (one per line)
 *
 * Usage (via spawnSync in tests — strict allowlist env, no Replit secrets):
 *   tsx src/probe/configBootstrapProbe.ts
 */
import { validateProductionConfig } from "../lib/productionConfigValidator.js";

const result = validateProductionConfig(process.env);

if (!result.valid) {
  for (const err of result.errors) {
    // Each error code on its own line for exact grep/assertion in tests
    process.stderr.write(`${err.code}\n`);
    // Human message on the next line (indented) — never contains secret values
    process.stderr.write(`  ${err.message}\n`);
  }
  process.exit(1);
}

// Explicit machine-readable bootstrap-validation marker
process.stdout.write("CONFIG_VALID\n");
process.exit(0);
