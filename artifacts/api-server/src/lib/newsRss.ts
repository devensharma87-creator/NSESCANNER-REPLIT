import type { NewsItem, NewsItemSentiment } from "@workspace/api-zod";
import { getBootCapabilities } from "./bootCapabilities";

/* ───────────────────────── feed registry ───────────────────────── */

interface FeedSource {
  source: string;
  url: string;
}

const FEEDS: FeedSource[] = [
  { source: "Moneycontrol", url: "https://www.moneycontrol.com/rss/MCtopnews.xml" },
  { source: "Moneycontrol", url: "https://www.moneycontrol.com/rss/business.xml" },
  { source: "Moneycontrol", url: "https://www.moneycontrol.com/rss/buzzingstocks.xml" },
  { source: "Moneycontrol", url: "https://www.moneycontrol.com/rss/results.xml" },
  { source: "Moneycontrol", url: "https://www.moneycontrol.com/rss/marketreports.xml" },
  { source: "Mint", url: "https://www.livemint.com/rss/markets" },
  { source: "Mint", url: "https://www.livemint.com/rss/companies" },
  { source: "Mint", url: "https://www.livemint.com/rss/economy" },
  { source: "ET Markets", url: "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms" },
  { source: "ET Markets", url: "https://economictimes.indiatimes.com/markets/stocks/rssfeeds/2146842.cms" },
  { source: "Economic Times", url: "https://economictimes.indiatimes.com/rssfeedstopstories.cms" },
  { source: "ET Earnings", url: "https://economictimes.indiatimes.com/markets/stocks/earnings/rssfeeds/13357270.cms" },
  { source: "ET Policy", url: "https://economictimes.indiatimes.com/markets/stocks/policy/rssfeeds/13357270.cms" },
  { source: "CNBC TV18", url: "https://www.cnbctv18.com/commonfeeds/v1/cne/rss/market.xml" },
  { source: "CNBC TV18", url: "https://www.cnbctv18.com/commonfeeds/v1/cne/rss/business.xml" },
  { source: "Business Standard", url: "https://www.business-standard.com/rss/markets-106.rss" },
  { source: "Business Standard", url: "https://www.business-standard.com/rss/companies-101.rss" },
  { source: "Investing.com", url: "https://www.investing.com/rss/news_25.rss" },
  { source: "Investing.com", url: "https://www.investing.com/rss/news_301.rss" },
  { source: "Yahoo Finance", url: "https://finance.yahoo.com/news/rssindex" },
];

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/* ───────────────────────── tiny RSS parser ───────────────────────── */

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(parseInt(d, 10)));
}

function stripHtml(s: string): string {
  return decodeEntities(s).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function pickTag(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = re.exec(block);
  return m ? m[1]!.trim() : null;
}

interface ParsedItem {
  title: string;
  link: string;
  description: string;
  pubDate: number;
}

function parseRss(xml: string): ParsedItem[] {
  const out: ParsedItem[] = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1]!;
    const titleRaw = pickTag(block, "title") ?? "";
    const linkRaw = pickTag(block, "link") ?? "";
    const descRaw = pickTag(block, "description") ?? "";
    const dateRaw = pickTag(block, "pubDate") ?? pickTag(block, "dc:date") ?? "";
    const title = stripHtml(titleRaw);
    const link = stripHtml(linkRaw);
    if (!title || !link) continue;
    const description = stripHtml(descRaw).slice(0, 280);
    // Strip CDATA wrappers + entities before parsing date (Mint wraps pubDate in CDATA).
    const dateClean = decodeEntities(dateRaw).replace(/<[^>]+>/g, "").trim();
    let ts = Date.parse(dateClean);
    // If unparseable, fall back to now so the item still surfaces. We do NOT
    // backdate items that are merely older than 14 days — they should rank
    // honestly by their real pubDate, not be promoted as "fresh".
    if (!Number.isFinite(ts)) ts = Date.now();
    out.push({ title, link, description, pubDate: ts });
  }
  return out;
}

/* ───────────────────────── sentiment heuristics ───────────────────────── */

