/**
 * Server entry point.
 *
 * Bootstrap order (enforced, not merely documented):
 *   1. PORT validation (cheapest check first)
 *   2. Production configuration validation via validateProductionConfig()
 *      — no routes, no schedulers, no DB, no provider imports at this point.
 *   3. If invalid: emit stable PROD_CONFIG_INVALID:* codes and exit(1).
 *      No HTTP listener is ever opened on invalid config.
 *   4. Dynamic import of app.ts (which loads all routes, schedulers, providers).
 *      App module is never initialized on invalid configuration.
 *   5. Start HTTP listener.
 *
 * CONFIG_ONLY=1 mode (test/probe only):
 *   Exit immediately after step 3 (validation pass) without initializing
 *   the application or opening any listener. Used by G3 bootstrap-order probes.
 */

import { validateProductionConfig } from "./lib/productionConfigValidator.js";

// Step 1 — PORT
const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Step 2 — Production configuration validation.
// Runs BEFORE the dynamic app import so that routes/schedulers/providers
// are never initialized when the configuration is invalid.
const validation = validateProductionConfig(process.env);
if (!validation.valid) {
  for (const err of validation.errors) {
    // Write stable machine-readable code to stderr (one per line)
    process.stderr.write(`${err.code}\n`);
    // Human description on next line — never contains secret values
    process.stderr.write(`  ${err.message}\n`);
  }
  process.exit(1);
}

// CONFIG_ONLY mode: used by bootstrap-order probes to verify that validation
// runs (and succeeds) before any app initialization.  Exit cleanly here.
if (process.env["CONFIG_ONLY"] === "1") {
  process.stdout.write("CONFIG_VALID\n");
  process.exit(0);
}

// Step 4 — Dynamic app import.
// app.ts is loaded here (after validation).  All static imports inside
// app.ts — routes, schedulers, providers — run at this point.
const { default: app } = await import("./app.js");

// Step 5 — Start listener.
app.listen(port, (err?: Error) => {
  if (err) {
    process.stderr.write(`Error listening on port ${port}: ${err.message}\n`);
    process.exit(1);
  }
});
