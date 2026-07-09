import { logger } from "./logger";

export interface FnoInstrument {
  instrument_token: number;
  exchange_token: number;
  tradingsymbol: string;
  name: string;
  last_price: number;
  expiry: Date | string;
  strike: number;
  tick_size: number;
  lot_size: number;
  instrument_type: string;
  segment: string;
  exchange: string;
}

let lastGoodRows: FnoInstrument[] | null = null;
let inflight: Promise<FnoInstrument[]> | null = null;

export async function loadFnoInstruments(kc: any): Promise<FnoInstrument[]> {
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const [nfo, bfo] = await Promise.all([
        (kc.getInstruments("NFO") as Promise<FnoInstrument[]>).catch((err: Error) => {
          logger.warn({ err: err.message }, "Kite NFO instruments fetch failed");
          return [] as FnoInstrument[];
        }),
        (kc.getInstruments("BFO") as Promise<FnoInstrument[]>).catch((err: Error) => {
          logger.warn({ err: err.message }, "Kite BFO instruments fetch failed");
          return [] as FnoInstrument[];
        }),
      ]);
      const rows = [...nfo, ...bfo];
      if (rows.length > 0) {
        lastGoodRows = rows;
        logger.info({ nfo: nfo.length, bfo: bfo.length, total: rows.length }, "F&O instruments combined");
      }
      return rows.length > 0 ? rows : (lastGoodRows ?? []);
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function isFnoInstrumentsCacheReady(): boolean {
  return lastGoodRows != null && lastGoodRows.length > 0;
}

export function clearFnoInstrumentsCache(): void {
  lastGoodRows = null;
}

/**
 * Reads the cached Kite F&O instrument dump synchronously to retrieve the
 * canonical lot size for the given index. Returns null when the cache is cold
 * (pre-warmup) — callers must fall back to the static LOT_SIZES map.
 *
 * contractGrade: "instrument_master" when returned from here; caller stamps
 * "static_fallback" when this returns null. Drift alarm fires in callers when
 * master lot size differs from the static map.
 */
export function getCachedLotSizeForIndex(indexSymbol: string): number | null {
  if (!lastGoodRows) return null;
  const sym = indexSymbol.toUpperCase();
  const row = lastGoodRows.find(
    r => r.name === sym && (r.instrument_type === "CE" || r.instrument_type === "PE"),
  );
  return row && row.lot_size > 0 ? row.lot_size : null;
}

/**
 * Test-only helper — sets the in-memory instruments cache to the given rows.
 * Never call from production code. Prefixed with underscore to signal test use.
 */
export function _setFnoInstrumentsCacheForTest(rows: FnoInstrument[]): void {
  lastGoodRows = rows;
}
