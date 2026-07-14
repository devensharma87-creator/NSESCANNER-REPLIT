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
import { getOptionChain as getCentralOptionChain } from "./marketData/optionChainProvider";
import { computeAnalytics, type OptionAnalytics } from "./optionAnalytics";
import { enrichAnalyticsWithIv } from "./ivHistory";
import { getRestClient, getActiveSession } from "./kiteAuth";
import { reserveQuoteSlot } from "./kiteRateLimiter";
import { loadBlob, saveBlob, istTradingDay } from "./diskCache";
import { loadFnoInstruments, type FnoInstrument } from "./kiteFnoInstruments";
import { fetchKiteOiHistoricalByToken } from "./kiteIntraday";

/**
 * OI Lab uses TRADE_GRADE mode — Kite only. If Kite is down/expired, the
 * central provider returns an explicit unavailable result (no NSE/Yahoo
 * fallback). This function unwraps the central result for compatibility.
 */
async function fetchKiteOnlyChain(sym: string): Promise<OcResponse | null> {
  const result = await getCentralOptionChain(sym, "TRADE_GRADE");
  return result.ok && result.data ? result.data.chain : null;
}

// ─── Universe ────────────────────────────────────────────────────────────────
// Owner-restricted (2026-05-08): only NIFTY / BANKNIFTY / SENSEX. Mirrors the
// OPTION_INDICES restriction in optionSignals.ts so OI Lab + signal engine
// always show the same universe (no orphaned analytics for indices we no
// longer trade). To restore: re-add symbols here AND in OPTION_INDICES.
export const FNO_INDICES = [
  "NIFTY",
  "BANKNIFTY",
  "SENSEX",   // BSE — quoted via BFO segment
] as const;

// Explicit denylist of indices removed from the F&O universe. Used by
// getDynamicFnoUniverse() to suppress their re-admission as "stocks" (they
// appear in Kite's NFO instruments dump as FUT contracts under their own
// `.name`, so the prior `!FNO_INDICES.includes(name)` filter alone would let
// them sneak back in once they were dropped from FNO_INDICES). Also enforced
// by bulkSnapshot() and startTracker() validators so OI Lab / tracker can
// never accept these underlyings even if a stale client sends them.
const REMOVED_FNO_INDEX_NAMES = new Set<string>([
  "FINNIFTY",
  "MIDCPNIFTY",
  "BANKEX",
  "NIFTYNXT50",
  // Kite's instruments dump uses these alternate `.name` values for the same
  // indices, so deny both forms to be safe.
  "NIFTY FIN SERVICE",
  "NIFTY MID SELECT",
  "NIFTY NEXT 50",
  "BSE BANKEX",
]);

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
    const all = await loadFnoInstruments(client.kc);
    const todayIso = new Date().toISOString().slice(0, 10);
    const names = new Set<string>();
    for (const i of all) {
      if (i.instrument_type !== "FUT") continue;
      const expIso = (typeof i.expiry === "string" ? i.expiry : i.expiry.toISOString()).slice(0, 10);
      if (expIso < todayIso) continue;
      if ((FNO_INDICES as readonly string[]).includes(i.name)) continue;
      // Suppress removed indices so they don't get classified as "stocks".
      if (REMOVED_FNO_INDEX_NAMES.has(i.name)) continue;
      names.add(i.name);
    }
    const stocks = Array.from(names).sort((a, b) => a.localeCompare(b));
    if (stocks.length > 0) {
      dynamicUniverseCache = { stocks, ts: Date.now() };
    } else if (dynamicUniverseCache) {
      return dynamicUniverseCache.stocks;
    }
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
  /** IV Percentile over 1Y rolling history — % of days where ATM IV was
   *  below today's. null when fewer than 5 history rows exist. */
  ivPercentile?: number | null;
  /** IV Rank — (current - min) / (max - min) × 100 over 1Y window. */
  ivRank?: number | null;
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
    // Hard-reject removed indices regardless of dynamic universe contents —
    // protects against stale clients still sending FINNIFTY/MIDCPNIFTY/BANKEX.
    if (REMOVED_FNO_INDEX_NAMES.has(sym)) return false;
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
      // Persist today's ATM IV + read back rank/percentile over 1Y rolling
      // window. Failures here never break the snapshot — IV history is a
      // best-effort enrichment, not a hard dependency.
      const ivMetrics = await enrichAnalyticsWithIv({
        underlying: sym,
        atmIv: a.atmIv,
        ivPercentile: a.ivPercentile,
        ivRank: a.ivRank,
      }).catch(() => ({ ivRank: null as number | null, ivPercentile: null as number | null }));
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
        ivPercentile: ivMetrics.ivPercentile,
        ivRank: ivMetrics.ivRank,
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
  // Black-Scholes Greeks (computed in optionChain/kiteOptionChain layer)
  ceDelta?: number;
  ceGamma?: number;
  ceTheta?: number;
  ceVega?: number;
  /** Absolute LTP change vs prev close (₹). Null when prev close unavailable
   *  (NSE-direct path doesn't return per-leg prev close). Source: Kite. */
  ceLtpChg?: number | null;
  // Puts
  peOi: number;
  peOiChg: number;
  peVolume: number;
  peLtp: number;
  peIv: number | null;
  peBuildup: "LONG_BUILDUP" | "SHORT_BUILDUP" | "SHORT_COVERING" | "LONG_UNWINDING" | "NEUTRAL";
  peDelta?: number;
  peGamma?: number;
  peTheta?: number;
  peVega?: number;
  /** Absolute LTP change vs prev close (₹). Null when prev close unavailable. */
  peLtpChg?: number | null;
  // Per-strike PCR (OI)
  pcr: number;
  // Max-pain payout if expiry pinned at this strike (lower = more pain to writers AT this strike)
  painValue: number;
  /** Per-strike Δ OI computed against a server-stored baseline taken
   *  ~`windowMs` ago. `null` means the server doesn't yet have a snapshot
   *  old enough for the requested window — the client must NOT substitute
   *  any other delta (no synthetic since-open fallback at strike level). */
  ceOiChgWindow?: number | null;
  peOiChgWindow?: number | null;
  /** Same Δ in crores (raw / 1e7), pre-rounded to 4 decimals so the client
   *  doesn't have to do its own /1e7 conversion (and risk drift between
   *  card / chart / tooltip — the spec's #14 accuracy rule). Null when
   *  the corresponding raw Δ field is null (no baseline for this strike). */
  ceOiChgWindowCr?: number | null;
  peOiChgWindowCr?: number | null;
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
  // ── Sprint 3 Phase B: Provenance fields ──────────────────────────────────
  /** Where the underlying spot price originated. */
  spotSource: string;
  /** True when spot is from a real-time trusted source (Kite or NSE). */
  spotTrusted: boolean;
  /** LTP of the nearest-month liquid FUT contract. Null when unavailable. */
  futurePrice: number | null;
  /** Source provenance for the future price ("kite" | "unavailable"). */
  futureSource: string;
  /** Expiry of the FUT contract used for futurePrice. */
  futureExpiry: string | null;
  /** Synthetic future from put-call parity at ATM. Null when ATM legs missing. */
  syntheticFuture: number | null;
  /** True when syntheticFuture is a modelled (not exchange-provided) value. */
  syntheticFutureModelled: boolean;
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
  /** Conviction strength on the active side, 0-100. Mirrors the
   *  "Bearish 70%" / "Bullish 80%" reading commercial chains surface.
   *  Computed as |sentimentScore| capped at 100. For NEUTRAL bands this
   *  reads how *close to neutral* the chain is (small number = balanced). */
  sentimentStrengthPct: number;
  marketInsight: string;     // 1-line summary
  analysis: string;          // 1-2 sentence detail
  // Per-strike rows (sorted asc by strike, trimmed to ATM ± strikesAround)
  strikes: OiStrikeRow[];
  /** When the client requested a finite Δ window (e.g. "?window=5m"), this
   *  block describes how the server fulfilled it. Absent when the client
   *  asked for the broker since-open Δ (default). */
  windowMs?: number;
  /** "exact"  — baseline within ±20% of requested window, Δ is honest.
   *  "approx" — closest available baseline is OUTSIDE ±20% (oldest snap
   *             we have is e.g. 90s old when 5min was requested).
   *  "none"   — server has no usable baseline yet (just-restarted /
   *             newly-tracked symbol). Per-strike `*OiChgWindow` will be
   *             `null` and the client should render a "buffering" state. */
  windowMode?: "exact" | "approx" | "none";
  /** ISO timestamp of the snapshot used as baseline. Null for "none". */
  windowBaselineAt?: string | null;
  /** Underlying spot price captured AT the baseline snapshot. Lets the
   *  client render Sensibull's two-anchor "NIFTY at HH:MM → NIFTY now"
   *  readout without inferring spot history client-side. Null when the
   *  baseline snap predates spot capture (legacy disk blob) or when the
   *  chain didn't publish a finite spot for that snap. */
  windowBaselineSpot?: number | null;
  /** Oldest snapshot the server has for this (underlying|expiry) — useful
   *  for telling the user "buffer fills in N more minutes" without making
   *  them retry blindly. Null when no snapshot exists at all. */
  windowBufferOldestAt?: string | null;
  /** Total snapshot count the server holds for this (underlying|expiry).
   *  Helps the client surface "Server has 4 snapshots, need 1 more" UX. */
  windowBufferCount?: number;
  /** ── Time-Based OI Change totals (windowed) ─────────────────────────
   *  Sums of CE/PE OI at the START snap and the END snap, plus the deltas
   *  in raw and Cr units. ONLY includes strikes that had BOTH a baseline
   *  CE leg AND a baseline PE leg (i.e. strikes whose `ceOiChgWindow` and
   *  `peOiChgWindow` are non-null) — guarantees the totals exactly equal
   *  the sum of strike-level deltas the client renders (spec acceptance
   *  criterion #4). Absent when `windowMode === "none"`. */
  windowTotals?: {
    callOiStart: number;
    callOiEnd: number;
    putOiStart: number;
    putOiEnd: number;
    callOiChange: number;
    putOiChange: number;
    callOiChangeCr: number;
    putOiChangeCr: number;
    /** Number of strikes that contributed to the sums (both legs had a
     *  baseline). Lets the client say "based on N strikes". */
    strikesIncluded: number;
  } | null;
  /** ── Windowed PCR readouts ──────────────────────────────────────────
   *  • `pcrStart`     : Put OI at start / Call OI at start (snapshot PCR
   *                     at the baseline timestamp)
   *  • `pcrEnd`       : Put OI at end   / Call OI at end   (snapshot PCR
   *                     right now — same as `pcrOi` when strike sets match)
   *  • `pcrChange`    : pcrEnd - pcrStart (signed, +ve = put-heavier
   *                     bias built up over the window)
   *  • `pcrOiChange`  : Put OI Δ / Call OI Δ over the window. The sign
   *                     follows the writers' direction: +0.81 means puts
   *                     were unwound 0.81× as much as calls when both
   *                     sides shrank. Null when |callOiChange| ≈ 0 to
   *                     avoid Infinity / NaN.
   *  • `pcrOiChangeAbs`: |Put OI Δ| / |Call OI Δ| — ratio of magnitudes,
   *                     used when the user wants to compare absolute
   *                     activity regardless of direction.
   *  Absent when `windowMode === "none"`. */
  windowPcr?: {
    pcrStart: number | null;
    pcrEnd: number | null;
    pcrChange: number | null;
    pcrOiChange: number | null;
    pcrOiChangeAbs: number | null;
  } | null;
}

