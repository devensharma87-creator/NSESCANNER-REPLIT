/**
 * PHASE 0.6 — AUTHORITATIVE INSTRUMENT REGISTRY
 *
 * Builds one reconciled registry record per OFFICIAL exchange security, then
 * maps each to a provider token by an EXACT, proven-unique join. This enriches
 * the accepted Phase 0.5A runtime identity (`canonicalInstrument.ts`) — it does
 * not replace it, and it does not collapse the exchange distinction.
 *
 * THE TWO JOINS, AND WHY THEY ARE THE WAY THEY ARE
 * ------------------------------------------------
 * NSE: Kite appends the series to every NON-EQ symbol (`GATECHDVR-BE`,
 *      `OMFURN-SM`, `MDL-ST`, `SANWARIA-BZ`); EQ symbols are bare. A naive
 *      exact-symbol join therefore drops EVERY BE, BZ and SME security at once.
 *      That failure is silent and looks like clean data absence, so the join
 *      builds the series-qualified form deliberately and a suspiciously perfect
 *      zero-match is treated as a bug, not as a finding.
 *      (VERIFIED 2026-08-12: Kite NSE suffix counts SM 428 / BE 250 / ST 131 /
 *      BZ 28 match the official CSV series counts exactly.)
 *
 * BSE: join official `SCRIP_CD` to Kite `exchange_token` EXACTLY. Never by
 *      symbol — BSE scrip ids collide with NSE symbols across exchanges.
 *
 * WHAT THIS FILE REFUSES TO DO
 *   - deduplicate an NSE and a BSE listing by shared ISIN (two order books)
 *   - let a symbol alone authorize a record
 *   - accept an ambiguous match
 *   - let one provider token authorize two canonical instruments
 *   - fabricate an Upstox identifier
 *   - reconstruct a missing ISIN
 *   - drop an unsupported record from reconciliation
 */

import { buildCanonicalInstrumentId } from "../canonicalInstrument";
import {
  assignEligibilityTier,
  classifyBseOfficialRow,
  classifyNseOfficialSeries,
  normalizeIsin,
  violatesLiveTierInvariant,
  type EligibilityTier,
  type RegistryListingStatus,
  type RegistrySecurityClass,
} from "./securityClassification";
import type {
  BseRawRow,
  KiteMasterRow,
  NseOfficialEquityRow,
  NseOfficialEtfRow,
} from "./officialSources";

export type RegistryExchange = "NSE" | "BSE";
export type RegistrySegment = "EQUITY" | "INDEX";

export type MappingStatus =
  | "MAPPED_EXACT"
  | "UNMAPPED_NO_PROVIDER_RECORD"
  | "REJECTED_AMBIGUOUS_MATCH"
  | "REJECTED_DUPLICATE_TOKEN";

export type ConflictStatus = "NONE" | "AMBIGUOUS_PROVIDER_MATCH" | "DUPLICATE_PROVIDER_TOKEN";

/** Cross-provider price comparison does not run in this phase. Never "agreeing". */
export type ValidationProviderStatus = "NOT_CHECKED";

export interface RegistryRecord {
  /**
   * `null` when the official symbol cannot form a canonical id (empty, or
   * containing the ":" separator). Such a record is NOT dropped — it stays in
   * reconciliation as UNRESOLVED so the remainder still closes to zero.
   */
  readonly canonicalInstrumentId: string | null;
  /** Exchange-assigned identity: `NSE:<SYMBOL>:<SERIES>` or `BSE:<SCRIP_CD>`. */
  readonly authoritativeSecurityId: string;
  readonly exchange: RegistryExchange;
  readonly segment: RegistrySegment;
  readonly tradingSymbol: string;
  readonly normalizedTradingSymbol: string;
  /** Official symbol (NSE) or official security code (BSE). */
  readonly officialSymbol: string;
  /** NSE series or BSE group, verbatim from the official master. */
  readonly seriesOrGroup: string;
  readonly isin: string | null;
  readonly securityClass: RegistrySecurityClass;
  readonly listingStatus: RegistryListingStatus;
  readonly eligibilityTier: EligibilityTier;
  readonly kiteInstrumentToken: number | null;
  readonly kiteExchangeToken: number | null;
  readonly kiteExchange: string | null;
  readonly kiteSegment: string | null;
  /** Always null in this phase — never fabricated. */
  readonly upstoxInstrumentId: null;
  readonly primaryQuoteProvider: "KITE" | null;
  readonly validationProviderStatus: ValidationProviderStatus;
  /** Which official source ids established this record. */
  readonly sourceProvenance: readonly string[];
  readonly effectiveDate: string;
  readonly registryGenerationId: string;
  readonly mappingStatus: MappingStatus;
  readonly mappingReason: string;
  readonly conflictStatus: ConflictStatus;
  /** Known symbols for this identity. Sorted; identity history, not identity. */
  readonly aliases: readonly string[];
  readonly firstSeenAt: string | null;
  readonly lastConfirmedAt: string;
  readonly classificationEvidence: string;
  readonly tierReason: string;
}

