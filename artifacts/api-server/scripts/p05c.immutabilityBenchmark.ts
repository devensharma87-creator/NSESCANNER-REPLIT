/**
 * Phase 0.5C — BOUNDED immutability cost comparison.
 *
 * Deliberately smaller than p05c.ringBenchmark.ts: the O(n)-vs-O(1)
 * question is already settled. The only open question is whether the
 * insertion-time bounded copy causes a MATERIAL regression against the
 * accepted Phase 0.5C ring result.
 *
 * HARNESS NOTES (a first version of this script produced the impossible
 * result "copy is faster than no-copy"; these are the corrections):
 *   • Tick construction is HOISTED out of the timed region. Allocating
 *     the payload costs far more than either append path, so leaving it
 *     inside swamped the signal with allocator/GC noise.
 *   • global.gc() is genuinely invoked between phases and reps when the
 *     process is started with --expose-gc. The earlier version printed
 *     "forced GC: yes" but never called it.
 *   • Both phases use the SAME ring capacity and clear between reps, so
 *     A and B differ only by the bounded copy.
 *   • Phase order is run twice (A-then-B and B-then-A) to expose any
 *     residual ordering bias.
 *
 * A: bare RingBuffer.push   — the ACCEPTED bdd65463 append path exactly:
 *                             O(1) ring that stores the CALLER'S
 *                             reference, with no immutability at all.
 * B: tapPushTick            — the final typed-snapshot-contract path:
 *                             same ring + per-type normalization that
 *                             copies supported values and rejects
 *                             unsupported ones fail-closed.
 * C: drainSince             — read-path snapshot cost
 *
 * Deterministic synthetic data only. No provider call, no database,
 * no scheduler, no network, no subscription.
 *
 * DEVELOPMENT SYNTHETIC EVIDENCE ONLY.
 *
 * Run: pnpm --filter @workspace/api-server exec tsx --expose-gc \
 *        scripts/p05c.immutabilityBenchmark.ts
 */
import { RingBuffer } from "../src/lib/ringBuffer";
import {
  tapPushTick,
  drainSince,
  tapStats,
  _resetLiveTapRing,
  type TapTick,
} from "../src/lib/liveTapRing";

const APPENDS = 20_000; // bounded
const POOL = 2_000;     // distinct prebuilt payloads, cycled
const REPS = 5;
const CAP = 400_000;    // same capacity the production tick ring uses

const gc: (() => void) | undefined =
  typeof (global as { gc?: () => void }).gc === "function"
    ? (global as { gc: () => void }).gc
    : undefined;

function makeTick(i: number): TapTick {
  const level = (n: number) => ({ price: 24000 + n, quantity: 10 + n, orders: 2 });
  return {
    receivedAtMs: 1_800_000_000_000 + i,
    instrumentToken: 256265,
    symbol: "NIFTY 50",
    ltp: 24000 + (i % 100),
    ltq: 1,
    volume: 1000 + i,
    oi: null,
    raw: {
      tradable: true,
      mode: "full",
      last_price: 24000 + (i % 100),
      average_traded_price: 23990,
      volume_traded: 1000 + i,
      total_buy_quantity: 500,
      total_sell_quantity: 480,
      ohlc: { open: 23900, high: 24100, low: 23850, close: 23950 },
      change: 0.21,
      oi_day_high: 0,
      oi_day_low: 0,
      depth: {
        buy: [level(1), level(2), level(3), level(4), level(5)],
        sell: [level(6), level(7), level(8), level(9), level(10)],
      },
    },
  };
}

// Prebuilt ONCE, outside every timed region.
const pool: TapTick[] = Array.from({ length: POOL }, (_, i) => makeTick(i));

function stats(xs: number[]): { median: number; worst: number } {
  const s = [...xs].sort((a, b) => a - b);
  const median = s.length % 2 === 1
    ? s[(s.length - 1) / 2]!
    : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
  return { median, worst: s[s.length - 1]! };
}

const baseRing = new RingBuffer<TapTick>(CAP);

function phaseA(): number {
  baseRing.clear();
  gc?.();
  const t0 = performance.now();
  for (let i = 0; i < APPENDS; i++) baseRing.push(pool[i % POOL]!);
  const ms = performance.now() - t0;
  if (baseRing.size !== APPENDS) throw new Error("A: size mismatch");
  return ms;
}

function phaseB(): number {
  _resetLiveTapRing();
  gc?.();
  const t0 = performance.now();
  for (let i = 0; i < APPENDS; i++) tapPushTick(pool[i % POOL]!);
  const ms = performance.now() - t0;
  // VALIDITY GUARD. A fail-closed contract that rejected every payload
  // would look BLAZINGLY fast here. Assert the work was actually done:
  // every append stored, nothing rejected.
  assertRealWork("B");
  return ms;
}

