/**
 * PHASE 0.8T — GRACEFUL SHUTDOWN BOUNDARY (INSTALLED BEFORE server.listen())
 *
 * A Reserved VM is replaced, not duplicated — but "replaced" is a sequence, not
 * an instant. Replit sends SIGTERM to the old instance while the new one is
 * already starting, so for a bounded window two processes exist. Today that
 * window is harmless: nothing owns a socket. From Phase 0.8B onwards it is the
 * exact window in which two processes could both hold Kite feeds against one
 * API key, and the provider counts sockets per key.
 *
 * This module is the boundary that closes that window. index.ts installs it
 * synchronously after createServer(app) and BEFORE server.listen(), closing
 * the startup window in which a SIGTERM could arrive without a handler:
 *
 *   signal → stop admitting feed activation → mark shutting down → run the feed
 *   close hook → wait, bounded → close HTTP → report an explicit result.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 *   - It contains no Kite logic and constructs no socket. The close hook is an
 *     injected no-op that HONESTLY reports "nothing was owned", so a future
 *     wiring mistake shows up as NOT_OWNED rather than as fake success.
 *   - It never sleeps to "let things settle". Every wait is a bounded race that
 *     resolves as soon as the hook answers.
 *   - It does not call process.exit itself unless an exit function is injected.
 */

import { randomUUID } from "node:crypto";

/** Lifecycle phase of the process with respect to shutdown. */
export type ShutdownPhase = "RUNNING" | "SHUTTING_DOWN" | "COMPLETE";

/** How the feed close attempt ended. Never conflated with "the feed is safe". */
export type FeedCloseOutcome =
  /** No feed was owned — the Phase 0.8T reality. */
  | "NOT_OWNED"
  /** The hook confirmed every socket closed. */
  | "CLOSED"
  /** The hook threw or rejected. */
  | "HOOK_FAILED"
  /** The hook did not answer inside the bounded timeout. */
  | "TIMEOUT";

export interface FeedCloseResult {
  /** True ONLY when the hook itself confirms the sockets are closed. */
  readonly closed: boolean;
  /** Non-sensitive detail string for the shutdown log. */
  readonly detail: string;
}

/** The Phase 0.8B seam. Receives the signal name; must be side-effect-free now. */
export type FeedCloseHook = (signal: string) => Promise<FeedCloseResult>;

/**
 * The only hook this phase ships. It owns nothing, so it closes nothing and
 * says so. It is not "success": callers see NOT_OWNED, which is the truth.
 */
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

/** Bounds for the feed-close wait. A timeout may never be unbounded. */
export const MIN_FEED_CLOSE_TIMEOUT_MS = 100;
export const MAX_FEED_CLOSE_TIMEOUT_MS = 30_000;
export const DEFAULT_FEED_CLOSE_TIMEOUT_MS = 5_000;

export interface ShutdownControllerOptions {
  /** Defaults to the honest no-op hook. */
  readonly closeFeed?: FeedCloseHook;
  /** Closes the HTTP listener. Runs AFTER the feed hook, never before. */
  readonly closeHttp: () => Promise<void>;
  /** Clamped into [MIN, MAX]. */
  readonly feedCloseTimeoutMs?: number;
  /**
   * Clamped into [MIN, MAX]. A listener with a hanging keep-alive connection
   * can leave `server.close()` pending forever, which would strand the process
   * in SHUTTING_DOWN with no result at all — so this wait is bounded too.
   */
  readonly httpCloseTimeoutMs?: number;
  /** Injectable so tests need no real timers. */
  readonly setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  readonly clearTimeoutFn?: (handle: unknown) => void;
  /** Optional observer for the final result (logging, diagnostics). */
  readonly onResult?: (result: ShutdownResult) => void;
}

export interface ShutdownController {
  /** False as soon as a signal arrives: no feed may be activated while dying. */
  readonly isFeedActivationPermitted: () => boolean;
  readonly phase: () => ShutdownPhase;
  readonly duplicateSignalsIgnored: () => number;
  /** Idempotent: later calls return the FIRST run's promise, not a second run. */
  readonly shutdown: (signal: string) => Promise<ShutdownResult>;
}

function clampTimeout(ms: number | undefined): number {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return DEFAULT_FEED_CLOSE_TIMEOUT_MS;
  return Math.min(MAX_FEED_CLOSE_TIMEOUT_MS, Math.max(MIN_FEED_CLOSE_TIMEOUT_MS, Math.trunc(ms)));
}

