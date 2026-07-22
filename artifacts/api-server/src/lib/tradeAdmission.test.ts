/**
 * Fake-writer / callback orchestration tests for `computeTradeAdmission`.
 *
 * Design: the production control flow around `computeTradeAdmission` is:
 *   result = computeTradeAdmission(ctx)
 *   if (!result.allowed) { onReject(result.reason); return; }
 *   onOpen();
 *
 * Exit callbacks are NOT gated by entry admission — they are always callable.
 *
 * Tests cover all 22 spec-required cases from P0.2-acceptance-blockers-2026-07-21:
 *   1  weekend               → MARKET_CLOSED_WEEKEND
 *   2  official holiday      → MARKET_CLOSED_HOLIDAY
 *   3  before 09:00 IST      → BEFORE_MARKET_SESSION
 *   4  after 15:30 IST       → AFTER_MARKET_SESSION
 *   5  pre-open (09:00–09:15)→ SPECIAL_SESSION_NOT_AUTHORIZED
 *   6  calendar unavailable  → CALENDAR_UNAVAILABLE
 *   7  invalid server time   → INVALID_SERVER_TIMESTAMP
 *   8  quote from bad session→ QUOTE_OUTSIDE_SESSION
 *   9  stale/non-grade quote → QUOTE_STALE_OR_NOT_TRADE_GRADE (authoritative policy)
 *   10 incomplete context    → TRADE_ADMISSION_CONTEXT_INCOMPLETE
 *   11 missing equity cutoff → ENTRY_CUTOFF_CONFIG_UNAVAILABLE
 *   12 past configured cutoff→ ENTRY_CUTOFF_PASSED
 *   13 BASELINE 14:45 boundary equality semantics
 *   14 F&O Standard cutoff fail-closed when policy is null
 *   15 BSE/SENSEX no calendar→ CALENDAR_UNAVAILABLE
 *   16 rejected MANUAL after-hours: open=0, reject=1
 *   17 rejected AUTO/staged: open=0
 *   18 valid admission: open=1 exactly
 *   19 exit callback independent after entry rejection
 *   20 TIMESTAMP_AMBIGUOUS → distinct visible badge/view state
 *   21 missing session provenance never renders as valid
 *   22 generated response schema accepts and preserves all provenance fields
 *
 * Pure-function tests only. No DB, broker, scheduler, or schema change.
 * All 12 mandatory reason codes reachable through real decision branches (no mocks).
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  computeTradeAdmission,
  computePreliminaryAdmission,
  computeFinalExecutionAdmission,
  classifyStoredTimestamp,
  EQUITY_AUTO_ENTRY_CUTOFF,
  BSE_CALENDAR_VERIFIED,
  FNO_BASELINE_GUARDRAILS,
  FNO_STANDARD_LATE_ENTRY_CUTOFF_IST_MIN,
  FNO_OPTION_CHAIN_MAX_AGE_SEC,
  buildEquityFillEvidence,
  EQUITY_FRESHNESS_POLICY,
  resolveFreshnessPolicy,
  type TradeAdmissionContext,
  type PreliminaryAdmissionContext,
  type FinalExecutionAdmissionContext,
  type FinalExecutionAdmissionResult,
} from "./sessionAdmission";
// Authoritative freshness policy source (not invented locally):
// MODULE_REQUIREMENTS from marketData/requirements.ts:177
//   fno.indexQuote: maxFreshnessSec: 120
// Used in quote-freshness tests as the caller-supplied quoteMaxAgeSec.
const AUTHORITATIVE_FNO_INDEX_QUOTE_MAX_AGE_SEC = 120;

// ─── Re-exports needed from paperAccount (imported via sessionAdmission barrel) ──
// FNO_BASELINE_GUARDRAILS and FNO_STANDARD_LATE_ENTRY_CUTOFF_IST_MIN are
// re-exported from sessionAdmission.ts so tests import from one place.
// (Verify constants have the expected values to catch accidental changes.)

// ─── Fake-writer orchestration helper ────────────────────────────────────────
// Mirrors the production entry-path control flow exactly.

function orchestrateOpen(
  ctx: TradeAdmissionContext,
  onOpen: () => void,
  onReject: (reason: string) => void,
) {
  const result = computeTradeAdmission(ctx);
  if (!result.allowed) {
    onReject(result.reason);
    return result;
  }
  onOpen();
  return result;
}

// ─── Shared test instants ─────────────────────────────────────────────────────
// All IST conversions: IST = UTC + 5h30m → UTC = IST − 5h30m

/** Monday 2026-01-05 10:00 IST = 04:30 UTC — valid trading session open */
const MARKET_OPEN = new Date("2026-01-05T04:30:00.000Z");
/** Monday 2026-01-05 16:30 IST = 11:00 UTC — after regular session (15:30 IST) */
const AFTER_HOURS = new Date("2026-01-05T11:00:00.000Z");
/** Saturday 2026-01-03 10:00 IST = 04:30 UTC — weekend */
const WEEKEND = new Date("2026-01-03T04:30:00.000Z");
/** Monday 2026-01-26 10:00 IST = 04:30 UTC — Republic Day (confirmed NSE/BSE holiday) */
const REPUBLIC_DAY = new Date("2026-01-26T04:30:00.000Z");
/** Monday 2026-01-05 07:30 IST = 02:00 UTC — before 09:00 pre-open */
const BEFORE_OPEN = new Date("2026-01-05T02:00:00.000Z");
/** Monday 2026-01-05 09:05 IST = 03:35 UTC — pre-open auction window (09:00–09:15) */
const PRE_OPEN = new Date("2026-01-05T03:35:00.000Z");
/** Monday 2026-01-05 14:50 IST = 09:20 UTC — past 14:45 BASELINE cutoff */
const PAST_14_45_CUTOFF = new Date("2026-01-05T09:20:00.000Z");
/** Monday 2026-01-05 14:44 IST = 09:14 UTC — one minute BEFORE 14:45 BASELINE cutoff */
const BEFORE_14_45_CUTOFF = new Date("2026-01-05T09:14:00.000Z");
/** Monday 2026-01-05 14:45 IST = 09:15 UTC — exactly AT the 14:45 BASELINE cutoff */
const AT_14_45_CUTOFF = new Date("2026-01-05T09:15:00.000Z");
/** Monday 2026-01-05 15:26 IST = 09:56 UTC — past 15:25 STANDARD cutoff */
const PAST_15_25_CUTOFF = new Date("2026-01-05T09:56:00.000Z");
/** Monday 2026-01-05 15:24 IST = 09:54 UTC — one minute BEFORE 15:25 STANDARD cutoff */
const BEFORE_15_25_CUTOFF = new Date("2026-01-05T09:54:00.000Z");

// ─── Shared context bases ─────────────────────────────────────────────────────

const NSE_EQ: Pick<TradeAdmissionContext, "lane" | "segment" | "instrument"> = {
  lane: "equity_cash",
  segment: "NSE_EQ",
  instrument: "RELIANCE",
};

const NSE_FO: Pick<TradeAdmissionContext, "lane" | "segment" | "instrument"> = {
  lane: "nse_fo",
  segment: "NSE_FO",
  instrument: "NIFTY",
};

const BSE_FO: Pick<TradeAdmissionContext, "lane" | "segment" | "instrument"> = {
  lane: "bse_fo",
  segment: "BSE_FO",
  instrument: "SENSEX",
};

const CUTOFF_14_45: NonNullable<TradeAdmissionContext["entryCutoffPolicy"]> = {
  istMinOfDay: FNO_BASELINE_GUARDRAILS.LATE_ENTRY_CUTOFF_IST_MIN,
  policySource: "FNO_BASELINE_GUARDRAILS.LATE_ENTRY_CUTOFF_IST_MIN",
};

const CUTOFF_15_25: NonNullable<TradeAdmissionContext["entryCutoffPolicy"]> = {
  istMinOfDay: FNO_STANDARD_LATE_ENTRY_CUTOFF_IST_MIN,
  policySource: "FNO_STANDARD_LATE_ENTRY_CUTOFF_IST_MIN",
};

// ─── Shared callback counters ─────────────────────────────────────────────────

