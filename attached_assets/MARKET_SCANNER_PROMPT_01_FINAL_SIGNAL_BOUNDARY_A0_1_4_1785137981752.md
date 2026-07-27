# MARKET SCANNER BY DEV
# PROMPT 01 — FINAL SIGNAL-BOUNDARY CLOSURE A0.1.4
## Revision 2 — Consolidated Against the Current Uncommitted Guard Patch

**Owner:** Devendra Sharma  
**Timezone:** Asia/Kolkata  
**Defects:** `D-FAB-03 / FX-03`, `D-FAB-04 / FX-04`  
**Current programme state:** `IMPLEMENTED_UNVERIFIED`  
**Current reported HEAD:** `3c353229113de5fb7bc5865553c71860fca7e63c`  
**Current reported worktree:** Three uncommitted source/test modifications  
**Deployment/publish/push:** Prohibited  
**Database/environment/secret mutation:** Prohibited  
**Next checkpoint after literal acceptance:** Phase A0.2  

---

## 1. BINDING REVIEW OF THE LATEST SUBMISSION

The latest submission is **not accepted as `UNIT_VERIFIED`**.

It appears to have executed an earlier confluence-guard correction rather than the final A0.1.4 signal-boundary prompt. It nevertheless found and corrected a real weakness:

- prior B1–B5 tests reportedly passed `vp: null` instead of their named non-null fixtures;
- the new tests reportedly inject non-null VP fixtures;
- the new `scoreVolumeProfile` guard reportedly neutralizes VP when `isIndexFno: true`;
- the current index-F&O caller reportedly passes both `vp: null` and `isIndexFno: true`;
- focused tests, regressions, typecheck, and diff hygiene reportedly pass.

These are useful changes. Preserve them unless exact code inspection disproves the report.

The checkpoint remains `IMPLEMENTED_UNVERIFIED` because:

1. `G-RESULT-BOUNDARY` still inspects `scoreConfluence` results, not an emitted index-F&O signal;
2. the reported caller fixture still does not emit a signal above `HC_EMISSION_FLOOR`;
3. `isIndexFno?: boolean` is optional, so the statement that the engine control “cannot be bypassed by any caller” is false;
4. a zero-weight diagnostic factor still has the label `VOLUME_PROFILE` and Volume Profile detail text, contradicting the broad claim that the confluence result contains no VP-derived label;
5. the reported production-deployment statement is inference-based; authoritative deployment status remains unverified;
6. the three production/test changes are still uncommitted and therefore no final automatic-checkpoint identity exists yet.

Do not repeat the audit. Close only these exact gaps.

---

## 2. PRESERVE THE CORRECT ENGINE-LEVEL DEFENCE

Preserve defence in depth:

```ts
vp: null,
isIndexFno: true,
```

at the index-F&O caller and the early guard inside `scoreVolumeProfile`.

The intended policy is:

> Volume Profile must not influence index-F&O scoring under the current authorised decision policy, even if a non-null VP object reaches the engine.

Do not restore POC/VAH/VAL scoring, change weights, or compensate elsewhere.

---

## 3. MAKE THE POLICY DISCRIMINANT NON-OPTIONAL

Do not keep:

```ts
isIndexFno?: boolean;
```

An optional flag silently defaults to the permissive path and can be omitted by a new caller.

Use:

```ts
isIndexFno: boolean;
```

or, only if the repository already has a required and semantically equivalent market-segment discriminant, reuse that existing required discriminant instead of adding another field.

Requirements:

1. every production construction of `ConfluenceInputs` must explicitly set the value;
2. index-F&O callers must set `true`;
3. non-index callers must explicitly set `false`;
4. every test fixture must set the value intentionally;
5. full TypeScript compilation must fail if a future caller omits the field;
6. no defaulting with `?? false`, optional chaining, type assertion, `as any`, or suppression is allowed.

Provide:

```bash
rg -n "ConfluenceInputs|scoreConfluence\\(" artifacts/api-server/src --glob '*.ts'
```

and classify every construction/call site.

This is a type-safety hardening of the already introduced guard, not authorisation for unrelated trading changes.

---

## 4. CORRECT THE GUARD’S DIAGNOSTIC LANGUAGE

Avoid unsupported absolute prose such as:

> cash indices carry structural zero volume

Use policy-accurate wording:

> Volume Profile is disabled for index-F&O decision scoring under the current authorised policy; VP was not scored.

The neutral diagnostic may identify that the factor was intentionally suppressed. It must not contain:

- POC, VAH, or VAL values;
- a directional statement;
- positive/negative evidence;
- a claim that every possible provider will always return zero volume.

---

## 5. FINAL MANDATORY EMITTED-SIGNAL TEST

Modify only the focused A0.1 regression fixture/test necessary to obtain a legitimate emitted result.

Use the real:

