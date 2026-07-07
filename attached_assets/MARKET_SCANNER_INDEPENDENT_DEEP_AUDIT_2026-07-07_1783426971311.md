# MARKET SCANNER — INDEPENDENT FULL DEEP AUDIT
**Date:** 2026-07-07 · **Auditor:** Claude (independent pass, source-only) · **Scope:** entire uploaded monorepo (`artifacts/api-server` ~85K lines of lib code, `artifacts/scanner` frontend, `artifacts/global`, backtest engine, all 35 routed tabs)

**Method:** line-level read of every core trading-math module (signal detectors, gates, vetoes, lifecycle, exit decision, premium overlay, F&O + equity + swing sizing, all three cost models, Black-Scholes, GEX, max pain, PCR, indicators, composite bias, backtest premium replay); structural read of the paper-trading transaction paths; spot-verification of frontend pages against server payloads; external verification of statutory FY 2026-27 rates. This audit was run WITHOUT reference to the repo's own 2026-07-01 audit until my findings were formed, then cross-checked against it — everything in Section 2 is **new** (not in your prior audit, or contradicts it).

**Not audited (impossible from source alone):** live prod DB state, actual Kite payloads, scheduler behaviour in prod, test-suite execution (deps not installed in this sandbox). Findings below are code-level facts, each with file evidence.

---

## 1. VERDICT SUMMARY

The platform's engineering discipline is genuinely institutional-grade: fail-closed premium provenance, FOR-UPDATE account serialization, idempotent CAS closes, exhaustive skip-reason taxonomy, honest labelling everywhere. The core math (Black-Scholes, IV solver, max pain, PCR, sizing in all three segments, lifecycle stop-priority) is **correct**.

But this audit found **three defects your own 2026-07-01 audit missed or wrongly marked ✅**, and two of them directly corrupt the numbers you are using to judge whether your edge is real:

1. **The three cost models disagree with each other, and two are statutorily wrong for FY 2026-27.** Your Paper Reports net P&L undercharges STT by 33%, and your Stage-4 backtest replay undercharges STT by 3× and exchange charges by 51%.
2. **The F&O signal engine's "VWAP" is not a VWAP for NIFTY/BANKNIFTY/SENSEX.** Index candles carry zero volume, so `sessionVwap` silently degenerates to the *current bar's HLC3*. Four of your six detectors are semantically not doing what their labels, drivers, and confidence weights claim. One detector (`VOLUME_BREAKOUT`) is structurally dead and can never fire.
3. **Entry-trigger semantics mismatch:** the card tells the human "15-min close > X"; the lifecycle fills the paper trade on a *touch* (wick/tick ≥ X). The paper book systematically takes entries the documented plan would not take.

Everything else is either right, or a **documented, deliberate realism trade-off** (frozen-premium settlement, linear delta projection) whose consequences you should understand precisely — Section 3 quantifies them.

---

## 2. CONFIRMED DEFECTS (WRONG — fix these)

### D1 — Three contradictory F&O cost models; two are wrong (SEVERITY: HIGH)

There are **three independent hard-coded charge blocks** for the same instrument class:

| Module | Consumes | STT (options sell) | Exchange txn | Verdict |
|---|---|---|---|---|
| `lib/fnoCostModel.ts` (shadow costs) | Shadow-cost report | **0.15%** (eff 2026-04-01) | 0.03503% | ✅ CORRECT |
| `lib/paperReportsFO.ts` → `computeFOCharges()` | **Paper Reports tab net P&L** | **0.10%** ("post 1-Oct-2024") | 0.03503% | ❌ STALE — Budget 2026 raised it to 0.15% eff 1-Apr-2026 |
| `lib/backtest/premiumReplay.ts` → `FNO_COST_RATES` | **Stage-4 real-premium replay** | **0.05%** (labelled "effective 2026-04-01"!) | **0.053%** | ❌ DOUBLY WRONG — 0.05% is the *futures* rate, not options; 0.053% is the *pre-Oct-2024* NSE options rate (current: 0.03503%) |

Verified externally: Budget 2026 raised STT on options premium to 0.15% (from 0.10%) and futures to 0.05%, effective 1 April 2026. So:

- **Paper Reports tab** (`netPnl = realized − charges`, line ~202 of `paperReportsFO.ts`) understates STT on every closed trade by a third. On a heavy month this is thousands of rupees of phantom net P&L.
- **Backtest replay** — the module whose entire reason for existing is cost honesty — charges 1/3 the correct STT *and* 1.51× the wrong exchange rate. Its header even claims "effective 2026-04-01", so this is not a stale file; the wrong numbers were written under the right date. Your first 21-trade real-premium run's net loss is therefore *understated* — real costs are worse.
- Your own 2026-07-01 audit marked "F&O cost model (2026 rates) — `premiumReplay.ts` — ✅". That entry is wrong.

**Fix:** delete both local blocks; make `paperReportsFO.computeFOCharges` and `premiumReplay.FNO_COST_RATES` import `FNO_COST_PARAMS` from `fnoCostModel.ts` (which `backtestCharges.ts` already correctly does for Modes A/B/C — so mode D is the odd one out). Add a structural test asserting all consumers of options charges resolve to a single constant object, in the same spirit as your import-allowlist tests. Also note `paperReportsEq.ts` (equity delivery: STT 0.1% both sides, exchange 0.00297%, DP ₹15.93) — verified correct, Budget 2026 left cash rates unchanged.

### D2 — "VWAP" in the F&O signal engine is not a VWAP for the three traded indices (SEVERITY: HIGH — signal-accuracy)

Chain of facts, all in code:

1. `kiteIntraday.ts` line ~381: *"Cash-index volume from Kite is 0 for NIFTY/BANKNIFTY/etc"* — index candles feed the engine with `volume = 0` on every bar.
2. `indicators.ts sessionVwap()` line 144: when cumulative volume is 0, `out[i] = typ` — i.e. **each bar's "VWAP" is that bar's own (H+L+C)/3**.
3. `optionSignals.ts buildContext()` computes `vwapSeries = sessionVwap(highs, lows, closes, vols)` on those zero-volume bars. `effectiveVwap` therefore = the *latest bar's HLC3*, not a session VWAP.
4. `indexFuturesVolume.ts` header explicitly confirms the futures-volume merge that would fix this exists **"solely for the Charting tab"** and *"NEVER touches signals"*.

Consequences per detector (this is where your 27-reason skip taxonomy and candidate→0-opens mystery likely connect):

- **TREND_CONTINUATION** — "Spot above VWAP" (25 confidence points, the single biggest driver) reduces to `close > (H+L+C)/3` of the current bar ⇔ *close in the upper half of the current 15-min bar*. A single-bar candle-shape check is being sold on the card as a session-VWAP regime read.
- **VWAP_RECLAIM** — the "cross" logic compares each of bars n-3/n-4 against *their own* HLC3, then the latest close against *its own* HLC3. It's a two-bar reversal candle pattern wearing a VWAP costume. Its 13:30 late-cutoff and loss history should be re-read in that light.
- **MEAN_REVERSION** — requires `|spot − vwap| > 2 × ATR15`. With vwap = current-bar HLC3, `|spot − vwap| = |2c − h − l|/3 ≤ ~⅔ of one bar's range`, while 2×ATR15 ≈ two full bars of range. **This detector is mathematically near-impossible to fire on the three indices.** Check your setup-frequency analytics — I expect MEAN_REVERSION ≈ 0 emissions.
- **VOLUME_BREAKOUT** — `lastVol = vols.at(-1) ?? null` returns **0, not null** (0 is not nullish), so the null-guard doesn't trip; then `volOk = 0 > 0×1.3 = false` — **the detector silently never fires for any index.** One of your five HC detectors is dead code in production, and the suppressed-reason log will forever say "conditions not met" rather than "structurally impossible".
- **BASELINE** — one of its four votes (spot vs VWAP) is the same degraded single-bar check; effective vote count is 3, biasing `conf = 35 + align×5` upward on ties.
- **confluenceEngine** — the `spot > vwap` factor and VWAP-distance factor are similarly degraded (VP-intraday is correctly nulled-out; VWAP was missed).

Note the interesting nuance: you correctly handled the *same root cause* for volume profile (`vpIntraday` → null on zero volume, "no-op factor") and for charting (futures-volume merge, honestly labelled). VWAP fell through the crack because `sessionVwap` fails *soft* (returns typ) instead of failing *closed* (returning null). This is the one place the platform's fail-closed philosophy wasn't applied.

