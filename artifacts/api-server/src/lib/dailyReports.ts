/**
 * Daily Telegram reports: pre-market readiness + post-market summary.
 *
 * Architecture:
 *   – Pure builder functions (`buildPreMarketReport`, `buildPostMarketReport`)
 *     accept plain data objects and return Telegram text. 100% testable without
 *     DB, Kite, or Telegram dependencies.
 *   – Async gather functions (`gatherPreMarketData`, `gatherPostMarketData`)
 *     collect live data from Kite session, F&O cycle state, DB, and
 *     in-process alert records. Each section fails-open independently.
 *   – Scheduler latches (`maybeRunPreMarketReport`, `maybeRunPostMarketReport`)
 *     follow the same 60-second tick + date-latch pattern as paperDailySummaryFo.ts.
 *
 * Source-honesty contract:
 *   – All data is labeled with its source (Kite session, in-process state, DB).
 *   – Missing data is shown as "Unavailable — not tracked yet", never as 0.
 *   – No Kite API calls are made during gathering (uses in-process state only).
 *   – No trading logic, signals, paper-trade creation, or broker execution.
 *   – Telegram secrets are NEVER logged or returned from any function here.
 *
 * Weekend behaviour: skip the report on IST Saturday/Sunday.
 * Dedup: latch key = `PRE_MARKET_REPORT::YYYY-MM-DD` / `POST_MARKET_REPORT::YYYY-MM-DD`.
 */

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";
import { getActiveSessionStatus } from "./kiteAuth";
import { feedStatus } from "./kiteFeed";
import { getLastFnoCycleState, OPTION_INDICES } from "./optionSignals";
import { computeDailySummaryFo, istDateOf } from "./paperDailySummaryFo";
import { getLastAlertRecord, alertOwnerRaw } from "./alerting";
import { getLastSwingAlertRecord } from "./swingAlerts";
import { getLastFnoSignalAlertRecord } from "./fnoSignalAlerts";

// ── IST helpers ───────────────────────────────────────────────────────────────

function istInfo(nowMs: number = Date.now()): {
  date: string;
  minOfDay: number;
  dayOfWeek: number;
  datetimeStr: string;
} {
  const ist = new Date(nowMs + 5.5 * 60 * 60 * 1000);
  const date = ist.toISOString().slice(0, 10);
  const minOfDay = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const dayOfWeek = ist.getUTCDay();
  const dd = String(ist.getUTCDate()).padStart(2, "0");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const mon = months[ist.getUTCMonth()] ?? "";
  const yr = ist.getUTCFullYear();
  const hh = String(ist.getUTCHours()).padStart(2, "0");
  const mm = String(ist.getUTCMinutes()).padStart(2, "0");
  const datetimeStr = `${dd} ${mon} ${yr} ${hh}:${mm}`;
  return { date, minOfDay, dayOfWeek, datetimeStr };
}

function formatIstHM(epochMs: number): string {
  try {
    return new Date(epochMs).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "??:??";
  }
}

function minsAgoStr(epochMs: number, nowMs: number): string {
  const diffMin = Math.round((nowMs - epochMs) / 60_000);
  if (diffMin < 60) return `${diffMin}m ago`;
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  return m > 0 ? `${h}h ${m}m ago` : `${h}h ago`;
}

// ── Pre-market data interfaces ────────────────────────────────────────────────

export interface PreMarketKite {
  sessionPresent: boolean;
  user: string | null;
  expiresAt: string | null;
  minsToExpiry: number | null;
  feedConnected: boolean;
  feedSubscribed: number;
}

export interface PreMarketFno {
  lastCycleAt: string | null;
  cycleMinsAgo: number | null;
  indicesWithBars: number;
  indicesConfigured: number;
  signalCount: number;
  suppressed: boolean;
  suppressedSummary: string;
}

export interface PreMarketSwing {
  pending: number;
  approvalRequired: number;
  approved: number;
  expired: number;
}

