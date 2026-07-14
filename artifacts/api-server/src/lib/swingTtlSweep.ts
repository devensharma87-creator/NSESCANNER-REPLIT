/**
 * Swing TTL Sweep Scheduler — background expiry for staged swing-cash orders.
 *
 * PROBLEM SOLVED: Without this scheduler, stale staged orders stay active until
 * the owner opens the Swing Cash Queue page — `expireStaleSwingOrders` is called
 * on-read inside `listSwingOrders` / `getSwingOrder`, but never on a timer. If
 * the owner is away for hours, STAGED/APPROVAL_REQUIRED orders pile up past
 * their 8-hour TTL without transitioning to EXPIRED.
 *
 * DESIGN:
 *   - 10-minute interval (`setInterval`, unref'd — never blocks process exit).
 *   - One immediate tick on start (after the boot-stagger delay in app.ts).
 *   - inFlight guard: a slow DB sweep never overlaps the next tick.
 *   - started guard: idempotent — calling `startSwingTtlSweepScheduler()` twice
 *     is a no-op; only one interval runs per process.
 *   - Single-replica assumption (matches other schedulers in this service). The
 *     CAS `WHERE status = prior_status` in `expireStaleSwingOrders` provides
 *     safe multi-worker row-level idempotency.
 *   - Fail-open: a tick error is logged at WARN level, never propagated. The app
 *     never crashes from a sweep failure.
 *   - No Telegram alerts for expiry (policy: log-only, no trade-channel noise).
 *   - Schema migration: `applySwingTtlSchemaColumns()` adds the two additive
 *     nullable columns (`expired_at`, `expiry_reason`) via
 *     `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` — safe on repeated calls, never
 *     drops or alters existing data.
 *
 * ABSOLUTE RULES:
 *   - Swing CASH / equity ONLY. No F&O, no option-chain, no capital-ledger,
 *     no paper-trade imports. Only `swingOrderStaging` + `logger` + DB `sql`.
 *   - Expiry only (no staging, no approval, no broker execution of any kind).
 *   - Missing data → honest MISSED_PNL_UNAVAILABLE (delegated to the library fn).
 */

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { expireStaleSwingOrders, type SwingSweepResult } from "./swingOrderStaging";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** How often the sweep runs once started. */
export const SWEEP_TICK_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// State (in-memory, single-replica)
// ---------------------------------------------------------------------------

export interface SwingTtlSweepState {
  /** ISO timestamp when `startSwingTtlSweepScheduler()` was first called. */
  startedAt: string | null;
  /** ISO timestamp of the last completed tick (null → never swept). */
  lastSweepAt: string | null;
  /** How many orders were found stale in the last tick. */
  lastSweepScanned: number;
  /** How many orders were successfully expired in the last tick. */
  lastSweepExpired: number;
  /** Wall-clock duration of the last tick in milliseconds. */
  lastSweepDurationMs: number;
  /** Error message from the last tick if it failed; null on success. */
  lastSweepError: string | null;
  /** Running total of orders expired since process start. */
  totalExpiredSinceStart: number;
  /** Number of completed ticks since process start. */
  sweepCount: number;
  /** Tick interval in ms. */
  tickMs: number;
}

const _state: SwingTtlSweepState = {
  startedAt: null,
  lastSweepAt: null,
  lastSweepScanned: 0,
  lastSweepExpired: 0,
  lastSweepDurationMs: 0,
  lastSweepError: null,
  totalExpiredSinceStart: 0,
  sweepCount: 0,
  tickMs: SWEEP_TICK_MS,
};

let _started = false;
let _inFlight = false;

/** Returns a snapshot of the current sweep state (safe to serialise as JSON). */
export function getSwingTtlSweepState(): SwingTtlSweepState {
  return { ..._state };
}

// ---------------------------------------------------------------------------
// Schema migration (additive only, applied once at boot)
// ---------------------------------------------------------------------------

/**
 * Add the two TTL audit columns to `swing_order_staging` if they do not already
 * exist. Safe to call repeatedly — `ADD COLUMN IF NOT EXISTS` is idempotent.
 * Fail-open: any error is logged at WARN level; the app never crashes.
 *
 * NOT drizzle-kit push — push wants to DROP out-of-schema tables in this repo.
 */
