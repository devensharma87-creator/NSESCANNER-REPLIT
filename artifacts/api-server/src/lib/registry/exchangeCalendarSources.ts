/**
 * PHASE 0.6A — PARSERS FOR THE OFFICIAL EXCHANGE CALENDAR SOURCES.
 *
 * Official exchange documents only. No third-party holiday site, no search
 * result, no broker list, no inferred holiday, and no Monday–Friday assumption
 * is ever treated as authority here.
 *
 * Sources understood by this module:
 *
 *   NSE  — the official NSE trading-holiday master (`/api/holiday-master`),
 *          segment CM, which is the machine-readable form of the exchange's
 *          published annual holiday circular.
 *   BSE  — the official BSE "Trading Holidays" page for the equity segment
 *          (`/static/markets/marketinfo/listholi.aspx`). BSE serves that page
 *          as a compiled application view, so the published table arrives
 *          inside the page bundle rather than as server-rendered HTML. It is
 *          still BSE's own document from BSE's own origin, and the parser
 *          records exactly which artefact was read.
 *   BSE  — the official UDiFF / Common Bhavcopy for a completed session.
 *
 * Parsing is strict and self-validating: every date must be real, and every
 * date must agree with the weekday the exchange printed next to it. A parse
 * that drifts out of alignment therefore fails loudly instead of producing a
 * plausible-looking calendar.
 *
 * PURE: no network, no filesystem, no clock. Bodies and instants are supplied.
 */

import { createHash } from "node:crypto";
import { isRealIstDate } from "./bseReferencePolicy";
import type { BseUdiffDescriptor } from "./bseReferencePolicy";
import type { SourceValidationResult } from "./officialSources";
import {
  istDayOfWeek,
  MAX_TIMING_EVIDENCE_ROWS,
  MAX_TIMING_SOURCE_BYTES,
  TIMING_EXTRACTION_VERSION,
  type CalendarSourceEvent,
  type CalendarSourceProvenance,
  type CalendarSourceValidation,
  type ParsedCalendarSource,
  type SessionTimingEvidenceRow,
  type SessionTimingProvenance,
  type SessionTimingSource,
  type TimingSourceValidation,
} from "./exchangeCalendar";

export const NSE_HOLIDAY_MASTER_URL = "https://www.nseindia.com/api/holiday-master?type=trading";
export const BSE_TRADING_HOLIDAYS_URL =
  "https://www.bseindia.com/static/markets/marketinfo/listholi.aspx";
export const BSE_UDIFF_URL_TEMPLATE =
  "https://www.bseindia.com/download/BhavCopy/Equity/BhavCopy_BSE_CM_0_0_0_{YYYYMMDD}_F_0000.CSV";

/**
 * An annual equity calendar below this many holidays is a truncated or error
 * response, not a genuinely holiday-light year. India has never had fewer.
 */
export const MIN_ANNUAL_HOLIDAY_EVENTS = 8;

/** A CM-segment UDiFF below this many rows is a truncated file. */
export const MIN_UDIFF_ROWS = 2000;

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const WEEKDAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

function sha256(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** `15-Jan-2026` or `15-Jan-26` → `2026-01-15`; null when unparseable. */
export function parseExchangeDate(raw: string, expectedYear: number): string | null {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})$/.exec(raw.trim());
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  if (!month) return null;
  const yearPart = m[3];
  const year = yearPart.length === 4 ? Number(yearPart) : 2000 + Number(yearPart);
  if (year !== expectedYear) return null;
  const date = `${year}-${pad2(month)}-${pad2(Number(m[1]))}`;
  return isRealIstDate(date) ? date : null;
}

/** `November 08, 2026` → `2026-11-08`. */
export function parseLongExchangeDate(month: string, day: string, year: string): string | null {
  const m = MONTHS[month.slice(0, 3).toLowerCase()];
  if (!m) return null;
  const date = `${year}-${pad2(m)}-${pad2(Number(day))}`;
  return isRealIstDate(date) ? date : null;
}

function weekdayMatches(date: string, printed: string): boolean {
  return WEEKDAY_NAMES[istDayOfWeek(date)] === printed.trim().toLowerCase();
}

function reject(
  base: Omit<CalendarSourceProvenance, "validationResult" | "rejectionDetail" | "eventCount">,
  validationResult: CalendarSourceValidation,
  detail: string,
): ParsedCalendarSource {
  return {
    provenance: { ...base, eventCount: 0, validationResult, rejectionDetail: detail },
    events: [],
  };
}

export interface CalendarParseOptions {
  readonly retrievedAt: string;
  readonly calendarYear: number;
}

