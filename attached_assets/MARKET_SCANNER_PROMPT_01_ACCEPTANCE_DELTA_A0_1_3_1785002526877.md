# MARKET SCANNER BY DEV
# PROMPT 01 — ACCEPTANCE DELTA A0.1.3
## Close the Last Executable-Evidence Gap Without Changing Trading Logic

**Owner:** Devendra Sharma  
**Timezone:** Asia/Kolkata  
**Defects:** `D-FAB-03 / FX-03`, `D-FAB-04 / FX-04`  
**Current checkpoint state:** `IMPLEMENTED_UNVERIFIED`  
**Scope:** One missing result-boundary test, corrected Test-E classification, and complete acceptance evidence  
**Production deployment/publish/push:** Prohibited  
**Database/environment/secret mutation:** Prohibited  
**Manual Git history mutation:** Prohibited  
**Next checkpoint after acceptance:** Phase A0.2  

---

## 1. ACCEPTANCE RULING ON THE LATEST SUBMISSION

The latest implementation is materially stronger:

- the real `scoreConfluence` is tested with bearish/above-spot VP;
- the real `buildSignalsForIndex` caller is exercised for bullish and bearish paths;
- runtime calls reportedly receive `vp: null` even when upstream VP is non-null;
- 38/38 focused tests reportedly pass;
- typecheck reportedly passes;
- the production seams are reported as export-only and runtime-neutral;
- deployment status is correctly classified as `PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`.

It is not yet a literal pass of A0.1.2 because:

1. the submitted “Test D” observes `scoreConfluence` arguments but does not inspect the actual returned/serialized index-F&O result for VP-derived reasons;
2. the submitted “Test E” returns `null` in every case and therefore does not prove entry/target/stop invariance on a produced candidate;
3. the exact combined-regression, diff-hygiene, current checkpoint SHA, upstream-reachability, and complete durable evidence report were not included in the owner-facing response.

Do not redo the audit and do not redesign the strategy. Close only these gaps.

---

## 2. CORRECTION TO THE PREVIOUS TEST-E REQUIREMENT

The prior prompt required `detectTrendContinuation()` to produce a no-VWAP candidate and then compare its target under manipulated VP.

Under the current authorised FX-04 logic, that requirement is impossible:

- EMA evidence: maximum `+20`;
- RSI evidence: maximum `+15`;
- trusted-volume confirmation: maximum `+8`;
- VP/POC contribution: removed;
- total maximum: `43`;
- emission threshold: `50`.

Therefore the no-VWAP branch cannot produce a `TREND_CONTINUATION` candidate without changing an authorised threshold, adding a substitute factor, or restoring fabricated VP influence. All such changes are prohibited.

Do **not** weaken the threshold, invent points, mock the detector result, bypass the guard, or copy the target formula into a test.

Replace the impossible gate with this honest classification:

`TARGET_RESULT_INVARIANCE_NOT_APPLICABLE_UNDER_CURRENT_NON_EMITTING_BRANCH`

Required proof:

1. execute the real detector with `vp: null`, extreme VP below spot, extreme VP above spot, and absurd VP values;
2. prove every case returns the same fail-closed result;
3. prove the real production source no longer contains the `Above/Below POC +8` contribution in the no-VWAP branch;
4. prove the real production source no longer consumes `pointOfControl`, `valueAreaHigh`, or `valueAreaLow` when constructing the no-VWAP target;
5. record that the no-VWAP `TREND_CONTINUATION` lane is currently non-emitting.

Item 5 is not a new replacement ID and must not be merged into `D-FAB-03` or `D-FAB-04`. Carry it forward under the existing Phase A0 exit requirement:

> Dead/non-emitting setups must be fixed or honestly retired with UI disclosure.

It must be resolved in the later dedicated Phase A0 dead-setup checkpoint together with the already registered setup viability work. Do not solve it in A0.1.3.

---

## 3. ONLY REQUIRED TEST CHANGE — ACTUAL RESULT-BOUNDARY QUARANTINE

Add or correct one focused table-driven test in:

`artifacts/api-server/src/lib/optionSignals.zeroVolume.test.ts`

The test must execute the real `buildSignalsForIndex` path for both:

- bullish index-F&O;
- bearish index-F&O.

For each direction:

1. supply a controlled context whose `vpIntraday` is explicitly non-null and contains extreme/sentinel POC, VAH, and VAL values;
2. assert this precondition directly before invoking the caller—do not infer it only from non-zero candle volumes;
3. invoke the real caller;
4. prove the relevant scoring call receives `vp: null`;
5. inspect the actual returned signal/candidate object produced by the caller;
6. inspect every applicable reason, explanation, factor, confluence, driver, and serialized decision field;
7. prove no VP-derived label/value reaches the result, including:
   - `VOLUME_PROFILE`;
   - `volume profile`;
   - `POC`;
   - `point of control`;
   - `VAH`;
   - `VAL`;
   - `value area`;
8. prove both directions are genuinely exercised and return a result suitable for inspection.

Use precise field assertions. A broad `JSON.stringify()` search may be used only as a secondary guard, not as the sole assertion.

If the real caller returns no inspectable result for either direction, do not fake one. Report:

`RESULT_BOUNDARY_TEST_BLOCKED_BY_NON_EMITTING_FIXTURE`

Then explain the exact guard preventing emission. Do not alter trading logic to make the test pass.

Avoid duplication: if the existing Test D or Test F proves only the same `vp: null` call argument, consolidate it rather than adding redundant tests.

---

## 4. PRODUCTION-SOURCE RULE

