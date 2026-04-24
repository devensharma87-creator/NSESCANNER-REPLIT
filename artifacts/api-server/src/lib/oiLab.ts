/**
 * OI Lab — server-side primitives for three intraday F&O analysis surfaces:
 *
 *   1. bulkSnapshot()  — fan-out fetchOptionChain across many underlyings in
 *                        parallel (bounded concurrency) and collapse to a
 *                        single rich payload (chain + analytics per symbol).
 *                        Also supports CSV serialisation for offline use.
 *
 *   2. fetchOiHeatmap() — futures-only OI buildup/unwind classification across
 *                         every F&O stock, using Kite's NFO FUT instruments +
 *                         per-session OI baseline (first call of the day
 *                         establishes the baseline; subsequent calls compare).
 *
 *   3. tracker         — in-memory ring buffer that snapshots option-chain
 *                        analytics every N minutes for a chosen set of
 *                        underlyings. Cleared on Kite session end / server
 *                        restart. No DB writes — live data only.
 *
 * Everything is on-demand. There is no persistence by design: live tick data
 * goes stale within hours (Kite tokens expire ~07:30 IST daily), so the only
 * correct cache is in-memory with a short TTL.
 */

import { logger } from "./logger";
import { isFnoUnderlying } from "./optionChain";
import type { OcResponse } from "./optionChain";
import { fetchKiteOptionChain } from "./kiteOptionChain";
import { computeAnalytics, type OptionAnalytics } from "./optionAnalytics";
import { getRestClient, getActiveSession } from "./kiteAuth";

/**
 * OI Lab is strictly Kite-only — we do NOT use the NSE fallback that
 * `fetchOptionChain` allows, because OI Lab's whole purpose is live broker
 * data integrity. If Kite is down/expired, we surface a hard error.
 */
async function fetchKiteOnlyChain(sym: string): Promise<OcResponse | null> {
  return await fetchKiteOptionChain(sym);
}

// ─── Universe ────────────────────────────────────────────────────────────────
export const FNO_INDICES = [
  "NIFTY",
  "BANKNIFTY",
  "FINNIFTY",
  "MIDCPNIFTY",
  "NIFTYNXT50",
] as const;

// ─── Bulk snapshot ───────────────────────────────────────────────────────────

export interface BulkSnapshotItem {
  underlying: string;
  ok: boolean;
  error?: string;
  spot?: number;
  changePercent?: number;
  expiry?: string;
  atmStrike?: number;
  pcrOi?: number;
  pcrVolume?: number;
  maxPain?: number;
  atmIv?: number | null;
  bias?: OptionAnalytics["bias"];
  totalCallOi?: number;
  totalPutOi?: number;
  callOiAdded?: number;
  putOiAdded?: number;
  topResistance?: { strike: number; oi: number }[];
  topSupport?: { strike: number; oi: number }[];
  interpretation?: string;
  source?: string;
  rowCount?: number;
}

export interface BulkSnapshotResult {
  generatedAt: string;
  requested: string[];
  okCount: number;
  failCount: number;
  items: BulkSnapshotItem[];
  /** Raw chains keyed by underlying — included only when `includeChain=true` */
  chains?: Record<string, OcResponse>;
}

async function mapBoundedParallel<T, R>(
  inputs: T[],
  concurrency: number,
  fn: (input: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(inputs.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= inputs.length) return;
      out[i] = await fn(inputs[i] as T);
    }
  }
  const workers: Promise<void>[] = [];
  for (let w = 0; w < Math.min(concurrency, inputs.length); w++) workers.push(worker());
  await Promise.all(workers);
  return out;
}

