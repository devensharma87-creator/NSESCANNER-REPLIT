/**
 * Replay harness R1 scaffold tests — verifies each module in isolation
 * before R2 wires the real engine.
 *
 * Covers:
 *   • Deterministic clock: monotonic advance, wraps Date.now / perf.now,
 *     traps setTimeout, allows scheduling when opted-in, backwards-move refused.
 *   • Seeded PRNG: identical seed → identical stream; different seeds diverge;
 *     Math.random goes through the seeded stream after arm().
 *   • RecordedKiteClient: fixture-order tick emission, monotonic-load guard,
 *     strict-subscription refusal.
 *   • RecordingTelegramClient: preserves send order + injected errors.
 *   • ReplayDriver: refuses non-kite provider, refuses hash-mismatch,
 *     refuses RECORD mode in CI.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import { promises as fs } from "node:fs";
import os from "node:os";
import {
  armDeterministicClock,
  disarmDeterministicClock,
  advanceClock,
  currentReplayNow,
} from "./deterministicClock";
import { armSeededRandom, disarmSeededRandom } from "./seededPRNG";
import { RecordedKiteClient } from "./mockKiteClient";
import { RecordingTelegramClient } from "./mockTelegramClient";
import {
  computeFixtureSourceHash,
  loadFixture,
  ReplayFixtureError,
} from "./bucketFetcher";
import { assertRecordModeSafe, replayFixture } from "./replayDriver";

afterEach(() => {
  // Belt-and-braces disarm — most tests do it themselves but a
  // premature throw should not contaminate the next test file.
  disarmDeterministicClock();
  disarmSeededRandom();
});

describe("deterministicClock", () => {
  it("wraps Date.now and advances only via advanceClock", () => {
    const start = Date.parse("2026-07-14T03:45:00Z");
    armDeterministicClock({ epochMs: start });
    try {
      expect(Date.now()).toBe(start);
      advanceClock(1000);
      expect(Date.now()).toBe(start + 1000);
      advanceClock(500);
      expect(Date.now()).toBe(start + 1500);
      expect(currentReplayNow()).toBe(start + 1500);
    } finally {
      disarmDeterministicClock();
    }
  });

  it("refuses backwards advance", () => {
    armDeterministicClock({ epochMs: 1_000_000 });
    try {
      expect(() => advanceClock(-1)).toThrow(/refuses to move backwards/);
    } finally {
      disarmDeterministicClock();
    }
  });

  it("traps setTimeout when scheduling is not allowed", () => {
    armDeterministicClock({ epochMs: 0, allowScheduling: false });
    try {
      expect(() => setTimeout(() => {}, 100)).toThrow(/trapped in replay mode/);
    } finally {
      disarmDeterministicClock();
    }
  });

  it("fires scheduled callbacks in order when scheduling is allowed", () => {
    armDeterministicClock({ epochMs: 0, allowScheduling: true });
    try {
      const fired: string[] = [];
      setTimeout(() => fired.push("b"), 200);
      setTimeout(() => fired.push("a"), 100);
      advanceClock(150);
      expect(fired).toEqual(["a"]);
      advanceClock(100);
      expect(fired).toEqual(["a", "b"]);
    } finally {
      disarmDeterministicClock();
    }
  });
});

describe("seededPRNG", () => {
  it("identical seed → identical stream", () => {
    armSeededRandom(42);
    const runA = [Math.random(), Math.random(), Math.random()];
    disarmSeededRandom();
    armSeededRandom(42);
    const runB = [Math.random(), Math.random(), Math.random()];
    disarmSeededRandom();
    expect(runA).toEqual(runB);
  });

  it("different seeds diverge", () => {
    armSeededRandom(1);
    const a = Math.random();
    disarmSeededRandom();
    armSeededRandom(2);
    const b = Math.random();
    disarmSeededRandom();
    expect(a).not.toEqual(b);
  });

  it("outputs stay in [0, 1)", () => {
    armSeededRandom(999);
    for (let i = 0; i < 100; i++) {
      const r = Math.random();
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(1);
    }
    disarmSeededRandom();
  });
});

describe("RecordedKiteClient", () => {
  const ticks = [
    { receivedAtNs: 100, instrumentToken: 256265, ltp: 24000, ltq: 50, volume: 1000, oi: null, raw: {} },
    { receivedAtNs: 200, instrumentToken: 256265, ltp: 24005, ltq: 100, volume: 1100, oi: null, raw: {} },
    { receivedAtNs: 300, instrumentToken: 260105, ltp: 52000, ltq: 25, volume: 500, oi: null, raw: {} },
  ];
  const jsonl = ticks.map((t) => JSON.stringify(t)).join("\n");

  it("emits ticks in monotonic order via advanceTo", () => {
    const client = new RecordedKiteClient({ ticksJsonl: jsonl, strictSubscriptions: false });
    const seen: number[] = [];
    client.onTick((t) => seen.push(t.receivedAtNs));
    client.advanceTo(250);
    expect(seen).toEqual([100, 200]);
    client.advanceTo(400);
    expect(seen).toEqual([100, 200, 300]);
    expect(client.position).toEqual({ cursor: 3, total: 3 });
  });

  it("strict subscriptions: refuses ticks for unsubscribed instruments", () => {
    const client = new RecordedKiteClient({ ticksJsonl: jsonl, strictSubscriptions: true });
    client.subscribe([256265]); // NIFTY only
    expect(() => client.drain()).toThrow(/NOT subscribed by the engine/);
  });

  it("non-strict: silently drops unsubscribed", () => {
    const client = new RecordedKiteClient({ ticksJsonl: jsonl, strictSubscriptions: false });
    client.subscribe([256265]);
    const seen: number[] = [];
    client.onTick((t) => seen.push(t.instrumentToken));
    client.drain();
    expect(seen).toEqual([256265, 256265]); // BANKNIFTY silently dropped
  });

  it("load-time guard: non-monotonic fixture is refused", () => {
    const bad = [
      { receivedAtNs: 200, instrumentToken: 1, ltp: 1, ltq: null, volume: null, oi: null, raw: {} },
      { receivedAtNs: 100, instrumentToken: 1, ltp: 1, ltq: null, volume: null, oi: null, raw: {} },
    ]
      .map((t) => JSON.stringify(t))
      .join("\n");
    expect(() => new RecordedKiteClient({ ticksJsonl: bad })).toThrow(/not monotonic/);
  });
});

describe("RecordingTelegramClient", () => {
  it("captures messages in strict send order with sequence", async () => {
    const bot = new RecordingTelegramClient();
    await bot.send({ tier: "ALERTS", chatId: 123, text: "one" });
    await bot.send({ tier: "PREPOST", chatId: 456, text: "two" });
    await bot.send({ tier: "RISK", chatId: 789, text: "three", injectedError: "500" });
    expect(bot.outbox.map((m) => m.sequence)).toEqual([1, 2, 3]);
    expect(bot.outbox.map((m) => m.text)).toEqual(["one", "two", "three"]);
    expect(bot.outbox[2]!.injectedError).toBe("500");
  });
});

describe("bucketFetcher — provenance verification", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "replay-fixture-"));
    process.env["SCANNER_REPLAY_CACHE_ROOT"] = tmp;
  });

  afterEach(async () => {
    delete process.env["SCANNER_REPLAY_CACHE_ROOT"];
    await fs.rm(tmp, { recursive: true, force: true });
  });

  async function writeFixture(id: string, opts: {
    provider: string;
    ticks?: string;
    chain?: string;
    boards?: string;
    events?: string;
    /** Override the manifest hash to force a mismatch. */
    forceBadHash?: boolean;
  }): Promise<string> {
    const dir = path.join(tmp, id);
    await fs.mkdir(dir, { recursive: true });
    const ticks = opts.ticks ?? "";
    const chain = opts.chain ?? "";
    const boards = opts.boards ?? "";
    const events = opts.events ?? "";
    const sourceHash = opts.forceBadHash
      ? "sha256:0000000000000000000000000000000000000000000000000000000000000000"
      : computeFixtureSourceHash({
          ticksJsonl: ticks,
          chainSnapshotsJsonl: chain,
          boardSnapshotsJsonl: boards,
          systemEventsJsonl: events,
        });
    const manifest = {
      id,
      recordedAt: "2026-07-14T03:45:00Z",
      sessionKind: "NORMAL_MONDAY",
      istDate: "2026-07-14",
      kiteInstruments: [],
      tickCount: 0,
      chainSnapshotCount: 0,
      boardSnapshotCount: 0,
      chainWidth: "FULL",
      provider: opts.provider,
      sourceHash,
      bucketUri: "s3://bucket/fake",
      engineVersion: "paper-writer-v1.2.0-ledger-net",
      runtimeSeed: 42,
    };
    await fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest), "utf8");
    await fs.writeFile(path.join(dir, "ticks.jsonl"), ticks, "utf8");
    await fs.writeFile(path.join(dir, "option_chain_snapshots.jsonl"), chain, "utf8");
    await fs.writeFile(path.join(dir, "index_boards.jsonl"), boards, "utf8");
    await fs.writeFile(path.join(dir, "system_events.jsonl"), events, "utf8");
    return dir;
  }

  it("loads a valid kite fixture", async () => {
    await writeFixture("nifty-week-1", { provider: "kite", ticks: "" });
    const loaded = await loadFixture("nifty-week-1");
    expect(loaded.manifest.provider).toBe("kite");
  });

  it("refuses non-kite provider", async () => {
    await writeFixture("bad-synthetic", { provider: "synthetic" });
    await expect(loadFixture("bad-synthetic")).rejects.toMatchObject({
      code: "REFUSED_NON_KITE_PROVIDER",
    });
  });

  it("refuses sourceHash mismatch", async () => {
    await writeFixture("tampered", { provider: "kite", forceBadHash: true });
    await expect(loadFixture("tampered")).rejects.toMatchObject({
      code: "SOURCE_HASH_MISMATCH",
    });
  });

  it("refuses missing fixture (bucket cache miss)", async () => {
    await expect(loadFixture("does-not-exist")).rejects.toMatchObject({
      code: "BUCKET_FETCH_NOT_IMPLEMENTED",
    });
  });
});

