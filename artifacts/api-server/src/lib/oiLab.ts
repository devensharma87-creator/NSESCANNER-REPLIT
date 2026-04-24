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
import type { OcResponse, OcSide } from "./optionChain";
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

/** Cache for dynamic F&O universe pulled from Kite NFO instruments dump.
 *  The dump is updated by Kite once per day (~07:30 IST), so a 6-hour TTL is
 *  generous. Resets on Kite session loss via clearOiBaseline(). */
let dynamicUniverseCache: { stocks: string[]; ts: number } | null = null;
const UNIVERSE_TTL = 6 * 60 * 60 * 1000;

/**
 * Returns the LIVE F&O equity universe straight from Kite's NFO instruments
 * dump — every name that has at least one futures contract listed for the
 * current/next expiry. This is the authoritative source (changes whenever NSE
 * adds/removes F&O names) and replaces our hand-curated ~199-name list.
 *
 * Falls back to `null` if Kite isn't connected — caller should use the static
 * list as a safety net.
 */
export async function getDynamicFnoUniverse(): Promise<string[] | null> {
  if (dynamicUniverseCache && Date.now() - dynamicUniverseCache.ts < UNIVERSE_TTL) {
    return dynamicUniverseCache.stocks;
  }
  const client = await getRestClient();
  if (!client) return null;
  try {
    const all = (await client.kc.getInstruments("NFO")) as KiteInstrumentLite[];
    const todayIso = new Date().toISOString().slice(0, 10);
    // Pull names that have at least one non-expired FUT contract — that's the
    // canonical NSE definition of "F&O underlying".
    const names = new Set<string>();
    for (const i of all) {
      if (i.instrument_type !== "FUT") continue;
      const expIso = (typeof i.expiry === "string" ? i.expiry : i.expiry.toISOString()).slice(0, 10);
      if (expIso < todayIso) continue;
      // Skip indices — they live in FNO_INDICES already.
      if ((FNO_INDICES as readonly string[]).includes(i.name)) continue;
      names.add(i.name);
    }
    const stocks = Array.from(names).sort((a, b) => a.localeCompare(b));
    dynamicUniverseCache = { stocks, ts: Date.now() };
    logger.info({ count: stocks.length }, "OI Lab: dynamic F&O universe refreshed from Kite");
    return stocks;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "OI Lab: dynamic universe fetch failed");
    return null;
  }
}

export function clearDynamicUniverseCache(): void {
  dynamicUniverseCache = null;
}

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

  // Pre-compute the dynamic Kite F&O list ONCE per snapshot (it's cached for
  // 6h anyway). Falls back to the static `isFnoUnderlying` predicate when
  // Kite isn't connected so the existing static-only flow still rejects
  // junk symbols. This keeps the picker (which serves dynamic Kite names)
  // and the snapshot validator in sync — earlier the picker offered ~210
  // names but the snapshot rejected anything outside the static ~199 list.
  const dynamic = await getDynamicFnoUniverse();
  const isAcceptedFno = (sym: string): boolean => {
    if (dynamic && dynamic.length > 0) {
      return dynamic.includes(sym) || (FNO_INDICES as readonly string[]).includes(sym);
    }
    return isFnoUnderlying(sym);
  };

  const chains: Record<string, OcResponse> = {};
  const items: BulkSnapshotItem[] = await mapBoundedParallel(cleaned, concurrency, async (sym) => {
    if (!isAcceptedFno(sym)) {
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
      return escape((it as unknown as Record<string, unknown>)[c]);
    });
    lines.push(row.join(","));
  }
  return lines.join("\n");
}

// ─── OI Insights (single underlying, rich per-strike payload) ───────────────

export type SentimentBand =
  | "STRONGLY_BEARISH"
  | "MILDLY_BEARISH"
  | "NEUTRAL"
  | "MILDLY_BULLISH"
  | "STRONGLY_BULLISH";

