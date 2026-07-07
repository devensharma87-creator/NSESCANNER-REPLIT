# FULL MARKET SCANNER DEEP AUDIT REPORT — 2026-07-07

**Platform:** https://marketscannerbydev.in (Market Scanner by Dev / Hrishi Associates)
**Auditor role:** senior full-stack auditor · professional Indian F&O + swing trader · quant logic reviewer · data-quality & source-honesty reviewer · risk manager · production trading-system architect
**Inputs:** full monorepo source (`artifacts/api-server` ~85K lib lines + routes, `artifacts/scanner` frontend 35 routes, `artifacts/global`, backtest engine, 3 backtest CSVs, all internal audit docs), reference file `MARKET_SCANNER_INDEPENDENT_DEEP_AUDIT_2026-07-07.md`, live production homepage fetch, external statutory-rate verification (Budget 2026 STT).
**Constraints honoured:** audit-only, zero code changes. Every PASS has evidence; every FAIL cites file/function/line and impact. Items unverifiable from source are explicitly marked **REQUIRES PRODUCTION VERIFICATION** with the exact test needed.

---

# 1. EXECUTIVE VERDICT

**Plain language:** The platform's *engineering* is genuinely professional — fail-closed premium provenance, transaction-locked capital ledger, idempotent trade paths, honest empty states, an exhaustive skip-reason taxonomy, and a data-honesty culture better than most retail and many institutional systems. The core financial mathematics (Black-Scholes, IV solver, Greeks, Max Pain, PCR, XIRR, HHI, all three position-sizing modules, lifecycle stop-priority) is **correct**.

But the platform is currently **lying to itself in three specific places**, and until those are fixed, neither the paper P&L, nor the Stage-4 backtest, nor the F&O signal cards can be trusted as evidence of edge:

1. **The scoreboards are miscosted.** Three contradictory F&O charge models coexist. The canonical one (`fnoCostModel.ts`, STT 0.15%) is statutorily correct for FY 2026-27; the Paper Reports tab still nets P&L at the stale 0.10% STT (net P&L **overstated**), and the Stage-4 real-premium replay uses the *futures* STT rate (0.05%) plus a pre-Oct-2024 exchange rate (0.053%) — while claiming "effective 2026-04-01" in its own header.
2. **The signal engine's VWAP and Volume Profile inputs are fabricated for the three indices it trades.** NIFTY/BANKNIFTY/SENSEX candles carry zero volume; `sessionVwap` degenerates to the current bar's HLC3, and — **new finding this audit** — `volumeProfile()` does *not* return null on zero volume as the code comment claims: it returns a degenerate profile with POC/VAL pinned near the window low. Result: one detector is dead (VOLUME_BREAKOUT), one is near-impossible (MEAN_REVERSION), two are mislabelled candle-shape checks (VWAP drivers), the confluence engine carries a **systematic bullish bias** (+3/−3 VP factor reads "above value" almost always), TREND_CONTINUATION gets a spurious asymmetric +8 "Above POC" driver, and **fabricated VAH/VAL/POC numbers are displayed on every F&O signal card** — a direct violation of the platform's own no-fabrication principle, hidden by a false comment.
3. **The cards and the engine describe two different strategies.** Cards say "15-min close > X"; the lifecycle fills on a touch/wick/tick. Paper results include entries the documented plan would never take.

Everything else is either verified correct, or a *documented, deliberate* realism trade-off (frozen-premium settlement, linear delta projection, level-price equity exits) whose cost is quantified in this report.

**Bottom line:** Safe today as an **analysis dashboard and disciplined paper-trading laboratory** (with the caveats above). **Not yet valid as evidence of edge.** **Not ready for semi-automated or live trading**, and — correctly — not wired for it (`broker_order_id` stays null by design). Fix the P0 list (Section 25), re-baseline, then restart the 6–12-month out-of-sample clock on clean numbers.

---

# 2. AUDIT SCOPE

**Tabs/routes audited (35 registered in `scanner/src/App.tsx:78-124`):** `/` Home, `/scanner`, `/option-chain(/:underlying)`, `/oi-lab`, `/watchlist`, `/premarket`, `/flows`, `/stocks-to-watch`, `/charting`, `/portfolio-analyser`, `/backtest-lab`, `/news`, `/learn`, `/deep-scan`, `/options` (F&O Cockpit), `/strategies`(+builder), `/sectors(/:sector)`, `/kite`, `/audit`, `/status`, `/manifesto`, `/admin`, `/infra-health`, `/fno-diagnostics`, `/daily-analysis`, `/swing-cash`, `/paper-trading`, `/paper-reports`, `/stock/:symbol`, `/index/:slug`, `/indices` (redirect), `/legal/{disclaimer,methodology,terms,privacy}`, plus not-found.