export interface ExchangeReconciliation {
  readonly exchange: RegistryExchange;
  readonly officialRecordCount: number;
  readonly liveRequired: number;
  readonly snapshotOnly: number;
  readonly unavailable: number;
  readonly excludedNonStock: number;
  readonly unresolved: number;
  readonly remainder: number;
  readonly mappedLive: number;
  readonly unmappedLive: number;
  readonly duplicateCanonicalIdentityCount: number;
  /**
   * INVARIANT VIOLATION: two retained records still hold the same provider
   * token. This must be zero; a non-zero value fails the reconciliation.
   */
  readonly duplicateActiveTokenCount: number;
  /**
   * Records that WERE rejected because several official securities claimed one
   * provider token. Correct fail-closed behaviour, but it must stay visible:
   * these instruments are unmapped, and `duplicateActiveTokenCount` cannot show
   * it precisely BECAUSE the rejection worked (the tokens were dropped).
   */
  readonly duplicateTokenRejectedCount: number;
  readonly ambiguousMappingCount: number;
  readonly ok: boolean;
  readonly failures: readonly string[];
}

export interface RegistryBuildInput {
  readonly nseMain: readonly NseOfficialEquityRow[];
  readonly nseSme: readonly NseOfficialEquityRow[];
  readonly nseEtf: readonly NseOfficialEtfRow[];
  readonly bseActive: readonly BseRawRow[];
  readonly bseSuspended: readonly BseRawRow[];
  readonly kite: readonly KiteMasterRow[];
  readonly registryGenerationId: string;
  readonly effectiveDate: string;
  readonly generatedAt: string;
  /** Optional prior generation, used only to carry forward `firstSeenAt`. */
  readonly priorFirstSeen?: ReadonlyMap<string, string>;
}

export interface RegistryBuildResult {
  readonly records: readonly RegistryRecord[];
  readonly indexRecords: readonly RegistryRecord[];
  readonly nse: ExchangeReconciliation;
  readonly bse: ExchangeReconciliation;
  /** BSE only: active + suspended must equal the official total. */
  readonly bseTotalOfficialRecords: number;
  readonly bseSuspendedRecordCount: number;
  readonly bseTotalReconciles: boolean;
  readonly ok: boolean;
  readonly failures: readonly string[];
}

/**
 * `buildCanonicalInstrumentId` THROWS on an unusable symbol. A single bad
 * official row must never abort the whole registry build, so the throw is
 * converted into an explicit null and the record is marked UNRESOLVED.
 */
function safeCanonicalId(
  exchange: RegistryExchange,
  segment: RegistrySegment,
  tradingSymbol: string,
): string | null {
  try {
    return buildCanonicalInstrumentId(exchange, segment, tradingSymbol);
  } catch {
    return null;
  }
}

/** Deterministic sort key that keeps un-mintable records stable and last. */
function sortKeyOf(r: RegistryRecord): string {
  return r.canonicalInstrumentId ?? `\uffff${r.authoritativeSecurityId}`;
}

/** Kite's equity cash segment marker. `INDICES` is the index segment. */
const KITE_EQUITY_SEGMENTS: Readonly<Record<RegistryExchange, string>> = {
  NSE: "NSE",
  BSE: "BSE",
};

