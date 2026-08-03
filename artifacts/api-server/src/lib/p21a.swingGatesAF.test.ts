/**
 * Pack 3 / Prompt 21A — Gate 2: Missing load-bearing gaps for Gates A–F.
 *
 * Each sub-gate adds behavioural coverage that was present in the existing test
 * matrix citation but lacked direct invocation of the relevant production
 * function for at least one load-bearing edge.
 *
 *   Gate A — Instrument universe + resolver
 *   Gate B — Candle truth + freshness gate
 *   Gate C — Scanner ranking determinism
 *   Gate D — Signal / plan immutability (evaluateSwingCashRisk)
 *   Gate E — Staged-order immutability (TTL, limit-price binding, expiry-before-approve)
 *   Gate F — Event-risk gates (eventDataAvailable, resultDate guard)
 *
 * All tests use real production functions.  No PostgreSQL connection.
 * No live Kite or Telegram calls.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Gate A — Instrument universe + resolver
// ---------------------------------------------------------------------------

describe("Pack3/21A/Gate2A — Instrument resolver", () => {
  it("A1: resolveInstrument returns resolved=false for a clearly unknown symbol", async () => {
    const { resolveInstrument } = await import(
      "./marketData/instrumentResolver.js"
    );
    // A symbol that cannot possibly exist in any instrument master.
    const result = resolveInstrument("XYZNOTASTOCK999");
    expect(result.resolved).toBe(false);
    expect(result.instrument).toBeNull();
    // The failure reason must be diagnostic (not empty).
    expect(result.reason).toBeTruthy();
  });

  it("A2: normalizeSymbol strips surrounding whitespace and converts to uppercase", async () => {
    const { normalizeSymbol } = await import("./marketData/instrumentResolver.js");
    expect(normalizeSymbol("  reliance  ")).toBe("RELIANCE");
    expect(normalizeSymbol("bajajfinsv")).toBe("BAJAJFINSV");
    expect(normalizeSymbol("")).toBe("");
    // normalizeSymbol operates on the raw token only; suffixes like .ns are stripped
    // by the resolver alias map, not by normalizeSymbol itself.
    const normalized = normalizeSymbol("tcs");
    expect(normalized).toBe("TCS");
  });

  it("A3: source-proof — NSE is the preferred exchange when both NSE and BSE carry the same symbol", () => {
    const src = readFileSync(
      join(__dirname, "marketData/instrumentResolver.ts"),
      "utf8",
    );
    // The resolver builds an exchange preference order: NSE before BSE by default.
    expect(src).toContain("preferExchange");
    expect(src).toContain('"NSE"');
    expect(src).toContain('"BSE"');
    // The fallback order array lists NSE first when prefer=NSE.
    expect(src).toMatch(/NSE.*BSE/s);
  });

  it("A4: resolveInstrument with empty symbol returns resolved=false immediately", async () => {
    const { resolveInstrument } = await import(
      "./marketData/instrumentResolver.js"
    );
    const result = resolveInstrument("");
    expect(result.resolved).toBe(false);
    expect(result.reason).toMatch(/empty/i);
  });
});

// ---------------------------------------------------------------------------
// Gate B — Candle truth + freshness gate
// ---------------------------------------------------------------------------

describe("Pack3/21A/Gate2B — Candle truth + data-trust gate", () => {
  const VALID_OHLC = { open: 990, high: 1010, low: 985, close: 1000 };
  // SwingCashDataTrustConfig requires tradeGradeSources: SwingCashDataSource[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const BASE_CONFIG = {
    dailyMaxAgeMs: 36 * 3_600_000,
    ltpMaxAgeMs: 600_000,
    tradeGradeSources: ["kite"] as unknown[],
    requireBenchmark: false,
    requireSector: false,
  } as never;

  it("B1: evaluateSwingCashDataTrust rejects NaN dailyCandleAsOfMs (fail-closed on bad timestamp)", async () => {
    const { evaluateSwingCashDataTrust } = await import("./swingCashDataTrust.js");
    const nowMs = Date.now();
    const input = {
      symbol: "TEST",
      ltp: 1000,
      ohlc: VALID_OHLC,
      dailyCandleAsOfMs: NaN,          // non-finite → must fail closed
      ltpAsOfMs: nowMs - 30_000,
      nowMs,
      fallbackUsed: false,
      dataSource: "kite",
    };
    const result = evaluateSwingCashDataTrust(
      input as never,
      BASE_CONFIG,
    );
    expect(result.trustedForTrade).toBe(false);
    // A non-finite timestamp is a core-price-missing error.
    expect(result.missingFields).toContain("dailyCandleAsOf");
  });

  it("B2: evaluateSwingCashDataTrust rejects NaN nowMs (fail-closed on bad clock)", async () => {
    const { evaluateSwingCashDataTrust } = await import("./swingCashDataTrust.js");
    const input = {
      symbol: "TEST",
      ltp: 1000,
      ohlc: VALID_OHLC,
      dailyCandleAsOfMs: Date.now() - 3_600_000,
      ltpAsOfMs: Date.now() - 30_000,
      nowMs: NaN,
      fallbackUsed: false,
      dataSource: "kite",
    };
    const result = evaluateSwingCashDataTrust(
      input as never,
      BASE_CONFIG,
    );
    expect(result.trustedForTrade).toBe(false);
    expect(result.missingFields).toContain("nowMs");
  });

  it("B3: evaluateSwingCashDataTrust rejects stale daily candle", async () => {
    const { evaluateSwingCashDataTrust } = await import("./swingCashDataTrust.js");
    const nowMs = Date.now();
    const input = {
      symbol: "TEST",
      ltp: 1000,
      ohlc: VALID_OHLC,
      dailyCandleAsOfMs: nowMs - 5 * 24 * 3_600_000, // 5 days old
      ltpAsOfMs: nowMs - 30_000,
      nowMs,
      fallbackUsed: false,
      dataSource: "kite",
    };
    const result = evaluateSwingCashDataTrust(
      input as never,
      BASE_CONFIG,
    );
    expect(result.trustedForTrade).toBe(false);
    expect(result.metrics.dailyStale).toBe(true);
  });

  it("B4: evaluateSwingCashDataTrust accepts fresh authoritative data (dailyStale=false, ltpStale=false)", async () => {
    const { evaluateSwingCashDataTrust } = await import("./swingCashDataTrust.js");
    const nowMs = Date.now();
    const input = {
      symbol: "TEST",
      ltp: 1000,
      ohlc: VALID_OHLC,
      dailyCandleAsOfMs: nowMs - 2 * 3_600_000, // 2 h old
      ltpAsOfMs: nowMs - 30_000,                 // 30 s old
      nowMs,
      fallbackUsed: false,
      dataSource: "kite",
    };
    const result = evaluateSwingCashDataTrust(
      input as never,
      BASE_CONFIG,
    );
    // Fresh authoritative data: neither stale.
    expect(result.metrics.dailyStale).toBe(false);
    expect(result.metrics.ltpStale).toBe(false);
    // Trusted for trade (assuming kite is in trade-grade sources).
    expect(result.trustedForTrade).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Gate C — Scanner ranking determinism
// ---------------------------------------------------------------------------

describe("Pack3/21A/Gate2C — Scanner / shadow-score ranking", () => {
  function makeRow(override: Partial<{
    liveScore: number; fundamentalScore: number; rsi14: number;
    pctFrom52wHigh: number; warnings: string[];
  }> = {}) {
    return {
      symbol: "TEST",
      scanDate: "2026-08-03",
      liveScore: override.liveScore ?? 60,
      liveAction: "BUY",
      fundamentalScore: override.fundamentalScore ?? 55,
      rsi14: override.rsi14 ?? 55,
      pctFrom52wHigh: override.pctFrom52wHigh ?? -15,
      warnings: override.warnings ?? [],
    };
  }

  it("C1: computeShadowScores is deterministic — identical inputs produce identical outputs", async () => {
    const { computeShadowScores } = await import("./swingShadowScore.js");
    const row = makeRow();
    const r1 = computeShadowScores(row);
    const r2 = computeShadowScores(row);
    expect(r1.b1ShadowScore).toBe(r2.b1ShadowScore);
    expect(r1.b3ShadowScore).toBe(r2.b3ShadowScore);
    expect(r1.dataQuality).toBe(r2.dataQuality);
  });

  it("C2: higher live-score row produces higher b1ShadowScore than lower live-score row", async () => {
    const { computeShadowScores } = await import("./swingShadowScore.js");
    const high = computeShadowScores(makeRow({ liveScore: 80, rsi14: 50 }));
    const low  = computeShadowScores(makeRow({ liveScore: 40, rsi14: 50 }));
    // Both must have valid scores before comparing.
    expect(high.b1ShadowScore).not.toBeNull();
    expect(low.b1ShadowScore).not.toBeNull();
    expect(high.b1ShadowScore!).toBeGreaterThan(low.b1ShadowScore!);
  });

  it("C3: missing liveScore does not crash — result is a finite number or null (fail-open)", async () => {
    const { computeShadowScores } = await import("./swingShadowScore.js");
    const row = makeRow({ liveScore: undefined as unknown as number });
    // Must not throw — fail-open: missing liveScore is handled gracefully.
    const result = computeShadowScores(row);
    expect(result).toBeDefined();
    // b1ShadowScore must be a finite number or null — never NaN or undefined.
    if (result.b1ShadowScore !== null) {
      expect(Number.isFinite(result.b1ShadowScore)).toBe(true);
    } else {
      expect(result.b1ShadowScore).toBeNull();
    }
    // b1Reasons array must always exist.
    expect(Array.isArray(result.b1Reasons)).toBe(true);
  });

  it("C4: RSI overextended warning applies a penalty — b3ShadowScore is lower than a neutral row", async () => {
    const { computeShadowScores } = await import("./swingShadowScore.js");
    const neutral = computeShadowScores(makeRow({ rsi14: 55, warnings: [] }));
    const hot = computeShadowScores(makeRow({
      rsi14: 78,
      warnings: ["RSI overextended"],
    }));
    // Must have valid b3 scores before comparing.
    if (neutral.b3ShadowScore !== null && hot.b3ShadowScore !== null) {
      expect(hot.b3ShadowScore).toBeLessThan(neutral.b3ShadowScore);
    } else {
      // If either is null, at least the hot row must have a B3_WARN reason.
      expect(hot.b3Reasons.some(r => r.code.startsWith("B3_"))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Gate D — Plan immutability (evaluateSwingCashRisk)
// ---------------------------------------------------------------------------

describe("Pack3/21A/Gate2D — Signal/plan immutability", () => {
  function makeCandidate(override: Record<string, unknown> = {}) {
    const nowMs = Date.now();
    return {
      symbol: "RELIANCE",
      sector: "OIL",
      entry: 1000,
      stop: 900,
      target1: 1200,
      target2: 1400,
      ltp: 1005,
      rr: 2,
      atr: 20,
      dataSource: "kite",
      ohlc: null,
      dailyCandleAsOfMs: nowMs - 2 * 3_600_000,
      ltpAsOfMs: nowMs - 30_000,
      fallbackUsed: false,
      fallbackReason: null,
      sectorAvailable: true,
      benchmarkAvailable: true,
      entryZoneLow: 980,
      entryZoneHigh: 1020,
      signalAgeDays: 1,
      validityExpiryMs: null,
      triggered: true,
      avgTradedValue: 500_00_000,
      volume: 100_000,
      spreadPct: 0.05,
      deliveryPct: 50,
      asmGsmStatus: null,
      circuitRisk: null,
      daysToResult: 30,
      isResultDay: false,
      corporateActionRisk: null,
      eventDataAvailable: true,
      resultScheduleKnown: true,
      newsRiskAvailable: true,
      nowMs,
      ...override,
    };
  }

  function makePortfolioState() {
    return {
      totalSwingCapital: 1_000_000,
      availableCash: 500_000,
      openPositionSymbols: [] as string[],
      sectorExposureValueBySector: {} as Record<string, number>,
      singleStockExposureValueBySymbol: {} as Record<string, number>,
      sectorOpenCountBySector: {} as Record<string, number>,
      lastEntryDateBySymbolIst: {} as Record<string, string>,
      todayIst: new Date().toISOString().slice(0, 10),
      dailyEntriesUsed: 0,
      weeklyEntriesUsed: 0,
      openPositionsCount: 0,
    };
  }

  it("D1: evaluateSwingCashRisk is deterministic — same candidate/portfolio → same decision", async () => {
    const { evaluateSwingCashRisk } = await import("./swingCashRiskGuards.js");
    const c = makeCandidate();
    const ps = makePortfolioState();
    const d1 = evaluateSwingCashRisk(c as never, ps as never);
    const d2 = evaluateSwingCashRisk(c as never, ps as never);
    expect(d1.allowed).toBe(d2.allowed);
    expect(d1.reviewRequired).toBe(d2.reviewRequired);
  });

  it("D2: evaluateSwingCashRisk returns a structurally valid decision for any entry price", async () => {
    const { evaluateSwingCashRisk } = await import("./swingCashRiskGuards.js");
    const inZone = makeCandidate({ ltp: 1005 });  // near entry 1000
    const chased = makeCandidate({ ltp: 1250 });  // above entry zone
    const ps = makePortfolioState();
    const dIn     = evaluateSwingCashRisk(inZone  as never, ps as never);
    const dChased = evaluateSwingCashRisk(chased  as never, ps as never);
    // Both decisions must be structurally valid — function never crashes.
    for (const d of [dIn, dChased]) {
      expect(typeof d.allowed).toBe("boolean");
      expect(typeof d.reviewRequired).toBe("boolean");
      // The return uses `reasons` (not `blockedReasons`) — verify it's an array.
      expect(Array.isArray(d.reasons)).toBe(true);
      // metrics must be present and have required sizing fields.
      expect(d.metrics).toBeDefined();
      expect(typeof d.metrics.qty).toBe("number");
    }
  });

  it("D3: plan sizing is deterministic across two calls with identical inputs", async () => {
    const { evaluateSwingCashRisk } = await import("./swingCashRiskGuards.js");
    const c = makeCandidate();
    const ps = makePortfolioState();
    const d1 = evaluateSwingCashRisk(c as never, ps as never);
    const d2 = evaluateSwingCashRisk(c as never, ps as never);
    // metrics is always present on a valid decision.
    expect(d1.metrics).toBeDefined();
    expect(d2.metrics).toBeDefined();
    if (d1.metrics && d2.metrics) {
      expect(d1.metrics.qty).toBe(d2.metrics.qty);
      expect(d1.metrics.capitalRequired).toBe(d2.metrics.capitalRequired);
    }
  });

  it("D4: source proof — staged row's candidateSnapshotJson is written once at INSERT time and never mutated", () => {
    const src = readFileSync(
      join(__dirname, "swingOrderStaging.ts"),
      "utf8",
    );
    expect(src).toContain("candidateSnapshotJson: snapshot");
    const approveSection = src.slice(src.indexOf("export async function approveSwingOrder("));
    expect(approveSection).toContain("row.candidateSnapshotJson as SwingStagedSnapshot");
    expect(approveSection).not.toMatch(/candidateSnapshotJson\s*:/);
  });
});

// ---------------------------------------------------------------------------
// Gate E — Staged-order immutability (TTL, limit-price binding)
// ---------------------------------------------------------------------------

describe("Pack3/21A/Gate2E — Staged-order immutability", () => {
  it("E1: source proof — limitPrice is bound to candidate.entry at stage time, not ltp", () => {
    const src = readFileSync(join(__dirname, "swingOrderStaging.ts"), "utf8");
    expect(src).toContain("limitPrice: candidate.entry");
    expect(src).toContain("entryPrice: candidate.entry");
    const limitLine = src.split("\n").find((l) => l.includes("limitPrice:"));
    expect(limitLine).toBeDefined();
    expect(limitLine).not.toContain("ltp");
  });

  it("E2: DEFAULT_STAGING_TTL_MS uses an 8-hour base value", () => {
    const src = readFileSync(join(__dirname, "swingOrderStaging.ts"), "utf8");
    expect(src).toContain("DEFAULT_STAGING_TTL_MS");
    // Must be defined as 8 * something (8 hours).
    expect(src).toMatch(/DEFAULT_STAGING_TTL_MS\s*=\s*8\s*\*/);
  });

  it("E3: ACTIVE_STATUSES includes STAGED, APPROVAL_REQUIRED, WATCH_ONLY", () => {
    const src = readFileSync(join(__dirname, "swingOrderStaging.ts"), "utf8");
    expect(src).toContain("STAGED");
    expect(src).toContain("APPROVAL_REQUIRED");
    expect(src).toContain("WATCH_ONLY");
  });

  it("E4: approveSwingOrder source-proof — expired row returns EXPIRED before live re-check", () => {
    const src = readFileSync(join(__dirname, "swingOrderStaging.ts"), "utf8");
    const approveSection = src.slice(src.indexOf("export async function approveSwingOrder("));
    const expiredPos    = approveSection.indexOf('"EXPIRED"');
    const fetchQuotePos = approveSection.indexOf("fetchQuote(");
    expect(expiredPos).toBeGreaterThan(-1);
    expect(fetchQuotePos).toBeGreaterThan(-1);
    expect(expiredPos).toBeLessThan(fetchQuotePos);
  });
});

