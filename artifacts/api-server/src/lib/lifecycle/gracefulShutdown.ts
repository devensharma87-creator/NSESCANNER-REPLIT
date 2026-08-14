/**
 * PHASE 0.8T — GRACEFUL SHUTDOWN BOUNDARY
 *
 * A Reserved VM is replaced, not duplicated — but "replaced" is a sequence,
 * not an instant. Replit sends SIGTERM to the old instance while the new one
 * is already starting, so for a bounded window two processes exist. Today
 * that window is harmless: nothing owns a socket. From Phase 0.8B onwards it
 * is the exact window in which two processes could both hold Kite feeds against
 * one API key, and the provider counts sockets per key.
 *
 * This module is the boundary. index.ts calls runStartupListenerPhase, which
 * calls installShutdownLifecycle synchronously before server.listen():
 *
 *   signal → stop admitting feed activation → mark shutting down → run the
 *   feed close hook → wait, bounded → close HTTP → report an explicit result.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 *   - It contains no Kite logic and constructs no socket. The close hook is
 *     the Phase 0.8T no-op that HONESTLY reports "nothing was owned".
 *   - It never sleeps. Every wait is a bounded race.
 *   - It does not call process.exit unless an exit function is injected.
 */

import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Shutdown controller
// ---------------------------------------------------------------------------

/** Lifecycle phase of the process with respect to shutdown. */
export type ShutdownPhase = "RUNNING" | "SHUTTING_DOWN" | "COMPLETE";

/** How the feed close attempt ended. */
export type FeedCloseOutcome = "NOT_OWNED" | "CLOSED" | "HOOK_FAILED" | "TIMEOUT";

export interface FeedCloseResult {
  readonly closed: boolean;
  readonly detail: string;
}

export type FeedCloseHook = (signal: string) => Promise<FeedCloseResult>;

export const NO_OP_FEED_CLOSE_HOOK: FeedCloseHook = async () =>
  Object.freeze({ closed: false, detail: "NO_FEED_OWNED_PHASE_0_8T" });

export interface ShutdownResult {
  readonly signal: string;
  readonly phase: "COMPLETE";
  readonly feedClose: FeedCloseOutcome;
  readonly feedCloseDetail: string;
  readonly httpClosed: boolean;
  readonly httpCloseError: string | null;
  readonly exitCode: number;
  readonly duplicateSignalsIgnored: number;
}

export const MIN_FEED_CLOSE_TIMEOUT_MS = 100;
export const MAX_FEED_CLOSE_TIMEOUT_MS = 30_000;
export const DEFAULT_FEED_CLOSE_TIMEOUT_MS = 5_000;

export interface ShutdownControllerOptions {
  readonly closeFeed?: FeedCloseHook;
  readonly closeHttp: () => Promise<void>;
  readonly feedCloseTimeoutMs?: number;
  readonly httpCloseTimeoutMs?: number;
  readonly setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  readonly clearTimeoutFn?: (handle: unknown) => void;
  readonly onResult?: (result: ShutdownResult) => void;
}

export interface ShutdownController {
  readonly isFeedActivationPermitted: () => boolean;
  readonly phase: () => ShutdownPhase;
  readonly duplicateSignalsIgnored: () => number;
  readonly shutdown: (signal: string) => Promise<ShutdownResult>;
}

function clampTimeout(ms: number | undefined): number {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return DEFAULT_FEED_CLOSE_TIMEOUT_MS;
  return Math.min(MAX_FEED_CLOSE_TIMEOUT_MS, Math.max(MIN_FEED_CLOSE_TIMEOUT_MS, Math.trunc(ms)));
}

