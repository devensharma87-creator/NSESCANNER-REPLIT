/**
 * PHASE 0.7B — FINAL AUTHORITY-TIME CORRECTION.
 *
 * The owner-approved BSE reference policy binds authority to a CURRENT-IST-DAY
 * retrieval of the List of Scrips. That question was asked when a generation
 * was built and then persisted as a boolean; nothing re-asked it at boot, so an
 * intact 12 August generation still reported CURRENT_AUTHORITATIVE on 13 August.
 *
 * These tests exercise the REAL production functions — the stored-verdict
 * evaluator, the combined authority boundary, the restore path and the coverage
 * bridge. No re-implementation, no relaxed threshold, no grace period: the only
 * rule under test is the approved one, calendar-day identity.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

import {
  evaluateStoredBseReferenceAuthorityNow,
  evaluateBseReferenceAuthority,
  nextIstMidnightAfter,
  istDateString,
  type StoredBseReferenceAuthority,
} from "./bseReferencePolicy";
import { toCalendarCommitment } from "./exchangeCalendar";
import {
  evaluateLoadedGeneration,
  evaluateRegistryAuthorityNow,
  getActiveGenerationAuthority,
  _setActiveGenerationForTest,
  _resetAuthorityMemoForTest,
  MIN_RECORDS_FOR_COMMIT,
  type RegistryGeneration,
} from "./manifestStore";
import {
  buildUniverseManifest,
  computeManifestChecksum,
  REQUIRED_SOURCE_IDS,
  type BuildManifestInput,
  type InstrumentUniverseManifest,
} from "./universeManifest";
import { toAuthoritativeCoverageManifest, __resetCalendarAuthorityMemo } from "./coverageBridge";
import { AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED } from "../marketData/aggregateCoverage";
import {
  makeLiveRecords,
  makeBuildResult,
  makeAcceptedSources,
  makeCurrentAuthoritativeBse,
  makeCalendarCommitment,
  makeFixtureCalendar,
  GEN_ID,
  GENERATED_AT,
  EFFECTIVE_DATE,
} from "./p06TestFixtures";

// ── instants ────────────────────────────────────────────────────────────────

/** 2026-08-12T09:30Z — IST 15:00 on Wednesday 12 August. */
const BUILD_MS = Date.parse(GENERATED_AT);
/** 2026-08-12T18:29:59.999Z — IST 23:59:59.999 on the retrieval day. */
const LAST_MS_OF_IST_DAY = Date.parse("2026-08-12T18:29:59.999Z");
/** 2026-08-12T18:30:00.000Z — IST 00:00:00.000 on 13 August. */
const IST_MIDNIGHT_MS = Date.parse("2026-08-12T18:30:00.000Z");
/** 2026-08-13T00:00:00.000Z — UTC midnight, which is IST 05:30 on 13 August. */
const UTC_MIDNIGHT_MS = Date.parse("2026-08-13T00:00:00.000Z");

function storedVerdict(overrides: Partial<StoredBseReferenceAuthority> = {}): StoredBseReferenceAuthority {
  return {
    state: "CURRENT_AUTHORITATIVE",
    mayAuthorizeNewGeneration: true,
    listRetrievedAt: GENERATED_AT,
    evaluatedIstDate: istDateString(BUILD_MS),
    ...overrides,
  };
}

/** A verdict whose List was retrieved at `iso`, self-consistently. */
function retrievedAt(iso: string): StoredBseReferenceAuthority {
  return storedVerdict({ listRetrievedAt: iso, evaluatedIstDate: istDateString(Date.parse(iso)) });
}

function buildInput(overrides: Partial<BuildManifestInput> = {}): BuildManifestInput {
  return {
    build: makeBuildResult(makeLiveRecords(MIN_RECORDS_FOR_COMMIT)),
    sources: makeAcceptedSources(),
    manifestVersion: 1,
    registryGenerationId: GEN_ID,
    generatedAt: GENERATED_AT,
    effectiveDate: EFFECTIVE_DATE,
    requiredSourceIds: REQUIRED_SOURCE_IDS,
    bseAuthority: makeCurrentAuthoritativeBse(),
    tradingCalendar: makeCalendarCommitment(),
    ...overrides,
  };
}