/** Normalize the chain's per-leg `oiBuildup` (which is `undefined` for missing
 *  legs or when no price/OI movement was observed) into a non-optional tag.
 *  We deliberately reuse the chain's classification — it's computed from real
 *  per-leg `priceChg` AND `oiChg`, not from a single boolean re-derivation. */
function legBuildupTag(b: OcSide["oiBuildup"] | undefined): OiStrikeRow["ceBuildup"] {
  return b ?? "NEUTRAL";
}

function bandFromScore(score: number): { band: SentimentBand; label: string } {
  // Tightened bands (was ±20 / ±60) so a clearly directional PCR can no
  // longer be swallowed by NEUTRAL. With the rebalanced scoreSentiment()
  // below, PCR alone of 0.76 contributes ≈-28, which now correctly lands
  // in MILDLY_BEARISH instead of getting cancelled out by a +3 max-pain
  // tilt and reading "NEUTRAL -6".
  if (score <= -55) return { band: "STRONGLY_BEARISH",  label: "Strongly Bearish" };
  if (score <= -12) return { band: "MILDLY_BEARISH",    label: "Mildly Bearish" };
  if (score <   12) return { band: "NEUTRAL",           label: "Neutral" };
  if (score <   55) return { band: "MILDLY_BULLISH",    label: "Mildly Bullish" };
  return                   { band: "STRONGLY_BULLISH",  label: "Strongly Bullish" };
}

