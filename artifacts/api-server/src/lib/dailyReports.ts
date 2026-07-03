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
 *   – DB-backed dedup (`daily_report_runs` table) prevents multi-worker duplicate
 *     sends on autoscale deployments. Manual test calls bypass DB dedup.
 *
 * Telegram routing:
 *   – Pre/Post Analysis bot (PREPOST_TELEGRAM_BOT_TOKEN + PREPOST_TELEGRAM_CHAT_ID)
 *     receives: pre-market reports and post-market reports.
 *   – Default urgent bot (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)
 *     receives: F&O signal alerts, swing alerts, urgent operational alerts.
 *   – If Pre/Post bot config is missing: PREPOST_TELEGRAM_DISABLED_* status.
 *     Daily reports are NOT routed to the default bot (fail-closed separation).
 *
 * Source-honesty contract:
 *   – Missing data is shown as "Unavailable — not tracked yet" or
 *     "Unavailable — data source not integrated yet", never as 0.
 *   – The only Kite calls made during gathering are the cached, fail-open
 *     `getKiteIndexQuotes()` batch (post-market INDEX PERFORMANCE) and a
 *     read of already-captured `option_chain_snapshot` DB rows (post-market
 *     OPTION CHAIN EOD, via `computeAnalytics` — no live Kite call). Both
 *     resolve to `null` on any failure/missing session rather than showing
 *     partial or stale data as if it were live.
 *   – No trading logic, signals, paper-trade creation, or broker execution.
 *   – Telegram secrets are NEVER logged or returned from any function here.
 *
 * Weekend behaviour: skip the report on IST Saturday/Sunday.
 * Dedup: DB-backed UNIQUE(report_type, ist_date) prevents multi-worker duplicates.
 *        In-memory latch as fast-path to skip DB round-trip if already sent.
 */

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";
import { getActiveSessionStatus } from "./kiteAuth";
import { feedStatus } from "./kiteFeed";
import { getLastFnoCycleState, OPTION_INDICES } from "./optionSignals";
import { computeDailySummaryFo } from "./paperDailySummaryFo";
import { getLastAlertRecord } from "./alerting";
import { getLastSwingAlertRecord } from "./swingAlerts";
import { getLastFnoSignalAlertRecord } from "./fnoSignalAlerts";
import { getKiteIndexQuotes } from "./kiteIndexQuotes";
import { computeAnalytics, type AnalyticsRowInput } from "./optionSnapshotAnalytics";
import { SNAPSHOT_INDICES } from "./optionChainSnapshotIngestor";
import {
  sendPrePostTelegramMessage,
  getPrePostTelegramStatus,
  type PrePostTelegramConfigStatus,
} from "./alerting";

// Re-export for use by routes
export type { PrePostTelegramConfigStatus };

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

function minsAgoLabel(mins: number): string {
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m ago` : `${h}h ago`;
}

// ── DB-backed multi-worker dedup ──────────────────────────────────────────────

const WORKER_ID = `pid-${process.pid}`;
let tableReady = false;

/**
 * Idempotent table creation — uses raw SQL (NOT drizzle-kit push, which would
 * drop out-of-schema tables). Safe to call on every server start.
 */
export async function ensureDailyReportRunsTable(): Promise<void> {
  if (tableReady) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS daily_report_runs (
        id SERIAL PRIMARY KEY,
        report_type TEXT NOT NULL,
        ist_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        worker_id TEXT,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        sent_at TIMESTAMPTZ,
        telegram_status TEXT,
        error_code TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(report_type, ist_date)
      )
    `);
    tableReady = true;
    logger.info({ worker: WORKER_ID }, "dailyReports: daily_report_runs table ready");
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "dailyReports: failed to ensure daily_report_runs table");
  }
}

/**
 * Attempt to claim a scheduled report run via INSERT ON CONFLICT DO NOTHING.
 * Returns true if THIS worker claimed it, false if another worker already did.
 * Fail-open: if DB is unavailable, returns true (allows send to proceed).
 *
 * Exported for unit testing (multi-worker dedup contract).
 */