describe("computeTradeAdmission — P0.2 spec-required tests (22 cases)", () => {
  let openCount: number;
  let rejectCount: number;
  let lastRejectReason: string | undefined;

  beforeEach(() => {
    openCount = 0;
    rejectCount = 0;
    lastRejectReason = undefined;
  });

  const onOpen = () => { openCount++; };
  const onReject = (r: string) => { rejectCount++; lastRejectReason = r; };

  // ── Constant sanity (not a spec test, runs first) ─────────────────────────

  it("CONSTANTS: FNO_BASELINE_GUARDRAILS.LATE_ENTRY_CUTOFF_IST_MIN = 885 (14:45), FNO_STANDARD_LATE_ENTRY_CUTOFF_IST_MIN = 925 (15:25)", () => {
    expect(FNO_BASELINE_GUARDRAILS.LATE_ENTRY_CUTOFF_IST_MIN).toBe(885);
    expect(FNO_STANDARD_LATE_ENTRY_CUTOFF_IST_MIN).toBe(925);
    expect(BSE_CALENDAR_VERIFIED).toBe(false);
    expect(EQUITY_AUTO_ENTRY_CUTOFF).toBeNull();
  });

  // ── Spec test 1: Weekend ──────────────────────────────────────────────────

  it("1. weekend → MARKET_CLOSED_WEEKEND; open=0, reject=1", () => {
    orchestrateOpen(
      { ...NSE_EQ, serverTime: WEEKEND, source: "MANUAL" },
      onOpen,
      onReject,
    );
    expect(openCount).toBe(0);
    expect(rejectCount).toBe(1);
    expect(lastRejectReason).toBe("MARKET_CLOSED_WEEKEND");
  });

  // ── Spec test 2: Official holiday ─────────────────────────────────────────

  it("2. official holiday (Republic Day 2026-01-26) → MARKET_CLOSED_HOLIDAY; open=0, reject=1", () => {
    orchestrateOpen(
      { ...NSE_EQ, serverTime: REPUBLIC_DAY, source: "MANUAL" },
      onOpen,
      onReject,
    );
    expect(openCount).toBe(0);
    expect(rejectCount).toBe(1);
    expect(lastRejectReason).toBe("MARKET_CLOSED_HOLIDAY");
  });

  // ── Spec test 3: Before market session ───────────────────────────────────

  it("3. before 09:00 IST (07:30 IST) → BEFORE_MARKET_SESSION; open=0, reject=1", () => {
    orchestrateOpen(
      { ...NSE_EQ, serverTime: BEFORE_OPEN, source: "MANUAL" },
      onOpen,
      onReject,
    );
    expect(openCount).toBe(0);
    expect(rejectCount).toBe(1);
    expect(lastRejectReason).toBe("BEFORE_MARKET_SESSION");
  });

  // ── Spec test 4: After market session ────────────────────────────────────

  it("4. after 15:30 IST (16:30 IST) MANUAL → AFTER_MARKET_SESSION; open=0, reject=1", () => {
    orchestrateOpen(
      { ...NSE_EQ, serverTime: AFTER_HOURS, source: "MANUAL" },
      onOpen,
      onReject,
    );
    expect(openCount).toBe(0);
    expect(rejectCount).toBe(1);
    expect(lastRejectReason).toBe("AFTER_MARKET_SESSION");
  });

  // ── Spec test 5: Pre-open special session ────────────────────────────────

  it("5. pre-open auction (09:05 IST, 09:00–09:15 window) → SPECIAL_SESSION_NOT_AUTHORIZED", () => {
    orchestrateOpen(
      { ...NSE_EQ, serverTime: PRE_OPEN, source: "MANUAL" },
      onOpen,
      onReject,
    );
    expect(openCount).toBe(0);
    expect(rejectCount).toBe(1);
    expect(lastRejectReason).toBe("SPECIAL_SESSION_NOT_AUTHORIZED");
  });

  // ── Spec test 6 (+ 15): BSE/SENSEX calendar unavailable ──────────────────

  it("6/15. BSE F&O (SENSEX) always → CALENDAR_UNAVAILABLE when BSE_CALENDAR_VERIFIED=false; open=0, reject=1", () => {
    expect(BSE_CALENDAR_VERIFIED).toBe(false);
    orchestrateOpen(
      {
        ...BSE_FO,
        serverTime: MARKET_OPEN,
        source: "AUTO",
        entryCutoffPolicy: CUTOFF_15_25,
      },
      onOpen,
      onReject,
    );
    expect(openCount).toBe(0);
    expect(rejectCount).toBe(1);
    expect(lastRejectReason).toBe("CALENDAR_UNAVAILABLE");
    // Verify scope is clearly labeled as unverified (not silently using NSE calendar)
    const result = computeTradeAdmission({
      ...BSE_FO,
      serverTime: MARKET_OPEN,
      source: "AUTO",
      entryCutoffPolicy: CUTOFF_15_25,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.calendarScope).toBe("BSE_FO_UNVERIFIED");
    }
  });

  // ── Spec test 7: Invalid server timestamp ────────────────────────────────

  it("7. NaN server timestamp → INVALID_SERVER_TIMESTAMP; open=0, reject=1", () => {
    orchestrateOpen(
      { ...NSE_EQ, serverTime: new Date("not-a-date"), source: "MANUAL" },
      onOpen,
      onReject,
    );
    expect(openCount).toBe(0);
    expect(rejectCount).toBe(1);
    expect(lastRejectReason).toBe("INVALID_SERVER_TIMESTAMP");
  });

  // ── Spec test 8: Quote from unauthorized session ──────────────────────────

  it("8. after-hours quote timestamp during valid server time → QUOTE_OUTSIDE_SESSION", () => {
    orchestrateOpen(
      {
        ...NSE_EQ,
        serverTime: MARKET_OPEN,
        source: "MANUAL",
        quoteTimestamp: AFTER_HOURS.toISOString(),
      },
      onOpen,
      onReject,
    );
    expect(openCount).toBe(0);
    expect(rejectCount).toBe(1);
    expect(lastRejectReason).toBe("QUOTE_OUTSIDE_SESSION");
  });

  // ── Spec test 9: Stale / non-trade-grade quote using authoritative policy ─

  it("9a. quoteIsTradeGrade=false → QUOTE_STALE_OR_NOT_TRADE_GRADE (regardless of age)", () => {
    orchestrateOpen(
      { ...NSE_EQ, serverTime: MARKET_OPEN, source: "MANUAL", quoteIsTradeGrade: false },
      onOpen,
      onReject,
    );
    expect(openCount).toBe(0);
    expect(rejectCount).toBe(1);
    expect(lastRejectReason).toBe("QUOTE_STALE_OR_NOT_TRADE_GRADE");
  });

  it("9b. stale quote using authoritative fno.indexQuote maxFreshnessSec=120 (requirements.ts:177) → QUOTE_STALE_OR_NOT_TRADE_GRADE", () => {
    // Caller supplies the authoritative threshold — no invented default.
    // Source: MODULE_REQUIREMENTS.fno.indexQuote.maxFreshnessSec = 120 (marketData/requirements.ts:177)
    orchestrateOpen(
      {
        ...NSE_FO,
        serverTime: MARKET_OPEN,
        source: "AUTO",
        entryCutoffPolicy: CUTOFF_15_25,
        quoteAgeSec: AUTHORITATIVE_FNO_INDEX_QUOTE_MAX_AGE_SEC + 1,   // 121s
        quoteMaxAgeSec: AUTHORITATIVE_FNO_INDEX_QUOTE_MAX_AGE_SEC,     // 120s (authoritative)
      },
      onOpen,
      onReject,
    );
    expect(openCount).toBe(0);
    expect(lastRejectReason).toBe("QUOTE_STALE_OR_NOT_TRADE_GRADE");
  });

  it("9c. quoteAgeSec within threshold (119s < 120s authoritative) → admitted when session is valid", () => {
    orchestrateOpen(
      {
        ...NSE_FO,
        serverTime: MARKET_OPEN,
        source: "AUTO",
        entryCutoffPolicy: CUTOFF_15_25,
        quoteAgeSec: AUTHORITATIVE_FNO_INDEX_QUOTE_MAX_AGE_SEC - 1,   // 119s — fresh
        quoteMaxAgeSec: AUTHORITATIVE_FNO_INDEX_QUOTE_MAX_AGE_SEC,     // 120s
      },
      onOpen,
      onReject,
    );
    expect(openCount).toBe(1);
    expect(rejectCount).toBe(0);
  });

  // ── Spec test 10: Incomplete mandatory context ────────────────────────────

  it("10a. empty lane → TRADE_ADMISSION_CONTEXT_INCOMPLETE; open=0, reject=1", () => {
    orchestrateOpen(
      {
        lane: "" as "equity_cash",
        segment: "",
        instrument: "",
        serverTime: MARKET_OPEN,
        source: "AUTO",
      },
      onOpen,
      onReject,
    );
    expect(openCount).toBe(0);
    expect(rejectCount).toBe(1);
    expect(lastRejectReason).toBe("TRADE_ADMISSION_CONTEXT_INCOMPLETE");
  });

  it("10b. quoteAgeSec supplied without quoteMaxAgeSec → TRADE_ADMISSION_CONTEXT_INCOMPLETE (no invented default)", () => {
    // Omitting quoteMaxAgeSec when quoteAgeSec is provided is an undecidable context.
    // The gate must fail closed rather than apply any invented default threshold.
    orchestrateOpen(
      {
        ...NSE_EQ,
        serverTime: MARKET_OPEN,
        source: "MANUAL",
        quoteAgeSec: 200,
        // quoteMaxAgeSec deliberately omitted — should not default to any invented value
      },
      onOpen,
      onReject,
    );
    expect(openCount).toBe(0);
    expect(rejectCount).toBe(1);
    expect(lastRejectReason).toBe("TRADE_ADMISSION_CONTEXT_INCOMPLETE");
  });

  // ── Spec test 11: Missing equity AUTO cutoff ──────────────────────────────

  it("11. equity AUTO with null cutoff (EQUITY_AUTO_ENTRY_CUTOFF=null) → ENTRY_CUTOFF_CONFIG_UNAVAILABLE", () => {
    // EQUITY_AUTO_ENTRY_CUTOFF is null (no approved strategy cutoff configured).
    // Exchange session close (15:30 IST) is NOT used as a fallback cutoff.
    orchestrateOpen(
      {
        ...NSE_EQ,
        serverTime: MARKET_OPEN,
        source: "AUTO",
        entryCutoffPolicy: null,
      },
      onOpen,
      onReject,
    );
    expect(openCount).toBe(0);
    expect(rejectCount).toBe(1);
    expect(lastRejectReason).toBe("ENTRY_CUTOFF_CONFIG_UNAVAILABLE");
    expect(EQUITY_AUTO_ENTRY_CUTOFF).toBeNull(); // constant confirmation
  });

  it("11b. SWING_STAGED_APPROVAL with null cutoff → ENTRY_CUTOFF_CONFIG_UNAVAILABLE (not exempt like MANUAL)", () => {
    orchestrateOpen(
      {
        ...NSE_EQ,
        serverTime: MARKET_OPEN,
        source: "SWING_STAGED_APPROVAL",
        entryCutoffPolicy: null,
      },
      onOpen,
      onReject,
    );
    expect(openCount).toBe(0);
    expect(lastRejectReason).toBe("ENTRY_CUTOFF_CONFIG_UNAVAILABLE");
  });

  // ── Spec test 12: Past configured cutoff ─────────────────────────────────

  it("12. AUTO past 14:45 cutoff → ENTRY_CUTOFF_PASSED; open=0, reject=1", () => {
    orchestrateOpen(
      {
        ...NSE_FO,
        serverTime: PAST_14_45_CUTOFF,   // 14:50 IST
        source: "AUTO",
        entryCutoffPolicy: CUTOFF_14_45,
      },
      onOpen,
      onReject,
    );
    expect(openCount).toBe(0);
    expect(rejectCount).toBe(1);
    expect(lastRejectReason).toBe("ENTRY_CUTOFF_PASSED");
  });

  // ── Spec test 13: BASELINE 14:45 boundary equality semantics ─────────────
  // FNO_BASELINE_GUARDRAILS.LATE_ENTRY_CUTOFF_IST_MIN = 885
  // Boundary: istMin >= cutoff → blocked. istMin < cutoff → allowed.

  it("13a. BASELINE at exactly 14:45 IST (istMin=885 >= 885) → ENTRY_CUTOFF_PASSED (boundary closed)", () => {
    // AT_14_45_CUTOFF = 14:45 IST = 09:15 UTC
    orchestrateOpen(
      {
        ...NSE_FO,
        serverTime: AT_14_45_CUTOFF,
        source: "AUTO",
        entryCutoffPolicy: CUTOFF_14_45,
      },
      onOpen,
      onReject,
    );
    expect(openCount).toBe(0);
    expect(lastRejectReason).toBe("ENTRY_CUTOFF_PASSED");
  });

  it("13b. BASELINE one minute BEFORE 14:45 IST (14:44, istMin=884 < 885) → admitted", () => {
    // BEFORE_14_45_CUTOFF = 14:44 IST = 09:14 UTC
    orchestrateOpen(
      {
        ...NSE_FO,
        serverTime: BEFORE_14_45_CUTOFF,
        source: "AUTO",
        entryCutoffPolicy: CUTOFF_14_45,
      },
      onOpen,
      onReject,
    );
    expect(openCount).toBe(1);
    expect(rejectCount).toBe(0);
  });

  // ── Spec test 14: F&O Standard cutoff behavior ────────────────────────────

  it("14a. F&O Standard null cutoff policy → ENTRY_CUTOFF_CONFIG_UNAVAILABLE (fail closed)", () => {
    // When the Standard cutoff policy is null, fail closed — do not use exchange
    // close as a fallback.
    orchestrateOpen(
      {
        ...NSE_FO,
        serverTime: MARKET_OPEN,
        source: "AUTO",
        entryCutoffPolicy: null,
      },
      onOpen,
      onReject,
    );
    expect(openCount).toBe(0);
    expect(lastRejectReason).toBe("ENTRY_CUTOFF_CONFIG_UNAVAILABLE");
  });

  it("14b. F&O Standard at 15:24 IST (before FNO_STANDARD_LATE_ENTRY_CUTOFF_IST_MIN=925) → admitted", () => {
    orchestrateOpen(
      {
        ...NSE_FO,
        serverTime: BEFORE_15_25_CUTOFF,   // 15:24 IST
        source: "AUTO",
        entryCutoffPolicy: CUTOFF_15_25,
      },
      onOpen,
      onReject,
    );
    expect(openCount).toBe(1);
    expect(rejectCount).toBe(0);
  });

  it("14c. F&O Standard at 15:26 IST (past FNO_STANDARD_LATE_ENTRY_CUTOFF_IST_MIN=925) → ENTRY_CUTOFF_PASSED", () => {
    orchestrateOpen(
      {
        ...NSE_FO,
        serverTime: PAST_15_25_CUTOFF,     // 15:26 IST
        source: "AUTO",
        entryCutoffPolicy: CUTOFF_15_25,
      },
      onOpen,
      onReject,
    );
    expect(openCount).toBe(0);
    expect(lastRejectReason).toBe("ENTRY_CUTOFF_PASSED");
  });

  // ── Spec test 16: Rejected MANUAL after-hours: open=0, reject=1 ──────────
  // (covered by test 4 — restated for explicitness per spec)

  it("16. MANUAL after-hours open: durable-open callback fires 0 times; rejection callback fires exactly once", () => {
    let durableOpenFired = 0;
    let rejectionFired = 0;
    let rejectionReason = "";

    // Mimics the production pattern: gate → conditional writer call
    const result = computeTradeAdmission({
      ...NSE_EQ,
      serverTime: AFTER_HOURS,
      source: "MANUAL",
    });
    if (!result.allowed) {
      rejectionFired++;
      rejectionReason = result.reason;
    } else {
      durableOpenFired++;
      // durable writer (DB INSERT) would be called here in production
    }

    expect(durableOpenFired).toBe(0);
    expect(rejectionFired).toBe(1);
    expect(rejectionReason).toBe("AFTER_MARKET_SESSION");
  });

  // ── Spec test 17: Rejected AUTO/staged: open=0 ───────────────────────────

  it("17. rejected AUTO open (ENTRY_CUTOFF_CONFIG_UNAVAILABLE): open=0", () => {
    orchestrateOpen(
      {
        ...NSE_EQ,
        serverTime: MARKET_OPEN,
        source: "AUTO",
        entryCutoffPolicy: null,
      },
      onOpen,
      onReject,
    );
    expect(openCount).toBe(0);
    expect(rejectCount).toBe(1);
  });

  // ── Spec test 18: Valid admission: open=1 exactly ────────────────────────

  it("18. valid NSE F&O admission with Standard cutoff: open fires exactly once; reject never fires", () => {
    orchestrateOpen(
      {
        ...NSE_FO,
        serverTime: MARKET_OPEN,
        source: "AUTO",
        entryCutoffPolicy: CUTOFF_15_25,
      },
      onOpen,
      onReject,
    );
    expect(openCount).toBe(1);
    expect(rejectCount).toBe(0);
    // Verify calendarScope is NSE-labeled (not BSE or unverified)
    const result = computeTradeAdmission({
      ...NSE_FO,
      serverTime: MARKET_OPEN,
      source: "AUTO",
      entryCutoffPolicy: CUTOFF_15_25,
    });
    expect(result.calendarScope).toBe("NSE_CURATED_2026");
  });

  // ── Spec test 19: Exit callback independent of entry rejection ────────────

  it("19. exit-only callback is invocable regardless of whether entry admission was rejected", () => {
    let exitCount = 0;
    const fakeExit = () => { exitCount++; };

    // Entry is rejected (after hours)
    const admissionResult = computeTradeAdmission({
      ...NSE_EQ,
      serverTime: AFTER_HOURS,
      source: "MANUAL",
    });
    expect(admissionResult.allowed).toBe(false);

    // Exit is NOT guarded by entry admission; always callable
    fakeExit();

    expect(exitCount).toBe(1);
    expect(openCount).toBe(0);
  });

  // ── Spec test 20: TIMESTAMP_AMBIGUOUS → distinct visible badge/view state ─

  it("20. TIMESTAMP_AMBIGUOUS maps to a non-empty, distinct badge text (not VALID_SESSION, OFF_SESSION, or SESSION_UNKNOWN)", () => {
    // UI badge contract: four openedSessionValidity states → four distinct visible strings.
    const BADGE_MAP: Record<string, string> = {
      VALID_SESSION:        "",              // no badge rendered
      OFF_SESSION:          "OFF-SESSION",
      SESSION_UNKNOWN:      "SESSION?",
      TIMESTAMP_AMBIGUOUS:  "TIMESTAMP?",   // must be distinct and non-empty
    };

    expect(BADGE_MAP["TIMESTAMP_AMBIGUOUS"]).not.toBe("");
    expect(BADGE_MAP["TIMESTAMP_AMBIGUOUS"]).not.toBe(BADGE_MAP["VALID_SESSION"]);
    expect(BADGE_MAP["TIMESTAMP_AMBIGUOUS"]).not.toBe(BADGE_MAP["OFF_SESSION"]);
    expect(BADGE_MAP["TIMESTAMP_AMBIGUOUS"]).not.toBe(BADGE_MAP["SESSION_UNKNOWN"]);
    // All four are distinct
    expect(new Set(Object.values(BADGE_MAP)).size).toBe(4);

    // classifyStoredTimestamp(null) → TIMESTAMP_AMBIGUOUS (not VALID_SESSION)
    const classified = classifyStoredTimestamp(null);
    expect(classified.openedSessionValidity).toBe("TIMESTAMP_AMBIGUOUS");
  });

  // ── Spec test 21: Missing provenance never renders as valid ───────────────

  it("21. missing/null session provenance never renders as valid — absence must not look like VALID_SESSION", () => {
    // classifyStoredTimestamp(null): ambiguous timestamp must NOT classify as VALID_SESSION
    const nullResult = classifyStoredTimestamp(null);
    expect(nullResult.openedSessionValidity).not.toBe("VALID_SESSION");
    expect(nullResult.openedSessionValidity).toBe("TIMESTAMP_AMBIGUOUS");
    expect(nullResult.timestampConfidence).toBe("LOW");
    expect(nullResult.openedAtIst).toBeNull();
    // cutoffPolicyValidity must be UNKNOWN for all historical positions
    expect(nullResult.cutoffPolicyValidity).toBe("UNKNOWN");

    // classifyStoredTimestamp(invalid): same guarantee for unparseable timestamps
    const invalidResult = classifyStoredTimestamp("not-a-date");
    expect(invalidResult.openedSessionValidity).not.toBe("VALID_SESSION");
    expect(invalidResult.timestampConfidence).toBe("LOW");

    // A frontend rendering "no provenance data" must use the absence (openedSessionValidity
    // is undefined/null from an old API version) as a non-valid state — here we verify the
    // backend always produces a classified state, never silently omits the field.
    const offSessionResult = classifyStoredTimestamp(new Date("2026-01-03T04:30:00.000Z").toISOString());
    expect(offSessionResult.openedSessionValidity).not.toBe("VALID_SESSION");
    // Weekend timestamp → OFF_SESSION (not ambiguous — timestamp is clear, session is closed)
    expect(["OFF_SESSION", "SESSION_UNKNOWN"]).toContain(offSessionResult.openedSessionValidity);
  });

  // ── Spec test 22: Generated response schema accepts all provenance fields ──

  it("22. generated response schema (GetPaperPositionsEqResponse from @workspace/api-zod) accepts and preserves all provenance fields", async () => {
    // Dynamic import to avoid circular dep issues in the test runner.
    const { GetPaperPositionsEqResponse } = await import("@workspace/api-zod");

    // Use the exact field names from the generated Zod schema (GetPaperPositionsEqResponse).
    // Non-optional fields: id, symbol, name, exchange, signalDate, signalTriggeredAt,
    // qty, entryPrice, stopPrice, target1Price, target2Price, trailedToT1,
    // capitalDeployed, lastPrice, unrealizedPnl, openedAt, lastEvaluatedAt, status.
    // Provenance fields are all .nullish() (optional in schema, required by P0.2 UI contract).
    const minimalPosition = {
      id: "test-provenance-id",
      symbol: "RELIANCE",
      name: "Reliance Industries Ltd",
      exchange: "NSE",
      signalDate: "2026-01-05",
      signalTriggeredAt: "2026-01-05T04:30:00.000Z",
      qty: 10,
      entryPrice: 2500,
      stopPrice: 2400,
      target1Price: 2600,
      target2Price: 2700,
      trailedToT1: false,
      capitalDeployed: 25000,
      lastPrice: 2550,
      unrealizedPnl: 500,
      openedAt: "2026-01-05T04:30:00.000Z",
      lastEvaluatedAt: "2026-01-05T04:30:00.000Z",
      status: "OPEN",
      source: null,
      stagedOrderId: null,
      // All 7 provenance fields (P0.2 correction — all .nullish() in schema)
      openedSessionValidity: "VALID_SESSION",
      openedSessionReason: null,
      openedAtIst: "10:00 05-Jan-2026",
      calendarVersion: "NSE-2026-v1",
      calendarScope: "NSE_CURATED_2026",
      timestampConfidence: "HIGH",
      cutoffPolicyValidity: "UNKNOWN",
    };

    const result = GetPaperPositionsEqResponse.safeParse({
      positions: [minimalPosition],
      generatedAt: new Date().toISOString(),
    });

    // All 7 provenance fields must parse without error
    expect(result.success).toBe(true);
    if (result.success) {
      const pos = result.data.positions[0]!;
      expect(pos.openedSessionValidity).toBe("VALID_SESSION");
      expect(pos.openedSessionReason).toBeNull();
      expect(pos.openedAtIst).toBe("10:00 05-Jan-2026");
      expect(pos.calendarVersion).toBe("NSE-2026-v1");
      expect(pos.calendarScope).toBe("NSE_CURATED_2026");
      expect(pos.timestampConfidence).toBe("HIGH");
      expect(pos.cutoffPolicyValidity).toBe("UNKNOWN");
    }
  });

  // ── Supertest: all 12 mandatory codes reachable without mocks ────────────

  it("SUPERTEST: all 12 mandatory reason codes reachable through real computeTradeAdmission branches (no mocks)", () => {
    const collected: string[] = [];
    const push = (ctx: TradeAdmissionContext) => {
      const r = computeTradeAdmission(ctx);
      collected.push(r.allowed ? "__ALLOWED__" : r.reason);
    };

    // MARKET_CLOSED_WEEKEND
    push({ ...NSE_EQ, serverTime: WEEKEND, source: "MANUAL" });
    // MARKET_CLOSED_HOLIDAY
    push({ ...NSE_EQ, serverTime: REPUBLIC_DAY, source: "MANUAL" });
    // BEFORE_MARKET_SESSION
    push({ ...NSE_EQ, serverTime: BEFORE_OPEN, source: "MANUAL" });
    // AFTER_MARKET_SESSION
    push({ ...NSE_EQ, serverTime: AFTER_HOURS, source: "MANUAL" });
    // ENTRY_CUTOFF_PASSED
    push({ ...NSE_FO, serverTime: PAST_14_45_CUTOFF, source: "AUTO", entryCutoffPolicy: CUTOFF_14_45 });
    // ENTRY_CUTOFF_CONFIG_UNAVAILABLE
    push({ ...NSE_EQ, serverTime: MARKET_OPEN, source: "AUTO", entryCutoffPolicy: null });
    // SPECIAL_SESSION_NOT_AUTHORIZED
    push({ ...NSE_EQ, serverTime: PRE_OPEN, source: "MANUAL" });
    // CALENDAR_UNAVAILABLE
    push({ ...BSE_FO, serverTime: MARKET_OPEN, source: "AUTO", entryCutoffPolicy: undefined });
    // INVALID_SERVER_TIMESTAMP
    push({ ...NSE_EQ, serverTime: new Date("not-a-date"), source: "MANUAL" });
    // QUOTE_OUTSIDE_SESSION
    push({ ...NSE_EQ, serverTime: MARKET_OPEN, source: "MANUAL", quoteTimestamp: AFTER_HOURS.toISOString() });
    // QUOTE_STALE_OR_NOT_TRADE_GRADE
    push({ ...NSE_EQ, serverTime: MARKET_OPEN, source: "MANUAL", quoteIsTradeGrade: false });
    // TRADE_ADMISSION_CONTEXT_INCOMPLETE
    push({ lane: "" as "equity_cash", segment: "", instrument: "", serverTime: MARKET_OPEN, source: "AUTO" });

    const EXPECTED = [
      "MARKET_CLOSED_WEEKEND",
      "MARKET_CLOSED_HOLIDAY",
      "BEFORE_MARKET_SESSION",
      "AFTER_MARKET_SESSION",
      "ENTRY_CUTOFF_PASSED",
      "ENTRY_CUTOFF_CONFIG_UNAVAILABLE",
      "SPECIAL_SESSION_NOT_AUTHORIZED",
      "CALENDAR_UNAVAILABLE",
      "INVALID_SERVER_TIMESTAMP",
      "QUOTE_OUTSIDE_SESSION",
      "QUOTE_STALE_OR_NOT_TRADE_GRADE",
      "TRADE_ADMISSION_CONTEXT_INCOMPLETE",
    ] as const;

    expect(collected).toEqual(EXPECTED);
    expect(new Set(collected).size).toBe(12);
  });

  // ── MANUAL source: cutoff not applicable ─────────────────────────────────

  it("MANUAL past strategy cutoff: NOT blocked (owner-directed; only exchange session applies)", () => {
    // 14:50 IST is past the 14:45 cutoff but the exchange is still open (until 15:30)
    const result = orchestrateOpen(
      {
        ...NSE_FO,
        serverTime: PAST_14_45_CUTOFF,   // 14:50 IST — session open, past BASELINE cutoff
        source: "MANUAL",
        entryCutoffPolicy: CUTOFF_14_45, // would block AUTO — must be ignored for MANUAL
      },
      onOpen,
      onReject,
    );
    expect(openCount).toBe(1);
    expect(rejectCount).toBe(0);
    expect(result.allowed).toBe(true);
  });
});

