# Phase A0.2 — D-FAB-01 / D-FAB-02 / D-FAB-05: Indicator Numeric-Validity Contract
## Acceptance Record

**Programme:** F&O Signal Fabrication Defect Closure  
**Phase:** A0.2 (D-FAB-01, D-FAB-02, D-FAB-05)  
**Precondition:** A0.1 accepted at `UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`; HEAD = `4af42c1f` on entry  
**Working tree status:** Modified (not committed) — 4 files changed; no other tracked file touched  
**Date completed:** 2026-07-27

---

## §1 Scope and Defect Classification

| Defect | Root issue | Status on entry | Fix class |
|--------|-----------|----------------|-----------|
| D-FAB-01 | `volumeProfile()` — `NaN <= 0` is `false`, bypassing total-vol guard; no length check; no per-bar non-finite OHLC/vol guard | PARTIALLY_IMPLEMENTED | Numeric-validity extension |
| D-FAB-02 | Three prose locations claimed provider-level facts the helper functions cannot observe (false "Kite returns vol=0", "HLC3 fallback") | PARTIALLY_IMPLEMENTED | Comment correction only |
| D-FAB-05 | `sessionVwap()` — `volume[i] ?? 0` let negative/NaN/Infinity volume silently accumulate; no length check; no per-bar non-finite OHLC guard | PARTIALLY_IMPLEMENTED | Numeric-validity extension |

Out of scope for this phase: D-FAB-03, D-FAB-04 (closed in A0.1), D-FAB-06, D-FAB-07, D-FKE-05, `rollingVwap`, provider-trust enforcement.

---

## §2 Changed Files

| File | Change type | Net ±lines |
|------|------------|-----------|
| `artifacts/api-server/src/lib/indicators.ts` | Implementation + JSDoc | +81 / -33 |
| `artifacts/api-server/src/lib/indicators.test.ts` | New test blocks (30 tests) | +254 / -3 |
| `artifacts/api-server/src/lib/optionSignals.ts` | Comment correction (D-FAB-02) | +10 / -7 |
| `artifacts/api-server/src/scripts/fetchKiteIndexCandles.ts` | Comment correction + log line (D-FAB-02) | +19 / -17 |

Total: 4 files, 332 insertions, 34 deletions. No other tracked file was modified.

---

## §3 Implementation: D-FAB-05 — sessionVwap()

### Before (defective behaviour)
```typescript
const vol = volume[i] ?? 0;  // NaN → NaN; negative → negative; accumulates silently
const typ = (high[i]! + low[i]! + close[i]!) / 3;
pv += typ * vol;
v += vol;
out[i] = v > 0 ? pv / v : null;
```
No mismatched-length check. NaN/Infinity volume accumulated into `pv` and `v`,
producing a non-null but numerically invalid VWAP.

### After (fixed contract)
New JSDoc: **D-FAB-05 Numeric-validity contract** states:
- Mismatched array lengths → all-null series of `close.length`.
- Non-finite volume (NaN, ±Infinity) or negative volume → bar skipped entirely.
- Non-finite OHLC (NaN typ) → bar skipped entirely.
- Does **NOT** fall back to HLC3, close, spot, or any price-only substitute.

```typescript
// Mismatched lengths: all positions unavailable.
if (high.length !== n || low.length !== n || volume.length !== n) {
  return new Array(n).fill(null);
}
// ...
const vol = volume[i]!;
// Non-finite or negative volume: skip this bar's contribution.
if (!isFinite(vol) || vol < 0) continue;
const typ = (high[i]! + low[i]! + close[i]!) / 3;
// Non-finite OHLC: skip this bar's contribution.
if (!isFinite(typ)) continue;
pv += typ * vol;
v += vol;
out[i] = v > 0 ? pv / v : null;
```

---

## §4 Implementation: D-FAB-01 — volumeProfile()

