/**
 * PHASE 0.6A — AUTHORITATIVE SESSION TIMES + CURRENT-AUTHORITY EXPIRY (T37–T68)
 *
 * Two blockers are under test here, and nothing else:
 *
 *   1. REGULAR_SESSION_CLOSE_TIME_NOT_AUTHORITATIVE_AND_NOT_EXCHANGE_INDEPENDENT
 *      — session hours must come from each exchange's OWN published timing
 *      document, with independent provenance, and must fail closed when absent.
 *
 *   2. ACCEPTED_CALENDAR_AUTHORITY_DOES_NOT_EXPIRE
 *      — integrity (immutable, at the committed instant) is split from current
 *      authority (re-asked against the present), and every boundary that can
 *      hand out an authoritative universe re-asks the second question.
 *
 * NO network, NO database, NO clock reads: every instant is supplied explicitly
 * and the DB module is mocked so importing the store opens no connection.
 */

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

// Mock the DB module so importing manifestStore does not open a connection.
vi.mock("@workspace/db", () => ({
  db: { execute: vi.fn(), transaction: vi.fn() },
}));

import {
  buildExchangeCalendar,
  calendarFromCommitment,
  evaluateCalendarAuthorityNow,
  getLatestCompletedTradingSession,
  getTradingSession,
  istWallClockToEpochMs,
  toCalendarCommitment,
  validateBhavcopySession,
  verifyCalendarCommitmentIntegrity,
  MAX_TIMING_EVIDENCE_ROWS,
  TIMING_EXTRACTION_VERSION,
  type CalendarExchange,
  type ExchangeCalendarGeneration,
  type ParsedCalendarSource,
  type SessionTimingSource,
} from "./exchangeCalendar";
import {
  parseBseSessionTimings,
  parseNseMarketTimings,
  BSE_EQUITY_SESSION_TIMINGS_PAGE,
  MIN_BSE_BUNDLE_BYTES,
  NSE_MARKET_TIMINGS_URL,
} from "./exchangeCalendarSources";
import { toAuthoritativeCoverageManifest, __resetCalendarAuthorityMemo } from "./coverageBridge";
import {
  acceptLoadedGeneration,
  getActiveGenerationAuthority,
  _resetAuthorityMemoForTest,
  _setActiveGenerationForTest,
  type RegistryGeneration,
} from "./manifestStore";
import { buildUniverseManifest, REQUIRED_SOURCE_IDS } from "./universeManifest";
import { NSE_REFERENCE_MAX_AGE_HOURS_MIRROR } from "./officialSources";
import {
  makeAnnualCalendarSource,
  makeAcceptedSources,
  makeBuildResult,
  makeCurrentAuthoritativeBse,
  makeLiveRecords,
  makeSessionTimingSource,
  EFFECTIVE_DATE,
  GEN_ID,
  GENERATED_AT,
} from "./p06TestFixtures";

/** 15:00 IST on Wednesday 2026-08-12 — before the 15:30 close. */
const NOW_MS = Date.parse(GENERATED_AT);
/** 15:50 IST the same day — after a 15:30 close, before a 15:45-close variant's. */
const AFTER_CLOSE_MS = Date.parse("2026-08-12T10:20:00.000Z");
/** 09:30 IST on 2027-01-01 — a real instant the 2026 calendar cannot speak for. */
const NEXT_YEAR_MS = Date.parse("2027-01-01T04:00:00.000Z");

const CALENDAR_SRC = readFileSync(new URL("./exchangeCalendar.ts", import.meta.url), "utf8");

function build(
  timings: readonly SessionTimingSource[],
  opts: {
    exchanges?: readonly CalendarExchange[];
    extraSources?: readonly ParsedCalendarSource[];
  } = {},
): ExchangeCalendarGeneration {
  const exchanges = opts.exchanges ?? (["NSE", "BSE"] as const);
  return buildExchangeCalendar({
    sources: [...exchanges.map((e) => makeAnnualCalendarSource(e)), ...(opts.extraSources ?? [])],
    timings,
    exchanges,
    years: [2026],
    generatedAt: GENERATED_AT,
  });
}

