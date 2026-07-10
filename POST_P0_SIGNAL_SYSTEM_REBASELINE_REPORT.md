# Post-P0 Signal System Re-Baseline Audit

**Status: `POST_P0_SIGNAL_SYSTEM_REBASELINE_PARTIAL_GAP_REMAINS`**  
**Date: 2026-07-08**  
**Baseline: `POST_P0_CLEAN_BASELINE_2026_07_08`**  
**Partial Gap: Zero post-P0 signals and trades — market sessions required to accumulate post-baseline evidence**

> **Re-baseline framework is complete, but performance validation is pending until market sessions generate post-P0 signals and trades.**
>
> - Clean baseline is created ✓
> - All P0 fixes are confirmed live in production ✓
> - Reports are updated, old data is labeled `PRE_P0_FIX_DATA` ✓
> - Tests are green (1,193 pass) ✓
> - Post-P0 signal sample: **0** — cannot yet evaluate detector performance, CALL/PUT distribution, paper-trade quality, or edge
> - Post-P0 paper trade sample: **0** — cannot yet evaluate execution, cost model accuracy, or realized P&L
>
> **Next action:** Wait for market sessions to generate post-P0 signals and trades. Run `POST_P0_SIGNAL_SAMPLE_REVIEW` once a sufficient sample exists (recommended: ≥5 trading sessions / ≥20 post-P0 signals).

---

## 1. Objective

All three P0 honesty fixes are now PROD_VERIFIED. This report creates a clean separation between pre-fix and post-fix signal quality data, documents what the detectors can and cannot do in the honest post-P0 state, and establishes the forward baseline for all future signal-performance measurement.

**No code was changed by this audit.** Read-only analysis only.

---

## 2. Part A — Production Fix Status Confirmation

| Fix | Production Status | Evidence | Verdict |
|---|---|---|---|
| `/api/build-info` latest commit | `eb09789d` (all P0 fixes live) | HTTP 200, commitShort confirmed | ✓ PASS |
| `verify:release` | 11 PASS / 0 WARN / 0 FAIL | Bundle `index-BI-foe_a.js`, all 7 checkpoint markers true | ✓ PASS |
| F&O cost model (P0-1) | Canonical rates live | `fnoCostModel.test.ts` + `fnoCostModelUnification.test.ts` 102/102 | ✓ PROD_VERIFIED |
| VWAP returns null when vol=0 (P0-2) | `sessionVwap` / `rollingVwap` return null for zero-vol bars | `optionSignals.zeroVolume.test.ts` 11/11 | ✓ PROD_VERIFIED |
| Volume Profile returns null when vol=0 (P0-2) | `volumeProfile` returns null when `totalVol ≤ 0` | Source confirmed + test coverage | ✓ PROD_VERIFIED |
| F&O signals expose `vwapAvailable` (P0-2) | `vwapAvailable: c.vwapAvailable` on every emitted signal | OpenAPI field + codegen + DB column | ✓ PROD_VERIFIED |
| Trigger wording honest (P0-3) | No `"15-min close"` in any `entryTrigger` string | `optionSignals.triggerSemantics.test.ts` 13/13 | ✓ PROD_VERIFIED |
| Broker (real Kite) execution | DISABLED | `/api/paper/diagnostics/environment` → paper bot only | ✓ CONFIRMED |
| No real orders | CONFIRMED | Paper auto-trader flag only; no real order path in codebase | ✓ CONFIRMED |
| No Telegram spam | CONFIRMED | No strategy/signal change in this audit | ✓ CONFIRMED |

---

## 3. Part B — Clean Baseline Definition

### P0 Fix Production Timeline

| Fix | Commit | Production Boot Time (UTC) | IST |
|---|---|---|---|
| P0-2 VWAP / Volume Profile Honesty | `8ba275a` | 2026-07-07T06:59:17Z | 12:29 IST |
| P0-1 F&O Cost Model Unification | `646e43be` | 2026-07-07T14:34:23Z | 20:04 IST |
| P0-3 Trigger Wording / Semantics | `eb09789d` | **2026-07-08T06:54:45Z** | **12:24 IST** |

### Clean Baseline

```
POST_P0_CLEAN_BASELINE_2026_07_08
Timestamp: 2026-07-08T06:54:45Z (IST: 12:24:45)
Commit:    eb09789d
```

**All three P0 fixes simultaneously live from 2026-07-08T06:54:45Z onwards.**

### Data Separation Rule

