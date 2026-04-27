import { logger } from "./logger";
import YahooFinance from "yahoo-finance2";
import { YAHOO_TICKER_OVERRIDES } from "./universe";

/** Translate canonical NSE/BSE symbol to the Yahoo Finance ticker actually used in
 *  network calls. Applies the renamed-ticker map (e.g. ZOMATO → ETERNAL.NS) and
 *  appends the appropriate exchange suffix when missing. */
export function yahooTickerFor(symbol: string, exchange: "NS" | "BO" = "NS"): string {
  // Already includes a suffix (passed by index/global lookups) — return as-is.
  if (/\.(NS|BO|BSE)$/i.test(symbol) || symbol.startsWith("^")) return symbol;
  const base = YAHOO_TICKER_OVERRIDES[symbol.toUpperCase()] ?? symbol;
  return `${base}.${exchange}`;
}

export interface YahooMeta {
  symbol: string;
  regularMarketPrice: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketVolume?: number;
  regularMarketTime?: number;
  chartPreviousClose?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  shortName?: string;
  longName?: string;
  exchangeName?: string;
}

export interface YahooChart {
  symbol: string;
  meta: YahooMeta;
  timestamps: number[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
}

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

// ── Hard-timeout guard for every external Yahoo call ─────────────────
// `yahoo-finance2` does not expose a per-request abort signal in the
// version we're on, so it will happily wait until the OS-level socket
// timeout (which can be 5+ minutes) when the upstream is unreachable.
// In production we've observed ~300s aborts cascading across every
// endpoint that depends on Yahoo (`/api/stocks`, `/api/sectors`,
// `/api/scan/top`, `/api/watchlist/*`, `/api/market/trend`,
// `/api/market/premarket`, …). Wrapping each call in `Promise.race`
// against a hard timer means a single slow ticker can't hold the
// entire request for minutes — it fails fast and the caller falls
// back to whatever data is already cached.
const YF_CHART_TIMEOUT_MS = 6_000;        // per attempt
const YF_QUOTE_SUMMARY_TIMEOUT_MS = 8_000; // per attempt — quoteSummary is heavier

class YahooTimeoutError extends Error {
  constructor(op: string, ms: number) { super(`Yahoo ${op} timed out after ${ms}ms`); this.name = "YahooTimeoutError"; }
}

function withTimeout<T>(op: string, ms: number, p: Promise<T>): Promise<T> {
  let to: NodeJS.Timeout | undefined;
  const timer = new Promise<never>((_, reject) => {
    to = setTimeout(() => reject(new YahooTimeoutError(op, ms)), ms);
  });
  return Promise.race([p, timer]).finally(() => { if (to) clearTimeout(to); }) as Promise<T>;
}

const RANGE_DAYS: Record<string, number> = {
  "1d": 2,
  "5d": 7,
  "1mo": 32,
  "3mo": 95,
  "6mo": 190,
  "1y": 370,
  "2y": 740,
  "3y": 1200,
  "5y": 2200,
};

type Interval = "1m" | "5m" | "15m" | "30m" | "60m" | "1d" | "1wk" | "1mo";

async function chartCall(ticker: string, range: string, interval: Interval): Promise<YahooChart | null> {
  const days = RANGE_DAYS[range] ?? 190;
  const period1 = new Date(Date.now() - days * 24 * 3600 * 1000);
  // Yahoo's edge will sporadically return "Too Many Requests" (HTTP 429) under
  // bursty load — we hammer it across many endpoints (market summary, trends,
  // deep snapshots, etc.). A short exponential-backoff retry inside the single
  // network primitive turns transient throttling into a clean success without
  // requiring every caller to add its own retry logic. We intentionally only
  // retry on 429 — for ETIMEDOUT/ECONNRESET (which in production usually means
  // Yahoo is unreachable from the deploy region, not a transient blip) we
  // fail fast on the first hit so a 280-symbol scan can't burn 7+ minutes
  // waiting for socket timeouts.
  const RATE_LIMIT_BACKOFF_MS = [600, 1500];
  // The yahoo-finance2 type for `chart` over-narrows to `{}` in some library
  // versions when called with permissive options — cast through `any` so we
  // can still inspect `meta` / `quotes` defensively at runtime.
  let res: any = null;
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= RATE_LIMIT_BACKOFF_MS.length; attempt++) {
    try {
      // The library accepts "1m"/"5m" but typing of `chart` is permissive.
      // Each individual attempt is bounded by a hard timer so we never wait
      // longer than YF_CHART_TIMEOUT_MS for one call regardless of what the
      // library does internally.
      res = await withTimeout(
        "chart",
        YF_CHART_TIMEOUT_MS,
        yf.chart(ticker, { period1, interval: interval as never }) as Promise<unknown>,
      );
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err as Error;
      const msg = lastErr.message ?? "";
      // Only retry on hard rate-limit responses. Network-level failures
      // (timeout, connection reset, DNS) are likely persistent in this
      // environment and retrying just multiplies the wait.
      const isRateLimit = /Too Many Requests|429/i.test(msg);
      if (!isRateLimit || attempt >= RATE_LIMIT_BACKOFF_MS.length) break;
      await new Promise(r => setTimeout(r, RATE_LIMIT_BACKOFF_MS[attempt]));
    }
  }
  if (lastErr || !res) {
    if (lastErr) {
      logger.warn({ err: lastErr.message, ticker, range, interval }, "Yahoo chart failed");
    }
    return null;
  }
  try {
    if (!res?.meta || !res.quotes?.length) return null;
    const open: number[] = [];
    const high: number[] = [];
    const low: number[] = [];
    const close: number[] = [];
    const volume: number[] = [];
    const timestamps: number[] = [];
    for (const q of res.quotes) {
      if (q.open == null || q.high == null || q.low == null || q.close == null) continue;
      timestamps.push(Math.floor(new Date(q.date).getTime() / 1000));
      open.push(q.open);
      high.push(q.high);
      low.push(q.low);
      close.push(q.close);
      volume.push(q.volume ?? 0);
    }
    const meta: YahooMeta = {
      symbol: ticker,
      regularMarketPrice: res.meta.regularMarketPrice ?? close[close.length - 1] ?? 0,
      regularMarketDayHigh: res.meta.regularMarketDayHigh,
      regularMarketDayLow: res.meta.regularMarketDayLow,
      regularMarketVolume: res.meta.regularMarketVolume,
      regularMarketTime: res.meta.regularMarketTime ? Math.floor(new Date(res.meta.regularMarketTime).getTime() / 1000) : undefined,
      chartPreviousClose: res.meta.chartPreviousClose ?? res.meta.previousClose,
      fiftyTwoWeekHigh: res.meta.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: res.meta.fiftyTwoWeekLow,
      shortName: res.meta.shortName,
      longName: res.meta.longName,
      exchangeName: res.meta.exchangeName,
    };
    return { symbol: ticker, meta, timestamps, open, high, low, close, volume };
  } catch (err) {
    logger.warn({ err: (err as Error).message, ticker, range, interval }, "Yahoo chart failed");
    return null;
  }
}

