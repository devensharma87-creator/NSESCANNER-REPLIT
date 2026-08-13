import type { NewsItem } from "@workspace/api-zod";
import { getAllMarketNewsLive } from "./newsRss";
import { resolveSymbols } from "./symbolAlias";
import { getEntry as findUniverseEntry } from "./universe";
import { getBootCapabilities } from "./bootCapabilities";

/**
 * Stocks-to-Watch / Stocks-to-Avoid daily deck.
 *
 * Pipeline (all deterministic, no LLM, no synthetic data):
 *   1. Pull cached news from getAllMarketNewsLive() — Moneycontrol, Mint, ET,
 *      ET Earnings/Policy, CNBC TV18, Business Standard, Investing.com, Yahoo.
 *   2. Filter to last 24h (configurable lookback).
 *   3. Resolve each headline to NSE symbol(s) via symbolAlias (curated names +
 *      bhavcopy tickers + hand-curated short-form aliases).
 *   4. Score each item against catalyst phrase rules:
 *        + positive catalysts (order win, new project, results beat, approval)
 *        - negative catalysts (probe, fraud, downgrade, miss, recall)
 *      Only items with a clear (and only one) side are kept; ambiguous /
 *      generic price-action stories are dropped (we already show those on the
 *      News tab).
 *   5. Group by symbol, side wins by aggregate confidence; highest-confidence
 *      headline becomes the displayed quote, secondary items kept as evidence.
 *   6. Return { asOf, lookbackHours, watch[], avoid[], counts }.
 */

export type WatchSide = "watch" | "avoid";

export interface WatchSignal {
  symbol: string;
  name?: string;
  sector?: string;
  side: WatchSide;
  catalyst: string;          // e.g. "Order win", "Results beat", "Probe / SEBI action"
  confidence: number;        // 0..1 aggregate
  headline: string;
  summary?: string;
  source: string;
  url: string;
  publishedAt: string;       // ISO
  evidence: { headline: string; source: string; url: string; publishedAt: string }[];
}

export interface StocksToWatchPayload {
  asOf: string;
  lookbackHours: number;
  watch: WatchSignal[];
  avoid: WatchSignal[];
  scanned: number;
  matched: number;
  sources: { source: string; count: number }[];
}

/* ───────────────────────── catalyst rules ───────────────────────── */

interface Catalyst {
  label: string;
  side: WatchSide;
  weight: number;
  patterns: RegExp[];
}