| Label | Period | Usage |
|---|---|---|
| `PRE_P0_FIX_DATA` | `generated_at < 2026-07-08T06:54:45Z` | NOT clean evidence of signal edge — contaminated by fabricated VWAP, wrong cost model, misleading card wording |
| `POST_P0_CLEAN_BASELINE_DATA` | `generated_at >= 2026-07-08T06:54:45Z` | Clean evidence — honest data, canonical costs, correct trigger wording |

> **Warning:** Performance before `POST_P0_CLEAN_BASELINE_2026_07_08` included older cost/VWAP/VP/trigger-wording behaviour and must not be used as clean evidence of signal edge.

---

## 4. Part C — F&O Signal Distribution Audit

### 4.1 Pre-P0 Signal Summary (3 main F&O indices)

| Period | Index | Total Signals | Calls | Puts | HC | Baseline | Avg Conf | Median Conf | Trading Days |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| PRE_P0 | NIFTY | 78 | 44 | 34 | 0 | 70 | 54.8 | 50.0 | 35 |
| PRE_P0 | BANKNIFTY | 82 | 48 | 34 | 0 | 71 | 56.6 | 55.0 | 35 |
| PRE_P0 | SENSEX | 78 | 44 | 34 | 0 | 67 | 55.7 | 54.0 | 35 |
| PRE_P0 | **Total (3 indices)** | **238** | **136** | **102** | **0** | **208** | **55.7** | **—** | **35** |

**Notes:**
- First signal: 2026-04-27 (NIFTY/BANKNIFTY/SENSEX simultaneously — backfill/warm-up)
- Last pre-P0 signal: 2026-07-08T06:21 UTC (11:51 IST) — just before the clean baseline
- **Zero HC-tier signals** in the entire pre-P0 corpus: all BASELINE tier
- CALL/PUT ratio: 57:43 (136 CALL vs 102 PUT) — slight bullish skew in pre-P0 period

**Obsolete indices (pre-P0 only, not part of current F&O universe):**

| Index | Total | Status |
|---|---|---|
| BANKEX | 9 | Removed from F&O universe |
| FINNIFTY | 11 | Removed from F&O universe |
| MIDCPNIFTY | 11 | Removed from F&O universe |

### 4.2 Post-P0 Signal Summary

| Period | Index | Total Signals | Status |
|---|---|---:|---|
| POST_P0 | NIFTY | 0 | Baseline set 2026-07-08T12:24 IST — no post-baseline market session yet |
| POST_P0 | BANKNIFTY | 0 | Same |
| POST_P0 | SENSEX | 0 | Same |

**`NO_POST_P0_SIGNAL_SAMPLE_YET`** — The clean baseline was set during trading hours on 2026-07-08. The first post-P0 signals will accumulate from the next market session (2026-07-09 onwards).

### 4.3 Contaminated Pre-P0 Signals (VWAP fabrication era)

These signals were generated while VWAP was being fabricated from zero-volume cash index data. They must NOT be used as evidence of real signal edge.

| Index | Detector | Count | Avg Conf | Period | Contamination |
|---|---|---:|---:|---|---|
| NIFTY | VWAP_RECLAIM | 7 | 74.3 | 2026-05-05 → 2026-06-15 | VWAP fabricated from zero-vol data |
| BANKNIFTY | VWAP_RECLAIM | 10 | 72.1 | 2026-05-13 → 2026-07-07 | VWAP fabricated from zero-vol data |
| SENSEX | VWAP_RECLAIM | 10 | 73.4 | 2026-05-05 → 2026-06-15 | VWAP fabricated from zero-vol data |
| **Total** | | **27** | **73.4** | | All contaminated — high apparent confidence driven by fabricated data |

An additional partial contamination applies to TREND_CONTINUATION (the ±25-pt VWAP confidence driver was active) and BASELINE_OUTLOOK (had a systematic false BEARISH vote from `spot > spot` always-false comparison). These are harder to isolate by count since the detectors still fired with correct logic, but with inflated/deflated confidence.

---

## 5. Part D — Detector-Wise Audit (Post-P0)

### 5.1 Pre-P0 Detector Distribution

| Detector | NIFTY | BANKNIFTY | SENSEX | Total | Avg Conf | Data Honest (pre-P0)? |
|---|---:|---:|---:|---:|---:|---|
| BASELINE_OUTLOOK | 59 | 56 | 57 | 172 | 50.4 | ⚠️ Partial — systematic false BEARISH vote from `spot > spot` |
| EMA_PULLBACK | 11 | 13 | 9 | 33 | 66.7 | ✓ Authentic — no VWAP/VP dependency |
| VWAP_RECLAIM | 7 | 10 | 10 | 27 | 73.3 | ✗ Contaminated — fabricated VWAP |
| TREND_CONTINUATION | 1 | 3 | 2 | 6 | 65.2 | ⚠️ Partial — ±25pt VWAP confidence driver from fabricated data |
| VOLUME_BREAKOUT | 0 | 0 | 0 | 0 | — | N/A — suppressed by null VP (worked correctly) |
| MEAN_REVERSION | 0 | 0 | 0 | 0 | — | N/A — suppressed naturally when dist=0 |

