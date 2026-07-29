---
name: A0.3.3 VWAP decision-path honesty
description: Ctx.pivotRef removed; ConfluenceInputs.vwap and VetoInputs.vwap are now number|null; null is the canonical "VWAP unavailable" signal; never substitute spot.
---

## Rule
`Ctx.pivotRef` (the `vwapRaw ?? spot` proxy) is **fully removed** from `optionSignals.ts`. Any future
code that references `c.pivotRef` or `ctx.pivotRef` will fail TypeScript compilation.

The canonical pattern for VWAP-unavailable is:
- `authVwap: null` on Ctx
- `vwapAvailable: false` on Ctx
- `ConfluenceInputs.vwap: null` — scoreVwap returns weight=0/neutral with honest detail
- `VetoInputs.vwap: null` — evaluateDirectionalVetoes early-returns {recovery:false,chase:false}
- Detector momentum checks using VWAP: `if (!c.authVwap) return null` (fail closed)
- Stop geometry: `const stopRef = c.vwapAvailable ? c.authVwap! : c.spot` (explicit, honest)

## Why
A0.3.2 renamed Ctx.vwap → Ctx.pivotRef but still fed `pivotRef` (= spot when VWAP absent)
through `vwap:`-named parameters in `scoreConfluence` and `evaluateDirectionalVetoes`,
and into detector stop/momentum formulas under a VWAP-labelled driver. The spot-as-proxy
created systematic bias: recovery veto meanReclaim was always true (spot ≥ spot), chase
veto extension was always 0, and VWAP confluence factor could shift confidence using spot.

## How to apply
- New detectors needing VWAP: check `c.authVwap !== null` or `c.vwapAvailable` before any
  VWAP arithmetic. Never pass `c.spot` as a `vwap:` argument to any function.
- New helpers that accept VWAP: type the field as `number | null`; handle null explicitly.
- Test baseline: full api-server suite = **4298 passed / 3 skipped** (3 skips = DB-isolation guard,
  pre-existing). pivotRefInventory.a032.test.ts = 35 tests (§13.1–§13.5 incl. A0.3.3 boundary tests).
- The regime classifier at line 525 still receives `vwap: effectiveVwap` (out-of-scope; not a
  VWAP-labelled trade-decision output).
- **Final acceptance (2026-07-29):** `ACCEPT_A0_3_AS_UNIT_VERIFIED` issued in §21 of evidence file.
  All 6 route states carry 9 records unconditionally (`computeAllIndexFnoSetupAvailability()` is
  static, called at line 3505 independent of per-index signal/exception results). EMA-pullback
  confirmed VWAP-free (0 references). Blocker (Case 10 stale fixture) closed — see stale-date-fixture.md.
  Working tree at acceptance: `swingOrderStaging.test.ts` modified (+7/-1), no commit made.
