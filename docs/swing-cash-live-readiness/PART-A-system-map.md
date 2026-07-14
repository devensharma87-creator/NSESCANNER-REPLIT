# Part A — Current Swing CASH System Map

**Scope:** Swing **Cash/Equity** segment only. This map is the mandated pre-code deliverable for the
"Professional Swing Cash Live-Trading Readiness + Fast Execution" effort. It documents the existing
system as-built so later phases can attach safety/execution layers **without** touching the F&O engine,
F&O risk guards, F&O scoring, option-chain math, the capital ledger, or F&O paper trading.

> Status of this document: **read-only inventory**. No code has been written. Build phases (B–T) are
> proposed separately in `PART-A2-plan.md` and require sign-off before any execution/broker code.

---

## 1. Component inventory (the prompt's 20 required areas)

| # | Area | File(s) | Key functions / exports | Routes |
|---|------|---------|--------------------------|--------|
| 1 | Swing scanner (Pro Swing Scanner v3) | `artifacts/api-server/src/lib/swingScanner.ts` | `scoreAndPlan`, `marketStructure`, `detectSupplyDemandZones`, `fixedVolumeProfile` | — (internal) |
| 2 | Swing signal generation | `artifacts/api-server/src/lib/swingSignals.ts` | `buildAllSwingSignals`, `computeSwingLevels` (ATR-based entry/stop/target plan; FNO_EQUITY_UNIVERSE ~236) | — |
| 3 | Signal scoring + STRONG_BUY/BUY/NEUTRAL/SELL classification | `artifacts/api-server/src/lib/scoring.ts` | `buildRecommendation` (score → label), weighting of technical/volume/price-action | `/api/scanner/evaluate` |
| 4 | Daily scan scheduler + manual trigger | `artifacts/api-server/src/lib/swingScannerStore.ts` (Deep Scan 15:35 IST latch + 15-min intraday `setInterval`); `artifacts/api-server/src/routes/scanner.ts` | `runDeepScan`, `runIntradayRefresh`, `refreshScanInBackground` | `POST /api/scanner/refresh`, `POST /api/scanner/full-nse/start` |
| 5 | Signal storage | `lib/db/src/schema/swingScan.ts` | `swing_scan_result` (PK symbol+scan_date), `swing_scan_run` (run metadata; cold-start latch) | — |
| 6 | Paper equity auto-open | `artifacts/api-server/src/lib/paperTradingEq.ts` | `openPaperEquityTrade` (FOR UPDATE tx, all gates, debit, insert) | side-effect of scan tick |
| 7 | Paper equity exits / MTM | `artifacts/api-server/src/lib/paperTradingEq.ts` | `evaluateOpenEquityTrades`, `closePaperEquityTradeRow` (T2 hit, stop hit, trail to T1, 30-day time stop) | `POST /api/paper/eq/eval` |
| 8 | Entry/SL/target1/target2 calc | `artifacts/api-server/src/lib/scoring.ts` + `swingSignals.ts` | `buildRecommendation` levels; `computeSwingLevels` (ATR + 20-bar swing low) | — |
| 9 | R:R calculation | `artifacts/api-server/src/lib/scoring.ts` | within `buildRecommendation` | — |
| 10 | Position sizing | `artifacts/api-server/src/lib/paperTradingEq.ts` (`perPosition = accountValue / max(BASE_SLOTS, openCount+1)`); pure mirror `equitySizingHelper.ts` | `computeEquitySizingPreview` | `GET /api/paper/eq/sizing-preview`, `GET /api/paper/eq/candidates-diagnostic` |
| 11 | Portfolio integration | `artifacts/api-server/src/routes/portfolio.ts`; FE `artifacts/scanner/src/lib/portfolio/*` | CRUD `/portfolios/*` | `/api/portfolios/*` |
| 12 | Swing UI pages | `artifacts/scanner/src/pages/stocks-to-watch.tsx` (`TechScanSection`, `SwingFreshnessPanel`, `DataSourceBadge`); view logic `lib/stocksToWatchView.ts` | `deriveRowBadges`, `candleSourceBadge` | consumes `GET /api/stocks-to-watch/analysis` |
| 13 | Equity paper-trade reports | `artifacts/scanner/src/pages/paper-reports.tsx`; `lib/reportsView.ts` | `EqReport`, `OverviewSection` | `GET /api/paper/reports/eq`, `/api/paper/analytics/*` |
| 14 | Data source layer (central) | `artifacts/api-server/src/lib/marketData/router.ts` | `getEquityQuote(s)`, `getEquityQuoteResolved`, `getIndexQuote`, `getEquityCandles`, `validateAgainstIndstocks` | — |
| 15 | Kite quote/candle path | `marketData/` provider wrappers (kiteFeed/kiteIntraday/kiteScanner) behind the router | (authoritative tier) | — |
| 16 | Yahoo/fallback path | `marketData/` (Yahoo = `secondary_analytics`); `swingScannerData.ts` Kite-first→Yahoo fallback | `fetchDailyBars`, `fetchBenchmarkBarsResilient` | — |
| 17 | Trust/freshness validation | `marketData/types.ts` (`TrustTier`, `TrustedQuote`, `TradeableBrand`), `validator.ts` (`buildMeta`, `isQuoteComplete`), `freshness.ts` (`computeFreshness`, `isStale`/`isHardStale`), `guard.ts` (`assertTradeable`) | — | — |
| 18 | Logs / diagnostics | `artifacts/api-server/src/routes/data.ts` | `buildDataDiagnostics`, `buildSymbolDiagnostic` | `GET /api/data/diagnostics`, `/diagnostics/symbol/:symbol`, `/diagnostics/portfolio-resolution`, `POST /api/data/compare` |
| 19 | Existing risk gates | `artifacts/api-server/src/lib/paperAccount.ts` + `paperTradingEq.ts` + `scoring.ts` | see §4 | — |
| 20 | Shadow/audit scoring | `artifacts/api-server/src/lib/swingShadowScore.ts` | `computeShadowScores` (Shadow B1 / B3) | — |

