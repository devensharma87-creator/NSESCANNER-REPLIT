import type { Holding, NewsItem, QuarterlyFinancial } from "@workspace/api-zod";
import { getEntry } from "./universe";

// We don't have a free, structured financials/holdings/news feed for NSE.
// To keep the app realistic and stable across refreshes, we generate
// deterministic-but-plausible series anchored to the symbol identity.

function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6D2B79F5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function quarterLabel(offset: number): string {
  const now = new Date();
  const totalQ = now.getFullYear() * 4 + Math.floor(now.getMonth() / 3) - 1 - offset;
  const y = Math.floor(totalQ / 4);
  const q = (totalQ % 4) + 1;
  return `Q${q} FY${(y + 1).toString().slice(-2)}`;
}

export function getFinancials(symbol: string): QuarterlyFinancial[] {
  const rand = seeded(`${symbol}-fin`);
  const baseRevenue = 800 + Math.floor(rand() * 9000); // crore ₹
  const baseMargin = 0.08 + rand() * 0.22;
  const out: QuarterlyFinancial[] = [];
  for (let i = 12; i >= 0; i--) {
    const growth = Math.pow(1 + (0.02 + rand() * 0.06), 12 - i);
    const seasonality = 1 + (i % 4 === 0 ? 0.06 : i % 4 === 2 ? -0.04 : 0);
    const revenue = baseRevenue * growth * seasonality * (0.95 + rand() * 0.1);
    const opMargin = Math.max(0.04, baseMargin + (rand() - 0.5) * 0.04);
    const netMargin = Math.max(0.02, opMargin - (0.03 + rand() * 0.02));
    const netProfit = revenue * netMargin;
    const eps = netProfit / (50 + rand() * 200);
    out.push({
      period: quarterLabel(i),
      revenue: Math.round(revenue * 10) / 10,
      netProfit: Math.round(netProfit * 10) / 10,
      eps: Math.round(eps * 100) / 100,
      operatingMargin: Math.round(opMargin * 1000) / 10,
      netMargin: Math.round(netMargin * 1000) / 10,
    });
  }
  return out;
}

export function getHoldings(symbol: string): Holding[] {
  const rand = seeded(`${symbol}-hold`);
  let promoter = 35 + rand() * 40;
  let fii = 8 + rand() * 18;
  let dii = 6 + rand() * 14;
  const out: Holding[] = [];
  for (let i = 12; i >= 0; i--) {
    promoter += (rand() - 0.5) * 0.4;
    fii += (rand() - 0.5) * 1.2;
    dii += (rand() - 0.5) * 0.8;
    promoter = Math.max(15, Math.min(80, promoter));
    fii = Math.max(2, Math.min(45, fii));
    dii = Math.max(2, Math.min(35, dii));
    const total = promoter + fii + dii;
    const pub = Math.max(5, 100 - total);
    out.push({
      period: quarterLabel(i),
      promoter: Math.round(promoter * 10) / 10,
      fii: Math.round(fii * 10) / 10,
      dii: Math.round(dii * 10) / 10,
      public: Math.round(pub * 10) / 10,
    });
  }
  return out;
}

const NEWS_TEMPLATES: Array<(name: string, sector: string) => Omit<NewsItem, "id" | "publishedAt" | "symbol">> = [
  (n, _s) => ({
    title: `${n} reports steady growth in latest quarter`,
    source: "Business Standard",
    url: "https://www.business-standard.com/",
    summary: `${n} posted in-line revenue with margin expansion led by operating leverage and stable input costs.`,
    sentiment: "positive",
  }),
  (n, _s) => ({
    title: `Brokerages raise target price on ${n} after strong commentary`,
    source: "Moneycontrol",
    url: "https://www.moneycontrol.com/",
    summary: `Multiple brokerages cite improving demand outlook and operating leverage as drivers for the upgrade.`,
    sentiment: "positive",
  }),
  (n, s) => ({
    title: `${s} sector sees buying interest as macro indicators improve`,
    source: "Mint",
    url: "https://www.livemint.com/",
    summary: `Improved domestic demand and easing input costs are supporting the broader ${s.toLowerCase()} sector.`,
    sentiment: "positive",
  }),
  (n, _s) => ({
    title: `${n} board meeting scheduled to consider strategic update`,
    source: "ET Markets",
    url: "https://economictimes.indiatimes.com/markets",
    summary: `The board is expected to review business plans and provide a near-term outlook for stakeholders.`,
    sentiment: "neutral",
  }),
  (n, _s) => ({
    title: `${n} faces near-term headwinds from input cost inflation`,
    source: "CNBC-TV18",
    url: "https://www.cnbctv18.com/",
    summary: `Margins could see modest pressure if elevated input costs persist into the next quarter.`,
    sentiment: "negative",
  }),
];