// ── NSE official holiday master ──────────────────────────────────────────────

/**
 * Parse the official NSE trading-holiday master, CM (cash market) segment.
 *
 * Every entry is a CLOSED day. NSE marks a day that also carries a special
 * session with an asterisk in the description but does not publish the session
 * timings in this payload, so no session is invented from it — the timings
 * arrive, if at all, through a separate official circular.
 */
export function parseNseHolidayMaster(
  body: string,
  options: CalendarParseOptions,
): ParsedCalendarSource {
  const { retrievedAt, calendarYear } = options;
  const base = {
    exchange: "NSE" as const,
    sourceId: `NSE_TRADING_HOLIDAYS_CM_${calendarYear}`,
    sourceName: `NSE official trading holidays ${calendarYear} (segment CM)`,
    sourceUrl: NSE_HOLIDAY_MASTER_URL,
    retrievedAt,
    calendarYear,
    effectiveFrom: `${calendarYear}-01-01`,
    effectiveTo: `${calendarYear}-12-31`,
    contentHash: sha256(body),
    kind: "ANNUAL_CALENDAR" as const,
    issuedAt: `${calendarYear}-01-01`,
  };

  if (body.trim().length === 0) return reject(base, "REJECTED_EMPTY", "empty body");

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return reject(base, "REJECTED_MALFORMED", "body is not valid JSON");
  }
  if (parsed === null || typeof parsed !== "object") {
    return reject(base, "REJECTED_MALFORMED", "body is not a JSON object");
  }
  const cm = (parsed as Record<string, unknown>).CM;
  if (!Array.isArray(cm)) {
    return reject(base, "REJECTED_MALFORMED", "no CM (cash market) segment in the holiday master");
  }
  if (cm.length === 0) return reject(base, "REJECTED_EMPTY", "CM segment carries no holidays");

  const events: CalendarSourceEvent[] = [];
  const seen = new Set<string>();
  for (const raw of cm) {
    if (raw === null || typeof raw !== "object") {
      return reject(base, "REJECTED_MALFORMED", "CM segment contains a non-object entry");
    }
    const row = raw as Record<string, unknown>;
    const tradingDateRaw = typeof row.tradingDate === "string" ? row.tradingDate : "";
    const weekDay = typeof row.weekDay === "string" ? row.weekDay : "";
    const description = typeof row.description === "string" ? row.description.trim() : "";
    const date = parseExchangeDate(tradingDateRaw, calendarYear);
    if (date === null) {
      return reject(
        base,
        "REJECTED_MALFORMED",
        `unparseable or out-of-year holiday date "${tradingDateRaw}"`,
      );
    }
    if (!weekdayMatches(date, weekDay)) {
      return reject(
        base,
        "REJECTED_MALFORMED",
        `holiday ${date} is printed as ${weekDay} but is a ${WEEKDAY_NAMES[istDayOfWeek(date)]}`,
      );
    }
    if (seen.has(date)) {
      return reject(base, "REJECTED_MALFORMED", `duplicate holiday date ${date}`);
    }
    seen.add(date);
    events.push({
      exchange: "NSE",
      tradingDate: date,
      sessionType: "CLOSED",
      description: description || "exchange holiday",
      scheduledOpenIst: null,
      scheduledCloseIst: null,
      sourceId: base.sourceId,
    });
  }

  if (events.length < MIN_ANNUAL_HOLIDAY_EVENTS) {
    return reject(
      base,
      "REJECTED_BELOW_FLOOR",
      `${events.length} holidays is below the floor of ${MIN_ANNUAL_HOLIDAY_EVENTS}`,
    );
  }

  events.sort((a, b) => (a.tradingDate < b.tradingDate ? -1 : 1));
  return {
    provenance: {
      ...base,
      eventCount: events.length,
      validationResult: "ACCEPTED",
      rejectionDetail: null,
    },
    events,
  };
}

// ── BSE official trading-holidays page ───────────────────────────────────────

/** Text literals emitted by the compiled BSE page view, in document order. */
function extractPageTextRun(body: string, fromIndex: number, toIndex: number): string[] {
  const region = body.slice(fromIndex, toIndex);
  const out: string[] = [];
  const re = /i\(\d+,"((?:[^"\\]|\\.)*)"\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(region)) !== null) {
    try {
      out.push(JSON.parse(`"${m[1]}"`) as string);
    } catch {
      out.push(m[1]);
    }
  }
  return out;
}

/**
 * Parse the official BSE equity-segment trading-holiday table plus any Muhurat
 * session declared alongside it.
 *
 * A Muhurat session whose timings BSE has not yet notified is recorded with
 * null timings. That is the honest representation, and it deliberately makes
 * the day fail closed for latest-completed-session purposes rather than
 * borrowing the ordinary 09:15–15:30 window that does not apply to it.
 */
