/**
 * Canonical NSE Instrument Eligibility Resolver — Pack 33B Rejected-Evidence Remediation.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * CLASSIFICATION AUTHORITY CONTRACT (Gate 1)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * ClassificationAuthority values:
 *
 *   AUTHORITATIVE_NSE_REFERENCE
 *     Classification is confirmed exclusively by an official NSE-published dataset
 *     (NSE EQUITY_L.csv series code, joined by symbol/ISIN). This is the ONLY
 *     source that can produce eligibleForOrdinaryEquityScanner=true.
 *     Sources: NSE EQUITY_L.csv (EQ, BE, BT, SM, ST, BL, …).
 *
 *   HEURISTIC_DIAGNOSTIC_ONLY
 *     Classification uses Kite tradingsymbol suffix evidence OR name-pattern evidence.
 *     These are NOT official NSE publications. They are supporting signals used only
 *     for conservative fail-closed EXCLUSION. A heuristic signal MUST NEVER produce
 *     eligibleForOrdinaryEquityScanner=true.
 *     Applies to: -GB/-SG/-ST/-SM/-PP/-BZ suffix, REIT/ETF/SGB/SDL name patterns.
 *
 *   UNRESOLVED
 *     Authoritative classification cannot be established because:
 *       a) NSE reference (EQUITY_L.csv) is unavailable (nseRef=null), or
 *       b) Symbol is absent from NSE reference (cannot confirm series), or
 *       c) Instrument is absent from the Kite master (inCurrentMaster=false).
 *     Result: eligibleForOrdinaryEquityScanner=false, warehouseEligible=false.
 *
 * RULES (non-negotiable):
 *   1. Only ORDINARY_COMPANY_EQUITY_ELIGIBLE with authority=AUTHORITATIVE_NSE_REFERENCE
 *      may enter the ordinary-equity scanner universe.
 *   2. A heuristic match MUST NEVER authorize eligibility (may only exclude).
 *   3. Symbol suffix or name pattern MUST NOT be called "authoritative."
 *   4. If official references cannot distinguish an instrument → UNRESOLVED_SECURITY_TYPE
 *      + authority=UNRESOLVED + eligibleForOrdinaryEquityScanner=false.
 *   5. The deprecated ORDINARY_MAIN_BOARD_EQUITY and ORDINARY_EQUITY_ELIGIBLE classes
 *      are in WAREHOUSE_EXCLUDED_CLASSES — old cache entries carrying them are
 *      fail-closed until reclassified with the current classifier.
 *   6. LAST_GOOD_BLOB_VERSION and DISK_CACHE_VERSION incremented to invalidate
 *      all caches carrying ORDINARY_MAIN_BOARD_EQUITY or HEURISTIC_FAIL_CLOSED entries.
 *
 * OFFICIAL NSE SOURCE DATASETS
 * ─────────────────────────────
 *   1. NSE EQUITY_L.csv
 *      URL:    https://archives.nseindia.com/content/equities/EQUITY_L.csv
 *      Backup: https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv
 *      Format: CSV — SYMBOL,NAME OF COMPANY,SERIES,DATE OF LISTING,PAID UP VALUE,MARKET LOT,ISIN NUMBER,FACE VALUE
 *      Updated: Daily by NSE.
 *      Classifies: EQ (ordinary), BE/BT (T2T), SM/ST (SME), BL (block deal)
 *      LIMITATION: Does NOT distinguish REIT/InvIT from ordinary EQ (both appear as EQ).
 *      LIMITATION: Does NOT distinguish preference shares from ordinary EQ (both appear as EQ).
 *      LIMITATION: Does NOT have a distinct ETF series code (ETFs appear as EQ in some cases).
 *      Result: Symbols present with series=EQ in EQUITY_L.csv and confirmed in Kite master
 *              receive authority=AUTHORITATIVE_NSE_REFERENCE and finalClass=ORDINARY_COMPANY_EQUITY_ELIGIBLE.
 *
 *   MISSING AUTHORITATIVE SOURCES:
 *   - REIT/InvIT: No official NSE CSV provides a programmatic REIT/InvIT registry.
 *     Detection uses HEURISTIC_DIAGNOSTIC_ONLY (name pattern). If insufficient:
 *     BLOCKED_AUTHORITATIVE_NSE_SECURITY_TYPE_REFERENCE_INSUFFICIENT applies.
 *   - Preference shares: EQUITY_L.csv does not have a preference-share series code.
 *     Detection uses HEURISTIC_DIAGNOSTIC_ONLY (name pattern).
 *   - ETF/Mutual Fund: Some ETFs appear in EQUITY_L.csv as EQ. Detection uses
 *     HEURISTIC_DIAGNOSTIC_ONLY (symbol/name pattern).
 *   - SGBs, SDL bonds: Kite tradingsymbol suffix (-GB, -SG) is HEURISTIC_DIAGNOSTIC_ONLY
 *     evidence. No official NSE CSV programmatically distinguishes these.
 *   - Inactive/delisted: Based on a curated INACTIVE_SYMBOLS set (maintained internally).
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { INACTIVE_SYMBOLS } from "../universe";
import { centralLooksLikeEtf } from "../marketData/compat";

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * Classification authority for a single instrument classification decision.
 *
 * AUTHORITATIVE_NSE_REFERENCE  — from NSE EQUITY_L.csv series code (joined by symbol).
 * HEURISTIC_DIAGNOSTIC_ONLY   — from Kite suffix or name-pattern evidence (exclusion only).
 * UNRESOLVED                  — reference unavailable, symbol absent, or not in master.
 */
export type ClassificationAuthority =
  | "AUTHORITATIVE_NSE_REFERENCE"
  | "HEURISTIC_DIAGNOSTIC_ONLY"
  | "UNRESOLVED";

/**
 * Canonical public classification result. This is the primary type that callers
 * should use for decision-making. InstrumentEligibilityResult extends this with
 * additional diagnostic fields.
 *
 * Rules:
 *   1. eligibleForOrdinaryEquityScanner=true ONLY when:
 *        finalClass="ORDINARY_COMPANY_EQUITY_ELIGIBLE"
 *        AND authority="AUTHORITATIVE_NSE_REFERENCE"
 *   2. All other combinations → eligibleForOrdinaryEquityScanner=false.
 *   3. authority="HEURISTIC_DIAGNOSTIC_ONLY" may only produce exclusions.
 *   4. sourceDataset is non-null only for AUTHORITATIVE_NSE_REFERENCE results.
 *   5. diagnosticWarnings lists heuristic signals that did NOT drive the decision
 *      (they are recorded for audit only, never for gate logic).
 */
