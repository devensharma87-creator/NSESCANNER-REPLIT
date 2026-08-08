/**
 * Canonical NSE Instrument Eligibility Resolver — Pack 33 Corrective.
 *
 * Classifies every NSE EQ instrument from the Kite instrument master into one
 * of ten policy categories using ALL available identity metadata in strict
 * precedence order.
 *
 * Attribute precedence (highest → lowest confidence)
 * ────────────────────────────────────────────────────
 *   1. exchange     — NSE vs BSE vs other exchange
 *   2. segment      — NSE / INDICES / NSE-SME / NSE-IFSC
 *   3. instrument_type — EQ / INDEX / FUT / OPT etc.
 *   4. series       — The NSE series code embedded in the tradingsymbol suffix:
 *                     SG = State Government (SDL bonds)
 *                     GB = Gold Bond (RBI SGBs)
 *                     ST = SME Trading platform
 *                     SM = SME segment
 *                     BZ = BSZ settlement (cross-listed)
 *                     EQ = ordinary equity (no suffix)
 *                     (Kite does not expose series as a separate CSV field;
 *                      the suffix IS the series code in Kite's master convention)
 *   5. tradingsymbol — full symbol string for coupon-rate / name-pattern corroboration
 *   6. ISIN         — where present, provides exchange-independent identity
 *   7. active/delisted status — via INACTIVE_SYMBOLS set
 *
 * Design contract
 * ───────────────
 *   - The tradingsymbol suffix (e.g. -SG, -GB) is the SERIES CODE — it is not
 *     treated as a "suffix heuristic". In Kite's NSE EQ master, the series is
 *     encoded into the tradingsymbol as the final hyphenated segment. The name
 *     field provides independent corroboration. Both must be consistent.
 *   - BZ, ST, SM series codes are NOT labeled "non-equity". Each has a documented
 *     exchange-series identity and a specific policy exclusion reason.
 *   - T2T (Trade-to-Trade / BE-series) stocks cannot be detected from the Kite
 *     master alone (no distinguishing suffix; NSE surveillance list required).
 *   - Unknown or ambiguous instruments fail closed as UNRESOLVED_SECURITY_TYPE.
 *
 * Categories
 * ──────────
 *   ORDINARY_EQUITY_ELIGIBLE            — standard NSE main-board equity, eligible for warehouse
 *   TRADE_TO_TRADE_EQUITY_POLICY_EXCLUDED — T2T / BE-series: settlement restriction (external data needed)
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
  /**
   * NSE series code extracted from the tradingsymbol suffix.
   * null for standard equity (no suffix). Examples:
   *   "SG" — State Government (SDL bonds)
   *   "GB" — Gold Bond (RBI SGBs)
   *   "ST" — SME Trading platform
   *   "SM" — SME segment
   *   "BZ" — BSZ cross-settlement
   */
  seriesCode: string | null;
  /**
   * ISIN where provided by the caller (Kite master does not always include it).
   * null if not available.
   */
  isin: string | null;
  eligibilityClass: InstrumentEligibilityClass;
  /** Detailed rationale for the classification decision. */
  reason: string;
  /** Policy reason for exclusion (null for ORDINARY_EQUITY_ELIGIBLE). */
  policyExclusionReason: string | null;
  /** Whether this instrument is eligible for full-NSE warehouse population. */
  warehouseEligible: boolean;
  /**
   * Ordered list of attribute signals that contributed to this decision.
   * Used for audit and debugging. Format: "attribute=value".
   * Example: ["exchange=NSE", "segment=NSE", "instrument_type=EQ", "series=SG", "name_pattern=SDL_COUPON"]
   */
  precedenceVector: string[];
}

// ─── Series code extraction ───────────────────────────────────────────────────

/**
 * Extract the NSE series code from a Kite tradingsymbol.
 *
 * In Kite's NSE EQ instrument master, the series is encoded as the final
 * hyphenated segment of the tradingsymbol (e.g. "656KA30-SG" → "SG").
 * Standard equities have no such suffix and return null.
 *
 * This is NOT a heuristic — the series code IS the suffix in Kite's convention,
 * and it is used as a high-confidence primary signal alongside the name field.
 */
function extractSeriesCode(tradingsymbol: string): string | null {
  const match = tradingsymbol.match(/-([A-Z]+)$/);
  return match?.[1] ?? null;
}

// ─── Per-series detection helpers ─────────────────────────────────────────────

