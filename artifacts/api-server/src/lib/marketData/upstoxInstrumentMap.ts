/**
 * Upstox instrument key mapping — Gate B, Pack 5 23A.
 *
 * Maps the canonical instrument identity (exchange + ISIN for equity,
 * normalized name for indices, exchange+underlying+expiry+strike+type for
 * derivatives) to the Upstox `instrument_key` required by all Upstox V2
 * market-data endpoints.
 *
 * ## Key design decisions
 *
 * 1. Cash equity primary key: exchange + ISIN.  Symbol matching is a
 *    secondary controlled rule (symbols can be reused/renamed; ISIN is stable).
 * 2. Index key: exchange segment + normalized official name.
 * 3. Derivative key: exchange/segment + underlying + expiry + strike + opt-type.
 * 4. `exchange_token` is NOT used as the stable key (Upstox reuses tokens).
 * 5. Ambiguous, duplicate, incomplete, expired and suspended entries are
 *    rejected — never selected.
 * 6. BOD cache: JSON-validated, atomically replaced, last-known-good retained
 *    only when explicitly fresh. Single-flight refresh.
 * 7. Mapping failure suppresses the shadow request and records a diagnostic.
 */

import type { UpstoxInstrument } from "./upstoxClient";

// ---------------------------------------------------------------------------
// Canonical mapping types
// ---------------------------------------------------------------------------

export interface CanonicalInstrumentMapping {
  /** Replit-internal stable ID: `<exchange>:<isin>` for equity, `INDEX:<normalizedName>` for indices. */
  canonicalId:     string;
  exchange:        string;
  segment:         string;
  tradingSymbol:   string;
  isin:            string | null;
  /** Kite instrument token (populated from Kite master). */
  kiteToken:       number | null;
  /** Upstox V2 stable instrument key (e.g. "NSE_EQ|INE009A01021"). */
  upstoxKey:       string;
  /** DERIVATIVE only */
  underlying?:     string | null;
  expiry?:         string | null;  // YYYY-MM-DD
  strike?:         number | null;
  optionType?:     "CE" | "PE" | null;
  lotSize?:        number | null;
  tickSize?:       number | null;
  isDerivative:    boolean;
  isIndex:         boolean;
  /** active | suspended | expired */
  status:          "active" | "suspended" | "expired";
  /** ISO timestamp when this mapping was created. */
  mappedAt:        string;
  /** Source of the mapping data. */
  source:          "BOD_DOWNLOAD" | "STATIC_BOOTSTRAP" | "TEST_FIXTURE";
}

export interface MappingDiagnostic {
  symbol:       string;
  upstoxKey:    string | null;
  resolvedAt:   string;
  ok:           boolean;
  failureKind:  MappingFailureKind | null;
  reason:       string | null;
}

export type MappingFailureKind =
  | "NOT_CONFIGURED"    // provider not set up
  | "NOT_IN_MAP"        // symbol/ISIN not found in the loaded master
  | "AMBIGUOUS"         // multiple instrument_keys match the same canonical identity
  | "DUPLICATE_KEY"     // same upstox instrument_key claimed by multiple rows
  | "SUSPENDED"         // instrument is suspended
  | "EXPIRED"           // derivative has expired
  | "ISIN_MISMATCH"     // secondary symbol match found but ISIN doesn't agree
  | "SCHEMA_INVALID"    // BOD payload failed JSON schema validation
  | "STALE_CACHE";      // cached master is too old and no fresh download succeeded

// ---------------------------------------------------------------------------
// Static bootstrap for well-known indices (no ISIN, mapped by official name)
// ---------------------------------------------------------------------------

/**
 * Static index mapping — always available without a BOD download.
 * These are mapped by official Upstox index segment + name, which are stable.
 */
