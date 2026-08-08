# Canary 50 Matrix — Full Instrument Token Data
**Date:** 2026-08-08 · **Pack:** 33 Corrective (Deployment Race Removal)  
**Source:** Kite NSE EQ instrument master · `/home/runner/workspace/artifacts/api-server/.cache/kite_instruments_NSE.json`

## Eligibility Classification Breakdown
| Class | Count | Symbols |
|-------|-------|---------|
| ORDINARY_EQUITY_ELIGIBLE | 14 | 21STCENMGM, STYRENIX, ADOR, AEGISLOG, HAPPSTMNDS, ALEMBICLTD, ARE&M, SHAREINDIA, ROUTE, ANDHRSUGAR, GODREJAGRO, APCOTEXIND, ANDHRAPAP, ARENTERP |
| DEBT_GOVERNMENT_SECURITY | 33 | All -SG suffix (SDL bonds) |
| SOVEREIGN_GOLD_BOND | 1 | SGBSEP28VI-GB |
| SME_EQUITY_POLICY_EXCLUDED | 1 | OMFURN-ST |
| UNRESOLVED_SECURITY_TYPE | 1 | SANWARIA-BZ |

**Root cause of Aug 7 canary result:** 36/50 symbols were excluded (33 SDL bonds + 1 SGB + 1 SME-ST + 1 BZ).  
Only 14/50 were ORDINARY_EQUITY_ELIGIBLE. Kite master artifact: SDL/SGB instruments have `instrument_type=EQ, segment=NSE` — the series code from the tradingsymbol suffix is the authoritative signal.

---

## Full 50-Symbol Matrix with Instrument Tokens

