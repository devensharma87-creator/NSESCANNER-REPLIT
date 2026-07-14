import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

/**
 * Pool tuning for Replit-managed Postgres (and any managed PG that closes
 * idle TCP connections after a short window).
 *
 * Why this matters
 * ----------------
 * Without these options, `pg.Pool` will hand out a stale connection that
 * the server has already half-closed. Drizzle then surfaces this as
 * `Failed query: <SQL>\nparams: ...` with an EMPTY error body — the same
 * fingerprint we observed on production worker pid=20 against three
 * unrelated tables (`option_signal_history`, `global_screener_presets`,
 * `kite_session`) after Kite ticker reconnect storms.
 *
 * - `keepAlive: true` — enables SO_KEEPALIVE on the TCP socket.
 * - `keepAliveInitialDelayMillis: 10_000` — sends the first keepalive probe
 *   10 s after the connection is established, well before a managed-PG
 *   reaper can classify the socket as idle and half-close it.  Without this
 *   delay, `keepAlive:true` alone depends on the OS default (often 2 h) and
 *   provides no protection against short-window managed-PG reapers.
 * - `idleTimeoutMillis: 10_000` — recycle our own idle conns every 10 s.
 *   Production shows connections dying faster than the previous 30 s window;
 *   10 s keeps the pool ahead of the network reaper on Replit managed PG.
 * - `max: 10` — bounded pool keeps us under managed PG's per-tenant
 *   connection limit even with two replicas.
 * - `connectionTimeoutMillis: 10_000` — fail fast on connect rather than
 *   hanging the request indefinitely.
 *
 * Critical pool error handler
 * ---------------------------
 * `pg.Pool` documents that *every* consumer must attach an `error`
 * listener — without one, an idle-client error (server-side disconnect,
 * TLS reset, etc.) becomes an unhandled `EventEmitter` error that can
 * crash the worker. We log structured stderr (picked up by pino's stream
 * capture in `api-server`) and let the pool drop the dead client; the
 * next checkout transparently dials a fresh one.
 */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
  max: 10,
});

pool.on("error", (err) => {
  process.stderr.write(
    JSON.stringify({
      level: "error",
      msg: "pg pool: idle client error (dead conn evicted, next checkout will reconnect)",
      err: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
      pid: process.pid,
      ts: new Date().toISOString(),
    }) + "\n",
  );
});

export const db = drizzle(pool, { schema });

/**
 * Read-only snapshot of the pg pool's in-memory counters.
 *
 * W6-P4B5: lets the api-server log cold-start pool utilization to verify the
 * W6-P4A boot staggering actually relieved contention — WITHOUT running a query
 * or acquiring a connection. `pg.Pool` maintains `totalCount` / `idleCount` /
 * `waitingCount` as plain in-memory numbers, and `options.max` is the configured
 * ceiling; reading them is free and side-effect-free.
 *
 * Only the four numeric counters are returned — never `options` itself (which
 * holds the connection string). Fail-open: returns `null` if any counter is
 * missing or reading throws, so a stats read can never crash a caller.
 */
export interface DbPoolStats {
  /** Total clients currently created by the pool (idle + in-use). */
  total: number;
  /** Clients currently idle (available for immediate checkout). */
  idle: number;
  /** Pending checkout requests waiting for a free client (contention signal). */
  waiting: number;
  /** Configured pool ceiling (`max`). */
  max: number;
}

interface PoolStatsSource {
  totalCount?: number;
  idleCount?: number;
  waitingCount?: number;
  options?: { max?: number };
}

export function getDbPoolStats(src: PoolStatsSource = pool): DbPoolStats | null {
  try {
    const total = src.totalCount;
    const idle = src.idleCount;
    const waiting = src.waitingCount;
    const max = src.options?.max;
    if (
      typeof total !== "number" ||
      typeof idle !== "number" ||
      typeof waiting !== "number" ||
      typeof max !== "number"
    ) {
      return null;
    }
    return { total, idle, waiting, max };
  } catch {
    return null;
  }
}

export * from "./schema";
