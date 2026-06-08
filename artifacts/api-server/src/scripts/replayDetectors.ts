/**
 * Task #104 — runnable REAL-DETECTOR REPLAY over the 2-year 15-min CSVs.
 *
 *   pnpm --filter @workspace/api-server run replay:detectors -- --tag before
 *
 * Drives the LIVE engine (`buildSignalsForIndex`) bar-by-bar with an injected
 * `now`, prints the suppress-reason histogram + BEFORE/AFTER metrics, and writes
 * a JSON report to tools/fno-backtester/replay-<tag>.json. Honest by construction
 * (see detectorReplay.ts header) — no fabricated data.
 */

import { writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// tsx runs this as ESM (package "type":"module"), so `__dirname` is undefined.
// candleSource.resolveDataDir() reads a bare `__dirname` at call-time → expose
// one on globalThis BEFORE the loader runs so its upward repo-root walk works.
const HERE = dirname(fileURLToPath(import.meta.url));
(globalThis as unknown as { __dirname?: string }).__dirname = HERE;

import { loadHistoricalCandles } from "../lib/backtest/candleSource";
import { OPTION_INDICES } from "../lib/optionSignals";
import {
  replayIndex,
  computeMetrics,
  type ReplayResult,
  type ForwardTrade,
  type TradeMetrics,
} from "../lib/backtest/detectorReplay";

const SUPPORTED = ["NIFTY", "BANKNIFTY", "SENSEX"];

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : def;
}

function resolveDataDir(): string | null {
  let dir = HERE;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "tools", "fno-backtester", "data");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function pct(n: number | null): string {
  return n == null ? "  n/a" : `${n.toFixed(1)}%`;
}
function num(n: number | null): string {
  return n == null ? "n/a" : (n === Infinity ? "∞" : n.toFixed(2));
}

function printMetrics(rows: TradeMetrics[]): void {
  const head = ["scope", "sig", "fill", "noFill", "win%", "stop%", "tgt%", "time%", "exp(pts)", "PF", "RR", "maxDD"];
  console.log(head.map((h) => h.padStart(10)).join(" "));
  for (const m of rows) {
    console.log([
      m.scope.padEnd(10).slice(0, 10),
      String(m.signals), String(m.filled), String(m.noFill),
      pct(m.winRatePct), pct(m.stopOutPct), pct(m.targetHitPct), pct(m.timeExitPct),
      num(m.expectancyPts), num(m.profitFactor), num(m.avgPlannedRR), num(m.maxDrawdownPts),
    ].map((c) => String(c).padStart(10)).join(" "));
  }
}