describe("replayDriver — R1 refusal paths", () => {
  it("assertRecordModeSafe: CI + RECORD is a hard fail", () => {
    const prev = process.env["CI"];
    process.env["CI"] = "true";
    try {
      expect(() => assertRecordModeSafe("RECORD")).toThrow(/refused when CI=true/);
    } finally {
      if (prev === undefined) delete process.env["CI"];
      else process.env["CI"] = prev;
    }
  });

  it("assertRecordModeSafe: CI + ASSERT is fine", () => {
    process.env["CI"] = "true";
    try {
      expect(() => assertRecordModeSafe("ASSERT")).not.toThrow();
    } finally {
      delete process.env["CI"];
    }
  });

  it("replayFixture: missing fixture returns pass=false with BUCKET_FETCH_NOT_IMPLEMENTED", async () => {
    const prevCache = process.env["SCANNER_REPLAY_CACHE_ROOT"];
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "replay-driver-"));
    process.env["SCANNER_REPLAY_CACHE_ROOT"] = tmp;
    try {
      const result = await replayFixture({
        fixtureId: "does-not-exist",
        goldenMode: "ASSERT",
      });
      expect(result.pass).toBe(false);
      expect(result.reason).toMatch(/BUCKET_FETCH_NOT_IMPLEMENTED/);
    } finally {
      if (prevCache === undefined) delete process.env["SCANNER_REPLAY_CACHE_ROOT"];
      else process.env["SCANNER_REPLAY_CACHE_ROOT"] = prevCache;
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
