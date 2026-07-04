/**
 * Report-grade index quote facade (Checkpoint 2.5).
 *
 * Daily Telegram reports (pre/post-market) need index performance numbers for
 * INFORMATIONAL display only — never for trading decisions. The trade-grade
 * router (`getIndexQuotes` in `router.ts`) hard-rejects any quote older than
 * the 10-minute hard-stale budget. That is correct for signals/paper-trades,
 * but wrong for the post-market report, which runs ~15 minutes after the
 * final tick at the 15:30 IST close — a naive swap to the trade-grade router
 * would blank the INDEX PERFORMANCE section again (the exact bug commit
 * bd8f5413 fixed).
 *
 * This module is a SEPARATE, clearly-labelled report-grade path:
 *   - `tradeGrade` / `canDriveSignals` / `canDrivePaperTrades` are hard-coded
 *     `false` on every row it returns — report-grade data can never reach a
 *     signal or paper-trade decision;
 *   - it accepts a same-IST-trading-day snapshot even when older than the
 *     10-minute trade-grade hard-stale budget (e.g. the 15:30 close tick,
 *     read again at 15:45);
 *   - it still refuses data that predates today's session (yesterday's
 *     cache, weekend) — it never fabricates a live-looking quote;
 *   - every row carries source / as-of / freshness so the report can label
 *     it honestly instead of implying "live".
 *
 * Internally it reuses the SAME Kite quote as the trade-grade router
 * (`kiteProvider.getIndexQuotes`) — this is the trusted layer calling its own
 * provider wrapper, which is legitimate (both files live under
 * `lib/marketData/`, exempt from the provider-import guard). It does NOT
 * modify, wrap, or weaken `router.ts`'s trade-grade path in any way.
 */

import { getIndexQuotes as getRawIndexQuotes } from "./kiteProvider";
import { computeFreshness } from "./freshness";
import type { MarketQuote } from "./types";

/** Distinguishes why a caller wants market data — governs which facade it may use. */
export type MarketDataUseCase =
  | "TRADE_DECISION"
  | "PAPER_TRADE"
  | "LIVE_ALERT"
  | "REPORT_POST_MARKET"
  | "REPORT_PRE_MARKET"
  | "DISPLAY_ONLY";

/** Use cases this facade is allowed to serve — trade/alert use cases must use `router.ts`. */
export type ReportUseCase = Extract<
  MarketDataUseCase,
  "REPORT_POST_MARKET" | "REPORT_PRE_MARKET" | "DISPLAY_ONLY"
>;

export type MarketSessionState = "open" | "closed" | "post_market" | "unknown";

export interface ReportGradeIndexQuote {
  /** Yahoo-style key used across the codebase's index maps (e.g. "^NSEI"). */
  symbol: string;
  name: string;
  ltp: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  /** Alias of `ltp` — kept distinct for reports that display a "close" column. */
  close: number | null;
  previousClose: number | null;
  change: number | null;
  changePct: number | null;
  source: "KITE" | "UNAVAILABLE";
  sourceAsOf: string | null;
  freshnessSec: number | null;
  /** Always false — report-grade data must never be treated as trade-grade. */
  tradeGrade: false;
  reportGrade: boolean;
  /** Always false — enforced at both the type and the runtime-value level. */
  canDriveSignals: false;
  /** Always false — enforced at both the type and the runtime-value level. */
  canDrivePaperTrades: false;
  canDriveReports: boolean;
  marketSession: MarketSessionState;
  reason: string | null;
}

/** Report-only index universe (yahoo-style key ↔ display name). */
export const REPORT_INDEX_KEYS: Array<{ key: string; name: string }> = [
  { key: "^NSEI", name: "NIFTY 50" },
  { key: "^NSEBANK", name: "NIFTY BANK" },
  { key: "^BSESN", name: "SENSEX" },
];

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MARKET_OPEN_MIN = 9 * 60 + 15; // 09:15 IST
const MARKET_CLOSE_MIN = 15 * 60 + 30; // 15:30 IST
/** Generous same-day window after close during which the post-market report runs. */
const POST_MARKET_WINDOW_END_MIN = 20 * 60; // 20:00 IST

/**
 * Same-IST-day session classification. Pure, deterministic, injectable clock.
 * Weekends are always "closed" — this never fabricates a trading session.
 */
export function deriveMarketSession(nowMs: number = Date.now()): MarketSessionState {
  const ist = new Date(nowMs + IST_OFFSET_MS);
  const dayOfWeek = ist.getUTCDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) return "closed";
  const minOfDay = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  if (minOfDay >= MARKET_OPEN_MIN && minOfDay < MARKET_CLOSE_MIN) return "open";
  if (minOfDay >= MARKET_CLOSE_MIN && minOfDay < POST_MARKET_WINDOW_END_MIN) return "post_market";
  return "closed";
}