export function parseBseTradingHolidayPage(
  body: string,
  options: CalendarParseOptions,
): ParsedCalendarSource {
  const { retrievedAt, calendarYear } = options;
  const base = {
    exchange: "BSE" as const,
    sourceId: `BSE_TRADING_HOLIDAYS_EQUITY_${calendarYear}`,
    sourceName: `BSE official trading holidays ${calendarYear} (equity segment)`,
    sourceUrl: BSE_TRADING_HOLIDAYS_URL,
    retrievedAt,
    calendarYear,
    effectiveFrom: `${calendarYear}-01-01`,
    effectiveTo: `${calendarYear}-12-31`,
    contentHash: sha256(body),
    kind: "ANNUAL_CALENDAR" as const,
    issuedAt: `${calendarYear}-01-01`,
  };

  if (body.trim().length === 0) return reject(base, "REJECTED_EMPTY", "empty body");

  const caption = `Display table for Trading Holidays for ${calendarYear} - Equity Segment`;
  const start = body.indexOf(caption);
  if (start < 0) {
    return reject(
      base,
      "REJECTED_MALFORMED",
      `official equity-segment holiday table for ${calendarYear} not found in the document`,
    );
  }
  // The equity table ends where the next segment's table begins. That
  // terminator is REQUIRED: without it the document has been truncated or
  // replaced mid-table (a bot-block page, a partial response), and a prefix of
  // valid rows would otherwise parse into an authoritative-looking calendar
  // that silently omits every later holiday.
  const end = body.indexOf(
    `Trading Holidays for ${calendarYear} - Currency Derivatives`,
    start + caption.length,
  );
  if (end < 0) {
    return reject(
      base,
      "REJECTED_MALFORMED",
      "equity-segment holiday table has no end boundary — the document is truncated or incomplete",
    );
  }

  const run = extractPageTextRun(body, start, end);
  // caption, then the four column headers, then repeating 4-cell rows.
  const headerAt = run.findIndex((t) => t.trim().toLowerCase() === "sr.no.");
  if (headerAt < 0 || run.length < headerAt + 4) {
    return reject(base, "REJECTED_MALFORMED", "holiday table header row not found");
  }
  const cells = run.slice(headerAt + 4);

  const events: CalendarSourceEvent[] = [];
  const seen = new Set<string>();
  let i = 0;
  for (; i + 3 < cells.length; i += 4) {
    const [sr, name, dateRaw, dayRaw] = cells.slice(i, i + 4);
    if (!/^\d{1,3}$/.test(sr.trim())) break;
    if (Number(sr.trim()) !== events.length + 1) {
      return reject(
        base,
        "REJECTED_MALFORMED",
        `holiday table row numbering broke at "${sr}" (expected ${events.length + 1})`,
      );
    }
    const date = parseExchangeDate(dateRaw, calendarYear);
    if (date === null) {
      return reject(base, "REJECTED_MALFORMED", `unparseable or out-of-year holiday date "${dateRaw}"`);
    }
    if (!weekdayMatches(date, dayRaw)) {
      return reject(
        base,
        "REJECTED_MALFORMED",
        `holiday ${date} is printed as ${dayRaw.trim()} but is a ${WEEKDAY_NAMES[istDayOfWeek(date)]}`,
      );
    }
    if (seen.has(date)) return reject(base, "REJECTED_MALFORMED", `duplicate holiday date ${date}`);
    seen.add(date);
    events.push({
      exchange: "BSE",
      tradingDate: date,
      sessionType: "CLOSED",
      description: name.trim() || "exchange holiday",
      scheduledOpenIst: null,
      scheduledCloseIst: null,
      sourceId: base.sourceId,
    });
  }

  if (events.length < MIN_ANNUAL_HOLIDAY_EVENTS) {
    return reject(
      base,
      "REJECTED_BELOW_FLOOR",
      `${events.length} holidays is below the floor of ${MIN_ANNUAL_HOLIDAY_EVENTS}`,
    );
  }

  // The loop above stops at the first cell that is not the next row number.
  // That is the correct stopping condition for the end of the table — but it is
  // ALSO what a single inserted or missing cell looks like, and the rows after
  // the misalignment would then be silently dropped. So the tail must contain
  // no row-number-shaped cell: anything numbered beyond the table means the
  // parser lost alignment rather than reaching the end.
  const tail = cells.slice(i);
  const strayRowNumber = tail.findIndex((c) => /^\d{1,3}$/.test(c.trim()));
  if (strayRowNumber >= 0) {
    return reject(
      base,
      "REJECTED_MALFORMED",
      `holiday table alignment lost after ${events.length} rows: unconsumed row cell ` +
        `"${tail[strayRowNumber].trim()}" remains inside the equity-segment table`,
    );
  }

  // Muhurat: an official special session that overrides the weekend/holiday
  // assumption for that date.
  const notes = tail.join(" ");
  const muhurat =
    /Muhurat Trading will be conducted on\s+[A-Za-z]+,\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/.exec(notes);
  if (muhurat) {
    const date = parseLongExchangeDate(muhurat[1], muhurat[2], muhurat[3]);
    if (date === null) {
      return reject(base, "REJECTED_MALFORMED", "Muhurat session note carries an unreal date");
    }
    if (date.slice(0, 4) !== String(calendarYear)) {
      return reject(base, "REJECTED_MALFORMED", `Muhurat session ${date} is outside ${calendarYear}`);
    }
    const timing = /Muhurat[^.]*?from\s+(\d{2}:\d{2})\s*(?:hrs)?\s*to\s+(\d{2}:\d{2})/i.exec(notes);
    if (seen.has(date)) {
      // The exchange listed the day as a holiday AND declared a session on it:
      // the session declaration is the more specific statement, so drop the
      // holiday row for that date rather than emitting a self-contradiction.
      const at = events.findIndex((e) => e.tradingDate === date);
      if (at >= 0) events.splice(at, 1);
    }
    events.push({
      exchange: "BSE",
      tradingDate: date,
      sessionType: "MUHURAT",
      description: timing
        ? "Muhurat Trading (official timings notified)"
        : "Muhurat Trading (timings not yet notified by the exchange)",
      scheduledOpenIst: timing ? timing[1] : null,
      scheduledCloseIst: timing ? timing[2] : null,
      sourceId: base.sourceId,
    });
  }

  events.sort((a, b) => (a.tradingDate < b.tradingDate ? -1 : 1));
  return {
    provenance: {
      ...base,
      eventCount: events.length,
      validationResult: "ACCEPTED",
      rejectionDetail: null,
    },
    events,
  };
}

