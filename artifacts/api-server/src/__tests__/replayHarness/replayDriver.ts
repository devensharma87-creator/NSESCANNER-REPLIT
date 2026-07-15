/**
 * Replay driver entry point.
 *
 * R1 scope (this iteration): scaffold + honest boot-refusal paths + the
 * public `replayFixture` signature. The driver LOADS a fixture, VERIFIES
 * provenance, ARMS the deterministic clock + PRNG, INSTANTIATES the mock
 * Kite + Telegram clients, and then... hands back a "not yet wired to
 * engine" `result` object.
 *
 * R2 will wire the real engine in step 9 of the boot sequence. R1 is a
 * scaffold + tests that prove each independent module works, so R2 is a
 * "compose" step rather than a "design + implement" step.
 *
 * Spec: BACKTEST_REPLAY_HARNESS_SPEC.md §4
 */
import { armDeterministicClock, disarmDeterministicClock, currentReplayNow } from "./deterministicClock";
import { armSeededRandom, disarmSeededRandom } from "./seededPRNG";
import { loadFixture, type LoadedFixture, ReplayFixtureError } from "./bucketFetcher";
import { RecordedKiteClient } from "./mockKiteClient";
import { RecordingTelegramClient } from "./mockTelegramClient";

export type ReplayGoldenMode = "ASSERT" | "RECORD";

export interface ReplayFixtureArgs {
  fixtureId: string;
  goldenMode: ReplayGoldenMode;
  /** Hard-locked to "SIMULATED" — argument exists for future clarity. */
  clock?: "SIMULATED";
  /** Safety kill-switch (ms). Driver aborts if a replay takes longer than
   *  this wall-clock time (real, not simulated). Default: 5 minutes. */
  tickBudgetMs?: number;
}

export interface ReplayResult {
  pass: boolean;
  fixtureId: string;
  reason: string;
  metrics: {
    tickCount: number;
    telegramMessages: number;
    replayWallMs: number;
  };
  /** Structured diff vs golden (R2 wire-up). Empty in R1. */
  diffs: Array<{ path: string; expected: unknown; actual: unknown }>;
}

/**
 * CI hard-fail guard from §4.2.5. Any attempt to RECORD in CI is a
 * process-level abort — no override flag. Called before any harness
 * side effect so a misconfigured CI doesn't overwrite goldens.
 */
export function assertRecordModeSafe(mode: ReplayGoldenMode): void {
  if (mode === "ASSERT") return;
  if (process.env["CI"] === "true" || process.env["CI"] === "1") {
    throw new Error(
      "replayDriver: goldenMode=RECORD is refused when CI=true. " +
        "Golden regeneration must be an explicit local PR step, never a CI run.",
    );
  }
}

/**
 * Load + verify a fixture and return the loaded artifacts. Does NOT
 * arm the clock or PRNG — call `bootReplay` for that. Split out so
 * tests can inspect the loader path without inducing global state.
 */
export async function loadAndVerify(fixtureId: string): Promise<LoadedFixture> {
  return loadFixture(fixtureId);
}

/**
 * Boot the harness end-to-end: verify provenance, arm clock + PRNG,
 * wire mock clients. Returns the wired context; caller is responsible
 * for `shutdownReplay(ctx)` on completion (or catching / finally).
 */
export interface ReplayContext {
  fixture: LoadedFixture;
  kite: RecordedKiteClient;
  telegram: RecordingTelegramClient;
  startedAtWallMs: number;
}

export async function bootReplay(args: ReplayFixtureArgs): Promise<ReplayContext> {
  assertRecordModeSafe(args.goldenMode);
  const fixture = await loadAndVerify(args.fixtureId);

  // §4.2.1 — clock advances only when driver consumes tick / event.
  armDeterministicClock({
    epochMs: Date.parse(fixture.manifest.recordedAt),
    allowScheduling: false,
  });
  // §4.2.2 — Math.random trap-thrown.
  armSeededRandom(fixture.manifest.runtimeSeed);

  const kite = new RecordedKiteClient({
    ticksJsonl: fixture.ticksJsonl,
    strictSubscriptions: true,
  });
  const telegram = new RecordingTelegramClient();

  return {
    fixture,
    kite,
    telegram,
    startedAtWallMs: performance.now(),
  };
}

export function shutdownReplay(_ctx: ReplayContext): void {
  disarmSeededRandom();
  disarmDeterministicClock();
}

/**
 * Full replay entry point. R1 scaffold — R2 wires the engine.
 *
 * Current behaviour:
 *   • Loads + verifies the fixture.
 *   • Arms deterministic clock + PRNG.
 *   • Wires mock Kite + Telegram clients.
 *   • Drains every tick from the fixture into the kite mock.
 *   • Returns a metrics-only pass result — no engine assertions yet.
 *
 * When R2 lands, the "drain ticks" step is replaced by "start engine
 * and let it consume ticks", followed by a diff of the resulting DB
 * tables + Telegram outbox against the golden files.
 */
export async function replayFixture(args: ReplayFixtureArgs): Promise<ReplayResult> {
  const budgetMs = args.tickBudgetMs ?? 5 * 60_000;
  const startWall = performance.now();
  let ctx: ReplayContext | null = null;
  try {
    ctx = await bootReplay(args);
    const ticksBefore = ctx.kite.position.total;
    ctx.kite.subscribe(ctx.fixture.manifest.kiteInstruments.map(_instrumentTokenFor));
    // R1 stand-in for the engine loop: pull ticks in fixture order until
    // exhausted, advancing the deterministic clock alongside.
    const emitted = ctx.kite.drain();
    void ticksBefore;
    const now = currentReplayNow();
    void now;
    const wallElapsed = performance.now() - startWall;
    if (wallElapsed > budgetMs) {
      return {
        pass: false,
        fixtureId: args.fixtureId,
        reason: `wall-clock budget exceeded: ${wallElapsed}ms > ${budgetMs}ms`,
        metrics: {
          tickCount: emitted,
          telegramMessages: ctx.telegram.outbox.length,
          replayWallMs: wallElapsed,
        },
        diffs: [],
      };
    }
    return {
      pass: true,
      fixtureId: args.fixtureId,
      reason: "R1 scaffold: engine not yet wired; harness proved fixture load + tick sequencing + mock plumbing.",
      metrics: {
        tickCount: emitted,
        telegramMessages: ctx.telegram.outbox.length,
        replayWallMs: wallElapsed,
      },
      diffs: [],
    };
  } catch (err) {
    if (err instanceof ReplayFixtureError) {
      return {
        pass: false,
        fixtureId: args.fixtureId,
        reason: `${err.code}: ${err.message}`,
        metrics: { tickCount: 0, telegramMessages: 0, replayWallMs: performance.now() - startWall },
        diffs: [],
      };
    }
    throw err;
  } finally {
    if (ctx) shutdownReplay(ctx);
  }
}

/** Placeholder instrument-token resolver. Real engine has a proper
 *  registry; the R1 scaffold uses a stable hash so the mock's
 *  subscription set matches the fixture's `raw.instrumentToken`. */
function _instrumentTokenFor(sym: string): number {
  let h = 0;
  for (let i = 0; i < sym.length; i++) h = (h * 31 + sym.charCodeAt(i)) >>> 0;
  return h;
}
