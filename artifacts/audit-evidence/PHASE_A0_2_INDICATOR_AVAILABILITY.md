# Phase A0.2 / A0.2.1 — D-FAB-01 / D-FAB-02 / D-FAB-05
## Indicator Numeric-Validity Contract + Fail-Closed Contaminated-Series Semantics

**Programme:** F&O Signal Fabrication Defect Closure
**Phases:** A0.2 (initial) + A0.2.1 (fail-closed correction, test-count reconciliation)
**Precondition:** A0.1 accepted at `UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`; baseline `4af42c1f`
**A0.2 entry HEAD:** `4af42c1f5bb6f9a6e9bea7c6e6379e53c4e1e7d0` (working-tree only on entry)
**A0.2 platform checkpoint:** `05334bd9bb2f31743bab62683f0eb0995cfd6f6a` (committed by platform)
**A0.2.1 entry HEAD:** `05334bd9bb2f31743bab62683f0eb0995cfd6f6a` (working-tree only on entry)
**A0.2.1 working tree:** Clean on entry; 3 files modified this delta; no commit/push
**Date completed:** 2026-07-27

---

## §1 Scope and Defect Classification

| Defect | Root issue | Status on A0.2 entry | Final status |
|--------|-----------|---------------------|-------------|
| D-FAB-01 / FX-01 | `volumeProfile()` — `NaN <= 0` bypasses total-vol guard; `continue` skips contaminated bars, profile returned from remainder | PARTIALLY_IMPLEMENTED | **UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION** |
| D-FAB-02 / FX-02 | Five false prose locations in helper JSDoc/comments claiming provider provenance | PARTIALLY_IMPLEMENTED | **UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION** |
| D-FAB-05 / FX-05 | `sessionVwap()` — `volume[i] ?? 0` let negative/NaN vol accumulate; `continue` skips bar, later bars resume a valid-looking VWAP | PARTIALLY_IMPLEMENTED | **UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION** |

Out of scope: D-FAB-03, D-FAB-04 (A0.1), D-FAB-06, D-FAB-07, D-FKE-05, `rollingVwap`, provider-trust enforcement.

---

## §2 Stage 0 — Git State on A0.2.1 Entry

```
branch:        main
PRE_DELTA_HEAD: 05334bd9bb2f31743bab62683f0eb0995cfd6f6a
git status:    ?? attached_assets/MARKET_SCANNER_PROMPT_02_ACCEPTANCE_DELTA_A0_2_1_[...].md
               (working tree clean — no modified tracked files)
upstream:      origin/main
ahead/behind:  20 ahead / 0 behind
merge-base with 4af42c1f: 4af42c1f5bb6f9a6e9bea7c6e6379e53c4e1e7d0 (CONFIRMED ANCESTOR)
git log HEAD-1:
  05334bd (HEAD -> main) Implement indicator logic with supporting tests and documentation
  4af42c1 Update confluence engine logic and expand zero volume option signal tests
  ...
```

A0.1 checkpoint `4af42c1f` is a confirmed ancestor of A0.2.1 entry HEAD. Baseline not diverged. Proceeding.

---

## §3 Changed Files — Complete A0.2 + A0.2.1 Record

### A0.2 (committed as `05334bd9`)
| File | Change type |
|------|-------------|
| `artifacts/api-server/src/lib/indicators.ts` | Numeric-validity contract (initial, "skip" semantics) |
| `artifacts/api-server/src/lib/indicators.test.ts` | New test blocks (+28 test executions) |
| `artifacts/api-server/src/lib/optionSignals.ts` | D-FAB-02 comment correction |
| `artifacts/api-server/src/scripts/fetchKiteIndexCandles.ts` | D-FAB-02 comment correction |

### A0.2.1 (working tree, not committed)
| File | Change type | Net ±lines |
|------|-------------|-----------|
| `artifacts/api-server/src/lib/indicators.ts` | Fail-closed pre-scan in `sessionVwap()` + `volumeProfile()`; JSDoc corrected | +64 / -50 |
| `artifacts/api-server/src/lib/indicators.test.ts` | T4 updated; 9 contaminated-series tests added | +102 / -41 |
| `artifacts/api-server/src/lib/optionSignals.ts` | D-FAB-02: remaining provider claims in interface JSDoc + buildContext comment | +25 / -22 |

Combined A0.2.1 delta: 3 files changed, 150 insertions, 41 deletions.
`fetchKiteIndexCandles.ts` not in this delta (committed in A0.2).

