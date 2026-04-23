import { logger } from "./logger";
import { db, tvAlertsTable } from "@workspace/db";
import { desc, sql } from "drizzle-orm";

export interface TradingViewAlert {
  id: string;
  receivedAt: string;
  symbol?: string;
  ticker?: string;
  exchange?: string;
  interval?: string;
  side?: "BUY" | "SELL" | "LONG" | "SHORT" | "EXIT" | string;
  strategy?: string;
  price?: number;
  message?: string;
  raw: unknown;
}

const MAX_ALERTS = 100;

/** Hot in-memory ring buffer in front of Postgres so the GET endpoint stays
 * fast even if the DB is under load. Hydrated on startup from the DB. */
let buffer: TradingViewAlert[] = [];
let hydrated = false;
let inflightHydration: Promise<void> | null = null;

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function asString(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  if (typeof v === "number") return String(v);
  return undefined;
}

function rowToAlert(r: typeof tvAlertsTable.$inferSelect): TradingViewAlert {
  return {
    id: r.id,
    receivedAt: r.receivedAt.toISOString(),
    symbol: r.symbol ?? undefined,
    ticker: r.ticker ?? undefined,
    exchange: r.exchange ?? undefined,
    interval: r.interval ?? undefined,
    side: r.side ?? undefined,
    strategy: r.strategy ?? undefined,
    price: r.price != null ? Number(r.price) : undefined,
    message: r.message ?? undefined,
    raw: r.raw,
  };
}

async function hydrate(): Promise<void> {
  if (hydrated) return;
  if (inflightHydration) return inflightHydration;
  inflightHydration = (async () => {
    try {
      const rows = await db.select().from(tvAlertsTable).orderBy(desc(tvAlertsTable.receivedAt)).limit(MAX_ALERTS);
      buffer = rows.map(rowToAlert);
      logger.info({ count: buffer.length }, "TV alerts hydrated from DB");
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "TV alerts DB hydrate failed (will rely on memory)");
    } finally {
      hydrated = true; // don't keep retrying forever
      inflightHydration = null;
    }
  })();
  return inflightHydration;
}

/** Normalise a TradingView webhook body into an alert record.
 * TradingView lets users put any JSON in the alert message field, so we
 * accept both: (a) a JSON object with conventional keys, and
 * (b) a plain text message that we store verbatim. */
export async function recordTradingViewAlert(body: unknown): Promise<TradingViewAlert> {
  if (!hydrated) await hydrate();
  const obj = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const alert: TradingViewAlert = {
    id: `tv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    receivedAt: new Date().toISOString(),
    symbol: asString(obj["symbol"]) ?? asString(obj["ticker"]),
    ticker: asString(obj["ticker"]),
    exchange: asString(obj["exchange"]),
    interval: asString(obj["interval"]) ?? asString(obj["timeframe"]),
    side: asString(obj["side"])?.toUpperCase() ?? asString(obj["action"])?.toUpperCase(),
    strategy: asString(obj["strategy"]) ?? asString(obj["alert_name"]),
    price: asNumber(obj["price"]) ?? asNumber(obj["close"]),
    message: asString(obj["message"]) ?? (typeof body === "string" ? (body as string) : undefined),
    raw: body,
  };

  // 1) Update the hot buffer FIRST so GET reflects the alert immediately,
  //    even if the DB call is slow or fails.
  buffer.unshift(alert);
  if (buffer.length > MAX_ALERTS) buffer.length = MAX_ALERTS;

  // 2) Persist to Postgres (best-effort).
  try {
    await db.insert(tvAlertsTable).values({
      id: alert.id,
      receivedAt: new Date(alert.receivedAt),
      symbol: alert.symbol ?? null,
      ticker: alert.ticker ?? null,
      exchange: alert.exchange ?? null,
      interval: alert.interval ?? null,
      side: alert.side ?? null,
      strategy: alert.strategy ?? null,
      price: alert.price != null ? String(alert.price) : null,
      message: alert.message ?? null,
      raw: alert.raw as object,
    });
  } catch (err) {
    logger.error({ err: (err as Error).message, id: alert.id }, "TV alert DB insert failed");
  }

  logger.info({ id: alert.id, symbol: alert.symbol, side: alert.side, strategy: alert.strategy }, "TradingView alert received");
  return alert;
}

export async function getRecentAlerts(limit = 25): Promise<TradingViewAlert[]> {
  if (!hydrated) await hydrate();
  return buffer.slice(0, Math.max(1, Math.min(MAX_ALERTS, limit)));
}

export async function clearAlerts(): Promise<number> {
  if (!hydrated) await hydrate();
  const n = buffer.length;
  buffer = [];
  try {
    await db.execute(sql`DELETE FROM tv_alerts`);
  } catch (err) {
    logger.error({ err: (err as Error).message }, "TV alerts DB clear failed");
  }
  return n;
}
