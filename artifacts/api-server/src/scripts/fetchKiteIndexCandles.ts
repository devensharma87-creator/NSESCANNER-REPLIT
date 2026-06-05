/**
 * fetchKiteIndexCandles.ts
 * ========================
 * One-off fetcher that pulls ~2 years of 15-minute candles for
 * NIFTY 50 / NIFTY BANK / SENSEX from Kite and writes three CSVs in the
 * EXACT shape the in-repo backtester consumes (tools/fno-backtester):
 *
 *     date,open,high,low,close,volume
 *
 * WHY THIS (TS) AND NOT THE PYTHON kite_fetch_indices.py
 * ------------------------------------------------------
 * This app does NOT keep the Kite access token in KITE_ACCESS_TOKEN env. The
 * live daily token is stored (encrypted) in the Postgres `kite_session` table
 * and surfaced via `getRestClient()`. This script reuses that SAME live session
 * — no fresh login, no token in a chat, no env juggling — exactly the
 * "reuse the auth the site already has" instinct. The Python script is kept as
 * a reference (tools/fno-backtester/kite_fetch_indices.py) for environments
 * where the token IS available as an env var, but THIS is the wired path.
 *
 * VOLUME BASIS — the correctness decision, settled
 * ------------------------------------------------
 * We fetch SPOT indices, NOT futures. The advisor raised "spot (vol=0) vs
 * near-month futures (real vol)" and leaned futures. The codebase settles it:
 * the LIVE engine computes index VWAP from Kite SPOT candles where cash-index
 * volume is 0 (see kiteIntraday.ts "Cash-index volume from Kite is 0"), its
 * `sessionVwap` falls back to typical price when volume is 0, and the
 * volume-breakout / volume-profile detectors stay DORMANT for indices. A
 * backtest MUST use the same volume basis as live, so fetching futures would
 * test a strategy live does not run = invalid. The backtester's session_vwap
 * mirrors the same typical-price fallback so zero-volume spot data is valid.
 *
 * KITE CONSTRAINT
 * ---------------
 * Kite caps a single 15-minute request at ~200 days, so we loop in 100-day
 * chunks across the 2-year window, pace requests (rate-limit safety), dedupe
 * chunk-boundary overlaps, and sort by timestamp.
 *
 * USAGE (from repo root, OUTSIDE market hours for fully-formed candles):
 *
 *   pnpm --filter @workspace/api-server run fetch:index-candles
 *   # then:
 *   python3 tools/fno-backtester/fno_backtester.py --csv tools/fno-backtester/data/NIFTY.csv --index NIFTY
 *
 * Required env: DATABASE_URL + a live Kite session (KITE_API_KEY / KITE_API_SECRET /
 * KITE_TOKEN_ENC_KEY, plus a logged-in session in `kite_session` — or KITE_MIRROR_URL
 * configured so a dev box can mirror the production session).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getRestClient } from "../lib/kiteAuth";

const YEARS_BACK = 2;
const CHUNK_DAYS = 100; // comfortably under Kite's ~200-day 15-min cap
const INTERVAL = "15minute";
const PACE_MS = 450; // gentle pacing between requests (3 req/s Kite limit)

interface IndexTarget {
  file: string; // output filename
  exchange: "NSE" | "BSE";
  tradingSymbol: string; // as listed in the Kite instrument master
  fallbackToken: number; // used if instrument-master lookup fails
}

// Mirrors INDEX_TABLE in kiteIntraday.ts (NIFTY 50 / NIFTY BANK / SENSEX).
const TARGETS: IndexTarget[] = [
  { file: "NIFTY.csv", exchange: "NSE", tradingSymbol: "NIFTY 50", fallbackToken: 256265 },
  { file: "BANKNIFTY.csv", exchange: "NSE", tradingSymbol: "NIFTY BANK", fallbackToken: 260105 },
  { file: "SENSEX.csv", exchange: "BSE", tradingSymbol: "SENSEX", fallbackToken: 265 },
];

interface RawCandle {
  date: Date | string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
// repo-root/tools/fno-backtester/data  (script lives at artifacts/api-server/src/scripts)
const OUT_DIR = resolve(__dirname, "../../../../tools/fno-backtester/data");

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** "YYYY-MM-DD" in IST (Kite accepts date-only for ranged historical pulls). */
function istDate(d: Date): string {
  // IST = UTC+5:30
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  return ist.toISOString().slice(0, 10);
}

async function resolveToken(
  kc: any,
  t: IndexTarget,
  dumps: Map<string, any[]>,
): Promise<number> {
  try {
    if (!dumps.has(t.exchange)) {
      dumps.set(t.exchange, (await kc.getInstruments(t.exchange)) as any[]);
    }
    const match = (dumps.get(t.exchange) ?? []).find(
      (i: any) => i.tradingsymbol === t.tradingSymbol,
    );
    if (match?.instrument_token) {
      return Number(match.instrument_token);
    }
    console.warn(
      `  [${t.tradingSymbol}] not found in ${t.exchange} dump; using fallback token ${t.fallbackToken}`,
    );
  } catch (err) {
    console.warn(
      `  [${t.tradingSymbol}] instrument lookup failed (${(err as Error).message}); using fallback token ${t.fallbackToken}`,
    );
  }
  return t.fallbackToken;
}

