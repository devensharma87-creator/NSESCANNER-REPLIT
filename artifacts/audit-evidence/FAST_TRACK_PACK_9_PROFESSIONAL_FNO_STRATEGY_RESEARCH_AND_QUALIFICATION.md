# Pack 9 — Professional F&O Strategy Research & Qualification
## Fast-Track Audit Evidence

**Evidence ID:** FAST_TRACK_PACK_9_PROFESSIONAL_FNO_STRATEGY_RESEARCH_AND_QUALIFICATION  
**Task:** #180  
**Date:** 2026-08-06  
**Verdict:** `BLOCKED_PACK_9_DATA_FOUNDATION_INSUFFICIENT`

---

## Executive Summary

Pack 9 executed a pre-registered, net-of-cost, out-of-sample qualification protocol for up to seven intraday F&O strategy families across NIFTY, BANKNIFTY, and SENSEX. The research protocol was frozen and hashed before any results were inspected. All data integrity, cost-model, execution, and provider-policy invariants were verified in 79 load-bearing unit tests.

**Result: ZERO strategies received `UNIVERSAL_FNO_V2_QUALIFIED` status.** This is a professionally valid outcome. The primary blocking condition is an empty `option_chain_snapshot` table — no real captured option premium data exists for any index on any date. Without real premiums, chronological out-of-sample qualification is structurally impossible.

A secondary open item is Gate 0: the 30-minute continuous parity observation window was not completed in Pack 9 (market closed before the task started; the Pack 8 continuous observation ran for only 10 minutes in a single loop). This does not change the BLOCKED verdict — even with Gate 0 resolved, Gate 1 would still block qualification.

No `FNO_PAPER_V2` activation was triggered. No new strategy was registered. No paper trade, Telegram alert, or broker order was affected.

---

## Gate-by-Gate Evidence

### Gate 0 — Provider Parity (Carryover from Pack 8)

**Pack 8 observation log:** `/tmp/gate0_p28_obs.log`  
**Instruments:** NIFTY 50, BANKNIFTY, SENSEX, RELIANCE, HDFCBANK, ICICIBANK, INFY, SBIN (8 instruments)  
**Observation count per instrument:** 26  
**Total observations:** 208  
**All classifications:** MATCH_WITHIN_TOLERANCE

| Instrument | n | p50 (bps) | p95 (bps) | max (bps) | Skew |
|---|---|---|---|---|---|
| BANKNIFTY | 26 | 0.00 | 0.61 | 0.81 | Negative |
| HDFCBANK | 26 | 0.00 | 1.36 | 1.36 | Negative |
| ICICIBANK | 26 | 0.00 | 1.37 | 1.37 | Negative |
| INFY | 26 | 0.00 | 3.42 | 4.28 | Negative |
| NIFTY 50 | 26 | 0.14 | 0.79 | 0.93 | Negative |
| RELIANCE | 26 | 0.00 | 2.27 | 3.03 | Negative |
| SBIN | 26 | 0.00 | 2.77 | 3.69 | Negative |
| SENSEX | 26 | 0.00 | 0.11 | 0.23 | Negative |
| **ALL** | **208** | **0.00** | **1.71** | **4.28** | Negative |

All deltas within PRICE_BPS_TOLERANCE (50 bps). Negative skew pattern (median = 0, mean > 0) indicates most observations are tick-exact with rare small divergences.

**Duration limitation (OPEN):** The Pack 8 loop ran from 14:05 to 14:15 IST — a 10-minute window, not the required 30 continuous minutes. Market closed at 15:30 IST before Pack 9 could extend the observation. Gate 0 is **PARTIAL** — evidence quality is sufficient to confirm provider parity is within tolerance, but the duration requirement is unmet. This does not affect the BLOCKED verdict.

**Gate 0 status: PARTIAL**

---

### Gate 1 — Data Foundation Audit

**Evidence file:** `artifacts/audit-evidence/p29_gate1_data_inventory.json`