export interface OiStrikeRow {
  strike: number;
  isAtm: boolean;
  // Calls
  ceOi: number;
  ceOiChg: number;          // intraday Δ OI
  ceVolume: number;
  ceLtp: number;
  ceIv: number | null;
  ceBuildup: "LONG_BUILDUP" | "SHORT_BUILDUP" | "SHORT_COVERING" | "LONG_UNWINDING" | "NEUTRAL";
  // Puts
  peOi: number;
  peOiChg: number;
  peVolume: number;
  peLtp: number;
  peIv: number | null;
  peBuildup: "LONG_BUILDUP" | "SHORT_BUILDUP" | "SHORT_COVERING" | "LONG_UNWINDING" | "NEUTRAL";
  // Per-strike PCR (OI)
  pcr: number;
  // Max-pain payout if expiry pinned at this strike (lower = more pain to writers AT this strike)
  painValue: number;
}

export interface OiInsightsResponse {
  underlying: string;
  kind: "INDEX" | "EQUITY";
  spot: number;
  prevClose: number;
  changePercent: number;
  expiry: string;
  expiries: string[];
  atmStrike: number;
  strikeStep: number;
  lotSize: number | null;
  source: string;
  generatedAt: string;
  // Aggregates
  pcrOi: number;
  /** Intraday flow polarity in [-1, +1]. +1 = puts being accumulated heavily
   *  vs calls (bullish writers); -1 = calls accumulated heavily (bearish). */
  intradayFlow: number;
  pcrVolume: number;
  /** When `false`, intraday OI delta fields (`ceOiChg`, `peOiChg`,
   *  `callOiAdded`, `putOiAdded`, `intradayFlow`) are derived from a Kite REST
   *  session-range proxy (`oi_day_high - oi_day_low`, signed by today's price
   *  change) — Kite REST does not expose tick-level OI deltas. The Intraday
   *  Tracker tab provides true tick-by-tick deltas when running. */
  intradayOiTrue: false;
  maxPain: number;
  maxPainDeviation: number;  // (spot - maxPain) / maxPain * 100
  atmIv: number | null;
  totalCallOi: number;
  totalPutOi: number;
  callOiAdded: number;
  putOiAdded: number;
  // Top OI clusters
  topResistance: { strike: number; oi: number }[];
  topSupport: { strike: number; oi: number }[];
  // Sentiment
  sentiment: SentimentBand;
  sentimentScore: number;    // -100 (extreme bear) … +100 (extreme bull)
  sentimentLabel: string;    // "Strongly Bearish", etc.
  marketInsight: string;     // 1-line summary
  analysis: string;          // 1-2 sentence detail
  // Per-strike rows (sorted asc by strike, trimmed to ATM ± strikesAround)
  strikes: OiStrikeRow[];
}

/** Normalize the chain's per-leg `oiBuildup` (which is `undefined` for missing
 *  legs or when no price/OI movement was observed) into a non-optional tag.
 *  We deliberately reuse the chain's classification — it's computed from real
 *  per-leg `priceChg` AND `oiChg`, not from a single boolean re-derivation. */
function legBuildupTag(b: OcSide["oiBuildup"] | undefined): OiStrikeRow["ceBuildup"] {
  return b ?? "NEUTRAL";
}

function bandFromScore(score: number): { band: SentimentBand; label: string } {
  if (score <= -60) return { band: "STRONGLY_BEARISH",  label: "Strongly Bearish" };
  if (score <= -20) return { band: "MILDLY_BEARISH",    label: "Mildly Bearish" };
  if (score <   20) return { band: "NEUTRAL",           label: "Neutral" };
  if (score <   60) return { band: "MILDLY_BULLISH",    label: "Mildly Bullish" };
  return                   { band: "STRONGLY_BULLISH",  label: "Strongly Bullish" };
}

/**
 * Score sentiment on a -100 .. +100 scale combining four signals.
 * Each signal is scored -25..+25 then summed.
 *
 *   1. Static PCR(OI)          — positioning weight (puts vs calls written)
 *   2. Spot vs Max-pain        — where option writers want price to land
 *   3. Intraday flow polarity  — direction of fresh OI accumulation today
 *   4. Top-cluster confirmation — does flow agree with where the heavy
 *                                 OI walls are (resistance vs support)?
 *
 * Note: signals 3 & 4 use the chain's session-range OI proxy (Kite REST
 * does not expose tick-level Δ OI). This is the same proxy the Heatmap tab
 * relies on for buildup classification — directionally correct in aggregate.
 */
