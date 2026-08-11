/**
 * EXCHANGE_QUALIFIED_RUNTIME_QUOTE_IDENTITY.
 * Data Foundation Phase 0.5A.
 *
 * SCOPE AND LIMITS — READ BEFORE EXTENDING
 * ----------------------------------------
 * This is a RUNTIME QUOTE identity, not the final authoritative canonical
 * security identity. It is sufficient to key live quotes without cross-exchange
 * collisions, and nothing more. It is NOT a canonical instrument master:
 *
 *   - securityId is null            (awaiting the official exchange master)
 *   - isin is null                  (Kite's dump carries no ISIN)
 *   - securityClass is UNRESOLVED   (never guessed from a symbol pattern)
 *   - official NSE/BSE master integration is pending
 *   - trading symbols can change, so this id is not eternally stable
 *
 * The future authoritative registry will ENRICH this runtime identity —
 * populating securityId, isin, securityClass and listingStatus — without
 * changing the exchange distinction and without deduplicating NSE and BSE
 * listings by ISIN. An NSE listing and a BSE listing remain separate
 * instruments before and after that enrichment.
 *
 * WHY THIS EXISTS
 * ---------------
 * The live feed keyed quotes by trading symbol alone. 2,280 trading symbols
 * exist on both NSE and BSE (OBSERVED, cached Kite masters 2026-08-11), so one
 * exchange's tick could overwrite the other's.
 *
 * This module is the single place allowed to mint an instrument identity.
 * Individual modules must NOT invent their own key format.
 *
 * IDENTITY FORMAT
 * ---------------
 *     <EXCHANGE>:<SEGMENT>:<TRADING_SYMBOL>
 *     e.g. "NSE:EQUITY:RELIANCE", "BSE:EQUITY:RELIANCE", "NSE:INDEX:NIFTY 50"
 *
 * Collision properties:
 *   - EXCHANGE is a closed set {NSE, BSE}; the same symbol on two exchanges
 *     yields two different ids, so cross-exchange overwrite is impossible.
 *   - SEGMENT is a closed set {EQUITY, INDEX}; an index can never collide
 *     with an equity even if they share a symbol.
 *   - TRADING_SYMBOL is normalised (trimmed, upper-cased) and is REJECTED if
 *     it contains the ":" separator, so the three-field encoding is
 *     unambiguous and round-trips exactly (see parseCanonicalInstrumentId).
 *   - The id contains NO provider token. Kite and, later, Upstox tokens are
 *     held as a separate mapping layer, so adding a second provider does not
 *     change any canonical id.
 *   - The id is provider-neutral, so future series can be keyed on it without a
 *     provider-specific primary key.
 *
 * DELIBERATE NON-GOALS
 *   - Cross-listed companies are NOT deduplicated by ISIN. An NSE listing and
 *     a BSE listing of the same company are two distinct market instruments
 *     with their own order books and prices, and stay separate here.
 *   - Symbol is never an identity key, and symbol-only matching is never used
 *     to join an official exchange master to a provider master.
 */

export type CanonicalExchange = "NSE" | "BSE";
export type CanonicalSegment = "EQUITY" | "INDEX";

/**
 * Authoritative security classification. Populated from the official NSE/BSE
 * masters in a later phase; UNRESOLVED until that join exists. Never guessed.
 */
export type CanonicalSecurityClass =
  | "ORDINARY_EQUITY"
  | "T2T_EQUITY"
  | "SME_EQUITY"
  | "SERIES_P_EQUITY"
  | "PARTLY_PAID_EQUITY"
  | "REIT_INVIT"
  | "ETF_FUND"
  | "RIGHTS_ENTITLEMENT"
  | "INDEX"
  | "UNRESOLVED";

export type CanonicalListingStatus = "ACTIVE" | "SUSPENDED" | "UNKNOWN";

export const CANONICAL_ID_SEPARATOR = ":";