| Data Source | Status | Count | Dates |
|---|---|---|---|
| Spot candle CSVs (NIFTY/BANKNIFTY/SENSEX) | ✓ AVAILABLE | 12,358 rows each | 2024-07-18 to 2026-07-17 |
| `option_chain_snapshot` | ✗ EMPTY | 0 rows | — |
| `option_chain_snapshot_run` | ✗ EMPTY | 0 rows | — |
| `iv_history` (daily ATM IV only) | Partial | 316 rows | 2026-05-05 to 2026-08-06 |
| `backtest_runs` | Present | 81 runs | DIRECTIONAL=45, REAL_REPLAY=36 |

**Critical finding:** `option_chain_snapshot` has 0 rows. No ingestion has ever run. The snapshot table is completely empty. `iv_history` contains daily ATM IV aggregates — useful for regime context but cannot substitute for actual per-contract option premiums.

**Gate 1 status: BLOCKED — option_chain_snapshot is empty; no real option premium data exists.**

---

### Gate 2 — Research Protocol (Frozen)

**Evidence files:**
- `artifacts/audit-evidence/p29_gate2_research_protocol.md`
- `artifacts/audit-evidence/p29_gate2_protocol_hash.txt`

**Protocol SHA-256:** `1d9309fee711cd95a1f19e7e31ee1e041875743623965b3baeedb1299eec2d61`

Protocol frozen before any backtest results were inspected. Covers:
- 7 candidate strategy archetypes (C1–C7)
- Allowed input fields (no synthetic premiums, no fabrication)
- Entry decision timestamp policy (signal on close, fill on next capture)
- Fill model (LTP → bid/ask mid → Black-Scholes → UNAVAILABLE)
- Contract/strike/expiry selection rules
- Exit, stop, target, and time-stop rules (force-exit at 15:20 IST)
- Cost model (8 components, all from `FNO_COST_PARAMS`, `ASOF=2026-04-01`)
- Chronological split (train 2024-07-18→2025-10-31, val 2025-11-01→2026-03-31, test SEALED 2026-04-01→2026-07-17)
- Walk-forward schedule (3 folds, growing window)
- Qualification thresholds (9 gates: expectancy, profit factor ≥ 1.30, max DD ≤ 20%, coverage ≥ 60%, stress survival, concentration limit, regime survival, parameter stability, walk-forward consistency)

**Gate 2 status: COMPLETE**

---

### Gate 3 — Candidate Archetypes

Seven candidate families documented in `p29_gate6_qualification_matrix.json`. Each has:
- Data dependency (all require `option_chain_snapshot` which is empty)
- Universality hypothesis (must work across all 3 indices)
- Parameter space (documented in protocol)
- Disqualification criteria (missing premium, delta-proxy label, coverage < 60%)

Candidates C4, C6, C7 additionally require synchronized multi-leg real premiums.

**Gate 3 status: DOCUMENTED; all 7 candidates BLOCKED_DATA_FOUNDATION_INSUFFICIENT**

---

### Gate 4 — Cost Model Verification

**Evidence file:** `artifacts/audit-evidence/p29_gate4_cost_reconciliation.json`

`computeFnoCosts` (in `premiumReplay.ts`) covers all 8 required components:
1. Brokerage: ₹20/side (fixed)
2. STT: 0.15% on exit premium (sell side only)
3. Exchange transaction: 0.03503% on total turnover
4. SEBI charges: ₹10/crore on total turnover
5. GST: 18% on (brokerage + exchange + SEBI)
6. Stamp duty: 0.003% on entry premium (buy side only)
7. Spread cost: 25 bps/side (canonical default)
8. Slippage: 10 bps/side

All rates come from canonical `FNO_COST_PARAMS` (`ASOF=2026-04-01`). No local rate constants in `premiumReplay.ts` or `backtestCharges.ts`. The `fnoCostModelUnification.test.ts` guard pins cross-consumer agreement.

Stress test: 2× spread, 3× slippage costs verified as positive and scaling correctly with quantity (Category 17 tests pass).

**Gate 4 status: COMPLETE**

---

### Gate 5 — Backtest Results

**Evidence file:** `artifacts/audit-evidence/p29_gate5_backtest_results.json`

Real-premium strategy backtests (C1–C7): **BLOCKED** — `option_chain_snapshot` is empty.

