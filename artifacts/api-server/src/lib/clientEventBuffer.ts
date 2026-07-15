/**
 * In-process ring buffer for client-side observability events.
 *
 * Fed by `POST /api/observability/client-event`, drained by
 * `GET /api/observability/summary?since=<iso>`. Deliberately in-memory
 * only — no persistence — because chip-downgrade events are useful for
 * "what happened in the last hour" ops queries, not long-term forensics
 * (pino WARN log is the durable trail for that).
 *
 * Guarantees:
 *
 *   • Hard cap on stored events (see MAX_EVENTS). Newest wins.
 *   • Summary output is bucketed by 60s IST wall-clock so the "5min
 *     spike" visual reads honestly.
 *   • The buffer is process-local — a horizontally scaled deployment
 *     would need to move this to Redis. Called out in ops docs.
 */

export interface RecordedClientEvent {
  observedAt: number;             // epoch ms — server-received time
  kind: "unified_grade_downgrade";
  chipId: string;
  fromGrade: string;
  toGrade: string;
  source: string;
  sessionId: string | undefined;
  page: string | undefined;
  /** Server-side flag: true iff this was a Kite-live degradation. */
  wasDegradation: boolean;
}

export interface ClientEventBucket {
  /** IST minute bucket start in ISO (e.g. 2026-07-15T09:30:00+05:30). */
  bucketStart: string;
  /** Total events in this minute. */
  total: number;
  /** Kite-live → informational transitions (the interesting subset). */
  degradations: number;
  /** Any recovery events (INFO_ONLY → KITE_TRADE_GRADE etc). */
  recoveries: number;
}

export interface ClientEventSummary {
  windowStart: string;            // ISO IST, aligned to :00
  windowEnd: string;
  bucketCount: number;
  totalEvents: number;
  totalDegradations: number;
  totalRecoveries: number;
  buckets: ClientEventBucket[];
  /** Top-5 chipIds by degradation count in the window (descending). */
  topDegradingChips: Array<{ chipId: string; degradations: number }>;
}

const MAX_EVENTS = 5000;          // ~1h @ ~1/s including bursts
const WINDOW_MAX_MINUTES = 240;   // absolute cap on any `since` query

const ring: RecordedClientEvent[] = [];

export function recordClientEvent(ev: Omit<RecordedClientEvent, "observedAt"> & { observedAt?: number }): void {
  ring.push({
    ...ev,
    observedAt: ev.observedAt ?? Date.now(),
  });
  if (ring.length > MAX_EVENTS) {
    ring.splice(0, ring.length - MAX_EVENTS);
  }
}

/** Test-only reset. Not exported from a barrel — reach in directly. */
export function _resetClientEventBuffer(): void {
  ring.length = 0;
}

function toIstBucketStart(epochMs: number): string {
  // Round down to the minute in UTC — the ISO-formatted string carries
  // the +05:30 offset so client-side parsing lands on IST cleanly.
  const minuteMs = 60_000;
  const floored = Math.floor(epochMs / minuteMs) * minuteMs;
  // Build "+05:30"-suffixed ISO. Base UTC ISO, then rewrite offset.
  const utcIso = new Date(floored).toISOString();
  // "2026-07-15T09:30:00.000Z" → "2026-07-15T15:00:00+05:30" (shifted view).
  // Simpler: shift the epoch by IST offset first, format naively, then
  // append the offset.
  const shifted = new Date(floored + 5.5 * 60 * 60_000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  const hh = String(shifted.getUTCHours()).padStart(2, "0");
  const mm = String(shifted.getUTCMinutes()).padStart(2, "0");
  void utcIso; // silence "unused" — kept for future audit trail
  return `${y}-${m}-${d}T${hh}:${mm}:00+05:30`;
}

export function summariseClientEvents(sinceIso: string): ClientEventSummary {
  const now = Date.now();
  const sinceMs = Date.parse(sinceIso);
  const safeSinceMs = Number.isFinite(sinceMs)
    ? Math.max(sinceMs, now - WINDOW_MAX_MINUTES * 60_000)
    : now - 60 * 60_000;

  const inWindow = ring.filter((e) => e.observedAt >= safeSinceMs && e.observedAt <= now);
  const bucketMap = new Map<string, ClientEventBucket>();
  const chipCounts = new Map<string, number>();
  let totalDegradations = 0;
  let totalRecoveries = 0;

  for (const ev of inWindow) {
    const key = toIstBucketStart(ev.observedAt);
    const b = bucketMap.get(key) ?? {
      bucketStart: key,
      total: 0,
      degradations: 0,
      recoveries: 0,
    };
    b.total += 1;
    if (ev.wasDegradation) {
      b.degradations += 1;
      totalDegradations += 1;
      chipCounts.set(ev.chipId, (chipCounts.get(ev.chipId) ?? 0) + 1);
    } else if (ev.toGrade === "KITE_TRADE_GRADE") {
      b.recoveries += 1;
      totalRecoveries += 1;
    }
    bucketMap.set(key, b);
  }

  const buckets = Array.from(bucketMap.values()).sort((a, b) =>
    a.bucketStart < b.bucketStart ? -1 : a.bucketStart > b.bucketStart ? 1 : 0,
  );

  const topDegradingChips = Array.from(chipCounts.entries())
    .map(([chipId, degradations]) => ({ chipId, degradations }))
    .sort((a, b) => b.degradations - a.degradations)
    .slice(0, 5);

  return {
    windowStart: toIstBucketStart(safeSinceMs),
    windowEnd: toIstBucketStart(now),
    bucketCount: buckets.length,
    totalEvents: inWindow.length,
    totalDegradations,
    totalRecoveries,
    buckets,
    topDegradingChips,
  };
}
