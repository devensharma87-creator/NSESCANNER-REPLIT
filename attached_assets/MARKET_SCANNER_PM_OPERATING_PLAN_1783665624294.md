# Market Scanner — Project Manager Operating Plan

## Goal
Turn marketscannerbydev.in into a complete, accurate, efficient, professional-level Indian market tool for daily use.

## Current problem
The project has become fragmented into random fixes. The owner is spending money and time without reaching a stable usable platform.

## New operating model

1. One master audit and fix program.
2. One master bug register.
3. One source-of-truth dataflow map.
4. P0 before P1.
5. No random lanes.
6. No partial completion accepted.
7. Every coder output gets accepted/rejected by evidence.
8. Every market number must be traceable.
9. Telegram, UI, DB, API, and paper ledger must reconcile.
10. Production verification required before any PROD_VERIFIED status.

## Immediate focus
The immediate program starts with a full platform baseline:

- Home / Market Pulse
- Stock Intelligence
- Scanner / Deep Scan
- Charting
- Portfolio
- Swing Cash Queue
- F&O Intraday Signals
- Option Chain
- OI Lab
- Backtest Lab
- Paper Trading
- P&L Reports
- Telegram pre-market
- Telegram post-market
- Admin / diagnostics / infra

## P0 closure definition
A P0 is closed only when:

1. root cause is proven,
2. DB/API/UI/Telegram evidence reconciles,
3. tests pass with exact counts,
4. reports are updated,
5. no safety rule is violated,
6. production verification is completed if claiming PROD_VERIFIED.

## Assistant role
The assistant acts as PM and audit controller:

- classify coder outputs,
- reject incomplete work,
- stop scope creep,
- maintain accepted status,
- generate professional downloadable prompts/directives,
- demand evidence,
- summarize done/not done clearly.