export async function fetchChart(
  symbol: string,
  range: "1d" | "5d" | "1mo" | "3mo" | "6mo" | "1y" | "2y" | "3y" | "5y" = "6mo",
  interval: "1d" | "1wk" | "1mo" = "1d",
  exchange: "NS" | "BO" = "NS",
): Promise<YahooChart | null> {
  const ticker = yahooTickerFor(symbol, exchange);
  const r = await chartCall(ticker, range, interval);
  if (r) return { ...r, symbol };
  return null;
}

export async function fetchIndexChart(yahooSymbol: string): Promise<YahooChart | null> {
  return chartCall(yahooSymbol, "5d", "1d");
}

/** Fetch intraday bars (most recent session) for an index or stock symbol. */
export async function fetchIntraday(
  yahooSymbol: string,
  interval: "5m" | "15m" | "30m" | "60m" = "15m",
  range: "1d" | "5d" = "5d",
): Promise<YahooChart | null> {
  return chartCall(yahooSymbol, range, interval);
}

/** Fundamental key stats from Yahoo Finance quoteSummary. Returned as ₹-friendly numbers
 * (market cap converted from raw INR to crore). Cached per symbol for 1 hour. */
export interface YahooFundamentals {
  marketCapCr?: number;
  peRatio?: number;
  forwardPe?: number;
  pbRatio?: number;
  eps?: number;
  bookValue?: number;
  dividendYield?: number;
  beta?: number;
  roe?: number;
  debtToEquity?: number;
  profitMargin?: number;
  operatingMargin?: number;
  sharesOutstandingCr?: number;
  fiftyDayAverage?: number;
  twoHundredDayAverage?: number;
  revenueGrowthYoy?: number;
  earningsGrowthYoy?: number;
  priceToSales?: number;
}

