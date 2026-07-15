/**
 * useUnifiedGradeTelemetry — React hook wired into `UnifiedGradeChip`.
 *
 * When a chip's derived grade CHANGES between renders, the hook
 * post-emits a `unified_grade_downgrade` event to
 * `/api/observability/client-event`. The server treats Kite-live →
 * informational transitions as warn-tier (an anomaly the trader
 * should notice); other transitions land as info-tier for a full
 * timeline.
 *
 * Design principles:
 *
 * 1. **No visual side-effects.** Rendering is unchanged whether the
 *    hook fires or not.
 * 2. **Rate-limited at source.** Same chip + same (from,to) transition
 *    within one minute is coalesced. Prevents flapping-source loops
 *    from spamming the drain.
 * 3. **Fire-and-forget.** `keepalive: true` + no `await`. Failures are
 *    swallowed — client telemetry must never break the UI.
 * 4. **First-render suppression.** The initial mount is not a
 *    "transition" — we only emit when a grade meaningfully changes.
 */
import { useEffect, useRef } from "react";
import type { HomeUnifiedGrade } from "@/lib/homeMarketPulseSourceMap";

type SentKey = `${string}::${HomeUnifiedGrade}->${HomeUnifiedGrade}`;

const DEDUP_WINDOW_MS = 60_000;

/**
 * Cross-hook dedup memory. Keyed by `chipId::from->to`. Value is the
 * epoch-ms of the last emission. Lives on `window` so multiple
 * `UnifiedGradeChip` instances share the same rate-limit budget.
 */
function getStore(): Map<SentKey, number> {
  if (typeof window === "undefined") return new Map();
  const w = window as unknown as { __ugcTelemetry?: Map<SentKey, number> };
  if (!w.__ugcTelemetry) w.__ugcTelemetry = new Map();
  return w.__ugcTelemetry;
}

/** Get or lazily create a stable session identifier for this tab. */
function sessionId(): string {
  if (typeof window === "undefined") return "ssr";
  const w = window as unknown as { __ugcSession?: string };
  if (w.__ugcSession) return w.__ugcSession;
  w.__ugcSession = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return w.__ugcSession;
}

export function useUnifiedGradeTelemetry(args: {
  chipId: string;
  grade: HomeUnifiedGrade;
  source: string;
}): void {
  const prevRef = useRef<HomeUnifiedGrade | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = args.grade;

    // First render: no prior grade → nothing to emit.
    if (prev == null) return;
    if (prev === args.grade) return;

    const key: SentKey = `${args.chipId}::${prev}->${args.grade}`;
    const store = getStore();
    const now = Date.now();
    const last = store.get(key);
    if (last != null && now - last < DEDUP_WINDOW_MS) return;
    store.set(key, now);

    const body = JSON.stringify({
      kind: "unified_grade_downgrade" as const,
      chipId: args.chipId,
      fromGrade: prev,
      toGrade: args.grade,
      source: args.source,
      page: typeof location !== "undefined" ? location.pathname : undefined,
      sessionId: sessionId(),
      observedAt: new Date().toISOString(),
    });

    try {
      // Prefer `sendBeacon` when available — survives page unload.
      const nav =
        typeof navigator !== "undefined"
          ? (navigator as unknown as { sendBeacon?: (u: string, b: BodyInit) => boolean })
          : undefined;
      if (nav?.sendBeacon) {
        const ok = nav.sendBeacon(
          "/api/observability/client-event",
          new Blob([body], { type: "application/json" }),
        );
        if (ok) return;
      }
      void fetch("/api/observability/client-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
        credentials: "same-origin",
      }).catch(() => {
        /* fire-and-forget; UI must never break on telemetry failure */
      });
    } catch {
      /* swallow — telemetry is best-effort */
    }
  }, [args.chipId, args.grade, args.source]);
}
