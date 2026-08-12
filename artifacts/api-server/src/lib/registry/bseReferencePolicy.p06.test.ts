/**
 * PHASE 0.6 CLOSURE — OWNER-APPROVED BSE REFERENCE POLICY.
 *
 * Test matrix items 1-11 of the closure directive. Pure functions only: no
 * network, no database, no clock. Every instant is supplied explicitly.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  BSE_REFERENCE_POLICY_ID,
  UNKNOWN_TRADING_CALENDAR,
  detectLastKnownMutation,
  evaluateBseReferenceAuthority,
  istDateString,
  type BseListRetrieval,
  type BseReferenceAuthorityInput,
  type BseUdiffDescriptor,
  type TradingCalendarVerdict,
} from "./bseReferencePolicy";
import {
  BSE_REFERENCE_FRESHNESS_POLICY,
  NSE_REFERENCE_MAX_AGE_HOURS_MIRROR,
  computeFreshnessState,
} from "./officialSources";

/** IST 2026-08-12 (Wed) 14:00 => 08:30Z. Latest completed session: Tue 08-11. */
const WED_1400_IST = Date.parse("2026-08-12T08:30:00.000Z");
const TUE = "2026-08-11";
const WED = "2026-08-12";

function list(overrides: Partial<Extract<BseListRetrieval, { outcome: "RETRIEVED" }>> = {}): BseListRetrieval {
  return {
    outcome: "RETRIEVED",
    retrievedAtMs: WED_1400_IST,
    validationResult: "ACCEPTED",
    contentHash: "list-hash",
    ...overrides,
  };
}

function udiff(overrides: Partial<BseUdiffDescriptor> = {}): BseUdiffDescriptor {
  return {
    tradingDate: TUE,
    sessionCompleted: true,
    validationResult: "ACCEPTED",
    contentHash: "udiff-hash",
    retrievedAtMs: WED_1400_IST,
    ...overrides,
  };
}

function calendar(overrides: Partial<TradingCalendarVerdict> = {}): TradingCalendarVerdict {
  return { known: true, dayKind: "TRADING_DAY", latestCompletedSessionDate: TUE, ...overrides };
}

function input(overrides: Partial<BseReferenceAuthorityInput> = {}): BseReferenceAuthorityInput {
  return {
    nowMs: WED_1400_IST,
    list: list(),
    udiff: udiff(),
    calendar: calendar(),
    hasPriorAcceptedGeneration: false,
    reconciliationClosed: true,
    ...overrides,
  };
}

describe("IST calendar-day arithmetic", () => {
  it("rolls the IST day at 18:30Z, not at midnight UTC", () => {
    // 18:29Z is still the same IST day; 18:30Z is the next one.
    expect(istDateString(Date.parse("2026-08-12T18:29:00.000Z"))).toBe(WED);
    expect(istDateString(Date.parse("2026-08-12T18:30:00.000Z"))).toBe("2026-08-13");
    // A UTC-midnight-crossing instant is still the SAME IST day.
    expect(istDateString(Date.parse("2026-08-12T23:00:00.000Z"))).toBe("2026-08-13");
    expect(istDateString(Date.parse("2026-08-12T00:30:00.000Z"))).toBe(WED);
  });

  it("returns INVALID rather than a date for a non-finite instant", () => {
    expect(istDateString(Number.NaN)).toBe("INVALID");
  });
});