const FUND_TTL = 60 * 60 * 1000;
const fundCache = new Map<string, { ts: number; data: YahooFundamentals | null }>();

/* ───── Full financial statements (annual + quarterly P&L, balance sheet, cash flow, holders) ───── */
export interface AnnualPLRow {
  period: string;            // FY label, e.g. "FY24"
  endDate: string;           // ISO yyyy-mm-dd
  revenue?: number;          // ₹ crore
  costOfRevenue?: number;
  grossProfit?: number;
  ebitda?: number;
  ebit?: number;             // operating income
  interestExpense?: number;
  netProfit?: number;
  eps?: number;              // basic EPS
  taxProvision?: number;
  operatingMargin?: number;  // %
  netMargin?: number;        // %
}
export interface QuarterlyPLRow extends AnnualPLRow { /* same shape, period = "Qx FY..." */ }

export interface BalanceSheetRow {
  period: string;
  endDate: string;
  totalAssets?: number;       // ₹ crore
  totalLiabilities?: number;
  totalEquity?: number;
  totalDebt?: number;
  cashAndEquivalents?: number;
  inventory?: number;
  receivables?: number;
  fixedAssets?: number;
  currentAssets?: number;
  currentLiabilities?: number;
  workingCapital?: number;
  bookValuePerShare?: number;
}

export interface CashFlowRow {
  period: string;
  endDate: string;
  operatingCashFlow?: number;   // ₹ crore
  investingCashFlow?: number;
  financingCashFlow?: number;
  capex?: number;
  freeCashFlow?: number;
  netChangeInCash?: number;
  dividendsPaid?: number;
}

export interface KeyRatio {
  period: string;
  endDate: string;
  currentRatio?: number;
  quickRatio?: number;
  debtToEquity?: number;
  roe?: number;        // %
  roa?: number;        // %
  roce?: number;       // %
  assetTurnover?: number;
  interestCoverage?: number;
  netMargin?: number;  // %
  operatingMargin?: number; // %
}

export interface InstitutionalHolder { name: string; percentHeld: number; valueCr?: number; reportDate?: string; }
export interface ShareholdingBreakdown {
  insidersPct?: number;       // % held by insiders / promoters proxy
  institutionsPct?: number;   // % held by institutions (FII+DII proxy)
  publicPct?: number;
  topInstitutions: InstitutionalHolder[];
  topInsiders: InstitutionalHolder[];
}

export interface StockStatements {
  annualPL: AnnualPLRow[];
  quarterlyPL: QuarterlyPLRow[];
  balanceSheet: BalanceSheetRow[];
  cashFlow: CashFlowRow[];
  ratios: KeyRatio[];
  shareholding: ShareholdingBreakdown;
}

const STMT_TTL = 6 * 60 * 60 * 1000; // 6h
const stmtCache = new Map<string, { ts: number; data: StockStatements | null }>();