async function main(): Promise<void> {
  const tag = arg("tag", "before");
  const from = arg("from", "");
  const to = arg("to", "");

  const cfgBySym = new Map(OPTION_INDICES.map((c) => [c.symbol, c]));
  const results: ReplayResult[] = [];
  const allTrades: ForwardTrade[] = [];

  for (const sym of SUPPORTED) {
    const cfg = cfgBySym.get(sym);
    if (!cfg) { console.warn(`No cfg for ${sym} — skipping`); continue; }
    const { candles, available } = await loadHistoricalCandles(sym, from || null, to || null);
    if (!available || candles.length === 0) {
      console.warn(`No candles for ${sym} (available=${available}) — skipping (no fabrication).`);
      continue;
    }
    const t0 = Date.now();
    const r = replayIndex(candles, cfg);
    results.push(r);
    allTrades.push(...r.trades);
    console.log(
      `\n=== ${sym} ===  bars=${r.barsEvaluated}  detectorSignals=${r.detectorSignalsEmitted}` +
      `  HC=${r.hcEmitted}  baselineOutlook=${r.baselineOutlookEmitted}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
    );
    console.log("-- top suppress reasons --");
    for (const b of r.suppress.slice(0, 12)) {
      console.log(`   ${b.detector.padEnd(22)} ${b.category.padEnd(24)} ${b.count}`);
    }
  }

  if (results.length === 0) {
    console.error("No data for any instrument — report not written (honest unavailable).");
    process.exit(1);
  }

  // Honest fill-quality split. CLEAN = genuine forward triggers (the trustworthy
  // headline). AMBIGUOUS = already-past chase fills (reported but NEVER mixed into
  // the CLEAN headline, so a missed move can't masquerade as an instant win).
  const clean = allTrades.filter((t) => t.fillQuality === "CLEAN");
  const ambiguous = allTrades.filter((t) => t.fillQuality === "AMBIGUOUS");
  const noFillCount = allTrades.filter((t) => t.fillQuality == null).length;
  console.log(
    `\nFill quality: CLEAN=${clean.length}  AMBIGUOUS(chase)=${ambiguous.length}  NO_FILL=${noFillCount}` +
    `  of ${allTrades.length} emitted detector signals`,
  );

  console.log("\n===== FORWARD-TEST METRICS (modeled ATM Δ≈0.5 proxy; intraday only) =====");
  console.log("-- TRUSTWORTHY: CLEAN forward-trigger fills only --");
  const cleanMetrics: TradeMetrics[] = [];
  cleanMetrics.push(computeMetrics("CLEAN-ALL", clean));
  cleanMetrics.push(computeMetrics("CLEAN-HC", clean.filter((t) => t.tier === "HIGH_CONVICTION")));
  cleanMetrics.push(computeMetrics("CLEAN-BASE", clean.filter((t) => t.tier === "BASELINE")));
  for (const key of ["TREND_CONTINUATION", "VWAP_RECLAIM", "VOLUME_BREAKOUT", "EMA_PULLBACK", "MEAN_REVERSION"]) {
    const ts = clean.filter((t) => t.setupKey === key);
    if (ts.length > 0) cleanMetrics.push(computeMetrics("CLN_" + key.slice(0, 6), ts));
  }
  printMetrics(cleanMetrics);

  console.log("\n-- AMBIGUOUS already-past chase fills (informational; NOT the headline) --");
  printMetrics([computeMetrics("AMBIG-ALL", ambiguous)]);

  console.log("\n-- ALL fills combined (clean+chase) + per-index / per-tier --");
  const metrics: TradeMetrics[] = [];
  metrics.push(computeMetrics("ALL", allTrades));
  metrics.push(computeMetrics("HC", allTrades.filter((t) => t.tier === "HIGH_CONVICTION")));
  metrics.push(computeMetrics("BASELINE", allTrades.filter((t) => t.tier === "BASELINE")));
  for (const sym of SUPPORTED) {
    const ts = allTrades.filter((t) => t.index === sym);
    if (ts.length > 0) metrics.push(computeMetrics(sym, ts));
  }
  printMetrics(metrics);

  const dataDir = resolveDataDir();
  if (dataDir) {
    const outPath = join(dataDir, "..", `replay-${tag}.json`);
    await writeFile(
      outPath,
      JSON.stringify(
        {
          tag,
          generatedAt: new Date().toISOString(),
          window: { from: from || null, to: to || null },
          caveats: [
            "Option P&L is a modeled ATM |delta|≈0.5 proxy on the real spot move — NOT money-accurate (no IV/theta/gamma/slippage).",
            "Index candles carry no volume; the engine's volumeless degradation is exercised as-is, never fabricated.",
            "gateCtx undefined: live-only bias-flip / RS / win-rate demote gates are omitted (they would only suppress MORE, never hide a suppression).",
            "Intraday only: no overnight holds; 15:20 IST / session-close force-exit.",
            "Honest fill model: CLEAN = genuine forward triggers (trigger NOT yet satisfied at signal close, later bar touches it; fill AT the level). AMBIGUOUS = already-past plans chased at the next bar's OPEN (real price, never the stale level). TARGET only books beyond the actual fill; same-bar entry+target is disallowed; stop checked first. The CLEAN scope is the trustworthy headline; AMBIGUOUS is reported separately and never mixed in.",
          ],
          fillQuality: {
            clean: clean.length,
            ambiguousChase: ambiguous.length,
            noFill: noFillCount,
            ofEmitted: allTrades.length,
          },
          cleanMetrics,
          perIndex: results.map((r) => ({
            index: r.index,
            barsEvaluated: r.barsEvaluated,
            detectorSignalsEmitted: r.detectorSignalsEmitted,
            hcEmitted: r.hcEmitted,
            baselineOutlookEmitted: r.baselineOutlookEmitted,
            suppress: r.suppress,
          })),
          metrics,
          trades: allTrades,
        },
        null,
        2,
      ),
      "utf8",
    );
    console.log(`\nReport written: ${outPath}`);
  }
}

main()
  .then(() => process.exit(0)) // open DB/Kite handles keep the loop alive otherwise
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
