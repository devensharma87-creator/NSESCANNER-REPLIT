/**
 * PHASE 0.6A — AUTHORITATIVE TRADING-CALENDAR TESTS (T01–T33).
 *
 * Every fixture below is in the OFFICIAL format of the source it stands for —
 * the NSE holiday-master JSON payload, the BSE equity-segment trading-holiday
 * table as the exchange's own page serves it, and the BSE UDiFF/Common Bhavcopy
 * CSV header set. They are deterministic and hand-written: no network, no
 * clock, no database.
 *
 * 2026 weekday facts these tests rely on (all verifiable from the fixtures'
 * own printed weekday column): 2026-08-11 is a Tuesday, 2026-08-12 a Wednesday,
 * 2026-08-15 a Saturday, and 2026-11-08 a SUNDAY on which BSE conducts Muhurat
 * trading — which is precisely why weekday-only logic cannot stand in for a
 * calendar.
 */

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  buildExchangeCalendar,
  deriveCalendarGenerationId,
  getLatestCompletedTradingSession,
  getPreviousTradingSession,
  getTradingSession,
  isTradingDate,
  toCalendarCommitment,
  toTradingCalendarVerdict,
  validateBhavcopySession,
  verifyCalendarCommitmentIntegrity,
  CALENDAR_POLICY_VERSION,
  CALENDAR_SCHEMA_VERSION,
  type CalendarExchange,
  type CalendarSourceEvent,
  type ParsedCalendarSource,
} from "./exchangeCalendar";
import {
  parseBseTradingHolidayPage,
  parseBseUdiff,
  parseNseHolidayMaster,
  MIN_ANNUAL_HOLIDAY_EVENTS,
} from "./exchangeCalendarSources";
import { NSE_REFERENCE_MAX_AGE_HOURS_MIRROR } from "./officialSources";
import { NIFTY50_SYMBOLS } from "../watchlistLists";
import { REQUIRED_SOURCE_IDS, buildUniverseManifest } from "./universeManifest";
import { toAuthoritativeCoverageManifest } from "./coverageBridge";
import { makeSessionTimingSource } from "./p06TestFixtures";
import {
  EFFECTIVE_DATE,
  GENERATED_AT,
  GEN_ID,
  makeAcceptedSources,
  makeBuildResult,
  makeCalendarCommitment,
  makeCurrentAuthoritativeBse,
  makeLiveRecords,
} from "./p06TestFixtures";
import type { RegistryGeneration } from "./manifestStore";

/** The fixture calendar's own evaluation instant: 15:00 IST on 2026-08-12. */
const FIXTURE_NOW_MS = Date.parse("2026-08-12T09:30:00.000Z");

const RETRIEVED_AT = "2026-08-12T10:30:00.000Z";
/** 15:00 IST on Wednesday 2026-08-12 — the session is still running. */
const NOW_BEFORE_CLOSE = Date.parse("2026-08-12T09:30:00.000Z");
/** 16:00 IST on the same day — after the 15:30 close. */
const NOW_AFTER_CLOSE = Date.parse("2026-08-12T10:30:00.000Z");

/** Eight real 2026 equity holidays with the weekday the exchange prints. */
const HOLIDAYS_2026: readonly (readonly [string, string, string])[] = [
  ["26-Jan-2026", "Monday", "Republic Day"],
  ["03-Mar-2026", "Tuesday", "Holi"],
  ["26-Mar-2026", "Thursday", "Shri Ram Navmi"],
  ["31-Mar-2026", "Tuesday", "Shri Mahavir Jayanti"],
  ["03-Apr-2026", "Friday", "Good Friday"],
  ["14-Apr-2026", "Tuesday", "Dr. Baba Saheb Ambedkar Jayanti"],
  ["01-May-2026", "Friday", "Maharashtra Day"],
  ["28-May-2026", "Thursday", "Bakri Id"],
];

// ── official-format fixtures ─────────────────────────────────────────────────

function nseHolidayMasterJson(
  rows: readonly (readonly [string, string, string])[] = HOLIDAYS_2026,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    CM: rows.map(([tradingDate, weekDay, description]) => ({
      tradingDate,
      weekDay,
      description,
      Sr_no: 1,
      morning_session: null,
      evening_session: null,
    })),
    FO: [],
    ...extra,
  });
}

/**
 * The BSE trading-holidays page as BSE serves it: an application bundle whose
 * text literals carry the published table in document order.
 */
function bseHolidayPage(
  rows: readonly (readonly [string, string, string])[] = HOLIDAYS_2026,
  options: { readonly year?: number; readonly note?: string | null; readonly caption?: string } = {},
): string {
  const year = options.year ?? 2026;
  let n = 100;
  const lit = (t: string) => `i(${n++},${JSON.stringify(t)})`;
  const parts: string[] = [
    "(function(){",
    lit(options.caption ?? `Display table for Trading Holidays for ${year} - Equity Segment`),
    lit("Sr.No."),
    lit("Holidays"),
    lit("Date"),
    lit("Day"),
  ];
  rows.forEach(([date, day, name], i) => {
    parts.push(lit(String(i + 1)), lit(name), lit(date.replace(/-\d{2}(\d{2})$/, "-$1")), lit(day));
  });
  if (options.note !== null) {
    parts.push(
      lit(
        options.note ??
          "Muhurat Trading will be conducted on Sunday, November 08, 2026. Timings of the same shall be notified subsequently.",
      ),
    );
  }
  parts.push(lit(`Display table for Trading Holidays for ${year} - Currency Derivatives Segment`));
  parts.push(lit("Sr.No."), lit("Holidays"), lit("Date"), lit("Day"));
  parts.push(lit("1"), lit("Some Currency Holiday"), lit("02-Feb-26"), lit("Monday"));
  parts.push("})();");
  return parts.join(",");
}

