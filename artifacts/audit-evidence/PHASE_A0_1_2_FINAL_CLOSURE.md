# PHASE A0.1.2 FINAL CLOSURE — D-FAB-03 & D-FAB-04

**Prepared:** 2026-07-25  
**Scope:** Volume Profile / VWAP fabrication bugs in index F&O signal path  
**Status:** IMPLEMENTATION COMPLETE — PRODUCTION DEPLOYMENT STATUS UNVERIFIED  

> **Note on deployment status:** This document cannot make a verified claim about production.
> Production deployment requires an explicit Publish action by the owner in the Replit dashboard.
> All evidence below is from the development environment (commit HEAD on `main`).

---

## 1. Defect Summary

| ID | Description | Severity |
|----|-------------|----------|
| D-FAB-03 | `scoreConfluence` received a real `vpIntraday` object for cash indices (NIFTY/BANKNIFTY/SENSEX), whose Kite candles carry structural zero volume. A non-null VP inflated the `VOLUME_PROFILE` factor weight, fabricating a VP-based confidence boost from data that was never meaningful. | HIGH |
| D-FAB-04 | `detectTrendContinuation` in the no-VWAP branch included a `vp.pointOfControl` comparison (`if (c.vp && c.spot > c.vp.pointOfControl) conf += 8`) that added directional confidence from volume data that does not exist for cash indices. | HIGH |

---

## 2. Commit History (Phase A0 closure chain)

### Phase A0 — df1a132 (2026-07-24)

**"Strengthen accuracy of trading decisions by removing unreliable data"**

```
artifacts/api-server/src/lib/optionSignals.ts   | 18 +-
artifacts/api-server/src/lib/optionSignals.zeroVolume.test.ts | 99 +-
artifacts/api-server/src/lib/confluenceEngine.ts | 5 +
```

*Effect:* Removed `if (c.vp && c.spot > c.vp.pointOfControl) conf += 8` from the
no-VWAP (index) branch of `detectTrendContinuation`. After this commit the maximum
achievable confidence in the no-VWAP path is EMA(20)+RSI(15)+vol(8) = 43, always
below the 50-point emission threshold. No TREND_CONTINUATION signal is emitted for
cash indices via this path.

### Phase A0.1 — a9063ac (2026-07-25)

**"Enforce strict boundary on volume profile data for index futures"**

```
artifacts/api-server/src/lib/confluenceEngine.ts   | 13 +-
artifacts/api-server/src/lib/optionSignals.ts      |  9 +-
artifacts/api-server/src/lib/optionSignals.zeroVolume.test.ts | 220 +
```

*Effect:* Changed `vp: ctx.vpIntraday` → `vp: null` at the `confluenceInputs`
construction site in `buildSignalsForIndex` (line ~1616 of `optionSignals.ts`).
This is an explicit decision-boundary rule: regardless of what `ctx.vpIntraday`
contains at call time, the confluence engine for index F&O MUST NOT receive VP data.
31 injection tests added in `optionSignals.zeroVolume.test.ts`.

### Phase A0.1.2 — current working tree (this session, 2026-07-25)

```
artifacts/api-server/src/lib/optionSignals.ts           |   6 +-
artifacts/api-server/src/lib/optionSignals.zeroVolume.test.ts | 364 +
```

*Effect:*
- 3 export seams added to `optionSignals.ts`: `export interface Ctx`,
  `export function detectTrendContinuation`, `export function buildSignalsForIndex`.
- Tests A–F added (364 lines) proving runtime behavioural invariants via real
  production modules and `vi.spyOn` on the live `scoreConfluence` binding.

---

## 3. Executable Tests A–F — Results

**Test run command:**
```
pnpm --filter @workspace/api-server exec vitest run --pool=threads \
  "src/lib/optionSignals.zeroVolume.test.ts"
```

**Outcome:**
```
 Test Files  1 passed (1)
      Tests  38 passed (38)
   Duration  7.48s
```

