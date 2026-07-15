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
 *   – The only Kite calls made during gathering are the report-grade,
 *     fail-open `getReportGradeIndexQuotes()` facade (post-market INDEX
 *     PERFORMANCE — see `lib/marketData/reportGradeIndexQuotes.ts`) and a
 *     read of already-captured `option_chain_snapshot` DB rows (post-market
 *     OPTION CHAIN EOD, via `computeAnalytics` — no live Kite call). Both
 *     resolve to `null`/unavailable on any failure/missing session rather
 *     than showing partial or stale data as if it were live. The
 *     report-grade facade never returns trade-grade data (`tradeGrade`,
 *     `canDriveSignals`, `canDrivePaperTrades` are hard-`false`) and never
 *     fabricates a live quote — it accepts today's close snapshot even past
 *     the 10-minute trade-grade hard-stale budget, but refuses anything
 *     older than today's session.
 *   – No trading logic, signals, paper-trade creation, or broker execution.
 *   – Telegram secrets are NEVER logged or returned from any function here.
 *
 * Weekend behaviour: skip the report on IST Saturday/Sunday.
 * Dedup: DB-backed UNIQUE(report_type, ist_date) prevents multi-worker duplicates.
 *        In-memory latch as fast-path to skip DB round-trip if already sent.
 */

import { sql } from "drizzle-orm";
import { getFiiDiiMonthly } from "./instFlows";
import { db } from "@workspace/db";
import { logger } from "./logger";
import { getActiveSessionStatus } from "./kiteAuth";
import { feedStatus } from "./kiteFeed";
import { computeDailySummaryFo } from "./paperDailySummaryFo";
import { getReportGradeIndexQuotes, REPORT_INDEX_KEYS } from "./marketData/reportGradeIndexQuotes";
import { computeAnalytics, type AnalyticsRowInput } from "./optionSnapshotAnalytics";
import { SNAPSHOT_INDICES } from "./optionChainSnapshotIngestor";
import {
  getCanonicalFnoReadiness,
  deriveFnoReadinessLabel,
  type CanonicalFnoReadiness,
} from "./canonicalFnoReadiness";
import { getFnoExitMonitorHealth } from "./fnoExitMonitorHealth";
import {
  sendPrePostTelegramMessage,
  getPrePostTelegramStatus,
  type PrePostTelegramConfigStatus,
} from "./alerting";

// Re-export for use by routes / tests
export type { CanonicalFnoReadiness };

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
    const insert = (await db.execute(sql`
      INSERT INTO daily_report_runs (report_type, ist_date, worker_id, status)
      VALUES (${reportType}, ${istDate}, ${WORKER_ID}, 'CLAIMED')
      ON CONFLICT (report_type, ist_date) DO NOTHING
      RETURNING id
    `)) as unknown as { rows: Array<{ id: number }> };
    if (insert.rows.length > 0) return true;

    // Row already exists. Allow retry if it previously FAILED (e.g. transient Telegram TIMEOUT).
    // A SENT row stays deduped — once successfully sent, never re-send.
    const retry = (await db.execute(sql`
      UPDATE daily_report_runs
      SET status         = 'CLAIMED',
          worker_id      = ${WORKER_ID},
          error_code     = NULL,
          telegram_status = NULL,
          updated_at     = NOW()
      WHERE report_type = ${reportType}
        AND ist_date    = ${istDate}
        AND status      = 'FAILED'
      RETURNING id
    `)) as unknown as { rows: Array<{ id: number }> };
    if (retry.rows.length > 0) {
      logger.info(
        { reportType, istDate, worker: WORKER_ID },
        "dailyReports: retrying FAILED report run — previous attempt had a transient error",
      );
    }
    return retry.rows.length > 0;
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

export interface PreMarketSwing {
  pending: number;
  approvalRequired: number;
  approved: number;
  expired: number;
  /** paper_trade_eq rows opened today with source=SWING_STAGED_APPROVAL. */
  openedToday: number;
  /** paper_trade_eq rows closed today with source=SWING_STAGED_APPROVAL. */
  closedToday: number;
  /** swing_order_staging rows that failed re-check today (RECHECK_BLOCKED). */
  blockedToday: number;
  /** Always 0 — notification failure tracking is in-memory only (no DB counter yet). */
  notificationFailures: number;
}

/** INFO_ONLY: FII/DII cash net flows from NSE archive (previous day). */
export interface PreMarketFiiDii {
  date: string;         // YYYY-MM-DD of the latest available row
  fiiNetCr: number;     // ₹ Cr net (buy − sell); negative = net seller
  diiNetCr: number;
}

export interface PreMarketReportData {
  isManualTest: boolean;
  istDatetime: string;
  isWeekend: boolean;
  kite: PreMarketKite;
  /** Checkpoint 1 Part C — replaces the old ad-hoc `fno` cycle summary. Single
   *  honest source of truth for F&O data readiness; null only if the async
   *  gatherer itself failed (fail-open — never fabricated). */
  canonicalFno: CanonicalFnoReadiness | null;
  swing: PreMarketSwing | null;
  /** INFO_ONLY: latest FII/DII cash net from NSE archive. Null when DB has no rows. */
  fiiDii?: PreMarketFiiDii | null;
}

// ── Pre-market builder (pure — no async, no imports, fully testable) ──────────

