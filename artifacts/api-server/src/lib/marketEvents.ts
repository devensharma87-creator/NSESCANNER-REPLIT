import { YahooFinance } from "./marketData/analyticsYahoo";
import { UNIVERSE } from "./universe";
import { logger } from "./logger";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

export interface MarketHoliday {
  date: string;          // YYYY-MM-DD
  name: string;
  exchange: string;      // "NSE/BSE", "NYSE", "LSE", etc.
  region: "IN" | "US" | "UK" | "EU" | "JP" | "HK" | "CN";
}

export interface EarningResult {
  date: string;          // YYYY-MM-DD
  symbol: string;
  name: string;
  estimateEPS?: number;
  source: string;
}

export interface EconomicEvent {
  date: string;          // YYYY-MM-DD
  name: string;
  region: "IN" | "US" | "UK" | "EU" | "JP" | "GLOBAL";
  category: "rate" | "data" | "policy" | "event";
  impact: "high" | "medium" | "low";
  description?: string;
}

/* ───────────────────────────────────────────────────────────────────────
 * Holiday / economic calendars are curated per calendar year. To keep the
 * app working past 2026-12-31 we expose them as a year → list map and
 * automatically include the current year + next year so a user querying
 * in late December still sees January events for the following year.
 *
 * When NSE publishes the official next-year holiday list, replace the
 * placeholder entries below with the actual gazetted dates.
 * ─────────────────────────────────────────────────────────────────────── */

// --- Curated 2026 NSE/BSE holidays (published by NSE annually) ---
// Source: NSE Circular NSE/CMTR/71775 — official 2026 weekday trading holidays
// (15 dates, equity segment). Updated from prior placeholder list 2026-07-22.
// June 25 is a normal Thursday and is NOT a holiday.
const NSE_HOLIDAYS_2026: MarketHoliday[] = [
  { date: "2026-01-26", name: "Republic Day",                 exchange: "NSE/BSE", region: "IN" },
  { date: "2026-03-03", name: "Holi",                         exchange: "NSE/BSE", region: "IN" },
  { date: "2026-03-26", name: "Shri Ram Navami",              exchange: "NSE/BSE", region: "IN" },
  { date: "2026-03-31", name: "Id-ul-Fitr (Eid)",             exchange: "NSE/BSE", region: "IN" },
  { date: "2026-04-03", name: "Good Friday",                  exchange: "NSE/BSE", region: "IN" },
  { date: "2026-04-14", name: "Dr. B.R. Ambedkar Jayanti",   exchange: "NSE/BSE", region: "IN" },
  { date: "2026-05-01", name: "Maharashtra Day",              exchange: "NSE/BSE", region: "IN" },
  { date: "2026-05-28", name: "Buddha Purnima",               exchange: "NSE/BSE", region: "IN" },
  { date: "2026-06-26", name: "Muharram",                     exchange: "NSE/BSE", region: "IN" },
  { date: "2026-09-14", name: "Milad-un-Nabi",                exchange: "NSE/BSE", region: "IN" },
  { date: "2026-10-02", name: "Mahatma Gandhi Jayanti",       exchange: "NSE/BSE", region: "IN" },
  { date: "2026-10-20", name: "Diwali — Laxmi Pujan",         exchange: "NSE/BSE", region: "IN" },
  { date: "2026-11-10", name: "Diwali Balipratipada",         exchange: "NSE/BSE", region: "IN" },
  { date: "2026-11-24", name: "Guru Nanak Jayanti",           exchange: "NSE/BSE", region: "IN" },
  { date: "2026-12-25", name: "Christmas",                    exchange: "NSE/BSE", region: "IN" },
];

// --- Provisional 2027 NSE/BSE holidays (best-effort projection from prior years' patterns).
//     Replace with the official NSE 2027 list when published. ---
const NSE_HOLIDAYS_2027: MarketHoliday[] = [
  { date: "2027-01-26", name: "Republic Day",         exchange: "NSE/BSE", region: "IN" },
  { date: "2027-03-09", name: "Holi (provisional)",   exchange: "NSE/BSE", region: "IN" },
  { date: "2027-03-26", name: "Good Friday (provisional)", exchange: "NSE/BSE", region: "IN" },
  { date: "2027-04-14", name: "Dr. B.R. Ambedkar Jayanti", exchange: "NSE/BSE", region: "IN" },
  { date: "2027-05-01", name: "Maharashtra Day",      exchange: "NSE/BSE", region: "IN" },
  { date: "2027-08-13", name: "Independence Day (obs.)", exchange: "NSE/BSE", region: "IN" },
  { date: "2027-10-02", name: "Mahatma Gandhi Jayanti", exchange: "NSE/BSE", region: "IN" },
  { date: "2027-11-09", name: "Diwali — Laxmi Pujan (provisional)", exchange: "NSE/BSE", region: "IN" },
  { date: "2027-12-24", name: "Christmas Eve (obs.)", exchange: "NSE/BSE", region: "IN" },
];

