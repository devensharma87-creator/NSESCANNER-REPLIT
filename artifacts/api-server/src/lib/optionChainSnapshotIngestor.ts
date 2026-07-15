/**
 * Option-chain snapshot ingestor (Priority 3 — write-only data layer).
 *
 * Periodically pulls option chains for the active F&O index universe
 * (NIFTY / BANKNIFTY / SENSEX — same set as `OPTION_INDICES` in
 * `optionSignals.ts` and `FNO_INDICES` in `oiLab.ts`) and persists
 * one row per (underlying, expiry, strike, side, captured_at) to
 * `option_chain_snapshot`. One run-summary row per cycle to
 * `option_chain_snapshot_run`.
 *
 * **Strict scope guarantees:**
 *   - Read path only from `fetchOptionChain()` — does NOT touch the
 *     F&O signal pipeline, paper-trader, scoring, Kite order placement,
 *     swing scanner, or the OI-Lab in-memory tracker.
 *   - Write path only inserts into the two new snapshot tables.
 *   - Nothing in this module is consumed by any trading decision.
 *
 * Configuration (env, with safe defaults):
 *   - `OPTION_SNAPSHOT_ENABLED`          — explicit override
 *                                          ("1"/"true"/"yes"/"on" → on,
 *                                          anything else → off; if unset,
 *                                          auto-detect: enabled iff
 *                                          `REPLIT_DEPLOYMENT === "1"`).
 *   - `OPTION_SNAPSHOT_INTERVAL_MIN`     — bucket / cadence (default 5).
 *   - `OPTION_SNAPSHOT_STRIKE_WINDOW`    — ATM ± N strikes (default 10).
 *   - `OPTION_SNAPSHOT_RETENTION_DAYS`   — daily retention sweep (default 825,
 *                                          ≈ 27 months). Long by design: these
 *                                          snapshots are the substrate for a
 *                                          future FAITHFUL 2-year Backtest-Lab
 *                                          replay, so the sweep must NOT purge
 *                                          history inside that window. Lower it
 *                                          via env only if storage is a concern.
 *   - `OPTION_SNAPSHOT_EXPIRIES`         — number of expiries from the
 *                                          front (default 2 — current +
 *                                          next).
 */

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  optionChainSnapshotTable,
  optionChainSnapshotRunTable,
  type NewOptionChainSnapshotRow,
} from "@workspace/db/schema";
import { logger } from "./logger";
import { fetchOptionChain } from "./optionChain";
import type { OcResponse, OcSide } from "./optionChain";
import { computeMarketStatus } from "./marketEvents";

// ───────────── Universe ─────────────
// Mirror `FNO_INDICES` exactly. Do NOT silently expand to FINNIFTY /
// MIDCPNIFTY / NIFTYNXT50 — those are explicitly denylisted in oiLab.ts
// and adding them here would (a) widen the data footprint and (b) drift
// from the trading-side universe, which the user has been clear about.
export const SNAPSHOT_INDICES = ["NIFTY", "BANKNIFTY", "SENSEX"] as const;
export type SnapshotIndex = (typeof SNAPSHOT_INDICES)[number];

// ───────────── Config ─────────────
const TRUTHY = new Set(["1", "true", "yes", "on"]);
const FALSY = new Set(["0", "false", "no", "off"]);

