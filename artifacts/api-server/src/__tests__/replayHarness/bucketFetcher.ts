/**
 * Manifest + fixture loader with cryptographic provenance verification.
 *
 * Spec: BACKTEST_REPLAY_HARNESS_SPEC.md §3.2, §3.4
 *
 * Contract:
 *   1. Manifest MUST have `provider === "kite"`. Any other value is a
 *      fabricated fixture — refused with a clear error.
 *   2. `sourceHash` MUST match `sha256(ticks + chain + boards)` bytes
 *      concatenated in that order. Mismatch = tamper = refuse.
 *   3. The single committed baseline (`bucketUri === null` +
 *      `id.startsWith("baseline_")`) reads from disk. Everything else
 *      reads from the bucket (bucketUri) with a local cache in
 *      `~/.cache/scanner-replay/<id>/`.
 *
 * R1 note: the bucket-fetch pathway is scaffolded but not wired to a
 * real S3 client — that's R1 tail work. For the baseline (committed to
 * repo) it fully works today, which is what R2 needs to boot the first
 * golden run.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface ReplayManifest {
  id: string;
  recordedAt: string;
  sessionKind: string;
  istDate: string;
  kiteInstruments: string[];
  tickCount: number;
  chainSnapshotCount: number;
  boardSnapshotCount: number;
  chainWidth: "FULL" | string;
  notes?: string;
  /** MUST be exactly "kite". Guarded on load. */
  provider: string;
  sourceHash: string;
  bucketUri: string | null;
  engineVersion: string;
  runtimeSeed: number;
}

export interface LoadedFixture {
  manifest: ReplayManifest;
  ticksJsonl: string;
  chainSnapshotsJsonl: string;
  boardSnapshotsJsonl: string;
  systemEventsJsonl: string;
}

const FIXTURES_ROOT = path.resolve(
  __dirname,
  "../../__tests__/replay_fixtures",
);

/** Resolved per-call so tests + owner env overrides take effect after
 *  module load. Defaults to `~/.cache/scanner-replay/`. */
function bucketCacheRoot(): string {
  return (
    process.env["SCANNER_REPLAY_CACHE_ROOT"] ??
    path.join(process.env["HOME"] ?? "/tmp", ".cache", "scanner-replay")
  );
}

/**
 * sha256 over the concatenated bytes of the fixture's four JSONL files.
 * Kept exposed for the recorder + tests. Order matters — mismatch
 * ordering is a corruption event.
 */
export function computeFixtureSourceHash(parts: {
  ticksJsonl: string;
  chainSnapshotsJsonl: string;
  boardSnapshotsJsonl: string;
  systemEventsJsonl: string;
}): string {
  const h = crypto.createHash("sha256");
  h.update(parts.ticksJsonl);
  h.update(parts.chainSnapshotsJsonl);
  h.update(parts.boardSnapshotsJsonl);
  h.update(parts.systemEventsJsonl);
  return `sha256:${h.digest("hex")}`;
}

export class ReplayFixtureError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ReplayFixtureError";
  }
}

async function readTextOrEmpty(p: string): Promise<string> {
  try {
    return await fs.readFile(p, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw err;
  }
}

async function loadFromDisk(dir: string): Promise<LoadedFixture> {
  const manifestPath = path.join(dir, "manifest.json");
  const manifestText = await fs.readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestText) as ReplayManifest;

  const ticks = await readTextOrEmpty(path.join(dir, "ticks.jsonl"));
  const chain = await readTextOrEmpty(
    path.join(dir, "option_chain_snapshots.jsonl"),
  );
  const boards = await readTextOrEmpty(
    path.join(dir, "index_boards.jsonl"),
  );
  const events = await readTextOrEmpty(
    path.join(dir, "system_events.jsonl"),
  );
  return {
    manifest,
    ticksJsonl: ticks,
    chainSnapshotsJsonl: chain,
    boardSnapshotsJsonl: boards,
    systemEventsJsonl: events,
  };
}

/**
 * Load a fixture by id — from repo (baseline_*) or from the bucket
 * cache. Verifies provenance (provider + sourceHash) before returning.
 */
export async function loadFixture(id: string): Promise<LoadedFixture> {
  const isBaseline = id.startsWith("baseline_");
  const dir = isBaseline
    ? path.join(FIXTURES_ROOT, id)
    : path.join(bucketCacheRoot(), id);

  if (!isBaseline) {
    // R1 scaffold: bucket-fetch path is stubbed. Real S3 client wiring
    // happens in R1-tail when the first non-baseline fixture is ready.
    const exists = await fs
      .stat(dir)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      throw new ReplayFixtureError(
        "BUCKET_FETCH_NOT_IMPLEMENTED",
        `bucketFetcher: fixture "${id}" not in local cache (${dir}). ` +
          `R1 scaffold does not yet fetch from S3 — populate manually ` +
          `or wait for the recorder endpoint (R1-tail).`,
      );
    }
  }

  const loaded = await loadFromDisk(dir);

  if (loaded.manifest.provider !== "kite") {
    throw new ReplayFixtureError(
      "REFUSED_NON_KITE_PROVIDER",
      `bucketFetcher: fixture "${id}" provider is "${loaded.manifest.provider}" — ` +
        `only "kite" is legal. Fabricated fixtures are banned by spec §2.`,
    );
  }

  const computed = computeFixtureSourceHash({
    ticksJsonl: loaded.ticksJsonl,
    chainSnapshotsJsonl: loaded.chainSnapshotsJsonl,
    boardSnapshotsJsonl: loaded.boardSnapshotsJsonl,
    systemEventsJsonl: loaded.systemEventsJsonl,
  });

  if (computed !== loaded.manifest.sourceHash) {
    throw new ReplayFixtureError(
      "SOURCE_HASH_MISMATCH",
      `bucketFetcher: fixture "${id}" sourceHash mismatch. ` +
        `manifest=${loaded.manifest.sourceHash} computed=${computed}. ` +
        `Tampered fixtures are refused.`,
    );
  }

  return loaded;
}