export interface PreMarketAlerts {
  lastDataAlertEvent: string | null;
  lastDataAlertMinsAgo: number | null;
  lastSignalAlertMinsAgo: number | null;
  lastSwingAlertMinsAgo: number | null;
}

export interface PreMarketReportData {
  isManualTest: boolean;
  istDatetime: string;
  isWeekend: boolean;
  kite: PreMarketKite;
  fno: PreMarketFno | null;
  swing: PreMarketSwing | null;
  alerts: PreMarketAlerts;
}

// ── Pre-market builder (pure — no async, no imports, fully testable) ──────────

export function buildPreMarketReport(data: PreMarketReportData): string {
  const header = data.isManualTest
    ? "🌅 PRE-MARKET READINESS [MANUAL TEST]"
    : "🌅 PRE-MARKET READINESS";
  const lines: string[] = [header, `Date: ${data.istDatetime} IST`, ""];

  if (data.isWeekend) {
    lines.push("⚠ Weekend — markets closed today.");
    lines.push("No F&O or swing activity expected.");
    lines.push("", "Source: Kite session + in-process state. Not a trading recommendation.");
    return lines.join("\n");
  }

  lines.push("── KITE SESSION ──");
  if (data.kite.sessionPresent) {
    lines.push(`Status: ✅ Active${data.kite.user ? ` (${data.kite.user})` : ""}`);
    if (data.kite.expiresAt != null && data.kite.minsToExpiry != null) {
      const h = Math.floor(data.kite.minsToExpiry / 60);
      const m = data.kite.minsToExpiry % 60;
      lines.push(`Expires: ${formatIstHM(new Date(data.kite.expiresAt).getTime())} IST (${h}h ${m}m)`);
    }
    lines.push(`Feed: ${data.kite.feedConnected ? "✅ Connected" : "⚠ Disconnected"} (${data.kite.feedSubscribed} tokens)`);
  } else {
    lines.push("Status: ❌ MISSING — login required");
    lines.push("Action: Reconnect Kite/Zerodha at /kite-login");
  }

  lines.push("");
  lines.push("── F&O DATA READINESS ──");
  if (data.fno != null) {
    const { indicesWithBars: bars, indicesConfigured: cfg } = data.fno;
    const barsStr =
      bars === cfg
        ? `✅ Available (${bars}/${cfg} indices)`
        : bars > 0
          ? `⚠ Partial (${bars}/${cfg} indices)`
          : `❌ UNAVAILABLE (0/${cfg} indices)`;
    lines.push(`Daily bars: ${barsStr}`);

    if (data.fno.lastCycleAt != null) {
      const agoStr = data.fno.cycleMinsAgo != null ? ` (${data.fno.cycleMinsAgo}m ago)` : "";
      lines.push(`Last F&O cycle: ${formatIstHM(new Date(data.fno.lastCycleAt).getTime())} IST${agoStr}`);
      lines.push(`Signals emitted: ${data.fno.signalCount}`);
    } else {
      lines.push("Last F&O cycle: None since server start");
    }

    if (data.fno.suppressed) {
      const reason = data.fno.suppressedSummary ? ` — ${data.fno.suppressedSummary}` : "";
      lines.push(`Signal cycle: ⚠ SUPPRESSED${reason}`);
      lines.push("Action: Check /fno-diagnostics");
    } else if (bars === cfg) {
      lines.push("Signal cycle: ✅ Ready");
    } else if (!data.kite.sessionPresent) {
      lines.push("Signal cycle: ❌ NOT READY — Kite session missing");
    } else {
      lines.push("Signal cycle: ⚠ NOT READY — daily bars unavailable");
      lines.push("Note: Kite session is active. F&O daily bars may still be loading.");
      lines.push("Action: Check /fno-diagnostics");
    }
  } else {
    lines.push("Daily bars: Unavailable — no F&O cycle has run since server start");
    lines.push("Signal cycle: Unavailable — not tracked yet");
  }

  lines.push("");
  lines.push("── SWING STAGING ──");
  if (data.swing != null) {
    lines.push(`Pending approval: ${data.swing.pending + data.swing.approvalRequired}`);
    lines.push(`Approved: ${data.swing.approved}`);
    lines.push(`Expired: ${data.swing.expired}`);
  } else {
    lines.push("Unavailable — not tracked yet");
  }

  lines.push("");
  lines.push("── ALERT STATUS ──");
  if (data.alerts.lastDataAlertEvent != null) {
    const agoStr = data.alerts.lastDataAlertMinsAgo != null
      ? ` (${minsAgoLabel(data.alerts.lastDataAlertMinsAgo)})`
      : "";
    lines.push(`Last F&O data alert: ${data.alerts.lastDataAlertEvent}${agoStr}`);
  } else {
    lines.push("Last F&O data alert: None");
  }
  if (data.alerts.lastSignalAlertMinsAgo != null) {
    lines.push(`Last tradeable signal: ${minsAgoLabel(data.alerts.lastSignalAlertMinsAgo)}`);
  } else {
    lines.push("Last tradeable signal: None");
  }
  if (data.alerts.lastSwingAlertMinsAgo != null) {
    lines.push(`Last swing alert: ${minsAgoLabel(data.alerts.lastSwingAlertMinsAgo)}`);
  } else {
    lines.push("Last swing alert: None");
  }
  lines.push("Broker execution: DISABLED");

  lines.push("");
  lines.push("Source: Kite session + in-process state. Not a trading recommendation.");
  return lines.join("\n");
}

