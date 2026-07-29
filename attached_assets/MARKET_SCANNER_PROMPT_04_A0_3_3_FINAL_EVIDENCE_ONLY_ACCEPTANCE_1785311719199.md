# MARKET SCANNER — PHASE A0.3.3 FINAL EVIDENCE-ONLY ACCEPTANCE

## Role

Act as the senior engineer and release-evidence owner for Devendra’s Market Scanner.

Your task is to close Phase A0.3.3 professionally and conclusively. Do not reopen the broader audit, redesign the signal engine, introduce unrelated improvements, or start another correction loop.

The reported A0.3.3 implementation appears to have removed the confirmed VWAP fabrication path. This task is now an **evidence-only acceptance pass** unless an executable validation exposes a genuine defect caused by the current A0.3.3 working-tree changes.

---

## Current reported state — verify, do not assume

The latest report claims:

- Initial observed HEAD changed from `62552dc` to `efb153af` before the A0.3.3 work.
- No A0.3.3 commit, push or deployment was performed.
- The current A0.3.3 work is uncommitted.
- Seven files are modified.
- `Ctx.pivotRef` was removed from production.
- `ConfluenceInputs.vwap` is now `number | null`.
- `VetoInputs.vwap` is now `number | null`.
- Confluence and veto connectors receive `ctx.authVwap`, never a spot-derived substitute.
- `scoreVwap({ vwap: null })` returns a neutral factor with zero weight.
- `evaluateDirectionalVetoes({ vwap: null })` returns no recovery or chase veto.
- VWAP-dependent volume breakout logic fails closed when authentic VWAP is unavailable.
- Baseline stop geometry uses authentic VWAP when available and spot geometry otherwise.
- The genuine-VWAP behavior is preserved.
- The new A0.3.3 behavioral suite passes `35/35`.
- The full API-server suite passes `4,298`, skips `3`, and fails `0`.
- Scanner TypeScript compilation passes.
- The existing A0.3 evidence file was updated.

Treat every statement above as a claim requiring executable or repository evidence.

---

## Controlling objective

Establish, with reconciled evidence, that:

1. Spot cannot enter any VWAP-labelled decision path.
2. Missing authentic VWAP cannot create a VWAP score, confidence contribution, driver, directional veto, eligibility decision or misleading diagnostic.
3. VWAP-dependent setups fail closed when authentic VWAP is unavailable.
4. Any permitted spot-based geometry is explicitly represented as spot geometry and never as VWAP-derived geometry.
5. Genuine VWAP behavior is unchanged.
6. All previously accepted A0.1, A0.2 and A0.3 regression gates remain green.
7. No unrelated production behavior was changed.

---

## Non-negotiable operating rules

### Do not roam

- Do not perform another broad audit.
- Do not investigate unrelated tabs, strategies, APIs, calculations, thresholds or UI areas.
- Do not refactor merely for cleanliness.
- Do not change strategy thresholds, weights, targets, stop-loss rules, entry rules, lot sizing, cooldowns, risk controls or market-hours logic.
- Do not change Kite, Upstox, IndianAPI, database, scheduler, deployment or infrastructure behavior.
- Do not begin Phase A0.4 or Task #158.

### Do not enter a loop

- Read each relevant file fully once.
- Build one acceptance manifest containing every required command and expected evidence item.
- Execute that manifest once.
- If a command fails, classify the failure before editing anything.
- Make a code change only when an executable failure proves a defect in the current A0.3.3 implementation.
- After a justified correction, rerun only the directly affected suite and then the complete acceptance manifest once.
- Do not repeatedly rewrite tests or cycle through speculative fixes.

### Protect the repository

- Do not commit.
- Do not amend, squash, rebase, merge, cherry-pick or reset.
- Do not push.
- Do not pull or fetch.
- Do not publish or deploy.
- Do not modify remote branches or tags.
- Do not discard, overwrite or hide existing working-tree changes.
- Do not use `git stash` as a substitute for recording the actual working-tree state.
- Do not change or weaken a test merely to obtain a passing result.
- Do not add `.skip`, `describe.skip`, `test.skip`, `it.skip`, `.only`, retries or quarantines.

### Permitted writes

The only unconditional write permitted is completing or correcting the existing A0.3 evidence section. A production or test-file edit is permitted only after a failing executable gate proves that the current A0.3.3 implementation is defective. Document the failure and the exact reason before making such an edit.

---

## Step 1 — establish the immutable preflight record

Before running tests or modifying anything, capture:

