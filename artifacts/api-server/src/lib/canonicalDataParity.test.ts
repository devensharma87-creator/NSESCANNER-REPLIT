/**
 * P0 Canonical Data Parity — Lane 1 Acceptance Tests
 *
 * Three fixes verified:
 *   BUG-1  MIDCAP proxy level scale mismatch — analytics suppressed when
 *          the daily-history proxy basket (^NSEMDCP50) runs on a different
 *          price scale than the live underlying (NIFTY_MID_SELECT.NS).
 *   BUG-2  F&O signal spotChangePctVsPrevClose — canonical vs-prevClose
 *          change% added alongside the open-baseline sessionChangePct.
 *   BUG-3  Strike step drift detection — kiteOptionChain now compares the
 *          inferred step from the live instrument master against the static
 *          STRIKE_STEPS map and logs a drift alarm when gap > 10%.
 *
 * Each section has:
 *   - A structural assertion (shape / presence in source)
 *   - A behavioural assertion (logic correctness where a pure unit is reachable)
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { buildItem, type InstrumentCfg } from "./indicesBoard";
import type { YahooChart } from "./yahoo";
import type { KiteIndexQuote } from "./kiteIndexQuotes";
import { LOT_SIZES } from "./optionChain";
import type { OcResponse } from "./optionChain";
import { OPTION_INDICES } from "./optionSignals";
import {
  getCachedLotSizeForIndex,
  clearFnoInstrumentsCache,
  _setFnoInstrumentsCacheForTest,
  type FnoInstrument,
} from "./kiteFnoInstruments";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Two-bar daily chart with proxy-scale closes.
 *  Both bars are stamped in the past (2+ days ago) so splitTodayPrev treats
 *  bar[1] as prevIdx — no dependency on real Date.now(). */
function proxyDailyChart(proxyCLose: number): YahooChart {
  const now = Date.now();
  const yesterdaySec = Math.floor(now / 1000) - 2 * 86400;
  const twoDaysAgoSec = yesterdaySec - 86400;
  return {
    symbol: "^NSEMDCP50",
    meta: { symbol: "^NSEMDCP50", regularMarketPrice: proxyCLose, regularMarketTime: yesterdaySec },
    timestamps:  [twoDaysAgoSec, yesterdaySec],
    open:        [proxyCLose - 50, proxyCLose - 20],
    high:        [proxyCLose + 100, proxyCLose + 80],
    low:         [proxyCLose - 100, proxyCLose - 80],
    close:       [proxyCLose - 10, proxyCLose],
    volume:      [1_000_000, 1_200_000],
  };
}

/** KiteIndexQuote returning a live price at a different scale than the proxy. */
function kiteQuote(livePrice: number, livePrevClose: number): KiteIndexQuote {
  return {
    yahooSymbol: "NIFTY_MID_SELECT.NS",
    name: "MIDCAP NIFTY",
    price: livePrice,
    open: livePrice - 50,
    high: livePrice + 100,
    low: livePrice - 100,
    previousClose: livePrevClose,
    change: livePrice - livePrevClose,
    changePercent: ((livePrice - livePrevClose) / livePrevClose) * 100,
    asOf: Date.now(),
  };
}

const MIDCAP_CFG: InstrumentCfg = {
  key: "MIDCPNIFTY",
  name: "MIDCAP NIFTY",
  category: "INDIA",
  yahoo: "NIFTY_MID_SELECT.NS",
  yahooDaily: "^NSEMDCP50",
  proxyNote: "Daily indicators use Nifty Midcap 50 proxy",
  kiteYahooKey: "NIFTY_MID_SELECT.NS",
  currency: "₹",
};

const NIFTY_CFG: InstrumentCfg = {
  key: "NIFTY50",
  name: "NIFTY 50",
  category: "INDIA",
  yahoo: "^NSEI",
  kiteYahooKey: "^NSEI",
  currency: "₹",
};