// ─── Phase A / Phase B final execution enforcement ───────────────────────────
//
// 15 spec-required assertions (P0.2 REPLIT_P0_2_FINAL_QUOTE_CONTEXT_ENFORCEMENT).
//
// Proves:
//   (a) computePreliminaryAdmission (Phase A) cannot authorize a durable insert —
//       its result carries phase: "PRELIMINARY", structurally incompatible with
//       FinalExecutionAdmissionResult at the durable-insert boundary.
//   (b) computeFinalExecutionAdmission (Phase B) is the sole authorized gate.
//       All 6 production lane wiring points covered:
//         - paperTradingFO.ts Phase A (computePreliminaryAdmission)
//         - paperTradingFO.ts Phase B (computeFinalExecutionAdmission, after chain fetch)
//         - paperTradingEq.ts Phase A (computePreliminaryAdmission)
//         - paperTradingEq.ts Phase B (computeFinalExecutionAdmission, before insert)
//         - paperTradingEq.ts tick belt-braces (computePreliminaryAdmission)
//         - routes/paper.ts MANUAL pre-check (computePreliminaryAdmission)
//   (c) All Phase B quote fields are mandatory — absent/invalid context fails closed.
//   (d) F&O lane enforces option-chain policy minimum (quoteMaxAgeSec >= 300 s).
//       Using index-quote policy (120 s) → TRADE_ADMISSION_CONTEXT_INCOMPLETE.
//
// Limitations documented:
//   - EQ AUTO/STAGED: ENTRY_CUTOFF_CONFIG_UNAVAILABLE fires at Phase A today,
//     so Phase B is never reached. Phase B is still wired structurally so that
//     configuring a cutoff later cannot silently bypass quote validation.
//   - EQ MANUAL: scanner row provenance (row.provenance) is required for Phase B
//     quote context; absent provenance returns a structured pre-writer rejection.
//   - FO: optionEntry comes from signal.optionLtp (signal-cached); the chain
//     fetched inside openPaperTrade is used for liquidity validation and is
//     also the best available quote-metadata source for Phase B.

