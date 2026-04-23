/**
 * Real fundamentals + news for the stock-detail page.
 *
 * - Financials & Holdings: delegated to Yahoo `quoteSummary` via fetchStatements()
 *   in lib/yahoo.ts. We adapt the rich StockStatements shape to the slimmer
 *   {QuarterlyFinancial, Holding} shape exposed by the public API.
 * - Per-symbol news: filtered from the live RSS aggregator by symbol/name keyword.
 * - Market news: returns whatever the live RSS aggregator delivers.
 *
 * Importantly, when real data is unavailable we return an EMPTY array rather
 * than fabricated rows. The UI is responsible for rendering an honest
 * "data unavailable" state — never silently substitute synthetic numbers.
 */

import type { Holding, NewsItem, QuarterlyFinancial } from "@workspace/api-zod";
import { getEntry } from "./universe";
import { fetchStatements } from "./yahoo";
import { getMarketNewsLive } from "./newsRss";

/* ───────────────────────── Quarterly P&L (real, from Yahoo) ───────────────────────── */

export async function getFinancials(symbol: string): Promise<QuarterlyFinancial[]> {
  const stmts = await fetchStatements(symbol, "NS").catch(() => null);
  if (!stmts || stmts.quarterlyPL.length === 0) return [];
  // Yahoo returns 4 quarters typically; sort newest-first to match prior contract.
  return stmts.quarterlyPL
    .slice()
    .sort((a, b) => a.endDate.localeCompare(b.endDate))
    .map(q => ({
      period: q.period,
      revenue: q.revenue,
      netProfit: q.netProfit,
      eps: q.eps,
      operatingMargin: q.operatingMargin,
      netMargin: q.netMargin,
    }));
}

/* ───────────────────────── Holdings (real, from Yahoo) ─────────────────────────
 * Yahoo's majorHoldersBreakdown only gives us a single snapshot (insiders%,
 * institutions%, public%). We don't have FII vs DII split nor a quarterly
 * series for free. Rather than fabricate, we return a single-row "current"
 * holding (period = "Current") with promoter≈insiders, fii+dii combined into
 * `fii`, dii=0, public=public. Returns [] when the upstream data is missing. */

export async function getHoldings(symbol: string): Promise<Holding[]> {
  const stmts = await fetchStatements(symbol, "NS").catch(() => null);
  if (!stmts) return [];
  const sh = stmts.shareholding;
  if (sh.insidersPct == null && sh.institutionsPct == null && sh.publicPct == null) return [];
  return [{
    period: "Current",
    promoter: sh.insidersPct,
    fii: sh.institutionsPct,
    dii: 0,
    public: sh.publicPct,
  }];
}

/* ───────────────────────── News (real RSS, keyword-filtered) ───────────────────────── */

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 &]/g, " ")
    .split(/\s+/)
    .filter(t => t.length >= 3 && !STOP.has(t));
}
const STOP = new Set(["the", "and", "ltd", "limited", "corp", "company", "industries", "india", "private"]);

/** Returns up to `count` recent live RSS items mentioning the symbol or its
 * canonical name. If nothing matches we return [] — never fabricate. */
export async function getNewsForSymbol(symbol: string, count = 5): Promise<NewsItem[]> {
  const entry = getEntry(symbol);
  const live = await getMarketNewsLive(80).catch(() => [] as NewsItem[]);
  if (live.length === 0) return [];

  const sym = symbol.toUpperCase();
  const nameTokens = entry?.name ? tokens(entry.name) : [];

  const matches = live.filter(n => {
    const hay = `${n.title} ${n.summary ?? ""}`.toLowerCase();
    if (hay.includes(sym.toLowerCase())) return true;
    // require at least one >=4-letter name token to avoid spurious matches
    return nameTokens.some(tok => tok.length >= 4 && hay.includes(tok));
  });

  return matches
    .slice(0, count)
    .map(n => ({ ...n, symbol }));
}

/** Live market headlines from the RSS aggregator. Returns [] if nothing is
 * available (e.g. all upstreams down). The route layer should NOT substitute
 * fabricated headlines on failure. */
export async function getMarketNews(count = 12): Promise<NewsItem[]> {
  const live = await getMarketNewsLive(count).catch(() => [] as NewsItem[]);
  return live.slice(0, count);
}