// ── BSE official UDiFF / Common Bhavcopy ─────────────────────────────────────

export interface ParsedUdiff {
  readonly descriptor: BseUdiffDescriptor;
  readonly rowCount: number;
  readonly distinctTradingDates: readonly string[];
  readonly sessionIds: readonly string[];
  readonly sourceUrl: string;
  readonly rejectionDetail: string | null;
}

export interface UdiffParseOptions {
  readonly retrievedAtMs: number;
  /** From the official filename: `F` is the final file, `O` an intraday one. */
  readonly fileVariant: "F" | "O";
  readonly sourceUrl: string;
}

/**
 * Parse an official BSE UDiFF (Common Bhavcopy) for the CM segment.
 *
 * `sessionCompleted` is asserted only for the FINAL file variant carrying a
 * single trading date and a session id on every row. An intraday file describes
 * a session still in progress and can never stand as completed-session
 * evidence, however recent it is.
 */
export function parseBseUdiff(body: string, options: UdiffParseOptions): ParsedUdiff {
  const contentHash = sha256(body);
  const fail = (detail: string, validation: SourceValidationResult, tradingDate = ""): ParsedUdiff => ({
    descriptor: {
      tradingDate,
      sessionCompleted: false,
      validationResult: validation,
      contentHash,
      retrievedAtMs: options.retrievedAtMs,
    },
    rowCount: 0,
    distinctTradingDates: [],
    sessionIds: [],
    sourceUrl: options.sourceUrl,
    rejectionDetail: detail,
  });

  const lines = body.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return fail("empty body", "REJECTED_EMPTY");

  const header = lines[0].split(",").map((h) => h.trim());
  const idxTradDt = header.indexOf("TradDt");
  const idxSgmt = header.indexOf("Sgmt");
  const idxSsnId = header.indexOf("SsnId");
  if (idxTradDt < 0 || idxSgmt < 0 || idxSsnId < 0) {
    return fail("UDiFF header is missing TradDt/Sgmt/SsnId", "REJECTED_MALFORMED");
  }

  const dates = new Set<string>();
  const sessions = new Set<string>();
  const segments = new Set<string>();
  let rowCount = 0;
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    if (cols.length < header.length) {
      return fail(`UDiFF row ${rowCount + 1} has ${cols.length} columns, expected ${header.length}`, "REJECTED_MALFORMED");
    }
    dates.add(cols[idxTradDt].trim());
    segments.add(cols[idxSgmt].trim());
    sessions.add(cols[idxSsnId].trim());
    rowCount++;
  }

  if (rowCount === 0) return fail("UDiFF carries no data rows", "REJECTED_EMPTY");
  if (rowCount < MIN_UDIFF_ROWS) {
    return fail(`${rowCount} rows is below the floor of ${MIN_UDIFF_ROWS}`, "REJECTED_BELOW_FLOOR");
  }
  if (dates.size !== 1) {
    return fail(`UDiFF mixes ${dates.size} trading dates: ${[...dates].sort().join(", ")}`, "REJECTED_MALFORMED");
  }
  if (!segments.has("CM") || segments.size !== 1) {
    return fail(`UDiFF segment is ${[...segments].sort().join(", ")}, expected CM only`, "REJECTED_MALFORMED");
  }
  const tradingDate = [...dates][0];
  if (!isRealIstDate(tradingDate)) {
    return fail(`UDiFF trading date "${tradingDate}" is not a real calendar date`, "REJECTED_MALFORMED");
  }
  if ([...sessions].some((s) => s.length === 0)) {
    return fail("UDiFF carries rows with no session id", "REJECTED_MALFORMED", tradingDate);
  }

  return {
    descriptor: {
      tradingDate,
      // An intraday file is a valid document describing an INCOMPLETE session.
      sessionCompleted: options.fileVariant === "F",
      validationResult: "ACCEPTED",
      contentHash,
      retrievedAtMs: options.retrievedAtMs,
    },
    rowCount,
    distinctTradingDates: [tradingDate],
    sessionIds: [...sessions].sort(),
    sourceUrl: options.sourceUrl,
    rejectionDetail:
      options.fileVariant === "F" ? null : "intraday UDiFF variant does not represent a completed session",
  };
}

