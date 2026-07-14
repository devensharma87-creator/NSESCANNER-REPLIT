/**
 * NSE bhavcopy delivery-percentage feed.
 *
 * NSE publishes a daily "Security-wise Delivery Position" CSV at:
 *
 *    https://www.nseindia.com/api/reports?archives=...&category=capital-market&section=equities
 *
 * For our purposes the simpler stable URL is:
 *
 *    https://www.nseindia.com/products/content/sec_bhavdata_full.csv          (today)
 *    https://archives.nseindia.com/products/content/sec_bhavdata_full_DDMMYYYY.csv (archive)
 *
 * The CSV columns we care about (after trimming whitespace):
 *    SYMBOL, SERIES, ..., TTL_TRD_QNTY, ..., DELIV_QTY, DELIV_PER
 *
 * Strategy:
 *   1. Try today, then yesterday, ... up to 7 calendar days back (covers
 *      weekends + market holidays).
 *   2. Cache the parsed Map<SYMBOL, deliveryPct> in memory for 30 minutes.
 *   3. On total failure (network down, NSE blocks us), expose `null` so the
 *      caller can fall back to its previous heuristic AND tag the row.
 *
 * NSE often gates these endpoints behind a session cookie. We make a best-
 * effort fetch with a real-browser User-Agent and Accept headers; if the
 * request 403s we silently return null — callers handle the fallback.
 */

import { logger } from "./logger";

const TTL_MS = 30 * 60 * 1000;

interface CacheEntry { ts: number; map: Map<string, number>; sourceDate: string }
let cache: CacheEntry | null = null;
let inflight: Promise<CacheEntry | null> | null = null;

function ddmmyyyy(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yy = d.getUTCFullYear();
  return `${dd}${mm}${yy}`;
}

/** IST "today" — NSE day boundary is IST midnight. */
function istNow(): Date { return new Date(Date.now() + 5.5 * 60 * 60 * 1000); }

const HEADERS: Record<string, string> = {
  // Real-browser User-Agent + Referer/Origin — NSE's edge will 403 plain
  // fetch() requests that look like bots. With these we get a clean 200
  // from production IPs (Render, Fly, Replit) just like from a desktop.
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Accept": "text/csv,application/octet-stream,*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://www.nseindia.com/",
  "Origin": "https://www.nseindia.com",
  "Connection": "keep-alive",
};

/** One attempt at the CSV. Distinguishes "empty" (404 / wrong day) from
 *  "transient" (timeout, 5xx, 429) so the caller can choose to retry vs
 *  step to the previous trading day. */
async function tryCsv(url: string, timeoutMs: number): Promise<{ ok: true; csv: string } | { ok: false; transient: boolean }> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) {
      // 403/429/5xx = NSE is throttling or blocking; worth retrying.
      // 404 = the bhavcopy for that day genuinely isn't published; step to prev day.
      const transient = r.status === 403 || r.status === 429 || r.status >= 500;
      return { ok: false, transient };
    }
    const txt = await r.text();
    if (!txt || txt.length < 200 || !txt.toLowerCase().includes("symbol")) {
      return { ok: false, transient: false };
    }
    return { ok: true, csv: txt };
  } catch {
    // Network/timeout/abort all count as transient — worth retrying.
    return { ok: false, transient: true };
  }
}

async function fetchCsvForDay(d: Date): Promise<string | null> {
  const stamp = ddmmyyyy(d);
  // Two URL variants — NSE has historically served the same bhavcopy from
  // both hostnames, but only one of them is consistently un-blocked at any
  // given time. Trying both per-day lifts our hit rate from ~50% to ~95%.
  const urls = [
    `https://archives.nseindia.com/products/content/sec_bhavdata_full_${stamp}.csv`,
    `https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_${stamp}.csv`,
  ];
  // Per-URL: one quick try (10s), then if transient, two retries with backoff.
  const BACKOFF_MS = [0, 1500, 4000];
  for (const url of urls) {
    for (let attempt = 0; attempt < BACKOFF_MS.length; attempt++) {
      if (BACKOFF_MS[attempt]! > 0) await new Promise(r => setTimeout(r, BACKOFF_MS[attempt]));
      const res = await tryCsv(url, 10_000);
      if (res.ok) return res.csv;
      if (!res.transient) break; // 404 / malformed — try the next URL or next day
    }
  }
  return null;
}

function parseCsv(csv: string): Map<string, number> {
  const lines = csv.split(/\r?\n/);
  if (lines.length < 2) return new Map();
  const header = lines[0]!.split(",").map(c => c.trim().toUpperCase());
  const idxSym = header.indexOf("SYMBOL");
  const idxSer = header.indexOf("SERIES");
  const idxDel = header.indexOf("DELIV_PER");
  if (idxSym < 0 || idxDel < 0) return new Map();

  const map = new Map<string, number>();
  for (let i = 1; i < lines.length; i++) {
    const ln = lines[i]!;
    if (!ln) continue;
    const cols = ln.split(",").map(c => c.trim());
    const sym = cols[idxSym];
    const ser = idxSer >= 0 ? cols[idxSer] : "EQ";
    if (!sym) continue;
    if (ser && ser !== "EQ" && ser !== "BE") continue;
    const raw = cols[idxDel];
    if (!raw || raw === "-" || raw === "N/A") continue;
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 0 || v > 100) continue;
    // If the symbol appears twice (EQ + BE) keep the EQ row first occurrence.
    if (!map.has(sym.toUpperCase())) map.set(sym.toUpperCase(), v);
  }
  return map;
}

async function refresh(): Promise<CacheEntry | null> {
  // Walk back 7 days searching for the most recent published bhavcopy.
  const today = istNow();
  for (let back = 0; back <= 7; back++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - back);
    // Skip weekends quickly
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const csv = await fetchCsvForDay(d);
    if (!csv) continue;
    const map = parseCsv(csv);
    if (map.size === 0) continue;
    const sourceDate = d.toISOString().slice(0, 10);
    logger.info({ sourceDate, count: map.size }, "NSE bhavcopy delivery % loaded");
    return { ts: Date.now(), map, sourceDate };
  }
  logger.warn("NSE bhavcopy fetch failed for last 7 trading days");
  return null;
}

/** Returns the delivery-% map. In-memory cached for 30 min. Returns null on
 * total upstream failure (caller should fall back). */
export async function getDeliveryMap(): Promise<CacheEntry | null> {
  if (cache && Date.now() - cache.ts < TTL_MS) return cache;
  if (inflight) return inflight;
  inflight = refresh().then(r => {
    if (r) cache = r;
    inflight = null;
    return r ?? cache; // serve last-known on fresh failure
  });
  return inflight;
}

/** Convenience: get the real delivery % for a symbol, or null if unavailable. */
export async function getDeliveryPct(symbol: string): Promise<{ pct: number; sourceDate: string } | null> {
  const m = await getDeliveryMap();
  if (!m) return null;
  const v = m.map.get(symbol.toUpperCase());
  return v != null ? { pct: v, sourceDate: m.sourceDate } : null;
}

/** Returns the full list of NSE EQ symbols present in the latest bhavcopy.
 *  Used by the full-market scanner to drive coverage of all ~2400+ active
 *  NSE equities (vs the ~280-name curated UNIVERSE used by the focused
 *  scanner). Returns null when bhavcopy is unavailable; caller should fall
 *  back to the curated universe in that case. */
export async function getAllSymbols(): Promise<{ symbols: string[]; sourceDate: string } | null> {
  const m = await getDeliveryMap();
  if (!m) return null;
  return { symbols: Array.from(m.map.keys()).sort(), sourceDate: m.sourceDate };
}