/**
 * The deterministic Kite trading-symbol form for an NSE official record.
 * EQ is bare; every other series is `SYMBOL-SERIES`. This is the documented
 * provider convention, not a guess, and it is applied uniformly.
 */
export function expectedKiteNseTradingSymbol(symbol: string, series: string): string {
  const s = symbol.trim().toUpperCase();
  const ser = series.trim().toUpperCase();
  return ser === "EQ" ? s : `${s}-${ser}`;
}

interface KiteIndexes {
  /** NSE equity-segment rows by trading symbol; arrays expose ambiguity. */
  readonly nseBySymbol: Map<string, KiteMasterRow[]>;
  /** BSE equity-segment rows by exchange token. */
  readonly bseByExchangeToken: Map<number, KiteMasterRow[]>;
  readonly indexRows: KiteMasterRow[];
}

function indexKiteMaster(kite: readonly KiteMasterRow[]): KiteIndexes {
  const nseBySymbol = new Map<string, KiteMasterRow[]>();
  const bseByExchangeToken = new Map<number, KiteMasterRow[]>();
  const indexRows: KiteMasterRow[] = [];

  for (const r of kite) {
    if (r.segment === "INDICES" && (r.exchange === "NSE" || r.exchange === "BSE")) {
      indexRows.push(r);
      continue;
    }
    if (r.exchange === "NSE" && r.segment === KITE_EQUITY_SEGMENTS.NSE) {
      const list = nseBySymbol.get(r.tradingSymbol);
      if (list) list.push(r);
      else nseBySymbol.set(r.tradingSymbol, [r]);
    } else if (r.exchange === "BSE" && r.segment === KITE_EQUITY_SEGMENTS.BSE) {
      const list = bseByExchangeToken.get(r.exchangeToken);
      if (list) list.push(r);
      else bseByExchangeToken.set(r.exchangeToken, [r]);
    }
  }
  return { nseBySymbol, bseByExchangeToken, indexRows };
}

interface Draft {
  exchange: RegistryExchange;
  segment: RegistrySegment;
  officialSymbol: string;
  seriesOrGroup: string;
  authoritativeSecurityId: string;
  expectedSymbol: string;
  isin: string | null;
  securityClass: RegistrySecurityClass;
  listingStatus: RegistryListingStatus;
  classificationEvidence: string;
  sourceProvenance: string[];
  aliases: Set<string>;
  match: KiteMasterRow | null;
  mappingStatus: MappingStatus;
  mappingReason: string;
  conflictStatus: ConflictStatus;
}