export type InstrumentClassification = {
  finalClass:
    | "ORDINARY_COMPANY_EQUITY_ELIGIBLE"
    | "TRADE_TO_TRADE_EQUITY"
    | "SME_EQUITY"
    | "ETF_OR_MUTUAL_FUND_UNIT"
    | "REIT_OR_INVIT"
    | "PARTLY_PAID_EQUITY"
    | "PREFERENCE_SHARE"
    | "DEBT_OR_HYBRID"
    | "SOVEREIGN_GOLD_BOND"
    | "INACTIVE_SECURITY"
    | "UNRESOLVED_SECURITY_TYPE";
  authority: ClassificationAuthority;
  eligibleForOrdinaryEquityScanner: boolean;
  /**
   * Official NSE dataset that produced this classification.
   * Non-null ONLY for authority=AUTHORITATIVE_NSE_REFERENCE.
   * Example: "NSE:EQUITY_L.csv"
   */
  sourceDataset: string | null;
  /**
   * Effective date of the official NSE dataset (YYYY-MM-DD).
   * Non-null ONLY for authority=AUTHORITATIVE_NSE_REFERENCE.
   */
  sourceEffectiveDate: string | null;
  /**
   * Short machine-readable reason for the classification decision.
   * Examples: "NSE_EQ_SERIES_CONFIRMED", "HEURISTIC_REIT_NAME", "NSE_REF_UNAVAILABLE".
   */
  reasonCode: string;
  /**
   * Ordered list of heuristic signals observed during classification.
   * These were collected for diagnostic purposes but did NOT drive the final class.
   * Empty when authority=AUTHORITATIVE_NSE_REFERENCE and no heuristic conflicts exist.
   */
  diagnosticWarnings: string[];
};

/**
 * Internal class union. Includes deprecated classes for backward cache compat.
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │  ONLY ORDINARY_COMPANY_EQUITY_ELIGIBLE is warehouse-eligible │
 * └─────────────────────────────────────────────────────────────┘
 *
 * Deprecated classes in WAREHOUSE_EXCLUDED_CLASSES (fail-closed):
 *   ORDINARY_MAIN_BOARD_EQUITY — renamed; any old cache entry fails-closed.
 *   ORDINARY_EQUITY_ELIGIBLE   — pre-reference-gate era; old blobs carry this.
 *   PARTLY_PAID_OR_PREFERENCE  — split into two specific classes.
 */
export type InstrumentEligibilityClass =
  /**
   * THE ONLY warehouse-eligible class.
   * Requires: authority=AUTHORITATIVE_NSE_REFERENCE (NSE EQUITY_L.csv series=EQ).
   * Replaces: ORDINARY_MAIN_BOARD_EQUITY (deprecated, excluded).
   */
  | "ORDINARY_COMPANY_EQUITY_ELIGIBLE"
  /**
   * @deprecated — classifyInstrument no longer emits this class.
   * Old disk cache entries may carry it. Added to WAREHOUSE_EXCLUDED_CLASSES
   * so old entries are fail-closed until reclassified. Must not be used by
   * any new code path.
   */
  | "ORDINARY_MAIN_BOARD_EQUITY"
  /**
   * @deprecated — kept for backward compatibility. Pre-reference-gate era class.
   * classifyInstrument never emits this. Old cache entries carrying it are excluded.
   */
  | "ORDINARY_EQUITY_ELIGIBLE"
  /**
   * Kite EQ + NSE segment confirmed, but NSE reference (EQUITY_L.csv) unavailable.
   * Cannot confirm security type without reference join.
   * Excluded from warehouse — cannot drive breadth, signals, or trade actions.
   */
  | "KITE_NSE_EQ_LIKE_PROVISIONAL"
  | "TRADE_TO_TRADE_EQUITY_POLICY_EXCLUDED"
  | "SME_EQUITY_POLICY_EXCLUDED"
  | "DEBT_GOVERNMENT_SECURITY"
  | "SOVEREIGN_GOLD_BOND"
  | "REIT_OR_INVIT"
  /**
   * Partly-paid equity shares.
   * Authority: HEURISTIC_DIAGNOSTIC_ONLY — Kite tradingsymbol suffix "-PP" or
   * "PARTLY PAID" in name. Neither is an official NSE series code.
   */
  | "PARTLY_PAID_EQUITY"
  /**
   * Preference shares.
   * Authority: HEURISTIC_DIAGNOSTIC_ONLY — "PREFERENCE" in name only.
   * NSE EQUITY_L.csv does not have a preference-share series code.
   */
  | "PREFERENCE_SHARE"
  /**
   * @deprecated — classifyInstrument no longer emits this class.
   * Old cache entries may carry it. Replaced by PARTLY_PAID_EQUITY / PREFERENCE_SHARE.
   */
  | "PARTLY_PAID_OR_PREFERENCE"
  | "ETF_OR_FUND"
  | "INDEX"
  | "INACTIVE_OR_DELISTED"
  | "UNRESOLVED_SECURITY_TYPE"
  | "OTHER_UNSUPPORTED";

/**
 * All InstrumentEligibilityClass values excluded from warehouse population.
 *
 * ORDINARY_COMPANY_EQUITY_ELIGIBLE is NOT in this set — it is the only eligible class.
 *
 * ORDINARY_MAIN_BOARD_EQUITY and ORDINARY_EQUITY_ELIGIBLE are IN this set (deprecated).
 * Any old cache blob carrying these classes is fail-closed until reclassified.
 */
export const WAREHOUSE_EXCLUDED_CLASSES = new Set<InstrumentEligibilityClass>([
  // Deprecated former eligibility classes (fail-closed on old cache entries)
  "ORDINARY_MAIN_BOARD_EQUITY",                // deprecated name — never emitted by current code
  "ORDINARY_EQUITY_ELIGIBLE",                  // deprecated pre-gate class
  // NSE reference unavailable — cannot confirm security type
  "KITE_NSE_EQ_LIKE_PROVISIONAL",
  // Authoritative exclusions (from NSE EQUITY_L.csv series code)
  "TRADE_TO_TRADE_EQUITY_POLICY_EXCLUDED",
  "SME_EQUITY_POLICY_EXCLUDED",
  // Heuristic fail-closed exclusions (diagnostic only — never authoritative)
  "DEBT_GOVERNMENT_SECURITY",
  "SOVEREIGN_GOLD_BOND",
  "REIT_OR_INVIT",
  "PARTLY_PAID_EQUITY",
  "PREFERENCE_SHARE",
  "PARTLY_PAID_OR_PREFERENCE",                 // deprecated — never emitted; kept for cache compat
  "ETF_OR_FUND",
  "INDEX",
  "INACTIVE_OR_DELISTED",
  "UNRESOLVED_SECURITY_TYPE",
  "OTHER_UNSUPPORTED",
  // ORDINARY_COMPANY_EQUITY_ELIGIBLE is NOT here — it is the only eligible class.
]);