/** A real, intact Schema-5 generation built through the production builder. */
function makeValidGeneration(): RegistryGeneration {
  const records = makeLiveRecords(MIN_RECORDS_FOR_COMMIT);
  return { manifest: buildUniverseManifest(buildInput({ build: makeBuildResult(records) })), records };
}

/**
 * Replace the committed BSE verdict and RECOMPUTE the manifest checksum, i.e.
 * the hand-edited-row shape. Without recomputing, the checksum gate fires first
 * and the authority boundary is never reached.
 */
function withStoredBse(patch: Partial<StoredBseReferenceAuthority>): RegistryGeneration {
  const base = makeValidGeneration();
  const { manifestChecksum: _drop, ...rest } = base.manifest;
  const swapped = {
    ...rest,
    bseReferenceAuthority: { ...base.manifest.bseReferenceAuthority, ...patch },
  } as Omit<InstrumentUniverseManifest, "manifestChecksum">;
  return {
    manifest: { ...swapped, manifestChecksum: computeManifestChecksum(swapped) },
    records: base.records,
  };
}

beforeEach(() => {
  _resetAuthorityMemoForTest();
  __resetCalendarAuthorityMemo();
  _setActiveGenerationForTest(null);
});

describe("P07B stored BSE reference authority expires at IST midnight", () => {
  it("B1 a List retrieved earlier today (IST) is still current", () => {
    const e = evaluateStoredBseReferenceAuthorityNow(storedVerdict(), BUILD_MS, BUILD_MS + 3_600_000);
    expect(e.state).toBe("CURRENT_AUTHORITATIVE");
    expect(e.currentIstDate).toBe("2026-08-12");
    expect(e.listRetrievalIstDate).toBe("2026-08-12");
    expect(e.reasons).toEqual([]);
  });

  it("B2 a List retrieved yesterday (IST) has expired", () => {
    const e = evaluateStoredBseReferenceAuthorityNow(storedVerdict(), BUILD_MS, BUILD_MS + 86_400_000);
    expect(e.state).toBe("LAST_KNOWN");
    expect(e.currentIstDate).toBe("2026-08-13");
    expect(e.reasons.join(" ")).toMatch(/expired at IST midnight/);
  });

  it("B3 23:59:59.999 IST on the retrieval day is still current", () => {
    const e = evaluateStoredBseReferenceAuthorityNow(storedVerdict(), BUILD_MS, LAST_MS_OF_IST_DAY);
    expect(e.state).toBe("CURRENT_AUTHORITATIVE");
    expect(e.currentIstDate).toBe("2026-08-12");
  });

  it("B4 exactly 00:00:00.000 IST the next day has expired", () => {
    expect(IST_MIDNIGHT_MS - LAST_MS_OF_IST_DAY).toBe(1);
    const e = evaluateStoredBseReferenceAuthorityNow(storedVerdict(), BUILD_MS, IST_MIDNIGHT_MS);
    expect(e.state).toBe("LAST_KNOWN");
    expect(e.currentIstDate).toBe("2026-08-13");
  });

  it("B5 UTC midnight does not control expiry — IST midnight does", () => {
    // Still current well past UTC noon on the retrieval day...
    expect(
      evaluateStoredBseReferenceAuthorityNow(storedVerdict(), BUILD_MS, Date.parse("2026-08-12T17:00:00Z"))
        .state,
    ).toBe("CURRENT_AUTHORITATIVE");
    // ...already expired 5h30m BEFORE the following UTC midnight.
    expect(IST_MIDNIGHT_MS).toBeLessThan(UTC_MIDNIGHT_MS);
    expect(
      evaluateStoredBseReferenceAuthorityNow(storedVerdict(), BUILD_MS, IST_MIDNIGHT_MS).state,
    ).toBe("LAST_KNOWN");
    expect(
      evaluateStoredBseReferenceAuthorityNow(storedVerdict(), BUILD_MS, UTC_MIDNIGHT_MS).state,
    ).toBe("LAST_KNOWN");
    // The cache boundary is the IST midnight instant itself, not a UTC one.
    expect(nextIstMidnightAfter(BUILD_MS)).toBe(IST_MIDNIGHT_MS);
  });

  it("B6 a weekend next day still expires at IST midnight", () => {
    // Retrieved Friday 2026-08-14 IST; evaluated Saturday 2026-08-15 IST.
    const friday = retrievedAt("2026-08-14T09:30:00.000Z");
    const saturdayMs = Date.parse("2026-08-15T04:00:00.000Z");
    expect(istDateString(saturdayMs)).toBe("2026-08-15");
    expect(new Date("2026-08-15T00:00:00Z").getUTCDay()).toBe(6);
    const e = evaluateStoredBseReferenceAuthorityNow(friday, Date.parse("2026-08-14T09:30:00.000Z"), saturdayMs);
    expect(e.state).toBe("LAST_KNOWN");
  });

  it("B7 an exchange holiday next day still expires at IST midnight", () => {
    // Retrieved Friday 2026-01-23 IST; evaluated on Monday 2026-01-26, an
    // official exchange holiday. No session completing does not extend the List.
    const before = retrievedAt("2026-01-23T09:30:00.000Z");
    const holidayMs = Date.parse("2026-01-26T04:00:00.000Z");
    expect(istDateString(holidayMs)).toBe("2026-01-26");
    const e = evaluateStoredBseReferenceAuthorityNow(before, Date.parse("2026-01-23T09:30:00.000Z"), holidayMs);
    expect(e.state).toBe("LAST_KNOWN");
  });

  it("B11 a stored CURRENT_AUTHORITATIVE flag cannot override runtime expiry", () => {
    const claiming = storedVerdict({ state: "CURRENT_AUTHORITATIVE", mayAuthorizeNewGeneration: true });
    const e = evaluateStoredBseReferenceAuthorityNow(claiming, BUILD_MS, BUILD_MS + 86_400_000);
    expect(e.state).toBe("LAST_KNOWN");
    // …and the stored object itself is untouched: authority expiring never
    // rewrites the committed evidence.
    expect(claiming.state).toBe("CURRENT_AUTHORITATIVE");
    expect(claiming.mayAuthorizeNewGeneration).toBe(true);
  });

  it("B12 a retrieval timestamp later than its own generation fails closed", () => {
    const impossible = retrievedAt("2026-08-12T10:30:00.000Z"); // an hour after persistence
    const e = evaluateStoredBseReferenceAuthorityNow(impossible, BUILD_MS, BUILD_MS + 3_600_000);
    expect(e.state).toBe("STALE");
    expect(e.reasons.join(" ")).toMatch(/later than the generation it belongs to/);
  });

  it("B12b missing, unparseable or internally inconsistent evidence fails closed", () => {
    expect(evaluateStoredBseReferenceAuthorityNow(null, BUILD_MS, BUILD_MS).state).toBe("STALE");
    expect(
      evaluateStoredBseReferenceAuthorityNow(storedVerdict({ listRetrievedAt: null }), BUILD_MS, BUILD_MS)
        .state,
    ).toBe("STALE");
    expect(
      evaluateStoredBseReferenceAuthorityNow(
        storedVerdict({ listRetrievedAt: "not-a-date" }),
        BUILD_MS,
        BUILD_MS,
      ).state,
    ).toBe("STALE");
    // evaluatedIstDate disagreeing with the retrieval instant it claims to describe
    expect(
      evaluateStoredBseReferenceAuthorityNow(
        storedVerdict({ evaluatedIstDate: "2026-08-11" }),
        BUILD_MS,
        BUILD_MS,
      ).state,
    ).toBe("STALE");
    // a missing evaluation date is missing evidence, not a waiver
    expect(
      evaluateStoredBseReferenceAuthorityNow(
        storedVerdict({ evaluatedIstDate: null }),
        BUILD_MS,
        BUILD_MS,
      ).state,
    ).toBe("STALE");
    // …including a shape-valid but unreal date
    expect(
      evaluateStoredBseReferenceAuthorityNow(
        storedVerdict({ evaluatedIstDate: "2026-02-31" }),
        BUILD_MS,
        BUILD_MS,
      ).state,
    ).toBe("STALE");
    // an unparseable generation instant makes the evidence ordering unevaluable
    expect(evaluateStoredBseReferenceAuthorityNow(storedVerdict(), Number.NaN, BUILD_MS).state).toBe("STALE");
    expect(
      evaluateStoredBseReferenceAuthorityNow(storedVerdict(), Date.parse("not-a-date"), BUILD_MS).state,
    ).toBe("STALE");
    // a non-finite clock
    expect(evaluateStoredBseReferenceAuthorityNow(storedVerdict(), BUILD_MS, Number.NaN).state).toBe("STALE");
  });

  it("B13 repeated evaluation at the same instant is deterministic", () => {
    const instants = [BUILD_MS, LAST_MS_OF_IST_DAY, IST_MIDNIGHT_MS, UTC_MIDNIGHT_MS];
    for (const t of instants) {
      const a = evaluateStoredBseReferenceAuthorityNow(storedVerdict(), BUILD_MS, t);
      const b = evaluateStoredBseReferenceAuthorityNow(storedVerdict(), BUILD_MS, t);
      expect(b.state).toBe(a.state);
      expect(b.reasons).toEqual(a.reasons);
      expect(b.validUntilMs).toBe(a.validUntilMs);
      expect(b.currentIstDate).toBe(a.currentIstDate);
    }
  });
});

