# MARKET SCANNER BY DEV
# PROMPT 02 — ACCEPTANCE DELTA A0.2.1
## Fail-Closed Contaminated-Series Semantics, Test-Count Reconciliation, and Final Evidence

**Owner:** Devendra Sharma
**Timezone:** Asia/Kolkata
**Platform:** `marketscannerbydev.in`
**Parent task:** Prompt 02 — Phase A0.2 Indicator Availability
**Accepted predecessor:** Phase A0.1 checkpoint `4af42c1f5bb6f9a6e9bea7c6e6379e53c4e1e7d0`
**Defects under review:** `D-FAB-01 / FX-01`, `D-FAB-02 / FX-02`, `D-FAB-05 / FX-05`
**Current Phase A0.2 status:** `IMPLEMENTED_UNVERIFIED`
**Production status:** `PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`
**Deployment/publish/push:** Prohibited

---

## 1. PURPOSE

Do not start Phase A0.3.

The Phase A0.2 completion summary is promising, but it is not yet acceptable. It contains two material inconsistencies that must be resolved from the actual repository:

1. it says non-finite/negative-volume and non-finite-price bars are **skipped**;
2. Prompt 02 requires contaminated required input to **fail closed**, not to be silently discarded while the remaining bars produce a valid-looking indicator.

It also reports:

- `indicators.test.ts` — 101 tests;
- `optionSignals.zeroVolume.test.ts` — 43 tests;
- `confluenceEngine.vwapGuard.test.ts` — 7 tests;
- combined — 151 tests;
- “30 new tests.”

Those figures require an exact reconciliation against the pre-task baseline. A passing total is not a substitute for explaining which tests were added, removed, renamed, parameter-expanded, or moved.

This is a narrow correction-and-acceptance task. Preserve correct Phase A0.2 work. Change only what repository evidence proves remains non-compliant.

---

## 2. NON-NEGOTIABLE SCOPE

Allowed:

- inspect the current Phase A0.2 implementation, tests, evidence record, and Git state;
- correct fail-closed behavior for `volumeProfile()` and `sessionVwap()`;
- add or strengthen narrowly missing tests;
- correct incomplete or inaccurate Phase A0.2 evidence;
- record an unavoidable platform checkpoint.

Prohibited:

- reopening or weakening Phase A0.1;
- changing `isIndexFno: boolean`, the index-F&O engine VP guard, or `vp: null`;
- starting `D-FAB-06`, `D-FAB-07`, `D-FKE-05`, Phase A0.3, or any later phase;
- changing strategies, thresholds, confidence floors, weights, setups, targets, stops, sizing, risk, cooldowns, market hours, or session definitions;
- provider integration or precedence redesign;
- API/UI redesign;
- operational database use;
- environment or secret mutation;
- live market/broker calls;
- orders;
- `git add`, `git commit`, `git push`, rebase, amend, reset, revert, or cherry-pick;
- deployment or publication.

Preserve:

- owner-only operation;
- Asia/Kolkata;
- Kite as sole trade-grade source;
- Upstox compare-only;
- IndianAPI research/fundamentals-only;
- Yahoo excluded from trade paths;
- F&O C0 and Equity C0 enabled;
- paper automatic opening disabled/blocked;
- swing broker path dry-run only;
- live execution unauthorised.

---

## 3. STAGE 0 — EXACT CURRENT STATE