### 5.2 Post-P0 Detector Capability Matrix

| Detector | Fires for NIFTY/BANKNIFTY/SENSEX? | VWAP dependent? | VP dependent? | Post-P0 behavior | Data Honest? | Needs redesign? |
|---|---|---|---|---|---|---|
| **EMA_PULLBACK** | ✓ Yes — fully operational | No | No | Pure EMA + RSI + momentum. Unchanged. | ✓ Yes | No |
| **BASELINE_OUTLOOK** | ✓ Yes — 3-vote system | Formerly yes (4-vote) | No | 3-vote (EMA21, EMA9vsEMA21, RSI). False BEARISH eliminated. Conf 30–45 | ✓ Yes | No |
| **TREND_CONTINUATION** | ✓ Yes — degraded | Formerly yes (+25pt boost) | No | EMA-stack-only when `!vwapAvailable`. Base conf 20 (was 45). VWAP driver suppressed. | ✓ Yes | Monitor — reduced signal confidence |
| **VWAP_RECLAIM** | ✗ NEVER fires | Yes — is the signal | No | Hard-suppressed: `return null` when `!vwapAvailable`. Correct — without real VWAP there is no reclaim to detect. | ✓ Yes (honest null) | Yes — alternative detector needed for cash indices |
| **MEAN_REVERSION** | ✗ NEVER fires | Yes — distance from VWAP | No | Structurally null: `effectiveVwap = spot`, dist = 0, `extendedUp/Dn = false → return null`. | ✓ Yes (honest null) | Yes — alternative distance metric needed |
| **VOLUME_BREAKOUT** | ✗ NEVER fires | No | Yes — VAH/VAL levels | Structurally null: `volumeProfile = null` → `if (!c.vp) return null`. | ✓ Yes (honest null) | Yes — alternative breakout detector needed |

### 5.3 Post-P0 Active Detector Count

- **Fully operational**: 2 of 6 (EMA_PULLBACK, BASELINE_OUTLOOK)
- **Degraded but operational**: 1 of 6 (TREND_CONTINUATION — EMA-only mode)
- **Structurally suppressed (honest)**: 3 of 6 (VWAP_RECLAIM, MEAN_REVERSION, VOLUME_BREAKOUT)

**Implication**: The F&O signal system is now running with 3 honest detectors for cash indices (NIFTY/BANKNIFTY/SENSEX). This is a CORRECT and SAFE state — the previous 6-detector diversity was partially illusory (VWAP_RECLAIM/MEAN_REVERSION/VOLUME_BREAKOUT were either fabricating or could fabricate). The reduced diversity is the honest cost of honesty.

---

## 6. Part E — Paper Trade Audit (Post-P0)

### 6.1 Post-P0 Paper Trades

```
NO_POST_P0_TRADE_SAMPLE_YET
```

Query: `SELECT * FROM paper_trade_fo WHERE opened_at >= '2026-07-08T06:54:45Z'` → 0 rows.

The clean baseline was set during market hours (12:24 IST) on 2026-07-08. No paper trade opened after the baseline timestamp.

### 6.2 Pre-P0 Paper Trades (ALL — for historical reference only)

| Index | Total Trades | Stops | Targets | Still Open | Total P&L | Period |
|---|---:|---:|---:|---:|---:|---|
| SENSEX | 4 | 0 | 0 | 4 (open) | ₹5,156 (unrealised) | 2026-05-04 → 2026-05-06 |
| BANKEX | 2 | 0 | 0 | 2 (open) | ₹3,313 (unrealised) | 2026-05-04 → 2026-05-05 |
| FINNIFTY | 1 | 0 | 0 | 1 (open) | ₹-1,960 (unrealised) | 2026-05-05 |
| NIFTY | 0 | — | — | — | — | No paper trades ever opened |
| BANKNIFTY | 0 | — | — | — | — | No paper trades ever opened |

**Label: `PRE_P0_FIX_DATA`** — These 7 trades were opened under the pre-P0-2 VWAP fabrication era (all before 2026-05-07). They must not be used as evidence of post-fix paper trading performance.