export async function bulkSnapshot(
  underlyings: string[],
  opts: { includeChain?: boolean; concurrency?: number } = {},
): Promise<BulkSnapshotResult> {
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 6, 12));
  const cleaned = Array.from(new Set(underlyings.map(s => s.toUpperCase().trim()))).filter(Boolean);

  const chains: Record<string, OcResponse> = {};
  const items: BulkSnapshotItem[] = await mapBoundedParallel(cleaned, concurrency, async (sym) => {
    if (!isFnoUnderlying(sym)) {
      return { underlying: sym, ok: false, error: "Not in F&O list" };
    }
    try {
      const chain = await fetchKiteOnlyChain(sym);
      if (!chain) return { underlying: sym, ok: false, error: "No Kite chain data (session expired or instrument unavailable)" };
      const a = computeAnalytics(chain);
      if (opts.includeChain) chains[sym] = chain;
      return {
        underlying: sym,
        ok: true,
        spot: chain.spot,
        changePercent: chain.changePercent,
        expiry: chain.expiry,
        atmStrike: chain.atmStrike,
        pcrOi: a.pcrOi,
        pcrVolume: a.pcrVolume,
        maxPain: a.maxPain,
        atmIv: a.atmIv,
        bias: a.bias,
        totalCallOi: a.totalCallOi,
        totalPutOi: a.totalPutOi,
        callOiAdded: a.callOiAdded,
        putOiAdded: a.putOiAdded,
        topResistance: a.topResistance,
        topSupport: a.topSupport,
        interpretation: a.interpretation,
        source: chain.source,
        rowCount: chain.rows.length,
      };
    } catch (err) {
      return { underlying: sym, ok: false, error: (err as Error).message };
    }
  });

  return {
    generatedAt: new Date().toISOString(),
    requested: cleaned,
    okCount: items.filter(i => i.ok).length,
    failCount: items.filter(i => !i.ok).length,
    items,
    ...(opts.includeChain ? { chains } : {}),
  };
}