export function buildPreMarketReport(data: PreMarketReportData): string {
  const header = data.isManualTest ? "PRE-MARKET STATUS [MANUAL TEST]" : "PRE-MARKET STATUS";
  const lines: string[] = [header, `Date: ${data.istDatetime} IST`, ""];

  if (data.isWeekend) {
    lines.push("Weekend — markets closed today.");
    lines.push("No F&O or swing activity expected.");
    lines.push("", "Broker execution: DISABLED");
    return lines.join("\n");
  }

  // ── Checkpoint 1 Part C ──────────────────────────────────────────────────
  // F&O readiness is sourced ENTIRELY from CanonicalFnoReadiness (Part B) —
  // never fabricated, never "not tracked yet" when readiness actually exists.
  // SOURCE_NOT_INTEGRATED providers (GIFT Nifty, live global cues, India VIX,
  // news/events) are collapsed into the single "Not included" footer instead
  // of full inline sections. Full per-section detail stays on /daily-analysis
  // and /premarket — Telegram is a notification, not the full report.
  const r = data.canonicalFno;
  let readinessLabel: ReturnType<typeof deriveFnoReadinessLabel> | null = null;

  if (r == null) {
    lines.push(`Kite: ${data.kite.sessionPresent ? "ACTIVE" : "MISSING"}`);
    lines.push(`Feed: ${data.kite.feedConnected ? "CONNECTED" : "DISCONNECTED"}`);
    lines.push("F&O readiness: UNKNOWN — canonical readiness check failed this run");
  } else {
    readinessLabel = deriveFnoReadinessLabel(r);
    lines.push(`Kite: ${r.kiteSession}`);
    lines.push(`Feed: ${r.feedStatus}`);
    lines.push(`Market mode: ${r.marketSession}`);
    lines.push(`F&O readiness: ${readinessLabel}`);
    lines.push(`Daily bars: ${r.dailyBars.readyCount}/${r.dailyBars.totalCount}`);
    const intradayReason = r.intradayBars.reason ? ` — ${r.intradayBars.reason}` : "";
    lines.push(`Intraday bars: ${r.intradayBars.readyCount}/${r.intradayBars.totalCount}${intradayReason}`);
    if (r.signalCycle.suppressedIndices.length > 0 && (readinessLabel === "DATA_BLOCKED" || r.signalCycle.suppressedSignals > 0)) {
      lines.push(`Suppressed indices: ${r.signalCycle.suppressedIndices.join(", ")}`);
    }
    lines.push(`Option chain: ${r.optionChain.status}`);
    lines.push(
      `Signals: ${r.signalCycle.generatedSignals} generated | ${r.signalCycle.tradeableSignals} tradeable | ${r.signalCycle.suppressedSignals} suppressed`,
    );
    if (readinessLabel === "DATA_BLOCKED" || readinessLabel === "NO_SETUP") {
      lines.push(`Status: ${readinessLabel} — ${deriveReadinessStatusReason(r, readinessLabel)}`);
    }
  }

  lines.push("");
  lines.push("Swing staging:");
  if (data.swing != null) {
    // Compact staging template — APPROVAL_REQUIRED rows fold into "Pending" here;
    // the full breakdown remains available via the JSON preview contract.
    lines.push(
      `Pending ${data.swing.pending + data.swing.approvalRequired} | Approved ${data.swing.approved} | Expired ${data.swing.expired}`,
    );
    // GAP 3: equity paper counts surface in Telegram (openedToday/closedToday/blockedToday)
    lines.push(
      `Opened ${data.swing.openedToday} | Closed ${data.swing.closedToday} | Blocked ${data.swing.blockedToday}`,
    );
  } else {
    lines.push("Pending 0 | Approved 0 | Expired 0 (unavailable this run)");
  }

  lines.push("");
  lines.push("FII/DII (INFO-ONLY — NSE archive, prev day):");
  if (data.fiiDii != null) {
    const fiiSign = data.fiiDii.fiiNetCr >= 0 ? "+" : "";
    const diiSign = data.fiiDii.diiNetCr >= 0 ? "+" : "";
    lines.push(
      `FII net: ₹${fiiSign}${data.fiiDii.fiiNetCr.toFixed(0)} Cr | DII net: ₹${diiSign}${data.fiiDii.diiNetCr.toFixed(0)} Cr (${data.fiiDii.date})`,
    );
  } else {
    lines.push("Unavailable — NSE archive not yet fetched for this date");
  }

  const actions: string[] = [];
  if (r == null || r.kiteSession !== "ACTIVE") {
    actions.push("- Reconnect Kite if session missing/expired");
  }
  if (r != null && readinessLabel === "DATA_BLOCKED") {
    actions.push("- Check /fno-diagnostics if data blocked");
  }
  if (r != null && readinessLabel === "READY") {
    actions.push("- Monitor /option-chain if data ready");
  }
  if (actions.length > 0) {
    lines.push("");
    lines.push("Action:");
    lines.push(...actions);
  }

  lines.push("");
  lines.push("Not included: GIFT Nifty, live global cues, India VIX, news/events — provider not configured.");

  // A.7 fix — explicit legend so every grade label in the message is
  // decodable by the recipient without external context.
  lines.push("");
  lines.push("Legend: TRADE-GRADE = decisioning data (Kite live). INFO-ONLY = supporting context, not for entries. STALE = last known good but past freshness SLA. Unavailable = temporarily missing. Provider not configured = source not integrated.");

  lines.push("");
  lines.push("Broker execution: DISABLED");
  return lines.join("\n");
}