const UDIFF_HEADER =
  "TradDt,BizDt,Sgmt,Src,FinInstrmTp,FinInstrmId,ISIN,TckrSymb,SctySrs,ClsPric,SttlmPric,OpnIntrst,SsnId";

function udiffCsv(
  options: {
    readonly tradingDate?: string;
    readonly rows?: number;
    readonly segment?: string;
    readonly sessionId?: string;
    readonly header?: string;
    readonly mixedDate?: string;
  } = {},
): string {
  const date = options.tradingDate ?? "2026-08-12";
  const rows = options.rows ?? 2500;
  const seg = options.segment ?? "CM";
  const ssn = options.sessionId ?? "F1";
  const lines = [options.header ?? UDIFF_HEADER];
  for (let i = 0; i < rows; i++) {
    const d = options.mixedDate && i === rows - 1 ? options.mixedDate : date;
    lines.push(
      `${d},${d},${seg},NSE,STK,${500000 + i},INE${String(i).padStart(9, "0")},SYM${i},A,100.5,100.5,0,${ssn}`,
    );
  }
  return lines.join("\n");
}

function annualSource(
  exchange: CalendarExchange,
  events: readonly CalendarSourceEvent[],
  overrides: Partial<ParsedCalendarSource["provenance"]> = {},
): ParsedCalendarSource {
  return {
    provenance: {
      exchange,
      sourceId: `${exchange}_ANNUAL_2026`,
      sourceName: `${exchange} annual 2026`,
      sourceUrl: `https://example.invalid/${exchange}`,
      retrievedAt: RETRIEVED_AT,
      calendarYear: 2026,
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-12-31",
      contentHash: "a".repeat(64),
      eventCount: events.length,
      validationResult: "ACCEPTED",
      kind: "ANNUAL_CALENDAR",
      issuedAt: "2026-01-01",
      rejectionDetail: null,
      ...overrides,
    },
    events,
  };
}

function closedEvent(exchange: CalendarExchange, tradingDate: string, sourceId: string): CalendarSourceEvent {
  return {
    exchange,
    tradingDate,
    sessionType: "CLOSED",
    description: "exchange holiday",
    scheduledOpenIst: null,
    scheduledCloseIst: null,
    sourceId,
  };
}

function realCalendar() {
  const nse = parseNseHolidayMaster(nseHolidayMasterJson(), {
    retrievedAt: RETRIEVED_AT,
    calendarYear: 2026,
  });
  const bse = parseBseTradingHolidayPage(bseHolidayPage(), {
    retrievedAt: RETRIEVED_AT,
    calendarYear: 2026,
  });
  return buildExchangeCalendar({
    sources: [nse, bse],
    timings: [makeSessionTimingSource("NSE"), makeSessionTimingSource("BSE")],
    exchanges: ["NSE", "BSE"],
    years: [2026],
    generatedAt: RETRIEVED_AT,
  });
}

// ── T01–T06 · NSE official holiday master ────────────────────────────────────