/**
 * Result of classifying a single NSE instrument.
 *
 * The `classification` field provides the canonical public-facing summary.
 * The remaining fields are diagnostic/audit fields.
 */
export interface InstrumentEligibilityResult {
  symbol: string;
  name: string;
  instrumentType: string;
  segment: string;
  exchange: string;
  /**
   * Kite tradingsymbol suffix extracted as DIAGNOSTIC EVIDENCE.
   * Examples: "SG"=SDL bond, "GB"=Gold Bond, "ST"=SME-ITP, "SM"=SME, "PP"=partly paid.
   * null for standard equity (no suffix).
   *
   * IMPORTANT: This is HEURISTIC_DIAGNOSTIC_ONLY evidence. Suffix alone is not
   * authoritative per the classification contract. It is recorded here for audit.
   */
  seriesCode: string | null;
  inCurrentMaster: boolean;
  isin: string | null;
  /** Internal class (includes deprecated classes for cache compat). */
  eligibilityClass: InstrumentEligibilityClass;
  /** Detailed rationale including which signals were applied. */
  reason: string;
  /** Policy reason for exclusion (null for ORDINARY_COMPANY_EQUITY_ELIGIBLE). */
  policyExclusionReason: string | null;
  /** Whether this instrument is eligible for full-NSE warehouse population. */
  warehouseEligible: boolean;
  /**
   * Classification authority level.
   *
   * AUTHORITATIVE_NSE_REFERENCE: From NSE EQUITY_L.csv series code join (only source
   *   that can produce eligibleForOrdinaryEquityScanner=true).
   * HEURISTIC_DIAGNOSTIC_ONLY: Suffix or name-pattern evidence (exclusion only).
   * UNRESOLVED: Reference unavailable, symbol absent, or not in master.
   */
  authorityLevel: ClassificationAuthority;
  /**
   * Official NSE dataset that produced this classification.
   * Non-null only for authority=AUTHORITATIVE_NSE_REFERENCE.
   */
  sourceDataset: string | null;
  /**
   * Effective date of the NSE dataset (YYYY-MM-DD).
   * Non-null only for authority=AUTHORITATIVE_NSE_REFERENCE.
   */
  sourceEffectiveDate: string | null;
  /**
   * Heuristic signals observed during classification, for audit.
   * These were NOT used to drive the final classification — they are diagnostic only.
   */
  diagnosticWarnings: string[];
  /**
   * Ordered attribute signals that contributed to this decision, for audit.
   */
  precedenceVector: string[];
  /**
   * Canonical public classification summary.
   * Use this type for all gate logic (not eligibilityClass directly).
   */
  classification: InstrumentClassification;
}

// ─── Suffix extraction (diagnostic evidence) ──────────────────────────────────

/**
 * Extract the trailing hyphenated segment from a Kite tradingsymbol.
 *
 * This is HEURISTIC_DIAGNOSTIC_ONLY evidence. The extracted suffix is meaningful
 * only when the instrument is confirmed in the current Kite master, and even then
 * it is not an official NSE series code — it is Kite's internal tradingsymbol
 * naming convention.
 *
 * Returns null for standard equities (no hyphen suffix).
 */
function extractSuffixCode(tradingsymbol: string): string | null {
  return tradingsymbol.match(/-([A-Z]+)$/)?.[1] ?? null;
}

// ─── Heuristic detection helpers (DIAGNOSTIC ONLY — may only exclude) ─────────
// All of the following are HEURISTIC_DIAGNOSTIC_ONLY. They may produce fail-closed
// exclusion results but MUST NEVER produce eligibleForOrdinaryEquityScanner=true.

function detectSovereignGoldBond(suffix: string | null, symbol: string, name: string): string[] | null {
  const s = symbol.toUpperCase(), n = name.toUpperCase();
  if (suffix === "GB") {
    const signals = ["suffix=GB (HEURISTIC: Kite tradingsymbol suffix — not an official NSE series code)"];
    if (s.startsWith("SGB")) signals.push("tradingsymbol_prefix=SGB");
    if (/GOLD\s*BOND/.test(n)) signals.push("name_pattern=GOLD_BOND");
    return signals;
  }
  if (s.startsWith("SGB") && /GOLD\s*BOND/.test(n)) {
    return ["tradingsymbol_prefix=SGB (HEURISTIC)", "name_pattern=GOLD_BOND (HEURISTIC)"];
  }
  return null;
}

function detectDebtGovSecurity(suffix: string | null, symbol: string, name: string): string[] | null {
  const n = name.toUpperCase(), s = symbol.toUpperCase();
  if (suffix === "SG") {
    const signals = ["suffix=SG (HEURISTIC: Kite tradingsymbol suffix — not an official NSE series code)"];
    if (/\bSDL\b/.test(n)) signals.push("name_contains=SDL");
    if (/\d+\.\d+%/.test(n)) signals.push("name_contains=coupon_rate_pattern");
    return signals;
  }
  if (/\bSDL\b/.test(n) && /\d+\.\d+%.*\d{4}/.test(n)) {
    return ["name_pattern=SDL_coupon_rate_year (HEURISTIC)"];
  }
  if (/^[67]\d{2}[A-Z]{2}\d{2}$/.test(s) && /\bSDL\b/.test(n)) {
    return ["symbol_pattern=coupon_rate_encoding (HEURISTIC)", "name_contains=SDL (HEURISTIC)"];
  }
  return null;
}

function detectSmeEquity(suffix: string | null): string[] | null {
  if (suffix === "ST") return ["suffix=ST (HEURISTIC: Kite tradingsymbol suffix — not an official NSE series code)"];
  if (suffix === "SM") return ["suffix=SM (HEURISTIC: Kite tradingsymbol suffix — not an official NSE series code)"];
  return null;
}