function scoreSentiment(args: {
  pcrOi: number;
  spot: number;
  maxPain: number;
  intradayFlow: number; // already normalised in [-1, +1]
  topResistanceOi: number;
  topSupportOi: number;
}): number {
  // 1. Static PCR — pivot at 1.0, cap at 0.4..1.6.
  const pcrClamped = Math.max(0.4, Math.min(1.6, args.pcrOi));
  const pcrScore = ((pcrClamped - 1) / 0.6) * 25;

  // 2. Spot vs Max-pain — spot above max-pain = market biased upward.
  const mpDev = args.maxPain > 0 ? ((args.spot - args.maxPain) / args.maxPain) * 100 : 0;
  const mpClamped = Math.max(-2, Math.min(2, mpDev));
  const mpScore = (mpClamped / 2) * 25;

  // 3. Flow polarity — already in [-1, +1].
  const flowScore = args.intradayFlow * 25;

  // 4. Cluster confirmation — heavier put cluster (support) vs call cluster
  //    (resistance) means writers are anchoring price ABOVE the put strike,
  //    i.e. bullish. Bounded the same way as flow.
  const clusterMag = args.topSupportOi + args.topResistanceOi;
  const clusterRatio = clusterMag > 0
    ? (args.topSupportOi - args.topResistanceOi) / clusterMag
    : 0;
  const clusterScore = clusterRatio * 25;

  return Math.round(pcrScore + mpScore + flowScore + clusterScore);
}

function buildMarketInsight(
  band: SentimentBand,
  args: {
    pcrOi: number;
    spot: number;
    maxPain: number;
    callOiAdded: number;
    putOiAdded: number;
    topResistance: { strike: number; oi: number }[];
    topSupport: { strike: number; oi: number }[];
  },
): { insight: string; analysis: string } {
  const mpDev = args.maxPain > 0 ? ((args.spot - args.maxPain) / args.maxPain) * 100 : 0;
  const mpDir = mpDev > 0.2 ? "above" : mpDev < -0.2 ? "below" : "near";
  const r1 = args.topResistance[0]?.strike;
  const s1 = args.topSupport[0]?.strike;

  let insight: string;
  switch (band) {
    case "STRONGLY_BEARISH":
      insight = "Heavy call writing + put unwinding — strong bearish positioning";
      break;
    case "MILDLY_BEARISH":
      insight = "Call writers in control; cap on upside near key resistance";
      break;
    case "STRONGLY_BULLISH":
      insight = "Heavy put writing + call covering — strong bullish positioning";
      break;
    case "MILDLY_BULLISH":
      insight = "Put writers stepping in; supports building beneath spot";
      break;
    default:
      insight = "Balanced positioning — no clear directional bias";
  }

  const callDom = args.callOiAdded > Math.abs(args.putOiAdded) * 1.3;
  const putDom  = args.putOiAdded  > Math.abs(args.callOiAdded) * 1.3;
  const flowText = callDom
    ? `Heavy call accumulation (+${(args.callOiAdded / 1e7).toFixed(2)} Cr) vs puts (${(args.putOiAdded / 1e7).toFixed(2)} Cr) shows bearish positioning.`
    : putDom
    ? `Heavy put accumulation (+${(args.putOiAdded / 1e7).toFixed(2)} Cr) vs calls (${(args.callOiAdded / 1e7).toFixed(2)} Cr) shows bullish positioning.`
    : `OI flow is balanced between calls and puts.`;

  const analysis =
    `${band.replaceAll("_", " ").toLowerCase()} sentiment with PCR at ${args.pcrOi.toFixed(2)}. ` +
    `Spot ${mpDir} max-pain ${args.maxPain.toFixed(0)}` +
    (Number.isFinite(mpDev) && mpDev !== 0 ? ` (${mpDev > 0 ? "+" : ""}${mpDev.toFixed(2)}%). ` : `. `) +
    flowText +
    (r1 ? ` Key resistance ${r1}.` : "") +
    (s1 ? ` Key support ${s1}.` : "");

  return { insight, analysis };
}