describe("T01–T06 · NSE official trading-holiday master (segment CM)", () => {
  it("T01 accepts the official payload and yields one CLOSED day per holiday", () => {
    const parsed = parseNseHolidayMaster(nseHolidayMasterJson(), {
      retrievedAt: RETRIEVED_AT,
      calendarYear: 2026,
    });
    expect(parsed.provenance.validationResult).toBe("ACCEPTED");
    expect(parsed.events).toHaveLength(HOLIDAYS_2026.length);
    expect(parsed.events.every((e) => e.sessionType === "CLOSED")).toBe(true);
    expect(parsed.events[0].tradingDate).toBe("2026-01-26");
    // Only the CM segment is read; FO is present in the payload and ignored.
    expect(parsed.provenance.sourceId).toContain("CM");
  });

  it("T02 rejects a holiday whose printed weekday contradicts its date", () => {
    const bad = HOLIDAYS_2026.map((r, i) =>
      i === 0 ? (["26-Jan-2026", "Friday", "Republic Day"] as const) : r,
    );
    const parsed = parseNseHolidayMaster(nseHolidayMasterJson(bad), {
      retrievedAt: RETRIEVED_AT,
      calendarYear: 2026,
    });
    expect(parsed.provenance.validationResult).toBe("REJECTED_MALFORMED");
    expect(parsed.provenance.rejectionDetail).toContain("printed as Friday");
    expect(parsed.events).toHaveLength(0);
  });

  it("T03 rejects an empty body and a non-JSON body without inventing a calendar", () => {
    for (const body of ["", "   ", "<html>Access Denied</html>"]) {
      const parsed = parseNseHolidayMaster(body, { retrievedAt: RETRIEVED_AT, calendarYear: 2026 });
      expect(parsed.provenance.validationResult).not.toBe("ACCEPTED");
      expect(parsed.events).toHaveLength(0);
    }
  });

  it("T04 rejects a payload with no CM segment", () => {
    const parsed = parseNseHolidayMaster(JSON.stringify({ FO: [] }), {
      retrievedAt: RETRIEVED_AT,
      calendarYear: 2026,
    });
    expect(parsed.provenance.validationResult).toBe("REJECTED_MALFORMED");
    expect(parsed.provenance.rejectionDetail).toContain("CM");
  });

  it("T05 rejects a truncated calendar below the annual holiday floor", () => {
    const parsed = parseNseHolidayMaster(nseHolidayMasterJson(HOLIDAYS_2026.slice(0, 3)), {
      retrievedAt: RETRIEVED_AT,
      calendarYear: 2026,
    });
    expect(parsed.provenance.validationResult).toBe("REJECTED_BELOW_FLOOR");
    expect(parsed.provenance.rejectionDetail).toContain(String(MIN_ANNUAL_HOLIDAY_EVENTS));
  });

  it("T06 rejects duplicate dates and dates outside the stated calendar year", () => {
    const dup = parseNseHolidayMaster(
      nseHolidayMasterJson([...HOLIDAYS_2026, HOLIDAYS_2026[0]]),
      { retrievedAt: RETRIEVED_AT, calendarYear: 2026 },
    );
    expect(dup.provenance.rejectionDetail).toContain("duplicate");

    const wrongYear = parseNseHolidayMaster(
      nseHolidayMasterJson([...HOLIDAYS_2026.slice(1), ["26-Jan-2025", "Sunday", "Republic Day"] as const]),
      { retrievedAt: RETRIEVED_AT, calendarYear: 2026 },
    );
    expect(wrongYear.provenance.validationResult).toBe("REJECTED_MALFORMED");
  });
});

// ── T07–T11 · BSE official trading-holidays page ─────────────────────────────

describe("T07–T11 · BSE official equity-segment trading holidays", () => {
  it("T07 reads only the equity-segment table, not the currency table below it", () => {
    const parsed = parseBseTradingHolidayPage(bseHolidayPage(), {
      retrievedAt: RETRIEVED_AT,
      calendarYear: 2026,
    });
    expect(parsed.provenance.validationResult).toBe("ACCEPTED");
    const closed = parsed.events.filter((e) => e.sessionType === "CLOSED");
    expect(closed).toHaveLength(HOLIDAYS_2026.length);
    expect(parsed.events.some((e) => e.description.includes("Currency"))).toBe(false);
    expect(parsed.events.some((e) => e.tradingDate === "2026-02-02")).toBe(false);
  });

  it("T08 records a Sunday Muhurat session whose timings are NOT yet notified", () => {
    const parsed = parseBseTradingHolidayPage(bseHolidayPage(), {
      retrievedAt: RETRIEVED_AT,
      calendarYear: 2026,
    });
    const muhurat = parsed.events.find((e) => e.sessionType === "MUHURAT");
    expect(muhurat).toBeDefined();
    expect(muhurat!.tradingDate).toBe("2026-11-08");
    // The exchange itself has not published timings — so neither do we.
    expect(muhurat!.scheduledOpenIst).toBeNull();
    expect(muhurat!.scheduledCloseIst).toBeNull();
  });

  it("T09 records official Muhurat timings when the exchange has notified them", () => {
    const parsed = parseBseTradingHolidayPage(
      bseHolidayPage(HOLIDAYS_2026, {
        note:
          "Muhurat Trading will be conducted on Sunday, November 08, 2026 from 18:15 hrs to 19:15 hrs.",
      }),
      { retrievedAt: RETRIEVED_AT, calendarYear: 2026 },
    );
    const muhurat = parsed.events.find((e) => e.sessionType === "MUHURAT");
    expect(muhurat!.scheduledOpenIst).toBe("18:15");
    expect(muhurat!.scheduledCloseIst).toBe("19:15");
  });

  it("T10 rejects a page that does not contain the official equity-segment table", () => {
    const parsed = parseBseTradingHolidayPage(bseHolidayPage(HOLIDAYS_2026, { caption: "Something Else" }), {
      retrievedAt: RETRIEVED_AT,
      calendarYear: 2026,
    });
    expect(parsed.provenance.validationResult).toBe("REJECTED_MALFORMED");
    expect(parsed.events).toHaveLength(0);
  });

  it("T11 rejects a weekday mismatch and a below-floor table", () => {
    const mismatch = parseBseTradingHolidayPage(
      bseHolidayPage(HOLIDAYS_2026.map((r, i) => (i === 1 ? (["03-Mar-2026", "Monday", "Holi"] as const) : r))),
      { retrievedAt: RETRIEVED_AT, calendarYear: 2026 },
    );
    expect(mismatch.provenance.validationResult).toBe("REJECTED_MALFORMED");

    const short = parseBseTradingHolidayPage(bseHolidayPage(HOLIDAYS_2026.slice(0, 2)), {
      retrievedAt: RETRIEVED_AT,
      calendarYear: 2026,
    });
    expect(short.provenance.validationResult).toBe("REJECTED_BELOW_FLOOR");
  });
});