export async function applySwingTtlSchemaColumns(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE swing_order_staging
      ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS expiry_reason TEXT
  `);
}

// ---------------------------------------------------------------------------
// Core sweep logic (exported for tests and manual trigger routes)
// ---------------------------------------------------------------------------

/**
 * Run one TTL sweep: expire all active staged orders (across ALL owners) whose
 * TTL has passed. Returns a summary of what was found and expired.
 *
 * Exported for:
 *   - `POST /swing/ttl-sweep/run-now` (manual owner trigger)
 *   - Tests (deterministic, injecting `now`)
 *   - The periodic interval tick (internal)
 */
export async function runSwingTtlSweepOnce(
  opts: { now?: Date } = {},
): Promise<SwingSweepResult & { durationMs: number }> {
  const now = opts.now ?? new Date();
  const start = Date.now();
  const result = await expireStaleSwingOrders(null, {
    now,
    expiryReason: "TTL_EXPIRED",
  });
  const durationMs = Date.now() - start;
  return { ...result, durationMs };
}

// ---------------------------------------------------------------------------
// Interval tick (internal — not exported)
// ---------------------------------------------------------------------------

async function _tick(): Promise<void> {
  if (_inFlight) return;
  _inFlight = true;
  const now = new Date();
  try {
    const result = await runSwingTtlSweepOnce({ now });
    _state.lastSweepAt = now.toISOString();
    _state.lastSweepScanned = result.scanned;
    _state.lastSweepExpired = result.expired;
    _state.lastSweepDurationMs = result.durationMs;
    _state.lastSweepError = null;
    _state.totalExpiredSinceStart += result.expired;
    _state.sweepCount++;
    if (result.expired > 0) {
      logger.info(
        {
          expired: result.expired,
          scanned: result.scanned,
          durationMs: result.durationMs,
        },
        "swing TTL sweep: expired stale staged orders",
      );
    } else {
      logger.debug(
        { scanned: result.scanned, durationMs: result.durationMs },
        "swing TTL sweep: tick complete, no stale orders",
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    _state.lastSweepError = msg;
    logger.warn({ err: msg }, "swing TTL sweep tick failed (fail-open)");
  } finally {
    _inFlight = false;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start the background TTL sweep scheduler.
 *
 * Idempotent — safe to call multiple times; only the first call starts the
 * interval. Subsequent calls are silent no-ops.
 *
 * Contract:
 *   - Non-blocking: returns immediately.
 *   - Runs one immediate tick (to expire any orders stale from before boot).
 *   - Then sweeps every `SWEEP_TICK_MS` (10 minutes) in the background.
 *   - Unref'd interval — never prevents process exit.
 *   - Fail-open: tick errors are logged, never propagated.
 *   - Applies the `expired_at`/`expiry_reason` schema columns on startup.
 */
export function startSwingTtlSweepScheduler(): void {
  if (_started) return;
  _started = true;
  _state.startedAt = new Date().toISOString();

  // Additive schema migration first, then immediate tick.  The tick must not
  // run until the migration resolves or rejects — it SELECT-s the new columns
  // and will fail with "column does not exist" on a fresh deployment otherwise.
  void applySwingTtlSchemaColumns()
    .catch((err: unknown) => {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "swing TTL sweep: schema column migration failed (fail-open, columns may not exist yet)",
      );
    })
    .then(() => {
      // Immediate tick: expire any orders that went stale before this process started.
      void _tick();
    });

  // Periodic sweep.
  const t = setInterval(() => {
    void _tick();
  }, SWEEP_TICK_MS);
  t.unref?.();

  logger.info(
    { tickMs: SWEEP_TICK_MS },
    "swing TTL sweep scheduler started (all-owners expiry, 10-min interval)",
  );
}

// ---------------------------------------------------------------------------
// Test helpers (only use in test files — reset module-level state)
// ---------------------------------------------------------------------------

/** @internal Reset module state for unit tests that need a clean slate. */
export function __resetSwingTtlSweepForTests(): void {
  _started = false;
  _inFlight = false;
  _state.startedAt = null;
  _state.lastSweepAt = null;
  _state.lastSweepScanned = 0;
  _state.lastSweepExpired = 0;
  _state.lastSweepDurationMs = 0;
  _state.lastSweepError = null;
  _state.totalExpiredSinceStart = 0;
  _state.sweepCount = 0;
}