export function bseUdiffUrlFor(tradingDate: string): string {
  return BSE_UDIFF_URL_TEMPLATE.replace("{YYYYMMDD}", tradingDate.replace(/-/g, ""));
}

// ── official regular-session timings ─────────────────────────────────────────

/**
 * NSE publishes its cash-market session clock as a server-rendered table on its
 * own market-timings page.
 */
export const NSE_MARKET_TIMINGS_URL = "https://www.nseindia.com/market-data/market-timings";

/**
 * BSE's equity trading-hours view is served by the BSE single-page application,
 * so the published session-timings table arrives inside BSE's own application
 * bundle rather than as server-rendered HTML — the same situation as the BSE
 * trading-holidays page above. The artefact actually read is recorded in
 * provenance.sourceUrl; this constant names the page it backs.
 */
export const BSE_EQUITY_SESSION_TIMINGS_PAGE =
  "https://www.bseindia.com/markets/equity/EQReports/tra_trading.aspx";

/** Below this a body is a stub, an error page or a truncated download. */
export const MIN_TIMING_BODY_BYTES = 512;

/**
 * Per-source completeness contracts.
 *
 * Finding the wanted row is NOT proof that the document is the whole document.
 * A truncated response, or a padded body carrying a copied row, contains the row
 * too. Each source therefore has to prove it arrived complete before any time is
 * read out of it:
 *
 *  * NSE — the timings page must publish EVERY labelled row of the cash-market
 *    table, and must end with its closing `</html>`. A response cut short mid
 *    table fails both.
 *  * BSE — the timings live in BSE's own application bundle, the same artefact
 *    the accepted holidays parser reads. It must therefore still BE that
 *    artefact: bundle-scale bytes, the bundle's holidays caption, and a
 *    terminated final statement. A fragment holding only the session row is not
 *    the bundle and is refused.
 */
export const MIN_NSE_TIMINGS_PAGE_BYTES = 32 * 1024;
export const MIN_BSE_BUNDLE_BYTES = 1024 * 1024;
/** Year-agnostic: the caption proves the artefact, not which year it covers. */
const BSE_BUNDLE_IDENTITY_ANCHOR = /Display table for Trading Holidays for \d{4} - Equity Segment/i;

export interface TimingParseOptions {
  readonly retrievedAt: string;
  /**
   * The year this publication is taken to speak for. Supplying a year makes the
   * timing expire with the calendar year; null means the document itself
   * carries no period.
   */
  readonly effectiveYear: number | null;
  /** The artefact actually fetched, recorded verbatim. */
  readonly sourceUrl: string;
}

type TimingBase = Omit<
  SessionTimingProvenance,
  "validationResult" | "rejectionDetail" | "contentHash" | "contentBytes"
>;