/**
 * Build a rich, decision-ready payload for a single underlying — drives the
 * "OI Insights" surface in the UI (multi-strike OI bar chart + sentiment gauge
 * + max-pain + PCR donut, all from one call).
 *
 * @param strikesAround  Number of strikes ABOVE and BELOW ATM to include.
 *                       e.g. 10 returns ATM ± 10 = 21 rows. Pass 999 for "all".
 */
export function computeOiInsights(chain: OcResponse, strikesAround = 20): OiInsightsResponse {
  const rows = chain.rows;

  // Aggregates
  let totalCallOi = 0, totalPutOi = 0;
  let totalCallVol = 0, totalPutVol = 0;
  let callOiAdded = 0, putOiAdded = 0;
  for (const r of rows) {
    if (r.ce) {
      totalCallOi  += r.ce.oi ?? 0;
      totalCallVol += r.ce.volume ?? 0;
      callOiAdded  += r.ce.chgOi ?? 0;
    }
    if (r.pe) {
      totalPutOi   += r.pe.oi ?? 0;
      totalPutVol  += r.pe.volume ?? 0;
      putOiAdded   += r.pe.chgOi ?? 0;
    }
  }
  const pcrOi     = totalCallOi > 0 ? +(totalPutOi / totalCallOi).toFixed(3) : 0;
  const pcrVolume = totalCallVol > 0 ? +(totalPutVol / totalCallVol).toFixed(3) : 0;
  // Intraday flow polarity, bounded to [-1, +1] regardless of unwinding/build
  // direction. Positive = puts being written more than calls (bullish).
  // Negative = calls being written more than puts (bearish).
  // Using normalized signed difference avoids the divide-by-negative blowup
  // of a naive (put / |call|) - 1 ratio when call OI is being unwound.
  const flowMagAll = Math.abs(putOiAdded) + Math.abs(callOiAdded);
  const flowNet    = flowMagAll > 0 ? (putOiAdded - callOiAdded) / flowMagAll : 0;

  // Per-strike pain (premium writers pay if expiry pinned at this strike)
  const painByStrike: Map<number, number> = new Map();
  for (const target of rows) {
    let pain = 0;
    for (const r of rows) {
      if (r.strike < target.strike) pain += (target.strike - r.strike) * (r.ce?.oi ?? 0);
      else if (r.strike > target.strike) pain += (r.strike - target.strike) * (r.pe?.oi ?? 0);
    }
    painByStrike.set(target.strike, pain);
  }
  let maxPain = chain.atmStrike;
  let minPainVal = Infinity;
  for (const [strike, pain] of painByStrike) {
    if (pain < minPainVal) { minPainVal = pain; maxPain = strike; }
  }

  // ATM IV
  const atmRow = rows.find(r => r.strike === chain.atmStrike)
    ?? rows.slice().sort((a, b) => Math.abs(a.strike - chain.spot) - Math.abs(b.strike - chain.spot))[0];
  let atmIv: number | null = null;
  if (atmRow) {
    const ce = atmRow.ce?.iv;
    const pe = atmRow.pe?.iv;
    if (ce && pe) atmIv = +((ce + pe) / 2).toFixed(2);
    else if (ce) atmIv = +ce.toFixed(2);
    else if (pe) atmIv = +pe.toFixed(2);
  }

  // Top OI clusters (calls = resistance, puts = support)
  const callByStrike = rows.map(r => ({ strike: r.strike, oi: r.ce?.oi ?? 0 }));
  const putByStrike  = rows.map(r => ({ strike: r.strike, oi: r.pe?.oi ?? 0 }));
  const topResistance = [...callByStrike].sort((a, b) => b.oi - a.oi).slice(0, 5);
  const topSupport    = [...putByStrike].sort((a, b) => b.oi - a.oi).slice(0, 5);

  // Sentiment
  const topResistanceOi = topResistance.reduce((s, r) => s + r.oi, 0);
  const topSupportOi    = topSupport.reduce((s, r) => s + r.oi, 0);
  const score = scoreSentiment({
    pcrOi, spot: chain.spot, maxPain,
    intradayFlow: flowNet,
    topResistanceOi, topSupportOi,
  });
  const { band, label } = bandFromScore(score);
  const { insight, analysis } = buildMarketInsight(band, {
    pcrOi, spot: chain.spot, maxPain,
    callOiAdded, putOiAdded, topResistance, topSupport,
  });

  // Per-strike rows — reuse chain's per-leg `oiBuildup` (computed from real
  // priceChg + oiChg in optionChain.ts), don't re-derive from a single sign.
  const allStrikeRows: OiStrikeRow[] = rows.map(r => {
    const ceOi = r.ce?.oi ?? 0, peOi = r.pe?.oi ?? 0;
    return {
      strike: r.strike,
      isAtm: r.strike === chain.atmStrike,
      ceOi,
      ceOiChg: r.ce?.chgOi ?? 0,
      ceVolume: r.ce?.volume ?? 0,
      ceLtp: r.ce?.ltp ?? 0,
      ceIv: r.ce?.iv != null ? +r.ce.iv.toFixed(2) : null,
      ceBuildup: legBuildupTag(r.ce?.oiBuildup),
      peOi,
      peOiChg: r.pe?.chgOi ?? 0,
      peVolume: r.pe?.volume ?? 0,
      peLtp: r.pe?.ltp ?? 0,
      peIv: r.pe?.iv != null ? +r.pe.iv.toFixed(2) : null,
      peBuildup: legBuildupTag(r.pe?.oiBuildup),
      pcr: ceOi > 0 ? +(peOi / ceOi).toFixed(2) : 0,
      painValue: painByStrike.get(r.strike) ?? 0,
    };
  });

  // Trim to ATM ± strikesAround
  const atmIdx = allStrikeRows.findIndex(r => r.isAtm);
  const startIdx = Math.max(0, atmIdx - strikesAround);
  const endIdx = Math.min(allStrikeRows.length, atmIdx + strikesAround + 1);
  const strikes = atmIdx >= 0 ? allStrikeRows.slice(startIdx, endIdx) : allStrikeRows;

  return {
    underlying: chain.underlying,
    kind: chain.kind,
    spot: chain.spot,
    prevClose: chain.prevClose,
    changePercent: chain.changePercent,
    expiry: chain.expiry,
    expiries: chain.expiries,
    atmStrike: chain.atmStrike,
    strikeStep: chain.strikeStep,
    lotSize: chain.lotSize ?? null,
    source: chain.source,
    generatedAt: chain.generatedAt,
    pcrOi,
    intradayFlow: +flowNet.toFixed(3),
    intradayOiTrue: false,
    pcrVolume,
    maxPain,
    maxPainDeviation: maxPain > 0 ? +(((chain.spot - maxPain) / maxPain) * 100).toFixed(2) : 0,
    atmIv,
    totalCallOi, totalPutOi,
    callOiAdded, putOiAdded,
    topResistance, topSupport,
    sentiment: band,
    sentimentScore: score,
    sentimentLabel: label,
    marketInsight: insight,
    analysis,
    strikes,
  };
}

/** Convenience wrapper used by the route handler — fetches Kite-only chain
 *  then computes insights, surfacing a clean error when Kite isn't connected. */
export async function fetchOiInsights(
  underlying: string,
  expiry?: string,
  strikesAround = 20,
): Promise<OiInsightsResponse | null> {
  const sym = underlying.toUpperCase();
  const chain = expiry
    ? await fetchKiteOptionChain(sym, expiry)
    : await fetchKiteOnlyChain(sym);
  if (!chain) return null;
  return computeOiInsights(chain, strikesAround);
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

  // Use the dynamic Kite F&O list when available so the tracker accepts every
  // symbol the picker offers; fall back to the static predicate when Kite
  // hasn't returned a universe yet.
  const dynamicSet = new Set(await getDynamicFnoUniverse() ?? []);
  const cleaned = Array.from(new Set(args.underlyings.map(s => s.toUpperCase().trim())))
    .filter(s => s && (
      dynamicSet.size > 0
        ? (dynamicSet.has(s) || (FNO_INDICES as readonly string[]).includes(s))
        : isFnoUnderlying(s)
    ));
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