Before editing, return literal output for:

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git remote -v
git rev-parse --abbrev-ref --symbolic-full-name @{upstream}
git rev-list --left-right --count @{upstream}...HEAD
git merge-base 4af42c1f5bb6f9a6e9bea7c6e6379e53c4e1e7d0 HEAD
git log --oneline --decorate -10
```

Then record:

- `PRE_DELTA_HEAD`;
- whether the previous Phase A0.2 changes are committed by an automatic platform checkpoint or remain in the working tree;
- every modified/untracked file;
- whether the accepted A0.1 checkpoint is an ancestor.

If the A0.1 checkpoint is not an ancestor, stop with:

`BLOCKED_BASELINE_DIVERGENCE`

Do not overwrite unrelated user work.

---

## 4. READ BEFORE EDITING

Read completely:

- the original Prompt 02;
- `artifacts/audit-evidence/PHASE_A0_2_INDICATOR_AVAILABILITY.md`;
- `artifacts/api-server/src/lib/indicators.ts`;
- `artifacts/api-server/src/lib/indicators.test.ts`;
- `artifacts/api-server/src/lib/optionSignals.ts`;
- `artifacts/api-server/src/lib/optionSignals.zeroVolume.test.ts`;
- `artifacts/api-server/src/lib/confluenceEngine.ts`;
- `artifacts/api-server/src/lib/confluenceEngine.vwapGuard.test.ts`;
- every `sessionVwap`, `rollingVwap`, and `volumeProfile` call site;
- every Phase A0.2-modified file, including `fetchKiteIndexCandles.ts` if changed.

Do not rely on the earlier completion summary. Quote the current implementation behavior with file and line ranges.

---

## 5. FIRST DECISION — VERIFY WHAT “SKIPPED” MEANS

Classify the current implementation separately for each function:

- `COMPLIANT_FAIL_CLOSED`;
- `INVALID_BAR_SKIPPED_AND_SERIES_CONTINUES`;
- `INVALID_BAR_NULL_BUT_LATER_VALUE_RESUMES`;
- `MIXED_OR_AMBIGUOUS`;
- `BLOCKED`.

For each classification, prove it with:

1. the production source branch;
2. a behavioral test using a **single invalid bar embedded inside otherwise valid positive-volume data**;
3. the last returned value, because that is what may reach context/scoring.

Do not use a fixture in which every bar is invalid. Such a fixture cannot prove that invalid data is not merely skipped.

---

## 6. AUTHORITATIVE FAIL-CLOSED CONTRACT

### 6.1 `volumeProfile()`

For the complete input window, return `null` when any of these is present:

- mismatched required array lengths;
- insufficient warm-up;
- a non-finite required high, low, or close at any position;
- a non-finite volume at any position;
- a negative volume at any position;
- total volume `<= 0`;
- non-finite or non-positive profile price range;
- a non-finite or invalid calculated level.

Zero-volume bars are allowed only when:

- all their other required inputs are finite;
- at least one other bar has positive finite volume;
- total volume is positive.

Forbidden behavior:

- `continue` or another branch that silently removes an invalid/non-finite/negative-volume bar and still returns a profile from the remaining bars;
- replacing invalid volume with zero;
- clamping invalid/negative volume;
- synthetic equal-volume, candle-count, close-frequency, or price-only fallback;
- truncating mismatched arrays.

Required contaminated-series tests:

```text
positive volumes with one negative middle bar       -> null
positive volumes with one NaN middle bar            -> null
positive volumes with one Infinity middle bar       -> null
valid volume with one NaN/Infinity OHLC middle bar  -> null
```

Also retain all original Prompt 02 valid-series, deterministic, range, order, and non-mutation tests.

### 6.2 `sessionVwap()`

Determine the real return type and preserve it. If the function returns a nullable series, “unavailable” means an all-null result of the contractually correct output length for the contaminated input window. Do not allow a later valid bar to resume a valid-looking session VWAP after a required input in that same function call was invalid.

For the complete supplied session/window, fail closed when any of these is present:

- mismatched required array lengths;
- empty input where a result is required;
- a non-finite required high, low, or close at any position;
- a non-finite volume at any position;
- a negative volume at any position;
- cumulative usable volume never becomes positive;
- non-finite weighted numerator or result.

Permitted valid behavior:

- a finite zero-volume bar may contribute zero weight when another bar has positive finite volume;
- before the first positive-volume bar, a cumulative series may remain null;
- once positive volume exists, the function uses the existing authorised typical-price basis and true volume weighting.

Forbidden behavior:

- skipping an invalid/non-finite/negative-volume bar and later resuming a valid-looking VWAP for the same supplied session/window;
- replacing invalid volume with zero;
- returning HLC3, close, spot, cached/previous VWAP, or zero as VWAP;
- silently truncating mismatched arrays.

Required contaminated-series tests:

```text
positive volumes with one negative middle bar       -> all unavailable
positive volumes with one NaN middle bar            -> all unavailable
positive volumes with one Infinity middle bar       -> all unavailable
valid volume with one NaN/Infinity OHLC middle bar  -> all unavailable
invalid middle bar followed by valid final bar       -> final value still unavailable
```

Also retain:

- all-zero input;
- mixed finite zero and positive volume;
- hand-calculated weighted fixture;
- deterministic result;
- input non-mutation;
- no price-only fallback.

If repository structure proves that `sessionVwap()` is always called with exactly one already-sliced trading session, state and prove that fact. Do not redesign session boundaries here.

---

## 7. END-TO-END PROPAGATION

Using real functions and real caller seams, prove:

1. zero-volume index candles produce `vp === null`;
2. zero-volume index candles produce a final `vwapRaw === null`;
3. `vwapAvailable === false`;
4. contaminated index candles also fail closed at the final caller-visible value;
5. no POC/VAH/VAL directional driver is emitted;
6. no “Spot above VWAP,” “Spot below VWAP,” “VWAP reclaim,” or equivalent positive VWAP driver is emitted;
7. no placeholder object/value replaces unavailable VP/VWAP;
8. A0.1 still passes `isIndexFno === true` and `vp === null`;
9. a valid positive-volume non-index path retains its existing behavior.

Source-text assertions may supplement but cannot replace behavioral execution.

---

## 8. D-FAB-02 — COMPLETE PROSE SEARCH

Run a full relevant-tree search before and after editing:

```bash
rg -n -i \
  "naturally null|always null|always.*zero|zero.?volume|HLC3|typical.?price|fallback|vwapAvailable|vpIntraday|point.?of.?control|\\bPOC\\b|\\bVAH\\b|\\bVAL\\b" \
  artifacts/api-server/src --glob '*.ts'
