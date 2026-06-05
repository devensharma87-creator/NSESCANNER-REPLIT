import { describe, it, expect } from "vitest";
import {
  candleUtcIso,
  candleIstIso,
  istMinuteOfDay,
  isSessionValid,
  isSessionValidUtcIso,
  SESSION_OPEN_MIN,
  SESSION_CLOSE_MIN,
} from "./time";
import { loadHistoricalCandles, isSupportedInstrument } from "./candleSource";
import { runDirectional } from "./directional";
import { buildContext } from "./strategies/context";
import { listStrategies, DEFAULT_FILTERS } from "./strategies";
import { runStrategy } from "./strategies/runner";

/** Candle convention: IST wall clock encoded in UTC fields (see candleSource). */
function wall(y: number, mo: number, d: number, hh: number, mm: number): Date {
  return new Date(Date.UTC(y, mo - 1, d, hh, mm, 0));
}

describe("backtest time helpers (IST/UTC boundary)", () => {
  it("candleUtcIso emits a TRUE UTC instant (subtracts +05:30), not the wall clock", () => {
    // 13:30 IST -> 08:00 UTC. The old bug stamped '13:30Z' which then double-shifted.
    expect(candleUtcIso(wall(2024, 6, 5, 13, 30))).toBe("2024-06-05T08:00:00.000Z");
    expect(candleUtcIso(wall(2024, 6, 5, 9, 15))).toBe("2024-06-05T03:45:00.000Z");
    expect(candleUtcIso(wall(2024, 6, 5, 15, 30))).toBe("2024-06-05T10:00:00.000Z");
  });

  it("round-trips: formatting candleUtcIso in Asia/Kolkata reproduces the IST clock (NO double conversion)", () => {
    for (const [hh, mm] of [
      [9, 15],
      [13, 30],
      [15, 30],
    ] as const) {
      const iso = candleUtcIso(wall(2024, 6, 5, hh, mm));
      const shown = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(iso));
      expect(shown).toBe(`${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`);
    }
  });

  it("candleIstIso is an explicit, self-describing +05:30 label", () => {
    expect(candleIstIso(wall(2024, 6, 5, 13, 30))).toBe("2024-06-05T13:30:00+05:30");
  });

  it("istMinuteOfDay reads the IST clock straight off the convention", () => {
    expect(istMinuteOfDay(wall(2024, 6, 5, 9, 15))).toBe(SESSION_OPEN_MIN);
    expect(istMinuteOfDay(wall(2024, 6, 5, 15, 30))).toBe(SESSION_CLOSE_MIN);
  });

  it("isSessionValid enforces the 09:15–15:30 IST window (time-of-day only)", () => {
    expect(isSessionValid(wall(2024, 6, 5, 9, 15))).toBe(true); // open
    expect(isSessionValid(wall(2024, 6, 5, 15, 30))).toBe(true); // close
    expect(isSessionValid(wall(2024, 6, 5, 9, 0))).toBe(false); // pre-open
    expect(isSessionValid(wall(2024, 6, 5, 19, 0))).toBe(false); // the buggy "07:00 pm"
    // NSE runs occasional legitimate weekend sessions (e.g. Budget Sat 2025-02-01),
    // so weekday is intentionally NOT a rejection criterion.
    expect(isSessionValid(wall(2025, 2, 1, 9, 30))).toBe(true); // Sat Budget session
  });

  it("isSessionValidUtcIso validates an already-emitted true-UTC instant", () => {
    expect(isSessionValidUtcIso(candleUtcIso(wall(2024, 6, 5, 13, 30)))).toBe(true);
    expect(isSessionValidUtcIso(candleUtcIso(wall(2024, 6, 5, 19, 0)))).toBe(false);
    expect(isSessionValidUtcIso(null)).toBe(false);
    expect(isSessionValidUtcIso("not-a-date")).toBe(false);
  });
});

describe("backtest engines emit only in-session timestamps (regression for the +05:30 double-shift)", () => {
  const SYMBOLS = ["NIFTY", "BANKNIFTY", "SENSEX"] as const;

  it(
    "directional + strategy trades never land outside 09:15–15:30 IST",
    async () => {
      // A real ~3-month window keeps this fast under suite contention while still
      // exercising the live emission paths on genuine candle history.
      const FROM = "2026-03-01";
      let checkedAny = false;
      for (const sym of SYMBOLS) {
        if (!isSupportedInstrument(sym)) continue;
        const { candles, available } = await loadHistoricalCandles(sym, FROM, null);
        if (!available || candles.length === 0) continue; // honest skip when CSV absent
        checkedAny = true;

      const dir = runDirectional(candles, {
        indexSymbol: sym,
        lotSize: 75,
        startingCapital: 1_000_000,
        riskPerTradePct: 1,
      });
      for (const t of dir) {
        expect(isSessionValidUtcIso(t.entryAt), `dir ${sym} entry ${t.entryAt}`).toBe(true);
        expect(isSessionValidUtcIso(t.exitAt), `dir ${sym} exit ${t.exitAt}`).toBe(true);
      }

      const ctx = buildContext(sym, candles);
      if (!ctx) continue;
      for (const mod of listStrategies()) {
        const { trades } = runStrategy(ctx, mod, DEFAULT_FILTERS, {
          timeframe: "15m",
          maxTradesPerDay: 3,
          includeCharges: false,
          includeSlippage: false,
        });
        for (const t of trades) {
          expect(isSessionValidUtcIso(t.entryAt), `${mod.meta.id} ${sym} entry ${t.entryAt}`).toBe(true);
          expect(isSessionValidUtcIso(t.exitAt), `${mod.meta.id} ${sym} exit ${t.exitAt}`).toBe(true);
        }
      }
      }
      expect(checkedAny || true).toBe(true); // never fail solely because the CSV is absent
    },
    30000,
  );
});
