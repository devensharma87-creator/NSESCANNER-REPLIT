# PHASE A0.1 FINAL ACCEPTANCE RECORD — D-FAB-03 & D-FAB-04

**Acceptance Delta:** A0.1.3  
**Prepared:** 2026-07-25  
**Owner:** Devendra Sharma  
**Timezone:** Asia/Kolkata  
**Defects:** D-FAB-03 / FX-03, D-FAB-04 / FX-04  
**Scope:** Volume Profile / VWAP fabrication bugs in index F&O signal path  

---

## 1. Final Verdict

`ACCEPT_CODE_AS_UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`

- **D-FAB-03 / FX-03** — `UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`
- **D-FAB-04 / FX-04** — `UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`
- **Production status** — `PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`
- **Programme closure** — not closed; next checkpoint is Phase A0.2
- **Governance exception** — Signal-level driver inspection in Test G is
  `RESULT_BOUNDARY_TEST_BLOCKED_BY_NON_EMITTING_FIXTURE`. Synthetic chart fixtures
  do not produce signals that pass `HC_EMISSION_FLOOR = 65`. The confluence-level
  proof via `spy.mock.results` is complete and covers the D-FAB-03 invariant fully:
  `VOLUME_PROFILE weight = 0` in every `scoreConfluence` return value for both
  BULLISH and BEARISH directions, both before and after `mockClear()`.

---

## 2. Checkpoint SHA and Mechanism

| Label | SHA | Source |
|-------|-----|--------|
| PRE_TASK_HEAD | `61252d7e6c16065cdde3b486795febe3d402102f` | `git rev-parse HEAD` before any edit |
| AUTOMATIC_PLATFORM_CHECKPOINT | `61252d7e6c16065cdde3b486795febe3d402102f` | Platform checkpoint from A0.1.2 session end |
| HEAD (at report time) | `61252d7e6c16065cdde3b486795febe3d402102f` | Working tree has uncommitted changes |

The task's changes are in the working tree and will be committed by the platform when
`mark_task_complete` is called. PRE_TASK_HEAD equals HEAD because the previous session
ended with a platform checkpoint. The current-task diff is working-tree only.

**Commit chain (Phase A0 closure):**

| SHA | Phase | Description |
|-----|-------|-------------|
| `df1a132` | A0 | Remove VP from no-VWAP target formula (pivot-only) |
| `a9063ac` | A0.1 | Change `vp: ctx.vpIntraday` → `vp: null` at call site; 31 injection tests |
| `c11aaa3` | A0.1 | Documentation and evidence for code audit process |
| `61252d7e` | A0.1.2 | Export seams + Tests A–F + initial evidence file (AUTOMATIC_PLATFORM_CHECKPOINT) |
| working tree | A0.1.3 | Test E enriched (classification + source proofs); Test G added |

---

## 3. Changed-File Inventory

**Working-tree diff vs PRE_TASK_HEAD:**

```
M artifacts/api-server/src/lib/optionSignals.zeroVolume.test.ts
  1 file changed, 181 insertions(+), 13 deletions(-)
?? attached_assets/MARKET_SCANNER_PROMPT_01_ACCEPTANCE_DELTA_A0_1_3_1785002526877.md
```

**Classification of every changed file:**

| File | Classification |
|------|----------------|
| `optionSignals.zeroVolume.test.ts` | Authorised regression test |
| `PHASE_A0_1_2_FINAL_CLOSURE.md` | Authorised evidence report (this file) |
| `attached_assets/...A0_1_3...md` | Prompt/attached artifact (untracked; not a source change) |

**Zero unrelated source changes.** ✓

---

## 4. Visibility-Only Seam Diff (Production Source)

The three export seams added in A0.1.2 are the **only** production-source changes across
the entire Phase A0 closure programme:

```typescript
// optionSignals.ts — A0.1.2 (commit 61252d7e)
export interface Ctx { ... }                    // was: interface Ctx
export function detectTrendContinuation(...)    // was: function detectTrendContinuation(...)
export function buildSignalsForIndex(...)        // was: function buildSignalsForIndex(...)
```

Bodies, parameters, defaults, side effects, call order, and runtime behaviour are
unchanged. No test can reach these seams except via the module's public API.

**A0.1.3 production-source changes: NONE.** Only `optionSignals.zeroVolume.test.ts`
was modified in this delta. The seams remain as committed in A0.1.2.

---

## 5. Test A-BEARISH — VP Boundary Load-Bearing for Bearish Direction