// ── T12–T16 · BSE official UDiFF / Common Bhavcopy ───────────────────────────

describe("T12–T16 · BSE official UDiFF (Common Bhavcopy)", () => {
  it("T12 accepts a final CM file and marks the session completed", () => {
    const parsed = parseBseUdiff(udiffCsv(), {
      retrievedAtMs: NOW_AFTER_CLOSE,
      fileVariant: "F",
      sourceUrl: "https://example.invalid/udiff",
    });
    expect(parsed.descriptor.validationResult).toBe("ACCEPTED");
    expect(parsed.descriptor.tradingDate).toBe("2026-08-12");
    expect(parsed.descriptor.sessionCompleted).toBe(true);
    expect(parsed.rowCount).toBe(2500);
    expect(parsed.sessionIds).toEqual(["F1"]);
  });

  it("T13 never treats an intraday file variant as a completed session", () => {
    const parsed = parseBseUdiff(udiffCsv(), {
      retrievedAtMs: NOW_BEFORE_CLOSE,
      fileVariant: "O",
      sourceUrl: "https://example.invalid/udiff",
    });
    expect(parsed.descriptor.validationResult).toBe("ACCEPTED");
    expect(parsed.descriptor.sessionCompleted).toBe(false);
    expect(parsed.rejectionDetail).toContain("intraday");
  });

  it("T14 rejects a file mixing two trading dates", () => {
    const parsed = parseBseUdiff(udiffCsv({ mixedDate: "2026-08-11" }), {
      retrievedAtMs: NOW_AFTER_CLOSE,
      fileVariant: "F",
      sourceUrl: "https://example.invalid/udiff",
    });
    expect(parsed.descriptor.validationResult).toBe("REJECTED_MALFORMED");
    expect(parsed.descriptor.sessionCompleted).toBe(false);
    expect(parsed.rejectionDetail).toContain("mixes 2 trading dates");
  });

  it("T15 rejects a truncated file and a non-CM segment", () => {
    const short = parseBseUdiff(udiffCsv({ rows: 50 }), {
      retrievedAtMs: NOW_AFTER_CLOSE,
      fileVariant: "F",
      sourceUrl: "https://example.invalid/udiff",
    });
    expect(short.descriptor.validationResult).toBe("REJECTED_BELOW_FLOOR");

    const fo = parseBseUdiff(udiffCsv({ segment: "FO" }), {
      retrievedAtMs: NOW_AFTER_CLOSE,
      fileVariant: "F",
      sourceUrl: "https://example.invalid/udiff",
    });
    expect(fo.descriptor.validationResult).toBe("REJECTED_MALFORMED");
    expect(fo.rejectionDetail).toContain("expected CM only");
  });

  it("T16 rejects a file whose header lacks the official session columns", () => {
    const parsed = parseBseUdiff(udiffCsv({ header: "Date,Symbol,Close" }), {
      retrievedAtMs: NOW_AFTER_CLOSE,
      fileVariant: "F",
      sourceUrl: "https://example.invalid/udiff",
    });
    expect(parsed.descriptor.validationResult).toBe("REJECTED_MALFORMED");
    expect(parsed.rejectionDetail).toContain("TradDt");
  });
});

// ── T17–T21 · calendar construction and conflict policy ──────────────────────

