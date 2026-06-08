import { describe, expect, it } from "vitest";
import { istDateKey, lockKey } from "./optionSignals.js";

// Task #104 regression: the intraday level-lock key MUST be derived from the
// injected `now`, not wall-clock `new Date()`. The original bug used the latter,
// so the offline replay collapsed every simulated day into a single lock-day —
// the first emitted signal per (symbol|setup|direction) froze its levels and
// every later bar reused them, silently bypassing applyTriggerRealism. These
// tests pin the now-threading so the per-day reset can never regress.
describe("optionSignals lock-key now-threading", () => {
  it("istDateKey uses the injected instant, not wall-clock", () => {
    // 2025-01-15 12:00 UTC = 17:30 IST -> 2025-01-15
    const a = istDateKey(new Date("2025-01-15T12:00:00Z"));
    expect(a).toBe("2025-01-15");
    // A different simulated day yields a different key.
    const b = istDateKey(new Date("2025-01-16T12:00:00Z"));
    expect(b).toBe("2025-01-16");
    expect(a).not.toBe(b);
  });

  it("rolls the IST date over at IST midnight (UTC+5:30), not UTC midnight", () => {
    // 2025-03-31 18:45 UTC = 2025-04-01 00:15 IST -> next IST day.
    expect(istDateKey(new Date("2025-03-31T18:45:00Z"))).toBe("2025-04-01");
    // 2025-03-31 18:15 UTC = 2025-03-31 23:45 IST -> still same IST day.
    expect(istDateKey(new Date("2025-03-31T18:15:00Z"))).toBe("2025-03-31");
  });

  it("lockKey embeds the injected day so different simulated days never collide", () => {
    const day1 = new Date("2024-06-05T06:00:00Z");
    const day2 = new Date("2024-06-06T06:00:00Z");
    const k1 = lockKey("NIFTY", "VWAP_RECLAIM", "BEARISH", day1);
    const k2 = lockKey("NIFTY", "VWAP_RECLAIM", "BEARISH", day2);
    expect(k1).not.toBe(k2);
    expect(k1).toBe("2024-06-05|NIFTY|VWAP_RECLAIM|BEARISH");
  });

  it("same simulated day + same setup yields a stable key (intraday lock holds)", () => {
    const t1 = new Date("2024-06-05T04:00:00Z"); // 09:30 IST
    const t2 = new Date("2024-06-05T09:00:00Z"); // 14:30 IST, same IST day
    expect(lockKey("BANKNIFTY", "EMA_PULLBACK", "BULLISH", t1)).toBe(
      lockKey("BANKNIFTY", "EMA_PULLBACK", "BULLISH", t2),
    );
  });

  it("distinguishes symbol / setup / direction within the same day", () => {
    const now = new Date("2024-06-05T06:00:00Z");
    const base = lockKey("NIFTY", "EMA_PULLBACK", "BULLISH", now);
    expect(lockKey("SENSEX", "EMA_PULLBACK", "BULLISH", now)).not.toBe(base);
    expect(lockKey("NIFTY", "VWAP_RECLAIM", "BULLISH", now)).not.toBe(base);
    expect(lockKey("NIFTY", "EMA_PULLBACK", "BEARISH", now)).not.toBe(base);
  });
});