function timingReject(
  base: TimingBase,
  body: string,
  validationResult: TimingSourceValidation,
  detail: string,
): SessionTimingSource {
  return {
    provenance: {
      ...base,
      contentHash: sha256(body),
      contentBytes: Buffer.byteLength(body, "utf8"),
      validationResult,
      rejectionDetail: detail,
    },
    openIst: null,
    closeIst: null,
    preOpenOpenIst: null,
    preOpenCloseIst: null,
    closingSessionOpenIst: null,
    closingSessionCloseIst: null,
    evidence: [],
  };
}

/** Beyond this a body is a real document, not a challenge page. */
const MAX_INTERSTITIAL_BYTES = 64 * 1024;
/** An interstitial IS the whole document, so its markers sit at the very top. */
const INTERSTITIAL_HEAD_CHARS = 4096;

/**
 * A body that is an interstitial, a block page or an error rather than content.
 *
 * Deliberately NOT a whole-body substring scan. An exchange's own application
 * bundle is megabytes of minified code that legitimately contains words like
 * "captcha" (BSE's bundle carries hundreds of them, the first a megabyte in) —
 * scanning the whole body rejects a perfectly good source. A real challenge
 * page is small and announces itself immediately, so only the head is read, and
 * the generic marker is trusted only when the body is small enough to BE one.
 */
function looksBlocked(body: string): string | null {
  const head = body.slice(0, INTERSTITIAL_HEAD_CHARS);
  if (/Access Denied|Request Rejected|The requested URL was rejected|Incapsula/i.test(head)) {
    return "body is an access-denied or bot-challenge interstitial";
  }
  if (Buffer.byteLength(body, "utf8") <= MAX_INTERSTITIAL_BYTES && /captcha/i.test(head)) {
    return "body is a bot-challenge page";
  }
  if (/<title>\s*(404|Page Not Found|Error)/i.test(head)) return "body is an error page";
  return null;
}

/** `09:15 hrs` → `09:15`. Returns null when the cell is not a clock time. */
function normalizeHrs(raw: string): string | null {
  const m = /^(\d{1,2}):([0-5]\d)\s*hrs\.?$/i.exec(raw.replace(/&nbsp;|&lt;|&gt;|\s+/g, (s) => (/\s/.test(s) ? " " : "")).trim());
  if (!m) return null;
  const h = Number(m[1]);
  if (h > 23) return null;
  return `${pad2(h)}:${m[2]}`;
}

/** `9:15am` / `3.30 pm` → `09:15` / `15:30`. */
function normalizeAmPm(hour: string, minute: string, meridiem: string): string | null {
  let h = Number(hour);
  if (h < 1 || h > 12 || Number(minute) > 59) return null;
  const pm = meridiem.toLowerCase().startsWith("p");
  if (pm && h !== 12) h += 12;
  if (!pm && h === 12) h = 0;
  return `${pad2(h)}:${minute}`;
}

const NSE_TIMING_LABELS = {
  open: "Normal / Odd lot market Open",
  close: "Normal / Odd lot market Close",
  preOpenOpen: "Pre-open session (Regular) Open",
  preOpenClose: "Pre-open session (Regular) Close",
  closingOpen: "Closing session Open",
  closingClose: "Closing session Close",
} as const;

/**
 * Parse NSE's own published cash-market session timings.
 *
 * Strictly anchored: only the exact labels NSE prints are read, a label that
 * appears twice with different values is AMBIGUOUS rather than resolved, and a
 * page missing the normal-market rows is malformed rather than partially
 * believed. The normalized rows are returned as evidence so the open/close can
 * be reproduced later from the commitment alone.
 */