- `volumeProfile`;
- `buildSignalsForIndex`;
- detector implementation;
- `scoreConfluence`;
- `HC_EMISSION_FLOOR`;
- signal serialization.

Do not mock a higher score, lower a threshold, add evidence points, fabricate a signal, or call a serializer with a hand-built detector result.

### 5.1 Fix the existing synthetic fixture

The reported fixture uses equal volume on every bar. Consequently:

```ts
lastVol > avgVol20 * 1.2
```

is false and legitimate volume-confirmation evidence does not fire.

Change only the test data so the final bar has a deterministic, sufficiently higher volume than the preceding baseline.

Directly calculate and assert:

```ts
expect(lastVol).toBeGreaterThan(avgVol20 * 1.2);
```

Also assert before invocation:

```ts
expect(volumeProfile(...)).not.toBeNull();
```

The final value must be derived from the real rolling-average convention used by production code.

### 5.2 Bullish emitted result

Using a real bullish caller fixture:

1. invoke `buildSignalsForIndex`;
2. assert an inspectable result is emitted;
3. select it through explicit `setup` and `direction` fields;
4. assert the intended direction is bullish;
5. assert runtime confluence input has `isIndexFno === true`;
6. assert runtime confluence input has `vp === null`;
7. inspect the actual emitted signal fields.

### 5.3 Bearish emitted result

Repeat the same proof using a real bearish fixture and assert the intended bearish direction.

If either legitimate fixture cannot emit, return `BLOCKED` with the exact calculated detector score, confluence score, floor, and rejecting guard. Do not return an acceptance verdict.

---

## 6. PRECISE SERIALIZATION RULE

The emitted signal’s positive `drivers`, tradeability reasons, decision reasons, and user-facing explanations must contain:

- at least one legitimate non-VP driver;
- no VP-derived directional evidence;
- no POC/VAH/VAL value;
- no `Above POC`, `Below POC`, `above value`, or `below value` statement;
- no VP-derived target.

A diagnostic factor breakdown may retain:

```text
VOLUME_PROFILE
weight = 0
polarity = neutral
```

only if:

- it is clearly a neutral diagnostic, not a positive driver;
- its detail states that the factor was disabled/not scored;
- it contains no VP price levels;
- it cannot affect the aggregate score, confidence, direction, target, stop, sizing, or tradeability.

Do not claim “no VP label exists anywhere” if the neutral diagnostic label remains. Claim precisely:

> No VP-derived decision evidence or value reaches an emitted index-F&O signal; any retained VP entry is diagnostic-only, zero-weight, neutral, and level-free.

Use explicit field assertions as primary proof. A whole-object string scan may be secondary only.

---

## 7. D-FAB-04 / TEST-E CLASSIFICATION

Preserve:

`TARGET_RESULT_INVARIANCE_NOT_APPLICABLE_UNDER_CURRENT_NON_EMITTING_BRANCH`

Use the accurate numbers:

- zero-volume fixture result: `35`;
- structural maximum with authorised volume confirmation: `43`;
- no-VWAP emission threshold: `50`.

Therefore the no-VWAP `TREND_CONTINUATION` branch remains non-emitting without fabricated VP evidence.

Do not alter it here. Carry it under the existing Phase A0 exit requirement:

> Dead/non-emitting setups must be fixed or honestly retired with UI disclosure.

Do not invent, reuse, or merge a stable defect ID.

---

## 8. REQUIRED TEST COLLECTION

Run each relevant file individually first:

```bash
pnpm --filter @workspace/api-server exec vitest run --pool=threads --reporter=verbose \
  "src/lib/optionSignals.zeroVolume.test.ts"

pnpm --filter @workspace/api-server exec vitest run --pool=threads --reporter=verbose \
  "src/lib/indicators.test.ts"

pnpm --filter @workspace/api-server exec vitest run --pool=threads --reporter=verbose \
  "src/lib/confluenceEngine.vwapGuard.test.ts"

pnpm --filter @workspace/api-server exec vitest run --pool=threads --reporter=verbose \
  "src/lib/fnoPaperRiskGuards.test.ts"

pnpm --filter @workspace/api-server exec vitest run --pool=threads --reporter=verbose \
  "src/lib/c0Enforcement.test.ts"
```

Then run the five-file collection together:

```bash
pnpm --filter @workspace/api-server exec vitest run --pool=threads --reporter=verbose \
  "src/lib/optionSignals.zeroVolume.test.ts" \
  "src/lib/indicators.test.ts" \
  "src/lib/confluenceEngine.vwapGuard.test.ts" \
  "src/lib/fnoPaperRiskGuards.test.ts" \
  "src/lib/c0Enforcement.test.ts"
```

Report the literal number of collected files and tests. Do not say five if the runner collects four.

Run:

```bash
pnpm --filter @workspace/api-server exec tsc --noEmit
pnpm run typecheck
git diff --check
```

For every command provide exact command, exit code, and final summary.