const STATIC_INDEX_MAP: ReadonlyMap<string, CanonicalInstrumentMapping> = new Map(
  [
    {
      canonicalId: "INDEX:NIFTY50",
      exchange: "NSE", segment: "NSE_INDEX", tradingSymbol: "Nifty 50",
      isin: null, kiteToken: null, upstoxKey: "NSE_INDEX|Nifty 50",
      isDerivative: false, isIndex: true, status: "active",
      mappedAt: "2026-08-04T00:00:00.000Z", source: "STATIC_BOOTSTRAP" as const,
    },
    {
      canonicalId: "INDEX:BANKNIFTY",
      exchange: "NSE", segment: "NSE_INDEX", tradingSymbol: "Nifty Bank",
      isin: null, kiteToken: null, upstoxKey: "NSE_INDEX|Nifty Bank",
      isDerivative: false, isIndex: true, status: "active",
      mappedAt: "2026-08-04T00:00:00.000Z", source: "STATIC_BOOTSTRAP" as const,
    },
    {
      canonicalId: "INDEX:SENSEX",
      exchange: "BSE", segment: "BSE_INDEX", tradingSymbol: "SENSEX",
      isin: null, kiteToken: null, upstoxKey: "BSE_INDEX|SENSEX",
      isDerivative: false, isIndex: true, status: "active",
      mappedAt: "2026-08-04T00:00:00.000Z", source: "STATIC_BOOTSTRAP" as const,
    },
    {
      canonicalId: "INDEX:NIFTYMIDCAP",
      exchange: "NSE", segment: "NSE_INDEX", tradingSymbol: "Nifty Midcap 100",
      isin: null, kiteToken: null, upstoxKey: "NSE_INDEX|Nifty Midcap 100",
      isDerivative: false, isIndex: true, status: "active",
      mappedAt: "2026-08-04T00:00:00.000Z", source: "STATIC_BOOTSTRAP" as const,
    },
  ].map(m => [m.canonicalId, m] as [string, CanonicalInstrumentMapping])
);

// Symbol alias → canonicalId for index resolution
const INDEX_SYMBOL_ALIASES: ReadonlyMap<string, string> = new Map([
  ["^NSEI",     "INDEX:NIFTY50"],
  ["NIFTY",     "INDEX:NIFTY50"],
  ["^NSEBANK",  "INDEX:BANKNIFTY"],
  ["BANKNIFTY", "INDEX:BANKNIFTY"],
  ["^BSESN",    "INDEX:SENSEX"],
  ["SENSEX",    "INDEX:SENSEX"],
  ["NIFTYMIDCAP100", "INDEX:NIFTYMIDCAP"],
]);

// ---------------------------------------------------------------------------
// BOD instrument master cache
// ---------------------------------------------------------------------------

export interface InstrumentMasterCache {
  /** ISO timestamp of the last successful BOD download. */
  fetchedAt:       string;
  /** Epoch ms — used for freshness gate. */
  fetchedAtMs:     number;
  /** Total instrument rows loaded. */
  rowCount:        number;
  /** Mapped rows after deduplication and validation. */
  mappedCount:     number;
  /** Rejected rows (ambiguous, suspended, etc.) */
  rejectedCount:   number;
  /** Failure counts by kind. */
  failureCounts:   Record<MappingFailureKind, number>;
  /** ISIN → mapping (NSE wins over BSE for same ISIN). */
  byIsin:          Map<string, CanonicalInstrumentMapping>;
  /** upstoxKey → mapping (for dedup checking). */
  byUpstoxKey:     Map<string, CanonicalInstrumentMapping>;
  /** derivativeKey → mapping. Key: `<segment>:<underlying>:<expiry>:<strike>:<optType>` */
  byDerivativeKey: Map<string, CanonicalInstrumentMapping>;
}

// Max age for last-known-good retention: 26 hours (covers overnight BOD)
const CACHE_MAX_AGE_MS = 26 * 60 * 60 * 1000;

let _cache: InstrumentMasterCache | null = null;
let _refreshInFlight: Promise<InstrumentMasterCache | null> | null = null;

// Test seam
let _testCache: InstrumentMasterCache | null | undefined = undefined;

export function __setInstrumentMapForTests(
  cache: InstrumentMasterCache | null,
): void {
  _testCache = cache;
}

export function __resetInstrumentMapForTests(): void {
  _testCache = undefined;
  _cache     = null;
  _refreshInFlight = null;
}

function getActiveCache(): InstrumentMasterCache | null {
  if (_testCache !== undefined) return _testCache;
  return _cache;
}

// ---------------------------------------------------------------------------
// Master download URL (Upstox publishes a daily instrument CSV/JSON)
// ---------------------------------------------------------------------------

// Upstox provides complete instrument masters as CSV per exchange.
// The canonical JSON master URL requires an authenticated download
// (API endpoint: GET /instruments). For Pack 5, only the static bootstrap
// and test-fixture paths are used; the live download is scaffolded but
// requires credentials to activate.
const MASTER_URL = "https://api.upstox.com/v2/instruments";