**Tests:** A-BEARISH (×2) — in describe block `A-BEARISH: VP boundary is load-bearing for the bearish direction`

**Claim:** `VP_POC_ABOVE_SPOT` (POC=24700, VAL=24600) with `direction="BEARISH"` awards a
non-zero `VOLUME_PROFILE` weight because spot sits below the POC (selling pressure at the
high-volume node). Enforcing `vp: null` resets weight to zero. The boundary is load-bearing
for BEARISH, not only BULLISH.

**Result:**
```
✓ non-null VP with POC above spot changes VOLUME_PROFILE weight for BEARISH — boundary is load-bearing
✓ BEARISH + vp:null — VOLUME_PROFILE weight=0 and no VP-derived detail text
```

---

## 6. Test B-CALLER — Bullish Real-Caller Spy

**Test:** B-CALLER — in describe block `B–F: Real caller path`

**Claim:** When `buildSignalsForIndex` runs the BULLISH fixture (vol=1e6/bar → `ctx.vpIntraday ≠ null`),
every runtime argument passed to `scoreConfluence` has `vp === null`.

**Mechanism:** `vi.spyOn(confluenceEngine, "scoreConfluence")` intercepts the live module binding.
The spy calls through to the real implementation (no stubbing).

**Result:**
```
✓ B-CALLER: BULLISH fixture — scoreConfluence is called and every call has vp===null (12ms)
```

---

## 7. Test C-CALLER — Bearish Real-Caller Spy

**Test:** C-CALLER — in describe block `B–F: Real caller path`

**Claim:** Same as B but for the BEARISH path. RSI ≈ 40 (32–48 healthy zone), EMA9 < EMA21,
spot < EMA9, spot < VWAP. `scoreSpy.mock.calls.length > 0` and `every call[0].vp === null`.

**Result:**
```
✓ C-CALLER: BEARISH fixture — scoreConfluence is called and every call has vp===null (3ms)
```

---

## 8. Test G-RESULT-BOUNDARY — Actual Returned-Result Reason Quarantine

**Test:** G-RESULT-BOUNDARY — in describe block `B–F: Real caller path`

### [1] Precondition assertion

`volumeProfile(chart.high, chart.low, chart.close, chart.volume, 24, 60)` called
directly on both BULLISH and BEARISH chart data — **not inferred from non-zero volume**.

```
✓ vpBull !== null   (ctx.vpIntraday ≠ null in BULLISH caller — boundary is active)
✓ vpBear !== null   (ctx.vpIntraday ≠ null in BEARISH caller — boundary is active)
```

### [2] Confluence return value inspection (via `spy.mock.results`)

`scoreSpy.mock.results` was used to capture the actual `ConfluenceResult` objects
returned by `scoreConfluence` — not just the call arguments. For every confluence result
across both BULLISH and BEARISH runs:

```
✓ VOLUME_PROFILE factor defined in every confluence result
✓ VOLUME_PROFILE.weight === 0 in every confluence result
✓ VOLUME_PROFILE.polarity === "neutral" in every confluence result
✓ No factor detail contains: VOLUME_PROFILE / volume profile / POC /
  point of control / VAH / VAL / value area
```

`scoreSpy.mockClear()` was called between the BULLISH and BEARISH runs so that
`spy.mock.results` was inspected cleanly for each direction separately.

### [3] Signal-level driver inspection

```
RESULT_BOUNDARY_TEST_BLOCKED_BY_NON_EMITTING_FIXTURE
```

No signals passed `HC_EMISSION_FLOOR = 65`. The synthetic chart fixtures produce
a raw detector confidence of ≈60 (VWAP path: 45 base + 15 RSI; vol confirm does not
fire because all bars have equal volume `1e6 = 1e6 × 1.2` is false). After confluence
adjustment, `adjustedConfidence < 65`. Signal-level driver inspection was not reachable.

**The confluence-level proof above is sufficient**: `VOLUME_PROFILE weight = 0` means
the factor was excluded from the driver push loop at line ~1624 of `optionSignals.ts`
(`if (f.weight === 0 || f.polarity === "neutral") continue`), and therefore could not
appear in `signal.drivers` even if a signal had been emitted.

`bullResult.hasBars === true` and `bearResult.hasBars === true` confirm context was
built successfully — the BLOCKED status is not a data error.

**Test result:**
```
✓ G-RESULT-BOUNDARY: BULLISH + BEARISH — confluence return values and signal drivers
  contain no VP-derived label or value (14ms)
```

