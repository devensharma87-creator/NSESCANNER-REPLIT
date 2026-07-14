/**
 * Cross-provider validation counters — in-memory, IST-day-scoped (single replica,
 * same pattern as the swing-scanner store). Feeds the diagnostics surface so the
 * owner can see how often Kite/INDstocks agreed, diverged, conflicted, or how
 * often INDstocks served a failover — without any DB writes.
 *
 * Counters reset automatically when the IST date rolls over.
 */

import type { CrossVerdict } from "./sourceValidation";

export interface ValidationDayStats {
  istDate: string;
  matched: number;
  warning: number;
  conflict: number;
  failovers: number;
  validations: number;
  lastValidationAt: string | null;
  lastFailoverAt: string | null;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Current IST calendar date (YYYY-MM-DD). */
export function istDate(nowMs: number = Date.now()): string {
  return new Date(nowMs + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function freshDay(date: string): ValidationDayStats {
  return {
    istDate: date,
    matched: 0,
    warning: 0,
    conflict: 0,
    failovers: 0,
    validations: 0,
    lastValidationAt: null,
    lastFailoverAt: null,
  };
}

let day: ValidationDayStats = freshDay(istDate());

function rollIfNeeded(nowMs: number): void {
  const d = istDate(nowMs);
  if (d !== day.istDate) day = freshDay(d);
}

/** Record a completed cross-provider validation. */
export function recordValidation(verdict: CrossVerdict, nowMs: number = Date.now()): void {
  rollIfNeeded(nowMs);
  day.validations += 1;
  day.lastValidationAt = new Date(nowMs).toISOString();
  if (verdict === "MATCHED") day.matched += 1;
  else if (verdict === "WARNING") day.warning += 1;
  else day.conflict += 1;
}

/** Record an INDstocks failover (Kite was unavailable). */
export function recordFailover(nowMs: number = Date.now()): void {
  rollIfNeeded(nowMs);
  day.failovers += 1;
  day.lastFailoverAt = new Date(nowMs).toISOString();
}

/** Snapshot of today's counters (no I/O). */
export function getValidationStats(nowMs: number = Date.now()): ValidationDayStats {
  rollIfNeeded(nowMs);
  return { ...day };
}

/** Test helper — reset counters. */
export function __resetValidationStatsForTests(): void {
  day = freshDay(istDate());
}
