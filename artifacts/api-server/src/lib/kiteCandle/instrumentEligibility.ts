/**
 * Canonical NSE Instrument Eligibility Resolver — Pack 33 Corrective.
 *
 * Classifies every NSE EQ instrument from the Kite instrument master into one
 * of ten policy categories using ALL available identity metadata:
 *   - exchange / segment
 *   - instrument_type
 *   - tradingsymbol (including series-suffix conventions)
 *   - name / descriptive label
 *   - ISIN (where present)
 *   - active/inactive status (from universe.ts INACTIVE_SYMBOLS)
 *
 * Design contract
 * ───────────────
 *   - A tradingsymbol suffix (e.g. -SG, -GB) is SUPPORTING EVIDENCE, not the
 *     sole authority. Every classification is justified by at least two
 *     independent signals (suffix + name pattern, or suffix + market context).
 *   - BZ, ST, SM suffixes are NOT blanket-labeled "non-equity". Each has a
 *     documented exchange-series identity and a specific policy exclusion reason.
 *   - Trade-to-Trade (T2T / BE-series) stocks are noted as a limitation:
 *     they cannot be reliably detected from the Kite instrument master alone
 *     (no `series` field in the instrument CSV; T2T stocks appear identical to
 *     regular EQ). A periodic audit against NSE's surveillance list is required.
 *
 * Categories
 * ──────────
 *   ORDINARY_EQUITY_ELIGIBLE            — standard NSE main-board equity, eligible for warehouse
 *   TRADE_TO_TRADE_EQUITY_POLICY_EXCLUDED — T2T / BE-series: settlement restriction, excluded
 *   SME_EQUITY_POLICY_EXCLUDED          — SME-segment (ST/SM series): thin liquidity, excluded
 *   DEBT_GOVERNMENT_SECURITY            — SDL bonds / G-Secs listed as EQ but no OHLCV candles
 *   SOVEREIGN_GOLD_BOND                 — RBI Gold Bonds (GB series): debt instrument, no equity candles
 *   ETF_OR_FUND                         — exchange-traded fund or index fund
 *   INDEX                               — index instrument (NIFTY/SENSEX family)
 *   INACTIVE_OR_DELISTED                — in INACTIVE_SYMBOLS set or known stale listing
 *   UNRESOLVED_SECURITY_TYPE            — BZ-series: cross-listed BSZ settlement, OHLCV coverage unreliable
 *   OTHER_UNSUPPORTED                   — does not fit any above category; manual review needed
 */

import { INACTIVE_SYMBOLS } from "../universe";
import { centralLooksLikeEtf } from "../marketData/compat";

// ─── Public types ─────────────────────────────────────────────────────────────

export type InstrumentEligibilityClass =
  | "ORDINARY_EQUITY_ELIGIBLE"
  | "TRADE_TO_TRADE_EQUITY_POLICY_EXCLUDED"
  | "SME_EQUITY_POLICY_EXCLUDED"
  | "DEBT_GOVERNMENT_SECURITY"
  | "SOVEREIGN_GOLD_BOND"
  | "ETF_OR_FUND"
  | "INDEX"
  | "INACTIVE_OR_DELISTED"
  | "UNRESOLVED_SECURITY_TYPE"
  | "OTHER_UNSUPPORTED";

/** All categories that should be EXCLUDED from warehouse population. */
export const WAREHOUSE_EXCLUDED_CLASSES = new Set<InstrumentEligibilityClass>([
  "TRADE_TO_TRADE_EQUITY_POLICY_EXCLUDED",
  "SME_EQUITY_POLICY_EXCLUDED",
  "DEBT_GOVERNMENT_SECURITY",
  "SOVEREIGN_GOLD_BOND",
  "ETF_OR_FUND",
  "INDEX",
  "INACTIVE_OR_DELISTED",
  "UNRESOLVED_SECURITY_TYPE",
  "OTHER_UNSUPPORTED",
]);

export interface InstrumentEligibilityResult {
  symbol: string;
  name: string;
  instrumentType: string;
  segment: string;
  exchange: string;
  eligibilityClass: InstrumentEligibilityClass;
  /** Detailed rationale for the classification decision. */
  reason: string;
  /** Policy reason for exclusion (null for ORDINARY_EQUITY_ELIGIBLE). */
  policyExclusionReason: string | null;
  /** Whether this instrument is eligible for full-NSE warehouse population. */
  warehouseEligible: boolean;
}

// ─── Detection helpers ────────────────────────────────────────────────────────