// --- Curated 2026 global market holidays (key half/full closures) ---
const GLOBAL_HOLIDAYS_2026: MarketHoliday[] = [
  // US (NYSE/Nasdaq)
  { date: "2026-01-01", name: "New Year's Day",          exchange: "NYSE/Nasdaq", region: "US" },
  { date: "2026-01-19", name: "Martin Luther King Day",  exchange: "NYSE/Nasdaq", region: "US" },
  { date: "2026-02-16", name: "Presidents' Day",         exchange: "NYSE/Nasdaq", region: "US" },
  { date: "2026-04-03", name: "Good Friday",             exchange: "NYSE/Nasdaq", region: "US" },
  { date: "2026-05-25", name: "Memorial Day",            exchange: "NYSE/Nasdaq", region: "US" },
  { date: "2026-06-19", name: "Juneteenth",              exchange: "NYSE/Nasdaq", region: "US" },
  { date: "2026-07-03", name: "Independence Day (obs.)", exchange: "NYSE/Nasdaq", region: "US" },
  { date: "2026-09-07", name: "Labor Day",               exchange: "NYSE/Nasdaq", region: "US" },
  { date: "2026-11-26", name: "Thanksgiving",            exchange: "NYSE/Nasdaq", region: "US" },
  { date: "2026-11-27", name: "Black Friday (early close)", exchange: "NYSE/Nasdaq", region: "US" },
  { date: "2026-12-25", name: "Christmas",               exchange: "NYSE/Nasdaq", region: "US" },
  // UK (LSE)
  { date: "2026-01-01", name: "New Year's Day",          exchange: "LSE",  region: "UK" },
  { date: "2026-04-03", name: "Good Friday",             exchange: "LSE",  region: "UK" },
  { date: "2026-04-06", name: "Easter Monday",           exchange: "LSE",  region: "UK" },
  { date: "2026-05-04", name: "Early May Bank Holiday",  exchange: "LSE",  region: "UK" },
  { date: "2026-05-25", name: "Spring Bank Holiday",     exchange: "LSE",  region: "UK" },
  { date: "2026-08-31", name: "Summer Bank Holiday",     exchange: "LSE",  region: "UK" },
  { date: "2026-12-25", name: "Christmas",               exchange: "LSE",  region: "UK" },
  { date: "2026-12-28", name: "Boxing Day (obs.)",       exchange: "LSE",  region: "UK" },
  // Japan
  { date: "2026-01-01", name: "New Year (Ganjitsu)",     exchange: "TSE",  region: "JP" },
  { date: "2026-05-04", name: "Greenery Day",            exchange: "TSE",  region: "JP" },
  { date: "2026-05-05", name: "Children's Day",          exchange: "TSE",  region: "JP" },
  { date: "2026-08-11", name: "Mountain Day",            exchange: "TSE",  region: "JP" },
  { date: "2026-12-31", name: "New Year's Eve",          exchange: "TSE",  region: "JP" },
  // Hong Kong
  { date: "2026-02-17", name: "Lunar New Year",          exchange: "HKEX", region: "HK" },
  { date: "2026-04-03", name: "Good Friday",             exchange: "HKEX", region: "HK" },
  { date: "2026-10-01", name: "National Day (China)",    exchange: "HKEX", region: "HK" },
];