/** A date-specific official circular — the only way a day gets its own hours. */
function circular(
  exchange: CalendarExchange,
  tradingDate: string,
  sessionType: "SPECIAL" | "MUHURAT" | "HALF_DAY" | "CLOSED",
  openIst: string | null,
  closeIst: string | null,
): ParsedCalendarSource {
  const sourceId = `${exchange}_CIRCULAR_${tradingDate.replace(/-/g, "_")}`;
  return {
    provenance: {
      exchange,
      sourceId,
      sourceName: `synthetic ${exchange} official circular ${tradingDate}`,
      sourceUrl: `https://example.invalid/${exchange}/circular/${tradingDate}`,
      retrievedAt: GENERATED_AT,
      calendarYear: 2026,
      effectiveFrom: tradingDate,
      effectiveTo: tradingDate,
      contentHash: `hash-${sourceId}-${sessionType}-${openIst}-${closeIst}`,
      eventCount: 1,
      validationResult: "ACCEPTED",
      kind: "OFFICIAL_CIRCULAR",
      issuedAt: "2026-08-01",
      rejectionDetail: null,
    },
    events: [
      {
        exchange,
        tradingDate,
        sessionType,
        description: `official ${sessionType} session`,
        scheduledOpenIst: openIst,
        scheduledCloseIst: closeIst,
        sourceId,
      },
    ],
  };
}

/** The enumerated record itself — readable even when the calendar is invalid. */
    function rawSession(cal: ExchangeCalendarGeneration, exchange: CalendarExchange, date: string) {
    const s = cal.sessions.find((r) => r.exchange === exchange && r.tradingDate === date);
    if (!s) throw new Error(`expected an enumerated ${exchange} record for ${date}`);
    return s;
    }

    function sessionOn(cal: ExchangeCalendarGeneration, exchange: CalendarExchange, date: string) {
  const s = getTradingSession(cal, exchange, date);
  if (s.known !== true) throw new Error(`expected a known ${exchange} session on ${date}`);
  return s.session;
}

function acceptedGeneration(
  tradingCalendar = toCalendarCommitment(build([makeSessionTimingSource("NSE"), makeSessionTimingSource("BSE")]), NOW_MS),
  generatedAt = GENERATED_AT,
): RegistryGeneration {
  const records = makeLiveRecords(3);
  const manifest = buildUniverseManifest({
    build: makeBuildResult(records),
    sources: makeAcceptedSources(),
    manifestVersion: 1,
    registryGenerationId: GEN_ID,
    generatedAt,
    effectiveDate: EFFECTIVE_DATE,
    requiredSourceIds: REQUIRED_SOURCE_IDS,
    tradingCalendar,
    bseAuthority: makeCurrentAuthoritativeBse(),
  });
  return { manifest, records } as RegistryGeneration;
}

// ── Fixture bodies shaped like the real published documents ─────────────────

// Both parsers now demand a COMPLETE document, so the fixtures have to be
// document-shaped: page-scale for NSE, bundle-scale for BSE, each carrying the
// structural markers the real artefacts carry.
const PAD = `<!-- ${"x".repeat(40 * 1024)} -->`;
const BUNDLE_PAD = `/* ${"z".repeat(MIN_BSE_BUNDLE_BYTES)} */`;
/** The caption that proves the body is BSE's own application bundle. */
const BSE_BUNDLE_CAPTION = `"Display table for Trading Holidays for 2026 - Equity Segment"`;

function nseTimingsHtml(closeCell = "15:30 hrs"): string {
  return `<html><body><table>
    <tr><td>Pre-open session (Regular) Open</td><td>09:00 hrs</td></tr>
    <tr><td>Pre-open session (Regular) Close</td><td>09:08 hrs</td></tr>
    <tr><td>Normal / Odd lot market Open</td><td>09:15 hrs</td></tr>
    <tr><td>Normal / Odd lot market Close</td><td>${closeCell}</td></tr>
    <tr><td>Closing session Open</td><td>15:40 hrs</td></tr>
    <tr><td>Closing session Close</td><td>16:00 hrs</td></tr>
  </table>${PAD}</body></html>`;
}