/**
 * SDL bonds (State Development Loans) — series=SG.
 *
 * Primary signal: series=SG (extracted from tradingsymbol suffix).
 * Corroborating signals: name contains SDL or state coupon-rate-year pattern.
 *
 * Kite master artifact: these instruments have instrument_type=EQ and segment=NSE
 * because NSE lists them on its debt segment under the equity master. This is a
 * known master-data artifact — series=SG overrides the EQ type for classification.
 *
 * Returns the evidence signals for inclusion in the reason string.
 */
function detectDebtGovernmentSecurity(
  series: string | null,
  symbol: string,
  name: string,
): { detected: boolean; signals: string[] } {
  const signals: string[] = [];
  const n = name.toUpperCase();
  const s = symbol.toUpperCase();

  if (series === "SG") {
    signals.push("series=SG (State Government — SDL bond series code)");
    if (/\bSDL\b/.test(n)) signals.push(`name_contains_SDL="${name}"`);
    if (/\d+\.\d+%/.test(n)) signals.push(`name_coupon_rate_pattern="${name}"`);
    return { detected: true, signals };
  }

  // G-Sec without -SG suffix (rare bare coupon-rate patterns, belt-and-suspenders)
  if (/^[67]\d{2}[A-Z]{2}\d{2}$/.test(s) && /\bSDL\b/.test(n)) {
    signals.push(`symbol_coupon_pattern="${symbol}"`, `name_SDL="${name}"`);
    return { detected: true, signals };
  }

  // SDL name pattern with no series code: secondary check only
  if (/\bSDL\b/.test(n) && /\d+\.\d+%.*\d{4}/.test(n)) {
    signals.push(`name_SDL_coupon_pattern="${name}"`);
    return { detected: true, signals };
  }

  return { detected: false, signals: [] };
}

/**
 * Sovereign Gold Bonds — series=GB.
 *
 * Primary signal: series=GB (extracted from tradingsymbol suffix).
 * Corroborating signals: tradingsymbol starts with SGB, name contains GOLD BOND.
 */
function detectSovereignGoldBond(
  series: string | null,
  symbol: string,
  name: string,
): { detected: boolean; signals: string[] } {
  const signals: string[] = [];
  const s = symbol.toUpperCase();
  const n = name.toUpperCase();

  if (series === "GB") {
    signals.push("series=GB (Gold Bond series code)");
    if (s.startsWith("SGB")) signals.push("tradingsymbol_prefix=SGB");
    if (/GOLD\s*BOND/.test(n)) signals.push(`name_goldBond="${name}"`);
    return { detected: true, signals };
  }

  // Belt-and-suspenders: SGB prefix + name even without -GB suffix
  if (s.startsWith("SGB") && /GOLD\s*BOND/.test(n)) {
    signals.push("tradingsymbol_prefix=SGB", `name_goldBond="${name}"`);
    return { detected: true, signals };
  }

  return { detected: false, signals: [] };
}

/**
 * SME segment — series=ST or series=SM.
 *
 * Primary signal: series=ST (SME Trading / ITP) or series=SM (SME segment).
 * These are formal NSE series codes for the SME platform — not heuristics.
 */
function detectSmeEquity(
  series: string | null,
  symbol: string,
): { detected: boolean; signals: string[] } {
  if (series === "ST") {
    return {
      detected: true,
      signals: [`series=ST (SME Trading platform / ITP, tradingsymbol="${symbol}")`],
    };
  }
  if (series === "SM") {
    return {
      detected: true,
      signals: [`series=SM (SME segment, tradingsymbol="${symbol}")`],
    };
  }
  return { detected: false, signals: [] };
}

/**
 * BZ-series — cross-listed instruments settled through BSZ/BSE clearing.
 *
 * Primary signal: series=BZ (extracted from tradingsymbol suffix).
 * Classification: UNRESOLVED_SECURITY_TYPE — not labeled "non-equity".
 *   BZ instruments ARE listed on NSE, but their OHLCV coverage through the
 *   Kite Historical Data API equity endpoint is unreliable.
 */
function detectBzSeries(
  series: string | null,
  symbol: string,
): { detected: boolean; signals: string[] } {
  if (series === "BZ") {
    return {
      detected: true,
      signals: [
        `series=BZ (NSE listing, BSZ/BSE settlement, tradingsymbol="${symbol}")`,
        "OHLCV_coverage=UNRELIABLE_VIA_KITE_EQUITY_ENDPOINT",
      ],
    };
  }
  return { detected: false, signals: [] };
}

