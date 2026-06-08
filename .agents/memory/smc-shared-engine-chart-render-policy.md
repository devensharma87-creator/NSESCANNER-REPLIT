---
name: SMC shared engine vs chart render policy
description: SMC math is single-sourced in lib/indicators; the scanner chart shares DETECTION but keeps its own render/lifecycle policy on purpose.
---

# SMC: one engine, two lifecycle policies

The mitigation-aware Smart-Money-Concepts math (structure/BOS/CHoCH, FVG,
swing/order-block zones, liquidity sweeps, displacement) lives in ONE place:
`lib/indicators/src/smc.ts` (`structurePass`, `fvgPass`, `swingZonePass`,
`sweepPass`, `displacementPass`, `computeSmcSeries`). The live engine, the
Backtest Lab evaluator, and the scanner charting adapter (`fnoSmc.ts`) all
consume it — no parallel copies of the detection math.

**Key non-obvious decision:** the scanner chart shares zone *detection* (pivot
lag, body/wick bounds, once-per-zone retest) but layers its OWN *render policy*
on top of `swingZonePass`: keep only the newest `zMax` formed zones per side and
optionally drop tested ones (`hideTested`). It does NOT adopt the trading
engine's zone *lifecycle* wholesale.

**Why:** the trading engine's `swingZonePass` deliberately splices a zone out of
its active set the first bar it is tested and caps the *untested-active* set —
that is correct for "nearest live zone to trade against". A chart, by contrast,
wants to keep showing recently-formed zones (incl. just-tested ones, unless the
user hides them). Forcing the chart onto the trading lifecycle would change what
users see for no benefit and risk a visual regression.

**How to apply:** if asked to "make the scanner chart use the shared SMC math",
the bar is that DETECTION + per-bar retest flags come from `smc.ts` (they do —
`fnoSmc.ts` `supplyDemandZones` is a thin adapter over `swingZonePass`, with a
parity test asserting bounds + retest flags originate there). Do NOT also rip out
the chart's last-`zMax`/`hideTested` render slice — that is intentional chart
policy, not duplicated math. The chart only renders structure/FVG/zones; it does
NOT render sweeps or displacement, so there is no sweep/displacement chart-parity
surface to unify.
