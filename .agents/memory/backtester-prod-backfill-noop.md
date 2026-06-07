---
name: Backtester prod backfill is a no-op
description: Why fix-backtest-trade-times never needs to run against production
---

# Backtester prod backfill is a no-op

The `fix-backtest-trade-times` backfill never needs to run against the
production database.

**Why:** the F&O backtester (tables `backtest_runs` / `backtest_trades`) was
dev-only until it was first published on 2026-06-07. The pre-fix, +05:30-shifted
"off-session" modeled trades only ever existed in the DEV database, because they
were generated during development. Production never accumulated any backtest rows
before that publish. After publish, prod's backtest tables came up empty
(0 runs / 0 trades / 0 off-session) and new runs use the fixed `candleUtcIso`
emission.

**How to apply:** if asked again to backfill prod backtest trade times, first
SELECT against the prod replica — it will show 0 off-session modeled trades. The
write-backfill (`pnpm --filter @workspace/scripts run fix-backtest-trade-times`)
stays available as a safety net if prod ever accumulates pre-fix rows, but is
otherwise unnecessary. Note: prod is read-only via the agent's executeSql; a real
write-backfill would need the production DATABASE_URL in scope.
