/**
 * Phase 0.5C — LiveTapRing characterization + post-migration contract tests.
 *
 * PART 1 (B1–B14) was written and executed against the ORIGINAL
 * shift()/splice() implementation to capture the real observable
 * contract before any modification. Every assertion in Part 1 passed
 * unchanged against the ring-buffer implementation — that equivalence
 * is the migration's safety proof.
 *
 * Overflow semantics are characterized on the `chains` stream
 * (CAP_CHAIN = 2_000) rather than `ticks` (CAP_TICKS = 400_000)
 * because both streams share the exact same `trim()` code path, and
 * driving 400_001 pushes through the ORIGINAL O(n)-per-append trim is
 * computationally infeasible in a test — which is itself the defect
 * under repair. Tick-stream capacity is proven separately in
 * ringBuffer.test.ts at the data-structure level.
 *
 * No provider call, no database write, no scheduler, no subscription.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  tapPushTick,
  tapPushChainSnapshot,
  tapPushSystemEvent,
  tapStats,
  drainSince,
  _resetLiveTapRing,
  _tapCapacities,
  type TapTick,
  type TapChainSnapshot,
} from "./liveTapRing";

const T0 = 1_800_000_000_000; // fixed epoch ms — deterministic, no Date.now() in assertions

function tick(over: Partial<TapTick> = {}): TapTick {
  return {
    receivedAtMs: T0,
    instrumentToken: 256265,
    symbol: "NIFTY 50",
    ltp: 24000,
    ltq: null,
    volume: null,
    oi: null,
    raw: {},
    ...over,
  };
}

function chain(over: Partial<TapChainSnapshot> = {}): TapChainSnapshot {
  return {
    capturedAtMs: T0,
    underlying: "NIFTY",
    expiry: "2026-07-17",
    source: "kite",
    snapshot: {},
    ...over,
  };
}

beforeEach(() => {
  _resetLiveTapRing();
});

// ─────────────────────────────────────────────────────────────────────
// B1–B14 — characterized observable contract
// ─────────────────────────────────────────────────────────────────────

describe("B1 maximum retained entry count", () => {
  it("exposes the exact configured capacities", () => {
    // TESTED: capacities are the pre-existing constants, unchanged by 0.5C.
    expect(_tapCapacities()).toEqual({
      ticks: 400_000,
      chains: 2_000,
      boards: 2_000,
      events: 5_000,
    });
  });

  it("chains never retain more than CAP_CHAIN entries under sustained overflow", () => {
    const cap = _tapCapacities().chains;
    for (let i = 0; i < cap + 500; i++) {
      tapPushChainSnapshot(chain({ capturedAtMs: T0 + i, expiry: `x-${i}` }));
    }
    expect(tapStats().chainCount).toBe(cap);
  });
});

describe("B2 oldest-to-newest ordering", () => {
  it("drainSince returns entries in push order", () => {
    for (let i = 0; i < 50; i++) {
      tapPushTick(tick({ receivedAtMs: T0 + i, ltp: i }));
    }
    const d = drainSince({ sinceMs: T0 });
    expect(d.ticks.map((t) => t.ltp)).toEqual(
      Array.from({ length: 50 }, (_, i) => i),
    );
  });
});

describe("B3 behaviour before capacity is reached", () => {
  it("retains every entry and reports honest counts", () => {
    for (let i = 0; i < 10; i++) {
      tapPushChainSnapshot(chain({ capturedAtMs: T0 + i, expiry: `e-${i}` }));
    }
    expect(tapStats().chainCount).toBe(10);
    expect(drainSince({ sinceMs: T0 }).chainSnapshots).toHaveLength(10);
  });
});

describe("B4 behaviour exactly at capacity", () => {
  it("retains exactly capacity entries, oldest still present", () => {
    const cap = _tapCapacities().chains;
    for (let i = 0; i < cap; i++) {
      tapPushChainSnapshot(chain({ capturedAtMs: T0 + i, expiry: `e-${i}` }));
    }
    const d = drainSince({ sinceMs: T0 });
    expect(d.chainSnapshots).toHaveLength(cap);
    expect(d.chainSnapshots[0]!.expiry).toBe("e-0");
    expect(d.chainSnapshots[cap - 1]!.expiry).toBe(`e-${cap - 1}`);
  });
});

describe("B5 behaviour after one overflow", () => {
  it("evicts exactly the single oldest entry", () => {
    const cap = _tapCapacities().chains;
    for (let i = 0; i < cap + 1; i++) {
      tapPushChainSnapshot(chain({ capturedAtMs: T0 + i, expiry: `e-${i}` }));
    }
    const d = drainSince({ sinceMs: T0 });
    expect(d.chainSnapshots).toHaveLength(cap);
    expect(d.chainSnapshots[0]!.expiry).toBe("e-1"); // e-0 evicted
    expect(d.chainSnapshots[cap - 1]!.expiry).toBe(`e-${cap}`);
  });
});

describe("B6 behaviour after repeated overflow", () => {
  it("keeps a contiguous newest-N window across many wraps", () => {
    const cap = _tapCapacities().chains;
    const total = cap * 3 + 7;
    for (let i = 0; i < total; i++) {
      tapPushChainSnapshot(chain({ capturedAtMs: T0 + i, expiry: `e-${i}` }));
    }
    const d = drainSince({ sinceMs: T0 });
    expect(d.chainSnapshots).toHaveLength(cap);
    expect(d.chainSnapshots[0]!.expiry).toBe(`e-${total - cap}`);
    expect(d.chainSnapshots[cap - 1]!.expiry).toBe(`e-${total - 1}`);
    // strictly increasing, no duplicates, no reordering
    for (let i = 1; i < d.chainSnapshots.length; i++) {
      expect(d.chainSnapshots[i]!.capturedAtMs).toBe(
        d.chainSnapshots[i - 1]!.capturedAtMs + 1,
      );
    }
  });
});

describe("B7 snapshot/read semantics", () => {
  it("drainSince returns a fresh array; pushing to it cannot affect the buffer", () => {
    tapPushTick(tick({ receivedAtMs: T0 }));
    const d = drainSince({ sinceMs: T0 });
    d.ticks.push(tick({ receivedAtMs: T0 + 1, ltp: 99999 }));
    expect(tapStats().tickCount).toBe(1);
    expect(drainSince({ sinceMs: T0 }).ticks).toHaveLength(1);
  });

  it("two successive drains are independent arrays", () => {
    tapPushTick(tick({ receivedAtMs: T0 }));
    const a = drainSince({ sinceMs: T0 }).ticks;
    const b = drainSince({ sinceMs: T0 }).ticks;
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it("drainSince is non-destructive — the buffer is NOT emptied by a drain", () => {
    // OBSERVED: despite the name, drainSince only reads.
    tapPushTick(tick({ receivedAtMs: T0 }));
    drainSince({ sinceMs: T0 });
    expect(tapStats().tickCount).toBe(1);
  });
});

describe("B8 filtering semantics", () => {
  it("sinceMs is an inclusive lower bound applied per stream", () => {
    tapPushTick(tick({ receivedAtMs: T0 - 1, ltp: 1 }));
    tapPushTick(tick({ receivedAtMs: T0, ltp: 2 }));
    tapPushTick(tick({ receivedAtMs: T0 + 1, ltp: 3 }));
    const d = drainSince({ sinceMs: T0 });
    expect(d.ticks.map((t) => t.ltp)).toEqual([2, 3]);
  });

  it("observedRangeMs is first/last of the FILTERED ticks, and null when empty", () => {
    // OBSERVED: implementation uses t[0]/t[last], not a true min/max scan.
    tapPushTick(tick({ receivedAtMs: T0 + 10 }));
    tapPushTick(tick({ receivedAtMs: T0 + 20 }));
    expect(drainSince({ sinceMs: T0 }).observedRangeMs).toEqual({
      min: T0 + 10,
      max: T0 + 20,
    });
    expect(drainSince({ sinceMs: T0 + 1000 }).observedRangeMs).toBeNull();
  });
});

describe("B9 clearing/reset behaviour", () => {
  it("_resetLiveTapRing returns every stream to a valid empty state", () => {
    tapPushTick(tick());
    tapPushChainSnapshot(chain());
    tapPushSystemEvent({ emittedAtMs: T0, kind: "OTHER", detail: {} });
    _resetLiveTapRing();
    expect(tapStats()).toEqual({
      tickCount: 0,
      chainCount: 0,
      boardCount: 0,
      eventCount: 0,
      oldestTickMs: null,
      newestTickMs: null,
    });
    const d = drainSince({ sinceMs: 0 });
    expect(d.ticks).toHaveLength(0);
    expect(d.chainSnapshots).toHaveLength(0);
    expect(d.observedRangeMs).toBeNull();
  });

  it("reset after overflow leaves a reusable buffer", () => {
    const cap = _tapCapacities().chains;
    for (let i = 0; i < cap + 50; i++) {
      tapPushChainSnapshot(chain({ capturedAtMs: T0 + i, expiry: `e-${i}` }));
    }
    _resetLiveTapRing();
    tapPushChainSnapshot(chain({ capturedAtMs: T0, expiry: "fresh" }));
    const d = drainSince({ sinceMs: T0 });
    expect(d.chainSnapshots).toHaveLength(1);
    expect(d.chainSnapshots[0]!.expiry).toBe("fresh");
  });
});

describe("B10 copies vs mutable references", () => {
  it("the returned ARRAY is a copy, but entry objects are shared references", () => {
    // OBSERVED (pre-existing, deliberately preserved): entries are not
    // deep-cloned. Array-level isolation protects internal storage;
    // element-level sharing is unchanged by 0.5C and reported as-is.
    const t = tick({ receivedAtMs: T0 });
    tapPushTick(t);
    const d = drainSince({ sinceMs: T0 });
    expect(d.ticks[0]).toBe(t);
  });
});

describe("B11 timestamp/order assumptions", () => {
  it("age eviction scans from the head and stops at the first non-expired entry", () => {
    // OBSERVED: an out-of-order OLD entry behind a fresh one is NOT
    // evicted by the age scan — the loop stops at the head. Preserved
    // exactly; this is head-scan behaviour, not a full sweep.
    const now = Date.now();
    tapPushTick(tick({ receivedAtMs: now, ltp: 1 }));          // fresh, at head
    tapPushTick(tick({ receivedAtMs: now - 5 * 3600_000, ltp: 2 })); // ancient, behind
    expect(tapStats().tickCount).toBe(2);
  });

  it("an entry older than MAX_AGE_MS pushed onto an empty buffer is dropped at push time", () => {
    tapPushTick(tick({ receivedAtMs: Date.now() - 5 * 3600_000 }));
    expect(tapStats().tickCount).toBe(0);
  });

  it("tapStats oldest/newest are head/tail of the buffer, not a min/max scan", () => {
    tapPushTick(tick({ receivedAtMs: T0 + 100, ltp: 1 }));
    tapPushTick(tick({ receivedAtMs: T0 + 50, ltp: 2 }));
    const s = tapStats();
    expect(s.oldestTickMs).toBe(T0 + 100);
    expect(s.newestTickMs).toBe(T0 + 50);
  });
});

describe("B12 duplicate instrument ticks", () => {
  it("identical repeated ticks are retained as distinct events, never deduplicated", () => {
    for (let i = 0; i < 5; i++) {
      tapPushTick(tick({ receivedAtMs: T0, instrumentToken: 256265, ltp: 24000 }));
    }
    expect(tapStats().tickCount).toBe(5);
    expect(drainSince({ sinceMs: T0 }).ticks).toHaveLength(5);
  });
});

describe("B13 canonical NSE/BSE identity separation", () => {
  it("same trading symbol on NSE and BSE stays distinct via providerInstrumentToken", () => {
    // NSE and BSE listings of one symbol carry DIFFERENT Kite instrument
    // tokens, so token-keyed replay entries never collide.
    tapPushTick(tick({ receivedAtMs: T0, instrumentToken: 111, symbol: "IDEA" }));
    tapPushTick(tick({ receivedAtMs: T0, instrumentToken: 222, symbol: "IDEA" }));
    const got = drainSince({ sinceMs: T0 }).ticks;
    expect(got).toHaveLength(2);
    expect(got.map((t) => t.instrumentToken)).toEqual([111, 222]);
  });

  it("an index alias sharing a symbol does not collapse into one entry", () => {
    tapPushTick(tick({ receivedAtMs: T0, instrumentToken: 256265, symbol: "NIFTY 50" }));
    tapPushTick(tick({ receivedAtMs: T0 + 1, instrumentToken: 256265, symbol: "NIFTY 50" }));
    expect(drainSince({ sinceMs: T0 }).ticks).toHaveLength(2);
  });
});

describe("B14 stream independence", () => {
  it("overflowing one stream does not disturb the others", () => {
    tapPushTick(tick({ receivedAtMs: T0 }));
    const cap = _tapCapacities().chains;
    for (let i = 0; i < cap + 25; i++) {
      tapPushChainSnapshot(chain({ capturedAtMs: T0 + i, expiry: `e-${i}` }));
    }
    const s = tapStats();
    expect(s.tickCount).toBe(1);
    expect(s.chainCount).toBe(cap);
    expect(s.boardCount).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Data-honesty guards (Section D)
// ─────────────────────────────────────────────────────────────────────

describe("D data honesty", () => {
  it("null-valued optional fields are stored as null, never coerced to zero", () => {
    tapPushTick(
      tick({ receivedAtMs: T0, ltq: null, volume: null, oi: null }),
    );
    const got = drainSince({ sinceMs: T0 }).ticks[0]!;
    expect(got.ltq).toBeNull();
    expect(got.volume).toBeNull();
    expect(got.oi).toBeNull();
  });

  it("an undefined symbol is preserved as undefined, never reconstructed", () => {
    tapPushTick(tick({ receivedAtMs: T0, symbol: undefined }));
    expect(drainSince({ sinceMs: T0 }).ticks[0]!.symbol).toBeUndefined();
  });

  it("the stored entry is field-identical to what the caller supplied", () => {
    const t = tick({ receivedAtMs: T0, raw: { ohlc: { close: 1 } } });
    tapPushTick(t);
    expect(drainSince({ sinceMs: T0 }).ticks[0]).toEqual(t);
  });
});