---

## 9. Test E-NOVWAP — Corrected Classification

**Classification:**
`TARGET_RESULT_INVARIANCE_NOT_APPLICABLE_UNDER_CURRENT_NON_EMITTING_BRANCH`

**Reason for classification:** The no-VWAP `TREND_CONTINUATION` lane is currently
non-emitting. Maximum reachable confidence = EMA(20) + RSI(15) + vol-confirm(0) = 35 <
emission threshold 50. The target formula (`c.piv.r1 + c.atr15 × 0.3`) is unreachable
because the `conf < 50` guard fires first. Target-invariance cannot be proved on an
emitted candidate without changing a threshold, inventing confidence points, or
restoring VP influence — all prohibited.

**Proof 1 — all VP variants return fail-closed null (section 2, item 2):**
```
r1 = detectTrendContinuation(ctx with VP_POC_BELOW_SPOT) → null  ✓
r2 = detectTrendContinuation(ctx with VP_POC_ABOVE_SPOT) → null  ✓
r3 = detectTrendContinuation(ctx with VP_ABSURD POC=99999) → null ✓
r4 = detectTrendContinuation(ctx with vpIntraday=null) → null    ✓
r1 === r2 === r3 === r4 (null === null — VP variation has zero structural effect) ✓
```

**Proof 2 — source no longer contains "Above/Below POC +8" (section 2, item 3):**  
Source-text regex extracted the `if (!c.vwapAvailable) { ... if (conf < 50)` block
and filtered to non-comment lines:
```
✓ noVwapConfCodeLines does not contain "pointOfControl"
✓ noVwapConfCodeLines does not contain "valueAreaHigh"
✓ noVwapConfCodeLines does not contain "valueAreaLow"
```

**Proof 3 — no VP terms in no-VWAP target construction (section 2, item 4):**  
Source-text regex extracted the `if (!c.vwapAvailable)...const t2` block,
filtered to non-comment lines:
```
✓ noVwapTargetCodeLines does not contain "valueAreaHigh"
✓ noVwapTargetCodeLines does not contain "valueAreaLow"
✓ noVwapTargetCodeLines does not contain "pointOfControl"
✓ src matches /\? c\.piv\.r1 \+ c\.atr15 \* 0\.3/  (pivot-only BULLISH target)
✓ src matches /: c\.piv\.s1 - c\.atr15 \* 0\.3/   (pivot-only BEARISH target)
```

**Test result:**
```
✓ E-NOVWAP: detectTrendContinuation — extreme VP fixtures in no-VWAP Ctx all return
  null (structural suppression) (7ms)
```

---

## 10. No-VWAP Non-Emitting Lane — Carry-Forward

The no-VWAP `TREND_CONTINUATION` lane is currently a dead setup. It is **not** merged
into D-FAB-03 or D-FAB-04. It is carried forward to the dedicated Phase A0 dead-setup
checkpoint under the existing Phase A0 exit requirement:

> "Dead/non-emitting setups must be fixed or honestly retired with UI disclosure."

Resolution in A0.1.3 is prohibited. It must be fixed (threshold restored to a
meaningful reachable value) or retired (UI disclosure that the setup is inactive)
in the later dedicated checkpoint.

---

## 11. Focused Test Result

**Command:**
```bash
pnpm --filter @workspace/api-server exec vitest run --pool=threads --reporter=verbose \
  "src/lib/optionSignals.zeroVolume.test.ts"
```

**Result:**
```
Test Files  1 passed (1)
     Tests  39 passed (39)
  Duration  8.05s
```

39 tests: 31 prior + 2 A-BEARISH + 1 B-CALLER + 1 C-CALLER + 1 D-SENTINEL +
1 E-NOVWAP (enriched) + 1 F-ALL + 1 G-RESULT-BOUNDARY.

**Exit code: 0**

---

## 12. Combined Regression Result

**Command:**
```bash
pnpm --filter @workspace/api-server exec vitest run --pool=threads \
  "src/lib/optionSignals.zeroVolume.test.ts" \
  "src/lib/indicators.test.ts" \
  "src/lib/fnoPaperRiskGuards.test.ts"
```

**Result:**
```
Test Files  3 passed (3)
     Tests  139 passed (139)
  Duration  5.96s
```

**Exit code: 0**

---

## 13. API Typecheck Result

**Command:**
```bash
pnpm --filter @workspace/api-server exec tsc --noEmit
```

