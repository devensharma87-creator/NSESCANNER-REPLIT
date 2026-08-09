/**
 * Canonical NSE Instrument Eligibility Resolver — Pack 33 Corrective.
 *
 * Classifies NSE EQ instruments using ALL available identity metadata from the
 * Kite instrument master, in strict precedence order.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * FUNDAMENTAL DESIGN CONTRACT
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * 1. AUTHORITATIVE SOURCE REQUIREMENT
 *    An instrument must be present in the current Kite NSE EQ instrument master
 *    to receive any affirmative classification. Instruments not present in the
 *    master are classified UNRESOLVED_SECURITY_TYPE regardless of their symbol.
 *    The caller MUST pass `inCurrentMaster: true` only for instruments that
 *    appear in the master fetched from Kite today.
 *
 * 2. ORDINARY_EQUITY_ELIGIBLE REQUIRES AFFIRMATIVE EVIDENCE
 *    A positive eligibility verdict requires ALL of:
 *      a. inCurrentMaster = true
 *      b. exchange = NSE
 *      c. instrument_type = EQ (from the master record)
 *      d. segment = NSE (main-board, not INDICES/SME/IFSC)
 *      e. No exclusion pattern detected (see below)
 *    Missing or conflicting metadata MUST fail closed as UNRESOLVED_SECURITY_TYPE.
 *
 * 3. SYMBOL-SUFFIX IS SUPPORTING EVIDENCE, NOT AUTHORITY
 *    The tradingsymbol suffix (e.g. -SG, -GB, -ST, -BZ) appears in Kite's
 *    instrument master as part of the tradingsymbol field. It is extracted and
 *    used as a SUPPORTING SIGNAL for classification of instruments that ARE in
 *    the master — it is NOT independently authoritative and CANNOT classify an
 *    instrument absent from the master.
 *    Example: "OMFURN-ST" absent from the master → UNRESOLVED (not SME), because
 *    the master record is required to confirm the series/security type.
 *
 * 4. AUTHORITATIVE CLASSIFICATION PRECEDENCE (for instruments in master)
 *    evaluated in this order; stop at first match:
 *      1. inCurrentMaster = false          → UNRESOLVED_SECURITY_TYPE
 *      2. exchange ≠ NSE                   → OTHER_UNSUPPORTED
 *      3. instrument_type = INDEX OR segment = INDICES  → INDEX
 *      4. In INACTIVE_SYMBOLS set          → INACTIVE_OR_DELISTED
 *      5. tradingsymbol suffix = -GB (Sovereign Gold Bonds) → SOVEREIGN_GOLD_BOND
 *      6. tradingsymbol suffix = -SG (State Dev Loans)     → DEBT_GOVERNMENT_SECURITY
 *         OR name contains SDL coupon-rate pattern
 *      7. tradingsymbol suffix = -ST or -SM (SME segment)  → SME_EQUITY_POLICY_EXCLUDED
 *      8. tradingsymbol suffix = -BZ (cross-listed BSZ)    → UNRESOLVED_SECURITY_TYPE
 *      9. ETF/fund name/symbol pattern (centralLooksLikeEtf) → ETF_OR_FUND
 *     10. exchange=NSE + segment=NSE + instrument_type=EQ + no pattern → ORDINARY_EQUITY_ELIGIBLE
 *     11. All others                       → OTHER_UNSUPPORTED (fail closed)
 *
 * 5. T2T LIMITATION
 *    Trade-to-Trade (BE-series) stocks appear in the master with instrument_type=EQ
 *    and no distinguishing suffix. Detection requires the external NSE T2T
 *    surveillance list (not yet integrated). These currently fall through to step 10
 *    and are classified ORDINARY_EQUITY_ELIGIBLE pending T2T integration.
 *    A future authoritative NSE security-master integration (joining via instrument_token,
 *    ISIN, exchange, segment, series/security type, and tradingsymbol) is required
 *    before the canary can be retried.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { INACTIVE_SYMBOLS } from "../universe";
import { centralLooksLikeEtf } from "../marketData/compat";

// ─── Public types ─────────────────────────────────────────────────────────────

export type InstrumentEligibilityClass =
  /**
   * NSE EQUITY_L.csv reference confirms ordinary main-board equity (series=EQ).
   * This is the ONLY class that can drive breadth, signals, and trade actions.
   * Requires NSE authoritative reference join (see nseSecurityMaster.ts).
   */
  | "ORDINARY_MAIN_BOARD_EQUITY"
  /**
   * Kite master says EQ/NSE, suffix checks pass, but the NSE authoritative
   * reference (EQUITY_L.csv) was unavailable OR the symbol was not found in it.
   * CANNOT drive breadth, rankings, signals, market mood, or trade actions.
   * Displayed in scanner for price/quote purposes only (INFO_ONLY).
   * Will be reclassified once NSE reference becomes available.
   */
  | "KITE_NSE_EQ_LIKE_PROVISIONAL"
  /**
   * @deprecated — kept for backward compatibility. classifyInstrument no longer
   * emits this class. Old cache entries may carry it; treat as KITE_NSE_EQ_LIKE_PROVISIONAL.
   */
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