/** Human-readable reason line for the "Status: DATA_BLOCKED/NO_SETUP" row. */
function deriveReadinessStatusReason(
  r: CanonicalFnoReadiness,
  label: "DATA_BLOCKED" | "NO_SETUP",
): string {
  if (label === "NO_SETUP") {
    return "data ready, no signal met the confidence threshold today";
  }
  if (r.kiteSession !== "ACTIVE") return `Kite session ${r.kiteSession.toLowerCase()}`;
  if (r.feedStatus === "DISCONNECTED") return "Kite feed disconnected";
  if (r.dailyBars.status === "MISSING") return r.dailyBars.reason ?? "daily bars missing";
  if (r.intradayBars.status === "MISSING") return r.intradayBars.reason ?? "intraday bars missing";
  return r.signalCycle.reasons[0] ?? "see /fno-diagnostics for detail";
}

// ── Post-market data interfaces ───────────────────────────────────────────────

export interface PostMarketFno {
  tradesOpened: number;
  tradesClosed: number;
  openCount: number;
  totalPnl: number | null;
  /** P0 Phase A — total charges (canonical model) across trades closed today.
   *  Null when no closed trades today. */
  totalCharges: number | null;
  /** P0 Phase A — total net P&L (gross − charges) across trades closed today. */
  totalNetPnl: number | null;
  /** Count of today's closed rows whose charges are DB-durable (CURRENT vs LEGACY). */
  chargesCoverage: {
    current: number;
    legacy: number;
  };
}

export interface PostMarketSwing {
  pending: number;
  approved: number;
  expired: number;
  /** paper_trade_eq rows opened today with source=SWING_STAGED_APPROVAL. */
  openedToday: number;
  /** paper_trade_eq rows closed today with source=SWING_STAGED_APPROVAL. */
  closedToday: number;
  /** swing_order_staging RECHECK_BLOCKED rows created today. */
  blockedToday: number;
  /** Live open paper_trade_eq positions with source=SWING_STAGED_APPROVAL. */
  equityOpenCount: number;
}

/** Overall equity paper counts (all sources) for the post-market report. */
export interface PostMarketEquityPaper {
  openedToday: number;
  closedToday: number;
  openCount: number;
  /** P0 Phase B — realized gross/net + durable charges for today's
   *  CLOSED equity paper rows. All three are null when no CURRENT-tagged
   *  row closed today. Legacy pre-P0 rows do NOT contribute. */
  grossPnlToday: number | null;
  chargesTotalToday: number | null;
  netPnlToday: number | null;
  chargesCoverage: {
    current: number;
    legacy: number;
  };
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
  atmStrike: number | null;
  atmStraddleTotal: number | null;
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
  /** Checkpoint 1 Part D — single honest source of truth for F&O readiness +
   *  signal counts, shared with the pre-market report (Part C). Null only if
   *  the async gatherer itself failed (fail-open — never fabricated). */
  canonicalFno: CanonicalFnoReadiness | null;
  fno: PostMarketFno | null;
  swing: PostMarketSwing | null;
  /** Overall equity paper trade counts (all sources) for today. Null if query fails. */
  equityPaper: PostMarketEquityPaper | null;
  indexPerformance: PostMarketIndexPerformance | null;
  optionChainEod: PostMarketOptionChainEod | null;
  /** True once the exit-monitor trust-gate has recorded at least one EXIT
   *  this process lifetime (`getFnoExitMonitorHealth().exitedTotal > 0`). */
  exitMonitorVerified: boolean;
  /** Ops observability rollup — chip-downgrade counts observed on client
   *  today (IST-day window). Null if the summariser threw. Zero fields
   *  when nothing was observed (common on healthy days). */
  observabilityToday: {
    totalDegradations: number;
    totalRecoveries: number;
    /** Top-1 chipId by degradation count in today's window — null if
     *  no degradations. */
    topChip: { chipId: string; degradations: number } | null;
  } | null;
}

// ── Post-market builder (pure) ────────────────────────────────────────────────

