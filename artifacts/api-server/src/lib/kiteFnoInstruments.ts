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
