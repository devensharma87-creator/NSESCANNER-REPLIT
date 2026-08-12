/**
 * RingBuffer — a strictly bounded, fixed-capacity circular buffer with
 * O(1) append and O(1) eviction of the oldest entry.
 *
 * Phase 0.5C. Replaces the previous `Array.shift()` / `Array.splice(0, n)`
 * trimming strategy, which moved every retained element on each append
 * once the buffer reached capacity — O(n) per incoming tick.
 *
 * Design notes:
 *   • Storage is preallocated to `capacity` once, at construction. Memory
 *     is therefore bounded and predictable for the lifetime of the buffer;
 *     no reallocation is ever proportional to retained history.
 *   • `head` is the physical index of the OLDEST retained entry.
 *   • `count` is the number of retained entries: 0 <= count <= capacity.
 *   • The write position is derived as `(head + count) % capacity`, so
 *     append never scans, copies or moves existing entries.
 *   • Reads always yield oldest-to-newest order.
 *
 * This is diagnostic/replay infrastructure. It is NOT historical candle
 * storage, NOT official closing-price storage, and must never be used to
 * fabricate technical indicators or to prove a quote is currently live.
 *
 * Pure data structure: no I/O, no timers, no provider calls, no database.
 */

export class RingBuffer<T> {
  private readonly buf: Array<T | undefined>;
  /** Physical index of the oldest retained entry. */
  private head = 0;
  /** Number of retained entries. Invariant: 0 <= count <= capacity. */
  private count = 0;

  readonly capacity: number;

  constructor(capacity: number) {
    if (!Number.isFinite(capacity)) {
      throw new RangeError("RingBuffer capacity must be a finite number");
    }
    if (!Number.isInteger(capacity)) {
      throw new RangeError("RingBuffer capacity must be an integer");
    }
    if (capacity < 1) {
      throw new RangeError("RingBuffer capacity must be >= 1");
    }
    this.capacity = capacity;
    // Preallocated, bounded storage. Never grows.
    this.buf = new Array<T | undefined>(capacity).fill(undefined);
  }

  /** Number of retained entries. */
  get size(): number {
    return this.count;
  }

  get isEmpty(): boolean {
    return this.count === 0;
  }

  get isFull(): boolean {
    return this.count === this.capacity;
  }

  /**
   * O(1) append. When the buffer is full this overwrites exactly one
   * entry — the oldest — and advances the head. Retained size never
   * exceeds `capacity`.
   */
  push(item: T): void {
    const cap = this.capacity;
    const writeIdx = this.head + this.count >= cap
      ? this.head + this.count - cap
      : this.head + this.count;
    this.buf[writeIdx] = item;
    if (this.count === cap) {
      // Full: the slot we just wrote WAS the oldest entry's slot, so the
      // new oldest is the next one along.
      this.head = this.head + 1 >= cap ? 0 : this.head + 1;
    } else {
      this.count++;
    }
  }

  /** The oldest retained entry, or undefined when empty. O(1). */
  peekOldest(): T | undefined {
    return this.count === 0 ? undefined : this.buf[this.head];
  }

  /** The newest retained entry, or undefined when empty. O(1). */
  peekNewest(): T | undefined {
    if (this.count === 0) return undefined;
    const idx = this.head + this.count - 1;
    return this.buf[idx >= this.capacity ? idx - this.capacity : idx];
  }

  /**
   * Evict the oldest entry. O(1). Returns it, or undefined when empty.
   * The vacated slot is cleared so the buffer never retains a strong
   * reference to an evicted payload.
   */
  dropOldest(): T | undefined {
    if (this.count === 0) return undefined;
    const idx = this.head;
    const item = this.buf[idx];
    this.buf[idx] = undefined;
    this.head = idx + 1 >= this.capacity ? 0 : idx + 1;
    this.count--;
    return item;
  }

  /**
   * Logical accessor: index 0 is the oldest retained entry. O(1).
   * Returns undefined when out of range.
   */
  at(i: number): T | undefined {
    if (!Number.isInteger(i) || i < 0 || i >= this.count) return undefined;
    const idx = this.head + i;
    return this.buf[idx >= this.capacity ? idx - this.capacity : idx];
  }

  /**
   * Materialise every retained entry, oldest-to-newest, into a NEW array.
   * O(n) by necessity. Callers may freely mutate the returned array —
   * internal storage is unreachable from it.
   */
  toArray(): T[] {
    const out = new Array<T>(this.count);
    const cap = this.capacity;
    let idx = this.head;
    for (let i = 0; i < this.count; i++) {
      out[i] = this.buf[idx] as T;
      idx = idx + 1 >= cap ? 0 : idx + 1;
    }
    return out;
  }

  /**
   * Single-pass filtered materialisation, oldest-to-newest. Avoids
   * building a full intermediate copy before filtering. O(n) reads,
   * output bounded by the number of matches.
   */
  filterToArray(predicate: (item: T) => boolean): T[] {
    const out: T[] = [];
    const cap = this.capacity;
    let idx = this.head;
    for (let i = 0; i < this.count; i++) {
      const item = this.buf[idx] as T;
      if (predicate(item)) out.push(item);
      idx = idx + 1 >= cap ? 0 : idx + 1;
    }
    return out;
  }

  /**
   * Return to a valid empty state and release every retained reference
   * so evicted payloads can be collected.
   */
  clear(): void {
    this.buf.fill(undefined);
    this.head = 0;
    this.count = 0;
  }
}
