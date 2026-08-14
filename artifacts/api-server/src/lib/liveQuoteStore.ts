/**
 * Live quote store — Data Foundation Phase 0.5A / 0.8B.
 *
 * Keyed by the EXCHANGE_QUALIFIED_RUNTIME_QUOTE_IDENTITY minted in
 * canonicalInstrument.ts. That identity is a runtime quote key, NOT an
 * authoritative security master: securityId and isin are null and
 * securityClass is UNRESOLVED until the official exchange master is
 * integrated. See canonicalInstrument.ts for the full scope statement.
 *
 * STORAGE IDENTITY RULE
 * ---------------------
 * A quote is stored under its canonicalInstrumentId, which is resolved from
 * the provider instrument token BEFORE insertion. The trading symbol plays no
 * part in deciding where a quote is stored. A tick whose token is not in the
 * canonical registry is rejected outright — it can never reach the store.
 *
 * CANONICAL PROVENANCE CONTRACT
 * -----------------------------
 * Every stored quote carries the full identity and provenance context required
 * to evaluate its authority:
 *   - Identity fields from the canonical registry (exchange, segment, isin, …)
 *   - Both timestamps kept distinct: exchangeTimestamp (provider-supplied,
 *     null when absent) and receivedTimestamp (local receipt time, always present)
 *   - Registry generation id, shard id, and manifest hashes from the feed session
 *   - Honest status fields: validationStatus, freshnessState, conflictStatus
 *   - lastValidTimestamp: the receivedTimestamp of the PREVIOUS accepted quote
 *     for this instrument, so callers can detect gaps without fabricating data
 *
 * LEGACY WRITES
 * -------------
 * The kiteFeed legacy path calls upsertQuote without provenance context. Those
 * writes receive validationStatus "LEGACY_UNVALIDATED" and null provenance
 * fields. This is honest: the legacy path does not pass through the Phase 0.8B
 * ingestion gate chain.
 *
 * Freshness semantics are unchanged: this module stores and returns ticks with
 * their timestamps and does not classify anything as LIVE. Presence in this
 * map is not a freshness claim.
 */
import {
  instrumentRegistry,
  type CanonicalExchange,
  type CanonicalSegment,
  type CanonicalInstrumentIdentity,
} from "./canonicalInstrument";

/** Providers permitted to write into the production live store. */
export type QuoteProvider = "KITE";
const APPROVED_PROVIDERS = new Set<string>(["KITE"]);

/**
 * Freshness state of a stored quote.
 *
 * NOT_EVALUATED is honest for Phase 0.8B: freshness requires a live session
 * clock and freshness policy that the disabled feed cannot supply.
 * LEGACY_UNVALIDATED is used for writes through the pre-0.8B code path.
 */
export type QuoteFreshnessState = "NOT_EVALUATED" | "LEGACY_UNVALIDATED";

/**
 * Conflict status of a stored quote.
 *
 * NOT_EVALUATED is the correct state when cross-provider validation was not
 * performed. Defaulting to NO_CONFLICT when conflict was never evaluated is
 * dishonest — it implies validation that did not happen.
 */
export type QuoteConflictStatus = "NOT_EVALUATED";

/** Validation path through which the quote was accepted. */
export type QuoteValidationStatus = "ACCEPTED" | "LEGACY_UNVALIDATED";

export interface LiveTick {
  // ── Identity ──────────────────────────────────────────────────────────────
  /** Canonical storage identity. Exchange-qualified; never symbol-derived. */
  canonicalInstrumentId: string;
  exchange: CanonicalExchange;
  segment: CanonicalSegment;
  /** Canonical exchange trading symbol (e.g. "RELIANCE", "NIFTY 50"). */
  tradingSymbol: string;
  /**
   * Legacy display key retained for backward compatibility with existing
   * consumers (NSE symbol for equities, Yahoo-style alias for indices).
   * Never an identity.
   */
  symbol: string;
  instrumentToken: number;
  /** Kite exchange_token from the canonical registry where available. */
  providerExchangeToken: number | null;
  /**
   * Official exchange security id where authoritative.
   * Explicit null until the official exchange master is integrated.
   */
  securityId: string | null;
  /**
   * ISIN where authoritative.
   * Explicit null — Kite's instrument dump carries no ISIN.
   */
  isin: string | null;
  /** Security class; UNRESOLVED until the official exchange master is integrated. */
  securityClass: string;
  provider: QuoteProvider;