---

## §4 § 23 — Reason for A0.2.1 Reopening

The A0.2 implementation used `continue` in both `sessionVwap()` and `volumeProfile()` to handle invalid bars. This behavior was classified as:

- **`sessionVwap()`**: `INVALID_BAR_NULL_BUT_LATER_VALUE_RESUMES` — a bar with negative/NaN/Infinity volume triggered `continue`; the contaminated position stayed null, but subsequent valid bars resumed accumulation, producing a non-null final value. The last element of the returned series was a valid-looking VWAP from a partial session window — forbidden by §6.2.

- **`volumeProfile()`**: `INVALID_BAR_SKIPPED_AND_SERIES_CONTINUES` — a bar with negative/NaN/Infinity volume or NaN close triggered `continue`; the bar was dropped silently and a profile was returned from the remaining bars — forbidden by §6.1.

Proof by construction: with input `[bar0: vol=200, bar1: vol=-1, bar2: vol=300]`:
```
sessionVwap before fix:
  bar 0: vol=200 (valid) → pv=200*typ0, v=200, out[0] = typ0
  bar 1: vol=-1  → continue → out[1] stays null
  bar 2: vol=300 → pv+=300*typ2, v=500, out[2] = (200*typ0+300*typ2)/500  ← non-null!
```
The last value `out[2]` is a valid-looking VWAP that silently excluded the contaminated bar.

Additional A0.2 issues:
- Test T4 in `sessionVwap — input validation (A0.2)` asserted `out[1]` and `out[2]` were non-null after a NaN-OHLC bar 0, which was correct under "skip" semantics but incorrect under fail-closed semantics.
- The "30 new tests" claim was inaccurate — arithmetic resolves to 28 new test executions.
- Two additional D-FAB-02 false-prose locations in `optionSignals.ts` (interface JSDoc + buildContext) were not addressed in A0.2.

---

## §5 §24 — Fail-Closed Classification (Post A0.2.1)

| Function | Classification | Proof |
|----------|---------------|-------|
| `sessionVwap()` | **`COMPLIANT_FAIL_CLOSED`** | Pre-scan returns all-null on first invalid bar; main loop only runs if all bars pass |
| `volumeProfile()` | **`COMPLIANT_FAIL_CLOSED`** | Pre-scan returns null on first invalid bar in sliced window; bucket loop only runs if all bars pass |

Behavioral proof is supplied by the contaminated-series tests (§9 below), which use a single invalid bar embedded in otherwise valid positive-volume data.

---

## §6 §25 — Fail-Closed Implementation and Behavioral Proof

### 6.1 `sessionVwap()` — before and after

**Before (A0.2, `INVALID_BAR_NULL_BUT_LATER_VALUE_RESUMES`):**
```typescript
for (let i = 0; i < n; i++) {
    const vol = volume[i]!;
    if (!isFinite(vol) || vol < 0) continue;           // ← skip
    const typ = (high[i]! + low[i]! + close[i]!) / 3;
    if (!isFinite(typ)) continue;                       // ← skip
    pv += typ * vol;
    v += vol;
    out[i] = v > 0 ? pv / v : null;
    // out[i+k] for valid bar k > i resumes → non-null final value
}
```

**After (A0.2.1, `COMPLIANT_FAIL_CLOSED`):**
```typescript
// Fail-closed pre-scan: a single non-finite/negative volume bar or non-finite
// OHLC bar contaminates the entire session window.
for (let i = 0; i < n; i++) {
    const vol = volume[i]!;
    if (!isFinite(vol) || vol < 0) return new Array(n).fill(null);
    const typ = (high[i]! + low[i]! + close[i]!) / 3;
    if (!isFinite(typ)) return new Array(n).fill(null);
}
// All bars numerically valid. Zero-volume bars contribute zero weight.
const out: (number | null)[] = new Array(n).fill(null);
let pv = 0; let v = 0;
for (let i = 0; i < n; i++) {
    const typ = (high[i]! + low[i]! + close[i]!) / 3;
    const vol = volume[i]!;
    pv += typ * vol;
    v += vol;
    out[i] = v > 0 ? pv / v : null;
}
return out;
```

### 6.2 `volumeProfile()` — before and after

**Before (A0.2, `INVALID_BAR_SKIPPED_AND_SERIES_CONTINUES`):**
```typescript
for (let i = 0; i < sliceC.length; i++) {
    const closeVal = sliceC[i]!;
    const vol = sliceV[i]!;
    if (!isFinite(closeVal) || !isFinite(vol) || vol < 0) continue; // ← skip
    const idx = ...;
    buckets[idx]! += vol;
}
// total vol check: if remaining bars had volume > 0, returns valid profile
```

