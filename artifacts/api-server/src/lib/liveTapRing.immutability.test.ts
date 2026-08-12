/**
 * Phase 0.5C — FINAL IMMUTABILITY CORRECTION.
 *
 * Acceptance invariant under test:
 *
 *     CONSUMER MUTATION CANNOT CORRUPT INTERNAL STORAGE
 *
 * Part A of this file was written and executed against the PRE-CORRECTION
 * Phase 0.5C implementation (bare `RingBuffer` storing caller references)
 * and FAILED, proving the defect was real and reachable rather than
 * theoretical. Part B fixes it; every assertion here must then pass.
 *
 * Documented depth of immutability is asserted explicitly in Part D —
 * including the boundary BEYOND which references are shared. That
 * boundary is reported honestly, not hidden.
 *
 * No provider call, no database write, no scheduler, no subscription.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  tapPushTick,
  tapPushChainSnapshot,
  tapPushBoardSnapshot,
  tapPushSystemEvent,
  drainSince,
  _resetLiveTapRing,
  COPY_DEPTH_LIMIT,
  getBoundedCopyDiagnostics,
  _resetBoundedCopyDiagnostics,
  type TapTick,
  type TapChainSnapshot,
  type TapBoardSnapshot,
  type TapSystemEvent,
} from "./liveTapRing";

const T0 = 1_800_000_000_000;
const ALL = { sinceMs: 0 };

function tick(over: Partial<TapTick> = {}): TapTick {
  return {
    receivedAtMs: T0,
    instrumentToken: 256265,
    symbol: "NIFTY 50",
    ltp: 24000,
    ltq: 1,
    volume: 100,
    oi: null,
    raw: { last_price: 24000, ohlc: { open: 23900, high: 24100 } },
    ...over,
  };
}

function chain(over: Partial<TapChainSnapshot> = {}): TapChainSnapshot {
  return {
    capturedAtMs: T0,
    underlying: "NIFTY",
    expiry: "2026-08-27",
    source: "kite",
    snapshot: { strikes: [{ strike: 24000, ce: { oi: 10 } }] },
    ...over,
  };
}

function board(over: Partial<TapBoardSnapshot> = {}): TapBoardSnapshot {
  return {
    capturedAtMs: T0,
    rows: [{ symbol: "NIFTY", ltp: 24000 }],
    ...over,
  };
}

function evt(over: Partial<TapSystemEvent> = {}): TapSystemEvent {
  return {
    emittedAtMs: T0,
    kind: "REGIME_CHANGE",
    detail: { from: "TREND", to: "CHOP" },
    ...over,
  };
}

beforeEach(() => {
  _resetLiveTapRing();
});

// ─── PART A — the four streams, top-level entry mutation ──────────────
// (C1, C2) Returned array AND returned entry mutation must not reach storage.

describe("A. consumer mutation of a returned entry cannot corrupt storage", () => {
  it("C1: mutating the returned ARRAY does not affect a later read", () => {
    tapPushTick(tick({ ltp: 100 }));
    tapPushTick(tick({ ltp: 200 }));

    const first = drainSince(ALL).ticks;
    expect(first).toHaveLength(2);
    first.pop();
    first.push(tick({ ltp: 999 }));
    first[0] = tick({ ltp: 888 });

    const second = drainSince(ALL).ticks;
    expect(second).toHaveLength(2);
    expect(second.map((t) => t.ltp)).toEqual([100, 200]);
  });

  it("C2: mutating a returned TICK entry does not affect retained storage", () => {
    tapPushTick(tick({ ltp: 24000, symbol: "NIFTY 50" }));

    const got = drainSince(ALL).ticks[0]!;
    got.ltp = -1;
    got.symbol = "CORRUPTED";
    got.instrumentToken = 999999;

    const after = drainSince(ALL).ticks[0]!;
    expect(after.ltp).toBe(24000);
    expect(after.symbol).toBe("NIFTY 50");
    expect(after.instrumentToken).toBe(256265);
  });

  it("C2: mutating a returned CHAIN entry does not affect retained storage", () => {
    tapPushChainSnapshot(chain({ underlying: "NIFTY" }));
    const got = drainSince(ALL).chainSnapshots[0]!;
    got.underlying = "CORRUPTED";
    expect(drainSince(ALL).chainSnapshots[0]!.underlying).toBe("NIFTY");
  });

  it("C2: mutating a returned BOARD entry does not affect retained storage", () => {
    tapPushBoardSnapshot(board());
    const got = drainSince(ALL).boardSnapshots[0]!;
    got.capturedAtMs = -1;
    expect(drainSince(ALL).boardSnapshots[0]!.capturedAtMs).toBe(T0);
  });

  it("C2: mutating a returned SYSTEM EVENT does not affect retained storage", () => {
    tapPushSystemEvent(evt({ kind: "REGIME_CHANGE" }));
    const got = drainSince(ALL).systemEvents[0]!;
    got.kind = "OTHER";
    expect(drainSince(ALL).systemEvents[0]!.kind).toBe("REGIME_CHANGE");
  });
});

// ─── PART B — nested mutable containers (C3) ──────────────────────────
// Every replay entry type declares exactly one nested mutable container.

describe("B. nested-field mutation cannot corrupt storage", () => {
  it("C3: tick.raw mutation does not reach storage", () => {
    tapPushTick(tick());
    const got = drainSince(ALL).ticks[0]!;
    got.raw.last_price = -1;
    got.raw.injected = "CORRUPT";
    const after = drainSince(ALL).ticks[0]!;
    expect(after.raw.last_price).toBe(24000);
    expect(after.raw.injected).toBeUndefined();
  });

  it("C3: tick.raw.ohlc (depth 3) mutation does not reach storage", () => {
    tapPushTick(tick());
    const got = drainSince(ALL).ticks[0]!;
    (got.raw.ohlc as Record<string, unknown>).open = -1;
    const after = drainSince(ALL).ticks[0]!;
    expect((after.raw.ohlc as Record<string, unknown>).open).toBe(23900);
  });

  it("C3: chain.snapshot nested array + object mutation does not reach storage", () => {
    tapPushChainSnapshot(chain());
    const got = drainSince(ALL).chainSnapshots[0]!;
    const strikes = got.snapshot.strikes as Array<Record<string, unknown>>;
    strikes.push({ strike: 99999 });
    (strikes[0]!.ce as Record<string, unknown>).oi = -1;

    const after = drainSince(ALL).chainSnapshots[0]!;
    const afterStrikes = after.snapshot.strikes as Array<Record<string, unknown>>;
    expect(afterStrikes).toHaveLength(1);
    expect((afterStrikes[0]!.ce as Record<string, unknown>).oi).toBe(10);
  });

  it("C3: board.rows array and row objects are isolated", () => {
    tapPushBoardSnapshot(board());
    const got = drainSince(ALL).boardSnapshots[0]!;
    got.rows.push({ symbol: "INJECTED" });
    got.rows[0]!.ltp = -1;

    const after = drainSince(ALL).boardSnapshots[0]!;
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0]!.ltp).toBe(24000);
  });

  it("C3: event.detail mutation does not reach storage", () => {
    tapPushSystemEvent(evt());
    const got = drainSince(ALL).systemEvents[0]!;
    got.detail.to = "CORRUPT";
    expect(drainSince(ALL).systemEvents[0]!.detail.to).toBe("CHOP");
  });
});

// ─── PART C — caller-owned input objects (C4, C5) ─────────────────────
// These CANNOT be satisfied by read-time copying alone; they force
// insertion-time copying.

describe("C. caller-owned input objects", () => {
  it("C4: mutating the original input AFTER push does not alter stored data", () => {
    const input = tick({ ltp: 24000 });
    tapPushTick(input);

    input.ltp = -1;
    input.symbol = "CORRUPTED";
    input.raw.last_price = -1;

    const after = drainSince(ALL).ticks[0]!;
    expect(after.ltp).toBe(24000);
    expect(after.symbol).toBe("NIFTY 50");
    expect(after.raw.last_price).toBe(24000);
  });

  it("C4: the caller's input object is NOT frozen or mutated by push", () => {
    const input = tick({ ltp: 24000 });
    tapPushTick(input);
    // Documented contract: we copy, we do not take ownership. The caller
    // may keep using its own object exactly as before.
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(input.raw)).toBe(false);
    expect(() => {
      input.ltp = 55;
    }).not.toThrow();
    expect(input.ltp).toBe(55);
  });

  it("C5: reusing and mutating ONE input object across pushes keeps each event independent", () => {
    const reused = tick({ ltp: 1, raw: { last_price: 1 } });
    tapPushTick(reused);
    reused.ltp = 2;
    reused.raw.last_price = 2;
    tapPushTick(reused);
    reused.ltp = 3;
    reused.raw.last_price = 3;
    tapPushTick(reused);

    const got = drainSince(ALL).ticks;
    expect(got).toHaveLength(3);
    expect(got.map((t) => t.ltp)).toEqual([1, 2, 3]);
    expect(got.map((t) => t.raw.last_price)).toEqual([1, 2, 3]);
  });

  it("C5: reused input object across system events stays independent", () => {
    const reused = evt({ kind: "REGIME_CHANGE" });
    tapPushSystemEvent(reused);
    reused.detail.to = "TREND";
    tapPushSystemEvent(reused);

    const got = drainSince(ALL).systemEvents;
    expect(got.map((e) => e.detail.to)).toEqual(["CHOP", "TREND"]);
  });
});

// ─── PART D — snapshot independence + documented depth (C6) ───────────

describe("D. snapshot independence and documented immutability depth", () => {
  it("C6: two snapshots are independent at every copied depth", () => {
    tapPushTick(tick());
    const a = drainSince(ALL);
    const b = drainSince(ALL);

    expect(a.ticks[0]).not.toBe(b.ticks[0]);
    expect(a.ticks[0]!.raw).not.toBe(b.ticks[0]!.raw);
    expect(a.ticks[0]!.raw.ohlc).not.toBe(b.ticks[0]!.raw.ohlc);

    a.ticks[0]!.ltp = -1;
    a.ticks[0]!.raw.last_price = -1;
    (a.ticks[0]!.raw.ohlc as Record<string, unknown>).open = -1;

    expect(b.ticks[0]!.ltp).toBe(24000);
    expect(b.ticks[0]!.raw.last_price).toBe(24000);
    expect((b.ticks[0]!.raw.ohlc as Record<string, unknown>).open).toBe(23900);
  });

  it("C6: the returned entry is never the stored object identity", () => {
    const input = tick();
    tapPushTick(input);
    const got = drainSince(ALL).ticks[0]!;
    expect(got).not.toBe(input);
    expect(got.raw).not.toBe(input.raw);
  });

  it("documents the depth limit as a real, asserted constant", () => {
    expect(COPY_DEPTH_LIMIT).toBe(6);
  });

  it("copies plain objects and arrays up to the documented depth limit", () => {
    // depth: entry(0) -> raw(1) -> l2(2) -> l3(3) -> l4(4) -> l5(5)
    tapPushTick(
      tick({
        raw: { l2: { l3: { l4: { l5: { leaf: "original" } } } } },
      }),
    );
    const a = drainSince(ALL).ticks[0]!;
    const b = drainSince(ALL).ticks[0]!;
    const pathOf = (t: TapTick): Record<string, unknown> =>
      ((((t.raw.l2 as Record<string, unknown>).l3 as Record<string, unknown>)
        .l4 as Record<string, unknown>).l5 as Record<string, unknown>);
    expect(pathOf(a)).not.toBe(pathOf(b));
    pathOf(a).leaf = "CORRUPT";
    expect(pathOf(b).leaf).toBe("original");
  });

  it("BOUNDARY (documented, not a defect): containers deeper than the limit are shared by reference", () => {
    // One level deeper than the copied depth. This is the honest,
    // deliberate boundary: unbounded-depth cloning on the tick append
    // path would reintroduce unbounded per-append work, which is exactly
    // what Phase 0.5C exists to remove.
    const deep = { leaf: "original" };
    tapPushTick(
      tick({
        raw: { l2: { l3: { l4: { l5: { l6: deep } } } } },
      }),
    );
    const a = drainSince(ALL).ticks[0]!;
    const reach = (t: TapTick): Record<string, unknown> =>
      (((((t.raw.l2 as Record<string, unknown>).l3 as Record<string, unknown>)
        .l4 as Record<string, unknown>).l5 as Record<string, unknown>)
        .l6 as Record<string, unknown>);
    // Beyond the limit the reference IS shared — asserted, not hidden.
    expect(reach(a)).toBe(deep);
  });

  it("REGRESSION: a Date is COPIED, so setTime() on a drain cannot corrupt storage", () => {
    // A Kite tick carries `timestamp` / `last_trade_time` as real Date
    // objects, so an earlier by-reference design left this as a live
    // corruption path rather than a theoretical one.
    const when = new Date(T0);
    tapPushTick(tick({ raw: { exchange_timestamp: when } }));

    const got = drainSince(ALL).ticks[0]!;
    const drained = got.raw.exchange_timestamp as Date;
    expect(drained).not.toBe(when);
    expect(drained.getTime()).toBe(T0);
    // Serialised bytes are unchanged by copying.
    expect(JSON.stringify(got.raw)).toBe(JSON.stringify({ exchange_timestamp: when }));

    // Attack 1 — mutate the drained Date.
    drained.setTime(0);
    expect((drainSince(ALL).ticks[0]!.raw.exchange_timestamp as Date).getTime()).toBe(T0);

    // Attack 2 — mutate the caller's original Date after the push.
    when.setTime(0);
    expect((drainSince(ALL).ticks[0]!.raw.exchange_timestamp as Date).getTime()).toBe(T0);
  });

  it("a Date is copied right up to the depth boundary, then shared with the subtree", () => {
    // Depth accounting: the entry itself is depth 0, so `entry.raw` is
    // depth 1 and each further nesting adds one.
    const atLimit = new Date(T0);
    // entry(0) → raw(1) → l2(2) → l3(3) → l4(4) → l5(5) → Date(6)
    tapPushTick(tick({ raw: { l2: { l3: { l4: { l5: { when: atLimit } } } } } }));
    const reached = (drainSince(ALL).ticks[0]!.raw as never as {
      l2: { l3: { l4: { l5: { when: Date } } } };
    }).l2.l3.l4.l5.when;
    expect(reached).not.toBe(atLimit); // Date branch precedes the depth check
    expect(reached.getTime()).toBe(T0);

    // One level deeper the PARENT container is shared at the limit, so
    // the walk never reaches the Date and the whole subtree is shared.
    // This is EXCLUSION 2 and is counted, not hidden.
    _resetLiveTapRing();
    _resetBoundedCopyDiagnostics();
    const beyond = new Date(T0);
    const leaf = { when: beyond };
    tapPushTick(tick({ raw: { l2: { l3: { l4: { l5: { l6: leaf } } } } } }));
    const shared = (drainSince(ALL).ticks[0]!.raw as never as {
      l2: { l3: { l4: { l5: { l6: { when: Date } } } } };
    }).l2.l3.l4.l5.l6;
    expect(shared).toBe(leaf);
    expect(getBoundedCopyDiagnostics().depthLimitTruncations).toBeGreaterThan(0);
  });

  it("null / undefined nested containers keep their exact shape (no {} fabrication)", () => {
    const t = tick();
    (t as unknown as Record<string, unknown>).raw = null;
    tapPushTick(t);
    const got = drainSince(ALL).ticks[0]!;
    expect(got.raw).toBeNull();
  });

  it("does not fabricate canonical identity fields", () => {
    tapPushTick(tick());
    const got = drainSince(ALL).ticks[0]! as unknown as Record<string, unknown>;
    expect(got.canonicalInstrumentId).toBeUndefined();
    expect(got.exchange).toBeUndefined();
    expect(got.segment).toBeUndefined();
    expect(got.provider).toBeUndefined();
    expect(Object.keys(got).sort()).toEqual(
      ["instrumentToken", "ltp", "ltq", "oi", "raw", "receivedAtMs", "symbol", "volume"],
    );
  });
});

// ─── PART E — invariants that must survive the correction ─────────────

describe("E. ordering, wrap-around and capacity survive the correction", () => {
  it("C7/C8: wrap-around retains the newest window in oldest-to-newest order", () => {
    // chains cap = 2_000
    for (let i = 0; i < 2_500; i++) {
      tapPushChainSnapshot(chain({ underlying: `U${i}`, snapshot: { i } }));
    }
    const got = drainSince(ALL).chainSnapshots;
    expect(got).toHaveLength(2_000);
    expect(got[0]!.underlying).toBe("U500");
    expect(got[got.length - 1]!.underlying).toBe("U2499");
    for (let i = 1; i < got.length; i++) {
      expect(got[i]!.snapshot.i as number).toBe((got[i - 1]!.snapshot.i as number) + 1);
    }
  });

  it("C7: wrap-around does not retain stale references from evicted entries", () => {
    for (let i = 0; i < 2_500; i++) {
      tapPushChainSnapshot(chain({ underlying: `U${i}` }));
    }
    const got = drainSince(ALL).chainSnapshots;
    expect(got.some((c) => c.underlying === "U0")).toBe(false);
    expect(got.some((c) => c.underlying === "U499")).toBe(false);
  });

  it("reset releases every retained reference", () => {
    tapPushTick(tick());
    tapPushChainSnapshot(chain());
    _resetLiveTapRing();
    const got = drainSince(ALL);
    expect(got.ticks).toHaveLength(0);
    expect(got.chainSnapshots).toHaveLength(0);
    expect(got.boardSnapshots).toHaveLength(0);
    expect(got.systemEvents).toHaveLength(0);
    expect(got.observedRangeMs).toBeNull();
  });

  it("filtering semantics (inclusive lower bound) are unchanged", () => {
    tapPushTick(tick({ receivedAtMs: T0 - 1 }));
    tapPushTick(tick({ receivedAtMs: T0 }));
    tapPushTick(tick({ receivedAtMs: T0 + 1 }));
    const got = drainSince({ sinceMs: T0 }).ticks;
    expect(got.map((t) => t.receivedAtMs)).toEqual([T0, T0 + 1]);
  });
});

// ─── PART F — exotic own-property shapes ──────────────────────────────
// Raised by independent review: a naive `{}` + Object.keys copy silently
// alters valid data. Each case below is a real structural difference.

describe("F. the bounded copy must not silently alter object shape", () => {
  const rawOf = (): Record<string, unknown> => drainSince(ALL).ticks[0]!.raw;

  it("an own __proto__ key is preserved as DATA and does not pollute", () => {
    // JSON.parse can produce a genuine own "__proto__" key, and chain
    // snapshots originate from parsed HTTP JSON. Plain assignment would
    // invoke the inherited setter: key silently dropped, prototype changed.
    const raw = JSON.parse('{"__proto__":{"polluted":true},"ok":1}') as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(raw, "__proto__")).toBe(true);

    tapPushTick(tick({ raw }));
    const got = rawOf();

    expect(Object.prototype.hasOwnProperty.call(got, "__proto__")).toBe(true);
    expect(got.ok).toBe(1);
    expect(Object.getPrototypeOf(got)).toBe(Object.prototype);
    expect((({}) as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("a null-prototype object stays null-prototype", () => {
    const np = Object.create(null) as Record<string, unknown>;
    np.x = 1;
    tapPushTick(tick({ raw: { np } }));
    const got = rawOf().np as object;
    expect(Object.getPrototypeOf(got)).toBeNull();
    expect((got as Record<string, unknown>).x).toBe(1);
  });

  it("DECLARED CONTRACT: symbol keys are not retained (JSON cannot express them)", () => {
    const S = Symbol.for("p05c.symbol");
    const raw: Record<PropertyKey, unknown> = { a: 1 };
    raw[S] = "dropped";
    const original = raw as Record<string, unknown>;
    tapPushTick(tick({ raw: original }));

    const got = rawOf();
    expect((got as Record<PropertyKey, unknown>)[S]).toBeUndefined();
    // The recorder's only output is JSONL, and JSON.stringify already
    // ignores symbol keys — so dropping them changes nothing observable.
    expect(JSON.stringify(got)).toBe(JSON.stringify(original));
  });

  it("DECLARED CONTRACT: non-enumerable own properties are not retained", () => {
    const raw: Record<string, unknown> = { a: 1 };
    Object.defineProperty(raw, "hidden", { value: 2, enumerable: false, configurable: true });
    tapPushTick(tick({ raw }));

    const got = rawOf();
    expect(got.hidden).toBeUndefined();
    expect(Object.keys(got)).toEqual(["a"]);
    expect(JSON.stringify(got)).toBe(JSON.stringify(raw));
  });

  it("getters are EVALUATED ONCE at insertion and stored as plain data", () => {
    let reads = 0;
    const raw: Record<string, unknown> = {};
    Object.defineProperty(raw, "lazy", {
      get() {
        reads++;
        return 42;
      },
      enumerable: true,
      configurable: true,
    });

    tapPushTick(tick({ raw }));
    expect(reads).toBe(1); // exactly once, at insertion — as JSON.stringify would

    const got = rawOf();
    expect(reads).toBe(1); // drains re-read plain data, never the accessor
    expect(got.lazy).toBe(42);

    const d = Object.getOwnPropertyDescriptor(got, "lazy")!;
    expect(d.get).toBeUndefined();
    expect(d.value).toBe(42);
  });

  it("REGRESSION: an accessor closure cannot reach retained storage", () => {
    // Independent review raised this exact attack against an earlier
    // design that transplanted accessors instead of evaluating them:
    // the getter closed over mutable state, so both storage and every
    // drained copy observed the same backing object.
    const backing = { value: 1 };
    const raw: Record<string, unknown> = {};
    Object.defineProperty(raw, "x", {
      get() {
        return backing;
      },
      enumerable: true,
      configurable: true,
    });

    tapPushTick(tick({ raw }));

    // Attack 1 — mutate through what the consumer received.
    (rawOf().x as Record<string, unknown>).value = 999;
    expect((rawOf().x as Record<string, unknown>).value).toBe(1);

    // Attack 2 — mutate the closure-captured object directly.
    backing.value = 777;
    expect((rawOf().x as Record<string, unknown>).value).toBe(1);
  });

  it("a THROWING getter cannot corrupt the ring", () => {
    tapPushTick(tick({ ltp: 111 })); // a good entry already retained

    const raw: Record<string, unknown> = { ok: 1 };
    Object.defineProperty(raw, "boom", {
      get() {
        throw new Error("getter exploded");
      },
      enumerable: true,
      configurable: true,
    });

    // The copy runs BEFORE ring.push, so the throw propagates to the
    // caller (every production caller wraps the tap in try/catch, per
    // spec 12.2) and nothing is appended. JSON.stringify would throw on
    // this input too, so the behaviour is consistent with the recorder.
    expect(() => tapPushTick(tick({ raw }))).toThrow("getter exploded");

    const after = drainSince(ALL).ticks;
    expect(after).toHaveLength(1); // ring intact, no partial entry
    expect(after[0]!.ltp).toBe(111);

    // And the ring still accepts writes afterwards.
    tapPushTick(tick({ ltp: 222 }));
    expect(drainSince(ALL).ticks.map((t) => t.ltp)).toEqual([111, 222]);
  });

  it("array holes stay holes and are not materialised as undefined", () => {
    // eslint-disable-next-line no-sparse-arrays
    const sparse = [1, , 3];
    tapPushTick(tick({ raw: { sparse } }));
    const got = rawOf().sparse as unknown[];
    expect(got).toHaveLength(3);
    expect(0 in got).toBe(true);
    expect(1 in got).toBe(false); // hole preserved
    expect(2 in got).toBe(true);
    expect(got[2]).toBe(3);
  });

  it("DECLARED CONTRACT: extra non-index array properties are not retained", () => {
    const arr = [1, 2] as unknown[] & { tag?: string };
    arr.tag = "meta";
    tapPushTick(tick({ raw: { arr } }));
    const got = rawOf().arr as unknown[] & { tag?: string };
    expect(Array.isArray(got)).toBe(true);
    expect(got).toHaveLength(2);
    expect(got.tag).toBeUndefined();
    // JSON.stringify ignores non-index array properties, so the
    // recorder's output is unchanged.
    expect(JSON.stringify(got)).toBe(JSON.stringify(arr));
  });

  it("PROOF: JSONL output is byte-identical to serialising the original entry", () => {
    const withHidden = (): Record<string, unknown> => {
      const o: Record<string, unknown> = { a: 1 };
      Object.defineProperty(o, "hidden", { value: 2, enumerable: false });
      (o as Record<PropertyKey, unknown>)[Symbol.for("p05c.json")] = 3;
      return o;
    };
    // eslint-disable-next-line no-sparse-arrays
    const sparse = [1, , 3];

    const cases: Array<Record<string, unknown>> = [
      { plain: 1, nested: { a: [1, 2, { b: 3 }] } },
      { withDate: new Date(T0) },
      { nullish: null, undef: undefined },
      { sparse },
      { deep: { l2: { l3: { l4: { l5: { l6: { leaf: 1 } } } } } } },
      JSON.parse('{"__proto__":{"p":1},"ok":2}') as Record<string, unknown>,
      withHidden(),
    ];

    for (const raw of cases) {
      _resetLiveTapRing();
      const original = tick({ raw });
      const expected = JSON.stringify(original);
      tapPushTick(original);
      expect(JSON.stringify(drainSince(ALL).ticks[0])).toBe(expected);
    }
  });

  it("Map and Set are COPIED — mutating a drained collection cannot corrupt storage", () => {
    const m = new Map([["k", 1]]);
    const s = new Set([1]);
    tapPushTick(tick({ raw: { m, s } }));

    const got = rawOf();
    const gm = got.m as Map<string, number>;
    const gs = got.s as Set<number>;
    expect(gm).not.toBe(m);
    expect(gs).not.toBe(s);
    expect(gm.get("k")).toBe(1);
    expect(gs.has(1)).toBe(true);

    gm.set("k", 999);
    gm.set("injected", 5);
    gs.add(42);
    m.set("k", 111);

    const again = rawOf();
    expect((again.m as Map<string, number>).get("k")).toBe(1);
    expect((again.m as Map<string, number>).has("injected")).toBe(false);
    expect((again.s as Set<number>).has(42)).toBe(false);
  });

  it("EXCLUSION 1: a class instance is shared by reference and COUNTED", () => {
    class Marker {
      constructor(public v: number) {}
    }
    const inst = new Marker(7);
    _resetBoundedCopyDiagnostics();
    tapPushTick(tick({ raw: { inst } }));

    expect(rawOf().inst).toBe(inst);
    // Not assumed absent — measured. Non-zero in production means the
    // exclusion is real and must be revisited.
    expect(getBoundedCopyDiagnostics().exoticPassthroughs).toBeGreaterThan(0);
  });

  it("EXCLUSION 1: a toJSON-bearing object is shared so its bytes stay exact", () => {
    const raw: Record<string, unknown> = { a: 1 };
    Object.defineProperty(raw, "secret", { value: 42, enumerable: false });
    Object.defineProperty(raw, "toJSON", {
      value(this: Record<string, unknown>) {
        return { a: this.a, secret: this.secret };
      },
      enumerable: false,
    });
    // JSON.stringify delegates to a NON-ENUMERABLE toJSON that reads
    // NON-ENUMERABLE state. Copying by contract would drop both and
    // change the serialised bytes, so the original is shared instead.
    _resetBoundedCopyDiagnostics();
    tapPushTick(tick({ raw }));

    const got = rawOf();
    expect(got).toBe(raw);
    expect(JSON.stringify(got)).toBe(JSON.stringify(raw));
    expect(JSON.stringify(got)).toBe('{"a":1,"secret":42}');
    expect(getBoundedCopyDiagnostics().exoticPassthroughs).toBeGreaterThan(0);
  });

  it("EXCLUSION 1: a CUSTOM toJSON on Date/Map/Set/array is caught before copying", () => {
    // Branch order matters. Copying a Date/Map/Set first would silently
    // drop an own toJSON and change the emitted bytes, while also
    // escaping the exclusion counter.
    const d = Object.assign(new Date(T0), { toJSON: () => "CUSTOM_DATE" });
    const m = Object.assign(new Map([["k", 1]]), { toJSON: () => ({ x: 1 }) });
    const s = Object.assign(new Set([1]), { toJSON: () => ({ y: 2 }) });
    const a = Object.assign([1, 2], { toJSON: () => ({ z: 3 }) });

    _resetBoundedCopyDiagnostics();
    tapPushTick(tick({ raw: { d, m, s, a } }));
    const got = rawOf();

    expect(got.d).toBe(d);
    expect(got.m).toBe(m);
    expect(got.s).toBe(s);
    expect(got.a).toBe(a);
    expect(JSON.stringify(got)).toBe(JSON.stringify({ d, m, s, a }));
    expect(JSON.stringify(got)).toBe(
      '{"d":"CUSTOM_DATE","m":{"x":1},"s":{"y":2},"a":{"z":3}}',
    );
    expect(getBoundedCopyDiagnostics().exoticPassthroughs).toBeGreaterThan(0);
  });

  it("an ORDINARY Date keeps the standard toJSON and is still COPIED, not shared", () => {
    _resetBoundedCopyDiagnostics();
    const when = new Date(T0);
    tapPushTick(tick({ raw: { when } }));
    const got = rawOf();
    expect(got.when).not.toBe(when);
    expect(JSON.stringify(got)).toBe(JSON.stringify({ when }));
    // Date.prototype.toJSON must NOT be mistaken for a custom one.
    expect(getBoundedCopyDiagnostics().exoticPassthroughs).toBe(0);
  });

  it("EXCLUSION 2: past-depth sharing is counted, and clean payloads count ZERO", () => {
    _resetBoundedCopyDiagnostics();
    // A realistic Kite full-mode payload: deepest container is
    // raw.depth.buy[i] at depth 4, well inside the limit.
    tapPushTick(
      tick({
        raw: {
          ohlc: { open: 1, high: 2, low: 3, close: 4 },
          depth: { buy: [{ price: 1, qty: 2 }], sell: [{ price: 3, qty: 4 }] },
          timestamp: new Date(T0),
        },
      }),
    );
    drainSince(ALL);
    const clean = getBoundedCopyDiagnostics();
    expect(clean.depthLimitTruncations).toBe(0);
    expect(clean.exoticPassthroughs).toBe(0);

    // Now exceed the limit deliberately.
    _resetBoundedCopyDiagnostics();
    let node: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < COPY_DEPTH_LIMIT + 2; i++) node = { next: node };
    tapPushTick(tick({ raw: node }));
    expect(getBoundedCopyDiagnostics().depthLimitTruncations).toBeGreaterThan(0);
  });

  it("a reference cycle is terminated by the depth limit and does not hang", () => {
    const cyclic: Record<string, unknown> = { name: "root" };
    cyclic.self = cyclic;
    expect(() => tapPushTick(tick({ raw: cyclic }))).not.toThrow();
    const got = rawOf();
    expect(got.name).toBe("root");
    // Below the limit the cycle is unrolled into copies; at the limit the
    // original reference is shared. Either way: terminates, no throw.
    expect(got).not.toBe(cyclic);
  });
});