  // ── Market values ─────────────────────────────────────────────────────────
  ltp: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  changePercent?: number;
  /** Open interest in contracts. Only present for F&O instruments. */
  oi?: number;
  oiDayHigh?: number;
  oiDayLow?: number;
  /** Buy/sell depth quantities (Kite full mode). */
  buyQty?: number;
  sellQty?: number;

  // ── Time ─────────────────────────────────────────────────────────────────
  /**
   * Exchange/provider timestamp when present; null when the provider did not
   * supply one. NEVER replaced by the receipt time.
   */
  exchangeTimestamp: Date | null;
  /**
   * Local receipt timestamp (ms since epoch). Always present.
   * For Phase 0.8B feed ticks: the adapter translation time.
   * For legacy kiteFeed ticks: Date.now() at write time.
   */
  receivedTimestamp: number;
  /**
   * Legacy backward-compat alias: exchangeTimestamp?.getTime() ?? receivedTimestamp.
   * Retained so existing consumers (aggregateCoverageLive, kiteFeed SSE) do
   * not need simultaneous changes. Do not use for new code — prefer
   * exchangeTimestamp and receivedTimestamp explicitly.
   */
  ts: number;

  // ── Provenance ────────────────────────────────────────────────────────────
  /**
   * Registry generation the token was resolved under.
   * Null for legacy writes that bypassed the 0.8B ingestion path.
   */
  registryGenerationId: string | null;
  /**
   * Shard-level subscription set hash (the shard's own shardHash).
   * Null for legacy writes or when the shard plan is unavailable.
   */
  subscriptionSetHash: string | null;
  /**
   * Complete manifest hash across all shards.
   * Null for legacy writes or when the plan is unavailable.
   */
  completeManifestHash: string | null;
  /**
   * Shard that delivered this tick.
   * Null for legacy writes.
   */
  shardId: number | null;

  // ── Status ────────────────────────────────────────────────────────────────
  validationStatus: QuoteValidationStatus;
  /**
   * NOT_EVALUATED for Phase 0.8B: freshness requires a live session clock.
   * Consumers that need freshness should compute it at read time from
   * receivedTimestamp.
   */
  freshnessState: QuoteFreshnessState;
  /**
   * NOT_EVALUATED: cross-provider conflict was not evaluated for this quote.
   * A default of NO_CONFLICT when conflict was never evaluated would be dishonest.
   */
  conflictStatus: QuoteConflictStatus;
  /**
   * receivedTimestamp of the previous accepted quote for this instrument.
   * Null when this is the first accepted quote, or for legacy writes.
   * Reflects the last ACCEPTED canonical value — never updated by a rejected tick.
   */
  lastValidTimestamp: number | null;
}

export interface UpsertQuoteInput {
  providerInstrumentToken: number;
  provider: QuoteProvider;
  ltp: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  changePercent?: number;
  oi?: number;
  oiDayHigh?: number;
  oiDayLow?: number;
  buyQty?: number;
  sellQty?: number;
  /**
   * Exchange/provider timestamp in epoch milliseconds.
   * Absent when the provider did not supply one. Never replaced by receivedTimestamp.
   */
  exchangeTimestamp?: number;
  /**
   * Local receipt timestamp in epoch milliseconds. Always present for canonical writes.
   * Defaults to Date.now() for legacy writes.
   */
  receivedTimestamp?: number;
  // ── Provenance context (optional; null/absent for legacy kiteFeed writes) ──
  registryGenerationId?: string | null;
  subscriptionSetHash?: string | null;
  completeManifestHash?: string | null;
  shardId?: number | null;
}

