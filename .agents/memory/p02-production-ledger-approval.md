---
name: P0.2 production ledger inventory and owner approval
description: Production paper_trade_eq/fo inventory (72 rows), dispositions, and 2026-07-22 owner approval. No rows modified.
---

## Rule

All 72 production paper-trade rows pre-dating the P0.2 deployment are classified ANNOTATE_INVALID or EXCLUDE_FROM_OFFICIAL_PNL. Owner approved 2026-07-22. No row may be modified or deleted under this approval.

**Why:** Every row was written by the pre-Phase-B writer (writer_version=null or pre-Phase-B stamp; fill_evidence_version column absent from production schema). No row passed Phase B admission. Off-session opens (13 equity + 1 F&O) and non-trading-day opens (2 equity) are further excluded.

**How to apply:** When building a P0.2 post-deployment performance report or any analytics that draws on paper_trade_eq/fo, exclude the 16 EXCLUDE rows entirely and annotate the 56 ANNOTATE_INVALID rows as "pre-Phase-B, unverified fill". Do not blend these into official P&L without that annotation.

## Counts (production DB, queried 2026-07-22)

| Table | EXCLUDE_FROM_OFFICIAL_PNL | ANNOTATE_INVALID | Total |
|---|---|---|---|
| paper_trade_eq | 15 | 29 | 44 |
| paper_trade_fo | 1 | 27 | 28 |
| **Total** | **16** | **56** | **72** |

## Key facts

- `fill_evidence_version` column: **ABSENT** from production schema (P0.2 not yet deployed to production).
- `writer_version`: null on all rows except one (`cc9d12bc` DLF — pre-Phase-B stamp `paper-writer-v1.2.0-ledger-net`; does not indicate Phase B validation).
- EXCLUDE reasons: off-session opens (times outside 09:15–15:30 IST), or opens on Saturday/Sunday non-trading days.
- MIDCPNIFTY F&O row (`05d70bcc`): outside current universe (NIFTY/BANKNIFTY/SENSEX only) — ANNOTATE_INVALID.
- `CURRENT_PRODUCTION_SHA = UNKNOWN` (no published `.replit.app` deployment found; build-info returns `environment=development`).
- `PAPER_TRADING_ENABLED=false` and `LIVE_CASH_SWING_ORDER_ENABLED=false` confirmed in production env tier.
- `DEPLOYMENT_READY = FALSE` at time of approval.
