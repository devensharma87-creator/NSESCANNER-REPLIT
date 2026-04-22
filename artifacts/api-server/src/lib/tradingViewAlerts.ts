import { logger } from "./logger";

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
const buffer: TradingViewAlert[] = [];

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

/** Normalise a TradingView webhook body into an alert record.
 * TradingView lets users put any JSON in the alert message field, so we
 * accept both: (a) a JSON object with conventional keys, and
 * (b) a plain text message that we store verbatim. */
export function recordTradingViewAlert(body: unknown): TradingViewAlert {
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
  buffer.unshift(alert);
  if (buffer.length > MAX_ALERTS) buffer.length = MAX_ALERTS;
  logger.info({ id: alert.id, symbol: alert.symbol, side: alert.side, strategy: alert.strategy }, "TradingView alert received");
  return alert;
}

export function getRecentAlerts(limit = 25): TradingViewAlert[] {
  return buffer.slice(0, Math.max(1, Math.min(MAX_ALERTS, limit)));
}

export function clearAlerts(): number {
  const n = buffer.length;
  buffer.length = 0;
  return n;
}
