---
name: Kite candle CSV must be IST-local, not UTC
description: The Kite→backtester candle export must emit IST-local naive timestamps; .toISOString() silently shifts the trading session by -5:30h.
---

# Kite candle CSVs feeding the F&O backtester must be IST-local naive timestamps

The Kite Node SDK (`getHistoricalData`) returns each candle's `date` as a JS `Date`
(an absolute instant). The F&O backtester (`tools/fno-backtester/fno_backtester.py`)
and the live engine both expect **IST-local naive** timestamps
(`YYYY-MM-DD HH:MM:SS`, session 09:15..15:30), which is what its hour buckets,
per-day session-VWAP reset, and time-of-day gates key off.

**Why:** writing `date.toISOString()` emits UTC (`...T03:45:00.000Z`), shifting the
whole NSE/BSE session by −5:30h. pandas then reads `.hour` as a UTC hour, so the
"BY HOUR" table (and any time-of-day gating) is wrong — the 09:15 IST open shows as
hour 3. The aggregate P&L happened to be unaffected only because that backtester
does not gate entries by time-of-day (identical trade counts pre/post fix), but the
hour analysis was meaningless and a future time-gated strategy would silently break.

**How to apply:** format candle timestamps via `Intl.DateTimeFormat("en-CA", {timeZone:
"Asia/Kolkata", ...})` → `YYYY-MM-DD HH:MM:SS` (no `Z`, no offset). India has no DST,
so Asia/Kolkata is a fixed +05:30. This lives in `toIsoTs()` in
`artifacts/api-server/src/scripts/fetchKiteIndexCandles.ts`. Sanity check after any
change: first data row of `data/NIFTY.csv` must read `09:15:00`, not `03:45:00`.