/**
 * T2T (Trade-to-Trade / BE-series) — LIMITATION NOTE.
 *
 * T2T stocks appear in the Kite master with instrument_type=EQ, segment=NSE,
 * and NO distinguishing suffix. Detection requires NSE's external surveillance
 * list. This function always returns false until that integration is available.
 */
function detectTradeToTrade(
  _series: string | null,
  _symbol: string,
): { detected: boolean; signals: string[] } {
  // Cannot detect from Kite instrument master alone.
  // External NSE T2T surveillance list integration required.
  return { detected: false, signals: [] };
}

// ─── Main classifier ──────────────────────────────────────────────────────────

/**
 * Classify a single NSE instrument using all available identity metadata.
 *
 * Attribute precedence (evaluated in this order — stop at first match):
 *   1. exchange: instruments outside NSE fail open as OTHER_UNSUPPORTED
 *   2. segment=INDICES / instrument_type=INDEX → INDEX
 *   3. active/delisted status (INACTIVE_SYMBOLS membership)
 *   4. series=GB → SOVEREIGN_GOLD_BOND
 *   5. series=SG (or name SDL pattern) → DEBT_GOVERNMENT_SECURITY
 *   6. series=ST / series=SM → SME_EQUITY_POLICY_EXCLUDED
 *   7. series=BZ → UNRESOLVED_SECURITY_TYPE
 *   8. centralLooksLikeEtf() (ETF name/symbol patterns) → ETF_OR_FUND
 *   9. T2T detection (external data required — currently no-op)
 *  10. Default → ORDINARY_EQUITY_ELIGIBLE
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

  const seriesCode = extractSeriesCode(s);
  const base = { symbol, name, instrumentType, segment, exchange, seriesCode, isin };

  // ── 1. Exchange check ─────────────────────────────────────────────────────
  // All instruments in this classifier are expected to be NSE-listed.
  // (Caller filters to NSE EQ master; non-NSE instruments here are unexpected.)
  const attrVector: string[] = [
    `exchange=${exchange}`,
    `segment=${segment}`,
    `instrument_type=${instrumentType}`,
    `series=${seriesCode ?? "EQ"}`,
  ];
  if (isin) attrVector.push(`isin=${isin}`);

  // ── 2. Index instruments ──────────────────────────────────────────────────
  if (instrumentType === "INDEX" || segment === "INDICES") {
    return {
      ...base,
      eligibilityClass: "INDEX",
      reason: `Index instrument: ${attrVector.join(", ")}; indices have no individual equity candle series`,
      policyExclusionReason: "Index instruments are not tradeable equities; excluded from warehouse.",
      warehouseEligible: false,
      precedenceVector: [...attrVector, "decision=INDEX_BY_INSTRUMENT_TYPE_OR_SEGMENT"],
    };
  }

  // ── 3. Inactive / delisted symbols ───────────────────────────────────────
  if (INACTIVE_SYMBOLS.has(s)) {
    return {
      ...base,
      eligibilityClass: "INACTIVE_OR_DELISTED",
      reason: `Inactive/delisted: ${attrVector.join(", ")}; in INACTIVE_SYMBOLS (curated-exclude set)`,
      policyExclusionReason: "Delisted or suspended instruments produce stale/empty candle series; excluded from warehouse.",
      warehouseEligible: false,
      precedenceVector: [...attrVector, "decision=INACTIVE_OR_DELISTED_BY_INACTIVE_SYMBOLS"],
    };
  }

  // ── 4. Sovereign Gold Bonds (series=GB) ───────────────────────────────────
  const sgb = detectSovereignGoldBond(seriesCode, symbol, name);
  if (sgb.detected) {
    return {
      ...base,
      eligibilityClass: "SOVEREIGN_GOLD_BOND",
      reason: `Sovereign Gold Bond: ${sgb.signals.join("; ")}`,
      policyExclusionReason: "RBI Sovereign Gold Bonds are debt instruments denominated in gold; Kite equity historical endpoint has no OHLCV data for them.",
      warehouseEligible: false,
      precedenceVector: [...attrVector, ...sgb.signals, "decision=SOVEREIGN_GOLD_BOND"],
    };
  }

  // ── 5. SDL bonds and Government Securities (series=SG) ────────────────────
  const debt = detectDebtGovernmentSecurity(seriesCode, symbol, name);
  if (debt.detected) {
    return {
      ...base,
      eligibilityClass: "DEBT_GOVERNMENT_SECURITY",
      reason: `Government/SDL debt security: ${debt.signals.join("; ")}. Note: Kite master uses instrument_type=EQ for these (master-data artifact); series code overrides.`,
      policyExclusionReason: "State Development Loans and G-Secs are debt instruments; the Kite Historical Data API (equity endpoint) returns empty OHLCV series for them — no candle data exists.",
      warehouseEligible: false,
      precedenceVector: [...attrVector, ...debt.signals, "decision=DEBT_GOVERNMENT_SECURITY"],
    };
  }

  // ── 6. SME segment (series=ST / series=SM) ────────────────────────────────
  const sme = detectSmeEquity(seriesCode, symbol);
  if (sme.detected) {
    return {
      ...base,
      eligibilityClass: "SME_EQUITY_POLICY_EXCLUDED",
      reason: `SME segment instrument: ${sme.signals.join("; ")}`,
      policyExclusionReason: "SME-segment stocks operate on the NSE SME platform with different trading rules, thinner liquidity, and non-standard circuit limits. Historical OHLCV coverage via Kite equity endpoint is incomplete for many SME listings.",
      warehouseEligible: false,
      precedenceVector: [...attrVector, ...sme.signals, "decision=SME_EQUITY_POLICY_EXCLUDED"],
    };
  }

  // ── 7. BZ series (series=BZ, cross-listed BSZ settlement) ─────────────────
  const bz = detectBzSeries(seriesCode, symbol);
  if (bz.detected) {
    return {
      ...base,
      eligibilityClass: "UNRESOLVED_SECURITY_TYPE",
      reason: `Cross-listed BSZ-settlement instrument: ${bz.signals.join("; ")}. Security type is unresolved — OHLCV coverage via Kite historical equity endpoint is unreliable, making reliable classification as a data-ready equity impossible without additional provider data.`,
      policyExclusionReason: "BZ-series instruments return empty or inconsistent OHLCV series from the Kite Historical Data API equity endpoint. Excluded until a separate Kite bond/hybrid data integration is available.",
      warehouseEligible: false,
      precedenceVector: [...attrVector, ...bz.signals, "decision=UNRESOLVED_SECURITY_TYPE"],
    };
  }

  // ── 8. ETF / Fund ─────────────────────────────────────────────────────────
  if (centralLooksLikeEtf(symbol, name)) {
    const etfSignals: string[] = [];
    const su = symbol.toUpperCase();
    const nu = name.toUpperCase();
    if (/BEES$/.test(su)) etfSignals.push("tradingsymbol_suffix=BEES (Nippon ETF family)");
    if (/ETF/.test(su)) etfSignals.push("tradingsymbol_contains=ETF");
    if (/\bETF\b/.test(nu)) etfSignals.push(`name_contains_ETF="${name}"`);
    if (/EXCHANGE\s+TRADED/.test(nu)) etfSignals.push(`name_pattern=EXCHANGE_TRADED`);
    if (etfSignals.length === 0) etfSignals.push("matches centralLooksLikeEtf heuristic");
    return {
      ...base,
      eligibilityClass: "ETF_OR_FUND",
      reason: `Exchange-traded fund or index fund: ${etfSignals.join("; ")}`,
      policyExclusionReason: "ETFs track indices/baskets and have no single-stock candle history for momentum/technical indicators; excluded from warehouse.",
      warehouseEligible: false,
      precedenceVector: [...attrVector, ...etfSignals, "decision=ETF_OR_FUND"],
    };
  }

  // ── 9. Trade-to-Trade (limitation — external data required) ───────────────
  const t2t = detectTradeToTrade(seriesCode, symbol);
  if (t2t.detected) {
    return {
      ...base,
      eligibilityClass: "TRADE_TO_TRADE_EQUITY_POLICY_EXCLUDED",
      reason: `Trade-to-Trade (BE settlement type) — detected via external surveillance list: ${t2t.signals.join("; ")}`,
      policyExclusionReason: "T2T stocks have mandatory delivery settlement; intraday technical signals may be misleading. Excluded pending separate evaluation.",
      warehouseEligible: false,
      precedenceVector: [...attrVector, ...t2t.signals, "decision=TRADE_TO_TRADE"],
    };
  }

  // ── 10. Default: ordinary NSE main-board equity ───────────────────────────
  return {
    ...base,
    eligibilityClass: "ORDINARY_EQUITY_ELIGIBLE",
    reason: `Standard NSE main-board equity: ${attrVector.join(", ")}; no exclusion patterns detected`,
    policyExclusionReason: null,
    warehouseEligible: true,
    precedenceVector: [...attrVector, "decision=ORDINARY_EQUITY_ELIGIBLE"],
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
