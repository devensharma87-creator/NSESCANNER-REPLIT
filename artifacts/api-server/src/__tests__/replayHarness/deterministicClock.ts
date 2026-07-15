/**
 * Deterministic clock wrapper for the replay harness.
 *
 * In replay mode, wall-clock time must ONLY advance when the driver
 * consumes a recorded tick or a scheduled system event. Any code path
 * that calls `Date.now()` / `performance.now()` / `setTimeout` reads
 * from this module's synthesised clock. Real timers are trap-thrown so
 * a stray `setInterval` in production code surfaces immediately instead
 * of introducing non-determinism into the golden diff.
 *
 * Spec: BACKTEST_REPLAY_HARNESS_SPEC.md §4.2.1
 */

export type MonotonicNs = number;

interface ScheduledCallback {
  id: number;
  dueMs: number;
  fn: () => void;
  interval: number | null;
}

let _now: number = 0;
let _monotonicNs: MonotonicNs = 0;
let _nextId = 1;
let _scheduled: ScheduledCallback[] = [];
let _armed = false;

const _origDateNow = Date.now.bind(Date);
const _origPerfNow = typeof performance !== "undefined" ? performance.now.bind(performance) : null;
const _origSetTimeout = globalThis.setTimeout;
const _origSetInterval = globalThis.setInterval;
const _origClearTimeout = globalThis.clearTimeout;
const _origClearInterval = globalThis.clearInterval;

export interface ArmDeterministicClockArgs {
  epochMs: number;
  /** If false, `setTimeout`/`setInterval` throw when called — set to
   *  true only if the caller has audited that the code under test
   *  should schedule (rare — most production code shouldn't). */
  allowScheduling?: boolean;
}

export function armDeterministicClock(args: ArmDeterministicClockArgs): void {
  if (_armed) throw new Error("armDeterministicClock: already armed — call disarm() first");
  _now = args.epochMs;
  _monotonicNs = 0;
  _scheduled = [];
  _nextId = 1;
  _armed = true;

  Date.now = () => _now;

  if (typeof performance !== "undefined") {
    performance.now = () => _monotonicNs / 1_000_000;
  }

  if (args.allowScheduling) {
    globalThis.setTimeout = ((fn: () => void, ms: number) => {
      const id = _nextId++;
      _scheduled.push({ id, dueMs: _now + Math.max(0, ms), fn, interval: null });
      return id as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    globalThis.setInterval = ((fn: () => void, ms: number) => {
      const id = _nextId++;
      _scheduled.push({ id, dueMs: _now + ms, fn, interval: ms });
      return id as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval;
    globalThis.clearTimeout = ((id: number) => {
      _scheduled = _scheduled.filter((s) => s.id !== id);
    }) as typeof clearTimeout;
    globalThis.clearInterval = ((id: number) => {
      _scheduled = _scheduled.filter((s) => s.id !== id);
    }) as typeof clearInterval;
  } else {
    const trap = (name: string) => () => {
      throw new Error(
        `Deterministic clock: ${name} is trapped in replay mode. If the code under test needs scheduling, call armDeterministicClock({ allowScheduling: true }).`,
      );
    };
    globalThis.setTimeout = trap("setTimeout") as unknown as typeof setTimeout;
    globalThis.setInterval = trap("setInterval") as unknown as typeof setInterval;
  }
}

/**
 * Advance the deterministic clock forward. Callbacks scheduled to fire
 * inside `[oldNow, newNow]` fire in order.
 */
export function advanceClock(deltaMs: number): void {
  if (!_armed) throw new Error("advanceClock: clock not armed");
  if (deltaMs < 0) throw new Error("advanceClock: refuses to move backwards");
  const target = _now + deltaMs;
  // Fire due callbacks in order.
  while (true) {
    _scheduled.sort((a, b) => a.dueMs - b.dueMs);
    const next = _scheduled[0];
    if (!next || next.dueMs > target) break;
    _now = next.dueMs;
    _monotonicNs += (next.dueMs - (target - deltaMs)) * 1_000_000;
    if (next.interval == null) {
      _scheduled.shift();
    } else {
      next.dueMs += next.interval;
    }
    try {
      next.fn();
    } catch (err) {
      // Do not let a scheduled callback throw affect the driver.
      // Wrap in an error handler for the driver to inspect.
      if (typeof console !== "undefined") console.error("[replay] scheduled callback threw", err);
    }
  }
  _now = target;
  _monotonicNs = (target - (_now - deltaMs + deltaMs)) * 1_000_000 + _monotonicNs;
  // Simpler: monotonic advances with wall clock in replay.
  _monotonicNs = target * 1_000_000;
}

export function currentReplayNow(): number {
  if (!_armed) throw new Error("currentReplayNow: clock not armed");
  return _now;
}

export function disarmDeterministicClock(): void {
  if (!_armed) return;
  Date.now = _origDateNow;
  if (typeof performance !== "undefined" && _origPerfNow) {
    performance.now = _origPerfNow;
  }
  globalThis.setTimeout = _origSetTimeout;
  globalThis.setInterval = _origSetInterval;
  globalThis.clearTimeout = _origClearTimeout;
  globalThis.clearInterval = _origClearInterval;
  _armed = false;
  _scheduled = [];
}