export function buildRegistry(input: RegistryBuildInput): RegistryBuildResult {
  const {
    nseMain,
    nseSme,
    nseEtf,
    bseActive,
    bseSuspended,
    kite,
    registryGenerationId,
    effectiveDate,
    generatedAt,
    priorFirstSeen,
  } = input;

  const kx = indexKiteMaster(kite);
  const drafts: Draft[] = [];

  // ── NSE official equities (main board + SME) ───────────────────────────────
  const etfSymbols = new Set(nseEtf.map((e) => e.symbol));
  for (const [rows, sourceId] of [
    [nseMain, "NSE_EQUITY_L"] as const,
    [nseSme, "NSE_SME_EQUITY_L"] as const,
  ]) {
    for (const row of rows) {
      const cls = classifyNseOfficialSeries(row.series);
      // The official ETF list overrides the series: a fund in an equity series
      // is still a fund. Official evidence beats series convenience.
      const isEtf = etfSymbols.has(row.symbol);
      const securityClass: RegistrySecurityClass = isEtf ? "ETF_OR_FUND" : cls;
      const expected = expectedKiteNseTradingSymbol(row.symbol, row.series);
      drafts.push({
        exchange: "NSE",
        segment: "EQUITY",
        officialSymbol: row.symbol,
        seriesOrGroup: row.series,
        authoritativeSecurityId: `NSE:${row.symbol}:${row.series}`,
        expectedSymbol: expected,
        isin: normalizeIsin(row.isin),
        securityClass,
        listingStatus: "ACTIVE",
        classificationEvidence: isEtf
          ? "present in official NSE ETF list (eq_etfseclist.csv)"
          : `official NSE SERIES=${row.series}`,
        sourceProvenance: isEtf ? [sourceId, "NSE_ETF_LIST"] : [sourceId],
        aliases: new Set([row.symbol, expected]),
        match: null,
        mappingStatus: "UNMAPPED_NO_PROVIDER_RECORD",
        mappingReason: "",
        conflictStatus: "NONE",
      });
    }
  }

  // ── NSE official ETFs ──────────────────────────────────────────────────────
  // The official ETF list is a SEPARATE publication: it shares ZERO symbols
  // with EQUITY_L.csv (VERIFIED 2026-08-12, 342 symbols, 0 overlap). Treating
  // it only as a reclassification overlay would therefore have silently
  // excluded every NSE ETF from the registry, leaving NSE SNAPSHOT_ONLY at 0.
  // These are official records in their own right.
  const nseOfficialSymbols = new Set(drafts.filter((d) => d.exchange === "NSE").map((d) => d.officialSymbol));
  for (const row of nseEtf) {
    // If a future EQUITY_L ever carries an ETF symbol, the equity draft above
    // already holds the ETF classification; adding a second record here would
    // mint a duplicate canonical identity.
    if (nseOfficialSymbols.has(row.symbol)) continue;
    drafts.push({
      exchange: "NSE",
      segment: "EQUITY",
      officialSymbol: row.symbol,
      seriesOrGroup: "ETF",
      authoritativeSecurityId: `NSE:${row.symbol}:ETF`,
      expectedSymbol: row.symbol,
      isin: normalizeIsin(row.isin),
      securityClass: "ETF_OR_FUND",
      listingStatus: "ACTIVE",
      classificationEvidence: "listed in the official NSE ETF list (eq_etfseclist.csv)",
      sourceProvenance: ["NSE_ETF_LIST"],
      aliases: new Set([row.symbol]),
      match: null,
      mappingStatus: "UNMAPPED_NO_PROVIDER_RECORD",
      mappingReason: "",
      conflictStatus: "NONE",
    });
  }

  // ── BSE official scrips (active + suspended) ───────────────────────────────
  for (const [rows, sourceId, status] of [
    [bseActive, "BSE_LIST_OF_SCRIPS_ACTIVE", "ACTIVE"] as const,
    [bseSuspended, "BSE_LIST_OF_SCRIPS_SUSPENDED", "SUSPENDED"] as const,
  ]) {
    for (const row of rows) {
      const { securityClass, evidence } = classifyBseOfficialRow(row);
      const symbol = row.scripId !== "" ? row.scripId : `BSE${row.scripCode}`;
      drafts.push({
        exchange: "BSE",
        segment: "EQUITY",
        officialSymbol: row.scripCode,
        seriesOrGroup: row.group,
        authoritativeSecurityId: `BSE:${row.scripCode}`,
        expectedSymbol: symbol,
        isin: normalizeIsin(row.isin),
        securityClass,
        listingStatus: status as RegistryListingStatus,
        classificationEvidence: evidence,
        sourceProvenance: [sourceId],
        aliases: new Set([symbol, row.scripCode]),
        match: null,
        mappingStatus: "UNMAPPED_NO_PROVIDER_RECORD",
        mappingReason: "",
        conflictStatus: "NONE",
      });
    }
  }

  // ── Provider mapping: exact, proven-unique ─────────────────────────────────
  for (const d of drafts) {
    if (d.exchange === "NSE") {
      const cands = kx.nseBySymbol.get(d.expectedSymbol) ?? [];
      if (cands.length === 0) {
        d.mappingStatus = "UNMAPPED_NO_PROVIDER_RECORD";
        d.mappingReason = `no Kite NSE row for exact series-qualified symbol "${d.expectedSymbol}"`;
      } else if (cands.length > 1) {
        d.mappingStatus = "REJECTED_AMBIGUOUS_MATCH";
        d.conflictStatus = "AMBIGUOUS_PROVIDER_MATCH";
        d.mappingReason = `${cands.length} Kite NSE rows share symbol "${d.expectedSymbol}"; exact mapping is not unique`;
      } else {
        d.match = cands[0]!;
        d.mappingStatus = "MAPPED_EXACT";
        d.mappingReason = `exact NSE series-qualified symbol match "${d.expectedSymbol}"`;
      }
    } else {
      const token = Number(d.officialSymbol);
      const cands = Number.isInteger(token) ? (kx.bseByExchangeToken.get(token) ?? []) : [];
      if (cands.length === 0) {
        d.mappingStatus = "UNMAPPED_NO_PROVIDER_RECORD";
        d.mappingReason = `no Kite BSE row with exchange_token = SCRIP_CD ${d.officialSymbol}`;
      } else if (cands.length > 1) {
        d.mappingStatus = "REJECTED_AMBIGUOUS_MATCH";
        d.conflictStatus = "AMBIGUOUS_PROVIDER_MATCH";
        d.mappingReason = `${cands.length} Kite BSE rows share exchange_token ${d.officialSymbol}`;
      } else {
        d.match = cands[0]!;
        d.mappingStatus = "MAPPED_EXACT";
        d.mappingReason = `exact BSE SCRIP_CD → Kite exchange_token match (${d.officialSymbol})`;
      }
    }
    if (d.match) d.aliases.add(d.match.tradingSymbol);
  }

  // ── One provider token may authorize exactly one canonical instrument ──────
  const tokenOwners = new Map<number, Draft[]>();
  for (const d of drafts) {
    if (!d.match) continue;
    const list = tokenOwners.get(d.match.instrumentToken);
    if (list) list.push(d);
    else tokenOwners.set(d.match.instrumentToken, [d]);
  }
  for (const [token, owners] of tokenOwners) {
    if (owners.length <= 1) continue;
    // Reject ALL claimants. Picking a winner would silently authorize one
    // instrument with another's price.
    for (const d of owners) {
      d.match = null;
      d.mappingStatus = "REJECTED_DUPLICATE_TOKEN";
      d.conflictStatus = "DUPLICATE_PROVIDER_TOKEN";
      d.mappingReason = `Kite instrument_token ${token} is claimed by ${owners.length} official records; all rejected`;
    }
  }

  // ── Materialize records ────────────────────────────────────────────────────
  const toRecord = (d: Draft): RegistryRecord => {
    const symbolForId = d.match ? d.match.tradingSymbol : d.expectedSymbol;
    const canonicalInstrumentId = safeCanonicalId(d.exchange, d.segment, symbolForId);
    const tier =
      canonicalInstrumentId === null
        ? {
            tier: "UNRESOLVED" as const,
            reason: `official symbol ${JSON.stringify(symbolForId)} cannot form a canonical identity`,
          }
        : assignEligibilityTier({
            securityClass: d.securityClass,
            listingStatus: d.listingStatus,
          });
    return {
      canonicalInstrumentId,
      authoritativeSecurityId: d.authoritativeSecurityId,
      exchange: d.exchange,
      segment: d.segment,
      tradingSymbol: symbolForId,
      normalizedTradingSymbol: symbolForId.trim().toUpperCase(),
      officialSymbol: d.officialSymbol,
      seriesOrGroup: d.seriesOrGroup,
      isin: d.isin,
      securityClass: d.securityClass,
      listingStatus: d.listingStatus,
      eligibilityTier: tier.tier,
      kiteInstrumentToken: d.match ? d.match.instrumentToken : null,
      kiteExchangeToken: d.match ? d.match.exchangeToken : null,
      kiteExchange: d.match ? d.match.exchange : null,
      kiteSegment: d.match ? d.match.segment : null,
      upstoxInstrumentId: null,
      primaryQuoteProvider: d.match ? "KITE" : null,
      validationProviderStatus: "NOT_CHECKED",
      sourceProvenance: [...d.sourceProvenance].sort(),
      effectiveDate,
      registryGenerationId,
      mappingStatus: d.mappingStatus,
      mappingReason: d.mappingReason,
      conflictStatus: d.conflictStatus,
      aliases: [...d.aliases].filter((a) => a !== "").sort(),
      // Keyed on the AUTHORITATIVE security id, never the canonical id. The
      // canonical id embeds the trading symbol and is nullable, so a symbol or
      // series change (or a failed mint) would silently reset an instrument's
      // history and make it look newly listed. The official exchange identity
      // is the thing that actually persists across generations.
      firstSeenAt: priorFirstSeen?.get(d.authoritativeSecurityId) ?? null,
      lastConfirmedAt: generatedAt,
      classificationEvidence: d.classificationEvidence,
      tierReason: tier.reason,
    };
  };

  const records = drafts.map(toRecord).sort(byCanonicalId);

  // ── Indices (provider-declared, outside the official-equity equations) ─────
  const indexRecords: RegistryRecord[] = kx.indexRows
    .map((r) => {
      const exchange = r.exchange as RegistryExchange;
      const canonicalInstrumentId = safeCanonicalId(exchange, "INDEX", r.tradingSymbol);
      const tier =
        canonicalInstrumentId === null
          ? { tier: "UNRESOLVED" as const, reason: "index symbol cannot form a canonical identity" }
          : assignEligibilityTier({ securityClass: "INDEX", listingStatus: "ACTIVE" });
      return {
        canonicalInstrumentId,
        authoritativeSecurityId: `${exchange}:INDEX:${r.tradingSymbol}`,
        exchange,
        segment: "INDEX" as const,
        tradingSymbol: r.tradingSymbol,
        normalizedTradingSymbol: r.tradingSymbol.trim().toUpperCase(),
        officialSymbol: r.tradingSymbol,
        seriesOrGroup: "INDEX",
        isin: null,
        securityClass: "INDEX" as const,
        listingStatus: "ACTIVE" as const,
        eligibilityTier: tier.tier,
        kiteInstrumentToken: r.instrumentToken,
        kiteExchangeToken: r.exchangeToken,
        kiteExchange: r.exchange,
        kiteSegment: r.segment,
        upstoxInstrumentId: null,
        primaryQuoteProvider: "KITE" as const,
        validationProviderStatus: "NOT_CHECKED" as const,
        sourceProvenance: ["KITE_INSTRUMENT_MASTER"],
        effectiveDate,
        registryGenerationId,
        mappingStatus: "MAPPED_EXACT" as const,
        mappingReason: "Kite INDICES segment row",
        conflictStatus: "NONE" as const,
        aliases: [r.tradingSymbol].sort(),
        firstSeenAt: priorFirstSeen?.get(`${exchange}:INDEX:${r.tradingSymbol}`) ?? null,
        lastConfirmedAt: generatedAt,
        classificationEvidence: "provider-declared index segment (not a security classification)",
        tierReason: tier.reason,
      };
    })
    .sort(byCanonicalId);

  const nse = reconcile("NSE", records);
  const bse = reconcile("BSE", records);

  const bseSuspendedRecordCount = records.filter(
    (r) => r.exchange === "BSE" && r.listingStatus === "SUSPENDED",
  ).length;
  const bseTotalOfficialRecords = bseActive.length + bseSuspended.length;
  const bseTotalReconciles = bse.officialRecordCount === bseTotalOfficialRecords;

  const failures: string[] = [...nse.failures, ...bse.failures];
  if (!bseTotalReconciles) {
    failures.push(
      `BSE total official records ${bseTotalOfficialRecords} != registry BSE records ${bse.officialRecordCount}`,
    );
  }
  // Global identity integrity across BOTH exchanges.
  const seenIds = new Set<string>();
  let globalDupIds = 0;
  for (const r of [...records, ...indexRecords]) {
    if (r.canonicalInstrumentId === null) continue;
    if (seenIds.has(r.canonicalInstrumentId)) globalDupIds++;
    else seenIds.add(r.canonicalInstrumentId);
  }
  if (globalDupIds > 0) failures.push(`${globalDupIds} duplicate canonical identities across the registry`);

  const globalTokens = new Map<number, number>();
  for (const r of [...records, ...indexRecords]) {
    if (r.kiteInstrumentToken === null) continue;
    globalTokens.set(r.kiteInstrumentToken, (globalTokens.get(r.kiteInstrumentToken) ?? 0) + 1);
  }
  const globalDupTokens = [...globalTokens.values()].filter((n) => n > 1).length;
  if (globalDupTokens > 0) {
    failures.push(`${globalDupTokens} provider tokens are mapped to more than one canonical instrument`);
  }

  for (const r of [...records, ...indexRecords]) {
    if (violatesLiveTierInvariant(r.eligibilityTier, r.securityClass, r.listingStatus)) {
      failures.push(`${r.canonicalInstrumentId} claims LIVE_REQUIRED but is not eligible`);
    }
  }

  return {
    records,
    indexRecords,
    nse,
    bse,
    bseTotalOfficialRecords,
    bseSuspendedRecordCount,
    bseTotalReconciles,
    ok: failures.length === 0,
    failures,
  };
}