| # | Symbol | Token | Exchange | Segment | instrument_type | Series Code | Name | Eligibility Class | DB Status | Bars | Error Code | Session Date |
|---|--------|-------|----------|---------|-----------------|-------------|------|-------------------|-----------|------|------------|--------------|
| 1 | 21STCENMGM | 1025 | NSE | NSE | EQ | null (EQ) | 21ST CENTURY MGMT SERVICE | ORDINARY_EQUITY_ELIGIBLE | ok | 272 | — | 2026-08-07 |
| 2 | 656KA30-SG | 3585 | NSE | NSE | EQ | SG | SDL KA 6.56% 2030 | DEBT_GOVERNMENT_SECURITY | unavailable | 0 | KITE_OFFLINE | — |
| 3 | 66RJ30-SG | 4609 | NSE | NSE | EQ | SG | SDL RJ 6.6% 2030 | DEBT_GOVERNMENT_SECURITY | NOT_IN_DB | — | DB_WRITE_FAILED | — |
| 4 | STYRENIX | 4865 | NSE | NSE | EQ | null (EQ) | STYRENIX PERFORMANCE | ORDINARY_EQUITY_ELIGIBLE | ok | 272 | — | 2026-08-07 |
| 5 | 66GA30A-SG | 5121 | NSE | NSE | EQ | SG | SDL GA 6.6% 2030 | DEBT_GOVERNMENT_SECURITY | NOT_IN_DB | — | DB_WRITE_FAILED | — |
| 6 | 664UP30-SG | 5377 | NSE | NSE | EQ | SG | SDL UP 6.64% 2030 | DEBT_GOVERNMENT_SECURITY | unavailable | 0 | KITE_OFFLINE | — |
| 7 | 67JK30-SG | 5889 | NSE | NSE | EQ | SG | SDL JK 6.7% 2030 | DEBT_GOVERNMENT_SECURITY | NOT_IN_DB | — | DB_WRITE_FAILED | — |
| 8 | 67HR30-SG | 6657 | NSE | NSE | EQ | SG | SDL HR 6.7% 2030 | DEBT_GOVERNMENT_SECURITY | NOT_IN_DB | — | DB_WRITE_FAILED | — |
| 9 | 667MH31-SG | 7425 | NSE | NSE | EQ | SG | SDL MH 6.67% 2031 | DEBT_GOVERNMENT_SECURITY | unavailable | 0 | KITE_OFFLINE | — |
| 10 | 679MP33-SG | 8193 | NSE | NSE | EQ | SG | SDL MP 6.79% 2033 | DEBT_GOVERNMENT_SECURITY | unavailable | 0 | KITE_OFFLINE | — |
| 11 | ADOR | 8705 | NSE | NSE | EQ | null (EQ) | ADOR WELDING | ORDINARY_EQUITY_ELIGIBLE | ok | 272 | — | 2026-08-07 |
| 12 | 677KA34-SG | 8961 | NSE | NSE | EQ | SG | SDL KA 6.77% 2034 | DEBT_GOVERNMENT_SECURITY | unavailable | 0 | KITE_OFFLINE | — |
| 13 | 685AP36-SG | 9729 | NSE | NSE | EQ | SG | SDL AP 6.85% 2036 | DEBT_GOVERNMENT_SECURITY | unavailable | 0 | KITE_OFFLINE | — |
| 14 | AEGISLOG | 10241 | NSE | NSE | EQ | null (EQ) | AEGIS LOGISTICS | ORDINARY_EQUITY_ELIGIBLE | ok | 272 | — | 2026-08-07 |
| 15 | 687AP38-SG | 10497 | NSE | NSE | EQ | SG | SDL AP 6.87% 2038 | DEBT_GOVERNMENT_SECURITY | unavailable | 0 | KITE_OFFLINE | — |
| 16 | 677WB40-SG | 10753 | NSE | NSE | EQ | SG | SDL WB 6.77% 2040 | DEBT_GOVERNMENT_SECURITY | unavailable | 0 | KITE_OFFLINE | — |
| 17 | SANWARIA-BZ | 11777 | NSE | NSE | EQ | BZ | SANWARIA CONSUMER | UNRESOLVED_SECURITY_TYPE | insufficient | 250 | INSUFFICIENT_CANONICAL_HISTORY | 2026-08-07 |
| 18 | HAPPSTMNDS | 12289 | NSE | NSE | EQ | null (EQ) | HAPPIEST MINDS TECHNO | ORDINARY_EQUITY_ELIGIBLE | ok | 272 | — | 2026-08-07 |
| 19 | 663GJ29-SG | 16641 | NSE | NSE | EQ | SG | SDL GJ 6.63% 2029 | DEBT_GOVERNMENT_SECURITY | insufficient | 1 | INSUFFICIENT_CANONICAL_HISTORY | 2026-03-04 |
| 20 | 684TS40-SG | 17409 | NSE | NSE | EQ | SG | SDL TS 6.84% 2040 | DEBT_GOVERNMENT_SECURITY | unavailable | 0 | KITE_OFFLINE | — |
| 21 | 665KA30-SG | 18433 | NSE | NSE | EQ | SG | SDL KA 6.65% 2030 | DEBT_GOVERNMENT_SECURITY | unavailable | 0 | KITE_OFFLINE | — |
| 22 | 675KA33-SG | 18945 | NSE | NSE | EQ | SG | SDL KA 6.75% 2033 | DEBT_GOVERNMENT_SECURITY | unavailable | 0 | KITE_OFFLINE | — |
| 23 | 667UK30-SG | 19457 | NSE | NSE | EQ | SG | SDL UK 6.67% 2030 | DEBT_GOVERNMENT_SECURITY | unavailable | 0 | KITE_OFFLINE | — |
| 24 | ALEMBICLTD | 20225 | NSE | NSE | EQ | null (EQ) | ALEMBIC | ORDINARY_EQUITY_ELIGIBLE | ok | 272 | — | 2026-08-07 |
| 25 | 67ML30-SG | 21249 | NSE | NSE | EQ | SG | SDL ML 6.7% 2030 | DEBT_GOVERNMENT_SECURITY | NOT_IN_DB | — | DB_WRITE_FAILED | — |
| 26 | 67NL30-SG | 22017 | NSE | NSE | EQ | SG | SDL NL 6.7% 2030 | DEBT_GOVERNMENT_SECURITY | NOT_IN_DB | — | DB_WRITE_FAILED | — |
| 27 | 667RJ30-SG | 22273 | NSE | NSE | EQ | SG | SDL RJ 6.67% 2030 | DEBT_GOVERNMENT_SECURITY | unavailable | 0 | KITE_OFFLINE | — |
| 28 | 67TR30-SG | 22785 | NSE | NSE | EQ | SG | SDL TR 6.7% 2030 | DEBT_GOVERNMENT_SECURITY | NOT_IN_DB | — | DB_WRITE_FAILED | — |
| 29 | 668UP30-SG | 23553 | NSE | NSE | EQ | SG | SDL UP 6.68% 2030 | DEBT_GOVERNMENT_SECURITY | unavailable | 0 | KITE_OFFLINE | — |
| 30 | 676MP33-SG | 24321 | NSE | NSE | EQ | SG | SDL MP 6.76% 2033 | DEBT_GOVERNMENT_SECURITY | unavailable | 0 | KITE_OFFLINE | — |
| 31 | ARE&M | 25601 | NSE | NSE | EQ | null (EQ) | AMARA RAJA ENERGY MOB | ORDINARY_EQUITY_ELIGIBLE | ok | 272 | — | 2026-08-07 |
| 32 | SHAREINDIA | 26625 | NSE | NSE | EQ | null (EQ) | SHARE IND. SECURITIES | ORDINARY_EQUITY_ELIGIBLE | ok | 272 | — | 2026-08-07 |
| 33 | OMFURN-ST | NOT_FOUND | NSE | NSE | EQ | ST | OM FURNITURE | SME_EQUITY_POLICY_EXCLUDED | insufficient | 233 | INSUFFICIENT_CANONICAL_HISTORY | 2026-08-07 |
| 34 | ROUTE | 32769 | NSE | NSE | EQ | null (EQ) | ROUTE MOBILE | ORDINARY_EQUITY_ELIGIBLE | ok | 272 | — | 2026-08-07 |
| 35 | ANDHRSUGAR | 34817 | NSE | NSE | EQ | null (EQ) | ANDHRA SUGARS | ORDINARY_EQUITY_ELIGIBLE | ok | 272 | — | 2026-08-07 |
| 36 | GODREJAGRO | 36865 | NSE | NSE | EQ | null (EQ) | GODREJ AGROVET | ORDINARY_EQUITY_ELIGIBLE | ok | 272 | — | 2026-08-07 |
| 37 | SGBSEP28VI-GB | 38145 | NSE | NSE | EQ | GB | 2.50%GOLDBONDS2028SR-VI | SOVEREIGN_GOLD_BOND | NOT_IN_DB | — | DB_WRITE_FAILED | — |
| 38 | APCOTEXIND | 39425 | NSE | NSE | EQ | null (EQ) | APCOTEX INDUSTRIES | ORDINARY_EQUITY_ELIGIBLE | ok | 272 | — | 2026-08-07 |
| 39 | 67MH28-SG | 40449 | NSE | NSE | EQ | SG | SDL MH 6.7% 2028 | DEBT_GOVERNMENT_SECURITY | NOT_IN_DB | — | DB_WRITE_FAILED | — |
| 40 | 674UP30-SG | 41217 | NSE | NSE | EQ | SG | SDL UP 6.74% 2030 | DEBT_GOVERNMENT_SECURITY | unavailable | 0 | KITE_OFFLINE | — |
| 41 | 68AS30-SG | 41985 | NSE | NSE | EQ | SG | SDL AS 6.8% 2030 | DEBT_GOVERNMENT_SECURITY | NOT_IN_DB | — | DB_WRITE_FAILED | — |
| 42 | 674GA30-SG | 42241 | NSE | NSE | EQ | SG | SDL GA 6.74% 2030 | DEBT_GOVERNMENT_SECURITY | unavailable | 0 | KITE_OFFLINE | — |
| 43 | ANDHRAPAP | 42497 | NSE | NSE | EQ | null (EQ) | ANDHRA PAPER | ORDINARY_EQUITY_ELIGIBLE | ok | 272 | — | 2026-08-07 |
| 44 | 67GJ30-SG | 42753 | NSE | NSE | EQ | SG | SDL GJ 6.7% 2030 | DEBT_GOVERNMENT_SECURITY | NOT_IN_DB | — | DB_WRITE_FAILED | — |
| 45 | 67KA30-SG | 43521 | NSE | NSE | EQ | SG | SDL KA 6.7% 2030 | DEBT_GOVERNMENT_SECURITY | NOT_IN_DB | — | DB_WRITE_FAILED | — |
| 46 | 672RJ30-SG | 43777 | NSE | NSE | EQ | SG | SDL RJ 6.72% 2030 | DEBT_GOVERNMENT_SECURITY | unavailable | 0 | KITE_OFFLINE | — |
| 47 | 673SK30-SG | 44289 | NSE | NSE | EQ | SG | SDL SK 6.73% 2030 | DEBT_GOVERNMENT_SECURITY | unavailable | 0 | KITE_OFFLINE | — |
| 48 | 669TN30-SG | 45825 | NSE | NSE | EQ | SG | SDL TN 6.69% 2030 | DEBT_GOVERNMENT_SECURITY | unavailable | 0 | KITE_OFFLINE | — |
| 49 | ARENTERP | 46337 | NSE | NSE | EQ | null (EQ) | RAJDARSHAN INDUSTRIES | ORDINARY_EQUITY_ELIGIBLE | ok | 270 | — | 2026-08-07 |
| 50 | 678KA32-SG | 46593 | NSE | NSE | EQ | SG | SDL KA 6.78% 2032 | DEBT_GOVERNMENT_SECURITY | unavailable | 0 | KITE_OFFLINE | — |

