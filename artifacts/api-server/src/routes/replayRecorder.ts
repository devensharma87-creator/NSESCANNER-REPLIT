/**
 * `POST /api/replay/record` — owner-only recorder endpoint.
 *
 * Drains the last N minutes from `liveTapRing` and writes a
 * replay-driver-compatible fixture to disk with a cryptographic
 * `sourceHash` in the manifest. Read-only tap — this endpoint never
 * touches the trading path; if the buffer failed silently earlier
 * (fail-open), the resulting fixture just has fewer rows.
 *
 * Also exposes:
 *   • `GET /api/replay/record/stats` — buffer health (row counts +
 *     wall-clock range).
 *
 * Access: session-gated via the ambient auth middleware (same tier as
 * other owner tools like `/replay/*` routes). Enforced at the router
 * mount point, not inside the handlers, so this file stays testable.
 *
 * Spec: BACKTEST_REPLAY_HARNESS_SPEC.md §12.2
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";
import { logger } from "../lib/logger";
import {
  drainSince,
  tapStats,
  type DrainedFixture,
} from "../lib/liveTapRing";
import { computeFixtureSourceHash } from "../__tests__/replayHarness/bucketFetcher";

const router: Router = Router();

const RecordBody = z.object({
  id: z
    .string()
    .min(4)
    .max(120)
    .regex(/^[a-z0-9_\-]+$/, "id must be [a-z0-9_-]+"),
  minutes: z.number().int().min(1).max(240),
  sessionKind: z.enum([
    "NORMAL_MONDAY",
    "NORMAL_SESSION",
    "EXPIRY_THU",
    "EXPIRY_FRI",
    "VIX_SPIKE",
    "KITE_OUTAGE",
    "BOOT_STORM",
    "OTHER",
  ]),
  kiteInstruments: z.array(z.string().min(1)).max(200),
  notes: z.string().max(1000).optional(),
  engineVersion: z.string().min(1).max(120),
  runtimeSeed: z.number().int().min(0).max(2 ** 31 - 1).optional(),
  /** When true, the fixture is written under the committed baseline
   *  slot AND the manifest carries `bucketUri: null`. Only ONE baseline
   *  is allowed at a time in the repo — the handler refuses if
   *  `baseline` is already occupied by a *different* id. */
  baseline: z.boolean().optional(),
});

const OUTPUT_ROOT_BASELINE = path.resolve(
  __dirname,
  "../__tests__/replay_fixtures",
);
// Fixtures destined for the bucket are staged here first; a
// `bucketUpload.ts` helper (not in this scaffold) would ship them to
// S3 / Replit Object Storage.
const OUTPUT_ROOT_STAGING =
  process.env["REPLAY_RECORDER_STAGING_ROOT"] ??
  path.join(process.env["HOME"] ?? "/tmp", ".cache", "scanner-replay-staging");