function detectBzSeries(suffix: string | null, symbol: string): string[] | null {
  if (suffix === "BZ") {
    return [
      `suffix=BZ (HEURISTIC: Kite tradingsymbol="${symbol}" — not an official NSE series code)`,
      "OHLCV_coverage_via_Kite_equity_endpoint=UNRELIABLE",
    ];
  }
  return null;
}

/**
 * Detect Real Estate Investment Trusts (REITs) and Infrastructure Investment Trusts (InvITs).
 *
 * AUTHORITY: HEURISTIC_DIAGNOSTIC_ONLY
 * NSE EQUITY_L.csv does NOT distinguish REITs/InvITs from ordinary EQ (both appear as EQ).
 * No official NSE CSV provides a programmatic REIT/InvIT registry.
 * Detection uses name patterns (trust names containing "REIT" or "INVIT") conservatively
 * for exclusion only. Cannot produce eligibleForOrdinaryEquityScanner=true.
 *
 * If name-pattern detection is deemed insufficient →
 *   BLOCKED_AUTHORITATIVE_NSE_SECURITY_TYPE_REFERENCE_INSUFFICIENT applies.
 */
function detectReitOrInvit(symbol: string, name: string): string[] | null {
  const nu = name.toUpperCase();
  if (/\bREIT\b/.test(nu)) return ["name_contains=REIT (HEURISTIC_DIAGNOSTIC_ONLY: no official NSE REIT registry CSV)"];
  if (/REAL ESTATE INVESTMENT TRUST/.test(nu)) return ["name_pattern=REAL_ESTATE_INVESTMENT_TRUST (HEURISTIC_DIAGNOSTIC_ONLY)"];
  if (/\bINVIT\b/.test(nu)) return ["name_contains=INVIT (HEURISTIC_DIAGNOSTIC_ONLY: no official NSE InvIT registry CSV)"];
  if (/INFRASTRUCTURE INVESTMENT TRUST/.test(nu)) return ["name_pattern=INFRASTRUCTURE_INVESTMENT_TRUST (HEURISTIC_DIAGNOSTIC_ONLY)"];
  if (/INVESTMENT TRUST/.test(nu) && /(?:INFRASTRUCTURE|REAL ESTATE|ROADS|HIGHWAYS|POWER GRID)/.test(nu)) {
    return ["name_pattern=INVESTMENT_TRUST_WITH_INFRASTRUCTURE_OR_REALESTATE (HEURISTIC_DIAGNOSTIC_ONLY)"];
  }
  return null;
}

/**
 * Detect partly-paid equity shares.
 *
 * AUTHORITY: HEURISTIC_DIAGNOSTIC_ONLY
 * The Kite tradingsymbol suffix "-PP" is Kite's internal naming convention — it is
 * NOT an official NSE series code from EQUITY_L.csv. "PARTLY PAID" in the instrument
 * name is a human-readable label, also not an official NSE programmatic identifier.
 *
 * May only be used for fail-closed EXCLUSION. Cannot authorize eligibility.
 */
function detectPartlyPaidEquity(suffix: string | null, symbol: string, name: string): string[] | null {
  const nu = name.toUpperCase();
  if (suffix === "PP") {
    return [`suffix=PP (HEURISTIC_DIAGNOSTIC_ONLY: Kite tradingsymbol suffix="${symbol}" — not official NSE series code)`];
  }
  if (/PARTLY[\s-]PAID/.test(nu)) {
    return ["name_pattern=PARTLY_PAID (HEURISTIC_DIAGNOSTIC_ONLY: instrument name — not an official NSE series code)"];
  }
  return null;
}

/**
 * Detect preference shares.
 *
 * AUTHORITY: HEURISTIC_DIAGNOSTIC_ONLY
 * NSE EQUITY_L.csv has no preference-share series code (both ordinary and preference
 * shares appear as EQ). Detection uses name-pattern evidence only.
 *
 * May only be used for fail-closed EXCLUSION. Cannot authorize eligibility.
 */
function detectPreferenceShare(name: string): string[] | null {
  const nu = name.toUpperCase();
  if (/\bPREFERENCE\b/.test(nu)) {
    return ["name_pattern=PREFERENCE_SHARES (HEURISTIC_DIAGNOSTIC_ONLY: NSE EQUITY_L.csv has no preference-share series code)"];
  }
  return null;
}

// ─── Canonical classification mapping ─────────────────────────────────────────

/**
 * Map an internal InstrumentEligibilityClass to the canonical InstrumentClassification.finalClass.
 */
function toFinalClass(cls: InstrumentEligibilityClass): InstrumentClassification["finalClass"] {
  switch (cls) {
    case "ORDINARY_COMPANY_EQUITY_ELIGIBLE": return "ORDINARY_COMPANY_EQUITY_ELIGIBLE";
    case "TRADE_TO_TRADE_EQUITY_POLICY_EXCLUDED": return "TRADE_TO_TRADE_EQUITY";
    case "SME_EQUITY_POLICY_EXCLUDED": return "SME_EQUITY";
    case "ETF_OR_FUND": return "ETF_OR_MUTUAL_FUND_UNIT";
    case "REIT_OR_INVIT": return "REIT_OR_INVIT";
    case "PARTLY_PAID_EQUITY": return "PARTLY_PAID_EQUITY";
    case "PREFERENCE_SHARE": return "PREFERENCE_SHARE";
    case "DEBT_GOVERNMENT_SECURITY": return "DEBT_OR_HYBRID";
    case "SOVEREIGN_GOLD_BOND": return "SOVEREIGN_GOLD_BOND";
    case "INACTIVE_OR_DELISTED": return "INACTIVE_SECURITY";
    // All others → UNRESOLVED_SECURITY_TYPE (includes deprecated classes and INDEX)
    default: return "UNRESOLVED_SECURITY_TYPE";
  }
}

// ─── Main classifier ──────────────────────────────────────────────────────────

/**
 * NSE authoritative equity reference map type.
 * Keyed by NSE tradingsymbol (uppercase). Sourced from EQUITY_L.csv.
 *
 * null = reference unavailable → all instruments fail-closed as KITE_NSE_EQ_LIKE_PROVISIONAL.
 */
export type NseSecurityReference = Map<string, {
  series: string;
  isin: string;
  dateOfListing: string;
  /** Snapshot date (YYYY-MM-DD) when this reference was fetched. */
  snapshotDate?: string;
}>;