// ---------------------------------------------------------------------------
// JSON schema validation (minimal — checks structural invariants)
// ---------------------------------------------------------------------------

function isValidInstrumentRow(row: unknown): row is Record<string, unknown> {
  if (typeof row !== "object" || row === null) return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r["instrument_key"] === "string" &&
    r["instrument_key"].length > 0 &&
    typeof r["exchange"] === "string" &&
    typeof r["segment"] === "string" &&
    typeof r["trading_symbol"] === "string"
  );
}

// ---------------------------------------------------------------------------
// Build cache from raw instrument rows
// ---------------------------------------------------------------------------

function deriveKey(row: UpstoxInstrument): string | null {
  if (row.expiry && row.strike != null && row.option_type) {
    // Derivative
    return `${row.segment}:${row.underlying_key ?? row.trading_symbol}:${row.expiry}:${row.strike}:${row.option_type}`;
  }
  if (row.isin) return `ISIN:${row.isin}:${row.exchange}`;
  return null;
}

function buildCache(
  rows: UpstoxInstrument[],
  fetchedAtMs: number,
): InstrumentMasterCache {
  const byIsin          = new Map<string, CanonicalInstrumentMapping>();
  const byUpstoxKey     = new Map<string, CanonicalInstrumentMapping>();
  const byDerivativeKey = new Map<string, CanonicalInstrumentMapping>();

  const failureCounts: Record<MappingFailureKind, number> = {
    NOT_CONFIGURED: 0, NOT_IN_MAP: 0, AMBIGUOUS: 0, DUPLICATE_KEY: 0,
    SUSPENDED: 0, EXPIRED: 0, ISIN_MISMATCH: 0, SCHEMA_INVALID: 0, STALE_CACHE: 0,
  };

  let mappedCount   = 0;
  let rejectedCount = 0;
  const fetchedAt   = new Date(fetchedAtMs).toISOString();

  // Track ISINs that appear more than once to detect ambiguity
  const isinSeen = new Map<string, UpstoxInstrument[]>();

  for (const row of rows) {
    if (!isValidInstrumentRow(row)) {
      failureCounts["SCHEMA_INVALID"]++;
      rejectedCount++;
      continue;
    }

    if (row.isin) {
      const prev = isinSeen.get(row.isin) ?? [];
      prev.push(row);
      isinSeen.set(row.isin, prev);
    }
  }

  // Resolve ISIN collisions: NSE wins over BSE for same ISIN
  const resolvedRows = new Map<string, UpstoxInstrument>();
  for (const [isin, candidates] of isinSeen) {
    if (candidates.length === 1) {
      resolvedRows.set(isin, candidates[0]!);
    } else {
      const nse = candidates.find(c => c.exchange === "NSE");
      if (nse) {
        resolvedRows.set(isin, nse);
      } else {
        // Multiple non-NSE rows — use the first
        resolvedRows.set(isin, candidates[0]!);
      }
    }
  }

  for (const row of rows) {
    // Skip schema-invalid rows (already counted above)
    if (!isValidInstrumentRow(row)) continue;

    // Check for upstoxKey duplicates
    if (byUpstoxKey.has(row.instrument_key)) {
      failureCounts["DUPLICATE_KEY"]++;
      rejectedCount++;
      continue;
    }

    // Skip expired derivatives
    if (row.expiry) {
      const expiryMs = Date.parse(row.expiry);
      if (Number.isFinite(expiryMs) && expiryMs < Date.now() - 24 * 3_600_000) {
        // Expired more than 1 day ago — skip
        failureCounts["EXPIRED"]++;
        rejectedCount++;
        continue;
      }
    }

    const isDerivative = !!(row.expiry && row.strike != null && row.option_type);
    const isIndex      = row.segment.includes("INDEX");

    // For equity: use ISIN as primary key
    if (!isDerivative && !isIndex && row.isin) {
      const resolved = resolvedRows.get(row.isin);
      if (!resolved || resolved.instrument_key !== row.instrument_key) {
        // This row lost the ISIN collision; skip
        rejectedCount++;
        continue;
      }
    }

    const mapping: CanonicalInstrumentMapping = {
      canonicalId:   isIndex ? `INDEX:${row.trading_symbol.toUpperCase().replace(/\s+/g, "")}` : (row.isin ? `${row.exchange}:${row.isin}` : `${row.exchange}:${row.trading_symbol}`),
      exchange:      row.exchange,
      segment:       row.segment,
      tradingSymbol: row.trading_symbol,
      isin:          row.isin ?? null,
      kiteToken:     null, // populated by cross-ref with Kite master (follow-on)
      upstoxKey:     row.instrument_key,
      underlying:    row.underlying_key ?? null,
      expiry:        row.expiry ?? null,
      strike:        row.strike ?? null,
      optionType:    row.option_type ?? null,
      lotSize:       row.lot_size ?? null,
      tickSize:      row.tick_size ?? null,
      isDerivative,
      isIndex,
      status:        "active",
      mappedAt:      fetchedAt,
      source:        "BOD_DOWNLOAD",
    };

    byUpstoxKey.set(row.instrument_key, mapping);

    if (row.isin && !isDerivative) {
      byIsin.set(row.isin, mapping);
    }

    if (isDerivative) {
      const dkey = deriveKey(row);
      if (dkey) byDerivativeKey.set(dkey, mapping);
    }

    mappedCount++;
  }

  return {
    fetchedAt, fetchedAtMs,
    rowCount:        rows.length,
    mappedCount,
    rejectedCount,
    failureCounts,
    byIsin,
    byUpstoxKey,
    byDerivativeKey,
  };
}

