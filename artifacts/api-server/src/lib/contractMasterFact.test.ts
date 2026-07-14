/**
 * contractMasterFact.test.ts
 *
 * Dedicated unit tests for resolveContractMaster() — covering all resolution
 * paths and proving the safety invariants documented in contractMasterFact.ts.
 *
 * Tests:
 *   GAP 1 — Resolver unit tests (all branches, completeness)
 *   GAP 2 — Runtime signal emission proofs (warm-cache → instrument_master)
 *   GAP 3 — Paper open provenance proofs (getLotSizeSource, fallback labelling)
 *   GAP 4 — Backtest lot-size regime proofs
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  resolveContractMaster,
  type ContractMasterFact,
} from "./contractMasterFact";
import {
  _setFnoInstrumentsCacheForTest,
  clearFnoInstrumentsCache,
  getCachedLotSizeForIndex,
  type FnoInstrument,
} from "./kiteFnoInstruments";
import { LOT_SIZES } from "./optionChain";

// ─────────────────────────────────────────────────────────────────────────────
// Shared test fixtures
// ─────────────────────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<FnoInstrument> & Pick<FnoInstrument, "name" | "tradingsymbol" | "instrument_token" | "expiry" | "strike" | "instrument_type" | "lot_size" | "exchange" | "segment">): FnoInstrument {
  return {
    exchange_token: overrides.instrument_token ?? 0,
    last_price: 0,
    tick_size: 0.05,
    ...overrides,
  };
}

const NIFTY_EXPIRY = "2026-07-24";
const SENSEX_EXPIRY = "2026-07-25";
const BNF_MONTHLY_EXPIRY = "2026-07-30"; // Only monthly for BANKNIFTY in this test scenario

const NIFTY_ROWS: FnoInstrument[] = [
  makeRow({ name: "NIFTY", tradingsymbol: "NIFTY26JUL24000CE", instrument_token: 10001, expiry: NIFTY_EXPIRY, strike: 24000, instrument_type: "CE", lot_size: 65, exchange: "NFO", segment: "NFO-OPT" }),
  makeRow({ name: "NIFTY", tradingsymbol: "NIFTY26JUL24050CE", instrument_token: 10002, expiry: NIFTY_EXPIRY, strike: 24050, instrument_type: "CE", lot_size: 65, exchange: "NFO", segment: "NFO-OPT" }),
  makeRow({ name: "NIFTY", tradingsymbol: "NIFTY26JUL24100CE", instrument_token: 10003, expiry: NIFTY_EXPIRY, strike: 24100, instrument_type: "CE", lot_size: 65, exchange: "NFO", segment: "NFO-OPT" }),
  makeRow({ name: "NIFTY", tradingsymbol: "NIFTY26JUL24000PE", instrument_token: 10101, expiry: NIFTY_EXPIRY, strike: 24000, instrument_type: "PE", lot_size: 65, exchange: "NFO", segment: "NFO-OPT" }),
  makeRow({ name: "NIFTY", tradingsymbol: "NIFTY26JUL24050PE", instrument_token: 10102, expiry: NIFTY_EXPIRY, strike: 24050, instrument_type: "PE", lot_size: 65, exchange: "NFO", segment: "NFO-OPT" }),
];

const SENSEX_ROWS: FnoInstrument[] = [
  makeRow({ name: "SENSEX", tradingsymbol: "SENSEX26JUL80000CE", instrument_token: 20001, expiry: SENSEX_EXPIRY, strike: 80000, instrument_type: "CE", lot_size: 20, exchange: "BFO", segment: "BFO-OPT" }),
  makeRow({ name: "SENSEX", tradingsymbol: "SENSEX26JUL80100CE", instrument_token: 20002, expiry: SENSEX_EXPIRY, strike: 80100, instrument_type: "CE", lot_size: 20, exchange: "BFO", segment: "BFO-OPT" }),
  makeRow({ name: "SENSEX", tradingsymbol: "SENSEX26JUL80000PE", instrument_token: 20101, expiry: SENSEX_EXPIRY, strike: 80000, instrument_type: "PE", lot_size: 20, exchange: "BFO", segment: "BFO-OPT" }),
];

// BANKNIFTY: ONLY monthly expiry — no weekly. This is the "fake-weekly" scenario.
const BNF_ROWS: FnoInstrument[] = [
  makeRow({ name: "BANKNIFTY", tradingsymbol: "BANKNIFTY26JUL52000CE", instrument_token: 30001, expiry: BNF_MONTHLY_EXPIRY, strike: 52000, instrument_type: "CE", lot_size: 30, exchange: "NFO", segment: "NFO-OPT" }),
  makeRow({ name: "BANKNIFTY", tradingsymbol: "BANKNIFTY26JUL52100CE", instrument_token: 30002, expiry: BNF_MONTHLY_EXPIRY, strike: 52100, instrument_type: "CE", lot_size: 30, exchange: "NFO", segment: "NFO-OPT" }),
  makeRow({ name: "BANKNIFTY", tradingsymbol: "BANKNIFTY26JUL52000PE", instrument_token: 30101, expiry: BNF_MONTHLY_EXPIRY, strike: 52000, instrument_type: "PE", lot_size: 30, exchange: "NFO", segment: "NFO-OPT" }),
];

const ALL_ROWS = [...NIFTY_ROWS, ...SENSEX_ROWS, ...BNF_ROWS];

/**
 * Assert that a ContractMasterFact has ALL required fields populated (non-undefined).
 * This is the "output completeness" contract — every field listed in the interface
 * must be present on every returned object.
 */
