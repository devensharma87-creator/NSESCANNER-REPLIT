---
name: F&O cost model is shadow/reporting-only; realized P&L is gross
description: Scope boundary for fnoCostModel — changing realized P&L/DD/heat to net is a trading-logic change, not a report tweak
---

# F&O cost model scope

`fnoCostModel.ts` (`computeFnoTradeCost`, `FNO_COST_PARAMS`) is **shadow / reporting-only**.
It is imported ONLY by `fnoShadowCosts.ts` and `routes/paper.ts` (the shadow report endpoint).
It is NOT imported by `paperTradingFO.ts` or `paperAccount.ts`.

**Therefore: realized P&L, daily/weekly DD caps, and portfolio heat are all computed GROSS (no costs applied).**

**Why this matters:** A request to "make STT/cost handling consistent across realized P&L / DD / heat" is
NOT a one-line report fix — it changes when risk caps and heat gates trigger, i.e. it changes
trading-blocking behavior. Treat it as a far-reaching trading-logic change that needs explicit owner sign-off,
separate from correcting the shadow report constants.

**Statutory STT rates (verified via web, eff 2026-04-01, Budget 2026):**
- Options sale-of-premium (sell): 0.15% (`STT_RATE_SELL_PREMIUM = 0.0015`)
- Futures (sell): 0.05% (`STT_RATE_SELL_FUTURES`, published constant — futures not traded by this paper book)
- ITM option exercise: 0.15% on intrinsic (`STT_RATE_EXERCISE_INTRINSIC`, published only — paper closes on premium)
- Captured in `FNO_COST_PARAMS_ASOF = "2026-04-01"`.
Prior eras: 0.0625% (pre-Oct-2024), 0.10% (Oct-2024 → Mar-2026).