export function buildPostMarketReport(data: PostMarketReportData): string {
  const header = data.isManualTest
    ? "POST-MARKET SUMMARY [MANUAL TEST]"
    : "POST-MARKET SUMMARY";
  // Telegram shows human-readable datetime; API/status/history always use ISO istDate
  const displayDate = data.datetimeStr != null ? `${data.datetimeStr} IST` : data.istDate;
  const lines: string[] = [header, `Date: ${displayDate}`, ""];

  if (data.isWeekend) {
    lines.push("Weekend — no market session today.");
    lines.push("", "Broker execution: DISABLED");
    return lines.join("\n");
  }

  const r = data.canonicalFno;

  // ── Checkpoint 1 Part D ──────────────────────────────────────────────────
  // Compact, useful format: only sections with real data get printed in
  // full; every SOURCE_NOT_INTEGRATED provider collapses into one footer
  // instead of ten placeholder sections.

  lines.push("Market close:");
  if (data.indexPerformance != null && data.indexPerformance.rows.length > 0) {
    for (const row of data.indexPerformance.rows) {
      const sign = row.changePct >= 0 ? "+" : "";
      const hi = row.high != null ? row.high.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—";
      const lo = row.low != null ? row.low.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—";
      lines.push(
        `${row.name}: ${row.close.toLocaleString("en-IN", { maximumFractionDigits: 2 })} ` +
          `(${sign}${row.changePct.toFixed(2)}%) H ${hi} L ${lo}`,
      );
    }
    if (data.indexPerformance.asOfIst != null) {
      lines.push(`(Kite, as of ${data.indexPerformance.asOfIst} IST)`);
    }
  } else {
    lines.push("Unavailable — Kite session not active");
  }

  lines.push("");
  lines.push("F&O:");
  if (r != null) {
    lines.push(
      `Signals: generated ${r.signalCycle.generatedSignals} | tradeable ${r.signalCycle.tradeableSignals} | suppressed ${r.signalCycle.suppressedSignals}`,
    );
  } else {
    lines.push("Signals: Unavailable — canonical readiness check failed this run");
  }
  if (data.fno != null) {
    if (data.fno.tradesOpened === 0 && data.fno.tradesClosed === 0 && data.fno.openCount === 0) {
      // A.6 fix — label is F&O-scoped so equity paper activity in the section
      // below is never mistaken for "no trades happened today at all".
      lines.push("F&O paper trades: none today");
    } else {
      lines.push(`F&O paper trades: opened ${data.fno.tradesOpened} | closed ${data.fno.tradesClosed} | open ${data.fno.openCount}`);
      if (data.fno.totalPnl != null) {
        const sign = data.fno.totalPnl >= 0 ? "+" : "";
        lines.push(`F&O realized P&L: ₹${sign}${data.fno.totalPnl.toLocaleString("en-IN")}`);
      } else {
        lines.push("F&O realized P&L: Unavailable");
      }
      // P0 Phase A — net P&L + charges. Only surfaced when at least one
      // CURRENT (durable-charges) row was closed today; if ALL closed rows
      // are LEGACY (pre-P0), we honestly say so and skip the net line
      // rather than mixing a partial net with unlabelled charges.
      if (data.fno.chargesCoverage.current > 0) {
        if (data.fno.totalCharges != null) {
          lines.push(
            `F&O charges (durable, ${data.fno.chargesCoverage.current} trade${data.fno.chargesCoverage.current === 1 ? "" : "s"}): ₹-${data.fno.totalCharges.toLocaleString("en-IN")}`,
          );
        }
        if (data.fno.totalNetPnl != null) {
          const sign = data.fno.totalNetPnl >= 0 ? "+" : "";
          lines.push(`F&O net realized P&L: ₹${sign}${data.fno.totalNetPnl.toLocaleString("en-IN")}`);
        }
        // Charges Drag — how much of the gross was eaten by friction.
        // Only meaningful when gross is non-zero AND the same trades
        // that produced it were CURRENT-tagged (so their charges are
        // durable). Two derived views:
        //   • Drag %  = |charges| / |gross|  ×100      (readable ratio)
        //   • Drag bps = charges / |gross|   ×10000    (fine-grained)
        // Zero-gross case: report abs charges only.
        if (data.fno.totalCharges != null && data.fno.totalPnl != null) {
          const gross = data.fno.totalPnl;
          const chg = data.fno.totalCharges;
          if (Math.abs(gross) > 0.005) {
            const dragPct = (chg / Math.abs(gross)) * 100;
            const dragBps = (chg / Math.abs(gross)) * 10_000;
            lines.push(
              `F&O charges drag: ${dragPct.toFixed(2)}% of |gross| (${dragBps.toFixed(0)} bps)`,
            );
          } else if (chg > 0) {
            lines.push(
              `F&O charges drag: gross ≈ ₹0 today — friction ₹-${chg.toLocaleString("en-IN")} is the entire result`,
            );
          }
        }
        if (data.fno.chargesCoverage.legacy > 0) {
          lines.push(
            `  (${data.fno.chargesCoverage.legacy} legacy trade${data.fno.chargesCoverage.legacy === 1 ? "" : "s"} closed today NOT included in net — pre-P0 rows carry no durable charges)`,
          );
        }
      } else if (data.fno.chargesCoverage.legacy > 0) {
        lines.push(
          `F&O charges: not stored (${data.fno.chargesCoverage.legacy} legacy pre-P0 trade${data.fno.chargesCoverage.legacy === 1 ? "" : "s"} closed today)`,
        );
      }
    }
  } else {
    lines.push("F&O paper trades: Unavailable — query failed this run");
  }
  lines.push(`Exit monitor: ${data.exitMonitorVerified ? "DEV_VERIFIED" : "waiting for live open trade evidence"}`);

  lines.push("");
  lines.push("Option chain:");
  if (data.optionChainEod != null && data.optionChainEod.rows.length > 0) {
    for (const row of data.optionChainEod.rows) {
      const pcr = row.pcr != null ? row.pcr.toFixed(2) : "—";
      const maxPain = row.maxPainStrike != null ? row.maxPainStrike.toLocaleString("en-IN") : "—";
      const atm =
        row.atmStrike != null
          ? `ATM ${row.atmStrike.toLocaleString("en-IN")}${row.atmStraddleTotal != null ? ` straddle ₹${row.atmStraddleTotal.toLocaleString("en-IN")}` : ""}`
          : "ATM —";
      lines.push(`${row.underlying}: PCR ${pcr} | Max Pain ${maxPain} | ${atm}`);
    }
  } else {
    lines.push("Unavailable — no option-chain snapshots captured today");
  }

  lines.push("");
  lines.push("Swing:");
  if (data.swing != null) {
    lines.push(`Pending ${data.swing.pending} | Approved ${data.swing.approved} | Expired ${data.swing.expired}`);
    // GAP 3: equity paper counts surface in Telegram
    lines.push(
      `Opened ${data.swing.openedToday} | Closed ${data.swing.closedToday} | Blocked ${data.swing.blockedToday} | Live ${data.swing.equityOpenCount}`,
    );
  } else {
    lines.push("Pending 0 | Approved 0 | Expired 0 (unavailable this run)");
  }

  lines.push("");
  lines.push("Equity paper trades:");
  if (data.equityPaper != null) {
    lines.push(
      `Opened ${data.equityPaper.openedToday} | Closed ${data.equityPaper.closedToday} | Live ${data.equityPaper.openCount}`,
    );
    // P0 Phase B — same charges-drag summary as F&O when at least one
    // CURRENT-tagged row closed today. Silent when nothing durable is
    // available (report continuity — no phantom lines).
    if (data.equityPaper.chargesCoverage.current > 0) {
      const eq = data.equityPaper;
      if (eq.grossPnlToday != null) {
        const s = eq.grossPnlToday >= 0 ? "+" : "";
        lines.push(`Equity gross realized P&L: ₹${s}${eq.grossPnlToday.toLocaleString("en-IN")}`);
      }
      if (eq.chargesTotalToday != null) {
        lines.push(
          `Equity charges (durable, ${eq.chargesCoverage.current} trade${eq.chargesCoverage.current === 1 ? "" : "s"}): ₹-${eq.chargesTotalToday.toLocaleString("en-IN")}`,
        );
      }
      if (eq.netPnlToday != null) {
        const s = eq.netPnlToday >= 0 ? "+" : "";
        lines.push(`Equity net realized P&L: ₹${s}${eq.netPnlToday.toLocaleString("en-IN")}`);
      }
      if (eq.grossPnlToday != null && eq.chargesTotalToday != null) {
        const gross = eq.grossPnlToday;
        const chg = eq.chargesTotalToday;
        if (Math.abs(gross) > 0.005) {
          const dragPct = (chg / Math.abs(gross)) * 100;
          const dragBps = (chg / Math.abs(gross)) * 10_000;
          lines.push(
            `Equity charges drag: ${dragPct.toFixed(2)}% of |gross| (${dragBps.toFixed(0)} bps)`,
          );
        } else if (chg > 0) {
          lines.push(
            `Equity charges drag: gross ≈ ₹0 today — friction ₹-${chg.toLocaleString("en-IN")} is the entire result`,
          );
        }
      }
      if (eq.chargesCoverage.legacy > 0) {
        lines.push(
          `  (${eq.chargesCoverage.legacy} legacy pre-P0 trade${eq.chargesCoverage.legacy === 1 ? "" : "s"} closed today NOT included in equity net)`,
        );
      }
    } else if (data.equityPaper.chargesCoverage.legacy > 0) {
      lines.push(
        `Equity charges: not stored (${data.equityPaper.chargesCoverage.legacy} legacy pre-P0 trade${data.equityPaper.chargesCoverage.legacy === 1 ? "" : "s"} closed today)`,
      );
    }
  } else {
    lines.push("Unavailable — query failed this run");
  }

  lines.push("");
  lines.push("Data health:");
  if (r != null) {
    lines.push(`Kite: ${r.kiteSession}`);
    const modules = deriveTradeGradeModules(r);
    lines.push(`Trade-grade modules: ${modules.ready}/${modules.total}`);
    if (modules.blocked.length > 0) {
      lines.push(`Blocked: ${modules.blocked.join(", ")}`);
    }
  } else {
    lines.push("Unavailable — canonical readiness check failed this run");
  }

  // Ops observability — client-side chip-downgrade rollup for the IST
  // day. Silent when zero degradations AND zero recoveries — no phantom
  // "0 things happened" noise on healthy days. On days with any
  // activity, one compact line names the counts + the loudest chip.
  if (data.observabilityToday != null) {
    const obs = data.observabilityToday;
    if (obs.totalDegradations > 0 || obs.totalRecoveries > 0) {
      const topStr = obs.topChip != null
        ? ` (top: ${obs.topChip.chipId} ×${obs.topChip.degradations})`
        : "";
      lines.push(
        `Chip downgrades today: ${obs.totalDegradations} degradation${obs.totalDegradations === 1 ? "" : "s"} · ${obs.totalRecoveries} recover${obs.totalRecoveries === 1 ? "y" : "ies"}${topStr}`,
      );
    }
  }

  lines.push("");
  lines.push("Tomorrow prep:");
  if (r != null) {
    lines.push(`Key levels ready: ${r.dailyBars.status === "READY" ? "Yes" : "No"}`);
    lines.push(`Option chain ready: ${r.optionChain.status === "READY" ? "Yes" : "No"}`);
    lines.push(`Kite reconnect required tomorrow: ${r.kiteSession !== "ACTIVE" ? "Yes" : "No"}`);
  } else {
    lines.push("Unavailable — canonical readiness check failed this run");
  }

  lines.push("");
  lines.push(
    "Not included: Market breadth, live news, India VIX, participant OI, global close — provider not configured.",
  );

  // A.7 fix — explicit legend so every grade label in the message is
  // decodable by the recipient without external context.
  lines.push("");
  lines.push("Legend: TRADE-GRADE = decisioning data (Kite live). INFO-ONLY = supporting context, not for entries. STALE = last known good but past freshness SLA. Unavailable = temporarily missing. Provider not configured = source not integrated.");

  lines.push("");
  lines.push("Broker execution: DISABLED");
  return lines.join("\n");
}