**Note on NIFTY/BANKNIFTY**: These never opened any paper trades in the historical record — the paper auto-trader either was not enabled or no signal met the `STRONG_BUY` + HC requirement during the live paper-trading period.

### 6.3 Recommendation

Wait for the next 2–5 market sessions (2026-07-09 onwards) before drawing any conclusions about post-P0 paper trade performance.

---

## 7. Part F — Old Data Honesty Labels

All performance statistics, signal distributions, and paper trade results before `POST_P0_CLEAN_BASELINE_2026_07_08` carry this label:

> **`PRE_P0_FIX_DATA` — NOT comparable with post-fix signal quality.**  
> Performance before `POST_P0_CLEAN_BASELINE_2026_07_08` (2026-07-08T06:54:45Z) included:
> - Fabricated VWAP/Volume Profile indicators for NIFTY/BANKNIFTY/SENSEX (zero-volume cash indices)
> - Cost model with STT rates from pre-2026-04-01 era
> - Signal cards claiming "15-min close confirmation" where execution was actually touch/wick-triggered
> - BASELINE_OUTLOOK with a systematic false BEARISH vote from `spot > spot`
>
> **Do not use pre-P0 signal statistics as clean evidence of signal edge.**

Old history is preserved in the database unchanged. Only the label is applied.

---

## 8. Part G — Next P1 Priority Recommendation

### Context from audit findings

3 of 6 detectors (VWAP_RECLAIM, MEAN_REVERSION, VOLUME_BREAKOUT) are now honestly suppressed for all three F&O indices. The signal system is running on 3 effective detectors with reduced diversity. This is the single most important architectural gap exposed by P0.

### P1 Ranking

| Rank | Task | Why | Risk | Expected Value |
|---:|---|---|---|---|
| 1 | **Exit premium market shadow column** — record real Kite option exit price alongside synthetic paper exit, compare in a shadow report | Zero paper trades closed post-P0 means we cannot yet validate exit P&L honesty. This is the highest data-quality gap that will affect real performance evidence. Low-risk additive schema column. | LOW — additive column, no execution change | HIGH — turns paper P&L from synthetic-only to real-vs-synthetic comparison |
| 2 | **Detector redesign for cash indices** — replace VWAP_RECLAIM/MEAN_REVERSION/VOLUME_BREAKOUT with OI-momentum, ATR-range, or MACD-based equivalents that work without volume data | 3 of 6 detectors dead. Signal diversity is halved. The only honest fix is new detectors that don't depend on zero-volume data. | MEDIUM — new detector logic, needs backtesting before live | HIGH — restores signal variety with honest data |
| 3 | **Detector emission + suppressed-reason dashboard** — show per-session why each detector fired or was suppressed (data unavailable / below threshold / guard rejected) | Currently invisible — operator cannot see whether TREND_CONTINUATION fired in degraded mode or why VWAP_RECLAIM never appeared | LOW — read-only display, no logic change | MEDIUM — operational visibility |
| 4 | **MACD warm-up fix** — MACD requires ~26 bars before emitting; warm-up bars are currently excluded from some contexts | Could improve TREND_CONTINUATION in degraded (EMA-only) mode by adding MACD as a supplemental signal | LOW — pure indicator fix | MEDIUM |
| 5 | **Paper trading gross-vs-net account display** — surface net P&L (after canonical charges) in the UI alongside gross | P0-1 fixed cost model. UI still shows gross in some views. Cosmetic but honesty-relevant. | LOW — UI-only, no execution change | MEDIUM |
| 6 | **Kite OI unit verification against NSE** | OI data quality is unverified; potential unit mismatch (lots vs contracts) | LOW — read-only verification | MEDIUM |
| 7 | **NSE holiday calendar** | Already partially handled by EXPIRY_DAY regime; lower urgency | LOW | LOW |
| 8 | **Equity gap-through exit realism** | Equity paper trading; separate from F&O signal system | MEDIUM | MEDIUM |
| 9 | **Charting professional upgrade** | UI; does not affect signal quality | MEDIUM | MEDIUM (UX) |

**Recommended immediate next step**: P1-Rank-1 (exit premium shadow column) — it unblocks post-P0 paper trade P&L validation with real data.

---

## 9. Part H — Tests

All tests executed in batches to stay within 120s tool timeout. No test failures.