### Before (defective behaviour)
```typescript
// No mismatched-length guard.
const lo = Math.min(...sliceL);   // NaN if any sliceL bar is NaN
const hi = Math.max(...sliceH);   // NaN if any sliceH bar is NaN
if (hi <= lo) return null;        // NaN <= NaN is FALSE → passes through!
// ...
buckets[idx]! += sliceV[i] ?? 0; // negative/NaN volume accumulated silently
// ...
if (totalVol <= 0) return null;   // NaN <= 0 is FALSE → returns degenerate profile!
```

### After (fixed contract)
New JSDoc: **D-FAB-01 Numeric-validity contract** states:
- Mismatched array lengths → null.
- Non-finite price range → `!isFinite(lo) || !isFinite(hi) || hi <= lo` → null.
- Per-bar: non-finite close or non-finite/negative volume → bar skipped.
- Total vol guard: `!isFinite(totalVol) || totalVol <= 0` → null.

```typescript
// Mismatched lengths: unavailable.
if (high.length !== n || low.length !== n || volume.length !== n) return null;
// ...
// Non-finite price range (NaN from non-finite OHLC) or zero-range: unavailable.
if (!isFinite(lo) || !isFinite(hi) || hi <= lo) return null;
// ...
// Skip bars with non-finite close or non-finite/negative volume.
if (!isFinite(closeVal) || !isFinite(vol) || vol < 0) continue;
// ...
// Return null when total usable volume is zero or non-finite.
if (!isFinite(totalVol) || totalVol <= 0) return null;
```

---

## §5 Implementation: D-FAB-02 — Comment Corrections

Three prose locations corrected. No logic or runtime behaviour changed.

### 5.1 indicators.ts — sessionVwap JSDoc
- **Removed:** "Kite returns volume=0 for every bar" (provider claim)
- **Added:** numeric-validity contract bullet list referencing D-FAB-05
- **Added:** "Provider/provenance trust is not enforced here"
- **Retained:** historical note that HLC3 fallback was removed

### 5.2 indicators.ts — volumeProfile JSDoc (new; was inline comment)
- **Old inline comment:** "Cash indices (NIFTY/BANKNIFTY/SENSEX) always have zero candle volume" — provider claim removed
- **Replaced with:** D-FAB-01 Numeric-validity contract JSDoc block

### 5.3 optionSignals.ts lines 394-401
- **Removed:** "naturally null for those indices" and "Cash-index volume from Kite is 0" — provider provenance claim
- **Added:** clarification that null is a numeric outcome, not a provenance guarantee; defence-in-depth reference to A0.1's `isIndexFno` policy

### 5.4 fetchKiteIndexCandles.ts — file-level block comment (lines 22-32)
- **Removed:** "`sessionVwap` falls back to typical price when volume is 0" — **factually false** (old buggy behaviour)
- **Added:** "`sessionVwap` returns null when cumulative volume is zero — it does NOT fall back to HLC3 or any price-only substitute"

### 5.5 fetchKiteIndexCandles.ts — console.log (line 265)
- **Removed:** "The backtester's session_vwap mirrors the live typical-price fallback" — false claim
- **Added:** "The live sessionVwap returns null for zero-volume bars (no HLC3 fallback)"

---

## §6 Test Coverage: sessionVwap (D-FAB-05) — 11 tests

Added to `describe("sessionVwap — input validation (A0.2)", ...)` in `indicators.test.ts`:

| Test | Contract clause | Expected |
|------|----------------|----------|
| T1: negative volume | negative vol skipped | all-null |
| T2: NaN volume | non-finite vol skipped | all-null |
| T3: Infinity volume | non-finite vol skipped | all-null |
| T4: non-finite OHLC (NaN bar 0) | NaN OHLC bar skipped; subsequent bars valid | out[0]=null, out[1..2]≠null |
| T5: all-non-finite OHLC | all bars skipped | all-null |
| T6: mismatched length (vol shorter) | length mismatch → all-null | all-null |
| T7: mismatched length (high shorter) | length mismatch → all-null | all-null |
| T8: mixed zero and positive volume | only positive-vol bars contribute; zero stays null | out[0..1]=null, out[2]=103 |
| T9: hand-verifiable positive fixture | VWAP = Σ(typ×vol)/Σ(vol) | out[0]=100.0, out[1]=106.0 |
| T10: all-zero vol returns null, not HLC3 | explicit no-fallback assertion | all-null |
| T11: determinism | same input → same output | r1 === r2 |
| T12: no mutation | input arrays unchanged after call | arrays unchanged |