describe("matrix 1 — current-day List + latest completed-session UDiFF", () => {
  it("is CURRENT_AUTHORITATIVE and may authorize a new generation", () => {
    const r = evaluateBseReferenceAuthority(input());
    expect(r.state).toBe("CURRENT_AUTHORITATIVE");
    expect(r.mayAuthorizeNewGeneration).toBe(true);
    expect(r.effectiveTradingDate).toBe(TUE);
  });

  it("exposes retrievedAt, effective trading date and BOTH source hashes (rule 8)", () => {
    const r = evaluateBseReferenceAuthority(input());
    expect(r.listRetrievedAt).toBe(new Date(WED_1400_IST).toISOString());
    expect(r.listContentHash).toBe("list-hash");
    expect(r.udiffContentHash).toBe("udiff-hash");
    expect(r.udiffTradingDate).toBe(TUE);
    expect(r.evaluatedIstDate).toBe(WED);
    expect(r.reasons.join(" ")).toContain(BSE_REFERENCE_POLICY_ID);
  });

  it("is frozen so an authority verdict cannot be edited after evaluation", () => {
    const r = evaluateBseReferenceAuthority(input());
    expect(Object.isFrozen(r)).toBe(true);
  });
});

describe("matrix 2 — weekend and exchange-holiday policy (rule 3)", () => {
  it("authorizes on a SATURDAY from the last completed weekday session", () => {
    const satIst = Date.parse("2026-08-15T08:30:00.000Z"); // IST Sat 2026-08-15
    const r = evaluateBseReferenceAuthority(
      input({
        nowMs: satIst,
        list: list({ retrievedAtMs: satIst }),
        udiff: udiff({ tradingDate: "2026-08-14" }),
        calendar: calendar({ dayKind: "WEEKEND", latestCompletedSessionDate: "2026-08-14" }),
      }),
    );
    expect(r.state).toBe("CURRENT_AUTHORITATIVE");
    expect(r.effectiveTradingDate).toBe("2026-08-14");
  });

  it("authorizes on an EXCHANGE HOLIDAY from the last completed session", () => {
    const r = evaluateBseReferenceAuthority(
      input({ calendar: calendar({ dayKind: "EXCHANGE_HOLIDAY" }) }),
    );
    expect(r.state).toBe("CURRENT_AUTHORITATIVE");
    expect(r.dayKind).toBe("EXCHANGE_HOLIDAY");
  });
});

describe("matrix 3 + 4 — pre-open and market-hours use the latest COMPLETED session", () => {
  // Rule 5: today's session has not completed, so yesterday's file is correct,
  // not stale. This must hold at both 09:00 IST (pre-open) and 12:00 IST.
  it.each([
    ["pre-open 09:00 IST", "2026-08-12T03:30:00.000Z"],
    ["market hours 12:00 IST", "2026-08-12T06:30:00.000Z"],
  ])("%s accepts the previous completed session", (_label, iso) => {
    const now = Date.parse(iso);
    const r = evaluateBseReferenceAuthority(
      input({ nowMs: now, list: list({ retrievedAtMs: now }) }),
    );
    expect(r.state).toBe("CURRENT_AUTHORITATIVE");
    expect(r.effectiveTradingDate).toBe(TUE);
  });

  it("goes STALE only once a NEWER completed session exists", () => {
    const r = evaluateBseReferenceAuthority(
      input({ calendar: calendar({ latestCompletedSessionDate: WED }) }),
    );
    expect(r.state).toBe("STALE");
    expect(r.mayAuthorizeNewGeneration).toBe(false);
  });
});