**After (A0.2.1, `COMPLIANT_FAIL_CLOSED`):**
```typescript
// Fail-closed pre-scan over the sliced window.
for (let i = 0; i < sliceC.length; i++) {
    if (
        !isFinite(sliceH[i]!) || !isFinite(sliceL[i]!) ||
        !isFinite(sliceC[i]!) || !isFinite(sliceV[i]!) || sliceV[i]! < 0
    ) return null;
}
// All bars valid. Bucket loop is clean (no continue needed).
for (let i = 0; i < sliceC.length; i++) {
    const closeVal = sliceC[i]!;
    const vol = sliceV[i]!;
    // Zero-volume bars contribute vol=0 to buckets (no effect on profile shape).
    const idx = ...;
    buckets[idx]! += vol;
}
```

**Behavioral proof (contaminated series with single embedded invalid bar):**

```
sessionVwap([100,102,104],[98,100,102],[99,101,103],[200,-1,300]):
  Pre-scan: bar 1 vol=-1 → !isFinite(-1)? false; -1 < 0? true → return [null,null,null]
  Result: [null, null, null]  ← ALL unavailable ✓

volumeProfile(H10,L10,C10,[100,200,150,-1,250,...]):
  Pre-scan: bar 3 vol=-1 → isFinite(-1)=true, -1<0 → return null
  Result: null ✓
```

---

## §7 Implementation: D-FAB-05 — sessionVwap() JSDoc

**Corrected (A0.2.1):**
- "Bars with non-finite volume … are **skipped** entirely" → "a single bar with non-finite volume … makes the **entire session window unavailable** (fail closed)"
- Removed stale per-bar-skip bullet; added fail-closed rule
- Retained: zero-volume permitted, no-HLC3-fallback rule, mismatched-length rule

---

## §8 Implementation: D-FAB-01 — volumeProfile() JSDoc

**Corrected (A0.2.1):**
- "Bars with non-finite close or non-finite/negative volume are **skipped**" → "a single bar with non-finite or negative required input makes the **entire profile window unavailable** (fail closed)"
- Added: "Zero-volume bars are permitted when all their OHLC inputs are finite"

---

## §9 Implementation: D-FAB-02 — Prose Correction Summary

All five original D-FAB-02 locations are closed. Two additional locations found in A0.2.1 prose search are also corrected.

| # | Location | Claim removed | Replacement | Phase |
|---|----------|--------------|-------------|-------|
| 1 | `indicators.ts` `sessionVwap` JSDoc | "Kite returns volume=0 for every bar" | D-FAB-05 numeric contract; "Provider/provenance trust is not enforced here" | A0.2 |
| 2 | `indicators.ts` `volumeProfile` (was inline comment) | "Cash indices always have zero candle volume" | D-FAB-01 numeric contract JSDoc | A0.2 |
| 3 | `optionSignals.ts` lines ~394-401 | "naturally null for those indices"; "Cash-index volume from Kite is 0" | Numeric outcome + isIndexFno defence-in-depth note | A0.2 |
| 4 | `fetchKiteIndexCandles.ts` block comment | "sessionVwap falls back to typical price when vol=0" (factually false) | "sessionVwap returns null … does NOT fall back to HLC3" | A0.2 |
| 5 | `fetchKiteIndexCandles.ts` console.log | "backtester's session_vwap mirrors the live typical-price fallback" | "live sessionVwap returns null for zero-volume bars (no HLC3 fallback)" | A0.2 |
| 6 | `optionSignals.ts` `DetectorCtx.vwapAvailable` JSDoc | "their Kite candles carry zero volume, so `vwap` is set to `spot`" | Numeric outcome language; "Provider/provenance trust is not asserted here" | A0.2.1 |
| 7 | `optionSignals.ts` `buildContext` comment | "Kite returns volume=0 for every bar" | "sessionVwap() returned a non-null final value"; provider provenance removed | A0.2.1 |

**Remaining in scope for future phases (NOT changed — detector-level, not indicator-helper):**
- `optionSignals.ts` line 709: "cash indices with structural zero candle volume" — detector body D-FAB-04 quarantine comment
- `optionSignals.ts` line 726: "Index spot candles carry zero volume" — driver detail text in `detectTrendContinuation`
- `optionSignals.ts` lines 1133, 1157: same; in `detectVwapReclaim` (separate detector)