/**
 * Build a shutdown controller. Creating one registers NOTHING: no signal
 * handler, no timer, no listener. It becomes active only when `shutdown` is
 * called or handlers are installed explicitly.
 */
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

  /**
   * Race a step against a bound. The timer is always cleared, so a step that
   * finishes first never leaves a pending handle behind.
   */
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
        // A hook that says it closed nothing is NOT_OWNED — never "closed".
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

    // HTTP closes only after the feed hook has answered or timed out, so a
    // future socket owner always gets its chance before the process goes quiet.
    // Bounded as well: a hanging listener must not strand the shutdown without
    // a result, and a timeout is reported as NOT closed.
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
    const httpClosed = http.closed;
    const httpCloseError = http.error;

    phase = "COMPLETE";
    const clean = (feed.outcome === "CLOSED" || feed.outcome === "NOT_OWNED") && httpClosed;
    const result: ShutdownResult = Object.freeze({
      signal,
      phase: "COMPLETE" as const,
      feedClose: feed.outcome,
      feedCloseDetail: feed.detail,
      httpClosed,
      httpCloseError,
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

/** Minimal surface of `process` this module needs; injectable for tests. */
export interface SignalTarget {
  on(signal: string, listener: (...args: unknown[]) => void): unknown;
  off?(signal: string, listener: (...args: unknown[]) => void): unknown;
}

export const SHUTDOWN_SIGNALS: readonly string[] = Object.freeze(["SIGTERM", "SIGINT"]);

/**
 * Install signal handlers for an existing controller.
 *
 * NOT called at boot in Phase 0.8T. Phase 0.8B wires this once, next to the
 * listener it owns. Returns an uninstall function so a test leaves no handler
 * behind.
 */
export function installShutdownSignalHandlers(
  controller: ShutdownController,
  target: SignalTarget,
  onExit?: (code: number) => void,
): () => void {
  const registered: Array<[string, (...args: unknown[]) => void]> = [];
  for (const signal of SHUTDOWN_SIGNALS) {
    const listener = (): void => {
      void controller.shutdown(signal).then((result) => {
        onExit?.(result.exitCode);
      });
    };
    target.on(signal, listener);
    registered.push([signal, listener]);
  }
  return () => {
    for (const [signal, listener] of registered) target.off?.(signal, listener);
  };
}

/**
 * Boot identity for owner diagnostics: distinguishes this process incarnation
 * from its predecessor across a restart. Computed lazily so importing this
 * module allocates nothing, and it is not an ownership credential — two
 * replicas would each have one.
 */
let bootId: string | null = null;
export function getBootId(): string {
  if (bootId === null) bootId = randomUUID();
  return bootId;
}

/** Describes readiness of the boundary for owner diagnostics. */
export interface ShutdownReadiness {
  readonly prepared: true;
  /** True once installShutdownSignalHandlers has been called at boot. */
  readonly installedAtBoot: boolean;
  readonly feedCloseHook: "NO_OP_PHASE_0_8T";
  readonly signals: readonly string[];
  readonly feedCloseTimeoutMs: number;
  /** Current shutdown phase of the installed controller, or RUNNING if none. */
  readonly currentPhase: ShutdownPhase;
}

/** Module-level registry of the installed controller (one per process). */
let _installedController: ShutdownController | null = null;

/**
 * Register the controller that was installed at boot. Called by index.ts
 * synchronously before server.listen(). Idempotent: a second call is a no-op
 * that returns false, preventing duplicate signal handlers across any code path
 * that could evaluate this module more than once.
 *
 * Returns true on the first (effective) installation, false on all subsequent
 * calls. Callers MUST NOT install a second controller; the first one wins.
 */
export function registerShutdownController(controller: ShutdownController): boolean {
  if (_installedController !== null) return false;
  _installedController = controller;
  return true;
}

/**
 * Fail-closed lifecycle gate: returns true only when a shutdown coordinator
 * has been registered at boot. Feed activation must check this before
 * proceeding — activation without a shutdown handler leaves no way to clean
 * up the feed on SIGTERM/SIGINT.
 */
export function isShutdownInstalled(): boolean {
  return _installedController !== null;
}

/** Returns the current phase of the installed controller, or "RUNNING". */
export function getInstalledShutdownPhase(): ShutdownPhase {
  return _installedController?.phase() ?? "RUNNING";
}

export function describeShutdownReadiness(): ShutdownReadiness {
  return Object.freeze({
    prepared: true as const,
    installedAtBoot: _installedController !== null,
    feedCloseHook: "NO_OP_PHASE_0_8T" as const,
    signals: SHUTDOWN_SIGNALS,
    feedCloseTimeoutMs: DEFAULT_FEED_CLOSE_TIMEOUT_MS,
    currentPhase: _installedController?.phase() ?? "RUNNING",
  });
}
