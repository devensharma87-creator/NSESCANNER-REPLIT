/**
 * Phase 0.5C — FINAL TYPED SNAPSHOT CONTRACT.
 *
 * Acceptance invariant under test:
 *
 *     NO ACCEPTED REPLAY ENTRY RETAINS A CALLER REFERENCE
 *     UNSUPPORTED VALUES ARE REJECTED FAIL-CLOSED
 *
 * An earlier revision of this module copied what JSON.stringify could
 * observe and SHARED what it could not rebuild (class instances,
 * custom-toJSON objects, containers past a depth limit), counting each
 * occurrence. That was rejected: a counter records that an entry might
 * be corruptible, it does not prevent the corruption.
 *
 * The contract is now explicit and finite — supported values are copied,
 * unsupported values are REJECTED and the entry never enters the ring.
 * There is no "share and count" outcome, and these tests prove it.
 *
 * No provider call, no database write, no scheduler, no subscription.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeEach } from "vitest";
import {
  tapPushTick,
  tapPushChainSnapshot,
  tapPushBoardSnapshot,
  tapPushSystemEvent,
  drainSince,
  tapStats,
  _resetLiveTapRing,
  _tapCapacities,
  MAX_REPLAY_DEPTH,
  getReplayRejectionDiagnostics,
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
    raw: { ohlc: { open: 23900, high: 24100, low: 23850, close: 23950 }, change_percent: 0.21 },
    ...over,
  };
}

function chain(over: Partial<TapChainSnapshot> = {}): TapChainSnapshot {
  return {
    capturedAtMs: T0,
    underlying: "NIFTY",
    expiry: "2026-08-27",
    source: "kite",
    snapshot: { rows: [{ strike: 24000, ce: { oi: 10, ltp: 120.5 } }], spot: 24012.4 },
    ...over,
  };
}

function board(over: Partial<TapBoardSnapshot> = {}): TapBoardSnapshot {
  return {
    capturedAtMs: T0,
    rows: [{ symbol: "NIFTY 50", ltp: 24000, changePercent: 0.21 }],
    ...over,
  };
}

function event(over: Partial<TapSystemEvent> = {}): TapSystemEvent {
  return {
    emittedAtMs: T0,
    kind: "SYSTEM_MODE_TRANSITION",
    detail: { from: "NORMAL", to: "DEGRADED", drivers: ["kite_stale"] },
    ...over,
  };
}

beforeEach(() => {
  _resetLiveTapRing();
});

/* ───────────────────────── A. NO RETAINED CALLER REFERENCE ───────── */

describe("A. accepted entries retain no caller reference", () => {
  // Proof 1
  it("mutating the original input after push cannot affect retained data", () => {
    const t = tick();
    tapPushTick(t);

    t.ltp = -1;
    t.symbol = "MUTATED";
    (t.raw.ohlc as Record<string, unknown>).open = -1;
    t.raw.injected = "should not appear";

    const [stored] = drainSince(ALL).ticks;
    expect(stored!.ltp).toBe(24000);
    expect(stored!.symbol).toBe("NIFTY 50");
    expect((stored!.raw.ohlc as Record<string, unknown>).open).toBe(23900);
    expect(stored!.raw.injected).toBeUndefined();
  });

  // Proof 2 — the case that failed hardest pre-correction: one reused
  // scratch object retroactively rewrote every earlier entry.
  it("reusing one mutable input across pushes preserves independent history", () => {
    const scratch = tick();
    for (let i = 1; i <= 3; i++) {
      scratch.ltp = i;
      (scratch.raw.ohlc as Record<string, unknown>).open = i * 10;
      tapPushTick(scratch);
    }

    const got = drainSince(ALL).ticks;
    expect(got.map((x) => x.ltp)).toEqual([1, 2, 3]);
    expect(
      got.map((x) => (x.raw.ohlc as Record<string, unknown>).open),
    ).toEqual([10, 20, 30]);
  });

  it("all four entry types ignore post-push caller mutation", () => {
    const c = chain();
    const b = board();
    const e = event();
    tapPushChainSnapshot(c);
    tapPushBoardSnapshot(b);
    tapPushSystemEvent(e);

    (c.snapshot.rows as unknown[])[0] = { strike: -1 };
    b.rows[0]!.ltp = -1;
    (e.detail.drivers as string[]).push("injected");

    const d = drainSince(ALL);
    expect(
      ((d.chainSnapshots[0]!.snapshot.rows as unknown[])[0] as { strike: number })
        .strike,
    ).toBe(24000);
    expect(d.boardSnapshots[0]!.rows[0]!.ltp).toBe(24000);
    expect(d.systemEvents[0]!.detail.drivers).toEqual(["kite_stale"]);
  });
});

/* ───────────────────────── B. CONSUMER CANNOT CORRUPT STORAGE ────── */