/**
 * Score sentiment on a -100 .. +100 scale combining four weighted signals.
 *
 *   1. Static PCR(OI)          ±35 — positioning weight (heaviest signal)
 *   2. Spot vs Max-pain        ±20 — where option writers want price to land
 *   3. Intraday flow polarity  ±20 — direction of fresh OI today
 *   4. Top-cluster confirmation ±25 — does flow agree with where the heavy
 *                                     OI walls are (resistance vs support)?
 *
 * Why PCR is now the heaviest leg (was ±25, now ±35 with a steeper slope):
 * the prior ±25 weight with a 0.4..1.6 clamp meant a clearly-bearish
 * PCR=0.76 contributed only -10. Combined with a +3 max-pain tilt that
 * landed in NEUTRAL (-6), even though every commercial option-chain
 * platform (StockMojo / Sensibull / Opstra) reads the same chain as
 * "Bearish ~70%". PCR(OI) is the most directly informative single number
 * in an Indian option chain — the rebalance reflects that.
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
  // 1. Static PCR — pivot at 1.0, saturate at 0.7 / 1.3 (was 0.4 / 1.6).
  //    NSE convention: PCR < 0.7 = bearish saturation, > 1.3 = bullish
  //    saturation. Clamping there means the score reads bearish *enough*
  //    to escape NEUTRAL the moment PCR drops below ~0.85.
  const pcrClamped = Math.max(0.7, Math.min(1.3, args.pcrOi));
  const pcrScore = ((pcrClamped - 1) / 0.3) * 35;

  // 2. Spot vs Max-pain — spot above max-pain = market biased upward.
  const mpDev = args.maxPain > 0 ? ((args.spot - args.maxPain) / args.maxPain) * 100 : 0;
  const mpClamped = Math.max(-2, Math.min(2, mpDev));
  const mpScore = (mpClamped / 2) * 20;

  // 3. Flow polarity — already in [-1, +1].
  const flowScore = args.intradayFlow * 20;

  // 4. Cluster confirmation — heavier put cluster (support) vs call cluster
  //    (resistance) means writers are anchoring price ABOVE the put strike,
  //    i.e. bullish.
  const clusterMag = args.topSupportOi + args.topResistanceOi;
  const clusterRatio = clusterMag > 0
    ? (args.topSupportOi - args.topResistanceOi) / clusterMag
    : 0;
  const clusterScore = clusterRatio * 25;

  // Sum saturates at ±100 (35 + 20 + 20 + 25).
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
    ? `Heavy call accumulation (+${(args.callOiAdded / 1e7).toFixed(2)} Cr contracts) vs puts (${(args.putOiAdded / 1e7).toFixed(2)} Cr contracts) shows bearish positioning.`
    : putDom
    ? `Heavy put accumulation (+${(args.putOiAdded / 1e7).toFixed(2)} Cr contracts) vs calls (${(args.callOiAdded / 1e7).toFixed(2)} Cr contracts) shows bullish positioning.`
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
    if (pain < minPainVal) {
      minPainVal = pain;
      maxPain = strike;
    } else if (
      pain === minPainVal &&
      Math.abs(strike - chain.spot) < Math.abs(maxPain - chain.spot)
    ) {
      // Deterministic tie-break: when two strikes both minimise option-writer
      // pain, prefer the one closest to spot. Old code relied on Map iteration
      // order which (a) is implementation-defined and (b) made max-pain jitter
      // run-to-run for chains that had ties.
      maxPain = strike;
    }
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

  // Top OI clusters (calls = resistance, puts = support).
  // Side-correct R/S: only CE strikes ≥ spot count as resistance, only PE
  // strikes ≤ spot count as support. ITM-side OI is hedging noise, not a
  // wall, and was bubbling up as the displayed level. See twin filter in
  // optionAnalytics.ts (used by bulkSnapshot) for the originating bug.
  const callByStrike = rows.map(r => ({ strike: r.strike, oi: r.ce?.oi ?? 0 }));
  const putByStrike  = rows.map(r => ({ strike: r.strike, oi: r.pe?.oi ?? 0 }));
  const resistanceCandidates = callByStrike.filter(c => c.strike >= chain.spot);
  const supportCandidates    = putByStrike.filter(c => c.strike <= chain.spot);
  const topResistance = (resistanceCandidates.length > 0 ? resistanceCandidates : callByStrike)
    .slice().sort((a, b) => b.oi - a.oi).slice(0, 5);
  const topSupport    = (supportCandidates.length > 0 ? supportCandidates : putByStrike)
    .slice().sort((a, b) => b.oi - a.oi).slice(0, 5);

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
      ceDelta: r.ce?.delta,
      ceGamma: r.ce?.gamma,
      ceTheta: r.ce?.theta,
      ceVega:  r.ce?.vega,
      ceLtpChg: r.ce?.ltpChange ?? null,
      peOi,
      peOiChg: r.pe?.chgOi ?? 0,
      peVolume: r.pe?.volume ?? 0,
      peLtp: r.pe?.ltp ?? 0,
      peIv: r.pe?.iv != null ? +r.pe.iv.toFixed(2) : null,
      peBuildup: legBuildupTag(r.pe?.oiBuildup),
      peDelta: r.pe?.delta,
      peGamma: r.pe?.gamma,
      peTheta: r.pe?.theta,
      peVega:  r.pe?.vega,
      peLtpChg: r.pe?.ltpChange ?? null,
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
    // Sprint 3 Phase B: provenance fields
    spotSource: chain.spotSource ?? "unavailable",
    spotTrusted: chain.spotTrusted ?? false,
    futurePrice: chain.futurePrice ?? null,
    futureSource: chain.futureSource ?? "unavailable",
    futureExpiry: chain.futureExpiry ?? null,
    syntheticFuture: chain.syntheticFuture ?? null,
    syntheticFutureModelled: chain.syntheticFutureModelled === true,
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
    sentimentStrengthPct: Math.min(100, Math.abs(score)),
    sentimentLabel: label,
    marketInsight: insight,
    analysis,
    strikes,
  };
}

// ─── Per-strike OI snapshot history (server-owned) ────────────────────────
// The OI Insights chart needs a "Δ over the last N minutes" view that
// works the moment the page opens — not after the user has waited 3+ min
// for a client-side rolling buffer to warm up. The server already polls
// the chain every time a client refreshes (~30s), so we piggyback on
// those calls: every successful `fetchOiInsights` pushes a per-strike
// snapshot into a per-(underlying|expiry) ring buffer. A finite-window
// request (`?window=5m`) then picks the snapshot closest to `now-5min`
// and computes per-strike Δ on the spot.
//
// Buffer survives across server restarts (same-day only) via the existing
// disk-cache infrastructure, so a restart at 14:00 doesn't reset every
// strike's "Last 1 hr" Δ to "buffering".
interface OiInsightsSnapshot {
  ts: number;                          // epoch ms
  ce: Record<number, number>;          // strike -> ceOi
  pe: Record<number, number>;          // strike -> peOi
  /** Underlying spot at snapshot time. Optional for backwards-compat with
   *  blobs persisted before this field existed — old snaps load with
   *  `undefined` and the windowed-Δ block surfaces baseline spot as null. */
  spot?: number;
}
const OI_INSIGHTS_HISTORY = new Map<string, OiInsightsSnapshot[]>();
// Hard cap per (underlying|expiry) — 3.5h at ~30s cadence ≈ 420 snapshots.
// We compress to ~12 strikes effective cost per snapshot (~1KB), so 420
// snapshots × 50 underlyings ≈ 20MB worst case. Comfortably bounded.
const OI_INSIGHTS_HISTORY_MAX = 450;
const OI_INSIGHTS_HISTORY_WINDOW_MS = (3 * 60 + 10) * 60_000; // 3h10m
const OI_INSIGHTS_BLOB_NAME = "oi-insights-history";
const OI_INSIGHTS_BLOB_VERSION = 1;
let oiInsightsHydrated = false;

interface OiInsightsDiskShape {
  tradingDay: string;
  entries: Array<[string, OiInsightsSnapshot[]]>;
}

function hydrateOiInsightsHistoryFromDisk(): void {
  if (oiInsightsHydrated) return;
  oiInsightsHydrated = true;
  const blob = loadBlob<OiInsightsDiskShape>(OI_INSIGHTS_BLOB_NAME, OI_INSIGHTS_BLOB_VERSION);
  if (!blob) return;
  const today = istTradingDay();
  if (blob.payload.tradingDay !== today) {
    logger.info({ stored: blob.payload.tradingDay, today }, "OI insights history: discarding stale (different trading day)");
    return;
  }
  for (const [k, snaps] of blob.payload.entries) {
    OI_INSIGHTS_HISTORY.set(k, snaps);
  }
  logger.info({ keys: OI_INSIGHTS_HISTORY.size }, "OI insights history: warm-started from disk");
}

// Debounce disk writes — every fetchOiInsights call would otherwise
// rewrite the entire blob (~20MB worst case), causing significant write
// amplification when many symbols are being polled concurrently. A 15s
// floor still survives a process restart with at most one missed
// snapshot per symbol, which is acceptable (the next poll re-fills it).
let lastPersistAt = 0;
const PERSIST_MIN_INTERVAL_MS = 15_000;
function persistOiInsightsHistoryToDisk(): void {
  const now = Date.now();
  if (now - lastPersistAt < PERSIST_MIN_INTERVAL_MS) return;
  lastPersistAt = now;
  try {
    const payload: OiInsightsDiskShape = {
      tradingDay: istTradingDay(),
      entries: Array.from(OI_INSIGHTS_HISTORY.entries()),
    };
    saveBlob(OI_INSIGHTS_BLOB_NAME, OI_INSIGHTS_BLOB_VERSION, payload);
  } catch { /* logged inside saveBlob */ }
}

/** Returns true when `ts` (epoch ms) falls inside the IST trading session
 *  window [09:15, 15:35]. Used by the READ-PATH baseline filter
 *  (`resolveWindowDelta`) to ensure picked baselines are real intraday
 *  snaps, not post-close frozen-OI tails. Timezone-safe via the IST
 *  minute-of-day trick (UTC+5:30 = +330 min). */
function isInIstMarketHours(ts: number): boolean {
  const istMin = ((Math.floor(ts / 60_000) + 330) % 1440 + 1440) % 1440;
  const OPEN_MIN = 9 * 60 + 15;   // 555  → 09:15 IST
  const CLOSE_MIN = 15 * 60 + 35; // 935  → 15:35 IST (5min post-close grace)
  return istMin >= OPEN_MIN && istMin <= CLOSE_MIN;
}

/** WRITE-path gate: accept any push at/after 09:15 IST. The previous
 *  strict [09:15, 15:35] window had a footgun — if the api-server is
 *  restarted after market close (common during dev/deploy), every
 *  subsequent `pushOiInsightsSnapshot` call is silently dropped, the
 *  buffer stays at 0 snaps, and the OI Lab Δ-window selector falls back
 *  to broker since-open Δ for every pill (the user-reported bug: "30
 *  min / 1 hr / 3 hr all show the same -3.83Cr"). Relaxing the gate to
 *  "≥ 09:15 IST today" lets post-close polls hydrate the buffer with
 *  the last-known frozen-OI snap so the selector works going forward
 *  (post-close Δ naturally reads ~0, which is truthful — OI doesn't
 *  move after close). Pre-open (00:00-09:14 IST) is still rejected to
 *  prevent yesterday's stale OI carryover from poisoning the next
 *  day's "All / Full Day" baseline pick. Cross-day rollover at midnight
 *  is handled separately by `hydrateOiInsightsHistoryFromDisk`'s
 *  `tradingDay` discard. */
function isAtOrAfterIstMarketOpen(ts: number): boolean {
  const istMin = ((Math.floor(ts / 60_000) + 330) % 1440 + 1440) % 1440;
  const OPEN_MIN = 9 * 60 + 15;   // 555  → 09:15 IST
  return istMin >= OPEN_MIN;
}