Directional research (existing 6 V1 strategies, delta proxy):
- All 6 strategies labeled `MODELLED_DIRECTIONAL_PROXY`
- All excluded from qualification by Gate 4 policy
- Spot CSV data (12,358 rows per index) is available and suitable for indicator computation
- 81 historical backtest runs exist in `backtest_runs` (45 DIRECTIONAL, 36 REAL_REPLAY)

**Gate 5 status: BLOCKED for real-premium strategies; directional proxy research excluded from qualification**

---

### Gate 6 — Qualification Matrix

**Evidence file:** `artifacts/audit-evidence/p29_gate6_qualification_matrix.json`

| Candidate | Classification | Reason |
|---|---|---|
| C1 ORB Breakout | BLOCKED_DATA_FOUNDATION_INSUFFICIENT | 0 snapshot rows |
| C2 EMA Continuation | BLOCKED_DATA_FOUNDATION_INSUFFICIENT | 0 snapshot rows |
| C3 Compression Breakout | BLOCKED_DATA_FOUNDATION_INSUFFICIENT | 0 snapshot rows |
| C4 Debit Spread | BLOCKED_DATA_FOUNDATION_INSUFFICIENT | 0 snapshot rows; no multi-leg sync |
| C5 Failed Breakout Reversal | BLOCKED_DATA_FOUNDATION_INSUFFICIENT | 0 snapshot rows |
| C6 Straddle/Strangle | BLOCKED_DATA_FOUNDATION_INSUFFICIENT | 0 snapshot rows; no two-leg sync |
| C7 Iron Condor | BLOCKED_DATA_FOUNDATION_INSUFFICIENT | 0 snapshot rows; no four-leg sync |
| CB Benchmark Controls | MODELLED_DIRECTIONAL_PROXY | Delta proxy; excluded by Gate 4 |

**UNIVERSAL_FNO_V2_QUALIFIED count: 0**

**Gate 6 status: COMPLETE — zero strategies qualified**

---

### Gate 7 — N/A (No Qualified Candidates)

**Evidence file:** `artifacts/audit-evidence/p29_gate7_replay_reconciliation.json`

Gate 7 applies only to UNIVERSAL_FNO_V2_QUALIFIED candidates. Zero qualified. Deterministic proofs verified:
- `bsOptionPrice` — pure function, put-call parity holds to 0.01 tolerance (test P29-C19-01)
- `resolvePremiumFromRow` — idempotent for same SnapshotRow (test P29-C19-02)
- `runDirectional` — same candles → same trade count (test P29-C13-02)
- No lookahead: entry spot = close of decision bar (test P29-C4-02)
- Missing data fails closed: `resolveSnapshotLeg` returns null when fetcher returns null (test P29-C5-02)

**Gate 7 status: N/A**

---

### Gate 8 — N/A (No Implementations)

**Evidence file:** `artifacts/audit-evidence/p29_gate8_disabled_strategy_manifest.json`

No V2 strategy was implemented or enabled. STRATEGY_REGISTRY still has exactly 6 V1 entries. `FNO_PAPER_V2` was not activated. `SWING_V2` was not activated. Current-cohort impact is ZERO.

**Gate 8 status: N/A**

---

### Gate 9 — Load-Bearing Test File

**Test file:** `artifacts/api-server/src/lib/p29.pack9.research.test.ts`

79 tests across all 24 mandatory categories. All 79 pass.