| Suite | Files | Tests | Status |
|---|---|---:|---|
| P0 regression (triggerSemantics + zeroVolume + cost model) | 5 | 102 | ✓ PASS |
| FNO signals + risk guards + paper account + routes batch 1 | 10 | 165 | ✓ PASS |
| Routes + provider import guard + backtest + monitoring | 7 | 102 | ✓ PASS |
| Paper trading (MTM sweep + orphan exit + premium path + analytics + capital + heat) | 6 | 54 | ✓ PASS |
| Scanner full suite (770 tests across 35 files) | 35 | 770 | ✓ PASS |
| **Total** | **63** | **1,193** | **✓ ALL PASS** |

`pnpm --filter @workspace/api-server run typecheck` — **clean**  
`pnpm --filter @workspace/scripts run index:llm:check` — **349 tracked files, 0 stale**  
`pnpm --filter @workspace/scripts run verify:release` — **11 PASS / 0 WARN / 0 FAIL**

---

## 10. Summary Table

| Item | Status | Details |
|---|---|---|
| All P0 fixes confirmed in production | ✓ | commit `eb09789d`, bootTime 2026-07-08T06:54:45Z |
| Clean baseline documented | ✓ | `POST_P0_CLEAN_BASELINE_2026_07_08` at 2026-07-08T06:54:45Z |
| Pre-P0 data labeled | ✓ | `PRE_P0_FIX_DATA` — not comparable with post-fix quality |
| Pre-P0 signal distribution audited | ✓ | 238 signals (NIFTY/BANKNIFTY/SENSEX), 35 trading days |
| Contaminated signals identified | ✓ | 27 VWAP_RECLAIM signals (fabricated VWAP) labeled |
| Detector post-P0 capability matrix | ✓ | 3 active (EMA_PULLBACK, BASELINE_OUTLOOK, TREND_CONTINUATION degraded), 3 suppressed |
| Post-P0 signal sample | ✗ GAP | 0 signals — market sessions required |
| Post-P0 paper trade sample | ✗ GAP | 0 trades → `NO_POST_P0_TRADE_SAMPLE_YET` |
| P1 priority ranked | ✓ | Exit premium shadow column = Rank 1 |
| Tests | ✓ | 1,193/1,193 pass |

---

## 11. Final Verdict

**`POST_P0_SIGNAL_SYSTEM_REBASELINE_PARTIAL_GAP_REMAINS`**

**Re-baseline framework is complete, but performance validation is pending until market sessions generate post-P0 signals and trades.**

| Component | Status |
|---|---|
| P0 fixes confirmed in production | ✓ Complete |
| Clean baseline documented | ✓ Complete |
| Pre-P0 data labeled `PRE_P0_FIX_DATA` | ✓ Complete |
| Detector capability matrix (post-P0) | ✓ Complete |
| Reports updated | ✓ Complete |
| Tests green | ✓ Complete (1,193/1,193) |
| Post-P0 signal sample | ✗ Gap — 0 signals; cannot evaluate detector performance, CALL/PUT distribution, or confidence distribution |
| Post-P0 paper trade sample | ✗ Gap — 0 trades (`NO_POST_P0_TRADE_SAMPLE_YET`); cannot evaluate execution quality, cost model accuracy, or edge |
| Lane 1 canonical data parity (2026-07-09) | ✓ `P0_LANE1_CANONICAL_DATA_PARITY_CONTRACT_MASTER_DEV_VERIFIED` — 57 acceptance tests pass; all 5 gaps closed |

The gap is not a defect — it is the expected state when a baseline is freshly set during a trading session (2026-07-08T12:24 IST). No signals or trades can accumulate until the next market session.

**Next action:** Wait for market sessions to generate post-P0 signals and trades, then run `POST_P0_SIGNAL_SAMPLE_REVIEW`. Recommended trigger: ≥5 trading sessions (≈ 2026-07-15) or ≥20 post-P0 signals across the three F&O indices.

---

## Addendum — P1 Exit Premium Market Shadow Column (2026-07-08)

**Verdict: `EXIT_PREMIUM_MARKET_SHADOW_DEV_VERIFIED`**

The Rank-1 P1 priority identified in this report has been implemented. The shadow column
infrastructure is now in place on `paper_trade_fo`. Once post-P0 paper trades accumulate,
`exit_premium_market` (real Kite chain LTP at exit) can be compared against `exit_premium`
(frozen synthetic MTM price) to evaluate exit-price quality and slippage magnitude.

**No signal/decision/P&L/balance code was changed.** The shadow is purely observational.
Production publish remains pending — shadow capture activates in prod after the next deploy.

Full detail: `EXIT_PREMIUM_MARKET_SHADOW_REPORT.md`

---

## Addendum — P1 Production Verification (2026-07-08)