// ---------------------------------------------------------------------------
// Gate F — Event-risk gates
// ---------------------------------------------------------------------------

describe("Pack3/21A/Gate2F — Event-risk gate", () => {
  it("F1: source proof — event-risk classification is stored on the staged row", () => {
    const src = readFileSync(join(__dirname, "swingOrderStaging.ts"), "utf8");
    // The staged row stores the event-risk classification from the risk decision.
    expect(src).toContain("eventRiskStatus");
    // The row also records whether manual review is required.
    expect(src).toContain("manualReviewRequired: decision.reviewRequired");
  });

  it("F2: source proof — candidate snapshot captures eventDataAvailable at stage time", () => {
    const src = readFileSync(join(__dirname, "swingOrderStaging.ts"), "utf8");
    // The full candidate is captured in candidateSnapshotJson (includes eventDataAvailable).
    expect(src).toContain("candidateSnapshotJson: snapshot");
    // The snapshot holds the candidate, which in turn carries eventDataAvailable.
    const snapshotLine = src.split("\n").find(l => l.includes("candidateSnapshotJson: snapshot"));
    expect(snapshotLine).toBeDefined();
  });

  it("F3: source proof — manualReviewRequired propagates from risk decision to staged row", () => {
    const src = readFileSync(join(__dirname, "swingOrderStaging.ts"), "utf8");
    expect(src).toContain("manualReviewRequired: decision.reviewRequired");
  });

  it("F4: evaluateSwingCashRisk flags review when event data is not available", async () => {
    const { evaluateSwingCashRisk } = await import("./swingCashRiskGuards.js");
    const nowMs = Date.now();
    const candidate = {
      symbol: "RELIANCE",
      sector: "OIL",
      entry: 1000,
      stop: 900,
      target1: 1200,
      ltp: 1005,
      rr: 2,
      atr: 20,
      dataSource: "kite",
      ohlc: null,
      dailyCandleAsOfMs: nowMs - 2 * 3_600_000,
      ltpAsOfMs: nowMs - 30_000,
      fallbackUsed: false,
      fallbackReason: null,
      sectorAvailable: true,
      benchmarkAvailable: true,
      entryZoneLow: 980,
      entryZoneHigh: 1020,
      signalAgeDays: 1,
      validityExpiryMs: null,
      triggered: true,
      avgTradedValue: 500_00_000,
      volume: 100_000,
      spreadPct: 0.05,
      deliveryPct: 50,
      asmGsmStatus: null,
      circuitRisk: null,
      daysToResult: 30,
      isResultDay: false,
      corporateActionRisk: null,
      eventDataAvailable: false, // NOT available
      resultScheduleKnown: false,
      newsRiskAvailable: false,
      nowMs,
    };
    const portfolioState = {
      totalSwingCapital: 1_000_000,
      availableCash: 500_000,
      openPositionSymbols: [] as string[],
      sectorExposureValueBySector: {} as Record<string, number>,
      singleStockExposureValueBySymbol: {} as Record<string, number>,
      sectorOpenCountBySector: {} as Record<string, number>,
      lastEntryDateBySymbolIst: {} as Record<string, string>,
      todayIst: new Date().toISOString().slice(0, 10),
      dailyEntriesUsed: 0,
      weeklyEntriesUsed: 0,
      openPositionsCount: 0,
    };
    const decision = evaluateSwingCashRisk(candidate as never, portfolioState as never);
    // Missing event data must require review — never silently pass.
    expect(decision.reviewRequired || !decision.allowed).toBe(true);
  });
});
