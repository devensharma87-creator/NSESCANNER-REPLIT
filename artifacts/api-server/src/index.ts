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
 *   5. Await the read-only instrument-registry restoration, so no HTTP consumer
 *      can observe the registry before restoration has settled.
 *   6. Start HTTP listener.
 *
 * CONFIG_ONLY=1 mode (test/probe only):
 *   Exit immediately after step 3 (validation pass) without initializing
 *   the application or opening any listener. Used by G3 bootstrap-order probes.
 */

import { validateProductionConfig } from "./lib/productionConfigValidator.js";
import {
  assertBootProofModeAllowed,
  BootProofModeForbiddenError,
  getBootCapabilities,
  isDataFoundationBootProofMode,
} from "./lib/bootCapabilities.js";
import {
  createShutdownController,
  installShutdownSignalHandlers,
  NO_OP_FEED_CLOSE_HOOK,
  registerShutdownController,
} from "./lib/lifecycle/gracefulShutdown.js";

// Step 0 — DATA_FOUNDATION_BOOT_PROOF admissibility.
// Deliberately the FIRST thing that runs: this module imports nothing but the
// config validator and the capability contract, so a production process that
// carries the development-only proof flag terminates here — before the app
// module is imported, before any provider is contacted, before any listener.
try {
  assertBootProofModeAllowed(process.env);
} catch (err) {
  if (err instanceof BootProofModeForbiddenError) {
    process.stderr.write(`${err.code}\n`);
    process.stderr.write(`  ${err.message}\n`);
    process.exit(1);
  }
  throw err;
}

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

// Step 5 — Restore the authoritative instrument universe (read-only, L2),
// BEFORE the listener opens.
//
// Awaited on purpose (Phase 0.7B). Restoration settles in one bounded query
// pair against the durable store — no provider call, no subscription, no write
// — and no HTTP consumer may be able to observe the registry mid-decision. A
// detached restore let a request arriving in that window read an empty universe
// that is indistinguishable from a genuinely unconfigured one.
//
// Still NON-FATAL: the registry is a coverage-reporting input, never a trading
// dependency. A refusal degrades coverage to UNIVERSE_NOT_CONFIGURED and the
// server serves; every acceptance gate (checksum, record-set hash, record
// count, calendar commitment, schema and policy version) is re-applied inside
// the loader, so an unverifiable generation is never adopted.
const proofMode = isDataFoundationBootProofMode();
/** Proof-mode-only stdout marker. Silent (and unreachable) on a normal boot. */
const proofMark = (event: string, extra = ""): void => {
  if (!proofMode) return;
  process.stdout.write(`BOOT_PROOF ${event} at=${new Date().toISOString()} pid=${process.pid}${extra}\n`);
};

proofMark("RESTORATION_START");
try {
  const { loadLatestAcceptedGeneration } = await import("./lib/registry/manifestStore.js");
  await loadLatestAcceptedGeneration("STARTUP_L2_RESTORE");
} catch {
  // Already logged and recorded as a terminal restoration state by the loader.
}
proofMark("RESTORATION_SETTLED");

// Step 6 — Start listener. In boot-proof mode, state plainly what this process
// is and is not doing, so the log is self-describing evidence.
proofMark("CAPABILITIES", ` capabilities=${JSON.stringify(getBootCapabilities())}`);
const server = app.listen(port, (err?: Error) => {
  if (err) {
    process.stderr.write(`Error listening on port ${port}: ${err.message}\n`);
    process.exit(1);
  }
  proofMark("LISTENING", ` port=${port}`);

  // Step 7 — Install graceful shutdown. Created inside the listen callback so
  // closeHttp has a reference to `server` (which is only assigned after
  // app.listen() returns, but the callback runs after that assignment).
  //
  // Ordering contract (Phase 0.8T):
  //   signal → SHUTTING_DOWN → feed hook (no-op, NOT_OWNED) → HTTP close
  //
  // The feed hook is the Phase 0.8T no-op: it owns no socket, says so
  // honestly, and is replaced in Phase 0.8B when socket construction is
  // authorised. Shutdown DOES NOT call process.exit itself; the onExit
  // callback does, after the result is written to the process.
  const shutdownController = createShutdownController({
    closeFeed: NO_OP_FEED_CLOSE_HOOK,
    closeHttp: () =>
      new Promise<void>((resolve, reject) => {
        server.close((e) => (e ? reject(e) : resolve()));
      }),
    // Feeds get 5 s to confirm closure; HTTP gets another 5 s for keep-alive
    // connections to drain. Neither wait is unbounded.
    feedCloseTimeoutMs: 5_000,
    httpCloseTimeoutMs: 5_000,
  });
  installShutdownSignalHandlers(shutdownController, process, (code) => {
    process.exit(code);
  });
  registerShutdownController(shutdownController);
  proofMark("SHUTDOWN_INSTALLED");
});