export function getNewsForSymbol(symbol: string, count = 5): NewsItem[] {
  const entry = getEntry(symbol);
  if (!entry) return [];
  const rand = seeded(`${symbol}-news-${Math.floor(Date.now() / (6 * 60 * 60 * 1000))}`);
  const out: NewsItem[] = [];
  for (let i = 0; i < count; i++) {
    const tpl = NEWS_TEMPLATES[Math.floor(rand() * NEWS_TEMPLATES.length)]!;
    const data = tpl(entry.name, entry.sector);
    const ageH = Math.floor(rand() * 48);
    out.push({
      id: `${symbol}-${i}`,
      ...data,
      symbol,
      publishedAt: new Date(Date.now() - ageH * 60 * 60 * 1000),
    });
  }
  return out.sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt));
}

export function getMarketNews(count = 12): NewsItem[] {
  const rand = seeded(`market-${Math.floor(Date.now() / (6 * 60 * 60 * 1000))}`);
  const headlines: Array<Omit<NewsItem, "id" | "publishedAt">> = [
    { title: "Nifty hovers near record as IT and banks lead the tape", source: "Moneycontrol", url: "https://www.moneycontrol.com/", summary: "IT majors and large private banks continue to provide directional support for the benchmark.", sentiment: "positive" },
    { title: "FII flows turn supportive after recent bout of selling", source: "ET Markets", url: "https://economictimes.indiatimes.com/markets", summary: "Foreign portfolio investors were net buyers in the cash market for a second straight session.", sentiment: "positive" },
    { title: "Crude oil eases on softer demand outlook", source: "Mint", url: "https://www.livemint.com/", summary: "OMCs and paint stocks may benefit from a softer crude trajectory in the near term.", sentiment: "positive" },
    { title: "RBI minutes signal cautious stance amid sticky core inflation", source: "Business Standard", url: "https://www.business-standard.com/", summary: "Rate-cut timing remains data-dependent; banks could see modest NIM compression.", sentiment: "neutral" },
    { title: "Auto retail momentum holds in semi-urban markets", source: "CNBC-TV18", url: "https://www.cnbctv18.com/", summary: "Two-wheeler and entry SUV demand remains the bright spot heading into the festive period.", sentiment: "positive" },
    { title: "Metal stocks slip as China demand worries resurface", source: "Bloomberg Quint", url: "https://www.bqprime.com/", summary: "Steel and base metal counters under pressure on softer global cues.", sentiment: "negative" },
    { title: "Pharma sector eyes specialty launches as US pricing stabilises", source: "Moneycontrol", url: "https://www.moneycontrol.com/", summary: "Companies with complex generics pipeline expected to outperform peers.", sentiment: "positive" },
    { title: "Power demand hits seasonal peak; PSU utilities in focus", source: "ET Markets", url: "https://economictimes.indiatimes.com/markets", summary: "Sustained industrial activity is keeping daily power demand elevated.", sentiment: "positive" },
    { title: "Realty stocks consolidate after multi-month rally", source: "Mint", url: "https://www.livemint.com/", summary: "Pre-sales momentum remains healthy but valuations now demand earnings delivery.", sentiment: "neutral" },
    { title: "FMCG volume growth gradually picking up in rural India", source: "Business Standard", url: "https://www.business-standard.com/", summary: "Industry checks suggest mid-single-digit volume growth as monsoon support kicks in.", sentiment: "positive" },
    { title: "Defence orders pipeline keeps PSU manufacturers in spotlight", source: "CNBC-TV18", url: "https://www.cnbctv18.com/", summary: "Indigenisation push driving sustained order inflows for listed defence majors.", sentiment: "positive" },
    { title: "USD-INR holds in tight range; exporters watch closely", source: "Bloomberg Quint", url: "https://www.bqprime.com/", summary: "Range-bound rupee keeps near-term hedging activity muted for IT and pharma exporters.", sentiment: "neutral" },
  ];
  const out: NewsItem[] = [];
  const used = new Set<number>();
  while (out.length < count && used.size < headlines.length) {
    const idx = Math.floor(rand() * headlines.length);
    if (used.has(idx)) continue;
    used.add(idx);
    const h = headlines[idx]!;
    const ageH = Math.floor(rand() * 24);
    out.push({
      id: `mkt-${idx}`,
      ...h,
      publishedAt: new Date(Date.now() - ageH * 60 * 60 * 1000),
    });
  }
  return out.sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt));
}
