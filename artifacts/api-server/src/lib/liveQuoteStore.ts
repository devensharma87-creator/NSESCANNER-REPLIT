/**
 * Live quote store — Data Foundation Phase 0.5A.
 *
 * STORAGE IDENTITY RULE
 * ---------------------
 * A quote is stored under its canonicalInstrumentId, which is resolved from
 * the provider instrument token BEFORE insertion. The trading symbol plays no
 * part in deciding where a quote is stored. A tick whose token is not in the
 * canonical registry is rejected outright — it can never reach the store.
 *
 * This replaces the previous `liveQuotes.set(symbol, tick)`, under which an
 * NSE and a BSE tick for the same symbol collapsed onto one entry.
 *
 * Freshness semantics are unchanged by this phase: this module stores and
 * returns ticks with their timestamps and does not classify anything as LIVE.
 * Presence in this map is not a freshness claim.
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

export interface LiveTick {
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
  provider: QuoteProvider;
  ltp: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  changePercent?: number;
  ts: number;
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
  ts: number;
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
  if (typeof input.ts !== "number" || !Number.isFinite(input.ts) || input.ts <= 0) {
    return { ok: false, reason: "INVALID_TIMESTAMP", detail: String(input.ts) };
  }

  const tick: LiveTick = {
    canonicalInstrumentId: identity.canonicalInstrumentId,
    exchange: identity.exchange,
    segment: identity.segment,
    tradingSymbol: identity.tradingSymbol,
    symbol: identity.primaryAlias,
    instrumentToken: token,
    provider: input.provider,
    ltp: input.ltp,
    open: input.open,
    high: input.high,
    low: input.low,
    close: input.close,
    volume: input.volume,
    changePercent: input.changePercent,
    ts: input.ts,
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
