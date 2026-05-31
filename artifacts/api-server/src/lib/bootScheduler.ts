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