function minsAgoLabel(mins: number): string {
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m ago` : `${h}h ago`;
}

// ── Post-market data interfaces ───────────────────────────────────────────────

export interface PostMarketFno {
  tradesOpened: number;
  hcOpened: number;
  baselineOpened: number;
  tradesClosed: number;
  totalPnl: number | null;
  signalsGenerated: number;
}

export interface PostMarketSwing {
  pendingCount: number;
  approvedCount: number;
  expiredCount: number;
  stagedCount: number;
  approvalRequiredCount: number;
}

export interface PostMarketAlerts {
  lastDataAlertEvent: string | null;
  lastDataAlertIst: string | null;
  lastSignalAlertIst: string | null;
  lastSwingAlertIst: string | null;
}

export interface PostMarketReportData {
  isManualTest: boolean;
  istDate: string;
  isWeekend: boolean;
  fno: PostMarketFno | null;
  swing: PostMarketSwing | null;
  alerts: PostMarketAlerts;
}

// ── Post-market builder (pure) ────────────────────────────────────────────────

export function buildPostMarketReport(data: PostMarketReportData): string {
  const header = data.isManualTest
    ? "🌇 POST-MARKET SUMMARY [MANUAL TEST]"
    : "🌇 POST-MARKET SUMMARY";
  const lines: string[] = [header, `Date: ${data.istDate}`, ""];

  if (data.isWeekend) {
    lines.push("⚠ Weekend — no market session today.");
    lines.push("", "Source: DB paper trade records + in-process state.");
    return lines.join("\n");
  }

  lines.push("── F&O PAPER TRADES (today) ──");
  if (data.fno != null) {
    lines.push(`Opened: ${data.fno.tradesOpened} (HC: ${data.fno.hcOpened}, BASELINE: ${data.fno.baselineOpened})`);
    lines.push(`Closed: ${data.fno.tradesClosed}`);
    lines.push(`Signals generated: ${data.fno.signalsGenerated}`);
    if (data.fno.totalPnl != null) {
      const sign = data.fno.totalPnl >= 0 ? "+" : "";
      lines.push(`Realized P&L today: ₹${sign}${data.fno.totalPnl.toLocaleString("en-IN")}`);
    } else {
      lines.push("Realized P&L today: Unavailable — not tracked yet");
    }
  } else {
    lines.push("Unavailable — not tracked yet");
  }

  lines.push("");
  lines.push("── SWING STAGING ──");
  if (data.swing != null) {
    const totalActive = data.swing.stagedCount + data.swing.approvalRequiredCount + data.swing.approvedCount;
    lines.push(`Active (staged/pending/approved): ${totalActive}`);
    lines.push(`Expired today: ${data.swing.expiredCount}`);
  } else {
    lines.push("Unavailable — not tracked yet");
  }

  lines.push("");
  lines.push("── ALERT HISTORY ──");
  if (data.alerts.lastDataAlertEvent != null) {
    lines.push(`Last F&O data alert: ${data.alerts.lastDataAlertEvent}${data.alerts.lastDataAlertIst ? ` at ${data.alerts.lastDataAlertIst} IST` : ""}`);
  } else {
    lines.push("Last F&O data alert: None");
  }
  if (data.alerts.lastSignalAlertIst != null) {
    lines.push(`Last tradeable signal: ${data.alerts.lastSignalAlertIst} IST`);
  } else {
    lines.push("Last tradeable signal: None today");
  }
  if (data.alerts.lastSwingAlertIst != null) {
    lines.push(`Last swing alert: ${data.alerts.lastSwingAlertIst} IST`);
  } else {
    lines.push("Last swing alert: None today");
  }

  lines.push("");
  lines.push("Broker execution: DISABLED — no real orders placed.");
  lines.push("Source: DB paper trade records + in-process state.");
  return lines.join("\n");
}

// ── Last report records (no secrets, safe for /alerts/status) ────────────────

export interface DailyReportRecord {
  istDate: string;
  sentAt: number;
  type: "pre-market" | "post-market";
  isManualTest: boolean;
  telegramStatus: "SENT" | "STUB_NO_CONFIG" | "SEND_FAILED" | "DISPATCHED";
}

let lastPreMarketRecord: DailyReportRecord | null = null;
let lastPostMarketRecord: DailyReportRecord | null = null;

export function getLastPreMarketReportRecord(): DailyReportRecord | null {
  return lastPreMarketRecord ? { ...lastPreMarketRecord } : null;
}

export function getLastPostMarketReportRecord(): DailyReportRecord | null {
  return lastPostMarketRecord ? { ...lastPostMarketRecord } : null;
}

// ── Data gatherers (async, fail-open per section) ─────────────────────────────

export async function gatherPreMarketData(
  nowMs: number = Date.now(),
  isManualTest = false,
): Promise<PreMarketReportData> {
  const { date, datetimeStr, dayOfWeek } = istInfo(nowMs);
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  let kite: PreMarketKite;
  try {
    const status = await getActiveSessionStatus();
    const session = status.session;
    const feed = feedStatus();
    kite = {
      sessionPresent: !!session,
      user: session ? (session.userName ?? session.userId ?? null) : null,
      expiresAt: session?.expiresAt?.toISOString() ?? null,
      minsToExpiry: session?.expiresAt
        ? Math.max(0, Math.floor((new Date(session.expiresAt).getTime() - nowMs) / 60_000))
        : null,
      feedConnected: feed.connected,
      feedSubscribed: feed.subscribed,
    };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "dailyReports: gatherPreMarketData kite section failed");
    const feed = feedStatus();
    kite = {
      sessionPresent: false,
      user: null,
      expiresAt: null,
      minsToExpiry: null,
      feedConnected: feed.connected,
      feedSubscribed: feed.subscribed,
    };
  }

  let fno: PreMarketFno | null = null;
  try {
    const cycle = getLastFnoCycleState();
    if (cycle != null) {
      const cycleMinsAgo = Math.round((nowMs - cycle.ts) / 60_000);
      const isSuppressed = cycle.suppressed.length > 0 && cycle.suppressed.length === OPTION_INDICES.length;
      fno = {
        lastCycleAt: new Date(cycle.ts).toISOString(),
        cycleMinsAgo,
        indicesWithBars: cycle.indicesWithBars,
        indicesConfigured: OPTION_INDICES.length,
        signalCount: cycle.signalCount,
        suppressed: isSuppressed,
        suppressedSummary: cycle.suppressedSummary ?? "",
      };
    } else {
      fno = null;
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "dailyReports: gatherPreMarketData fno section failed");
    fno = null;
  }

  let swing: PreMarketSwing | null = null;
  try {
    const rows = (await db.execute(sql`
      SELECT status, approval_status, COUNT(*)::int AS n
      FROM swing_order_staging
      WHERE owner_key = 'owner'
        AND expires_at > NOW()
        AND status NOT IN ('EXPIRED', 'REJECTED')
      GROUP BY status, approval_status
    `)) as unknown as { rows: Array<{ status: string; approval_status: string; n: number | string }> };

    const expiredRows = (await db.execute(sql`
      SELECT COUNT(*)::int AS n
      FROM swing_order_staging
      WHERE owner_key = 'owner'
        AND status = 'EXPIRED'
        AND created_at > NOW() - INTERVAL '1 day'
    `)) as unknown as { rows: Array<{ n: number | string }> };

    let pending = 0, approvalRequired = 0, approved = 0;
    for (const row of rows.rows) {
      const n = Number(row.n);
      if (row.approval_status === "APPROVED") approved += n;
      else if (row.status === "STAGED") pending += n;
      else approvalRequired += n;
    }
    const expired = Number(expiredRows.rows[0]?.n ?? 0);
    swing = { pending, approvalRequired, approved, expired };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "dailyReports: gatherPreMarketData swing section failed");
    swing = null;
  }

  const dataAlert = getLastAlertRecord();
  const signalAlert = getLastFnoSignalAlertRecord();
  const swingAlert = getLastSwingAlertRecord();

  const alerts: PreMarketAlerts = {
    lastDataAlertEvent: dataAlert?.event ?? null,
    lastDataAlertMinsAgo: dataAlert ? Math.round((nowMs - dataAlert.at) / 60_000) : null,
    lastSignalAlertMinsAgo: signalAlert ? Math.round((nowMs - signalAlert.at) / 60_000) : null,
    lastSwingAlertMinsAgo: swingAlert ? Math.round((nowMs - swingAlert.at) / 60_000) : null,
  };

  return { isManualTest, istDatetime: datetimeStr, isWeekend, kite, fno, swing, alerts };
}

export async function gatherPostMarketData(
  nowMs: number = Date.now(),
  isManualTest = false,
): Promise<PostMarketReportData> {
  const { date, dayOfWeek } = istInfo(nowMs);
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  let fno: PostMarketFno | null = null;
  try {
    const summary = await computeDailySummaryFo(date);
    fno = {
      tradesOpened: summary.tradesOpened,
      hcOpened: summary.tradesOpenedByTier.HC,
      baselineOpened: summary.tradesOpenedByTier.BASELINE,
      tradesClosed: summary.tradesClosed,
      totalPnl: summary.pnl.total,
      signalsGenerated: summary.signalsGenerated,
    };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "dailyReports: gatherPostMarketData fno section failed");
    fno = null;
  }

  let swing: PostMarketSwing | null = null;
  try {
    const rows = (await db.execute(sql`
      SELECT status, COUNT(*)::int AS n
      FROM swing_order_staging
      WHERE owner_key = 'owner'
        AND created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY status
    `)) as unknown as { rows: Array<{ status: string; n: number | string }> };

    const counts: Record<string, number> = {};
    for (const row of rows.rows) counts[row.status] = Number(row.n);
    swing = {
      stagedCount: counts["STAGED"] ?? 0,
      approvalRequiredCount: counts["APPROVAL_REQUIRED"] ?? 0,
      approvedCount: counts["APPROVED"] ?? 0,
      expiredCount: counts["EXPIRED"] ?? 0,
      pendingCount: counts["PENDING"] ?? 0,
    };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "dailyReports: gatherPostMarketData swing section failed");
    swing = null;
  }

  const dataAlert = getLastAlertRecord();
  const signalAlert = getLastFnoSignalAlertRecord();
  const swingAlert = getLastSwingAlertRecord();

  const alerts: PostMarketAlerts = {
    lastDataAlertEvent: dataAlert?.event ?? null,
    lastDataAlertIst: dataAlert ? formatIstHM(dataAlert.at) : null,
    lastSignalAlertIst: signalAlert ? formatIstHM(signalAlert.at) : null,
    lastSwingAlertIst: swingAlert ? formatIstHM(swingAlert.at) : null,
  };

  return { isManualTest, istDate: date, isWeekend, fno, swing, alerts };
}

// ── Send helpers (gather + build + alertOwnerRaw) ─────────────────────────────

export async function sendPreMarketReport(
  nowMs: number = Date.now(),
  isManualTest = false,
): Promise<void> {
  const data = await gatherPreMarketData(nowMs, isManualTest);
  const text = buildPreMarketReport(data);
  const dedupKey = `PRE_MARKET_REPORT::${data.istDatetime.slice(0, 10)}`;
  alertOwnerRaw(dedupKey, `Pre-market readiness report (${data.istDatetime})`, text, 22 * 60 * 60_000);
  lastPreMarketRecord = {
    istDate: data.istDatetime.slice(0, 10),
    sentAt: nowMs,
    type: "pre-market",
    isManualTest,
    telegramStatus: "DISPATCHED",
  };
  logger.info({ istDatetime: data.istDatetime, isManualTest }, "dailyReports: pre-market report sent");
}

export async function sendPostMarketReport(
  nowMs: number = Date.now(),
  isManualTest = false,
): Promise<void> {
  const data = await gatherPostMarketData(nowMs, isManualTest);
  const text = buildPostMarketReport(data);
  const dedupKey = `POST_MARKET_REPORT::${data.istDate}`;
  alertOwnerRaw(dedupKey, `Post-market summary (${data.istDate})`, text, 22 * 60 * 60_000);
  lastPostMarketRecord = {
    istDate: data.istDate,
    sentAt: nowMs,
    type: "post-market",
    isManualTest,
    telegramStatus: "DISPATCHED",
  };
  logger.info({ istDate: data.istDate, isManualTest }, "dailyReports: post-market report sent");
}

// ── Scheduler latches (60s tick, same pattern as paperDailySummaryFo.ts) ──────

let lastPreMarketReportDate: string | null = null;
const PRE_MARKET_START_MIN = 8 * 60 + 50;  // 08:50 IST
const PRE_MARKET_WINDOW_MIN = 20;          // fire any time in [08:50, 09:10)

export async function maybeRunPreMarketReport(): Promise<void> {
  const { date, minOfDay, dayOfWeek } = istInfo();
  if (dayOfWeek === 0 || dayOfWeek === 6) return;
  if (minOfDay < PRE_MARKET_START_MIN || minOfDay >= PRE_MARKET_START_MIN + PRE_MARKET_WINDOW_MIN) return;
  if (lastPreMarketReportDate === date) return;
  try {
    await sendPreMarketReport(Date.now(), false);
    lastPreMarketReportDate = date;
  } catch (err) {
    logger.warn({ err: (err as Error).message, date }, "dailyReports: pre-market report failed — will retry next tick");
  }
}

let lastPostMarketReportDate: string | null = null;
const POST_MARKET_START_MIN = 15 * 60 + 45; // 15:45 IST
const POST_MARKET_WINDOW_MIN = 30;           // fire any time in [15:45, 16:15)

export async function maybeRunPostMarketReport(): Promise<void> {
  const { date, minOfDay, dayOfWeek } = istInfo();
  if (dayOfWeek === 0 || dayOfWeek === 6) return;
  if (minOfDay < POST_MARKET_START_MIN || minOfDay >= POST_MARKET_START_MIN + POST_MARKET_WINDOW_MIN) return;
  if (lastPostMarketReportDate === date) return;
  try {
    await sendPostMarketReport(Date.now(), false);
    lastPostMarketReportDate = date;
  } catch (err) {
    logger.warn({ err: (err as Error).message, date }, "dailyReports: post-market report failed — will retry next tick");
  }
}

// ── Module-load side-effect: install 60s tick ─────────────────────────────────

const REPORT_TICK_MS = 60_000;
setInterval(() => {
  void maybeRunPreMarketReport().catch(() => undefined);
  void maybeRunPostMarketReport().catch(() => undefined);
}, REPORT_TICK_MS).unref?.();
