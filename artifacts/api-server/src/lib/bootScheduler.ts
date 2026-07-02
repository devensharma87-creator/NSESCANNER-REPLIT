import type { DbPoolStats } from "@workspace/db";
import { logger } from "./logger";

/**
 * Boot-stagger offsets (ms) for heavy background subsystems.
 *
 * W6-P4A: at cold autoscale boot, several background jobs used to start in the
 * same tick and contend for the shared 10-connection DB pool, surfacing as
 * transient "Connection terminated due to connection timeout" warnings. These
 * offsets spread the *initial* start of each subsystem across the cold-start
 * window. They delay ONLY the first start — each subsystem's own periodic
 * interval/cadence (preset scheduler 30s tick, instFlows 15-min refresh, OI
 * lookback window) is unchanged once started.
 */
export const BOOT_STAGGER_MS = {
  globalDataPump: 15_000,
  presetScheduler: 25_000,
  kiteWarmup: 40_000,
  instFlowsRefresher: 60_000,
} as const;

/**
 * Schedule a one-shot background boot job to run after `delayMs`.
 *
 * Contract:
 * - Non-blocking: returns immediately (a timer handle), so server startup is
 *   never delayed.
 * - Fail-open: any error thrown or rejected by `fn` is caught and logged at
 *   warn level, never propagated (a failing boot job can never crash the app).
 * - Observable: logs when the job is scheduled and when it starts.
 */
export function scheduleBootJob(
  label: string,
  delayMs: number,
  fn: () => void | Promise<void>,
): NodeJS.Timeout {
  logger.info({ job: label, delayMs }, "boot job scheduled (staggered)");
  return setTimeout(() => {
    void (async () => {
      try {
        await fn();
        logger.info({ job: label, delayMs }, "boot job started");
      } catch (err) {
        logger.warn({ job: label, err }, "boot job failed at start (fail-open)");
      }
    })();
  }, delayMs);
}

/**
 * Post-boot DB pool observability snapshots (ms after boot).
 *
 * W6-P4B5: three read-only snapshots bracket the W6-P4A stagger window so the
 * operator can see whether cold-start pool contention is actually gone before
 * deciding to stagger more jobs:
 *   - 30s  — after global-data-pump (15s) + preset-scheduler (25s) have started
 *   - 75s  — after inst-flows-refresher (60s) has started
 *   - 120s — steady state
 * These only READ in-memory pool counters; they never query, never acquire a
 * connection, and never change pool config or cadence.
 */
export const POOL_STATS_LOG_DELAYS_MS = [30_000, 75_000, 120_000] as const;

/**
 * Log a one-shot, read-only snapshot of DB pool utilization.
 *
 * Contract:
 * - Never queries the DB or acquires a connection — `getStats` only reads the
 *   pool's in-memory counters.
 * - Never leaks secrets: only the four numeric counters are logged, never the
 *   pool options/connection string.
 * - Fail-open: logs an "unavailable" line if stats are null and swallows any
 *   throw, so it can never crash the process.
 */
export function logDbPoolStats(
  label: string,
  getStats: () => DbPoolStats | null,
): void {
  try {
    const stats = getStats();
    if (stats == null) {
      logger.info({ label }, "post-boot db pool stats unavailable");
      return;
    }
    logger.info(
      {
        label,
        total: stats.total,
        idle: stats.idle,
        waiting: stats.waiting,
        max: stats.max,
        uptimeSec: Math.round(process.uptime()),
      },
      "post-boot db pool stats",
    );
  } catch (err) {
    logger.warn({ label, err }, "post-boot db pool stats log failed (fail-open)");
  }
}

/**
 * Schedule a one-shot, non-blocking pool-stats snapshot `delayMs` after boot.
 * Returns the timer handle (clearable). Never blocks startup.
 */
export function scheduleDbPoolStatsLog(
  label: string,
  delayMs: number,
  getStats: () => DbPoolStats | null,
): NodeJS.Timeout {
  return setTimeout(() => logDbPoolStats(label, getStats), delayMs);
}
