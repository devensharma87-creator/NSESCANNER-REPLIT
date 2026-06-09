---
name: Backtest Lab — synthetic option-premium modelling (deferred rectification)
description: Audit finding that Strategy Research / Backtest Lab option premiums are synthetic; needs its own later task, kept OUT of the Portfolio/Home data-authenticity lanes.
---

# Backtest Lab option-premium layer is synthetic (deferred to its own task)

**Finding (owner audit, not yet actioned):** The Strategy Research / Backtest Lab option-premium layer is synthetic, not market-derived:
- premium ≈ a fixed ~0.40% of spot,
- a fixed ~0.50 delta,
- no theta, no IV,
- and the stop-loss documentation does not match the modelled behaviour.

**Why this matters:** On a money/trading app this is a data-authenticity issue of the same family as the Home/Portfolio audit — modelled numbers presented without honest labelling. But it is a SEPARATE lane.

**How to apply:**
- Do NOT fold this into the Portfolio Analyser work or into T003 (Home/Market-Pulse index analytics honesty). Keep the lanes separate.
- This needs its own later task: "Backtest Lab rectification + labelling" — either source real option premiums or clearly label the modelled premium/greeks as synthetic, and fix the stop-loss documentation mismatch.
- Owner sequencing: (now) close scoped Portfolio T004 → (next) T003 index analytics honesty → (later) Backtest Lab rectification.
- **Full deferred spec lives in `docs/backtest-lab-rectification-backlog.md`** (audit findings + required labels/pricing-modes REAL_CHAIN/BLACK_SCHOLES_MODELLED/SYNTHETIC_DELTA_PROXY + missing export columns + tests + acceptance + the 37.5%-vs-30% stop mismatch). Spot/calendar/lot data verified authentic; only the option-premium layer is synthetic.