describe("P07B the reported defect: calendar still current, List already expired", () => {
  /**
   * THE EXACT SHAPE OF THE DEFECT.
   *
   * A generation built AFTER the 15:30 IST close on 12 August reconciles to the
   * session completed that same day. Booted the next morning — before 13 August
   * closes — the committed calendar is still perfectly current: 12 August is
   * still the latest completed session, so the calendar check alone reports
   * CURRENT_AUTHORITATIVE and nothing contradicts the stored BSE boolean.
   *
   * Only the List-of-Scrips question exposes the expiry, which is why it has to
   * be asked separately at the same boundary.
   */
  const AFTER_CLOSE_MS = Date.parse("2026-08-12T10:30:00.000Z"); // 16:00 IST, 12 Aug
  const NEXT_MORNING_MS = Date.parse("2026-08-13T09:00:00.000Z"); // 14:30 IST, 13 Aug

  function afterCloseGeneration(): RegistryGeneration {
    const listContentHash = makeCurrentAuthoritativeBse().listContentHash!;
    const bseAuthority = evaluateBseReferenceAuthority({
      nowMs: AFTER_CLOSE_MS,
      list: {
        outcome: "RETRIEVED",
        retrievedAtMs: AFTER_CLOSE_MS,
        validationResult: "ACCEPTED",
        contentHash: listContentHash,
      },
      udiff: {
        tradingDate: "2026-08-12",
        sessionCompleted: true,
        validationResult: "ACCEPTED",
        contentHash: "bse-udiff-hash-fixture",
        retrievedAtMs: AFTER_CLOSE_MS,
      },
      calendar: { known: true, dayKind: "TRADING_DAY", latestCompletedSessionDate: "2026-08-12" },
      hasPriorAcceptedGeneration: false,
      reconciliationClosed: true,
    });
    expect(bseAuthority.state).toBe("CURRENT_AUTHORITATIVE");

    const records = makeLiveRecords(MIN_RECORDS_FOR_COMMIT);
    const manifest = buildUniverseManifest(
      buildInput({
        build: makeBuildResult(records),
        generatedAt: new Date(AFTER_CLOSE_MS).toISOString(),
        bseAuthority,
        tradingCalendar: toCalendarCommitment(makeFixtureCalendar(), AFTER_CLOSE_MS),
      }),
    );
    return { manifest, records };
  }

  it("B0 the calendar alone would still say CURRENT the next morning", () => {
    const gen = afterCloseGeneration();
    expect(gen.manifest.tradingCalendar.latestCompletedSession.BSE).toBe("2026-08-12");
    // The calendar dimension, evaluated on its own at 14:30 IST on 13 August.
    expect(evaluateRegistryAuthorityNow(gen.manifest, NEXT_MORNING_MS).calendar.state).toBe(
      "CURRENT_AUTHORITATIVE",
    );
  });

  it("B0b the List-of-Scrips dimension expires anyway, and the boundary follows it", () => {
    const gen = afterCloseGeneration();
    const authority = evaluateRegistryAuthorityNow(gen.manifest, NEXT_MORNING_MS);

    expect(authority.bse.state).toBe("LAST_KNOWN");
    expect(authority.combined.state).toBe("LAST_KNOWN");

    const verdict = evaluateLoadedGeneration(gen, "L2_POSTGRESQL", NEXT_MORNING_MS);
    expect(verdict.state).toBe("RESTORED_LAST_KNOWN");
    expect(verdict.blockerCode).toBe("AUTHORITY_EXPIRED");

    _setActiveGenerationForTest(gen);
    expect(getActiveGenerationAuthority(NEXT_MORNING_MS).mayAuthorize).toBe(false);
    __resetCalendarAuthorityMemo();
    expect(toAuthoritativeCoverageManifest(gen, NEXT_MORNING_MS)).toEqual(
      AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED,
    );
  });

  it("B0c the same generation is authoritative on its own evening", () => {
    const gen = afterCloseGeneration();
    expect(evaluateLoadedGeneration(gen, "L2_POSTGRESQL", AFTER_CLOSE_MS).state).toBe("RESTORED_CURRENT");
    __resetCalendarAuthorityMemo();
    expect(toAuthoritativeCoverageManifest(gen, AFTER_CLOSE_MS).coverageAuthority).toBe(
      "AUTHORITATIVE_RECONCILED_UNIVERSE",
    );
  });
});

