/**
 * Timestamp-tagged TTL caches for the market-data layer.
 *
 * Every cached entry records when it was stored so the router can re-derive
 * freshness at read time (and so cached reads are honestly tagged source
 * "cache" with the original asOf preserved).
 */

export interface CacheEntry<T> {
  /** epoch ms when stored. */
  storedAt: number;
  value: T;
}

export class TtlCache<T> {
  private readonly map = new Map<string, CacheEntry<T>>();
  constructor(private readonly ttlMs: number) {}

  get(key: string): CacheEntry<T> | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (Date.now() - e.storedAt > this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    return e;
  }

  /** Returns the entry even if expired (caller decides what to do). */
  peek(key: string): CacheEntry<T> | undefined {
    return this.map.get(key);
  }

  set(key: string, value: T): void {
    this.map.set(key, { storedAt: Date.now(), value });
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}