/** Fail loudly if the timed phase did not actually store what it claims. */
function assertRealWork(label: string): void {
  const s = tapStats();
  if (s.tickCount !== Math.min(APPENDS, CAP)) {
    throw new Error(
      `${label}: stored ${s.tickCount}, expected ${Math.min(APPENDS, CAP)} — ` +
        `benchmark invalid`,
    );
  }
  if (s.rejections.total !== 0) {
    throw new Error(
      `${label}: ${s.rejections.total} entries REJECTED ` +
        `(${JSON.stringify(s.rejections.byReason)}) — benchmark invalid`,
    );
  }
}

// Phases A/B isolate the copy against a bare reference-store, which is
// NOT the real production baseline: kiteFeed already allocates a fresh
// tick object for every tick. A2/B2 therefore measure the realistic
// marginal cost, with payload construction included in BOTH sides.
function phaseA2(): number {
  baseRing.clear();
  gc?.();
  const t0 = performance.now();
  for (let i = 0; i < APPENDS; i++) baseRing.push(makeTick(i));
  return performance.now() - t0;
}

function phaseB2(): number {
  _resetLiveTapRing();
  gc?.();
  const t0 = performance.now();
  for (let i = 0; i < APPENDS; i++) tapPushTick(makeTick(i));
  const ms = performance.now() - t0;
  assertRealWork("B2");
  return ms;
}

/**
 * The ACTUAL production tick shape.
 *
 * kiteFeed.ts pushes `raw: { ohlc, change_percent }` and nothing else —
 * no depth ladder, no mode/tradable block. makeTick() above is a
 * deliberately pessimistic ~30-property payload that production never
 * emits, so it overstates the contract's cost. This phase measures what
 * the tick path really pays.
 */
function makeRealTick(i: number): TapTick {
  return {
    receivedAtMs: 1_800_000_000_000 + i,
    instrumentToken: 256265,
    symbol: "NIFTY 50",
    ltp: 24000 + (i % 100),
    ltq: 1,
    volume: 1000 + i,
    oi: null,
    raw: {
      ohlc: { open: 23900, high: 24100, low: 23850, close: 23950 },
      change_percent: 0.21,
    },
  };
}

function phaseA3(): number {
  baseRing.clear();
  gc?.();
  const t0 = performance.now();
  for (let i = 0; i < APPENDS; i++) baseRing.push(makeRealTick(i));
  return performance.now() - t0;
}

function phaseB3(): number {
  _resetLiveTapRing();
  gc?.();
  const t0 = performance.now();
  for (let i = 0; i < APPENDS; i++) tapPushTick(makeRealTick(i));
  const ms = performance.now() - t0;
  assertRealWork("B3");
  return ms;
}

