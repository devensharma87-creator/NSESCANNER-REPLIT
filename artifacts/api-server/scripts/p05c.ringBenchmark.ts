/**
 * Phase 0.5C — bounded synthetic benchmark: OLD (shift/splice trim) vs
 * NEW (O(1) ring buffer).
 *
 * Deterministic synthetic ticks only. No provider call, no database,
 * no scheduler, no network, no subscription.
 *
 * DEVELOPMENT SYNTHETIC EVIDENCE ONLY. A microbenchmark on an idle
 * container is NOT proof of production throughput and does NOT prove
 * the future ~7,890-token universe is safe.
 *
 * Run: pnpm --filter @workspace/api-server exec tsx scripts/p05c.ringBenchmark.ts
 */
import { monitorEventLoopDelay } from "node:perf_hooks";
import { RingBuffer } from "../src/lib/ringBuffer";

interface Tick {
  receivedAtMs: number;
  instrumentToken: number;
  ltp: number;
}

function makeTick(i: number): Tick {
  return { receivedAtMs: 1_800_000_000_000 + i, instrumentToken: i % 7890, ltp: 100 + (i % 500) };
}

/** The ORIGINAL algorithm, reproduced verbatim from the pre-0.5C source. */
function runOld(capacity: number, appends: number): number {
  const arr: Tick[] = [];
  const t0 = performance.now();
  for (let i = 0; i < appends; i++) {
    arr.push(makeTick(i));
    // age trim omitted: with monotonic synthetic timestamps nothing
    // expires, so this isolates the COUNT trim — the hot path.
    if (arr.length > capacity) arr.splice(0, arr.length - capacity);
  }
  const ms = performance.now() - t0;
  if (arr.length !== capacity) throw new Error(`old: bad length ${arr.length}`);
  return ms;
}

function runNew(capacity: number, appends: number): number {
  const ring = new RingBuffer<Tick>(capacity);
  const t0 = performance.now();
  for (let i = 0; i < appends; i++) {
    ring.push(makeTick(i));
  }
  const ms = performance.now() - t0;
  if (ring.size !== capacity) throw new Error(`new: bad size ${ring.size}`);
  return ms;
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function stats(xs: number[]): { median: number; worst: number } {
  const s = [...xs].sort((a, b) => a - b);
  const median = s.length % 2 === 1
    ? s[(s.length - 1) / 2]!
    : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
  return { median, worst: s[s.length - 1]! };
}

const REPS = 3;
const forcedGc = typeof global.gc === "function";

async function main(): Promise<void> {
  console.log("=".repeat(72));
  console.log("PHASE 0.5C — SYNTHETIC RING BUFFER BENCHMARK");
  console.log("=".repeat(72));
  console.log(`node                : ${process.version}`);
  console.log(`platform            : ${process.platform} ${process.arch}`);
  console.log(`repetitions         : ${REPS} (median + worst reported)`);
  console.log(`warm-up             : 1 discarded rep per algorithm per case`);
  console.log(`explicit GC forced  : ${forcedGc ? "yes (--expose-gc)" : "no"}`);
  console.log("");

  // capacity, appends, runOld?
  const CASES: Array<[number, number, boolean]> = [
    [1_000, 50_000, true],
    [10_000, 30_000, true],
    [50_000, 70_000, true],
    // The production tick capacity. The OLD algorithm is deliberately
    // NOT run here: 20k overflow appends x 400k retained = ~8e9 element
    // moves, which does not complete in a sane time. That infeasibility
    // is itself the finding.
    [400_000, 420_000, false],
  ];

  for (const [capacity, appends, withOld] of CASES) {
    console.log("-".repeat(72));
    console.log(`capacity=${capacity.toLocaleString()}  appends=${appends.toLocaleString()}  overflow=${(appends - capacity).toLocaleString()}`);

    if (forcedGc) global.gc!();
    const before = process.memoryUsage();

    let oldStats: { median: number; worst: number } | null = null;
    if (withOld) {
      runOld(capacity, appends); // warm-up, discarded
      const runs: number[] = [];
      for (let r = 0; r < REPS; r++) runs.push(runOld(capacity, appends));
      oldStats = stats(runs);
    }

    if (forcedGc) global.gc!();

    const loopDelay = monitorEventLoopDelay({ resolution: 10 });
    loopDelay.enable();
    runNew(capacity, appends); // warm-up, discarded
    const newRuns: number[] = [];
    for (let r = 0; r < REPS; r++) newRuns.push(runNew(capacity, appends));
    loopDelay.disable();
    const newStats = stats(newRuns);

    const after = process.memoryUsage();

    if (oldStats) {
      console.log(`  OLD shift/splice : median ${oldStats.median.toFixed(1).padStart(9)} ms   worst ${oldStats.worst.toFixed(1).padStart(9)} ms`);
    } else {
      console.log(`  OLD shift/splice : NOT RUN — projected ~${(((appends - capacity) * capacity) / 1e9).toFixed(1)}e9 element moves, infeasible`);
    }
    console.log(`  NEW ring O(1)    : median ${newStats.median.toFixed(1).padStart(9)} ms   worst ${newStats.worst.toFixed(1).padStart(9)} ms`);
    if (oldStats) {
      console.log(`  speed-up (median): ${(oldStats.median / newStats.median).toFixed(1)}x`);
      const perAppendOld = (oldStats.median * 1e6) / appends;
      const perAppendNew = (newStats.median * 1e6) / appends;
      console.log(`  per append       : old ${perAppendOld.toFixed(0)} ns   new ${perAppendNew.toFixed(0)} ns`);
    }
    console.log(`  heapUsed         : ${mb(before.heapUsed)} -> ${mb(after.heapUsed)}`);
    console.log(`  rss              : ${mb(before.rss)} -> ${mb(after.rss)}`);
    console.log(`  event-loop delay : mean ${(loopDelay.mean / 1e6).toFixed(2)} ms   max ${(loopDelay.max / 1e6).toFixed(2)} ms  (NEW only)`);
  }

  console.log("-".repeat(72));
  console.log("");
  console.log("DEVELOPMENT SYNTHETIC EVIDENCE ONLY.");
  console.log("Not production throughput proof. The ~7,890-token universe is NOT proven.");
}

void main();