export function snapshotToCsv(snap: BulkSnapshotResult): string {
  const cols = [
    "underlying", "ok", "spot", "changePercent", "expiry", "atmStrike",
    "pcrOi", "pcrVolume", "maxPain", "atmIv", "bias",
    "totalCallOi", "totalPutOi", "callOiAdded", "putOiAdded",
    "topResistance", "topSupport", "interpretation", "source", "error",
  ];
  const escape = (v: unknown): string => {
    if (v == null) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [cols.join(",")];
  for (const it of snap.items) {
    const row = cols.map(c => {
      if (c === "topResistance") return escape(it.topResistance?.map(r => `${r.strike}:${r.oi}`).join("|"));
      if (c === "topSupport")    return escape(it.topSupport?.map(r => `${r.strike}:${r.oi}`).join("|"));
      return escape((it as Record<string, unknown>)[c]);
    });
    lines.push(row.join(","));
  }
  return lines.join("\n");
}

// ─── OI Heatmap (Futures) ────────────────────────────────────────────────────

interface KiteInstrumentLite {
  instrument_token: number;
  tradingsymbol: string;
  name: string;
  expiry: Date | string;
  strike: number;
  lot_size: number;
  instrument_type: string;
  segment: string;
  exchange: string;
}
interface KiteQuoteLite {
  last_price: number;
  oi?: number;
  volume?: number;
  net_change?: number;
  ohlc?: { open: number; high: number; low: number; close: number };
}

export type OiBuildupBucket = "LONG_BUILDUP" | "SHORT_BUILDUP" | "SHORT_COVERING" | "LONG_UNWINDING" | "NEUTRAL";

export interface OiHeatmapRow {
  symbol: string;
  fut: string;            // tradingsymbol of front-month FUT
  expiry: string;         // ISO date
  ltp: number;
  prevClose: number;
  priceChgPct: number;
  oi: number;
  baselineOi: number;
  oiChgAbs: number;
  oiChgPct: number;
  bucket: OiBuildupBucket;
  notional: number;       // ltp * oi * lot_size (approx rupee notional)
  lotSize: number;
  volume: number;
}

export interface OiHeatmapResponse {
  generatedAt: string;
  baselineEstablishedAt: string;
  rows: OiHeatmapRow[];
  buckets: Record<OiBuildupBucket, number>;
  totalNotional: number;
}

/** First-seen OI per instrument per session — establishes "baseline" for ∆%.
 *  Cleared when Kite session is cleared/expired. */
const oiBaselineMap = new Map<number, { oi: number; ts: number; symbol: string }>();
let baselineEstablishedAt: string | null = null;

function classifyBuildup(priceChgPct: number, oiChgPct: number): OiBuildupBucket {
  // Buildup classification REQUIRES a meaningful OI move on either side.
  // If OI is essentially flat, no fresh positions are being created/closed
  // regardless of how much price moved — that's pure spot drift, not buildup.
  const oNeutral = Math.abs(oiChgPct) < 0.5;
  const pNeutral = Math.abs(priceChgPct) < 0.1;
  if (oNeutral) return "NEUTRAL";
  if (pNeutral) return "NEUTRAL"; // OI shifting but no price reaction yet — undecided
  const pUp = priceChgPct > 0;
  const oUp = oiChgPct > 0;
  if (pUp && oUp) return "LONG_BUILDUP";
  if (!pUp && oUp) return "SHORT_BUILDUP";
  if (pUp && !oUp) return "SHORT_COVERING";
  return "LONG_UNWINDING";
}

export function clearOiBaseline(): void {
  oiBaselineMap.clear();
  baselineEstablishedAt = null;
}

const HEATMAP_CACHE_TTL = 30_000;
let heatmapCache: { data: OiHeatmapResponse; ts: number } | null = null;
// In-flight dedupe — concurrent callers share a single Kite fetch instead of
// each spawning their own (which would burn through the 1 req/sec quota).
let heatmapInflight: Promise<OiHeatmapResponse | null> | null = null;

export async function fetchOiHeatmap(): Promise<OiHeatmapResponse | null> {
  if (heatmapCache && Date.now() - heatmapCache.ts < HEATMAP_CACHE_TTL) return heatmapCache.data;
  if (heatmapInflight) return heatmapInflight;
  heatmapInflight = (async () => {
    try {
      return await fetchOiHeatmapInner();
    } finally {
      heatmapInflight = null;
    }
  })();
  return heatmapInflight;
}

async function fetchOiHeatmapInner(): Promise<OiHeatmapResponse | null> {
  const client = await getRestClient();
  if (!client) return null;
  const { kc } = client;

  // Pull NFO instruments once and pick the front-month FUT for each F&O name.
  const all = (await kc.getInstruments("NFO")) as KiteInstrumentLite[];
  const todayIso = new Date().toISOString().slice(0, 10);

  // Group FUT contracts by underlying name; pick nearest non-expired.
  const futByName = new Map<string, KiteInstrumentLite>();
  for (const i of all) {
    if (i.instrument_type !== "FUT") continue;
    const expIso = (typeof i.expiry === "string" ? i.expiry : i.expiry.toISOString()).slice(0, 10);
    if (expIso < todayIso) continue;
    const cur = futByName.get(i.name);
    if (!cur) { futByName.set(i.name, i); continue; }
    const curExp = (typeof cur.expiry === "string" ? cur.expiry : cur.expiry.toISOString()).slice(0, 10);
    if (expIso < curExp) futByName.set(i.name, i);
  }

  const futs = Array.from(futByName.values());
  if (futs.length === 0) return null;

  // Batch quote calls (Kite caps ~500 instruments per call)
  const symbols = futs.map(f => `NFO:${f.tradingsymbol}`);
  const quoteMap = new Map<string, KiteQuoteLite>();
  const BATCH = 400;
  for (let i = 0; i < symbols.length; i += BATCH) {
    try {
      const q = (await kc.getQuote(symbols.slice(i, i + BATCH))) as Record<string, KiteQuoteLite>;
      for (const [k, v] of Object.entries(q)) quoteMap.set(k, v);
    } catch (err) {
      logger.warn({ err: (err as Error).message, batchStart: i }, "OI heatmap: getQuote batch failed");
    }
  }

  const now = Date.now();
  const rows: OiHeatmapRow[] = [];
  for (const f of futs) {
    const q = quoteMap.get(`NFO:${f.tradingsymbol}`);
    if (!q || !q.last_price || q.oi == null) continue;

    // Establish/refresh OI baseline (first-of-session per instrument)
    let baseline = oiBaselineMap.get(f.instrument_token);
    if (!baseline) {
      baseline = { oi: q.oi, ts: now, symbol: f.name };
      oiBaselineMap.set(f.instrument_token, baseline);
      if (!baselineEstablishedAt) baselineEstablishedAt = new Date(now).toISOString();
    }

    const ltp = q.last_price;
    const prevClose = q.ohlc?.close ?? ltp;
    const priceChgPct = prevClose > 0 ? ((ltp - prevClose) / prevClose) * 100 : 0;
    const oiChgAbs = q.oi - baseline.oi;
    const oiChgPct = baseline.oi > 0 ? (oiChgAbs / baseline.oi) * 100 : 0;
    const bucket = classifyBuildup(priceChgPct, oiChgPct);

    const expIso = (typeof f.expiry === "string" ? f.expiry : f.expiry.toISOString()).slice(0, 10);
    rows.push({
      symbol: f.name,
      fut: f.tradingsymbol,
      expiry: expIso,
      ltp,
      prevClose,
      priceChgPct: +priceChgPct.toFixed(2),
      oi: q.oi,
      baselineOi: baseline.oi,
      oiChgAbs,
      oiChgPct: +oiChgPct.toFixed(2),
      bucket,
      notional: Math.round(ltp * q.oi * (f.lot_size || 1)),
      lotSize: f.lot_size || 0,
      volume: q.volume ?? 0,
    });
  }

  // Sort by absolute OI change (largest movements first) — most relevant first.
  rows.sort((a, b) => Math.abs(b.oiChgPct) - Math.abs(a.oiChgPct));

  const buckets: Record<OiBuildupBucket, number> = {
    LONG_BUILDUP: 0, SHORT_BUILDUP: 0, SHORT_COVERING: 0, LONG_UNWINDING: 0, NEUTRAL: 0,
  };
  let totalNotional = 0;
  for (const r of rows) {
    buckets[r.bucket]++;
    totalNotional += r.notional;
  }

  const out: OiHeatmapResponse = {
    generatedAt: new Date().toISOString(),
    baselineEstablishedAt: baselineEstablishedAt ?? new Date(now).toISOString(),
    rows,
    buckets,
    totalNotional,
  };
  heatmapCache = { data: out, ts: now };
  return out;
}

// ─── Intraday Tracker ────────────────────────────────────────────────────────

export interface TrackerSnapshot {
  ts: string;
  underlying: string;
  spot: number;
  changePercent: number;
  atmStrike: number;
  pcrOi: number;
  pcrVolume: number;
  maxPain: number;
  atmIv: number | null;
  totalCallOi: number;
  totalPutOi: number;
  callOiAdded: number;
  putOiAdded: number;
  bias: OptionAnalytics["bias"];
}

export interface TrackerStatus {
  running: boolean;
  startedAt: string | null;
  lastTickAt: string | null;
  nextTickAt: string | null;
  intervalMs: number;
  underlyings: string[];
  snapshotCount: number;
  errors: { ts: string; underlying: string; error: string }[];
}

interface TrackerState {
  running: boolean;
  startedAt: string | null;
  lastTickAt: string | null;
  intervalMs: number;
  underlyings: string[];
  timer: NodeJS.Timeout | null;
  snapshots: TrackerSnapshot[];
  errors: { ts: string; underlying: string; error: string }[];
}

const MAX_SNAPSHOTS = 600; // ~50 hours @ 5-min interval — plenty for a session
const MAX_ERRORS = 50;
const MAX_TRACKER_UNDERLYINGS = 20; // hard cap to protect Kite quota

interface TrackerStateExt extends TrackerState {
  /** Monotonic token; bumped on every start/stop so any in-flight tick from a
   *  previous run becomes a no-op when it tries to write its results. */
  runToken: number;
  /** Set while a tick is executing, so an overlapping setInterval call skips. */
  tickInFlight: boolean;
}

const trackerState: TrackerStateExt = {
  running: false,
  startedAt: null,
  lastTickAt: null,
  intervalMs: 5 * 60_000,
  underlyings: [],
  timer: null,
  snapshots: [],
  errors: [],
  runToken: 0,
  tickInFlight: false,
};

async function trackerTick(token: number): Promise<void> {
  // Skip if a previous tick is still in flight or this tick belongs to a stopped run.
  if (trackerState.tickInFlight) {
    logger.debug("Tracker: skipping tick — previous tick still in flight");
    return;
  }
  if (token !== trackerState.runToken || !trackerState.running) return;

  trackerState.tickInFlight = true;
  try {
    // Bail if Kite session disappeared (daily expiry, manual logout).
    const session = await getActiveSession().catch(() => null);
    if (!session) {
      logger.warn("Tracker: Kite session ended — auto-stopping and clearing state");
      stopTracker(true);
      return;
    }

    const ts = new Date().toISOString();
    const symsForThisTick = trackerState.underlyings.slice();
    let sessionLost = false;
    await mapBoundedParallel(symsForThisTick, 4, async (sym) => {
      try {
        // Mid-tick session + token check — abort writes if Kite died between symbols.
        if (token !== trackerState.runToken || !trackerState.running || sessionLost) return;
        const liveSession = await getActiveSession().catch(() => null);
        if (!liveSession) {
          sessionLost = true;
          return;
        }
        const chain = await fetchKiteOnlyChain(sym);
        if (token !== trackerState.runToken || !trackerState.running || sessionLost) return;
        if (!chain) {
          trackerState.errors.push({ ts, underlying: sym, error: "No Kite chain data" });
          if (trackerState.errors.length > MAX_ERRORS) trackerState.errors.shift();
          return;
        }
        const a = computeAnalytics(chain);
        const snap: TrackerSnapshot = {
          ts,
          underlying: sym,
          spot: chain.spot,
          changePercent: chain.changePercent,
          atmStrike: chain.atmStrike,
          pcrOi: a.pcrOi,
          pcrVolume: a.pcrVolume,
          maxPain: a.maxPain,
          atmIv: a.atmIv,
          totalCallOi: a.totalCallOi,
          totalPutOi: a.totalPutOi,
          callOiAdded: a.callOiAdded,
          putOiAdded: a.putOiAdded,
          bias: a.bias,
        };
        trackerState.snapshots.push(snap);
        if (trackerState.snapshots.length > MAX_SNAPSHOTS) trackerState.snapshots.shift();
      } catch (err) {
        if (token !== trackerState.runToken) return;
        trackerState.errors.push({ ts, underlying: sym, error: (err as Error).message });
        if (trackerState.errors.length > MAX_ERRORS) trackerState.errors.shift();
      }
    });
    if (token === trackerState.runToken && trackerState.running) {
      trackerState.lastTickAt = ts;
    }
  } finally {
    trackerState.tickInFlight = false;
  }
}

export async function startTracker(args: { underlyings: string[]; intervalMs?: number }): Promise<TrackerStatus> {
  const session = await getActiveSession().catch(() => null);
  if (!session) throw new Error("Kite session not active — login required first");

  const cleaned = Array.from(new Set(args.underlyings.map(s => s.toUpperCase().trim())))
    .filter(s => s && isFnoUnderlying(s));
  if (cleaned.length === 0) throw new Error("No valid F&O underlyings supplied");
  if (cleaned.length > MAX_TRACKER_UNDERLYINGS) {
    throw new Error(`Too many underlyings (${cleaned.length}); max is ${MAX_TRACKER_UNDERLYINGS} to respect Kite rate limits`);
  }

  const intervalMs = Math.max(60_000, Math.min(args.intervalMs ?? 5 * 60_000, 60 * 60_000));

  if (trackerState.timer) clearInterval(trackerState.timer);
  trackerState.runToken++;
  const myToken = trackerState.runToken;
  trackerState.running = true;
  trackerState.startedAt = new Date().toISOString();
  trackerState.intervalMs = intervalMs;
  trackerState.underlyings = cleaned;
  // Don't clear snapshots — let user keep prior session view if they restart.
  trackerState.timer = setInterval(() => { void trackerTick(myToken); }, intervalMs);
  // Kick an immediate tick so the user sees data without waiting one interval.
  void trackerTick(myToken);
  return getTrackerStatus();
}

export function stopTracker(clearData = false): TrackerStatus {
  if (trackerState.timer) clearInterval(trackerState.timer);
  trackerState.timer = null;
  trackerState.running = false;
  trackerState.runToken++; // invalidate any in-flight tick from the prior run
  if (clearData) {
    trackerState.snapshots = [];
    trackerState.errors = [];
    trackerState.startedAt = null;
    trackerState.lastTickAt = null;
    trackerState.underlyings = [];
  }
  return getTrackerStatus();
}

export function getTrackerStatus(): TrackerStatus {
  return {
    running: trackerState.running,
    startedAt: trackerState.startedAt,
    lastTickAt: trackerState.lastTickAt,
    nextTickAt: trackerState.lastTickAt && trackerState.running
      ? new Date(new Date(trackerState.lastTickAt).getTime() + trackerState.intervalMs).toISOString()
      : null,
    intervalMs: trackerState.intervalMs,
    underlyings: trackerState.underlyings,
    snapshotCount: trackerState.snapshots.length,
    errors: trackerState.errors.slice(-10),
  };
}

export function getTrackerSeries(underlying?: string): TrackerSnapshot[] {
  if (!underlying) return [...trackerState.snapshots];
  const sym = underlying.toUpperCase();
  return trackerState.snapshots.filter(s => s.underlying === sym);
}
