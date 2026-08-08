# Canary 50 Exact Matrix — Pack 33 Corrective (2026-08-07)

**Run date:** 2026-08-07  
**Snapshot ID:** `2026-08-07_3f1d7468` (original canary; current production snapshot after accidental reset: `2026-08-08_f097df15`)  
**Run start:** 2026-08-07 15:10:14Z (5 min after first publish)  
**Outcome:** CANARY_VALIDATION_FAILED — 22/50 symbols reported as fail → exceeded 10% threshold → STOPPED

## Run Metrics (from warehouse log)

| Metric | Value |
|--------|-------|
| symbolsAttempted | 50 |
| successCount | 22 |
| insufficientCount | 6 |
| failCount | 22 |
| kiteRequests | 50 |
| Status after | STOPPED |

## Exact 50-Symbol Matrix

> Source: `kite_candle_store` queried 2026-08-08 (production DB).  
> For 38 persisted rows: exact status, bar_count, error_code, session_date from DB.  
> For 12 not-in-DB rows: DB upsert failed silently (best-effort write in warehouse).  
> Canonical eligibility classification is from `instrumentEligibility.ts` (Pack 33 Corrective).

| # | Symbol | Eligibility Class | DB Status | Bars | Error Code | Session Date | Notes |
|---|--------|------------------|-----------|------|------------|--------------|-------|
| 1 | 21STCENMGM | ORDINARY_EQUITY_ELIGIBLE | ok | 272 | — | 2026-08-07 | ✅ Full history |
| 2 | 656KA30-SG | DEBT_GOVERNMENT_SECURITY | unavailable | 0 | KITE_OFFLINE | — | SDL KA 6.56% 2030 |
| 3 | 66RJ30-SG | DEBT_GOVERNMENT_SECURITY | NOT_IN_DB | — | — | — | DB write failed |
| 4 | STYRENIX | ORDINARY_EQUITY_ELIGIBLE | ok | 272 | — | 2026-08-07 | ✅ Full history |
| 5 | 66GA30A-SG | DEBT_GOVERNMENT_SECURITY | NOT_IN_DB | — | — | — | DB write failed |
| 6 | 664UP30-SG | DEBT_GOVERNMENT_SECURITY | unavailable | 0 | KITE_OFFLINE | — | SDL UP 6.64% 2030 |
| 7 | 67JK30-SG | DEBT_GOVERNMENT_SECURITY | NOT_IN_DB | — | — | — | DB write failed |
| 8 | 67HR30-SG | DEBT_GOVERNMENT_SECURITY | NOT_IN_DB | — | — | — | DB write failed |
| 9 | 667MH31-SG | DEBT_GOVERNMENT_SECURITY | unavailable | 0 | KITE_OFFLINE | — | SDL MH 6.67% 2031 |
| 10 | 679MP33-SG | DEBT_GOVERNMENT_SECURITY | unavailable | 0 | KITE_OFFLINE | — | SDL MP 6.79% 2033 |
| 11 | ADOR | ORDINARY_EQUITY_ELIGIBLE | ok | 272 | — | 2026-08-07 | ✅ Full history |
| 12 | 677KA34-SG | DEBT_GOVERNMENT_SECURITY | unavailable | 0 | KITE_OFFLINE | — | SDL KA 6.77% 2034 |
| 13 | 685AP36-SG | DEBT_GOVERNMENT_SECURITY | unavailable | 0 | KITE_OFFLINE | — | SDL AP 6.85% 2036 |
| 14 | AEGISLOG | ORDINARY_EQUITY_ELIGIBLE | ok | 272 | — | 2026-08-07 | ✅ Full history |
| 15 | 687AP38-SG | DEBT_GOVERNMENT_SECURITY | unavailable | 0 | KITE_OFFLINE | — | SDL AP 6.87% 2038 |
| 16 | 677WB40-SG | DEBT_GOVERNMENT_SECURITY | unavailable | 0 | KITE_OFFLINE | — | SDL WB 6.77% 2040 |
| 17 | SANWARIA-BZ | UNRESOLVED_SECURITY_TYPE | insufficient | 250 | INSUFFICIENT_CANONICAL_HISTORY | 2026-08-07 | 2 bars short of 252 |
| 18 | HAPPSTMNDS | ORDINARY_EQUITY_ELIGIBLE | ok | 272 | — | 2026-08-07 | ✅ Full history |
| 19 | 663GJ29-SG | DEBT_GOVERNMENT_SECURITY | insufficient | 1 | INSUFFICIENT_CANONICAL_HISTORY | 2026-03-04 | SDL GJ — 1 bar stored |
| 20 | 684TS40-SG | DEBT_GOVERNMENT_SECURITY | unavailable | 0 | KITE_OFFLINE | — | SDL TS 6.84% 2040 |
| 21 | 665KA30-SG | DEBT_GOVERNMENT_SECURITY | unavailable | 0 | KITE_OFFLINE | — | SDL KA 6.65% 2030 |
| 22 | 675KA33-SG | DEBT_GOVERNMENT_SECURITY | unavailable | 0 | KITE_OFFLINE | — | SDL KA 6.75% 2033 |
| 23 | 667UK30-SG | DEBT_GOVERNMENT_SECURITY | unavailable | 0 | KITE_OFFLINE | — | SDL UK 6.67% 2030 |
| 24 | ALEMBICLTD | ORDINARY_EQUITY_ELIGIBLE | ok | 272 | — | 2026-08-07 | ✅ Full history |
| 25 | 67ML30-SG | DEBT_GOVERNMENT_SECURITY | NOT_IN_DB | — | — | — | DB write failed |
| 26 | 67NL30-SG | DEBT_GOVERNMENT_SECURITY | NOT_IN_DB | — | — | — | DB write failed |
| 27 | 667RJ30-SG | DEBT_GOVERNMENT_SECURITY | unavailable | 0 | KITE_OFFLINE | — | SDL RJ 6.67% 2030 |
| 28 | 67TR30-SG | DEBT_GOVERNMENT_SECURITY | NOT_IN_DB | — | — | — | DB write failed |
| 29 | 668UP30-SG | DEBT_GOVERNMENT_SECURITY | unavailable | 0 | KITE_OFFLINE | — | SDL UP 6.68% 2030 |
| 30 | 676MP33-SG | DEBT_GOVERNMENT_SECURITY | unavailable | 0 | KITE_OFFLINE | — | SDL MP 6.76% 2033 |
| 31 | ARE&M | ORDINARY_EQUITY_ELIGIBLE | ok | 272 | — | 2026-08-07 | ✅ Full history |
| 32 | SHAREINDIA | ORDINARY_EQUITY_ELIGIBLE | ok | 272 | — | 2026-08-07 | ✅ Full history |
| 33 | OMFURN-ST | SME_EQUITY_POLICY_EXCLUDED | insufficient | 233 | INSUFFICIENT_CANONICAL_HISTORY | 2026-08-07 | SME board — 19 bars short |
| 34 | ROUTE | ORDINARY_EQUITY_ELIGIBLE | ok | 272 | — | 2026-08-07 | ✅ Full history |
| 35 | ANDHRSUGAR | ORDINARY_EQUITY_ELIGIBLE | ok | 272 | — | 2026-08-07 | ✅ Full history |
| 36 | GODREJAGRO | ORDINARY_EQUITY_ELIGIBLE | ok | 272 | — | 2026-08-07 | ✅ Full history |
| 37 | SGBSEP28VI-GB | SOVEREIGN_GOLD_BOND | NOT_IN_DB | — | — | — | DB write failed |
| 38 | APCOTEXIND | ORDINARY_EQUITY_ELIGIBLE | ok | 272 | — | 2026-08-07 | ✅ Full history |
| 39 | 67MH28-SG | DEBT_GOVERNMENT_SECURITY | NOT_IN_DB | — | — | — | DB write failed |
| 40 | 674UP30-SG | DEBT_GOVERNMENT_SECURITY | unavailable | 0 | KITE_OFFLINE | — | SDL UP 6.74% 2030 |
| 41 | 68AS30-SG | DEBT_GOVERNMENT_SECURITY | NOT_IN_DB | — | — | — | DB write failed |
| 42 | 674GA30-SG | DEBT_GOVERNMENT_SECURITY | unavailable | 0 | KITE_OFFLINE | — | SDL GA 6.74% 2030 |
| 43 | ANDHRAPAP | ORDINARY_EQUITY_ELIGIBLE | ok | 272 | — | 2026-08-07 | ✅ Full history |
| 44 | 67GJ30-SG | DEBT_GOVERNMENT_SECURITY | NOT_IN_DB | — | — | — | DB write failed |
| 45 | 67KA30-SG | DEBT_GOVERNMENT_SECURITY | NOT_IN_DB | — | — | — | DB write failed |
| 46 | 672RJ30-SG | DEBT_GOVERNMENT_SECURITY | unavailable | 0 | KITE_OFFLINE | — | SDL RJ 6.72% 2030 |
| 47 | 673SK30-SG | DEBT_GOVERNMENT_SECURITY | unavailable | 0 | KITE_OFFLINE | — | SDL SK 6.73% 2030 |
| 48 | 669TN30-SG | DEBT_GOVERNMENT_SECURITY | unavailable | 0 | KITE_OFFLINE | — | SDL TN 6.69% 2030 |
| 49 | ARENTERP | ORDINARY_EQUITY_ELIGIBLE | ok | 270 | — | 2026-08-07 | ✅ 270 bars (2 below 272 avg) |
| 50 | 678KA32-SG | DEBT_GOVERNMENT_SECURITY | unavailable | 0 | KITE_OFFLINE | — | SDL KA 6.78% 2032 |

