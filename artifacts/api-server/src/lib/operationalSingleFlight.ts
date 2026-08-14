/**
 * SINGLE-FLIGHT GUARD FOR CONTROLLED OPERATIONS — PHASE 0.8D
 *
 * Both controlled operations in this phase (authoritative registry refresh and
 * Kite session validation) are expensive, externally-visible and idempotent.
 * Running two at once is never useful and is sometimes harmful: two refreshes
 * would fetch every official source twice and race each other into the same
 * transactional store, and two validations would burn two provider calls to
 * answer one question and could write evidence out of order.
 *
 * This guard coalesces rather than rejects. A second caller arriving while an
 * operation is in flight receives the SAME result the first caller gets, marked
 * `coalesced: true`, instead of an error it would have to interpret. Rejecting
 * would push the retry decision onto every call site, and the honest answer to
 * "refresh now" while a refresh is already running is the running one's result.
 *
 * The slot is released on EVERY path — success, rejection and synchronous
 * throw — via `finally`. A guard that leaks its slot on an error path is worse
 * than no guard at all: it converts one failure into a permanently wedged
 * operation that reports "already running" forever, with no timer to clear it.
 */

export type SingleFlightState = "IDLE" | "RUNNING";

export interface SingleFlightOutcome<T> {
  readonly result: T;
  /** True when this caller joined an already-running operation. */
  readonly coalesced: boolean;
}

export class SingleFlightGuard<T> {
  private inflight: Promise<T> | null = null;
  private startedAtMs: number | null = null;

  /** IDLE or RUNNING. Safe to read from diagnostics; never starts anything. */
  get state(): SingleFlightState {
    return this.inflight === null ? "IDLE" : "RUNNING";
  }

  /** When the in-flight operation began, or null when idle. */
  get startedAt(): number | null {
    return this.startedAtMs;
  }

  /**
   * Run `operation`, or join the one already running.
   *
   * `operation` is invoked exactly once per in-flight window, so a test can
   * prove coalescing by counting invocations rather than by timing.
   */
  async run(nowMs: number, operation: () => Promise<T>): Promise<SingleFlightOutcome<T>> {
    const existing = this.inflight;
    if (existing !== null) {
      // Join it. If it rejects, this caller sees the same rejection — which is
      // correct: they asked for that operation's outcome.
      return { result: await existing, coalesced: true };
    }

    // `operation()` is called inside the promise executor so that a SYNCHRONOUS
    // throw becomes a rejected promise rather than escaping before `finally` is
    // attached. Without this, a synchronous throw would leave `inflight` set.
    const started = (async () => operation())();
    this.inflight = started;
    this.startedAtMs = nowMs;

    try {
      return { result: await started, coalesced: false };
    } finally {
      this.inflight = null;
      this.startedAtMs = null;
    }
  }

  /** Test-only. Never called by production code. */
  __resetForTests(): void {
    this.inflight = null;
    this.startedAtMs = null;
  }
}