describe("B. drained snapshots are independent of storage", () => {
  // Proof 3
  it("mutating a drained array cannot affect the ring", () => {
    tapPushTick(tick());
    tapPushTick(tick({ ltp: 24100 }));

    const first = drainSince(ALL);
    first.ticks.length = 0;
    first.ticks.push(tick({ ltp: 999999 }));

    expect(drainSince(ALL).ticks.map((x) => x.ltp)).toEqual([24000, 24100]);
  });

  // Proof 4
  it("mutating a drained entry cannot affect the ring", () => {
    tapPushTick(tick());

    const drained = drainSince(ALL).ticks[0]!;
    drained.ltp = -1;
    drained.symbol = "CORRUPTED";

    const again = drainSince(ALL).ticks[0]!;
    expect(again.ltp).toBe(24000);
    expect(again.symbol).toBe("NIFTY 50");
  });

  // Proof 5
  it("mutating nested objects and arrays in a drained entry cannot affect the ring", () => {
    tapPushChainSnapshot(chain());

    const drained = drainSince(ALL).chainSnapshots[0]!;
    const rows = drained.snapshot.rows as Array<Record<string, unknown>>;
    (rows[0]!.ce as Record<string, unknown>).oi = -1;
    rows.push({ strike: -1 });
    drained.snapshot.spot = -1;

    const again = drainSince(ALL).chainSnapshots[0]!;
    const againRows = again.snapshot.rows as Array<Record<string, unknown>>;
    expect(againRows).toHaveLength(1);
    expect((againRows[0]!.ce as Record<string, unknown>).oi).toBe(10);
    expect(again.snapshot.spot).toBe(24012.4);
  });

  // Proof 6
  it("a second drain is fully independent from the first", () => {
    tapPushTick(tick());

    const a = drainSince(ALL).ticks[0]!;
    const b = drainSince(ALL).ticks[0]!;

    expect(a).not.toBe(b);
    expect(a.raw).not.toBe(b.raw);
    expect(a.raw.ohlc).not.toBe(b.raw.ohlc);

    (a.raw.ohlc as Record<string, unknown>).open = -1;
    expect((b.raw.ohlc as Record<string, unknown>).open).toBe(23900);
  });

  it("drain never shares an object identity with a subsequent drain", () => {
    tapPushBoardSnapshot(board());
    const a = drainSince(ALL).boardSnapshots[0]!;
    const b = drainSince(ALL).boardSnapshots[0]!;
    expect(a.rows).not.toBe(b.rows);
    expect(a.rows[0]).not.toBe(b.rows[0]);
  });

  it("the drain path itself never records a rejection", () => {
    tapPushTick(tick());
    tapPushChainSnapshot(chain());
    tapPushBoardSnapshot(board());
    tapPushSystemEvent(event());
    drainSince(ALL);
    drainSince(ALL);
    expect(getReplayRejectionDiagnostics().total).toBe(0);
  });
});

/* ───────────────────────── C. ACCEPTED VALUE RANGE ───────────────── */