/** Deep-equal compare of two snapshot CE+PE strike maps. Used for
 *  post-close dedup — once OI freezes at 15:30, every subsequent poll
 *  reports identical strike values; without this dedup the 450-snap
 *  ring-buffer cap would evict legitimate intraday snaps within ~3.75h
 *  of post-close polling at 30s cadence. */
function snapDataEquals(a: OiInsightsSnapshot, b: OiInsightsSnapshot): boolean {
  const aCeKeys = Object.keys(a.ce);
  const bCeKeys = Object.keys(b.ce);
  if (aCeKeys.length !== bCeKeys.length) return false;
  for (const k of aCeKeys) if (a.ce[k as unknown as number] !== b.ce[k as unknown as number]) return false;
  const aPeKeys = Object.keys(a.pe);
  const bPeKeys = Object.keys(b.pe);
  if (aPeKeys.length !== bPeKeys.length) return false;
  for (const k of aPeKeys) if (a.pe[k as unknown as number] !== b.pe[k as unknown as number]) return false;
  return true;
}

function pushOiInsightsSnapshot(insights: OiInsightsResponse): void {
  const key = `${insights.underlying}|${insights.expiry}`;
  const ts = new Date(insights.generatedAt).getTime();
  // Pre-market guard ONLY. Pre-9:15 IST snaps carry yesterday's stale
  // OI and would poison the "All / Full Day" baseline pick on the first
  // morning poll. Post-close pushes are accepted (and dedup'd below)
  // so the buffer hydrates even when the server is restarted after
  // market close — see `isAtOrAfterIstMarketOpen` for full rationale.
  if (!isAtOrAfterIstMarketOpen(ts)) {
    return;
  }
  const snap: OiInsightsSnapshot = {
    ts,
    ce: Object.fromEntries(insights.strikes.map(s => [s.strike, s.ceOi])),
    pe: Object.fromEntries(insights.strikes.map(s => [s.strike, s.peOi])),
    // Capture spot at snapshot time so the windowed-Δ block can surface
    // a "NIFTY at HH:MM ➜ NIFTY now" two-anchor readout, mirroring the
    // Sensibull "Change on <date>" panel.
    spot: Number.isFinite(insights.spot) ? insights.spot : undefined,
  };
  insertOiSnap(key, snap);
}

/** Order-preserving insert of a fully-built snapshot into the per-key
 *  ring buffer. Extracted from `pushOiInsightsSnapshot` so the
 *  Kite-historical backfill path (`backfillOiInsightsHistoryFromKite`)
 *  can write reconstructed past snapshots into the same buffer without
 *  re-running the OI insights computation pipeline.
 *
 *  The backfill caller pre-validates `snap.ts` is in-session today, so
 *  the pre-market write-gate is intentionally NOT re-applied here —
 *  that gate belongs to the LIVE-poll entry point which receives a
 *  wall-clock timestamp that could legitimately be pre-09:15 if the
 *  user opens OI Lab at 08:30 IST. Backfill timestamps are always
 *  Kite-candle-bucket close times for in-session candles, so they're
 *  guaranteed in [09:15, 15:30] by construction. */
function insertOiSnap(key: string, snap: OiInsightsSnapshot): void {
  const ts = snap.ts;
  const buf = OI_INSIGHTS_HISTORY.get(key) ?? [];
  // Order-preserving insert. `resolveWindowDelta` relies on the buffer
  // being sorted by `ts` ascending (so `candidates[0]` is oldest and the
  // last-older-than-cutoff search via filter+pop returns the true
  // latest-≤-cutoff baseline). A naive `buf.push(snap)` would break that
  // invariant under concurrent requests: if the chain fetch for an older
  // poll resolves AFTER a newer one (out-of-order async resolution, no
  // in-flight dedup at fetchKiteOptionChain), the older `ts` would land
  // at the end of the array and corrupt baseline picking.
  //
  // The buffer is bounded to OI_INSIGHTS_HISTORY_MAX (450), and the
  // common case is "new ts >= every existing ts", so we walk from the
  // tail and bail at the first older entry — O(1) amortised on the hot
  // path, O(n) worst case when stale ticks land. Same-ts entries get
  // MERGED (strike-map union) anywhere in the buffer, not just at the
  // tail — this protects against the strikes=20 → strikes=5 shrink bug
  // even when the duplicate ts isn't the most-recent slot.
  let insertIdx = buf.length;
  while (insertIdx > 0 && buf[insertIdx - 1]!.ts > ts) insertIdx--;
  if (insertIdx > 0 && buf[insertIdx - 1]!.ts === ts) {
    const prev = buf[insertIdx - 1]!;
    buf[insertIdx - 1] = {
      ts,
      ce: { ...prev.ce, ...snap.ce },
      pe: { ...prev.pe, ...snap.pe },
      // Prefer the freshest spot (snap.spot from the just-arrived poll)
      // but keep prev.spot as a fallback when the new poll didn't carry
      // a finite spot for some reason.
      spot: snap.spot ?? prev.spot,
    };
  } else if (insertIdx === buf.length) {
    // Pure tail-append path. Apply value-dedup against the most-recent
    // buffered snap: once OI freezes at 15:30 IST, every subsequent poll
    // reports identical CE/PE strike values; without this guard, post-close
    // polls at 30s cadence would evict ~3.75h of legitimate intraday history
    // via the 450-snap cap (the partner of the relaxed write-gate above —
    // both are needed to make the OI Lab Δ-window selector work post-close
    // without sacrificing intraday baseline availability). Skipping the
    // push also skips the disk persist (the buffer hasn't changed).
    //
    // CRITICAL: this dedup MUST come AFTER the same-ts merge branch above,
    // not before — a pre-merge tail dedup would incorrectly drop an
    // out-of-order arrival whose ts matches a mid-buffer row but whose
    // values match the tail, bypassing the strike-map-union merge and
    // leaving the mid-buffer row partial. Gating on `insertIdx === buf.length`
    // (true tail-append) plus the same-ts branch above guarantees the
    // merge always runs when applicable. Mid-buffer splice inserts
    // (rare out-of-order arrivals with ts strictly between two existing
    // rows) intentionally bypass dedup since they carry novel
    // intermediate-time data even if values happen to equal the tail.
    if (buf.length > 0 && snapDataEquals(buf[buf.length - 1]!, snap)) {
      return;
    }
    buf.push(snap);
  } else {
    buf.splice(insertIdx, 0, snap);
  }
  const cutoff = ts - OI_INSIGHTS_HISTORY_WINDOW_MS;
  while (buf.length > 0 && buf[0]!.ts < cutoff) buf.shift();
  while (buf.length > OI_INSIGHTS_HISTORY_MAX) buf.shift();
  OI_INSIGHTS_HISTORY.set(key, buf);
  persistOiInsightsHistoryToDisk();
}