1. Current timestamp in `Asia/Kolkata`.
2. `git rev-parse HEAD`.
3. `git status --short --branch`.
4. Current branch.
5. Configured upstream.
6. Ahead/behind count against the already-configured upstream reference.
7. `git log --oneline --decorate -n 20`.
8. `git diff --stat`.
9. `git diff --name-status`.
10. Exact modified and untracked file inventory.
11. Whether `62552dc` is an ancestor of current HEAD.
12. Whether `efb153af` is current HEAD.
13. The commits between `62552dc` and `efb153af`, if the range exists.
14. A read-only explanation of why HEAD changed from `62552dc` to `efb153af`.

Do not guess who moved HEAD or how it moved. Base the explanation on the local reflog and commit graph if those records are available. Do not expose credentials or secrets.

Important: uncommitted A0.3.3 changes are not contained in HEAD. The final report must distinguish:

- repository HEAD;
- working-tree implementation state;
- evidence-file state.

---

## Step 2 — build the exact acceptance manifest

Before execution, list every test file and command that will be run. Resolve commands from the repository’s actual package scripts and workspace configuration. Do not invent package names or substitute an unrelated TypeScript command.

The manifest must include the following gates.

### Gate A — accepted backend baseline

Run these separately and report exact per-file results:

| Test file | Required result |
|---|---:|
| `indicators.test.ts` | `110/110` |
| `optionSignals.zeroVolume.test.ts` | `43/43` |
| `confluenceEngine.vwapGuard.test.ts` | `7/7` |
| **Accepted baseline** | **`160/160`** |

No skip, failure or exception is acceptable in this baseline.

### Gate B — A0.3.3 load-bearing behavioral proof

Run the complete new A0.3.3 test file and report every section:

- null authentic-VWAP confluence behavior;
- null authentic-VWAP veto behavior;
- connector-source proof;
- VWAP-dependent detector fail-closed behavior;
- spot-geometry isolation;
- genuine-VWAP preservation.

Required result: `35/35`.

Do not report only the aggregate. State what each section proves.

### Gate C — existing A0.3 acceptance suites

Run and report separately:

- setup-availability contract tests;
- A0.3.1 core tests;
- A0.3.2 paper-admission tests;
- route-serializer tests;
- actual OpenAPI YAML parity tests;
- Zod/client parity tests;
- C0 enforcement tests;
- actual production availability/disclosure component tests;
- scanner availability tests;
- trading-boundary tests.

Use the repository’s actual test filenames in the report.

### Gate D — normal and reverse order

Run the complete Phase A0.3 acceptance file set:

1. once in normal order;
2. once in exact reverse order.

Report:

- the ordered file list for each run;
- each file’s passed, skipped and failed counts;
- the arithmetic sum;
- both final aggregate results.

The earlier accepted aggregate was `408/408`, but the A0.3.3 work reportedly replaced 16 old inventory tests with 35 new tests, a net increase of 19. Therefore:

- do not blindly repeat `408`;
- determine whether the new manifest total is `427`, or another total;
- reconcile it explicitly as the sum of the displayed per-file counts;
- explain every difference from the earlier `408`.

An unreconciled aggregate is a failed evidence gate even when tests are green.

### Gate E — scanner and full API regression

Run and report:

- complete scanner regression suite: expected `843/843`;
- complete API-server suite: expected `4,298 passed / 3 skipped / 0 failed`.

For each of the three skipped API tests:

- provide the exact file;
- provide the exact test name;
- provide the skip reason;
- prove it is not an A0.1, A0.2, A0.3 or A0.3.3 acceptance test.

Search the final diff and affected files for newly introduced skip/only markers. Confirm that A0.3.3 introduced none.

---

## Step 3 — prove the production VWAP boundary

This is the load-bearing part of acceptance. Do not rely only on text searches; combine source inventory, connector inspection and behavioral tests.

### 3.1 Production inventory

Search all production source files for:

- `pivotRef`;
- `effectiveVwap`;
- `vwapRaw ?? spot`;
- `authVwap ?? spot`;
- fields named `vwap`;
- calls to confluence scoring;
- calls to directional veto evaluation;
- VWAP-dependent detector calls;
- VWAP driver creation;
- signal serialization and diagnostics mentioning VWAP.

Classify every match as:

- authoritative VWAP;
- nullable VWAP input;
- permitted spot geometry;
- test/comment only;
- prohibited fabrication.

Required production result:

- `Ctx.pivotRef` does not exist;
- no production decision path receives a spot-derived value through a parameter or field named `vwap`;
- `ConfluenceInputs.vwap` and `VetoInputs.vwap` may remain named `vwap`, but their call sites must pass only `authVwap`;
- no prohibited fabrication match remains.