/** Trade-grade module roll-up for the post-market "Data health" section —
 *  reuses CanonicalFnoReadiness fields only, no new data fetch. */
function deriveTradeGradeModules(r: CanonicalFnoReadiness): { ready: number; total: number; blocked: string[] } {
  const modules: Array<{ name: string; ready: boolean }> = [
    { name: "Feed", ready: r.feedStatus === "CONNECTED" },
    { name: "Daily bars", ready: r.dailyBars.status === "READY" },
    { name: "Intraday bars", ready: r.intradayBars.status === "READY" },
    { name: "Option chain", ready: r.optionChain.status === "READY" },
  ];
  const ready = modules.filter((m) => m.ready).length;
  const blocked = modules.filter((m) => !m.ready).map((m) => m.name);
  return { ready, total: modules.length, blocked };
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

  let canonicalFno: CanonicalFnoReadiness | null = null;
  try {
    canonicalFno = await getCanonicalFnoReadiness(new Date(nowMs));
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      "dailyReports: gatherPreMarketData canonical F&O readiness section failed",
    );
  }

  let swing: PreMarketSwing | null = null;
  try {
    // IST day boundary for today's opened/closed/blocked counts
    const preIstNowMs = nowMs + 5.5 * 60 * 60_000;
    const preIstDayStart = new Date(Math.floor(preIstNowMs / 86_400_000) * 86_400_000 - 5.5 * 60 * 60_000);
    const preIstDayEnd = new Date(preIstDayStart.getTime() + 86_400_000);

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

    const ptOpenedRows = (await db.execute(sql`
      SELECT COUNT(*)::int AS n
      FROM paper_trade_eq
      WHERE source = 'SWING_STAGED_APPROVAL'
        AND opened_at >= ${preIstDayStart.toISOString()}
        AND opened_at < ${preIstDayEnd.toISOString()}
    `)) as unknown as { rows: Array<{ n: number | string }> };

    const ptClosedRows = (await db.execute(sql`
      SELECT COUNT(*)::int AS n
      FROM paper_trade_eq
      WHERE source = 'SWING_STAGED_APPROVAL'
        AND status = 'CLOSED'
        AND exited_at IS NOT NULL
        AND exited_at >= ${preIstDayStart.toISOString()}
        AND exited_at < ${preIstDayEnd.toISOString()}
    `)) as unknown as { rows: Array<{ n: number | string }> };

    const blockedRows = (await db.execute(sql`
      SELECT COUNT(*)::int AS n
      FROM swing_order_staging
      WHERE owner_key = 'owner'
        AND status = 'RECHECK_BLOCKED'
        AND created_at >= ${preIstDayStart.toISOString()}
        AND created_at < ${preIstDayEnd.toISOString()}
    `)) as unknown as { rows: Array<{ n: number | string }> };

    let pending = 0, approvalRequired = 0, approved = 0;
    for (const row of rows.rows) {
      const n = Number(row.n);
      if (row.approval_status === "APPROVED") approved += n;
      else if (row.status === "STAGED") pending += n;
      else approvalRequired += n;
    }
    const expired = Number(expiredRows.rows[0]?.n ?? 0);
    const openedToday = Number(ptOpenedRows.rows[0]?.n ?? 0);
    const closedToday = Number(ptClosedRows.rows[0]?.n ?? 0);
    const blockedToday = Number(blockedRows.rows[0]?.n ?? 0);
    swing = { pending, approvalRequired, approved, expired, openedToday, closedToday, blockedToday, notificationFailures: 0 };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "dailyReports: gatherPreMarketData swing section failed");
  }

  let fiiDii: PreMarketFiiDii | null = null;
  try {
    const months = await getFiiDiiMonthly(1);
    const allDays = months.flatMap((m) => m.days);
    const latest = allDays[allDays.length - 1] ?? null;
    if (latest != null) {
      fiiDii = { date: latest.date, fiiNetCr: latest.fiiNet, diiNetCr: latest.diiNet };
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "dailyReports: gatherPreMarketData fiiDii section failed");
  }

  return { isManualTest, istDatetime: datetimeStr, isWeekend, kite, canonicalFno, swing, fiiDii };
}