export async function tryClaimScheduledReport(reportType: string, istDate: string): Promise<boolean> {
  try {
    const result = (await db.execute(sql`
      INSERT INTO daily_report_runs (report_type, ist_date, worker_id, status)
      VALUES (${reportType}, ${istDate}, ${WORKER_ID}, 'CLAIMED')
      ON CONFLICT (report_type, ist_date) DO NOTHING
      RETURNING id
    `)) as unknown as { rows: Array<{ id: number }> };
    return result.rows.length > 0;
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, reportType, istDate },
      "dailyReports: DB dedup claim failed — proceeding fail-open",
    );
    return true;
  }
}

async function updateReportRunStatus(
  reportType: string,
  istDate: string,
  status: string,
  telegramStatus: string | null,
  errorCode: string | null,
): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE daily_report_runs
      SET status = ${status},
          sent_at = CASE WHEN ${status} = 'SENT' THEN NOW() ELSE sent_at END,
          telegram_status = ${telegramStatus},
          error_code = ${errorCode},
          updated_at = NOW()
      WHERE report_type = ${reportType}
        AND ist_date = ${istDate}
        AND worker_id = ${WORKER_ID}
    `);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "dailyReports: failed to update report run status");
  }
}

// ── Data coverage matrix ──────────────────────────────────────────────────────

export type DataCoverageStatus =
  | "AVAILABLE"
  | "STALE"
  | "UNAVAILABLE"
  | "SOURCE_NOT_INTEGRATED"
  | "INFO_ONLY"
  | "TRADE_GRADE";

export interface DataCoverageEntry {
  status: DataCoverageStatus;
  source: string | null;
  note: string;
}

/**
 * Honest data availability map for every section in the pre/post market analysis.
 * AVAILABLE = current app tracks this from a trusted source.
 * INFO_ONLY = data exists but is not trade-grade (Yahoo, NSE archive, etc.).
 * SOURCE_NOT_INTEGRATED = data point requires a new provider not yet integrated.
 */
export const DAILY_ANALYSIS_COVERAGE: Record<string, DataCoverageEntry> = {
  // Pre-market
  overnightGlobalCues: {
    status: "INFO_ONLY",
    source: "yahoo-finance",
    note: "US/Asia/Europe indices via Yahoo Finance — delayed, not trade-grade; sourced from global scanner",
  },
  giftNifty: {
    status: "SOURCE_NOT_INTEGRATED",
    source: null,
    note: "GIFT Nifty / SGX Nifty not tracked — no integration with NSE IFSC or Bloomberg",
  },
  fiiDiiCash: {
    status: "INFO_ONLY",
    source: "nse-archive",
    note: "NSE FII/DII cash daily flows — info-only; available via /api/inst/fii-dii",
  },
  fiiDiiFno: {
    status: "SOURCE_NOT_INTEGRATED",
    source: null,
    note: "FII F&O index futures / options participant data not tracked in real-time",
  },
  participantOi: {
    status: "INFO_ONLY",
    source: "nse-archive",
    note: "NSE participant OI CSV — info-only; available via /api/inst/participant-oi",
  },
  indiaVix: {
    status: "SOURCE_NOT_INTEGRATED",
    source: null,
    note: "India VIX not separately tracked; ATM IV available via option chain snapshot",
  },
  keyLevelsOhlc: {
    status: "AVAILABLE",
    source: "kite",
    note: "Previous day OHLC from Kite historical data — available if Kite session active",
  },
  cprPivots: {
    status: "AVAILABLE",
    source: "computed",
    note: "CPR and classic floor pivots computed from Kite OHLC — see /premarket for full display",
  },
  optionChainAnalytics: {
    status: "AVAILABLE",
    source: "kite",
    note: "PCR, max pain, OI walls via Kite option chain snapshot — see /option-chain",
  },
  expectedRange: {
    status: "AVAILABLE",
    source: "kite",
    note: "ATM straddle premium and VIX-implied range from Kite option chain snapshot",
  },
  newsEvents: {
    status: "SOURCE_NOT_INTEGRATED",
    source: null,
    note: "Domestic/global news and events calendar not integrated — no provider configured",
  },
  expiryRollover: {
    status: "AVAILABLE",
    source: "kite",
    note: "Expiry check from Kite F&O instruments master — weekly/monthly expiry dates",
  },
  biasTradePlan: {
    status: "INFO_ONLY",
    source: "computed",
    note: "Bias derived from available data (F&O readiness, session state); not a trading recommendation",
  },
  // Post-market
  indexPerformance: {
    status: "AVAILABLE",
    source: "kite",
    note: "Today OHLCV from Kite historical data — available if session active",
  },
  marketBreadth: {
    status: "SOURCE_NOT_INTEGRATED",
    source: null,
    note: "NSE advance/decline, 52-week high/low not tracked — no integration",
  },
  optionChainEod: {
    status: "AVAILABLE",
    source: "kite",
    note: "EOD OI change, PCR shift, max pain shift from option chain snapshots",
  },
  levelValidation: {
    status: "SOURCE_NOT_INTEGRATED",
    source: null,
    note: "CPR/VWAP validation requires intraday VWAP tracking — not implemented",
  },
  sectorMoves: {
    status: "INFO_ONLY",
    source: "scanner",
    note: "Scanner sector data — info-only, not trade-grade",
  },
  newsRecap: {
    status: "SOURCE_NOT_INTEGRATED",
    source: null,
    note: "News recap requires a news provider — not integrated",
  },
  globalStatusCheck: {
    status: "INFO_ONLY",
    source: "yahoo-finance",
    note: "US futures / European closing data via Yahoo Finance — delayed, not trade-grade",
  },
  tradeJournal: {
    status: "AVAILABLE",
    source: "db",
    note: "Paper trade daily summary from DB — F&O paper trade outcomes for the session",
  },
  tomorrowSetup: {
    status: "INFO_ONLY",
    source: "computed",
    note: "Preliminary setup derived from available data; not a trading recommendation",
  },
};

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
  const kiteOk = data.kite.sessionPresent;
  const headline = kiteOk ? "🌅 PRE-MARKET STATUS" : "🌅 PRE-MARKET STATUS — ACTION REQUIRED";
  const header = data.isManualTest ? `${headline} [MANUAL TEST]` : headline;
  const lines: string[] = [header, `Date: ${data.istDatetime} IST`, ""];

  if (data.isWeekend) {
    lines.push("⚠ Weekend — markets closed today.");
    lines.push("No F&O or swing activity expected.");
    lines.push("", "Source: Kite session + in-process state. Not a trading recommendation.");
    return lines.join("\n");
  }

  // ── Compact operational status (docs/telegram-alert-quality-audit-2026-07-03.md §3) ──
  // Every SOURCE_NOT_INTEGRATED section (overnight cues, GIFT Nifty, FII/DII F&O, India
  // VIX, VIX-implied range, news/events) is collapsed to one footer line below instead of
  // a full inline header per section — same honesty, far less noise. Full per-section
  // detail remains on /daily-analysis and /premarket; Telegram is a notification, not the
  // full report.

  if (kiteOk) {
    lines.push(`Kite: ✅ Active${data.kite.user ? ` (${data.kite.user})` : ""}`);
    lines.push(`Feed: ${data.kite.feedConnected ? "✅ Connected" : "⚠ Disconnected"} (${data.kite.feedSubscribed} tokens)`);
  } else {
    lines.push("Kite: ❌ MISSING — login required");
  }

  if (data.fno == null) {
    lines.push("F&O readiness: Unavailable — not tracked yet");
  } else {
    const { indicesWithBars: bars, indicesConfigured: cfg } = data.fno;
    if (data.fno.suppressed) {
      const reason = data.fno.suppressedSummary ? ` — ${data.fno.suppressedSummary}` : "";
      lines.push(`F&O readiness: ⚠ SUPPRESSED (${bars}/${cfg} indices)${reason}`);
    } else if (bars === cfg) {
      lines.push(`F&O readiness: ✅ Ready (${bars}/${cfg} indices, daily bars + option chain)`);
    } else if (bars > 0) {
      lines.push(`F&O readiness: ⚠ Partial (${bars}/${cfg} indices)`);
    } else {
      lines.push(`F&O readiness: ❌ Blocked (0/${cfg} indices)`);
    }
    if (data.fno.lastCycleAt != null) {
      lines.push(`Signals emitted: ${data.fno.signalCount}`);
    }
  }

  if (data.swing != null) {
    lines.push(`Swing staging: ${data.swing.pending + data.swing.approvalRequired} pending`);
  } else {
    lines.push("Swing staging: Unavailable — not tracked yet");
  }

  lines.push("");
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

  lines.push("");
  // FII/DII cash + participant OI is real (INFO_ONLY, NSE-archive) data — stays in the
  // body per §3. Key levels / option chain need a live Kite session, so only claim
  // availability when Kite is actually up (data-authenticity: don't imply live data from
  // a dead session).
  lines.push("FII/DII cash: Info-only (NSE archive) — see /flows page");
  if (kiteOk) {
    lines.push("Key levels: Available on /premarket");
    lines.push("Option chain: Available on /option-chain");
  }

  lines.push("");
  if (!kiteOk) {
    lines.push("Action: Reconnect Kite/Zerodha at /kite-login before market open.");
  } else if (data.fno != null && (data.fno.suppressed || data.fno.indicesWithBars < data.fno.indicesConfigured)) {
    lines.push("Action: Check /fno-diagnostics");
  } else {
    lines.push("Action: Monitor /fno-diagnostics and /option-chain");
  }

  lines.push("");
  lines.push(
    "Not included today: GIFT Nifty, overnight global cues, FII/DII (F&O), India VIX, " +
      "news/events — provider not configured.",
  );

  lines.push("");
  lines.push("Broker execution: DISABLED");
  lines.push("Source: Kite session + in-process state. Not a trading recommendation.");
  return lines.join("\n");
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

export interface PostMarketIndexRow {
  name: string;
  close: number;
  changePct: number;
  high: number | null;
  low: number | null;
}

export interface PostMarketIndexPerformance {
  rows: PostMarketIndexRow[];
  /** HH:mm IST of the freshest row included — null if unavailable. */
  asOfIst: string | null;
}

export interface PostMarketOptionChainRow {
  underlying: string;
  expiry: string;          // ISO date (YYYY-MM-DD)
  pcr: number | null;
  maxPainStrike: number | null;
  ceOiChange: number | null;
  peOiChange: number | null;
  capturedAtIst: string;   // HH:mm IST of the snapshot used
}

export interface PostMarketOptionChainEod {
  rows: PostMarketOptionChainRow[];
}

export interface PostMarketReportData {
  isManualTest: boolean;
  istDate: string;         // ISO YYYY-MM-DD — used for API/status/history/dedup
  datetimeStr?: string;    // DD MMM YYYY HH:mm — Telegram display (optional; falls back to istDate)
  isWeekend: boolean;
  fno: PostMarketFno | null;
  swing: PostMarketSwing | null;
  alerts: PostMarketAlerts;
  indexPerformance: PostMarketIndexPerformance | null;
  optionChainEod: PostMarketOptionChainEod | null;
}

// ── Post-market builder (pure) ────────────────────────────────────────────────

export function buildPostMarketReport(data: PostMarketReportData): string {
  const header = data.isManualTest
    ? "🌇 POST-MARKET SUMMARY [MANUAL TEST]"
    : "🌇 POST-MARKET SUMMARY";
  // Telegram shows human-readable datetime; API/status/history always use ISO istDate
  const displayDate = data.datetimeStr != null ? `${data.datetimeStr} IST` : data.istDate;
  const lines: string[] = [header, `Date: ${displayDate}`, ""];

  if (data.isWeekend) {
    lines.push("⚠ Weekend — no market session today.");
    lines.push("", "Source: DB paper trade records + in-process state.");
    return lines.join("\n");
  }

  // ── ANALYSIS SECTIONS (data availability honest labels) ──

  lines.push("── INDEX PERFORMANCE ──");
  if (data.indexPerformance != null && data.indexPerformance.rows.length > 0) {
    for (const r of data.indexPerformance.rows) {
      const sign = r.changePct >= 0 ? "+" : "";
      const hi = r.high != null ? r.high.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—";
      const lo = r.low != null ? r.low.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—";
      lines.push(
        `${r.name}: ${r.close.toLocaleString("en-IN", { maximumFractionDigits: 2 })} ` +
          `(${sign}${r.changePct.toFixed(2)}%) H ${hi} L ${lo}`,
      );
    }
    if (data.indexPerformance.asOfIst != null) {
      lines.push(`(Kite, as of ${data.indexPerformance.asOfIst} IST)`);
    }
  } else {
    lines.push("Index performance: Unavailable — Kite session not active");
  }

  lines.push("");
  lines.push("── MARKET BREADTH ──");
  lines.push("Market breadth (adv/dec): Unavailable — data source not integrated yet");
  lines.push("(NSE advance/decline, 52-week highs/lows, DMA breadth not tracked)");

  lines.push("");
  lines.push("── FII / DII ACTIVITY ──");
  lines.push("FII/DII cash flows: Info-only (NSE archive) — see /flows page");
  lines.push("F&O participant data: Unavailable — data source not integrated yet");

  lines.push("");
  lines.push("── PARTICIPANT OI CHANGE ──");
  lines.push("FII / DII / Pro / Client OI: Unavailable — data source not integrated yet");
  lines.push("(NSE participant OI CSV: info-only, see /flows page)");

  lines.push("");
  lines.push("── OPTION CHAIN EOD ──");
  if (data.optionChainEod != null && data.optionChainEod.rows.length > 0) {
    for (const r of data.optionChainEod.rows) {
      const pcr = r.pcr != null ? r.pcr.toFixed(2) : "—";
      const maxPain = r.maxPainStrike != null ? r.maxPainStrike.toLocaleString("en-IN") : "—";
      const ceOi = r.ceOiChange != null ? r.ceOiChange.toLocaleString("en-IN") : "—";
      const peOi = r.peOiChange != null ? r.peOiChange.toLocaleString("en-IN") : "—";
      lines.push(
        `${r.underlying} (${r.expiry}): PCR ${pcr} | Max Pain ${maxPain} | ` +
          `ΔOI CE ${ceOi} / PE ${peOi} · ${r.capturedAtIst} IST`,
      );
    }
  } else {
    lines.push("Option chain EOD: Unavailable — no option-chain snapshots captured today");
  }

  lines.push("");
  lines.push("── LEVEL VALIDATION ──");
  lines.push("Level validation (CPR/VWAP): Unavailable — data source not integrated yet");
  lines.push("(Intraday VWAP tracking not implemented)");

  lines.push("");
  lines.push("── SECTOR MOVES ──");
  lines.push("Sector moves: Info-only (scanner) — see /sectors page");
  lines.push("(Not trade-grade; delayed data)");

  lines.push("");
  lines.push("── NEWS RECAP ──");
  lines.push("News recap: Unavailable — data source not integrated yet");
  lines.push("(No news provider configured)");

  lines.push("");
  lines.push("── GLOBAL STATUS CHECK ──");
  lines.push("Global status check: Info-only (Yahoo Finance delayed)");
  lines.push("US futures / Europe close: see /global for reference (not trade-grade)");

  // ── OPERATIONAL SECTIONS (live DB / in-process state) ──

  lines.push("");
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
  lines.push("── TRADE JOURNAL TIE-IN ──");
  if (data.fno != null) {
    if (data.fno.tradesOpened > 0) {
      const pnlStr = data.fno.totalPnl != null
        ? `₹${data.fno.totalPnl >= 0 ? "+" : ""}${data.fno.totalPnl.toLocaleString("en-IN")}`
        : "P&L unavailable";
      lines.push(`Session: ${data.fno.tradesOpened} trade(s) opened, ${data.fno.tradesClosed} closed`);
      lines.push(`Realized P&L: ${pnlStr}`);
    } else {
      lines.push("No F&O paper trades opened today");
    }
  } else {
    lines.push("Trade data: Unavailable — not tracked yet");
  }

  lines.push("");
  lines.push("── TOMORROW SETUP ──");
  if (data.fno != null && data.fno.signalsGenerated > 0) {
    lines.push(`F&O signals generated today: ${data.fno.signalsGenerated}`);
  }
  lines.push("Key levels / option chain: Available (Kite) — check /premarket and /option-chain");
  lines.push("Expiry / news events: See /fno-diagnostics");
  lines.push("(Preliminary bias not automated — based on available data above)");

  lines.push("");
  lines.push("Broker execution: DISABLED — no real orders placed.");
  lines.push("Source: DB paper trade records + in-process state.");
  return lines.join("\n");
}

// ── Last report records (no secrets, safe for status endpoints) ───────────────

export interface DailyReportRecord {
  istDate: string;
  sentAt: number;
  type: "pre-market" | "post-market";
  isManualTest: boolean;
  telegramStatus: string;
  telegramDestination: "prepost";
  prepostConfigStatus: string;
}

let lastPreMarketRecord: DailyReportRecord | null = null;
let lastPostMarketRecord: DailyReportRecord | null = null;

export function getLastPreMarketReportRecord(): DailyReportRecord | null {
  return lastPreMarketRecord ? { ...lastPreMarketRecord } : null;
}

export function getLastPostMarketReportRecord(): DailyReportRecord | null {
  return lastPostMarketRecord ? { ...lastPostMarketRecord } : null;
}

// ── Report history (DB query — no secrets) ────────────────────────────────────

export interface ReportRunRow {
  reportType: string;
  istDate: string;
  status: string;
  workerId: string | null;
  startedAt: string;
  sentAt: string | null;
  telegramStatus: string | null;
  errorCode: string | null;
  createdAt: string;
}

export async function getReportHistory(limit = 30): Promise<ReportRunRow[]> {
  try {
    const result = (await db.execute(sql`
      SELECT report_type, ist_date, status, worker_id, started_at, sent_at,
             telegram_status, error_code, created_at
      FROM daily_report_runs
      ORDER BY created_at DESC
      LIMIT ${limit}
    `)) as unknown as { rows: Array<Record<string, unknown>> };
    return result.rows.map(r => ({
      reportType: String(r["report_type"] ?? ""),
      istDate: String(r["ist_date"] ?? ""),
      status: String(r["status"] ?? ""),
      workerId: r["worker_id"] != null ? String(r["worker_id"]) : null,
      startedAt: String(r["started_at"] ?? ""),
      sentAt: r["sent_at"] != null ? String(r["sent_at"]) : null,
      telegramStatus: r["telegram_status"] != null ? String(r["telegram_status"]) : null,
      errorCode: r["error_code"] != null ? String(r["error_code"]) : null,
      createdAt: String(r["created_at"] ?? ""),
    }));
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "dailyReports: failed to query report history — table may not exist yet");
    return [];
  }
}

// ── Data gatherers (async, fail-open per section) ─────────────────────────────

export async function gatherPreMarketData(
  nowMs: number = Date.now(),
  isManualTest = false,
): Promise<PreMarketReportData> {
  const { datetimeStr, dayOfWeek } = istInfo(nowMs);
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
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "dailyReports: gatherPreMarketData fno section failed");
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
  const { date, dayOfWeek, datetimeStr } = istInfo(nowMs);
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
  }

  const INDEX_PERFORMANCE_KEYS: Array<{ yahoo: string; name: string }> = [
    { yahoo: "^NSEI", name: "NIFTY 50" },
    { yahoo: "^NSEBANK", name: "NIFTY BANK" },
    { yahoo: "^BSESN", name: "SENSEX" },
  ];

  let indexPerformance: PostMarketIndexPerformance | null = null;
  try {
    const quotes = await getKiteIndexQuotes();
    if (quotes != null) {
      const rows: PostMarketIndexRow[] = [];
      let latestAsOf: number | null = null;
      for (const k of INDEX_PERFORMANCE_KEYS) {
        const q = quotes.get(k.yahoo);
        if (q == null) continue; // never fabricate a missing row
        rows.push({
          name: k.name,
          close: q.price,
          changePct: q.changePercent,
          high: q.high ?? null,
          low: q.low ?? null,
        });
        if (latestAsOf == null || q.asOf > latestAsOf) latestAsOf = q.asOf;
      }
      if (rows.length > 0) {
        indexPerformance = { rows, asOfIst: latestAsOf != null ? formatIstHM(latestAsOf) : null };
      }
    }
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      "dailyReports: gatherPostMarketData index performance section failed",
    );
  }

  let optionChainEod: PostMarketOptionChainEod | null = null;
  try {
    // IST-day boundary — same pattern as routes/optionChainSnapshot.ts diagnostics.
    const istNowMs = nowMs + 5.5 * 60 * 60_000;
    const istDayStart = new Date(Math.floor(istNowMs / 86_400_000) * 86_400_000 - 5.5 * 60 * 60_000);

    const groups = (await db.execute(sql`
      WITH today_snaps AS (
        SELECT underlying, expiry, captured_at
        FROM option_chain_snapshot
        WHERE underlying = ANY(ARRAY[${sql.join(SNAPSHOT_INDICES.map((u) => sql`${u}`), sql`, `)}])
          AND captured_at >= ${istDayStart.toISOString()}
      ),
      front_expiry AS (
        SELECT underlying, MIN(expiry) AS expiry
        FROM today_snaps
        GROUP BY underlying
      ),
      latest_capture AS (
        SELECT t.underlying, t.expiry, MAX(t.captured_at) AS captured_at
        FROM today_snaps t
        JOIN front_expiry f ON f.underlying = t.underlying AND f.expiry = t.expiry
        GROUP BY t.underlying, t.expiry
      )
      SELECT underlying, expiry::text AS expiry, captured_at
      FROM latest_capture
      ORDER BY underlying;
    `)) as unknown as { rows: Array<{ underlying: string; expiry: string; captured_at: string }> };

    const rows: PostMarketOptionChainRow[] = [];
    for (const g of groups.rows) {
      const legs = (await db.execute(sql`
        SELECT strike, opt_type, oi, oi_change, ltp, iv, bid, ask, spot, atm_strike
        FROM option_chain_snapshot
        WHERE underlying = ${g.underlying}
          AND expiry = ${g.expiry}
          AND captured_at = ${g.captured_at}
      `)) as unknown as {
        rows: Array<{
          strike: string | number;
          opt_type: "CE" | "PE";
          oi: string | number | null;
          oi_change: string | number | null;
          ltp: string | number | null;
          iv: string | number | null;
          bid: string | number | null;
          ask: string | number | null;
          spot: string | number | null;
          atm_strike: string | number | null;
        }>;
      };
      if (legs.rows.length === 0) continue;

      const toNum = (v: string | number | null): number | null => (v == null ? null : Number(v));
      const inputs: AnalyticsRowInput[] = legs.rows.map((r) => ({
        strike: Number(r.strike),
        optType: r.opt_type,
        oi: toNum(r.oi),
        oiChange: toNum(r.oi_change),
        ltp: toNum(r.ltp),
        iv: toNum(r.iv),
        bid: toNum(r.bid),
        ask: toNum(r.ask),
        spot: toNum(r.spot),
        atmStrike: toNum(r.atm_strike),
      }));
      const analytics = computeAnalytics(inputs);
      rows.push({
        underlying: g.underlying,
        expiry: g.expiry,
        pcr: analytics.pcr,
        maxPainStrike: analytics.maxPainStrike,
        ceOiChange: analytics.ceOiChange,
        peOiChange: analytics.peOiChange,
        capturedAtIst: formatIstHM(new Date(g.captured_at).getTime()),
      });
    }
    if (rows.length > 0) optionChainEod = { rows };
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      "dailyReports: gatherPostMarketData option chain EOD section failed",
    );
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

  return {
    isManualTest,
    istDate: date,
    datetimeStr,
    isWeekend,
    fno,
    swing,
    alerts,
    indexPerformance,
    optionChainEod,
  };
}

// ── Send helpers (gather + build + PREPOST bot send + DB dedup) ───────────────

export type ReportSendResult = "SENT" | "DEDUP_SKIPPED" | "SEND_FAILED" | "CONFIG_MISSING" | "DISPATCHED";

function toReportSendResult(sendResult: string): ReportSendResult {
  if (sendResult === "SENT") return "SENT";
  if (sendResult.startsWith("PREPOST_TELEGRAM_DISABLED")) return "CONFIG_MISSING";
  return "SEND_FAILED";
}

/**
 * Gather data, build the pre-market report, send to PREPOST Telegram bot.
 *
 * @param isManualTest  If true, bypasses DB dedup (manual test still rate-limited by route).
 * @returns "SENT" | "DEDUP_SKIPPED" | "SEND_FAILED" | "CONFIG_MISSING"
 */
export async function sendPreMarketReport(
  nowMs: number = Date.now(),
  isManualTest = false,
): Promise<ReportSendResult> {
  const data = await gatherPreMarketData(nowMs, isManualTest);
  const text = buildPreMarketReport(data);
  const { date: istDate } = istInfo(nowMs);

  if (!isManualTest) {
    const claimed = await tryClaimScheduledReport("PRE_MARKET", istDate);
    if (!claimed) {
      logger.info(
        { istDate, worker: WORKER_ID },
        "dailyReports: pre-market report already claimed by another worker — skipping",
      );
      return "DEDUP_SKIPPED";
    }
  }

  const sendResult = await sendPrePostTelegramMessage(text);
  const result = toReportSendResult(sendResult);

  if (!isManualTest) {
    await updateReportRunStatus(
      "PRE_MARKET",
      istDate,
      result === "SENT" ? "SENT" : "FAILED",
      sendResult,
      result !== "SENT" ? sendResult : null,
    );
  }

  const prepostStatus = getPrePostTelegramStatus();
  lastPreMarketRecord = {
    istDate,
    sentAt: nowMs,
    type: "pre-market",
    isManualTest,
    telegramStatus: sendResult,
    telegramDestination: "prepost",
    prepostConfigStatus: prepostStatus.status,
  };

  logger.info(
    { istDatetime: data.istDatetime, isManualTest, telegramStatus: sendResult, telegramDestination: "prepost" },
    "dailyReports: pre-market report sent",
  );
  return result;
}

/**
 * Gather data, build the post-market report, send to PREPOST Telegram bot.
 *
 * @param isManualTest  If true, bypasses DB dedup (manual test still rate-limited by route).
 * @returns "SENT" | "DEDUP_SKIPPED" | "SEND_FAILED" | "CONFIG_MISSING"
 */
export async function sendPostMarketReport(
  nowMs: number = Date.now(),
  isManualTest = false,
): Promise<ReportSendResult> {
  const data = await gatherPostMarketData(nowMs, isManualTest);
  const text = buildPostMarketReport(data);
  const istDate = data.istDate;

  if (!isManualTest) {
    const claimed = await tryClaimScheduledReport("POST_MARKET", istDate);
    if (!claimed) {
      logger.info(
        { istDate, worker: WORKER_ID },
        "dailyReports: post-market report already claimed by another worker — skipping",
      );
      return "DEDUP_SKIPPED";
    }
  }

  const sendResult = await sendPrePostTelegramMessage(text);
  const result = toReportSendResult(sendResult);

  if (!isManualTest) {
    await updateReportRunStatus(
      "POST_MARKET",
      istDate,
      result === "SENT" ? "SENT" : "FAILED",
      sendResult,
      result !== "SENT" ? sendResult : null,
    );
  }

  const prepostStatus = getPrePostTelegramStatus();
  lastPostMarketRecord = {
    istDate,
    sentAt: nowMs,
    type: "post-market",
    isManualTest,
    telegramStatus: sendResult,
    telegramDestination: "prepost",
    prepostConfigStatus: prepostStatus.status,
  };

  logger.info(
    { istDate, isManualTest, telegramStatus: sendResult, telegramDestination: "prepost" },
    "dailyReports: post-market report sent",
  );
  return result;
}

// ── Scheduler latches (60s tick, same pattern as paperDailySummaryFo.ts) ──────

let lastPreMarketReportDate: string | null = null;
const PRE_MARKET_START_MIN = 8 * 60 + 50;  // 08:50 IST
const PRE_MARKET_WINDOW_MIN = 20;          // fire any time in [08:50, 09:10)

export async function maybeRunPreMarketReport(): Promise<void> {
  const { date, minOfDay, dayOfWeek } = istInfo();
  if (dayOfWeek === 0 || dayOfWeek === 6) return;
  if (minOfDay < PRE_MARKET_START_MIN || minOfDay >= PRE_MARKET_START_MIN + PRE_MARKET_WINDOW_MIN) return;
  if (lastPreMarketReportDate === date) return; // fast in-memory dedup
  try {
    const result = await sendPreMarketReport(Date.now(), false);
    // Set latch regardless — SENT, DEDUP_SKIPPED, or even CONFIG_MISSING all mean
    // this date's window is done for this worker. Only retry on actual send failure.
    if (result !== "SEND_FAILED") {
      lastPreMarketReportDate = date;
    }
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
  if (lastPostMarketReportDate === date) return; // fast in-memory dedup
  try {
    const result = await sendPostMarketReport(Date.now(), false);
    if (result !== "SEND_FAILED") {
      lastPostMarketReportDate = date;
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message, date }, "dailyReports: post-market report failed — will retry next tick");
  }
}

// ── Module-load side-effect: ensure table + install 60s tick ─────────────────

void ensureDailyReportRunsTable().catch(() => undefined);

const REPORT_TICK_MS = 60_000;
setInterval(() => {
  void maybeRunPreMarketReport().catch(() => undefined);
  void maybeRunPostMarketReport().catch(() => undefined);
}, REPORT_TICK_MS).unref?.();