export interface CanonicalInstrumentIdentity {
  readonly canonicalInstrumentId: string;
  readonly exchange: CanonicalExchange;
  readonly segment: CanonicalSegment;
  readonly tradingSymbol: string;
  readonly providerInstrumentToken: number;
  readonly providerExchangeToken: number | null;
  /**
   * Exchange-assigned security identifier from an OFFICIAL master
   * (for BSE this is the scrip code). `null` until the official-master join
   * lands; a provider token is deliberately not substituted here.
   */
  readonly securityId: string | null;
  /** `null` until the official-master join lands. Kite's dump carries no ISIN. */
  readonly isin: string | null;
  readonly securityClass: CanonicalSecurityClass;
  readonly listingStatus: CanonicalListingStatus;
  /**
   * Preferred display/lookup key for this instrument (the NSE trading symbol
   * for equities, the declared Yahoo-style alias for indices).
   *
   * DETERMINISTIC: chosen from the declared preference, else the
   * lexicographically smallest alias. It is never positional, so reordering
   * the source table cannot change it, and it is stable across restarts.
   *
   * Display/compatibility only — it never determines storage identity.
   */
  readonly primaryAlias: string;
}

/**
 * Deterministic preferred alias. An explicitly declared preference wins;
 * otherwise the lexicographically smallest alias is used. Never positional, so
 * reordering the alias source cannot change the result.
 */
function pickPreferredAlias(normAliases: string[], declared: string | undefined, fallback: string): string {
  if (typeof declared === "string") {
    const d = declared.trim().toUpperCase();
    if (d.length > 0 && normAliases.includes(d)) return d;
  }
  if (normAliases.length === 0) return fallback;
  return [...normAliases].sort()[0]!;
}

const VALID_EXCHANGES = new Set<string>(["NSE", "BSE"]);
const VALID_SEGMENTS = new Set<string>(["EQUITY", "INDEX"]);

/** Trim + upper-case. Returns null when the symbol cannot be part of an id. */
export function normalizeTradingSymbol(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toUpperCase();
  if (s.length === 0) return null;
  if (s.includes(CANONICAL_ID_SEPARATOR)) return null;
  return s;
}

export function buildCanonicalInstrumentId(
  exchange: CanonicalExchange,
  segment: CanonicalSegment,
  tradingSymbol: string,
): string {
  const sym = normalizeTradingSymbol(tradingSymbol);
  if (sym == null) throw new Error(`Invalid trading symbol for canonical id: ${JSON.stringify(tradingSymbol)}`);
  if (!VALID_EXCHANGES.has(exchange)) throw new Error(`Invalid exchange: ${exchange}`);
  if (!VALID_SEGMENTS.has(segment)) throw new Error(`Invalid segment: ${segment}`);
  return `${exchange}${CANONICAL_ID_SEPARATOR}${segment}${CANONICAL_ID_SEPARATOR}${sym}`;
}

export function parseCanonicalInstrumentId(
  id: string,
): { exchange: CanonicalExchange; segment: CanonicalSegment; tradingSymbol: string } | null {
  if (typeof id !== "string") return null;
  const idx1 = id.indexOf(CANONICAL_ID_SEPARATOR);
  if (idx1 < 0) return null;
  const idx2 = id.indexOf(CANONICAL_ID_SEPARATOR, idx1 + 1);
  if (idx2 < 0) return null;
  const exchange = id.slice(0, idx1);
  const segment = id.slice(idx1 + 1, idx2);
  const tradingSymbol = id.slice(idx2 + 1);
  if (!VALID_EXCHANGES.has(exchange)) return null;
  if (!VALID_SEGMENTS.has(segment)) return null;
  if (tradingSymbol.length === 0 || tradingSymbol.includes(CANONICAL_ID_SEPARATOR)) return null;
  // Only accept ids in canonical (normalised) form, so a lowercase or padded
  // variant can never be mistaken for a genuine canonical id.
  if (tradingSymbol !== normalizeTradingSymbol(tradingSymbol)) return null;
  return {
    exchange: exchange as CanonicalExchange,
    segment: segment as CanonicalSegment,
    tradingSymbol,
  };
}