const CATALYSTS: Catalyst[] = [
  // ───── POSITIVE catalysts ─────
  { label: "Order win", side: "watch", weight: 0.95, patterns: [
    /\b(?:wins?|bags?|secures?|awarded|receives?)\b[^.]{0,40}\b(?:order|contract|tender|deal|loa|mandate)\b/i,
    /\border\s+win\b/i,
    /\bcontract\s+(?:win|award)/i,
  ] },
  { label: "New project / capacity", side: "watch", weight: 0.85, patterns: [
    /\b(?:announces?|launches?|commissions?|inaugurates?)\b[^.]{0,40}\b(?:project|plant|facility|factory|capacity|expansion|line)\b/i,
    /\bcapex\b[^.]{0,30}\b(?:plan|approve|sanction)/i,
    /\bgreenfield|brownfield\b/i,
    /\bgroundbreaking\b/i,
  ] },
  { label: "New product / innovation", side: "watch", weight: 0.85, patterns: [
    /\b(?:launches?|unveils?|introduces?)\b[^.]{0,40}\b(?:product|platform|service|model|drug|app|chip|ev|car|suv|bike)\b/i,
    /\b(?:patent|fda|usfda|cdsco|ce mark|emergency use authorization)\b[^.]{0,40}\b(?:approval|granted|cleared|nod)\b/i,
    /\b(?:approval|nod|clearance|license)\b[^.]{0,30}\b(?:for|to)\b[^.]{0,40}\b(?:drug|product|plant|project|launch)\b/i,
  ] },
  { label: "Results beat / strong growth", side: "watch", weight: 0.8, patterns: [
    /\b(?:beats?|tops?|surpasses?)\b[^.]{0,30}\b(?:estimates?|forecast|expectations?|street)\b/i,
    /\b(?:profit|net profit|pat|revenue|sales|ebitda)\b[^.]{0,30}\bup\b[^.]{0,15}\b\d{2,}\s*%/i,
    /\b(?:profit|pat)\b[^.]{0,15}\b(?:doubles|jumps|surges|soars|rises)/i,
    /\b(?:record|highest)\b[^.]{0,15}\b(?:profit|revenue|sales|quarter)/i,
    /\b(?:margin|ebitda margin)\b[^.]{0,30}\bexpand/i,
  ] },
  { label: "Acquisition / stake buy", side: "watch", weight: 0.75, patterns: [
    /\b(?:acquires?|buys?|to acquire|to buy)\b[^.]{0,40}\b(?:stake|share|business|arm|unit|company)\b/i,
    /\bstake\s+(?:purchase|buy)/i,
    /\b\d{1,3}\s*%\s+stake\b/i,
    /\bopen\s+offer\b/i,
  ] },
  { label: "Tie-up / MoU / partnership", side: "watch", weight: 0.7, patterns: [
    /\b(?:partners?|tie[- ]?up|mou|joint venture|jv|collaborates?|signs?)\b[^.]{0,40}\b(?:with|to)\b/i,
  ] },
  { label: "Upgrade / target raised", side: "watch", weight: 0.7, patterns: [
    /\b(?:upgraded?|upgrade|raises?|hikes?)\b[^.]{0,30}\b(?:rating|target|price target|tp|to buy|to overweight)\b/i,
    /\b(?:initiates|initiated)\b[^.]{0,15}\bcoverage\b[^.]{0,15}\b(?:buy|outperform|overweight|positive)/i,
  ] },
  { label: "Strong order book / guidance raise", side: "watch", weight: 0.7, patterns: [
    /\b(?:raises?|hikes?|lifts?)\b[^.]{0,15}\bguidance\b/i,
    /\border\s+book\b[^.]{0,30}\b(?:up|rises?|grows?|jumps?|surges?|swells?|crosses?)/i,
    /\bbook\s+to\s+bill\b/i,
  ] },

  // ───── NEGATIVE catalysts ─────
  { label: "Regulator probe / SEBI action", side: "avoid", weight: 0.95, patterns: [
    /\b(?:sebi|cbi|ed|enforcement directorate|i-?t|income tax|gst)\b[^.]{0,40}\b(?:probe|raid|search|notice|investigation|crackdown|action)/i,
    /\bshow\s*cause\b/i,
    /\b(?:fraud|scam|scandal|kickback|round-?tripping)\b/i,
  ] },
  { label: "Penalty / fine / lawsuit", side: "avoid", weight: 0.85, patterns: [
    /\b(?:fined|penalty|penal\w*|imposes?\s+fine)\b[^.]{0,30}\b(?:on|against)\b/i,
    /\bsued\b|\blawsuit\b|\barbitration\b/i,
    /\b(?:adverse|negative)\b[^.]{0,15}\b(?:order|judgment|ruling)\b/i,
  ] },
  { label: "Downgrade / target cut", side: "avoid", weight: 0.8, patterns: [
    /\b(?:downgrades?|downgrade|cuts?|slashes?|lowers?|reduces?)\b[^.]{0,30}\b(?:rating|target|price target|tp|to sell|to underweight|to underperform)\b/i,
    /\b(?:downgraded?)\b[^.]{0,15}\bto\b[^.]{0,15}\b(?:sell|underperform|underweight|hold|neutral)\b/i,
  ] },
  { label: "Results miss / margin pressure", side: "avoid", weight: 0.8, patterns: [
    /\b(?:misses?|missed)\b[^.]{0,30}\b(?:estimates?|forecast|expectations?|street)\b/i,
    /\b(?:profit|net profit|pat|revenue|sales|ebitda)\b[^.]{0,30}\b(?:falls?|drops?|slips?|plunges?|tumbles?|crashes?)\b[^.]{0,15}\b\d{1,2}\s*%/i,
    /\b(?:loss|net loss)\b[^.]{0,15}\b(?:widens?|rises?|grows?)/i,
    /\b(?:margin)\b[^.]{0,30}\b(?:contracts?|shrinks?|under pressure|squeeze)/i,
  ] },
  { label: "Recall / quality issue", side: "avoid", weight: 0.85, patterns: [
    /\brecalls?\b[^.]{0,30}\b(?:vehicles?|cars?|drugs?|product|batch|units?)\b/i,
    /\b(?:warning letter|usfda)\b[^.]{0,30}\b(?:warning|observation|483|import alert|olc)\b/i,
  ] },
  { label: "Resignation / management exit", side: "avoid", weight: 0.7, patterns: [
    /\b(?:ceo|cfo|md|managing director|chairman|chief|coo|cto)\b[^.]{0,30}\b(?:resigns?|quits?|steps?\s+down|exits?)/i,
    /\b(?:resignation|departure)\b[^.]{0,30}\b(?:ceo|cfo|md|chairman|chief)\b/i,
  ] },
  { label: "Default / debt stress", side: "avoid", weight: 0.9, patterns: [
    /\b(?:default|defaulted)\b[^.]{0,30}\b(?:debt|loan|payment|coupon|repayment)\b/i,
    /\b(?:credit rating|rating)\b[^.]{0,15}\b(?:downgrade|cut|lowered)\b/i,
    /\b(?:NCLT|insolvency|bankruptcy)\b/i,
  ] },
  { label: "Auditor flags / governance", side: "avoid", weight: 0.85, patterns: [
    /\bauditor\b[^.]{0,30}\b(?:flags?|raises?|concerns?|qualified|adverse)/i,
    /\bgoing\s+concern\b/i,
    /\baccount\w*\s+irregularit/i,
  ] },
  { label: "Order loss / contract cancelled", side: "avoid", weight: 0.85, patterns: [
    /\b(?:loses?|loses out|cancels?|terminated)\b[^.]{0,30}\b(?:order|contract|deal|mandate)\b/i,
  ] },
];