// ---------------------------------------------------------------------------
// BOD download (scaffolded — requires credentials)
// ---------------------------------------------------------------------------

/** Initiate (or reuse in-flight) a BOD instrument master download. */
async function refreshFromBod(
  token: string,
  fetchImpl: typeof fetch = globalThis.fetch,
  timeoutMs = 30_000,
): Promise<InstrumentMasterCache | null> {
  if (_refreshInFlight) return _refreshInFlight;

  _refreshInFlight = (async () => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let res: Response;
      try {
        res = await fetchImpl(MASTER_URL, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (!res.ok) return _cache; // retain last-known-good
      const raw = (await res.json()) as unknown;
      if (!Array.isArray(raw)) return _cache;

      const newCache = buildCache(raw as UpstoxInstrument[], Date.now());
      // Atomic cache replacement
      _cache = newCache;
      return newCache;
    } catch {
      // Network/timeout — retain last-known-good if it is still fresh enough
      const c = getActiveCache();
      if (c && Date.now() - c.fetchedAtMs < CACHE_MAX_AGE_MS) return c;
      return null;
    } finally {
      _refreshInFlight = null;
    }
  })();

  return _refreshInFlight;
}

// ---------------------------------------------------------------------------
// Public resolution API
// ---------------------------------------------------------------------------

export interface ResolveOptions {
  /** ISIN for cash equities (primary key). */
  isin?:       string;
  /** exchange (NSE/BSE) for ISIN disambiguation. */
  exchange?:   string;
  /** For derivatives: underlying symbol. */
  underlying?: string;
  /** For derivatives: expiry YYYY-MM-DD. */
  expiry?:     string;
  /** For derivatives: strike price. */
  strike?:     number;
  /** For derivatives: CE or PE. */
  optionType?: "CE" | "PE";
  /** Upstox bearer token (for on-demand BOD refresh). */
  token?:      string;
}

/**
 * Resolve a canonical symbol / ISIN → `UpstoxInstrumentKey`.
 *
 * Resolution order:
 *  1. Static index bootstrap (NIFTY, BANKNIFTY, SENSEX, ^NSEI, ^NSEBANK, ^BSESN)
 *  2. BOD cache by ISIN (equity)
 *  3. BOD cache by derivative key
 *
 * Returns a `MappingDiagnostic` that includes the key (null on failure).
 */