---

## 9. CURRENT-TASK DIFF AND SCOPE

Capture the current HEAD before further edits.

Provide:

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git diff --name-status
git diff --stat
git diff --check
git diff --no-ext-diff -- \
  artifacts/api-server/src/lib/confluenceEngine.ts \
  artifacts/api-server/src/lib/optionSignals.ts \
  artifacts/api-server/src/lib/optionSignals.zeroVolume.test.ts \
  artifacts/audit-evidence/PHASE_A0_1_2_FINAL_CLOSURE.md
```

Classify every changed file as:

- authorised engine guard/type hardening;
- authorised caller defence;
- authorised regression test;
- authorised evidence report;
- prompt/attached artifact;
- unrelated.

Acceptance requires zero unrelated source changes.

---

## 10. UPDATE THE EXISTING EVIDENCE RECORD

Update only:

`artifacts/audit-evidence/PHASE_A0_1_2_FINAL_CLOSURE.md`

Do not create another audit file.

It must record:

1. why the prior B1–B5 tests were invalid;
2. the corrected non-null injection tests;
3. the required policy discriminant and all explicit call-site values;
4. engine guard execution before VP scoring;
5. bullish emitted-signal proof;
6. bearish emitted-signal proof;
7. exact serialized positive drivers;
8. exact neutral diagnostic factor, if retained;
9. absence of VP levels and directional VP evidence;
10. corrected Test-E classification;
11. all five individual test results;
12. five-file combined result;
13. API typecheck;
14. full-workspace typecheck;
15. diff hygiene;
16. current Git/worktree state;
17. governance exception history;
18. `PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`;
19. complete PASS/FAIL/BLOCKED gate table;
20. next checkpoint: Phase A0.2.

End exactly with:

`END OF PHASE A0.1 FINAL ACCEPTANCE RECORD`

---

## 11. GIT AND DEPLOYMENT GOVERNANCE

Do not run:

- `git add`;
- `git commit`;
- `git push`;
- amend, rebase, reset, revert, or cherry-pick;
- publish or deploy commands.

If the platform creates an automatic checkpoint, preserve it and perform a final read-only pass:

```bash
git rev-parse HEAD
git status --short
git show --no-ext-diff --format=fuller --stat HEAD
git rev-parse --abbrev-ref --symbolic-full-name @{upstream}
git rev-list --left-right --count @{upstream}...HEAD
```

Do not edit any file after that pass.

The owner-facing response may record the final checkpoint SHA; the evidence file does not need to self-reference the SHA of the commit that contains it.

Do not claim production remains on a particular revision without an authoritative deployment record.

Use:

`PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`

unless direct read-only platform evidence proves otherwise.

---

## 12. STANDING SAFETY CONTROLS

Preserve:

- owner-only;
- Asia/Kolkata;
- Kite as sole trade-grade source;
- Upstox compare-only;
- IndianAPI research-only;
- Yahoo excluded from trade paths;
- F&O C0 and Equity C0 enabled;
- paper automatic opening disabled/blocked;
- swing broker execution dry-run only;
- no live broker order placement;
- no operational database use.

Static grep evidence for live-order absence must state its coverage limitations. Do not represent grep as proof against every dynamic or external execution path.

---

## 13. FINAL VERDICT GATE

Return:

`ACCEPT_CODE_AS_UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`

only if:

1. the policy discriminant is required at compile time;
2. every production caller sets it explicitly;
3. B1–B5 inject genuine non-null VP fixtures;
4. the engine neutralizes those fixtures for index F&O;
5. the real bullish caller emits an inspectable signal;
6. the real bearish caller emits an inspectable signal;
7. both emitted signals contain legitimate non-VP positive drivers;
8. neither emitted signal contains VP-derived directional evidence or levels;
9. any retained VP diagnostic is zero-weight, neutral, honest, and level-free;
10. D-FAB-04 remains free of VP confidence and target influence;
11. all five individual test files pass;
12. the five-file combined suite passes;
13. API and full-workspace typechecks pass;
14. diff hygiene passes;
15. no unrelated source change exists;
16. Git/checkpoint governance is recorded accurately;
17. deployment status is not inferred;
18. the evidence report is complete and terminated correctly.

Otherwise return `IMPLEMENTED_UNVERIFIED` or `BLOCKED`.

Even after acceptance:

- `D-FAB-03 / FX-03` maximum state: `UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`;
- `D-FAB-04 / FX-04` maximum state: `UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`;
- production state: `UNVERIFIED`;
- programme state: not closed.

The next checkpoint is Phase A0.2, limited to the related indicator-availability cluster:

- `D-FAB-01 / FX-01`;
- `D-FAB-02 / FX-02`;
- `D-FAB-05 / FX-05`.

Do not begin A0.2, D-FAB-06, D-FAB-07, D-FKE-05, or any later-phase work in this task.