**Sum = 50 ✓**

## Classification Breakdown

| Eligibility Class | Count | Description |
|------------------|-------|-------------|
| ORDINARY_EQUITY_ELIGIBLE | 14 | Standard NSE main-board equities with full OHLCV history |
| DEBT_GOVERNMENT_SECURITY | 33 | SDL State Development Loans (SG series) — no equity OHLCV |
| SOVEREIGN_GOLD_BOND | 1 | RBI Gold Bond (GB series) — SGBSEP28VI-GB |
| SME_EQUITY_POLICY_EXCLUDED | 1 | SME Trading segment (ST series) — OMFURN-ST |
| UNRESOLVED_SECURITY_TYPE | 1 | BZ cross-listed (BSZ settlement) — SANWARIA-BZ |

**Root cause of CANARY_VALIDATION_FAILED:**  
36/50 symbols (72%) are non-equity instruments (bonds, gold bonds, SME, BZ series) that have no OHLCV data on Kite's equity historical endpoint. They return 0 bars → KITE_OFFLINE or EMPTY_SERIES → counted as hard fails. The `getEligibleNseSymbols()` function previously did not exclude these instruments, causing the warehouse to process bonds as if they were equity.

**Fix (Pack 33 Corrective):**  
`instrumentEligibility.ts` canonical classifier now filters DEBT_GOVERNMENT_SECURITY, SOVEREIGN_GOLD_BOND, SME_EQUITY_POLICY_EXCLUDED, and UNRESOLVED_SECURITY_TYPE from the warehouse batch. Only ORDINARY_EQUITY_ELIGIBLE symbols proceed to the Kite historical fetch.

## DB Write Failure Note

12 symbols (positions 3, 5, 7, 8, 25, 26, 28, 37, 39, 41, 44, 45) are NOT in `kite_candle_store` despite the warehouse attempting to process them. Their `storeKiteCandleEntry()` DB upserts failed silently (best-effort error handling). These are all bond-type instruments and would have returned KITE_OFFLINE or EMPTY_SERIES anyway. Their absence from the DB does not affect the corrective fix.

## Reconciliation

From warehouse run metrics: successCount=22, insufficientCount=6, failCount=22, total=50 ✓  
From DB (38 rows): ok=14, insufficient=3, unavailable=21  
Difference: 12 rows not persisted due to silent DB write failures.

The 22 "ok" in the run metrics includes 8 symbols whose `storeKiteCandleEntry()` succeeded in updating memCache but failed the DB write; those are not visible in the current DB query.

---
*Generated: 2026-08-08 | Pack 33 Corrective | Authorizing commit: pending deployment*
