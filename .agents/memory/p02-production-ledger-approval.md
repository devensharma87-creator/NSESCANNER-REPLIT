---
name: P0.2 production ledger inventory and owner approval
description: Production paper_trade_eq/fo inventory (71 rows confirmed), dispositions, and 2026-07-22 owner approval. 44→43 discrepancy reconciled. No rows modified.
---

## Rule

All production paper-trade rows pre-dating the P0.2 deployment are classified ANNOTATE_INVALID or EXCLUDE_FROM_OFFICIAL_PNL. Owner approved 2026-07-22. No row may be modified or deleted under this approval.

**Why:** Every row was written by the pre-Phase-B writer (writer_version=null or pre-Phase-B stamp; fill_evidence_version column absent from production schema). No row passed Phase B admission. Off-session opens and non-trading-day opens are further excluded.

**How to apply:** When building a P0.2 post-deployment performance report or any analytics that draws on paper_trade_eq/fo, exclude the EXCLUDE rows entirely and annotate the ANNOTATE_INVALID rows as "pre-Phase-B, unverified fill". Do not blend these into official P&L without that annotation.

## Definitive counts (confirmed 2026-07-22 — see reconciliation below)

| Table | Total | OPEN | CLOSED | Newest opened_at |
|---|---|---|---|---|
| paper_trade_eq | **43** | 8 | 35 | 2026-07-18 10:30:28 UTC (cc9d12bc DLF) |
| paper_trade_fo | **28** | 0 | 28 | 2026-06-15 05:20:44 UTC (d0f760be BANKNIFTY) |
| **Grand total** | **71** | **8** | **63** | — |

## 44→43 equity discrepancy — reconciliation

Prior session recorded 44 equity rows; current confirmed count is 43. Full investigation 2026-07-22:

1. **`pg_stat_user_tables.n_tup_del = 0`** — PostgreSQL has tracked zero DELETE operations on `paper_trade_eq` in the current statistics epoch.
2. **`paper_eq_audit` orphan query** — LEFT JOIN of all `paper_trade_id` values in the audit table against `paper_trade_eq`: **0 orphan entries**. Every paper_trade_id in the audit has a live matching row. No row was deleted.
3. **`COUNT(*) = 43` consistent** across multiple independent queries from two separate sessions in this task.
4. **Dev DB has 22 rows** (test data: TESTSTK, GAP1TSTMR* symbols) — completely different from prod. The prior "44" was not a dev-vs-prod confusion.

**Verdict: The prior session "44" was a miscounting or transient replica state artifact. No row was deleted, modified, or created since that inventory. The definitive production equity count is 43.**

## EXCLUDE / ANNOTATE breakdown (requires re-verification)

The prior session's 15/29 equity split was computed against the wrong "44" count. The owner's approval was:
- EXCLUDE_FROM_OFFICIAL_PNL: 16 total (15 equity + 1 F&O)
- ANNOTATE_INVALID: 56 total (29 equity + 27 F&O) — based on wrong equity total

With 43 equity rows confirmed, the correct breakdown is one of:
- 15 equity EXCLUDE + **28** equity ANNOTATE = 43 ✅ (if the phantom was in ANNOTATE)
- 14 equity EXCLUDE + **29** equity ANNOTATE = 43 ✅ (if the phantom was in EXCLUDE)

Owner re-confirmation of EXCLUDE/ANNOTATE split against the actual 43-row list is recommended before the post-deployment report.

## Key facts