38 tests pass: 31 existing tests (A1/A2, B1–B5, C1–C3, D1/D2, T1–T4, C0, others) +
7 new behavioural proof tests (A-BEARISH×2, B-CALLER, C-CALLER, D-SENTINEL, E-NOVWAP, F-ALL).

### Test A-BEARISH (2 tests)

**Claim:** The `vp: null` boundary is load-bearing for the *bearish* direction, not
only bullish. A non-null VP with `POC > spot` (spot below the value node — a bearish
VP configuration) changes the `VOLUME_PROFILE` factor weight in a BEARISH
`scoreConfluence` call.

**Test:** `scoreConfluence({ ...BASE_BEARISH, vp: VP_POC_ABOVE_SPOT })` vs
`scoreConfluence({ ...BASE_BEARISH, vp: null })`.

**Result:**
- `vpWithVP.weight ≠ 0` ✓ (boundary is load-bearing for BEARISH)
- `vpWithNull.weight === 0` ✓
- `withVP.confluenceScore ≠ withNull.confluenceScore` ✓
- No POC/VAH/VAL detail text with `vp: null` ✓

### Test B-CALLER

**Claim:** When `buildSignalsForIndex` runs a BULLISH fixture, the actual runtime
argument passed to `scoreConfluence` has `vp === null`, even though `ctx.vpIntraday`
is non-null (fixture has `volume = 1 000 000` on all 100 bars → `volumeProfile()`
returns a real VP object upstream).

**Seam used:** `vi.spyOn(confluenceEngine, "scoreConfluence")` observing the live
module binding. Fake time: `2026-01-28T05:00:00Z` = Wednesday 10:30 IST (market open,
not holiday, not expiry day for NIFTY).

**Result:**
- `scoreSpy.mock.calls.length > 0` ✓ (detector fired and reached confluence)
- Every call: `call[0].vp === null` ✓
- Directions observed: contains "BULLISH" ✓

### Test C-CALLER

**Claim:** Same as B but for the BEARISH path. Fixture: alternating −3/+2 per bar
from 23000 → RSI ≈ 40 (32–48 bearish zone), EMA9 < EMA21, spot < VWAP.

**Result:**
- `scoreSpy.mock.calls.length > 0` ✓
- Every call: `call[0].vp === null` ✓
- Directions observed: contains "BEARISH" ✓

### Test D-SENTINEL

**Claim:** The boundary holds even when `ctx.vpIntraday` would have been a numerically
extreme sentinel (the BULLISH fixture already has real non-null vpIntraday due to
vol = 1e6). An absent boundary would expose the call to an absurd POC (99999 on a
22000-spot instrument) inflating the confluence score massively.

**Result:**
- `scoreSpy.mock.calls.length > 0` ✓
- Every call: `call[0].vp === null` ✓

### Test E-NOVWAP

**Claim:** In the no-VWAP branch, `detectTrendContinuation` returns null regardless
of `vpIntraday` value. Maximum reachable confidence = EMA(20)+RSI(15) = 35 with
`avgVol20=0, lastVol=0` (vol confirm cannot fire) < 50 emission threshold. VP
variation has zero structural effect on the null return.

**Fixture:** Direct `Ctx` construction via the exported `Ctx` interface:
`vwapAvailable: false`, `ema9: 24580 > ema21: 24550`, `spot: 24600 > ema9`,
`rsi14: 60` (52–68 zone), `avgVol20: 0`, `lastVol: 0`.

**Four variants tested:**
| vpIntraday | Result | Reason |
|------------|--------|--------|
| VP_POC_BELOW_SPOT | null | conf(35) < threshold(50) |
| VP_POC_ABOVE_SPOT | null | conf(35) < threshold(50) |
| VP_ABSURD (POC=99999) | null | conf(35) < threshold(50) |
| null | null | conf(35) < threshold(50) |

All four: `r1 === r2 === r3 === r4 === null` ✓

