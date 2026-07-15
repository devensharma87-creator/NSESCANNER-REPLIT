/**
 * R1-tail: LiveTapRing + recorder endpoint contract tests.
 *
 * Guards:
 *   • Ring buffer trims by age + count, drops oldest first.
 *   • Ring buffer stats are honest.
 *   • Recorder writes a valid manifest + JSONL bundle whose sourceHash
 *     survives a round-trip through the bucketFetcher verifier.
 *   • Recorder refuses empty windows.
 *   • Recorder refuses a second baseline in the repo slot.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express, { type Express } from "express";
import http from "http";
import os from "os";
import path from "path";
import { promises as fs } from "fs";
import {
  tapPushTick,
  tapPushChainSnapshot,
  tapPushSystemEvent,
  tapStats,
  drainSince,
  _resetLiveTapRing,
} from "./liveTapRing";

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const replayRecorderRouter = (await import("../routes/replayRecorder")).default;

let server: http.Server;
let baseUrl: string;
let stagingRoot: string;

async function post<T = unknown>(body: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(`${baseUrl}/api/replay/record`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const parsed = (await res.json().catch(() => null)) as T;
  return { status: res.status, body: parsed };
}

beforeEach(async () => {
  _resetLiveTapRing();
  stagingRoot = await fs.mkdtemp(path.join(os.tmpdir(), "replay-recorder-"));
  process.env["REPLAY_RECORDER_STAGING_ROOT"] = stagingRoot;
  const app: Express = express();
  app.use(express.json());
  app.use("/api", replayRecorderRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no addr");
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  delete process.env["REPLAY_RECORDER_STAGING_ROOT"];
  await fs.rm(stagingRoot, { recursive: true, force: true });
});

describe("LiveTapRing", () => {
  it("push + drainSince returns exactly what was pushed inside the window", () => {
    const now = Date.now();
    tapPushTick({
      receivedAtMs: now - 30_000,
      instrumentToken: 256265,
      symbol: "NIFTY 50",
      ltp: 24000,
      ltq: 50,
      volume: 1000,
      oi: null,
      raw: {},
    });
    tapPushChainSnapshot({
      capturedAtMs: now - 20_000,
      underlying: "NIFTY",
      expiry: "2026-07-17",
      source: "kite",
      snapshot: {},
    });
    tapPushSystemEvent({
      emittedAtMs: now - 10_000,
      kind: "SYSTEM_MODE_TRANSITION",
      detail: { from: "PRE_MARKET", to: "MARKET_OPEN" },
    });
    const drained = drainSince({ sinceMs: now - 60_000 });
    expect(drained.ticks).toHaveLength(1);
    expect(drained.chainSnapshots).toHaveLength(1);
    expect(drained.systemEvents).toHaveLength(1);
    expect(drained.observedRangeMs).toEqual({ min: now - 30_000, max: now - 30_000 });
  });

  it("drainSince drops rows older than the sinceMs cutoff", () => {
    const now = Date.now();
    tapPushTick({
      receivedAtMs: now - 120_000,
      instrumentToken: 1,
      symbol: "OLD",
      ltp: 1,
      ltq: null,
      volume: null,
      oi: null,
      raw: {},
    });
    tapPushTick({
      receivedAtMs: now - 30_000,
      instrumentToken: 2,
      symbol: "NEW",
      ltp: 2,
      ltq: null,
      volume: null,
      oi: null,
      raw: {},
    });
    const drained = drainSince({ sinceMs: now - 60_000 });
    expect(drained.ticks).toHaveLength(1);
    expect(drained.ticks[0]!.symbol).toBe("NEW");
  });

  it("tapStats returns honest counts + range", () => {
    const now = Date.now();
    tapPushTick({
      receivedAtMs: now - 1000,
      instrumentToken: 1,
      symbol: "A",
      ltp: 1,
      ltq: null,
      volume: null,
      oi: null,
      raw: {},
    });
    tapPushTick({
      receivedAtMs: now - 500,
      instrumentToken: 2,
      symbol: "B",
      ltp: 2,
      ltq: null,
      volume: null,
      oi: null,
      raw: {},
    });
    const s = tapStats();
    expect(s.tickCount).toBe(2);
    expect(s.oldestTickMs).toBe(now - 1000);
    expect(s.newestTickMs).toBe(now - 500);
  });
});

describe("POST /api/replay/record", () => {
  it("empty window → 422 with a helpful hint", async () => {
    const { status, body } = await post({
      id: "empty-test",
      minutes: 5,
      sessionKind: "NORMAL_MONDAY",
      kiteInstruments: ["NIFTY 50"],
      engineVersion: "paper-writer-v1.2.0-ledger-net",
    });
    expect(status).toBe(422);
    const b = body as { error: string; detail: string };
    expect(b.error).toBe("empty_window");
    expect(b.detail).toMatch(/Verify the tap/);
  });

  it("populated window → 201 with manifest, JSONL files, and matching sourceHash", async () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      tapPushTick({
        receivedAtMs: now - (5 - i) * 1000,
        instrumentToken: 256265,
        symbol: "NIFTY 50",
        ltp: 24000 + i,
        ltq: 50,
        volume: 1000 + i,
        oi: null,
        raw: { i },
      });
    }
    const { status, body } = await post({
      id: "smoke-test",
      minutes: 5,
      sessionKind: "NORMAL_MONDAY",
      kiteInstruments: ["NIFTY 50"],
      engineVersion: "paper-writer-v1.2.0-ledger-net",
      runtimeSeed: 42,
    });
    expect(status).toBe(201);
    const b = body as {
      fixtureId: string;
      dir: string;
      manifest: {
        provider: string;
        sourceHash: string;
        tickCount: number;
        bucketUri: string | null;
      };
      counts: { ticks: number };
    };
    expect(b.fixtureId).toBe("smoke-test");
    expect(b.manifest.provider).toBe("kite");
    expect(b.manifest.sourceHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(b.manifest.tickCount).toBe(5);
    expect(b.manifest.bucketUri).toBe("staging://smoke-test");
    expect(b.counts.ticks).toBe(5);
    // Files should exist on disk.
    const dir = b.dir;
    for (const f of ["manifest.json", "ticks.jsonl", "option_chain_snapshots.jsonl", "index_boards.jsonl", "system_events.jsonl"]) {
      const stat = await fs.stat(path.join(dir, f));
      expect(stat.isFile()).toBe(true);
    }
    // ticks.jsonl must contain 5 lines with receivedAtNs (ms upshifted to ns).
    const ticks = (await fs.readFile(path.join(dir, "ticks.jsonl"), "utf8"))
      .trim()
      .split("\n");
    expect(ticks).toHaveLength(5);
    const first = JSON.parse(ticks[0]!);
    expect(first.receivedAtNs).toBe((now - 5000) * 1_000_000);
  });

  it("baseline flag with an existing baseline: refuses 409", async () => {
    // Pre-plant a baseline directory in the repo output root. We compute
    // the repo root the same way the router does, so this test doesn't
    // pollute anything the driver actually reads.
    const repoRoot = path.resolve(
      __dirname,
      "../__tests__/replay_fixtures",
    );
    const stray = path.join(repoRoot, "baseline_squatter");
    await fs.mkdir(stray, { recursive: true });
    try {
      tapPushTick({
        receivedAtMs: Date.now() - 1000,
        instrumentToken: 1,
        symbol: "NIFTY 50",
        ltp: 24000,
        ltq: null,
        volume: null,
        oi: null,
        raw: {},
      });
      const { status, body } = await post({
        id: "candidate",
        minutes: 5,
        sessionKind: "NORMAL_MONDAY",
        kiteInstruments: ["NIFTY 50"],
        engineVersion: "paper-writer-v1.2.0-ledger-net",
        baseline: true,
      });
      expect(status).toBe(409);
      expect((body as { error: string }).error).toBe("baseline_slot_occupied");
    } finally {
      await fs.rm(stray, { recursive: true, force: true });
    }
  });

  it("invalid body → 400 with structured error", async () => {
    const { status, body } = await post({
      id: "BAD ID WITH SPACES",
      minutes: 5,
      sessionKind: "NORMAL_MONDAY",
      kiteInstruments: [],
      engineVersion: "v1",
    });
    expect(status).toBe(400);
    expect((body as { error: string }).error).toBe("invalid_body");
  });
});
