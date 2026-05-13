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
 * - `keepAlive: true` — keeps the TCP socket alive so the managed PG
 *   side doesn't reap it as idle.
 * - `idleTimeoutMillis: 30_000` — recycle our own idle conns *before* the
 *   server kills them. 30 s is well under the typical 60–120 s server
 *   reaper window.
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
  idleTimeoutMillis: 30_000,
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

export * from "./schema";
