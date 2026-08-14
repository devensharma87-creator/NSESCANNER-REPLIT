/**
 * Live Kite tick feed.
 *
 * - Resolves NSE trading symbols → instrument_token via Kite's `getInstruments`
 *   dump (cached for 24h since instruments change at most once per day).
 * - Maintains a single KiteTicker WebSocket; subscribes to a rolling set of
 *   instrument tokens (currently: NIFTY 50 watchlist).
 * - Exposes `getLiveQuote(symbol)` → returns {ltp, ohlc, volume, ts} from the
 *   in-memory tick map. `null` if the symbol hasn't been subscribed or no
 *   tick has arrived yet.
 * - Pushes every tick to registered SSE listeners.
 */
import { logger } from "./logger";
import { getBootCapabilities, runIfCapable } from "./bootCapabilities";
import { getActiveSession, getRestClient, autoMirrorSession, autoMirrorInstruments, type ActiveSession } from "./kiteAuth";
import { NIFTY50_SYMBOLS } from "./watchlistLists";
import { KiteTicker } from "kiteconnect";
import { tapPushTick, tapPushSystemEvent } from "./liveTapRing";
import {
  instrumentRegistry,
  buildCanonicalInstrumentId,
  normalizeTradingSymbol,
  type CanonicalExchange,
  type CanonicalSegment,
} from "./canonicalInstrument";
import {
  reconcileProviderToken,
  tokenReconciliationDiagnostics,
  type OwnerTokenReconciliationDiagnostics,
  type SubscriptionPort,
} from "./providerTokenReconciliation";
import {
  upsertQuote,
  getQuoteBySymbol,
  allQuotes,
  quoteCount,
  clearQuotes,
  evictQuote as evictStoredQuote,
  resolveQuoteBySymbol,
  type LiveTick,
  type QuoteResolution,
} from "./liveQuoteStore";

export type { LiveTick, QuoteResolution };

/**
 * Subscription side-effects handed to the token reconciler. Keeping them
 * behind this port is what lets the no-orphan policy be tested without a
 * live socket.
 */
const subscriptionPort: SubscriptionPort = {
  isSubscribed: (t) => subscribedTokens.has(t),
  unsubscribe: (t) => {
    if (!getBootCapabilities().subscriptions) throw new Error("subscriptions suppressed (boot proof mode)");
    if (!ticker) throw new Error("ticker unavailable");
    ticker.unsubscribe([t]);
  },
  markUnsubscribed: (t) => { subscribedTokens.delete(t); },
  subscribeToken: (t) => {
    if (!getBootCapabilities().subscriptions) throw new Error("subscriptions suppressed (boot proof mode)");
    if (!ticker) throw new Error("ticker unavailable");
    ticker.subscribe([t]);
    ticker.setMode(ticker.modeQuote, [t]);
  },
  markSubscribed: (t) => { subscribedTokens.add(t); },
  evictQuote: (id) => { evictStoredQuote(id); },
};

/** Canonical id, or null when the symbol cannot form one. Never throws. */
function safeCanonicalId(
  exchange: CanonicalExchange,
  segment: CanonicalSegment,
  tradingSymbol: string,
): string | null {
  if (normalizeTradingSymbol(tradingSymbol) == null) return null;
  return buildCanonicalInstrumentId(exchange, segment, tradingSymbol);
}

/**
 * Align an identity's provider token with the freshly loaded master.
 * Returns false when the caller must skip this instrument this cycle.
 */
function reconcileOrSkip(canonicalId: string, token: number, label: string): boolean {
  const rec = reconcileProviderToken({
    canonicalInstrumentId: canonicalId,
    desiredToken: token,
    port: subscriptionPort,
    nowMs: Date.now(),
  });
  if (rec.status === "TOKEN_REBIND_REQUIRES_SUBSCRIPTION_RECONCILIATION") {
    logger.warn(
      { instrument: label, previousToken: rec.previousToken, desiredToken: rec.desiredToken, detail: rec.detail },
      "Token rebind deferred — previous token stays active, queued for reconciliation",
    );
    return false;
  }
  if (rec.status === "REJECTED") {
    logger.warn({ instrument: label, token, reason: rec.reason, detail: rec.detail }, "Token reconciliation rejected");
    return false;
  }
  if (rec.status === "REBOUND") {
    // The replacement token was subscribed and marked inside the rotation, so
    // the caller's batch subscribe must NOT re-add it.
    logger.warn(
      { instrument: label, previousToken: rec.previousToken, newToken: rec.newToken },
      "Provider token rebound — old token unsubscribed, replacement subscribed, stale quote evicted",
    );
  }
  return true;
}