**Fix options (pick one, don't leave as-is):**
- (a) *Honest & cheap:* make `sessionVwap` return null when total volume is 0; treat null VWAP exactly like null VP — detector conditions using it skip that driver, VOLUME_BREAKOUT/MEAN_REVERSION get explicit "index has no volume" suppressed-reasons, cards stop displaying a fake VWAP number.
- (b) *Correct & matching pro terminals:* extend the existing `indexFuturesVolume` merge (already built, already fail-open) into the signal engine's intraday fetch, so VWAP/VP/volume detectors run on futures-volume-weighted candles — with a provenance tag (`VWAP_SOURCE: FUT_VOLUME`) per your labelling discipline.
- Either way this **changes signal behaviour**, so per your own rules it belongs behind a flag with before/after shadow comparison, and it resets the meaning of any historical setup-level win-rate stats (WIN_RATE_CALIBRATION samples straddle the fix).

### D3 — Trigger semantics: card says "close above", engine fills on touch (SEVERITY: MEDIUM)

`toSignal()` writes `entryTrigger: "15-min close > X"` on every card. But `optionSignalLifecycle.evaluateTransition()` triggers `PENDING → TRIGGERED` on `hi >= entry` (bar high, or the live Kite tick overlay) — a **touch**, not a close. So the paper book enters on every wick-poke through the level, while a human following the card would wait for bar close confirmation. Effects: (1) paper results include whipsaw entries the documented strategy excludes — your loss sample's "stopped by a single wick" pattern is partly self-inflicted here; (2) signal-vs-human parity is broken, which matters for the eventual live transition. Same-bar trigger+stop resolves stop-first (worst-case), compounding it. **Fix:** either implement close-confirmed triggering (needs bar-close awareness in the 30s sweep) or change the card wording to "spot touches X" so the plan and the execution say the same thing. Honesty demands one or the other.

### D4 — MACD signal-line warm-up contamination (SEVERITY: LOW)

`indicators.ts macd()`: `macdNumeric = macdLine.map(v => v ?? 0)` feeds nulls-as-zeros into the signal EMA, distorting the signal line and histogram for roughly the first `slow+signal` bars. Your prior audit flagged the cross-file inconsistency; the fix (seed signal EMA from the first valid MACD value) is a 5-line change. Matters most for short daily series (new listings) in Deep Scan / swing paths.

### D5 — Cosmetic/consistency nits (SEVERITY: TRIVIAL, listed for completeness)

`optionSignals.ts`: `const last10Vol = vols.slice(-20)` — name says 10, code takes 20, comment-free; `avgVol20` is fine but the variable name will mislead a future editor. `detectMeanReversion` t1/t2 ternaries return identical values in both branches (`c.vwap : c.vwap`). `impliedVolatility()` put-intrinsic lower bound omits the dividend discount on S (harmless for indices, q≈0). `fnoSizingHelper` accepts a stop *above* entry for a long option (Math.abs) — callers validate, but the pure helper's INVALID_PLAN gate could also assert `stop < entry` for long-premium plans since that's the only shape it's ever fed.

---

## 3. STRUCTURAL REALISM GAPS (not bugs — deliberate designs whose cost you should price in)

These are documented in your own headers as intentional. The audit's job is to state precisely what they do to the numbers.

**G1 — Frozen-premium settlement + linear delta projection.** Entry/SL/T1/T2 premiums are projected as `premium + delta × Δspot` with a *constant* delta (ATM ±0.5 fallback when Greeks missing), locked at open, and every STOPPED/TARGET exit settles at the locked plan premium (`pickExitPremium`), never a re-quoted market premium. What this misstates: (a) **no theta** — a T1 hit at 14:45 settles at a premium computed as if zero hours elapsed; on a weekly index option that overstates the winner by several percent of premium, worse on expiry-adjacent days; (b) **no gamma** — for a long CE moving toward target, real delta rises along the path, so the linear projection *understates* the winner (partially offsetting theta), while toward the stop real delta falls, so the projection *overstates* the loss (conservative); (c) **no IV change** — a stop hit during a vol spike would in reality settle richer than the locked stop premium. Net direction is regime-dependent, which is exactly why the paper book's realized P&L can't be trusted as a live-P&L estimate — only as a *directional-accuracy* ledger. The premium hard-stop overlay caps blowups at ~−1R (good) but also settles at the locked stop premium, so real slippage below stop is never recorded. **Recommendation:** you already capture option-chain snapshots every sweep — add a shadow column `exit_premium_market` (nearest fresh snapshot LTP at exit time) written alongside every close, decision-neutral, so after ~50 trades you can measure the frozen-vs-market settlement gap empirically instead of arguing about it. This is the cheapest possible upgrade toward your Stage-4 "prove it with real premium" goal on the *live* book, not just the backtest.

**G2 — Headline P&L vs charges.** Paper Reports correctly nets charges (once D1 is fixed); but the Paper Trading tab's live cards and account balance are gross (shadow costs surfaced separately). A trader glancing at the balance sees a number ~0.9–1.3% of round-trip premium turnover better than reality per trade. Consider a small "net-of-est-charges" line on the account card.

**G3 — Equity paper sizing is slot-based, not risk-based.** `openPaperEquityTrade` deploys `accountValue / max(BASE_SLOTS, open+1)` capital per position regardless of stop distance — so a 1.2% stop and a 7.8% stop carry the *same capital* and wildly different rupee risk (the stop-sanity gate only bounds it to 1–8%, a 6.5× risk spread). Swing-cash and F&O both size by risk. This inconsistency makes cross-segment win-rate/expectancy comparison misleading. Either adopt `computeSwingCashSizing`-style risk sizing for equity, or explicitly document that equity expectancy stats are capital-normalized, not risk-normalized.

**G4 — ATM-only strike selection, fixed by construction** (`nearestStrike(spot, step)`). Fine as a v1 constraint; but note the plan projection then *assumes* the strike stays the plan's strike even when the trigger-realism shift moves the entry level materially. Strike distance from eventual entry is uncontrolled tail risk in the delta assumption. Log `|entrySpot − strike| / strikeStep` per trade so you can see whether it correlates with projection error.

**G5 — Holiday calendar absent** (`fnoTradingDays` = Mon–Fri). Already known; affects DTE in guards and "days to expiry" analytics around exchange holidays. Cheap fix: static NSE holiday list per year, refreshed annually.

**G6 — ATR uses EMA smoothing, not Wilder RMA** (`atr = ema(TR,14)`); slightly more reactive than canonical ATR. Every consumer (clamps, floors, regime) is internally consistent, so this is a definition choice, not an error — but your Pine MultiTool and TradingView use Wilder, so cross-checking platform stops against TradingView will show small systematic differences. Document it once.

**G7 — Consecutive-stop circuit logic scans last-N closes globally.** `openPaperTrade`'s pre-check takes the last `MAX_CONSECUTIVE_STOPS_PER_DAY` CLOSED rows for the day and requires *all* to be STOPPED. A TIME_EXIT_1520 or T1 close sandwiched between stops resets the streak — which is the intended "consecutive" semantics, but note a day of stop, tiny-target, stop, stop, stop never trips it. Verify that matches your intent (the Gita-system rule was "hard daily loss limit" — the daily DD cap covers rupees, this covers sequence; both are present, just confirm the interplay is what you want).

---

## 4. WHAT IS RIGHT (verified correct, with the checks performed)

**Math verified line-by-line:** Black-Scholes price/Greeks (signs, q-adjusted, theta/365, vega per 1%, A&S CDF ≤7.5e-8); IV solver (Newton with vega×100 Jacobian — correct unit handling — plus bisection fallback and intrinsic sanity); `yearsToExpiry` 15:30 IST settlement; **max pain** (writers' payout minimization, correct one-sided sums); PCR OI/volume; classic floor pivots; ADX (Wilder smoothed sums, SMA-seeded ADX, canonical); bbWidth; equity delivery charges; swing-cash sizing (min of risk/value/cash with lot flooring, gap buffer additive, fail-closed on non-finite); F&O lot sizing (risk-budget + heat + ceiling, floor semantics, correct min/bind reporting); composite bias (the documented deviation from the spec's broken ×10/1.71 fudge is the *right* call and honestly annotated); GEX formula (γ·OI·lot·S²·0.01 with correct call+/put− dealer convention) — subject to the OI-unit verification in Section 5.

**Engineering verified:** paper F&O open path is a defense-in-depth stack that would pass a professional review — fail-closed tradeability assertion → premium-trust gate (Kite-only, per-leg LTP+OI) → confidence floor → idempotent existing-row check → market-hours → consecutive stops → daily/weekly DD caps → time cutoffs → 30% premium-loss stop cap → liquidity gates (LTP floor fail-closed, spread best-effort, missing-strike fail-closed, OI=0 fail-closed) → FOR UPDATE account lock → txn-internal BASELINE guardrails (fail-closed on stats unavailability, with alert counter) → dynamic sizing → post-stop & VOLATILE multipliers (reduce-only) → final fail-closed heat assertion → **cash-affordability check** (yes, it's there — `balance < capitalDeployed` refuses) → ON CONFLICT insert + predicated atomic debit that rolls the whole txn back on a lost race. The 15:20 force-exit, orphan reconciliation, MTM sweep (GREATEST/LEAST watermarks, decision-neutral), and exit trust gate (fail-closed on Yahoo/stale/no-session with `wouldHaveExited` diagnostics) are all correctly separated from the open gate so corrective exits still run in read-only mode. The lifecycle's stop-wins-on-same-bar rule is conservative and correct, including the runner-after-T1 no-trail case, and the T2>T1 ordering invariant in `clampPlanForIntraday` correctly prevents folded-geometry false T2 hits.

**Signal-engine architecture:** the gate/veto/demote system (HTF daily + true session-aware 1h aggregation that correctly drops orphan 4-bar chunks and never spans the overnight gap, RS-vs-NIFTY with benchmark self-exclusion, rolling win-rate with sample guard, recovery/chase vetoes, opening/closing noise windows, expiry-day, VIX intraday+gap spike, bias-flip cooldown, correlated-bucket suppression, stale-PENDING expiry) with the clean-vs-demoted top-3 partition is a genuinely well-thought-out design. Trigger-realism translation preserving RR, the min/max stop clamp with the vol-clamp hard-reject ratio, and the HC emission floor all do what their comments claim — I checked the arithmetic.

**Frontend:** pages render server-computed values; I found no client-side re-derivation of P&L, RR, or charges that could drift from the backend (paper-reports, paper-trading, options, backtest-lab checked). Backtest Lab's honesty panel (modeled-field flags, pricing-mode mix chips, blank-stays-blank CSV export) matches the backend taxonomy. Ownership gating on the trading tabs is correct in the router.

---

## 5. VERIFY EMPIRICALLY (cannot be settled from source; each has a cheap decisive test)

**V1 — Kite OI units (affects GEX and OI-Lab rupee notionals).** `gex.ts` asserts Kite `q.oi` is in *contracts (lots)* and multiplies by lotSize; the cited "proof" is your own oiLab line assuming the same thing — circular. If Kite reports OI in *units* (as its volume field does), GEX and OI notionals are inflated ~lotSize× (75× on NIFTY). **Test:** take one liquid strike, compare Kite `q.oi` against the NSE website's OI (contracts) for the same strike at the same time. If Kite ≈ NSE × lotSize → units → fix the multiplier. If Kite ≈ NSE → contracts → close the item and replace the circular proof with this empirical one. Also recheck `MIN_OPTION_OI = 50,000` after the answer — under the units interpretation it's ~667 NIFTY lots, a near-decorative floor.

**V2 — Brokerage under freeze quantity.** ₹20/side assumes one order per side; NIFTY freeze qty (1,800 units = 24 lots at lot 75) means >24 lots requires multiple orders. Your ceilings (≤10 lots) currently keep this moot — add a comment tying the assumption to the ceiling so raising one forces revisiting the other.

**V3 — STT-on-exercise path.** Paper closes on premium so `STT_RATE_EXERCISE_INTRINSIC` is published-only — correct today. If you ever let an ITM long run into expiry (e.g., a future swing-options mode), the 0.15%-on-intrinsic charge is a large cost and must enter the model.

**V4 — Suppressed-reason distribution.** After D2, pull 30 days of `suppressed[]` and setup-emission counts. Prediction from this audit: MEAN_REVERSION and VOLUME_BREAKOUT emissions ≈ 0 for the indices; TREND_CONTINUATION dominant. If confirmed, that's the empirical smoking gun for the VWAP fix's priority.

---

## 6. TAB-BY-TAB STATUS (all 35 routes)

| Tab | Status | Notes from this pass |
|---|---|---|
| Home `/` | ✅ | Server-computed pulse; no client math drift found. |
| Scanner `/scanner` | ✅/⚠️ | Engine sound; full-NSE partial-coverage (~198-row cached set) remains the known Stage-2 gap — needs the loud partial label + parallelization you already planned. |
| Option Chain `/option-chain` | ✅ | Spot-trust provenance surfaced; per-leg buildup from real priceChg+oiChg, not sign-only re-derivation. |
| OI Lab `/oi-lab` | ✅/V1 | Sentiment scoring, support/resistance spot-side filtering (the resistance-below-spot bug is fixed) correct; rupee notionals subject to V1 OI-unit check. |
| F&O Cockpit `/options` | ⚠️ | D2 (VWAP semantics) + D3 (trigger wording) affect card honesty; everything else verified. |
| Strategies `/strategies`, Builder | ✅ | Not exhaustively re-derived; payoff structures spot-checked, no issues found. |
| Paper Trading `/paper-trading` | ✅/G2 | Execution path exemplary (Section 4); headline P&L is gross — G2. |
| Paper Reports `/paper-reports` | ❌→fixable | **D1: STT 0.10% stale → net P&L overstated.** Structure otherwise correct (charges netted per trade, calendar buckets consistent). |
| Backtest Lab `/backtest-lab` | ❌→fixable | **D1: replay STT 0.05% + exchange 0.053% both wrong.** Pricing-mode taxonomy, tolerance rules, coverage flags, honesty panel all correct. |
| Swing Cash `/swing-cash` | ✅ | Entry gate math (rrNow from LTP, chase/stale/too-close classifications), sizing, TTL sweep, staging state machine (broker_order_id stays null) all verified sound. |
| Stocks to Watch / Swing Scanner | ✅/G6 | Deterministic port is clean; scoring weights internally consistent; ATR definition note G6. |
| Deep Scan, Stock Detail | ✅/D4 | MACD warm-up nit is most visible here on short series. |
| Pre-market, Daily Analysis | ✅ | Composite bias implementation is *better* than its source spec and says so honestly. |
| Flows, Sectors, Watchlist, Indices | ✅ | Read-only surfaces of verified libs; no independent math. |
| Charting | ✅ | Futures-volume VWAP merge is the right approach — the irony is it should also feed the signal engine (D2 fix b). |
| Portfolio Analyser | ✅ | XIRR/HHI previously verified; nothing new found. |
| News, Learn, Legal | ✅ | Static/feed surfaces. |
| Kite, Audit, Status, Admin, Infra, F&O Diagnostics, Manifesto (owner) | ✅ | Diagnostics-only; exit-monitor health counters correctly per-invocation (no shared-accumulator cross-attribution). |

---

## 7. WHAT TO ADD / IMPROVE — PRIORITIZED

**P0 (this week, small diffs, protects the integrity of every number you're accumulating):**
1. Unify the cost model (D1) — single import, structural test. Re-state the Stage-4 replay result with corrected costs before drawing any conclusion from it.
2. `sessionVwap` fail-closed on zero volume + explicit suppressed-reasons for volume-dependent detectors (D2 option a). This is label-honesty even if you later do option b.
3. Fix the trigger wording or the trigger logic (D3) — pick one semantics.

**P1 (behaviour-changing, flag-gated, feeds your Stage-3/4 goals):**
4. Futures-volume candles into the signal engine (D2 option b) with provenance tag; shadow-compare emission diffs for 2 weeks before promoting.
5. `exit_premium_market` shadow column on every F&O close (G1) — turns the frozen-vs-real settlement debate into measured data.
6. Suppressed-reason + setup-frequency dashboard (you already planned this as Stage 3) — with D2 fixed it becomes interpretable.

**P2 (consistency and completeness):**
7. Equity risk-based sizing option (G3), NSE holiday calendar (G5), MACD warm-up fix (D4), Kite-OI unit empirical test (V1) and correct GEX if it fails.
8. The out-of-sample wall you already identified as the real remaining 20% — nothing in this audit changes that conclusion; D1/D2 just mean the in-sample numbers you'd have walled off were themselves miscosted and partially mislabelled. Fix first, then start the clock.

---

## 8. CLOSING ASSESSMENT

What is *right* about this platform is rare: the data-honesty layer, fail-closed defaults, transaction discipline, and audit-trail culture are ahead of most retail-built systems and many professional ones. What is *wrong* is narrow but consequential: the platform is currently keeping score with two miscalibrated scoreboards (Paper Reports, Backtest replay) and generating signals whose single largest confidence driver, for the three instruments it actually trades, is not the indicator its label claims. Both are fully fixable within your existing architecture — the futures-volume module and the canonical cost model already exist in the repo; they just aren't wired to the places that matter most. Fix D1–D3, re-baseline, and then the 6–12-month analytical-patience plan stands on clean numbers.