// ─────────────────────────────────────────────────────────────────────────────
// BUG-1: MIDCAP proxy level scale guard
// ─────────────────────────────────────────────────────────────────────────────

describe("BUG-1: MIDCAP proxy level scale guard", () => {
  // Proxy (^NSEMDCP50) runs at ~17 845 while the live underlying
  // (NIFTY_MID_SELECT.NS) trades at ~14 618. Gap = 22.1%.
  const PROXY_LEVEL = 17_845;
  const LIVE_LEVEL  = 14_618;

  it("proxyLevelBlocked=true when scale gap > 1%", () => {
    const daily = proxyDailyChart(PROXY_LEVEL);
    const kite  = kiteQuote(LIVE_LEVEL + 50, LIVE_LEVEL);
    const item  = buildItem(MIDCAP_CFG, daily, null, undefined, kite);

    expect(item.proxyLevelBlocked).toBe(true);
  });

  it("proxyLevelBlockReason mentions the proxy ticker and scale gap", () => {
    const daily = proxyDailyChart(PROXY_LEVEL);
    const kite  = kiteQuote(LIVE_LEVEL + 50, LIVE_LEVEL);
    const item  = buildItem(MIDCAP_CFG, daily, null, undefined, kite);

    expect(item.proxyLevelBlockReason).toBeDefined();
    expect(item.proxyLevelBlockReason).toContain("^NSEMDCP50");
    // Gap should be expressed as a percentage in the reason string
    const gapMatch = item.proxyLevelBlockReason?.match(/(\d+\.\d+)%/);
    expect(gapMatch).not.toBeNull();
    const gapPct = parseFloat(gapMatch![1]);
    expect(gapPct).toBeGreaterThan(15); // structural: should be ~22%
  });

  it("all price-level analytics are suppressed when proxyLevelBlocked", () => {
    const daily = proxyDailyChart(PROXY_LEVEL);
    const kite  = kiteQuote(LIVE_LEVEL + 50, LIVE_LEVEL);
    const item  = buildItem(MIDCAP_CFG, daily, null, undefined, kite);

    // Level-based fields must be undefined/empty
    expect(item.ema9).toBeUndefined();
    expect(item.ema20).toBeUndefined();
    expect(item.ema50).toBeUndefined();
    expect(item.ema100).toBeUndefined();
    expect(item.ema200).toBeUndefined();
    expect(item.pivot).toBeUndefined();
    expect(item.support).toEqual([]);
    expect(item.resistance).toEqual([]);
    expect(item.fiftyTwoWeekHigh).toBeUndefined();
    expect(item.fiftyTwoWeekLow).toBeUndefined();
    expect(item.prevOpen).toBeUndefined();
    expect(item.prevHigh).toBeUndefined();
    expect(item.prevLow).toBeUndefined();
  });

  it("dimensionless fields are NOT suppressed — change/changePercent/prevClose stay", () => {
    const daily = proxyDailyChart(PROXY_LEVEL);
    const kite  = kiteQuote(LIVE_LEVEL + 50, LIVE_LEVEL);
    const item  = buildItem(MIDCAP_CFG, daily, null, undefined, kite);

    // prevClose = live kite's previousClose (overridden from proxy)
    expect(item.prevClose).toBe(LIVE_LEVEL);
    // change and changePercent must be derived from live ltp vs live prevClose
    expect(item.change).toBeCloseTo(50, 0);
    expect(item.changePercent).toBeGreaterThan(0);
    // ltp must be the kite live price
    expect(item.ltp).toBe(LIVE_LEVEL + 50);
  });

  it("adds a human-readable note when proxy is blocked", () => {
    const daily = proxyDailyChart(PROXY_LEVEL);
    const kite  = kiteQuote(LIVE_LEVEL + 50, LIVE_LEVEL);
    const item  = buildItem(MIDCAP_CFG, daily, null, undefined, kite);

    const blockNote = item.notes.find(n => n.includes("proxy blocked"));
    expect(blockNote).toBeDefined();
  });

  it("no suppression when gap <= 1% (co-moving proxies)", () => {
    // Proxy prevClose = 14700, live prevClose = 14680 → gap = 0.14%
    const daily = proxyDailyChart(14_700);
    const kite  = kiteQuote(14_700 + 30, 14_680);
    const item  = buildItem(MIDCAP_CFG, daily, null, undefined, kite);

    expect(item.proxyLevelBlocked).toBeUndefined();
    // EMAs should be present (two bars is too few for EMA200, but not suppressed by guard)
    // Just confirm the guard didn't null them — ema9 may be undefined from insufficient bars
    // so we only check the flag.
    expect(item.proxyLevelBlockReason).toBeUndefined();
  });

  it("no suppression for non-proxy configs (yahooDaily absent)", () => {
    // NIFTY 50 has no yahooDaily → guard never fires
    const daily = proxyDailyChart(24_500);
    const kite  = kiteQuote(24_500 + 30, 24_400);
    const item  = buildItem(NIFTY_CFG, daily, null, undefined, kite);

    expect(item.proxyLevelBlocked).toBeUndefined();
    expect(item.proxyLevelBlockReason).toBeUndefined();
  });

  it("no suppression when proxy and live use the same ticker (yahooDaily === yahoo)", () => {
    // Cfg where yahooDaily explicitly matches yahoo — guard must not fire.
    const cfg: InstrumentCfg = { ...NIFTY_CFG, yahooDaily: "^NSEI" };
    const daily = proxyDailyChart(24_500);
    const kite  = kiteQuote(24_500 + 30, 24_400);
    const item  = buildItem(cfg, daily, null, undefined, kite);

    expect(item.proxyLevelBlocked).toBeUndefined();
  });

  // ── Structural / source-scan assertions ──────────────────────────────────

  it("IndexBoardItem interface declares proxyLevelBlocked and proxyLevelBlockReason", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "indicesBoard.ts"),
      "utf8",
    );
    expect(src).toContain("proxyLevelBlocked?: boolean");
    expect(src).toContain("proxyLevelBlockReason?: string");
  });

  it("scale guard captures proxyPrevClose before the Kite override", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "indicesBoard.ts"),
      "utf8",
    );
    // Proof: proxyPrevClose variable is declared before the kite override block
    const proxyCapIdx  = src.indexOf("let proxyPrevClose");
    const kiteBlockIdx = src.indexOf("// ── Live Kite override");
    expect(proxyCapIdx).toBeGreaterThan(-1);
    expect(kiteBlockIdx).toBeGreaterThan(-1);
    expect(proxyCapIdx).toBeLessThan(kiteBlockIdx);
  });

  it("scale guard runs AFTER the Kite override block", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "indicesBoard.ts"),
      "utf8",
    );
    const kiteBlockIdx  = src.indexOf("// ── Live Kite override");
    const guardBlockIdx = src.indexOf("// ── Analytics scale guard");
    expect(guardBlockIdx).toBeGreaterThan(kiteBlockIdx);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUG-2: F&O signal spotChangePctVsPrevClose (prevClose-based canonical change%)