// --- Curated 2026 economic & central-bank calendar ---
// Domestic (RBI MPC) + global (Fed, ECB, BoE, BoJ) + key macro releases.
const ECONOMIC_EVENTS_2026: EconomicEvent[] = [
  // RBI MPC 2026 (bi-monthly)
  { date: "2026-02-06", name: "RBI MPC — Repo rate decision", region: "IN", category: "rate", impact: "high", description: "Reserve Bank of India Monetary Policy Committee outcome" },
  { date: "2026-04-08", name: "RBI MPC — Repo rate decision", region: "IN", category: "rate", impact: "high" },
  { date: "2026-06-05", name: "RBI MPC — Repo rate decision", region: "IN", category: "rate", impact: "high" },
  { date: "2026-08-07", name: "RBI MPC — Repo rate decision", region: "IN", category: "rate", impact: "high" },
  { date: "2026-10-02", name: "RBI MPC — Repo rate decision", region: "IN", category: "rate", impact: "high" },
  { date: "2026-12-04", name: "RBI MPC — Repo rate decision", region: "IN", category: "rate", impact: "high" },
  // India macro releases (typical schedule)
  { date: "2026-05-12", name: "India CPI Inflation (Apr)",   region: "IN", category: "data",  impact: "high" },
  { date: "2026-05-30", name: "India Q4 FY26 GDP",            region: "IN", category: "data",  impact: "high" },
  { date: "2026-06-12", name: "India CPI Inflation (May)",   region: "IN", category: "data",  impact: "high" },
  { date: "2026-06-14", name: "India WPI Inflation (May)",   region: "IN", category: "data",  impact: "medium" },
  { date: "2026-07-31", name: "Union Budget Half-Year Review", region: "IN", category: "policy", impact: "medium" },
  // US Fed FOMC 2026
  { date: "2026-04-29", name: "US Fed FOMC — Rate decision",  region: "US", category: "rate", impact: "high" },
  { date: "2026-06-17", name: "US Fed FOMC — Rate decision",  region: "US", category: "rate", impact: "high" },
  { date: "2026-07-29", name: "US Fed FOMC — Rate decision",  region: "US", category: "rate", impact: "high" },
  { date: "2026-09-16", name: "US Fed FOMC — Rate decision",  region: "US", category: "rate", impact: "high" },
  { date: "2026-11-04", name: "US Fed FOMC — Rate decision",  region: "US", category: "rate", impact: "high" },
  { date: "2026-12-16", name: "US Fed FOMC — Rate decision",  region: "US", category: "rate", impact: "high" },
  // US macro
  { date: "2026-05-01", name: "US Non-Farm Payrolls (Apr)",   region: "US", category: "data", impact: "high" },
  { date: "2026-05-13", name: "US CPI Inflation (Apr)",       region: "US", category: "data", impact: "high" },
  { date: "2026-06-05", name: "US Non-Farm Payrolls (May)",   region: "US", category: "data", impact: "high" },
  { date: "2026-06-11", name: "US CPI Inflation (May)",       region: "US", category: "data", impact: "high" },
  { date: "2026-07-03", name: "US Non-Farm Payrolls (Jun)",   region: "US", category: "data", impact: "high" },
  // ECB
  { date: "2026-04-30", name: "ECB — Rate decision",          region: "EU", category: "rate", impact: "high" },
  { date: "2026-06-04", name: "ECB — Rate decision",          region: "EU", category: "rate", impact: "high" },
  { date: "2026-07-23", name: "ECB — Rate decision",          region: "EU", category: "rate", impact: "high" },
  { date: "2026-09-10", name: "ECB — Rate decision",          region: "EU", category: "rate", impact: "high" },
  { date: "2026-10-29", name: "ECB — Rate decision",          region: "EU", category: "rate", impact: "high" },
  { date: "2026-12-17", name: "ECB — Rate decision",          region: "EU", category: "rate", impact: "high" },
  // BoE
  { date: "2026-05-07", name: "BoE — Bank Rate decision",     region: "UK", category: "rate", impact: "medium" },
  { date: "2026-06-18", name: "BoE — Bank Rate decision",     region: "UK", category: "rate", impact: "medium" },
  { date: "2026-08-06", name: "BoE — Bank Rate decision",     region: "UK", category: "rate", impact: "medium" },
  { date: "2026-09-17", name: "BoE — Bank Rate decision",     region: "UK", category: "rate", impact: "medium" },
  { date: "2026-11-05", name: "BoE — Bank Rate decision",     region: "UK", category: "rate", impact: "medium" },
  { date: "2026-12-17", name: "BoE — Bank Rate decision",     region: "UK", category: "rate", impact: "medium" },
  // BoJ
  { date: "2026-04-30", name: "BoJ — Policy decision",        region: "JP", category: "rate", impact: "medium" },
  { date: "2026-06-17", name: "BoJ — Policy decision",        region: "JP", category: "rate", impact: "medium" },
  { date: "2026-07-31", name: "BoJ — Policy decision",        region: "JP", category: "rate", impact: "medium" },
  { date: "2026-09-18", name: "BoJ — Policy decision",        region: "JP", category: "rate", impact: "medium" },
  { date: "2026-10-30", name: "BoJ — Policy decision",        region: "JP", category: "rate", impact: "medium" },
  { date: "2026-12-18", name: "BoJ — Policy decision",        region: "JP", category: "rate", impact: "medium" },
  // OPEC + global crude
  { date: "2026-06-04", name: "OPEC+ Ministerial Meeting",    region: "GLOBAL", category: "event", impact: "medium" },
  { date: "2026-12-03", name: "OPEC+ Ministerial Meeting",    region: "GLOBAL", category: "event", impact: "medium" },
];