describe("T17–T21 · calendar construction", () => {
  it("T17 enumerates every day of the covered year for every covered exchange", () => {
    const cal = realCalendar();
    expect(cal.valid).toBe(true);
    expect(cal.sessions).toHaveLength(365 * 2);
    for (const exchange of ["NSE", "BSE"] as const) {
      const days = cal.sessions.filter((s) => s.exchange === exchange);
      expect(days[0].tradingDate).toBe("2026-01-01");
      expect(days[days.length - 1].tradingDate).toBe("2026-12-31");
      expect(new Set(days.map((d) => d.tradingDate)).size).toBe(365);
    }
  });

  it("T18 classifies holidays, weekends and a SUNDAY Muhurat without weekday assumptions", () => {
    const cal = realCalendar();
    // A weekday holiday is closed even though Monday–Friday logic says open.
    expect(isTradingDate(cal, "NSE", "2026-01-26")).toBe(false);
    // An ordinary Saturday is closed.
    expect(isTradingDate(cal, "NSE", "2026-08-15")).toBe(false);
    // And a Sunday IS a trading date when the exchange declared a session.
    expect(isTradingDate(cal, "BSE", "2026-11-08")).toBe(true);
    const muhurat = getTradingSession(cal, "BSE", "2026-11-08");
    expect(muhurat.known && muhurat.session.sessionType).toBe("MUHURAT");
    expect(muhurat.known && muhurat.session.timesOfficiallyNotified).toBe(false);
    // NSE, which declared no Sunday session, remains closed that day.
    expect(isTradingDate(cal, "NSE", "2026-11-08")).toBe(false);
  });

  it("T19 fails closed when an exchange/year has no accepted official annual calendar", () => {
    const nse = parseNseHolidayMaster(nseHolidayMasterJson(), {
      retrievedAt: RETRIEVED_AT,
      calendarYear: 2026,
    });
    const cal = buildExchangeCalendar({
      sources: [nse],
      timings: [makeSessionTimingSource("NSE"), makeSessionTimingSource("BSE")],
      exchanges: ["NSE", "BSE"],
      years: [2026],
      generatedAt: RETRIEVED_AT,
    });
    expect(cal.valid).toBe(false);
    expect(cal.blockers.join(" ")).toContain("no accepted official annual trading calendar for BSE 2026");
    // An invalid calendar answers nothing.
    expect(isTradingDate(cal, "NSE", "2026-08-11")).toBeNull();
  });

  it("T20 rejects contradictory equal-priority official sources instead of choosing", () => {
    const a = annualSource("NSE", [closedEvent("NSE", "2026-08-11", "NSE_ANNUAL_2026")]);
    const b: ParsedCalendarSource = {
      provenance: { ...a.provenance, sourceId: "NSE_ANNUAL_2026_ALT" },
      events: [
        {
          exchange: "NSE",
          tradingDate: "2026-08-11",
          sessionType: "REGULAR",
          description: "regular",
          scheduledOpenIst: "09:15",
          scheduledCloseIst: "15:30",
          sourceId: "NSE_ANNUAL_2026_ALT",
        },
      ],
    };
    const cal = buildExchangeCalendar({
      sources: [a, b],
      timings: [makeSessionTimingSource("NSE")],
      exchanges: ["NSE"],
      years: [2026],
      generatedAt: RETRIEVED_AT,
    });
    expect(cal.valid).toBe(false);
    expect(cal.blockers.join(" ")).toContain("contradictory equal-priority official sources");
  });

  it("T21 lets a later specifically-applicable circular override the annual calendar, preserving both", () => {
    const annual = annualSource("NSE", [closedEvent("NSE", "2026-08-11", "NSE_ANNUAL_2026")]);
    const circular: ParsedCalendarSource = {
      provenance: {
        ...annual.provenance,
        sourceId: "NSE_CIRCULAR_2026_08_05",
        kind: "OFFICIAL_CIRCULAR",
        issuedAt: "2026-08-05",
        effectiveFrom: "2026-08-11",
        effectiveTo: "2026-08-11",
        contentHash: "b".repeat(64),
      },
      events: [
        {
          exchange: "NSE",
          tradingDate: "2026-08-11",
          sessionType: "SPECIAL",
          description: "special live-trading session",
          scheduledOpenIst: "09:15",
          scheduledCloseIst: "15:30",
          sourceId: "NSE_CIRCULAR_2026_08_05",
        },
      ],
    };
    const cal = buildExchangeCalendar({
      sources: [annual, circular],
      timings: [makeSessionTimingSource("NSE")],
      exchanges: ["NSE"],
      years: [2026],
      generatedAt: RETRIEVED_AT,
    });
    expect(cal.valid).toBe(true);
    const day = getTradingSession(cal, "NSE", "2026-08-11");
    expect(day.known && day.session.sessionType).toBe("SPECIAL");
    expect(day.known && day.session.sourceId).toBe("NSE_CIRCULAR_2026_08_05");
    expect(day.known && day.session.overrideReason).toContain("NSE_ANNUAL_2026");
    // Both official documents survive in provenance — nothing is discarded.
    expect(cal.sources.map((s) => s.sourceId).sort()).toEqual([
      "NSE_ANNUAL_2026",
      "NSE_CIRCULAR_2026_08_05",
    ]);
  });
});

// ── T22–T27 · session queries ────────────────────────────────────────────────