export function isOptionSnapshotEnabled(): boolean {
  const raw = process.env["OPTION_SNAPSHOT_ENABLED"];
  if (raw != null && raw.length > 0) {
    const v = raw.trim().toLowerCase();
    if (TRUTHY.has(v)) return true;
    if (FALSY.has(v)) return false;
    return false; // unrecognised → fail closed
  }
  return process.env["REPLIT_DEPLOYMENT"] === "1";
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function getSnapshotConfig(): {
  intervalMinutes: number;
  strikeWindow: number;
  retentionDays: number;
  expiriesPerUnderlying: number;
} {
  return {
    intervalMinutes: intEnv("OPTION_SNAPSHOT_INTERVAL_MIN", 5, 1, 60),
    strikeWindow: intEnv("OPTION_SNAPSHOT_STRIKE_WINDOW", 10, 1, 50),
    retentionDays: intEnv("OPTION_SNAPSHOT_RETENTION_DAYS", 825, 1, 1100),
    expiriesPerUnderlying: intEnv("OPTION_SNAPSHOT_EXPIRIES", 2, 1, 6),
  };
}

// ───────────── Pure helpers (exported for tests) ─────────────

/**
 * Round a wall-clock timestamp down to the nearest `intervalMinutes`
 * bucket. Used as `captured_at` so multiple ingestion attempts within
 * the same bucket UPSERT the same row instead of duplicating.
 *
 * Examples (5-min bucket):
 *   10:03:14 → 10:00:00
 *   10:07:59 → 10:05:00
 */
export function bucketTimestamp(now: Date, intervalMinutes: number): Date {
  const ms = intervalMinutes * 60_000;
  return new Date(Math.floor(now.getTime() / ms) * ms);
}

/**
 * Pick the strikes from the chain that lie within ±`window` strikes of
 * ATM. Operates on the chain's existing `rows` (already strike-sorted by
 * `fetchOptionChain`) — does NOT widen or narrow what the broker
 * returned, only filters.
 */
export function selectStrikesAroundAtm<T extends { strike: number }>(
  rows: ReadonlyArray<T>,
  atmStrike: number,
  window: number,
): T[] {
  if (rows.length === 0) return [];
  // sort by abs distance from ATM, then take 2*window+1 closest, then
  // re-sort by strike for stable storage order
  const closest = [...rows]
    .sort((a, b) => Math.abs(a.strike - atmStrike) - Math.abs(b.strike - atmStrike))
    .slice(0, window * 2 + 1);
  closest.sort((a, b) => a.strike - b.strike);
  return closest;
}

/** Coerce numeric → drizzle-numeric string (rounded to 4dp); null when absent. */
function numStr(n: number | null | undefined, dp = 2): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  return n.toFixed(dp);
}

/** Coerce numeric → integer; null when absent. */
function intOrNull(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.trunc(n);
}

/**
 * Flatten one option chain into an array of insert rows, one per leg
 * within the ATM window. Pure — exported for tests.
 */
export function flattenChainToRows(
  chain: OcResponse,
  capturedAt: Date,
  strikeWindow: number,
): NewOptionChainSnapshotRow[] {
  const atm = chain.atmStrike ?? 0;
  if (atm <= 0) return [];
  const window = selectStrikesAroundAtm(chain.rows, atm, strikeWindow);
  const out: NewOptionChainSnapshotRow[] = [];
  const spotStr = numStr(chain.spot);
  const atmStr = numStr(atm);

  for (const r of window) {
    for (const side of ["CE", "PE"] as const) {
      const leg: OcSide | undefined = side === "CE" ? r.ce : r.pe;
      if (!leg) continue;
      const bid = leg.bid;
      const ask = leg.ask;
      const spread = bid != null && ask != null && Number.isFinite(bid) && Number.isFinite(ask)
        ? Math.max(0, ask - bid)
        : null;
      out.push({
        underlying: chain.underlying,
        expiry: chain.expiry,
        strike: r.strike.toFixed(2),
        optType: side,
        capturedAt,
        tradingsymbol: null,
        instrumentToken: null,
        spot: spotStr,
        atmStrike: atmStr,
        ltp: numStr(leg.ltp),
        open: null,
        high: null,
        low: null,
        close: null,
        volume: intOrNull(leg.volume),
        oi: intOrNull(leg.oi),
        oiChange: intOrNull(leg.chgOi),
        iv: numStr(leg.iv),
        bid: numStr(bid),
        ask: numStr(ask),
        bidQty: intOrNull(leg.bidQty),
        askQty: intOrNull(leg.askQty),
        spread: numStr(spread),
        depthSummary: null,
        delta: numStr(leg.delta, 4),
        gamma: numStr(leg.gamma, 6),
        theta: numStr(leg.theta, 4),
        vega: numStr(leg.vega, 4),
        source: chain.source ?? "unknown",
      });
    }
  }
  return out;
}

// ───────────── DB writes ─────────────

/** Idempotent bulk upsert. Returns number of rows attempted (DB-driver
 *  level — we don't differentiate inserts from updates here). */
