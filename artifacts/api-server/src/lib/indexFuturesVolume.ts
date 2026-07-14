/**
 * Read-only nearest-month index FUTURES volume series, used solely to give the
 * Charting tab a real, volume-weighted VWAP (and volume bars / Volume Profile)
 * for spot indices — which themselves carry no traded volume.
 *
 * Spot indices (NIFTY / BANKNIFTY / SENSEX / ...) are computed values: Kite's
 * historical API returns volume = 0 for them, so a true VWAP is impossible from
 * the cash index alone. Professional terminals (e.g. TradingView) weight the
 * index by its FUTURES' traded volume. We mirror that: fetch the nearest-expiry
 * FUT contract's candles (which DO carry real volume) and align them by
 * timestamp to the spot index candles.
 *
 * Fail-OPEN everywhere: any failure returns null and the caller leaves the spot
 * candles untouched (volume stays 0 → VWAP / VP honestly unavailable). This
 * module NEVER fabricates volume and NEVER touches signals / paper trading.
 */
import { getRestClient } from "./kiteAuth";
import { loadFnoInstruments, type FnoInstrument } from "./kiteFnoInstruments";
import { fetchKiteHistoricalByToken } from "./kiteIntraday";
import { logger } from "./logger";

type KiteInterval =
  | "minute" | "3minute" | "5minute" | "10minute" | "15minute"
  | "30minute" | "60minute" | "day";

/**
 * Charting index canonical symbol → Kite F&O `name`. Only indices that have a
 * listed futures contract appear here; everything else (NIFTY500, INDIA VIX,
 * the NSE sector indices, global) has no future and is intentionally absent so
 * the merge is a no-op for them.
 */
const INDEX_FUT_NAME: Record<string, string> = {
  NIFTY: "NIFTY",
  BANKNIFTY: "BANKNIFTY",
  FINNIFTY: "FINNIFTY",
  MIDCPNIFTY: "MIDCPNIFTY",
  NIFTYNXT50: "NIFTYNXT50",
  SENSEX: "SENSEX",
  BANKEX: "BANKEX",
};

/** The Kite F&O `name` for an index charting symbol, or null when none lists futures. */
export function indexFutName(symbol: string): string | null {
  return INDEX_FUT_NAME[symbol.toUpperCase()] ?? null;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** UTC epoch (ms) of the current IST calendar day's midnight. */
function istStartOfTodayMs(): number {
  const ist = new Date(Date.now() + IST_OFFSET_MS);
  return Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_OFFSET_MS;
}

function expiryMs(e: Date | string): number {
  return e instanceof Date ? e.getTime() : new Date(e).getTime();
}

function istDayKey(): string {
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

// Resolved near-month FUT token, revalidated once per IST day per F&O name.
const tokenCache = new Map<string, { day: string; token: number | null }>();

async function resolveNearestFutToken(
  kc: unknown,
  fnoName: string,
): Promise<number | null> {
  const day = istDayKey();
  const cached = tokenCache.get(fnoName);
  if (cached && cached.day === day) return cached.token;

  let token: number | null = null;
  try {
    const rows = await loadFnoInstruments(kc);
    const cutoff = istStartOfTodayMs();
    const futs = rows
      .filter((r: FnoInstrument) => r.instrument_type === "FUT" && r.name === fnoName)
      .map((r: FnoInstrument) => ({ token: r.instrument_token, exp: expiryMs(r.expiry) }))
      .filter(f =>
        Number.isFinite(f.token) && f.token > 0 &&
        Number.isFinite(f.exp) && f.exp >= cutoff,
      )
      .sort((a, b) => a.exp - b.exp);
    token = futs.length > 0 ? futs[0]!.token : null;
  } catch (err) {
    logger.warn({ err: (err as Error).message, fnoName }, "index-fut: token resolution failed");
    token = null;
  }
  tokenCache.set(fnoName, { day, token });
  return token;
}

/**
 * Nearest-month futures volume keyed by epoch-second candle open, for the index
 * whose charting symbol is `indexSymbol`. Returns null when the symbol has no
 * futures, there is no live Kite session, or the fetch failed/was empty.
 */
export async function fetchIndexFuturesVolume(
  indexSymbol: string,
  interval: KiteInterval,
  daysBack: number,
): Promise<Map<number, number> | null> {
  const fnoName = indexFutName(indexSymbol);
  if (!fnoName) return null;

  const client = await getRestClient();
  if (!client) return null;

  const token = await resolveNearestFutToken(client.kc, fnoName);
  if (token == null) return null;

  const chart = await fetchKiteHistoricalByToken(token, `FUT:${fnoName}`, interval, daysBack);
  if (!chart) return null;

  const out = new Map<number, number>();
  for (let i = 0; i < chart.timestamps.length; i++) {
    const t = chart.timestamps[i]!;
    const v = chart.volume[i];
    if (Number.isFinite(t) && v != null && Number.isFinite(v) && v > 0) {
      out.set(t, v);
    }
  }
  return out.size > 0 ? out : null;
}