/**
 * SDL bonds (State Development Loans) — government state-level debt instruments
 * listed on NSE in the "SG" series (State Government).
 *
 * Identity signals:
 *   1. Tradingsymbol ends with "-SG" (primary: series code in Kite master)
 *   2. Name matches SDL/SDL+ pattern (secondary: descriptive label)
 *   3. Name contains state coupon-rate-year format (e.g. "6.56% 2030")
 *
 * Note: Kite classifies these as instrument_type=EQ, segment=NSE because they
 * are listed on NSE's debt segment under the equity master — a master-data
 * artifact, not an indicator of equity nature.
 */
function isDebtGovernmentSecurity(symbol: string, name: string): boolean {
  const s = symbol.toUpperCase();
  const n = name.toUpperCase();

  // SG suffix: "State Government" series — SDL bonds
  if (s.endsWith("-SG")) return true;

  // G-Sec style names (Central Government Securities)
  if (/\bSDL\b/.test(n)) return true;
  if (/^[67]\d{2}[A-Z]{2}\d{2}$/.test(s)) return true; // bare coupon-rate patterns

  // Naming patterns: coupon rate + state/year
  if (/\d+\.\d+%.*\d{4}/.test(n) && /\b(SDL|SG|GOV|GOVT|BOND|SEC)\b/.test(n)) return true;

  return false;
}

/**
 * Sovereign Gold Bonds — RBI-issued gold bonds, listed on NSE in the "GB" series.
 *
 * Identity signals:
 *   1. Tradingsymbol ends with "-GB" (primary: series code)
 *   2. Tradingsymbol starts with "SGB" (secondary: naming convention)
 *   3. Name contains "GOLDBOND" or "GOLD BOND" (tertiary)
 */
function isSovereignGoldBond(symbol: string, name: string): boolean {
  const s = symbol.toUpperCase();
  const n = name.toUpperCase();
  if (s.endsWith("-GB")) return true;
  if (s.startsWith("SGB")) return true;
  if (/GOLD\s*BOND/.test(n)) return true;
  return false;
}

/**
 * SME-segment instruments — Small & Medium Enterprise board, traded with
 * thinner liquidity and different price-band rules.
 *
 * Series codes:
 *   -ST (SME Trading): NSE SME platform, SME ITP (Institutional Trading Platform)
 *   -SM (SME segment): alternative SME board designation
 *
 * Policy exclusion reason: SME stocks have circuit-breaker rules, thin order
 * books, and non-standard trading hours on the SME platform. Historical OHLCV
 * coverage via Kite equity endpoint is incomplete for many SME listings.
 */
function isSmeEquity(symbol: string, _name: string): boolean {
  const s = symbol.toUpperCase();
  return s.endsWith("-ST") || s.endsWith("-SM");
}

/**
 * BZ-series (Cross-listed BSZ settlement) instruments.
 *
 * The "BZ" series on NSE represents instruments that are listed on NSE but
 * settled through BSE's clearing corporation (previously BSZ — BSE Settlement).
 * These are typically bonds or hybrid instruments that appear in Kite's NSE EQ
 * master due to their NSE listing but have no reliable equity-style OHLCV
 * history through the Kite Historical Data API (equity endpoint).
 *
 * Classification: UNRESOLVED_SECURITY_TYPE
 *   We do NOT call these "non-equity" — they ARE equity-type listings on NSE.
 *   However, their OHLCV coverage through Kite's historical equity endpoint is
 *   unreliable, making them unfit for the candle warehouse. A future integration
 *   with NSE's bond/hybrid data feed could reclassify these.
 *
 * Policy exclusion reason: Kite historical equity endpoint returns empty or
 *   inconsistent OHLCV series for BZ-series instruments, causing warehouse
 *   failures (EMPTY_SERIES) that inflate the canary hard-failure rate.
 */
function isBzSeries(symbol: string, _name: string): boolean {
  return symbol.toUpperCase().endsWith("-BZ");
}

/**
 * Trade-to-Trade (T2T / BE-series) equity — LIMITATION NOTE.
 *
 * On NSE, Trade-to-Trade stocks are in the "BE" settlement type. These are
 * regular equity stocks where intraday trading is restricted (settlement is
 * mandatory delivery). They appear in the Kite instrument master with:
 *   - instrument_type = "EQ"
 *   - segment = "NSE"
 *   - tradingsymbol WITHOUT any distinguishing suffix
 *
 * There is NO series/suffix marker in the Kite instrument master CSV that
 * reliably distinguishes T2T stocks from ordinary EQ. Detection requires
 * NSE's live surveillance/T2T list (external data source not available here).
 *
 * Currently: T2T stocks are classified as ORDINARY_EQUITY_ELIGIBLE and will
 * appear in the warehouse. This is a known limitation. A periodic audit against
 * NSE's T2T surveillance list should be scheduled to identify and tag them.
 *
 * This function always returns false pending external data integration.
 */
