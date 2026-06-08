---
name: Backtest trade pnl/optionExit null semantics
description: How to detect a REAL_REPLAY "no captured exit" trade in the Backtest Lab UI without mislabeling modeled proxy trades.
---

In Backtest Lab trade rows, `pnl` and `optionExit` are NOT interchangeable signals
for "no captured exit", and `optionExit == null` is the wrong predicate.

- **REAL_REPLAY** (`modeled === false`): `optionExit` and `pnl` are assigned in the
  SAME guarded block (captured exit AND entry premium AND lot size all present), so
  they are null together. A null here means "no usable captured exit outcome"
  (either truly no exit, or exit captured but entry/size missing — both excluded
  from P&L).
- **Modeled** (Directional / Strategy / Compare proxy, `modeled === true`): the delta
  proxy leaves premiums blank, so `optionExit == null` ALWAYS — yet these trades DO
  have a real modeled exit time and a non-null proxy `pnl`.

**Rule:** to detect an exit-less REAL_REPLAY row (render exit time as "—", skip its
exitAt in the session-validity audit), use `!t.modeled && t.pnl == null`. Never key
off `optionExit == null` — it would wrongly hide the real modeled exit time on every
proxy trade.

**Why:** an architect review suggested `optionExit == null`; it is wrong precisely
because modeled proxy trades have null premiums but real exits. The `!modeled` guard
also defends against any future modeled builder that emits a null pnl.

**How to apply:** any Backtest Lab UI logic distinguishing "real captured exit" from
"stale/EOD mark" exit. Source of truth: `buildReplayTrades` /
`capturedExit` in `artifacts/api-server/src/lib/backtest/replay.ts`.