export async function gatherPostMarketData(
  nowMs: number = Date.now(),
  isManualTest = false,
): Promise<PostMarketReportData> {
  const { date, dayOfWeek, datetimeStr } = istInfo(nowMs);
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  let canonicalFno: CanonicalFnoReadiness | null = null;
  try {
    canonicalFno = await getCanonicalFnoReadiness(new Date(nowMs));
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      "dailyReports: gatherPostMarketData canonical F&O readiness section failed",
    );
  }

  let exitMonitorVerified = false;
  try {
    exitMonitorVerified = getFnoExitMonitorHealth().exitedTotal > 0;
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      "dailyReports: gatherPostMarketData exit monitor health section failed",
    );
  }

  let fno: PostMarketFno | null = null;
  try {
    const summary = await computeDailySummaryFo(date);
    const openRows = (await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM paper_trade_fo WHERE status = 'OPEN'
    `)) as unknown as { rows: Array<{ n: number | string }> };

    // P0 Phase A — today's charges + net P&L, sourced strictly from
    // durable DB columns. `charges_total` and `net_pnl` are NULL for
    // pre-P0 (LEGACY_NOT_STORED) rows; SUM(NULL) → NULL, and we count
    // CURRENT vs LEGACY separately so the recipient can see coverage.
    const istDayIso = date; // "YYYY-MM-DD" IST
    const dayStartUtc = new Date(`${istDayIso}T00:00:00+05:30`).toISOString();
    const [y, m, d] = istDayIso.split("-").map(Number) as [number, number, number];
    const nextIst = new Date(Date.UTC(y, m - 1, d + 1));
    const dayEndUtc = new Date(nextIst.getTime() - 5.5 * 60 * 60 * 1000).toISOString();
    const chargesRes = (await db.execute(sql`
      SELECT
        SUM(charges_total) FILTER (WHERE charges_status = 'CURRENT') AS total_charges,
        SUM(net_pnl)       FILTER (WHERE charges_status = 'CURRENT') AS total_net_pnl,
        COUNT(*) FILTER (WHERE charges_status = 'CURRENT')::int AS n_current,
        COUNT(*) FILTER (WHERE charges_status IS DISTINCT FROM 'CURRENT')::int AS n_legacy
        FROM paper_trade_fo
       WHERE status = 'CLOSED'
         AND exited_at >= ${dayStartUtc}
         AND exited_at <  ${dayEndUtc}
    `)) as unknown as {
      rows: Array<{
        total_charges: string | number | null;
        total_net_pnl: string | number | null;
        n_current: number;
        n_legacy: number;
      }>;
    };
    const cRow = chargesRes.rows[0] ?? {
      total_charges: null,
      total_net_pnl: null,
      n_current: 0,
      n_legacy: 0,
    };
    const totalCharges = cRow.total_charges == null ? null : Number(cRow.total_charges);
    const totalNetPnl = cRow.total_net_pnl == null ? null : Number(cRow.total_net_pnl);

    fno = {
      tradesOpened: summary.tradesOpened,
      tradesClosed: summary.tradesClosed,
      openCount: Number(openRows.rows[0]?.n ?? 0),
      totalPnl: summary.pnl.total,
      totalCharges,
      totalNetPnl,
      chargesCoverage: {
        current: Number(cRow.n_current ?? 0),
        legacy: Number(cRow.n_legacy ?? 0),
      },
    };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "dailyReports: gatherPostMarketData fno section failed");
  }

  let indexPerformance: PostMarketIndexPerformance | null = null;
  try {
    const quotes = await getReportGradeIndexQuotes("REPORT_POST_MARKET", nowMs);
    const rows: PostMarketIndexRow[] = [];
    let latestAsOfMs: number | null = null;
    for (const { key, name } of REPORT_INDEX_KEYS) {
      const q = quotes.get(key);
      if (q == null || !q.canDriveReports || q.ltp == null || q.changePct == null) continue; // never fabricate a missing row
      rows.push({
        name,
        close: q.ltp,
        changePct: q.changePct,
        high: q.high ?? null,
        low: q.low ?? null,
      });
      const asOfMs = q.sourceAsOf != null ? Date.parse(q.sourceAsOf) : NaN;
      if (Number.isFinite(asOfMs) && (latestAsOfMs == null || asOfMs > latestAsOfMs)) {
        latestAsOfMs = asOfMs;
      }
    }
    if (rows.length > 0) {
      indexPerformance = { rows, asOfIst: latestAsOfMs != null ? formatIstHM(latestAsOfMs) : null };
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
        atmStrike: analytics.atmStrike,
        atmStraddleTotal: analytics.atmStraddle?.total ?? null,
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
    // IST day boundary
    const postIstNowMs = nowMs + 5.5 * 60 * 60_000;
    const postIstDayStart = new Date(Math.floor(postIstNowMs / 86_400_000) * 86_400_000 - 5.5 * 60 * 60_000);
    const postIstDayEnd = new Date(postIstDayStart.getTime() + 86_400_000);

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

    const ptSwingOpenedRows = (await db.execute(sql`
      SELECT COUNT(*)::int AS n
      FROM paper_trade_eq
      WHERE source = 'SWING_STAGED_APPROVAL'
        AND opened_at >= ${postIstDayStart.toISOString()}
        AND opened_at < ${postIstDayEnd.toISOString()}
    `)) as unknown as { rows: Array<{ n: number | string }> };

    const ptSwingClosedRows = (await db.execute(sql`
      SELECT COUNT(*)::int AS n
      FROM paper_trade_eq
      WHERE source = 'SWING_STAGED_APPROVAL'
        AND status = 'CLOSED'
        AND exited_at IS NOT NULL
        AND exited_at >= ${postIstDayStart.toISOString()}
        AND exited_at < ${postIstDayEnd.toISOString()}
    `)) as unknown as { rows: Array<{ n: number | string }> };

    const swingBlockedRows = (await db.execute(sql`
      SELECT COUNT(*)::int AS n
      FROM swing_order_staging
      WHERE owner_key = 'owner'
        AND status = 'RECHECK_BLOCKED'
        AND created_at >= ${postIstDayStart.toISOString()}
        AND created_at < ${postIstDayEnd.toISOString()}
    `)) as unknown as { rows: Array<{ n: number | string }> };

    const swingLiveRows = (await db.execute(sql`
      SELECT COUNT(*)::int AS n
      FROM paper_trade_eq
      WHERE source = 'SWING_STAGED_APPROVAL'
        AND status = 'OPEN'
    `)) as unknown as { rows: Array<{ n: number | string }> };

    let pending = 0, approvalRequired = 0, approved = 0;
    for (const row of rows.rows) {
      const n = Number(row.n);
      if (row.approval_status === "APPROVED") approved += n;
      else if (row.status === "STAGED") pending += n;
      else approvalRequired += n;
    }
    const expired = Number(expiredRows.rows[0]?.n ?? 0);
    const openedToday = Number(ptSwingOpenedRows.rows[0]?.n ?? 0);
    const closedToday = Number(ptSwingClosedRows.rows[0]?.n ?? 0);
    const blockedToday = Number(swingBlockedRows.rows[0]?.n ?? 0);
    const equityOpenCount = Number(swingLiveRows.rows[0]?.n ?? 0);
    swing = { pending: pending + approvalRequired, approved, expired, openedToday, closedToday, blockedToday, equityOpenCount };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "dailyReports: gatherPostMarketData swing section failed");
  }

  let equityPaper: PostMarketEquityPaper | null = null;
  try {
    const eqIstNowMs = nowMs + 5.5 * 60 * 60_000;
    const eqIstDayStart = new Date(Math.floor(eqIstNowMs / 86_400_000) * 86_400_000 - 5.5 * 60 * 60_000);
    const eqIstDayEnd = new Date(eqIstDayStart.getTime() + 86_400_000);

    const eqOpenedRows = (await db.execute(sql`
      SELECT COUNT(*)::int AS n
      FROM paper_trade_eq
      WHERE opened_at >= ${eqIstDayStart.toISOString()}
        AND opened_at < ${eqIstDayEnd.toISOString()}
    `)) as unknown as { rows: Array<{ n: number | string }> };

    const eqClosedRows = (await db.execute(sql`
      SELECT COUNT(*)::int AS n
      FROM paper_trade_eq
      WHERE status = 'CLOSED'
        AND exited_at IS NOT NULL
        AND exited_at >= ${eqIstDayStart.toISOString()}
        AND exited_at < ${eqIstDayEnd.toISOString()}
    `)) as unknown as { rows: Array<{ n: number | string }> };

    const eqLiveRows = (await db.execute(sql`
      SELECT COUNT(*)::int AS n
      FROM paper_trade_eq
      WHERE status = 'OPEN'
    `)) as unknown as { rows: Array<{ n: number | string }> };

    // P0 Phase B — durable charges + net P&L on today's closed EQ rows.
    // Same predicate as F&O; separate SUM per column so nulls don't
    // poison the aggregate.
    const eqChargesRes = (await db.execute(sql`
      SELECT
        SUM(realized_pnl) FILTER (WHERE charges_status = 'CURRENT') AS gross,
        SUM(charges_total) FILTER (WHERE charges_status = 'CURRENT') AS charges,
        SUM(net_pnl)       FILTER (WHERE charges_status = 'CURRENT') AS net,
        COUNT(*) FILTER (WHERE charges_status = 'CURRENT')::int AS n_current,
        COUNT(*) FILTER (WHERE charges_status IS DISTINCT FROM 'CURRENT')::int AS n_legacy
        FROM paper_trade_eq
       WHERE status = 'CLOSED'
         AND exited_at IS NOT NULL
         AND exited_at >= ${eqIstDayStart.toISOString()}
         AND exited_at <  ${eqIstDayEnd.toISOString()}
    `)) as unknown as {
      rows: Array<{
        gross: string | number | null;
        charges: string | number | null;
        net: string | number | null;
        n_current: number;
        n_legacy: number;
      }>;
    };
    const eqC = eqChargesRes.rows[0] ?? {
      gross: null,
      charges: null,
      net: null,
      n_current: 0,
      n_legacy: 0,
    };

    equityPaper = {
      openedToday: Number(eqOpenedRows.rows[0]?.n ?? 0),
      closedToday: Number(eqClosedRows.rows[0]?.n ?? 0),
      openCount: Number(eqLiveRows.rows[0]?.n ?? 0),
      grossPnlToday: eqC.gross == null ? null : Number(eqC.gross),
      chargesTotalToday: eqC.charges == null ? null : Number(eqC.charges),
      netPnlToday: eqC.net == null ? null : Number(eqC.net),
      chargesCoverage: {
        current: Number(eqC.n_current ?? 0),
        legacy: Number(eqC.n_legacy ?? 0),
      },
    };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "dailyReports: gatherPostMarketData equity paper section failed");
  }

  // Ops observability rollup — pulled from the in-process client-event
  // ring buffer (see lib/clientEventBuffer.ts). Fail-open: any throw
  // → null, report proceeds with a "unavailable" line rather than
  // dropping the whole post-market run.
  //
  // NOTE (SCALE-OUT): the ring buffer is process-local. In a
  // multi-pod future this section would either read from a shared
  // Redis (see BACKTEST_REPLAY_HARNESS_SPEC.md / observability
  // roadmap) or aggregate cross-pod via a dedicated collector. For
  // single-pod today, in-memory is the honest source of truth.
  let observabilityToday:
    | { totalDegradations: number; totalRecoveries: number; topChip: { chipId: string; degradations: number } | null }
    | null = null;
  try {
    const { summariseClientEvents } = await import("./clientEventBuffer");
    const istDayStartMs = new Date(`${date}T00:00:00+05:30`).getTime();
    const s = summariseClientEvents(new Date(istDayStartMs).toISOString());
    observabilityToday = {
      totalDegradations: s.totalDegradations,
      totalRecoveries: s.totalRecoveries,
      topChip: s.topDegradingChips[0] ?? null,
    };
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      "dailyReports: gatherPostMarketData observability section failed",
    );
  }

  return {
    isManualTest,
    istDate: date,
    datetimeStr,
    isWeekend,
    canonicalFno,
    fno,
    swing,
    equityPaper,
    indexPerformance,
    optionChainEod,
    exitMonitorVerified,
    observabilityToday,
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