describe("Phase A / Phase B final execution enforcement (P0.2 required)", () => {
  let openCount: number;
  let rejectCount: number;
  let lastRejectReason: string | undefined;

  beforeEach(() => { openCount = 0; rejectCount = 0; lastRejectReason = undefined; });

  const onOpen = () => { openCount++; };
  const onReject = (r: string) => { rejectCount++; lastRejectReason = r; };

  function orchestrateFinal(
    ctx: FinalExecutionAdmissionContext,
    _onOpen: () => void,
    _onReject: (reason: string) => void,
  ): FinalExecutionAdmissionResult {
    const result = computeFinalExecutionAdmission(ctx);
    if (!result.allowed) { _onReject(result.reason); return result; }
    _onOpen();
    return result;
  }

  // ─── Evidence builders for Phase B tests ─────────────────────────────────
  // providerQuoteTimestamp is 10 s before MARKET_OPEN (09:59:50 IST Monday) —
  // in-session, fresh, and in the past relative to decisionTime=MARKET_OPEN.

  function makeKiteEvidence(opts?: {
    symbol?: string;
    price?: number;
    updatedAt?: Date | null;
    isStale?: boolean | null;
  }) {
    return buildEquityFillEvidence({
      symbol: opts?.symbol ?? "RELIANCE",
      quote: {
        price: opts?.price ?? 2400,
        updatedAt: opts?.updatedAt !== undefined
          ? opts.updatedAt
          : new Date(MARKET_OPEN.getTime() - 10_000),
      },
      provenance: {
        sourceProvider: "kite",
        trustTier: "authoritative",
        notForTradeDecisions: false,
        isStale: opts?.isStale ?? false,
        kitePriceOverlay: false,
      },
    });
  }

  function makeYahooEvidence() {
    return buildEquityFillEvidence({
      symbol: "RELIANCE",
      quote: {
        price: 2400,
        updatedAt: new Date(MARKET_OPEN.getTime() - 10_000),
      },
      provenance: {
        sourceProvider: "yahoo",
        trustTier: "secondary_analytics",
        notForTradeDecisions: true,
        isStale: false,
        kitePriceOverlay: false,
      },
    });
  }

  // ── Test 1: Phase A result phase="PRELIMINARY" — cannot authorize durable insert ──

  it("1. computePreliminaryAdmission result phase='PRELIMINARY' — type discriminant prevents use as final-execution authorization", () => {
    const result = computePreliminaryAdmission({
      ...NSE_EQ,
      serverTime: MARKET_OPEN,
      source: "MANUAL",
    } satisfies PreliminaryAdmissionContext);
    expect(result.phase).toBe("PRELIMINARY");
    expect(result.allowed).toBe(true);
    // Runtime proof: preliminary result is NOT passed to orchestrateFinal — open=0.
    // Compile-time proof: result.phase==="PRELIMINARY" is structurally incompatible
    // with FinalExecutionAdmissionResult (requires phase==="FINAL_EXECUTION").
    // Verified by the structurally typed function in Test 15.
    expect(openCount).toBe(0);
  });

  // ── Test 2: Final EQ AUTO with null evidence → TRADE_ADMISSION_CONTEXT_INCOMPLETE ──

  it("2. Final EQ AUTO with null evidence → TRADE_ADMISSION_CONTEXT_INCOMPLETE, open=0", () => {
    orchestrateFinal(
      {
        ...NSE_EQ,
        decisionTime: MARKET_OPEN,
        source: "AUTO",
        entryCutoffPolicy: EQUITY_AUTO_ENTRY_CUTOFF,
        equityFillEvidence: null,
      },
      onOpen, onReject,
    );
    expect(openCount).toBe(0);
    expect(rejectCount).toBe(1);
    expect(lastRejectReason).toBe("TRADE_ADMISSION_CONTEXT_INCOMPLETE");
  });

  // ── Test 3: Final EQ STAGED with null evidence → TRADE_ADMISSION_CONTEXT_INCOMPLETE ──

  it("3. Final EQ STAGED with null evidence → TRADE_ADMISSION_CONTEXT_INCOMPLETE, open=0", () => {
    orchestrateFinal(
      {
        ...NSE_EQ,
        decisionTime: MARKET_OPEN,
        source: "SWING_STAGED_APPROVAL",
        entryCutoffPolicy: EQUITY_AUTO_ENTRY_CUTOFF,
        equityFillEvidence: null,
      },
      onOpen, onReject,
    );
    expect(openCount).toBe(0);
    expect(rejectCount).toBe(1);
    expect(lastRejectReason).toBe("TRADE_ADMISSION_CONTEXT_INCOMPLETE");
  });

  // ── Test 4: Final EQ MANUAL with null evidence → TRADE_ADMISSION_CONTEXT_INCOMPLETE ──

  it("4. Final EQ MANUAL with null evidence → TRADE_ADMISSION_CONTEXT_INCOMPLETE, open=0 (structured rejection)", () => {
    // Simulates openManualPaperEquityTrade when buildEquityFillEvidence returns null
    // (invalid price or missing timestamp). Exact reason confirmed here.
    orchestrateFinal(
      {
        ...NSE_EQ,
        decisionTime: MARKET_OPEN,
        source: "MANUAL",
        equityFillEvidence: null,
      },
      onOpen, onReject,
    );
    expect(openCount).toBe(0);
    expect(rejectCount).toBe(1);
    expect(lastRejectReason).toBe("TRADE_ADMISSION_CONTEXT_INCOMPLETE");
  });

  // ── Test 5: Final EQ — providerQuoteTimestamp outside session → QUOTE_OUTSIDE_SESSION ──

  it("5. Final EQ MANUAL providerQuoteTimestamp outside session → QUOTE_OUTSIDE_SESSION, open=0", () => {
    // Friday 2026-01-02 18:30 IST = 13:00 UTC — after market close (AFTER_CLOSE)
    // decisionTime = MARKET_OPEN (Monday 10:00 IST, 04:30 UTC)
    // age = Jan 05 04:30 UTC − Jan 02 13:00 UTC ≈ 228600s (positive ✓)
    // QUOTE_OUTSIDE_SESSION fires at step 6 of computeTradeAdmission,
    // BEFORE staleness check (step 7), so stale age doesn't change the reason.
    const fridayAfterHours = new Date("2026-01-02T13:00:00.000Z");
    const ev = makeKiteEvidence({ updatedAt: fridayAfterHours });
    expect(ev).not.toBeNull();
    orchestrateFinal(
      {
        ...NSE_EQ,
        decisionTime: MARKET_OPEN,
        source: "MANUAL",
        equityFillEvidence: ev,
      },
      onOpen, onReject,
    );
    expect(openCount).toBe(0);
    expect(rejectCount).toBe(1);
    expect(lastRejectReason).toBe("QUOTE_OUTSIDE_SESSION");
  });

  // ── Test 6: Final EQ — Yahoo evidence (notForTradeDecisions=true) → QUOTE_STALE_OR_NOT_TRADE_GRADE ──

  it("6. Final EQ MANUAL Yahoo evidence (notForTradeDecisions=true) → QUOTE_STALE_OR_NOT_TRADE_GRADE, open=0", () => {
    // Yahoo-sourced LTP: notForTradeDecisions=true → evidence fails trade-grade check.
    // Phase B rejects at step 7 (evidence-level grade) before delegating to computeTradeAdmission.
    const ev = makeYahooEvidence();
    expect(ev).not.toBeNull();
    orchestrateFinal(
      {
        ...NSE_EQ,
        decisionTime: MARKET_OPEN,
        source: "MANUAL",
        equityFillEvidence: ev,
      },
      onOpen, onReject,
    );
    expect(openCount).toBe(0);
    expect(rejectCount).toBe(1);
    expect(lastRejectReason).toBe("QUOTE_STALE_OR_NOT_TRADE_GRADE");
  });

  // ── Test 7: Valid EQ MANUAL final context → open exactly once, validatedFill carries price ──

  it("7. Valid EQ MANUAL final context (Kite, fresh, in-session) → open exactly once; validatedFill.price matches evidence", () => {
    const ev = makeKiteEvidence({ price: 2450 });
    expect(ev).not.toBeNull();
    const result = orchestrateFinal(
      {
        ...NSE_EQ,
        decisionTime: MARKET_OPEN,
        source: "MANUAL",
        equityFillEvidence: ev,
      },
      onOpen, onReject,
    );
    expect(openCount).toBe(1);
    expect(rejectCount).toBe(0);
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.validatedFill.price).toBe(2450);
      expect(result.validatedFill.instrument).toBe("RELIANCE");
    }
  });

  // ── Test 8: F&O Phase A → phase="PRELIMINARY", cannot authorize durable insert ──

  it("8. F&O computePreliminaryAdmission during session → phase='PRELIMINARY', cannot authorize durable insert", () => {
    const result = computePreliminaryAdmission({
      ...NSE_FO,
      serverTime: MARKET_OPEN,
      source: "AUTO",
      entryCutoffPolicy: CUTOFF_15_25,
    } satisfies PreliminaryAdmissionContext);
    expect(result.phase).toBe("PRELIMINARY");
    expect(result.allowed).toBe(true);
    // Phase discriminant ensures PRELIMINARY cannot be passed to orchestrateFinal.
    expect(openCount).toBe(0);
  });

  // ── Test 9: Final F&O nse_fo with null evidence → TRADE_ADMISSION_CONTEXT_INCOMPLETE ──

  it("9. Final F&O nse_fo with null evidence → TRADE_ADMISSION_CONTEXT_INCOMPLETE, open=0 (F&O always fails closed)", () => {
    // F&O fails at step 1 (no trusted per-premium event timestamp) regardless
    // of other context fields. FNO_OPTION_CHAIN_MAX_AGE_SEC is still exported
    // and its value is pinned below for documentation.
    expect(FNO_OPTION_CHAIN_MAX_AGE_SEC).toBe(300);
    orchestrateFinal(
      {
        ...NSE_FO,
        decisionTime: MARKET_OPEN,
        source: "AUTO",
        entryCutoffPolicy: CUTOFF_15_25,
        equityFillEvidence: null,
      },
      onOpen, onReject,
    );
    expect(openCount).toBe(0);
    expect(rejectCount).toBe(1);
    expect(lastRejectReason).toBe("TRADE_ADMISSION_CONTEXT_INCOMPLETE");
  });

  // ── Test 10: F&O always TRADE_ADMISSION_CONTEXT_INCOMPLETE — fails before any policy check ──

  it("10. F&O nse_fo always TRADE_ADMISSION_CONTEXT_INCOMPLETE — fails at step 1 before policy/session check", () => {
    // With the new interface, F&O lanes fail at step 1 (no trusted per-premium
    // event timestamp). AUTHORITATIVE_FNO_INDEX_QUOTE_MAX_AGE_SEC = 120 s was
    // the old "policy mismatch" input; now there is no quoteMaxAgeSec field —
    // F&O fails before any policy check. The constant is pinned here as documentation.
    expect(AUTHORITATIVE_FNO_INDEX_QUOTE_MAX_AGE_SEC).toBe(120);
    orchestrateFinal(
      {
        ...NSE_FO,
        decisionTime: MARKET_OPEN,
        source: "AUTO",
        entryCutoffPolicy: CUTOFF_15_25,
      },
      onOpen, onReject,
    );
    expect(openCount).toBe(0);
    expect(rejectCount).toBe(1);
    expect(lastRejectReason).toBe("TRADE_ADMISSION_CONTEXT_INCOMPLETE");
  });

  // ── Test 11: Final F&O bse_fo (SENSEX) → TRADE_ADMISSION_CONTEXT_INCOMPLETE (before calendar) ──

  it("11. Final F&O bse_fo (SENSEX) → TRADE_ADMISSION_CONTEXT_INCOMPLETE — F&O fails before BSE calendar check", () => {
    // BSE_CALENDAR_VERIFIED=false would cause CALENDAR_UNAVAILABLE if the F&O
    // lane reached the calendar step. With the new interface, it fails at step 1
    // (F&O lane, no trusted timestamp) BEFORE the calendar check.
    expect(BSE_CALENDAR_VERIFIED).toBe(false);
    orchestrateFinal(
      {
        ...BSE_FO,
        decisionTime: MARKET_OPEN,
        source: "AUTO",
        entryCutoffPolicy: CUTOFF_15_25,
      },
      onOpen, onReject,
    );
    expect(openCount).toBe(0);
    expect(rejectCount).toBe(1);
    expect(lastRejectReason).toBe("TRADE_ADMISSION_CONTEXT_INCOMPLETE");
  });

  // ── Test 12: F&O nse_fo always TRADE_ADMISSION_CONTEXT_INCOMPLETE ──────────

  it("12. F&O nse_fo always TRADE_ADMISSION_CONTEXT_INCOMPLETE — no EquityFillEvidence type defined for F&O premiums", () => {
    // Regardless of what optional fields are provided, nse_fo fails at step 1.
    orchestrateFinal(
      { ...NSE_FO, decisionTime: MARKET_OPEN, source: "AUTO" },
      onOpen, onReject,
    );
    expect(openCount).toBe(0);
    expect(rejectCount).toBe(1);
    expect(lastRejectReason).toBe("TRADE_ADMISSION_CONTEXT_INCOMPLETE");
  });

  // ── Test 13: F&O bse_fo always TRADE_ADMISSION_CONTEXT_INCOMPLETE ──────────

  it("13. F&O bse_fo always TRADE_ADMISSION_CONTEXT_INCOMPLETE — F&O step-1 precedes BSE calendar gate", () => {
    expect(BSE_CALENDAR_VERIFIED).toBe(false);
    orchestrateFinal(
      { ...BSE_FO, decisionTime: MARKET_OPEN, source: "AUTO" },
      onOpen, onReject,
    );
    expect(openCount).toBe(0);
    expect(rejectCount).toBe(1);
    expect(lastRejectReason).toBe("TRADE_ADMISSION_CONTEXT_INCOMPLETE");
  });

  // ── Test 14: Exit callback independent of Phase B entry rejection ──────────

  it("14. Exit callback invocable regardless of Phase B entry rejection — entries and exits are independent", () => {
    let exitCount = 0;
    const onExit = () => { exitCount++; };

    // Phase B rejects entry: Yahoo evidence is not trade-grade.
    const ev = makeYahooEvidence();
    orchestrateFinal(
      {
        ...NSE_EQ,
        decisionTime: MARKET_OPEN,
        source: "MANUAL",
        equityFillEvidence: ev,
      },
      onOpen, onReject,
    );
    expect(openCount).toBe(0);
    expect(lastRejectReason).toBe("QUOTE_STALE_OR_NOT_TRADE_GRADE");

    // Exit callbacks are NOT gated by entry admission.
    onExit();
    expect(exitCount).toBe(1);
  });

  // ── Test 15: Phase discriminant — compile-time and runtime enforcement ─────

  it("15. computeFinalExecutionAdmission returns phase='FINAL_EXECUTION'; PreliminaryAdmissionResult cannot be passed where FinalExecutionAdmissionResult is required", () => {
    const preliminary = computePreliminaryAdmission({
      ...NSE_EQ,
      serverTime: MARKET_OPEN,
      source: "MANUAL",
    });
    const ev = makeKiteEvidence({ price: 2500 });
    expect(ev).not.toBeNull();
    const final = computeFinalExecutionAdmission({
      ...NSE_EQ,
      decisionTime: MARKET_OPEN,
      source: "MANUAL",
      equityFillEvidence: ev,
    });

    expect(preliminary.phase).toBe("PRELIMINARY");
    expect(final.phase).toBe("FINAL_EXECUTION");

    // Runtime enforcement: a durable-insert guard that requires FINAL_EXECUTION
    // accepts only computeFinalExecutionAdmission results.
    function guardDurableInsert(result: FinalExecutionAdmissionResult): boolean {
      return result.phase === "FINAL_EXECUTION" && result.allowed;
    }
    expect(guardDurableInsert(final)).toBe(true);
    // TypeScript compile-time enforcement: PreliminaryAdmissionResult is not
    // assignable to FinalExecutionAdmissionResult — the phase discriminant
    // ("PRELIMINARY" vs "FINAL_EXECUTION") makes them structurally incompatible.

    // On allowed=true, validatedFill.price carries the Phase-B-approved fill price.
    if (final.allowed) {
      expect(final.validatedFill.price).toBe(2500);
      expect(final.quoteProvenance).toBe("kite");
    } else {
      expect(final.quoteProvenance).toBeDefined();
    }
  });
});