// --- Provisional 2027 economic & central-bank calendar (key meetings only;
//     specific dates marked "tentative" until publishers confirm). ---
const ECONOMIC_EVENTS_2027: EconomicEvent[] = [
  // RBI MPC 2027 (bi-monthly, tentative)
  { date: "2027-02-04", name: "RBI MPC — Repo rate decision (tentative)", region: "IN", category: "rate", impact: "high" },
  { date: "2027-04-08", name: "RBI MPC — Repo rate decision (tentative)", region: "IN", category: "rate", impact: "high" },
  { date: "2027-06-10", name: "RBI MPC — Repo rate decision (tentative)", region: "IN", category: "rate", impact: "high" },
  { date: "2027-08-05", name: "RBI MPC — Repo rate decision (tentative)", region: "IN", category: "rate", impact: "high" },
  { date: "2027-10-07", name: "RBI MPC — Repo rate decision (tentative)", region: "IN", category: "rate", impact: "high" },
  { date: "2027-12-02", name: "RBI MPC — Repo rate decision (tentative)", region: "IN", category: "rate", impact: "high" },
  // US Fed FOMC 2027 (tentative)
  { date: "2027-01-27", name: "US Fed FOMC — Rate decision (tentative)",  region: "US", category: "rate", impact: "high" },
  { date: "2027-03-17", name: "US Fed FOMC — Rate decision (tentative)",  region: "US", category: "rate", impact: "high" },
  { date: "2027-04-28", name: "US Fed FOMC — Rate decision (tentative)",  region: "US", category: "rate", impact: "high" },
  { date: "2027-06-16", name: "US Fed FOMC — Rate decision (tentative)",  region: "US", category: "rate", impact: "high" },
  { date: "2027-07-28", name: "US Fed FOMC — Rate decision (tentative)",  region: "US", category: "rate", impact: "high" },
  { date: "2027-09-22", name: "US Fed FOMC — Rate decision (tentative)",  region: "US", category: "rate", impact: "high" },
  { date: "2027-11-03", name: "US Fed FOMC — Rate decision (tentative)",  region: "US", category: "rate", impact: "high" },
  { date: "2027-12-15", name: "US Fed FOMC — Rate decision (tentative)",  region: "US", category: "rate", impact: "high" },
];

const NSE_HOLIDAYS_BY_YEAR: Record<number, MarketHoliday[]> = {
  2026: NSE_HOLIDAYS_2026,
  2027: NSE_HOLIDAYS_2027,
};

/** Set of YYYY-MM-DD dates on which the NSE/BSE *regular* equity session
 *  (09:15–15:30 IST) does NOT run. Muhurat trading on Diwali is a special
 *  evening session (~6:15 PM); the daytime regular session is closed.
 *  Since the scanner / signal engine targets the regular session only, we
 *  treat Muhurat days as fully closed — preventing detectors from firing
 *  on stale daytime quotes that won't have any matching trading interest. */
const NSE_HOLIDAY_SET: Set<string> = new Set(
  Object.values(NSE_HOLIDAYS_BY_YEAR).flat().map(h => h.date)
);

export function isNseHoliday(istDate: Date): boolean {
  const ymd = istDate.toISOString().slice(0, 10);
  return NSE_HOLIDAY_SET.has(ymd);
}

/** Compute the equity-market session state for a given clock instant.
 *  IST sessions: pre-open 09:00–09:15, regular 09:15–15:30. Closed on weekends and NSE holidays. */
export function computeMarketStatus(now: Date): "open" | "closed" | "pre_open" {
  // Convert to IST wall-clock
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const dow = ist.getUTCDay();          // 0=Sun .. 6=Sat
  if (dow === 0 || dow === 6) return "closed";
  if (isNseHoliday(ist)) return "closed";
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  if (mins >= 9 * 60 && mins < 9 * 60 + 15) return "pre_open";
  if (mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30) return "open";
  return "closed";
}