export function parseNseMarketTimings(
  body: string,
  options: TimingParseOptions,
): SessionTimingSource {
  const base: TimingBase = {
    exchange: "NSE",
    sourceId: `NSE_MARKET_TIMINGS_CM${options.effectiveYear === null ? "" : `_${options.effectiveYear}`}`,
    sourceName: "NSE official market timings, cash market (nseindia.com market-timings)",
    sourceUrl: options.sourceUrl,
    retrievedAt: options.retrievedAt,
    effectiveYear: options.effectiveYear,
    effectiveFrom: options.effectiveYear === null ? null : `${options.effectiveYear}-01-01`,
    extractionVersion: TIMING_EXTRACTION_VERSION,
  };

  if (body.trim().length === 0) return timingReject(base, body, "REJECTED_EMPTY", "empty body");
  const blocked = looksBlocked(body);
  if (blocked) return timingReject(base, body, "REJECTED_MALFORMED", blocked);
  if (Buffer.byteLength(body, "utf8") < MIN_NSE_TIMINGS_PAGE_BYTES) {
    return timingReject(base, body, "REJECTED_MALFORMED", "body is too small to be the timings page");
  }
  if (Buffer.byteLength(body, "utf8") > MAX_TIMING_SOURCE_BYTES) {
    return timingReject(base, body, "REJECTED_TOO_LARGE", "body exceeds the evidence size limit");
  }
  // Non-truncation: the document must reach its own end.
  if (!/<\/html\s*>\s*$/i.test(body.trimEnd())) {
    return timingReject(
      base,
      body,
      "REJECTED_MALFORMED",
      "body does not end with its closing </html>: the page did not arrive complete",
    );
  }

  const cells = [...body.matchAll(/<td[^>]*>([^<]{2,120})<\/td>\s*<td[^>]*>([^<]{2,60})<\/td>/g)];
  if (cells.length === 0) {
    return timingReject(base, body, "REJECTED_MALFORMED", "no label/value table rows found");
  }

  const found = new Map<string, string>();
  const evidence: SessionTimingEvidenceRow[] = [];
  const wanted = new Map(Object.entries(NSE_TIMING_LABELS).map(([k, v]) => [v.toLowerCase(), k]));
  for (const cell of cells) {
    const label = cell[1].replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    const key = wanted.get(label.toLowerCase());
    if (!key) continue;
    const value = normalizeHrs(cell[2]);
    if (value === null) {
      return timingReject(
        base,
        body,
        "REJECTED_MALFORMED",
        `row "${label}" carries "${cell[2].trim()}", which is not a clock time`,
      );
    }
    const prior = found.get(key);
    if (prior !== undefined && prior !== value) {
      return timingReject(
        base,
        body,
        "REJECTED_AMBIGUOUS",
        `row "${label}" appears with conflicting values ${prior} and ${value}`,
      );
    }
    if (prior === undefined) {
      found.set(key, value);
      evidence.push({ label, value: cell[2].replace(/\s+/g, " ").trim() });
    }
  }

  const openIst = found.get("open") ?? null;
  const closeIst = found.get("close") ?? null;
  if (openIst === null || closeIst === null) {
    return timingReject(
      base,
      body,
      "REJECTED_MALFORMED",
      `page does not publish "${NSE_TIMING_LABELS.open}" and "${NSE_TIMING_LABELS.close}"`,
    );
  }
  // Structural completeness: the cash-market table publishes every one of these
  // rows. A body carrying only the two rows we happen to want is a fragment, not
  // NSE's timings table, and its close time is not authoritative.
  const missingRows = Object.keys(NSE_TIMING_LABELS).filter((k) => !found.has(k));
  if (missingRows.length > 0) {
    return timingReject(
      base,
      body,
      "REJECTED_MALFORMED",
      `timings table is incomplete: missing ${missingRows
        .map((k) => `"${NSE_TIMING_LABELS[k as keyof typeof NSE_TIMING_LABELS]}"`)
        .join(", ")}`,
    );
  }
  if (closeIst <= openIst) {
    return timingReject(base, body, "REJECTED_MALFORMED", `normal market closes (${closeIst}) at or before it opens (${openIst})`);
  }

  return {
    provenance: {
      ...base,
      contentHash: sha256(body),
      contentBytes: Buffer.byteLength(body, "utf8"),
      validationResult: "ACCEPTED",
      rejectionDetail: null,
    },
    openIst,
    closeIst,
    preOpenOpenIst: found.get("preOpenOpen") ?? null,
    preOpenCloseIst: found.get("preOpenClose") ?? null,
    closingSessionOpenIst: found.get("closingOpen") ?? null,
    closingSessionCloseIst: found.get("closingClose") ?? null,
    evidence,
  };
}

/**
 * The label must START a cell, string literal or element — `"Continuous Trading
 * Session"` — and must be SINGULAR. BSE's bundle also contains prose such as
 * "…through the BOLT System with the continuous trading sessions from 9.00 a.m.
 * to 3.30 p.m", describing the G-Sec retail segment, in two versions that
 * disagree with each other. That prose is not a published equity timing and is
 * never read: it is preceded by an ordinary word and is plural.
 *
 * The value may be separated from the label by markup, and the dash may arrive
 * as a literal `\\u2013` escape inside the un-evaluated bundle source, whose own
 * digits must not be mistaken for a time.
 */