**Verdict: `EXIT_PREMIUM_MARKET_SHADOW_PROD_INFRA_VERIFIED_LIVE_SAMPLE_PENDING`**

Production deployed at commit `a8e0a6a6` (2026-07-08T10:19:32Z boot). All 8 shadow columns confirmed present and nullable in production DB. Legacy trades correctly return null for all shadow fields. No post-deploy F&O exits have occurred yet (`NO_LIVE_EXIT_SAMPLE_YET`). Shadow capture infrastructure is live. Full PROD_VERIFIED pending a real exit sample. See `EXIT_PREMIUM_MARKET_SHADOW_REPORT.md` §13 for complete evidence.

---

## Addendum — P1 Kite OI Unit Verification (2026-07-08)

**Verdict: `KITE_OI_UNIT_VERIFICATION_LABEL_ONLY_GAP`**

Completed as a separate P1 verification task on 2026-07-08.

**Scope:** Read-only audit. Verified whether Kite option-chain `q.oi` values are in
contracts or quantity. Covered gex.ts, kiteOptionChain.ts, oiLab.ts, optionAnalytics.ts,
paperAccount.ts, and production `option_chain_snapshot` table (9 strike-side pairs).

**Key finding:** Kite `q.oi` is in **CONTRACTS**. All code files are internally consistent.
GEX formula, OI notional, PCR/MaxPain, sentimentScore all correct. The `FNO_LIQUIDITY`
paper-trade gate (`MIN_OPTION_OI = 50,000`) is correctly calibrated and discriminates liquid
from illiquid strikes in live production data. NSE direct comparison was `NSE_LIVE_VERIFICATION_PENDING`
(geo-restricted from Replit), but 9-pair magnitude analysis strongly confirms contracts.

**OI gate impact on signal system:** OI_VETO and ATM OI conflict gates are unit-agnostic
(ratio-based). The only unit-sensitive gate (`FNO_LIQUIDITY.MIN_OPTION_OI`) is correct.
No signal logic changes required.

**Two documentation gaps (no trading impact):** stale line reference in gex.ts comment
(line 1716 → 1746) and OI Lab narrative "Cr" label without "contracts" qualifier.

Full detail: `KITE_OI_UNIT_VERIFICATION_REPORT.md`

---

## Addendum — P1 Consolidated Audit + P1A — 2026-07-08

**Verdict: `P1A_PAPER_TRADING_GROSS_NET_DISPLAY_DEV_VERIFIED`**

Five P1 items audited. No signal/F&O/swing logic changed. Full detail in
`P1_CONSOLIDATED_REMAINING_WORK_AUDIT_REPORT.md`.

**Relevant to signal system:**

- **MACD warm-up (P1B, deferred):** Canonical `indicators.ts` zero-fills null MACD
  values before signal EMA (`v ?? 0`). Global implementation is correct (seeds from first
  valid value). For scanner scoring, `chart.close.length >= 30` guard limits impact to
  new listings. Rule 6 (weight 8) may produce distorted early histogram for very new
  symbols. Fix is medium-risk behavioral change — must be standalone, with owner
  awareness that historical MACD reads for short-history symbols will change.

- **MACD signal is not the primary F&O signal driver** — F&O signals are generated by
  the Phase-3 confluence engine via `optionSignals.ts`, not the scanner MACD. MACD
  affects the NSE equity scanner (280-symbol universe scoring) and the home dashboard
  index sparklines. It does NOT directly gate F&O paper trade opens.

- **P1B MACD warm-up fix (PROD_VERIFIED 2026-07-08):** The zero-fill bug in canonical
  `indicators.ts` is fixed and live in production (commit `8f41f811`, after MACD fix
  `f224e41`). Signal EMA is now seeded only from the first valid MACD value (bar 33 for
  defaults), matching `global/indicators.ts`. Impact: new NSE listings with < 35 bars of
  daily data get null MACD histogram instead of a distorted value (expected, correct drift).
  Long-history symbols (250+ bars) are unaffected. No F&O signal thresholds or weights
  changed. Scoring Rule 6 weight ±8 unchanged — only the histogram input is now correct.
  This is now the confirmed signal baseline for MACD-related audits.

- **POST_P0_SIGNAL_SAMPLE_REVIEW:** Still pending. Run after ≥5 sessions or ≥20
  post-P0 signals. MACD warm-up fix (P1B) is now complete and should be treated as the
  new signal baseline — do not compare future samples against pre-P1B MACD behavior.

- **P1A (paper display):** Pure UI — zero impact on signal generation, scoring, or
  paper-trade opening eligibility.