export type UpsertRejectReason =
  | "UNAPPROVED_PROVIDER"
  | "INVALID_PROVIDER_TOKEN"
  | "UNKNOWN_PROVIDER_TOKEN"
  | "INVALID_PRICE"
  | "INVALID_TIMESTAMP";

export type UpsertResult =
  | { ok: true; tick: LiveTick }
  | { ok: false; reason: UpsertRejectReason; detail: string };

export type QuoteResolution =
  | { status: "UNIQUE"; quote: LiveTick }
  | { status: "AMBIGUOUS"; candidates: LiveTick[] }
  | { status: "NOT_FOUND" };

/** canonicalInstrumentId -> last tick. */
const liveQuotes = new Map<string, LiveTick>();

/**
 * Resolve token -> canonical identity, then store under the canonical id.
 * Rejects anything that cannot be tied to a registered instrument, which is
 * what stops fixture/demo values from entering the production store.
 *
 * Provenance fields (registryGenerationId, shardId, …) are optional. When
 * absent the write is tagged LEGACY_UNVALIDATED, which is honest for the
 * existing kiteFeed code path that pre-dates Phase 0.8B.
 */
export function upsertQuote(input: UpsertQuoteInput): UpsertResult {
  if (!APPROVED_PROVIDERS.has(input.provider)) {
    return { ok: false, reason: "UNAPPROVED_PROVIDER", detail: String(input.provider) };
  }
  const token = input.providerInstrumentToken;
  if (!Number.isInteger(token) || token <= 0) {
    return { ok: false, reason: "INVALID_PROVIDER_TOKEN", detail: String(token) };
  }
  const identity = instrumentRegistry.resolveByToken(token);
  if (identity == null) {
    return { ok: false, reason: "UNKNOWN_PROVIDER_TOKEN", detail: String(token) };
  }
  if (typeof input.ltp !== "number" || !Number.isFinite(input.ltp)) {
    return { ok: false, reason: "INVALID_PRICE", detail: String(input.ltp) };
  }

  // receivedTimestamp must be positive and finite for canonical writes.
  const receivedTimestamp = input.receivedTimestamp ?? Date.now();
  if (!Number.isFinite(receivedTimestamp) || receivedTimestamp <= 0) {
    return { ok: false, reason: "INVALID_TIMESTAMP", detail: String(receivedTimestamp) };
  }

  // exchangeTimestamp: only set when a valid epoch ms was supplied.
  const etMs = input.exchangeTimestamp;
  const exchangeTimestamp: Date | null =
    typeof etMs === "number" && Number.isFinite(etMs) && etMs > 0 ? new Date(etMs) : null;

  // ts: backward-compat alias.
  const ts = exchangeTimestamp?.getTime() ?? receivedTimestamp;

  // lastValidTimestamp: the receivedTimestamp of the PREVIOUS accepted quote.
  const existing = liveQuotes.get(identity.canonicalInstrumentId);
  const lastValidTimestamp = existing?.receivedTimestamp ?? null;

  // Determine validation path.
  const hasProvenance =
    input.registryGenerationId !== undefined &&
    input.registryGenerationId !== null &&
    input.shardId !== undefined &&
    input.shardId !== null;

  const validationStatus: QuoteValidationStatus = hasProvenance ? "ACCEPTED" : "LEGACY_UNVALIDATED";
  const freshnessState: QuoteFreshnessState = hasProvenance ? "NOT_EVALUATED" : "LEGACY_UNVALIDATED";

  const tick: LiveTick = {
    // Identity
    canonicalInstrumentId: identity.canonicalInstrumentId,
    exchange: identity.exchange,
    segment: identity.segment,
    tradingSymbol: identity.tradingSymbol,
    symbol: identity.primaryAlias,
    instrumentToken: token,
    providerExchangeToken: identity.providerExchangeToken,
    securityId: identity.securityId,
    isin: identity.isin,
    securityClass: identity.securityClass,
    provider: input.provider,
    // Market values
    ltp: input.ltp,
    open: input.open,
    high: input.high,
    low: input.low,
    close: input.close,
    volume: input.volume,
    changePercent: input.changePercent,
    oi: input.oi,
    oiDayHigh: input.oiDayHigh,
    oiDayLow: input.oiDayLow,
    buyQty: input.buyQty,
    sellQty: input.sellQty,
    // Time
    exchangeTimestamp,
    receivedTimestamp,
    ts,
    // Provenance
    registryGenerationId: input.registryGenerationId ?? null,
    subscriptionSetHash: input.subscriptionSetHash ?? null,
    completeManifestHash: input.completeManifestHash ?? null,
    shardId: input.shardId ?? null,
    // Status
    validationStatus,
    freshnessState,
    conflictStatus: "NOT_EVALUATED",
    lastValidTimestamp,
  };
  liveQuotes.set(identity.canonicalInstrumentId, tick);
  return { ok: true, tick };
}