```

For every relevant match, provide:

- file and line;
- whether it is accurate implementation text, inaccurate prose, test text, or unrelated;
- disposition.

Required wording rules:

- indicator helpers document numeric validity only;
- no helper claims it validates Kite/Upstox/IndianAPI provenance;
- no comment claims VP/VWAP is naturally or permanently unavailable because of current provider behavior;
- the index-F&O invariant is stated as explicit policy:
  `isIndexFno` disables VP scoring, with caller `vp: null` as defence in depth;
- do not delete accurate terminology from tests merely to make a search empty.

---

## 9. TEST-COUNT RECONCILIATION

The prior report’s counts must be reconciled exactly.

Create a table for each relevant test file with:

- test count at accepted A0.1 checkpoint `4af42c1f...`;
- test count immediately before this delta;
- test count after this delta;
- names of tests added;
- names of tests removed;
- names of tests renamed;
- parameterized cases added;
- tests moved between files;
- net arithmetic.

The arithmetic must satisfy:

```text
final count
= baseline count
+ added/expanded executable cases
- removed/contracted executable cases
```

Explain specifically how:

- 101 indicator tests;
- 43 option-signal tests;
- 7 confluence-guard tests;
- 151 combined tests;
- “30 new tests”

can all be true. If the “30 new tests” claim is inaccurate, correct the evidence record rather than defending it.

Do not add duplicate tests merely to make the number larger. Coverage and traceability matter, not volume.

---

## 10. REQUIRED TEST MATRIX TRACEABILITY

In the evidence record, map every original Prompt 02 required test to:

- exact test name;
- file;
- result;
- whether newly added or pre-existing;
- exact contract proved.

This includes all:

- 12 `volumeProfile()` cases;
- 12 `sessionVwap()` cases;
- 7 propagation cases;
- contaminated-series cases introduced by this delta;
- A0.1 non-regression cases.

If one parameterized test executes several cases, list the executed cases separately while naming the shared test block.

No item may be described only as “covered by the suite.”

---

## 11. VALIDATION COMMANDS

Run each file individually:

```bash
pnpm --filter @workspace/api-server exec vitest run --pool=threads --reporter=verbose \
  "src/lib/indicators.test.ts"

pnpm --filter @workspace/api-server exec vitest run --pool=threads --reporter=verbose \
  "src/lib/optionSignals.zeroVolume.test.ts"

pnpm --filter @workspace/api-server exec vitest run --pool=threads --reporter=verbose \
  "src/lib/confluenceEngine.vwapGuard.test.ts"
```

Run normal order:

```bash
pnpm --filter @workspace/api-server exec vitest run --pool=threads --reporter=verbose \
  "src/lib/indicators.test.ts" \
  "src/lib/optionSignals.zeroVolume.test.ts" \
  "src/lib/confluenceEngine.vwapGuard.test.ts"
```

Run reverse order:

```bash
pnpm --filter @workspace/api-server exec vitest run --pool=threads --reporter=verbose \
  "src/lib/confluenceEngine.vwapGuard.test.ts" \
  "src/lib/optionSignals.zeroVolume.test.ts" \
  "src/lib/indicators.test.ts"