const TO_CR = (n?: number) => (n != null && Number.isFinite(n) ? +(n / 1e7).toFixed(2) : undefined);
const PCT = (n?: number) => (n != null && Number.isFinite(n) ? +(n * 100).toFixed(2) : undefined);
const N = (n?: number) => (n != null && Number.isFinite(n) ? +n.toFixed(2) : undefined);
const fyLabel = (d: Date) => `FY${(d.getMonth() >= 3 ? d.getFullYear() + 1 : d.getFullYear()).toString().slice(-2)}`;
const qLabel = (d: Date) => {
  // Indian fiscal year (Apr-Mar): Q1=Apr-Jun, Q2=Jul-Sep, Q3=Oct-Dec, Q4=Jan-Mar
  const m = d.getMonth();
  const fy = (m >= 3 ? d.getFullYear() + 1 : d.getFullYear()).toString().slice(-2);
  const q = m >= 3 && m <= 5 ? "Q1" : m >= 6 && m <= 8 ? "Q2" : m >= 9 && m <= 11 ? "Q3" : "Q4";
  return `${q} FY${fy}`;
};
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

interface YfStmtRow { endDate?: Date | string; [k: string]: unknown }
const dateOf = (r: YfStmtRow): Date | null => {
  const v = r.endDate;
  if (!v) return null;
  const d = typeof v === "string" ? new Date(v) : v;
  return isNaN(+d) ? null : d;
};
const num = (r: YfStmtRow, k: string): number | undefined => {
  const v = r[k];
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && "raw" in (v as Record<string, unknown>)) {
    const raw = (v as { raw: unknown }).raw;
    return typeof raw === "number" ? raw : undefined;
  }
  return undefined;
};

