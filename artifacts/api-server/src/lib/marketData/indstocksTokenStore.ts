/**
 * INDstocks daily access-token store.
 *
 * The INDstocks REST token expires roughly every 24h. Rather than forcing the
 * operator to edit the INDSTOCKS_API_TOKEN secret + restart (dev) / redeploy
 * (prod) every day, this store persists the current token in the DB (encrypted
 * at rest via the shared kiteCrypto AES-256-GCM helper) so the owner can
 * hot-swap it from inside the app.
 *
 * Reads are DB-first with an env-secret fallback, so an existing
 * INDSTOCKS_API_TOKEN secret keeps working until the owner pastes a token.
 *
 * Trust is unchanged: INDstocks remains a `secondary_validation` source. This
 * module only changes WHERE the token comes from, never what the token is
 * allowed to do. The token value is NEVER logged and NEVER returned by the
 * status helper.
 */
import { eq } from "drizzle-orm";
import { db, indstocksTokenTable } from "@workspace/db";
import { encryptToken, decryptToken } from "../kiteCrypto";
import { logger } from "../logger";

const ACTIVE_ID = "active";
const CACHE_TTL_MS = 30_000;
const DEFAULT_VALIDITY_MS = 24 * 60 * 60 * 1000;

export type IndstocksTokenSource = "db" | "env" | "none";

interface TokenCache {
  token: string | null;
  source: IndstocksTokenSource;
  fetchedAt: number;
}

let cache: TokenCache | null = null;

export interface IndstocksTokenStatus {
  /** True when a usable token exists (DB or env). Never reveals the value. */
  present: boolean;
  source: IndstocksTokenSource;
  updatedAt: string | null;
  expiresAt: string | null;
  /** True when the DB token is past its recorded expiry hint. */
  expired: boolean;
  updatedBy: string | null;
}

function envToken(): string | null {
  const t = process.env["INDSTOCKS_API_TOKEN"]?.trim();
  return t && t.length > 0 ? t : null;
}

/**
 * Resolve the effective INDstocks token: DB row first (hot-swappable), then the
 * env secret. Cached in-memory for CACHE_TTL_MS so per-request resolution stays
 * cheap. DB failures fail-OPEN to the env token (logged, never the value).
 */
export async function getIndstocksToken(): Promise<string | null> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache.token;

  let token: string | null = null;
  let source: IndstocksTokenSource = "none";
  try {
    const rows = await db
      .select()
      .from(indstocksTokenTable)
      .where(eq(indstocksTokenTable.id, ACTIVE_ID))
      .limit(1);
    const r = rows[0];
    if (r) {
      const dec = decryptToken(r.token);
      if (dec && dec.trim().length > 0) {
        token = dec.trim();
        source = "db";
      }
    }
  } catch (err) {
    logger.warn(
      `indstocksTokenStore: DB token read failed; falling back to env secret: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  if (!token) {
    const env = envToken();
    if (env) {
      token = env;
      source = "env";
    }
  }

  cache = { token, source, fetchedAt: now };
  return token;
}

/**
 * Persist a new token (encrypted) as the single active row and refresh the
 * in-memory cache so the very next request uses it — no restart/redeploy.
 */
export async function setIndstocksToken(
  rawToken: string,
  opts?: { expiresAt?: Date; updatedBy?: string | null },
): Promise<void> {
  const token = (rawToken ?? "").trim();
  if (!token) throw new Error("setIndstocksToken: token must be a non-empty string");

  const now = new Date();
  const expiresAt =
    opts?.expiresAt instanceof Date && !Number.isNaN(opts.expiresAt.getTime())
      ? opts.expiresAt
      : new Date(now.getTime() + DEFAULT_VALIDITY_MS);
  const updatedBy = opts?.updatedBy ?? null;
  const encrypted = encryptToken(token);

  await db
    .insert(indstocksTokenTable)
    .values({ id: ACTIVE_ID, token: encrypted, updatedAt: now, expiresAt, updatedBy })
    .onConflictDoUpdate({
      target: indstocksTokenTable.id,
      set: { token: encrypted, updatedAt: now, expiresAt, updatedBy },
    });

  cache = { token, source: "db", fetchedAt: Date.now() };
}

/** Remove the DB token so reads fall back to the env secret. */
export async function clearIndstocksToken(): Promise<void> {
  await db.delete(indstocksTokenTable).where(eq(indstocksTokenTable.id, ACTIVE_ID));
  cache = null;
}

/** Status for the owner UI/diagnostics. NEVER returns the token value. */
export async function getIndstocksTokenStatus(): Promise<IndstocksTokenStatus> {
  let updatedAt: string | null = null;
  let expiresAt: string | null = null;
  let updatedBy: string | null = null;
  let dbPresent = false;
  try {
    const rows = await db
      .select()
      .from(indstocksTokenTable)
      .where(eq(indstocksTokenTable.id, ACTIVE_ID))
      .limit(1);
    const r = rows[0];
    if (r) {
      let dec: string | null = null;
      try {
        dec = decryptToken(r.token);
      } catch {
        // Encrypted row we cannot read (missing/rotated key) — treat as absent
        // for usability purposes but still surface the metadata below.
        dec = null;
      }
      dbPresent = !!(dec && dec.trim().length > 0);
      updatedAt = r.updatedAt ? new Date(r.updatedAt).toISOString() : null;
      expiresAt = r.expiresAt ? new Date(r.expiresAt).toISOString() : null;
      updatedBy = r.updatedBy ?? null;
    }
  } catch (err) {
    logger.warn(
      `indstocksTokenStore: status DB read failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  if (dbPresent) {
    const expired = expiresAt ? new Date(expiresAt).getTime() < Date.now() : false;
    return { present: true, source: "db", updatedAt, expiresAt, expired, updatedBy };
  }
  const env = envToken();
  if (env) {
    return {
      present: true,
      source: "env",
      updatedAt: null,
      expiresAt: null,
      expired: false,
      updatedBy: null,
    };
  }
  return {
    present: false,
    source: "none",
    updatedAt: null,
    expiresAt: null,
    expired: false,
    updatedBy: null,
  };
}

/** Test-only: clear the in-memory cache so a test can mutate DB/env between cases. */
export function _resetIndstocksTokenCacheForTests(): void {
  cache = null;
}
