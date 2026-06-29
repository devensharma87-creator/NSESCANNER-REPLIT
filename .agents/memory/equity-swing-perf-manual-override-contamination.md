---
name: Equity-swing paper performance — exclude MANUAL_OVERRIDE for go-live edge
description: When auditing paper_trade_eq for real-money readiness, the blended win rate overstates the AUTONOMOUS system's edge because manual closes are mixed in.
---

When judging whether the equity swing system is ready for real money, do NOT cite the blended `paper_trade_eq` win rate / net P&L as "the system's edge."

A material share of closed trades exit via `exit_reason = 'MANUAL_OVERRIDE'` (operator-driven, not system-managed). Those are a human's decisions, not the autonomous strategy. Always partition the closed set and report the autonomous-only sample (exclude `MANUAL_OVERRIDE`) separately — that is the number that matters for unattended go-live.

**Why:** In the 2026-04-29..06-29 prod sample, 8 of 24 closed trades (33%) were MANUAL_OVERRIDE. Blended was 75% WR / +₹142,762; autonomous-only was 16 trades, 12W/4L (still ~75%), +₹109,630. The edge survived the cut, but the *autonomous sample size collapsed to 16* — far too thin to scale on. A blended count hides that thinness.

**How to apply:** For any equity-swing readiness/performance audit, run the aggregate twice — all-closed and `WHERE exit_reason <> 'MANUAL_OVERRIDE'` — and gate scaling on autonomous closed-trade count (target ~50–100 after costs), not the blended figure. Also remember the track record can lean on a few names (top-3 names ~58% of gross wins, incl. consecutive-day stacking of the same symbol since dedup is same-day only).