describe("T22–T27 · session queries", () => {
  it("T22 does not treat a session still in progress as completed", () => {
    const cal = realCalendar();
    const latest = getLatestCompletedTradingSession(cal, "NSE", NOW_BEFORE_CLOSE);
    expect(latest.ok).toBe(true);
    // 15:00 IST on Wednesday: today has not closed, so Tuesday is the answer.
    expect(latest.ok && latest.session.tradingDate).toBe("2026-08-11");
  });

  it("T23 accepts the same day only once the official close has passed", () => {
    const cal = realCalendar();
    const latest = getLatestCompletedTradingSession(cal, "NSE", NOW_AFTER_CLOSE);
    expect(latest.ok && latest.session.tradingDate).toBe("2026-08-12");
    // One millisecond before the close it is still not completed.
    const closeMs = cal.sessions.find(
      (s) => s.exchange === "NSE" && s.tradingDate === "2026-08-12",
    )!.scheduledCloseMs!;
    const just = getLatestCompletedTradingSession(cal, "NSE", closeMs - 1);
    expect(just.ok && just.session.tradingDate).toBe("2026-08-11");
    expect(getLatestCompletedTradingSession(cal, "NSE", closeMs).ok).toBe(true);
  });

  it("T24 fails closed rather than skipping a session with no officially notified timings", () => {
    const cal = realCalendar();
    // 10:30 IST on Monday 2026-11-09: today's session is still running, so the
    // scan reaches the Sunday Muhurat whose timings BSE has not notified.
    // Skipping it would falsely nominate the preceding Friday as "latest".
    const latest = getLatestCompletedTradingSession(cal, "BSE", Date.parse("2026-11-09T05:00:00.000Z"));
    expect(latest.ok).toBe(false);
    expect(latest.ok === false && latest.reason).toContain("no officially notified timings");
  });

  it("T25 fails closed for a year with no official calendar and for an unreal date", () => {
    const cal = realCalendar();
    expect(isTradingDate(cal, "NSE", "2027-01-04")).toBeNull();
    expect(isTradingDate(cal, "NSE", "2026-02-30")).toBeNull();
    const lookup = getTradingSession(cal, "NSE", "2027-01-04");
    expect(lookup.known === false && lookup.reason).toContain("no official NSE calendar for year 2027");
    const latest = getLatestCompletedTradingSession(cal, "NSE", Date.parse("2027-03-01T12:00:00.000Z"));
    expect(latest.ok).toBe(false);
  });

  it("T26 walks back over weekends and holidays for the previous session", () => {
    const cal = realCalendar();
    // Monday 2026-08-10 → back over the weekend to Friday 2026-08-07.
    const prev = getPreviousTradingSession(cal, "NSE", "2026-08-10");
    expect(prev.ok && prev.session.tradingDate).toBe("2026-08-07");
    // 2026-03-31 is a holiday and 2026-03-29 a Sunday, so 2026-04-01 goes back
    // to Monday 2026-03-30.
    const acrossHoliday = getPreviousTradingSession(cal, "NSE", "2026-04-01");
    expect(acrossHoliday.ok && acrossHoliday.session.tradingDate).toBe("2026-03-30");
    // Strictly before: the same date is never its own previous session.
    const strict = getPreviousTradingSession(cal, "NSE", "2026-08-11");
    expect(strict.ok && strict.session.tradingDate).toBe("2026-08-10");
  });

  it("T27 exposes the calendar to the BSE policy as a verdict, unknown when invalid", () => {
    const cal = realCalendar();
    const verdict = toTradingCalendarVerdict(cal, "BSE", NOW_AFTER_CLOSE);
    expect(verdict).toEqual({
      known: true,
      dayKind: "TRADING_DAY",
      latestCompletedSessionDate: "2026-08-12",
    });
    const broken = buildExchangeCalendar({
      sources: [],
      timings: [makeSessionTimingSource("BSE")],
      exchanges: ["BSE"],
      years: [2026],
      generatedAt: RETRIEVED_AT,
    });
    expect(toTradingCalendarVerdict(broken, "BSE", NOW_AFTER_CLOSE)).toEqual({
      known: false,
      dayKind: null,
      latestCompletedSessionDate: null,
    });
  });
});

// ── T28–T29 · bhavcopy reconciliation ────────────────────────────────────────

describe("T28–T29 · UDiFF must equal the calculated latest completed session", () => {
  it("T28 accepts exactly the latest completed session and nothing else", () => {
    const cal = realCalendar();
    const ok = validateBhavcopySession(cal, "BSE", "2026-08-12", NOW_AFTER_CLOSE);
    expect(ok).toMatchObject({ ok: true, code: "VALID_LATEST_COMPLETED" });

    const stale = validateBhavcopySession(cal, "BSE", "2026-08-11", NOW_AFTER_CLOSE);
    expect(stale).toMatchObject({ ok: false, code: "NOT_LATEST_COMPLETED", expectedTradingDate: "2026-08-12" });

    // Same file, evaluated before the close: now the expected session is the
    // previous day, so today's file is "not latest completed" too.
    const early = validateBhavcopySession(cal, "BSE", "2026-08-12", NOW_BEFORE_CLOSE);
    expect(early).toMatchObject({ ok: false, code: "NOT_LATEST_COMPLETED", expectedTradingDate: "2026-08-11" });
  });

  it("T29 rejects future-dated, non-session and unreal bhavcopy dates", () => {
    const cal = realCalendar();
    expect(validateBhavcopySession(cal, "BSE", "2026-08-13", NOW_AFTER_CLOSE).code).toBe("FUTURE_DATED");
    expect(validateBhavcopySession(cal, "BSE", "2026-08-08", NOW_AFTER_CLOSE).code).toBe(
      "NOT_A_TRADING_SESSION",
    );
    expect(validateBhavcopySession(cal, "BSE", "not-a-date", NOW_AFTER_CLOSE).code).toBe("INVALID_DATE");
    // When the latest completed session itself is unknown, nothing validates.
    const broken = buildExchangeCalendar({
      sources: [],
      timings: [makeSessionTimingSource("BSE")],
      exchanges: ["BSE"],
      years: [2026],
      generatedAt: RETRIEVED_AT,
    });
    expect(validateBhavcopySession(broken, "BSE", "2026-08-12", NOW_AFTER_CLOSE).code).toBe(
      "LATEST_COMPLETED_UNKNOWN",
    );
  });
});