describe("C. supported values are accepted and copied", () => {
  // Proof 7
  it("plain objects and arrays within the accepted depth work", () => {
    // snapshot=1, l2=2, l3=3, l4=4 — all strictly below MAX_REPLAY_DEPTH.
    const deep = chain({
      snapshot: { l2: { l3: { l4: { leaf: "ok", list: [1, 2, 3] } } } },
    });
    tapPushTick(tick());
    tapPushChainSnapshot(deep);

    const got = drainSince(ALL).chainSnapshots[0]!;
    const l2 = got.snapshot.l2 as Record<string, unknown>;
    const l3 = l2.l3 as Record<string, unknown>;
    const l4 = l3.l4 as Record<string, unknown>;
    expect(l4.leaf).toBe("ok");
    expect(l4.list).toEqual([1, 2, 3]);
    expect(getReplayRejectionDiagnostics().total).toBe(0);
  });

  it("null, undefined, booleans, strings and numbers survive exactly", () => {
    tapPushTick(
      tick({
        oi: null,
        raw: {
          nul: null,
          undef: undefined,
          yes: true,
          no: false,
          str: "x",
          zero: 0,
          neg: -1.5,
        },
      }),
    );
    const raw = drainSince(ALL).ticks[0]!.raw;
    expect(raw.nul).toBeNull();
    expect("undef" in raw).toBe(true);
    expect(raw.undef).toBeUndefined();
    expect(raw.yes).toBe(true);
    expect(raw.no).toBe(false);
    expect(raw.str).toBe("x");
    expect(raw.zero).toBe(0);
    expect(raw.neg).toBe(-1.5);
  });

  it("an own __proto__ key is stored as real data, not applied as a prototype", () => {
    // Reachable: JSON.parse produces own __proto__ keys and chain
    // snapshots come from parsed HTTP JSON.
    const snapshot = JSON.parse('{"__proto__":{"polluted":true},"ok":1}') as Record<
      string,
      unknown
    >;
    tapPushChainSnapshot(chain({ snapshot }));

    const got = drainSince(ALL).chainSnapshots[0]!.snapshot;
    expect(Object.prototype.hasOwnProperty.call(got, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(got)).toBe(Object.prototype);
    expect((({}) as Record<string, unknown>).polluted).toBeUndefined();
    expect(got.ok).toBe(1);
  });

  it("array holes stay holes and length is preserved", () => {
    const sparse: unknown[] = [1];
    sparse[3] = 4;
    tapPushChainSnapshot(chain({ snapshot: { sparse } }));

    const got = drainSince(ALL).chainSnapshots[0]!.snapshot.sparse as unknown[];
    expect(got).toHaveLength(4);
    expect(1 in got).toBe(false);
    expect(got[3]).toBe(4);
  });

  it("a null-prototype payload keeps its null prototype", () => {
    const np = Object.create(null) as Record<string, unknown>;
    np.a = 1;
    tapPushChainSnapshot(chain({ snapshot: { np } }));

    const got = drainSince(ALL).chainSnapshots[0]!.snapshot.np as object;
    expect(Object.getPrototypeOf(got)).toBeNull();
    expect((got as Record<string, unknown>).a).toBe(1);
  });
});

/* ───────────────────────── D. FAIL-CLOSED REJECTION ──────────────── */

describe("D. unsupported values are rejected, never shared", () => {
  function expectRejected(reason: string) {
    const d = getReplayRejectionDiagnostics();
    expect(d.total).toBe(1);
    expect(d.byReason[reason as keyof typeof d.byReason]).toBe(1);
    // Proof 15 — the ring never grew.
    expect(tapStats().tickCount + tapStats().chainCount).toBe(0);
    expect(drainSince(ALL).ticks).toHaveLength(0);
    expect(drainSince(ALL).chainSnapshots).toHaveLength(0);
  }

  // Proof 8
  it("excessive nesting is rejected, not shared", () => {
    // snapshot=1, l2=2, l3=3, l4=4, l5=5, l6=6 -> rejected at 6.
    const tooDeep = { l2: { l3: { l4: { l5: { l6: { leaf: 1 } } } } } };
    tapPushChainSnapshot(chain({ snapshot: tooDeep }));
    expectRejected("MAX_DEPTH_EXCEEDED");
  });

  // Proof 9
  it("cyclic input is rejected deterministically", () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    tapPushTick(tick({ raw: cyclic }));
    expectRejected("CYCLIC_REFERENCE");
  });

  it("a cycle through an array is also rejected", () => {
    const arr: unknown[] = [];
    arr.push(arr);
    tapPushTick(tick({ raw: { arr } }));
    expect(getReplayRejectionDiagnostics().byReason.CYCLIC_REFERENCE).toBe(1);
    expect(drainSince(ALL).ticks).toHaveLength(0);
  });

  it("a repeated (non-cyclic) sibling reference is NOT mistaken for a cycle", () => {
    const shared = { v: 1 };
    tapPushTick(tick({ raw: { a: shared, b: shared } }));
    const got = drainSince(ALL).ticks[0]!;
    expect(getReplayRejectionDiagnostics().total).toBe(0);
    expect(got.raw.a).toEqual({ v: 1 });
    expect(got.raw.b).toEqual({ v: 1 });
    // Copied independently — they must NOT alias each other.
    expect(got.raw.a).not.toBe(got.raw.b);
  });

  // Proof 10
  it("getter/accessor input is rejected", () => {
    const raw: Record<string, unknown> = {};
    Object.defineProperty(raw, "leaky", {
      get: () => "computed",
      enumerable: true,
      configurable: true,
    });
    tapPushTick(tick({ raw }));
    expectRejected("ACCESSOR_PROPERTY");
  });

  it("a setter-only property is rejected too", () => {
    const raw: Record<string, unknown> = {};
    Object.defineProperty(raw, "sink", {
      set: () => undefined,
      enumerable: true,
      configurable: true,
    });
    tapPushTick(tick({ raw }));
    expectRejected("ACCESSOR_PROPERTY");
  });

  it("a throwing getter is rejected WITHOUT being invoked", () => {
    let invoked = false;
    const raw: Record<string, unknown> = {};
    Object.defineProperty(raw, "boom", {
      get: () => {
        invoked = true;
        throw new Error("must never run");
      },
      enumerable: true,
      configurable: true,
    });
    expect(() => tapPushTick(tick({ raw }))).not.toThrow();
    expect(invoked).toBe(false);
    expectRejected("ACCESSOR_PROPERTY");
  });

  // Proof 11
  it("function values are rejected", () => {
    tapPushTick(tick({ raw: { fn: () => 1 } }));
    expectRejected("FUNCTION_VALUE");
  });

  it("symbol values are rejected", () => {
    tapPushTick(tick({ raw: { sym: Symbol("s") } }));
    expectRejected("SYMBOL_VALUE");
  });

  it("bigint values are rejected", () => {
    tapPushTick(tick({ raw: { big: BigInt(1) } }));
    expectRejected("BIGINT_VALUE");
  });

  // Proof 12
  it("class instances are rejected", () => {
    class Position {
      constructor(readonly qty: number) {}
    }
    tapPushTick(tick({ raw: { pos: new Position(5) } }));
    expectRejected("CLASS_INSTANCE");
  });

  // Proof 13
  it("custom-toJSON objects are rejected", () => {
    const withToJson = { v: 1, toJSON: () => ({ v: "custom" }) };
    tapPushTick(tick({ raw: { withToJson } }));
    expectRejected("CUSTOM_TO_JSON");
  });

  // Proof 14 — Date/Map/Set are NOT normalized by this contract, so the
  // explicit field contract rejects them rather than sharing them.
  it("Date values are rejected (not silently shared)", () => {
    tapPushTick(tick({ raw: { ts: new Date(T0) } }));
    expectRejected("DATE_VALUE");
  });

  it("Map and Set values are rejected", () => {
    tapPushTick(tick({ raw: { m: new Map([["a", 1]]) } }));
    expect(getReplayRejectionDiagnostics().byReason.MAP_OR_SET_VALUE).toBe(1);
    _resetLiveTapRing();
    tapPushTick(tick({ raw: { s: new Set([1]) } }));
    expectRejected("MAP_OR_SET_VALUE");
  });

  it("weak collections and promises are rejected", () => {
    tapPushTick(tick({ raw: { w: new WeakMap() } }));
    expect(getReplayRejectionDiagnostics().byReason.WEAK_COLLECTION_VALUE).toBe(1);
    _resetLiveTapRing();
    tapPushTick(tick({ raw: { p: Promise.resolve(1) } }));
    expectRejected("PROMISE_VALUE");
  });

  it("a malformed scalar field rejects the entry", () => {
    tapPushTick(tick({ receivedAtMs: NaN }));
    expect(getReplayRejectionDiagnostics().byReason.INVALID_SCALAR_FIELD).toBe(1);
    _resetLiveTapRing();
    tapPushSystemEvent(event({ kind: "NOT_A_KIND" as TapSystemEvent["kind"] }));
    expect(getReplayRejectionDiagnostics().byReason.INVALID_SCALAR_FIELD).toBe(1);
    expect(drainSince(ALL).systemEvents).toHaveLength(0);
  });

  it("a non-object payload container rejects the entry", () => {
    tapPushTick(tick({ raw: [1, 2] as unknown as Record<string, unknown> }));
    expectRejected("INVALID_PAYLOAD_CONTAINER");
  });

  it("rejection of one entry never damages entries already stored", () => {
    tapPushTick(tick({ ltp: 1 }));
    tapPushTick(tick({ raw: { bad: () => 1 } }));
    tapPushTick(tick({ ltp: 3 }));

    expect(drainSince(ALL).ticks.map((x) => x.ltp)).toEqual([1, 3]);
    expect(getReplayRejectionDiagnostics().total).toBe(1);
  });

  it("rejection never throws into the caller", () => {
    expect(() => tapPushTick(tick({ raw: { fn: () => 1 } }))).not.toThrow();
    expect(() => tapPushChainSnapshot(chain({ snapshot: { d: new Date() } }))).not.toThrow();
    expect(() => tapPushBoardSnapshot(board({ rows: [null as unknown as Record<string, unknown>] }))).not.toThrow();
    expect(() => tapPushSystemEvent(event({ detail: { s: Symbol("x") } }))).not.toThrow();
  });

  it("caller input is never mutated or frozen by rejection or acceptance", () => {
    const accepted = tick();
    const rejected = tick({ raw: { fn: () => 1 } });
    tapPushTick(accepted);
    tapPushTick(rejected);

    expect(Object.isFrozen(accepted)).toBe(false);
    expect(Object.isFrozen(accepted.raw)).toBe(false);
    expect(Object.isFrozen(rejected)).toBe(false);
    expect(accepted.ltp).toBe(24000);
    expect(typeof rejected.raw.fn).toBe("function");
  });
});

