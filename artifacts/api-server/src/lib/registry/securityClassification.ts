/**
 * PHASE 0.6 — CLOSED SECURITY CLASSIFICATION AND ELIGIBILITY TIERS
 *
 * Classification comes from OFFICIAL EXCHANGE FIELDS ONLY. Every rule in this
 * file cites the official field it reads. There is no name matching, no
 * search-engine knowledge, and no "the letter looks like X" inference.
 *
 * WHY THIS FILE IS SEPARATE FROM THE PROVIDER MASTER
 * --------------------------------------------------
 * Kite's `instrument_type` is `EQ` for ALL 10,026 NSE rows and ALL 12,760 BSE
 * rows in the provider dump (OBSERVED 2026-08-12). It is `EQ` for government
 * securities, treasury bills, sovereign gold bonds and corporate debt alike.
 * The provider master therefore cannot classify anything; it supplies tokens
 * and nothing else.
 *
 * OFFICIAL EVIDENCE BEHIND THE NON-OBVIOUS BSE RULES (OBSERVED 2026-08-12)
 * -----------------------------------------------------------------------
 * These three rules are the ones most likely to be got wrong by guessing from
 * the group letter, so each is pinned to a field, not a letter:
 *
 *   • group `R` is RIGHTS ENTITLEMENT, not "ordinary". Evidence: the official
 *     `Segment` field is BLANK for all 539 group-R rows, and blank `Segment`
 *     occurs for NO other group — a perfect, exclusive correlation. 419 of
 *     them additionally carry a `-RE` scrip_id suffix. We require BOTH
 *     official signals (group R AND blank Segment) so a future group-R row
 *     that is genuinely segment-qualified is not silently mislabelled.
 *     (A tempting ISIN rule — "positions 9-10 == 20" — was TESTED AND
 *     REJECTED: it matches 0 of the 536 suspended rights rows.)
 *
 *   • group `IP` is ORDINARY EQUITY, not REIT/InvIT. Evidence: the three
 *     active IP rows are HASJUICE, WEBSL and ADHIRAJ, each `Segment=Equity`
 *     with an ordinary `INE…01…` company ISIN. Reading "IP" as "InvIT/Property"
 *     would misclassify three ordinary companies.
 *
 *   • group `P` is EQUITY when the official `Segment` says `Equity`, NOT a
 *     preference share. Evidence: all 55 active P rows carry `Segment=Equity`
 *     and ordinary company ISINs. PREFERENCE_SHARE is therefore only ever
 *     assigned on explicit authoritative evidence, which this dataset does not
 *     supply — so in practice it is never assigned here.
 *
 * ISIN prefix `INF` is the official fund/ETF issuer prefix and overrides the
 * group, because a fund listed in an equity group is still a fund.
 */

/**
 * Closed security classification set. A record is UNRESOLVED whenever the
 * official evidence does not determine the class — never "probably ordinary".
 */
export type RegistrySecurityClass =
  | "NSE_ORDINARY_EQUITY_EQ"
  | "NSE_TRADE_TO_TRADE_BE"
  | "NSE_SURVEILLANCE_BZ"
  | "NSE_SME_SM"
  | "NSE_SME_ST"
  | "NSE_SME_SZ"
  | "NSE_REIT_RR"
  | "NSE_INVIT_IV"
  | "NSE_PARTLY_PAID_E1"
  | "BSE_ORDINARY_EQUITY"
  | "BSE_TRADE_TO_TRADE"
  | "BSE_SME"
  | "BSE_EQUITY_SERIES_P"
  | "RIGHTS_ENTITLEMENT"
  | "ETF_OR_FUND"
  | "PREFERENCE_SHARE"
  | "REIT"
  | "INVIT"
  | "GOVERNMENT_SECURITY"
  | "SOVEREIGN_GOLD_BOND"
  | "CORPORATE_DEBT"
  | "SUSPENDED"
  | "DELISTED"
  | "INDEX"
  | "UNRESOLVED";

