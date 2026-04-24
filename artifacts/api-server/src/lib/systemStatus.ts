/**
 * Live system status — health snapshot of every subsystem the app depends on.
 * Used by the /status page. Probe results are cached for 60s to keep the
 * endpoint cheap to poll.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { feedStatus } from "./kiteFeed";
import { getKiteCreds, getActiveSession } from "./kiteAuth";
import { getRecentAlerts } from "./tradingViewAlerts";
import { computeMarketStatus } from "./marketEvents";

export type Severity = "ok" | "warn" | "fail" | "info";

export interface StatusItem {
  id: string;
  group: "core" | "data" | "feed" | "upstream" | "scheduled" | "alerts";
  title: string;
  status: Severity;
  detail: string;
  /** ISO timestamp of the most recent good signal, if relevant. */
  lastUpdated?: string | null;
  /** Latency of the live probe in ms, if measured. */
  latencyMs?: number;
}

export interface StatusReport {
  generatedAt: string;
  uptimeSec: number;
  marketState: "open" | "closed" | "pre_open";
  summary: { ok: number; warn: number; fail: number; info: number; total: number };
  items: StatusItem[];
}

const PROBE_TTL_MS = 60_000;

interface ProbeResult {
  ok: boolean;
  status: number | null;
  latencyMs: number;
  error?: string;
  fetchedAt: number;
}

const probeCache = new Map<string, ProbeResult>();
// Singleflight: if a probe for the same URL is already in flight, all callers
// share the same Promise instead of stampeding the upstream at TTL boundaries.
const inFlight = new Map<string, Promise<ProbeResult>>();

async function probeUrl(url: string, timeoutMs = 5000): Promise<ProbeResult> {
  const cached = probeCache.get(url);
  if (cached && Date.now() - cached.fetchedAt < PROBE_TTL_MS) return cached;

  const existing = inFlight.get(url);
  if (existing) return existing;

  const p = (async (): Promise<ProbeResult> => {
    const t0 = Date.now();
    const ctrl = new AbortController();
    const tm = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, {
        method: "GET",
        signal: ctrl.signal,
        headers: { "user-agent": "NSE-Scanner-StatusProbe/1.0" },
      });
      const result: ProbeResult = {
        ok: r.ok,
        status: r.status,
        latencyMs: Date.now() - t0,
        fetchedAt: Date.now(),
      };
      probeCache.set(url, result);
      return result;
    } catch (err) {
      const result: ProbeResult = {
        ok: false,
        status: null,
        latencyMs: Date.now() - t0,
        error: err instanceof Error ? err.message : "probe_failed",
        fetchedAt: Date.now(),
      };
      probeCache.set(url, result);
      return result;
    } finally {
      clearTimeout(tm);
      inFlight.delete(url);
    }
  })();
  inFlight.set(url, p);
  return p;
}