/**
 * All categories that are EXCLUDED from warehouse population (scanner symbolList).
 *
 * ORDINARY_MAIN_BOARD_EQUITY — NOT excluded: the ONLY class that is warehouse-eligible.
 *   Requires NSE authoritative reference join (nseRef=Map, series=EQ confirmed).
 *
 * KITE_NSE_EQ_LIKE_PROVISIONAL — EXCLUDED: NSE reference unavailable → fail closed.
 *   Instruments cannot drive breadth, rankings, signals, market mood, or trade actions
 *   until the authoritative reference confirms their security type.
 *
 * ORDINARY_EQUITY_ELIGIBLE — EXCLUDED: deprecated class from pre-reference-gate era.
 *   Old disk cache entries carrying this class are treated as fail-closed.
 *   The classifier never emits this class; any entry carrying it is stale.
 *
 * All others — excluded from symbolList entirely.
 */
export const WAREHOUSE_EXCLUDED_CLASSES = new Set<InstrumentEligibilityClass>([
  // Authoritative exclusions (confirmed by NSE reference or Kite master)
  "KITE_NSE_EQ_LIKE_PROVISIONAL",    // NSE reference required but unavailable — fail closed
  "ORDINARY_EQUITY_ELIGIBLE",         // deprecated pre-gate class — treat as fail-closed
  "TRADE_TO_TRADE_EQUITY_POLICY_EXCLUDED",
  "SME_EQUITY_POLICY_EXCLUDED",
  "DEBT_GOVERNMENT_SECURITY",
  "SOVEREIGN_GOLD_BOND",
  "ETF_OR_FUND",
  "INDEX",
  "INACTIVE_OR_DELISTED",
  "UNRESOLVED_SECURITY_TYPE",
  "OTHER_UNSUPPORTED",
  // ORDINARY_MAIN_BOARD_EQUITY is NOT here — it is the only warehouse-eligible class.
]);

export interface InstrumentEligibilityResult {
  symbol: string;
  name: string;
  instrumentType: string;
  segment: string;
  exchange: string;
  /**
   * NSE tradingsymbol suffix extracted as a supporting signal.
   * Examples: "SG" = SDL bond, "GB" = Gold Bond, "ST" = SME-ITP, "SM" = SME, "BZ" = BSZ.
   * null for standard equity (no suffix).
   *
   * IMPORTANT: This is supporting evidence from the master record's tradingsymbol field,
   * NOT an independent authority. An instrument absent from the master is UNRESOLVED
   * regardless of what its suffix implies.
   */
  seriesCode: string | null;
  /**
   * Whether this instrument appears in the current Kite NSE EQ instrument master.
   * false → UNRESOLVED_SECURITY_TYPE; no further classification is performed.
   */
  inCurrentMaster: boolean;
  /** ISIN where provided (Kite master does not always include it). */
  isin: string | null;
  eligibilityClass: InstrumentEligibilityClass;
  /** Detailed rationale including which signals were applied. */
  reason: string;
  /** Policy reason for exclusion (null for ORDINARY_EQUITY_ELIGIBLE). */
  policyExclusionReason: string | null;
  /** Whether this instrument is eligible for full-NSE warehouse population. */
  warehouseEligible: boolean;
  /**
   * Ordered attribute signals that contributed to this decision, for audit.
   * Format: "attribute=value". Example: ["inCurrentMaster=true", "exchange=NSE",
   * "segment=NSE", "instrument_type=EQ", "suffix=SG", "name_pattern=SDL_COUPON"]
   */
  precedenceVector: string[];
}