These are in the detection engine (caller level), not indicator helpers; they describe operational behaviour of the A0.1 policy. Deferred to a future D-FAB-02 extension phase.

---

## §10 D-FAB-02 Full Prose Search Results (post A0.2.1)

Command:
```bash
rg -n -i \
  "naturally null|always null|always.*zero|zero.?volume|HLC3|typical.?price|vwapAvailable|vpIntraday|point.?of.?control|\bPOC\b|\bVAH\b|\bVAL\b" \
  artifacts/api-server/src/lib/indicators.ts \
  artifacts/api-server/src/lib/optionSignals.ts \
  artifacts/api-server/src/scripts/fetchKiteIndexCandles.ts
```

**`indicators.ts` matches — all ACCURATE:**
| Line | Text (truncated) | Classification |
|------|-----------------|----------------|
| 119 | "Rolling daily VWAP using HLC3 weighted by volume" | ACCURATE — formula description in `rollingVwap` |
| 153 | "Zero-volume bars are permitted: they contribute zero weight" | ACCURATE — fail-closed contract |
| 155 | "Does NOT fall back to HLC3, close, spot, or any price-only substitute" | ACCURATE — explicit no-fallback rule |
| 161 | "previous behaviour (returning HLC3 when cumVol=0) was silently wrong" | ACCURATE — historical note |
| 185 | "All bars numerically valid. Zero-volume bars contribute zero weight" | ACCURATE — implementation note |
| 201 | `pointOfControl: number` | ACCURATE — interface field name |
| 219 | "degenerate all-zero-bucket profile would produce POC/VAH/VAL" | ACCURATE — contract bullet |
| 226 | "Valid-output guarantee: POC, VAH, VAL are finite" | ACCURATE — contract guarantee |
| 248 | "Zero-volume bars … pass this check and contribute zero weight" | ACCURATE — implementation note |
| 289 | `pointOfControl: lo + (pocIdx + 0.5) * step` | ACCURATE — return value |

**`optionSignals.ts` matches — no remaining false prose in indicator/helper scope:**
| Line | Text (truncated) | Classification |
|------|-----------------|----------------|
| 218 | `vwapAvailable: boolean` (interface field) | ACCURATE — field declaration |
| 230 | `vp: { pointOfControl: ...} \| null` | ACCURATE — field declaration |
| 234 | `vpIntraday: { ... } \| null` | ACCURATE — field declaration |
| 359-367 | "vwapAvailable reflects whether sessionVwap() returned a non-null final value" | ACCURATE — FIXED in A0.2.1 |
| 403-407 | "Whether vpIntraday is null is a numeric outcome; it is not asserted here as a provenance guarantee" | ACCURATE — FIXED in A0.2 |
| 533,538 | `vwapAvailable`, `vpIntraday` field assignments | ACCURATE |
| 688 | (buildContext) "zero, so sessionVwap returns null…" | ACCURATE — numeric description |
| 709 | "cash indices with structural zero candle volume" | DETECTION ENGINE — outside helper scope; deferred |
| 726 | "Index spot candles carry zero volume" | DETECTION ENGINE — deferred |
| 785,793 | "Above POC", "Below POC" driver logic | ACCURATE — VP detector labels |
| 849 | "apparent cross would be fabricated from HLC3. Hard-suppress." | ACCURATE — guard rationale |
| 1133 | "cash indices with zero candle volume" | DETECTION ENGINE — deferred |
| 1157 | "Index spot candles carry zero volume" | DETECTION ENGINE — deferred |

**`fetchKiteIndexCandles.ts` matches:**
| Line | Text (truncated) | Classification |
|------|-----------------|----------------|
| 27 | "fall back to HLC3 or any price-only substitute (that was the old buggy" | ACCURATE — explicitly says we do NOT do this |
| 63-118 | `fallbackToken` | UNRELATED — instrument master lookup |
| 266-267 | "for zero-volume bars (no HLC3 fallback)" | ACCURATE — FIXED in A0.2 |

---

## §11 §26 — Test-Count Reconciliation

### Reconciliation Table

| File | A0.1 baseline `4af42c1f` grep/runner | After A0.2 `05334bd` grep/runner | After A0.2.1 delta grep/runner |
|------|--------------------------------------|----------------------------------|-------------------------------|
| `indicators.test.ts` | 65 / 73† | 93 / 101 | **102 / 110** |
| `optionSignals.zeroVolume.test.ts` | 43 / 43 | 43 / 43 | **43 / 43** |
| `confluenceEngine.vwapGuard.test.ts` | 7 / 7 | 7 / 7 | **7 / 7** |
| **Combined** | **115 / 123** | **143 / 151** | **152 / 160** |