/**
 * Explicit symbol/alias resolution. Unlike getLiveQuote(), this reports
 * AMBIGUOUS when a symbol exists on more than one exchange so callers can
 * surface the choice instead of silently receiving one exchange's price.
 */
export function resolveLiveQuoteBySymbol(symbol: string): QuoteResolution {
  return resolveQuoteBySymbol(symbol);
}

interface InstrumentMeta {
  instrument_token: number;
  exchange_token: number;
  tradingsymbol: string;
  name?: string;
  exchange: string;
  segment: string;
  instrument_type: string;
}

const INSTRUMENTS_TTL_MS = 24 * 3600 * 1000;

let instrumentsCache: { fetchedAt: number; bySymbol: Map<string, InstrumentMeta> } | null = null;
let ticker: any = null;
let tickerStarted = false;
let lastConnect: number | null = null;
let lastDisconnect: number | null = null;
let lastError: string | null = null;
let subscribedTokens: Set<number> = new Set();
const sseListeners = new Set<(tick: LiveTick) => void>();

/** Refresh the NSE EQ instruments dump. */
async function loadInstruments(): Promise<Map<string, InstrumentMeta> | null> {
  if (instrumentsCache && Date.now() - instrumentsCache.fetchedAt < INSTRUMENTS_TTL_MS) {
    return instrumentsCache.bySymbol;
  }
  const ctx = await getRestClient();
  if (!ctx) return null;
  try {
    const list = (await ctx.kc.getInstruments(["NSE"])) as InstrumentMeta[];
    const bySymbol = new Map<string, InstrumentMeta>();
    for (const ins of list) {
      if (ins.instrument_type !== "EQ") continue;
      bySymbol.set(ins.tradingsymbol, ins);
    }
    instrumentsCache = { fetchedAt: Date.now(), bySymbol };
    logger.info({ count: bySymbol.size }, "Kite instruments loaded");
    return bySymbol;
  } catch (err) {
    lastError = (err as Error).message;
    logger.warn({ err: lastError }, "Kite getInstruments failed");
    return null;
  }
}

/** Resolve plain NSE symbols to their full Kite instrument records. */
async function resolveInstruments(symbols: string[]): Promise<InstrumentMeta[]> {
  const map = await loadInstruments();
  if (!map) return [];
  const out: InstrumentMeta[] = [];
  for (const s of symbols) {
    const ins = map.get(s);
    if (ins) out.push(ins);
  }
  return out;
}