**Backend routes audited:** all 36 route files in `api-server/src/routes/` (admin, alerts, auth, backtest, buildInfo, candleWarehouse, chart, dailyAnalysis, data, dataHealth, dataParity, deepscan, equitySizing, fno, global/*, health, home, indices, instFlows, kite, oiLab, optionChain, optionChainSnapshot, optionStrategies, paper, paperCombo, parity, portfolio, scanner, stocksToWatch, swingStaging, system, tradingview, userAuth).

**Libraries read line-by-line:** optionSignals (2,876 ln), paperTradingFO (3,245 ln), optionSignalGates, optionSignalVetoes, optionSignalLifecycle, fnoExitDecision, fnoPremiumExitOverlay, fnoCostModel, fnoSizingHelper, fnoPaperRiskGuards, blackScholes, gex, oiLab, optionAnalytics, optionChain, indicators, confluenceEngine, compositeBias, scoring, paperTradingEq, paperReportsEq/FO, swingScanner, swingSignals, swingCash{Sizing,EntryGate,CostModel,RiskGuards,Exposure,Liquidity,EventRisk}, swingOrderStaging, swingTtlSweep, backtest/* (premiumReplay, backtestCharges, directional, replay, strategies/*), kiteIntraday, kiteOptionChain, kiteReadiness, indexFuturesVolume, dataProvider, tradingConfig, instFlows, giftNifty, preMarket, newsRss, universe, symbolAlias, chartDatafeed, portfolio/* (calc, risk, score…), auth/userAuth, app.ts.

**Schedulers audited:** boot-staggered jobs (`bootScheduler.ts`), 30s F&O signal cycle, kiteReadinessScheduler (setInterval), optionChainSnapshotIngestor (tick + retention), candleWarehouseIngestor (daily 5-min / intraday 15-min / retention), swingTtlSweep (10-min, unref'd), swingScannerStore (60s deep-scan latch ≥15:35 IST + intraday interval), instFlows 15-min refresh.

**Not possible from this sandbox (each marked in-line):** live DB row counts, live Kite payloads (OI units), suppressed-reason distribution in prod, scheduler uptime, live API responses behind auth (web fetch of `/api/*` blocked; homepage confirmed live and correctly positioned as "educational and research use only").

---

# 3. REFERENCE AUDIT CROSS-CHECK

Every finding in `MARKET_SCANNER_INDEPENDENT_DEEP_AUDIT_2026-07-07.md` was re-verified against the current tree, independently, with fresh greps.

| # | Reference Finding | Current Status | Evidence (file:line) | Impact | Action |
|---|---|---|---|---|---|
| R1 | Three contradictory F&O cost models | **CONFIRMED** | `fnoCostModel.ts:66` STT 0.0015; `paperReportsFO.ts:78` STT 0.001; `premiumReplay.ts:43-44` STT 0.0005 + exch 0.00053 | Every scoreboard disagrees with every other | P0-1 |
| R2 | Paper Reports STT stale at 0.10% | **CONFIRMED** | `paperReportsFO.ts:78` `const stt = 0.001 * sellTurnover; // 0.1% ... (post 1-Oct-2024)` | Net P&L **overstated** on every closed trade (STT under-charged 33%) | P0-1 |
| R3 | Backtest replay STT 0.05% + exchange 0.053% | **CONFIRMED** | `premiumReplay.ts:43-44` (constants), `:324-325` (application), header claims "effective 2026-04-01" | Replay net **overstated**: STT charged at 1/3 of statutory, exchange at 1.51× correct rate | P0-1 |
| R4 | `backtestCharges.ts` imports canonical model | **CONFIRMED CORRECT** | `backtestCharges.ts:18` imports `computeFnoTradeCost, FNO_COST_PARAMS` | Modes A/B/C consistent; Mode D (replay) is the outlier | — |
| R5 | Index candles carry zero volume | **CONFIRMED** | `kiteIntraday.ts:381-385` comment + `volume.push(c.volume > 0 ? c.volume : 0)` | Root cause of R6–R10, N1 | P0-2 |
| R6 | `sessionVwap` returns HLC3 when volume=0 → engine "VWAP" = current-bar typical price | **CONFIRMED** | `indicators.ts:144` `out[i] = v > 0 ? pv / v : typ` | VWAP drivers on cards are candle-shape checks | P0-2 |
| R7 | TREND_CONTINUATION "Spot above VWAP" (25 pts) ≈ close-in-upper-half-of-bar | **CONFIRMED** | `optionSignals.ts:611-616` uses `c.spot > c.vwap` with degraded vwap; algebra: `c > (h+l+c)/3 ⇔ c > (h+l)/2` | Biggest single confidence driver is not what its label says | P0-2 |
| R8 | VWAP_RECLAIM is a 2-bar candle reversal pattern under fake VWAP | **CONFIRMED** | `optionSignals.ts:687-720` compares closes[n-3]/[n-4] to their own bars' HLC3 | Detector mislabelled; its loss history should be reinterpreted | P0-2 |
| R9 | MEAN_REVERSION near-impossible on indices | **CONFIRMED** | `optionSignals.ts:907-910` needs `|spot−vwap| > 2×ATR15`; with vwap=lastbar HLC3, `|spot−vwap| = |2c−h−l|/3 ≤ ~⅔ bar range ≪ 2×ATR` | 1 of 5 HC detectors effectively cannot fire on the traded indices | P0-2 |
| R10 | VOLUME_BREAKOUT can never fire for indices | **CONFIRMED (with corrected mechanism)** | `optionSignals.ts:474` `lastVol: vols.at(-1) ?? null` → **0, not null** (0 not nullish); `:776-781` null-guard passes, then `volOk = 0 > 0×1.3` = false | Dead detector; suppressed log forever says "conditions not met". NOTE: the `!c.vp` early gate does NOT stop it — see N1: vp is degenerate non-null | P0-2 |
| R11 | Futures-volume VWAP exists only for Charting, never feeds signals | **CONFIRMED** | `indexFuturesVolume.ts:2-3` "used solely to give the Charting tab a real, volume-weighted VWAP"; header: "NEVER touches signals" | The fix module exists but is wired to the wrong consumer | P0-2 fix path |
| R12 | Card says "15-min close >" but lifecycle enters on touch | **CONFIRMED** | Cards: `optionSignals.ts:663,753,820,…`; engine: `optionSignalLifecycle.ts:194` `hi >= entry : lo <= entry` (bar high or live tick) | Paper book takes wick entries the plan excludes; human/engine parity broken | P0-3 |
| R13 | MACD signal-line warm-up (nulls→0) | **CONFIRMED** | `indicators.ts:91` `macdNumeric = macdLine.map(v => v ?? 0)` feeds zeros into signal EMA | First ~35 bars of signal/hist distorted; worst on short daily series (new listings) in Deep Scan/swing | P1 |
| R14 | Frozen-premium settlement (no market exit premium) | **CONFIRMED** | `paperTradingFO.ts:2521-2535` `pickExitPremium` returns locked stop/target/last premium; `fnoExitDecision.ts:53` `settlement: "FROZEN_PREMIUM"` (documented deliberate) | Realized F&O P&L is a directional-accuracy ledger, not a market P&L estimate (theta/gamma/IV ignored at exit) | P1 shadow column |
| R15 | Gross vs net P&L visibility | **CONFIRMED** | Paper Trading tab balance/cards gross (`paper-trading.tsx:610` `unrealizedPnl = currentValue − invested`, no charges); Paper Reports nets charges (`paperReportsFO.ts:202`) — but at the wrong rate (R2) | User sees ~0.9–1.3% of round-trip premium turnover better than reality on the live tab | P1 |
| R16 | Equity sizing slot-based, not risk-based | **CONFIRMED** | `paperTradingEq.ts:~388-392` `perPosition = accountValue / max(BASE_SLOTS, open+1)`; stop-sanity 1–8% ⇒ up to 6.5× rupee-risk spread per position | Cross-segment expectancy stats not risk-comparable | P2 |
| R17 | Kite OI unit assumption (contracts vs units) | **NEEDS LIVE DATA VERIFICATION** | `gex.ts:9-20` asserts contracts, "proof" cites own `oiLab.ts:1716` (circular); `kiteOptionChain.ts:197,280` passes `q.oi` raw | If Kite OI is units, GEX & OI rupee notionals inflated ~lotSize× (75× NIFTY) | P1-V1: compare one liquid strike's Kite `q.oi` vs NSE site OI×lot at same minute |
| R18 | Suppressed-reason / setup-emission distribution | **NEEDS PRODUCTION DB VERIFICATION** | Query `option_signal_history` + suppressed logs 30d | Prediction from code: MEAN_REVERSION & VOLUME_BREAKOUT ≈ 0 emissions on indices; TREND_CONTINUATION dominant | P1-V2 |
| R19 | ATR = EMA-smoothed, not Wilder | **CONFIRMED** | `indicators.ts:25` `return ema(trs, period)` | Internally consistent; differs from TradingView/Pine — document once | P3 |
| R20 | NSE holiday calendar absent | **CONFIRMED** | `fnoTradingDays.ts` Mon–Fri only (per prior audit; file re-checked) | DTE guards & expiry analytics wrong around exchange holidays | P2 |
| **N1** | **NEW CONTRADICTION FOUND: fake Volume Profile** | **NEW — not in reference audit** | See Section 4 / F-02 | Fabricated VP levels on cards + systematic bullish signal bias | **P0-2 (expanded)** |

---

# 4. HIGHEST-RISK FINDINGS (P0 and severe P1 only)

### F-01 (P0) — Contradictory & statutorily wrong cost models corrupt both scoreboards
- **Files:** `paperReportsFO.ts:71-92` (`computeFOCharges`), `backtest/premiumReplay.ts:41-51,320-335` (`FNO_COST_RATES`), canonical `fnoCostModel.ts:61-91`.
- **Statutory fact (externally verified):** Budget 2026 raised STT effective 1-Apr-2026 to **0.15% on options premium (sell)**, **0.15% on exercise intrinsic**, **0.05% on futures**; equity delivery/intraday unchanged; NSE options exchange txn charge remains **0.03503%**.
- **Wrong:** Paper Reports nets at 0.10% STT (net P&L overstated). Replay charges options at the *futures* rate 0.05% and exchange at 0.053% — under-costing STT 3× and over-costing exchange 1.51×, net effect: **replay net P&L overstated**; your 21-trade Stage-4 run's conclusion is invalid until re-run.
- **Trust impact:** the platform's proudest claim — "after-charges P&L you would actually see at a broker" (paperReportsFO header) — is currently false.
- **Fix (on approval):** delete both local blocks; import `FNO_COST_PARAMS`; add structural test asserting a single charge constant object for all options-charge consumers (same pattern as the import-allowlist tests).

### F-02 (P0) — Zero-volume indices → fake VWAP **and fake Volume Profile**; false comment hides it; fabricated numbers on cards; systematic bullish bias
Beyond the reference audit's VWAP finding, this audit found the **VP layer is worse than believed**:

- `indicators.ts volumeProfile()` (lines 155-198) checks only `n < 10` and `hi <= lo`. **There is no zero-total-volume guard.** With all-zero volumes: every bucket = 0, `pocIdx` stays 0, `targetVA = 0`, the value-area loop exits immediately → it returns a **non-null degenerate profile**: `POC = windowLow + 0.5·step`, `VAL = windowLow`, `VAH = windowLow + step` (step = range/bins).
- The comment at `optionSignals.ts:347-349` — *"`volumeProfile` returns null when total volume is zero, so this is naturally null for those indices"* — is **factually false**. Both `vp` (daily, 30 bins/60 days) and `vpIntraday` (24 bins/60 intraday bars) are degenerate fake profiles for NIFTY/BANKNIFTY/SENSEX.
- **Consequence 1 — fabricated display:** `toSignal()` publishes `valueAreaHigh/valueAreaLow/pointOfControl` and the intraday variants on every F&O card (`optionSignals.ts:1180-1284`). For indices these are **fabricated levels** (VAH ≈ 60-day low + range/30). Direct violation of the platform's no-fabrication rule, invisible to the user.
- **Consequence 2 — systematic bullish signal bias:** `confluenceEngine.scoreVolumeProfile` (lines 141-178) gives **+3 to BULLISH / −3 to BEARISH** whenever `spot > VAH` — and with fake VAH pinned near the window low, spot is above it almost every bar of every session. A structural ~6-point confidence spread favouring CALLs on every trend-class setup.
- **Consequence 3:** TREND_CONTINUATION's "Above POC" driver (`optionSignals.ts:627,635`, +8) fires nearly always for BULLISH and nearly never mirrors for BEARISH — a second asymmetric bullish boost. MEAN_REVERSION's "Inside-value pull" (+5) similarly biased bullish.
- **Consequence 4:** VOLUME_BREAKOUT's `!c.vp` early gate does **not** protect it (vp is non-null); the detector survives to the volume gate and dies there (`0 > 0×1.3`). Dead either way, but the code's mental model of *why* is wrong.
- **Trader translation:** on the three indices, the F&O engine has an unexamined **structural long tilt**. Check your CALL-vs-PUT outcome split in prod — this predicts CALL over-representation independent of market direction.
- **Fix path (on approval):** (a) add `if (totalVol <= 0) return null` to `volumeProfile()` and make `sessionVwap` return null on zero cumulative volume (fail-closed, matching platform philosophy); or (b) wire the existing `indexFuturesVolume` merge into the signal engine's intraday fetch behind a flag with provenance tags. Either way: stop publishing VP fields on index cards until real, and delete the false comment. **Behaviour-changing → shadow-compare 2 weeks; resets WIN_RATE_CALIBRATION sample meaning.**

### F-03 (P0) — Card wording vs execution semantics
- Cards: "15-min close > X" (`optionSignals.ts:663` and every detector). Engine: touch trigger `hi >= entry` (`optionSignalLifecycle.ts:194`), with live Kite tick overlay. Same-bar trigger+stop resolves stop-first (worst case). Paper book systematically takes wick-poke entries; part of the "stopped by a single wick" loss pattern is self-inflicted; live-transition parity broken. **Fix:** close-confirmed triggering OR reword cards to "spot touches X". One truth.

### F-04 (severe P1) — Frozen-premium settlement + linear delta projection (documented, but quantify it)
- `enrichBundlesWithOptionLevels` (`optionSignals.ts:1893-2090`): premiums projected as `LTP + delta×Δspot`, constant delta (ATM ±0.5 closed-form fallback when Greeks missing — honestly not published as `optionDelta` in that case, good). Exits settle at these **locked** premiums (`pickExitPremium`). Ignored at exit: theta (overstates winners held hours), gamma (understates winners / overstates stop losses — partially offsetting), IV shifts (stop during vol spike settles too cheap). Premium hard-stop overlay caps blowups at ~−1R but also settles at the locked stop premium — real slippage below stop never recorded.
- **Cheapest honest upgrade:** decision-neutral `exit_premium_market` shadow column (nearest fresh option-chain snapshot LTP at exit) — you already snapshot chains every sweep. After ~50 trades the frozen-vs-market gap becomes measured, not argued.

### F-05 (severe P1) — Kite OI units unverified → GEX/OI notional possibly inflated 75×
- `gex.ts` multiplies `q.oi × lotSize` on the assertion that Kite OI is contracts; the "PROOF" cites the platform's own `oiLab.ts` making the same assumption — **circular**. One 2-minute empirical test settles it (R17). Until then, treat GEX magnitudes, flip point ranking, and OI rupee notionals as **unverified**. (UI already labels GEX "MODELLED — not exchange provided" and it feeds no trading decision — correct containment.)

---

# 5. WHAT IS RIGHT (verified, with the check performed)

**Mathematics (line-verified):**
- **Black-Scholes** (`blackScholes.ts`): price/delta/gamma/vega/theta/rho with q-adjustment; theta per calendar day /365; vega per 1% IV; A&S 26.2.17 CDF (≤7.5e-8). Correct.
- **IV solver:** Brenner-Subrahmanyam seed; Newton step `σ − diff/(vega×100)` — correct unit handling (vega is per-1%); bisection fallback [1e-4, 5]; intrinsic sanity `marketPrice < intrinsic − 1e-4 → null`. Correct. (Minor: put intrinsic omits `e^{-qT}` on S; q≈0 for indices, immaterial.)
- **`yearsToExpiry`:** 15:30 IST = 10:00 UTC settlement, 1-hour floor. Correct.
- **Max Pain** (`optionAnalytics.ts:20-30`): Σ(T−K)·CE_OI(K<T) + Σ(K−T)·PE_OI(K>T), min over targets — canonical writers'-payout formulation. Correct.
- **PCR OI/volume, pivots (classic floor), ADX** (Wilder smoothed sums, SMA-seeded ADX RMA — canonical), **RSI/EMA** (shared single-source `@workspace/indicators`), **bbWidth** (population σ), **supportResistance**, **rollingVwap** (HLC3). Correct.
- **XIRR** (`portfolio/calc.ts:240`): sign check, Newton with −0.9999 floor, 200-iter bisection over [−0.9999, 100], clamped. Professional. **HHI** and structure score previously verified; re-spot-checked.
- **F&O lot sizing** (`fnoSizingHelper.ts`): min(risk-budget, heat-headroom, ceiling) with floor semantics, correct rejection ordering, full workings surfaced. Correct.
- **Swing-cash sizing** (`swingCashSizing.ts`): min(byRisk, byValue, byCash) with lot flooring, slippage-buffered affordability, gap-adjusted max loss, fail-closed on non-finite (the NaN-slips-through-guards comment shows real care). Correct.
- **Composite bias** (`compositeBias.ts`): the documented deviation from the spec's internally-inconsistent ×10/1.71 fudge is the *right* engineering call, honestly annotated; null signals excluded from numerator AND denominator (no false neutrals). Correct.
- **Equity delivery charges** (`paperReportsEq.ts`): STT 0.1% both sides, NSE 0.00297%, SEBI ₹10/cr, GST 18% on (brokerage+txn+SEBI), stamp 0.015% buy, DP ₹15.93/scrip/sell — matches FY 2026-27 (Budget 2026 left cash rates unchanged). **Correct — the equity cost model is the one that's right.**
- **`fnoCostModel.ts`** itself: STT 0.15% sell-premium, 0.15% exercise-intrinsic (published, correctly unapplied for premium closes), 0.05% futures (published-only), exchange 0.03503%, SEBI ₹10/cr, GST base correct, stamp 0.003% buy, spread 25bps + slippage 10bps per side, open-trade one-sided handling (1 brokerage leg, no STT, null P&L) vs closed-at-zero (2 legs, STT 0). **Correct and well-designed** — it just isn't imported by the two consumers that matter.
- **Lifecycle** (`optionSignalLifecycle.evaluateTransition`): stop-wins-on-same-bar (worst case for trader), runner-after-T1 still stoppable at original stop (no phantom trail), T2-before-T1 ordering protected upstream by the `cappedT2Dist <= newT1Dist → reject` invariant in `clampPlanForIntraday`. Correct and conservative.

**Engineering (structurally verified):**
- **F&O open path** is a defense-in-depth stack: fail-closed `assertTradeableForOpen` → Kite-only premium-trust gate (chain provenance + per-leg LTP>0 AND OI>0, demote to INFO_ONLY otherwise) → confidence floor → idempotent existing-row check → market-hours → consecutive-stops pause → daily/weekly DD caps → 15:25/14:45 cutoffs → 30% premium-loss stop cap → liquidity gates (LTP floor fail-closed, spread best-effort with honest fail-open on transient chain errors, missing-strike fail-closed, OI=0 fail-closed) → **FOR UPDATE account lock** → txn-internal BASELINE guardrails (fail-CLOSED with alert counter when stats unavailable) → dynamic sizing → post-stop & VOLATILE multipliers (reduce-only, floor 1) → final fail-closed heat assertion → **explicit cash-affordability check** (`balance < capitalDeployed` refuses) → ON CONFLICT insert + **predicated atomic debit** whose failure throws and rolls back the insert. This is textbook.
- **Exit trust gate** (`fnoExitDecision.ts`): fail-closed precedence CONTRACT_INVALID → KITE_UNAVAILABLE → DELAYED_YAHOO → STALE/asOf-null → freshness>120s; blocked evaluations still compute `wouldHaveExited` for diagnostics but can never mutate. Correct.
- **Corrective exits not gated by read-only mode** (15:20 force-exit, orphan reconciliation, premium hard-stop overlay) — the dev/prod isolation rule gates OPENs, not closes. Correct asymmetry.
- **Info-only / Baseline cannot open trades** under hygiene v2: `deriveTradeClass` + `isAutoTradeableSizingTier` + the tradeability assertion; legacy BASELINE lane reachable only with the flag OFF (rollback path). Correct.
- **Gate/veto system:** daily-EMA50 HTF, true 1h aggregation (session-aware 4-bar chunking, orphan-chunk drop, never spans the overnight gap — verified), RS-vs-NIFTY with benchmark self-exclusion, rolling win-rate demotion with MIN_SAMPLE guard, recovery/chase vetoes, opening/closing noise, expiry-day, VIX intraday + gap spike, bias-flip cooldown, correlated-bucket suppression, stale-PENDING expiry, clean-vs-demoted top-3 partition (a clamped 80-conf can't displace a clean 75-conf). Professional design.
- **MTM sweep:** GREATEST/LEAST watermarks, decision-neutral, idempotent, fail-quiet per row. Exit-monitor health accumulator is **per-invocation** (no cross-attribution between concurrent cycles — architect-reviewed and verified in code).
- **Swing staging:** state machine with `broker_order_id` permanently null, TTL sweep (10-min, unref'd), entry gate (chase/too-close/stale/rrNow-from-LTP classification math verified), dry-run broker isolation, kill switch present.
- **Security/API:** helmet, CORS allowlist with prod wildcard refusal, login rate-limiters on both auth routes, global `requireAuth` at `app.ts:201`, `requireOwner`/`requireOwnerStrict` for owner routes (`userAuth.ts:220,253`), owner-only tabs enforced in the SPA router AND server-side.
- **Honest empty states:** chartDatafeed "Bars are NEVER fabricated — explicit empty state" (`chartDatafeed.ts:5-6`) with source/tier/provenance/fallback fields; GIFT NIFTY fixed to real NSE-IX front-month futures after the old ^NSEI-proxy dishonesty was identified and removed (`giftNifty.ts` header — the platform *found and fixed its own* fake-proxy issue here, which is exactly the culture that makes F-02's false comment stand out).
- **Compliance posture:** production homepage meta verified live: "For educational and research use only" — correct positioning for an unregistered analytics platform (no advisory claims).

---

# 6. WHAT IS WRONG (defects)

Consolidated defect register (details in Sections 4, 11–13, 21):

| ID | Defect | File:Line | Severity |
|---|---|---|---|
| F-01 | Paper Reports STT 0.10% (stale) | `paperReportsFO.ts:78` | P0 |
| F-01 | Replay STT 0.05% (futures rate) + exchange 0.053% (pre-Oct-2024) | `premiumReplay.ts:43-44,324-325` | P0 |
| F-02 | `volumeProfile()` no zero-volume guard → degenerate fake profile | `indicators.ts:155-198` | P0 |
| F-02 | False comment claiming VP "naturally null" for indices | `optionSignals.ts:347-349` | P0 |
| F-02 | Fabricated VAH/VAL/POC published on index F&O cards | `optionSignals.ts` toSignal fields | P0 |
| F-02 | Confluence VP factor systematic bullish tilt (+3/−3) | `confluenceEngine.ts:141-178` | P0 |
| F-02 | Asymmetric "Above POC" +8 driver | `optionSignals.ts:627,635` | P0 |
| F-02 | `sessionVwap` fails soft (HLC3) on zero volume | `indicators.ts:144` | P0 |
| F-02 | VOLUME_BREAKOUT dead (`0` not nullish; volOk `0>0`) | `optionSignals.ts:474,776-781` | P0 |
| F-02 | MEAN_REVERSION near-impossible on indices | `optionSignals.ts:907-910` | P0 |
| F-03 | Trigger wording vs touch execution | `optionSignals.ts:663…` vs `optionSignalLifecycle.ts:194` | P0 |
| F-06 | MACD signal warm-up nulls→0 | `indicators.ts:91` | P1 |
| F-07 | Equity paper exits settle AT stop/target level even on gap-through (`ltp ≤ stop ⇒ close at stop`) — overnight gap risk understated for delivery positions | `paperTradingEq.ts:6-11,606-626` | P1 |
| F-08 | Equity slot-based sizing (risk spread up to 6.5× across positions) | `paperTradingEq.ts:~388` | P2 |
| F-09 | NSE holiday calendar absent (Mon–Fri assumed trading) | `fnoTradingDays.ts` | P2 |
| F-10 | `last10Vol = vols.slice(-20)` misleading name; MR t1/t2 identical ternaries; sizing helper accepts stop>entry via Math.abs (callers validate) | `optionSignals.ts`, `fnoSizingHelper.ts` | P3 |

---

# 7. WHAT IS MISLEADING / FAKE / SYNTHETIC / STALE / OVERCLAIMED (strict)

1. **FAKE (unlabelled):** VAH/VAL/POC on index F&O signal cards (F-02). The single worst honesty breach in the platform — everything else fake is labelled; this is fake *and* the code comments assert it's handled.
2. **MISLEADING (mislabelled):** "Spot above VWAP", "VWAP reclaim", "Volume confirmation" drivers on index cards — the words describe session-VWAP/volume logic; the math is single-bar candle shape / dead checks.
3. **MISLEADING (wording):** "15-min close > X" entry triggers vs touch execution (F-03).
4. **OVERCLAIMED:** paperReportsFO header — "what the same trade would actually cost at a discount broker" — currently false by 50% on STT (F-01). Replay header citing "effective 2026-04-01" above wrong rates is worse: right date, wrong law.
5. **STALE-BY-STATUTE:** the 0.10%/0.05%/0.053% rate constants (F-01).
6. **SYNTHETIC BUT HONEST (no action needed, listed for completeness):** Modes B/C modeled ATM premium @0.7% of spot — clearly labelled in the UI assumptions panel (`backtest-lab.tsx:352-353`); GEX "MODELLED — not exchange provided"; BS-modelled replay legs flagged per-leg; ATM-delta fallback deliberately NOT published as `optionDelta`; historical CSVs' synthetic premium layer already labelled after the June audit.
7. **PROXY BUT HONEST:** Pre-market global cues weighted composite with explicit `category: "proxy"` for GIFT (`preMarket.ts:41,98`); GIFT itself now real NSE-IX futures, not the old ^NSEI fake.
8. **CANNOT CONFIRM FRESHNESS IN PROD (mark, don't accuse):** whether every tab's as-of timestamp renders on mobile widths; whether IV history for BANKEX/NIFTYNXT50 is still stale (prior audit flagged 05-08); whether `candle` warehouse still has 0 rows; whether `tv_alerts` still stale since 2026-04-24. **REQUIRES PRODUCTION VERIFICATION** (one SQL each).

---

# 8. WHAT IS MISSING (professional-platform gaps)

**Risk/controls:** NSE holiday calendar; entry slippage model on paper fills (exits have the overlay; entries fill at projected premium exactly); freeze-quantity multi-order brokerage note (moot at ≤10-lot ceilings — tie the assumption to the ceiling in code); gap-through exit modeling for equity/swing (F-07); per-setup expectancy-after-costs dashboard; **in-sample/out-of-sample wall** (your own key reframe — still absent).
**Data:** futures-volume candles for the signal engine (module exists, unwired); real exit premium capture (F-04 shadow column); full-NSE scan completion (cached ~198-row partial set with loud label — Stage-2 backlog, still open); NSE bhavcopy blocked from prod IP (known, open); corporate-actions adjustment layer for long swing lookbacks.
**Analytics:** CALL/PUT outcome-split monitor (would have caught F-02's bias empirically); suppressed-reason distribution page (Stage-3 backlog); MFE/MAE distribution per setup; slippage/settlement-gap report once F-04 column exists.
**Product:** visible "net of est. charges" line on Paper Trading account card; per-card data-freshness chip standardisation across all tabs; Pine-subset import (Stage-5, planned).

---

# 9. FULL TAB-BY-TAB AUDIT

Legend: Src = primary source; Fresh = as-of visible; Verdict per tab. All money/level values traced to backend; **no client-side re-derivation of P&L/RR/charges found anywhere** (paper-reports, paper-trading, options, backtest-lab, swing-cash line-checked — frontend renders server payloads).

| Tab | Path | Purpose | Key line items | Backend route / lib | DB | Src & label | What's right | What's wrong/missing | Priority |
|---|---|---|---|---|---|---|---|---|---|
| Home / Market Pulse | `/` | Snapshot: indices, breadth, bias | Index quotes, movers, pulse | `routes/home.ts`, indicesBoard, liveBias | cache | Kite→Yahoo w/ provider status | Server-computed; provider reason strings honest | Freshness chip consistency to verify in prod | P3 |
| Scanner | `/scanner` | Equity scan | Price, RSI/EMA, score, reco | `routes/scanner.ts`, scoring, kiteScanner | scan cache | Kite/Yahoo labelled | Scoring lib verified; provenance module exists | **Full-NSE partial ~198-row cached set** needs loud partial-coverage label (open Stage-2) | P1 |
| Deep Scan | `/deep-scan` | Per-stock deep score | Technicals, fundamentals, verdict | `routes/deepscan.ts` (+honesty tests) | — | mixed, labelled | Honesty tests exist (`deepscan.honesty.test.ts`) | MACD warm-up (F-06) worst here on short series | P1 |
| Stock Detail | `/stock/:symbol` | Full stock page | Quote, chart, financials | chart + financials libs | — | labelled | Resolver + alias dict (ONGC/OIL, TATACAPITAL, ABREL… `symbolAlias.ts:20-25`) | Universe = 278 curated symbols — not full NSE; search beyond universe depends on instrument-master path (verify TRIDENT/BDL/CDSL/ARE&M/BLS/INDHOTEL resolve in prod) | P2 |
| Watchlist | `/watchlist` | Lists/baskets | Quotes, alerts | watchlist(+Basket,Lists) | tables | Kite/Yahoo | Tested (watchlist.test, consumerImports test) | — | P3 |
| Portfolio Analyser | `/portfolio-analyser` | Holdings analytics | Value, day/total P&L, **XIRR**, HHI, allocation, score | `routes/portfolio.ts`, `scanner/lib/portfolio/*` | portfolios tables | price labelled; missing→honest | XIRR/HHI verified correct; benchmark prefs; CSV import tested | Corporate-action adjustments absent (splits distort long-window returns) | P2 |
| Indices / Index detail | `/indices→/index/:slug` | Index analytics | Levels, internals | indicesBoard | — | Kite | Analytics tests exist | — | P3 |
| Sectors | `/sectors(/:name)` | Sector strength | Sector avgs, quartiles | sectorMap/Strength/Coverage | — | derived | Coverage tests | — | P3 |
| Flows | `/flows` | FII/DII + participant OI | Cash net, part-OI | `instFlows.ts` | inst_flows | **NSE official**, ISO-dated (`instFlows.ts:5-8,73,102-112`) | Real source, real dates, provisional handling | T-1 nature should stay visible on card | P3 |
| Option Chain | `/option-chain` | Chain analytics | LTP/OI/IV/Greeks, PCR, Max Pain | `routes/optionChain.ts`, kiteOptionChain, optionAnalytics | snapshots | Kite→NSE, `spotSource/spotTrusted` explicit (`optionChain.ts:165-178,408-409,473-474`) | Max Pain/PCR verified; spot-trust separated from premium-trust (display vs signal) — correct design | Kite chain IV approximated from premium when broker omits IV (documented `kiteOptionChain.ts:39`) — label fine; OI units V1 pending | P1(V1) |
| OI Lab | `/oi-lab` | OI analytics | Buildup, sentiment, GEX, notionals | `oiLab.ts` (4,663-ln page) | snapshots | modelled GEX labelled | Sentiment scoring sound; support/resistance spot-side filtering fixed; buildup reuses real priceChg+oiChg | **GEX/notional magnitudes unverified pending V1 OI-unit test** | P1 |
| F&O Cockpit | `/options` | Signal cards + lifecycle | Setups, drivers, entry/SL/T1/T2, RR, premiums, tags | `routes/fno.ts`, optionSignals + full gate stack | option_signals, lifecycle | **Kite-only enforced** (Yahoo fallback disabled for F&O, `optionSignals.ts:2345-2367`) | Gates/vetoes/partition/lifecycle correct; premium provenance fail-closed; data-quality chip | **F-02 fake VP fields + mislabelled VWAP drivers; F-03 trigger wording; dead/near-dead detectors** | **P0** |
| F&O Diagnostics | `/fno-diagnostics` | Owner ops | Skip reasons, exit-monitor health | facades | reasoning log | internal | Per-invocation health accumulators verified | Add suppressed-distribution rollup (Stage-3) | P1 |
| Paper Trading | `/paper-trading` | Live paper book | Open positions, MTM, balance | `routes/paper.ts`, paperTradingFO/Eq/Combo | paper_trade_*, paper_account | Kite-trusted only for opens | Entire open/exit/ledger stack verified (Section 5) | **Gross P&L on tab (R15); frozen-premium settlement (F-04)** | P1 |
| Paper Reports | `/paper-reports` | Realized analytics | Daily/monthly buckets, gross/net, charges | paperReportsFO/Eq | closed rows | charges itemised | Structure & aggregation correct; open trades excluded from realized; EQ charges correct | **F&O STT rate wrong (F-01) → net overstated** | **P0** |
| Backtest Lab | `/backtest-lab` | Modes A–D | Trades, P&L, pricing-mode mix, DQ panel | `routes/backtest.ts`, backtest/* | backtest, snapshots | mode flags, modeled fields amber-flagged, blanks stay blank | Taxonomy (REAL/PARTIAL/BS/PROXY/UNAVAILABLE) honest; 5-min tolerance hard; coverage % flagged; anti-fabrication tests | **Replay cost block wrong (F-01)**; Modes B/C directional-only (honest) | **P0** |
| Strategies / Builder | `/strategies` | Multi-leg payoffs | Legs, payoff, greeks | optionStrategies | — | chain-sourced | Spot-checked, no issues found (not exhaustively re-derived) | Deeper payoff-math pass optional | P3 |
| Swing Cash | `/swing-cash` | Staged swing orders | Entry gate class, sizing, risk decision, TTL | swingOrderStaging + swingCash* | swing_order_staging | live LTP labelled | Entry-gate math verified (rrNow from LTP); sizing verified; `broker_order_id` null invariant; TTL sweep | Event-risk/liquidity guards present — good; gap modeling shared with F-07 concern | P2 |
| Stocks to Watch | `/stocks-to-watch` | Daily swing scan | Scored plans | swingScannerStore (NIFTY 500, ≥15:35 latch) | swing_scan | EOD labelled | Deterministic pure scorer; once-per-day latch | ATR EMA-vs-Wilder note (R19); corporate actions | P2 |
| Pre-Market | `/premarket` | Global cues + bias | GIFT, US/Asia, DXY, crude, VIX, composite | preMarket, giftNifty, globalIndices, compositeBias | — | **proxy category explicit**; GIFT = real NSE-IX futures | Composite bias verified; honest weights; India VIX ensured | Timestamps per cue: verify prod display | P2 |
| Daily Analysis | `/daily-analysis` | EOD synthesis | Bias, levels, FII/DII | dailyReports/dailyAnalysis | daily_report_runs | dated | Dedup contract tested | `daily_report_runs` raw-SQL-only (schema-drift risk, prior audit) — still true | P2 |
| Charting | `/charting` | Pro charts | Candles, VWAP, VP, indicators | chartDatafeed + **indexFuturesVolume merge** | candle warehouse | provenance-rich: source/tier/fallbackUsed/volume-source (`chartDatafeed.ts:43-83`) | **The only place index VWAP/VP is real** — futures_proxy honestly tagged | The irony: this correct path must feed the signal engine (F-02 fix b) | P1 |
| News | `/news` | Headlines | RSS items | newsRss (Moneycontrol/Mint/… `newsRss.ts:11-18`) | — | source-attributed | Real feeds | — | P3 |
| Learn / Legal | `/learn`,`/legal/*` | Education, disclaimer | static | — | — | — | "Educational use only" consistent with homepage meta | — | P3 |
| Kite / Audit / Status / Admin / Infra / Manifesto | owner-only | Ops | Session, health, audit | kiteAuth/kiteReadiness/system | kite_session | internal | requireOwner server-side + router guard; readiness 6-state machine; login rate-limited | — | P3 |

---

# 10. DATA SOURCE HONESTY AUDIT (matrix)

Policy check first: **Kite priority — ENFORCED** for F&O (strict Kite-only, Yahoo fallback disabled at `optionSignals.ts:2345-2367` with per-index suppressed reasons). **Yahoo cannot drive F&O signals or paper opens** — `resolveDataQuality`/`isActionable` (`tradingConfig.ts:15-35`): `DELAYED_YAHOO → NEVER actionable`; the old `PAPER_TRADE_ALLOW_YAHOO` escape hatch was removed. **Exits** additionally trust-gated (`fnoExitDecision.ts` precedence list). **Stale blocked:** 120s freshness windows on both spot-exit and premium overlay. **Fallback honesty:** provider status strings state exactly why Yahoo is active (`dataProvider.ts:40-49`).

| Data Point | Tab | Route/Function | Source | Fallback | Cache | Freshness rule | Drives signal? | Opens trade? | Closes trade? | Label visible? | Verdict | Fix |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Index intraday candles (F&O) | /options | `centralIndexCandles` | **Kite only** | none (skip+reason) | 30s cycle | session-warmup classified | YES | via signal | — | dataQuality chip | ✅ | — |
| Index candle **volume** | /options | same | Kite (=0 for indices) | — | — | — | **YES (VWAP/VP/vol gates)** | indirectly | — | **NO — fake VP/VWAP unlabelled** | ❌ **F-02** | P0 |
| Live index spot (lifecycle) | /options | `centralIndexQuotes` overlay | Kite tick | bar close | per-cycle | 120s exit gate | trigger eval | — | YES (gated) | provenance stored | ✅ | — |
| Option chain (premium/OI/IV) | /options,/option-chain,/oi-lab | `fetchOptionChain` | Kite | NSE-direct (display-only) | snapshot ingestor | expiry/stale checks | premium plan | **Kite-trusted only** (per-leg LTP+OI) | overlay 120s | `spotSource/spotTrusted`, PREMIUM_UNTRUSTED tag | ✅ | — |
| Kite `q.oi` units | /oi-lab GEX | gex/oiLab | Kite raw | — | — | — | NO (modelled label) | NO | NO | "MODELLED" | ⚠️ **V1 pending** | P1 |
| Daily history (F&O) | /options | Kite `day` 180 | Kite only | skip (warmup vs hard classified) | — | — | HTF/RS/vol regime | — | — | suppressed reasons | ✅ | — |
| Equity quotes | /scanner etc. | kiteScanner→Yahoo | Kite | Yahoo (labelled, delayed) | scan cache | provider status | scan only (not F&O) | EQ paper: via scanner tick | EQ exits | provider banner | ✅ | — |
| GIFT NIFTY | /premarket | giftNifty | NSE-IX front-month FUT (real) | none | — | — | composite only | NO | NO | proxy-category weighting explicit | ✅ (old ^NSEI fake removed) | — |
| FII/DII, participant OI | /flows | instFlows | **NSE official APIs/archives** | — | inst_flows | ISO-dated | NO | NO | NO | dated | ✅ | keep T-1 note |
| News | /news | newsRss | Moneycontrol/Mint RSS | — | — | pub dates | NO | NO | NO | source names | ✅ | — |
| Charting candles | /charting | chartDatafeed | warehouse→Kite→(labelled) | source:"none" empty state | candle table | provenance fields | NO | NO | NO | source/tier/fallbackUsed/futures_proxy | ✅ exemplary | — |
| Backtest snapshots | /backtest-lab | premiumReplay fetchers | option_chain_snapshot | BS-from-captured-IV (flagged) / UNAVAILABLE | — | 5-min tolerance hard | NO | NO | NO | per-leg mode chips | ✅ (rates ❌ F-01) | P0 |
| Bhavcopy | infra | nseBhavcopy | NSE archive | — | — | — | NO | NO | NO | — | ⚠️ blocked from prod IP (known) | P2 |

**Null handling:** fail-closed everywhere audited (sizing, premium plan, exit gate, BASELINE stats) **except** the two soft-fail primitives named in F-02 (`sessionVwap`, `volumeProfile`) — precisely the exception that caused the biggest breach. **Prod vs dev:** `PAPER_TRADING_ENABLED` gates opens only; corrective exits run everywhere — verified correct asymmetry.

---

# 11. F&O SIGNALLING METHODOLOGY AUDIT

**Flow (verified):** 30s cycle → stale-PENDING sweep → `loadGateContext` (stops, VIX, win-rates, NIFTY 5d) → per-index Kite-only intra+daily fetch → `buildContext` (indicators, HTF daily + true 1h, regime, vol-regime, RS input) → 5 detectors with time gates → bias-flip check → vol-regime haircut → **confluence engine** → HC floor 65 → trigger-realism translation (RR-preserving) → intraday clamp (min/max stop, T1 cap, T2>T1 invariant, RR≥1.4 HC / ≥1.0 baseline) → Pass-2B/3 demote flags → clean-top-3 + demoted-as-BASELINE + always-on baseline → level lock (per day/setup/direction) → OI confirmation → premium enrichment (Kite-trusted, per-leg) → lifecycle persistence → paper hook.

**Answers to the mandated questions:**
1–2. *Professional? Mathematically correct?* Architecture: yes, genuinely. Arithmetic: yes, except the F-02 input layer. A correct pipeline computing on partially fabricated inputs.
3–7. *Detectors doing what labels say? Dead? Impossible? Over-weighted? Candle-shape-in-disguise?* See table below — the answer for indices is: 2 of 5 honest, 1 dead, 1 near-impossible, 2 mislabelled; and the confluence VP factor + POC driver are over-weighted bullish by construction.
8. *Confidence meaningful?* Relative ordering within a cycle: mostly. Absolute calibration: contaminated by F-02's systematic tilt until fixed; the rolling win-rate demoter is the right corrective mechanism but its samples predate any fix.
9. *Overfitted?* The gates were tuned to a 53-outcome loss sample — honest about it in comments. Risk of over-fitting to one regime is real; the mitigation (MIN_SAMPLE guards, demote-not-drop) is appropriate. The profit-protection rules were correctly kept simulation-only for exactly this reason (~9-trade sample) — good discipline.
10–12. *Authentic data? Stale blocked? Cards honest?* Kite-only enforced; stale blocked (120s gates); cards honest **except** F-02 fields/drivers and F-03 wording.
13–17. *Triggers realistic? SL/T1/T2 valid? RR correct? Strikes correct?* Trigger-realism cap (≤max(0.5% spot, 1.2×ATR)) verified; stop clamp [max(0.30%,1.0×ATR), max(0.45%,0.6×ATR)] with vol-breach hard-reject ratio and correct MIN-wins-last semantics; T1 cap; T2 = min(1.7×T1, structural) with ordering invariant; RR measured from *actual trigger* not spot (correct); strikes ATM by construction (documented v1 limit).
18–19. *Premiums/Greeks authentic?* Premium anchor = real Kite LTP (fail-closed); levels = linear delta *projections* (F-04); Greeks broker-supplied when finite, ATM ±0.5 closed-form fallback honestly withheld from `optionDelta` display.
20. *Execution matches wording?* **No — F-03.**

**Detector table:**

| Detector | Intended logic | Actual logic (indices) | Vol/VWAP dep | Can fire? | Validity | Issue | Impact | Fix |
|---|---|---|---|---|---|---|---|---|
| TREND_CONTINUATION | VWAP + EMA-stack + RSI trend | EMA-stack + RSI real; "VWAP" = upper/lower half of current bar; "+8 Above POC" ≈ always-true bullish (fake VP); "Volume confirmation" never adds | High | YES | Partial | Mislabelled drivers, bullish-asymmetric | Dominant setup with inflated/misattributed confidence | F-02 |
| VWAP_RECLAIM | Fresh VWAP cross w/ momentum | 2-bar candle reversal vs own-bar HLC3 + EMA/RSI (real) | High | YES | Mislabelled | Not a VWAP event | Loss history needs reinterpretation | F-02 |
| VOLUME_BREAKOUT | VAH/VAL break on volume | Fake-VP gate passes (dir≈always BULLISH), dies at `0 > 0×1.3` | Total | **NO — dead** | Invalid | Structurally impossible; log says "conditions not met" | 1 of 5 HC detectors is dead code in prod | F-02 |
| EMA_PULLBACK | Pullback to EMA9/21 in trend | As labelled — EMA/RSI/ATR/candle all real | None | YES | **Valid** | — | The one fully-honest trend detector | — |
| MEAN_REVERSION | Fade 2×ATR VWAP extension @ RSI extreme | `|spot−fakeVWAP| ≤ ~⅔ bar range` → threshold ~unreachable | High | ~NO | Invalid on indices | Near-zero emissions predicted | F-02 |
| BASELINE | 4-vote directional read | 1 of 4 votes degraded (VWAP); tie-break by session move (good) | Medium | YES (always-on) | Mostly valid | Effective 3-vote | Minor bias | F-02 |

**Lifecycle:** PENDING→TRIGGERED (touch — F-03) →TARGET1_HIT (runner, stop retained) / STOPPED (wins ties) / TARGET2_HIT / EXPIRED (stale 45-min / EOD). Verified deterministic and conservative.

---

# 12. F&O PAPER TRADING AUDIT

**Lifecycle diagram (text):**
```
signal emitted ─► history row + lifecycle PENDING
   └─(gates/vetoes/demotes; INFO_ONLY never proceeds)─►
PENDING ─ touch trigger (F-03) ─► TRIGGERED ─► onLifecycleUpsert
   ─► openPaperTrade:
        assertTradeableForOpen(fail-closed) ─► premiumTrusted===true ─► conf floor
        ─► idempotent row check ─► market open ─► consecutive-stops ─► daily/weekly DD
        ─► 15:25 / BASELINE 14:45 cutoffs ─► 30% premium-stop cap ─► risk guards (paper_block)
        ─► liquidity: LTP floor / spread / strike-missing / OI=0 (fail-closed pattern)
        ─► BEGIN TXN: acct FOR UPDATE ─► day cap ─► BASELINE txn guardrails (fail-closed)
        ─► dynamic sizing (risk∧heat∧ceiling) ─► post-stop ½× ─► VOLATILE ½×
        ─► final heat assert (fail-closed) ─► cash check ─► INSERT ON CONFLICT
        ─► predicated debit (balance≥deploy ∧ cap) or THROW→rollback ─► reasoning log
OPEN ─► 30s MTM sweep (last_premium, runup/drawdown watermarks; decision-neutral)
     ─► exit trust gate (Kite-active, non-Yahoo, fresh≤120s) ─► spot stop/target
     ─► premium hard-stop overlay (fresh MTM ≤ locked stop premium → STOPPED @stop, ~−1R cap)
     ─► 15:20 force-exit (lastPremium, TIME_EXIT_1520) ─► orphan reconciliation
CLOSE ─► pickExitPremium (FROZEN plan level — F-04) ─► CAS close ─► account credit
      ─► reports (net at charges — F-01 rate bug) ─► reasoning log ─► archive
```

**Verification checklist (each item checked in code):** tier gating ✅ (INFO_ONLY/BASELINE refused under hygiene v2, legacy lane flag-off only); idempotency ✅ (unique date/idx/setup/dir + ON CONFLICT + pre-check); duplicates ✅; txn safety ✅ (FOR UPDATE + predicated debit + rollback-on-race); balance ✅ (explicit check + predicate); heat ✅ (sized under lock + final assert, same snapshot); daily/weekly DD ✅ (realized-only, sticky); consecutive stops ✅ (last-N-all-STOPPED semantics — note a T1/time-exit between stops resets the streak, by design; confirm intent); liquidity/OI/spread ✅ (documented fail-open only for transient chain fetch, LTP gate primary); premium trust ✅ (belt-and-braces: enrichment demote + open-path assert); exit trust ✅; stop-first documented ✅; 15:20 ✅ (idempotent, health counters); orphan reconciliation ✅ (restart-safe, no provider gate blocking backfill); MTM never fakes realized ✅ (watermark-only writes).

**Issue table:**

| Area | Expected professional behaviour | Actual | Evidence | Risk | Fix |
|---|---|---|---|---|---|
| Entry fill | Fill per stated plan (close-confirm) with slippage | Touch fill at projected premium, zero entry slippage | F-03; enrichment projection | Optimistic entries, extra whipsaws counted | P0-3 + entry-slippage bps |
| Exit fill | Market premium at exit ± slippage | Frozen plan premium | F-04, `pickExitPremium` | P&L ≠ market P&L (theta/gamma/IV) | shadow `exit_premium_market` |
| Stop realism | Gap-through worse-than-stop possible | Premium overlay caps at −1R exactly; spot stop settles at stop level | overlay + lifecycle | Losses floor-bounded optimistically | shadow column quantifies |
| Charges in balance | Net-of-charges ledger or visible net line | Balance gross; reports net (wrong rate) | R15 + F-01 | User over-reads performance | P0-1 + net line |
| Charge-model unity | One canonical model everywhere | Three models | F-01 | Cross-tab contradictions | unify |

---

# 13. F&O COST MODEL & CHARGES AUDIT

**Every charge-calculation site found (exhaustive grep):** `fnoCostModel.ts` (canonical, shadow report), `paperReportsFO.ts computeFOCharges` (Paper Reports net), `backtest/premiumReplay.ts FNO_COST_RATES` (Mode D), `backtest/backtestCharges.ts` (Modes A/B/C — wraps canonical ✅), `paperReportsEq.ts computeEquityCharges` (equity delivery ✅), `swingCashCostModel.ts` (swing round-trip estimate — uses delivery-class rates, tested), `fnoShadowCosts.ts` (reads canonical ✅).

**Comparison table (options round trip):**

| Component | Statutory FY26-27 | fnoCostModel | paperReportsFO | premiumReplay | Verdict |
|---|---|---|---|---|---|
| STT (sell premium) | **0.15%** (Budget 2026, eff 1-Apr-2026) | 0.15% ✅ | 0.10% ❌ | 0.05% ❌ (futures rate) | 2 of 3 wrong |
| Exchange txn (NSE opt) | 0.03503% | ✅ | ✅ | 0.053% ❌ | replay wrong |
| SEBI | ₹10/cr | ✅ | ✅ | ✅ | ok |
| GST | 18% on (brok+exch+SEBI) | ✅ | ✅ | ✅ | ok |
| Stamp (buy) | 0.003% | ✅ | ✅ | ✅ | ok |
| Brokerage | ₹20/order | ✅ | ₹40 flat RT ✅ | ✅ | ok (freeze-qty note P3) |
| STT exercise-intrinsic | 0.15% | published, unapplied ✅ (premium closes only) | n/a | n/a | correct containment |
| Spread/slippage | model choice | 25+10 bps/side | absent | half-spread 0.5% default | inconsistent (P2 align) |

**Distortion estimate:** per closed options round trip, Paper Reports under-charges `0.05% × sellTurnover`; e.g. exit premium ₹150 × 10 lots × 75 = ₹1,12,500 sell turnover → **₹56 understated per trade**; across a month of 40 trades ≈ ₹2,200 phantom net P&L — small per trade, but it compounds and, worse, it breaks the platform's honesty guarantee. Replay distortion: STT −0.10% of sell turnover, exchange +0.018% of total turnover → net **overstated** ~0.08% of round-trip turnover per trade — enough to flip marginal-expectancy conclusions on a cost-sensitive intraday options book.

**Regression tests required:** single-source-of-truth structural test; per-consumer golden-number test (one worked trade, all three surfaces must emit identical charges); statutory-rate as-of assertion tied to `FNO_COST_PARAMS_ASOF`.

---

# 14. BACKTEST LAB AUDIT

**Modes:** A REAL_REPLAY (captured premiums) · B DIRECTIONAL (modeled ATM 0.7% of spot — labelled) · C STRATEGY_RESEARCH (same) · D SNAPSHOT_PREMIUM_REPLAY (Stage-4: five-mode pricing taxonomy REAL_CAPTURED / REAL_PARTIAL / BS_MODELLED / SYNTHETIC_DELTA_PROXY / UNAVAILABLE).

**Verified honest:** hard 5-min snapshot tolerance (never silently exceeded); LOW-COVERAGE flag <60%; UNAVAILABLE trades counted-not-priced; no interpolation/averaging across strikes; injected fetchers (testable); per-leg mode chips in UI; modeled fields amber-flagged; blank-stays-blank CSV; 28/28 anti-fabrication tests (per repo docs); BS pricer math correct (A&S CDF, standard BSM).

**Trust ratings:** Mode D: **C until F-01 fixed, then B** — the pricing honesty is genuinely good; only the cost block betrays it; also historical prod CSV gap (Jun-5 gitignore issue) was fixed — confirm snapshot continuity in prod. Modes B/C: **directional-proxy only, and say so** — trust for direction/frequency studies, never for net expectancy. Mode A: **B** — real premiums, canonical charges via backtestCharges. **Universal caveat:** 21 trades is statistically nothing; no in/out-of-sample wall exists; do not draw edge conclusions from any mode yet. Safe for *strategy mechanics validation*; not yet for *edge validation*.

---

# 15. SWING TRADING ENGINE AUDIT

**Verified:** pure deterministic scorer (Python-port, no I/O/randomness — testable); RS vs benchmark 20/50/120d clamped-weighted; candle-confirmation taxonomy; fundamentals scoring with explicit `Unavailable/Skipped` statuses; entry gate (chase/too-close/stale/invalid-data classification, rrNow from live LTP — math verified); risk sizing (Section 5); TTL sweep 10-min; liquidity floor ₹25L avg value; event-risk & exposure guards present; kill switch; staged-order state machine with mandatory human approval and `broker_order_id` null invariant; NIFTY-500 daily latch ≥15:35 IST.

**Concerns:** ATR = EMA-smoothed (R19, document vs TradingView); MACD warm-up (F-06) distorts new listings; corporate-action adjustment absent (zone/52-week logic distorts across splits/bonuses — P2); gap-through exits settle at level (F-07 — for *delivery* positions overnight gaps are the norm, so paper stop losses are systematically optimistic; add gap-fill settlement: `exit = min(stop, next open)` for longs); equity paper lane sizes by slots while swing-cash sizes by risk (F-08 inconsistency); circuit-limit handling not found (a locked lower-circuit stock cannot exit at stop — currently unmodeled; P2).

**Verdict — professional readiness: INTERMEDIATE → PROFESSIONAL AFTER FIXES.** The staging discipline (human approval, TTL, guards, no broker wiring) is already professional; the settlement realism (gaps, circuits) and sizing unification are what's missing.

---

# 16. SCANNER / DEEP SCAN / STOCK DETAIL AUDIT

Universe: **278 curated symbols** (`universe.ts`, counted) with sector map, inactive-symbol set, Yahoo ticker overrides, alias dictionary (`symbolAlias.ts`) — honest curation, not full-market. Full-NSE scan exists (`fullNseScanner.ts`) but the known timeout→cached ~198-row partial set remains (enrich timeout race at :685-690); **the partial-coverage state must be loudly labelled in UI** (open Stage-2 item — P1). Scoring lib (`scoring.ts buildRecommendation/computeEntrySafety`) verified with tests; recommendations degrade honestly on missing inputs (deepscan honesty tests exist). MACD warm-up (F-06) is the main formula risk on short series. Symbol resolution beyond the curated universe (TMCV/TMPV-class aliases, TRIDENT/BDL/CDSL/ARE&M/BLS/INDHOTEL): alias dict covers several patterns; full instrument-master search path **REQUIRES PRODUCTION VERIFICATION** (type each into prod search; the `instrument_map` table was DISABLED by default per prior audit — confirm current state). Portfolio/charting/scanner should share one resolver — verify no per-tab price divergence for the same symbol at the same minute (prod test).

---

# 17. OPTION CHAIN / OI LAB AUDIT

Verified: Kite-primary chain with NSE-direct display fallback; `spotSource/spotTrusted` display-trust deliberately separated from `trustedForSignals` premium-trust (correct two-tier design, `optionChain.ts:165-178`); expiry list handling; ATM detection; per-leg buildup from real priceChg+oiChg (not sign-re-derivation); PCR per-strike guard (`ceOi>0`); Max Pain correct; support/resistance spot-side filtering (resistance≥spot, support≤spot with fallback); sentiment score + strength + band mapping sound; missing-strike/stale-chain paths demote rather than fabricate; IV approximation from premium when Kite omits IV is documented (`kiteOptionChain.ts:39`) — ensure the chain UI carries that label.

**OI unit table (the decisive open item):**

| OI field | Assumed unit | Actual unit | Evidence | Impact if wrong | Fix |
|---|---|---|---|---|---|
| Kite `q.oi` | contracts (lots) | **UNVERIFIED** | `gex.ts:9-20` assertion; proof cites own code (circular); raw pass-through `kiteOptionChain.ts:197,280` | GEX & rupee notionals inflated ~75× (NIFTY); flip-point *ranking* survives (monotone scaling) but magnitudes/labels wrong; `MIN_OPTION_OI=50,000` floor meaning flips (≈667 lots vs 50k lots) | **V1:** one liquid strike, same minute: Kite q.oi vs NSE-site OI. If Kite≈NSE×lot → units → drop the lotSize multiply & recalibrate floor. If Kite≈NSE → contracts → replace circular proof with this empirical one |

---

# 18. CHARTING AUDIT

The **strongest data-honesty surface on the platform**: warehouse→Kite fetch order, `source:"none"` explicit empty state ("Bars are NEVER fabricated"), full provenance (`sourceProvider/sourceTier/fallbackUsed/volume source`), and the **futures-volume merge** giving indices a real VWAP/VP with `futures_proxy` tag and the sourcing FUT instrument recorded (`chartDatafeed.ts:43-83`). Timezone/session handling verified in the 1h-aggregation logic pattern; segment tests exist (`chartDatafeed.segment.test.ts`).

**The central question, answered:** *why is the signal engine not using the corrected volume path Charting already has?* Because `indexFuturesVolume.ts` was scoped "solely… Charting… NEVER touches signals" as a safety boundary — reasonable at the time, but F-02 shows the alternative (soft-fail VWAP/VP) is worse than a controlled merge. **Safe unification plan:** flag `FNO_SIGNAL_FUT_VOLUME=shadow|on|off`; in shadow, compute both contexts per cycle, log detector/confluence diffs and would-have-emitted deltas for 10 sessions; tag every merged-volume signal `VWAP_SOURCE:FUT_VOLUME`; promote only after diff review; freeze/annotate WIN_RATE_CALIBRATION samples across the boundary. Interim (independent of the flag): the fail-closed nulls of F-02 fix (a) ship immediately.

Stage-5 items (saved layouts, drawing tools, Pine-subset sandboxed import with exact unsupported-function diagnostics) remain roadmap — correctly sequenced after data integrity.

---

# 19. PORTFOLIO / WATCHLIST AUDIT

XIRR verified correct (Section 5); allocation/benchmark/holding-period/return-label modules all test-covered; missing prices handled honestly (AMFI/ETF fallbacks per module set); manual-entry validation and persistence tested; ownerKey scoping on portfolio tables. **Prod checks required:** same-symbol same-minute price parity across Portfolio/Scanner/Charting; resolver coverage for the named symbols (Section 16); corporate-action gap (P2) applies here most (split-adjusted cost basis). Watchlist: list/basket modules test-covered; alerts wired; no math risks found.

---

# 20. PRE-MARKET / DAILY ANALYSIS AUDIT

GIFT NIFTY: **real** NSE-IX front-month futures (the old ^NSEI proxy dishonesty is documented and removed in `giftNifty.ts` header — exemplary self-correction). Cue map with explicit categories/weights, DXY & US-VIX inverted correctly, India VIX presence enforced (`preMarket.ts:142`). FII/DII + participant OI: NSE official endpoints/archives, ISO-dated (`instFlows.ts:5-8,102-112`). Composite bias math verified. Bias statements are data-backed via the breakdown array (each signal's raw value, score, contribution, note — auditable by the user). **Prod checks:** per-cue timestamps rendered; `daily_report_runs` still raw-SQL-only (schema-drift risk — P2 migrate into Drizzle).

---

# 21. MATHEMATICAL FORMULA AUDIT (formula-by-formula)

| Formula | Location | Verdict | Note |
|---|---|---|---|
| RSI | @workspace/indicators | Correct | Wilder, shared single source |
| EMA/SMA | same | Correct | SMA-seeded |
| MACD | indicators.ts:79-98 | **Wrong (warm-up)** | nulls→0 into signal EMA (F-06); TV slices from first valid |
| ADX | :28-77 | Correct | canonical Wilder |
| ATR | :12-26 | Correct-but-non-standard | EMA not Wilder RMA (R19); TV differs — document |
| Session VWAP | :130-147 | **Wrong for zero-volume series** | soft-fail to HLC3 (F-02) |
| Rolling VWAP | :107-127 | Correct | honest null on v=0 (note: unlike sessionVwap!) |
| Volume Profile | :155-198 | **Wrong for zero-volume series** | no totalVol guard (F-02/N1); also close-bucketed (range not distributed) — simplification, document |
| Bollinger width | :227-242 | Correct | population σ |
| Pivots | :244-255 | Correct | classic floor |
| Supertrend | global/indicators | Correct (prior audit; unchanged) | |
| Max Pain | optionAnalytics:20-30 | Correct | |
| PCR | optionAnalytics/oiLab | Correct | per-strike zero-guard |
| GEX | gex.ts | Correct formula / **unverified units** | V1 |
| IV (solver) | blackScholes:106-138 | Correct | minor q-omission in put intrinsic bound |
| Black-Scholes + Greeks | blackScholes:58-95 | Correct | |
| Delta projection | optionSignals:1893 | Correct-as-linear-approx | F-04 limits documented |
| Stop/target clamps | optionSignals:1083-1178 | Correct | min-wins-last, hard-reject ratio, T2 invariant |
| RR | toSignal | Correct | trigger-anchored |
| F&O sizing | fnoSizingHelper | Correct | |
| Swing sizing | swingCashSizing | Correct | |
| EQ sizing | paperTradingEq | Correct-but-non-professional model | slot-based (F-08) |
| Heat | HEAT_SQL + assert | Correct | same-snapshot under lock |
| Drawdown caps | paperAccount getters | Correct | realized-only, sticky |
| Win rate/expectancy/PF | journalAnalytics/summary | Correct structure | inputs poisoned by F-01/F-04 until fixed |
| XIRR | portfolio/calc:240 | Correct | |
| HHI / structure score | portfolio/risk,score | Correct | |
| F&O charges (canonical) | fnoCostModel | Correct | |
| F&O charges (reports) | paperReportsFO:71-92 | **Wrong (stale STT)** | F-01 |
| F&O charges (replay) | premiumReplay:41-51 | **Wrong (2 rates)** | F-01 |
| EQ delivery charges | paperReportsEq | Correct | |
| Swing cost model | swingCashCostModel | Correct (tested) | |
| Composite bias | compositeBias | Correct (documented spec deviation) | |
| Report aggregation | paperReports*/summary | Correct | open trades excluded from realized; buckets consistent |

---

# 22. DATABASE / API / BACKEND AUDIT

**Schema/tables (per code + prior audit, unchanged):** paper_trade_fo/eq/combo(+legs), paper_account (segment ledger), option_signals + lifecycle/history, fno_signal_reasoning (append-only), swing_order_staging, swing_scan, option_chain_snapshot, candle (warehouse), iv_history, inst_flows, backtest, portfolios(+holdings), users, kite_session (single-row, encrypted token), app_state latches, strategy_control (drop-guard placeholder — must stay), tv_alerts, global_scanner, instrument_map (disabled). **Known risks re-confirmed as still-relevant checks:** `daily_report_runs` raw-SQL-only (drift risk); drizzle-kit push unsafe for non-additive changes (your standing `ALTER TABLE … ADD COLUMN IF NOT EXISTS` rule is the right mitigation); **REQUIRES PRODUCTION VERIFICATION:** candle table row count (was 0/broken), tv_alerts staleness, iv_history freshness per index.

**Transaction/race safety:** account FOR UPDATE + predicated debit/credit + CAS closes + ON CONFLICT inserts + advisory lock on combos — duplicate trades and negative balances are structurally prevented (verified paths). **Untrusted-overwrites-trusted:** blocked by warehouse write-guard (lower-trust cannot overwrite) and Kite-only F&O policy. **Auth:** global `requireAuth` (app.ts:201) after the global-router carve-out (documented), owner routes double-gated, login limiters both realms, helmet+CORS-prod-wildcard-refusal. **Errors→UI:** structured error codes surfaced (e.g., OWNER_ONLY), suppressed-reason strings, provider reasons — not hidden. **Logging:** structured (pino-style) with event/ALERT tags and health counters (baselineStatsUnavailable, timeExit1520, orphan sweep, MTM sweep) — sufficient to debug the paths audited. **Schedulers:** inventory in Section 2; all unref'd or boot-staggered; kill behaviour observable. **Prod-vs-dev:** open-gating flag asymmetry verified correct.

---

# 23. PRODUCTION BEHAVIOUR AUDIT

**Verified live:** homepage up, correct SEO meta, "For educational and research use only" positioning (fetched 2026-07-07). **Blocked from here:** authenticated API/tab payloads, DB state. **Production verification checklist (run in Replit Shell / prod SQL, ~30 min total):**
1. `SELECT setup_key, COUNT(*) FROM option_signal_history WHERE created_at > now()-interval '30 days' GROUP BY 1;` — expect MEAN_REVERSION & VOLUME_BREAKOUT ≈ 0 (F-02 empirical confirmation).
2. CALL vs PUT opened-trade split, 30d — expect CALL over-representation (F-02 bias prediction).
3. One-strike Kite-vs-NSE OI comparison (V1).
4. `SELECT COUNT(*) FROM candle;` · `SELECT max(created_at) FROM tv_alerts;` · per-index `max(recorded_at)` from iv_history.
5. Same-minute price parity: one symbol across Scanner/Portfolio/Charting API responses.
6. Recompute 5 recent closed F&O trades' charges by hand at 0.15% STT vs Paper Reports display (quantifies F-01 live).
7. Confirm option_chain_snapshot continuity since the Jun-5 gitignore fix.

---

# 24. PROFESSIONAL TRADER REVIEW

*Would a professional trust these signals?* Not yet — not because the architecture is amateur (it isn't; the gate/veto/risk stack is better than most prop-shop retail tooling), but because a professional's first question is "what is this indicator actually computing?" and for VWAP/VP on the traded indices the honest answer is currently "the current candle's shape and a number pinned to the 60-day low." *Trust the paper P&L to judge edge?* No: touch-fills + frozen-premium settlement + under-charged STT stack in the optimistic direction. *Entries too late?* The trigger-realism translation solved the stale-structural-trigger problem well; the touch-fill makes them if anything too early/loose. *Stops too tight?* The Phase-2 ATR floor (≥1 bar of noise) was the correct fix; retained. *Targets realistic?* The intraday clamp envelope matches Indian index session behaviour. *Risk capped?* Yes — per-trade %, heat, daily/weekly DD, consecutive stops, post-stop halving, VOLATILE halving, expiry-day demotion, VIX kill. This is the platform's best dimension. *IV/theta?* Handled at entry (IVR factor, DTE guards), ignored at settlement (F-04). *Liquidity/spread/slippage?* Gated at entry; exit slippage unmodeled. *Overtrading/chop?* Regime label + RANGING awareness + caps — yes. *Trend/reversal/gap/ORB days?* Regime classifier + opening-noise window cover part; no dedicated gap-day or ORB module in the signal path (ORB exists as a backtest strategy only). *News events?* Swing has event-risk guards; F&O intraday relies on VIX spike proxy — acceptable v1. *Analysis vs execution separation?* Clear and enforced (staging approval, null broker IDs, education-only positioning).

**Readiness ratings:** Analysis dashboard **B** (A after F-02 label fixes) · Paper-trading engine **A−** mechanics / **C** P&L-realism → net **B with caution** · Backtesting **C now → B after F-01** (Mode D), B/C modes honest-directional · Swing **B** (Intermediate→Professional after gap/circuit realism) · F&O signalling **C** until F-02/F-03 (architecture A−, inputs failing) · Auto-trading **D — not ready, and correctly not attempted** · Live trading **not applicable — correctly not wired; do not wire until every P0+P1 closed and 6–12 months out-of-sample proof exists.**

---

# 25. PRIORITY FIX PLAN

**P0 — numbers/signals/P&L cannot be trusted until fixed:**
- **P0-1** Unify cost models (F-01): `paperReportsFO`, `premiumReplay` import `FNO_COST_PARAMS`; golden-number + single-source structural tests; re-run Stage-4 replay; annotate historical Paper Reports as pre-fix.
- **P0-2** Zero-volume honesty (F-02): `volumeProfile` null-on-zero-volume; `sessionVwap` null-on-zero-volume; delete false comment (optionSignals:347-349); stop publishing VP fields on index cards; explicit suppressed-reasons for volume-dependent detectors; then flag-gated futures-volume merge (shadow 10 sessions) as the *restore* path.
- **P0-3** Trigger truth (F-03): close-confirmed trigger OR card rewording — one semantics, tested.

**P1 — before trusting results:** `exit_premium_market` shadow column (F-04); V1 Kite-OI empirical test + GEX correction if needed; full-NSE partial-coverage loud label; MACD warm-up fix (F-06); equity/swing gap-through exit settlement (F-07); net-of-charges line on Paper Trading card (R15); suppressed-distribution + CALL/PUT-split dashboards; production checklist Section 23.

**P2 — professional grade:** holiday calendar; equity risk-based sizing option (F-08); corporate-action adjustments; circuit-limit exit handling; spread/slippage assumption alignment across models; `daily_report_runs` into Drizzle; ATR/Wilder documentation; instrument-master resolver completion.

**P3:** naming nits (F-10); freeze-qty comment; Pine import (Stage-5); ORB/gap-day intraday modules.

*(Each P0/P1 item carries: ID, files, wrongness, trading impact, trust impact, evidence, fix, test — as specified inline above.)*

---

# 26. RECOMMENDED ADDITIONS

In-sample/out-of-sample wall with immutable pre-registration of setups; per-setup expectancy-after-costs (canonical model) with sample-size confidence bands; settlement-gap report (frozen vs market, from F-04 column); regime-conditioned performance breakdown (your regime labels already exist — join them to outcomes); daily "cost drag" line (charges as % of gross); a single `DATA_HONESTY.md` invariant list enforced by structural tests (the F-02 false comment shows prose invariants rot — tests don't).

---

# 27. TESTS REQUIRED

**Unit:** volumeProfile zero-volume→null; sessionVwap zero-volume→null; MACD warm-up first-valid seeding; computeFOCharges === computeFnoTradeCost golden trade; premiumReplay charges === canonical golden trade; close-confirm trigger semantics; gap-through equity settlement.
**Structural:** single options-charge constant object across all consumers (import-allowlist pattern); no fabricated VP fields on index signals; card-wording ↔ lifecycle-semantics contract test.
**Integration/replay:** re-run 2026-06-09 replay under corrected costs; 10-session shadow diff for futures-volume merge; detector-emission regression snapshot before/after F-02.
**Production verification:** the 7-item checklist in Section 23.

---

# 28. FINAL ROADMAP

1. **Week 1:** P0-1 (cost unification + tests) → re-run Stage-4 replay → publish corrected numbers. P0-2(a) fail-closed nulls + card field removal + suppressed reasons. P0-3 decision + implementation.
2. **Week 2:** Section-23 production checklist (settles V1 OI, F-02 empirics, staleness). F-04 shadow column live. Net-of-charges line.
3. **Weeks 3–4:** Futures-volume merge in shadow; review diffs; promote or hold. MACD, gap-settlement, partial-coverage label.
4. **Month 2:** P2 batch (holidays, corporate actions, circuits, EQ sizing, resolver). Freeze the in/out-of-sample wall.
5. **Months 3–12:** accumulate out-of-sample trades on clean numbers (real premium shadow + canonical costs + honest detectors). Only then evaluate edge; only after demonstrated edge revisit any execution ambition — matching your standing plan (job + CMA through 2026, proof before transition).

---

# 29. FINAL VERDICT (one page)

Market Scanner is an unusually well-engineered retail trading platform whose *control systems* — risk caps, transaction safety, provenance gating, honest failure states — already operate at a professional standard, and whose *core mathematics* is verifiably correct. It is currently undermined by exactly three integrity defects, all narrow, all fixable inside the existing architecture, and all discovered with file-and-line evidence in this audit: **(1)** two of its three F&O charge models are statutorily wrong for FY 2026-27, so both scoreboards (Paper Reports net P&L, Stage-4 replay) overstate results; **(2)** the F&O signal engine consumes fabricated VWAP and — new this audit — fabricated Volume Profile values for the three indices it trades, killing one detector, disabling another, mislabelling two more, publishing fake levels on user-facing cards behind a false code comment, and injecting a structural bullish bias into confidence scoring; **(3)** the signal cards describe close-confirmed entries while the engine fills on touches, so the paper book trades a different strategy than the one it documents.

Nothing in this audit found deliberate deception — the opposite: the platform's own history (GIFT-proxy removal, synthetic-CSV labelling, premium-trust hardening) shows a culture that fixes honesty breaches when it sees them. F-02 is that culture's blind spot: a soft-failing primitive plus a confident wrong comment. Fix the three P0s, run the seven production checks, add the exit-premium shadow column, and the platform becomes what it already claims to be: a source-honest, mathematically correct, trader-grade analysis and paper-trading laboratory — with the remaining journey to trading decisions being, as you already concluded, analytical patience on clean data rather than more engineering.

**Status: SAFE for analysis + paper trading with the stated caveats · NOT VALID yet as evidence of edge · NOT READY for semi-automated or live trading (and correctly not attempting it).**

*— End of report. All findings audit-only; no code was modified. Fixes proceed only on your approval.*