// ─── Kite-historical OI backfill ─────────────────────────────────────────────
//
// PROBLEM. The OI Lab Δ-window selector (3m / 30m / 1h / 3h / Full Day) reads
// from `OI_INSIGHTS_HISTORY` — an in-memory buffer fed by the live 30s poll.
// When the api-server is restarted mid- or post-session (deploy, crash,
// dev-restart), the buffer is empty for today, the relaxed write-gate hydrates
// it only with NEW snapshots from "now" forward, and every Δ pill ends up
// reading broker since-open Δ via the windowMode==="none" fallback — so
// every pill shows the same number. The user sees "30 min / 1 hr / 3 hr all
// show -3.83Cr" and the selector is effectively dead until tomorrow's open.
//
// SOLUTION. On the FIRST `fetchOiInsights` call per (underlying|expiry|day),
// kick off a background fetch of Kite's `historical_data` API with `oi=true`
// at 5-minute resolution for each option leg the user is currently viewing.
// Convert the candle stream into reconstructed snapshots (one per candle ts,
// strike-map keyed by leg) and feed them into the SAME buffer via
// `insertOiSnap` — re-using the order-preserving insert + same-ts merge so
// existing live snaps are never overwritten or modified (per owner directive
// "do not change existing data and information"). Backfilled snaps fill the
// gaps; live polls continue to extend the buffer at the tail.
//
// CONSTRAINTS.
//  * NEVER overwrites existing snaps. `insertOiSnap`'s same-ts merge unions
//    strike maps non-destructively (existing strike-OI values win when the
//    backfilled candle bucket happens to share a ts with a live snap — which
//    is rare since live polls land at wall-clock ts and candles at bucket
//    closes, but defended for safety).
//  * NEVER fabricates OI. Candles with non-finite or negative `oi` are
//    rejected upstream in `fetchKiteOiHistoricalByToken`.
//  * Runs AT MOST once per (underlying|expiry|day) — `oiBackfillCompleted`
//    map prevents repeat work, `oiBackfillInflight` map prevents concurrent
//    work for the same key.
//  * Background-only — `fetchOiInsights` returns the live snap immediately
//    and lets the backfill enrich the buffer for SUBSEQUENT polls. The first
//    poll the user sees still uses broker since-open Δ; second-onward polls
//    (30s cadence) start surfacing real windowed Δ as backfilled snaps land.
//  * Bounded cost. Capped at `BACKFILL_MAX_STRIKES=15` strikes (ATM ± 7),
//    × 2 sides = 30 historical_data calls per backfill. At 2.5 req/s shared
//    throttle (HISTORICAL_MIN_INTERVAL_MS=400ms in kiteIntraday.ts) ≈ 12s
//    per index. For the F&O sweep's 3 indices in parallel ≈ 30-45s total —
//    acceptable background warmup window.
//  * Fail-OPEN. Any failure (no Kite session, no instruments, throttle
//    overflow, transient 5xx) is caught + logged; the backfill silently
//    skips and the day's `oiBackfillCompleted` flag is NOT set, so the
//    next `fetchOiInsights` call retries. Never blocks the request hot path.

const BACKFILL_MAX_STRIKES = 15; // ATM ± 7 strikes, both legs each
const BACKFILL_INTERVAL = "5minute" as const;
/** Per-(underlying|expiry) → tradingDay-of-completion. Backfill skips when
 *  this map's value matches today. Resets implicitly on cross-day rollover
 *  because the keys here are scoped to the same in-process lifetime as the
 *  buffer itself; both get rebuilt fresh after a server restart. */
const oiBackfillCompleted = new Map<string, string>();
/** In-flight dedup so two parallel `fetchOiInsights` calls for the same key
 *  trigger at most one backfill. Cleared in the .finally block. */
const oiBackfillInflight = new Map<string, Promise<void>>();

function maybeBackfillOiInsightsHistoryFromKite(insights: OiInsightsResponse): void {
  const key = `${insights.underlying}|${insights.expiry}`;
  const today = istTradingDay();
  if (oiBackfillCompleted.get(key) === today) return;
  if (oiBackfillInflight.has(key)) return;
  // Bail when the buffer is already well-populated for today — the live
  // polls have done the work themselves (e.g. server has been up since 09:15
  // and is just servicing a fresh user view). Threshold of 8 in-session snaps
  // ≈ 4 minutes of live polling at 30s cadence; below this, backfill is
  // worthwhile (catches "server just restarted" + "first user view of the
  // day" cases). Above this, backfill would mostly duplicate existing tail.
  const buf = OI_INSIGHTS_HISTORY.get(key) ?? [];
  const inSessionToday = buf.filter(s => isInIstMarketHours(s.ts) && istTradingDay(new Date(s.ts)) === today).length;
  if (inSessionToday >= 8) {
    oiBackfillCompleted.set(key, today);
    return;
  }
  // Fire-and-forget. The .finally clears inflight; the .then sets the
  // completed marker only on success so failures self-retry on next poll.
  const visibleStrikes = insights.strikes.map(s => s.strike);
  const work = backfillOiInsightsHistoryFromKite(insights.underlying, insights.expiry, insights.atmStrike, visibleStrikes)
    .then(() => {
      oiBackfillCompleted.set(key, today);
    })
    .catch(err => {
      logger.warn(
        { err: (err as Error).message, underlying: insights.underlying, expiry: insights.expiry },
        "OI insights history backfill failed; will retry on next fetch",
      );
    })
    .finally(() => {
      oiBackfillInflight.delete(key);
    });
  oiBackfillInflight.set(key, work);
}

async function backfillOiInsightsHistoryFromKite(
  underlying: string,
  expiry: string,
  atmStrike: number,
  visibleStrikes: number[],
): Promise<void> {
  const client = await getRestClient();
  if (!client) return; // No Kite session → silent skip; live polls retry next cycle
  const { kc } = client;

  // Resolve option-leg instrument tokens. `loadFnoInstruments` is cached
  // (refreshed daily); typical hot-path latency is single-digit ms.
  const all = await loadFnoInstruments(kc);
  // Cap to ATM ± BACKFILL_MAX_STRIKES/2 so cost stays bounded. Visible
  // strikes are sorted in `insights.strikes` already (ATM-centered band)
  // but we re-center on `atmStrike` here to be robust to any ordering
  // quirk and pick the BACKFILL_MAX_STRIKES strikes nearest ATM.
  const sortedByAtmDist = [...visibleStrikes].sort(
    (a, b) => Math.abs(a - atmStrike) - Math.abs(b - atmStrike),
  );
  const strikeSet = new Set(sortedByAtmDist.slice(0, BACKFILL_MAX_STRIKES));
  const legs = all.filter((i): i is FnoInstrument & { instrument_type: "CE" | "PE" } =>
    i.name === underlying &&
    (i.instrument_type === "CE" || i.instrument_type === "PE") &&
    expiryISOForBackfill(i.expiry) === expiry &&
    strikeSet.has(i.strike),
  );
  if (legs.length === 0) {
    logger.info({ underlying, expiry, visibleStrikes: visibleStrikes.length }, "OI backfill: no matching legs found");
    return;
  }

  // Today's intraday window in IST.
  const today = istTradingDay();
  const fromIst = new Date(`${today}T09:15:00+05:30`);
  const toIst = new Date(); // up to "now"; Kite clamps to last completed candle bucket

  // Bucket reconstructed candles by ts so all strikes that share a candle
  // bucket close coalesce into a single snapshot. Map<tsMs, {ce, pe}>.
  const buckets = new Map<number, { ce: Map<number, number>; pe: Map<number, number> }>();

  // Bounded concurrency 4. Each worker pulls the next leg index off the
  // shared cursor. The global Kite-historical throttle in kiteIntraday.ts
  // serializes the actual API calls to ~2.5 req/s regardless of worker
  // count — concurrency here just keeps the pipeline full while one slot
  // is in flight. Workers > legs is harmless (loop exits immediately).
  let nextLeg = 0;
  // WORKERS=2 (architect-driven HIGH fix). With 3 indices kicked off in
  // parallel by the F&O sweep loop, WORKERS=4 per index would pin up to
  // 12 throttle slots simultaneously — combined with the equity scanner
  // and the sweep's own intraday OHLCV calls, the shared 30-slot queue
  // (`HISTORICAL_MAX_QUEUE` in kiteIntraday.ts) could overflow and force
  // legitimate live calls to fall back to Yahoo (degraded data quality
  // until the backfill drains, ~12-30s). At WORKERS=2 the backfill's
  // peak footprint across all indices is ≤6 slots, leaving comfortable
  // headroom for the scanner. Per-leg fetches still serialize through
  // the global 400ms-per-slot throttle so increasing concurrency above
  // this never improves wall-clock time anyway — it just hogs queue
  // capacity from concurrent callers.
  const WORKERS = 2;
  await Promise.all(Array.from({ length: Math.min(WORKERS, legs.length) }, async () => {
    while (true) {
      const i = nextLeg++;
      if (i >= legs.length) return;
      const leg = legs[i]!;
      const candles = await fetchKiteOiHistoricalByToken(
        leg.instrument_token,
        `OI:${leg.exchange}:${leg.tradingsymbol}`,
        BACKFILL_INTERVAL,
        fromIst,
        toIst,
      );
      if (!candles || candles.length === 0) continue;
      const optType = leg.instrument_type;
      for (const c of candles) {
        // Defensive: clamp to in-session window. Kite occasionally returns
        // a stub candle at the session boundary (e.g. a 09:14 bucket close
        // when the request `from` is 09:15) — those would be rejected by
        // the buffer's same-day filter anyway but we drop them here to
        // keep the bucket map clean and the persisted disk blob lean.
        if (!isInIstMarketHours(c.ts)) continue;
        let b = buckets.get(c.ts);
        if (!b) { b = { ce: new Map(), pe: new Map() }; buckets.set(c.ts, b); }
        if (optType === "CE") b.ce.set(leg.strike, c.oi);
        else b.pe.set(leg.strike, c.oi);
      }
    }
  }));

  if (buckets.size === 0) {
    logger.info({ underlying, expiry, legs: legs.length }, "OI backfill: Kite returned no candles");
    return;
  }

  // Insert in ts-ascending order so the buffer's order invariant stays
  // intact even though `insertOiSnap`'s splice path would correct any
  // out-of-order arrival. Sorted insert means every backfilled snap
  // lands via the cheap tail-append branch (or the same-ts merge branch
  // when a live poll happens to coincide with a candle bucket close).
  const key = `${underlying}|${expiry}`;
  const sortedTs = [...buckets.keys()].sort((a, b) => a - b);
  for (const ts of sortedTs) {
    const b = buckets.get(ts)!;
    // Skip empty buckets defensively (shouldn't happen — every bucket is
    // created on first leg-write — but cheap to guard).
    if (b.ce.size === 0 && b.pe.size === 0) continue;
    const snap: OiInsightsSnapshot = {
      ts,
      ce: Object.fromEntries(b.ce),
      pe: Object.fromEntries(b.pe),
      // No `spot` for backfilled snaps. Kite's option-leg historical
      // candles don't carry the underlying spot, and reconstructing it
      // from a parallel index-historical fetch would multiply the API
      // cost. The buffer's `spot` field is optional — `resolveWindowDelta`
      // surfaces `windowBaselineSpot: null` when the picked baseline has
      // no spot, which the client renders gracefully. Live polls landing
      // at the SAME ts (rare, candle-boundary collision) would merge in
      // the live spot via the same-ts merge branch's `snap.spot ?? prev.spot`.
    };
    insertOiSnap(key, snap);
  }
  logger.info(
    {
      underlying, expiry,
      legsFetched: legs.length,
      snapsBackfilled: sortedTs.length,
      bufferSize: (OI_INSIGHTS_HISTORY.get(key) ?? []).length,
    },
    "OI insights history backfill complete",
  );
}