function toJsonl(rows: Array<Record<string, unknown> | { raw?: Record<string, unknown> }>): string {
  if (rows.length === 0) return "";
  return rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

/**
 * Serialise a drained window into the four canonical JSONL streams
 * the replay driver expects. Row shape matches
 * `RecordedTick` / `RecordedKiteClient` requirements exactly (the
 * driver's `parseTicks` reads `receivedAtNs`, so we upshift ms → ns
 * here at the boundary).
 */
export function serialiseFixture(d: DrainedFixture): {
  ticksJsonl: string;
  chainSnapshotsJsonl: string;
  boardSnapshotsJsonl: string;
  systemEventsJsonl: string;
} {
  return {
    ticksJsonl: toJsonl(
      d.ticks.map((t) => ({
        receivedAtNs: t.receivedAtMs * 1_000_000,
        instrumentToken: t.instrumentToken,
        ltp: t.ltp,
        ltq: t.ltq,
        volume: t.volume,
        oi: t.oi,
        raw: { symbol: t.symbol, ...t.raw },
      })),
    ),
    chainSnapshotsJsonl: toJsonl(
      d.chainSnapshots.map((s) => ({
        capturedAtMs: s.capturedAtMs,
        underlying: s.underlying,
        expiry: s.expiry,
        source: s.source,
        snapshot: s.snapshot,
      })),
    ),
    boardSnapshotsJsonl: toJsonl(
      d.boardSnapshots.map((b) => ({
        capturedAtMs: b.capturedAtMs,
        rows: b.rows,
      })),
    ),
    systemEventsJsonl: toJsonl(
      d.systemEvents.map((e) => ({
        emittedAtMs: e.emittedAtMs,
        kind: e.kind,
        detail: e.detail,
      })),
    ),
  };
}

router.get("/replay/record/stats", (_req: Request, res: Response) => {
  return res.json(tapStats());
});

router.post("/replay/record", async (req: Request, res: Response) => {
  const parsed = RecordBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "invalid_body",
      detail: parsed.error.flatten(),
    });
  }
  const body = parsed.data;
  const baseline = body.baseline === true;
  const dirId = baseline ? `baseline_${body.id}` : body.id;

  const outputRoot = baseline ? OUTPUT_ROOT_BASELINE : OUTPUT_ROOT_STAGING;
  const dir = path.join(outputRoot, dirId);

  // Baseline slot check: refuse if a DIFFERENT baseline directory
  // already exists in the repo. Only one baseline may live in the
  // repo at any time (spec §12.1).
  if (baseline) {
    try {
      const entries = await fs.readdir(OUTPUT_ROOT_BASELINE);
      const existingBaseline = entries.find(
        (e) => e.startsWith("baseline_") && e !== dirId,
      );
      if (existingBaseline) {
        return res.status(409).json({
          error: "baseline_slot_occupied",
          detail: `A baseline fixture already exists (${existingBaseline}). Only one is allowed in the repo per spec §12.1.`,
        });
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  const sinceMs = Date.now() - body.minutes * 60_000;
  const drained = drainSince({ sinceMs });

  if (drained.ticks.length === 0) {
    return res.status(422).json({
      error: "empty_window",
      detail:
        "No ticks in the requested window. Verify the tap is wired to " +
        "kiteFeed and that Kite was connected during the target minutes.",
      stats: tapStats(),
    });
  }

  const serialised = serialiseFixture(drained);
  const sourceHash = computeFixtureSourceHash(serialised);

  const manifest = {
    id: dirId,
    recordedAt: new Date().toISOString(),
    sessionKind: body.sessionKind,
    istDate: istDateFor(Date.now()),
    kiteInstruments: body.kiteInstruments,
    tickCount: drained.ticks.length,
    chainSnapshotCount: drained.chainSnapshots.length,
    boardSnapshotCount: drained.boardSnapshots.length,
    chainWidth: "FULL",
    notes: body.notes ?? "",
    provider: "kite",
    sourceHash,
    bucketUri: baseline ? null : `staging://${dirId}`,
    engineVersion: body.engineVersion,
    runtimeSeed: body.runtimeSeed ?? 42,
  };

  try {
    await fs.mkdir(dir, { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8"),
      fs.writeFile(path.join(dir, "ticks.jsonl"), serialised.ticksJsonl, "utf8"),
      fs.writeFile(
        path.join(dir, "option_chain_snapshots.jsonl"),
        serialised.chainSnapshotsJsonl,
        "utf8",
      ),
      fs.writeFile(
        path.join(dir, "index_boards.jsonl"),
        serialised.boardSnapshotsJsonl,
        "utf8",
      ),
      fs.writeFile(
        path.join(dir, "system_events.jsonl"),
        serialised.systemEventsJsonl,
        "utf8",
      ),
    ]);
  } catch (err) {
    logger.error(
      { err: (err as Error).message, dir },
      "replay recorder: fixture write failed",
    );
    return res.status(500).json({ error: "write_failed", detail: (err as Error).message });
  }

  logger.info(
    {
      fixtureId: dirId,
      dir,
      tickCount: drained.ticks.length,
      chainSnapshotCount: drained.chainSnapshots.length,
      sourceHash,
      baseline,
    },
    "replay recorder: fixture written",
  );

  return res.status(201).json({
    fixtureId: dirId,
    dir,
    manifest,
    counts: {
      ticks: drained.ticks.length,
      chainSnapshots: drained.chainSnapshots.length,
      boardSnapshots: drained.boardSnapshots.length,
      systemEvents: drained.systemEvents.length,
    },
    observedRangeMs: drained.observedRangeMs,
  });
});

function istDateFor(epochMs: number): string {
  // Shift to IST then format Y-M-D.
  const d = new Date(epochMs + 5.5 * 60 * 60_000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default router;
