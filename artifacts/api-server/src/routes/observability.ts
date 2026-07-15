/**
 * P1 client-side observability endpoint.
 *
 * Accepts a small, opinionated payload from the SPA for "something the
 * user visibly saw" events — e.g. a data-source chip silently degrading
 * from Kite trade-grade to informational fallback mid-session. This is
 * NOT a general logging drain (no full stack traces, no free-form
 * strings), so the surface stays audit-friendly.
 *
 * The endpoint is deliberately public (session-optional). Client events
 * are already user-facing information — hiding them behind auth would
 * only obscure real anomalies for anonymous visitors on the public tabs.
 *
 * Rate limiting: one warn line per (kind, sessionId, subjectId) per
 * minute is enforced client-side in `useUnifiedGradeTelemetry`. The
 * server just clamps the accepted event kinds and payload size.
 */
import { Router } from "express";
import { z } from "zod";
import { logger } from "../lib/logger";
import { recordClientEvent, summariseClientEvents } from "../lib/clientEventBuffer";

const router: Router = Router();

const ChipDowngradeEvent = z.object({
  kind: z.literal("unified_grade_downgrade"),
  chipId: z.string().min(1).max(80),
  fromGrade: z.enum([
    "KITE_TRADE_GRADE",
    "NSE_ARCHIVE",
    "DELAYED_T_PLUS_1",
    "INFO_ONLY",
    "UNAVAILABLE",
    "PROVIDER_NOT_CONFIGURED",
  ]),
  toGrade: z.enum([
    "KITE_TRADE_GRADE",
    "NSE_ARCHIVE",
    "DELAYED_T_PLUS_1",
    "INFO_ONLY",
    "UNAVAILABLE",
    "PROVIDER_NOT_CONFIGURED",
  ]),
  source: z.string().max(32),
  page: z.string().max(160).optional(),
  sessionId: z.string().min(4).max(64).optional(),
  observedAt: z.string().datetime().optional(),
});

const EventBody = z.discriminatedUnion("kind", [ChipDowngradeEvent]);

router.post("/observability/client-event", (req, res) => {
  const parsed = EventBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "invalid_event",
      detail: parsed.error.flatten(),
    });
  }

  const ev = parsed.data;
  // Kite live → INFO_ONLY/UNAVAILABLE is the anomalous case we care about.
  // Other transitions (e.g. UNAVAILABLE → live) are recovery signals,
  // useful but not a warn.
  const isDegradation =
    ev.kind === "unified_grade_downgrade" &&
    (ev.fromGrade === "KITE_TRADE_GRADE" || ev.fromGrade === "NSE_ARCHIVE") &&
    (ev.toGrade === "INFO_ONLY" ||
      ev.toGrade === "UNAVAILABLE" ||
      ev.toGrade === "DELAYED_T_PLUS_1");

  if (isDegradation) {
    logger.warn(
      {
        clientEvent: ev.kind,
        chipId: ev.chipId,
        fromGrade: ev.fromGrade,
        toGrade: ev.toGrade,
        source: ev.source,
        page: ev.page,
        sessionId: ev.sessionId,
        observedAt: ev.observedAt,
      },
      "unified_grade_downgrade observed on client",
    );
  } else {
    // Non-degradation transitions (mostly recoveries) — info tier so
    // ops has a full timeline if they need to correlate.
    logger.info(
      {
        clientEvent: ev.kind,
        chipId: ev.chipId,
        fromGrade: ev.fromGrade,
        toGrade: ev.toGrade,
        source: ev.source,
        sessionId: ev.sessionId,
      },
      "client-side chip transition",
    );
  }

  // Bucketed ring-buffer store for the ops dashboard. Fed synchronously
  // so `/observability/summary` sees the event immediately after 204.
  recordClientEvent({
    kind: ev.kind,
    chipId: ev.chipId,
    fromGrade: ev.fromGrade,
    toGrade: ev.toGrade,
    source: ev.source,
    sessionId: ev.sessionId,
    page: ev.page,
    wasDegradation: isDegradation,
  });

  return res.status(204).end();
});

/**
 * Ops-side summary of client-event volume. Public because the drain
 * itself is public — the summary reveals no user identity, only
 * chipIds + grade transitions + minute-bucketed counts.
 *
 * Query param `since` is ISO datetime; defaults to now − 60 min; hard-
 * capped at 240 min by the buffer to bound response size.
 */
router.get("/observability/summary", (req, res) => {
  const rawSince =
    typeof req.query["since"] === "string" ? req.query["since"] : undefined;
  const defaultSince = new Date(Date.now() - 60 * 60_000).toISOString();
  const summary = summariseClientEvents(rawSince ?? defaultSince);
  return res.json(summary);
});

export default router;
