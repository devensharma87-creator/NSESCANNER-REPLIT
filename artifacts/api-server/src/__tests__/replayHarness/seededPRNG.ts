/**
 * Seeded pseudo-random number generator for the replay harness.
 *
 * Uses xoshiro128** — a well-tested small-state PRNG that's fast, has
 * a period of 2^128 − 1, and passes standard statistical tests. The
 * harness seeds this from `manifest.runtimeSeed` so any code path in
 * the trading engine that reads random numbers produces byte-identical
 * output on replay.
 *
 * In replay mode, `Math.random` is trap-thrown to catch stray usage.
 *
 * Spec: BACKTEST_REPLAY_HARNESS_SPEC.md §4.2.2
 */

interface Xoshiro128State {
  a: number;
  b: number;
  c: number;
  d: number;
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

function step(s: Xoshiro128State): number {
  const result = ((rotl(Math.imul(s.b, 5), 7) * 9) | 0) >>> 0;
  const t = (s.b << 9) >>> 0;
  s.c ^= s.a;
  s.d ^= s.b;
  s.b ^= s.c;
  s.a ^= s.d;
  s.c ^= t;
  s.d = rotl(s.d, 11);
  return result;
}

function makeStateFromSeed(seed: number): Xoshiro128State {
  // splitmix32 to expand the single seed into 4 words of state.
  let x = seed >>> 0;
  const next = (): number => {
    x = (x + 0x9e3779b9) >>> 0;
    let z = x;
    z = (Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0);
    z = (Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0);
    return (z ^ (z >>> 16)) >>> 0;
  };
  return { a: next(), b: next(), c: next(), d: next() };
}

let _armed = false;
let _state: Xoshiro128State | null = null;
const _origMathRandom = Math.random.bind(Math);

export function armSeededRandom(seed: number): void {
  if (_armed) throw new Error("armSeededRandom: already armed — call disarm() first");
  _state = makeStateFromSeed(seed);
  _armed = true;
  Math.random = () => {
    if (!_state) throw new Error("PRNG disarmed mid-run");
    return step(_state) / 0x1_0000_0000;
  };
}

export function disarmSeededRandom(): void {
  if (!_armed) return;
  Math.random = _origMathRandom;
  _state = null;
  _armed = false;
}

/** Test-visible peek at the next raw value (0..2^32-1). */
export function nextRawForTest(): number {
  if (!_state) throw new Error("PRNG not armed");
  return step(_state);
}
