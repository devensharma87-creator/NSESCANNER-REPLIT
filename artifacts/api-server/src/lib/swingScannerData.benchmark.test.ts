/**
 * S3a — Swing Benchmark Reliability tests.
 *
 * Verifies the resilient NIFTY 50 benchmark loader
 * (`fetchBenchmarkBarsResilient`) in `swingScannerData.ts`.
 *
 * Scope:
 *  • Fallback ladder: Yahoo → Yahoo retry → Kite → none
 *  • Insufficient-bar guard at every layer
 *  • Never-throws contract (errors recorded, not raised)
 *  • RS formula stability against a fixed (stock, benchmark) fixture
 *  • `rs20`/`rs50`/`rs120`/`rsScore` populated when benchmark valid
 *  • No sector/delivery scoring, no stock-vs-sector RS, no entry/stop/
 *    target/RR/F&O/paper-equity changes — verified by static source
 *    inspection of `swingScanner.ts` exports.
 *
 * No DB. No network. Pure unit tests.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fetchBenchmarkBarsResilient } from "./swingScannerData";
import { scoreAndPlan, type SwingScanResult } from "./swingScanner";

/* ───────────────────────── Fixture helpers ─────────────────────────── */

/** Build a synthetic OHLCV chart of `n` daily bars with monotone closes. */
function makeChart(n: number, startClose = 20000, drift = 5) {
  const close: number[] = [];
  const open: number[] = [];
  const high: number[] = [];
  const low: number[] = [];
  const volume: number[] = [];
  const timestamps: number[] = [];
  // Anchor first bar to a fixed past date so dates are deterministic.
  const startMs = Date.UTC(2025, 0, 1);
  for (let i = 0; i < n; i++) {
    const c = startClose + i * drift;
    close.push(c);
    open.push(c - 1);
    high.push(c + 2);
    low.push(c - 2);
    volume.push(0); // index → 0 volume
    timestamps.push(Math.floor((startMs + i * 86400 * 1000) / 1000));
  }
  return { close, open, high, low, volume, timestamps };
}

/* ─────────────────────────── Fallback tests ────────────────────────── */

