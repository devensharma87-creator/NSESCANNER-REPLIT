import { describe, it, expect, beforeEach } from "vitest";
import {
  loadBenchmarkPref,
  saveBenchmarkPref,
  resolveBenchmarkPref,
  isBenchmarkKey,
  DEFAULT_BENCHMARK_KEY,
} from "./benchmarkPref";

/** Minimal in-memory Storage stand-in for deterministic tests. */
function memStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
}

describe("benchmarkPref", () => {
  let storage: Storage;
  beforeEach(() => {
    storage = memStorage();
  });

  it("validates known keys only", () => {
    expect(isBenchmarkKey("NIFTY")).toBe(true);
    expect(isBenchmarkKey("NIFTY500")).toBe(true);
    expect(isBenchmarkKey("DOWJONES")).toBe(false);
    expect(isBenchmarkKey(null)).toBe(false);
    expect(isBenchmarkKey(42)).toBe(false);
  });

  it("returns null when nothing is stored", () => {
    expect(loadBenchmarkPref("p1", storage)).toBeNull();
    expect(loadBenchmarkPref(null, storage)).toBeNull();
  });

  it("round-trips a per-portfolio preference", () => {
    saveBenchmarkPref("p1", "BANKNIFTY", storage);
    expect(loadBenchmarkPref("p1", storage)).toBe("BANKNIFTY");
    // Other portfolios are unaffected.
    expect(loadBenchmarkPref("p2", storage)).toBeNull();
  });

  it("keeps portfolio scopes independent", () => {
    saveBenchmarkPref("p1", "BANKNIFTY", storage);
    saveBenchmarkPref("p2", "SENSEX", storage);
    saveBenchmarkPref(null, "NIFTY500", storage);
    expect(loadBenchmarkPref("p1", storage)).toBe("BANKNIFTY");
    expect(loadBenchmarkPref("p2", storage)).toBe("SENSEX");
    expect(loadBenchmarkPref(null, storage)).toBe("NIFTY500");
  });

  it("ignores invalid/stale stored values", () => {
    storage.setItem("portfolio-analyser:benchmark:p1", "OLD_INDEX");
    expect(loadBenchmarkPref("p1", storage)).toBeNull();
  });

  it("does not persist invalid keys", () => {
    // @ts-expect-error — guard against bad runtime input
    saveBenchmarkPref("p1", "NOT_A_KEY", storage);
    expect(loadBenchmarkPref("p1", storage)).toBeNull();
  });

  it("resolve prefers the per-portfolio pick", () => {
    saveBenchmarkPref(null, "NIFTY500", storage);
    saveBenchmarkPref("p1", "BANKNIFTY", storage);
    expect(resolveBenchmarkPref("p1", storage)).toBe("BANKNIFTY");
  });

  it("resolve falls back to the shared default scope for a new portfolio", () => {
    saveBenchmarkPref(null, "SENSEX", storage);
    expect(resolveBenchmarkPref("brand-new", storage)).toBe("SENSEX");
  });

  it("resolve falls back to the global default key when nothing is stored", () => {
    expect(resolveBenchmarkPref("p1", storage)).toBe(DEFAULT_BENCHMARK_KEY);
    expect(resolveBenchmarkPref(null, storage)).toBe(DEFAULT_BENCHMARK_KEY);
  });

  it("is resilient when storage throws (e.g. disabled/quota)", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    expect(loadBenchmarkPref("p1", throwing)).toBeNull();
    expect(() => saveBenchmarkPref("p1", "SENSEX", throwing)).not.toThrow();
    expect(resolveBenchmarkPref("p1", throwing)).toBe(DEFAULT_BENCHMARK_KEY);
  });
});