/** Epoch ms of IST midnight (start of the current IST calendar day). */
function istDayStartMs(nowMs: number): number {
  const ist = new Date(nowMs + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const d = ist.getUTCDate();
  return Date.UTC(y, m, d) - IST_OFFSET_MS;
}

/** Epoch ms of today's IST market-open instant (09:15 IST). */
function todaysMarketOpenMs(nowMs: number): number {
  return istDayStartMs(nowMs) + MARKET_OPEN_MIN * 60_000;
}

function unavailableQuote(
  key: string,
  name: string,
  session: MarketSessionState,
  reason: string,
): ReportGradeIndexQuote {
  return {
    symbol: key,
    name,
    ltp: null,
    open: null,
    high: null,
    low: null,
    close: null,
    previousClose: null,
    change: null,
    changePct: null,
    source: "UNAVAILABLE",
    sourceAsOf: null,
    freshnessSec: null,
    tradeGrade: false,
    reportGrade: false,
    canDriveSignals: false,
    canDrivePaperTrades: false,
    canDriveReports: false,
    marketSession: session,
    reason,
  };
}

function toReportGradeQuote(
  key: string,
  name: string,
  q: MarketQuote,
  session: MarketSessionState,
  nowMs: number,
): ReportGradeIndexQuote {
  const fresh = computeFreshness(Date.parse(q.meta.asOf ?? ""), nowMs);
  return {
    symbol: key,
    name,
    ltp: q.lastPrice ?? null,
    open: q.open ?? null,
    high: q.high ?? null,
    low: q.low ?? null,
    close: q.lastPrice ?? null,
    previousClose: q.previousClose ?? null,
    change: q.change ?? null,
    changePct: q.changePercent ?? null,
    source: "KITE",
    sourceAsOf: q.meta.asOf,
    freshnessSec: fresh.freshnessSec,
    tradeGrade: false,
    reportGrade: true,
    canDriveSignals: false,
    canDrivePaperTrades: false,
    canDriveReports: true,
    marketSession: session,
    reason: null,
  };
}

/**
 * Report-grade index quotes for daily Telegram reports / display surfaces.
 *
 * NEVER usable for trade decisions — `tradeGrade`, `canDriveSignals`, and
 * `canDrivePaperTrades` are hard-coded `false` on every returned row.
 *
 * Acceptance policy (deliberately looser than the trade-grade router, but
 * still honest):
 *   - a quote whose `asOf` falls on/after today's IST market open (09:15) is
 *     report-grade even if older than the 10-minute trade-grade hard-stale
 *     budget — this is what lets the 15:45 post-market report show the
 *     15:30 closing tick;
 *   - a quote from before today's session (yesterday's cache, weekend) is
 *     honestly marked unavailable with `reason: "REPORT_INDEX_QUOTES_STALE"`
 *     — never presented as if it were today's data;
 *   - no upstream data at all → `reason: "INDEX_QUOTES_UNAVAILABLE"`.
 *
 * @param useCase Documents intent at the call site; only report/display use
 *   cases may call this facade (trade/alert paths must use `router.ts`).
 */
export async function getReportGradeIndexQuotes(
  useCase: ReportUseCase,
  nowMs: number = Date.now(),
): Promise<Map<string, ReportGradeIndexQuote>> {
  void useCase; // documents intent at the call site; no branching today
  const session = deriveMarketSession(nowMs);
  const out = new Map<string, ReportGradeIndexQuote>();

  let raw: Map<string, MarketQuote> | null = null;
  try {
    raw = await getRawIndexQuotes();
  } catch {
    raw = null;
  }

  if (!raw) {
    for (const { key, name } of REPORT_INDEX_KEYS) {
      out.set(key, unavailableQuote(key, name, session, "INDEX_QUOTES_UNAVAILABLE"));
    }
    return out;
  }

  const todaysOpen = todaysMarketOpenMs(nowMs);

  for (const { key, name } of REPORT_INDEX_KEYS) {
    const q = raw.get(key);
    const asOfMs = q?.meta.asOf != null ? Date.parse(q.meta.asOf) : NaN;
    if (!q || !Number.isFinite(asOfMs)) {
      out.set(key, unavailableQuote(key, name, session, "INDEX_QUOTES_UNAVAILABLE"));
      continue;
    }
    if (asOfMs < todaysOpen) {
      out.set(key, unavailableQuote(key, name, session, "REPORT_INDEX_QUOTES_STALE"));
      continue;
    }
    out.set(key, toReportGradeQuote(key, name, q, session, nowMs));
  }

  return out;
}