If `pivotRef` remains only in test descriptions or historical comments, list those exact paths and explain why they are non-production.

### 3.2 Confluence proof

Prove behaviorally that, when `authVwap === null`:

- the VWAP factor has `weight = 0`;
- the VWAP factor has neutral polarity;
- the VWAP factor cannot change total confluence confidence;
- no VWAP driver is created;
- changing spot or any geometry anchor to absurdly different values cannot change the VWAP factor, total score or driver list.

Also prove that a valid authentic VWAP retains the previously accepted score, polarity and driver behavior.

### 3.3 Directional-veto proof

Prove behaviorally that, when `authVwap === null`:

- recovery veto is `false`;
- chase veto is `false`;
- changing spot or any geometry anchor cannot change those results;
- no hidden fallback value enters the veto evaluator.

Also prove that authentic VWAP preserves the valid existing recovery/chase behavior.

### 3.4 VWAP-dependent detector matrix

Provide an exact matrix for every detector or setup that uses or historically used VWAP, including at minimum:

- volume breakout;
- mean reversion;
- trend continuation;
- EMA pullback;
- baseline outlook;
- any other match found by repository search.

For each detector, report:

| Detector | Input used | Behavior when `authVwap=null` | Can emit? | Confidence/driver effect | Entry/target/stop effect | User-facing provenance |
|---|---|---|---|---|---|---|

Required behavior:

- a truly VWAP-dependent setup fails closed when authentic VWAP is unavailable;
- it cannot be re-enabled by spot;
- it cannot create a VWAP driver or confidence contribution;
- it cannot describe spot as VWAP;
- genuine VWAP behavior remains unchanged.

If baseline outlook is permitted to use spot for non-indicator stop geometry:

- prove this is a deliberate geometry fallback only;
- prove it does not affect VWAP confidence, drivers, vetoes or setup availability;
- prove its output/diagnostic identifies the anchor as spot-based geometry;
- prove it is never represented as a VWAP-derived stop.

### 3.5 Serialization and UI honesty

Prove that:

- a signal serializes `vwap` only when authentic VWAP exists;
- missing authentic VWAP results in omission or an explicitly supported null representation, according to the production schema;
- spot geometry is never serialized under `vwap`;
- no UI copy describes spot-derived data as VWAP;
- retired/unavailable setup records remain truthful;
- active setup counts exclude unavailable setups.

---

## Step 4 — route and contract preservation

Rerun the six actual production route-state tests and report each state separately:

1. normal signals;
2. no signals;
3. market closed;
4. stale or suppressed data;
5. partial index failure;
6. all-index failure.

For every state, report:

- HTTP/result state expected by the production serializer;
- schema parse result;
- signal cardinality;
- setup-availability cardinality;
- diagnostic behavior;
- whether exactly nine availability records remain present.

The all-index-failure state must still return the canonical nine-record availability contract. A0.3.3 must not reintroduce `?? []`, optional-bundle derivation or an avoidable HTTP 500.

Confirm the actual production validator still rejects:

- duplicate nine-entry arrays;
- missing index/setup combinations;
- invalid status/reason combinations;
- `eligibleForEmission: true`;
- wrong cardinality.

---

## Step 5 — typechecks, builds and static checks

Run the actual repository commands and report the exact command, exit code and concise result for:

1. API-server typecheck;
2. API Zod/schema package typecheck;
3. API React client typecheck;
4. scanner typecheck;
5. full-workspace typecheck;
6. scanner production build;
7. relevant API production build;
8. `git diff --check`.

If the repository has no standalone command for one item, state that precisely and identify the real encompassing command that validates it. Do not replace it with an unrelated package check.

No typecheck, build or diff-check failure is acceptable.

---

## Step 6 — evidence-file integrity

Update only the existing A0.3 evidence file:

`artifacts/audit-evidence/PHASE_A0_3_SETUP_VIABILITY_AND_HONEST_RETIREMENT.md`

Do not create a competing evidence file unless this path genuinely does not exist.

The A0.3.3 evidence section must contain:

1. Date and time in IST.
2. Scope and exact defect closed.
3. Implementation HEAD observed before the evidence write.
4. Explicit statement that A0.3.3 implementation changes are uncommitted, if still true.
5. Exact changed-file inventory.
6. Production VWAP-boundary inventory.
7. Detector matrix.
8. Per-file test results.
9. Reconciled normal/reverse totals.
10. Full regression results.
11. Typecheck/build commands and outcomes.
12. Git state.
13. No-commit/no-push/no-deploy declaration.
14. Remaining governance limitation: production deployment unverified.
15. Exact final verdict.
16. Exact final terminator:

`END_PHASE_A0_3_3_FINAL_EVIDENCE`

After the final byte is written:

- verify that the terminator occurs exactly once;
- verify it is the final nonblank line;
- calculate SHA256;
- report the SHA256 externally in the final response.

Do not attempt to embed the file’s own final SHA256 inside the same hashed file. That would create a recursive and non-reproducible claim.

Confirm that A0.1 and A0.2 evidence files were not modified.

---

## Step 7 — final Git record

After all validation and the evidence write, capture:

1. Final HEAD.
2. Branch.
3. Upstream.
4. Ahead/behind count against the existing upstream reference.
5. `git status --short --branch`.
6. Exact modified/untracked file inventory.
7. `git diff --stat`.
8. `git diff --name-status`.
9. Accepted-checkpoint ancestor results.
10. Whether HEAD changed during this task.
11. Whether any commit command was executed.
12. Whether any push command was executed.
13. Whether any deployment or publish action was executed.

Do not claim that an uncommitted working tree is contained in final HEAD.

Because fetching is prohibited, distinguish between:

- “no push command was executed during this task”; and
- independently verified current remote state.

Do not claim remote verification unless it was actually available without changing repository state.

---

## Failure handling

If any required gate fails:

1. Stop the acceptance run.
2. Report the exact command, failing test/build and error.
3. Classify it as:
   - A0.3.3 regression;
   - pre-existing but acceptance-blocking regression;
   - environment/tooling issue;
   - evidence arithmetic/documentation issue.
4. Do not weaken the test.
5. Do not continue into unrelated investigation.
6. Make the smallest justified correction only if the failure proves a defect within A0.3.3 scope.
7. Rerun the affected gate and then the full acceptance manifest once.

If the failure cannot be safely resolved within this scope, return:

`A0_3_3_NOT_ACCEPTED — <EXACT_BLOCKER>`

Do not manufacture a passing verdict.

---

## Acceptance criteria

Return `ACCEPT_A0_3_AS_UNIT_VERIFIED` only if all of the following are true:

- accepted backend baseline is exactly `160/160`;
- A0.3.3 behavioral suite is exactly `35/35`;
- all A0.3 acceptance files pass in normal and reverse order;
- normal/reverse totals reconcile arithmetically;
- scanner suite is `843/843`;
- full API suite has zero failures;
- all three skips are identified and unrelated;
- no skip/only marker was added;
- all typechecks and builds pass;
- `git diff --check` passes;
- no production `pivotRef` remains;
- spot cannot enter VWAP scoring, drivers, confidence or vetoes;
- all VWAP-dependent detectors fail closed without authentic VWAP;
- permitted spot geometry is explicitly and truthfully represented;
- genuine VWAP behavior is preserved;
- six production route states pass;
- canonical nine-record availability remains intact;
- exact Git and evidence integrity records are complete;
- no commit, push or deployment was performed.

Even after unit acceptance, production status must remain:

`PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`

Do not combine unit acceptance with production acceptance.

---

## Required final-response format

Return only the final evidence record. Do not return an execution diary, repeated plan or broad narrative.

### 1. Verdict

`ACCEPT_A0_3_AS_UNIT_VERIFIED`

or

`A0_3_3_NOT_ACCEPTED — <EXACT_BLOCKER>`

### 2. VWAP honesty conclusion

A concise conclusion covering:

- confluence;
- drivers/confidence;
- directional vetoes;
- detectors;
- serialization/UI;
- permitted spot geometry.

### 3. Test evidence

A table with:

| Gate | Exact files | Passed | Skipped | Failed | Result |
|---|---|---:|---:|---:|---|

Include the `160/160` baseline, A0.3.3 `35/35`, normal order, reverse order, scanner and full API suite.

### 4. Detector matrix

Include every VWAP-related detector and its null/authentic-VWAP behavior.

### 5. Six route states

Provide one row per production route state.

### 6. Typechecks and builds

Provide exact commands and exit results.

### 7. Skipped-test record

List all three skipped API tests and reasons.

### 8. Git record

Include:

- starting HEAD;
- final HEAD;
- explanation of `62552dc → efb153af`;
- branch/upstream/ahead-behind;
- working-tree state;
- exact file inventory;
- diff statistics;
- checkpoint ancestry;
- no commit/push/deploy statements.

### 9. Evidence integrity

Include:

- evidence path;
- SHA256;
- terminator count;
- final-nonblank-line verification;
- evidence-write chronology;
- confirmation that A0.1/A0.2 evidence files were untouched.

### 10. Production status

`PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`

Stop after this record. Do not propose Phase A0.4, publishing or additional improvements.