export function createShutdownController(options: ShutdownControllerOptions): ShutdownController {
  const closeFeed = options.closeFeed ?? NO_OP_FEED_CLOSE_HOOK;
  const timeoutMs = clampTimeout(options.feedCloseTimeoutMs);
  const httpTimeoutMs = clampTimeout(options.httpCloseTimeoutMs);
  const setTimeoutFn = options.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimeoutFn =
    options.clearTimeoutFn ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));

  let phase: ShutdownPhase = "RUNNING";
  let duplicates = 0;
  let inFlight: Promise<ShutdownResult> | null = null;

  async function withBound<T>(
    step: () => Promise<T>,
    onTimeout: () => T,
    boundMs: number,
  ): Promise<T> {
    let timer: unknown = null;
    const timeout = new Promise<T>((resolve) => {
      timer = setTimeoutFn(() => resolve(onTimeout()), boundMs);
    });
    try {
      return await Promise.race([step(), timeout]);
    } finally {
      if (timer !== null) clearTimeoutFn(timer);
    }
  }

  async function runFeedClose(signal: string): Promise<{ outcome: FeedCloseOutcome; detail: string }> {
    const attempt = async (): Promise<{ outcome: FeedCloseOutcome; detail: string }> => {
      try {
        const result = await closeFeed(signal);
        return result.closed
          ? { outcome: "CLOSED", detail: result.detail }
          : { outcome: "NOT_OWNED", detail: result.detail };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { outcome: "HOOK_FAILED", detail: `FEED_CLOSE_HOOK_FAILED: ${message}` };
      }
    };
    return withBound(
      attempt,
      () => ({ outcome: "TIMEOUT" as const, detail: `FEED_CLOSE_TIMEOUT_AFTER_${timeoutMs}MS` }),
      timeoutMs,
    );
  }

  async function run(signal: string): Promise<ShutdownResult> {
    const feed = await runFeedClose(signal);
    const http = await withBound<{ closed: boolean; error: string | null }>(
      async () => {
        try {
          await options.closeHttp();
          return { closed: true, error: null };
        } catch (err) {
          return { closed: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
      () => ({ closed: false, error: `HTTP_CLOSE_TIMEOUT_AFTER_${httpTimeoutMs}MS` }),
      httpTimeoutMs,
    );

    phase = "COMPLETE";
    const clean = (feed.outcome === "CLOSED" || feed.outcome === "NOT_OWNED") && http.closed;
    const result: ShutdownResult = Object.freeze({
      signal,
      phase: "COMPLETE" as const,
      feedClose: feed.outcome,
      feedCloseDetail: feed.detail,
      httpClosed: http.closed,
      httpCloseError: http.error,
      exitCode: clean ? 0 : 1,
      duplicateSignalsIgnored: duplicates,
    });
    options.onResult?.(result);
    return result;
  }

  return Object.freeze({
    isFeedActivationPermitted: () => phase === "RUNNING",
    phase: () => phase,
    duplicateSignalsIgnored: () => duplicates,
    shutdown: (signal: string): Promise<ShutdownResult> => {
      if (inFlight !== null) {
        duplicates += 1;
        return inFlight;
      }
      phase = "SHUTTING_DOWN";
      inFlight = run(signal);
      return inFlight;
    },
  });
}

// ---------------------------------------------------------------------------
// Signal target contract
// ---------------------------------------------------------------------------

/**
 * Minimal surface of `process` this module needs; injectable for tests.
 *
 * A validated removal method — `off` or `removeListener` — is required before
 * any listener is installed. installShutdownLifecycle refuses if neither is
 * present, guaranteeing rollback capability without optional chaining.
 */
export interface SignalTarget {
  on(signal: string, listener: (...args: unknown[]) => void): unknown;
  off?: (signal: string, listener: (...args: unknown[]) => void) => unknown;
  removeListener?: (signal: string, listener: (...args: unknown[]) => void) => unknown;
}

export const SHUTDOWN_SIGNALS: readonly string[] = Object.freeze(["SIGTERM", "SIGINT"]);

// ---------------------------------------------------------------------------
// Lifecycle installation — explicit state machine
// ---------------------------------------------------------------------------

/** Return value of installShutdownLifecycle. */
export type InstallShutdownLifecycleResult = "INSTALLED" | "ALREADY_INSTALLED";

/**
 * Explicit installation state.
 *
 *   UNINSTALLED → (first call) → INSTALLING → (all listeners added) → INSTALLED
 *                                     ↓ (any failure)
 *                               UNINSTALLED  (never stuck)
 *
 * Any synchronous re-entrant call from target.on() observes INSTALLING and
 * returns ALREADY_INSTALLED immediately, preventing a second listener pair
 * even if JavaScript's event loop has not returned yet.
 */
export type ShutdownInstallationState = "UNINSTALLED" | "INSTALLING" | "INSTALLED";

type CleanupFn = (signal: string, listener: (...args: unknown[]) => void) => void;

let _state: ShutdownInstallationState = "UNINSTALLED";
let _installedController: ShutdownController | null = null;
let _installedCleanup: CleanupFn | null = null;
let _installedListeners: Array<[string, (...args: unknown[]) => void]> = [];

/**
 * Atomically install the shutdown lifecycle protection.
 *
 * Re-entrancy safe: the exclusive claim (`_state = "INSTALLING"`) is acquired
 * synchronously BEFORE the first call to external code (`target.on()`), so a
 * re-entrant call from inside `on()` sees INSTALLING and returns
 * ALREADY_INSTALLED without touching listeners.
 *
 * Rollback guaranteed: `off` or `removeListener` is resolved and validated
 * BEFORE any listener is installed. If neither is available, the function
 * throws with state restored to UNINSTALLED and zero listeners added. On any
 * subsequent listener failure the resolved cleanup function is called
 * unconditionally (no optional chaining) for every listener already installed.
 *
 * State transitions:
 *   1. UNINSTALLED → INSTALLING  (before first external call)
 *   2. INSTALLING → INSTALLED    (after all listeners succeed)
 *   3. INSTALLING → UNINSTALLED  (on any validation or listener failure)
 *
 * `isShutdownInstalled()` returns true only in state INSTALLED.
 */
export function installShutdownLifecycle(
  controller: ShutdownController,
  target: SignalTarget,
  onExit?: (code: number) => void,
): InstallShutdownLifecycleResult {
  // ── Step 1: re-entrancy safe claim ────────────────────────────────────────
  // Any state other than UNINSTALLED refuses immediately — including INSTALLING
  // (covers synchronous re-entrancy from inside target.on()).
  if (_state !== "UNINSTALLED") return "ALREADY_INSTALLED";

  // ── Step 2: acquire exclusive claim BEFORE any external call ──────────────
  _state = "INSTALLING";

  // ── Step 3: resolve cleanup function before touching any listener ─────────
  // Rollback requires a non-optional removal method. Resolve it now, before
  // the listener loop, so no listener is ever added without a cleanup path.
  let cleanup: CleanupFn;
  if (typeof target.off === "function") {
    cleanup = target.off.bind(target) as CleanupFn;
  } else if (typeof target.removeListener === "function") {
    cleanup = (target.removeListener as (s: string, l: (...args: unknown[]) => void) => unknown).bind(target) as CleanupFn;
  } else {
    // No cleanup method: refuse immediately, restore UNINSTALLED.
    _state = "UNINSTALLED";
    throw new Error(
      "SHUTDOWN_TARGET_MISSING_CLEANUP_METHOD: target must expose off() or removeListener()",
    );
  }

  // ── Step 4: install listeners with guaranteed rollback ────────────────────
  const listeners: Array<[string, (...args: unknown[]) => void]> = [];
  try {
    for (const signal of SHUTDOWN_SIGNALS) {
      const listener = (): void => {
        void controller.shutdown(signal).then((result) => {
          onExit?.(result.exitCode);
        });
      };
      target.on(signal, listener);
      listeners.push([signal, listener]);
    }
  } catch (err) {
    // Remove every listener installed by this call — unconditionally, no
    // optional chaining, because cleanup was verified callable above.
    for (const [sig, lst] of listeners) cleanup(sig, lst);
    // Clear all transient state and return to UNINSTALLED.
    _state = "UNINSTALLED";
    throw err;
  }

  // ── Step 5: complete installation atomically ──────────────────────────────
  _installedController = controller;
  _installedCleanup = cleanup;
  _installedListeners = listeners;
  _state = "INSTALLED";
  return "INSTALLED";
}

// ---------------------------------------------------------------------------
// Public accessors
// ---------------------------------------------------------------------------

/**
 * Returns the current installation state. Exposed so tests can observe the
 * INSTALLING transition and verify no state is ever stuck.
 */
export function getShutdownInstallationState(): ShutdownInstallationState {
  return _state;
}

/**
 * Fail-closed lifecycle gate: true only when state is INSTALLED.
 * Returns false during INSTALLING (re-entrant window) and after rollback.
 */
export function isShutdownInstalled(): boolean {
  return _state === "INSTALLED";
}

/** Returns the current phase of the installed controller, or "RUNNING". */
export function getInstalledShutdownPhase(): ShutdownPhase {
  return _installedController?.phase() ?? "RUNNING";
}

// ---------------------------------------------------------------------------
// Test reset
// ---------------------------------------------------------------------------

/**
 * Test-only lifecycle reset. Removes installed listeners using the resolved
 * cleanup function (unconditionally — the same function used in production
 * rollback) and restores state to UNINSTALLED.
 *
 * MUST have zero production callers. The `_forTesting_` prefix enforces this.
 * Tests assert via source scan that no production file calls this function.
 * Safe to call when state is already UNINSTALLED (no-op).
 */
export function _forTesting_resetShutdownLifecycle(): void {
  if (_state === "UNINSTALLED") return;
  if (_installedCleanup !== null) {
    for (const [signal, listener] of _installedListeners) {
      _installedCleanup(signal, listener);
    }
  }
  _state = "UNINSTALLED";
  _installedController = null;
  _installedCleanup = null;
  _installedListeners = [];
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

let bootId: string | null = null;
export function getBootId(): string {
  if (bootId === null) bootId = randomUUID();
  return bootId;
}

export interface ShutdownReadiness {
  readonly prepared: true;
  /** True only when installShutdownLifecycle has completed successfully. */
  readonly installedAtBoot: boolean;
  readonly installationState: ShutdownInstallationState;
  readonly feedCloseHook: "NO_OP_PHASE_0_8T";
  readonly signals: readonly string[];
  readonly feedCloseTimeoutMs: number;
  readonly currentPhase: ShutdownPhase;
}

export function describeShutdownReadiness(): ShutdownReadiness {
  return Object.freeze({
    prepared: true as const,
    installedAtBoot: _state === "INSTALLED",
    installationState: _state,
    feedCloseHook: "NO_OP_PHASE_0_8T" as const,
    signals: SHUTDOWN_SIGNALS,
    feedCloseTimeoutMs: DEFAULT_FEED_CLOSE_TIMEOUT_MS,
    currentPhase: _installedController?.phase() ?? "RUNNING",
  });
}