function byCanonicalId(a: RegistryRecord, b: RegistryRecord): number {
  const ka = sortKeyOf(a);
  const kb = sortKeyOf(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

/**
 * Zero-remainder reconciliation for one exchange. Every count is DERIVED from
 * the records; nothing here is a literal.
 */
export function reconcile(
  exchange: RegistryExchange,
  allRecords: readonly RegistryRecord[],
): ExchangeReconciliation {
  const rows = allRecords.filter((r) => r.exchange === exchange);
  const count = (t: EligibilityTier): number => rows.filter((r) => r.eligibilityTier === t).length;

  const liveRequired = count("LIVE_REQUIRED");
  const snapshotOnly = count("SNAPSHOT_ONLY");
  const unavailable = count("UNAVAILABLE");
  const excludedNonStock = count("EXCLUDED_NON_STOCK");
  const unresolved = count("UNRESOLVED");
  const officialRecordCount = rows.length;
  const remainder =
    officialRecordCount - (liveRequired + snapshotOnly + unavailable + excludedNonStock + unresolved);

  const live = rows.filter((r) => r.eligibilityTier === "LIVE_REQUIRED");
  const mappedLive = live.filter((r) => r.mappingStatus === "MAPPED_EXACT").length;
  const unmappedLive = live.length - mappedLive;

  const ids = new Map<string, number>();
  for (const r of rows) {
    if (r.canonicalInstrumentId === null) continue;
    ids.set(r.canonicalInstrumentId, (ids.get(r.canonicalInstrumentId) ?? 0) + 1);
  }
  const duplicateCanonicalIdentityCount = [...ids.values()].filter((n) => n > 1).length;

  const tokens = new Map<number, number>();
  for (const r of rows) {
    if (r.kiteInstrumentToken === null) continue;
    tokens.set(r.kiteInstrumentToken, (tokens.get(r.kiteInstrumentToken) ?? 0) + 1);
  }
  const duplicateActiveTokenCount = [...tokens.values()].filter((n) => n > 1).length;
  const duplicateTokenRejectedCount = rows.filter(
    (r) => r.mappingStatus === "REJECTED_DUPLICATE_TOKEN",
  ).length;
  const ambiguousMappingCount = rows.filter(
    (r) => r.mappingStatus === "REJECTED_AMBIGUOUS_MATCH",
  ).length;

  const failures: string[] = [];
  if (remainder !== 0) failures.push(`${exchange} reconciliation remainder is ${remainder}, expected 0`);
  if (duplicateCanonicalIdentityCount > 0) {
    failures.push(`${exchange} has ${duplicateCanonicalIdentityCount} duplicate canonical identities`);
  }
  if (duplicateActiveTokenCount > 0) {
    failures.push(`${exchange} has ${duplicateActiveTokenCount} duplicated active provider tokens`);
  }
  if (mappedLive + unmappedLive !== liveRequired) {
    failures.push(`${exchange} live mapping split ${mappedLive}+${unmappedLive} != ${liveRequired}`);
  }

  return {
    exchange,
    officialRecordCount,
    liveRequired,
    snapshotOnly,
    unavailable,
    excludedNonStock,
    unresolved,
    remainder,
    mappedLive,
    unmappedLive,
    duplicateCanonicalIdentityCount,
    duplicateActiveTokenCount,
    duplicateTokenRejectedCount,
    ambiguousMappingCount,
    ok: failures.length === 0,
    failures,
  };
}
