/**
 * Phase 0.5C — RingBuffer correctness suite (Section G, checks 1–20).
 *
 * Deterministic synthetic data only. No provider call, no database
 * write, no scheduler, no subscription, no network.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { RingBuffer } from "./ringBuffer";

const PROD_APPEND_PATH_FILES = [
  path.join(__dirname, "ringBuffer.ts"),
  path.join(__dirname, "liveTapRing.ts"),
];

describe("G1 capacity 1", () => {
  it("retains only the newest entry", () => {
    const r = new RingBuffer<number>(1);
    expect(r.capacity).toBe(1);
    r.push(1);
    expect(r.toArray()).toEqual([1]);
    expect(r.isFull).toBe(true);
    r.push(2);
    expect(r.size).toBe(1);
    expect(r.toArray()).toEqual([2]);
    r.push(3);
    expect(r.toArray()).toEqual([3]);
  });
});

describe("G2 capacity 2", () => {
  it("keeps the newest two in oldest-to-newest order", () => {
    const r = new RingBuffer<number>(2);
    r.push(1);
    expect(r.toArray()).toEqual([1]);
    r.push(2);
    expect(r.toArray()).toEqual([1, 2]);
    r.push(3);
    expect(r.toArray()).toEqual([2, 3]);
    r.push(4);
    expect(r.toArray()).toEqual([3, 4]);
    expect(r.size).toBe(2);
  });
});

describe("G3 default production capacity", () => {
  it("accepts the 400_000 tick capacity and stays bounded", () => {
    const r = new RingBuffer<number>(400_000);
    expect(r.capacity).toBe(400_000);
    for (let i = 0; i < 400_010; i++) r.push(i);
    expect(r.size).toBe(400_000);
    expect(r.peekOldest()).toBe(10);
    expect(r.peekNewest()).toBe(400_009);
  });
});

describe("G4 empty snapshot", () => {
  it("returns an empty array and honest empty state", () => {
    const r = new RingBuffer<number>(8);
    expect(r.size).toBe(0);
    expect(r.isEmpty).toBe(true);
    expect(r.isFull).toBe(false);
    expect(r.toArray()).toEqual([]);
    expect(r.filterToArray(() => true)).toEqual([]);
    expect(r.peekOldest()).toBeUndefined();
    expect(r.peekNewest()).toBeUndefined();
    expect(r.dropOldest()).toBeUndefined();
    expect(r.at(0)).toBeUndefined();
  });
});

describe("G5 partial buffer snapshot", () => {
  it("returns exactly the retained prefix", () => {
    const r = new RingBuffer<number>(10);
    for (let i = 0; i < 4; i++) r.push(i);
    expect(r.size).toBe(4);
    expect(r.isFull).toBe(false);
    expect(r.toArray()).toEqual([0, 1, 2, 3]);
  });
});

describe("G6 exactly-full buffer snapshot", () => {
  it("returns every slot with nothing evicted", () => {
    const r = new RingBuffer<number>(5);
    for (let i = 0; i < 5; i++) r.push(i);
    expect(r.isFull).toBe(true);
    expect(r.size).toBe(5);
    expect(r.toArray()).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("G7 single wrap-around", () => {
  it("evicts the oldest exactly once and preserves order", () => {
    const r = new RingBuffer<number>(5);
    for (let i = 0; i < 6; i++) r.push(i);
    expect(r.size).toBe(5);
    expect(r.toArray()).toEqual([1, 2, 3, 4, 5]);
    expect(r.peekOldest()).toBe(1);
    expect(r.peekNewest()).toBe(5);
  });
});

describe("G8 multiple wrap-arounds", () => {
  it("holds a contiguous newest-N window after many wraps", () => {
    const cap = 7;
    const r = new RingBuffer<number>(cap);
    const total = cap * 5 + 3;
    for (let i = 0; i < total; i++) r.push(i);
    expect(r.size).toBe(cap);
    expect(r.toArray()).toEqual(
      Array.from({ length: cap }, (_, i) => total - cap + i),
    );
  });

  it("stays correct across wraps interleaved with dropOldest", () => {
    const r = new RingBuffer<number>(4);
    for (let i = 0; i < 6; i++) r.push(i); // [2,3,4,5]
    expect(r.dropOldest()).toBe(2);
    expect(r.toArray()).toEqual([3, 4, 5]);
    r.push(6);
    r.push(7);
    expect(r.toArray()).toEqual([4, 5, 6, 7]);
    expect(r.size).toBe(4);
  });
});

describe("G9 large number of appends", () => {
  it("remains bounded and correct over 1e6 appends", () => {
    const cap = 1_000;
    const r = new RingBuffer<number>(cap);
    const total = 1_000_000;
    for (let i = 0; i < total; i++) r.push(i);
    expect(r.size).toBe(cap);
    expect(r.peekOldest()).toBe(total - cap);
    expect(r.peekNewest()).toBe(total - 1);
    const arr = r.toArray();
    expect(arr).toHaveLength(cap);
    for (let i = 1; i < arr.length; i++) {
      expect(arr[i]).toBe(arr[i - 1]! + 1);
    }
  });
});

describe("G10 oldest entry evicted exactly once per overflow", () => {
  it("each append past capacity removes precisely one entry", () => {
    const cap = 6;
    const r = new RingBuffer<number>(cap);
    for (let i = 0; i < cap; i++) r.push(i);
    for (let k = 1; k <= 20; k++) {
      r.push(cap + k - 1);
      expect(r.size).toBe(cap);
      expect(r.peekOldest()).toBe(k);
    }
  });

  it("size never exceeds capacity — 0 <= size <= capacity invariant", () => {
    const cap = 3;
    const r = new RingBuffer<number>(cap);
    for (let i = 0; i < 100; i++) {
      r.push(i);
      expect(r.size).toBeGreaterThanOrEqual(0);
      expect(r.size).toBeLessThanOrEqual(cap);
    }
  });
});

describe("G11 oldest-to-newest order preserved", () => {
  it("at(i) agrees with toArray() at every logical index after a wrap", () => {
    const r = new RingBuffer<string>(5);
    for (let i = 0; i < 13; i++) r.push(`v${i}`);
    const arr = r.toArray();
    expect(arr).toEqual(["v8", "v9", "v10", "v11", "v12"]);
    for (let i = 0; i < arr.length; i++) expect(r.at(i)).toBe(arr[i]);
    expect(r.at(-1)).toBeUndefined();
    expect(r.at(arr.length)).toBeUndefined();
  });

  it("no entry is duplicated or silently reordered", () => {
    const r = new RingBuffer<number>(50);
    for (let i = 0; i < 523; i++) r.push(i);
    const arr = r.toArray();
    expect(new Set(arr).size).toBe(arr.length);
    const sorted = [...arr].sort((a, b) => a - b);
    expect(arr).toEqual(sorted);
  });
});

describe("G12 reset after wrap-around", () => {
  it("clear() returns a valid, reusable empty buffer", () => {
    const r = new RingBuffer<number>(4);
    for (let i = 0; i < 11; i++) r.push(i);
    r.clear();
    expect(r.size).toBe(0);
    expect(r.isEmpty).toBe(true);
    expect(r.isFull).toBe(false);
    expect(r.toArray()).toEqual([]);
    expect(r.peekOldest()).toBeUndefined();
    r.push(100);
    r.push(101);
    expect(r.toArray()).toEqual([100, 101]);
  });

  it("draining every entry one by one leaves a valid empty state", () => {
    const r = new RingBuffer<number>(3);
    for (let i = 0; i < 5; i++) r.push(i); // [2,3,4]
    expect(r.dropOldest()).toBe(2);
    expect(r.dropOldest()).toBe(3);
    expect(r.dropOldest()).toBe(4);
    expect(r.dropOldest()).toBeUndefined();
    expect(r.size).toBe(0);
    expect(r.isEmpty).toBe(true);
    r.push(9);
    expect(r.toArray()).toEqual([9]);
  });
});

describe("G13 snapshot mutation cannot alter internal state", () => {
  it("mutating the array returned by toArray() does not touch the ring", () => {
    const r = new RingBuffer<number>(4);
    for (let i = 0; i < 4; i++) r.push(i);
    const snap = r.toArray();
    snap.push(999);
    snap[0] = -1;
    snap.length = 1;
    expect(r.size).toBe(4);
    expect(r.toArray()).toEqual([0, 1, 2, 3]);
  });

  it("mutating the array returned by filterToArray() does not touch the ring", () => {
    const r = new RingBuffer<number>(4);
    for (let i = 0; i < 4; i++) r.push(i);
    const got = r.filterToArray((n) => n % 2 === 0);
    expect(got).toEqual([0, 2]);
    got.push(999);
    got[0] = -1;
    expect(r.toArray()).toEqual([0, 1, 2, 3]);
  });

  it("successive snapshots are independent array instances", () => {
    const r = new RingBuffer<number>(3);
    r.push(1);
    const a = r.toArray();
    const b = r.toArray();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it("reads never mutate the ring", () => {
    const r = new RingBuffer<number>(5);
    for (let i = 0; i < 8; i++) r.push(i);
    const before = r.toArray();
    r.toArray();
    r.filterToArray(() => false);
    r.peekOldest();
    r.peekNewest();
    r.at(2);
    expect(r.size).toBe(5);
    expect(r.toArray()).toEqual(before);
  });
});

describe("G14 duplicate events remain distinct", () => {
  it("structurally identical entries are all retained as separate events", () => {
    const r = new RingBuffer<{ token: number; ltp: number }>(10);
    for (let i = 0; i < 5; i++) r.push({ token: 256265, ltp: 24000 });
    expect(r.size).toBe(5);
    expect(r.toArray()).toHaveLength(5);
  });

  it("the same object reference pushed twice occupies two slots", () => {
    const r = new RingBuffer<{ n: number }>(4);
    const shared = { n: 1 };
    r.push(shared);
    r.push(shared);
    expect(r.size).toBe(2);
    expect(r.at(0)).toBe(shared);
    expect(r.at(1)).toBe(shared);
  });
});

describe("G15 same-symbol NSE/BSE events remain distinct", () => {
  it("identical trading symbols on different exchanges never collapse", () => {
    interface E {
      canonicalInstrumentId: string;
      exchange: "NSE" | "BSE";
      tradingSymbol: string;
      providerInstrumentToken: number;
    }
    const r = new RingBuffer<E>(10);
    r.push({
      canonicalInstrumentId: "NSE:EQ:IDEA",
      exchange: "NSE",
      tradingSymbol: "IDEA",
      providerInstrumentToken: 111,
    });
    r.push({
      canonicalInstrumentId: "BSE:EQ:IDEA",
      exchange: "BSE",
      tradingSymbol: "IDEA",
      providerInstrumentToken: 222,
    });
    const got = r.toArray();
    expect(got).toHaveLength(2);
    expect(got.map((e) => e.canonicalInstrumentId)).toEqual([
      "NSE:EQ:IDEA",
      "BSE:EQ:IDEA",
    ]);
    expect(new Set(got.map((e) => e.providerInstrumentToken)).size).toBe(2);
  });

  it("survives a wrap without cross-exchange contamination", () => {
    const r = new RingBuffer<string>(4);
    const ids = [
      "NSE:EQ:IDEA",
      "BSE:EQ:IDEA",
      "NSE:EQ:TCS",
      "BSE:EQ:TCS",
      "NSE:EQ:SBIN",
      "BSE:EQ:SBIN",
    ];
    for (const id of ids) r.push(id);
    expect(r.toArray()).toEqual([
      "NSE:EQ:TCS",
      "BSE:EQ:TCS",
      "NSE:EQ:SBIN",
      "BSE:EQ:SBIN",
    ]);
  });
});

describe("G16 index aliases preserve canonical identity", () => {
  it("an alias does not create a duplicate entry — one event in, one out", () => {
    const r = new RingBuffer<{ canonicalInstrumentId: string; alias: string }>(10);
    r.push({ canonicalInstrumentId: "NSE:INDICES:NIFTY 50", alias: "NIFTY" });
    expect(r.size).toBe(1);
    expect(r.at(0)!.canonicalInstrumentId).toBe("NSE:INDICES:NIFTY 50");
  });

  it("two genuine provider events for one canonical id are both retained", () => {
    const r = new RingBuffer<{ canonicalInstrumentId: string; seq: number }>(10);
    r.push({ canonicalInstrumentId: "NSE:INDICES:NIFTY 50", seq: 1 });
    r.push({ canonicalInstrumentId: "NSE:INDICES:NIFTY 50", seq: 2 });
    expect(r.toArray().map((e) => e.seq)).toEqual([1, 2]);
  });
});

describe("G17 invalid capacity rejected", () => {
  it.each([0, -1, -100, 1.5, 0.5, NaN, Infinity, -Infinity])(
    "rejects capacity %p",
    (bad) => {
      expect(() => new RingBuffer<number>(bad as number)).toThrow(RangeError);
    },
  );

  it("accepts the smallest legal capacity", () => {
    expect(() => new RingBuffer<number>(1)).not.toThrow();
  });
});

describe("G18/G19 no linear trim in the production append path", () => {
  it.each(PROD_APPEND_PATH_FILES)("%s contains no .shift()", (file) => {
    const src = readFileSync(file, "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/\.shift\s*\(/);
  });

  it.each(PROD_APPEND_PATH_FILES)("%s contains no front-removal .splice()", (file) => {
    const src = readFileSync(file, "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/\.splice\s*\(/);
  });

  it("liveTapRing routes every stream through RingBuffer", () => {
    const src = readFileSync(path.join(__dirname, "liveTapRing.ts"), "utf8");
    expect(src).toMatch(/from "\.\/ringBuffer"/);
    expect(src).toMatch(/new RingBuffer<TapTick>\(CAP_TICKS\)/);
    expect(src).toMatch(/new RingBuffer<TapChainSnapshot>\(CAP_CHAIN\)/);
    expect(src).toMatch(/new RingBuffer<TapBoardSnapshot>\(CAP_BOARDS\)/);
    expect(src).toMatch(/new RingBuffer<TapSystemEvent>\(CAP_EVENTS\)/);
  });
});

describe("G20 no database, provider, scheduler or network call introduced", () => {
  const FORBIDDEN: Array<[string, RegExp]> = [
    ["timer", /\bsetInterval\s*\(|\bsetTimeout\s*\(|\bsetImmediate\s*\(/],
    ["database", /\bdb\s*\.|\bdrizzle\b|\bpool\s*\.query|\bexecuteSql\b/],
    ["network", /\bfetch\s*\(|\baxios\b|\bhttps?\.request\b|WebSocket|EventSource/],
    ["provider", /KiteConnect|KiteTicker|Upstox|IndianAPI|yahoo/i],
    ["subscription", /\bsubscribe\s*\(|\bunsubscribe\s*\(/],
    ["persistence", /\bfs\s*\.|writeFile|readFile|createWriteStream/],
  ];

  it.each(FORBIDDEN)("ringBuffer.ts introduces no %s call", (_label, re) => {
    const src = readFileSync(path.join(__dirname, "ringBuffer.ts"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(re);
  });

  it("ringBuffer.ts has no imports at all — it is a pure data structure", () => {
    const src = readFileSync(path.join(__dirname, "ringBuffer.ts"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/^\s*import\s/m);
    expect(code).not.toMatch(/\brequire\s*\(/);
  });

  it("liveTapRing.ts imports nothing beyond the ring buffer and the logger", () => {
    const src = readFileSync(path.join(__dirname, "liveTapRing.ts"), "utf8");
    const imports = [...src.matchAll(/^\s*import\s[\s\S]*?from\s+"([^"]+)"/gm)].map(
      (m) => m[1],
    );
    // DELIBERATE RELAXATION (Phase 0.5C typed snapshot contract).
    // The allowlist gained "./logger" because the contract must log a
    // safe reason when it REJECTS an entry — silent data loss would be
    // strictly worse than the shared references this phase removed.
    // The guard's intent is unchanged and still enforced above: no
    // database, provider, scheduler, subscription or network import may
    // appear here. Any addition beyond these two still fails.
    expect(imports).toEqual(["./ringBuffer", "./logger"]);
  });
});