---

## UPDATE 2026-07-09 — P0-00 plan immutability and the re-baseline sample

P0-00 (signal-plan immutability, `P0_00_SIGNAL_PLAN_IMMUTABILITY_REPORT.md`) changed
**persistence and display only** — no detector, confidence, gate, sizing, or threshold
change — so it does NOT reset the post-P0 sample window. However, future sample review
gains a data-quality benefit: plan premiums recorded from 2026-07-09 onward are
write-once (`option_premium_locked_at`), so per-signal plan-vs-outcome analysis can trust
`option_entry/option_stop_loss/option_target1/2` as the true emitted plan. Pre-fix rows
may carry silently-overwritten premiums (API labels them `legacyPlanFields`) — exclude
premium-plan accuracy metrics for rows created before 2026-07-09, or treat them as
untrusted. Sample status unchanged: **still pending ≥5 sessions / ≥20 post-P0 signals**
(`POST_P0_SIGNAL_SYSTEM_REBASELINE_PARTIAL_GAP_REMAINS`).

**P0-00 PROD_VERIFIED update (2026-07-09)**: Production deploy confirmed (`f831ded1`). Write-once lock is live — production signals generated after 08:03 UTC today have `option_premium_locked_at` set and cannot be overwritten. Pre-fix rows (including the SENSEX 77100 PUT) are correctly labeled `legacyPlanFields: true`. The re-baseline sample window is unaffected by this persistence/display change.

---

## Lane 1 Round-2 — GAP A/B/C/D Status (2026-07-09)

| Component | Status |
|---|---|
| ContractMasterFact module (`contractMasterFact.ts`) | ✅ SHIPPED |
| optionSignals toSignal() leg wiring | ✅ SHIPPED |
| OpenAPI OptionLeg schema expansion | ✅ SHIPPED |
| paper_trade_fo contract columns | ✅ SHIPPED |
| paperTradingFO INSERT wiring | ✅ SHIPPED |
| backtest_trades lot-size columns | ✅ SHIPPED |
| backtest runner annotations | ✅ SHIPPED |
| canonicalDataParity acceptance tests (58 total) | ✅ ALL PASS |

**Lane 1 Round-2 verdict: `P0_LANE1_GAP_ABCD_CLOSED_DEV_VERIFIED`**

---

## Lane 1 Round-3 — Final Closure (2026-07-09)

### Summary

All remaining Lane 1 hard gaps from LANE1_FINAL_HARD_GAP_PROMPT are now closed.

| Requirement | Met? |
|---|---|
| Dedicated contractMasterFact.test.ts with 78 tests | ✅ |
| Runtime proof: warm cache → expirySource=instrument_master | ✅ |
| SENSEX BFO path directly tested (9 tests) | ✅ |
| BANKNIFTY fake-weekly guard directly tested (7 tests) | ✅ |
| Cold-cache / unavailable directly tested (10 tests) | ✅ |
| Paper open contract provenance tested (getLotSizeSource, INSERT, schema) | ✅ |
| Backtest regime/source tested (types, directional 2 sites, runner) | ✅ |
| Frontend surfaces contract identity (ContractMasterBadge, 3 states) | ✅ |
| fetchedAt field in ContractMasterFact interface + all return paths | ✅ |
| All 6 reports updated | ✅ |
| verify:release exact count (11/11 PASS) | ✅ |
| scanner full suite exact count (770/770, 35 files) | ✅ |
| api-server typecheck clean | ✅ |
| scanner typecheck clean | ✅ |
| LLM index fresh (353 files) | ✅ |

### Safety confirmation
Zero changes to: broker execution, real orders, Telegram, strategy thresholds, detector weights, confidence formula, stop formula, target formula, account balance, realized P&L, historical trades, schema destructive migration, P0-00 locked plan.

### Final Lane 1 verdict
**P0_LANE1_CANONICAL_DATA_PARITY_CONTRACT_MASTER_DEV_VERIFIED**

PROD_VERIFIED pending: owner publishes and `/api/build-info` confirms the Lane 1 fix commit is live.

---

## Phase 2A Update — 2026-07-10

**Verdict:** `PHASE_2A_SWING_TELEGRAM_FNO_P0_PARTIAL_GAP_REMAINS`

### Accepted partial work in Phase 2A affecting signal rebaseline

1. **suppressedIndices added to F&O readiness** — `canonicalFnoReadiness.ts` now surfaces which indices are suppressed by name. This improves observability for the signal rebaseline — when a post-P0 sample has suppressed indices the reason is now partially visible. However, per-index reasons (daily bars / intraday / option chain) are not yet granular.