describe("P07B the restore path and coverage bridge honour that expiry", () => {
  it("B8 an intact but expired generation restores as LAST KNOWN, not rejected", () => {
    const gen = makeValidGeneration();
    const nextDay = BUILD_MS + 86_400_000;
    const verdict = evaluateLoadedGeneration(gen, "L2_POSTGRESQL", nextDay);

    expect(verdict.state).toBe("RESTORED_LAST_KNOWN");
    expect(verdict.blockerCode).toBe("AUTHORITY_EXPIRED");
    // Installed, not discarded: last-known data keeps its display value.
    expect(verdict.generation).not.toBeNull();
    expect(verdict.generation?.manifest.registryGenerationId).toBe(GEN_ID);
    expect(verdict.authority?.state).toBe("LAST_KNOWN");

    // And the BSE dimension is the one that expired, independently of the calendar.
    const authority = evaluateRegistryAuthorityNow(gen.manifest, nextDay);
    expect(authority.bse.state).toBe("LAST_KNOWN");
    expect(authority.bse.reasons.join(" ")).toMatch(/List of Scrips/);
    expect(authority.combined.state).toBe("LAST_KNOWN");
  });

  it("B8b the same generation is still CURRENT on its own retrieval day", () => {
    const gen = makeValidGeneration();
    const verdict = evaluateLoadedGeneration(gen, "L2_POSTGRESQL", BUILD_MS);
    expect(verdict.state).toBe("RESTORED_CURRENT");
    expect(verdict.blockerCode).toBeNull();
  });

  it("B9 an expired generation cannot authorize a coverage denominator", () => {
    const gen = makeValidGeneration();
    expect(toAuthoritativeCoverageManifest(gen, BUILD_MS).coverageAuthority).toBe(
      "AUTHORITATIVE_RECONCILED_UNIVERSE",
    );
    __resetCalendarAuthorityMemo();
    expect(toAuthoritativeCoverageManifest(gen, BUILD_MS + 86_400_000)).toEqual(
      AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED,
    );
  });

  it("B10 an expired generation may not authorize trade-grade readiness", () => {
    const gen = makeValidGeneration();
    _setActiveGenerationForTest(gen);
    const nextDay = BUILD_MS + 86_400_000;

    // The in-memory authority boundary every readiness consumer reads.
    const authority = getActiveGenerationAuthority(nextDay);
    expect(authority.mayAuthorize).toBe(false);
    expect(authority.authority?.state).toBe("LAST_KNOWN");
    // The generation is still served for display continuity.
    expect(authority.generation?.manifest.registryGenerationId).toBe(GEN_ID);

    // …and the denominator that feeds readiness degrades with it.
    const coverage = toAuthoritativeCoverageManifest(gen, nextDay);
    expect(coverage.coverageAuthority).not.toBe("AUTHORITATIVE_RECONCILED_UNIVERSE");
    expect(coverage.universeReconciliationValid).toBe(false);
    expect(coverage.requiredInstrumentIds).toEqual([]);
  });

  it("B10b the memoized boundary re-expires at IST midnight without a restart", () => {
    const gen = makeValidGeneration();
    _setActiveGenerationForTest(gen);
    expect(getActiveGenerationAuthority(BUILD_MS).mayAuthorize).toBe(true);
    // No reload, no restart — only the clock crossing the boundary.
    expect(getActiveGenerationAuthority(IST_MIDNIGHT_MS).mayAuthorize).toBe(false);
  });

  it("B12d a manifest whose own generation instant is unparseable is refused", () => {
    const base = makeValidGeneration();
    const { manifestChecksum: _drop, ...rest } = base.manifest;
    const swapped = { ...rest, generatedAt: "not-an-instant" } as Omit<
      InstrumentUniverseManifest,
      "manifestChecksum"
    >;
    const gen: RegistryGeneration = {
      manifest: { ...swapped, manifestChecksum: computeManifestChecksum(swapped) },
      records: base.records,
    };
    const verdict = evaluateLoadedGeneration(gen, "L2_POSTGRESQL", BUILD_MS);
    expect(verdict.state).toBe("RESTORE_FAILED");
    expect(verdict.blockerCode).toBe("BSE_REFERENCE_EVIDENCE_INVALID");
    expect(toAuthoritativeCoverageManifest(gen, BUILD_MS)).toEqual(AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED);
  });

  it("B12e a verdict with no committed evaluation date is refused", () => {
    const gen = withStoredBse({ evaluatedIstDate: null });
    const verdict = evaluateLoadedGeneration(gen, "L2_POSTGRESQL", BUILD_MS);
    expect(verdict.state).toBe("RESTORE_FAILED");
    expect(verdict.blockerCode).toBe("BSE_REFERENCE_EVIDENCE_INVALID");
    __resetCalendarAuthorityMemo();
    expect(toAuthoritativeCoverageManifest(gen, BUILD_MS)).toEqual(AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED);
  });

  it("B12c a stored verdict dated after its generation is refused, not served", () => {
    const gen = withStoredBse({
      listRetrievedAt: "2026-08-12T10:30:00.000Z",
      evaluatedIstDate: "2026-08-12",
    });
    const verdict = evaluateLoadedGeneration(gen, "L2_POSTGRESQL", BUILD_MS + 3_600_000);
    expect(verdict.state).toBe("RESTORE_FAILED");
    expect(verdict.blockerCode).toBe("BSE_REFERENCE_EVIDENCE_INVALID");
    expect(verdict.generation).toBeNull();
  });
});

describe("P07B safety locks", () => {
  it("B14 all four locks remain false", () => {
    const candle = readFileSync("src/lib/candleEvaluationControl.ts", "utf8");
    const locks = readFileSync("src/lib/v2PaperLocks.ts", "utf8");
    const flags = [...candle.matchAll(/=\s*false as boolean/g), ...locks.matchAll(/=\s*false as boolean/g)];
    expect(flags.length).toBe(4);
    expect(candle).not.toMatch(/=\s*true as boolean/);
    expect(locks).not.toMatch(/=\s*true as boolean/);
  });
});
