/**
 * Pack 5 23A — Stock fundamentals from IndianAPI reference data provider.
 * NOT for trading decisions. All fields nullable — nulls preserved, never fabricated.
 */

export interface StockProfile {
  companyName:  string | null;
  symbol:       string;
  isin:         string | null;
  sector:       string | null;
  industry:     string | null;
  /** Market capitalisation in INR. Null when unavailable. */
  marketCap:    number | null;
  currency:     string | null;
}

export interface StockRatios {
  symbol:        string;
  pe:            number | null;
  pb:            number | null;
  eps:           number | null;
  dividendYield: number | null;
  roe:           number | null;
  debtToEquity:  number | null;
  /** Reporting period context, e.g. "TTM". Null when unavailable. */
  period:        string | null;
}

export interface StockFundamentalsMeta {
  source:               string;
  trustTier:            string;
  asOf:                 string | null;
  fetchedAt:            string;
  notForSignals:        boolean;
  notForTradeDecisions: boolean;
  validationStatus:     string;
  warnings:             string[];
}

export interface StockFundamentals {
  ok:            boolean;
  symbol:        string;
  fetchedAt:     string;
  /** NOT_CONFIGURED | AVAILABLE | ERROR | RATE_LIMITED */
  providerState: string;
  /** Safe to show — never the key itself. */
  plan:          string | null;
  /** Null when provider not configured or fetch failed. */
  profile:       StockProfile | null;
  /** Null when provider not configured or fetch failed. */
  ratios:        StockRatios | null;
  warnings:      string[];
  meta:          StockFundamentalsMeta;
}