/** Local copy of expiryISO from kiteOptionChain.ts — duplicated here to avoid
 *  cycling that module (it imports OcResponse from optionChain.ts which is
 *  fine, but we don't want oiLab.ts pulling in the full kiteOptionChain
 *  module just for one date-format helper). Identical semantics. */
function expiryISOForBackfill(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  if (!dt || Number.isNaN(dt.getTime())) return "";
  return dt.toISOString().slice(0, 10);
}

/** Pure helper extracted so unit tests can pin behavior without going
 *  through `fetchOiInsights`. Returns the windowed-Δ enrichment block. */
function resolveWindowDelta(
  insights: OiInsightsResponse,
  windowMs: number,
): {
  windowMs: number;
  windowMode: "exact" | "approx" | "none";
  windowBaselineAt: string | null;
  windowBaselineSpot: number | null;
  windowBufferOldestAt: string | null;
  windowBufferCount: number;
  strikes: OiStrikeRow[];
  windowTotals: NonNullable<OiInsightsResponse["windowTotals"]> | null;
  windowPcr: NonNullable<OiInsightsResponse["windowPcr"]> | null;
} {
  const key = `${insights.underlying}|${insights.expiry}`;
  const rawBuf = OI_INSIGHTS_HISTORY.get(key) ?? [];
  const nowMs = new Date(insights.generatedAt).getTime();
  // ── Read-path session/day guard ────────────────────────────────────
  // The write-path `pushOiInsightsSnapshot` already drops out-of-hours
  // snaps, but if the server stays up across a market-close → next-open
  // boundary, the buffer can still contain YESTERDAY's snaps as in-memory
  // residue (the disk-hydrate path discards cross-day blobs only on cold
  // start). A windowed request at 08:30 IST tomorrow would otherwise pick
  // a 17h-stale snap as baseline → wildly inflated "approx" Δ.
  //
  // Defence-in-depth: filter the candidate set to ONLY snaps whose ts
  // (a) lands inside today's IST trading day AND (b) inside the IST
  // market window. The original buffer is left intact (so post-close
  // analysis at e.g. 16:00 IST still works against in-session snaps),
  // we just refuse to USE pre-market / cross-day snaps as baselines.
  const todayIst = istTradingDay(new Date(nowMs));
  const buf = rawBuf.filter(s =>
    isInIstMarketHours(s.ts) && istTradingDay(new Date(s.ts)) === todayIst
  );
  const oldestAt = buf.length > 0 ? new Date(buf[0]!.ts).toISOString() : null;
  // Need at least one snapshot strictly OLDER than `now` (the just-pushed
  // one is at `now` itself and is useless as a baseline).
  const candidates = buf.filter(s => s.ts < nowMs);
  if (candidates.length === 0) {
    const stripped = insights.strikes.map(s => ({
      ...s,
      ceOiChgWindow: null,
      peOiChgWindow: null,
      ceOiChgWindowCr: null,
      peOiChgWindowCr: null,
    }));
    return {
      windowMs,
      windowMode: "none",
      windowBaselineAt: null,
      windowBaselineSpot: null,
      windowBufferOldestAt: rawBuf.length > 0 ? new Date(rawBuf[0]!.ts).toISOString() : null,
      windowBufferCount: rawBuf.length,
      strikes: stripped,
      windowTotals: null,
      windowPcr: null,
    };
  }
  // `windowBufferCount` / `windowBufferOldestAt` reflect the IN-SESSION
  // snaps only (post-filter). Surfacing the unfiltered raw count would
  // mislead the client into "I have 50 snaps!" while only 2 are usable
  // for windowed Δ this morning.
  const usableBufLen = buf.length;
  const cutoff = nowMs - windowMs;
  // Baseline picker — two-tier policy that fixes the prior "0 Δ on 1hr
  // pill" bug:
  //
  //   Tier 1 (preferred): pick the LATEST snapshot that is OLDER than
  //                       the cutoff. This guarantees AT LEAST `windowMs`
  //                       of true windowed Δ, so "Last 1 hr" never
  //                       silently shrinks to "Last 2 min" just because
  //                       the buffer happens to have a recent snapshot.
  //   Tier 2 (fallback):  no snapshot is old enough → use the OLDEST
  //                       available snap. Δ under-shoots the requested
  //                       window but is still better than mode=none.
  //
  // The previous algorithm picked closest-to-cutoff in absolute distance,
  // which favored newer-than-cutoff snapshots when the buffer was sparse
  // → microscopic Δ that rounded to exactly zero against a chain-cache
  // hit. Always preferring older-than-cutoff snapshots eliminates that
  // failure mode and keeps the windowed Δ consistent with what the
  // user pill is asking for.
  const olderCandidates = candidates.filter(s => s.ts <= cutoff);
  let best: OiInsightsSnapshot;
  if (olderCandidates.length > 0) {
    best = olderCandidates[olderCandidates.length - 1]!;
  } else {
    // No snapshot reaches back to `cutoff` — use the oldest we have.
    // candidates is `buf.filter(s => s.ts < nowMs)` and `buf` is kept
    // chronological by push order, so candidates[0] is the oldest.
    best = candidates[0]!;
  }
  const bestDist = Math.abs(best.ts - cutoff);
  // ±20% tolerance — outside that band, the chart caption flags "approx"
  // so the user is never lied to about what window they're seeing.
  const mode: "exact" | "approx" = bestDist <= windowMs * 0.2 ? "exact" : "approx";
  // Round to 4 decimals (worth ~0.0001 Cr ≈ ₹1000) — visible Cr displays
  // typically round to 2dp at render time, so 4dp here gives the client
  // headroom for tooltip-level precision without leaking float noise.
  const toCr = (n: number): number => Math.round((n / 1e7) * 10_000) / 10_000;
  // Accumulators for the Time-Based OI Change totals + PCR block. We
  // sum ONLY strikes where BOTH legs have a baseline so the totals
  // exactly equal the sum of strike-level deltas the client renders
  // (spec acceptance criterion #4: "Open Interest Change summary card
  // values exactly match the sum of strike-level deltas returned by
  // the API"). Strikes with a missing baseline contribute zero to
  // both the chart bars AND these totals — single source of truth.
  let callOiStart = 0, callOiEnd = 0, putOiStart = 0, putOiEnd = 0;
  let strikesIncluded = 0;
  const enriched = insights.strikes.map(s => {
    const baseCe = best.ce[s.strike];
    const basePe = best.pe[s.strike];
    // Strict semantics: require BOTH legs to have a baseline before
    // reporting a windowed Δ. A strike that wasn't in the chain when the
    // baseline snap was taken (newly-listed / outside ATM±N at that time)
    // gets `null` — never zero, never the broker since-open Δ.
    if (baseCe == null || basePe == null) {
      return { ...s, ceOiChgWindow: null, peOiChgWindow: null, ceOiChgWindowCr: null, peOiChgWindowCr: null };
    }
    const ceChg = s.ceOi - baseCe;
    const peChg = s.peOi - basePe;
    callOiStart += baseCe;
    callOiEnd   += s.ceOi;
    putOiStart  += basePe;
    putOiEnd    += s.peOi;
    strikesIncluded++;
    return {
      ...s,
      ceOiChgWindow: ceChg,
      peOiChgWindow: peChg,
      ceOiChgWindowCr: toCr(ceChg),
      peOiChgWindowCr: toCr(peChg),
    };
  });
  // Build the windowTotals block. Empty (zero strikes matched) → null
  // instead of all-zero so the client can render "No OI snapshot data
  // available for this time window." (spec §8 friendly empty state).
  const windowTotals = strikesIncluded > 0 ? {
    callOiStart,
    callOiEnd,
    putOiStart,
    putOiEnd,
    callOiChange: callOiEnd - callOiStart,
    putOiChange:  putOiEnd  - putOiStart,
    // NOTE: *Cr fields are PRESENTATION-only (4dp rounded). Do NOT sum
    // these client-side to derive aggregates — additive rounding drift
    // can accumulate. Always sum the RAW *Change fields then divide by
    // 1e7 at render time when an aggregate Cr value is needed.
    callOiChangeCr: toCr(callOiEnd - callOiStart),
    putOiChangeCr:  toCr(putOiEnd  - putOiStart),
    strikesIncluded,
  } : null;
  // Windowed PCR block. All four fields use safe-divide → null instead
  // of Infinity / NaN per spec §4 ("Handle division by zero safely").
  const safeDiv = (num: number, den: number): number | null =>
    den !== 0 && Number.isFinite(num) && Number.isFinite(den)
      ? Math.round((num / den) * 10_000) / 10_000
      : null;
  // pcrStart / pcrEnd are computed once and reused — pcrChange derives
  // from those two values rather than re-running safeDiv (architect
  // review feedback: single source so future safeDiv tweaks can't
  // create a tiny start/end vs change rounding mismatch).
  const pcrStart = windowTotals ? safeDiv(windowTotals.putOiStart, windowTotals.callOiStart) : null;
  const pcrEnd   = windowTotals ? safeDiv(windowTotals.putOiEnd,   windowTotals.callOiEnd)   : null;
  const windowPcr = windowTotals ? {
    pcrStart,
    pcrEnd,
    pcrChange: pcrStart != null && pcrEnd != null
      ? Math.round((pcrEnd - pcrStart) * 10_000) / 10_000
      : null,
    // PCR OI Change = Put OI Δ / Call OI Δ. Sign carries directionality
    // (spec §4: "Put OI Change divided by Call OI Change, not Call
    // divided by Put"). Null when |callOiChange| is zero.
    pcrOiChange:    safeDiv(windowTotals.putOiChange, windowTotals.callOiChange),
    pcrOiChangeAbs: safeDiv(Math.abs(windowTotals.putOiChange), Math.abs(windowTotals.callOiChange)),
  } : null;
  return {
    windowMs,
    windowMode: mode,
    windowBaselineAt: new Date(best.ts).toISOString(),
    // Old snaps persisted before the spot field was added carry
    // `undefined` — surface those as `null` so the wire shape stays
    // strict (number | null) and the client's optional-chain reads
    // cleanly. Same goes for any rare snap where chain.spot was NaN.
    windowBaselineSpot: typeof best.spot === "number" && Number.isFinite(best.spot) ? best.spot : null,
    windowBufferOldestAt: oldestAt,
    windowBufferCount: usableBufLen,
    strikes: enriched,
    windowTotals,
    windowPcr,
  };
}