/**
 * Classify a single NSE instrument.
 *
 * The caller MUST set `inCurrentMaster: true` only for instruments confirmed
 * present in the Kite NSE EQ instrument master fetched today.
 *
 * Classification path:
 *   1. Not in master                 → UNRESOLVED_SECURITY_TYPE   (UNRESOLVED)
 *   2. Not NSE exchange              → OTHER_UNSUPPORTED           (UNRESOLVED)
 *   3. INDEX instrument              → INDEX                       (UNRESOLVED)
 *   4. In INACTIVE_SYMBOLS           → INACTIVE_OR_DELISTED        (HEURISTIC_DIAGNOSTIC_ONLY)
 *   5. -GB suffix / SGB name         → SOVEREIGN_GOLD_BOND         (HEURISTIC_DIAGNOSTIC_ONLY)
 *   6. -SG suffix / SDL name         → DEBT_GOVERNMENT_SECURITY    (HEURISTIC_DIAGNOSTIC_ONLY)
 *   7. -ST/-SM suffix                → SME_EQUITY_POLICY_EXCLUDED  (HEURISTIC_DIAGNOSTIC_ONLY)
 *      NOTE: When nseRef available, the reference join may override this with
 *            SM/ST series → SME_EQUITY_POLICY_EXCLUDED (AUTHORITATIVE_NSE_REFERENCE).
 *   8. -BZ suffix                    → UNRESOLVED_SECURITY_TYPE    (HEURISTIC_DIAGNOSTIC_ONLY)
 *   9. REIT/InvIT name pattern       → REIT_OR_INVIT               (HEURISTIC_DIAGNOSTIC_ONLY)
 *  10. Partly-paid suffix/name       → PARTLY_PAID_EQUITY          (HEURISTIC_DIAGNOSTIC_ONLY)
 *  11. Preference name               → PREFERENCE_SHARE            (HEURISTIC_DIAGNOSTIC_ONLY)
 *  12. ETF name/symbol               → ETF_OR_FUND                 (HEURISTIC_DIAGNOSTIC_ONLY)
 *  13. EQ + NSE segment, nseRef=null → KITE_NSE_EQ_LIKE_PROVISIONAL (UNRESOLVED)
 *  14. EQ + NSE, nseRef + series=EQ  → ORDINARY_COMPANY_EQUITY_ELIGIBLE (AUTHORITATIVE_NSE_REFERENCE)
 *  15. EQ + NSE, nseRef + series=BE  → TRADE_TO_TRADE_EQUITY        (AUTHORITATIVE_NSE_REFERENCE)
 *  16. EQ + NSE, nseRef + series=SM  → SME_EQUITY_POLICY_EXCLUDED  (AUTHORITATIVE_NSE_REFERENCE)
 *  17. EQ + NSE, nseRef + not found  → UNRESOLVED_SECURITY_TYPE    (UNRESOLVED)
 *  18. All others                    → OTHER_UNSUPPORTED            (UNRESOLVED)
 */