†The gap between grep (65) and runner (73) at baseline is explained by the `for...of` loop at line 796 of `indicators.test.ts`:
```typescript
for (const n of [0, 1, 10, 25, 26, 33, 34, 50, 100]) {
    it(`n=${n}: all three arrays have length ${n}`, () => { ... });
}
```
grep counts the `it(` line once; the runner executes it 9 times (9 values of `n`). So: 65 grep − 1 loop-line + 9 loop-executions = **73 runner**.

### A0.2 Addition Detail (28 new test executions, not 30 as previously stated)

| Describe block | New `it()` calls | New runner executions |
|---------------|------------------|-----------------------|
| `sessionVwap — input validation (A0.2)` | 12 | 12 |
| `volumeProfile — input validation (A0.2)` | 12 | 12 |
| `sessionVwap / volumeProfile propagation (§9.3)` | 4 | 4 |
| **A0.2 total** | **28** | **28** |

The "30 new tests" claim in the prior summary was incorrect. The correct count is **28**. There was no "test-file reorganisation" producing additional tests.

### A0.2.1 Addition Detail (9 new test executions)

| Describe block | Change | New runner executions |
|---------------|--------|----------------------|
| `sessionVwap — input validation (A0.2)` | T4 updated (same `it()` count; assertions changed) | 0 net new |
| `sessionVwap — input validation (A0.2)` | 5 contaminated-series `it()` calls added | +5 |
| `volumeProfile — input validation (A0.2)` | T9 comment corrected (same `it()` count) | 0 net new |
| `volumeProfile — input validation (A0.2)` | 4 contaminated-series `it()` calls added | +4 |
| **A0.2.1 total** | | **+9** |

### Arithmetic verification

```
Final runner count = Baseline runner + A0.2 new + A0.2.1 new
indicators.test.ts: 73 + 28 + 9 = 110 ✓  (runner reported 110)
Combined:           123 + 28 + 9 = 160 ✓  (runner reported 160)
```

---

## §12 §27 — Prompt 02 Required Test Matrix Traceability

### §12.1 sessionVwap() — 12 original Prompt 02 cases

| # | Required test | Test name (file: indicators.test.ts) | Added/Pre-existing | Contract proved |
|---|--------------|--------------------------------------|--------------------|----------------|
| 1 | negative volume → all unavailable | "negative volume: every bar returns null..." | A0.2 (new) | pre-scan returns all-null when `vol < 0` |
| 2 | NaN volume → all unavailable | "NaN volume: every bar returns null..." | A0.2 (new) | pre-scan returns all-null when `!isFinite(NaN)` |
| 3 | Infinity volume → all unavailable | "Infinity volume: every bar returns null..." | A0.2 (new) | pre-scan returns all-null when `!isFinite(Infinity)` |
| 4 | non-finite OHLC → all unavailable | "non-finite OHLC: any bar with NaN high/low/close fails the entire session closed (A0.2.1)" | A0.2 then updated A0.2.1 | pre-scan returns all-null when `!isFinite(typ)` |
| 5 | all-non-finite OHLC → all unavailable | "all-non-finite OHLC: every bar returns null" | A0.2 (new) | all bars have NaN typ → all-null |
| 6 | mismatched lengths (vol shorter) → all-null | "mismatched array lengths (volume shorter)..." | A0.2 (new) | length guard returns all-null |
| 7 | mismatched lengths (high shorter) → all-null | "mismatched array lengths (high shorter)..." | A0.2 (new) | length guard returns all-null |
| 8 | mixed zero and positive volume | "mixed zero and positive valid volume: zero-volume bars contribute zero weight; profile valid" | A0.2 (new) | zero bars stay null until positive vol accumulates |
| 9 | hand-verifiable weighted fixture | "hand-verifiable positive fixture: VWAP = Σ(typ_i × vol_i) / Σ(vol_i)" | A0.2 (new) | VWAP math verified: out[0]=100, out[1]=106 |
| 10 | all-zero vol not HLC3/close/spot | "all-zero volume does NOT return HLC3, close, or spot (A0.2 explicit contract)" | A0.2 (new) | explicit null ≠ hlc3 ≠ close[0] assertion |
| 11 | determinism | "determinism: identical input produces identical output" | A0.2 (new) | r1 deepEquals r2 |
| 12 | input non-mutation | "input arrays are not mutated" | A0.2 (new) | arrays unchanged after call |