describe("matrix 5 + 6 — failed retrieval cannot authorize, prior stays LAST_KNOWN", () => {
  it("serves LAST_KNOWN when retrieval fails and a prior accepted generation exists", () => {
    const r = evaluateBseReferenceAuthority(
      input({
        list: { outcome: "RETRIEVAL_FAILED", failureReason: "HTTP 503" },
        hasPriorAcceptedGeneration: true,
      }),
    );
    expect(r.state).toBe("LAST_KNOWN");
    expect(r.mayAuthorizeNewGeneration).toBe(false);
    expect(r.effectiveTradingDate).toBeNull();
  });

  it("is UNAVAILABLE when retrieval fails and there is no prior generation", () => {
    const r = evaluateBseReferenceAuthority(
      input({ list: { outcome: "RETRIEVAL_FAILED", failureReason: "DNS failure" } }),
    );
    expect(r.state).toBe("UNAVAILABLE");
    expect(r.mayAuthorizeNewGeneration).toBe(false);
  });

  it("treats a List retrieved on an EARLIER IST day as not current", () => {
    const r = evaluateBseReferenceAuthority(
      input({
        list: list({ retrievedAtMs: Date.parse("2026-08-11T08:30:00.000Z") }),
        hasPriorAcceptedGeneration: true,
      }),
    );
    expect(r.state).toBe("LAST_KNOWN");
    expect(r.mayAuthorizeNewGeneration).toBe(false);
  });

  it("never authorizes from a failed retrieval, whatever else is valid", () => {
    // Exhaustive over prior-generation state: neither may authorize.
    for (const hasPrior of [true, false]) {
      const r = evaluateBseReferenceAuthority(
        input({
          list: { outcome: "RETRIEVAL_FAILED", failureReason: "timeout" },
          hasPriorAcceptedGeneration: hasPrior,
        }),
      );
      expect(r.mayAuthorizeNewGeneration).toBe(false);
    }
  });
});

describe("matrix 7 — unknown trading calendar fails closed", () => {
  it("refuses when the calendar is unknown", () => {
    const r = evaluateBseReferenceAuthority(input({ calendar: UNKNOWN_TRADING_CALENDAR }));
    expect(r.state).toBe("INVALID");
    expect(r.mayAuthorizeNewGeneration).toBe(false);
    expect(r.reasons.join(" ")).toContain("trading calendar unknown");
  });

  it("refuses when the calendar claims to be known but names no completed session", () => {
    const r = evaluateBseReferenceAuthority(
      input({ calendar: { known: true, dayKind: "TRADING_DAY", latestCompletedSessionDate: null } }),
    );
    expect(r.state).toBe("INVALID");
  });
});

describe("matrix 8 — future or invalid UDiFF date fails closed", () => {
  it("rejects a UDiFF dated in the future", () => {
    const r = evaluateBseReferenceAuthority(
      input({
        udiff: udiff({ tradingDate: "2026-08-20" }),
        calendar: calendar({ latestCompletedSessionDate: "2026-08-20" }),
      }),
    );
    expect(r.state).toBe("INVALID");
    expect(r.reasons.join(" ")).toContain("future");
  });

  it("rejects a malformed UDiFF date", () => {
    const r = evaluateBseReferenceAuthority(
      input({
        udiff: udiff({ tradingDate: "11-08-2026" }),
        calendar: calendar({ latestCompletedSessionDate: "11-08-2026" }),
      }),
    );
    expect(r.state).toBe("INVALID");
  });

  it("rejects an IMPOSSIBLE but well-formed UDiFF date", () => {
    // 2026-02-31 matches YYYY-MM-DD and sorts like any February date, so a
    // shape-only check would let it through every ordering comparison.
    const r = evaluateBseReferenceAuthority(
      input({
        udiff: udiff({ tradingDate: "2026-02-31" }),
        calendar: calendar({ latestCompletedSessionDate: "2026-02-31" }),
      }),
    );
    expect(r.state).toBe("INVALID");
    expect(r.mayAuthorizeNewGeneration).toBe(false);
    expect(r.reasons.join(" ")).toContain("not a real calendar date");
  });

  it("rejects an impossible latest-completed-session date from the calendar", () => {
    const r = evaluateBseReferenceAuthority(
      input({ calendar: calendar({ latestCompletedSessionDate: "2026-13-01" }) }),
    );
    expect(r.state).toBe("INVALID");
  });

  it("rejects a latest-completed-session date in the future", () => {
    const r = evaluateBseReferenceAuthority(
      input({
        calendar: calendar({ latestCompletedSessionDate: "2026-09-01" }),
        udiff: udiff({ tradingDate: "2026-09-01" }),
      }),
    );
    expect(r.state).toBe("INVALID");
  });

  it("rejects a UDiFF that post-dates the latest completed session", () => {
    const r = evaluateBseReferenceAuthority(
      input({ udiff: udiff({ tradingDate: WED }) }), // latest completed is TUE
    );
    expect(r.state).toBe("INVALID");
  });

  it("rejects an in-progress (not completed) session file", () => {
    const r = evaluateBseReferenceAuthority(input({ udiff: udiff({ sessionCompleted: false }) }));
    expect(r.state).toBe("INVALID");
  });

  it("is UNAVAILABLE, never authoritative, when no UDiFF exists at all", () => {
    expect(evaluateBseReferenceAuthority(input({ udiff: null })).state).toBe("UNAVAILABLE");
    expect(
      evaluateBseReferenceAuthority(input({ udiff: null, hasPriorAcceptedGeneration: true })).state,
    ).toBe("LAST_KNOWN");
  });
});