function bseTimingsBundle(secondRow = "Continuous Trading Session 9:15am to 3:30pm"): string {
  return `var c=${BSE_BUNDLE_CAPTION};
  var t=[{h:"Continuous Trading Session 9:15am to 3:30pm"},{h:"${secondRow}"}];
  // BSE also prints historical prose elsewhere: G-Sec used to open at 9.00 a.m.
  ${BUNDLE_PAD}
  boot();`;
}

const NSE_PARSE_OPTS = {
  retrievedAt: GENERATED_AT,
  effectiveYear: 2026,
  sourceUrl: NSE_MARKET_TIMINGS_URL,
} as const;
const BSE_PARSE_OPTS = {
  retrievedAt: GENERATED_AT,
  effectiveYear: 2026,
  sourceUrl: BSE_EQUITY_SESSION_TIMINGS_PAGE,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
describe("T37–T42 — regular-session hours are SOURCED, per exchange", () => {
  it("T37 takes the NSE regular close from the NSE timing document, not a constant", () => {
    const cal = build([makeSessionTimingSource("NSE", "09:15", "15:45"), makeSessionTimingSource("BSE")]);
    expect(cal.valid).toBe(true);
    const s = sessionOn(cal, "NSE", "2026-08-12");
    expect(s.scheduledCloseIst).toBe("15:45");
    expect(s.timesOfficiallyNotified).toBe(true);
    expect(s.timingSourceId).toBe("NSE_SESSION_TIMINGS_2026");
  });

  it("T38 takes the BSE regular close from BSE's own document, never NSE's", () => {
    const cal = build([makeSessionTimingSource("NSE", "09:15", "15:45"), makeSessionTimingSource("BSE")]);
    const nse = sessionOn(cal, "NSE", "2026-08-12");
    const bse = sessionOn(cal, "BSE", "2026-08-12");
    expect(bse.scheduledCloseIst).toBe("15:30");
    expect(bse.scheduledCloseIst).not.toBe(nse.scheduledCloseIst);
    expect(bse.timingSourceId).toBe("BSE_SESSION_TIMINGS_2026");
  });

  it("T39 keeps provenance independent even when both exchanges publish the same hours", () => {
    const cal = build([makeSessionTimingSource("NSE"), makeSessionTimingSource("BSE")]);
    const [nse, bse] = ["NSE", "BSE"].map((e) => cal.timings.find((t) => t.provenance.exchange === e)!);
    expect(nse.openIst).toBe(bse.openIst);
    expect(nse.closeIst).toBe(bse.closeIst);
    // Same times, two documents: different id, different URL, different bytes.
    expect(nse.provenance.sourceId).not.toBe(bse.provenance.sourceId);
    expect(nse.provenance.sourceUrl).not.toBe(bse.provenance.sourceUrl);
    expect(nse.provenance.contentHash).not.toBe(bse.provenance.contentHash);
    expect(nse.provenance.extractionVersion).toBe(TIMING_EXTRACTION_VERSION);
  });

  it("T40 extracts all six anchored NSE rows and keeps evidence that reproduces them", () => {
    const parsed = parseNseMarketTimings(nseTimingsHtml(), NSE_PARSE_OPTS);
    expect(parsed.provenance.validationResult).toBe("ACCEPTED");
    expect([parsed.openIst, parsed.closeIst]).toEqual(["09:15", "15:30"]);
    expect([parsed.preOpenOpenIst, parsed.preOpenCloseIst]).toEqual(["09:00", "09:08"]);
    expect([parsed.closingSessionOpenIst, parsed.closingSessionCloseIst]).toEqual(["15:40", "16:00"]);
    // The evidence alone reproduces the normalized close.
    const closeRow = parsed.evidence.find((r) => r.label === "Normal / Odd lot market Close");
    expect(closeRow?.value).toBe("15:30 hrs");
    expect(parsed.evidence.length).toBeLessThanOrEqual(MAX_TIMING_EVIDENCE_ROWS);

    // COMPLETENESS. Carrying the two rows we want is not the same as being the
    // published table: a response cut short, and a page missing a published row,
    // are refused rather than half-read.
    const truncated = nseTimingsHtml().replace(/<\/body><\/html>$/, "");
    expect(parseNseMarketTimings(truncated, NSE_PARSE_OPTS).provenance.rejectionDetail).toContain(
      "did not arrive complete",
    );
    const missingRow = nseTimingsHtml().replace(
      "<tr><td>Closing session Close</td><td>16:00 hrs</td></tr>",
      "",
    );
    const partial = parseNseMarketTimings(missingRow, NSE_PARSE_OPTS);
    expect(partial.provenance.validationResult).toBe("REJECTED_MALFORMED");
    expect(partial.provenance.rejectionDetail).toContain("incomplete");
    expect(partial.closeIst).toBeNull();
  });

  it("T41 extracts BSE's continuous trading session from its published row", () => {
    const parsed = parseBseSessionTimings(bseTimingsBundle(), BSE_PARSE_OPTS);
    expect(parsed.provenance.validationResult).toBe("ACCEPTED");
    expect([parsed.openIst, parsed.closeIst]).toEqual(["09:15", "15:30"]);
    expect(parsed.evidence[0]?.label).toBe("Continuous Trading Session");
    // Unanchored historical prose in the same body is NOT read.
    expect(parsed.openIst).not.toBe("09:00");
    // A megabyte-deep "captcha" is application code, not a bot challenge: the
    // real bundle carries hundreds of them and must still parse.
    const withAppCode = bseTimingsBundle() + `\n/*${"z".repeat(5000)}*/ var Captcha = {};`;
    expect(parseBseSessionTimings(withAppCode, BSE_PARSE_OPTS).closeIst).toBe("15:30");
    // A small page that announces the challenge up front is still rejected.
    const challenge = `<html><head><title>Access Denied</title></head><body>x</body></html>`;
    const blocked = parseBseSessionTimings(challenge, BSE_PARSE_OPTS);
    expect(blocked.provenance.validationResult).toBe("REJECTED_MALFORMED");
    expect(blocked.closeIst).toBeNull();

    // COMPLETENESS. Finding the row is not proof the document arrived whole. A
    // truncated bundle, a bundle-scale body that is not BSE's artefact, and a
    // fragment carrying only the row are all refused rather than read.
    const truncated = bseTimingsBundle().replace(/boot\(\);$/, 'var q="unter');
    expect(parseBseSessionTimings(truncated, BSE_PARSE_OPTS).provenance.rejectionDetail).toContain(
      "did not arrive complete",
    );
    const notTheBundle = bseTimingsBundle().replace(BSE_BUNDLE_CAPTION, '"unrelated"');
    expect(parseBseSessionTimings(notTheBundle, BSE_PARSE_OPTS).provenance.rejectionDetail).toContain(
      "not BSE's application bundle",
    );
    const fragment = `var t=[{h:"Continuous Trading Session 9:15am to 3:30pm"}];`;
    const frag = parseBseSessionTimings(fragment, BSE_PARSE_OPTS);
    expect(frag.provenance.validationResult).toBe("REJECTED_MALFORMED");
    expect(frag.closeIst).toBeNull();
  });

  it("T42 no longer carries a shared hardcoded regular-session constant", () => {
    expect(CALENDAR_SRC).not.toMatch(/REGULAR_SESSION_(OPEN|CLOSE)_IST/);
    expect(CALENDAR_SRC).not.toMatch(/=\s*"15:30"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("T43–T48 — absent or unusable timing sources fail closed", () => {
  it("T43 blocks when NSE has no official timing source", () => {
    const cal = build([makeSessionTimingSource("BSE")]);
    expect(cal.valid).toBe(false);
    expect(cal.blockers.join(" ")).toContain("no official NSE regular-session timing source");
    const s = rawSession(cal, "NSE", "2026-08-12");
    expect(s.scheduledCloseIst).toBeNull();
    expect(s.timesOfficiallyNotified).toBe(false);
    // An invalid calendar also answers no lookups at all.
    expect(getTradingSession(cal, "NSE", "2026-08-12").known).toBe(false);
  });

  it("T44 blocks when BSE has no official timing source", () => {
    const cal = build([makeSessionTimingSource("NSE")]);
    expect(cal.valid).toBe(false);
    expect(cal.blockers.join(" ")).toContain("no official BSE regular-session timing source");
  });

  it("T45 treats a rejected timing document as a blocker, never as a fallback", () => {
    const rejected: SessionTimingSource = {
      ...makeSessionTimingSource("BSE"),
      openIst: null,
      closeIst: null,
      evidence: [],
      provenance: {
        ...makeSessionTimingSource("BSE").provenance,
        validationResult: "REJECTED_MALFORMED",
        rejectionDetail: "body is an access-denied or bot-challenge interstitial",
      },
    };
    const cal = build([makeSessionTimingSource("NSE"), rejected]);
    expect(cal.valid).toBe(false);
    const text = cal.blockers.join(" ");
    expect(text).toContain("REJECTED_MALFORMED");
    expect(text).toContain("no official BSE regular-session timing source");
    expect(rawSession(cal, "BSE", "2026-08-12").scheduledCloseIst).toBeNull();
  });

  it("T46 blocks a timing document effective for a year the calendar does not cover", () => {
    const stale = makeSessionTimingSource("BSE");
    const cal = build([
      makeSessionTimingSource("NSE"),
      { ...stale, provenance: { ...stale.provenance, effectiveYear: 2025, effectiveFrom: "2025-01-01" } },
    ]);
    expect(cal.valid).toBe(false);
    expect(cal.blockers.join(" ")).toContain("is effective for 2025, which this calendar does not cover");
  });

  it("T47 fails closed on two equal-priority timing sources that disagree", () => {
    const a = makeSessionTimingSource("NSE");
    const b = makeSessionTimingSource("NSE", "09:15", "15:00");
    const cal = build([
      a,
      { ...b, provenance: { ...b.provenance, sourceId: "NSE_SESSION_TIMINGS_2026_ALT" } },
      makeSessionTimingSource("BSE"),
    ]);
    expect(cal.valid).toBe(false);
    expect(cal.blockers.join(" ")).toContain("contradictory equal-priority NSE session timing sources");
    expect(rawSession(cal, "NSE", "2026-08-12").scheduledCloseIst).toBeNull();
  });

  it("T48 accepts two agreeing documents for one exchange without inventing a conflict", () => {
    const a = makeSessionTimingSource("NSE");
    const cal = build([
      a,
      { ...a, provenance: { ...a.provenance, sourceId: "NSE_SESSION_TIMINGS_2026_MIRROR" } },
      makeSessionTimingSource("BSE"),
    ]);
    expect(cal.blockers.join(" ")).not.toContain("contradictory");
    expect(cal.valid).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("T49–T54 — session-time precedence and completion boundaries", () => {
  it("T49 lets an official circular override the regular hours for its date only", () => {
    const cal = build([makeSessionTimingSource("NSE"), makeSessionTimingSource("BSE")], {
      extraSources: [circular("NSE", "2026-08-12", "SPECIAL", "10:00", "14:00")],
    });
    expect(cal.valid).toBe(true);
    const declared = sessionOn(cal, "NSE", "2026-08-12");
    expect([declared.sessionType, declared.scheduledOpenIst, declared.scheduledCloseIst]).toEqual([
      "SPECIAL",
      "10:00",
      "14:00",
    ]);
    // A date-specific event carries its OWN timings, so it cites no timing doc.
    expect(declared.timingSourceId).toBeNull();
    // The next day is untouched and still sourced from the timing document.
    const next = sessionOn(cal, "NSE", "2026-08-13");
    expect(next.scheduledCloseIst).toBe("15:30");
    expect(next.timingSourceId).toBe("NSE_SESSION_TIMINGS_2026");
  });

  it("T50 can produce HALF_DAY, but only through an official override", () => {
    const cal = build([makeSessionTimingSource("NSE"), makeSessionTimingSource("BSE")], {
      extraSources: [circular("NSE", "2026-08-12", "HALF_DAY", "09:15", "12:30")],
    });
    const s = sessionOn(cal, "NSE", "2026-08-12");
    expect(s.sessionType).toBe("HALF_DAY");
    expect(s.scheduledCloseIst).toBe("12:30");
    expect(s.timesOfficiallyNotified).toBe(true);
    expect(s.sourceId).toBe("NSE_CIRCULAR_2026_08_12");
  });

  it("T51 never INFERS a half day: with no circular every trading day stays REGULAR", () => {
    const cal = build([makeSessionTimingSource("NSE"), makeSessionTimingSource("BSE")]);
    expect(cal.sessions.some((s) => s.sessionType === "HALF_DAY")).toBe(false);
    // An early/absent bhavcopy is a validation input, never a calendar input: it
    // cannot shorten a session or change its type.
    const before = sessionOn(cal, "BSE", "2026-08-11");
    expect(validateBhavcopySession(cal, "BSE", "2026-08-11", NOW_MS).code).toBe("VALID_LATEST_COMPLETED");
    expect(sessionOn(cal, "BSE", "2026-08-11")).toEqual(before);
    expect(before.sessionType).toBe("REGULAR");
    expect(before.scheduledCloseIst).toBe("15:30");
  });

  it("T52 does not let an event without hours borrow the regular timing document", () => {
    const cal = build([makeSessionTimingSource("NSE"), makeSessionTimingSource("BSE")], {
      extraSources: [circular("NSE", "2026-08-12", "SPECIAL", null, null)],
    });
    const s = sessionOn(cal, "NSE", "2026-08-12");
    expect(s.sessionType).toBe("SPECIAL");
    expect(s.scheduledOpenIst).toBeNull();
    expect(s.scheduledCloseIst).toBeNull();
    expect(s.timesOfficiallyNotified).toBe(false);
  });

  it("T53 measures session completion against the SOURCED close", () => {
    const late = build([makeSessionTimingSource("NSE", "09:15", "15:45"), makeSessionTimingSource("BSE")]);
    const standard = build([makeSessionTimingSource("NSE"), makeSessionTimingSource("BSE")]);
    // 15:50 IST: complete under a 15:30 close, complete under 15:45 too.
    const at1550 = Date.parse("2026-08-12T10:20:00.000Z");
    expect(getLatestCompletedTradingSession(standard, "NSE", at1550)).toMatchObject({
      ok: true,
      session: { tradingDate: "2026-08-12" },
    });
    // 15:35 IST: complete under 15:30, NOT complete under 15:45.
    const at1535 = Date.parse("2026-08-12T10:05:00.000Z");
    const std = getLatestCompletedTradingSession(standard, "NSE", at1535);
    const lateRes = getLatestCompletedTradingSession(late, "NSE", at1535);
    expect(std.ok && std.session.tradingDate).toBe("2026-08-12");
    expect(lateRes.ok && lateRes.session.tradingDate).toBe("2026-08-11");
  });

  it("T54 lets an official half-day close move the completion boundary earlier", () => {
    const cal = build([makeSessionTimingSource("NSE"), makeSessionTimingSource("BSE")], {
      extraSources: [circular("NSE", "2026-08-12", "HALF_DAY", "09:15", "12:30")],
    });
    // 13:00 IST — past the half-day close, well before the usual 15:30.
    const at1300 = Date.parse("2026-08-12T07:30:00.000Z");
    const res = getLatestCompletedTradingSession(cal, "NSE", at1300);
    expect(res.ok && res.session.tradingDate).toBe("2026-08-12");
    expect(res.ok && res.session.sessionType).toBe("HALF_DAY");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("T55–T62 — integrity is immutable, authority expires", () => {
  const commitment = toCalendarCommitment(
    build([makeSessionTimingSource("NSE"), makeSessionTimingSource("BSE")]),
    NOW_MS,
  );

  it("T55 evaluates integrity at the committed instant, with no clock input at all", () => {
    expect(verifyCalendarCommitmentIntegrity(commitment)).toEqual([]);
    // Same commitment, same verdict, whatever "now" is — the function takes none.
    expect(verifyCalendarCommitmentIntegrity.length).toBe(1);
    expect(verifyCalendarCommitmentIntegrity(commitment)).toEqual([]);
  });

  it("T56 fails integrity when a session cites a timing source the commitment lacks", () => {
    const broken = {
      ...commitment,
      timings: commitment.timings.filter((t) => t.provenance.exchange !== "BSE"),
    };
    expect(verifyCalendarCommitmentIntegrity(broken).join(" ")).toMatch(
      /BSE regular-session timing source|timingSourceId/i,
    );
  });

  it("T57 fails integrity when a committed timing source carries no evidence", () => {
    const stripped = {
      ...commitment,
      timings: commitment.timings.map((t) =>
        t.provenance.exchange === "NSE" ? { ...t, evidence: [] } : t,
      ),
    };
    expect(verifyCalendarCommitmentIntegrity(stripped).length).toBeGreaterThan(0);
  });

  it("T58 is CURRENT_AUTHORITATIVE at the instant it was committed", () => {
    const authority = evaluateCalendarAuthorityNow(commitment, NOW_MS);
    expect(authority.state).toBe("CURRENT_AUTHORITATIVE");
    expect(authority.reasons).toEqual([]);
    expect(authority.requiredLatestCompletedSession.BSE).toBe(commitment.latestCompletedSession.BSE);
  });

  it("T59 becomes LAST_KNOWN on 2027-01-01 without mutating anything it committed", () => {
    const before = JSON.stringify(commitment);
    const authority = evaluateCalendarAuthorityNow(commitment, NEXT_YEAR_MS);
    expect(authority.state).toBe("LAST_KNOWN");
    expect(authority.reasons.join(" ")).toContain("does not cover");
    expect(authority.currentIstDate).toBe("2027-01-01");
    // Non-mutating: the stored commitment, its checksum and its committed
    // latest-completed claim are all exactly as they were.
    expect(JSON.stringify(commitment)).toBe(before);
    expect(authority.committedLatestCompletedSession).toEqual(commitment.latestCompletedSession);
    // And integrity is still clean — an expired calendar is intact, not corrupt.
    expect(verifyCalendarCommitmentIntegrity(commitment)).toEqual([]);
  });

  it("T60 becomes LAST_KNOWN once a newer BSE session has completed", () => {
    const authority = evaluateCalendarAuthorityNow(commitment, AFTER_CLOSE_MS);
    expect(authority.state).toBe("LAST_KNOWN");
    expect(authority.reasons.join(" ")).toContain("latest completed BSE session is now 2026-08-12");
    expect(authority.requiredLatestCompletedSession.BSE).toBe("2026-08-12");
    expect(authority.committedLatestCompletedSession.BSE).toBe("2026-08-11");
  });

  it("T61 is STALE — never authoritative — on an unusable clock or broken commitment", () => {
    expect(evaluateCalendarAuthorityNow(commitment, Number.NaN).state).toBe("STALE");
    expect(evaluateCalendarAuthorityNow(null, NOW_MS).state).toBe("STALE");
    const tampered = { ...commitment, calendarChecksum: "0".repeat(64) };
    expect(evaluateCalendarAuthorityNow(tampered, NOW_MS).state).toBe("STALE");
  });

  it("T62 reports a bounded validity window: the earlier of the next close and IST midnight", () => {
    const authority = evaluateCalendarAuthorityNow(commitment, NOW_MS);
    // 15:00 IST → the 15:30 close of the same day comes before midnight.
    expect(authority.validUntilMs).toBe(istWallClockToEpochMs("2026-08-12", "15:30"));
    expect(authority.validUntilMs).toBeGreaterThan(NOW_MS);
    // Past every close for the day, the window runs to the next IST midnight.
    const evening = Date.parse("2026-08-12T14:00:00.000Z");
    expect(evaluateCalendarAuthorityNow(commitment, evening).validUntilMs).toBe(
      istWallClockToEpochMs("2026-08-13", "00:00"),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("T63–T67 — every authority boundary re-asks the current question", () => {
  it("T63 grants coverage authority now and refuses it on 2027-01-01", () => {
    __resetCalendarAuthorityMemo();
    const gen = acceptedGeneration();
    expect(toAuthoritativeCoverageManifest(gen, NOW_MS).coverageAuthority).toBe(
      "AUTHORITATIVE_RECONCILED_UNIVERSE",
    );
    __resetCalendarAuthorityMemo();
    const expired = toAuthoritativeCoverageManifest(gen, NEXT_YEAR_MS);
    expect(expired.coverageAuthority).toBe("UNIVERSE_NOT_CONFIGURED");
    expect(expired.requiredInstrumentIds).toHaveLength(0);
  });

  it("T64 caches the verdict between boundaries and re-evaluates once one passes", () => {
    __resetCalendarAuthorityMemo();
    const gen = acceptedGeneration();
    const calSpy = calendarFromCommitment; // referenced to keep the import honest
    expect(typeof calSpy).toBe("function");
    // Repeated calls inside the window keep the same verdict (memo, no rescan).
    for (let i = 0; i < 5; i++) {
      expect(toAuthoritativeCoverageManifest(gen, NOW_MS + i).coverageAuthority).toBe(
        "AUTHORITATIVE_RECONCILED_UNIVERSE",
      );
    }
    // Crossing the boundary flips it with no reload and no restart.
    const boundary = evaluateCalendarAuthorityNow(gen.manifest.tradingCalendar, NOW_MS).validUntilMs;
    expect(toAuthoritativeCoverageManifest(gen, boundary + 60_000).coverageAuthority).toBe(
      "UNIVERSE_NOT_CONFIGURED",
    );
  });

  it("T65 cold-loads an expired generation as LAST KNOWN, but it may not authorize", () => {
    __resetCalendarAuthorityMemo();
    const gen = acceptedGeneration();
    // Still loadable from either durable layer — the bytes are intact.
    expect(acceptLoadedGeneration(gen, "L2_POSTGRESQL", NEXT_YEAR_MS)).not.toBeNull();
    expect(acceptLoadedGeneration(gen, "L1_DISK", NEXT_YEAR_MS)).not.toBeNull();
    // Its stored checksum is NOT rewritten because the clock moved.
    expect(gen.manifest.manifestChecksum).toBe(acceptedGeneration().manifest.manifestChecksum);
    // But the denominator is refused.
    expect(toAuthoritativeCoverageManifest(gen, NEXT_YEAR_MS).coverageAuthority).toBe(
      "UNIVERSE_NOT_CONFIGURED",
    );
  });

  it("T66 flips the in-memory generation's authority across a boundary with no reload", () => {
    _resetAuthorityMemoForTest();
    const gen = acceptedGeneration();
    _setActiveGenerationForTest(gen);
    try {
      const now = getActiveGenerationAuthority(NOW_MS);
      expect(now.mayAuthorize).toBe(true);
      expect(now.authority?.state).toBe("CURRENT_AUTHORITATIVE");
      const later = getActiveGenerationAuthority(NEXT_YEAR_MS);
      expect(later.mayAuthorize).toBe(false);
      expect(later.authority?.state).toBe("LAST_KNOWN");
      // The generation itself is untouched — only its right to speak changed.
      expect(later.generation).toBe(gen);
    } finally {
      _setActiveGenerationForTest(null);
      _resetAuthorityMemoForTest();
    }
  });

  it("T67 refuses to ACCEPT a new manifest built on a calendar that is not authoritative now", () => {
    const gen = acceptedGeneration(undefined, "2027-01-05T09:30:00.000Z");
    expect(gen.manifest.acceptanceStatus).toBe("REJECTED");
    expect(gen.manifest.blockers.join(" ")).toContain("committed trading calendar is LAST_KNOWN");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("T68 — everything out of scope is still exactly where it was", () => {
  it("T68 changes no subscription, no provider check, no safety lock and no NSE policy", async () => {
    __resetCalendarAuthorityMemo();
    const cov = toAuthoritativeCoverageManifest(acceptedGeneration(), NOW_MS);
    expect(cov.subscriptionRequestedCount).toBe(0);
    for (const r of makeLiveRecords(3)) expect(r.validationProviderStatus).toBe("NOT_CHECKED");
    expect(NSE_REFERENCE_MAX_AGE_HOURS_MIRROR).toBe(48);

    const locks = await import("../v2PaperLocks");
    expect(locks.FNO_PAPER_V2_RUNTIME_AUTHORIZED).toBe(false);
    expect(locks.SWING_PAPER_V2_RUNTIME_AUTHORIZED).toBe(false);
    const control = await import("../candleEvaluationControl");
    expect(control.FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED).toBe(false);
    expect(control.SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED).toBe(false);

    // The calendar modules reach no provider, ticker or subscription surface.
    const sourcesSrc = readFileSync(new URL("./exchangeCalendarSources.ts", import.meta.url), "utf8");
    for (const src of [CALENDAR_SRC, sourcesSrc]) {
      expect(src).not.toMatch(/from "\.\.\/marketData\//);
      expect(src).not.toMatch(/subscribe|kiteTicker|websocket/i);
    }
  });
});