### §12.2 sessionVwap() — 5 contaminated-series cases (A0.2.1, §6.2 required)

| # | Required test | Test name | Result | Contract proved |
|---|--------------|-----------|--------|----------------|
| CS-1 | positive volumes with one negative middle bar → all unavailable | "contaminated series: one negative-volume middle bar → all positions unavailable (fail closed)" | all-null ✓ | pre-scan catches vol=-1 at bar 1; final value null |
| CS-2 | positive volumes with one NaN middle bar → all unavailable | "contaminated series: one NaN-volume middle bar → all positions unavailable (fail closed)" | all-null ✓ | pre-scan catches vol=NaN at bar 1 |
| CS-3 | positive volumes with one Infinity middle bar → all unavailable | "contaminated series: one Infinity-volume middle bar → all positions unavailable (fail closed)" | all-null ✓ | pre-scan catches vol=Infinity at bar 1 |
| CS-4 | valid volume with one NaN OHLC middle bar → all unavailable | "contaminated series: one NaN OHLC middle bar → all positions unavailable (fail closed)" | all-null ✓ | pre-scan catches NaN OHLC at bar 1 |
| CS-5 | invalid middle bar; final bar still unavailable | "contaminated series: invalid middle bar — final bar value is still unavailable (no resume after contamination)" | result[3]=null ✓ | 4-bar window; bar 1 negative; ALL positions null including last |

### §12.3 volumeProfile() — 12 original Prompt 02 cases

| # | Required test | Test name | Added/Pre-existing | Contract proved |
|---|--------------|-----------|--------------------|----|
| 1 | negative volume → null | "negative volume: returns null (all negative → total usable vol = 0)" | A0.2 (new) | pre-scan catches `vol < 0` |
| 2 | NaN volume → null | "NaN volume: returns null (NaN bars skipped → total usable vol = 0)" | A0.2 (new) | pre-scan catches `!isFinite(NaN)` |
| 3 | Infinity volume → null | "Infinity volume: returns null (Infinity bars skipped → total usable vol = 0)" | A0.2 (new) | pre-scan catches `!isFinite(Infinity)` |
| 4 | non-finite OHLC (NaN in low) → null | "non-finite OHLC (NaN in low array): Math.min returns NaN → !isFinite(lo) → null" | A0.2 (new) | pre-scan catches NaN in sliceL[5] |
| 5 | non-finite OHLC (NaN in high) → null | "non-finite OHLC (NaN in high array): Math.max returns NaN → !isFinite(hi) → null" | A0.2 (new) | pre-scan catches NaN in sliceH[2] |
| 6 | mismatched lengths (vol-1) → null | "mismatched array lengths (volume shorter by 1)..." | A0.2 (new) | length guard |
| 7 | mismatched lengths (high-2) → null | "mismatched array lengths (high shorter)..." | A0.2 (new) | length guard |
| 8 | non-positive price range → null | "non-positive price range (all-same OHLC: hi === lo)..." | A0.2 (new) | `hi <= lo` guard |
| 9 | mixed zero and positive volume | "mixed zero and positive valid volume: zero-volume bars contribute zero weight; profile valid" | A0.2 (new; updated A0.2.1) | zero-vol bars permitted (pre-scan allows vol=0) |
| 10 | valid positive fixture VAL/POC/VAH | "valid positive-volume: VAL <= POC <= VAH, all within [min(L10), max(H10)]" | A0.2 (new) | ordering and range guarantees |
| 11 | determinism | "determinism: identical input produces identical result" | A0.2 (new) | r1 deepEquals r2 |
| 12 | input non-mutation | "input arrays are not mutated" | A0.2 (new) | arrays unchanged after call |

### §12.4 volumeProfile() — 4 contaminated-series cases (A0.2.1, §6.1 required)

| # | Required test | Test name | Result | Contract proved |
|---|--------------|-----------|--------|----------------|
| CS-1 | positive volumes with one negative middle bar → null | "contaminated series: one negative-volume middle bar → null (fail closed)" | null ✓ | pre-scan catches V10[5]=-1 at bar 5 of 10 |
| CS-2 | positive volumes with one NaN middle bar → null | "contaminated series: one NaN-volume middle bar → null (fail closed)" | null ✓ | pre-scan catches V10[5]=NaN |
| CS-3 | positive volumes with one Infinity middle bar → null | "contaminated series: one Infinity-volume middle bar → null (fail closed)" | null ✓ | pre-scan catches V10[5]=Infinity |
| CS-4 | valid volume with one NaN OHLC middle bar → null | "contaminated series: one NaN-close middle bar → null (fail closed)" | null ✓ | pre-scan catches C10[5]=NaN |

