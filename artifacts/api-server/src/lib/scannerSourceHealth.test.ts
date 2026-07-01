import { describe, it, expect } from "vitest";
import {
  toScannerRowSource,
  buildScannerSourceHealth,
} from "./scannerSourceHealth";
import {
  buildSourceProvenance,
  shouldDemoteSignal,
} from "./scannerProvenance";

const NOW = Date.UTC(2026, 5, 10, 6, 0, 0); // 2026-06-10T06:00:00Z
const nowSec = Math.floor(NOW / 1000);

// ── helpers ──────────────────────────────────────────────────────────────────

function kiteProvFresh() {
  return buildSourceProvenance({
    provider: "kite",
    asOfSec: nowSec - 60,
    tf: "15m",
    now: NOW,
  });
}

function kiteProvEod() {
  return buildSourceProvenance({
    provider: "kite",
    asOfSec: nowSec - 3600,
    tf: "1D",
    now: NOW,
  });
}

function kiteProvStale() {
  return buildSourceProvenance({
    provider: "kite",
    asOfSec: nowSec - 5000, // > 2700s budget for 15m
    tf: "15m",
    now: NOW,
  });
}

function yahooProvFresh() {
  return buildSourceProvenance({
    provider: "yahoo",
    asOfSec: nowSec - 60,
    tf: "15m",
    now: NOW,
  });
}

function yahooProvStale() {
  return buildSourceProvenance({
    provider: "yahoo",
    asOfSec: nowSec - 5000,
    tf: "15m",
    now: NOW,
  });
}

function nullProv() {
  return buildSourceProvenance({
    provider: null,
    asOfSec: null,
    tf: "1D",
    now: NOW,
    missingReason: "Feed unavailable",
  });
}

/**
 * Phase A: Yahoo signal source + Kite batch price overlay.
 * Indicators remain Yahoo; price/OHLC/volume comes from Kite REST batch quote.
 */
function yahooWithKiteOverlayProv() {
  return buildSourceProvenance({
    provider: "yahoo",
    asOfSec: nowSec - 30, // Kite batch quote ts (fresh)
    tf: "15m",
    now: NOW,
    kitePriceOverlay: true,
    warnings: [
      "Kite batch quote used for price/OHLC/volume. Scanner indicators still use Yahoo daily candles — info-only until Kite candle warehouse is active (Phase B).",
    ],
  });
}

function makeRow(prov: ReturnType<typeof buildSourceProvenance> | null | undefined) {
  return { symbol: "TEST", provenance: prov };
}

// ── Part D: toScannerRowSource ────────────────────────────────────────────────