const POS = ["surge", "soar", "jump", "rally", "gain", "rise", "up", "high", "record", "buy", "upgrade", "beat", "outperform", "bullish", "strong", "growth", "profit", "expansion", "wins", "approval"];
const NEG = ["fall", "drop", "slip", "plunge", "tumble", "crash", "loss", "down", "low", "sell", "downgrade", "miss", "underperform", "bearish", "weak", "decline", "cut", "fraud", "probe", "hike", "warn"];

function classifySentiment(text: string): NewsItemSentiment {
  const t = text.toLowerCase();
  let p = 0, n = 0;
  for (const w of POS) if (t.includes(w)) p++;
  for (const w of NEG) if (t.includes(w)) n++;
  if (p > n) return "positive";
  if (n > p) return "negative";
  return "neutral";
}

/* ───────────────────────── cache + fetch ───────────────────────── */

interface Cache {
  items: NewsItem[];
  ts: number;
}
let CACHE: Cache | null = null;
const TTL_MS = 5 * 60 * 1000;
let inflight: Promise<NewsItem[]> | null = null;

async function fetchOne(feed: FeedSource): Promise<NewsItem[]> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(feed.url, { headers: { "User-Agent": UA, "Accept": "application/rss+xml,application/xml,text/xml,*/*" }, signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return [];
    const xml = await res.text();
    const parsed = parseRss(xml);
    return parsed.slice(0, 20).map<NewsItem>((p, i) => ({
      id: `${feed.source}-${Buffer.from(p.link).toString("base64url")}-${i}`,
      title: p.title,
      url: p.link,
      source: feed.source,
      summary: p.description || undefined,
      sentiment: classifySentiment(`${p.title} ${p.description}`),
      publishedAt: new Date(p.pubDate),
    }));
  } catch {
    return [];
  }
}

async function refresh(): Promise<NewsItem[]> {
  const results = await Promise.all(FEEDS.map(fetchOne));
  const flat = results.flat();
  // Dedupe by URL (and fallback by title).
  const seen = new Set<string>();
  const uniq: NewsItem[] = [];
  for (const it of flat) {
    const key = (it.url || "").toLowerCase() || it.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(it);
  }
  uniq.sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt));
  // Round-robin interleave by source so no single feed (e.g. Moneycontrol with stale dates
  // bumped to "now") dominates the top of the merged list.
  const bySource = new Map<string, NewsItem[]>();
  for (const it of uniq) {
    const arr = bySource.get(it.source) ?? [];
    arr.push(it);
    bySource.set(it.source, arr);
  }
  const queues = Array.from(bySource.values());
  const interleaved: NewsItem[] = [];
  let added = true;
  while (added) {
    added = false;
    for (const q of queues) {
      const next = q.shift();
      if (next) { interleaved.push(next); added = true; }
    }
  }
  CACHE = { items: interleaved, ts: Date.now() };
  return interleaved;
}

/** All cached items (no count slice). Used by stocksToWatch classifier. */
export async function getAllMarketNewsLive(): Promise<NewsItem[]> {
  const now = Date.now();
  if (CACHE && now - CACHE.ts < TTL_MS && CACHE.items.length > 0) return CACHE.items;
  if (!inflight) inflight = refresh().finally(() => { inflight = null; });
  try { return await inflight; } catch { return CACHE?.items ?? []; }
}

export async function getMarketNewsLive(count = 30): Promise<NewsItem[]> {
  const now = Date.now();
  if (CACHE && now - CACHE.ts < TTL_MS && CACHE.items.length > 0) {
    return CACHE.items.slice(0, count);
  }
  if (!inflight) {
    inflight = refresh().finally(() => { inflight = null; });
  }
  try {
    const items = await inflight;
    return items.slice(0, count);
  } catch {
    return CACHE?.items.slice(0, count) ?? [];
  }
}

// Warm cache on module load (guarded: skip in test env — P0.1B tripwire).
if (process.env['NODE_ENV'] !== 'test' && getBootCapabilities().providerNetwork) {
  void getMarketNewsLive(1).catch(() => undefined);
  // Background refresh every 5 minutes.
  setInterval(() => { void refresh().catch(() => undefined); }, TTL_MS);
}
