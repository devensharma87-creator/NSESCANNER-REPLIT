---
name: Equity session gate — root cause and fix
description: Why 14/43 prod equity paper positions had invalid session timestamps, what was missing, and how the gate was added.
---

## Rule
`openPaperEquityTrade` must call `computeMarketStatus(new Date())` before any DB write and return null with `MARKET_CLOSED` reason when result ≠ `"open"`. `MANUAL` source bypasses (owner override). `runEquityPaperTradingTick` also has a belt-and-braces check before the signal loop.

**Why:** The fullNseScanner runs every 60s around the clock (`REFRESH_MS = 60_000`). Every overnight tick that found STRONG_BUY candidates in the scanner cache called `openPaperEquityTrade` without any session gate, producing positions at 23:41 IST, 06:13 IST, on Sundays, and on Saturdays. `computeMarketStatus` existed in `marketEvents.ts` but was never imported in `paperTradingEq.ts`.

**How to apply:** Any new equity paper-trade writer path (future auto/staged/quant path) must either call `openPaperEquityTrade` (which now gates) or explicitly call `computeMarketStatus` itself before inserting to `paper_trade_eq`.

## Key facts
- Production forensics 2026-07-21: 14 invalid (9 INVALID_AFTER_SESSION, 2 INVALID_WEEKEND, 3 INVALID_BEFORE_SESSION), 5 still OPEN
- Notable cluster: GRASIM/EXIDEIND/TITAN all at 2026-07-09 23:41:35.xxx — single scanner tick ran at midnight IST
- DLF 2026-07-18 16:00:28 IST = Saturday (DOW=6) — newest invalid position, writer_version=paper-writer-v1.2.0-ledger-net
- `EqAuditReason` extended with `"MARKET_CLOSED"` skip reason
- UI: `fmtDateTime` now shows year + "IST", `isOffSessionTimestamp` helper added, OFF-SESSION badge on open positions table
- Tests: `equitySessionGate.test.ts`, 23 pure unit tests anchored to production timestamps
- Full forensic record: `docs/P0_2_INVALID_SESSION_FORENSICS_2026-07-21.md`