/* ───── D2. HOSTILE ACCESSORS AND EXOTIC ARRAYS (review regressions) ─ */

describe("D2. no accessor is ever invoked, at any position", () => {
  /** Defines a property whose getter fails the test if it ever runs. */
  function poison(target: object, key: string): void {
    Object.defineProperty(target, key, {
      get: () => {
        throw new Error(`getter for "${key}" must never be invoked`);
      },
      configurable: true,
      enumerable: true,
    });
  }

  it("a throwing accessor on a TOP-LEVEL field rejects without running", () => {
    for (const key of ["receivedAtMs", "ltp", "symbol", "raw", "oi"]) {
      _resetLiveTapRing();
      const t = tick();
      delete (t as unknown as Record<string, unknown>)[key];
      poison(t, key);

      expect(() => tapPushTick(t)).not.toThrow();
      expect(tapStats().tickCount).toBe(0);
      const d = getReplayRejectionDiagnostics();
      expect(d.byReason.ACCESSOR_PROPERTY).toBe(1);
      expect(d.lastRejection?.path).toBe(key);
    }
  });

  it("a throwing top-level accessor rejects on all four entry types", () => {
    _resetLiveTapRing();
    const c = chain();
    delete (c as unknown as Record<string, unknown>).snapshot;
    poison(c, "snapshot");
    const b = board();
    delete (b as unknown as Record<string, unknown>).rows;
    poison(b, "rows");
    const e = event();
    delete (e as unknown as Record<string, unknown>).detail;
    poison(e, "detail");

    expect(() => {
      tapPushChainSnapshot(c);
      tapPushBoardSnapshot(b);
      tapPushSystemEvent(e);
    }).not.toThrow();

    const d = getReplayRejectionDiagnostics();
    expect(d.total).toBe(3);
    expect(d.byReason.ACCESSOR_PROPERTY).toBe(3);
    expect(tapStats().chainCount + tapStats().boardCount + tapStats().eventCount).toBe(0);
  });

  it("a throwing `toJSON` accessor rejects without running", () => {
    const nested: Record<string, unknown> = { v: 1 };
    poison(nested, "toJSON");
    expect(() => tapPushTick(tick({ raw: { nested } }))).not.toThrow();
    expect(getReplayRejectionDiagnostics().byReason.ACCESSOR_PROPERTY).toBe(1);
    expect(tapStats().tickCount).toBe(0);
  });

  it("a throwing `then` accessor on an exotic object rejects without running", () => {
    class Weird {}
    const w = new Weird();
    poison(w, "then");
    expect(() => tapPushTick(tick({ raw: { w } }))).not.toThrow();
    // Classified by prototype brand, never by duck-typing `.then`.
    expect(getReplayRejectionDiagnostics().byReason.CLASS_INSTANCE).toBe(1);
    expect(tapStats().tickCount).toBe(0);
  });

  it("a NON-ENUMERABLE toJSON is still caught (it drives JSON.stringify)", () => {
    const sneaky: Record<string, unknown> = { v: 1 };
    Object.defineProperty(sneaky, "toJSON", {
      value: () => ({ v: "rewritten" }),
      enumerable: false,
      configurable: true,
    });
    // Proves the hazard is real: stringify honours it despite Object.keys
    // never listing it.
    expect(JSON.stringify(sneaky)).toBe('{"v":"rewritten"}');

    tapPushTick(tick({ raw: { sneaky } }));
    expect(getReplayRejectionDiagnostics().byReason.CUSTOM_TO_JSON).toBe(1);
    expect(tapStats().tickCount).toBe(0);
  });

  it("an ARRAY carrying its own toJSON is rejected, not silently copied", () => {
    const arr: unknown[] = [1, 2];
    (arr as unknown as Record<string, unknown>).toJSON = () => "REWRITTEN";
    expect(JSON.stringify({ arr })).toBe('{"arr":"REWRITTEN"}');

    tapPushChainSnapshot(chain({ snapshot: { arr } }));
    expect(getReplayRejectionDiagnostics().byReason.CUSTOM_TO_JSON).toBe(1);
    expect(tapStats().chainCount).toBe(0);
  });

  it("an Array SUBCLASS is rejected as a class instance", () => {
    class Rows extends Array<number> {}
    const rows = Rows.from([1, 2]) as unknown as unknown[];
    expect(Array.isArray(rows)).toBe(true); // isArray alone cannot catch it
    tapPushChainSnapshot(chain({ snapshot: { rows } }));
    expect(getReplayRejectionDiagnostics().byReason.CLASS_INSTANCE).toBe(1);
    expect(tapStats().chainCount).toBe(0);
  });

  it("an index visible only through a polluted Array.prototype is rejected", () => {
    const arr: unknown[] = [];
    arr.length = 2;
    arr[1] = "own";
    // Index 0 is a hole on the array but present on the prototype.
    Object.defineProperty(Array.prototype, "0", {
      value: "INHERITED",
      configurable: true,
      enumerable: false,
      writable: true,
    });
    try {
      expect(0 in arr).toBe(true);
      expect(Object.getOwnPropertyDescriptor(arr, 0)).toBeUndefined();

      // Must not throw a TypeError out of the push, and must not store.
      expect(() =>
        tapPushChainSnapshot(chain({ snapshot: { arr } })),
      ).not.toThrow();
      expect(
        getReplayRejectionDiagnostics().byReason.INHERITED_INDEXED_PROPERTY,
      ).toBe(1);
      expect(tapStats().chainCount).toBe(0);
    } finally {
      delete (Array.prototype as unknown as Record<string, unknown>)["0"];
    }
  });

  // CONTRACT BOUNDARY. A Proxy can run code from any reflection
  // operation, so the no-invoke guarantee is scoped to ordinary objects.
  // What must STILL hold unconditionally is the integrity invariant:
  // a hostile proxy costs an entry, never storage correctness.
  it("a proxy's `get` trap is never fired — descriptor reads bypass it", () => {
    // Going descriptor-only had an unplanned benefit: `get` traps are
    // simply never consulted, so this class of proxy is normalized into
    // ordinary data instead of being stored by reference.
    let getTrapFired = false;
    const target = [1, 2] as unknown[];
    const proxied = new Proxy(target, {
      get(t, prop, recv) {
        getTrapFired = true;
        return Reflect.get(t, prop, recv);
      },
    });

    tapPushChainSnapshot(chain({ snapshot: { proxied } }));

    expect(getTrapFired).toBe(false);
    const stored = drainSince(ALL).chainSnapshots[0]!.snapshot
      .proxied as unknown[];
    // Stored as an independent plain array, NOT as the proxy or target.
    expect(stored).toEqual([1, 2]);
    expect(stored).not.toBe(proxied);
    expect(stored).not.toBe(target);
    target[0] = 999;
    expect(stored[0]).toBe(1);
  });

  it("a proxy with a throwing reflection trap stores nothing and corrupts nothing", () => {
    // The documented residual: getOwnPropertyDescriptor/ownKeys traps
    // CAN run code and throw. Integrity must still hold absolutely.
    tapPushTick(tick({ ltp: 111 })); // a good entry already in the ring

    const hostile = new Proxy(
      { a: 1 },
      {
        getOwnPropertyDescriptor() {
          throw new Error("hostile trap");
        },
      },
    );

    // May throw — that is documented, and every production call site
    // wraps tapPush* in try/catch. It must never store or damage.
    try {
      tapPushChainSnapshot(chain({ snapshot: { hostile } }));
    } catch {
      /* contained exactly as the production call sites contain it */
    }

    expect(tapStats().chainCount).toBe(0);
    const ticks = drainSince(ALL).ticks;
    expect(ticks).toHaveLength(1);
    expect(ticks[0]!.ltp).toBe(111);
  });

  it("array length is read by descriptor, not by member access", () => {
    // A getter on `length` is impossible on a real array, so this pins
    // the weaker but checkable property: the source has no bare
    // `src.length` read left in the copy path.
    const src = readFileSync(path.join(__dirname, "liveTapRing.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/\bsrc\.length\b/);
  });

  it("a genuine hole is still preserved when the prototype is clean", () => {
    const arr: unknown[] = [];
    arr.length = 2;
    arr[1] = "own";
    tapPushChainSnapshot(chain({ snapshot: { arr } }));
    const got = drainSince(ALL).chainSnapshots[0]!.snapshot.arr as unknown[];
    expect(got).toHaveLength(2);
    expect(0 in got).toBe(false);
    expect(got[1]).toBe("own");
  });
});

/* ───────────────────────── E. DIAGNOSTICS ────────────────────────── */

describe("E. rejection diagnostics", () => {
  // Proof 16
  it("counters increase correctly by total, entry type and reason", () => {
    tapPushTick(tick({ raw: { fn: () => 1 } }));
    tapPushTick(tick({ raw: { d: new Date() } }));
    tapPushChainSnapshot(chain({ snapshot: { s: Symbol("x") } }));

    const d = getReplayRejectionDiagnostics();
    expect(d.total).toBe(3);
    expect(d.byEntryType.tick).toBe(2);
    expect(d.byEntryType.chainSnapshot).toBe(1);
    expect(d.byEntryType.boardSnapshot).toBe(0);
    expect(d.byReason.FUNCTION_VALUE).toBe(1);
    expect(d.byReason.DATE_VALUE).toBe(1);
    expect(d.byReason.SYMBOL_VALUE).toBe(1);
    expect(d.lastRejection).toEqual({
      entryType: "chainSnapshot",
      reason: "SYMBOL_VALUE",
      path: "snapshot.s",
    });
  });

  it("diagnostics are surfaced on tapStats and are a defensive copy", () => {
    tapPushTick(tick({ raw: { fn: () => 1 } }));
    const stats = tapStats();
    expect(stats.rejections.total).toBe(1);

    stats.rejections.total = 999;
    stats.rejections.byEntryType.tick = 999;
    expect(tapStats().rejections.total).toBe(1);
    expect(tapStats().rejections.byEntryType.tick).toBe(1);
  });

  it("counters stay at zero for every realistic production payload", () => {
    // Exact shapes from the Section A call-site inventory.
    tapPushTick({
      receivedAtMs: T0,
      instrumentToken: 256265,
      symbol: "NIFTY 50",
      ltp: 24000.5,
      ltq: 0,
      volume: null,
      oi: null,
      raw: {
        ohlc: { open: 23900, high: 24100, low: 23850, close: 23950 },
        change_percent: 0.21,
      },
    });
    tapPushChainSnapshot({
      capturedAtMs: T0,
      underlying: "NIFTY",
      expiry: "2026-08-27",
      source: "kite",
      snapshot: {
        rows: Array.from({ length: 40 }, (_, i) => ({
          strike: 23000 + i * 50,
          ce: { oi: 1, chgOi: 2, iv: 12.5, ltp: 100, moneyness: "OTM", open: null },
          pe: { oi: 3, chgOi: 4, iv: 13.5, ltp: 90, moneyness: "ITM", open: null },
          pcrOi: 1.2,
          isMaxPain: false,
        })),
        spot: 24012.4,
      },
    });
    tapPushSystemEvent({
      emittedAtMs: T0,
      kind: "SYSTEM_MODE_TRANSITION",
      detail: { from: "NORMAL", to: "DEGRADED", drivers: ["kite_stale", "nse_slow"] },
    });
    tapPushSystemEvent({
      emittedAtMs: T0,
      kind: "KITE_SESSION_EDGE",
      detail: { edge: "disconnect", err: "socket hang up" },
    });
    tapPushSystemEvent({
      emittedAtMs: T0,
      kind: "REGIME_CHANGE",
      detail: {
        indexSymbol: "NIFTY",
        from: "RANGE",
        to: "TREND_UP",
        reason: "adx>25",
        bypassedHysteresis: true,
      },
    });

    const s = tapStats();
    expect(s.rejections.total).toBe(0);
    expect(s.tickCount).toBe(1);
    expect(s.chainCount).toBe(1);
    expect(s.eventCount).toBe(3);
  });

  // Proof 17
  it("diagnostic output exposes no payload contents or secrets", () => {
    const SECRET = "kite_access_token_SUPERSECRET_VALUE";
    tapPushTick(
      tick({
        raw: {
          accessToken: SECRET,
          nested: { apiSecret: SECRET },
          leak: () => SECRET,
        },
      }),
    );

    const serialised = JSON.stringify(getReplayRejectionDiagnostics());
    expect(serialised).not.toContain(SECRET);
    expect(serialised).not.toContain("SUPERSECRET");
    // Only the structural key path is retained.
    expect(getReplayRejectionDiagnostics().lastRejection?.path).toBe("raw.leak");
  });

  it("_resetLiveTapRing clears the counters as well as the rings", () => {
    tapPushTick(tick({ raw: { fn: () => 1 } }));
    expect(getReplayRejectionDiagnostics().total).toBe(1);
    _resetLiveTapRing();
    const d = getReplayRejectionDiagnostics();
    expect(d.total).toBe(0);
    expect(d.byReason).toEqual({});
    expect(d.lastRejection).toBeNull();
    expect(d.byEntryType).toEqual({
      tick: 0,
      chainSnapshot: 0,
      boardSnapshot: 0,
      systemEvent: 0,
    });
  });
});

/* ───────────────────────── F. OUTPUT + STRUCTURAL PARITY ─────────── */

describe("F. production JSON shape and ring behaviour are preserved", () => {
  // Proof 18
  it("all four entry types preserve their valid production JSON shape", () => {
    const t = tick();
    const c = chain();
    const b = board();
    const e = event();
    tapPushTick(t);
    tapPushChainSnapshot(c);
    tapPushBoardSnapshot(b);
    tapPushSystemEvent(e);

    const d = drainSince(ALL);
    // Byte-for-byte parity with serialising the caller's own object —
    // this is exactly what the recorder writes to JSONL.
    expect(JSON.stringify(d.ticks[0])).toBe(JSON.stringify(t));
    expect(JSON.stringify(d.chainSnapshots[0])).toBe(JSON.stringify(c));
    expect(JSON.stringify(d.boardSnapshots[0])).toBe(JSON.stringify(b));
    expect(JSON.stringify(d.systemEvents[0])).toBe(JSON.stringify(e));
  });

  it("the recorder's own projection of a tick is byte-identical", () => {
    const t = tick();
    tapPushTick(t);
    const stored = drainSince(ALL).ticks[0]!;
    // Mirrors serialiseFixture() in routes/replayRecorder.ts.
    const project = (x: TapTick) => ({
      receivedAtMs: x.receivedAtMs,
      instrumentToken: x.instrumentToken,
      ltp: x.ltp,
      raw: { symbol: x.symbol, ...x.raw },
    });
    expect(JSON.stringify(project(stored))).toBe(JSON.stringify(project(t)));
  });

  // Proof 19
  it("capacity, wrap, order and reset behaviour are unchanged", () => {
    const cap = _tapCapacities().chains;
    for (let i = 0; i < cap + 25; i++) {
      tapPushChainSnapshot(chain({ capturedAtMs: T0 + i, underlying: `U${i}` }));
    }
    const got = drainSince(ALL).chainSnapshots;
    expect(got).toHaveLength(cap);
    // Oldest 25 were overwritten; order is still oldest -> newest.
    expect(got[0]!.underlying).toBe("U25");
    expect(got[got.length - 1]!.underlying).toBe(`U${cap + 24}`);
    for (let i = 1; i < got.length; i++) {
      expect(got[i]!.capturedAtMs).toBeGreaterThan(got[i - 1]!.capturedAtMs);
    }

    _resetLiveTapRing();
    expect(tapStats().chainCount).toBe(0);
    tapPushChainSnapshot(chain());
    expect(tapStats().chainCount).toBe(1);
  });

  it("the drain window boundary is still inclusive", () => {
    tapPushTick(tick({ receivedAtMs: T0 - 1 }));
    tapPushTick(tick({ receivedAtMs: T0 }));
    const got = drainSince({ sinceMs: T0 }).ticks;
    expect(got).toHaveLength(1);
    expect(got[0]!.receivedAtMs).toBe(T0);
  });

  // Proof 20 + 22 — source-text guards. readFileSync, never a dynamic
  // import: importing these modules for a text check would run their
  // module-level side effects.
  const SRC = (f: string) =>
    readFileSync(path.join(__dirname, f), "utf8");

  it("no shift / front-splice returns to the append path", () => {
    for (const f of ["liveTapRing.ts", "ringBuffer.ts"]) {
      // Comments are stripped first: ringBuffer.ts's header legitimately
      // NAMES the Array.shift()/splice() pattern it replaced.
      const code = SRC(f)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(code).not.toMatch(/\.shift\s*\(/);
      expect(code).not.toMatch(/\.unshift\s*\(/);
      expect(code).not.toMatch(/\.splice\s*\(/);
    }
  });

  it("no provider, DB, scheduler or subscription work is introduced", () => {
    for (const f of ["liveTapRing.ts", "ringBuffer.ts"]) {
      const src = SRC(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(src).not.toMatch(/setInterval|setTimeout|setImmediate/);
      expect(src).not.toMatch(/\bdrizzle\b|\bdb\.|executeSql|\bpool\b/);
      expect(src).not.toMatch(/\bfetch\s*\(|axios|KiteConnect|KiteTicker/);
      expect(src).not.toMatch(/subscribe\s*\(|\.on\s*\(/);
      expect(src).not.toMatch(/structuredClone|JSON\.parse|JSON\.stringify/);
    }
  });

  it("the module declares no universal clone surface", () => {
    const src = SRC("liveTapRing.ts");
    // The rejected "share and count" primitive must be gone.
    expect(src).not.toMatch(/boundedCopy/);
    expect(src).not.toMatch(/exoticPassthroughs/);
    expect(src).not.toMatch(/depthLimitTruncations/);
  });

  // Proof 21
  it("append stays O(1) as retained size grows", () => {
    const measure = (preload: number): number => {
      _resetLiveTapRing();
      for (let i = 0; i < preload; i++) {
        tapPushTick(tick({ receivedAtMs: T0 + i }));
      }
      const N = 4000;
      const start = performance.now();
      for (let i = 0; i < N; i++) {
        tapPushTick(tick({ receivedAtMs: T0 + preload + i }));
      }
      return (performance.now() - start) / N;
    };

    measure(1000); // warm JIT
    const small = measure(1_000);
    const large = measure(120_000);

    // Linear-in-size behaviour would be ~120x here. A generous ceiling
    // keeps this robust on a shared CI container while still failing
    // loudly if per-append cost starts tracking retained size.
    expect(large).toBeLessThan(Math.max(small, 0.0005) * 6);
    expect(tapStats().rejections.total).toBe(0);
  });
});

describe("G. depth boundary is exact", () => {
  it("accepts the deepest legal payload and rejects one level more", () => {
    // Container depth: snapshot=1 ... so the deepest legal object sits at
    // MAX_REPLAY_DEPTH - 1.
    const build = (levels: number): Record<string, unknown> => {
      let node: Record<string, unknown> = { leaf: 1 };
      for (let i = 0; i < levels; i++) node = { next: node };
      return node;
    };

    // snapshot(1) + 4 nested objects = deepest object at depth 5.
    tapPushChainSnapshot(chain({ snapshot: build(4) }));
    expect(tapStats().chainCount).toBe(1);
    expect(getReplayRejectionDiagnostics().total).toBe(0);

    _resetLiveTapRing();
    tapPushChainSnapshot(chain({ snapshot: build(5) }));
    expect(tapStats().chainCount).toBe(0);
    expect(getReplayRejectionDiagnostics().byReason.MAX_DEPTH_EXCEEDED).toBe(1);
  });

  it("MAX_REPLAY_DEPTH is the documented value", () => {
    expect(MAX_REPLAY_DEPTH).toBe(6);
  });
});