export const ALL_SECURITY_CLASSES: readonly RegistrySecurityClass[] = [
  "NSE_ORDINARY_EQUITY_EQ",
  "NSE_TRADE_TO_TRADE_BE",
  "NSE_SURVEILLANCE_BZ",
  "NSE_SME_SM",
  "NSE_SME_ST",
  "NSE_SME_SZ",
  "NSE_REIT_RR",
  "NSE_INVIT_IV",
  "NSE_PARTLY_PAID_E1",
  "BSE_ORDINARY_EQUITY",
  "BSE_TRADE_TO_TRADE",
  "BSE_SME",
  "BSE_EQUITY_SERIES_P",
  "RIGHTS_ENTITLEMENT",
  "ETF_OR_FUND",
  "PREFERENCE_SHARE",
  "REIT",
  "INVIT",
  "GOVERNMENT_SECURITY",
  "SOVEREIGN_GOLD_BOND",
  "CORPORATE_DEBT",
  "SUSPENDED",
  "DELISTED",
  "INDEX",
  "UNRESOLVED",
] as const;

/** Exactly one primary tier per record. */
export type EligibilityTier =
  | "LIVE_REQUIRED"
  | "SNAPSHOT_ONLY"
  | "UNAVAILABLE"
  | "EXCLUDED_NON_STOCK"
  | "UNRESOLVED";

export const ALL_ELIGIBILITY_TIERS: readonly EligibilityTier[] = [
  "LIVE_REQUIRED",
  "SNAPSHOT_ONLY",
  "UNAVAILABLE",
  "EXCLUDED_NON_STOCK",
  "UNRESOLVED",
] as const;

export type RegistryListingStatus = "ACTIVE" | "SUSPENDED" | "DELISTED" | "UNKNOWN";

// ── NSE ──────────────────────────────────────────────────────────────────────

/**
 * NSE series → class, from the official `SERIES` column of EQUITY_L.csv /
 * SME_EQUITY_L.csv. The series column IS the exchange's own classification;
 * this is a lookup, not an inference.
 */
const NSE_SERIES_CLASS: Readonly<Record<string, RegistrySecurityClass>> = {
  EQ: "NSE_ORDINARY_EQUITY_EQ",
  BE: "NSE_TRADE_TO_TRADE_BE",
  BZ: "NSE_SURVEILLANCE_BZ",
  SM: "NSE_SME_SM",
  ST: "NSE_SME_ST",
  SZ: "NSE_SME_SZ",
  RR: "NSE_REIT_RR",
  IV: "NSE_INVIT_IV",
  E1: "NSE_PARTLY_PAID_E1",
};

/** Unknown series stays UNRESOLVED. Never defaulted to ordinary equity. */
export function classifyNseOfficialSeries(series: string): RegistrySecurityClass {
  const s = typeof series === "string" ? series.trim().toUpperCase() : "";
  return NSE_SERIES_CLASS[s] ?? "UNRESOLVED";
}

// ── BSE ──────────────────────────────────────────────────────────────────────

/** BSE groups the exchange operates as trade-to-trade / restricted settlement. */
const BSE_T2T_GROUPS = new Set(["T", "XT", "TS", "ZP"]);
/** BSE groups the exchange operates as its SME platform. */
const BSE_SME_GROUPS = new Set(["M", "MT", "MS"]);
/** BSE groups that are ordinary rolling-settlement equity. `IP` included on evidence. */
const BSE_ORDINARY_GROUPS = new Set(["A", "B", "X", "Z", "Y", "IP"]);

export interface BseOfficialRow {
  /** Official `SCRIP_CD`. Joins EXACTLY to Kite `exchange_token`. */
  readonly scripCode: string;
  readonly scripId: string;
  readonly scripName: string;
  /** Official `GROUP`. */
  readonly group: string;
  /** Official `Segment`. BLANK is itself meaningful evidence (rights). */
  readonly segment: string;
  /** Official `ISIN_NUMBER`; may be absent or the literal string "NA". */
  readonly isin: string | null;
  /** Official `Status`. */
  readonly status: "Active" | "Suspended";
}