export type RegisterRejectReason =
  | "INVALID_TRADING_SYMBOL"
  | "INVALID_EXCHANGE"
  | "INVALID_SEGMENT"
  | "INVALID_PROVIDER_TOKEN"
  | "DUPLICATE_TOKEN_CONFLICT"
  | "IDENTITY_TOKEN_CONFLICT"
  | "INVALID_ALIAS"
  | "ALIAS_CONFLICT";

export type RegisterResult =
  | { ok: true; identity: CanonicalInstrumentIdentity; created: boolean }
  | { ok: false; reason: RegisterRejectReason; detail: string };

/**
 * A provider token rotation is NEVER applied through register(). It must go
 * through prepare/commit so the caller can retire the old subscription first
 * (see providerTokenReconciliation.ts).
 */
export type PrepareRebindResult =
  | { status: "NOT_REQUIRED"; identity: CanonicalInstrumentIdentity }
  | { status: "UNKNOWN_IDENTITY" }
  | { status: "INVALID_PROVIDER_TOKEN" }
  | { status: "TOKEN_OWNED_BY_OTHER_IDENTITY"; owner: string }
  | { status: "REBIND_REQUIRED"; previousToken: number; identity: CanonicalInstrumentIdentity };

export type CommitRebindResult =
  | { ok: true; identity: CanonicalInstrumentIdentity; previousToken: number }
  | { ok: false; reason: RegisterRejectReason; detail: string };

export interface RegisterInstrumentInput {
  exchange: CanonicalExchange;
  segment: CanonicalSegment;
  tradingSymbol: string;
  providerInstrumentToken: number;
  providerExchangeToken?: number | null;
  securityId?: string | null;
  isin?: string | null;
  securityClass?: CanonicalSecurityClass;
  listingStatus?: CanonicalListingStatus;
  /**
   * Additional legacy lookup keys that must resolve to this identity
   * (e.g. the Yahoo-style index aliases "^NSEI", "NIFTY_FIN_SERVICE.NS").
   */
  aliases?: string[];
  /**
   * Explicitly declared preferred alias. Must be one of `aliases` or the
   * trading symbol. Declaring it keeps the preferred key stable and
   * independent of the order aliases happen to arrive in.
   */
  preferredAlias?: string;
}

export type SymbolResolution =
  | { status: "UNIQUE"; identity: CanonicalInstrumentIdentity }
  | { status: "AMBIGUOUS"; candidates: CanonicalInstrumentIdentity[] }
  | { status: "NOT_FOUND" };

/**
 * In-memory catalogue of canonical identities.
 *
 * Identities are immutable facts about the market, so the registry
 * deliberately survives WebSocket disconnects and ticker restarts; only
 * quotes are cleared on restart. `clear()` exists for tests.
 */
class CanonicalInstrumentRegistry {
  private byId = new Map<string, CanonicalInstrumentIdentity>();
  private byToken = new Map<number, string>();
  /** alias (normalised) -> set of canonical ids. >1 entry means ambiguous. */
  private byAlias = new Map<string, Set<string>>();