- `fill_evidence_version` column: **ABSENT** from production schema (P0.2 not yet deployed).
- `writer_version`: null on 42 of 43 rows; one row (`cc9d12bc` DLF) has `paper-writer-v1.2.0-ledger-net` (does NOT indicate Phase B validation).
- EXCLUDE reasons: off-session opens (times outside 09:15–15:30 IST).
- MIDCPNIFTY F&O row (`05d70bcc`): outside current universe (NIFTY/BANKNIFTY/SENSEX only) — ANNOTATE_INVALID.
- `CURRENT_PRODUCTION_SHA = 533ff05fd0992288a5d4cd50f1a019c8de8787fb` (verified 2026-07-22; both C0 gates active).
- `SAFE_ROLLBACK_SHA = 533ff05fd0992288a5d4cd50f1a019c8de8787fb` (same — this is the last verified live deployment with C0 gates confirmed).
- `PAPER_TRADING_ENABLED=false`, `LIVE_CASH_SWING_ORDER_ENABLED=false`, `SWING_CASH_EXECUTION_MODE=paper_only` confirmed in production env tier.
- `PUBLISH_STATUS = NOT_STARTED` (as of 2026-07-22; merge to main not yet done).

## Definitive equity row list (all 43, sorted by opened_at)

| ID (short) | Symbol | Status | opened_at UTC |
|---|---|---|---|
| 12285714 | CROMPTON | CLOSED | 2026-04-29 07:30:36 |
| 6d2e7ae3 | RBLBANK | CLOSED | 2026-04-29 07:30:37 |
| c26a106c | LAURUSLABS | CLOSED | 2026-05-04 06:03:54 |
| b6caa571 | GODREJPROP | CLOSED | 2026-05-04 07:14:53 |
| 63e1244f | JINDALSTEL | CLOSED | 2026-05-04 09:39:16 |
| 5ee11b94 | MARICO | CLOSED | 2026-05-05 09:58:53 |
| 3bcdcb29 | BERGEPAINT | CLOSED | 2026-05-13 07:19:18 |
| 25650384 | ASIANPAINT | CLOSED | 2026-05-13 07:19:18 |
| 71efa657 | CIPLA | CLOSED | 2026-05-13 07:19:49 |
| 6d84e97d | ASIANPAINT | CLOSED | 2026-05-14 00:43:32 |
| 92de7221 | GRASIM | CLOSED | 2026-05-14 00:43:32 |
| 92758733 | HAL | CLOSED | 2026-05-14 07:38:35 |
| 6a7a61f0 | GRASIM | CLOSED | 2026-05-15 14:04:00 |
| 48faf2db | JSWSTEEL | CLOSED | 2026-05-15 14:04:00 |
| 130a8130 | MANAPPURAM | CLOSED | 2026-05-19 01:58:07 |
| e3fe5805 | ZEEL | CLOSED | 2026-05-27 06:36:57 |
| 5af0013e | MOTHERSON | CLOSED | 2026-05-27 09:46:38 |
| 3f1da4f2 | GMRINFRA | CLOSED | 2026-05-31 10:08:22 |
| 72d31ea8 | ZEEL | CLOSED | 2026-06-01 05:49:40 |
| 9eb5a07f | COALINDIA | CLOSED | 2026-06-01 06:21:08 |
| 03710593 | NMDC | CLOSED | 2026-06-01 08:03:35 |
| 3f5e5db2 | FORTIS | CLOSED | 2026-06-08 06:06:59 |
| a61ce0a6 | DIVISLAB | CLOSED | 2026-06-09 06:56:49 |
| 10a3ec26 | IDFCFIRSTB | CLOSED | 2026-06-09 09:37:36 |
| 848b52c6 | GLAND | CLOSED | 2026-06-11 07:26:39 |
| 35f7a569 | AUBANK | CLOSED | 2026-06-12 09:13:04 |
| 2c578285 | OBEROIRLTY | CLOSED | 2026-06-15 05:27:08 |
| 7cc03849 | INDIGO | CLOSED | 2026-06-15 07:07:35 |
| 3c849e88 | LT | CLOSED | 2026-06-15 07:38:23 |
| f9bee8ec | PHOENIXLTD | CLOSED | 2026-06-16 15:55:33 |
| 44f0e529 | ABB | CLOSED | 2026-06-29 09:42:03 |
| cadffdd2 | TORNTPHARM | CLOSED | 2026-06-29 11:35:28 |
| 2cbb3e4c | MAZDOCK | CLOSED | 2026-06-30 09:26:17 |
| 50eb7f53 | INDUSINDBK | CLOSED | 2026-07-03 16:02:00 |
| 8845767e | BANDHANBNK | CLOSED | 2026-07-10 07:40:18 |
| 548dd81a | MARUTI | **OPEN** | 2026-06-30 09:26:17 |
| 7e0e4cd1 | DELHIVERY | **OPEN** | 2026-07-01 09:25:01 |
| 0a19219d | GRASIM | **OPEN** | 2026-07-09 18:11:35 |
| 090f0f85 | EXIDEIND | **OPEN** | 2026-07-09 18:11:35 |
| 678b65dc | TITAN | **OPEN** | 2026-07-09 18:11:35 |
| d0037f80 | DLF | **OPEN** | 2026-07-10 06:00:30 |
| da1a3783 | ADANIGREEN | **OPEN** | 2026-07-14 13:32:54 |
| cc9d12bc | DLF | **OPEN** | 2026-07-18 10:30:28 |