export type MarketStatusReason =
  | "OPEN"
  | "BEFORE_OPEN"
  | "PRE_OPEN"
  | "AFTER_CLOSE"
  | "WEEKEND"
  | "HOLIDAY"
  | "UNKNOWN";

export interface FnoMarketStatusDetail {
  isTradingDay: boolean;
  marketOpen: boolean;
  reason: MarketStatusReason;
  serverUtc: string;
  serverIst: string;
  exchangeTimezone: string;
  openTimeIst: string;
  closeTimeIst: string;
  calendarSource: string;
  calendarAsOf: string;
}

/** Rich IST market-hours status.  Use marketOpen (boolean) for gating; reason for display copy. */
export function getMarketStatusDetail(now: Date): FnoMarketStatusDetail {
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const dow = ist.getUTCDay(); // 0=Sun .. 6=Sat
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();

  const pad2 = (n: number) => String(n).padStart(2, "0");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const serverIst = `${pad2(ist.getUTCHours())}:${pad2(ist.getUTCMinutes())} ${pad2(ist.getUTCDate())}-${months[ist.getUTCMonth()]}-${ist.getUTCFullYear()}`;

  let reason: MarketStatusReason;
  let marketOpen = false;
  let isTradingDay = false;

  if (dow === 0 || dow === 6) {
    reason = "WEEKEND";
  } else if (isNseHoliday(ist)) {
    reason = "HOLIDAY";
  } else {
    isTradingDay = true;
    if (mins < 9 * 60) {
      reason = "BEFORE_OPEN";
    } else if (mins < 9 * 60 + 15) {
      reason = "PRE_OPEN";
    } else if (mins <= 15 * 60 + 30) {
      reason = "OPEN";
      marketOpen = true;
    } else {
      reason = "AFTER_CLOSE";
    }
  }

  return {
    isTradingDay,
    marketOpen,
    reason,
    serverUtc: now.toISOString(),
    serverIst,
    exchangeTimezone: "Asia/Kolkata",
    openTimeIst: "09:15",
    closeTimeIst: "15:30",
    calendarSource: "NSE_CURATED_2026",
    calendarAsOf: "2026-12-31",
  };
}
const ECONOMIC_EVENTS_BY_YEAR: Record<number, EconomicEvent[]> = {
  2026: ECONOMIC_EVENTS_2026,
  2027: ECONOMIC_EVENTS_2027,
};

/** Pick all curated events that could fall inside a [from, to] window —
 * walks each year that intersects the range and collects matching lists.
 * Returns [] for any year we don't have data for (so the calendar simply
 * shows fewer items rather than throwing). */
function holidaysInRange(fromMs: number, toMs: number): MarketHoliday[] {
  const fromY = new Date(fromMs).getUTCFullYear();
  const toY = new Date(toMs).getUTCFullYear();
  const out: MarketHoliday[] = [];
  for (let y = fromY; y <= toY; y++) {
    const list = NSE_HOLIDAYS_BY_YEAR[y];
    if (list) out.push(...list);
    // Global holidays are only curated for 2026; mirror the same pattern
    // for future years if/when that list grows.
    if (y === 2026) out.push(...GLOBAL_HOLIDAYS_2026);
  }
  return out;
}
function eventsInRange(fromMs: number, toMs: number): EconomicEvent[] {
  const fromY = new Date(fromMs).getUTCFullYear();
  const toY = new Date(toMs).getUTCFullYear();
  const out: EconomicEvent[] = [];
  for (let y = fromY; y <= toY; y++) {
    const list = ECONOMIC_EVENTS_BY_YEAR[y];
    if (list) out.push(...list);
  }
  return out;
}

// --- Earnings calendar via Yahoo (Indian universe + global mega-caps) ---
const GLOBAL_TICKERS_FOR_EARNINGS = [
  "AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA", "JPM", "BAC", "WFC",
  "TSM", "BABA", "TM",
];

interface EarningsCacheEntry { items: EarningResult[]; ts: number }
let earningsCache: EarningsCacheEntry | null = null;
const EARNINGS_TTL_MS = 6 * 60 * 60 * 1000; // 6h