export interface BseClassification {
  readonly securityClass: RegistrySecurityClass;
  /** The official field(s) the decision rests on. Recorded for audit. */
  readonly evidence: string;
}

/**
 * Classify a BSE record from official fields only.
 *
 * Order matters: rights and fund detection must precede group handling,
 * because a rights line or a fund can appear inside an equity group.
 */
export function classifyBseOfficialRow(row: BseOfficialRow): BseClassification {
  const group = (row.group ?? "").trim().toUpperCase();
  const segment = (row.segment ?? "").trim();
  const isin = normalizeIsin(row.isin);

  // 1. Rights entitlement — TWO official signals required.
  if (group === "R" && segment === "") {
    return {
      securityClass: "RIGHTS_ENTITLEMENT",
      evidence: "official GROUP=R AND official Segment is blank",
    };
  }

  // 2. Fund/ETF by official ISIN issuer prefix; overrides the group.
  if (isin !== null && isin.startsWith("INF")) {
    return {
      securityClass: "ETF_OR_FUND",
      evidence: `official ISIN issuer prefix INF (${isin})`,
    };
  }

  // 3. Preference shares, declared by the exchange in the official `Segment`
  //    field — NOT inferred from the group letter. (OBSERVED 2026-08-12: the
  //    four `Segment=PreferenceShares` rows are groups P, Y, Y and P, so the
  //    letter is worthless here and the segment is decisive.)
  if (segment.replace(/\s+/g, "").toUpperCase() === "PREFERENCESHARES") {
    return {
      securityClass: "PREFERENCE_SHARE",
      evidence: `official Segment=${segment} (group letter ${group} is not the authority)`,
    };
  }

  // Beyond this point the exchange must have declared an equity segment.
  // Without it we do not know what the instrument is, and we say so.
  if (segment.toUpperCase() !== "EQUITY") {
    return {
      securityClass: "UNRESOLVED",
      evidence: `official Segment is ${segment === "" ? "blank" : `"${segment}"`}, not Equity`,
    };
  }

  if (BSE_SME_GROUPS.has(group)) {
    return { securityClass: "BSE_SME", evidence: `official GROUP=${group} (BSE SME platform), Segment=Equity` };
  }
  if (BSE_T2T_GROUPS.has(group)) {
    return {
      securityClass: "BSE_TRADE_TO_TRADE",
      evidence: `official GROUP=${group} (trade-to-trade settlement), Segment=Equity`,
    };
  }
  if (group === "P") {
    // Classified as EQUITY on the official segment, NOT as preference on the letter.
    return {
      securityClass: "BSE_EQUITY_SERIES_P",
      evidence: "official Segment=Equity (group letter P alone proves nothing)",
    };
  }
  if (BSE_ORDINARY_GROUPS.has(group)) {
    return {
      securityClass: "BSE_ORDINARY_EQUITY",
      evidence: `official GROUP=${group}, Segment=Equity`,
    };
  }

  return { securityClass: "UNRESOLVED", evidence: `unmapped official GROUP=${group}` };
}

/**
 * Official ISIN or null. BSE emits both "" and the literal "NA" for absent
 * ISINs; both mean "the exchange did not publish one" and must stay null.
 * An ISIN is NEVER reconstructed.
 */
export function normalizeIsin(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toUpperCase();
  if (s === "" || s === "NA" || s === "N.A." || s === "-") return null;
  if (s.length !== 12) return null;
  return s;
}

// ── Eligibility tiers ────────────────────────────────────────────────────────

/**
 * Classes the owner has approved for live subscription. Membership here is a
 * POLICY statement about the security, independent of whether a provider token
 * happens to exist — see the note on mapping below.
 */
const LIVE_REQUIRED_CLASSES = new Set<RegistrySecurityClass>([
  "NSE_ORDINARY_EQUITY_EQ",
  "NSE_TRADE_TO_TRADE_BE",
  "NSE_SURVEILLANCE_BZ",
  "NSE_SME_SM",
  "NSE_SME_ST",
  "NSE_SME_SZ",
  "NSE_REIT_RR",
  "NSE_INVIT_IV",
  "NSE_PARTLY_PAID_E1",
  "BSE_ORDINARY_EQUITY",
  "BSE_TRADE_TO_TRADE",
  "BSE_SME",
  "BSE_EQUITY_SERIES_P",
  "INDEX",
]);