export async function fetchStatements(symbol: string, exchange: "NS" | "BO" = "NS"): Promise<StockStatements | null> {
  const ticker = yahooTickerFor(symbol, exchange);
  const c = stmtCache.get(ticker);
  if (c && Date.now() - c.ts < STMT_TTL) return c.data;
  try {
    const r = await withTimeout("quoteSummary(statements)", YF_QUOTE_SUMMARY_TIMEOUT_MS, yf.quoteSummary(ticker, {
      modules: [
        "incomeStatementHistory", "incomeStatementHistoryQuarterly",
        "balanceSheetHistory", "balanceSheetHistoryQuarterly",
        "cashflowStatementHistory", "cashflowStatementHistoryQuarterly",
        "majorHoldersBreakdown", "institutionOwnership", "insiderHolders",
        "defaultKeyStatistics", "financialData",
      ] as never,
    }));

    const inc = ((r as Record<string, unknown>)["incomeStatementHistory"] as { incomeStatementHistory?: YfStmtRow[] })?.incomeStatementHistory ?? [];
    const incQ = ((r as Record<string, unknown>)["incomeStatementHistoryQuarterly"] as { incomeStatementHistory?: YfStmtRow[] })?.incomeStatementHistory ?? [];
    const bs = ((r as Record<string, unknown>)["balanceSheetHistory"] as { balanceSheetStatements?: YfStmtRow[] })?.balanceSheetStatements ?? [];
    const cf = ((r as Record<string, unknown>)["cashflowStatementHistory"] as { cashflowStatements?: YfStmtRow[] })?.cashflowStatements ?? [];
    const mhb = ((r as Record<string, unknown>)["majorHoldersBreakdown"] as Record<string, number | undefined>) ?? {};
    const inst = ((r as Record<string, unknown>)["institutionOwnership"] as { ownershipList?: YfStmtRow[] })?.ownershipList ?? [];
    const insid = ((r as Record<string, unknown>)["insiderHolders"] as { holders?: YfStmtRow[] })?.holders ?? [];
    const ks = ((r as Record<string, unknown>)["defaultKeyStatistics"] as Record<string, number | undefined>) ?? {};
    const fd = ((r as Record<string, unknown>)["financialData"] as Record<string, number | undefined>) ?? {};

    const mapPL = (rows: YfStmtRow[], labeler: (d: Date) => string): AnnualPLRow[] => rows
      .map(row => {
        const d = dateOf(row); if (!d) return null;
        const revenue = TO_CR(num(row, "totalRevenue"));
        const ebit = TO_CR(num(row, "operatingIncome") ?? num(row, "ebit"));
        const ebitda = TO_CR(num(row, "ebitda"));
        const cor = TO_CR(num(row, "costOfRevenue"));
        const gp = TO_CR(num(row, "grossProfit"));
        const np = TO_CR(num(row, "netIncome"));
        const interest = TO_CR(num(row, "interestExpense"));
        const tax = TO_CR(num(row, "incomeTaxExpense"));
        const opMargin = revenue && ebit != null ? +(ebit / revenue * 100).toFixed(2) : undefined;
        const netMargin = revenue && np != null ? +(np / revenue * 100).toFixed(2) : undefined;
        const eps = N(num(row, "eps") ?? num(row, "basicEps"));
        return {
          period: labeler(d), endDate: isoDate(d),
          revenue, costOfRevenue: cor, grossProfit: gp, ebitda, ebit,
          interestExpense: interest, netProfit: np, eps, taxProvision: tax,
          operatingMargin: opMargin, netMargin,
        } as AnnualPLRow;
      })
      .filter((x): x is AnnualPLRow => x != null)
      .sort((a, b) => a.endDate.localeCompare(b.endDate));

    const mapBS = (rows: YfStmtRow[]): BalanceSheetRow[] => rows
      .map(row => {
        const d = dateOf(row); if (!d) return null;
        const ta = TO_CR(num(row, "totalAssets"));
        const tl = TO_CR(num(row, "totalLiab") ?? num(row, "totalLiabilitiesNetMinorityInterest"));
        const te = TO_CR(num(row, "totalStockholderEquity") ?? num(row, "stockholdersEquity"));
        const td = TO_CR(num(row, "totalDebt") ?? ((num(row, "shortLongTermDebt") ?? 0) + (num(row, "longTermDebt") ?? 0)));
        const cash = TO_CR(num(row, "cash") ?? num(row, "cashAndCashEquivalents"));
        const inv = TO_CR(num(row, "inventory"));
        const recv = TO_CR(num(row, "netReceivables"));
        const fx = TO_CR(num(row, "propertyPlantEquipment"));
        const ca = TO_CR(num(row, "totalCurrentAssets"));
        const cl = TO_CR(num(row, "totalCurrentLiabilities"));
        const sh = num(row, "commonStockSharesOutstanding") ?? ks["sharesOutstanding"];
        const bv = te != null && sh ? +((te * 1e7) / sh).toFixed(2) : undefined;
        return {
          period: fyLabel(d), endDate: isoDate(d),
          totalAssets: ta, totalLiabilities: tl, totalEquity: te, totalDebt: td,
          cashAndEquivalents: cash, inventory: inv, receivables: recv, fixedAssets: fx,
          currentAssets: ca, currentLiabilities: cl,
          workingCapital: ca != null && cl != null ? +(ca - cl).toFixed(2) : undefined,
          bookValuePerShare: bv,
        } as BalanceSheetRow;
      })
      .filter((x): x is BalanceSheetRow => x != null)
      .sort((a, b) => a.endDate.localeCompare(b.endDate));

    const mapCF = (rows: YfStmtRow[]): CashFlowRow[] => rows
      .map(row => {
        const d = dateOf(row); if (!d) return null;
        const op = TO_CR(num(row, "totalCashFromOperatingActivities") ?? num(row, "operatingCashflow"));
        const inv = TO_CR(num(row, "totalCashflowsFromInvestingActivities"));
        const fin = TO_CR(num(row, "totalCashFromFinancingActivities"));
        const capex = TO_CR(num(row, "capitalExpenditures"));
        const fcf = op != null && capex != null ? +(op + capex).toFixed(2) : undefined; // capex is negative
        const div = TO_CR(num(row, "dividendsPaid"));
        const net = TO_CR(num(row, "changeInCash"));
        return {
          period: fyLabel(d), endDate: isoDate(d),
          operatingCashFlow: op, investingCashFlow: inv, financingCashFlow: fin,
          capex, freeCashFlow: fcf, netChangeInCash: net, dividendsPaid: div,
        } as CashFlowRow;
      })
      .filter((x): x is CashFlowRow => x != null)
      .sort((a, b) => a.endDate.localeCompare(b.endDate));

    const annualPL = mapPL(inc, fyLabel);
    const quarterlyPL = mapPL(incQ, qLabel);
    const balanceSheet = mapBS(bs);
    const cashFlow = mapCF(cf);

    // Build derived ratios per balance-sheet period (joining with same-period P&L)
    const ratios: KeyRatio[] = balanceSheet.map(b => {
      const pl = annualPL.find(p => p.endDate === b.endDate);
      const cur = b.currentAssets != null && b.currentLiabilities ? +(b.currentAssets / b.currentLiabilities).toFixed(2) : undefined;
      const quick = b.currentLiabilities && b.currentAssets != null && b.inventory != null
        ? +((b.currentAssets - b.inventory) / b.currentLiabilities).toFixed(2) : undefined;
      const de = b.totalEquity ? +((b.totalDebt ?? 0) / b.totalEquity).toFixed(2) : undefined;
      const roe = pl?.netProfit != null && b.totalEquity ? +(pl.netProfit / b.totalEquity * 100).toFixed(2) : undefined;
      const roa = pl?.netProfit != null && b.totalAssets ? +(pl.netProfit / b.totalAssets * 100).toFixed(2) : undefined;
      const capEmp = (b.totalEquity ?? 0) + (b.totalDebt ?? 0);
      const roce = pl?.ebit != null && capEmp ? +(pl.ebit / capEmp * 100).toFixed(2) : undefined;
      const at = pl?.revenue != null && b.totalAssets ? +(pl.revenue / b.totalAssets).toFixed(2) : undefined;
      const intCov = pl?.ebit != null && pl?.interestExpense ? +(pl.ebit / Math.abs(pl.interestExpense)).toFixed(2) : undefined;
      return {
        period: b.period, endDate: b.endDate,
        currentRatio: cur, quickRatio: quick, debtToEquity: de,
        roe, roa, roce, assetTurnover: at, interestCoverage: intCov,
        netMargin: pl?.netMargin, operatingMargin: pl?.operatingMargin,
      };
    });

    const insidersPct = PCT(mhb["insidersPercentHeld"]);
    const institutionsPct = PCT(mhb["institutionsPercentHeld"]);
    const publicPct = insidersPct != null && institutionsPct != null
      ? +(100 - insidersPct - institutionsPct).toFixed(2) : undefined;

    const topInstitutions: InstitutionalHolder[] = inst.slice(0, 10).map(h => ({
      name: String(h["organization"] ?? ""),
      percentHeld: +((num(h, "pctHeld") ?? 0) * 100).toFixed(2),
      valueCr: TO_CR(num(h, "value")),
      reportDate: dateOf(h)?.toISOString().slice(0, 10),
    }));
    const topInsiders: InstitutionalHolder[] = insid.slice(0, 10).map(h => ({
      name: String(h["name"] ?? ""),
      percentHeld: +((num(h, "positionDirectPercent") ?? 0) * 100).toFixed(2),
      valueCr: undefined,
      reportDate: dateOf(h)?.toISOString().slice(0, 10),
    }));

    const data: StockStatements = {
      annualPL, quarterlyPL, balanceSheet, cashFlow, ratios,
      shareholding: { insidersPct, institutionsPct, publicPct, topInstitutions, topInsiders },
    };

    // Note: enrich balance sheet ROE etc with KS fallback if available
    if (data.ratios.length > 0 && data.ratios[data.ratios.length - 1]!.roe == null && fd["returnOnEquity"] != null) {
      data.ratios[data.ratios.length - 1]!.roe = +(fd["returnOnEquity"]! * 100).toFixed(2);
    }

    stmtCache.set(ticker, { ts: Date.now(), data });
    return data;
  } catch (err) {
    logger.warn({ err: (err as Error).message, ticker }, "Yahoo statements failed");
    stmtCache.set(ticker, { ts: Date.now(), data: null });
    return null;
  }
}