async function fetchEarningsForSymbol(yfSym: string, displayName?: string): Promise<EarningResult | null> {
  try {
    const summary = await yf.quoteSummary(yfSym, { modules: ["calendarEvents", "price"] }) as unknown as {
      calendarEvents?: { earnings?: { earningsDate?: Date[]; earningsAverage?: number } };
      price?: { shortName?: string; longName?: string };
    };
    const ed = summary?.calendarEvents?.earnings?.earningsDate?.[0];
    if (!ed) return null;
    const date = new Date(ed);
    if (Number.isNaN(date.getTime())) return null;
    const ymd = date.toISOString().slice(0, 10);
    const symbolDisplay = yfSym.replace(/\.NS$|\.BO$/, "");
    return {
      date: ymd,
      symbol: symbolDisplay,
      name: displayName || summary?.price?.longName || summary?.price?.shortName || symbolDisplay,
      estimateEPS: summary?.calendarEvents?.earnings?.earningsAverage,
      source: yfSym.endsWith(".NS") || yfSym.endsWith(".BO") ? "NSE/BSE" : "Global",
    };
  } catch {
    return null;
  }
}

async function refreshEarnings(): Promise<EarningResult[]> {
  const now = new Date();
  const horizonMs = 30 * 24 * 60 * 60 * 1000;
  const limit = 60; // throttle: top 60 by curated order in universe
  const indianTargets = UNIVERSE.slice(0, limit).map(u => ({
    yfSym: u.symbol.endsWith(".NS") || u.symbol.endsWith(".BO") ? u.symbol : `${u.symbol}.NS`,
    name: u.name,
  }));
  const globalTargets = GLOBAL_TICKERS_FOR_EARNINGS.map(s => ({ yfSym: s, name: s }));
  const all = [...indianTargets, ...globalTargets];

  // Run in batches of 8 to avoid hammering Yahoo.
  const out: EarningResult[] = [];
  const batchSize = 8;
  for (let i = 0; i < all.length; i += batchSize) {
    const batch = all.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(t => fetchEarningsForSymbol(t.yfSym, t.name)));
    for (const r of results) {
      if (!r) continue;
      const ts = new Date(r.date).getTime();
      if (Number.isNaN(ts)) continue;
      // Only include events within the next 30 days OR up to 2 days ago (just-released).
      if (ts < now.getTime() - 2 * 24 * 60 * 60 * 1000) continue;
      if (ts > now.getTime() + horizonMs) continue;
      out.push(r);
    }
  }
  // Dedupe by symbol
  const seen = new Set<string>();
  const uniq: EarningResult[] = [];
  for (const r of out) {
    if (seen.has(r.symbol)) continue;
    seen.add(r.symbol);
    uniq.push(r);
  }
  uniq.sort((a, b) => a.date.localeCompare(b.date));
  return uniq;
}

export async function getUpcomingEarnings(): Promise<EarningResult[]> {
  const now = Date.now();
  if (earningsCache && now - earningsCache.ts < EARNINGS_TTL_MS) {
    return earningsCache.items;
  }
  try {
    const items = await refreshEarnings();
    earningsCache = { items, ts: now };
    return items;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "earnings refresh failed");
    return earningsCache?.items ?? [];
  }
}

export interface MarketEventsResponse {
  generatedAt: string;
  holidays: { upcoming: MarketHoliday[]; total: number };
  earnings: EarningResult[];
  events: EconomicEvent[];
}

export async function getMarketEvents(): Promise<MarketEventsResponse> {
  const now = new Date();
  const todayMs = now.getTime();
  const horizonMs = 90 * 24 * 60 * 60 * 1000;

  const winFrom = todayMs - 24 * 60 * 60 * 1000;
  const winTo = todayMs + horizonMs;

  const allHolidays = holidaysInRange(winFrom, winTo)
    .filter(h => {
      const t = new Date(`${h.date}T00:00:00+05:30`).getTime();
      return t >= winFrom && t <= winTo;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const events = eventsInRange(winFrom, winTo)
    .filter(e => {
      const t = new Date(`${e.date}T00:00:00Z`).getTime();
      return t >= winFrom && t <= winTo;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const earnings = await getUpcomingEarnings();

  return {
    generatedAt: now.toISOString(),
    holidays: { upcoming: allHolidays, total: allHolidays.length },
    earnings,
    events,
  };
}

// Warm cache on boot (guarded: skip in test env — P0.1B tripwire)
if (process.env['NODE_ENV'] !== 'test') {
  void getUpcomingEarnings().catch(() => undefined);
  setInterval(() => { void getUpcomingEarnings().catch(() => undefined); }, EARNINGS_TTL_MS);
}