// ── T30 · durable commitment ─────────────────────────────────────────────────

describe("T30 · manifest commitment (no separate calendar table)", () => {
  it("T30 derives its id from its checksum and re-verifies structurally", () => {
    const cal = realCalendar();
    const commitment = toCalendarCommitment(cal, NOW_AFTER_CLOSE);
    expect(commitment.calendarGenerationId).toBe(deriveCalendarGenerationId(cal.calendarChecksum));
    expect(commitment.calendarSchemaVersion).toBe(CALENDAR_SCHEMA_VERSION);
    expect(commitment.calendarPolicyVersion).toBe(CALENDAR_POLICY_VERSION);
    expect(commitment.latestCompletedSession).toEqual({ NSE: "2026-08-12", BSE: "2026-08-12" });
    expect(verifyCalendarCommitmentIntegrity(commitment)).toEqual([]);

    // Tampering with the checksum breaks the derived-id binding.
    expect(verifyCalendarCommitmentIntegrity({ ...commitment, calendarChecksum: "f".repeat(64) })).toContain(
      "committed calendar generation id is not derived from its checksum",
    );
    // A missing commitment is a blocker, never a silent default.
    expect(verifyCalendarCommitmentIntegrity(null)).toEqual(["manifest carries no trading-calendar commitment"]);
    // A one-sided calendar cannot stand for both exchanges.
    expect(
      verifyCalendarCommitmentIntegrity({
        ...commitment,
        sources: commitment.sources.filter((s) => s.exchange === "NSE"),
      }),
    ).toContain("committed trading calendar has no BSE source");

    // Rebuilding from identical inputs is byte-identical: the commitment is
    // deterministic, which is what makes the checksum meaningful.
    expect(toCalendarCommitment(realCalendar(), NOW_AFTER_CLOSE)).toEqual(commitment);
  });
});

// ── T31–T33 · guards ─────────────────────────────────────────────────────────

const MODULE_FILES = ["exchangeCalendar.ts", "exchangeCalendarSources.ts"] as const;