---

## §7 Test Coverage: volumeProfile (D-FAB-01) — 12 tests

Added to `describe("volumeProfile — input validation (A0.2)", ...)` in `indicators.test.ts`:

| Test | Contract clause | Expected |
|------|----------------|----------|
| T1: negative volume | all negative → usable vol=0 → null | null |
| T2: NaN volume | all NaN skipped → usable vol=0 → null | null |
| T3: Infinity volume | all Inf skipped → usable vol=0 → null | null |
| T4: NaN in low array | Math.min=NaN → !isFinite(lo) → null | null |
| T5: NaN in high array | Math.max=NaN → !isFinite(hi) → null | null |
| T6: mismatched length (vol-1) | length check → null | null |
| T7: mismatched length (high-2) | length check → null | null |
| T8: non-positive range (flat OHLC) | hi===lo → hi<=lo → null | null |
| T9: mixed zero and positive vol | positive bars only → valid profile | non-null, valid VAL≤POC≤VAH |
| T10: valid positive fixture | full happy-path | non-null; all in [min(L),max(H)] |
| T11: determinism | same input → same result | r1 deepEqual r2 |
| T12: no mutation | input arrays unchanged | arrays unchanged |

---

## §8 Test Coverage: §9.3 Propagation (D-FAB-01/05 joint) — 4 tests

Added to `describe("sessionVwap / volumeProfile propagation (A0.2 §9.3)", ...)`:

| Test | Assertion |
|------|-----------|
| §9.3.1: zero-vol vp is null | volumeProfile(n=30, vol=0) → null |
| §9.3.2: zero-vol vwapRaw is null | last element of sessionVwap(vol=0) series is null |
| §9.3.3: vwapAvailable=false | null vwapRaw → `vwapAvailable = false` |
| §9.3.7: positive-vol non-index retains correct behaviour | sessionVwap and volumeProfile both non-null on valid equity fixture |

---

## §9 Test Run Evidence

### §9.1 indicators.test.ts (standalone)
```
Test Files  1 passed (1)
Tests       101 passed (101)
Start at    10:00:29
Duration    287ms
```
(Includes: all pre-existing MACD, rollingVwap, and other tests + 30 new A0.2 tests)

### §9.2 optionSignals.zeroVolume.test.ts (standalone)
```
Test Files  1 passed (1)
Tests       43 passed (43)
Start at    10:00:24
Duration    2.73s
```

### §9.3 confluenceEngine.vwapGuard.test.ts (standalone)
```
Test Files  1 passed (1)
Tests       7 passed (7)
Start at    10:00:27
Duration    262ms
```
Note: test line 43 `detail.toMatch(/zero volume/i)` asserts VWAP-unavailability numeric condition
(A0.1 guard); deliberately unchanged in A0.2.

### §9.4 Combined 3-file run (normal order)
```
Test Files  3 passed (3)
Tests       151 passed (151)
Start at    09:59:33
Duration    4.31s
```

### §9.5 Combined 3-file run (reverse order)
```
Test Files  3 passed (3)
Tests       151 passed (151)
Start at    09:59:38
Duration    2.46s
```
No test-order sensitivity detected.

---

## §10 Typecheck Evidence
```
$ pnpm run typecheck
[full workspace — all 5 artifact typecheck tasks]
artifacts/api-server typecheck: Done
artifacts/global typecheck: Done
artifacts/scanner typecheck: Done
artifacts/mockup-sandbox typecheck: Done
scripts typecheck: Done
```
Zero errors. Exit code 0.

---

