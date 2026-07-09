# MASTER QUANT-GRADE REMEDIATION ROADMAP — 2026-07-09

**Program**: zero-tolerance remediation of all outstanding quant-grade audit findings.
**Companion register**: `MASTER_QUANT_BUG_REGISTER_2026_07_09.csv` (44 rows, deduplicated, one status each).
**First fix lane executed**: P0-00 signal-plan immutability (this session, dev-verified — see `P0_00_SIGNAL_PLAN_IMMUTABILITY_REPORT.md`).

---

## 1. Milestone reconciliation (verified 2026-07-09 against /api/build-info + verify:release)

Production commit at reconciliation: `8f41f811`. `verify:release`: **11 PASS / 0 WARN / 0 FAIL**.

| # | Milestone | Reconciled status | Evidence |
|---|---|---|---|
| 1 | RELEASE_INTEGRITY_PROD_VERIFIED | ✅ HOLDS | verify:release 11/11 PASS (re-run 2026-07-09) |
| 2 | BACKTEST_CHARGES_MODEL_NET_PNL_PROD_VERIFIED | ✅ HOLDS | Unchanged since verification |
| 3 | FNO_COST_MODEL_UNIFICATION_PROD_VERIFIED | ✅ HOLDS | Guard test pins cross-consumer agreement |
| 4 | FNO_VWAP_VOLUME_PROFILE_HONESTY_PROD_VERIFIED | ✅ HOLDS | vwapAvailable gating live |
| 5 | FNO_TRIGGER_WORDING_SEMANTICS_PROD_VERIFIED | ✅ HOLDS for NEW rows | Legacy-row normalization still open (MQ-P0-07, Lane 2) |
| 6 | KITE_OI_UNIT_VERIFICATION_CONFIRMED_CORRECT | ✅ HOLDS | Not a bug |
| 7 | P1A_PAPER_TRADING_GROSS_NET_DISPLAY_PROD_VERIFIED | ✅ HOLDS | foCockpitView 138/138 |
| 8 | P1B_MACD_WARMUP_FIX | ✅ **PROD_VERIFIED** | Commit `8f41f811` live (post-fix `f224e41`); startIdx slicing confirmed in prod source |
| 9 | EXIT_PREMIUM_MARKET_SHADOW | ⏳ PROD_INFRA_VERIFIED_LIVE_SAMPLE_PENDING | 8 shadow columns live at `a8e0a6a6`; waiting for first real F&O exit |
| 10 | POST_P0_SIGNAL_SYSTEM_REBASELINE | ⏳ PARTIAL_GAP_REMAINS | Waiting for ≥20 post-P0 signals |

Nothing previously claimed PROD_VERIFIED was found regressed.

---

## 2. Register summary

44 findings compiled from: quant_grade_deep_audit_v2, quant_grade_bug_register_v2.csv, quant_grade_fix_prompt_v2, AUDIT-REPORT-FINAL/Phase1, corrected-reference.html, Quant-Grade Audit 2026-07-08 (lot-size), P1_CONSOLIDATED_REMAINING_WORK, P1B_MACD_WARMUP_FIX, KITE_OI_UNIT_VERIFICATION, EXIT_PREMIUM_MARKET_SHADOW, WEBSITE_CANONICAL_DATA_INTEGRATION, USER_FACING_CORE_TABS_DEEP_AUDIT, POST_P0_SIGNAL_SYSTEM_REBASELINE, FNO_TRIGGER_SEMANTICS_HONESTY, canonical data reports, production build-info.

| Status | Count | IDs |
|---|---|---|
| FIXED_DEV_VERIFIED | 1 | MQ-P0-00 (this session) |
| FIXED_PROD_VERIFIED | 6 | MQ-P1-17, MQ-DONE-01/02/03/04/06/07 (DONE-03/04 also map as duplicates) |
| PARTIAL_FIX | 3 | MQ-P0-06, MQ-P0-07, MQ-P0-12 |
| OPEN_P0 | 8 | MQ-P0-02/03/04/05/08/10/11 + MQ-P1-22 (P0-adjacent, Lane 1) |
| OPEN_P1 | 18 | MQ-P1-01…16, 18, 19, 21, 23 |
| NEEDS_OWNER_APPROVAL | 2 | MQ-P0-09 (ledger), MQ-P1-20 (ATR method) |
| NEEDS_LIVE_DATA_VERIFICATION | 2 | MQ-DONE-08 (shadow sample), MQ-REB-01 (rebaseline sample) |
| DUPLICATE | 1 | MQ-DONE-09 → MQ-P0-12 |
| NOT_A_BUG | 1 | MQ-DONE-05 (Kite OI units) |
| MONITOR_ONLY | 1 | MQ-L2-01 (shadow-mode risk guards) |

Duplicates are retained in the CSV and mapped via the `Duplicate Of` column — nothing deleted.

---

## 3. P0-00 — executed this session (HARD STOP after this)

**Owner observation**: SENSEX 77100 PUT, confidence 65, TRIGGERED — then entry premium, market price and stop-loss changed on the card without intimation.