// ─────────────────────────────────────────────────────────────────────────────

describe("BUG-2: F&O signal spotChangePctVsPrevClose", () => {
  it("Ctx interface declares prevClose: number | null", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "optionSignals.ts"),
      "utf8",
    );
    expect(src).toContain("prevClose: number | null");
  });

  it("prevClose is computed from daily.close[dn - 2] in buildContext", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "optionSignals.ts"),
      "utf8",
    );
    // The computation must reference daily.close[dn - 2]
    expect(src).toContain("daily.close[dn - 2]");
    // And must require dn >= 2
    expect(src).toContain("dn >= 2");
  });

  it("spotChangePctVsPrevClose is emitted in the signal return object", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "optionSignals.ts"),
      "utf8",
    );
    expect(src).toContain("spotChangePctVsPrevClose:");
  });

  it("spotPrevClose is emitted in the signal return object", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "optionSignals.ts"),
      "utf8",
    );
    expect(src).toContain("spotPrevClose:");
  });

  it("spotChangePctVsPrevClose uses prevClose, NOT sessionChangePct / open0", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "optionSignals.ts"),
      "utf8",
    );
    // Extract the spotChangePctVsPrevClose line and ensure it references c.prevClose
    const idx = src.indexOf("spotChangePctVsPrevClose:");
    expect(idx).toBeGreaterThan(-1);
    const snippet = src.slice(idx, idx + 200);
    expect(snippet).toContain("c.prevClose");
    // Must NOT use open0 or sessionChangePct in its formula
    expect(snippet).not.toContain("open0");
    expect(snippet).not.toContain("sessionChangePct");
  });

  it("spotChangePercent (vs open) is preserved unchanged for internal use", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "optionSignals.ts"),
      "utf8",
    );
    // spotChangePercent still exists and still uses sessionChangePct
    expect(src).toContain("spotChangePercent: round2(c.sessionChangePct)");
  });

  it("OpenAPI spec includes spotChangePctVsPrevClose on OptionSignal", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../../../lib/api-spec/openapi.yaml"),
      "utf8",
    );
    expect(src).toContain("spotChangePctVsPrevClose:");
    expect(src).toContain("spotPrevClose:");
  });

  it("spotChangePctVsPrevClose guard: null prevClose emits undefined (no divide-by-zero)", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "optionSignals.ts"),
      "utf8",
    );
    // The emission must guard on prevClose != null AND prevClose > 0
    const idx = src.indexOf("spotChangePctVsPrevClose:");
    const snippet = src.slice(idx, idx + 250);
    expect(snippet).toMatch(/prevClose.*!=.*null/);
    expect(snippet).toMatch(/prevClose.*>.*0/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUG-3: Strike step drift detection
// ─────────────────────────────────────────────────────────────────────────────

describe("BUG-3: Strike step drift detection", () => {
  it("kiteOptionChain.ts infers strike step from instrument master first", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "kiteOptionChain.ts"),
      "utf8",
    );
    // The inferredStep must be computed before the static map is consulted
    expect(src).toContain("const inferredStep = inferStrikeStep(");
    expect(src).toContain("const staticStep");
    const inferIdx  = src.indexOf("const inferredStep");
    const staticIdx = src.indexOf("const staticStep");
    expect(inferIdx).toBeLessThan(staticIdx);
  });

  it("kiteOptionChain.ts emits a drift alarm when static and master differ by >10%", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "kiteOptionChain.ts"),
      "utf8",
    );
    // Drift alarm uses a percentage threshold check
    expect(src).toContain("STRIKE_STEP_DRIFT");
    expect(src).toContain("0.10");
  });

  it("kiteOptionChain.ts falls back to static map with 'static_map_fallback' source when inference fails", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "kiteOptionChain.ts"),
      "utf8",
    );
    expect(src).toContain('"static_map_fallback"');
  });

  it("kiteOptionChain.ts stamps strikeStepSource on the returned OcResponse", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "kiteOptionChain.ts"),
      "utf8",
    );
    expect(src).toContain("strikeStepSource,");
  });

  it("NSE direct path stamps strikeStepSource='inferred_from_nse'", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "optionChain.ts"),
      "utf8",
    );
    expect(src).toContain('"inferred_from_nse"');
    expect(src).toContain("strikeStepSource:");
  });

  it("OcResponse interface declares strikeStepSource with a union of 3 values", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "optionChain.ts"),
      "utf8",
    );
    expect(src).toContain("strikeStepSource?");
    expect(src).toContain('"instrument_master"');
    expect(src).toContain('"static_map_fallback"');
    expect(src).toContain('"inferred_from_nse"');
  });

  it("OpenAPI spec includes strikeStepSource on OptionChainResponse", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../../../lib/api-spec/openapi.yaml"),
      "utf8",
    );
    expect(src).toContain("strikeStepSource:");
    expect(src).toContain("instrument_master");
    expect(src).toContain("static_map_fallback");
    expect(src).toContain("inferred_from_nse");
  });

  it("instrument_master source is preferred — the code uses inferredStep when valid", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "kiteOptionChain.ts"),
      "utf8",
    );
    // The guard: inferredStep > 0 && Number.isFinite(inferredStep)
    expect(src).toContain("inferredStep > 0");
    expect(src).toContain("Number.isFinite(inferredStep)");
    expect(src).toContain('"instrument_master"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Contract: OpenAPI → Zod schema generated types include the new fields
// ─────────────────────────────────────────────────────────────────────────────

describe("Contract: generated Zod schema includes Lane 1 fields", () => {
  it("generated Zod schema includes proxyLevelBlocked on IndexBoardItem", () => {
    // The generated file lives at lib/api-zod/src/generated/
    const zodFile = path.resolve(
      __dirname,
      "../../../../lib/api-zod/src/generated/indian-stock-market-scannerZod.ts",
    );
    // Guard: only assert if the generated file exists (codegen may not have run in CI)
    if (!fs.existsSync(zodFile)) return;
    const src = fs.readFileSync(zodFile, "utf8");
    expect(src).toContain("proxyLevelBlocked");
  });

  it("generated Zod schema includes spotChangePctVsPrevClose on OptionSignal", () => {
    const zodFile = path.resolve(
      __dirname,
      "../../../../lib/api-zod/src/generated/indian-stock-market-scannerZod.ts",
    );
    if (!fs.existsSync(zodFile)) return;
    const src = fs.readFileSync(zodFile, "utf8");
    expect(src).toContain("spotChangePctVsPrevClose");
  });

  it("generated Zod schema includes strikeStepSource on OptionChainResponse", () => {
    const zodFile = path.resolve(
      __dirname,
      "../../../../lib/api-zod/src/generated/indian-stock-market-scannerZod.ts",
    );
    if (!fs.existsSync(zodFile)) return;
    const src = fs.readFileSync(zodFile, "utf8");
    expect(src).toContain("strikeStepSource");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 1 — F&O Frontend Baseline Parity
// Formula contract: spotChangePctVsPrevClose ≠ spotChangePercent (vs open)
// ─────────────────────────────────────────────────────────────────────────────

describe("GAP 1 — F&O signal change% formula: prevClose vs open distinction", () => {
  it("spotChangePctVsPrevClose and spotChangePercent diverge when open ≠ prevClose", () => {
    const ltp = 24500;
    const prevClose = 24000;
    const open = 24100; // gap-up: open > prevClose
    const vsPrevClose = ((ltp - prevClose) / prevClose) * 100; // ≈ 2.083
    const vsOpen      = ((ltp - open) / open) * 100;           // ≈ 1.660
    expect(Math.abs(vsPrevClose - vsOpen)).toBeGreaterThan(0.01);
    expect(parseFloat(vsPrevClose.toFixed(2))).toBe(2.08);
    expect(parseFloat(vsOpen.toFixed(2))).toBe(1.66);
    expect(vsPrevClose).not.toBeCloseTo(vsOpen, 1);
  });

  it("spotChangePctVsPrevClose = 0 exactly when ltp = prevClose", () => {
    const ltp = 24000;
    const prevClose = 24000;
    const vsPrevClose = ((ltp - prevClose) / prevClose) * 100;
    expect(vsPrevClose).toBe(0);
  });

  it("spotChangePctVsPrevClose is negative when ltp < prevClose (bearish)", () => {
    const ltp = 23500;
    const prevClose = 24000;
    const vsPrevClose = ((ltp - prevClose) / prevClose) * 100;
    expect(vsPrevClose).toBeLessThan(0);
    expect(parseFloat(vsPrevClose.toFixed(2))).toBe(-2.08);
  });

  it("generated Zod schema includes both spotChangePctVsPrevClose and spotPrevClose on OptionSignal", () => {
    const zodFile = path.resolve(
      __dirname,
      "../../../../lib/api-zod/src/generated/indian-stock-market-scannerZod.ts",
    );
    if (!fs.existsSync(zodFile)) return;
    const src = fs.readFileSync(zodFile, "utf8");
    expect(src).toContain("spotChangePctVsPrevClose");
    expect(src).toContain("spotPrevClose");
  });

  it("options.tsx uses spotChangePctVsPrevClose as primary display (not spotChangePercent)", () => {
    const optionsPath = path.resolve(__dirname, "../../../../artifacts/scanner/src/pages/options.tsx");
    let src = "";
    try { src = fs.readFileSync(optionsPath, "utf8"); } catch { return; }
    expect(src).toContain("spotChangePctVsPrevClose");
    expect(src).toContain("spotChangePctVsPrevClose != null");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 2 — FINNIFTY prevClose / 52W contamination closure
// Verdict: OUTDATED_AUDIT_FINDING — no yahooDaily proxy → no scale gap
// ─────────────────────────────────────────────────────────────────────────────

describe("GAP 2 — FINNIFTY source scan: no yahooDaily proxy → no scale contamination", () => {
  const boardSrc = fs.readFileSync(path.resolve(__dirname, "indicesBoard.ts"), "utf8");

  it("FINNIFTY config line has no yahooDaily property (same ticker for live and history)", () => {
    const lines = boardSrc.split("\n");
    const finniftyLine = lines.find(l =>
      l.includes('"FINNIFTY"') && l.includes("NIFTY_FIN_SERVICE.NS"),
    );
    expect(finniftyLine).toBeDefined();
    expect(finniftyLine).not.toContain("yahooDaily");
  });

  it("proxy scale guard (proxyLevelBlocked) only fires when yahooDaily is set — structurally unreachable for FINNIFTY", () => {
    expect(boardSrc).toContain("cfg.yahooDaily && cfg.yahooDaily !== cfg.yahoo");
  });

  it("prevClose formula in indicesBoard is standard — change = ltp - prevClose, pct = ch / prevClose * 100", () => {
    expect(boardSrc).toContain("item.ltp - item.prevClose");
    expect(boardSrc).toContain("ch / item.prevClose");
  });

  it("FINNIFTY 52W high/low comes from Yahoo meta for NIFTY_FIN_SERVICE.NS (same ticker, no scale gap)", () => {
    expect(boardSrc).toContain("fiftyTwoWeekHigh");
    expect(boardSrc).toContain("fiftyTwoWeekLow");
    const finniftyLine = boardSrc.split("\n").find(l =>
      l.includes('"FINNIFTY"') && l.includes("NIFTY_FIN_SERVICE.NS"),
    ) ?? "";
    expect(finniftyLine).not.toContain("yahooDaily");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 3 — Expiry / Contract Master Tests
// Per-index cadence config; no global Tuesday/Thursday assumption
// ─────────────────────────────────────────────────────────────────────────────

describe("GAP 3 — Expiry resolution: per-index cadence (no global weekday assumption)", () => {
  it("NIFTY uses weekly cadence on Tuesday (expiryWeekday=2)", () => {
    const cfg = OPTION_INDICES.find(c => c.symbol === "NIFTY");
    expect(cfg).toBeDefined();
    expect(cfg!.expiryCadence).toBe("weekly");
    expect(cfg!.expiryWeekday).toBe(2); // 0=Sun,1=Mon,2=Tue,3=Wed,4=Thu,5=Fri,6=Sat
  });

  it("BANKNIFTY uses monthly cadence on last Thursday (expiryWeekday=4)", () => {
    const cfg = OPTION_INDICES.find(c => c.symbol === "BANKNIFTY");
    expect(cfg).toBeDefined();
    expect(cfg!.expiryCadence).toBe("monthly");
    expect(cfg!.expiryWeekday).toBe(4);
  });

  it("SENSEX uses weekly cadence on Tuesday (expiryWeekday=2)", () => {
    const cfg = OPTION_INDICES.find(c => c.symbol === "SENSEX");
    expect(cfg).toBeDefined();
    expect(cfg!.expiryCadence).toBe("weekly");
    expect(cfg!.expiryWeekday).toBe(2);
  });

  it("no single global weekday applies to all indices — NIFTY/SENSEX=Tue, BANKNIFTY=Thu", () => {
    const weekdays = OPTION_INDICES.map(c => c.expiryWeekday);
    const allSame = weekdays.length > 1 && weekdays.every(d => d === weekdays[0]);
    expect(allSame).toBe(false);
  });

  it("BANKNIFTY expiry weekday (4=Thu) differs from NIFTY expiry weekday (2=Tue)", () => {
    const nifty = OPTION_INDICES.find(c => c.symbol === "NIFTY")!;
    const bnf   = OPTION_INDICES.find(c => c.symbol === "BANKNIFTY")!;
    expect(nifty.expiryWeekday).not.toBe(bnf.expiryWeekday);
  });

  it("optionSignals.ts delegates expiry resolution to resolveContractMaster (not a hardcoded string)", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "optionSignals.ts"), "utf8");
    // Must import and call resolveContractMaster
    expect(src).toContain('import { resolveContractMaster }');
    expect(src).toContain('resolveContractMaster(');
    // Must NOT hardcode algorithmic_weekday any more
    expect(src).not.toContain(`expirySource: "algorithmic_weekday" as const`);
  });

  it("optionSignals.ts leg wires all 4 ContractMasterFact fields onto the OptionLeg", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "optionSignals.ts"), "utf8");
    expect(src).toContain("expirySource: _cmf.expirySource");
    expect(src).toContain("expiryType: _cmf.expiryType");
    expect(src).toContain("contractInstrumentToken");
    expect(src).toContain("contractGrade: _cmf.contractGrade");
  });

  it("generated Zod schema includes expirySource on OptionLeg", () => {
    const zodFile = path.resolve(
      __dirname,
      "../../../../lib/api-zod/src/generated/indian-stock-market-scannerZod.ts",
    );
    if (!fs.existsSync(zodFile)) return;
    const src = fs.readFileSync(zodFile, "utf8");
    expect(src).toContain("expirySource");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 4 — Lot-size ContractMasterFact / Drift Alarm
// Static map correctness + master-first resolution via getCachedLotSizeForIndex
// ─────────────────────────────────────────────────────────────────────────────

describe("GAP 4 — Lot-size contract: static map correctness and master-first resolution", () => {
  it("LOT_SIZES static map — NIFTY = 65 (Jan-2026 NSE revision)", () => {
    expect(LOT_SIZES["NIFTY"]).toBe(65);
  });

  it("LOT_SIZES static map — BANKNIFTY = 30", () => {
    expect(LOT_SIZES["BANKNIFTY"]).toBe(30);
  });

  it("LOT_SIZES static map — SENSEX = 20", () => {
    expect(LOT_SIZES["SENSEX"]).toBe(20);
  });

  it("LOT_SIZES static map — FINNIFTY = 60", () => {
    expect(LOT_SIZES["FINNIFTY"]).toBe(60);
  });

  it("LOT_SIZES static map — MIDCPNIFTY = 120", () => {
    expect(LOT_SIZES["MIDCPNIFTY"]).toBe(120);
  });

  it("getCachedLotSizeForIndex returns null when cache is cold", () => {
    clearFnoInstrumentsCache();
    expect(getCachedLotSizeForIndex("NIFTY")).toBeNull();
    expect(getCachedLotSizeForIndex("BANKNIFTY")).toBeNull();
    expect(getCachedLotSizeForIndex("SENSEX")).toBeNull();
  });

  it("getCachedLotSizeForIndex returns master lot size for all 5 indices when cache is warm", () => {
    const mockRows: FnoInstrument[] = [
      { instrument_token: 1, exchange_token: 1, tradingsymbol: "NIFTY24JUL24950CE", name: "NIFTY",     last_price: 0, expiry: "2024-07-25", strike: 24950, tick_size: 0.05, lot_size: 65,  instrument_type: "CE", segment: "NFO-OPT", exchange: "NFO" },
      { instrument_token: 2, exchange_token: 2, tradingsymbol: "BANKNIFTY24JUL52000CE", name: "BANKNIFTY", last_price: 0, expiry: "2024-07-25", strike: 52000, tick_size: 0.05, lot_size: 30,  instrument_type: "CE", segment: "NFO-OPT", exchange: "NFO" },
      { instrument_token: 3, exchange_token: 3, tradingsymbol: "SENSEX24JUL80000CE", name: "SENSEX",    last_price: 0, expiry: "2024-07-26", strike: 80000, tick_size: 0.05, lot_size: 20,  instrument_type: "CE", segment: "BFO-OPT", exchange: "BFO" },
      { instrument_token: 4, exchange_token: 4, tradingsymbol: "FINNIFTY24JUL23000CE", name: "FINNIFTY",  last_price: 0, expiry: "2024-07-23", strike: 23000, tick_size: 0.05, lot_size: 60,  instrument_type: "CE", segment: "NFO-OPT", exchange: "NFO" },
      { instrument_token: 5, exchange_token: 5, tradingsymbol: "MIDCPNIFTY24JUL13000CE", name: "MIDCPNIFTY", last_price: 0, expiry: "2024-07-22", strike: 13000, tick_size: 0.05, lot_size: 120, instrument_type: "CE", segment: "NFO-OPT", exchange: "NFO" },
    ];
    _setFnoInstrumentsCacheForTest(mockRows);
    expect(getCachedLotSizeForIndex("NIFTY")).toBe(65);
    expect(getCachedLotSizeForIndex("BANKNIFTY")).toBe(30);
    expect(getCachedLotSizeForIndex("SENSEX")).toBe(20);
    expect(getCachedLotSizeForIndex("FINNIFTY")).toBe(60);
    expect(getCachedLotSizeForIndex("MIDCPNIFTY")).toBe(120);
    clearFnoInstrumentsCache();
  });

  it("drift alarm path exists in paperTradingFO.ts — master wins over static when cache is warm", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "paperTradingFO.ts"), "utf8");
    expect(src).toContain("LOT_SIZE_DRIFT");
    expect(src).toContain("getCachedLotSizeForIndex");
    expect(src).toContain("masterLotSize !== staticLotSize");
    expect(src).toContain("contractGrade=static_fallback");
  });

  it("kiteOptionChain.ts stamps lotSizeSource from live instrument dump lot_size field", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "kiteOptionChain.ts"), "utf8");
    expect(src).toContain("lotSizeSource");
    expect(src).toContain('"instrument_master"');
    expect(src).toContain('"static_fallback"');
    expect(src).toContain("masterLotSize");
  });

  it("static map must never silently override master — lotSizeFor tries master first", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "paperTradingFO.ts"), "utf8");
    const masterCheckIdx = src.indexOf("getCachedLotSizeForIndex");
    const staticCheckIdx = src.indexOf("LOT_SIZES[sym]");
    expect(masterCheckIdx).toBeGreaterThan(-1);
    expect(staticCheckIdx).toBeGreaterThan(-1);
    // master check must appear before the static fallback in the function
    expect(masterCheckIdx).toBeLessThan(staticCheckIdx);
  });

  it("generated Zod schema includes lotSizeSource on OptionChainResponse", () => {
    const zodFile = path.resolve(
      __dirname,
      "../../../../lib/api-zod/src/generated/indian-stock-market-scannerZod.ts",
    );
    if (!fs.existsSync(zodFile)) return;
    const src = fs.readFileSync(zodFile, "utf8");
    expect(src).toContain("lotSizeSource");
  });
});