### §12.5 Propagation cases — 7 required (§7 of prompt)

| # | Propagation assertion | Test name | Result |
|---|----------------------|-----------|--------|
| 1 | zero-vol index candles → `vp === null` | "§9.3.1 zero-volume series: vp (volumeProfile) returns null…" | null ✓ |
| 2 | zero-vol index candles → final `vwapRaw === null` | "§9.3.2 zero-volume series: sessionVwap last value (vwapRaw) is null" | null ✓ |
| 3 | `vwapAvailable === false` | "§9.3.3 zero-volume series: vwapAvailable derived from vwapRaw is false" | false ✓ |
| 4 | contaminated candles fail closed at caller-visible value | CS-5 sessionVwap (result[3]=null) + CS-4 volumeProfile | null ✓ |
| 5 | no POC/VAH/VAL directional driver emitted | "§9.3.1" + S52-BULLISH/S53-BEARISH in zeroVolume test | ✓ (vp=null → no VP drivers) |
| 6 | no "Spot above/below VWAP", "VWAP reclaim" positive driver | G-RESULT-BOUNDARY in zeroVolume test | ✓ (vwapAvailable=false gating) |
| 7 | valid positive-volume non-index path retains behavior | "§9.3.7 valid positive-volume non-index series retains correct behaviour" | non-null ✓ |

### §12.6 A0.1 non-regression cases (unchanged, all pass)

| Test file | Test count | All pass |
|-----------|-----------|---------|
| `confluenceEngine.vwapGuard.test.ts` | 7 | ✓ |
| `optionSignals.zeroVolume.test.ts` | 43 | ✓ |
| A0.1 guards in `indicators.test.ts` (zero-volume guard sections) | 11 | ✓ |

---

## §13 §28 — Final Delta Diff and Scope Proof

### Files changed (A0.2.1 delta vs HEAD `05334bd9`)

```
git diff --stat HEAD:
 artifacts/api-server/src/lib/indicators.test.ts | 102 +++++++++++++++++++++---
 artifacts/api-server/src/lib/indicators.ts      |  64 ++++++++++-----
 artifacts/api-server/src/lib/optionSignals.ts   |  25 +++---
 3 files changed, 150 insertions(+), 41 deletions(-)
```

`git diff --check HEAD`: CLEAN (no whitespace errors)

### File classification

| File | Classification |
|------|---------------|
| `indicators.ts` | AUTHORISED indicator contract (fail-closed pre-scan + JSDoc) |
| `indicators.test.ts` | AUTHORISED test (T4 updated; 9 contaminated-series tests added) |
| `optionSignals.ts` | AUTHORISED structural comment (D-FAB-02 interface JSDoc + buildContext) |
| `fetchKiteIndexCandles.ts` | Committed in A0.2 — not in this delta |
| `PHASE_A0_2_INDICATOR_AVAILABILITY.md` | AUTHORISED evidence |

Acceptance checklist:
- Zero unrelated production changes ✓
- Zero threshold/weight/strategy/risk changes ✓
- Zero weakening of A0.1 ✓
- No formatting-only churn outside touched blocks ✓

---

## §14 Test Run Evidence — A0.2.1 Final

### Individual files

```
indicators.test.ts (standalone):
  Test Files  1 passed (1)
  Tests       110 passed (110)
  Start at    10:28:19 / Duration 688ms

optionSignals.zeroVolume.test.ts (standalone):
  Test Files  1 passed (1)
  Tests       43 passed (43)
  Start at    10:28:21 / Duration 6.22s

confluenceEngine.vwapGuard.test.ts (standalone):
  Test Files  1 passed (1)
  Tests       7 passed (7)
  Start at    10:28:28 / Duration 206ms
  Note: line 43 `detail.toMatch(/zero volume/i)` — A0.1 VWAP numeric-condition assertion; UNTOUCHED
```

### Combined runs

```
Normal order (indicators → zeroVolume → vwapGuard):
  Test Files  3 passed (3)
  Tests       160 passed (160)
  Duration    3.87s

Reverse order (vwapGuard → zeroVolume → indicators):
  Test Files  3 passed (3)
  Tests       160 passed (160)
  Duration    2.94s
```