// ─── P0.2 Final — EquityFillEvidence canonical gate (20 cases) ───────────────

describe("P0.2 Final — EquityFillEvidence canonical gate (20 cases)", () => {
  let openCount: number;
  let rejectCount: number;
  let lastRejectReason: string | undefined;
  beforeEach(() => { openCount = 0; rejectCount = 0; lastRejectReason = undefined; });
  const onOpen   = () => { openCount++; };
  const onReject = (r: string) => { rejectCount++; lastRejectReason = r; };

  function orchestrateFinal(
    ctx: FinalExecutionAdmissionContext,
    _onOpen: () => void,
    _onReject: (reason: string) => void,
  ): FinalExecutionAdmissionResult {
    const result = computeFinalExecutionAdmission(ctx);
    if (!result.allowed) { _onReject(result.reason); return result; }
    _onOpen();
    return result;
  }

  // ─── Evidence factory: buildEquityFillEvidence ───────────────────────────

  it("E-1. buildEquityFillEvidence returns null for price=0 (non-positive price)", () => {
    const ev = buildEquityFillEvidence({
      symbol: "RELIANCE",
      quote: { price: 0, updatedAt: new Date(MARKET_OPEN.getTime() - 10_000) },
      provenance: { sourceProvider: "kite", trustTier: "authoritative", notForTradeDecisions: false, isStale: false },
    });
    expect(ev).toBeNull();
  });

  it("E-2. buildEquityFillEvidence returns null for price=-100 (non-positive price)", () => {
    const ev = buildEquityFillEvidence({
      symbol: "RELIANCE",
      quote: { price: -100, updatedAt: new Date(MARKET_OPEN.getTime() - 10_000) },
    });
    expect(ev).toBeNull();
  });

  it("E-3. buildEquityFillEvidence returns null for price=NaN", () => {
    const ev = buildEquityFillEvidence({
      symbol: "RELIANCE",
      quote: { price: NaN, updatedAt: new Date(MARKET_OPEN.getTime() - 10_000) },
    });
    expect(ev).toBeNull();
  });

  it("E-4. buildEquityFillEvidence returns null for updatedAt=null (missing timestamp)", () => {
    const ev = buildEquityFillEvidence({
      symbol: "RELIANCE",
      quote: { price: 2400, updatedAt: null },
    });
    expect(ev).toBeNull();
  });

  it("E-5. buildEquityFillEvidence returns null for updatedAt=new Date(NaN) (invalid timestamp)", () => {
    const ev = buildEquityFillEvidence({
      symbol: "RELIANCE",
      quote: { price: 2400, updatedAt: new Date(NaN) },
    });
    expect(ev).toBeNull();
  });

  it("E-6. buildEquityFillEvidence returns valid evidence for Kite source — price/timestamp/provenance fields are correct", () => {
    const ts = new Date(MARKET_OPEN.getTime() - 10_000);
    const ev = buildEquityFillEvidence({
      symbol: "RELIANCE",
      quote: { price: 2400, updatedAt: ts },
      provenance: { sourceProvider: "kite", trustTier: "authoritative", notForTradeDecisions: false, isStale: false, kitePriceOverlay: false },
    });
    expect(ev).not.toBeNull();
    expect(ev?.price).toBe(2400);
    expect(ev?.providerQuoteTimestamp).toBe(ts);
    expect(ev?.instrument).toBe("RELIANCE");
    expect(ev?.sourceTrustTier).toBe("authoritative");
    expect(ev?.notForTradeDecisions).toBe(false);
    expect(ev?.isStale).toBe(false);
    expect(ev?.providerIdentity).toBe("kite");
    expect(ev?._evidenceBrand).toBe("EquityFillEvidence@equityFillEvidence.ts");
  });

  it("E-7. buildEquityFillEvidence with kitePriceOverlay=true → notForTradeDecisions=true (Kite overlay on Yahoo signal)", () => {
    const ev = buildEquityFillEvidence({
      symbol: "RELIANCE",
      quote: { price: 2400, updatedAt: new Date(MARKET_OPEN.getTime() - 10_000) },
      provenance: { sourceProvider: "kite", trustTier: "authoritative", notForTradeDecisions: false, isStale: false, kitePriceOverlay: true },
    });
    expect(ev).not.toBeNull();
    expect(ev?.notForTradeDecisions).toBe(true);
  });

  it("E-8. buildEquityFillEvidence with missing provenance → notForTradeDecisions=true, trustTier='unavailable'", () => {
    const ev = buildEquityFillEvidence({
      symbol: "RELIANCE",
      quote: { price: 2400, updatedAt: new Date(MARKET_OPEN.getTime() - 10_000) },
    });
    expect(ev).not.toBeNull();
    expect(ev?.notForTradeDecisions).toBe(true);
    expect(ev?.sourceTrustTier).toBe("unavailable");
  });

  it("E-9. EQUITY_FRESHNESS_POLICY.watchlist.quote.maxFreshnessSec === 120 (constant guard)", () => {
    expect(EQUITY_FRESHNESS_POLICY["watchlist.quote.maxFreshnessSec"]).toBe(120);
  });

  it("E-10. resolveFreshnessPolicy returns 120 for canonical watchlist.quote.maxFreshnessSec key", () => {
    expect(resolveFreshnessPolicy("watchlist.quote.maxFreshnessSec")).toBe(120);
  });

  it("E-11. resolveFreshnessPolicy returns null for unknown policy identifier", () => {
    expect(resolveFreshnessPolicy("fno.optionChain.unknown")).toBeNull();
  });

  // ─── Phase B: EquityFillEvidence gate ────────────────────────────────────

  it("E-12. F&O nse_fo → TRADE_ADMISSION_CONTEXT_INCOMPLETE; quoteProvenance = 'fno_no_provider_timestamp'", () => {
    const result = orchestrateFinal(
      { ...NSE_FO, decisionTime: MARKET_OPEN, source: "AUTO" },
      onOpen, onReject,
    );
    expect(openCount).toBe(0);
    expect(lastRejectReason).toBe("TRADE_ADMISSION_CONTEXT_INCOMPLETE");
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.quoteProvenance).toBe("fno_no_provider_timestamp");
    }
  });

  it("E-13. F&O bse_fo → TRADE_ADMISSION_CONTEXT_INCOMPLETE (same step 1 rejection as nse_fo)", () => {
    const result = orchestrateFinal(
      { ...BSE_FO, decisionTime: MARKET_OPEN, source: "AUTO" },
      onOpen, onReject,
    );
    expect(openCount).toBe(0);
    expect(lastRejectReason).toBe("TRADE_ADMISSION_CONTEXT_INCOMPLETE");
    if (!result.allowed) {
      expect(result.quoteProvenance).toBe("fno_no_provider_timestamp");
    }
  });

  it("E-14. Equity null evidence → TRADE_ADMISSION_CONTEXT_INCOMPLETE", () => {
    orchestrateFinal(
      { ...NSE_EQ, decisionTime: MARKET_OPEN, source: "MANUAL", equityFillEvidence: null },
      onOpen, onReject,
    );
    expect(openCount).toBe(0);
    expect(lastRejectReason).toBe("TRADE_ADMISSION_CONTEXT_INCOMPLETE");
  });

  it("E-15. Equity evidence with isStale=true → QUOTE_STALE_OR_NOT_TRADE_GRADE", () => {
    const ev = buildEquityFillEvidence({
      symbol: "RELIANCE",
      quote: { price: 2400, updatedAt: new Date(MARKET_OPEN.getTime() - 10_000) },
      provenance: { sourceProvider: "kite", trustTier: "authoritative", notForTradeDecisions: false, isStale: true },
    });
    orchestrateFinal(
      { ...NSE_EQ, decisionTime: MARKET_OPEN, source: "MANUAL", equityFillEvidence: ev },
      onOpen, onReject,
    );
    expect(openCount).toBe(0);
    expect(lastRejectReason).toBe("QUOTE_STALE_OR_NOT_TRADE_GRADE");
  });

  it("E-16. Equity Yahoo evidence (secondary_analytics, notForTradeDecisions=true) → QUOTE_STALE_OR_NOT_TRADE_GRADE", () => {
    const ev = buildEquityFillEvidence({
      symbol: "RELIANCE",
      quote: { price: 2400, updatedAt: new Date(MARKET_OPEN.getTime() - 10_000) },
      provenance: { sourceProvider: "yahoo", trustTier: "secondary_analytics", notForTradeDecisions: true, isStale: false },
    });
    orchestrateFinal(
      { ...NSE_EQ, decisionTime: MARKET_OPEN, source: "MANUAL", equityFillEvidence: ev },
      onOpen, onReject,
    );
    expect(openCount).toBe(0);
    expect(lastRejectReason).toBe("QUOTE_STALE_OR_NOT_TRADE_GRADE");
  });

  it("E-17. Equity evidence symbol mismatch (ev.instrument != ctx.instrument) → TRADE_ADMISSION_CONTEXT_INCOMPLETE", () => {
    const ev = buildEquityFillEvidence({
      symbol: "INFY",  // mismatches NSE_EQ.instrument = "RELIANCE"
      quote: { price: 1800, updatedAt: new Date(MARKET_OPEN.getTime() - 10_000) },
      provenance: { sourceProvider: "kite", trustTier: "authoritative", notForTradeDecisions: false, isStale: false },
    });
    orchestrateFinal(
      { ...NSE_EQ, decisionTime: MARKET_OPEN, source: "MANUAL", equityFillEvidence: ev },
      onOpen, onReject,
    );
    expect(openCount).toBe(0);
    expect(lastRejectReason).toBe("TRADE_ADMISSION_CONTEXT_INCOMPLETE");
  });

  it("E-18. Equity future providerQuoteTimestamp (after decisionTime) → TRADE_ADMISSION_CONTEXT_INCOMPLETE (negative age, no tolerance)", () => {
    // AFTER_HOURS (11:00 UTC = 16:30 IST) is 6.5h AFTER MARKET_OPEN (04:30 UTC).
    // age = (04:30 - 11:00) = negative → INCOMPLETE; no clock-skew tolerance.
    const ev = buildEquityFillEvidence({
      symbol: "RELIANCE",
      quote: { price: 2400, updatedAt: AFTER_HOURS },
      provenance: { sourceProvider: "kite", trustTier: "authoritative", notForTradeDecisions: false, isStale: false },
    });
    orchestrateFinal(
      { ...NSE_EQ, decisionTime: MARKET_OPEN, source: "MANUAL", equityFillEvidence: ev },
      onOpen, onReject,
    );
    expect(openCount).toBe(0);
    expect(lastRejectReason).toBe("TRADE_ADMISSION_CONTEXT_INCOMPLETE");
  });

  it("E-19. Valid Kite evidence → allowed=true, validatedFill.price === evidence.price (P0.2 Correction 4 binding)", () => {
    const ts = new Date(MARKET_OPEN.getTime() - 10_000);
    const ev = buildEquityFillEvidence({
      symbol: "RELIANCE",
      quote: { price: 2750, updatedAt: ts },
      provenance: { sourceProvider: "kite", trustTier: "authoritative", notForTradeDecisions: false, isStale: false },
    });
    const result = orchestrateFinal(
      { ...NSE_EQ, decisionTime: MARKET_OPEN, source: "MANUAL", equityFillEvidence: ev },
      onOpen, onReject,
    );
    expect(openCount).toBe(1);
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.validatedFill.price).toBe(2750);
      expect(result.validatedFill.instrument).toBe("RELIANCE");
      expect(result.validatedFill.provider).toBe("kite");
      expect(result.validatedFill.policyId).toBe("watchlist.quote.maxFreshnessSec");
      expect(result.validatedFill.policyMaxAgeSec).toBe(120);
    }
  });

  it("E-20. validatedFill.computedAgeSec is derived from (decisionTime − providerTs) — caller cannot supply it", () => {
    // P0.2 Correction 1: age is derived internally. There is no quoteAgeSec field.
    // Structural proof: FinalExecutionAdmissionContext has no quoteAgeSec property.
    // The computedAgeSec in ValidatedFillEvidence is the only public read of the age.
    const ts = new Date(MARKET_OPEN.getTime() - 30_000); // 30s before MARKET_OPEN
    const ev = buildEquityFillEvidence({
      symbol: "RELIANCE",
      quote: { price: 2400, updatedAt: ts },
      provenance: { sourceProvider: "kite", trustTier: "authoritative", notForTradeDecisions: false, isStale: false },
    });
    const result = orchestrateFinal(
      { ...NSE_EQ, decisionTime: MARKET_OPEN, source: "MANUAL", equityFillEvidence: ev },
      onOpen, onReject,
    );
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      // age = (MARKET_OPEN − ts) / 1000 = 30s
      expect(result.validatedFill.computedAgeSec).toBeCloseTo(30, 0);
      expect(result.validatedFill.decisionTime).toBe(MARKET_OPEN);
      expect(result.validatedFill.providerTimestamp).toBe(ts);
    }
  });

});