2. **FII/DII wired into pre-market report** — pre-market report now shows actual FII/DII net flow from `fii_dii_monthly`. This does not affect signal logic but improves context for manual rebaseline review.

3. **Provider import guard cleanup** — no impact on signal logic or rebaseline. Infrastructure cleanup only.

### Rebaseline blockers remaining (unchanged from prior status)

- Post-P0 live signal accumulation: requires ≥20 post-Phase-2A signals in production before a meaningful win-rate / confidence-distribution rebaseline can be computed.
- F&O DATA_BLOCKED per-index diagnostics are still incomplete (suppressedIndices only, no per-index reason). Until FP-P0-03A is closed, it is impossible to distinguish signal suppression from data failure vs genuine no-setup conditions.
- Swing approval → paper_trade_eq reconciliation (FP-P0-01A): until the full pipeline is proven end-to-end, swing paper-trade performance data for rebaseline cannot be trusted to be complete.

### No signal thresholds, detectors, weights, or stop/target formulas were changed in Phase 2A.

*Rebaseline status remains: `POST_P0_SIGNAL_SYSTEM_REBASELINE_PARTIAL_GAP_REMAINS`*

---

## Phase 2A P0 Closure — 2026-07-10

**Verdict:** `PHASE_2A_SIGNAL_REBASELINE_P0_GAPS_CLOSED_DEV_VERIFIED`

### Rebaseline blockers resolved:

1. **F&O per-index diagnostics complete (FP-P0-03A closed)** — `IndexFnoDiagnostic` now carries `dailyBarsCount, intradayBarsCount, optionChainFetchOk, quoteStatus, source, asOf, freshness`. It is now possible to definitively distinguish "NIFTY data missing" from "genuine no-setup conditions" per index. Signal suppression reason codes are machine-readable and logged.

2. **Kite timeout behavioral proof (FP-P0-04B closed)** — `classifyKiteHistoricalError()` returns `KITE_REST_TIMEOUT` for "etimedout"/"econnaborted"/"timeout" messages. A `Promise.race` + `vi.useFakeTimers` behavioral test (Case B6) proves a stalled Kite call resolves within 15,000ms with this named code. Diagnostics surface the code as `exactBlockReason` in `IndexFnoDiagnostic`.

3. **Swing → paper_trade_eq pipeline proven (FP-P0-01A closed)** — Telegram dry-run test produces concrete pre/post market messages with non-zero swing counts. `swingOrderStaging.test.ts` Case 23 proves DB insert → `listSwingOrders()` → `toOrder()` serialization matches. DB/API/UI reconciliation table documented in `PART-M-final-report.md`.

### Still pending (not changed by Phase 2A P0 code work):

- Live post-P0 signal accumulation: ≥20 real signals in production required before statistical win-rate rebaseline is meaningful. This is a time-gated production dependency.
- No signal thresholds, detector weights, or stop/target formulas were changed.

### Final signal rebaseline status:

*Structural blockers resolved. Production accumulation (time-gated) remains the only pending dependency.*

*Rebaseline infrastructure status: `POST_P0_SIGNAL_SYSTEM_REBASELINE_INFRASTRUCTURE_VERIFIED`*

---

## Phase 2A Production Verification — 2026-07-10

**Verdict: `PHASE_2A_SWING_TELEGRAM_FNO_P0_PROD_VERIFIED`**

Production build confirmed on Phase 2A fix commit `3ee67447daeb06e3a786b280fc3a4bd2b32b9ef4`. `buildTime: 2026-07-10T14:13:26Z`, `bootTime: 2026-07-10T14:15:39Z`, `environment: production`. All 7 checkpoint markers = `true`. `verify:release`: **11 PASS, 0 WARN, 0 FAIL**.

All owner-only endpoints (swing staged orders, Telegram preview, F&O readiness, TTL sweep) return `{"error":"unauthorized","code":"AUTH_REQUIRED"}` — auth gate active, zero raw SQL or stack traces exposed in any production response.

Post-publish targeted regression: **2,047 tests, 108 files, 0 failures** (swing/paper/fno/daily/routes + scanner). All 3 typecheck targets EXIT:0. LLM index rebuilt with 354 files all fresh.

No signal thresholds, detector weights, or stop/target formulas were changed. Live signal accumulation (≥20 real signals) remains a time-gated production dependency for the statistical rebaseline itself.

*Production signal infrastructure status: `POST_P0_SIGNAL_SYSTEM_REBASELINE_PROD_VERIFIED`*