| Category | Tests | Status |
|---|---|---|
| 1. Data inventory and coverage arithmetic | 4 | ✓ PASS |
| 2. Duplicate/future/out-of-session detection | 4 | ✓ PASS |
| 3. Contract/expiry/lot-size historical identity | 4 | ✓ PASS |
| 4. No same-bar lookahead | 3 | ✓ PASS |
| 5. Next-eligible-quote execution policy | 3 | ✓ PASS |
| 6. Missing-premium fail-closed behavior | 3 | ✓ PASS |
| 7. Synchronized multi-leg fills | 5 | ✓ PASS |
| 8. Complete transaction costs | 5 | ✓ PASS |
| 9. Gross-to-net reconciliation | 3 | ✓ PASS |
| 10. Chronological split isolation | 3 | ✓ PASS |
| 11. Untouched-test protection | 4 | ✓ PASS |
| 12. Bounded parameter search | 3 | ✓ PASS |
| 13. Walk-forward determinism | 3 | ✓ PASS |
| 14. Regime metrics and trade provenance | 3 | ✓ PASS |
| 15. Sample-size gates | 3 | ✓ PASS |
| 16. Universal vs index-scoped classification | 3 | ✓ PASS |
| 17. Cost/slippage stress | 3 | ✓ PASS |
| 18. Strategy contribution concentration | 2 | ✓ PASS |
| 19. Independent replay reconciliation | 3 | ✓ PASS |
| 20. V2 feature flags default false | 3 | ✓ PASS |
| 21. Zero current-cohort impact | 3 | ✓ PASS |
| 22. Provider-policy invariants | 3 | ✓ PASS |
| 23. Pack 7/8 continuous observation carryover | 3 | ✓ PASS |
| 24. Global-project exclusion | 3 | ✓ PASS |

**Gate 9 status: COMPLETE — 79/79 tests pass**

---

### Gate 10 — Full Verification Battery

| Check | Target | Result |
|---|---|---|
| api-server test suite | ≥ 5,964 | **6,043 PASS** (270 files) |
| scanner test suite | ≥ 1,250 | **1,250 PASS** (52 files) |
| api-server TSC | Clean | **CLEAN** |
| scanner TSC | Clean | **CLEAN** |
| lib packages TSC | N/A (no changes) | SKIPPED |
| `git diff --check` | 0 warnings | **0 warnings** |
| No .skip/.only | 0 instances | **0 instances** |
| Global untouched | 0 changes | **0 changes** |

**Gate 10 status: ALL PASS**

---

## Infrastructure Discovered (For Future Use)

The following infrastructure is production-ready and waiting for data:

| Component | Location | Purpose |
|---|---|---|
| `resolvePremiumFromRow` | `premiumReplay.ts` | LTP→mid→BS→null priority chain |
| `resolveSnapshotLeg` | `premiumReplay.ts` | Per-leg fill with tolerance enforcement |
| `priceTradesFromSnapshots` | `premiumReplay.ts` | Full run pricing engine |
| `computeFnoCosts` | `premiumReplay.ts` | 8-component cost model |
| `snapshotPremiumBacktest.ts` | `backtest/` | Reads `option_chain_snapshot` → returns UNAVAILABLE when empty |
| `assignPricingMode` | `premiumReplay.ts` | Multi-leg synchronization classifier |
| `bsOptionPrice` | `premiumReplay.ts` | Black-Scholes fallback pricer |
| 6 strategy families | `backtest/strategies/` | V1 ORB/VWAP/EMA/FBR/RR/CB |
| `runDirectional` | `backtest/directional.ts` | Delta-proxy backtester |

---

## Remediation Plan

1. **Activate `option_chain_snapshot` ingestion** for NIFTY, BANKNIFTY, SENSEX at 5-minute intervals, capturing ATM ± 3 strikes, current + next expiry.
2. **Run continuously for ≥ 6 months** (minimum for the 3-fold walk-forward validation window).
3. **Complete Gate 0 observation** in next market session (need ≥ 30 elapsed minutes of continuous observation).
4. **Re-run Pack 9 with collected data** when Gate 1 audit confirms ≥ 60% session coverage per instrument.

---

## Verdict

`BLOCKED_PACK_9_DATA_FOUNDATION_INSUFFICIENT — option_chain_snapshot archive contains 0 rows across all three indices; no ingestion has ever run; chronological out-of-sample qualification is impossible without real captured option premiums. Gate 0 30-minute continuous parity observation also incomplete (market closed during execution). Zero strategies received UNIVERSAL_FNO_V2_QUALIFIED status. No V2 implementation was created. Current-cohort trading is unaffected. 79/79 load-bearing tests pass. Remediation plan documented.`

END_FAST_TRACK_PACK_9_PROFESSIONAL_FNO_STRATEGY_RESEARCH_AND_QUALIFICATION
