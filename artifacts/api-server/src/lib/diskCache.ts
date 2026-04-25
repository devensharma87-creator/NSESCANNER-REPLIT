/**
 * Tiny disk-cache helper for warm-start state.
 *
 * The Replit dev container restarts the API server on every file save (and
 * cold-boots on workflow restart). Without persistence, all in-memory caches
 * — Full NSE scan rows (~5min cold scan), OI heatmap baseline (only correct
 * after the second poll of a session), and OI tracker snapshots — are lost
 * and the user sees an empty/cold UI for minutes.
 *
 * This module persists JSON blobs to `.cache/` at the repo root, atomically
 * (write-temp + rename) so a kill mid-write can't corrupt the file. Each
 * blob carries a `version` field; on schema bump, increment it and the
 * loader will silently discard old payloads.
 *
 * NOT a database — just a fast warm-start hint. Callers must tolerate a
 * `null` return (file missing, parse error, version mismatch).
 */

import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger";

// repo root = ../../../.. from artifacts/api-server/src/lib/
const CACHE_DIR = path.resolve(process.cwd(), ".cache");

function ensureDir(): void {
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch { /* swallow */ }
}

export interface DiskBlob<T> {
  version: number;
  ts: number;          // unix ms when written
  payload: T;
}

/** Synchronously load a JSON blob. Returns null on any error or version mismatch. */
export function loadBlob<T>(name: string, expectedVersion: number): DiskBlob<T> | null {
  const file = path.join(CACHE_DIR, `${name}.json`);
  try {
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as DiskBlob<T>;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.version !== expectedVersion) {
      logger.info({ name, found: parsed.version, expected: expectedVersion }, "diskCache: version mismatch — discarding");
      return null;
    }
    return parsed;
  } catch (err) {
    logger.warn({ name, err: (err as Error).message }, "diskCache: load failed");
    return null;
  }
}

/** Atomically write a JSON blob. Best-effort — failures are logged, not thrown. */
export function saveBlob<T>(name: string, version: number, payload: T): void {
  ensureDir();
  const file = path.join(CACHE_DIR, `${name}.json`);
  const tmp  = `${file}.${process.pid}.tmp`;
  try {
    const blob: DiskBlob<T> = { version, ts: Date.now(), payload };
    fs.writeFileSync(tmp, JSON.stringify(blob), "utf8");
    fs.renameSync(tmp, file);
  } catch (err) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* swallow */ }
    logger.warn({ name, err: (err as Error).message }, "diskCache: save failed");
  }
}

/** Delete a blob (rarely needed; mostly for tests). */
export function clearBlob(name: string): void {
  const file = path.join(CACHE_DIR, `${name}.json`);
  try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch { /* swallow */ }
}

/** "YYYY-MM-DD" in IST — used to scope baselines to a single trading day. */
export function istTradingDay(d: Date = new Date()): string {
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}