---

## 2. Architecture map

```
                       ┌──────────────────────────────────────────────┐
                       │  Central Market-Data Layer (trust-tiered)      │
                       │  marketData/router.ts                          │
                       │   • Kite  = authoritative (trade-grade)        │
                       │   • INDstocks = secondary_validation/failover  │
                       │   • Yahoo = secondary_analytics (info only)    │
                       │  validator.ts / freshness.ts / guard.ts        │
                       │   → TrustedQuote (branded) | DataMeta          │
                       └───────────────┬───────────────────────────────┘
                                       │ quotes / candles + provenance
        ┌──────────────────────────────┼───────────────────────────────┐
        ▼                               ▼                               ▼
 swingScanner.ts              swingScannerData.ts              data.ts diagnostics
 (pure scoring math)          (Kite-first → Yahoo fallback)    (owner-only health)
        │                               │
        ▼                               ▼
 swingScannerStore.ts  ── persists ──▶  swing_scan_result / swing_scan_run
 (Deep Scan 15:35 IST + 15-min refresh)
        │
        ▼
 swingSignals.ts  (buildAllSwingSignals → liquid universe + ATR plan)
        │
        ▼
 fullNseScanner.ts :: runSwingTickForLatestScan  ── bridge ──▶
        │
        ▼
 paperTradingEq.ts :: openPaperEquityTrade  (gates → debit → insert paper_trade_eq)
        │                                          ▲
        ▼                                          │ gates/constants
 paperTradingEq.ts :: evaluateOpenEquityTrades     paperAccount.ts (DD caps, stop sanity,
 (MTM, T1 trail, T2/stop/time exits)               heat, entry/concurrent caps); scoring.ts
        │                                          (computeEntrySafety)
        ▼
 paper_trade_eq (OPEN/CLOSED, realized_pnl)  ──▶  paper-reports.tsx / reportsView.ts
```

---

## 3. Trade lifecycle map (current, paper only)

1. **Deep Scan** (15:35 IST, once/day, latched on `swing_scan_run`) scores NIFTY 500 via `scoreAndPlan`.
2. **Intraday refresh** (every 15 min) updates `intraday_last`, `trigger_hit` on `swing_scan_result`.
3. **Signal build** — `buildAllSwingSignals` filters `STRONG_BUY` rows to the liquid FNO_EQUITY_UNIVERSE,
   confirms volume, computes ATR-based entry/stop/T1/T2 (`computeSwingLevels`).
4. **Auto-open bridge** — `runSwingTickForLatestScan` calls `openPaperEquityTrade`.
5. **Gate sequence** (all inside a `FOR UPDATE` account tx) — see §4. Requires `STRONG_BUY`
   (Entry-Safety POOR demotes `STRONG_BUY→BUY`, which naturally blocks auto-open).
6. **Sizing** — `perPosition = accountValue / max(BASE_SLOTS, openCount+1)`; debit balance; insert `paper_trade_eq`.
7. **Exits** — `evaluateOpenEquityTrades`: T2 hit, stop hit, trail stop→T1 once T1 hit, 30-trading-day time stop.
8. **Reporting** — `paper-reports.tsx` reads `/api/paper/reports/eq` + analytics.

> Dev/prod isolation: paper auto-trading is gated by `isPaperAutoTradingEnabled()` (prod only by default);
> dev/preview is read-only for auto-open. MTM still runs in dev.

---

## 4. Existing risk gates (current limitations baseline)