async function upsertRows(rows: NewOptionChainSnapshotRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  // 500-row batch keeps each statement well under PG parameter limits
  // (~13 params per row × 500 = 6500, within the 32k cap).
  const BATCH = 500;
  let total = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    await db
      .insert(optionChainSnapshotTable)
      .values(slice)
      .onConflictDoUpdate({
        target: [
          optionChainSnapshotTable.underlying,
          optionChainSnapshotTable.expiry,
          optionChainSnapshotTable.strike,
          optionChainSnapshotTable.optType,
          optionChainSnapshotTable.capturedAt,
        ],
        set: {
          ltp: sql`excluded.ltp`,
          volume: sql`excluded.volume`,
          oi: sql`excluded.oi`,
          oiChange: sql`excluded.oi_change`,
          iv: sql`excluded.iv`,
          bid: sql`excluded.bid`,
          ask: sql`excluded.ask`,
          bidQty: sql`excluded.bid_qty`,
          askQty: sql`excluded.ask_qty`,
          spread: sql`excluded.spread`,
          delta: sql`excluded.delta`,
          gamma: sql`excluded.gamma`,
          theta: sql`excluded.theta`,
          vega: sql`excluded.vega`,
          spot: sql`excluded.spot`,
          atmStrike: sql`excluded.atm_strike`,
          source: sql`excluded.source`,
        },
      });
    total += slice.length;
  }
  return total;
}

// ───────────── Run loop ─────────────

interface RunResult {
  underlyingsAttempted: number;
  underlyingsOk: number;
  expiriesCovered: number;
  rowsWritten: number;
  errors: Array<{ underlying: string; expiry?: string; message: string }>;
  source: string;
  startedAt: Date;
  finishedAt: Date;
}

/**
 * One ingestion cycle. Public for the diagnostic endpoint to optionally
 * trigger a manual capture (owner-only).
 */
export async function runIngestionTick(opts?: { force?: boolean }): Promise<RunResult> {
  const startedAt = new Date();
  const cfg = getSnapshotConfig();
  const capturedAt = bucketTimestamp(startedAt, cfg.intervalMinutes);

  const errors: RunResult["errors"] = [];
  let okCount = 0;
  let totalRows = 0;
  let expiryCount = 0;
  const seenSources = new Set<string>();
  const force = opts?.force === true;

  if (!force && computeMarketStatus(startedAt) !== "open") {
    const finishedAt = new Date();
    return {
      underlyingsAttempted: 0,
      underlyingsOk: 0,
      expiriesCovered: 0,
      rowsWritten: 0,
      errors: [{ underlying: "*", message: "market_closed" }],
      source: "none",
      startedAt,
      finishedAt,
    };
  }

  for (const underlying of SNAPSHOT_INDICES) {
    let firstChain: OcResponse | null = null;
    try {
      firstChain = await fetchOptionChain(underlying);
    } catch (err) {
      errors.push({ underlying, message: (err as Error).message });
      continue;
    }
    if (!firstChain) {
      errors.push({ underlying, message: "no_chain_returned" });
      continue;
    }

    // First chain is the front (current) expiry. Take up to N expiries from
    // the chain header `expiries[]` — already sorted ascending future-only.
    const expiries = (firstChain.expiries ?? [firstChain.expiry])
      .filter((e) => typeof e === "string" && e.length === 10)
      .slice(0, cfg.expiriesPerUnderlying);

    let underlyingOk = false;
    for (const exp of expiries) {
      try {
        // Avoid an extra fetch for the front expiry — reuse `firstChain`.
        const chain = exp === firstChain.expiry
          ? firstChain
          : await fetchOptionChain(underlying, exp);
        if (!chain || chain.rows.length === 0) {
          errors.push({ underlying, expiry: exp, message: "empty_chain" });
          continue;
        }
        if (chain.source) seenSources.add(chain.source);
        const rows = flattenChainToRows(chain, capturedAt, cfg.strikeWindow);
        const n = await upsertRows(rows);
        totalRows += n;
        expiryCount += 1;
        underlyingOk = true;
        // R1-tail: replay recorder read-only tap. Push a full-chain
        // snapshot into the live-tap ring so `POST /api/replay/record`
        // can drain it as fixture data. Wrapped fail-open — buffer
        // failures MUST NOT affect the ingestor.
        try {
          const { tapPushChainSnapshot } = await import("./liveTapRing");
          tapPushChainSnapshot({
            capturedAtMs: capturedAt.getTime(),
            underlying,
            expiry: exp,
            source: chain.source ?? "unknown",
            snapshot: { rows: chain.rows, spot: chain.spot ?? null },
          });
        } catch { /* fail-open — recorder is read-only */ }
      } catch (err) {
        errors.push({ underlying, expiry: exp, message: (err as Error).message });
      }
    }
    if (underlyingOk) okCount += 1;
  }

  const finishedAt = new Date();
  const sourceTag =
    seenSources.size === 0 ? "none"
    : seenSources.size === 1 ? [...seenSources][0]!
    : "mixed";

  // Persist the run row for the diagnostic endpoint.
  try {
    await db.insert(optionChainSnapshotRunTable).values({
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      underlyingsAttempted: SNAPSHOT_INDICES.length,
      underlyingsOk: okCount,
      expiriesCovered: expiryCount,
      rowsWritten: totalRows,
      source: sourceTag.slice(0, 16),
      errors: errors.slice(0, 20),
    });
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      "option-snapshot: failed to persist run row (continuing)",
    );
  }

  return {
    underlyingsAttempted: SNAPSHOT_INDICES.length,
    underlyingsOk: okCount,
    expiriesCovered: expiryCount,
    rowsWritten: totalRows,
    errors,
    source: sourceTag,
    startedAt,
    finishedAt,
  };
}