describe("toScannerRowSource — row-level source contract (Part D)", () => {
  it("[Test 1] Kite fresh intraday → TRADE_GRADE, source=kite, canDriveSignals=true", () => {
    const rs = toScannerRowSource(kiteProvFresh(), "RELIANCE");
    expect(rs.source).toBe("kite");
    expect(rs.sourceStatus).toBe("TRADE_GRADE");
    expect(rs.canDriveSignals).toBe(true);
    expect(rs.canDriveTradeAlerts).toBe(true);
    expect(rs.symbol).toBe("RELIANCE");
  });

  it("[Test 2] Kite EOD bar → DELAYED, source=kite, canDriveSignals=false", () => {
    const rs = toScannerRowSource(kiteProvEod(), "INFY");
    expect(rs.source).toBe("kite");
    expect(rs.sourceStatus).toBe("DELAYED");
    expect(rs.canDriveSignals).toBe(false);
    expect(rs.canDriveTradeAlerts).toBe(false);
  });

  it("[Test 3] Kite stale → STALE, source=kite, canDriveSignals=false", () => {
    const rs = toScannerRowSource(kiteProvStale(), "TCS");
    expect(rs.source).toBe("kite");
    expect(rs.sourceStatus).toBe("STALE");
    expect(rs.canDriveSignals).toBe(false);
    expect(rs.canDriveTradeAlerts).toBe(false);
  });

  it("[Test 4] Yahoo fresh → INFO_ONLY, source=yahoo, canDriveSignals=false", () => {
    const rs = toScannerRowSource(yahooProvFresh(), "HDFCBANK");
    expect(rs.source).toBe("yahoo");
    expect(rs.sourceStatus).toBe("INFO_ONLY");
    expect(rs.canDriveSignals).toBe(false);
    expect(rs.canDriveTradeAlerts).toBe(false);
  });

  it("[Test 5] Yahoo stale → STALE, source=yahoo, canDriveSignals=false", () => {
    const rs = toScannerRowSource(yahooProvStale(), "ICICIBANK");
    expect(rs.source).toBe("yahoo");
    expect(rs.sourceStatus).toBe("STALE");
    expect(rs.canDriveSignals).toBe(false);
  });

  it("[Test 6] Provider null (unavailable) → NO_FEED, source=none, canDriveSignals=false", () => {
    const rs = toScannerRowSource(nullProv(), "WIPRO");
    expect(rs.source).toBe("none");
    expect(rs.sourceStatus).toBe("NO_FEED");
    expect(rs.canDriveSignals).toBe(false);
    expect(rs.canDriveTradeAlerts).toBe(false);
  });

  it("[Test 7] No provenance (undefined) → NO_FEED, source=none", () => {
    const rs = toScannerRowSource(undefined, "AXISBANK");
    expect(rs.source).toBe("none");
    expect(rs.sourceStatus).toBe("NO_FEED");
    expect(rs.canDriveSignals).toBe(false);
  });

  it("[Test 8] asOf is an ISO string (not epoch seconds)", () => {
    const prov = kiteProvFresh();
    const rs = toScannerRowSource(prov, "SBIN");
    expect(rs.asOf).not.toBeNull();
    // Must be a valid ISO 8601 string
    expect(rs.asOf).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    // Must NOT be an integer epoch seconds value rendered as a string
    expect(Number.isInteger(Number(rs.asOf))).toBe(false);
    // Round-trip: parsed ISO should reproduce the original asOfSec (within 1s)
    const parsedSec = Math.floor(new Date(rs.asOf!).getTime() / 1000);
    expect(Math.abs(parsedSec - (nowSec - 60))).toBeLessThanOrEqual(1);
  });

  it("[Test 9] Warning is forwarded from provenance.warnings[0]", () => {
    const prov = buildSourceProvenance({
      provider: "yahoo",
      asOfSec: nowSec - 60,
      tf: "15m",
      now: NOW,
      warnings: ["Live price from Kite; swing indicators from Yahoo daily candles."],
    });
    const rs = toScannerRowSource(prov, "KOTAK");
    expect(rs.warning).toBe("Live price from Kite; swing indicators from Yahoo daily candles.");
  });
});

// ── Part C: buildScannerSourceHealth ─────────────────────────────────────────