const NON_STOCK_CLASSES = new Set<RegistrySecurityClass>([
  "GOVERNMENT_SECURITY",
  "SOVEREIGN_GOLD_BOND",
  "CORPORATE_DEBT",
]);

export interface TierInput {
  readonly securityClass: RegistrySecurityClass;
  readonly listingStatus: RegistryListingStatus;
}

export interface TierDecision {
  readonly tier: EligibilityTier;
  readonly reason: string;
}

/**
 * Assign exactly one primary tier.
 *
 * DELIBERATE CONTRACT NOTE — tier is a POLICY tier, not a mapping outcome.
 * A LIVE_REQUIRED security with no provider token stays LIVE_REQUIRED and is
 * counted as "unmapped live". Section F of the directive requires
 * `LIVE_REQUIRED official = mapped LIVE_REQUIRED + unmapped LIVE_REQUIRED`,
 * an equation that is only meaningful if unmapped records remain inside the
 * LIVE_REQUIRED tier (its own baseline of 2,972 official vs 2,971 mapped
 * describes exactly one such record). Demoting unmapped records to UNAVAILABLE
 * would force that difference to zero permanently and hide the gap the
 * equation exists to expose. Mapping is reported by `mappingStatus`, never by
 * silently moving the record to another tier.
 */
export function assignEligibilityTier(input: TierInput): TierDecision {
  const { securityClass, listingStatus } = input;

  if (listingStatus === "SUSPENDED") {
    return { tier: "UNAVAILABLE", reason: "official listing status is SUSPENDED" };
  }
  if (listingStatus === "DELISTED") {
    return { tier: "UNAVAILABLE", reason: "official listing status is DELISTED" };
  }
  if (securityClass === "UNRESOLVED") {
    return { tier: "UNRESOLVED", reason: "authoritative classification incomplete" };
  }
  if (securityClass === "RIGHTS_ENTITLEMENT") {
    return { tier: "UNAVAILABLE", reason: "rights entitlement — not separately authorized for live data" };
  }
  if (NON_STOCK_CLASSES.has(securityClass)) {
    return { tier: "EXCLUDED_NON_STOCK", reason: `non-equity cash-segment instrument (${securityClass})` };
  }
  if (securityClass === "ETF_OR_FUND") {
    return { tier: "SNAPSHOT_ONLY", reason: "ETF/fund — snapshot tier under current owner policy" };
  }
  if (securityClass === "PREFERENCE_SHARE" || securityClass === "REIT" || securityClass === "INVIT") {
    // Reachable only with explicit authoritative evidence, which the currently
    // ingested masters do not supply. Kept honest rather than forced live.
    return { tier: "UNRESOLVED", reason: `${securityClass} has no approved tier policy yet` };
  }
  if (securityClass === "SUSPENDED" || securityClass === "DELISTED") {
    return { tier: "UNAVAILABLE", reason: `security class is ${securityClass}` };
  }
  if (LIVE_REQUIRED_CLASSES.has(securityClass)) {
    return { tier: "LIVE_REQUIRED", reason: `owner-approved live class ${securityClass}` };
  }
  return { tier: "UNRESOLVED", reason: `class ${securityClass} has no tier rule` };
}

/** Invariant guard: nothing unresolved or unavailable may claim LIVE_REQUIRED. */
export function violatesLiveTierInvariant(
  tier: EligibilityTier,
  securityClass: RegistrySecurityClass,
  listingStatus: RegistryListingStatus,
): boolean {
  if (tier !== "LIVE_REQUIRED") return false;
  if (securityClass === "UNRESOLVED") return true;
  if (listingStatus === "SUSPENDED" || listingStatus === "DELISTED") return true;
  return !LIVE_REQUIRED_CLASSES.has(securityClass);
}