---

## Instrument Token Coverage
- **49/50** tokens found in Kite instrument cache (OMFURN-ST not in cache — delisted from Kite master)
- Token range: 1025 (21STCENMGM) → 46593 (678KA32-SG)
- All instruments: `exchange=NSE, segment=NSE, instrument_type=EQ` — the Kite master-data artifact that caused early misclassification

## Series Code Precedence Validation
The series code extracted from the tradingsymbol suffix is the **authoritative** signal (not a heuristic):
- `-SG` → `State Government (SDL bond)` — 33 instruments
- `-GB` → `Gold Bond (RBI SGB)` — 1 instrument  
- `-ST` → `SME Trading platform` — 1 instrument
- `-BZ` → `BSZ cross-settlement (unresolved)` — 1 instrument
- no suffix → standard EQ — 14 instruments

All 33 SDL bonds have `instrument_type=EQ, segment=NSE` in the Kite master — a known instrument-data artifact. The series code from the symbol suffix overrides the instrument_type field in the eligibility classifier, as documented in `instrumentEligibility.ts`.

## Compile-Time Population Lock Status (2026-08-08)
```
FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED = false as boolean
WAREHOUSE_POPULATION_LOCKED_CODE = "PAUSED_BY_COMPILE_TIME_CONTROL"
```
- Scheduler: **NOT registered** after deploy (no setTimeout, no provider calls possible)
- Application is **safe with zero owner action** after deployment
- Production DB status: `kite_warehouse_progress.status=CANARY` (from Aug 7 accidental reset)
- Force-stop endpoint (`POST /api/scan/candle-store/warehouse/force-stop`) now requires `expectedSnapshotId` + `expectedCurrentStatus` preconditions + writes structured audit record
- Pre-publish verdict: `PROMPT_33_CONTROL_REMEDIATION_IMPLEMENTED — DEPLOYMENT_PENDING — WAREHOUSE_POPULATION_HARD_PAUSED`