function formatAge(iso: string | null | undefined): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export async function buildStatusReport(): Promise<StatusReport> {
  const items: StatusItem[] = [];
  const market = computeMarketStatus(new Date());

  // ---- CORE ----
  const memMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
  items.push({
    id: "core_uptime",
    group: "core",
    title: "API server",
    status: "ok",
    detail: `Up ${Math.floor(process.uptime() / 60)} min · RSS memory ${memMb} MB · Node ${process.version}`,
  });

  // ---- DATABASE ----
  const dbT0 = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    items.push({
      id: "data_db",
      group: "data",
      title: "PostgreSQL connection",
      status: "ok",
      detail: "Connection healthy.",
      latencyMs: Date.now() - dbT0,
    });
  } catch (err) {
    items.push({
      id: "data_db",
      group: "data",
      title: "PostgreSQL connection",
      status: "fail",
      detail: err instanceof Error ? err.message : "DB query failed",
      latencyMs: Date.now() - dbT0,
    });
  }

  // ---- KITE ----
  const creds = getKiteCreds();
  if (!creds) {
    items.push({
      id: "feed_kite_creds",
      group: "feed",
      title: "Kite credentials",
      status: "warn",
      detail: "KITE_API_KEY / KITE_API_SECRET not configured. Live feed disabled.",
    });
  } else {
    items.push({
      id: "feed_kite_creds",
      group: "feed",
      title: "Kite credentials",
      status: "ok",
      detail: `API key prefix: ${creds.apiKey.slice(0, 4)}…`,
    });

    const session = await getActiveSession().catch(() => null);
    if (!session) {
      items.push({
        id: "feed_kite_session",
        group: "feed",
        title: "Kite session (daily login)",
        status: "warn",
        detail:
          "No active Kite access token. Kite tokens expire each day at ~6 AM IST — log in again from the Kite page.",
      });
    } else {
      const expiresAt = session.expiresAt?.toISOString() ?? null;
      const minsToExpiry = expiresAt ? Math.floor((new Date(expiresAt).getTime() - Date.now()) / 60000) : null;
      items.push({
        id: "feed_kite_session",
        group: "feed",
        title: "Kite session (daily login)",
        status: minsToExpiry !== null && minsToExpiry < 30 ? "warn" : "ok",
        detail:
          `Logged in as ${session.userName ?? session.userId ?? "user"}` +
          (expiresAt ? ` · expires ${formatAge(expiresAt)}` : "") +
          (minsToExpiry !== null && minsToExpiry < 30 ? " (expiring soon)" : ""),
        lastUpdated: session.loginTime?.toISOString() ?? null,
      });
    }

    const feed = feedStatus();
    items.push({
      id: "feed_kite_ws",
      group: "feed",
      title: "Kite WebSocket ticker",
      status: feed.connected ? "ok" : feed.running ? "warn" : "info",
      detail:
        `Running: ${feed.running} · Connected: ${feed.connected} · ` +
        `Subscribed: ${feed.subscribed} symbols · Quotes cached: ${feed.liveQuotes}` +
        (feed.lastError ? ` · Last error: ${feed.lastError}` : ""),
      lastUpdated: feed.lastConnectAt,
    });
  }

  // ---- TRADINGVIEW ALERTS ----
  const tvLen = (process.env["TRADINGVIEW_WEBHOOK_SECRET"] ?? "").length;
  const isProd = process.env["NODE_ENV"] === "production";
  items.push({
    id: "alerts_webhook_secret",
    group: "alerts",
    title: "TradingView webhook auth",
    status: tvLen === 0 ? (isProd ? "fail" : "warn") : "ok",
    detail:
      tvLen === 0
        ? isProd
          ? "TRADINGVIEW_WEBHOOK_SECRET not set — webhook returns 503."
          : "Open mode (dev only). Set TRADINGVIEW_WEBHOOK_SECRET before publishing."
        : `Configured (${tvLen} chars).`,
  });

  try {
    const recent = await getRecentAlerts(5);
    const last = recent[0]?.receivedAt ?? null;
    items.push({
      id: "alerts_recent",
      group: "alerts",
      title: "Recent TradingView alerts",
      status: "info",
      detail:
        recent.length === 0
          ? "No alerts received yet."
          : `${recent.length} recent · last from ${recent[0]?.symbol ?? "?"} (${recent[0]?.side ?? "?"}) ${formatAge(last)}.`,
      lastUpdated: last,
    });
  } catch (err) {
    items.push({
      id: "alerts_recent",
      group: "alerts",
      title: "Recent TradingView alerts",
      status: "fail",
      detail: err instanceof Error ? err.message : "alert query failed",
    });
  }

  // ---- UPSTREAM PROBES (Yahoo / NSE / Moneycontrol / RSS) ----
  const probes = await Promise.all([
    probeUrl("https://query1.finance.yahoo.com/v1/finance/search?q=NIFTY"),
    probeUrl("https://www.nseindia.com/api/marketStatus"),
    probeUrl("https://www.moneycontrol.com/news/business/markets/"),
    probeUrl("https://www.business-standard.com/rss/markets-106.rss"),
  ]);
  const labels = ["Yahoo Finance", "NSE India (direct)", "Moneycontrol", "Business Standard RSS"];
  const ids = ["upstream_yahoo", "upstream_nse", "upstream_mc", "upstream_rss"];
  for (let i = 0; i < probes.length; i++) {
    const p = probes[i]!;
    const label = labels[i]!;
    const id = ids[i]!;
    items.push({
      id,
      group: "upstream",
      title: label,
      status: p.ok ? "ok" : p.status === 401 || p.status === 403 ? "warn" : "fail",
      detail:
        p.ok
          ? `HTTP ${p.status} in ${p.latencyMs} ms.`
          : p.status
            ? `HTTP ${p.status} in ${p.latencyMs} ms${id === "upstream_nse" ? " (NSE blocks non-Indian IPs — Kite is the primary feed in production)." : "."}`
            : `Probe failed: ${p.error ?? "no response"}`,
      latencyMs: p.latencyMs,
    });
  }

  // ---- MARKET STATE ----
  items.push({
    id: "core_market_state",
    group: "core",
    title: "NSE market state",
    status: "info",
    detail:
      market === "open"
        ? "Market is OPEN (09:15–15:30 IST, Mon–Fri)."
        : market === "pre_open"
          ? "Pre-open session (09:00–09:15 IST)."
          : "Market is CLOSED.",
  });

  // ---- SUMMARY ----
  let ok = 0,
    warn = 0,
    fail = 0,
    info = 0;
  for (const it of items) {
    if (it.status === "ok") ok++;
    else if (it.status === "warn") warn++;
    else if (it.status === "fail") fail++;
    else info++;
  }

  return {
    generatedAt: new Date().toISOString(),
    uptimeSec: Math.floor(process.uptime()),
    marketState: market,
    summary: { ok, warn, fail, info, total: items.length },
    items,
  };
}
