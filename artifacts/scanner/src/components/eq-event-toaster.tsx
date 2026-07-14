/**
 * Background poller that surfaces every equity-side lifecycle event
 * (BUY_EXECUTED / SL_HIT / TARGET2_HIT / TRAIL_TO_T1 / TIME_STOP /
 * SIGNAL_FLIP / BUY_SKIPPED for manual rejects) as a shadcn toast.
 *
 * Mounting is one-shot from App.tsx — first poll PRIMES with the
 * server's current latestId so we don't replay history (the ring
 * buffer holds 200 events). After that we long-poll every 10s with
 * `since` = the previously-returned latestId.
 *
 * Lives in the equity world only. F&O has its own OptionSignalAlerter.
 */
import { useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL;
const POLL_MS = 10_000;

interface EqEvent {
  id: number;
  ts: number;
  type:
    | "BUY_EXECUTED" | "BUY_SKIPPED" | "SL_HIT" | "TARGET2_HIT"
    | "TRAIL_TO_T1" | "TIME_STOP" | "SIGNAL_FLIP"
    | "MANUAL_BUY" | "MANUAL_CLOSE";
  symbol: string;
  title: string;
  detail?: string;
  source: "auto" | "manual";
  severity: "info" | "success" | "warn" | "error";
}

interface EventResponse {
  events: EqEvent[];
  latestId: number;
}

export function EqEventToaster() {
  const { toast } = useToast();
  const sinceRef = useRef<number>(0);
  const primedRef = useRef<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const res = await fetch(`${BASE}api/paper/events/eq?since=${sinceRef.current}`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as EventResponse;
        if (cancelled) return;
        if (!primedRef.current) {
          // First successful poll — anchor at server latestId so we
          // don't replay the in-memory ring buffer on page-load.
          sinceRef.current = body.latestId;
          primedRef.current = true;
        } else {
          for (const ev of body.events) {
            toast({
              title: ev.title,
              description: ev.detail,
              variant: ev.severity === "error" ? "destructive" : "default",
            });
          }
          if (body.events.length > 0) sinceRef.current = body.latestId;
        }
      } catch {
        // Quiet on network blips — next tick will retry.
      } finally {
        if (!cancelled) timer = setTimeout(tick, POLL_MS);
      }
    }
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [toast]);

  return null;
}