No skipped, todo, only, or flaky tests. Zero test-order sensitivity.

---

## §15 Typecheck Evidence

```
$ pnpm run typecheck
[full workspace: all 5 artifact typecheck tasks]
artifacts/api-server typecheck: Done
artifacts/global typecheck: Done
artifacts/scanner typecheck: Done
artifacts/mockup-sandbox typecheck: Done
scripts typecheck: Done
Exit code: 0 — zero errors
```

---

## §16 A0.1 Guard Integrity

All A0.1 boundaries are confirmed untouched:

| Guard | Status |
|-------|--------|
| `confluenceEngine.ts` — `isIndexFno` required field (compile-time) | UNTOUCHED |
| `confluenceEngine.ts` — `scoreVolumeProfile` returns weight=0 when `isIndexFno=true` | UNTOUCHED |
| `optionSignals.ts` — call site passes `vp: null, isIndexFno: true` | UNTOUCHED |
| `confluenceEngine.vwapGuard.test.ts` line 43 — `/zero volume/i` | UNTOUCHED |
| `optionSignals.zeroVolume.test.ts` — 43 A0.1 tests | ALL PASS |

---

## §17 End-to-End Propagation Proof

Using real functions (not mocks):

1. `volumeProfile(n=30, vol=[0,…0]) → null` ✓ (§9.3.1)
2. `sessionVwap(vol=[0,0,0])` last element `→ null` ✓ (§9.3.2)
3. `vwapAvailable = (null !== null) = false` ✓ (§9.3.3)
4. `sessionVwap(vol=[200,-1,300,400])` → `[null,null,null,null]` ✓ (CS-5)
5. `buildSignalsForIndex` emitted signals have no VP driver in `signal.drivers` ✓ (G-RESULT-BOUNDARY)
6. No "Spot above/below VWAP", "VWAP reclaim" driver labels in emitted signals ✓ (G-RESULT-BOUNDARY)
7. No placeholder object replaces null VP/VWAP ✓ (`vp: null` passed through; `vwap: spot` is explicit geometric placeholder, flagged `vwapAvailable=false`)
8. `isIndexFno === true` and `vp === null` on every `scoreConfluence` call ✓ (B-CALLER, C-CALLER, D-SENTINEL, F-ALL)
9. Positive-volume non-index path retains correct behavior ✓ (§9.3.7)

Source-text supplement only; all 9 assertions above are backed by behavioral test execution.

---

## §18 Outstanding Governance Exceptions

| Exception | Phase introduced | Status |
|-----------|----------------|--------|
| No-VWAP TREND_CONTINUATION dead lane (D-FAB-04) | A0.1 | Carry-forward to A0.3; tested/quarantined |

No new governance exceptions introduced in A0.2 or A0.2.1.

---

## §19 Defect Status Summary

| Defect | Status |
|--------|--------|
| D-FAB-01 / FX-01 | **UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION** — fail-closed pre-scan; contaminated-series tests pass |
| D-FAB-02 / FX-02 | **UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION** — all 7 prose locations corrected; detector-level deferred |
| D-FAB-03 | Closed in A0.1 |
| D-FAB-04 | Closed in A0.1 (quarantine) |
| D-FAB-05 / FX-05 | **UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION** — fail-closed pre-scan; contaminated-series tests pass |

---

## §20 Git / Checkpoint State

```
Branch:        main
Committed A0.2:  05334bd9bb2f31743bab62683f0eb0995cfd6f6a
A0.2.1 working tree: 3 files modified, NOT committed (no git add/commit/push)
Upstream:      origin/main (20 ahead / 0 behind at A0.2.1 entry)
A0.1 ancestor: 4af42c1f5bb6f9a6e9bea7c6e6379e53c4e1e7d0 CONFIRMED
PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED
```

---

## §21 Acceptance State

```
OVERALL VERDICT:  ACCEPT_A0_2_AS_UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION

D-FAB-01 / FX-01: UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION
D-FAB-02 / FX-02: UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION
D-FAB-05 / FX-05: UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION

GOVERNANCE_EXCEPTION: No-VWAP TREND_CONTINUATION dead lane (D-FAB-04 carry-forward to A0.3)
GIT_COMMIT_STATUS:    NOT_COMMITTED (working tree only — no git add/commit/push)
PUBLISH_STATUS:       NOT_STARTED
PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED
```

---

END OF PHASE A0.2 INDICATOR AVAILABILITY RECORD