const BSE_CONTINUOUS_ROW =
  /["'>(,]\s*Continuous Trading Session(?![a-z])[\s\S]{0,160}?(\d{1,2})[:.]([0-5]\d)\s*([ap])\.?m(?:\\u[0-9a-fA-F]{4}|[^0-9]){0,14}?(\d{1,2})[:.]([0-5]\d)\s*([ap])\.?m/gi;

/**
 * Parse BSE's own published equity session timings.
 *
 * Anchored on the row BSE labels "Continuous Trading Session" in its session
 * timings table. The document also contains historical prose about other
 * segments carrying different hours, which is exactly why nothing unanchored is
 * read: only rows bearing that label count, and if two of them disagree the
 * source is AMBIGUOUS rather than resolved in our favour.
 */
export function parseBseSessionTimings(
  body: string,
  options: TimingParseOptions,
): SessionTimingSource {
  const base: TimingBase = {
    exchange: "BSE",
    sourceId: `BSE_SESSION_TIMINGS_EQUITY${options.effectiveYear === null ? "" : `_${options.effectiveYear}`}`,
    sourceName:
      "BSE official equity session timings (continuous trading session row, BSE application bundle)",
    sourceUrl: options.sourceUrl,
    retrievedAt: options.retrievedAt,
    effectiveYear: options.effectiveYear,
    effectiveFrom: options.effectiveYear === null ? null : `${options.effectiveYear}-01-01`,
    extractionVersion: TIMING_EXTRACTION_VERSION,
  };

  if (body.trim().length === 0) return timingReject(base, body, "REJECTED_EMPTY", "empty body");
  const blocked = looksBlocked(body);
  if (blocked) return timingReject(base, body, "REJECTED_MALFORMED", blocked);
  if (Buffer.byteLength(body, "utf8") < MIN_BSE_BUNDLE_BYTES) {
    return timingReject(
      base,
      body,
      "REJECTED_MALFORMED",
      "body is too small to be BSE's application bundle: a fragment carrying the row is not the document",
    );
  }
  if (Buffer.byteLength(body, "utf8") > MAX_TIMING_SOURCE_BYTES) {
    return timingReject(base, body, "REJECTED_TOO_LARGE", "body exceeds the evidence size limit");
  }
  // Artefact identity: this must be the same bundle the accepted holidays parser
  // reads, not an arbitrary body that happens to contain a session row.
  if (!BSE_BUNDLE_IDENTITY_ANCHOR.test(body)) {
    return timingReject(
      base,
      body,
      "REJECTED_MALFORMED",
      "body does not carry BSE's published equity trading-holidays caption: it is not BSE's application bundle",
    );
  }
  // Non-truncation: a complete bundle ends on a terminated statement.
  if (!/[;}]\s*$/.test(body.trimEnd())) {
    return timingReject(
      base,
      body,
      "REJECTED_MALFORMED",
      "bundle does not end on a terminated statement: it did not arrive complete",
    );
  }

  const evidence: SessionTimingEvidenceRow[] = [];
  let openIst: string | null = null;
  let closeIst: string | null = null;

  BSE_CONTINUOUS_ROW.lastIndex = 0;
  for (const m of body.matchAll(BSE_CONTINUOUS_ROW)) {
    const open = normalizeAmPm(m[1], m[2], m[3]);
    const close = normalizeAmPm(m[4], m[5], m[6]);
    if (open === null || close === null) {
      return timingReject(base, body, "REJECTED_MALFORMED", "continuous-session row carries an unreadable time");
    }
    if (openIst !== null && (openIst !== open || closeIst !== close)) {
      return timingReject(
        base,
        body,
        "REJECTED_AMBIGUOUS",
        `continuous trading session is published as both ${openIst}-${closeIst} and ${open}-${close}`,
      );
    }
    openIst = open;
    closeIst = close;
    if (evidence.length < MAX_TIMING_EVIDENCE_ROWS) {
      evidence.push({
        label: "Continuous Trading Session",
        value: `${m[1]}:${m[2]}${m[3]}m - ${m[4]}:${m[5]}${m[6]}m`,
      });
    }
  }

  if (openIst === null || closeIst === null) {
    return timingReject(
      base,
      body,
      "REJECTED_MALFORMED",
      'document does not publish a "Continuous Trading Session" row with timings',
    );
  }
  if (closeIst <= openIst) {
    return timingReject(base, body, "REJECTED_MALFORMED", `continuous session closes (${closeIst}) at or before it opens (${openIst})`);
  }

  return {
    provenance: {
      ...base,
      contentHash: sha256(body),
      contentBytes: Buffer.byteLength(body, "utf8"),
      validationResult: "ACCEPTED",
      rejectionDetail: null,
    },
    openIst,
    closeIst,
    // BSE's pre-open rows are not uniquely anchorable in this document, and a
    // guessed pre-open is worse than an absent one.
    preOpenOpenIst: null,
    preOpenCloseIst: null,
    closingSessionOpenIst: null,
    closingSessionCloseIst: null,
    evidence,
  };
}
