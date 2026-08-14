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
 *   6. Create the HTTP server object via createServer(app).
 *   7. Install the graceful-shutdown coordinator SYNCHRONOUSLY — immediately
 *      after the server object exists, before server.listen() is called and
 *      before the listening callback can execute. This closes the startup window
 *      in which a SIGTERM/SIGINT could arrive without a registered handler.
 *   8. Start the HTTP listener.
 *
 * CONFIG_ONLY=1 mode (test/probe only):
 *   Exit immediately after step 3 (validation pass) without initializing
 *   the application or opening any listener. Used by G3 bootstrap-order probes.
 */

import { createServer } from "node:http";
import { validateProductionConfig } from "./lib/productionConfigValidator.js";
import {
  assertBootProofModeAllowed,
  BootProofModeForbiddenError,
  getBootCapabilities,
  isDataFoundationBootProofMode,
} from "./lib/bootCapabilities.js";
import {
  createShutdownController,
  installShutdownLifecycle,
  NO_OP_FEED_CLOSE_HOOK,
} from "./lib/lifecycle/gracefulShutdown.js";
import { runStartupListenerPhase } from "./lib/lifecycle/startupListenerPhase.js";

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

// Step 6 — Create HTTP server object.
// The server object is created here so the shutdown coordinator (Step 7) can
// reference it synchronously before listen() is called.
proofMark("CAPABILITIES", ` capabilities=${JSON.stringify(getBootCapabilities())}`);
const server = createServer(app);

// Steps 7–8 — Install graceful shutdown and start listening via the shared
// startup seam. runStartupListenerPhase is the same function imported by the
// Phase 0.8T lifecycle tests, so the ordering guarantees proved behaviourally
// in those tests hold here unconditionally.
//
// Accepted ordering:
//   installLifecycle() → proofMark("SHUTDOWN_INSTALLED") → server.listen()
//
// If lifecycle installation fails (throw or ALREADY_INSTALLED refusal),
// runStartupListenerPhase calls onStartupError and returns without ever
// reaching server.listen().
//
// Ordering contract (Phase 0.8T):
//   signal → SHUTTING_DOWN → feed hook (no-op, NOT_OWNED) → HTTP close
const shutdownController = createShutdownController({
  closeFeed: NO_OP_FEED_CLOSE_HOOK,
  closeHttp: () =>
    new Promise<void>((resolve, reject) => {
      server.close((e) => (e ? reject(e) : resolve()));
    }),
  feedCloseTimeoutMs: 5_000,
  httpCloseTimeoutMs: 5_000,
});

runStartupListenerPhase({
  installLifecycle: () =>
    installShutdownLifecycle(shutdownController, process, (code) => {
      process.exit(code);
    }),
  proofMark,
  server,
  port,
  onStartupError: (msg) => {
    process.stderr.write(`${msg}\n`);
    process.exit(1);
  },
});