## Definitive F&O row list (all 28, all CLOSED)

| ID (short) | Index | Direction | opened_at UTC |
|---|---|---|---|
| 8dca466f | SENSEX | BEARISH | 2026-05-04 10:26:16 |
| ca24a872 | SENSEX | BULLISH | 2026-05-05 09:40:25 |
| e7e34dc6 | SENSEX | BEARISH | 2026-05-06 07:05:09 |
| 05d70bcc | MIDCPNIFTY | BULLISH | 2026-05-08 06:21:58 |
| 279ed0ad | SENSEX | BEARISH | 2026-05-13 04:14:31 |
| 97106a37 | SENSEX | BULLISH | 2026-05-14 07:44:27 |
| ede5c136 | SENSEX | BULLISH | 2026-05-15 05:21:23 |
| e927944b | NIFTY | BULLISH | 2026-05-18 07:36:05 |
| 8fac3dd7 | SENSEX | BULLISH | 2026-05-18 07:36:27 |
| e2060ff5 | BANKNIFTY | BULLISH | 2026-05-19 06:14:36 |
| 01401aaf | SENSEX | BULLISH | 2026-05-20 08:42:01 |
| ea78ae5b | BANKNIFTY | BULLISH | 2026-05-20 08:53:23 |
| f972d815 | BANKNIFTY | BEARISH | 2026-05-26 07:31:13 |
| 3a5be4f5 | SENSEX | BEARISH | 2026-05-26 07:31:14 |
| b532103f | NIFTY | BEARISH | 2026-06-01 04:18:25 |
| c39a88b7 | SENSEX | BEARISH | 2026-06-01 04:18:25 |
| b754739a | NIFTY | BEARISH | 2026-06-02 05:01:27 |
| c929db79 | SENSEX | BEARISH | 2026-06-02 05:15:25 |
| f34eb6e9 | BANKNIFTY | BULLISH | 2026-06-03 07:50:41 |
| 7bdecfd6 | BANKNIFTY | BULLISH | 2026-06-04 05:11:03 |
| 726ddb20 | SENSEX | BULLISH | 2026-06-04 05:16:02 |
| 749f7469 | BANKNIFTY | BULLISH | 2026-06-05 06:31:21 |
| cbfdae5c | NIFTY | BEARISH | 2026-06-05 07:14:47 |
| d178dc48 | BANKNIFTY | BEARISH | 2026-06-08 07:58:13 |
| a1e71490 | BANKNIFTY | BEARISH | 2026-06-08 08:44:47 |
| 6f02b9fb | NIFTY | BEARISH | 2026-06-09 05:47:53 |
| 59f72450 | SENSEX | BULLISH | 2026-06-10 04:13:19 |
| d0f760be | BANKNIFTY | BULLISH | 2026-06-15 05:20:44 |