// ─── Suffix extraction (supporting evidence) ──────────────────────────────────

/**
 * Extract the trailing hyphenated segment from a Kite tradingsymbol.
 *
 * In Kite's NSE EQ master, some security types are encoded into the tradingsymbol
 * as a hyphenated suffix (e.g. "656KA30-SG", "SGBSEP28VI-GB", "OMFURN-ST").
 * This extraction is a SUPPORTING SIGNAL — the extracted code is only meaningful
 * when the instrument is confirmed to be in the current Kite master.
 *
 * Returns null for standard equities (no hyphen suffix).
 */
function extractSuffixCode(tradingsymbol: string): string | null {
  return tradingsymbol.match(/-([A-Z]+)$/)?.[1] ?? null;
}

// ─── Classification helpers (all require inCurrentMaster=true) ────────────────

function detectSovereignGoldBond(suffix: string | null, symbol: string, name: string): string[] | null {
  const s = symbol.toUpperCase(), n = name.toUpperCase();
  if (suffix === "GB") {
    const signals = ["suffix=GB (Gold Bond series, Kite master tradingsymbol)"];
    if (s.startsWith("SGB")) signals.push("tradingsymbol_prefix=SGB");
    if (/GOLD\s*BOND/.test(n)) signals.push(`name_pattern=GOLD_BOND`);
    return signals;
  }
  if (s.startsWith("SGB") && /GOLD\s*BOND/.test(n)) {
    return ["tradingsymbol_prefix=SGB", "name_pattern=GOLD_BOND"];
  }
  return null;
}

function detectDebtGovSecurity(suffix: string | null, symbol: string, name: string): string[] | null {
  const n = name.toUpperCase(), s = symbol.toUpperCase();
  if (suffix === "SG") {
    const signals = ["suffix=SG (State Development Loan series, Kite master tradingsymbol)"];
    if (/\bSDL\b/.test(n)) signals.push("name_contains=SDL");
    if (/\d+\.\d+%/.test(n)) signals.push("name_contains=coupon_rate_pattern");
    return signals;
  }
  // Name-pattern corroboration for bare SDL symbols without suffix (rare)
  if (/\bSDL\b/.test(n) && /\d+\.\d+%.*\d{4}/.test(n)) {
    return ["name_pattern=SDL_coupon_rate_year"];
  }
  if (/^[67]\d{2}[A-Z]{2}\d{2}$/.test(s) && /\bSDL\b/.test(n)) {
    return [`symbol_pattern=coupon_rate_encoding`, "name_contains=SDL"];
  }
  return null;
}

function detectSmeEquity(suffix: string | null): string[] | null {
  if (suffix === "ST") return ["suffix=ST (NSE SME-ITP/Trading platform, Kite master tradingsymbol)"];
  if (suffix === "SM") return ["suffix=SM (NSE SME segment, Kite master tradingsymbol)"];
  return null;
}

function detectBzSeries(suffix: string | null, symbol: string): string[] | null {
  if (suffix === "BZ") {
    return [
      `suffix=BZ (NSE listing with BSZ/BSE cross-settlement, Kite master tradingsymbol="${symbol}")`,
      "OHLCV_coverage_via_Kite_equity_endpoint=UNRELIABLE",
    ];
  }
  return null;
}

// ─── Main classifier ──────────────────────────────────────────────────────────

/**
 * Classify a single NSE instrument.
 *
 * The caller MUST set `inCurrentMaster: true` only for instruments confirmed
 * present in the Kite NSE EQ instrument master fetched today.
 * Pass `inCurrentMaster: false` for any instrument not found in the master
 * (e.g. delisted, symbol not in cache). It will be classified UNRESOLVED_SECURITY_TYPE.
 */
/**
 * NSE authoritative equity reference map type.
 * Keyed by NSE tradingsymbol (uppercase). Sourced from EQUITY_L.csv.
 *
 * Passing null is the ONLY way to express "reference unavailable" — it always
 * results in KITE_NSE_EQ_LIKE_PROVISIONAL (fail-closed). Omitting nseRef is a
 * TypeScript compile error (the field is required, non-optional).
 */
export type NseSecurityReference = Map<string, { series: string; isin: string; dateOfListing: string }>;