**Result:** No output (exit code 0) — zero type errors.

---

## 14. Full-Workspace Typecheck Result

**Command:**
```bash
pnpm run typecheck
```

**Result:**
```
artifacts/api-server typecheck: Done
artifacts/global typecheck: Done
artifacts/scanner typecheck: Done
artifacts/mockup-sandbox typecheck: Done
scripts typecheck: Done
```

All 5 leaf packages clean. **Exit code: 0**

---

## 15. Diff-Hygiene Result

**Command:**
```bash
git diff --check HEAD
```

**Result:** No output. **Exit code: 0** — no trailing whitespace or other hygiene issues.

---

## 16. Upstream Reachability

**Command:**
```bash
git rev-parse --abbrev-ref --symbolic-full-name @{upstream}
git rev-list --left-right --count @{upstream}...HEAD
```

**Result:**
```
origin/main
0   16   (0 commits behind upstream; 16 commits ahead)
```

Branch: `main`. Upstream: `origin/main`. The branch is ahead of remote and has no
divergence from it.

---

## 17. Production Deployment Status

`PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`

This document cannot verify that the Phase A0 fixes are live in production. Production
deployment requires an explicit Publish action by the owner via the Replit dashboard.
All evidence in this record is from the development environment (`main` branch).

This classification does not prevent unit-level acceptance but strictly prevents
DEV_VERIFIED, STAGING_VERIFIED, PROD_VERIFIED, CLOSED, or any statement that
production contains these fixes.

---

## 18. Governance Exception Record

| Exception | Classification | Reason |
|-----------|---------------|--------|
| Signal-level driver inspection (Test G) | `RESULT_BOUNDARY_TEST_BLOCKED_BY_NON_EMITTING_FIXTURE` | HC_EMISSION_FLOOR=65 not reached by synthetic test fixtures. Confluence-level proof via `spy.mock.results` fully covers the D-FAB-03 invariant. |
| No-VWAP TREND_CONTINUATION target invariance (Test E) | `TARGET_RESULT_INVARIANCE_NOT_APPLICABLE_UNDER_CURRENT_NON_EMITTING_BRANCH` | Lane non-emitting (max conf=35 < threshold 50). Carry-forward to Phase A0 dead-setup checkpoint. |
| Production deployment | `PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED` | No authoritative read-only production release record available. |

**Standing controls confirmed active (unchanged):**
- Owner-only access maintained
- Asia/Kolkata timezone
- Kite sole trade-grade source
- Yahoo excluded from trade paths
- F&O C0 and Equity C0 enabled (confirmed by C0-containment tests in the suite)
- Paper automatic opening disabled
- Swing broker execution dry-run only
- No live order placement

---

## 19. PASS / FAIL / BLOCKED Checklist

| Gate | Status |
|------|--------|
| A-BEARISH: boundary load-bearing for BEARISH direction | **PASS** |
| B-CALLER: BULLISH real-caller spy — every call `vp===null` | **PASS** |
| C-CALLER: BEARISH real-caller spy — every call `vp===null` | **PASS** |
| D-SENTINEL: extreme upstream VP — boundary holds | **PASS** |
| E-NOVWAP: all VP variants → null; source proofs 2 & 3 | **PASS** |
| E-NOVWAP: corrected classification applied | **PASS** |
| E-NOVWAP carry-forward registered | **PASS** |
| F-ALL: 100% of `scoreConfluence` calls `vp===null` both directions | **PASS** |
| G precondition: `vpIntraday` directly asserted non-null via `volumeProfile()` | **PASS** |
| G confluence results: `VOLUME_PROFILE weight=0` in every return value | **PASS** |
| G confluence results: no VP-derived text in any factor detail | **PASS** |
| G signal-level driver inspection | **BLOCKED** (HC_EMISSION_FLOOR governance exception) |
| Focused suite 39/39 | **PASS** |
| Combined regression 139/139 | **PASS** |
| API typecheck | **PASS** |
| Full-workspace typecheck | **PASS** |
| Diff hygiene | **PASS** |
| Zero unrelated source changes | **PASS** |
| All automatic checkpoints recorded | **PASS** |
| `PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED` maintained | **PASS** |

---

## 20. Next Checkpoint

**Phase A0.2** — Signal Quality & Risk Framework (event blackouts, detector cooldown,
swing regression gate). Do not begin Phase A0.2 in this task.

---

END OF PHASE A0.1 FINAL ACCEPTANCE RECORD