## §11 Diff Hygiene
```
$ git diff --check HEAD
(no output — DIFF_CHECK_CLEAN)

$ git diff --stat HEAD
 artifacts/api-server/src/lib/indicators.test.ts        | 254 +++++++++++++++
 artifacts/api-server/src/lib/indicators.ts             |  81 +++++--
 artifacts/api-server/src/lib/optionSignals.ts          |  13 +-
 artifacts/api-server/src/scripts/fetchKiteIndexCandles.ts |  18 +-
 4 files changed, 332 insertions(+), 34 deletions(-)
```
No whitespace errors. Exactly 4 files modified. No D-FAB-03/04 guard files (`confluenceEngine.ts`, `confluenceEngine.vwapGuard.test.ts`) were touched.

---

## §12 A0.1 Guard Integrity

The A0.1 boundaries were tested in the combined runs and remain unchanged:

| Guard | Status |
|-------|--------|
| `confluenceEngine.ts` — `isIndexFno` required field (compile-time) | UNTOUCHED |
| `confluenceEngine.ts` — `scoreVolumeProfile` returns weight=0 when `isIndexFno=true` | UNTOUCHED |
| `optionSignals.ts` — call site passes `vp: null, isIndexFno: true` | UNTOUCHED |
| `confluenceEngine.vwapGuard.test.ts` line 43 — `/zero volume/i` assertion | UNTOUCHED |
| `optionSignals.zeroVolume.test.ts` — 43 A0.1 tests | ALL PASS |

---

## §13 False-Prose Audit — Final Status

| Location | Claim removed | Replacement |
|----------|--------------|-------------|
| `indicators.ts` sessionVwap JSDoc | "Kite returns volume=0 for every bar" | D-FAB-05 numeric contract; "Provider/provenance trust is not enforced here" |
| `indicators.ts` volumeProfile | "Cash indices always have zero candle volume" (inline) | D-FAB-01 numeric contract JSDoc |
| `optionSignals.ts` lines 394-401 | "naturally null for those indices"; "Cash-index volume from Kite is 0" | Numeric outcome + isIndexFno defence-in-depth note |
| `fetchKiteIndexCandles.ts` block comment lines 26-32 | "sessionVwap falls back to typical price when volume is 0" (factually false) | "sessionVwap returns null … does NOT fall back to HLC3" |
| `fetchKiteIndexCandles.ts` console.log line 265 | "backtester's session_vwap mirrors the live typical-price fallback" | "live sessionVwap returns null for zero-volume bars (no HLC3 fallback)" |

All five D-FAB-02 false-prose locations resolved. **D-FAB-02 status: CLOSED.**

---

## §14 Carry-Forward from A0.1 (unchanged)

The no-VWAP `TREND_CONTINUATION` dead lane (D-FAB-04 Test E) remains quarantined:
- Max reachable confidence in no-VWAP branch = 43 (below threshold of 50)
- Structural suppression is intentional and tested (S-E in zeroVolume test suite)
- Resolution deferred to A0.3

---

## §15 Outstanding Governance Exceptions

| Exception | Phase introduced | Status |
|-----------|----------------|--------|
| No-VWAP TREND_CONTINUATION dead lane | A0.1 | Carry-forward to A0.3; tested/quarantined |

No new governance exceptions introduced in A0.2.

---

## §16 Defect Status Summary

| Defect | Status |
|--------|--------|
| D-FAB-01 | **CLOSED** — numeric-validity contract enforced in `volumeProfile()` |
| D-FAB-02 | **CLOSED** — all five false-prose locations corrected |
| D-FAB-03 | Closed in A0.1 |
| D-FAB-04 | Closed in A0.1 (quarantine) |
| D-FAB-05 | **CLOSED** — numeric-validity contract enforced in `sessionVwap()` |

---

## §17 Acceptance State

```
ACCEPT_A0_2_AS: UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION
EXCEPTION_DETAIL: No-VWAP TREND_CONTINUATION dead lane (D-FAB-04 carry-forward to A0.3)
COMMIT_STATUS: NOT_COMMITTED (working tree only — no git add/commit/push)
PUBLISH_STATUS: NOT_STARTED
```

---

END OF PHASE A0.2 INDICATOR AVAILABILITY ACCEPTANCE RECORD