export function getQuoteByCanonicalId(canonicalInstrumentId: string): LiveTick | null {
  return liveQuotes.get(canonicalInstrumentId) ?? null;
}

export function getQuoteByToken(token: number): LiveTick | null {
  const identity = instrumentRegistry.resolveByToken(token);
  if (identity == null) return null;
  return liveQuotes.get(identity.canonicalInstrumentId) ?? null;
}

/**
 * Secondary symbol/alias convenience lookup. Returns an explicit AMBIGUOUS
 * result when a symbol exists on more than one exchange — it never picks one.
 */
export function resolveQuoteBySymbol(symbol: string): QuoteResolution {
  const res = instrumentRegistry.resolveBySymbol(symbol);
  if (res.status === "NOT_FOUND") return { status: "NOT_FOUND" };
  if (res.status === "UNIQUE") {
    const q = liveQuotes.get(res.identity.canonicalInstrumentId);
    return q ? { status: "UNIQUE", quote: q } : { status: "NOT_FOUND" };
  }
  const candidates: LiveTick[] = [];
  for (const ident of res.candidates) {
    const q = liveQuotes.get(ident.canonicalInstrumentId);
    if (q) candidates.push(q);
  }
  if (candidates.length === 0) return { status: "NOT_FOUND" };
  if (candidates.length === 1) return { status: "UNIQUE", quote: candidates[0]! };
  return { status: "AMBIGUOUS", candidates };
}

/**
 * Backward-compatible symbol lookup for existing callers.
 * Returns null on ambiguity — deliberately refusing to guess an exchange
 * rather than silently defaulting to NSE.
 */
export function getQuoteBySymbol(symbol: string): LiveTick | null {
  const res = resolveQuoteBySymbol(symbol);
  return res.status === "UNIQUE" ? res.quote : null;
}

/** Every quote keyed by canonical identity. Preferred for new consumers. */
export function allQuotesByCanonicalId(): Record<string, LiveTick> {
  const out: Record<string, LiveTick> = {};
  for (const [k, v] of liveQuotes) out[k] = v;
  return out;
}

/**
 * Legacy-shaped snapshot for existing API/SSE consumers.
 *
 * Keyed by the instrument's legacy alias when that alias is unambiguous, and
 * by the canonical id when it is not. No quote is ever dropped or silently
 * overwritten; an ambiguous symbol simply surfaces under its exchange-
 * qualified key instead.
 */
export function allQuotes(): Record<string, LiveTick> {
  const out: Record<string, LiveTick> = {};
  for (const [canonicalId, tick] of liveQuotes) {
    const res = instrumentRegistry.resolveBySymbol(tick.symbol);
    const key = res.status === "UNIQUE" ? tick.symbol : canonicalId;
    out[key] = tick;
  }
  return out;
}

/**
 * Drop one instrument's quote. Used when a provider-token rebind makes the
 * cached tick unattributable; the price was sourced from a token that no
 * longer identifies this instrument.
 */
export function evictQuote(canonicalInstrumentId: string): boolean {
  return liveQuotes.delete(canonicalInstrumentId);
}

export function quoteCount(): number {
  return liveQuotes.size;
}

export function clearQuotes(): void {
  liveQuotes.clear();
}

export type { CanonicalInstrumentIdentity };
