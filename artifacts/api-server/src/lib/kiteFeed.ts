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
import { getActiveSession, getRestClient, autoMirrorSession, type ActiveSession } from "./kiteAuth";
import { NIFTY50_SYMBOLS } from "./watchlistLists";
import { KiteTicker } from "kiteconnect";

export interface LiveTick {
  symbol: string;
  instrumentToken: number;
  ltp: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  changePercent?: number;
  ts: number;
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
const tokenToSymbol = new Map<number, string>();
const liveQuotes = new Map<string, LiveTick>();
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

/** Resolve a list of plain NSE symbols to Kite instrument tokens. */
async function resolveTokens(symbols: string[]): Promise<{ token: number; symbol: string }[]> {
  const map = await loadInstruments();
  if (!map) return [];
  const out: { token: number; symbol: string }[] = [];
  for (const s of symbols) {
    const ins = map.get(s);
    if (ins) out.push({ token: ins.instrument_token, symbol: s });
  }
  return out;
}

function handleTicks(ticks: any[]): void {
  const now = Date.now();
  for (const t of ticks) {
    const tok = t.instrument_token as number;
    const sym = tokenToSymbol.get(tok);
    if (!sym) continue;
    const ohlc = t.ohlc ?? {};
    const close = ohlc.close as number | undefined;
    const ltp = (t.last_price ?? t.ltp) as number | undefined;
    if (ltp == null || !Number.isFinite(ltp)) continue;
    const tick: LiveTick = {
      symbol: sym,
      instrumentToken: tok,
      ltp,
      open: ohlc.open,
      high: ohlc.high,
      low: ohlc.low,
      close,
      volume: t.volume_traded ?? t.volume,
      changePercent: close && close > 0 ? +(((ltp - close) / close) * 100).toFixed(2) : undefined,
      ts: now,
    };
    liveQuotes.set(sym, tick);
    for (const fn of sseListeners) {
      try { fn(tick); } catch { /* swallow */ }
    }
  }
}

/** Idempotently start the WebSocket and subscribe to the default symbol set. */
export async function startTicker(session?: ActiveSession): Promise<boolean> {
  if (tickerStarted) return true;
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
    // Subscribe to NIFTY 50 by default. F&O / sector lists can call subscribe() too.
    await subscribe(NIFTY50_SYMBOLS);
  });

  ticker.on("ticks", handleTicks);

  ticker.on("disconnect", (err: any) => {
    lastDisconnect = Date.now();
    lastError = describeWsError(err);
    logger.warn({ err: lastError }, "Kite ticker disconnected");
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
    tokenToSymbol.clear();
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
  tokenToSymbol.clear();
  liveQuotes.clear();
}

/** Subscribe to a list of symbols (additive). Returns the number actually added. */
export async function subscribe(symbols: string[]): Promise<number> {
  if (!ticker || !tickerStarted) return 0;
  const resolved = await resolveTokens(symbols);
  const newTokens: number[] = [];
  for (const { token, symbol } of resolved) {
    if (subscribedTokens.has(token)) continue;
    subscribedTokens.add(token);
    tokenToSymbol.set(token, symbol);
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
  return liveQuotes.get(symbol) ?? null;
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
  const out: Record<string, LiveTick> = {};
  for (const [k, v] of liveQuotes) out[k] = v;
  return out;
}

export function feedStatus(): {
  running: boolean;
  connected: boolean;
  subscribed: number;
  liveQuotes: number;
  lastConnectAt: string | null;
  lastDisconnectAt: string | null;
  lastError: string | null;
} {
  return {
    running: tickerStarted,
    connected: !!(ticker && typeof ticker.connected === "function" && ticker.connected()),
    subscribed: subscribedTokens.size,
    liveQuotes: liveQuotes.size,
    lastConnectAt: lastConnect ? new Date(lastConnect).toISOString() : null,
    lastDisconnectAt: lastDisconnect ? new Date(lastDisconnect).toISOString() : null,
    lastError,
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
  }
}
