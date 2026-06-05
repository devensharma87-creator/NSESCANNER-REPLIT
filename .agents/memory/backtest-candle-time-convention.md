---
name: Backtest candle time convention (IST-wall-clock-in-UTC)
description: Why backtest candle Dates must be emitted via candleUtcIso, not toISOString, to avoid a +05:30 double-shift.
---

# Backtest candle timestamps are IST wall-clock encoded in UTC fields

Backtest candles (`tools/fno-backtester/data/*.csv`, loaded by `candleSource.parseIstWallClock`)
store the **IST wall clock in the UTC fields** of a JS `Date`: 09:15 IST becomes
`09:15:00Z`, not the true instant `03:45:00Z`. Internal bar math is fine with this, but it
is a trap at every emission/display boundary.

**Rule:** when emitting a backtest candle Date for persistence or API output, use
`candleUtcIso(t)` from `artifacts/api-server/src/lib/backtest/time.ts` (it subtracts
`IST_OFFSET_MS` then `.toISOString()`), NOT raw `.toISOString()`.

**Why:** raw `.toISOString()` mislabels the IST clock as a UTC instant. The frontend then
formats with `timeZone: "Asia/Kolkata"` (+05:30), double-shifting e.g. 13:30 IST -> 19:00
("07:00 pm" off-session bug). This was a real shipped bug fixed 2026-06-05.

**How to apply:**
- Directional + strategy engines emit `entryAt`/`exitAt` via `candleUtcIso`. A wall-clock
  `iso` may still be used internally for `dayKey` grouping — that's fine, it never leaves.
- `replay.ts` (REAL_REPLAY) is the exception: its rows are real DB signal instants, NOT
  wall-clock-encoded candles, so plain `.toISOString()` is correct there. Don't "fix" it.
- Session-validity audit (`isSessionValid`) is **time-of-day only** (09:15-15:30 IST);
  do NOT add a weekday rejection — NSE runs legitimate weekend sessions (e.g. the
  Union-Budget live session Sat 2025-02-01, present in the real candle history). A weekday
  check produces false "off-session" flags on those bars.
- Pre-fix persisted backtest runs keep their wrong (IST-as-UTC) times until re-run; there
  is no migration.