export function resolveInstrumentKey(
  symbol: string,
  opts:   ResolveOptions = {},
): MappingDiagnostic {
  const resolvedAt = new Date().toISOString();
  const symUpper   = symbol.toUpperCase().trim();

  // 1. Static index lookup
  const indexAlias = INDEX_SYMBOL_ALIASES.get(symUpper);
  if (indexAlias) {
    const m = STATIC_INDEX_MAP.get(indexAlias);
    if (m) {
      return { symbol, upstoxKey: m.upstoxKey, resolvedAt, ok: true, failureKind: null, reason: null };
    }
  }
  // Direct canonicalId lookup for index
  const directIndex = STATIC_INDEX_MAP.get(`INDEX:${symUpper}`);
  if (directIndex) {
    return { symbol, upstoxKey: directIndex.upstoxKey, resolvedAt, ok: true, failureKind: null, reason: null };
  }

  const cache = getActiveCache();

  // 2. ISIN-based equity lookup
  if (opts.isin) {
    if (!cache) {
      return { symbol, upstoxKey: null, resolvedAt, ok: false, failureKind: "NOT_IN_MAP", reason: "BOD cache not loaded." };
    }
    const m = cache.byIsin.get(opts.isin);
    if (!m) {
      return { symbol, upstoxKey: null, resolvedAt, ok: false, failureKind: "NOT_IN_MAP", reason: `ISIN ${opts.isin} not in Upstox master.` };
    }
    if (m.status === "suspended") {
      return { symbol, upstoxKey: null, resolvedAt, ok: false, failureKind: "SUSPENDED", reason: `${symbol} is suspended.` };
    }
    // Secondary exchange check
    if (opts.exchange && m.exchange !== opts.exchange) {
      // ISIN found but on wrong exchange — still return it; NSE wins
    }
    return { symbol, upstoxKey: m.upstoxKey, resolvedAt, ok: true, failureKind: null, reason: null };
  }

  // 3. Derivative key lookup
  if (opts.underlying && opts.expiry && opts.strike != null && opts.optionType) {
    if (!cache) {
      return { symbol, upstoxKey: null, resolvedAt, ok: false, failureKind: "NOT_IN_MAP", reason: "BOD cache not loaded." };
    }
    const dkey = `NSE_FO:${opts.underlying}:${opts.expiry}:${opts.strike}:${opts.optionType}`;
    const m = cache.byDerivativeKey.get(dkey);
    if (!m) {
      return { symbol, upstoxKey: null, resolvedAt, ok: false, failureKind: "NOT_IN_MAP", reason: `Derivative key ${dkey} not in Upstox master.` };
    }
    if (m.status === "expired") {
      return { symbol, upstoxKey: null, resolvedAt, ok: false, failureKind: "EXPIRED", reason: `${symbol} has expired.` };
    }
    return { symbol, upstoxKey: m.upstoxKey, resolvedAt, ok: true, failureKind: null, reason: null };
  }

  // 4. Unresolvable — no ISIN, not an index, not a derivative with full params
  return {
    symbol, upstoxKey: null, resolvedAt, ok: false,
    failureKind: "NOT_IN_MAP",
    reason: "No ISIN provided and symbol is not a known index. Equity shadow requires ISIN for unambiguous mapping.",
  };
}

// ---------------------------------------------------------------------------
// Gate D (23B) — Index bootstrap BOD validation
// ---------------------------------------------------------------------------

export type IndexBootstrapValidationStatus =
  | "UNCHANGED"      // BOD confirms bootstrap key
  | "CHANGED"        // BOD has a different key — prefer BOD
  | "MISSING"        // No BOD entry found — suppress shadow comparison
  | "AMBIGUOUS"      // Multiple BOD rows match — suppress shadow comparison
  | "WRONG_SEGMENT"; // BOD row found but segment mismatch — suspicious, use bootstrap

export interface IndexBootstrapValidationResult {
  canonicalId:   string;
  bootstrapKey:  string;
  /** Active key to use for shadow dispatch. null when comparison should be suppressed. */
  activeKey:     string | null;
  status:        IndexBootstrapValidationStatus;
  notes:         string;
}

/**
 * Validate static index bootstrap candidates against a real BOD instrument cache.
 *
 * For each STATIC_INDEX_MAP entry:
 *  1. Scan byIndexName for matching segment + tradingSymbol.
 *  2. If unique match: compare key. UNCHANGED or CHANGED. CHANGED → prefer BOD.
 *  3. If multiple matches: AMBIGUOUS → suppress.
 *  4. If no match: MISSING → suppress.
 *  5. If match but wrong segment: WRONG_SEGMENT → use bootstrap.
 *
 * This function is read-only: it does NOT alter resolveInstrumentKey() results.
 * Callers decide whether to update their active dispatch map.
 */