| Gate | Location | Constant / trigger | Effect |
|---|---|---|---|
| Entry-Safety Gate | `scoring.ts :: computeEntrySafety` | `STRONG_MOVE_PCT` 2.5%, `NEAR_PCT` 1.5% | POOR demotes `STRONG_BUY→BUY` (audit `LATE_ENTRY_AT_*`) → blocks auto-open |
| Stop-loss sanity | `paperTradingEq.ts` | `EQUITY_STOP_SANITY` 1%–8% | Reject entry outside band |
| Drawdown caps | `paperAccount.ts :: getEqDailyRealizedDrawdown` | daily 2% / weekly 4% / monthly 8% of ₹10L | Sticky latch; block new opens |
| Portfolio heat cap | `paperTradingEq.ts` | `PORTFOLIO_HEAT.MAX_EQ_HEAT_PCT` 0.06 | Σ risk across opens < 6% seed; fail-closed in same tx |
| Daily entry cap | `paperTradingEq.ts` | `EQUITY_RISK.MAX_NEW_PER_DAY` 3 | Hard cap new/day |
| Concurrent cap | `paperTradingEq.ts` | `EQUITY_RISK.MAX_CONCURRENT` 10 | Hard cap open positions |
| Auto-trade toggle | `paperAutoTradeFlag.ts` | `isPaperAutoTradingEnabled` (system_config + env) | Master switch (prod-only default) |

**Current limitations vs. the live-readiness spec (the gaps to close in B–T):**

- **No data-trust gate at trade-candidate level** — trust tiering exists in the market-data layer, but there is
  no per-candidate `TRADE_GRADE_KITE / INFO_ONLY_YAHOO / STALE / UNAVAILABLE / UNTRUSTED` classification feeding swing.
- **No entry-freshness/chase gate** — `trigger_hit` exists, but no `ENTRY_VALID_NOW / CHASED / STALE / TOO_CLOSE_*` classifier.
- **Sizing is slot-based, not risk-based** — no per-trade risk-% sizing, no reserve-cash / max-position-value / gap-buffer engine.
- **No sector or single-stock exposure cap** — heat is ₹-at-risk only; no sector%/single-stock% or duplicate/consecutive-day stacking control.
- **No liquidity/execution gate** — no avg-traded-value / spread / ASM-GSM / circuit checks for cash entries.
- **No event/result/corporate-action risk layer.**
- **No order staging, no fast-approval workflow, no broker execution abstraction, no reconciliation, no kill-switch.**
- **No cost/slippage model for cash delivery, no missed-opportunity tracker, no paper-vs-live comparison.**
- **No explicit mode machine** (`PAPER_ONLY / LIVE_DRY_RUN / LIVE_STAGED_APPROVAL / LIVE_AUTO_SMALL_SIZE`).

---

## 5. Data-flow map (trust enforcement)

- **Trade-grade path:** `router.getEquityQuote(s)` / `getEquityCandles` → `validator.buildMeta` →
  `freshness.computeFreshness` → `guard.assertTradeable` brands a `TrustedQuote`. Only Kite (authoritative),
  fresh, complete data is brandable. Hard-stale is rejected unconditionally; Yahoo/INDstocks are never tradeable.
- **Analytics path:** `swingScannerData.fetchDailyBars` may fall back to Yahoo for *scoring/scan display*, which
  is why scanner rows must carry provenance and why a Yahoo-sourced signal must NOT be promoted to trade-grade by
  a later Kite LTP tick.

---

## 6. Signal-to-order map (target end-state, gated)

```
swing_scan_result(STRONG_BUY) ─▶ candidate
   └▶ [B] Data Trust Gate ───────── trade-grade? (Kite fresh+complete) else block/REVIEW
   └▶ [C] Entry Freshness Gate ──── VALID_NOW / WAITING / CHASED / STALE / TOO_CLOSE_*
   └▶ [F] Liquidity Gate ────────── traded-value / spread / ASM-GSM / circuit
   └▶ [H] Event Risk Gate ───────── result-day / corp-action / unavailable→review
   └▶ [G] Exposure Gate ─────────── sector% / single-stock% / duplicate / consecutive-day
   └▶ [E] Position Sizing Engine ── risk-based qty (reserve cash, max position value, gap buffer)
   └▶ [D] swingCashRiskGuards :: evaluateSwingCashRisk → SwingCashRiskDecision (allowed/mode/severity/reasons/metrics)
   └▶ [N] Cost/Slippage Model ───── net R after charges; re-check min R:R
        │ all pass
        ▼
   [I] swing_order_staging (STAGED / APPROVAL_REQUIRED)  ← additive table, no broker order yet
        │
        ▼
   [J] Fast-Approval queue (owner one-click; final data recheck; expiry on price move)
        │ approved + global live flag
        ▼
   [K] Broker Execution Layer (DISABLED by default; LIVE_CASH_SWING_ORDER_ENABLED=false)
        ▼  [L] Reconciliation + Kill-switch    [O] Dashboard    [P] Missed-opp    [Q] paper-vs-live
```

---

## 7. Hard boundaries (must remain untouched)

F&O engine, F&O risk guards (`fnoPaperRiskGuards.ts`), F&O scoring (`optionSignals.ts`), option-chain math,
capital ledger / `paper_capital_event`, F&O paper trading (`paper_trade_fo`), combo lane. Shared broker-safety
infra (kill-switch, mode flags) may be designed to be reusable, but this task only wires it to the cash lane.