async function fetchAll(
  kc: any,
  token: number,
): Promise<{ rows: RawCandle[]; failures: number }> {
  const end = new Date();
  const start = new Date(end.getTime() - YEARS_BACK * 365 * 24 * 3600 * 1000);
  const rows: RawCandle[] = [];
  let failures = 0;
  let cursor = new Date(start);
  while (cursor < end) {
    const chunkEnd = new Date(
      Math.min(cursor.getTime() + CHUNK_DAYS * 24 * 3600 * 1000, end.getTime()),
    );
    const fromStr = istDate(cursor);
    const toStr = istDate(chunkEnd);
    try {
      const candles = (await kc.getHistoricalData(
        token,
        INTERVAL,
        fromStr,
        toStr,
        false,
        false,
      )) as RawCandle[];
      rows.push(...(candles ?? []));
      console.log(`    ${fromStr} -> ${toStr}: ${candles?.length ?? 0} candles`);
    } catch (err) {
      failures += 1;
      console.error(
        `    ${fromStr} -> ${toStr}: FAILED (${(err as Error).message})`,
      );
    }
    cursor = new Date(chunkEnd.getTime() + 24 * 3600 * 1000);
    await sleep(PACE_MS);
  }
  return { rows, failures };
}

function toIsoTs(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

function writeCsv(file: string, rows: RawCandle[]): number {
  // Dedupe on timestamp (chunk boundaries can overlap), then sort ascending.
  const seen = new Map<string, RawCandle>();
  for (const r of rows) {
    const ts = toIsoTs(r.date);
    if (!Number.isFinite(new Date(ts).getTime())) continue;
    if (![r.open, r.high, r.low, r.close].every(v => Number.isFinite(v) && v > 0)) continue;
    seen.set(ts, r);
  }
  const ordered = [...seen.keys()].sort().map(k => seen.get(k)!);
  const lines = ["date,open,high,low,close,volume"];
  for (const r of ordered) {
    lines.push(
      [toIsoTs(r.date), r.open, r.high, r.low, r.close, r.volume ?? 0].join(","),
    );
  }
  const path = resolve(OUT_DIR, file);
  writeFileSync(path, lines.join("\n") + "\n", "utf8");
  return ordered.length;
}

async function main() {
  console.log(
    `Fetching ${YEARS_BACK}y of ${INTERVAL} SPOT candles for ${TARGETS.length} indices...`,
  );
  const client = await getRestClient();
  if (!client) {
    console.error(
      "No active Kite session. Log in to Kite (or configure KITE_MIRROR_URL) and retry.",
    );
    process.exit(1);
    return;
  }
  const { kc } = client;
  const allowPartial = process.argv.includes("--allow-partial");
  mkdirSync(OUT_DIR, { recursive: true });

  const dumps = new Map<string, any[]>();
  let zeroVolHint = false;
  let totalFailures = 0;
  for (const t of TARGETS) {
    console.log(`\n${t.file} (${t.tradingSymbol}):`);
    const token = await resolveToken(kc, t, dumps);
    const { rows, failures } = await fetchAll(kc, token);
    totalFailures += failures;
    if (failures > 0 && !allowPartial) {
      // Fail-closed: do NOT write an incomplete CSV — a partial 2y window would
      // silently bias the backtest. Re-run (chunk pulls are idempotent) or pass
      // --allow-partial to deliberately accept gaps.
      console.error(
        `  SKIPPED writing ${t.file}: ${failures} chunk(s) failed — incomplete data. ` +
          `Re-run, or pass --allow-partial to accept gaps.`,
      );
      continue;
    }
    const n = writeCsv(t.file, rows);
    const anyVol = rows.some(r => Number(r.volume) > 0);
    if (!anyVol) zeroVolHint = true;
    console.log(
      `  wrote ${resolve(OUT_DIR, t.file)}: ${n} unique candles` +
        `${failures > 0 ? ` (PARTIAL — ${failures} chunk failure(s))` : ""}` +
        `${anyVol ? "" : " (volume all 0 — expected for spot index)"}`,
    );
  }

  if (totalFailures > 0 && !allowPartial) {
    console.error(
      `\nFAILED: ${totalFailures} chunk fetch failure(s); some CSVs were not written. ` +
        `Re-run (idempotent) or pass --allow-partial to accept gaps.`,
    );
    process.exit(1);
    return;
  }

  console.log("\nDone. Run the backtester, e.g.:");
  console.log(
    "  python3 tools/fno-backtester/fno_backtester.py --csv tools/fno-backtester/data/NIFTY.csv --index NIFTY",
  );
  if (zeroVolHint) {
    console.log(
      "\nNote: index spot volume is 0 (expected). The backtester's session_vwap mirrors\n" +
        "the live typical-price fallback, so the VWAP gate stays valid on zero-volume data.",
    );
  }
  process.exit(0);
}

main().catch(err => {
  console.error("fetchKiteIndexCandles failed:", err);
  process.exit(1);
});
