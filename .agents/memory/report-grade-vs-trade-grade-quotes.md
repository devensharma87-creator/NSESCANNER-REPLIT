---
name: Report-grade vs trade-grade market data facades
description: Why display/report consumers of market data need a separate acceptance policy from trade-decision consumers, and where that facade lives.
---

Any consumer of index/equity quotes that is NOT a trade/signal/paper-trade decision (e.g. scheduled Telegram reports, read-only dashboards) must go through a dedicated **report-grade** facade in `lib/marketData/`, never the raw provider module and never the strict trade-grade router directly.

**Why:** the trade-grade router (`marketData/router.ts`) enforces a hard-stale budget (10 min) because trade/signal decisions must never act on an old tick. But some legitimate report use cases run *after* that window by design — e.g. a post-market summary sent 15 minutes after the 15:30 IST close is inherently >10min past the last tick. Swapping such a consumer to the strict router naively makes the section go blank/rejected, even though showing "today's closing tick" is completely honest for a report.

**How to apply:** a report-grade facade should (1) reuse the same underlying provider wrapper as the trade-grade path (no new provider dependency), (2) accept any quote from *today's* session even if older than the trade-grade stale budget, (3) still reject genuinely pre-today/stale-day data, (4) hard-code `tradeGrade`/`canDriveSignals`/`canDrivePaperTrades` to `false` at both the type and runtime level so it can never be mistaken for or wired into a decision path. Keep it in `lib/marketData/` so the provider-import guard's directory-based exemption applies without allowlist growth.