  register(input: RegisterInstrumentInput): RegisterResult {
    if (!VALID_EXCHANGES.has(input.exchange)) {
      return { ok: false, reason: "INVALID_EXCHANGE", detail: String(input.exchange) };
    }
    if (!VALID_SEGMENTS.has(input.segment)) {
      return { ok: false, reason: "INVALID_SEGMENT", detail: String(input.segment) };
    }
    const sym = normalizeTradingSymbol(input.tradingSymbol);
    if (sym == null) {
      return { ok: false, reason: "INVALID_TRADING_SYMBOL", detail: JSON.stringify(input.tradingSymbol) };
    }
    const token = input.providerInstrumentToken;
    if (!Number.isInteger(token) || token <= 0) {
      return { ok: false, reason: "INVALID_PROVIDER_TOKEN", detail: String(token) };
    }

    const canonicalInstrumentId = `${input.exchange}${CANONICAL_ID_SEPARATOR}${input.segment}${CANONICAL_ID_SEPARATOR}${sym}`;

    // A provider token must resolve to EXACTLY ONE canonical identity.
    const tokenOwner = this.byToken.get(token);
    if (tokenOwner != null && tokenOwner !== canonicalInstrumentId) {
      return {
        ok: false,
        reason: "DUPLICATE_TOKEN_CONFLICT",
        detail: `token ${token} already bound to ${tokenOwner}, refused rebind to ${canonicalInstrumentId}`,
      };
    }
    // An identity must never change provider token through register(). Doing
    // so here would silently orphan the old token's live subscription, so a
    // rotation has to go through prepareTokenRebind/commitTokenRebind.
    const existing = this.byId.get(canonicalInstrumentId);
    if (existing != null && existing.providerInstrumentToken !== token) {
      return {
        ok: false,
        reason: "IDENTITY_TOKEN_CONFLICT",
        detail: `${canonicalInstrumentId} already bound to token ${existing.providerInstrumentToken}, refused rebind to ${token}`,
      };
    }

    // Validate every alias before mutating anything, so a rejected
    // registration leaves the registry untouched. This list is a SET of
    // lookup keys — its order carries no meaning, because the preferred alias
    // is chosen by pickPreferredAlias, never by position.
    const rawAliases = [...(input.aliases ?? []), sym];
    const normAliases: string[] = [];
    for (const a of rawAliases) {
      const na = typeof a === "string" ? a.trim().toUpperCase() : "";
      if (na.length === 0) {
        return { ok: false, reason: "INVALID_ALIAS", detail: JSON.stringify(a) };
      }
      const owners = this.byAlias.get(na);
      if (owners && !owners.has(canonicalInstrumentId) && na !== sym) {
        // A legacy alias pointing at two different instruments would
        // reintroduce exactly the ambiguity this phase removes.
        return {
          ok: false,
          reason: "ALIAS_CONFLICT",
          detail: `alias ${na} already resolves to ${[...owners].join(", ")}`,
        };
      }
      if (!normAliases.includes(na)) normAliases.push(na);
    }

    if (existing != null) {
      for (const na of normAliases) this.indexAlias(na, canonicalInstrumentId);
      return { ok: true, identity: existing, created: false };
    }

    const identity: CanonicalInstrumentIdentity = Object.freeze({
      canonicalInstrumentId,
      exchange: input.exchange,
      segment: input.segment,
      tradingSymbol: sym,
      providerInstrumentToken: token,
      providerExchangeToken: input.providerExchangeToken ?? null,
      securityId: input.securityId ?? null,
      isin: input.isin ?? null,
      securityClass: input.securityClass ?? "UNRESOLVED",
      listingStatus: input.listingStatus ?? "UNKNOWN",
      primaryAlias: pickPreferredAlias(normAliases, input.preferredAlias, sym),
    });

    this.byId.set(canonicalInstrumentId, identity);
    this.byToken.set(token, canonicalInstrumentId);
    for (const na of normAliases) this.indexAlias(na, canonicalInstrumentId);
    return { ok: true, identity, created: true };
  }

  /**
   * Phase 1 of a provider-token rotation. Pure inspection — mutates nothing —
   * so the caller can retire the old subscription before committing.
   */
  prepareTokenRebind(canonicalInstrumentId: string, newToken: number): PrepareRebindResult {
    if (!Number.isInteger(newToken) || newToken <= 0) return { status: "INVALID_PROVIDER_TOKEN" };
    const existing = this.byId.get(canonicalInstrumentId);
    if (existing == null) return { status: "UNKNOWN_IDENTITY" };
    if (existing.providerInstrumentToken === newToken) {
      return { status: "NOT_REQUIRED", identity: existing };
    }
    const owner = this.byToken.get(newToken);
    if (owner != null && owner !== canonicalInstrumentId) {
      return { status: "TOKEN_OWNED_BY_OTHER_IDENTITY", owner };
    }
    return { status: "REBIND_REQUIRED", previousToken: existing.providerInstrumentToken, identity: existing };
  }