```

Run:

```bash
pnpm --filter @workspace/api-server exec tsc --noEmit
pnpm run typecheck
git diff --check
```

For every command record:

- exact command;
- exit code;
- test file count;
- test count;
- pass/fail/skip count;
- final summary.

Any skipped, todo, only, flaky retry, or order-dependent test blocks acceptance.

---

## 12. DIFF AND SCOPE EVIDENCE

Return:

```bash
git status --short
git diff --name-status
git diff --stat
git diff --check
git diff --no-ext-diff -- \
  artifacts/api-server/src/lib/indicators.ts \
  artifacts/api-server/src/lib/indicators.test.ts \
  artifacts/api-server/src/lib/optionSignals.ts \
  artifacts/api-server/src/lib/optionSignals.zeroVolume.test.ts \
  artifacts/api-server/src/lib/confluenceEngine.ts \
  artifacts/api-server/src/lib/confluenceEngine.vwapGuard.test.ts \
  artifacts/api-server/src/lib/marketData/fetchKiteIndexCandles.ts \
  artifacts/audit-evidence/PHASE_A0_2_INDICATOR_AVAILABILITY.md
```

If the actual `fetchKiteIndexCandles.ts` path differs, use the discovered path and state it.

Classify every changed file:

- authorised indicator contract;
- authorised propagation proof;
- authorised structural comment;
- authorised test;
- authorised evidence;
- pre-existing user change;
- unrelated.

Acceptance requires:

- zero unrelated production change;
- zero threshold/weight/strategy/risk change;
- zero weakening of A0.1;
- no formatting-only churn outside touched blocks.

---

## 13. UPDATE THE EXISTING EVIDENCE RECORD

Update, do not duplicate:

`artifacts/audit-evidence/PHASE_A0_2_INDICATOR_AVAILABILITY.md`

It must contain all 22 sections required by Prompt 02 plus:

23. A0.2.1 reason for reopening acceptance;
24. current “skipped” semantics classification;
25. contaminated-series implementation and behavioral proof;
26. exact test-count reconciliation;
27. Prompt 02 matrix-to-test traceability;
28. final delta diff and scope proof.

Correct any inaccurate earlier statement, especially:

- “invalid bar skipped” if that behavior has been removed;
- “30 new tests” if the arithmetic does not prove it;
- any conclusion derived from a passing aggregate rather than a named test.

End exactly with:

`END OF PHASE A0.2 INDICATOR AVAILABILITY RECORD`

Verify the final line with:

```bash
tail -n 1 artifacts/audit-evidence/PHASE_A0_2_INDICATOR_AVAILABILITY.md
```

---

## 14. ACCEPTANCE

Until every item above is proved, return:

`IMPLEMENTED_UNVERIFIED`

The only acceptable success verdict is:

`ACCEPT_A0_2_AS_UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`

Success requires:

1. `volumeProfile()` rejects one invalid required bar embedded in otherwise valid data;
2. `sessionVwap()` does not skip contamination and later resume a valid-looking final value;
3. zero-volume and mixed-valid-volume behavior remains correct;
4. valid positive-volume calculations remain correct and deterministic;
5. input arrays remain unmodified;
6. null/unavailable values propagate without placeholders or positive VP/VWAP decision drivers;
7. all false prose is removed or accurately classified;
8. A0.1 is unchanged and green;
9. individual, normal-order, and reverse-order tests pass with no skipped/todo/only cases;
10. API and workspace typechecks pass;
11. diff hygiene passes;
12. test-count arithmetic reconciles;
13. evidence is complete and exactly terminated;
14. Git/checkpoint state is exact;
15. production is not inferred.

The maximum per-defect states remain:

- `D-FAB-01 / FX-01` — `UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`;
- `D-FAB-02 / FX-02` — `UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`;
- `D-FAB-05 / FX-05` — `UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`.

Do not use `DEV_VERIFIED`, `STAGING_VERIFIED`, `PROD_VERIFIED`, or `CLOSED`.

---

## 15. FINAL READ-ONLY GIT PASS

After an unavoidable platform checkpoint, or after all edits if none occurs, run:

```bash
git rev-parse HEAD
git status --short
git show --no-ext-diff --format=fuller --stat HEAD
git rev-parse --abbrev-ref --symbolic-full-name @{upstream}
git rev-list --left-right --count @{upstream}...HEAD
git merge-base 4af42c1f5bb6f9a6e9bea7c6e6379e53c4e1e7d0 HEAD
tail -n 1 artifacts/audit-evidence/PHASE_A0_2_INDICATOR_AVAILABILITY.md
```

Do not edit after this pass.

Return:

- exact final SHA;
- branch;
- upstream;
- ahead/behind;
- clean/dirty state;
- changed-file list;
- exact evidence terminator;
- exact overall verdict;
- exact per-defect verdicts;
- residual governance exceptions;
- `PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`.

Do not start A0.3.