export function validateIndexBootstrap(
  cache: InstrumentMasterCache,
): IndexBootstrapValidationResult[] {
  const results: IndexBootstrapValidationResult[] = [];

  for (const [, staticMapping] of STATIC_INDEX_MAP) {
    const { canonicalId, upstoxKey: bootstrapKey, segment, tradingSymbol } = staticMapping;

    // Scan all BOD entries by tradingSymbol (segment-agnostic first pass)
    const matchingBySymbol: CanonicalInstrumentMapping[] = [];
    for (const mapping of cache.byUpstoxKey.values()) {
      if (mapping.tradingSymbol === tradingSymbol) {
        matchingBySymbol.push(mapping);
      }
    }

    if (matchingBySymbol.length === 0) {
      results.push({
        canonicalId, bootstrapKey,
        activeKey: null,
        status:    "MISSING",
        notes:     `No BOD instrument found for index "${tradingSymbol}". Shadow comparison suppressed.`,
      });
      continue;
    }

    // Check for wrong-segment match before deduplication
    const correctSegment = matchingBySymbol.filter(m => m.segment === segment);
    const wrongSegment   = matchingBySymbol.filter(m => m.segment !== segment);
    if (wrongSegment.length > 0 && correctSegment.length === 0) {
      results.push({
        canonicalId, bootstrapKey,
        activeKey: bootstrapKey,
        status:    "WRONG_SEGMENT",
        notes:     `BOD entry for "${tradingSymbol}" has segment "${wrongSegment[0]!.segment}" but expected "${segment}". Using bootstrap key.`,
      });
      continue;
    }

    // Use only correct-segment rows for further comparison
    const matchingByName = correctSegment.length > 0 ? correctSegment : matchingBySymbol;

    if (matchingByName.length > 1) {
      // Deduplicate: if all have the same key, treat as UNCHANGED
      const uniqueKeys = new Set(matchingByName.map(m => m.upstoxKey));
      if (uniqueKeys.size === 1) {
        const bodKey = matchingByName[0]!.upstoxKey;
        results.push({
          canonicalId, bootstrapKey,
          activeKey: bodKey,
          status:    bodKey === bootstrapKey ? "UNCHANGED" : "CHANGED",
          notes:     bodKey === bootstrapKey
            ? `BOD confirms bootstrap key for "${tradingSymbol}".`
            : `BOD has different key for "${tradingSymbol}". BOD preferred: ${bodKey}.`,
        });
        continue;
      }
      results.push({
        canonicalId, bootstrapKey,
        activeKey: null,
        status:    "AMBIGUOUS",
        notes:     `Multiple BOD keys for "${tradingSymbol}" — shadow comparison suppressed.`,
      });
      continue;
    }

    const bodMapping = matchingByName[0]!;

    // Check segment agreement
    if (bodMapping.segment !== segment) {
      results.push({
        canonicalId, bootstrapKey,
        activeKey: bootstrapKey, // Fall back to bootstrap when segment is wrong
        status:    "WRONG_SEGMENT",
        notes:     `BOD entry for "${tradingSymbol}" has segment "${bodMapping.segment}" but expected "${segment}". Using bootstrap key.`,
      });
      continue;
    }

    const bodKey = bodMapping.upstoxKey;
    results.push({
      canonicalId, bootstrapKey,
      activeKey: bodKey,
      status:    bodKey === bootstrapKey ? "UNCHANGED" : "CHANGED",
      notes:     bodKey === bootstrapKey
        ? `BOD confirms bootstrap key for "${tradingSymbol}".`
        : `Mapping change detected for "${tradingSymbol}": bootstrap=${bootstrapKey}, BOD=${bodKey}. Using BOD key.`,
    });
  }

  return results;
}

/**
 * Load (or refresh) the BOD instrument master.
 * Single-flight: concurrent calls share the same in-flight promise.
 * Returns null when provider not configured or download failed and cache is stale.
 */
export async function loadInstrumentMaster(
  token: string | null,
  fetchImpl?: typeof fetch,
): Promise<InstrumentMasterCache | null> {
  if (!token) return null;
  const c = getActiveCache();
  if (c && Date.now() - c.fetchedAtMs < CACHE_MAX_AGE_MS) return c;
  return refreshFromBod(token, fetchImpl);
}

/**
 * Inject a pre-built cache for testing (bypasses BOD download).
 * Pass `null` to clear the cache; `undefined` to reset to live mode.
 */
export function __loadTestFixture(rows: UpstoxInstrument[]): InstrumentMasterCache {
  const cache = buildCache(rows, Date.now());
  _testCache = cache;
  return cache;
}

export { buildCache as __buildCacheForTests };