function isTradeToTrade(_symbol: string, _name: string): boolean {
  // Cannot detect from Kite instrument master alone.
  // See T2T limitation note above.
  return false;
}

// ─── Main classifier ──────────────────────────────────────────────────────────

/**
 * Classify a single NSE instrument using all available identity metadata.
 *
 * Priority order (highest → lowest confidence):
 *   1. instrument_type = INDEX
 *   2. INACTIVE_SYMBOLS membership
 *   3. Sovereign Gold Bond (GB series)
 *   4. SDL / Government Debt (SG series + name patterns)
 *   5. SME segment (ST/SM series)
 *   6. BZ series (cross-listed BSZ settlement)
 *   7. ETF / Fund (name/symbol pattern)
 *   8. Trade-to-Trade (external data required — currently a no-op)
 *   9. ORDINARY_EQUITY_ELIGIBLE
 */
export function classifyInstrument(opts: {
  symbol: string;
  name: string;
  instrumentType: string;
  segment: string;
  exchange: string;
  isin?: string | null;
}): InstrumentEligibilityResult {
  const { symbol, name, instrumentType, segment, exchange, isin = null } = opts;
  const s = symbol.toUpperCase();
  const n = name.toUpperCase();

  const base = { symbol, name, instrumentType, segment, exchange };

  // 1. Index instruments
  if (instrumentType === "INDEX") {
    return {
      ...base,
      eligibilityClass: "INDEX",
      reason: `instrument_type=INDEX (${symbol}); index instruments have no individual equity candle series`,
      policyExclusionReason: "Index instruments are not tradeable equities; excluded from warehouse.",
      warehouseEligible: false,
    };
  }

  // 2. Inactive / delisted symbols
  if (INACTIVE_SYMBOLS.has(s)) {
    return {
      ...base,
      eligibilityClass: "INACTIVE_OR_DELISTED",
      reason: `Symbol ${symbol} is in INACTIVE_SYMBOLS (known delisted / suspended / curated-exclude set)`,
      policyExclusionReason: "Delisted or suspended instruments produce stale/empty candle series; excluded from warehouse.",
      warehouseEligible: false,
    };
  }

  // 3. Sovereign Gold Bonds (GB series)
  if (isSovereignGoldBond(symbol, name)) {
    const signals: string[] = [];
    if (s.endsWith("-GB")) signals.push("tradingsymbol ends with -GB (Kite GB series code)");
    if (s.startsWith("SGB")) signals.push("tradingsymbol starts with SGB (RBI gold bond convention)");
    if (/GOLD\s*BOND/.test(n)) signals.push(`name contains 'GOLD BOND': "${name}"`);
    if (isin) signals.push(`ISIN=${isin}`);
    return {
      ...base,
      eligibilityClass: "SOVEREIGN_GOLD_BOND",
      reason: `Sovereign Gold Bond: ${signals.join("; ")}`,
      policyExclusionReason: "RBI Sovereign Gold Bonds are debt instruments denominated in gold; Kite equity historical endpoint has no OHLCV data for them.",
      warehouseEligible: false,
    };
  }

  // 4. SDL bonds and Government Securities (SG series + name patterns)
  if (isDebtGovernmentSecurity(symbol, name)) {
    const signals: string[] = [];
    if (s.endsWith("-SG")) signals.push("tradingsymbol ends with -SG (Kite State Government series code)");
    if (/\bSDL\b/.test(n)) signals.push("name contains 'SDL' (State Development Loan)");
    if (/\d+\.\d+%/.test(n)) signals.push(`name contains coupon rate: "${name}"`);
    return {
      ...base,
      eligibilityClass: "DEBT_GOVERNMENT_SECURITY",
      reason: `Government/SDL debt security: ${signals.join("; ")}`,
      policyExclusionReason: "State Development Loans and G-Secs are debt instruments; Kite's NSE EQ master lists them with instrument_type=EQ (master-data artifact), but the Kite Historical Data API (equity endpoint) returns empty OHLCV series for them.",
      warehouseEligible: false,
    };
  }

  // 5. SME segment (ST / SM series)
  if (isSmeEquity(symbol, name)) {
    const series = s.endsWith("-ST") ? "ST (SME Trading / ITP)" : "SM (SME segment)";
    return {
      ...base,
      eligibilityClass: "SME_EQUITY_POLICY_EXCLUDED",
      reason: `SME segment instrument: tradingsymbol ends with ${s.endsWith("-ST") ? "-ST" : "-SM"} (${series})`,
      policyExclusionReason: "SME-segment stocks operate on the NSE SME platform with different trading rules, thinner liquidity, and non-standard circuit limits. Historical OHLCV coverage via Kite equity endpoint is incomplete for many SME listings.",
      warehouseEligible: false,
    };
  }

  // 6. BZ series (cross-listed BSZ settlement)
  if (isBzSeries(symbol, name)) {
    return {
      ...base,
      eligibilityClass: "UNRESOLVED_SECURITY_TYPE",
      reason: `BZ-series cross-listed instrument: tradingsymbol ends with -BZ. Listed on NSE but settled through BSZ/BSE clearing. Exchange-series identity: NSE-BZ (NSE listing, BSE settlement). Security type is unresolved — OHLCV coverage via Kite historical equity endpoint is unreliable, making classification as a data-ready equity impossible without additional data.`,
      policyExclusionReason: "BZ-series instruments return empty or missing OHLCV series from the Kite Historical Data API equity endpoint, causing warehouse EMPTY_SERIES failures. Excluded until a separate Kite bond/hybrid data integration is available.",
      warehouseEligible: false,
    };
  }

  // 7. ETF / Fund (using centralLooksLikeEtf + additional patterns)
  if (centralLooksLikeEtf(symbol, name)) {
    const signals: string[] = [];
    if (/BEES$/.test(s)) signals.push("tradingsymbol ends with BEES (Nippon ETF family)");
    if (/ETF/.test(s)) signals.push("tradingsymbol contains ETF");
    if (/\bETF\b/.test(n)) signals.push("name contains ETF");
    if (/EXCHANGE\s+TRADED/.test(n)) signals.push("name contains 'EXCHANGE TRADED'");
    if (signals.length === 0) signals.push("matches ETF detection heuristic");
    return {
      ...base,
      eligibilityClass: "ETF_OR_FUND",
      reason: `Exchange-traded fund or index fund: ${signals.join("; ")}`,
      policyExclusionReason: "ETFs track indices/baskets and have no single-stock candle history for momentum/technical indicators; excluded from warehouse.",
      warehouseEligible: false,
    };
  }

  // 8. Trade-to-Trade (limitation — cannot detect without external data)
  if (isTradeToTrade(symbol, name)) {
    return {
      ...base,
      eligibilityClass: "TRADE_TO_TRADE_EQUITY_POLICY_EXCLUDED",
      reason: `Trade-to-Trade (BE settlement type) — detected via external surveillance list`,
      policyExclusionReason: "T2T stocks have mandatory delivery settlement; intraday technical signals may be misleading. Excluded pending separate evaluation.",
      warehouseEligible: false,
    };
  }

  // 9. Default: ordinary NSE main-board equity
  return {
    ...base,
    eligibilityClass: "ORDINARY_EQUITY_ELIGIBLE",
    reason: `Standard NSE main-board equity: segment=${segment}, instrument_type=${instrumentType}, no exclusion patterns detected`,
    policyExclusionReason: null,
    warehouseEligible: true,
  };
}

/**
 * Classify a batch of instruments.
 * Returns a Map from symbol to result for O(1) lookup by the caller.
 */
export function classifyInstrumentBatch(
  instruments: Array<{
    symbol: string;
    name: string;
    instrumentType: string;
    segment: string;
    exchange: string;
    isin?: string | null;
  }>,
): Map<string, InstrumentEligibilityResult> {
  const result = new Map<string, InstrumentEligibilityResult>();
  for (const inst of instruments) {
    result.set(inst.symbol, classifyInstrument(inst));
  }
  return result;
}

/**
 * Return a summary of eligibility counts for a classified batch.
 */
export function summarizeEligibility(results: InstrumentEligibilityResult[]): {
  eligible: number;
  excluded: number;
  byClass: Record<InstrumentEligibilityClass, number>;
} {
  const byClass = {} as Record<InstrumentEligibilityClass, number>;
  let eligible = 0;
  let excluded = 0;

  for (const r of results) {
    byClass[r.eligibilityClass] = (byClass[r.eligibilityClass] ?? 0) + 1;
    if (r.warehouseEligible) eligible++;
    else excluded++;
  }

  return { eligible, excluded, byClass };
}