/* ───────────────────────── classifier ───────────────────────── */

interface Scored {
  positive: number;
  negative: number;
  positiveLabels: string[];
  negativeLabels: string[];
}

function score(text: string): Scored {
  let positive = 0, negative = 0;
  const positiveLabels: string[] = [];
  const negativeLabels: string[] = [];
  for (const c of CATALYSTS) {
    for (const p of c.patterns) {
      if (p.test(text)) {
        if (c.side === "watch") {
          positive += c.weight;
          if (!positiveLabels.includes(c.label)) positiveLabels.push(c.label);
        } else {
          negative += c.weight;
          if (!negativeLabels.includes(c.label)) negativeLabels.push(c.label);
        }
        break; // one match per catalyst is enough
      }
    }
  }
  return { positive, negative, positiveLabels, negativeLabels };
}

/* ───────────────────────── cache ───────────────────────── */

const TTL_MS = 10 * 60 * 1000; // 10 min — keeps deck fresh; the underlying RSS cache is 5 min so this stays cheap
let CACHE: { payload: StocksToWatchPayload; ts: number } | null = null;
let inflight: Promise<StocksToWatchPayload> | null = null;

interface BuildOpts { lookbackHours: number; }

async function build(opts: BuildOpts): Promise<StocksToWatchPayload> {
  const news = await getAllMarketNewsLive();
  const cutoff = Date.now() - opts.lookbackHours * 3600 * 1000;
  const recent = news.filter(n => +new Date(n.publishedAt) >= cutoff);

  const sourceCounts = new Map<string, number>();
  for (const n of recent) sourceCounts.set(n.source, (sourceCounts.get(n.source) ?? 0) + 1);

  // grouped[symbol][side] = list of scored hits
  const grouped = new Map<string, { watch: ScoredHit[]; avoid: ScoredHit[] }>();
  let matched = 0;

  for (const n of recent) {
    const text = `${n.title} ${n.summary ?? ""}`;
    const sc = score(text);
    if (sc.positive === 0 && sc.negative === 0) continue;

    const symbols = await resolveSymbols(text);
    if (symbols.length === 0) continue;
    matched++;

    // Drop "resolved" / "cleared" probe stories so positive disclosures aren't
    // mis-classified as AVOID just because they mention the word "probe".
    if (/\b(?:cleared|closed|dropped|dismissed|withdrawn|settled|exonerat\w*|no\s+adverse|absolved|acquitted)\b/i.test(text)
        && /\b(?:probe|investigation|case|charges?|allegations?|notice)\b/i.test(text)) {
      continue;
    }
    const isPositive = sc.positive > sc.negative;
    const isNegative = sc.negative > sc.positive;
    if (!isPositive && !isNegative) continue; // tie → drop (mixed signal)

    const side: WatchSide = isPositive ? "watch" : "avoid";
    const labels = isPositive ? sc.positiveLabels : sc.negativeLabels;
    const conf = Math.min(1, (isPositive ? sc.positive : sc.negative) / 1.5);

    for (const { symbol } of symbols) {
      const slot = grouped.get(symbol) ?? { watch: [], avoid: [] };
      slot[side].push({ item: n, confidence: conf, catalyst: labels[0] ?? "Catalyst" });
      grouped.set(symbol, slot);
    }
  }

  const watchOut: WatchSignal[] = [];
  const avoidOut: WatchSignal[] = [];

  for (const [symbol, slot] of grouped) {
    // pick the dominant side per symbol (sum of confidences)
    const wSum = slot.watch.reduce((s, h) => s + h.confidence, 0);
    const aSum = slot.avoid.reduce((s, h) => s + h.confidence, 0);
    if (wSum === 0 && aSum === 0) continue;
    const side: WatchSide = wSum >= aSum ? "watch" : "avoid";
    const hits = side === "watch" ? slot.watch : slot.avoid;
    if (hits.length === 0) continue;

    hits.sort((a, b) => b.confidence - a.confidence || +new Date(b.item.publishedAt) - +new Date(a.item.publishedAt));
    const top = hits[0]!;
    const u = findUniverseEntry(symbol);

    const sig: WatchSignal = {
      symbol,
      name: u?.name,
      sector: u?.sector,
      side,
      catalyst: top.catalyst,
      confidence: Math.min(1, (side === "watch" ? wSum : aSum) / 1.5),
      headline: top.item.title,
      summary: top.item.summary,
      source: top.item.source,
      url: top.item.url ?? "",
      publishedAt: new Date(top.item.publishedAt).toISOString(),
      evidence: hits.slice(0, 4).map(h => ({
        headline: h.item.title,
        source: h.item.source,
        url: h.item.url ?? "",
        publishedAt: new Date(h.item.publishedAt).toISOString(),
      })),
    };
    (side === "watch" ? watchOut : avoidOut).push(sig);
  }

  // sort each side by confidence, then recency
  const sortFn = (a: WatchSignal, b: WatchSignal) =>
    b.confidence - a.confidence ||
    +new Date(b.publishedAt) - +new Date(a.publishedAt);
  watchOut.sort(sortFn);
  avoidOut.sort(sortFn);

  return {
    asOf: new Date().toISOString(),
    lookbackHours: opts.lookbackHours,
    watch: watchOut.slice(0, 30),
    avoid: avoidOut.slice(0, 30),
    scanned: recent.length,
    matched,
    sources: Array.from(sourceCounts.entries())
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count),
  };
}

interface ScoredHit { item: NewsItem; confidence: number; catalyst: string; }

export async function getStocksToWatch(lookbackHours = 24): Promise<StocksToWatchPayload> {
  const now = Date.now();
  if (CACHE && now - CACHE.ts < TTL_MS && CACHE.payload.lookbackHours === lookbackHours) {
    return CACHE.payload;
  }
  if (!inflight) {
    inflight = build({ lookbackHours }).then(p => {
      CACHE = { payload: p, ts: Date.now() };
      return p;
    }).finally(() => { inflight = null; });
  }
  try {
    return await inflight;
  } catch {
    if (CACHE) return CACHE.payload;
    throw new Error("stocks-to-watch unavailable: news feed empty");
  }
}

// background warm — non-blocking (guarded: skip in test env — P0.1B tripwire)
if (process.env['NODE_ENV'] !== 'test' && getBootCapabilities().providerNetwork) {
  void getStocksToWatch().catch(() => undefined);
  setInterval(() => { void getStocksToWatch().catch(() => undefined); }, TTL_MS);
}