function assertCompleteness(cmf: ContractMasterFact) {
  const REQUIRED_FIELDS: (keyof ContractMasterFact)[] = [
    "underlying", "exchange", "segment",
    "instrumentToken", "tradingSymbol",
    "expiry", "expirySource", "expiryType",
    "strike", "strikeStep", "strikeStepSource",
    "optionType",
    "lotSize", "lotSizeSource",
    "source", "asOf", "fetchedAt", "freshnessSeconds",
    "isFallback", "fallbackReason", "contractGrade",
  ];
  for (const field of REQUIRED_FIELDS) {
    expect(cmf, `field "${field}" must exist on ContractMasterFact`).toHaveProperty(field);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GAP 1A — NIFTY exact contract match
// ─────────────────────────────────────────────────────────────────────────────

describe("GAP 1A — NIFTY exact contract match (warm cache)", () => {
  beforeEach(() => { _setFnoInstrumentsCacheForTest(ALL_ROWS); });
  afterEach(() => { clearFnoInstrumentsCache(); });

  it("resolves exchange=NFO for NIFTY", () => {
    const cmf = resolveContractMaster("NIFTY", NIFTY_EXPIRY, 24050, "CE", "weekly");
    expect(cmf.exchange).toBe("NFO");
  });

  it("resolves expirySource=instrument_master for exact match", () => {
    const cmf = resolveContractMaster("NIFTY", NIFTY_EXPIRY, 24050, "CE", "weekly");
    expect(cmf.expirySource).toBe("instrument_master");
  });

  it("resolves contractGrade=trade_grade for exact strike match", () => {
    const cmf = resolveContractMaster("NIFTY", NIFTY_EXPIRY, 24050, "CE", "weekly");
    expect(cmf.contractGrade).toBe("trade_grade");
  });

  it("returns the Kite instrumentToken for exact match", () => {
    const cmf = resolveContractMaster("NIFTY", NIFTY_EXPIRY, 24050, "CE", "weekly");
    expect(cmf.instrumentToken).toBe(10002);
  });

  it("returns the Kite tradingSymbol for exact match", () => {
    const cmf = resolveContractMaster("NIFTY", NIFTY_EXPIRY, 24050, "CE", "weekly");
    expect(cmf.tradingSymbol).toBe("NIFTY26JUL24050CE");
  });

  it("resolves lotSize=65 from instrument master (not static map)", () => {
    const cmf = resolveContractMaster("NIFTY", NIFTY_EXPIRY, 24050, "CE", "weekly");
    expect(cmf.lotSize).toBe(65);
    expect(cmf.lotSizeSource).toBe("instrument_master");
  });

  it("resolves strikeStep from master rows (modal gap = 50)", () => {
    const cmf = resolveContractMaster("NIFTY", NIFTY_EXPIRY, 24050, "CE", "weekly");
    expect(cmf.strikeStep).toBe(50);
    expect(cmf.strikeStepSource).toBe("instrument_master");
  });

  it("isFallback=false and fallbackReason=null for exact match", () => {
    const cmf = resolveContractMaster("NIFTY", NIFTY_EXPIRY, 24050, "CE", "weekly");
    expect(cmf.isFallback).toBe(false);
    expect(cmf.fallbackReason).toBeNull();
  });

  it("source=kite_instrument_cache for warm-cache resolution", () => {
    const cmf = resolveContractMaster("NIFTY", NIFTY_EXPIRY, 24050, "CE", "weekly");
    expect(cmf.source).toBe("kite_instrument_cache");
  });

  it("fetchedAt is a non-null ISO string when cache is warm", () => {
    const cmf = resolveContractMaster("NIFTY", NIFTY_EXPIRY, 24050, "CE", "weekly");
    expect(cmf.fetchedAt).not.toBeNull();
    expect(cmf.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("output completeness — all 22 required fields present", () => {
    const cmf = resolveContractMaster("NIFTY", NIFTY_EXPIRY, 24050, "CE", "weekly");
    assertCompleteness(cmf);
  });

  it("expiry matches the algorithmicExpiry (not corrected)", () => {
    const cmf = resolveContractMaster("NIFTY", NIFTY_EXPIRY, 24050, "CE", "weekly");
    expect(cmf.expiry).toBe(NIFTY_EXPIRY);
  });

  it("static fallback NEVER silently overrides master — lotSizeSource=instrument_master even if static agrees", () => {
    const cmf = resolveContractMaster("NIFTY", NIFTY_EXPIRY, 24050, "CE", "weekly");
    // Static map also has NIFTY=65, but source must be instrument_master when cache warm
    expect(cmf.lotSizeSource).toBe("instrument_master");
    expect(LOT_SIZES["NIFTY"]).toBe(65); // confirm static matches — no drift alarm needed here
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 1B — SENSEX exact contract match (BFO exchange path)
// ─────────────────────────────────────────────────────────────────────────────

describe("GAP 1B — SENSEX exact contract match (BFO, warm cache)", () => {
  beforeEach(() => { _setFnoInstrumentsCacheForTest(ALL_ROWS); });
  afterEach(() => { clearFnoInstrumentsCache(); });

  it("SENSEX resolves exchange=BFO (not NFO)", () => {
    const cmf = resolveContractMaster("SENSEX", SENSEX_EXPIRY, 80000, "CE", "weekly");
    expect(cmf.exchange).toBe("BFO");
  });

  it("SENSEX expirySource=instrument_master for exact match", () => {
    const cmf = resolveContractMaster("SENSEX", SENSEX_EXPIRY, 80000, "CE", "weekly");
    expect(cmf.expirySource).toBe("instrument_master");
  });

  it("SENSEX contractGrade=trade_grade for exact strike", () => {
    const cmf = resolveContractMaster("SENSEX", SENSEX_EXPIRY, 80000, "CE", "weekly");
    expect(cmf.contractGrade).toBe("trade_grade");
  });

  it("SENSEX returns Kite instrumentToken", () => {
    const cmf = resolveContractMaster("SENSEX", SENSEX_EXPIRY, 80000, "CE", "weekly");
    expect(cmf.instrumentToken).toBe(20001);
  });

  it("SENSEX returns Kite tradingSymbol", () => {
    const cmf = resolveContractMaster("SENSEX", SENSEX_EXPIRY, 80000, "CE", "weekly");
    expect(cmf.tradingSymbol).toBe("SENSEX26JUL80000CE");
  });

  it("SENSEX lotSize=20 from instrument master", () => {
    const cmf = resolveContractMaster("SENSEX", SENSEX_EXPIRY, 80000, "CE", "weekly");
    expect(cmf.lotSize).toBe(20);
    expect(cmf.lotSizeSource).toBe("instrument_master");
  });

  it("SENSEX segment=BFO-OPT from instrument row", () => {
    const cmf = resolveContractMaster("SENSEX", SENSEX_EXPIRY, 80000, "CE", "weekly");
    expect(cmf.segment).toBe("BFO-OPT");
  });

  it("SENSEX output completeness — all 22 required fields present", () => {
    const cmf = resolveContractMaster("SENSEX", SENSEX_EXPIRY, 80000, "CE", "weekly");
    assertCompleteness(cmf);
  });

  it("SENSEX PE path also resolves BFO correctly", () => {
    const cmf = resolveContractMaster("SENSEX", SENSEX_EXPIRY, 80000, "PE", "weekly");
    expect(cmf.exchange).toBe("BFO");
    expect(cmf.contractGrade).toBe("trade_grade");
    expect(cmf.instrumentToken).toBe(20101);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 1C — BANKNIFTY fake-weekly guard
// ─────────────────────────────────────────────────────────────────────────────

describe("GAP 1C — BANKNIFTY fake-weekly guard", () => {
  beforeEach(() => { _setFnoInstrumentsCacheForTest(ALL_ROWS); });
  afterEach(() => { clearFnoInstrumentsCache(); });

  const FAKE_WEEKLY = "2026-07-09"; // Thursday — would be a weekly if they existed

  it("does not create a fake weekly expiry when master only has monthly", () => {
    const cmf = resolveContractMaster("BANKNIFTY", FAKE_WEEKLY, 52000, "CE", "weekly");
    // The returned expiry must NOT be the fake weekly — it must be the nearest real master expiry
    expect(cmf.expiry).not.toBe(FAKE_WEEKLY);
    expect(cmf.expiry).toBe(BNF_MONTHLY_EXPIRY);
  });

  it("selected expiry exists in the master (not invented)", () => {
    const cmf = resolveContractMaster("BANKNIFTY", FAKE_WEEKLY, 52000, "CE", "weekly");
    // The expiry must be a date that appears in BANKNIFTY rows
    const masterExpiries = new Set(BNF_ROWS.map(r => r.expiry));
    expect(masterExpiries.has(cmf.expiry)).toBe(true);
  });

  it("isFallback=true when algorithmic expiry was corrected", () => {
    const cmf = resolveContractMaster("BANKNIFTY", FAKE_WEEKLY, 52000, "CE", "weekly");
    expect(cmf.isFallback).toBe(true);
  });

  it("fallbackReason explicitly describes the correction", () => {
    const cmf = resolveContractMaster("BANKNIFTY", FAKE_WEEKLY, 52000, "CE", "weekly");
    expect(cmf.fallbackReason).not.toBeNull();
    expect(cmf.fallbackReason).toContain(FAKE_WEEKLY);
    expect(cmf.fallbackReason).toContain(BNF_MONTHLY_EXPIRY);
  });

  it("contractGrade is trade_grade when exact strike matched at corrected expiry", () => {
    const cmf = resolveContractMaster("BANKNIFTY", FAKE_WEEKLY, 52000, "CE", "weekly");
    expect(cmf.contractGrade).toBe("trade_grade");
    expect(cmf.instrumentToken).toBe(30001);
  });

  it("BANKNIFTY exact monthly expiry resolves trade_grade without correction", () => {
    const cmf = resolveContractMaster("BANKNIFTY", BNF_MONTHLY_EXPIRY, 52000, "CE", "monthly");
    expect(cmf.isFallback).toBe(false);
    expect(cmf.fallbackReason).toBeNull();
    expect(cmf.contractGrade).toBe("trade_grade");
    expect(cmf.expiry).toBe(BNF_MONTHLY_EXPIRY);
  });

  it("exchange=NFO for BANKNIFTY (not BFO)", () => {
    const cmf = resolveContractMaster("BANKNIFTY", BNF_MONTHLY_EXPIRY, 52000, "CE", "monthly");
    expect(cmf.exchange).toBe("NFO");
  });

  it("output completeness for BANKNIFTY fake-weekly path", () => {
    const cmf = resolveContractMaster("BANKNIFTY", FAKE_WEEKLY, 52000, "CE", "weekly");
    assertCompleteness(cmf);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 1D — Cold cache / unavailable contract master
// ─────────────────────────────────────────────────────────────────────────────

describe("GAP 1D — Cold cache / unavailable contract master", () => {
  beforeEach(() => { clearFnoInstrumentsCache(); });

  it("contractGrade is fallback (not trade_grade) when cache cold", () => {
    const cmf = resolveContractMaster("NIFTY", "2026-07-24", 24050, "CE", "weekly");
    expect(cmf.contractGrade).toBe("fallback");
    expect(cmf.contractGrade).not.toBe("trade_grade");
    expect(cmf.contractGrade).not.toBe("info_only");
  });

  it("expirySource is unavailable when cache cold", () => {
    const cmf = resolveContractMaster("NIFTY", "2026-07-24", 24050, "CE", "weekly");
    expect(cmf.expirySource).toBe("unavailable");
  });

  it("isFallback=true when cache cold", () => {
    const cmf = resolveContractMaster("NIFTY", "2026-07-24", 24050, "CE", "weekly");
    expect(cmf.isFallback).toBe(true);
  });

  it("fallbackReason is populated and mentions cache cold", () => {
    const cmf = resolveContractMaster("NIFTY", "2026-07-24", 24050, "CE", "weekly");
    expect(cmf.fallbackReason).not.toBeNull();
    expect(cmf.fallbackReason).toContain("cold");
  });

  it("fetchedAt is null when cache cold", () => {
    const cmf = resolveContractMaster("NIFTY", "2026-07-24", 24050, "CE", "weekly");
    expect(cmf.fetchedAt).toBeNull();
  });

  it("instrumentToken is null when cache cold", () => {
    const cmf = resolveContractMaster("NIFTY", "2026-07-24", 24050, "CE", "weekly");
    expect(cmf.instrumentToken).toBeNull();
  });

  it("tradingSymbol is null when cache cold", () => {
    const cmf = resolveContractMaster("NIFTY", "2026-07-24", 24050, "CE", "weekly");
    expect(cmf.tradingSymbol).toBeNull();
  });

  it("static fallback does NOT pretend to be instrument_master (source=static_map)", () => {
    const cmf = resolveContractMaster("NIFTY", "2026-07-24", 24050, "CE", "weekly");
    expect(cmf.source).toBe("static_map");
    expect(cmf.lotSizeSource).toBe("static_fallback");
    expect(cmf.strikeStepSource).toBe("static_map_fallback");
  });

  it("lotSize still uses static map fallback when cold (not zero, not fabricated)", () => {
    const cmf = resolveContractMaster("NIFTY", "2026-07-24", 24050, "CE", "weekly");
    expect(cmf.lotSize).toBe(LOT_SIZES["NIFTY"]);
    expect(cmf.lotSize).toBeGreaterThan(0);
  });

  it("output completeness for cold-cache path", () => {
    const cmf = resolveContractMaster("NIFTY", "2026-07-24", 24050, "CE", "weekly");
    assertCompleteness(cmf);
  });

  it("SENSEX cold-cache also returns fallback (not trade_grade)", () => {
    const cmf = resolveContractMaster("SENSEX", "2026-07-25", 80000, "CE", "weekly");
    expect(cmf.contractGrade).toBe("fallback");
    expect(cmf.exchange).toBe("unknown"); // no master → exchange unknown
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 1E — Static mismatch drift alarm
// ─────────────────────────────────────────────────────────────────────────────

describe("GAP 1E — Static mismatch drift alarm", () => {
  afterEach(() => { clearFnoInstrumentsCache(); });

  it("master lot size wins over static map when they differ", () => {
    // Simulate a master that uses 75 (post-revision) while static still says 65
    const revisedRows: FnoInstrument[] = [
      makeRow({ name: "NIFTY", tradingsymbol: "NIFTY26JUL24050CE", instrument_token: 99, expiry: "2026-07-24", strike: 24050, instrument_type: "CE", lot_size: 75, exchange: "NFO", segment: "NFO-OPT" }),
    ];
    _setFnoInstrumentsCacheForTest(revisedRows);
    const cmf = resolveContractMaster("NIFTY", "2026-07-24", 24050, "CE", "weekly");
    // Master wins — returns 75, not static 65
    expect(cmf.lotSize).toBe(75);
    expect(cmf.lotSizeSource).toBe("instrument_master");
  });

  it("lotSizeSource=instrument_master even when master differs from static", () => {
    const revisedRows: FnoInstrument[] = [
      makeRow({ name: "NIFTY", tradingsymbol: "NIFTY26JUL24050CE", instrument_token: 99, expiry: "2026-07-24", strike: 24050, instrument_type: "CE", lot_size: 75, exchange: "NFO", segment: "NFO-OPT" }),
    ];
    _setFnoInstrumentsCacheForTest(revisedRows);
    const cmf = resolveContractMaster("NIFTY", "2026-07-24", 24050, "CE", "weekly");
    // Even when values differ, master-sourced result must be labelled instrument_master
    expect(cmf.lotSizeSource).toBe("instrument_master");
  });

  it("drift alarm path exists in paperTradingFO.ts — source code confirms LOT_SIZE_DRIFT log", () => {
    // This is a source-level safety regression guard
    const fs = require("node:fs");
    const path = require("node:path");
    const src = fs.readFileSync(path.resolve(__dirname, "paperTradingFO.ts"), "utf8");
    expect(src).toContain("LOT_SIZE_DRIFT");
    expect(src).toContain("masterLotSize !== staticLotSize");
    expect(src).toContain("using master");
  });

  it("drift alarm path — static must never silently override master when cache is warm", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const src = fs.readFileSync(path.resolve(__dirname, "paperTradingFO.ts"), "utf8");
    // getCachedLotSizeForIndex must appear BEFORE LOT_SIZES fallback in lotSizeFor()
    const masterIdx = src.indexOf("getCachedLotSizeForIndex");
    const staticIdx = src.indexOf("LOT_SIZES[sym]");
    expect(masterIdx).toBeGreaterThan(-1);
    expect(staticIdx).toBeGreaterThan(-1);
    expect(masterIdx).toBeLessThan(staticIdx);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 1F — info_only grade (expiry confirmed, strike not listed)
// ─────────────────────────────────────────────────────────────────────────────

describe("GAP 1F — info_only grade (expiry in master but strike not listed)", () => {
  beforeEach(() => { _setFnoInstrumentsCacheForTest(ALL_ROWS); });
  afterEach(() => { clearFnoInstrumentsCache(); });

  it("returns info_only when expiry matches but strike is OTM extreme (not in master)", () => {
    // Strike 30000 is not in our NIFTY fixture rows
    const cmf = resolveContractMaster("NIFTY", NIFTY_EXPIRY, 30000, "CE", "weekly");
    expect(cmf.contractGrade).toBe("info_only");
  });

  it("expirySource=instrument_master even when strike not found", () => {
    const cmf = resolveContractMaster("NIFTY", NIFTY_EXPIRY, 30000, "CE", "weekly");
    expect(cmf.expirySource).toBe("instrument_master");
  });

  it("instrumentToken=null and tradingSymbol=null when strike not in master", () => {
    const cmf = resolveContractMaster("NIFTY", NIFTY_EXPIRY, 30000, "CE", "weekly");
    expect(cmf.instrumentToken).toBeNull();
    expect(cmf.tradingSymbol).toBeNull();
  });

  it("lotSize still from master when expiry matched (not static fallback)", () => {
    const cmf = resolveContractMaster("NIFTY", NIFTY_EXPIRY, 30000, "CE", "weekly");
    expect(cmf.lotSizeSource).toBe("instrument_master");
    expect(cmf.lotSize).toBe(65);
  });

  it("exchange=NFO resolved from expiry rows even without exact strike", () => {
    const cmf = resolveContractMaster("NIFTY", NIFTY_EXPIRY, 30000, "CE", "weekly");
    expect(cmf.exchange).toBe("NFO");
  });

  it("output completeness for info_only path", () => {
    const cmf = resolveContractMaster("NIFTY", NIFTY_EXPIRY, 30000, "CE", "weekly");
    assertCompleteness(cmf);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 2 — Runtime signal emission proofs
// Warm-cache resolveContractMaster output matches what optionSignals.ts
// stamps on the leg (validated by source + output equality).
// ─────────────────────────────────────────────────────────────────────────────

describe("GAP 2 — Runtime signal emission proofs (warm-cache behaviour)", () => {
  beforeEach(() => { _setFnoInstrumentsCacheForTest(ALL_ROWS); });
  afterEach(() => { clearFnoInstrumentsCache(); });

  it("warm-cache resolution → expirySource=instrument_master (not algorithmic fallback)", () => {
    const cmf = resolveContractMaster("NIFTY", NIFTY_EXPIRY, 24050, "CE", "weekly");
    expect(cmf.expirySource).toBe("instrument_master");
    // Safety: it must NOT be the fallback values
    expect(cmf.expirySource).not.toBe("algorithmic_weekday_fallback");
    expect(cmf.expirySource).not.toBe("static_fallback");
    expect(cmf.expirySource).not.toBe("unavailable");
  });

  it("warm-cache resolution → contractInstrumentToken is a positive integer", () => {
    const cmf = resolveContractMaster("NIFTY", NIFTY_EXPIRY, 24050, "CE", "weekly");
    expect(cmf.instrumentToken).not.toBeNull();
    expect(cmf.instrumentToken).toBeGreaterThan(0);
    expect(Number.isInteger(cmf.instrumentToken)).toBe(true);
  });

  it("warm-cache resolution → tradingSymbol is a non-empty string", () => {
    const cmf = resolveContractMaster("NIFTY", NIFTY_EXPIRY, 24050, "CE", "weekly");
    expect(cmf.tradingSymbol).toBeTruthy();
    expect(typeof cmf.tradingSymbol).toBe("string");
  });

  it("SENSEX warm-cache leg carries exchange=BFO (not NFO)", () => {
    const cmf = resolveContractMaster("SENSEX", SENSEX_EXPIRY, 80000, "CE", "weekly");
    expect(cmf.exchange).toBe("BFO");
    expect(cmf.expirySource).toBe("instrument_master");
  });

  it("BANKNIFTY warm-cache with fake-weekly → leg expiry corrected to nearest real (no invented weekly)", () => {
    const cmf = resolveContractMaster("BANKNIFTY", "2026-07-09", 52000, "CE", "weekly");
    expect(cmf.expiry).toBe(BNF_MONTHLY_EXPIRY); // corrected to real monthly
    expect(cmf.expiry).not.toBe("2026-07-09");   // fake weekly NOT used
    expect(cmf.isFallback).toBe(true);
    expect(cmf.fallbackReason).not.toBeNull();
  });

  it("cold-cache signal leg is clearly fallback (not trade_grade)", () => {
    clearFnoInstrumentsCache();
    const cmf = resolveContractMaster("NIFTY", "2026-07-24", 24050, "CE", "weekly");
    expect(cmf.contractGrade).toBe("fallback");
    expect(cmf.expirySource).toBe("unavailable");
    expect(cmf.instrumentToken).toBeNull();
    expect(cmf.tradingSymbol).toBeNull();
    expect(cmf.source).toBe("static_map");
  });

  it("optionSignals.ts source confirms IIFE-based CMF wiring on the leg", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const src = fs.readFileSync(path.resolve(__dirname, "optionSignals.ts"), "utf8");
    // The CMF import and call must be present
    expect(src).toContain("import { resolveContractMaster }");
    expect(src).toContain("resolveContractMaster(c.cfg.symbol");
    // All 4 CMF fields must be wired onto the leg
    expect(src).toContain("expirySource: _cmf.expirySource");
    expect(src).toContain("expiryType: _cmf.expiryType");
    expect(src).toContain("contractInstrumentToken");
    expect(src).toContain("contractGrade: _cmf.contractGrade");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 3 — Paper open contract provenance proofs
// ─────────────────────────────────────────────────────────────────────────────

describe("GAP 3 — Paper open contract provenance", () => {
  afterEach(() => { clearFnoInstrumentsCache(); });

  it("getCachedLotSizeForIndex returns 65 for NIFTY when cache warm", () => {
    _setFnoInstrumentsCacheForTest(NIFTY_ROWS);
    expect(getCachedLotSizeForIndex("NIFTY")).toBe(65);
  });

  it("getCachedLotSizeForIndex returns null (cold) → lotSizeSource would be static_fallback", () => {
    clearFnoInstrumentsCache();
    expect(getCachedLotSizeForIndex("NIFTY")).toBeNull();
  });

  it("NIFTY paper open: warm cache → resolveContractMaster gives trade_grade with token", () => {
    _setFnoInstrumentsCacheForTest(NIFTY_ROWS);
    const cmf = resolveContractMaster("NIFTY", NIFTY_EXPIRY, 24050, "CE", "weekly");
    // Mirrors what paperTradingFO.ts stores in the INSERT
    expect(cmf.lotSizeSource).toBe("instrument_master"); // lot_size_source column
    expect(cmf.instrumentToken).toBe(10002);             // contract_instrument_token column
    expect(cmf.contractGrade).toBe("trade_grade");       // contract_grade column
    expect(cmf.fallbackReason).toBeNull();               // contract_fallback_reason column = NULL
  });

  it("SENSEX paper open: BFO exchange resolved from master (not static)", () => {
    _setFnoInstrumentsCacheForTest(SENSEX_ROWS);
    const cmf = resolveContractMaster("SENSEX", SENSEX_EXPIRY, 80000, "CE", "weekly");
    expect(cmf.lotSize).toBe(20);
    expect(cmf.lotSizeSource).toBe("instrument_master");
    expect(cmf.contractGrade).toBe("trade_grade");
    expect(cmf.exchange).toBe("BFO");
  });

  it("static fallback open: contractGrade NOT trade_grade — cannot silently claim master grade", () => {
    clearFnoInstrumentsCache(); // cold
    const cmf = resolveContractMaster("NIFTY", "2026-07-24", 24050, "CE", "weekly");
    // Static fallback must never claim trade_grade
    expect(cmf.contractGrade).not.toBe("trade_grade");
    expect(cmf.lotSizeSource).toBe("static_fallback");
    expect(cmf.fallbackReason).not.toBeNull();
    expect(cmf.source).toBe("static_map");
  });

  it("paperTradingFO.ts source confirms lot_size_source, contract_grade, contract_fallback_reason are stored in INSERT", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const src = fs.readFileSync(path.resolve(__dirname, "paperTradingFO.ts"), "utf8");
    expect(src).toContain("lotSizeSource: getLotSizeSource(indexSymbol)");
    expect(src).toContain("contractInstrumentToken: signal.leg.contractInstrumentToken");
    expect(src).toContain("contractGrade: signal.leg.contractGrade");
    expect(src).toContain("contractFallbackReason");
    expect(src).toContain("ensureContractMasterSchemaColumns");
  });

  it("paperTradingFO.ts source confirms getLotSizeSource helper exists", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const src = fs.readFileSync(path.resolve(__dirname, "paperTradingFO.ts"), "utf8");
    expect(src).toContain("function getLotSizeSource(");
    expect(src).toContain('"instrument_master"');
    expect(src).toContain('"static_fallback"');
  });

  it("paper_trade_fo schema has the 4 new contract-provenance columns", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const schemaSrc = fs.readFileSync(
      path.resolve(__dirname, "../../../../lib/db/src/schema/paperTrading.ts"),
      "utf8",
    );
    expect(schemaSrc).toContain("lotSizeSource");
    expect(schemaSrc).toContain("contractInstrumentToken");
    expect(schemaSrc).toContain("contractGrade");
    expect(schemaSrc).toContain("contractFallbackReason");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 4 — Backtest lot-size regime annotation proofs
// ─────────────────────────────────────────────────────────────────────────────

describe("GAP 4 — Backtest lot-size regime annotations", () => {
  it("backtest_trades schema has lot_size_source and lot_size_regime columns", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const schemaSrc = fs.readFileSync(
      path.resolve(__dirname, "../../../../lib/db/src/schema/backtest.ts"),
      "utf8",
    );
    expect(schemaSrc).toContain("lotSizeSource");
    expect(schemaSrc).toContain("lotSizeRegime");
  });

  it("BacktestTradeOut interface has lotSizeSource and lotSizeRegime optional fields", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const typesSrc = fs.readFileSync(
      path.resolve(__dirname, "backtest/types.ts"),
      "utf8",
    );
    expect(typesSrc).toContain("lotSizeSource?");
    expect(typesSrc).toContain("lotSizeRegime?");
  });

  it("directional backtest runner stamps lotSizeSource=static_map and lotSizeRegime=2026-JAN-NSE-REVISION", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "backtest/directional.ts"),
      "utf8",
    );
    expect(src).toContain('lotSizeSource: "static_map"');
    expect(src).toContain('lotSizeRegime: "2026-JAN-NSE-REVISION"');
  });

  it("strategies runner also stamps lotSizeSource=static_map and lotSizeRegime", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "backtest/strategies/runner.ts"),
      "utf8",
    );
    expect(src).toContain('lotSizeSource: "static_map"');
    expect(src).toContain('lotSizeRegime: "2026-JAN-NSE-REVISION"');
  });

  it("both trade push sites in directional.ts are annotated (2 occurrences)", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "backtest/directional.ts"),
      "utf8",
    );
    const matches = [...src.matchAll(/lotSizeSource:\s*"static_map"/g)];
    expect(matches.length).toBe(2);
  });

  it("lot_size_regime value matches Jan-2026 NSE circular revision label", () => {
    const EXPECTED_REGIME = "2026-JAN-NSE-REVISION";
    const fs = require("node:fs");
    const path = require("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "backtest/directional.ts"),
      "utf8",
    );
    expect(src).toContain(EXPECTED_REGIME);
    // Confirm it matches the static lot sizes (NIFTY=65, BANKNIFTY=30, SENSEX=20)
    expect(LOT_SIZES["NIFTY"]).toBe(65);
    expect(LOT_SIZES["BANKNIFTY"]).toBe(30);
    expect(LOT_SIZES["SENSEX"]).toBe(20);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 1F-extra — Edge cases and safety invariants
// ─────────────────────────────────────────────────────────────────────────────

describe("Safety invariants — cross-cutting", () => {
  afterEach(() => { clearFnoInstrumentsCache(); });

  it("contractGrade=fallback → instrumentToken MUST be null", () => {
    clearFnoInstrumentsCache();
    const cmf = resolveContractMaster("NIFTY", "2026-07-24", 24050, "CE", "weekly");
    expect(cmf.contractGrade).toBe("fallback");
    expect(cmf.instrumentToken).toBeNull();
  });

  it("contractGrade=trade_grade → instrumentToken MUST be a positive integer", () => {
    _setFnoInstrumentsCacheForTest(NIFTY_ROWS);
    const cmf = resolveContractMaster("NIFTY", NIFTY_EXPIRY, 24050, "CE", "weekly");
    expect(cmf.contractGrade).toBe("trade_grade");
    expect(cmf.instrumentToken).toBeGreaterThan(0);
  });

  it("static fallback never claims instrument_master source", () => {
    clearFnoInstrumentsCache();
    const cmf = resolveContractMaster("NIFTY", "2026-07-24", 24050, "CE", "weekly");
    expect(cmf.source).toBe("static_map");
    expect(cmf.lotSizeSource).toBe("static_fallback");
    expect(cmf.expirySource).toBe("unavailable");
    expect(cmf.contractGrade).toBe("fallback");
  });

  it("underlying is always uppercased in the output", () => {
    _setFnoInstrumentsCacheForTest(NIFTY_ROWS);
    const cmf = resolveContractMaster("nifty", NIFTY_EXPIRY, 24050, "CE", "weekly");
    expect(cmf.underlying).toBe("NIFTY");
  });

  it("lotSize is always positive — never zero or negative", () => {
    clearFnoInstrumentsCache();
    const cmf = resolveContractMaster("NIFTY", "2026-07-24", 24050, "CE", "weekly");
    expect(cmf.lotSize).toBeGreaterThan(0);
  });

  it("freshnessSeconds is null when cache cold, 0 when warm", () => {
    clearFnoInstrumentsCache();
    const cold = resolveContractMaster("NIFTY", "2026-07-24", 24050, "CE", "weekly");
    expect(cold.freshnessSeconds).toBeNull();

    _setFnoInstrumentsCacheForTest(NIFTY_ROWS);
    const warm = resolveContractMaster("NIFTY", NIFTY_EXPIRY, 24050, "CE", "weekly");
    expect(warm.freshnessSeconds).toBe(0);
  });
});