No further production trading logic change is authorised.

The three existing test seams may remain only if the exact diff confirms that each change is visibility-only:

```ts
export interface Ctx
export function detectTrendContinuation(...)
export function buildSignalsForIndex(...)
```

Do not change their bodies, parameters, defaults, side effects, call order, or runtime behaviour.

Do not change:

- setup eligibility;
- signal thresholds or evidence weights;
- entries, targets, stops, sizing, confidence, or risk;
- provider precedence or data policy;
- paper-trading, C0, broker, database, API, UI, environment, or deployment logic.

---

## 5. REQUIRED VALIDATION

Capture `PRE_TASK_HEAD` before editing.

Run the focused test individually:

```bash
pnpm --filter @workspace/api-server exec vitest run --pool=threads --reporter=verbose \
  "src/lib/optionSignals.zeroVolume.test.ts"
```

Run the combined relevant regression set:

```bash
pnpm --filter @workspace/api-server exec vitest run --pool=threads \
  "src/lib/optionSignals.zeroVolume.test.ts" \
  "src/lib/indicators.test.ts" \
  "src/lib/fnoPaperRiskGuards.test.ts"
```

Run API typecheck:

```bash
pnpm --filter @workspace/api-server exec tsc --noEmit
```

Run full repository typecheck only if it is an existing supported script. Report API and full-workspace results separately.

Run diff hygiene:

```bash
git diff --check
```

If an automatic platform checkpoint occurs:

```bash
git diff --check "$PRE_TASK_HEAD"..HEAD
```

For each command provide the exact command, exit code, and exact final summary.

---

## 6. REQUIRED GIT AND SCOPE EVIDENCE

Provide exact output for:

```bash
git branch --show-current
git rev-parse "$PRE_TASK_HEAD"
git rev-parse HEAD
git status --short
git rev-parse --abbrev-ref --symbolic-full-name @{upstream}
git rev-list --left-right --count @{upstream}...HEAD
git diff --name-status "$PRE_TASK_HEAD"..HEAD
git diff --no-ext-diff "$PRE_TASK_HEAD"..HEAD -- \
  artifacts/api-server/src/lib/optionSignals.ts \
  artifacts/api-server/src/lib/optionSignals.zeroVolume.test.ts \
  artifacts/audit-evidence/PHASE_A0_1_2_FINAL_CLOSURE.md
```

Also provide the exact SHA and `git show --format=fuller --stat` output for the automatic checkpoint reported by the latest submission.

Classify every changed file as:

- visibility-only production seam;
- authorised regression test;
- authorised evidence report;
- prompt/attached artifact;
- unrelated.

Acceptance requires zero unrelated source changes.

Do not run `git add`, `git commit`, `git push`, history rewriting, deployment, or publish commands.

If the platform creates another automatic checkpoint, preserve and record it as:

`AUTOMATIC_PLATFORM_CHECKPOINT`

---

## 7. DEPLOYMENT AND SAFETY CLASSIFICATION

Keep:

`PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`

unless an authoritative read-only production release record proves otherwise.

This does not prevent **unit-level** acceptance, but it strictly prevents:

- `DEV_VERIFIED`;
- `STAGING_VERIFIED`;
- `PROD_VERIFIED`;
- `CLOSED`;
- any statement that production contains these fixes.

Maintain all standing controls:

- owner-only;
- Asia/Kolkata;
- Kite sole trade-grade source;
- Upstox compare-only;
- IndianAPI research-only;
- Yahoo excluded from trade paths;
- F&O C0 and Equity C0 enabled;
- paper automatic opening disabled;
- swing broker execution dry-run only;
- no live order placement.

---

## 8. UPDATE THE DURABLE EVIDENCE REPORT

Update, do not duplicate:

`artifacts/audit-evidence/PHASE_A0_1_2_FINAL_CLOSURE.md`

The completed report must include:

1. final verdict;
2. exact current checkpoint SHA and mechanism;
3. exact changed-file inventory;
4. visibility-only seam diff;
5. bearish/above-spot raw VP test;
6. bullish executable caller test;
7. bearish executable caller test;
8. actual returned-result reason quarantine;
9. corrected Test-E classification;
10. no-VWAP non-emitting-lane carry-forward;
11. focused test result;
12. combined regression result;
13. API typecheck result;
14. full-workspace typecheck result, if run;
15. diff-hygiene result;
16. upstream reachability;
17. `PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`;
18. governance exception record;
19. complete PASS/FAIL/BLOCKED checklist;
20. next checkpoint: Phase A0.2.

The file must end with:

`END OF PHASE A0.1 FINAL ACCEPTANCE RECORD`

Verify the terminator using a read-only command before responding.

---

## 9. FINAL VERDICT RULE

Return:

`ACCEPT_CODE_AS_UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`

only if:

- the actual result-boundary quarantine passes for bullish and bearish paths;
- the corrected Test-E proof passes without changing trading logic;
- focused and combined suites pass;
- API typecheck passes;
- current-task diff hygiene passes;
- no unrelated source change exists;
- all automatic checkpoints are recorded;
- the evidence report is complete and has the required terminator.

Otherwise return:

- `IMPLEMENTED_UNVERIFIED` for a failed technical gate; or
- `BLOCKED` for an inaccessible or impossible required check.

Even after acceptance, record:

- `D-FAB-03 / FX-03` — `UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`;
- `D-FAB-04 / FX-04` — `UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`;
- production status — `UNVERIFIED`;
- programme closure — not closed;
- next checkpoint — Phase A0.2.

Do not begin Phase A0.2 in this task.