export function classifyInstrument(opts: {
  symbol: string;
  name: string;
  instrumentType: string;
  segment: string;
  exchange: string;
  inCurrentMaster: boolean;
  isin?: string | null;
  /**
   * NSE authoritative equity reference (EQUITY_L.csv parsed, keyed by symbol).
   *
   * REQUIRED — non-optional by design. Omitting this field is a TypeScript compile error.
   * This ensures every caller explicitly acknowledges the reference-gate contract.
   *
   *   nseRef=null → NSE reference unavailable → KITE_NSE_EQ_LIKE_PROVISIONAL (fail-closed).
   *                 Instruments CANNOT drive breadth, rankings, signals, or trade actions.
   *   nseRef=Map  → Reference loaded → join performed by symbol:
   *                   found + series=EQ → ORDINARY_MAIN_BOARD_EQUITY (warehouse-eligible)
   *                   found + series=BE/BT → TRADE_TO_TRADE_EQUITY_POLICY_EXCLUDED
   *                   found + series=SM/ST → SME_EQUITY_POLICY_EXCLUDED
   *                   found + other series → OTHER_UNSUPPORTED
   *                   not found → UNRESOLVED_SECURITY_TYPE
   *
   * The deprecated ORDINARY_EQUITY_ELIGIBLE class is NEVER emitted. Old disk cache entries
   * carrying that class are excluded from warehouse (WAREHOUSE_EXCLUDED_CLASSES includes it).
   */
  nseRef: NseSecurityReference | null;
}): InstrumentEligibilityResult {
  const { symbol, name, instrumentType, segment, exchange, inCurrentMaster, isin = null, nseRef } = opts;
  const su = symbol.toUpperCase();
  const suffix = extractSuffixCode(su);

  const base = { symbol, name, instrumentType, segment, exchange, seriesCode: suffix, inCurrentMaster, isin };

  const attrVec: string[] = [
    `inCurrentMaster=${inCurrentMaster}`,
    `exchange=${exchange}`,
    `segment=${segment}`,
    `instrument_type=${instrumentType}`,
    `suffix=${suffix ?? "(none)"}`,
  ];
  if (isin) attrVec.push(`isin=${isin}`);

  // ── 1. Authoritative source requirement ───────────────────────────────────
  // An instrument not present in the current Kite master cannot be classified.
  // The symbol suffix alone is NOT sufficient authority — the master record must
  // confirm the security type.
  if (!inCurrentMaster) {
    return {
      ...base,
      eligibilityClass: "UNRESOLVED_SECURITY_TYPE",
      reason: `Instrument not present in current Kite NSE EQ instrument master (inCurrentMaster=false). ` +
        `Symbol suffix "${suffix ?? "(none)"}" is supporting evidence only and cannot independently ` +
        `authorize an eligibility class. Without an authoritative master record, ` +
        `the instrument fails closed as UNRESOLVED_SECURITY_TYPE.`,
      policyExclusionReason:
        "Not present in the current Kite NSE EQ instrument master. A dated NSE security-master " +
        "record joined via instrument_token, ISIN, exchange, segment, and series/security type " +
        "is required before this instrument can receive an affirmative eligibility verdict.",
      warehouseEligible: false,
      precedenceVector: [...attrVec, "decision=UNRESOLVED_BY_ABSENT_FROM_MASTER"],
    };
  }

  // ── 2. Exchange check ──────────────────────────────────────────────────────
  if (exchange !== "NSE") {
    return {
      ...base,
      eligibilityClass: "OTHER_UNSUPPORTED",
      reason: `Non-NSE exchange "${exchange}"; only NSE main-board instruments are supported`,
      policyExclusionReason: "Exchange is not NSE; excluded from NSE warehouse population.",
      warehouseEligible: false,
      precedenceVector: [...attrVec, "decision=OTHER_UNSUPPORTED_BY_EXCHANGE"],
    };
  }

  // ── 3. Index instruments ───────────────────────────────────────────────────
  if (instrumentType === "INDEX" || segment === "INDICES") {
    return {
      ...base,
      eligibilityClass: "INDEX",
      reason: `Index instrument: ${attrVec.join(", ")}`,
      policyExclusionReason: "Index instruments are not tradeable equities; no individual equity candle series exists.",
      warehouseEligible: false,
      precedenceVector: [...attrVec, "decision=INDEX_BY_INSTRUMENT_TYPE_OR_SEGMENT"],
    };
  }

  // ── 4. Inactive / delisted ────────────────────────────────────────────────
  if (INACTIVE_SYMBOLS.has(su)) {
    return {
      ...base,
      eligibilityClass: "INACTIVE_OR_DELISTED",
      reason: `In INACTIVE_SYMBOLS curated-exclude set: ${su}`,
      policyExclusionReason: "Delisted or suspended instruments produce stale or empty candle series.",
      warehouseEligible: false,
      precedenceVector: [...attrVec, "decision=INACTIVE_OR_DELISTED_BY_INACTIVE_SYMBOLS"],
    };
  }

  // ── 5. Sovereign Gold Bonds (suffix=GB) ────────────────────────────────────
  const sgb = detectSovereignGoldBond(suffix, symbol, name);
  if (sgb) {
    return {
      ...base,
      eligibilityClass: "SOVEREIGN_GOLD_BOND",
      reason: `Sovereign Gold Bond confirmed by master record: ${sgb.join("; ")}`,
      policyExclusionReason:
        "RBI Sovereign Gold Bonds are debt instruments; the Kite Historical Data API " +
        "equity endpoint returns no OHLCV data for them.",
      warehouseEligible: false,
      precedenceVector: [...attrVec, ...sgb, "decision=SOVEREIGN_GOLD_BOND"],
    };
  }

  // ── 6. SDL bonds / Government Securities (suffix=SG) ─────────────────────
  // Note: Kite master artifact — these have instrument_type=EQ, segment=NSE.
  // The master's tradingsymbol suffix (SG) and name pattern are used together.
  const debt = detectDebtGovSecurity(suffix, symbol, name);
  if (debt) {
    return {
      ...base,
      eligibilityClass: "DEBT_GOVERNMENT_SECURITY",
      reason:
        `Government/SDL debt security (Kite master-data artifact: instrument_type=EQ despite being debt): ` +
        debt.join("; "),
      policyExclusionReason:
        "State Development Loans and G-Secs are debt instruments. The Kite Historical Data API " +
        "(equity endpoint) returns empty OHLCV series for SDL/G-Sec symbols — no candle data exists.",
      warehouseEligible: false,
      precedenceVector: [...attrVec, ...debt, "decision=DEBT_GOVERNMENT_SECURITY"],
    };
  }

  // ── 7. SME segment (suffix=ST / suffix=SM) ────────────────────────────────
  const sme = detectSmeEquity(suffix);
  if (sme) {
    return {
      ...base,
      eligibilityClass: "SME_EQUITY_POLICY_EXCLUDED",
      reason: `SME-segment instrument confirmed by master record: ${sme.join("; ")}`,
      policyExclusionReason:
        "SME-platform stocks operate under different trading rules, thinner liquidity, " +
        "and non-standard circuit limits. Historical OHLCV coverage via Kite equity endpoint " +
        "is incomplete for many SME listings.",
      warehouseEligible: false,
      precedenceVector: [...attrVec, ...sme, "decision=SME_EQUITY_POLICY_EXCLUDED"],
    };
  }

  // ── 8. BZ series (suffix=BZ) ──────────────────────────────────────────────
  const bz = detectBzSeries(suffix, symbol);
  if (bz) {
    return {
      ...base,
      eligibilityClass: "UNRESOLVED_SECURITY_TYPE",
      reason:
        `Cross-listed BSZ-settlement instrument confirmed by master record (instrument is NSE-listed ` +
        `but settled via BSZ/BSE clearing): ${bz.join("; ")}. ` +
        `OHLCV coverage via the Kite Historical Data API equity endpoint is unreliable.`,
      policyExclusionReason:
        "BZ-series instruments return empty or inconsistent OHLCV series from the Kite " +
        "Historical Data API equity endpoint. Excluded until a separate Kite bond/hybrid data " +
        "integration provides authoritative OHLCV history.",
      warehouseEligible: false,
      precedenceVector: [...attrVec, ...bz, "decision=UNRESOLVED_SECURITY_TYPE_BY_BZ_SERIES"],
    };
  }

  // ── 9. ETF / Fund ─────────────────────────────────────────────────────────
  if (centralLooksLikeEtf(symbol, name)) {
    const etfSignals: string[] = [];
    const nu = name.toUpperCase();
    if (/BEES$/.test(su)) etfSignals.push("tradingsymbol_suffix=BEES");
    if (/ETF/.test(su)) etfSignals.push("tradingsymbol_contains=ETF");
    if (/\bETF\b/.test(nu)) etfSignals.push("name_contains=ETF");
    if (/EXCHANGE\s+TRADED/.test(nu)) etfSignals.push("name_pattern=EXCHANGE_TRADED");
    if (etfSignals.length === 0) etfSignals.push("centralLooksLikeEtf=true");
    return {
      ...base,
      eligibilityClass: "ETF_OR_FUND",
      reason: `Exchange-traded fund or index fund: ${etfSignals.join("; ")}`,
      policyExclusionReason:
        "ETFs track indices/baskets and have no single-stock candle history for " +
        "momentum/technical indicators; excluded from warehouse.",
      warehouseEligible: false,
      precedenceVector: [...attrVec, ...etfSignals, "decision=ETF_OR_FUND"],
    };
  }

  // ── 10. NSE reference-confirmed equity classification ─────────────────────
  // Reaches here only when: inCurrentMaster=true + exchange=NSE + no exclusion
  // pattern (no -SG/-GB/-ST/-SM/-BZ suffix, not ETF, not INDEX, not INACTIVE).
  // Join against the authoritative NSE EQUITY_L.csv reference.
  //
  // nseRef is REQUIRED (non-optional, enforced by TypeScript).
  // nseRef=null → fail closed: KITE_NSE_EQ_LIKE_PROVISIONAL (reference unavailable).
  // nseRef=Map  → authoritative join (series determines class).
  if (instrumentType === "EQ" && segment === "NSE") {
    // 10a. nseRef=null: NSE reference unavailable — fail closed.
    //      KITE_NSE_EQ_LIKE_PROVISIONAL cannot drive breadth, rankings, signals,
    //      market mood, or trade actions. Excluded from WAREHOUSE_EXCLUDED_CLASSES.
    if (!nseRef) {
      return {
        ...base,
        eligibilityClass: "KITE_NSE_EQ_LIKE_PROVISIONAL",
        reason:
          `Kite master confirms instrument_type=EQ, segment=NSE, exchange=NSE for ${su}, ` +
          `but NSE authoritative reference (EQUITY_L.csv) was not loaded. ` +
          `Cannot confirm ordinary main-board equity without reference join. ` +
          `Classified as KITE_NSE_EQ_LIKE_PROVISIONAL — ` +
          `prices displayed for informational purposes; ` +
          `CANNOT drive breadth, rankings, signals, market mood or trade actions.`,
        policyExclusionReason:
          "NSE authoritative reference (EQUITY_L.csv) unavailable. " +
          "Cannot confirm security type without reference join. Re-classified once reference loads.",
        warehouseEligible: false,
        precedenceVector: [...attrVec, "nseRef=UNAVAILABLE", "decision=KITE_NSE_EQ_LIKE_PROVISIONAL"],
      };
    }

    // 10b. NSE reference loaded → join by symbol.
    const nseRecord = nseRef.get(su);
    if (!nseRecord) {
      return {
        ...base,
        eligibilityClass: "UNRESOLVED_SECURITY_TYPE",
        reason:
          `Symbol ${su} is in the Kite EQ master (instrument_type=EQ, segment=NSE) but ` +
          `NOT found in the NSE EQUITY_L.csv reference. ` +
          `Cannot authoritatively confirm security type. Fails closed as UNRESOLVED_SECURITY_TYPE.`,
        policyExclusionReason:
          "Symbol absent from NSE EQUITY_L.csv — cannot authoritatively classify. " +
          "May be a recently-listed security, a corporate action artefact, or a Kite master discrepancy.",
        warehouseEligible: false,
        precedenceVector: [...attrVec, "nseRef=NOT_FOUND", "decision=UNRESOLVED_SECURITY_TYPE"],
      };
    }

    // 10c. Symbol found in NSE reference — classify by the official NSE series code.
    const nseSeriesU = nseRecord.series.toUpperCase().trim();
    const isinTag = nseRecord.isin ? `isin=${nseRecord.isin}` : "isin=N/A";
    const listingTag = nseRecord.dateOfListing ? `dateOfListing=${nseRecord.dateOfListing}` : "";
    const nseAttr = [`nseRef.series=${nseSeriesU}`, isinTag, listingTag].filter(Boolean);

    if (nseSeriesU === "EQ") {
      return {
        ...base,
        eligibilityClass: "ORDINARY_MAIN_BOARD_EQUITY",
        reason:
          `NSE EQUITY_L.csv authoritatively confirms ordinary main-board equity: ` +
          `symbol=${su}, ${nseAttr.join(", ")}. ` +
          `Eligible for breadth, rankings, signals, and trade actions.`,
        policyExclusionReason: null,
        warehouseEligible: true,
        precedenceVector: [...attrVec, ...nseAttr, "decision=ORDINARY_MAIN_BOARD_EQUITY"],
      };
    }

    if (nseSeriesU === "BE" || nseSeriesU === "BT") {
      return {
        ...base,
        eligibilityClass: "TRADE_TO_TRADE_EQUITY_POLICY_EXCLUDED",
        reason:
          `NSE EQUITY_L.csv confirms Trade-to-Trade equity: ${nseAttr.join(", ")}. ` +
          `Policy: T2T excluded — no intraday squaring allowed, circuit-to-circuit trading only.`,
        policyExclusionReason:
          "Trade-to-Trade (T2T) stocks must be delivered — no intraday squaring. " +
          "Excluded from warehouse and scanner until explicit T2T policy defined.",
        warehouseEligible: false,
        precedenceVector: [...attrVec, ...nseAttr, "decision=TRADE_TO_TRADE_EQUITY_POLICY_EXCLUDED"],
      };
    }

    if (nseSeriesU === "SM" || nseSeriesU === "ST") {
      return {
        ...base,
        eligibilityClass: "SME_EQUITY_POLICY_EXCLUDED",
        reason:
          `NSE EQUITY_L.csv confirms SME equity: ${nseAttr.join(", ")}. ` +
          `Policy: SME platform excluded — different trading rules and thinner liquidity.`,
        policyExclusionReason:
          "SME-platform stocks (NSE Emerge) have different trading rules and thinner liquidity; excluded from warehouse.",
        warehouseEligible: false,
        precedenceVector: [...attrVec, ...nseAttr, "decision=SME_EQUITY_POLICY_EXCLUDED"],
      };
    }

    // Other NSE series (BL, N1-N9, etc.) — not ordinary main-board equity.
    return {
      ...base,
      eligibilityClass: "OTHER_UNSUPPORTED",
      reason:
        `NSE EQUITY_L.csv shows series=${nseSeriesU} for ${su}, ` +
        `which is not an ordinary main-board equity series (EQ). ` +
        `${nseAttr.join(", ")}. Excluded as OTHER_UNSUPPORTED.`,
      policyExclusionReason:
        `NSE EQUITY_L.csv series=${nseSeriesU} is not ordinary main-board equity (EQ). ` +
        `Not eligible for warehouse population.`,
      warehouseEligible: false,
      precedenceVector: [...attrVec, ...nseAttr, "decision=OTHER_UNSUPPORTED_BY_NSE_SERIES"],
    };
  }

  // ── 11. All other combinations → fail closed ────────────────────────────
  return {
    ...base,
    eligibilityClass: "OTHER_UNSUPPORTED",
    reason:
      `Instrument does not match any affirmatively defined category: ` +
      `${attrVec.join(", ")}. Missing or conflicting metadata fails closed.`,
    policyExclusionReason:
      "Cannot be classified as ORDINARY_EQUITY_ELIGIBLE — one or more required attributes " +
      "(exchange=NSE, segment=NSE, instrument_type=EQ) are missing or unexpected.",
    warehouseEligible: false,
    precedenceVector: [...attrVec, "decision=OTHER_UNSUPPORTED_FAIL_CLOSED"],
  };
}

/**
 * Classify a batch of instruments.
 * Returns a Map from symbol to result for O(1) lookup.
 *
 * Every input must include `inCurrentMaster` — the caller is responsible for
 * comparing the input list against the live Kite master and setting this flag.
 */
export function classifyInstrumentBatch(
  instruments: Array<{
    symbol: string;
    name: string;
    instrumentType: string;
    segment: string;
    exchange: string;
    inCurrentMaster: boolean;
    isin?: string | null;
    /** Required — pass null if NSE reference unavailable (fail-closed → KITE_NSE_EQ_LIKE_PROVISIONAL). */
    nseRef: NseSecurityReference | null;
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