export function classifyInstrument(opts: {
  symbol: string;
  name: string;
  instrumentType: string;
  segment: string;
  exchange: string;
  inCurrentMaster: boolean;
  isin?: string | null;
  /** Required — pass null if NSE reference unavailable → fail-closed KITE_NSE_EQ_LIKE_PROVISIONAL. */
  nseRef: NseSecurityReference | null;
}): InstrumentEligibilityResult {
  const { symbol, name, instrumentType, segment, exchange, inCurrentMaster, isin = null, nseRef } = opts;
  const su = symbol.toUpperCase();
  const suffix = extractSuffixCode(su);

  const base = {
    symbol,
    name,
    instrumentType,
    segment,
    exchange,
    seriesCode: suffix,
    inCurrentMaster,
    isin,
  };

  const attrVec: string[] = [
    `inCurrentMaster=${inCurrentMaster}`,
    `exchange=${exchange}`,
    `segment=${segment}`,
    `instrument_type=${instrumentType}`,
    `suffix=${suffix ?? "(none)"}`,
  ];
  if (isin) attrVec.push(`isin=${isin}`);

  function makeResult(
    eligibilityClass: InstrumentEligibilityClass,
    authority: ClassificationAuthority,
    reason: string,
    policyExclusionReason: string | null,
    precedenceVector: string[],
    overrides: {
      sourceDataset?: string | null;
      sourceEffectiveDate?: string | null;
      diagnosticWarnings?: string[];
    } = {},
  ): InstrumentEligibilityResult {
    const warehouseEligible = !WAREHOUSE_EXCLUDED_CLASSES.has(eligibilityClass);
    const sourceDataset = overrides.sourceDataset ?? null;
    const sourceEffectiveDate = overrides.sourceEffectiveDate ?? null;
    const diagnosticWarnings = overrides.diagnosticWarnings ?? [];

    // Derive a short reasonCode from the precedence vector
    const decisionTag = precedenceVector.find(v => v.startsWith("decision="))?.replace("decision=", "") ?? eligibilityClass;

    const classification: InstrumentClassification = {
      finalClass: toFinalClass(eligibilityClass),
      authority,
      eligibleForOrdinaryEquityScanner: warehouseEligible && authority === "AUTHORITATIVE_NSE_REFERENCE",
      sourceDataset,
      sourceEffectiveDate,
      reasonCode: decisionTag,
      diagnosticWarnings,
    };

    return {
      ...base,
      eligibilityClass,
      reason,
      policyExclusionReason,
      warehouseEligible,
      authorityLevel: authority,
      sourceDataset,
      sourceEffectiveDate,
      diagnosticWarnings,
      precedenceVector,
      classification,
    };
  }

  // ── 1. Authoritative source requirement ───────────────────────────────────
  if (!inCurrentMaster) {
    return makeResult(
      "UNRESOLVED_SECURITY_TYPE",
      "UNRESOLVED",
      `Instrument not present in current Kite NSE EQ instrument master (inCurrentMaster=false). ` +
        `Symbol suffix "${suffix ?? "(none)"}" is HEURISTIC_DIAGNOSTIC_ONLY and cannot independently ` +
        `authorize a classification. Without an authoritative master record, the instrument fails ` +
        `closed as UNRESOLVED_SECURITY_TYPE.`,
      "Not present in the current Kite NSE EQ instrument master. A dated NSE security-master " +
        "record joined via instrument_token, ISIN, exchange, segment, and series/security type " +
        "is required before this instrument can receive an affirmative eligibility verdict.",
      [...attrVec, "decision=UNRESOLVED_BY_ABSENT_FROM_MASTER"],
    );
  }

  // ── 2. Exchange check ──────────────────────────────────────────────────────
  if (exchange !== "NSE") {
    return makeResult(
      "OTHER_UNSUPPORTED",
      "UNRESOLVED",
      `Non-NSE exchange "${exchange}"; only NSE main-board instruments are supported`,
      "Exchange is not NSE; excluded from NSE warehouse population.",
      [...attrVec, "decision=OTHER_UNSUPPORTED_BY_EXCHANGE"],
    );
  }

  // ── 3. Index instruments ───────────────────────────────────────────────────
  if (instrumentType === "INDEX" || segment === "INDICES") {
    return makeResult(
      "INDEX",
      "UNRESOLVED",
      `Index instrument: ${attrVec.join(", ")}`,
      "Index instruments are not tradeable equities; no individual equity candle series exists.",
      [...attrVec, "decision=INDEX_BY_INSTRUMENT_TYPE_OR_SEGMENT"],
    );
  }

  // ── 4. Inactive / delisted ────────────────────────────────────────────────
  if (INACTIVE_SYMBOLS.has(su)) {
    return makeResult(
      "INACTIVE_OR_DELISTED",
      "HEURISTIC_DIAGNOSTIC_ONLY",
      `In INACTIVE_SYMBOLS curated-exclude set: ${su}`,
      "Delisted or suspended instruments produce stale or empty candle series.",
      [...attrVec, "decision=INACTIVE_OR_DELISTED_BY_INACTIVE_SYMBOLS"],
      { diagnosticWarnings: ["INACTIVE_SYMBOLS curated set (HEURISTIC_DIAGNOSTIC_ONLY: maintained internally, not an official NSE publication)"] },
    );
  }

  // ── 5. Sovereign Gold Bonds (suffix=GB, SGB prefix) ───────────────────────
  // AUTHORITY: HEURISTIC_DIAGNOSTIC_ONLY (suffix is Kite convention, not official NSE series code)
  const sgb = detectSovereignGoldBond(suffix, symbol, name);
  if (sgb) {
    return makeResult(
      "SOVEREIGN_GOLD_BOND",
      "HEURISTIC_DIAGNOSTIC_ONLY",
      `Sovereign Gold Bond — heuristic-diagnostic-only exclusion: ${sgb.join("; ")}. ` +
        `Authority: HEURISTIC_DIAGNOSTIC_ONLY — Kite tradingsymbol suffix "-GB" is not an ` +
        `official NSE series code. Used for conservative fail-closed exclusion only.`,
      "RBI Sovereign Gold Bonds are debt instruments; the Kite Historical Data API equity " +
        "endpoint returns no OHLCV data for them. Excluded as heuristic diagnostic.",
      [...attrVec, ...sgb, "authority=HEURISTIC_DIAGNOSTIC_ONLY", "decision=SOVEREIGN_GOLD_BOND"],
      { diagnosticWarnings: sgb },
    );
  }

  // ── 6. SDL bonds / Government Securities (suffix=SG) ─────────────────────
  // AUTHORITY: HEURISTIC_DIAGNOSTIC_ONLY (suffix is Kite convention)
  const debt = detectDebtGovSecurity(suffix, symbol, name);
  if (debt) {
    return makeResult(
      "DEBT_GOVERNMENT_SECURITY",
      "HEURISTIC_DIAGNOSTIC_ONLY",
      `Government/SDL debt security — heuristic-diagnostic-only exclusion: ${debt.join("; ")}. ` +
        `Authority: HEURISTIC_DIAGNOSTIC_ONLY — Kite tradingsymbol suffix "-SG" is not an ` +
        `official NSE series code.`,
      "State Development Loans and G-Secs are debt instruments. The Kite Historical Data API " +
        "equity endpoint returns empty OHLCV series for SDL/G-Sec symbols — no OHLCV data exists. " +
        "Excluded as HEURISTIC_DIAGNOSTIC_ONLY.",
      [...attrVec, ...debt, "authority=HEURISTIC_DIAGNOSTIC_ONLY", "decision=DEBT_GOVERNMENT_SECURITY"],
      { diagnosticWarnings: debt },
    );
  }

  // ── 7. SME segment heuristic (suffix=ST / suffix=SM) ──────────────────────
  // AUTHORITY: HEURISTIC_DIAGNOSTIC_ONLY (suffix is Kite convention)
  // NOTE: The NSE reference join (step 14+) may override this with an authoritative
  // SME classification if the symbol appears in EQUITY_L.csv with series=SM/ST.
  // This step fires only when nseRef is unavailable for the heuristic-first path.
  const sme = detectSmeEquity(suffix);
  if (sme && !nseRef) {
    // Only use heuristic when no authoritative reference is available
    return makeResult(
      "SME_EQUITY_POLICY_EXCLUDED",
      "HEURISTIC_DIAGNOSTIC_ONLY",
      `SME-segment instrument — heuristic-diagnostic-only exclusion (no NSE ref available): ${sme.join("; ")}. ` +
        `Authority: HEURISTIC_DIAGNOSTIC_ONLY — Kite suffix is not an official NSE series code. ` +
        `When NSE reference is available, the authoritative series code takes precedence.`,
      "SME-platform stocks under different trading rules. Excluded as heuristic diagnostic.",
      [...attrVec, ...sme, "authority=HEURISTIC_DIAGNOSTIC_ONLY", "decision=SME_EQUITY_POLICY_EXCLUDED_HEURISTIC"],
      { diagnosticWarnings: sme },
    );
  }

  // ── 8. BZ series (suffix=BZ) ──────────────────────────────────────────────
  // AUTHORITY: HEURISTIC_DIAGNOSTIC_ONLY
  const bz = detectBzSeries(suffix, symbol);
  if (bz) {
    return makeResult(
      "UNRESOLVED_SECURITY_TYPE",
      "HEURISTIC_DIAGNOSTIC_ONLY",
      `Cross-listed BSZ-settlement instrument — heuristic-diagnostic-only exclusion: ${bz.join("; ")}. ` +
        `OHLCV coverage via the Kite Historical Data API equity endpoint is unreliable.`,
      "BZ-series instruments return empty or inconsistent OHLCV series from Kite equity endpoint. " +
        "Excluded until a separate Kite bond/hybrid data integration provides authoritative coverage.",
      [...attrVec, ...bz, "authority=HEURISTIC_DIAGNOSTIC_ONLY", "decision=UNRESOLVED_SECURITY_TYPE_BY_BZ_SERIES"],
      { diagnosticWarnings: bz },
    );
  }

  // ── 9. REIT / InvIT ───────────────────────────────────────────────────────
  // AUTHORITY: HEURISTIC_DIAGNOSTIC_ONLY
  // Applied before NSE reference join: REITs appear in EQUITY_L.csv with series=EQ,
  // so the series check alone is insufficient to exclude them.
  const reit = detectReitOrInvit(symbol, name);
  if (reit) {
    return makeResult(
      "REIT_OR_INVIT",
      "HEURISTIC_DIAGNOSTIC_ONLY",
      `REIT or InvIT (trust-structured) — heuristic-diagnostic-only exclusion: ${reit.join("; ")}. ` +
        `Authority: HEURISTIC_DIAGNOSTIC_ONLY — NSE EQUITY_L.csv does NOT distinguish REIT from ` +
        `ordinary EQ (both appear as EQ). No official NSE CSV REIT registry is available.`,
      "Real Estate Investment Trusts (REITs) and Infrastructure Investment Trusts (InvITs) are " +
        "trust-structured, not ordinary corporate equity. Excluded as HEURISTIC_DIAGNOSTIC_ONLY.",
      [...attrVec, ...reit, "authority=HEURISTIC_DIAGNOSTIC_ONLY", "decision=REIT_OR_INVIT"],
      { diagnosticWarnings: reit },
    );
  }

  // ── 10. Partly-paid equity shares ─────────────────────────────────────────
  // AUTHORITY: HEURISTIC_DIAGNOSTIC_ONLY (suffix and name are not official NSE series codes)
  const pp = detectPartlyPaidEquity(suffix, symbol, name);
  if (pp) {
    return makeResult(
      "PARTLY_PAID_EQUITY",
      "HEURISTIC_DIAGNOSTIC_ONLY",
      `Partly-paid equity share — heuristic-diagnostic-only exclusion: ${pp.join("; ")}. ` +
        `Authority: HEURISTIC_DIAGNOSTIC_ONLY — Kite tradingsymbol suffix "-PP" is Kite's ` +
        `internal naming convention, not an official NSE series code. "PARTLY PAID" in name ` +
        `is a human-readable label, also not an official NSE programmatic identifier.`,
      "Partly-paid shares have different trading rights and price behaviour from fully paid shares. " +
        "Excluded as HEURISTIC_DIAGNOSTIC_ONLY.",
      [...attrVec, ...pp, "authority=HEURISTIC_DIAGNOSTIC_ONLY", "decision=PARTLY_PAID_EQUITY"],
      { diagnosticWarnings: pp },
    );
  }

  // ── 11. Preference shares ─────────────────────────────────────────────────
  // AUTHORITY: HEURISTIC_DIAGNOSTIC_ONLY (name pattern — no official NSE series code)
  const pref = detectPreferenceShare(name);
  if (pref) {
    return makeResult(
      "PREFERENCE_SHARE",
      "HEURISTIC_DIAGNOSTIC_ONLY",
      `Preference share — heuristic-diagnostic-only exclusion: ${pref.join("; ")}. ` +
        `Authority: HEURISTIC_DIAGNOSTIC_ONLY — NSE EQUITY_L.csv has no preference-share series code.`,
      "Preference shares have different dividend priority and voting rights. " +
        "Excluded as HEURISTIC_DIAGNOSTIC_ONLY.",
      [...attrVec, ...pref, "authority=HEURISTIC_DIAGNOSTIC_ONLY", "decision=PREFERENCE_SHARE"],
      { diagnosticWarnings: pref },
    );
  }

  // ── 12. ETF / Fund ────────────────────────────────────────────────────────
  // AUTHORITY: HEURISTIC_DIAGNOSTIC_ONLY (name/symbol patterns)
  if (centralLooksLikeEtf(symbol, name)) {
    const etfSignals: string[] = [];
    const nu = name.toUpperCase();
    if (/BEES$/.test(su)) etfSignals.push("tradingsymbol_suffix=BEES (HEURISTIC_DIAGNOSTIC_ONLY)");
    if (/ETF/.test(su)) etfSignals.push("tradingsymbol_contains=ETF (HEURISTIC_DIAGNOSTIC_ONLY)");
    if (/\bETF\b/.test(nu)) etfSignals.push("name_contains=ETF (HEURISTIC_DIAGNOSTIC_ONLY)");
    if (/EXCHANGE\s+TRADED/.test(nu)) etfSignals.push("name_pattern=EXCHANGE_TRADED (HEURISTIC_DIAGNOSTIC_ONLY)");
    if (etfSignals.length === 0) etfSignals.push("centralLooksLikeEtf=true (HEURISTIC_DIAGNOSTIC_ONLY)");
    return makeResult(
      "ETF_OR_FUND",
      "HEURISTIC_DIAGNOSTIC_ONLY",
      `Exchange-traded fund or index fund — heuristic-diagnostic-only exclusion: ${etfSignals.join("; ")}`,
      "ETFs track indices/baskets and have no single-stock candle history. " +
        "Excluded as HEURISTIC_DIAGNOSTIC_ONLY.",
      [...attrVec, ...etfSignals, "authority=HEURISTIC_DIAGNOSTIC_ONLY", "decision=ETF_OR_FUND"],
      { diagnosticWarnings: etfSignals },
    );
  }

  // ── 13–18. NSE reference-confirmed classification ─────────────────────────
  // Reaches here for: inCurrentMaster=true + exchange=NSE + no heuristic exclusion.
  // The NSE reference join is the ONLY source of AUTHORITATIVE_NSE_REFERENCE.
  if (instrumentType === "EQ" && segment === "NSE") {

    // 13. nseRef=null: NSE reference unavailable → fail closed.
    if (!nseRef) {
      return makeResult(
        "KITE_NSE_EQ_LIKE_PROVISIONAL",
        "UNRESOLVED",
        `Kite master confirms instrument_type=EQ, segment=NSE, exchange=NSE for ${su}, ` +
          `but NSE authoritative reference (EQUITY_L.csv) was not loaded. ` +
          `Cannot confirm ordinary main-board equity without reference join. ` +
          `Classified as KITE_NSE_EQ_LIKE_PROVISIONAL — prices displayed for informational purposes; ` +
          `CANNOT drive breadth, rankings, signals, market mood or trade actions.`,
        "NSE authoritative reference (EQUITY_L.csv) unavailable. " +
          "Cannot confirm security type without reference join. Re-classified once reference loads.",
        [...attrVec, "nseRef=UNAVAILABLE", "authority=UNRESOLVED", "decision=KITE_NSE_EQ_LIKE_PROVISIONAL"],
      );
    }

    // 14. NSE reference loaded → join by symbol.
    const nseRecord = nseRef.get(su);
    if (!nseRecord) {
      return makeResult(
        "UNRESOLVED_SECURITY_TYPE",
        "UNRESOLVED",
        `Symbol ${su} is in the Kite EQ master (instrument_type=EQ, segment=NSE) but ` +
          `NOT found in the NSE EQUITY_L.csv reference. ` +
          `Cannot authoritatively confirm security type. Fails closed as UNRESOLVED_SECURITY_TYPE.`,
        "Symbol absent from NSE EQUITY_L.csv — cannot authoritatively classify. " +
          "May be a recently-listed security, a corporate action artefact, or a Kite master discrepancy.",
        [...attrVec, "nseRef=NOT_FOUND", "authority=UNRESOLVED", "decision=UNRESOLVED_SECURITY_TYPE"],
      );
    }

    // Symbol found in NSE reference — classify by the official NSE series code.
    // THIS IS THE ONLY PATH TO AUTHORITATIVE_NSE_REFERENCE CLASSIFICATION.
    const nseSeriesU = nseRecord.series.toUpperCase().trim();
    const isinTag = nseRecord.isin ? `isin=${nseRecord.isin}` : "isin=N/A";
    const listingTag = nseRecord.dateOfListing ? `dateOfListing=${nseRecord.dateOfListing}` : "";
    const nseSnapshotDate = (nseRecord as { snapshotDate?: string }).snapshotDate ?? null;
    const nseAttr = [`nseRef.series=${nseSeriesU}`, isinTag, listingTag].filter(Boolean);

    // Collect any heuristic signals that would have fired but are overridden by the authoritative join
    const heuristicWarnings: string[] = [];
    if (sme) heuristicWarnings.push(...sme); // SME suffix but reference says EQ? Flag it.

    if (nseSeriesU === "EQ") {
      // Only ORDINARY_COMPANY_EQUITY_ELIGIBLE can produce eligibleForOrdinaryEquityScanner=true.
      return makeResult(
        "ORDINARY_COMPANY_EQUITY_ELIGIBLE",
        "AUTHORITATIVE_NSE_REFERENCE",
        `NSE EQUITY_L.csv authoritatively confirms ordinary main-board equity: ` +
          `symbol=${su}, ${nseAttr.join(", ")}. ` +
          `Authority: AUTHORITATIVE_NSE_REFERENCE — from official NSE EQUITY_L.csv series=EQ join. ` +
          `Eligible for breadth, rankings, signals, and trade actions.`,
        null,
        [...attrVec, ...nseAttr, "authority=AUTHORITATIVE_NSE_REFERENCE", "decision=ORDINARY_COMPANY_EQUITY_ELIGIBLE"],
        {
          sourceDataset: "NSE:EQUITY_L.csv",
          sourceEffectiveDate: nseSnapshotDate,
          diagnosticWarnings: heuristicWarnings,
        },
      );
    }

    if (nseSeriesU === "BE" || nseSeriesU === "BT") {
      return makeResult(
        "TRADE_TO_TRADE_EQUITY_POLICY_EXCLUDED",
        "AUTHORITATIVE_NSE_REFERENCE",
        `NSE EQUITY_L.csv confirms Trade-to-Trade equity: ${nseAttr.join(", ")}. ` +
          `Authority: AUTHORITATIVE_NSE_REFERENCE — official NSE EQUITY_L.csv series=${nseSeriesU}.`,
        "Trade-to-Trade (T2T) stocks must be delivered — no intraday squaring. " +
          "Excluded from warehouse and scanner until explicit T2T policy defined.",
        [...attrVec, ...nseAttr, "authority=AUTHORITATIVE_NSE_REFERENCE", "decision=TRADE_TO_TRADE_EQUITY_POLICY_EXCLUDED"],
        { sourceDataset: "NSE:EQUITY_L.csv", sourceEffectiveDate: nseSnapshotDate },
      );
    }

    if (nseSeriesU === "SM" || nseSeriesU === "ST") {
      return makeResult(
        "SME_EQUITY_POLICY_EXCLUDED",
        "AUTHORITATIVE_NSE_REFERENCE",
        `NSE EQUITY_L.csv confirms SME equity: ${nseAttr.join(", ")}. ` +
          `Authority: AUTHORITATIVE_NSE_REFERENCE — official NSE EQUITY_L.csv series=${nseSeriesU}.`,
        "SME-platform stocks (NSE Emerge) have different trading rules and thinner liquidity; excluded from warehouse.",
        [...attrVec, ...nseAttr, "authority=AUTHORITATIVE_NSE_REFERENCE", "decision=SME_EQUITY_POLICY_EXCLUDED"],
        { sourceDataset: "NSE:EQUITY_L.csv", sourceEffectiveDate: nseSnapshotDate },
      );
    }

    // Other NSE series (BL, N1-N9, etc.) — authoritative but not ordinary main-board equity.
    return makeResult(
      "OTHER_UNSUPPORTED",
      "AUTHORITATIVE_NSE_REFERENCE",
      `NSE EQUITY_L.csv shows series=${nseSeriesU} for ${su}, ` +
        `which is not an ordinary main-board equity series (EQ). ` +
        `${nseAttr.join(", ")}. Excluded as OTHER_UNSUPPORTED.`,
      `NSE EQUITY_L.csv series=${nseSeriesU} is not ordinary main-board equity (EQ). ` +
        `Not eligible for warehouse population.`,
      [...attrVec, ...nseAttr, "authority=AUTHORITATIVE_NSE_REFERENCE", "decision=OTHER_UNSUPPORTED_BY_NSE_SERIES"],
      { sourceDataset: "NSE:EQUITY_L.csv", sourceEffectiveDate: nseSnapshotDate },
    );
  }

  // ── 19. All other combinations → fail closed ────────────────────────────
  return makeResult(
    "OTHER_UNSUPPORTED",
    "UNRESOLVED",
    `Instrument does not match any affirmatively defined category: ` +
      `${attrVec.join(", ")}. Missing or conflicting metadata fails closed.`,
    "Cannot be classified as ORDINARY_COMPANY_EQUITY_ELIGIBLE — one or more required attributes " +
      "(exchange=NSE, segment=NSE, instrument_type=EQ) are missing or unexpected.",
    [...attrVec, "authority=UNRESOLVED", "decision=OTHER_UNSUPPORTED_FAIL_CLOSED"],
  );
}

/**
 * Classify a batch of instruments.
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
