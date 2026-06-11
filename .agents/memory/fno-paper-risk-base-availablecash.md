---
name: F&O paper sizing/heat base = availableCash
description: F&O paper lot sizing and portfolio-heat cap key off available cash (paper_account.balance), not seed; consequences and invariants.
---

# F&O paper sizing & heat base = available cash (not seed)

Owner-approved change: the F&O paper auto-trader sizes lots and computes the
portfolio-heat cap off **available cash = `paper_account.balance`**, NOT seed
capital. `PAPER_FIXED_LOTS` is now a **ceiling only**, not the budget.

Sizing (pure `fnoSizingHelper.ts`): `riskPerLot = |entry-stop| * lotSize`;
`finalLots = min(byTradeRisk, byHeat, ceiling)`. When `finalLots < 1`,
`byTradeRisk < 1` is reported FIRST as `RISK_TOO_WIDE_FOR_MIN_LOT`, else
`PORTFOLIO_HEAT_CAP`. The legacy final fail-closed `PORTFOLIO_HEAT` assertion in
`openPaperTrade` is retained as defense-in-depth, using the heat snapshot read
inside the `FOR UPDATE` tx.

**Why:** keeps risk proportional to the cash actually available rather than a
fixed seed, and ties the heat budget to real free capital.

**Non-obvious consequence (do NOT "fix" as a regression):** the heat cap is now
`availableCash * MAX_FNO_HEAT_PCT` (6% of *free* cash). As premium is deployed,
free cash shrinks, so the cap shrinks too — intentionally more conservative than
the old seed-based cap. This is the approved model.

**Invariant for capital ops:** any capital-movement ledger write
(`ADD_CAPITAL` / `WITHDRAW_CAPITAL` into `paper_capital_event`) MUST happen in
the SAME transaction as the `paper_account.balance` mutation. Withdraw uses
`SELECT ... FOR UPDATE` and blocks (no ledger row) when `balance < amount` so
balance can never go negative; withdrawable = balance (open-position capital is
locked separately and is not withdrawable).