export async function fetchFundamentals(symbol: string, exchange: "NS" | "BO" = "NS"): Promise<YahooFundamentals | null> {
  const ticker = yahooTickerFor(symbol, exchange);
  const c = fundCache.get(ticker);
  if (c && Date.now() - c.ts < FUND_TTL) return c.data;
  try {
    const r = await withTimeout("quoteSummary(fundamentals)", YF_QUOTE_SUMMARY_TIMEOUT_MS, yf.quoteSummary(ticker, {
      modules: ["price", "summaryDetail", "defaultKeyStatistics", "financialData"] as never,
    }));
    const price = (r as { price?: { marketCap?: number; sharesOutstanding?: number } }).price ?? {};
    const sd = (r as { summaryDetail?: Record<string, number | undefined> }).summaryDetail ?? {};
    const ks = (r as { defaultKeyStatistics?: Record<string, number | undefined> }).defaultKeyStatistics ?? {};
    const fd = (r as { financialData?: Record<string, number | undefined> }).financialData ?? {};
    const data: YahooFundamentals = {
      marketCapCr: price.marketCap != null ? +(price.marketCap / 1e7).toFixed(2) : undefined,
      peRatio: sd["trailingPE"] != null ? +sd["trailingPE"].toFixed(2) : undefined,
      forwardPe: sd["forwardPE"] != null ? +sd["forwardPE"].toFixed(2) : undefined,
      pbRatio: ks["priceToBook"] != null ? +ks["priceToBook"].toFixed(2) : undefined,
      eps: ks["trailingEps"] != null ? +ks["trailingEps"].toFixed(2) : undefined,
      bookValue: ks["bookValue"] != null ? +ks["bookValue"].toFixed(2) : undefined,
      dividendYield: sd["dividendYield"] != null ? +(sd["dividendYield"] * 100).toFixed(2) : undefined,
      beta: ks["beta"] != null ? +ks["beta"].toFixed(2) : undefined,
      roe: fd["returnOnEquity"] != null ? +(fd["returnOnEquity"] * 100).toFixed(2) : undefined,
      debtToEquity: fd["debtToEquity"] != null ? +fd["debtToEquity"].toFixed(2) : undefined,
      profitMargin: fd["profitMargins"] != null ? +(fd["profitMargins"] * 100).toFixed(2) : undefined,
      operatingMargin: fd["operatingMargins"] != null ? +(fd["operatingMargins"] * 100).toFixed(2) : undefined,
      sharesOutstandingCr: price.sharesOutstanding != null ? +(price.sharesOutstanding / 1e7).toFixed(2) : undefined,
      fiftyDayAverage: sd["fiftyDayAverage"] != null ? +sd["fiftyDayAverage"].toFixed(2) : undefined,
      twoHundredDayAverage: sd["twoHundredDayAverage"] != null ? +sd["twoHundredDayAverage"].toFixed(2) : undefined,
      revenueGrowthYoy: fd["revenueGrowth"] != null ? +(fd["revenueGrowth"] * 100).toFixed(2) : undefined,
      earningsGrowthYoy: fd["earningsGrowth"] != null ? +(fd["earningsGrowth"] * 100).toFixed(2) : undefined,
      priceToSales: sd["priceToSalesTrailing12Months"] != null ? +sd["priceToSalesTrailing12Months"].toFixed(2) : undefined,
    };
    fundCache.set(ticker, { ts: Date.now(), data });
    return data;
  } catch (err) {
    logger.warn({ err: (err as Error).message, ticker }, "Yahoo fundamentals failed");
    fundCache.set(ticker, { ts: Date.now(), data: null });
    return null;
  }
}