// ───────────── Retention sweep ─────────────

export async function runRetentionSweep(): Promise<{ snapshotRowsDeleted: number; runRowsDeleted: number }> {
  const cfg = getSnapshotConfig();
  const cutoff = new Date(Date.now() - cfg.retentionDays * 86_400_000);
  const snap = await db.execute(sql`
    DELETE FROM option_chain_snapshot WHERE captured_at < ${cutoff.toISOString()};
  `);
  const runs = await db.execute(sql`
    DELETE FROM option_chain_snapshot_run WHERE started_at < ${cutoff.toISOString()};
  `);
  // node-postgres returns rowCount on the underlying result; drizzle's
  // execute exposes it on `.rowCount` for postgres-js too.
  const snapDel = (snap as unknown as { rowCount?: number }).rowCount ?? 0;
  const runDel = (runs as unknown as { rowCount?: number }).rowCount ?? 0;
  return { snapshotRowsDeleted: snapDel, runRowsDeleted: runDel };
}

// ───────────── Scheduler ─────────────

let tickTimer: NodeJS.Timeout | null = null;
let retentionTimer: NodeJS.Timeout | null = null;
let inFlight = false;
let lastRun: RunResult | null = null;

export function getLastRun(): RunResult | null {
  return lastRun;
}

/**
 * Start the long-running ingestor. Idempotent — safe to call twice.
 * No-ops in three cases:
 *   1. `OPTION_SNAPSHOT_ENABLED` resolves to false (dev / preview default).
 *   2. The timer is already running.
 *   3. `DATABASE_URL` is unset (test environments).
 */
export function startOptionSnapshotIngestor(): void {
  if (tickTimer != null) return;
  if (!process.env["DATABASE_URL"]) {
    logger.info("option-snapshot: DATABASE_URL not set, skipping ingestor");
    return;
  }
  if (!isOptionSnapshotEnabled()) {
    logger.info(
      { reason: "OPTION_SNAPSHOT_ENABLED is off (auto-detected dev or explicit override)" },
      "option-snapshot: ingestor disabled",
    );
    return;
  }
  const cfg = getSnapshotConfig();
  const intervalMs = cfg.intervalMinutes * 60_000;
  logger.info(
    {
      intervalMin: cfg.intervalMinutes,
      strikeWindow: cfg.strikeWindow,
      expiries: cfg.expiriesPerUnderlying,
      retentionDays: cfg.retentionDays,
      universe: SNAPSHOT_INDICES,
    },
    "option-snapshot: starting ingestor",
  );

  const tick = async (): Promise<void> => {
    if (inFlight) return;
    inFlight = true;
    try {
      const r = await runIngestionTick();
      lastRun = r;
      if (r.rowsWritten > 0 || r.errors.length > 0) {
        logger.info(
          { rows: r.rowsWritten, ok: r.underlyingsOk, err: r.errors.length, src: r.source },
          "option-snapshot: tick complete",
        );
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "option-snapshot: tick failed");
    } finally {
      inFlight = false;
    }
  };

  // Fire one tick on boot (will no-op outside market hours), then schedule.
  void tick();
  tickTimer = setInterval(() => void tick(), intervalMs);

  // Daily retention sweep at boot + every 24h. Fail-soft.
  void runRetentionSweep().catch((err) =>
    logger.warn({ err: (err as Error).message }, "option-snapshot: retention sweep failed"),
  );
  retentionTimer = setInterval(
    () =>
      void runRetentionSweep().catch((err) =>
        logger.warn({ err: (err as Error).message }, "option-snapshot: retention sweep failed"),
      ),
    24 * 60 * 60_000,
  );
}

/** Test hook — stops timers so vitest doesn't keep the event loop alive. */
export function stopOptionSnapshotIngestor(): void {
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  if (retentionTimer) { clearInterval(retentionTimer); retentionTimer = null; }
}