describe("matrix 9 — reconciliation, hash and row-floor failures fail closed", () => {
  it("refuses when reconciliation did not close", () => {
    const r = evaluateBseReferenceAuthority(input({ reconciliationClosed: false }));
    expect(r.state).toBe("INVALID");
    expect(r.mayAuthorizeNewGeneration).toBe(false);
  });

  it.each(["REJECTED_EMPTY", "REJECTED_MALFORMED", "REJECTED_BELOW_FLOOR", "UNAVAILABLE"] as const)(
    "refuses a List that is %s",
    (validationResult) => {
      const r = evaluateBseReferenceAuthority(input({ list: list({ validationResult }) }));
      expect(r.state).toBe("INVALID");
      expect(r.mayAuthorizeNewGeneration).toBe(false);
    },
  );

  it.each(["REJECTED_EMPTY", "REJECTED_MALFORMED", "REJECTED_BELOW_FLOOR", "UNAVAILABLE"] as const)(
    "refuses a UDiFF that is %s",
    (validationResult) => {
      const r = evaluateBseReferenceAuthority(input({ udiff: udiff({ validationResult }) }));
      expect(r.state).toBe("INVALID");
    },
  );

  it("only ever authorizes from the single CURRENT_AUTHORITATIVE state", () => {
    // Sweep every deny path above and assert the invariant holds globally.
    const denials: BseReferenceAuthorityInput[] = [
      input({ list: { outcome: "RETRIEVAL_FAILED", failureReason: "x" } }),
      input({ list: list({ validationResult: "REJECTED_MALFORMED" }) }),
      input({ list: list({ retrievedAtMs: Date.parse("2026-08-10T08:30:00.000Z") }) }),
      input({ calendar: UNKNOWN_TRADING_CALENDAR }),
      input({ udiff: null }),
      input({ udiff: udiff({ sessionCompleted: false }) }),
      input({ udiff: udiff({ tradingDate: "2026-09-01" }) }),
      input({ calendar: calendar({ latestCompletedSessionDate: WED }) }),
      input({ reconciliationClosed: false }),
    ];
    for (const d of denials) {
      const r = evaluateBseReferenceAuthority(d);
      expect(r.mayAuthorizeNewGeneration).toBe(false);
      expect(r.state).not.toBe("CURRENT_AUTHORITATIVE");
      expect(r.effectiveTradingDate).toBeNull();
    }
  });
});

