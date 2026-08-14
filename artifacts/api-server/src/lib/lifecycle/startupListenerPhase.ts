/**
 * PHASE 0.8T — STARTUP LISTENER PHASE
 *
 * The testable seam between lifecycle installation and HTTP listener start.
 *
 * Extracted so that the accepted boot ordering can be proved behaviourally
 * using injected fakes — without running a real server or importing any
 * provider, feed, scheduler, database, or deployment dependency.
 *
 * The real entry point (index.ts) calls runStartupListenerPhase with real
 * dependencies. Tests import the same function with fakes/spies. No logic is
 * duplicated between the two uses.
 *
 * Enforced ordering:
 *   installLifecycle() → proofMark("SHUTDOWN_INSTALLED") → server.listen()
 *                                                              → proofMark("LISTENING")
 *
 * If installation fails (throws) or is refused (ALREADY_INSTALLED),
 * server.listen is never called and onStartupError is invoked instead.
 *
 * MUST NOT import providers, feeds, schedulers, databases, or deployment code.
 */

import type { InstallShutdownLifecycleResult } from "./gracefulShutdown.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StartupServer {
  listen(port: number, cb: (err?: Error) => void): void;
}

export interface StartupListenerPhaseOptions {
  /**
   * Zero-argument closure that calls installShutdownLifecycle with the real
   * (or injected) controller, target, and onExit. The caller owns the
   * partial application so this function has no provider dependency.
   */
  readonly installLifecycle: () => InstallShutdownLifecycleResult;
  /**
   * Proof-marker function. Called with "SHUTDOWN_INSTALLED" after successful
   * installation (before listen) and with "LISTENING" inside the listen
   * callback (after the port is open). Silent on a normal boot when
   * boot-proof mode is disabled; functional in proof-mode and in tests.
   */
  readonly proofMark: (event: string) => void;
  /** The HTTP server object, created but not yet listening. */
  readonly server: StartupServer;
  readonly port: number;
  /**
   * Called with a FATAL message on installation failure or refusal.
   * The production implementation writes to stderr and calls process.exit.
   * Declared as `() => void` (not `never`) so TypeScript compiles the return
   * statements that guard against calling server.listen after failure.
   */
  readonly onStartupError: (message: string) => void;
}

// ---------------------------------------------------------------------------
// Production startup function
// ---------------------------------------------------------------------------

/**
 * Run the startup listener phase.
 *
 * Behavioural guarantees (proved by startupListenerPhase.p08t.test.ts):
 *   - Installation throw  → server.listen is never called.
 *   - ALREADY_INSTALLED   → server.listen is never called.
 *   - INSTALLED           → proofMark("SHUTDOWN_INSTALLED") fires first,
 *                           then server.listen, then proofMark("LISTENING").
 *   - The listen callback cannot execute before isShutdownInstalled() is true.
 */
export function runStartupListenerPhase(opts: StartupListenerPhaseOptions): void {
  // ── Lifecycle installation ──────────────────────────────────────────────
  let result: InstallShutdownLifecycleResult;
  try {
    result = opts.installLifecycle();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    opts.onStartupError(`FATAL: SHUTDOWN_LIFECYCLE_INSTALLATION_FAILED: ${msg}`);
    return; // server.listen is never reached
  }

  if (result === "ALREADY_INSTALLED") {
    opts.onStartupError("FATAL: SHUTDOWN_LIFECYCLE_ALREADY_INSTALLED_BEFORE_BOOT");
    return; // server.listen is never reached
  }

  // ── Installation succeeded (result === "INSTALLED") ─────────────────────
  opts.proofMark("SHUTDOWN_INSTALLED");

  // ── Start listening ──────────────────────────────────────────────────────
  opts.server.listen(opts.port, (err?: Error) => {
    if (err) {
      opts.onStartupError(`FATAL: Error listening on port ${opts.port}: ${err.message}`);
      return;
    }
    opts.proofMark("LISTENING");
  });
}