**D-FAB-04 structural guarantee:** The target formula (`piv.r1 + atr15 * 0.3`)
is never reached in the no-VWAP branch because the `conf < 50` guard returns null
before it. VP cannot influence the target at the structural level — not merely
because the POC check was removed (Phase A0) but because the no-VWAP path cannot
emit at all.

### Test F-ALL

**Claim:** 100% of `scoreConfluence` calls across both BULLISH and BEARISH emission
paths receive `vp === null`. No exception exists.

**Method:** `buildSignalsForIndex` called twice (BULLISH then BEARISH). Spy accumulates
all calls across both invocations.

**Result:**
- `totalCalls > 0` ✓
- `allNull = scoreSpy.mock.calls.every(call => call[0].vp === null)` → **true** ✓
- `dirs.includes("BULLISH")` ✓
- `dirs.includes("BEARISH")` ✓

---

## 4. Typecheck

```
pnpm run typecheck
```

**Outcome:** All 5 leaf packages clean — no errors.

```
artifacts/api-server typecheck: Done
artifacts/global typecheck: Done
artifacts/scanner typecheck: Done
artifacts/mockup-sandbox typecheck: Done
scripts typecheck: Done
```

---

## 5. Fixture Validity Notes

### Timestamp computation (BASE_INTRA_TS_CLOSURE = 1769571900)

`1769571900 + 19800 = 1769591700`  
`new Date(1769591700 * 1000).toISOString()` = `"2026-01-28T09:15:00.000Z"` (IST 09:15)

2026-01-28 is a Wednesday. 2026-01-26 is Republic Day (NSE holiday). 2026-01-28 is
a normal trading day. NIFTY expires on Tuesdays (`expiryWeekday: 2`), so 2026-01-28
is NOT an expiry day.

### RSI approximation for the fixtures

BULLISH series (alternating +3/−2): 7 gains of 3 + 7 losses of 2 in first 14 bars →
`avgGain = 1.5, avgLoss = 1.0` → `RSI₁₄ = 100 − 100/(1+1.5) = 60` (52–68 zone ✓)

BEARISH series (alternating −3/+2): 7 losses of 3 + 7 gains of 2 →
`avgGain = 1.0, avgLoss = 1.5` → `RSI₁₄ = 100 − 100/(1+0.667) = 40` (32–48 zone ✓)

### EMA stack for BULLISH

Net drift = +0.5/bar. Steady-state EMA lag ≈ `d × (k−1)/2`:
- EMA9 lag ≈ 0.5 × 4 = 2.0 pts → EMA9 ≈ 22048
- EMA21 lag ≈ 0.5 × 10 = 5.0 pts → EMA21 ≈ 22045
- spot = 22050 > EMA9 (22048) > EMA21 (22045) ✓

### htfBias computation

`dailyEma50 ≈ flatClose`. Bias is BULLISH when `spot > dailyEma50 × 1.004`:
- BULLISH: spot~22050 > 21000×1.004=21084 ✓
- BEARISH: spot~22950 < 24000×0.996=23904 (BEARISH htfBias) ✓

No HTF conflict in either fixture → no demotion from htfBias gate.

---

## 6. Scope Boundaries — What This Closure Does NOT Cover

| Item | Status |
|------|--------|
| Live Kite session with real NIFTY candles | Not tested (requires broker auth) |
| Production database | Not accessed |
| Paper trade creation / signal lifecycle | Not affected by this change |
| `getOptionSignals()` full end-to-end | Not tested (requires Kite + DB) |
| Other detectors (VWAP Reclaim, Volume Breakout, etc.) | Covered by existing tests; not changed |
| Signal scoring thresholds, lot sizing, DD caps | Not changed |

---

## 7. Production Deployment Status

**PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED**

This document cannot verify that the changes are live in production. Production
deployment requires an explicit Publish action by the owner via the Replit dashboard.
The evidence above is from the development environment on the `main` branch.

To verify production is current: check the deployment logs for a boot timestamp
after the commit timestamps above, or compare `/api/build-info` (if available) against
the commit SHAs.

---

*End of PHASE_A0_1_2_FINAL_CLOSURE.md*