/** Kite's CSV-backed dumps can yield numeric fields as strings. */
function asToken(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function asExchange(raw: unknown): "NSE" | "BSE" | null {
  return raw === "NSE" || raw === "BSE" ? raw : null;
}

function handleTicks(ticks: any[]): void {
  const now = Date.now();
  for (const t of ticks) {
    const tok = asToken(t.instrument_token);
    if (tok == null) continue;
    // Storage identity comes from the provider token via the canonical
    // registry. The trading symbol never decides where a quote is stored.
    const identity = instrumentRegistry.resolveByToken(tok);
    if (!identity) continue;
    const ohlc = t.ohlc ?? {};
    const close = ohlc.close as number | undefined;
    const ltp = (t.last_price ?? t.ltp) as number | undefined;
    if (ltp == null || !Number.isFinite(ltp)) continue;
    const stored = upsertQuote({
      providerInstrumentToken: tok,
      provider: "KITE",
      ltp,
      open: ohlc.open,
      high: ohlc.high,
      low: ohlc.low,
      close,
      volume: t.volume_traded ?? t.volume,
      changePercent: close && close > 0 ? +(((ltp - close) / close) * 100).toFixed(2) : undefined,
      receivedTimestamp: now,
    });
    if (!stored.ok) continue;
    const tick = stored.tick;
    // R1-tail — replay recorder read-only tap. Wrapped in try/catch so
    // a buffer failure NEVER touches the trading path (spec §12.2). The
    // recorder endpoint /api/replay/record drains this into a fixture
    // on owner demand.
    try {
      tapPushTick({
        receivedAtMs: now,
        instrumentToken: tok,
        symbol: tick.symbol,
        ltp,
        ltq: (t.last_traded_quantity ?? null) as number | null,
        volume: (t.volume_traded ?? t.volume ?? null) as number | null,
        oi: (t.oi ?? null) as number | null,
        raw: { ohlc, change_percent: tick.changePercent },
      });
    } catch { /* fail-open — recorder is read-only */ }
    for (const fn of sseListeners) {
      try { fn(tick); } catch { /* swallow */ }
    }
  }
}

/** Idempotently start the WebSocket and subscribe to the default symbol set. */
export async function startTicker(session?: ActiveSession): Promise<boolean> {
  if (tickerStarted) return true;
  // Boot-proof mode: no WebSocket may be constructed by ANY caller, not just
  // the boot path. This is the last line of defence, at the only place in the
  // repository where a KiteTicker is created.
  if (!getBootCapabilities().webSockets) {
    runIfCapable("kiteTickerConstruction", "webSockets", () => undefined);
    return false;
  }
  const sess = session ?? (await getActiveSession());
  if (!sess) return false;
  // A successful startTicker call (whether triggered by the daily login
  // callback or by the noreconnect-restart loop) means the broker is
  // reachable and the session is good — reset the backoff so the *next*
  // failure starts from the 60s base instead of inheriting a 10-min cap
  // accumulated by the last outage.
  restartBackoffMs = 60_000;
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }

  ticker = new KiteTicker({ api_key: sess.apiKey, access_token: sess.accessToken });
  ticker.autoReconnect(true, 50, 5);

  ticker.on("connect", async () => {
    lastConnect = Date.now();
    lastError = null;
    logger.info("Kite ticker connected");
    // R1-tail: replay recorder read-only tap. Session edges are gold
    // for replay determinism — the engine's Kite-offline path is
    // regime-critical. Fail-open.
    try {
      tapPushSystemEvent({
        emittedAtMs: lastConnect,
        kind: "KITE_SESSION_EDGE",
        detail: { edge: "connect" },
      });
    } catch { /* fail-open */ }
    // Subscribe to NIFTY 50 by default. F&O / sector lists can call subscribe() too.
    await subscribe(NIFTY50_SYMBOLS);
    // Phase-4 (2026-05-06): also subscribe to every Indian index spot
    // we care about so getKiteIndexQuotes() can serve from the in-memory
    // tick cache instead of polling Kite's REST `getQuote` every 10s.
    // This eliminates the homepage-strip and F&O-sweep REST roundtrips
    // during regular session hours. REST is still the fallback when no
    // tick has arrived yet (cold start) or the ticker is disconnected.
    await subscribeIndices().catch(err =>
      logger.warn({ err: (err as Error).message }, "subscribeIndices failed"),
    );
  });

  ticker.on("ticks", handleTicks);

  ticker.on("disconnect", (err: any) => {
    lastDisconnect = Date.now();
    lastError = describeWsError(err);
    logger.warn({ err: lastError }, "Kite ticker disconnected");
    try {
      tapPushSystemEvent({
        emittedAtMs: lastDisconnect,
        kind: "KITE_SESSION_EDGE",
        detail: { edge: "disconnect", err: lastError },
      });
    } catch { /* fail-open */ }
  });

  ticker.on("error", (err: any) => {
    lastError = describeWsError(err);
    logger.warn({ err: lastError }, "Kite ticker error");
  });

  ticker.on("noreconnect", () => {
    // Kite's auto-reconnect (50 retries × 5s ≈ 4 min) gave up. Without an
    // outer-loop restart the ticker stays dead until a process restart —
    // the user sees Connected=No, Subscribed=0, Live Quotes=0 with a valid
    // session in the DB. Schedule a self-restart with exponential backoff
    // that re-checks for a valid session each cycle so a 06:00 IST token
    // expiry doesn't trigger an infinite reconnect storm.
    lastError = "Auto-reconnect exhausted; scheduling restart";
    logger.warn("Kite ticker auto-reconnect exhausted; scheduling restart in 60s");
    tickerStarted = false;
    ticker = null;
    subscribedTokens.clear();
    scheduleTickerRestart(60_000);
  });

  ticker.connect();
  tickerStarted = true;
  return true;
}

let restartTimer: NodeJS.Timeout | null = null;
let restartBackoffMs = 60_000;
const MAX_RESTART_BACKOFF = 10 * 60_000;

function scheduleTickerRestart(initialDelayMs: number): void {
  if (restartTimer) return; // already scheduled
  restartBackoffMs = initialDelayMs;
  const tick = async () => {
    restartTimer = null;
    const sess = await getActiveSession().catch(() => null);
    if (!sess) {
      // No session in DB → user has logged out or token expired. Stop the
      // restart loop; a fresh login will call startTicker() on its own.
      logger.info("Ticker restart skipped — no active Kite session");
      return;
    }
    const ok = await startTicker(sess).catch(() => false);
    if (!ok) {
      restartBackoffMs = Math.min(restartBackoffMs * 2, MAX_RESTART_BACKOFF);
      logger.warn({ nextDelayMs: restartBackoffMs }, "Ticker restart failed; backing off");
      restartTimer = setTimeout(tick, restartBackoffMs);
    } else {
      logger.info("Ticker restart succeeded");
      restartBackoffMs = 60_000;
    }
  };
  restartTimer = setTimeout(tick, initialDelayMs);
}