  /**
   * Phase 2. Retires the old token from resolution and installs the new one in
   * a single synchronous step, so there is never a moment where both resolve.
   * Call ONLY after the old token has been unsubscribed.
   */
  commitTokenRebind(canonicalInstrumentId: string, newToken: number): CommitRebindResult {
    const prep = this.prepareTokenRebind(canonicalInstrumentId, newToken);
    switch (prep.status) {
      case "INVALID_PROVIDER_TOKEN":
        return { ok: false, reason: "INVALID_PROVIDER_TOKEN", detail: String(newToken) };
      case "UNKNOWN_IDENTITY":
        return { ok: false, reason: "IDENTITY_TOKEN_CONFLICT", detail: `unknown identity ${canonicalInstrumentId}` };
      case "TOKEN_OWNED_BY_OTHER_IDENTITY":
        return { ok: false, reason: "DUPLICATE_TOKEN_CONFLICT", detail: `token ${newToken} already resolves to ${prep.owner}` };
      case "NOT_REQUIRED":
        return { ok: true, identity: prep.identity, previousToken: newToken };
      case "REBIND_REQUIRED":
        break;
    }
    const previousToken = prep.previousToken;
    const identity: CanonicalInstrumentIdentity = Object.freeze({
      ...prep.identity,
      providerInstrumentToken: newToken,
    });
    this.byToken.delete(previousToken);
    this.byToken.set(newToken, canonicalInstrumentId);
    this.byId.set(canonicalInstrumentId, identity);
    return { ok: true, identity, previousToken };
  }

  private indexAlias(alias: string, canonicalId: string): void {
    let set = this.byAlias.get(alias);
    if (!set) {
      set = new Set<string>();
      this.byAlias.set(alias, set);
    }
    set.add(canonicalId);
  }

  resolveByToken(token: number): CanonicalInstrumentIdentity | null {
    const id = this.byToken.get(token);
    return id == null ? null : this.byId.get(id) ?? null;
  }

  resolveById(canonicalInstrumentId: string): CanonicalInstrumentIdentity | null {
    return this.byId.get(canonicalInstrumentId) ?? null;
  }

  /**
   * Symbol/alias lookup. Deliberately returns an explicit AMBIGUOUS result
   * rather than silently choosing an exchange.
   */
  resolveBySymbol(symbol: string): SymbolResolution {
    const na = typeof symbol === "string" ? symbol.trim().toUpperCase() : "";
    if (na.length === 0) return { status: "NOT_FOUND" };
    const owners = this.byAlias.get(na);
    if (!owners || owners.size === 0) return { status: "NOT_FOUND" };
    const candidates: CanonicalInstrumentIdentity[] = [];
    for (const id of owners) {
      const ident = this.byId.get(id);
      if (ident) candidates.push(ident);
    }
    if (candidates.length === 0) return { status: "NOT_FOUND" };
    if (candidates.length === 1) return { status: "UNIQUE", identity: candidates[0]! };
    return { status: "AMBIGUOUS", candidates };
  }

  listAll(): CanonicalInstrumentIdentity[] {
    return [...this.byId.values()];
  }

  size(): number {
    return this.byId.size;
  }

  /** Test-only. Identities are immutable facts and are kept across restarts. */
  clear(): void {
    this.byId.clear();
    this.byToken.clear();
    this.byAlias.clear();
  }
}

export const instrumentRegistry = new CanonicalInstrumentRegistry();
export type { CanonicalInstrumentRegistry };