describe("buildScannerSourceHealth — scan-level aggregate (Part C)", () => {
  it("[Test 10] Empty rows → NO_FEED, tradeGrade=false, canDriveSignals=false", () => {
    const h = buildScannerSourceHealth([]);
    expect(h.sourceStatus).toBe("NO_FEED");
    expect(h.tradeGrade).toBe(false);
    expect(h.canDriveSignals).toBe(false);
    expect(h.rowCounts.total).toBe(0);
    expect(h.warning).toMatch(/no scanner rows/i);
  });

  it("[Test 11] All Kite trade-grade rows → KITE_TRADE_GRADE, tradeGrade=true", () => {
    const rows = [
      makeRow(kiteProvFresh()),
      makeRow(kiteProvFresh()),
      makeRow(kiteProvFresh()),
    ];
    const h = buildScannerSourceHealth(rows, { marketSession: "open" });
    expect(h.sourceStatus).toBe("KITE_TRADE_GRADE");
    expect(h.tradeGrade).toBe(true);
    expect(h.canDriveSignals).toBe(true);
    expect(h.rowCounts.kiteLive).toBe(3);
    expect(h.rowCounts.total).toBe(3);
    expect(h.marketSession).toBe("open");
    expect(h.warning).toBeNull();
  });

  it("[Test 12] All Yahoo rows → YAHOO_INFO_ONLY, tradeGrade=false", () => {
    const rows = [
      makeRow(yahooProvFresh()),
      makeRow(yahooProvFresh()),
    ];
    const h = buildScannerSourceHealth(rows, { marketSession: "closed" });
    expect(h.sourceStatus).toBe("YAHOO_INFO_ONLY");
    expect(h.tradeGrade).toBe(false);
    expect(h.canDriveSignals).toBe(false);
    expect(h.rowCounts.yahooDelayed).toBe(2);
    expect(h.action).toBe("/kite");
    expect(h.warning).toMatch(/yahoo/i);
  });

  it("[Test 13] Mixed Kite+Yahoo rows → MIXED_SOURCES", () => {
    const rows = [
      makeRow(kiteProvFresh()),
      makeRow(yahooProvFresh()),
      makeRow(yahooProvFresh()),
    ];
    const h = buildScannerSourceHealth(rows);
    expect(h.sourceStatus).toBe("MIXED_SOURCES");
    expect(h.tradeGrade).toBe(false);
    expect(h.rowCounts.kiteLive).toBe(1);
    expect(h.rowCounts.yahooDelayed).toBe(2);
    expect(h.warning).toMatch(/mixed sources/i);
  });

  it("[Test 14] Kite rows with some stale/noFeed → KITE_PARTIAL", () => {
    const rows = [
      makeRow(kiteProvFresh()),
      makeRow(kiteProvFresh()),
      makeRow(kiteProvStale()),
      makeRow(nullProv()),
    ];
    const h = buildScannerSourceHealth(rows);
    expect(h.sourceStatus).toBe("KITE_PARTIAL");
    expect(h.tradeGrade).toBe(false);
    expect(h.rowCounts.kiteLive).toBe(2);
    expect(h.rowCounts.kiteStale).toBe(1);
    expect(h.rowCounts.noFeed).toBe(1);
  });

  it("[Test 15] All Kite rows but stale → STALE_CACHE", () => {
    const rows = [
      makeRow(kiteProvStale()),
      makeRow(kiteProvStale()),
    ];
    const h = buildScannerSourceHealth(rows);
    expect(h.sourceStatus).toBe("STALE_CACHE");
    expect(h.tradeGrade).toBe(false);
    expect(h.rowCounts.kiteStale).toBe(2);
    expect(h.warning).toMatch(/stale/i);
  });

  it("[Test 16] rowCounts reflect correct per-bucket counts", () => {
    const rows = [
      makeRow(kiteProvFresh()),
      makeRow(kiteProvStale()),
      makeRow(yahooProvFresh()),
      makeRow(yahooProvStale()),
      makeRow(nullProv()),
    ];
    const h = buildScannerSourceHealth(rows);
    expect(h.rowCounts.total).toBe(5);
    expect(h.rowCounts.kiteLive).toBe(1);
    expect(h.rowCounts.kiteStale).toBe(1);
    expect(h.rowCounts.yahooDelayed).toBe(1);
    expect(h.rowCounts.yahooStale).toBe(1);
    expect(h.rowCounts.noFeed).toBe(1);
    expect(h.rowCounts.cache).toBe(0);
  });

  it("[Test 17] oldestAsOf and newestAsOf are ISO strings (not epoch seconds)", () => {
    const older = buildSourceProvenance({
      provider: "kite", asOfSec: nowSec - 300, tf: "15m", now: NOW,
    });
    const newer = buildSourceProvenance({
      provider: "kite", asOfSec: nowSec - 60, tf: "15m", now: NOW,
    });
    const rows = [makeRow(older), makeRow(newer)];
    const h = buildScannerSourceHealth(rows);
    expect(h.oldestAsOf).not.toBeNull();
    expect(h.newestAsOf).not.toBeNull();
    expect(h.oldestAsOf).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(h.newestAsOf).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // oldest < newest
    expect(new Date(h.oldestAsOf!).getTime()).toBeLessThan(
      new Date(h.newestAsOf!).getTime(),
    );
  });
});

// ── F&O / swing consumer safety ──────────────────────────────────────────────

describe("F&O / swing consumer safety — signal demotion gates", () => {
  it("[Test 18] Yahoo-provenance rows are always demoted (canDriveSignals=false) AND shouldDemoteSignal=true", () => {
    const yahooFresh = yahooProvFresh();
    // Part D: canDriveSignals must be false for any Yahoo row
    const rs = toScannerRowSource(yahooFresh, "NIFTY");
    expect(rs.canDriveSignals).toBe(false);
    expect(rs.canDriveTradeAlerts).toBe(false);
    expect(rs.sourceStatus).toBe("INFO_ONLY");

    // Existing gate still fires — confirms backward-compat with F&O/swing consumers
    expect(shouldDemoteSignal(yahooFresh)).toBe(true);

    // Stale Kite is also demoted
    const kiteStale = kiteProvStale();
    const rs2 = toScannerRowSource(kiteStale, "NIFTY");
    expect(rs2.canDriveSignals).toBe(false);
    expect(shouldDemoteSignal(kiteStale)).toBe(true);

    // Only fresh Kite intraday passes both gates
    const kiteOk = kiteProvFresh();
    const rs3 = toScannerRowSource(kiteOk, "NIFTY");
    expect(rs3.canDriveSignals).toBe(true);
    expect(shouldDemoteSignal(kiteOk)).toBe(false);
  });
});