describe("matrix 10 — LAST_KNOWN cannot mutate membership or classification (rule 7)", () => {
  const prior = [
    { authoritativeSecurityId: "BSE:500325", securityClass: "ORDINARY_EQUITY", eligibilityTier: "LIVE_REQUIRED" },
    { authoritativeSecurityId: "BSE:500180", securityClass: "ORDINARY_EQUITY", eligibilityTier: "LIVE_REQUIRED" },
  ];

  it("flags an ADDED security", () => {
    const next = [
      ...prior,
      { authoritativeSecurityId: "BSE:999999", securityClass: "ORDINARY_EQUITY", eligibilityTier: "LIVE_REQUIRED" },
    ];
    expect(detectLastKnownMutation("LAST_KNOWN", prior, next)).toEqual(["LAST_KNOWN registry added security BSE:999999"]);
  });

  it("flags a REMOVED security", () => {
    expect(detectLastKnownMutation("LAST_KNOWN", prior, [prior[0]])).toEqual([
      "LAST_KNOWN registry removed security BSE:500180",
    ]);
  });

  it("flags a RECLASSIFIED security and a RE-TIERED security", () => {
    const next = [
      { ...prior[0], securityClass: "PREFERENCE_SHARE" },
      { ...prior[1], eligibilityTier: "SNAPSHOT_ONLY" },
    ];
    const v = detectLastKnownMutation("LAST_KNOWN", prior, next);
    expect(v).toHaveLength(2);
    expect(v.join(" ")).toContain("reclassified BSE:500325");
    expect(v.join(" ")).toContain("re-tiered BSE:500180");
  });

  it("passes an unchanged LAST_KNOWN set", () => {
    expect(detectLastKnownMutation("LAST_KNOWN", prior, [...prior])).toEqual([]);
  });

  it("does not constrain a CURRENT_AUTHORITATIVE generation, which MAY change membership", () => {
    expect(detectLastKnownMutation("CURRENT_AUTHORITATIVE", prior, [prior[0]])).toEqual([]);
  });
});

describe("matrix 11 — NSE 48-hour policy unchanged, no new hour threshold", () => {
  it("keeps the NSE mirror at exactly 48 hours", () => {
    expect(NSE_REFERENCE_MAX_AGE_HOURS_MIRROR).toBe(48);
  });

  it("still applies the 48-hour boundary to NSE sources", () => {
    const t = Date.parse("2026-08-10T00:00:00.000Z");
    const justUnder = t + 47.9 * 3600_000;
    const justOver = t + 48.1 * 3600_000;
    expect(computeFreshnessState("NSE_EQUITY_L", new Date(t).toISOString(), justUnder)).toBe(
      "CURRENT_AUTHORITATIVE",
    );
    expect(computeFreshnessState("NSE_EQUITY_L", new Date(t).toISOString(), justOver)).toBe("STALE");
  });

  it("labels BSE freshness by IST CALENDAR DAY, with no hour threshold", () => {
    const retrieved = "2026-08-12T04:00:00.000Z"; // IST 09:30 Wed
    // 13 hours later is still the same IST day => still authoritative.
    expect(
      computeFreshnessState("BSE_LIST_OF_SCRIPS_ACTIVE", retrieved, Date.parse("2026-08-12T17:00:00.000Z")),
    ).toBe("CURRENT_AUTHORITATIVE");
    // 15 hours later has crossed into the next IST day => LAST_KNOWN.
    expect(
      computeFreshnessState("BSE_LIST_OF_SCRIPS_ACTIVE", retrieved, Date.parse("2026-08-12T19:00:00.000Z")),
    ).toBe("LAST_KNOWN");
  });

  it("records the policy as owner-approved and introduces no hour constant", () => {
    expect(BSE_REFERENCE_FRESHNESS_POLICY).toBe(
      "OWNER_APPROVED_CURRENT_DAY_LIST_PLUS_LATEST_COMPLETED_SESSION_UDIFF",
    );
    // Source-text guard: the policy module must not smuggle in an hour bound.
    const src = readFileSync(new URL("./bseReferencePolicy.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    // The IST offset is timezone arithmetic, not a freshness bound; it is the
    // ONLY permitted hour-valued constant, so remove it and require the rest
    // of the module to be free of any age/threshold arithmetic.
    const offsetLine = /export const IST_OFFSET_MS = [^;]+;/;
    expect(src).toMatch(offsetLine);
    expect(src.replace(offsetLine, "")).not.toMatch(/MAX_AGE|_HOURS|TOLERANCE|3600_000|86_400|ageMs/);
  });
});
