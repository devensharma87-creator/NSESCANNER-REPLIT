/**
 * SSE live-tick stream reducers.
 *
 * The server stores quotes under an exchange-qualified identity
 * (`NSE:EQUITY:RELIANCE`), because 2,280 trading symbols exist on both NSE and
 * BSE. Fixing that server-side is not enough: a client that keys its own state
 * by `symbol` re-collapses the two listings into one row, so the collision
 * simply reappears in browser state.
 *
 * The two stream events arrive keyed DIFFERENTLY:
 *   - `snapshot` is an object keyed by the legacy display alias
 *   - `tick` is a single tick object
 *
 * Both must be reduced onto the SAME key — `canonicalInstrumentId` — or one
 * instrument shows up twice: once under its alias and once under its identity.
 *
 * These reducers are pure so that invariant is unit-testable without a live
 * EventSource.
 */

export interface IdentifiedTick {
  /** Exchange-qualified storage identity. The ONLY valid state key. */
  canonicalInstrumentId: string;
  exchange?: string;
  tradingSymbol?: string;
  /** Legacy display alias. Not unique across exchanges — never use as a key. */
  symbol: string;
  ts: number;
}

/**
 * The state key for a tick, or null if the server did not send an identity
 * (older build). Ticks without an identity are dropped rather than falling
 * back to `symbol`, because that fallback is exactly the collision.
 */
export function tickKey<T extends IdentifiedTick>(t: T | null | undefined): string | null {
  const id = t?.canonicalInstrumentId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * Re-key the `snapshot` payload from legacy alias to canonical identity.
 *
 * Several aliases can point at one instrument (index aliases share a token),
 * so this also collapses them to a single entry.
 */
export function applySnapshot<T extends IdentifiedTick>(
  raw: Record<string, T> | null | undefined,
): Record<string, T> {
  const next: Record<string, T> = {};
  if (!raw || typeof raw !== "object") return next;
  for (const t of Object.values(raw)) {
    const key = tickKey(t);
    if (key == null) continue;
    const existing = next[key];
    // Aliases of one instrument carry the same quote; keep the newest.
    if (existing == null || t.ts >= existing.ts) next[key] = t;
  }
  return next;
}

/** Merge one `tick` event using the same key the snapshot was re-keyed onto. */
export function applyTick<T extends IdentifiedTick>(
  prev: Record<string, T>,
  t: T | null | undefined,
): Record<string, T> {
  const key = tickKey(t);
  if (key == null || t == null) return prev;
  return { ...prev, [key]: t };
}