function mb(b: number): string {
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

console.log("=".repeat(70));
console.log("PHASE 0.5C — BOUNDED IMMUTABILITY COST COMPARISON");
console.log("=".repeat(70));
console.log(`node          : ${process.version}`);
console.log(`appends       : ${APPENDS.toLocaleString()} (bounded)  pool ${POOL.toLocaleString()} prebuilt payloads`);
console.log(`reps          : ${REPS} per order + 1 discarded warm-up`);
console.log(`payload       : Kite full-mode shape incl. depth.buy[5]/sell[5]`);
console.log(`forced GC     : ${gc ? "yes (--expose-gc, actually invoked)" : "NO — run with --expose-gc"}`);
console.log(`timed region  : append loop only; payload construction hoisted out`);
console.log("");

const before = process.memoryUsage();

phaseA();
phaseB();

const aRuns: number[] = [];
const bRuns: number[] = [];

// Order 1: A then B
for (let r = 0; r < REPS; r++) {
  aRuns.push(phaseA());
  bRuns.push(phaseB());
}
// Order 2: B then A — exposes ordering bias
for (let r = 0; r < REPS; r++) {
  bRuns.push(phaseB());
  aRuns.push(phaseA());
}

const a = stats(aRuns);
const b = stats(bRuns);

// Buffer left full by the last phaseB — drain measures the real read path.
gc?.();
const dRuns: number[] = [];
let drainRows = 0;
for (let r = 0; r < REPS; r++) {
  const t0 = performance.now();
  const d = drainSince({ sinceMs: 0 });
  dRuns.push(performance.now() - t0);
  drainRows = d.ticks.length;
}
const d = stats(dRuns);

const after = process.memoryUsage();

const nsA = (a.median * 1e6) / APPENDS;
const nsB = (b.median * 1e6) / APPENDS;
const delta = nsB - nsA;

console.log(`A  ring push, NO copy     : median ${a.median.toFixed(2).padStart(8)} ms   worst ${a.worst.toFixed(2).padStart(8)} ms   ${nsA.toFixed(0).padStart(5)} ns/append`);
console.log(`B  tapPushTick, WITH copy : median ${b.median.toFixed(2).padStart(8)} ms   worst ${b.worst.toFixed(2).padStart(8)} ms   ${nsB.toFixed(0).padStart(5)} ns/append`);
console.log("");
console.log(`   immutability overhead  : ${delta >= 0 ? "+" : ""}${delta.toFixed(0)} ns/tick   (${(nsB / nsA).toFixed(2)}x)`);
console.log(`   implied ceiling        : ~${Math.round(1e9 / nsB).toLocaleString()} ticks/sec on this container`);
console.log("");

// Realistic marginal cost: payload construction included on both sides.
const a2Runs: number[] = [];
const b2Runs: number[] = [];
phaseA2();
phaseB2();
for (let r = 0; r < REPS; r++) {
  a2Runs.push(phaseA2());
  b2Runs.push(phaseB2());
}
for (let r = 0; r < REPS; r++) {
  b2Runs.push(phaseB2());
  a2Runs.push(phaseA2());
}
const a2 = stats(a2Runs);
const b2 = stats(b2Runs);
const nsA2 = (a2.median * 1e6) / APPENDS;
const nsB2 = (b2.median * 1e6) / APPENDS;
console.log("REALISTIC PIPELINE (payload construction included on both sides):");
console.log(`A2 construct + push, NO copy   : median ${a2.median.toFixed(2).padStart(8)} ms   ${nsA2.toFixed(0).padStart(5)} ns/tick`);
console.log(`B2 construct + push, WITH copy : median ${b2.median.toFixed(2).padStart(8)} ms   ${nsB2.toFixed(0).padStart(5)} ns/tick`);
console.log(`   marginal overhead           : ${nsB2 - nsA2 >= 0 ? "+" : ""}${(nsB2 - nsA2).toFixed(0)} ns/tick   (${(nsB2 / nsA2).toFixed(2)}x)`);
console.log("");

// The decision-relevant number: the payload kiteFeed ACTUALLY pushes.
const a3Runs: number[] = [];
const b3Runs: number[] = [];
phaseA3();
phaseB3();
for (let r = 0; r < REPS; r++) {
  a3Runs.push(phaseA3());
  b3Runs.push(phaseB3());
}
for (let r = 0; r < REPS; r++) {
  b3Runs.push(phaseB3());
  a3Runs.push(phaseA3());
}
const a3 = stats(a3Runs);
const b3 = stats(b3Runs);
const nsA3 = (a3.median * 1e6) / APPENDS;
const nsB3 = (b3.median * 1e6) / APPENDS;
console.log("REAL PRODUCTION TICK SHAPE (raw = { ohlc, change_percent } only):");
console.log(`A3 construct + push, NO copy   : median ${a3.median.toFixed(2).padStart(8)} ms   worst ${a3.worst.toFixed(2).padStart(8)} ms   ${nsA3.toFixed(0).padStart(5)} ns/tick`);
console.log(`B3 construct + normalize+push  : median ${b3.median.toFixed(2).padStart(8)} ms   worst ${b3.worst.toFixed(2).padStart(8)} ms   ${nsB3.toFixed(0).padStart(5)} ns/tick`);
console.log(`   marginal overhead           : ${nsB3 - nsA3 >= 0 ? "+" : ""}${(nsB3 - nsA3).toFixed(0)} ns/tick   (${(nsB3 / nsA3).toFixed(2)}x)`);
console.log("");
console.log(`C  drainSince (${drainRows.toLocaleString()} rows) : median ${d.median.toFixed(2)} ms   worst ${d.worst.toFixed(2)} ms   ${((d.median * 1e6) / Math.max(drainRows, 1)).toFixed(0)} ns/row`);
console.log("");
console.log(`   heapUsed : ${mb(before.heapUsed)} -> ${mb(after.heapUsed)}`);
console.log(`   rss      : ${mb(before.rss)} -> ${mb(after.rss)}`);
console.log("");
console.log("Reference: the ORIGINAL shift/splice trim cost ~2439 ns/append at");
console.log("capacity 50,000 and was infeasible at capacity 400,000.");
console.log("");
console.log("DEVELOPMENT SYNTHETIC EVIDENCE ONLY. Not production throughput proof.");