**Confirmed root cause (forensic, dev DB + code)**: real DB mutation, not just display recompute. `recordOrUpdate` in `optionSignalLifecycle.ts` spread an `optionPremiumPatch` — built from the CURRENT cycle's live Greeks re-projection — into **every** status-transition UPDATE, silently rewriting `option_entry` / `option_stop_loss` / `option_target1/2` on every poll. The frontend then rendered one merged premium grid, conflating locked plan with live projection.

**Fix shipped (dev-verified)**:
1. `optionPremiumPatch` removed — status transitions can never touch premium columns.
2. `persistOptionPremiums` is the ONLY premium writer: one-shot (`option_entry IS NULL` guard + `option_premium_locked_at` stamp) and **strike-guarded** (`strike = locked strike` in WHERE, so drifted-ATM re-projections cannot backfill a different contract).
3. New `option_signal_plan_audit` append-only ledger with a 4-reason CHECK constraint (MANUAL_OWNER_EDIT, CONTRACT_CORRECTION_WITH_AUDIT, CORPORATE_ACTION_ADJUSTMENT, DATA_ERROR_CORRECTION_WITH_AUDIT). Silent categories are rejected at the DB level.
4. API: `planSnapshot` (immutable) vs `liveMtm` (mutable) vs `planRevised` vs `paperFill` fields on `OptionSignal` (OpenAPI + codegen).
5. UI: card split into **LOCKED PLAN — does not change after trigger** and **LIVE MTM — updates with market** sections; legacy rows without a lock render a LEGACY_PLAN_FIELDS warning; strike drift suppresses live premium projections with an explicit warning.
6. 5 regression tests green (`optionSignalPlanImmutability.test.ts`).

**Verdict**: `P0_00_SIGNAL_PLAN_IMMUTABILITY_DEV_VERIFIED` — production publish pending. Full evidence in `P0_00_SIGNAL_PLAN_IMMUTABILITY_REPORT.md`.

---

## 4. Lane order after P0-00 (owner approval required per lane)

| Lane | Scope | Register IDs | Risk class |
|---|---|---|---|
| **Lane 1 — P0 Canonical Data Parity + Contract Master** | Canonical IndexQuoteFact; ContractMasterFact (expiry/lotSize/strikeStep/instrumentToken); FINNIFTY/MIDCAP proxy suppression; baseline parity; dynamic lot-size resolver; labeled + drift-alarmed static fallback | MQ-P0-02, 03, 04, 05, 12, MQ-P1-22 | Data-layer, no trading-logic change |
| **Lane 2 — P0 F&O Signal Honesty** | Trigger renderer from structured semantics incl. legacy rows; premium-stop vs projected-spot-stop disclosure; VWAP "—"; null premium never ₹0.00; MFE/MAE null until TRIGGERED | MQ-P0-06, 07, MQ-P1-08 | Display/honesty |
| **Lane 3 — P0 Paper Ledger and Reports** | Replace Net-vs-Seed; ledger invariant drift alert ≥ ₹1; aligned report windows; worst-trades losses-only; DD denominator label; off-session backtest filter | MQ-P0-09, MQ-P1-05, 06, 07, 19 | Ledger — **owner sign-off needed for MQ-P0-09** |
| **Lane 4 — P0 Chart Reliability** | Shared chartSeries contract; empty-state logic; Playwright SVG assertions | MQ-P0-10 | Display |
| **Lane 5 — P1 Source Cleanliness** | India/US VIX labels; FII/DII date parity; holiday calendar; debt/bond exclusion; F&O ban union state; US 10Y parse; max-pain sign; OI share denominator; EMA200 parity; risk-free rate config; ITM IV flags; ΔOI labels; future mislabel; illiquid S/R; margin label; yearsToExpiry | MQ-P0-08, 11, MQ-P1-01, 02, 03, 04, 09, 10, 11, 12, 13, 14, 15, 16, 18, 21, 23 | Data hygiene |
| **Lane 6 — Strategy-risk (owner sign-off REQUIRED)** | ATR EMA vs Wilder; equity gap-through exit realism; SENSEX enable/disable rules; minimum premium gate; DTE/theta gate; post-stop re-entry cooldown (guards exist in shadow mode) | MQ-P1-20, MQ-L2-01 + P1D | Trading logic — never start without explicit approval |

**Rules carried into every lane**: no broker execution, no Telegram tests, no threshold/weight/confidence changes without approval, no ledger rewrite, no destructive migration, no fabricated data, every market number carries source/asOf/freshness/grade.

---

## 5. Final verdicts

- **`MASTER_QUANT_REMEDIATION_ROADMAP_CREATED`**
- **`P0_00_SIGNAL_PLAN_IMMUTABILITY_DEV_VERIFIED`**

**HARD STOP**: per instruction, Lane 1 is NOT started. Next action belongs to the owner: publish to production, then P0-00 prod verification (build-info + live card check), then approve the next lane.