function moduleSource(file: string): string {
  return readFileSync(new URL(`./${file}`, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("T31–T33 · scope guards", () => {
  it("T31 contains no hour-based freshness threshold anywhere in the calendar modules", () => {
    for (const f of MODULE_FILES) {
      const src = moduleSource(f);
      expect(src, `${f} must not carry an age/freshness threshold`).not.toMatch(
        /MAX_AGE|AGE_HOURS|ageHours|hoursOld|freshnessThreshold|STALE_AFTER/i,
      );
    }
    // Session completion is decided by the official close instant, not by age:
    // evaluated on Saturday, Friday's session is still the latest completed one
    // and is not rejected for being many hours old.
    const cal = realCalendar();
    const overWeekend = getLatestCompletedTradingSession(cal, "NSE", Date.parse("2026-08-15T12:00:00.000Z"));
    expect(overWeekend.ok && overWeekend.session.tradingDate).toBe("2026-08-14");
  });

  it("T32 never touches subscriptions, providers, the tick path or quote liveness", () => {
    for (const f of MODULE_FILES) {
      const src = moduleSource(f);
      expect(src, `${f} must not touch the live feed`).not.toMatch(
        /\bsubscribe\s*\(|setMode\s*\(|KiteTicker|startTicker|getQuote|LIVE_TICKS/,
      );
      // Pure by construction: no I/O, no ambient clock.
      expect(src, `${f} must not perform I/O`).not.toMatch(/\bfetch\s*\(|axios|readFileSync|\bdb\b\./);
      expect(src, `${f} must not read an ambient clock`).not.toMatch(/Date\.now\s*\(/);
    }
    // The subscription universe is untouched by this phase.
    expect(NIFTY50_SYMBOLS).toHaveLength(50);
    // And the NSE reference freshness policy is unchanged at 48 hours.
    expect(NSE_REFERENCE_MAX_AGE_HOURS_MIRROR).toBe(48);
  });

  it("T34 rejects a truncated page whose table has a valid prefix but no end boundary", () => {
    // A bot-block or partial response that still carries the caption, the
    // header and the first eight rows. The row floor alone would accept it and
    // silently drop every later holiday.
    const full = bseHolidayPage();
    const cut = full.indexOf("Currency Derivatives");
    const truncated = full.slice(0, cut - 40) + ',i(999,"…")';
    const parsed = parseBseTradingHolidayPage(truncated, {
      retrievedAt: RETRIEVED_AT,
      calendarYear: 2026,
    });
    expect(parsed.provenance.validationResult).toBe("REJECTED_MALFORMED");
    expect(parsed.provenance.rejectionDetail).toContain("no end boundary");
    expect(parsed.events).toHaveLength(0);
  });

  it("T35 rejects a table that lost cell alignment instead of silently dropping rows", () => {
    // One extra cell inserted after the fourth row shifts every later cell, so
    // the row-number check stops early. The rows beyond it must not vanish.
    const twelveRows = [
      ...HOLIDAYS_2026,
      ["05-Jun-2026", "Friday", "Extra Holiday A"] as const,
      ["12-Jun-2026", "Friday", "Extra Holiday B"] as const,
      ["03-Jul-2026", "Friday", "Extra Holiday C"] as const,
      ["10-Jul-2026", "Friday", "Extra Holiday D"] as const,
    ];
    const full = bseHolidayPage(twelveRows);
    expect(
      parseBseTradingHolidayPage(full, { retrievedAt: RETRIEVED_AT, calendarYear: 2026 })
        .provenance.validationResult,
    ).toBe("ACCEPTED");
    // One inserted cell before row 10: rows 1-9 still parse, clearing the floor.
    const drifted = full.replace(/,i\((\d+),"10"\),/, ',i(999,"stray cell"),i($1,"10"),');
    expect(drifted).not.toBe(full);
    const parsed = parseBseTradingHolidayPage(drifted, {
      retrievedAt: RETRIEVED_AT,
      calendarYear: 2026,
    });
    expect(parsed.provenance.validationResult).not.toBe("ACCEPTED");
    expect(parsed.events).toHaveLength(0);
  });

  it("T36 rejects a fabricated commitment at verify, at the manifest gate and on restore", () => {
    const genuine = makeCalendarCommitment();
    expect(verifyCalendarCommitmentIntegrity(genuine)).toEqual([]);

    // (a) Self-consistent id/checksum pair, plausible dates, real official
    // sources — but no calendar behind it. Nothing may be taken on assertion.
    const hollowChecksum = "e".repeat(64);
    const hollow = {
      ...genuine,
      calendarChecksum: hollowChecksum,
      calendarGenerationId: deriveCalendarGenerationId(hollowChecksum),
      sessions: [],
    };
    expect(verifyCalendarCommitmentIntegrity(hollow)).toContain(
      "committed trading calendar carries no enumerated sessions",
    );

    // (b) A complete, checksum-correct calendar that CLAIMS a session its own
    // records do not support. `latestCompletedSession` is not part of the
    // checksum, so only re-derivation can catch this.
    const lying = {
      ...genuine,
      latestCompletedSession: { NSE: "2026-08-11", BSE: "2026-08-07" },
    };
    expect(verifyCalendarCommitmentIntegrity(lying).join(" ")).toContain(
      "committed latest completed BSE session 2026-08-07 does not follow from the committed calendar",
    );

    // (c) The manifest gate refuses to accept a generation built on it.
    const records = makeLiveRecords(3);
    const build = () =>
      buildUniverseManifest({
        build: makeBuildResult(records),
        sources: makeAcceptedSources(),
        manifestVersion: 1,
        registryGenerationId: GEN_ID,
        generatedAt: GENERATED_AT,
        effectiveDate: EFFECTIVE_DATE,
        requiredSourceIds: REQUIRED_SOURCE_IDS,
        bseAuthority: makeCurrentAuthoritativeBse(),
        tradingCalendar: genuine,
      });
    expect(build().acceptanceStatus).toBe("ACCEPTED");

    const rejected = buildUniverseManifest({
      build: makeBuildResult(records),
      sources: makeAcceptedSources(),
      manifestVersion: 1,
      registryGenerationId: GEN_ID,
      generatedAt: GENERATED_AT,
      effectiveDate: EFFECTIVE_DATE,
      requiredSourceIds: REQUIRED_SOURCE_IDS,
      bseAuthority: makeCurrentAuthoritativeBse(),
      tradingCalendar: hollow,
    });
    expect(rejected.acceptanceStatus).toBe("REJECTED");

    // (d) And a stored manifest re-signed with a fabricated calendar loses
    // coverage authority when it is read back.
    const accepted = build();
    const good = { manifest: accepted, records } as RegistryGeneration;
    expect(toAuthoritativeCoverageManifest(good, FIXTURE_NOW_MS).coverageAuthority).toBe(
      "AUTHORITATIVE_RECONCILED_UNIVERSE",
    );
    const restored = {
      manifest: { ...accepted, tradingCalendar: lying },
      records,
    } as RegistryGeneration;
    expect(toAuthoritativeCoverageManifest(restored, FIXTURE_NOW_MS).coverageAuthority).not.toBe(
      "AUTHORITATIVE_RECONCILED_UNIVERSE",
    );
  });

  it("T33 leaves the four safety locks false", () => {
    const LOCKS: readonly (readonly [string, string])[] = [
      ["../candleEvaluationControl.ts", "FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED"],
      ["../candleEvaluationControl.ts", "SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED"],
      ["../v2PaperLocks.ts", "FNO_PAPER_V2_RUNTIME_AUTHORIZED"],
      ["../v2PaperLocks.ts", "SWING_PAPER_V2_RUNTIME_AUTHORIZED"],
    ];
    for (const [file, lock] of LOCKS) {
      const src = readFileSync(new URL(file, import.meta.url), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      const m = new RegExp(`export const ${lock}\\s*=\\s*([^;]+);`).exec(src);
      expect(m, `${lock} not found in ${file}`).not.toBeNull();
      expect(m![1].trim()).toBe("false as boolean");
    }
  });
});