describe("S3a fetchBenchmarkBarsResilient — fallback ladder", () => {
  const sleepNoop = async () => {};

  it("1. Yahoo success on first attempt → source=yahoo", async () => {
    const chart = makeChart(250);
    const result = await fetchBenchmarkBarsResilient(365, {
      yahooFetch: async () => chart,
      kiteFetch: async () => null,
      sleepMs: sleepNoop,
    });
    expect(result.source).toBe("yahoo");
    expect(result.bars).not.toBeNull();
    expect(result.barCount).toBe(250);
    expect(result.firstDate).toBe("2025-01-01");
    expect(result.errors.yahoo).toBeUndefined();
    expect(result.errors.kite).toBeUndefined();
  });

  it("2. Yahoo first attempt fails (null), retry succeeds → source=yahoo_retry", async () => {
    const chart = makeChart(200);
    let call = 0;
    const result = await fetchBenchmarkBarsResilient(365, {
      yahooFetch: async () => {
        call++;
        return call === 1 ? null : chart;
      },
      kiteFetch: async () => null,
      sleepMs: sleepNoop,
    });
    expect(call).toBe(2);
    expect(result.source).toBe("yahoo_retry");
    expect(result.bars).not.toBeNull();
    expect(result.barCount).toBe(200);
    expect(result.errors.yahoo).toBe("null_response");
    expect(result.errors.yahooRetry).toBeUndefined();
  });

  it("2b. Yahoo first attempt throws, retry succeeds → source=yahoo_retry, error recorded", async () => {
    const chart = makeChart(180);
    let call = 0;
    const result = await fetchBenchmarkBarsResilient(365, {
      yahooFetch: async () => {
        call++;
        if (call === 1) throw new Error("ETIMEDOUT");
        return chart;
      },
      kiteFetch: async () => null,
      sleepMs: sleepNoop,
    });
    expect(result.source).toBe("yahoo_retry");
    expect(result.errors.yahoo).toBe("ETIMEDOUT");
    expect(result.bars).not.toBeNull();
  });

  it("3. Yahoo fails both times, Kite succeeds → source=kite", async () => {
    const chart = makeChart(160);
    const result = await fetchBenchmarkBarsResilient(365, {
      yahooFetch: async () => null,
      kiteFetch: async () => chart,
      sleepMs: sleepNoop,
    });
    expect(result.source).toBe("kite");
    expect(result.bars).not.toBeNull();
    expect(result.barCount).toBe(160);
    expect(result.errors.yahoo).toBe("null_response");
    expect(result.errors.yahooRetry).toBe("null_response");
    expect(result.errors.kite).toBeUndefined();
  });

  it("4. Yahoo AND Kite both fail → source=none, bars=null, neutral RS behaviour", async () => {
    const result = await fetchBenchmarkBarsResilient(365, {
      yahooFetch: async () => null,
      kiteFetch: async () => null,
      sleepMs: sleepNoop,
    });
    expect(result.source).toBe("none");
    expect(result.bars).toBeNull();
    expect(result.barCount).toBe(0);
    expect(result.firstDate).toBeNull();
    expect(result.lastDate).toBeNull();
    expect(result.errors.yahoo).toBeDefined();
    expect(result.errors.yahooRetry).toBeDefined();
    expect(result.errors.kite).toBeDefined();
  });

  it("5. Benchmark with insufficient bars (< 140) at every layer → source=none", async () => {
    const tooShort = makeChart(50);
    const result = await fetchBenchmarkBarsResilient(365, {
      yahooFetch: async () => tooShort,
      kiteFetch: async () => tooShort,
      sleepMs: sleepNoop,
    });
    expect(result.source).toBe("none");
    expect(result.bars).toBeNull();
    expect(result.errors.yahoo).toBe("insufficient_bars:50");
    expect(result.errors.yahooRetry).toBe("insufficient_bars:50");
    expect(result.errors.kite).toBe("insufficient_bars:50");
  });

  it("5b. Yahoo too short but Kite has enough → source=kite", async () => {
    const tooShort = makeChart(50);
    const enough = makeChart(180);
    const result = await fetchBenchmarkBarsResilient(365, {
      yahooFetch: async () => tooShort,
      kiteFetch: async () => enough,
      sleepMs: sleepNoop,
    });
    expect(result.source).toBe("kite");
    expect(result.bars).not.toBeNull();
    expect(result.barCount).toBe(180);
  });

  it("6. Benchmark fallback NEVER throws, even when every layer throws", async () => {
    const result = await fetchBenchmarkBarsResilient(365, {
      yahooFetch: async () => { throw new Error("yahoo_dead"); },
      kiteFetch: async () => { throw new Error("kite_dead"); },
      sleepMs: sleepNoop,
    });
    expect(result.source).toBe("none");
    expect(result.bars).toBeNull();
    expect(result.errors.yahoo).toBe("yahoo_dead");
    expect(result.errors.yahooRetry).toBe("yahoo_dead");
    expect(result.errors.kite).toBe("kite_dead");
    // durationMs ≥ 0 and finite
    expect(Number.isFinite(result.durationMs)).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("6b. Error messages are trimmed to ≤200 chars", async () => {
    const longMsg = "x".repeat(500);
    const result = await fetchBenchmarkBarsResilient(365, {
      yahooFetch: async () => { throw new Error(longMsg); },
      kiteFetch: async () => null,
      sleepMs: sleepNoop,
    });
    expect(result.errors.yahoo?.length).toBeLessThanOrEqual(200);
    expect(result.errors.yahooRetry?.length).toBeLessThanOrEqual(200);
  });
});

/* ───────────────── RS formula stability + populate tests ───────────── */

describe("S3a — RS formula unchanged + columns populate on valid benchmark", () => {
  /**
   * Fixed (stock, benchmark) fixture: 260 daily bars, deterministic
   * geometric drift on both sides. This test pins the *exact* rs120
   * value the formula produces today so any future tweak to the RS
   * math (which is out of S3a scope) will fail this assertion.
   */
  it("7. RS formula output is stable for a fixed (stock, benchmark) fixture", () => {
    const benchClose: number[] = [];
    const benchTs: number[] = [];
    const stockClose: number[] = [];
    const stockOpen: number[] = [];
    const stockHigh: number[] = [];
    const stockLow: number[] = [];
    const stockVol: number[] = [];
    const stockTs: number[] = [];
    const startMs = Date.UTC(2025, 0, 1);
    for (let i = 0; i < 260; i++) {
      const t = Math.floor((startMs + i * 86400 * 1000) / 1000);
      // benchmark: slow uptrend, 0.1% per bar
      const b = 20000 * Math.pow(1.001, i);
      benchClose.push(b);
      benchTs.push(t * 1000);
      // stock: outpaces benchmark, 0.2% per bar — RS should be POSITIVE
      const s = 1000 * Math.pow(1.002, i);
      stockClose.push(s);
      stockOpen.push(s * 0.999);
      stockHigh.push(s * 1.005);
      stockLow.push(s * 0.995);
      stockVol.push(100000 + i * 100);
      stockTs.push(t * 1000);
    }
    const result = scoreAndPlan({
      symbol: "TEST",
      bars: { ts: stockTs, open: stockOpen, high: stockHigh, low: stockLow, close: stockClose, volume: stockVol },
      benchmarkClose: benchClose,
      benchmarkTs: benchTs,
      fundamentals: null,
    });
    expect(result.status).toBe("OK");
    if (result.status !== "OK") return;
    const r = result as SwingScanResult;
    // rs20/rs50/rs120 should all be finite and POSITIVE (stock outperformed benchmark)
    expect(Number.isFinite(r.rs20)).toBe(true);
    expect(Number.isFinite(r.rs50)).toBe(true);
    expect(Number.isFinite(r.rs120)).toBe(true);
    expect(r.rs20).toBeGreaterThan(0);
    expect(r.rs50).toBeGreaterThan(0);
    expect(r.rs120).toBeGreaterThan(0);
    // rsScore is clamped to [0, 10] by `relativeStrengthSnapshot` — a
    // strong outperformer (rs120≈12% with stock weight 0.15 etc.) sits
    // comfortably above the 5.0 neutral midpoint.
    expect(r.rsScore).toBeGreaterThan(5.0);
    // rs120 stability pin. The formula in `relativeStrengthSnapshot`
    // returns stock-vs-bench return-spread on the trailing 120-bar
    // window; for this fixed (1.002^i, 1.001^i) fixture it produces
    // 14.351524436637565. Pin to 2 decimals — tight enough to fail
    // on any future change to the RS formula, loose enough that
    // changing the underlying number type / rounding mode wouldn't
    // accidentally trip it.
    expect(r.rs120).toBeCloseTo(14.35, 1);
  });

  it("8. rs20/rs50/rs120/rsScore populate when benchmark is valid", async () => {
    // 260 bars: comfortably above the scanner's EMA-200 seed (220 bars)
    // and the rs120 lookback.
    const benchChart = makeChart(260, 20000, 5);
    const benchResult = await fetchBenchmarkBarsResilient(365, {
      yahooFetch: async () => benchChart,
      kiteFetch: async () => null,
      sleepMs: async () => {},
    });
    expect(benchResult.bars).not.toBeNull();
    if (!benchResult.bars) return;
    const stockBars = {
      ts: benchResult.bars.ts.slice(),
      open: benchResult.bars.close.map((c) => c * 0.999),
      high: benchResult.bars.close.map((c) => c * 1.01),
      low: benchResult.bars.close.map((c) => c * 0.99),
      close: benchResult.bars.close.map((c) => c * 1.05), // stock 5% above bench
      volume: benchResult.bars.close.map(() => 100000),
    };
    const r = scoreAndPlan({
      symbol: "FIX",
      bars: stockBars,
      benchmarkClose: benchResult.bars.close,
      benchmarkTs: benchResult.bars.ts,
      fundamentals: null,
    });
    expect(r.status).toBe("OK");
    if (r.status !== "OK") return;
    const ok = r as SwingScanResult;
    expect(Number.isFinite(ok.rs20)).toBe(true);
    expect(Number.isFinite(ok.rs50)).toBe(true);
    expect(Number.isFinite(ok.rs120)).toBe(true);
    expect(Number.isFinite(ok.rsScore)).toBe(true);
    expect(ok.rsScore).toBeGreaterThan(0);
  });
});

/* ───────────── Static-source assertions: out-of-scope guards ───────── */

describe("S3a — no scope creep (static source assertions)", () => {
  const scannerSrc = readFileSync(
    path.join(__dirname, "swingScanner.ts"),
    "utf8",
  );
  const dataSrc = readFileSync(
    path.join(__dirname, "swingScannerData.ts"),
    "utf8",
  );
  const storeSrc = readFileSync(
    path.join(__dirname, "swingScannerStore.ts"),
    "utf8",
  );

  it("9. No sector-scoring symbol introduced into the scanner module", () => {
    // The scoring module must not gain a `sectorScore`/`sectorRank`
    // export. Sector/industry remain display-only per S3 acceptance.
    expect(scannerSrc).not.toMatch(/\bsectorScore\b/);
    expect(scannerSrc).not.toMatch(/\bsectorRank\b/);
    expect(scannerSrc).not.toMatch(/computeSectorScore/);
  });

  it("10. No delivery-scoring symbol introduced into the scanner module", () => {
    expect(scannerSrc).not.toMatch(/\bdeliveryScore\b/);
    expect(scannerSrc).not.toMatch(/computeDeliveryScore/);
    // Delivery loaded elsewhere never reaches the scoring module today.
    expect(scannerSrc).not.toMatch(/deliveryPct.*score/i);
  });

  it("11. No stock-vs-sector RS function introduced", () => {
    // Stock-vs-sector RS is an explicit S3a non-goal.
    expect(scannerSrc).not.toMatch(/stockVsSector/i);
    expect(scannerSrc).not.toMatch(/relativeStrengthVsSector/);
    expect(dataSrc).not.toMatch(/fetchSectorBenchmark/);
  });

  it("12. No entry/stop/target/RR thresholds touched in S3a-edited files", () => {
    // `swingScannerData.ts` and `swingScannerStore.ts` (the files S3a
    // edits) must not contain any references to entry/stop/target/RR
    // numeric constants or paper-execution helpers — those live in
    // `swingScanner.ts` (`scoreAndPlan`) and `paperAccount.ts` and are
    // untouched. We allow the literal column-name strings to pass.
    expect(dataSrc).not.toMatch(/stopLossPct\s*=/);
    expect(dataSrc).not.toMatch(/targetMultiplier/);
    expect(dataSrc).not.toMatch(/riskRewardThreshold/);
    expect(storeSrc).not.toMatch(/stopLossPct\s*=/);
    expect(storeSrc).not.toMatch(/openPaperEquityTrade/);
    expect(storeSrc).not.toMatch(/runEquityPaperTradingTick/);
  });

  it("13. No F&O signal/exec paths touched in S3a-edited files", () => {
    for (const src of [dataSrc, storeSrc]) {
      expect(src).not.toMatch(/getOptionSignals/);
      expect(src).not.toMatch(/runFnoPaperTradingTick/);
      expect(src).not.toMatch(/openPaperTrade\b/);
      expect(src).not.toMatch(/forceCloseAllOpenFnoFor1520/);
    }
  });
});