function describeWsError(err: unknown): string {
  if (err == null) return "unknown (null)";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (typeof err === "object") {
    const e = err as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof e["code"] === "number" || typeof e["code"] === "string") parts.push(`code=${e["code"]}`);
    if (typeof e["type"] === "string") parts.push(`type=${e["type"]}`);
    if (typeof e["reason"] === "string") parts.push(`reason=${e["reason"]}`);
    if (typeof e["message"] === "string") parts.push(`message=${e["message"]}`);
    if (parts.length > 0) return parts.join(" ");
    try { return JSON.stringify(err); } catch { return "unknown (unstringifiable)"; }
  }
  return String(err);
}

/** Stop the ticker and clear in-memory state. */
export function stopTicker(): void {
  if (ticker) {
    try { ticker.disconnect(); } catch { /* ignore */ }
  }
  ticker = null;
  tickerStarted = false;
  subscribedTokens.clear();
  clearQuotes();
}

/** Subscribe to a list of symbols (additive). Returns the number actually added. */
export async function subscribe(symbols: string[]): Promise<number> {
  if (!ticker || !tickerStarted) return 0;
  const resolved = await resolveInstruments(symbols);
  const newTokens: number[] = [];
  for (const ins of resolved) {
    const token = asToken(ins.instrument_token);
    const exchange = asExchange(ins.exchange);
    if (token == null || exchange == null) {
      logger.warn(
        { tradingsymbol: ins.tradingsymbol, token: ins.instrument_token, exchange: ins.exchange },
        "Skipping instrument with unusable token/exchange",
      );
      continue;
    }
    const canonicalId = safeCanonicalId(exchange, "EQUITY", ins.tradingsymbol);
    if (canonicalId == null) {
      logger.warn({ tradingsymbol: ins.tradingsymbol }, "Skipping instrument with unusable trading symbol");
      continue;
    }
    if (!reconcileOrSkip(canonicalId, token, ins.tradingsymbol)) continue;
    if (subscribedTokens.has(token)) continue;
    const reg = instrumentRegistry.register({
      exchange,
      segment: "EQUITY",
      tradingSymbol: ins.tradingsymbol,
      providerInstrumentToken: token,
      providerExchangeToken: asToken(ins.exchange_token),
    });
    if (!reg.ok) {
      logger.warn(
        { tradingsymbol: ins.tradingsymbol, token, reason: reg.reason, detail: reg.detail },
        "Canonical identity rejected; instrument not subscribed",
      );
      continue;
    }
    subscribedTokens.add(token);
    newTokens.push(token);
  }
  if (newTokens.length > 0) {
    try {
      ticker.subscribe(newTokens);
      // "quote" mode = LTP + OHLC + volume; "full" adds market depth (heavier)
      ticker.setMode(ticker.modeQuote, newTokens);
      logger.info({ added: newTokens.length, total: subscribedTokens.size }, "Kite subscribed");
    } catch (err) {
      lastError = (err as Error).message;
      logger.warn({ err: lastError }, "Kite subscribe failed");
    }
  }
  return newTokens.length;
}

/** O(1) lookup of last tick for a symbol. */
export function getLiveQuote(symbol: string): LiveTick | null {
  return getQuoteBySymbol(symbol);
}

/**
 * Phase-4 (2026-05-06): subscribe the WebSocket to every Indian index
 * spot we surface (NIFTY 50 / BANK NIFTY / SENSEX / sectorals etc).
 * Tokens are resolved via kiteIntraday's INDEX_TABLE — keyed by their
 * yahoo-style alias so existing yahoo-keyed callers (`getKiteIndexQuotes`,
 * `optionSignals` overlay) can read tick data via `getLiveQuote(yahoo)`
 * without restructuring. Idempotent: skips already-subscribed tokens.
 */