/** Convenience wrapper used by the route handler — fetches Kite-only chain
 *  then computes insights, surfacing a clean error when Kite isn't connected.
 *
 *  When `windowMs` is provided, the returned response is enriched with
 *  per-strike `ceOiChgWindow` / `peOiChgWindow` plus top-level
 *  `windowMode` / `windowBaselineAt` describing how the Δ was computed.
 *  The history buffer is pushed on every call regardless of `windowMs`,
 *  so repeated polling at 30s steadily fills the buffer for future
 *  finite-window requests. */
export async function fetchOiInsights(
  underlying: string,
  expiry?: string,
  strikesAround = 20,
  windowMs?: number,
): Promise<OiInsightsResponse | null> {
  hydrateOiInsightsHistoryFromDisk();
  const sym = underlying.toUpperCase();
  const result = await getCentralOptionChain(sym, "TRADE_GRADE", expiry);
  const chain = result.ok && result.data ? result.data.chain : null;
  if (!chain) return null;
  const insights = computeOiInsights(chain, strikesAround);
  // Push the snapshot AFTER computing insights so the snapshot's ts
  // matches `insights.generatedAt` exactly (which the client uses for the
  // "updated Ns ago" pulse) — keeps timestamps consistent across surfaces.
  pushOiInsightsSnapshot(insights);
  // Background backfill — fires at most once per (underlying|expiry|day)
  // when the buffer has < 8 in-session snaps for today (i.e. fresh server
  // restart, or first user view of a not-yet-polled underlying). Pulls
  // Kite `historical_data` with `oi=true` for the visible strike band so
  // the Δ-window selector becomes useful immediately rather than waiting
  // for the live 30s polls to backfill organically (which post-close
  // never happens at all). Fire-and-forget; never blocks the request.
  void maybeBackfillOiInsightsHistoryFromKite(insights);
  if (windowMs == null || windowMs <= 0) {
    // No windowed Δ requested — return broker since-open Δ shape unchanged.
    return insights;
  }
  const block = resolveWindowDelta(insights, windowMs);
  return {
    ...insights,
    strikes: block.strikes,
    windowMs: block.windowMs,
    windowMode: block.windowMode,
    windowBaselineAt: block.windowBaselineAt,
    windowBaselineSpot: block.windowBaselineSpot,
    windowBufferOldestAt: block.windowBufferOldestAt,
    windowBufferCount: block.windowBufferCount,
    windowTotals: block.windowTotals,
    windowPcr: block.windowPcr,
  };
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
  // Kite returns the day's OI extremes alongside the live OI. We use these
  // to compute a session-range proxy baseline on cold start, so the very
  // first heatmap call doesn't show every contract as Neutral / 0% change.
  oi_day_high?: number;
  oi_day_low?: number;
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
 *  Cleared when Kite session is cleared/expired or when the IST trading day
 *  rolls over. Persisted to disk so a server restart mid-session doesn't
 *  reset every contract back to "Neutral / 0%". */
const oiBaselineMap = new Map<number, { oi: number; ts: number; symbol: string }>();
let baselineEstablishedAt: string | null = null;
const BASELINE_BLOB_NAME = "oi-heatmap-baseline";
const BASELINE_BLOB_VERSION = 1;
let baselineHydrated = false;

interface BaselineDiskShape {
  tradingDay: string; // YYYY-MM-DD in IST
  establishedAt: string;
  entries: Array<[number, { oi: number; ts: number; symbol: string }]>;
}

function hydrateBaselineFromDisk(): void {
  if (baselineHydrated) return;
  baselineHydrated = true;
  const blob = loadBlob<BaselineDiskShape>(BASELINE_BLOB_NAME, BASELINE_BLOB_VERSION);
  if (!blob) return;
  const today = istTradingDay();
  if (blob.payload.tradingDay !== today) {
    logger.info({ stored: blob.payload.tradingDay, today }, "OI baseline: discarding stale (different trading day)");
    return;
  }
  for (const [k, v] of blob.payload.entries) oiBaselineMap.set(k, v);
  baselineEstablishedAt = blob.payload.establishedAt;
  logger.info({ entries: oiBaselineMap.size, establishedAt: baselineEstablishedAt }, "OI baseline: warm-started from disk");
}

function persistBaselineToDisk(): void {
  try {
    const payload: BaselineDiskShape = {
      tradingDay: istTradingDay(),
      establishedAt: baselineEstablishedAt ?? new Date().toISOString(),
      entries: Array.from(oiBaselineMap.entries()),
    };
    saveBlob(BASELINE_BLOB_NAME, BASELINE_BLOB_VERSION, payload);
  } catch { /* logged inside */ }
}

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
  // Lazy hydrate from disk on first call (after server restart). Same-day
  // baselines survive across restarts so the very first heatmap render
  // already shows real OI deltas instead of all-zeros / all-Neutral.
  hydrateBaselineFromDisk();

  const client = await getRestClient();
  if (!client) return null;
  const { kc } = client;

  const all = await loadFnoInstruments(kc);
  const todayIso = new Date().toISOString().slice(0, 10);

  const futByName = new Map<string, FnoInstrument>();
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

  // Batch quote calls (Kite caps ~500 instruments per call). Use the
  // instrument's own `exchange` (NFO or BFO) so BSE-segment futures are
  // queried on the right segment.
  const symbols = futs.map(f => `${f.exchange}:${f.tradingsymbol}`);
  const quoteMap = new Map<string, KiteQuoteLite>();
  const BATCH = 400;
  for (let i = 0; i < symbols.length; i += BATCH) {
    try {
      if (!await reserveQuoteSlot()) {
        logger.warn({ batchStart: i }, "OI heatmap: getQuote throttle full; skipping batch");
        continue;
      }
      const q = (await kc.getQuote(symbols.slice(i, i + BATCH))) as Record<string, KiteQuoteLite>;
      for (const [k, v] of Object.entries(q)) quoteMap.set(k, v);
    } catch (err) {
      logger.warn({ err: (err as Error).message, batchStart: i }, "OI heatmap: getQuote batch failed");
    }
  }

  const now = Date.now();
  const rows: OiHeatmapRow[] = [];
  for (const f of futs) {
    const q = quoteMap.get(`${f.exchange}:${f.tradingsymbol}`);
    if (!q || !q.last_price || q.oi == null) continue;

    // Establish/refresh OI baseline (first-of-session per instrument).
    // First-touch problem: the most natural baseline is "OI at session open",
    // but Kite doesn't expose that field. Without a workaround, the very
    // first heatmap call after a cold boot stamps baseline=current_oi → all
    // contracts show 0% change → everything bucketed as Neutral, which is
    // exactly what the user reported ("Heatmap shows all 0/Neutral 218").
    //
    // Mitigation: when establishing a fresh baseline, infer session-open OI
    // from oi_day_high/oi_day_low. At market open (09:15 IST) the first OI
    // tick equals previous close OI — no trades yet. For buildup days
    // (current OI near day high), oi_day_low ≈ prevCloseOI. For unwinding
    // days (current OI near day low), oi_day_high ≈ prevCloseOI.
    let baseline = oiBaselineMap.get(f.instrument_token);
    if (!baseline) {
      const dayHigh = q.oi_day_high;
      const dayLow  = q.oi_day_low;
      let baselineOi = q.oi;
      if (typeof dayHigh === "number" && typeof dayLow === "number" && dayHigh > 0 && dayLow > 0 && dayHigh >= dayLow) {
        const midpoint = Math.round((dayHigh + dayLow) / 2);
        if (q.oi >= midpoint) {
          baselineOi = dayLow;
        } else {
          baselineOi = dayHigh;
        }
      }
      baseline = { oi: baselineOi, ts: now, symbol: f.name };
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
  // Persist after every successful scan — small JSON file (~30KB), so the
  // I/O cost is negligible compared to the 30s minimum gap between scans.
  persistBaselineToDisk();
  return out;
}

/** Lifetime helper for the export endpoint — returns the latest cached
 *  heatmap payload (forcing a fresh fetch if nothing is cached yet). */
export async function getOiHeatmapForExport(): Promise<OiHeatmapResponse | null> {
  if (heatmapCache && Date.now() - heatmapCache.ts < HEATMAP_CACHE_TTL) return heatmapCache.data;
  return fetchOiHeatmap();
}

export function getLatestHeatmapCache(): OiHeatmapResponse | null {
  if (!heatmapCache) return null;
  if (Date.now() - heatmapCache.ts > 5 * 60 * 1000) return null;
  return heatmapCache.data;
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
  ivPercentile: number | null;
  ivRank: number | null;
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

// ── Tracker snapshot persistence ──────────────────────────────────────────
// The tracker writes a snapshot every N minutes; on a server restart all of
// that history would otherwise vanish (the screenshot showing "2 snapshots"
// after a long run is exactly this). We persist the ring buffer to disk per
// IST trading day and re-hydrate at process start.
const TRACKER_BLOB_NAME = "oi-tracker-snapshots";
const TRACKER_BLOB_VERSION = 1;
let trackerHydrated = false;

interface TrackerDiskShape {
  tradingDay: string;
  snapshots: TrackerSnapshot[];
}

function hydrateTrackerFromDisk(): void {
  if (trackerHydrated) return;
  trackerHydrated = true;
  const blob = loadBlob<TrackerDiskShape>(TRACKER_BLOB_NAME, TRACKER_BLOB_VERSION);
  if (!blob) return;
  const today = istTradingDay();
  if (blob.payload.tradingDay !== today) {
    logger.info({ stored: blob.payload.tradingDay, today }, "Tracker snapshots: discarding stale (different trading day)");
    return;
  }
  trackerState.snapshots = blob.payload.snapshots.slice(-MAX_SNAPSHOTS);
  logger.info({ count: trackerState.snapshots.length }, "Tracker snapshots: warm-started from disk");
}

function persistTrackerToDisk(): void {
  try {
    const payload: TrackerDiskShape = {
      tradingDay: istTradingDay(),
      snapshots: trackerState.snapshots.slice(-MAX_SNAPSHOTS),
    };
    saveBlob(TRACKER_BLOB_NAME, TRACKER_BLOB_VERSION, payload);
  } catch { /* logged inside */ }
}

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
        // Tracker writes one ATM IV row per (underlying, day) → after a
        // few days of intraday ticks we have a full 1Y rolling window
        // and rank/percentile become meaningful. Best-effort: on any
        // DB hiccup we just log null and continue collecting.
        const ivMetrics = await enrichAnalyticsWithIv({
          underlying: sym,
          atmIv: a.atmIv,
          ivPercentile: a.ivPercentile,
          ivRank: a.ivRank,
        }).catch(() => ({ ivRank: null as number | null, ivPercentile: null as number | null }));
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
          ivPercentile: ivMetrics.ivPercentile,
          ivRank: ivMetrics.ivRank,
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
      // Persist after every tick so a restart mid-day keeps the chart history.
      persistTrackerToDisk();
    }
  } finally {
    trackerState.tickInFlight = false;
  }
}

export async function startTracker(args: { underlyings: string[]; intervalMs?: number }): Promise<TrackerStatus> {
  // Pull any same-day snapshots back into memory so the user's first chart
  // view after a restart isn't empty.
  hydrateTrackerFromDisk();

  const session = await getActiveSession().catch(() => null);
  if (!session) throw new Error("Kite session not active — login required first");

  // Use the dynamic Kite F&O list when available so the tracker accepts every
  // symbol the picker offers; fall back to the static predicate when Kite
  // hasn't returned a universe yet.
  const dynamicSet = new Set(await getDynamicFnoUniverse() ?? []);
  const cleaned = Array.from(new Set(args.underlyings.map(s => s.toUpperCase().trim())))
    // Hard-reject removed indices first so stale tracker requests for
    // FINNIFTY/MIDCPNIFTY/BANKEX/NIFTYNXT50 cannot start.
    .filter(s => s && !REMOVED_FNO_INDEX_NAMES.has(s) && (
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
  hydrateTrackerFromDisk();
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
  hydrateTrackerFromDisk();
  if (!underlying) return [...trackerState.snapshots];
  const sym = underlying.toUpperCase();
  return trackerState.snapshots.filter(s => s.underlying === sym);
}