// ── Phase A: Kite price overlay (scanner trade-grade upgrade) ─────────────────

describe("Phase A — Kite batch quote price overlay", () => {
  it("[Test 19] kitePriceOverlay=true is stored on the provenance envelope", () => {
    const p = yahooWithKiteOverlayProv();
    expect(p.kitePriceOverlay).toBe(true);
    expect(p.sourceProvider).toBe("yahoo"); // signal source stays Yahoo
    expect(p.notForSignals).toBe(true);     // canDriveSignals stays false
    expect(p.notForTradeDecisions).toBe(true);
  });

  it("[Test 20] Phase A row: source=yahoo, sourceStatus=INFO_ONLY, canDriveSignals=false", () => {
    const prov = yahooWithKiteOverlayProv();
    const rs = toScannerRowSource(prov, "RELIANCE");
    expect(rs.source).toBe("yahoo");
    expect(rs.sourceStatus).toBe("INFO_ONLY");
    expect(rs.canDriveSignals).toBe(false);
    expect(rs.canDriveTradeAlerts).toBe(false);
    // Warning from provenance is forwarded
    expect(rs.warning).toMatch(/Kite batch quote/i);
  });

  it("[Test 21] All Phase A rows (Yahoo + kitePriceOverlay) → scan-level KITE_PARTIAL", () => {
    const rows = [
      makeRow(yahooWithKiteOverlayProv()),
      makeRow(yahooWithKiteOverlayProv()),
      makeRow(yahooWithKiteOverlayProv()),
    ];
    const h = buildScannerSourceHealth(rows, { marketSession: "open" });
    expect(h.sourceStatus).toBe("KITE_PARTIAL");
    expect(h.tradeGrade).toBe(false);
    expect(h.canDriveSignals).toBe(false);
    // All rows still count as yahooDelayed in rowCounts (signal source is Yahoo)
    expect(h.rowCounts.yahooDelayed).toBe(3);
    expect(h.rowCounts.kiteLive).toBe(0);
    expect(h.rowCounts.total).toBe(3);
  });

  it("[Test 22] Phase A KITE_PARTIAL warning mentions Kite price overlay and Phase B", () => {
    const rows = [
      makeRow(yahooWithKiteOverlayProv()),
      makeRow(yahooWithKiteOverlayProv()),
    ];
    const h = buildScannerSourceHealth(rows);
    expect(h.sourceStatus).toBe("KITE_PARTIAL");
    expect(h.warning).toMatch(/Kite price overlay active/i);
    expect(h.warning).toMatch(/2 of 2/);
    expect(h.warning).toMatch(/Phase B/i);
  });

  it("[Test 23] Mixed Phase A rows and plain Yahoo rows → still KITE_PARTIAL (all are Yahoo-signal)", () => {
    // Some rows got Kite batch quote, some didn't (e.g. symbol not found in Kite)
    const rows = [
      makeRow(yahooWithKiteOverlayProv()), // Kite price overlay
      makeRow(yahooProvFresh()),            // plain Yahoo, no overlay
    ];
    const h = buildScannerSourceHealth(rows);
    expect(h.sourceStatus).toBe("KITE_PARTIAL");
    expect(h.rowCounts.yahooDelayed).toBe(2);
    expect(h.warning).toMatch(/1 of 2/); // only 1 row has overlay
  });

  it("[Test 24] Plain Yahoo rows WITHOUT overlay → YAHOO_INFO_ONLY (overlay=false does not trigger KITE_PARTIAL)", () => {
    const rows = [
      makeRow(yahooProvFresh()),
      makeRow(yahooProvFresh()),
    ];
    const h = buildScannerSourceHealth(rows);
    expect(h.sourceStatus).toBe("YAHOO_INFO_ONLY");
    expect(h.tradeGrade).toBe(false);
    expect(h.canDriveSignals).toBe(false);
  });

  it("[Test 25] kitePriceOverlay=false by default on provenance (no regression)", () => {
    const p = yahooProvFresh();
    expect(p.kitePriceOverlay).toBe(false);
    const pNull = buildSourceProvenance({ provider: null, asOfSec: null, tf: "1D", now: NOW });
    expect(pNull.kitePriceOverlay).toBe(false);
    const pKite = kiteProvFresh();
    expect(pKite.kitePriceOverlay).toBe(false);
  });
});
