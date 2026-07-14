---
name: Risk-guard sim netImprovement formula
description: How to compute scenario netImprovement in the F&O risk-guard simulation without double-counting blocked winners
---
Rule: In the F&O risk-guard simulation each scenario's `netImprovement` MUST equal `-(netPnlAvoided)`. `netPnlAvoided` already nets blocked winners against blocked losers, so it is the complete delta from applying the guard.

**Why:** An earlier version subtracted blocked-winner P&L a second time (`-(netPnlAvoided) - netPnlLostFromBlockedWinners`), double-counting winners and making every protective scenario look falsely negative — the full 4-guard combo showed −₹15,750 when the true value was +₹61,451. That almost drove a wrong "roll back to shadow" decision.

**How to apply:** Any change to scenario aggregation in `riskGuardSimulation.ts` must preserve `netImprovement === -(netPnlAvoided)`; `netPnlLostFromBlockedWinners` is display-only context and must never be re-subtracted. Cross-check invariant: `simulatedNet === baselineNet + netImprovement`. Also: the theta guard (G1) is conjunctive (DTE≤threshold AND premium<threshold) — a THETA_RISK_ONLY scenario blocking 0 trades is the signal that there is no blanket-DTE harm to BANKNIFTY.
