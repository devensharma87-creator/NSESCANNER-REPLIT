/**
 * Backtest Lab — historical 15-min SPOT candle source for Mode B.
 *
 * The only 2-year 15-min index history available in this project is the REAL
 * Kite-fetched CSV captured by `pnpm --filter @workspace/api-server run
 * fetch:index-candles` (NIFTY / BANKNIFTY / SENSEX, IST timestamps, no volume —
 * index candles never carry volume). We read it straight off disk. When a file
 * is missing we return an empty array — the caller surfaces "Historical option
 * data unavailable" rather than fabricating anything.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import type { Candle } from "./directional";

const SUPPORTED = new Set(["NIFTY", "BANKNIFTY", "SENSEX"]);

/** Walk upward from this module to find the repo-root data directory. */
function resolveDataDir(): string | null {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "tools", "fno-backtester", "data");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function isSupportedInstrument(symbol: string): boolean {
  return SUPPORTED.has(symbol);
}

/** Parse "2024-06-05 09:15:00" (IST wall clock) into a Date whose UTC fields
 *  equal that wall clock — keeps day/minute maths trivial and tz-stable. */
function parseIstWallClock(s: string): Date | null {
  const iso = s.trim().replace(" ", "T");
  const d = new Date(iso.endsWith("Z") ? iso : `${iso}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface LoadCandlesResult {
  candles: Candle[];
  available: boolean;
}

/**
 * Load real 15-min candles for one index, optionally windowed by inclusive
 * `fromDate`/`toDate` (YYYY-MM-DD). `available` is false only when the source
 * file does not exist (honest "unavailable" vs a genuinely empty window).
 */
export async function loadHistoricalCandles(
  symbol: string,
  fromDate: string | null,
  toDate: string | null,
): Promise<LoadCandlesResult> {
  if (!SUPPORTED.has(symbol)) return { candles: [], available: false };
  const dataDir = resolveDataDir();
  if (!dataDir) return { candles: [], available: false };
  const file = join(dataDir, `${symbol}.csv`);
  if (!existsSync(file)) return { candles: [], available: false };

  const raw = await readFile(file, "utf8");
  const lines = raw.split(/\r?\n/);
  const fromMs = fromDate ? Date.parse(`${fromDate}T00:00:00Z`) : null;
  const toMs = toDate ? Date.parse(`${toDate}T23:59:59Z`) : null;

  const candles: Candle[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const parts = line.split(",");
    if (parts.length < 5) continue;
    const t = parseIstWallClock(parts[0]!);
    if (!t) continue;
    const ms = t.getTime();
    if (fromMs !== null && ms < fromMs) continue;
    if (toMs !== null && ms > toMs) continue;
    const o = Number(parts[1]);
    const h = Number(parts[2]);
    const l = Number(parts[3]);
    const c = Number(parts[4]);
    if (![o, h, l, c].every(Number.isFinite)) continue;
    candles.push({ t, o, h, l, c });
  }
  candles.sort((a, b) => a.t.getTime() - b.t.getTime());
  return { candles, available: true };
}