export async function subscribeIndices(): Promise<number> {
  if (!ticker || !tickerStarted) return 0;
  // Lazy import to avoid an init-time circular reference between
  // kiteFeed and kiteIntraday (kiteIntraday already imports
  // getInstrumentToken from this module).
  const { getIndexIdentityByToken } = await import("./kiteIntraday");
  const byToken = await getIndexIdentityByToken();
  if (!byToken) return 0;
  const newTokens: number[] = [];
  for (const [token, meta] of byToken) {
    const exchange = asExchange(meta.exchange);
    if (exchange == null) {
      logger.warn({ tradingSymbol: meta.tradingSymbol, exchange: meta.exchange }, "Skipping index with unusable exchange");
      continue;
    }
    const canonicalId = safeCanonicalId(exchange, "INDEX", meta.tradingSymbol);
    if (canonicalId == null) {
      logger.warn({ tradingSymbol: meta.tradingSymbol }, "Skipping index with unusable trading symbol");
      continue;
    }
    if (!reconcileOrSkip(canonicalId, token, meta.tradingSymbol)) continue;
    const reg = instrumentRegistry.register({
      exchange,
      segment: "INDEX",
      tradingSymbol: meta.tradingSymbol,
      providerInstrumentToken: token,
      securityClass: "INDEX",
      aliases: meta.aliases,
      preferredAlias: meta.preferredAlias,
    });
    if (!reg.ok) {
      logger.warn(
        { tradingSymbol: meta.tradingSymbol, token, reason: reg.reason, detail: reg.detail },
        "Canonical index identity rejected; index not subscribed",
      );
      continue;
    }
    if (subscribedTokens.has(token)) continue;
    subscribedTokens.add(token);
    newTokens.push(token);
  }
  if (newTokens.length > 0) {
    try {
      ticker.subscribe(newTokens);
      ticker.setMode(ticker.modeQuote, newTokens);
      logger.info({ added: newTokens.length, kind: "indices" }, "Kite indices subscribed");
    } catch (err) {
      lastError = (err as Error).message;
      logger.warn({ err: lastError }, "Kite index subscribe failed");
    }
  }
  return newTokens.length;
}

/**
 * Resolve a single NSE EQ tradingsymbol to its Kite instrument_token.
 * Triggers an instrument-dump load on first call (cached 24h). Returns
 * null when no Kite session is active or the symbol is not in the EQ
 * list (e.g. delisted, F&O-only, or a typo).
 */
export async function getInstrumentToken(symbol: string): Promise<number | null> {
  const map = await loadInstruments();
  if (!map) return null;
  const ins = map.get(symbol);
  return ins ? ins.instrument_token : null;
}

export function getAllLiveQuotes(): Record<string, LiveTick> {
  return allQuotes();
}

/**
 * Read-only snapshot of the provider tokens currently subscribed.
 *
 * Coverage accounting needs PER-INSTRUMENT subscription state; the aggregate
 * `feedStatus().subscribed` count cannot tell you WHICH instruments are dark.
 * Returns a copy — callers must never mutate the live subscription set.
 */
export function subscribedTokenSnapshot(): number[] {
  return [...subscribedTokens];
}

/**
 * Owner-only feed status (every /api/kite/* route is owner-gated), so this may
 * carry exact identity and provider-token detail for deferred rotations.
 * Public surfaces must use publicTokenReconciliationStatus() instead.
 */
export function feedStatus(): {
  running: boolean;
  connected: boolean;
  subscribed: number;
  liveQuotes: number;
  lastConnectAt: string | null;
  lastDisconnectAt: string | null;
  lastError: string | null;
  tokenReconciliation: OwnerTokenReconciliationDiagnostics;
} {
  return {
    running: tickerStarted,
    connected: !!(ticker && typeof ticker.connected === "function" && ticker.connected()),
    subscribed: subscribedTokens.size,
    liveQuotes: quoteCount(),
    lastConnectAt: lastConnect ? new Date(lastConnect).toISOString() : null,
    lastDisconnectAt: lastDisconnect ? new Date(lastDisconnect).toISOString() : null,
    lastError,
    tokenReconciliation: tokenReconciliationDiagnostics(),
  };
}

export function addTickListener(fn: (tick: LiveTick) => void): () => void {
  sseListeners.add(fn);
  return () => sseListeners.delete(fn);
}

/** Called from server bootstrap. Tries to resume the ticker if a valid token is in DB.
 *  If no local session exists, attempts to auto-mirror from production. */
export async function bootstrapKite(): Promise<void> {
  try {
    let ok = await startTicker();
    if (ok) {
      logger.info("Kite live feed started from saved session");
      return;
    }
    const mirrored = await autoMirrorSession();
    if (mirrored) {
      ok = await startTicker(mirrored);
      if (ok) {
        logger.info("Kite live feed started from auto-mirrored production session");
        return;
      }
    }
    logger.info("Kite not connected (no active session). User must complete daily login.");
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "Kite bootstrap failed");
  } finally {
    autoMirrorInstruments().catch(() => {});
  }
}
