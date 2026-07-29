# MARKET SCANNER — PHASE A0.3 FINAL BLOCKER CLOSURE

## Role and mission

Act as the senior engineer responsible for closing the final Phase A0.3 blockers in Devendra’s Market Scanner.

This is not a new audit and not another broad development phase. The A0.3.3 VWAP-honesty correction is considered technically verified and must remain frozen unless a directly relevant executable test proves otherwise.

Your mission is limited to four closure items:

1. Diagnose and permanently resolve the single failing `swingOrderStaging.test.ts` regression.
2. Prove the missing partial-index-failure and all-index-failure production route states correctly.
3. Resolve the contradictory Git and evidence-file record.
4. Run the few missing acceptance checks and then one final complete regression pass.

Do not work outside this scope.

---

## Current evidence — verify before relying on it

The previous run reported:

- Current HEAD: `faa1d0ad14b8bace52bacf851abc3a02df631d93`.
- Branch: `main`.
- Upstream: `origin/main`.
- Local state: `35` commits ahead and `0` behind the locally recorded upstream reference.
- A0.3.3 changes are already contained in commit `faa1d0ad`.
- No commit, push or deployment was performed during the previous evidence-only task.
- Accepted backend baseline: `160/160`.
- A0.3.3 behavioral tests: `35/35`.
- Other A0.3 acceptance tests: `232/232`.
- Normal order: `427/427`.
- Reverse order: `427/427`.
- Scanner: `843/843`.
- Full API-server suite: `4,297 passed / 3 skipped / 1 failed`.
- Sole failure:
  - file: `swingOrderStaging.test.ts`;
  - test: `Case 10: event-risk forces review; owner override clears it`;
  - assertion: expected `false` to be `true` near line `404`.
- Three skipped tests are database-isolation tests in `paperTradingEqProvenance.test.ts`.
- Evidence SHA reported previously:
  `9c77e03267766aaac54cbb2de62f4cbf99ef879492bbea1d3b3d77a9935f743d`.

The previous report also contains contradictions that must not be carried forward:

- It calls the working tree “clean” while also reporting untracked files.
- It says evidence §20 was written but uncommitted while `git diff` was empty.
- It labels a degraded/stale test as the all-index-failure proof.
- It still mentions `?? [] → [] fails .length(9)`, even though the required production behavior is a schema-valid response containing the canonical nine availability records.
- It did not separately prove the partial-index-failure route state.
- It did not report a full-workspace typecheck.

Do not repeat these statements without fresh verification.

---

## Non-negotiable controls

### Scope control

- Do not reopen the VWAP audit.
- Do not modify confluence, VWAP scoring, directional vetoes, signal weights, thresholds, entry logic, targets, stop-loss rules or setup-retirement policy unless a directly relevant regression proves the A0.3.3 implementation itself is defective.
- Do not audit unrelated website modules.
- Do not modify Kite, Upstox, IndianAPI, market-hours, scheduler, database schema, deployment or infrastructure.
- Do not begin Phase A0.4 or Task #158.

### Repository control

- Do not commit.
- Do not amend, merge, rebase, reset, cherry-pick or squash.
- Do not push, pull or fetch.
- Do not deploy or publish.
- Do not delete or add the user’s untracked attachments.
- Do not stash the active working tree.
- Do not hide changes using `assume-unchanged`, `skip-worktree`, alternate indexes or temporary commits.
- If an agent or platform automatically changes HEAD, stop immediately and report the new HEAD. Do not revert it automatically.

### Test integrity

- Do not weaken, delete, skip or quarantine a failing test.
- Do not add `.skip`, `describe.skip`, `test.skip`, `it.skip`, `.only`, retries or arbitrary sleeps.
- Do not update an assertion merely to match current broken behavior.
- Use only an isolated test database. Never run destructive tests against production, preview-production, staging-with-production-data or any shared operational database.
- If an isolated test database cannot be proven, stop with:
  `BLOCKED — SAFE_TEST_DATABASE_NOT_CONFIRMED`.

### Loop prevention

- Read the relevant test, implementation and fixtures completely before editing.
- Create one failure hypothesis table.
- Run a bounded diagnostic matrix.
- Select the root cause supported by evidence.
- Make one smallest coherent correction.
- Rerun the directly affected tests.
- Run the full acceptance manifest once.
- Do not perform repeated speculative code passes.

---

## Step 1 — immutable preflight

Before modifying anything, record:

1. Current IST timestamp.
2. `git rev-parse HEAD`.
3. `git status --short --branch`.
4. `git status --porcelain=v2 --untracked-files=all`.
5. Current branch and configured upstream.
6. Ahead/behind against the existing local upstream reference.
7. `git diff --stat`.
8. `git diff --name-status`.
9. `git diff --cached --stat`.
10. `git diff --cached --name-status`.
11. `git ls-files -v` result for the A0.3 evidence file.
12. `git check-ignore -v` results for reported untracked `attached_assets` files, if any.
13. Exact tracked modifications.
14. Exact untracked files.

Classify the working tree accurately:

- tracked-clean and untracked-clean;
- tracked-clean with untracked files;
- tracked-dirty;
- index-dirty;
- or a combination.

Never use the word “clean” when untracked or modified files exist without explicitly qualifying what is clean.

Confirm that HEAD is still `faa1d0ad14b8bace52bacf851abc3a02df631d93`. If it is not, stop and report the observed state before doing anything else.

---

## Step 2 — diagnose the swing staging regression

### 2.1 Read the complete causal surface

Read completely:

- the failing `swingOrderStaging.test.ts` test file;
- the full implementation called by Case 10;
- event-risk evaluation logic;
- owner-override logic;
- staging-status transitions;
- database helpers and cleanup hooks used by the test;
- fixtures, factories, mocks, clocks and environment variables used by the test;
- relevant changes between `efb153af` and `faa1d0ad`;
- the last commits touching the test and its production dependencies.

Do not treat `git blame` on the failing assertion as causation. A shared-state, import, fixture, clock or database change elsewhere can break an older line without modifying that line.

### 2.2 State the expected business invariant

Before changing code, document the expected Case 10 state transition in plain language:

1. A staged swing order is exposed to event risk.
2. Without a valid owner override, the order requires review or remains blocked according to the production contract.
3. A valid authorized owner override clears only the event-risk review condition it is permitted to clear.
4. Other risk controls remain active.
5. The resulting boolean/status asserted at line 404 must represent the documented contract.
6. An expired, unauthorized, mismatched or malformed override must never clear the risk condition.

Confirm the expectation against existing domain types, API contract and neighboring tests. Do not invent new business rules.

### 2.3 Run the bounded diagnostic matrix

Using the isolated test database:

1. Run Case 10 alone at current HEAD five consecutive times.
2. Run the complete `swingOrderStaging.test.ts` file five consecutive times.
3. Run Case 10 after each immediately preceding case in the same file, using the smallest supported runner grouping.
4. Run the complete file in its declared order.
5. Run the complete file in reverse order if the runner supports deterministic reverse ordering.
6. Run the relevant database cleanup/setup hooks independently and inspect row counts/state before and after Case 10.
7. Check fake timers, system time, timezone, random IDs, cooldowns, process-global caches, module singletons and environment leakage.
8. Run the exact failing full-suite order once and capture the nearest preceding test files.
9. Reproduce Case 10 after the smallest plausible preceding-file set to identify cross-file leakage.

Record each run as:

| Run | Scope/order | Result | Database state | Clock/env state | Interpretation |
|---|---|---|---|---|---|

### 2.4 Compare checkpoints safely

Compare:

- pre-A0.3.3 checkpoint `efb153af`;
- current checkpoint `faa1d0ad`.

Use detached temporary worktrees under an explicitly created temporary directory. Do not alter the active worktree, branch or index.

For each checkpoint:

- use the same dependency versions;
- use a separately isolated test database/schema;
- use the same environment contract;
- run Case 10 alone;
- run the complete test file;
- record exact results.

Remove only the temporary worktrees and temporary databases created for this diagnostic after verifying their exact paths. Never delete a broad directory or shared database.

If checkpoint comparison cannot be performed safely, say so; do not manufacture a conclusion.

### 2.5 Root-cause classification

Classify the failure as exactly one of:

- production logic defect;
- stale or incorrect test fixture;
- database cleanup/isolation failure;
- test-order/shared-state leakage;
- clock/timezone leakage;
- environment/configuration mismatch;
- nondeterministic/flaky behavior with identified cause;
- unresolved.

Provide evidence for the selected classification.

### 2.6 Correction rules

If the failure is reproducible and caused by production logic:

- correct the smallest production boundary;
- preserve all established risk controls;
- add focused tests for valid, invalid, expired, unauthorized and mismatched owner overrides;
- do not broaden the override’s authority.

If the failure is caused by fixture or database isolation:

- correct setup/cleanup deterministically;
- do not change the business assertion;
- prove no state leaks between cases or files.

If the failure is caused by time:

- use an injected/frozen clock consistent with IST/business rules;
- do not add arbitrary sleep or timing retries.

If the failure is unresolved:

- stop;
- return `A0_3_NOT_ACCEPTED — SWING_STAGING_ROOT_CAUSE_UNRESOLVED`;
- do not move to evidence rewriting.

---

## Step 3 — correct the route-state proof

This step must test the actual production route serializer/handler, not a constructed object that only resembles its output.

### 3.1 Confirm the production source

Inspect the actual production route and prove:

```ts
const availability = computeAllIndexFnoSetupAvailability();
```

or the repository’s equivalent canonical computation is used independently of optional signal bundles.

Required invariants:

- the production route contains no `indexFnoSetupAvailability ?? []`;
- it contains no equivalent empty-array fallback;
- availability is not derived from a successful signal bundle;
- index signal failures cannot suppress the mandatory policy contract;
- exactly nine records are produced:
  - NIFTY × 3;
  - BANKNIFTY × 3;
  - SENSEX × 3.

Search production and test code for `?? []` near setup availability and report every match.

### 3.2 Execute all six required production states

Test these exact states:

1. Normal signals.
2. No signals.
3. Market closed.
4. Stale or suppressed market data.
5. Partial index failure: at least one supported index fails while another succeeds.
6. All-index failure: all supported index signal computations fail.

For every state, prove:

- actual production route invocation;
- expected HTTP/result status;
- production Zod parse success;
- signal count;
- diagnostics behavior;
- exactly nine setup-availability records;
- three unique records per supported index;
- no duplicate composite keys;
- all entries have `eligibleForEmission: false`.

Mandatory results:

- partial index failure remains schema-valid and truthful;
- all-index failure remains schema-valid and contains all nine availability records;
- neither state returns an avoidable HTTP 500;
- neither state uses `?? []`;
- missing optional `diagnostics` is omitted;
- do not pass `diagnostics: null` unless the production schema intentionally supports null.

The old evidence statement:

`?? [] → [] fails .length(9)`

is not acceptable as an all-index-failure proof. Replace it with actual production behavior.

### 3.3 Preserve rejection tests

Confirm the production validator still rejects:

- fewer or more than nine entries;
- duplicate index/setup keys;
- missing index/setup combinations replaced by duplicates;
- invalid status/reason combinations;
- invalid index symbols;
- `eligibleForEmission: true`.

---

## Step 4 — complete the missing targeted checks

Run and report separately:

1. Actual production disclosure-component test.
2. Scanner setup-availability test.
3. Trading-boundary test suite.
4. EMA-pullback null-VWAP proof:
   - absence of authentic VWAP cannot create a VWAP factor, driver, confidence contribution, veto or VWAP-labelled entry condition;
   - if EMA pullback is legitimately allowed to emit using non-VWAP conditions, prove those conditions and provenance explicitly;
   - changing any spot/geometry anchor must not change VWAP score, driver or veto state.
5. Full-workspace typecheck using the repository’s actual root command.

If the repository has no root typecheck command, report that fact and run every workspace package typecheck that composes the full workspace. List all included and excluded packages.

---

## Step 5 — focused verification before the full pass

After any justified correction, run:

- `swingOrderStaging.test.ts`;
- new or updated override/isolation tests;
- actual production route-state tests;
- disclosure component;
- scanner availability;
- trading boundary;
- A0.3.3 behavioral tests `35/35`;
- accepted backend baseline `160/160`.

Every focused gate must have zero failures before continuing.

---

## Step 6 — one final acceptance manifest

Run the complete acceptance package once after the focused gates pass:

| Gate | Required result |
|---|---:|
| Accepted backend baseline | `160/160` |
| A0.3.3 behavioral | `35/35` |
| Other A0.3 acceptance | `232/232` unless file counts legitimately changed and are reconciled |
| Normal-order A0.3 manifest | exact reconciled total, previously `427/427` |
| Reverse-order A0.3 manifest | same reconciled total |
| Scanner | `843/843` |
| Swing staging file | all tests passing |
| Full API server | zero failures |
| API server typecheck | pass |
| API Zod typecheck | pass |
| API React client typecheck | pass |
| Scanner typecheck | pass |
| Full workspace typecheck | pass |
| Scanner production build | pass |
| API production build | pass |
| `git diff --check` | pass |

Report exact per-file counts and reconcile every aggregate arithmetically.

For the full API suite, list every skipped test and reason. Prove no new skip/only marker was introduced.

No “pre-existing regression exception” is permitted for final A0.3 unit acceptance. The complete suite must have zero failures.

---

## Step 7 — repair the evidence record truthfully

Update the existing file only:

`artifacts/audit-evidence/PHASE_A0_3_SETUP_VIABILITY_AND_HONEST_RETIREMENT.md`

Do not create a competing evidence file.

### Evidence chronology

Record separately:

- implementation HEAD;
- whether production/test corrections are uncommitted;
- evidence-file working-tree modification;
- untracked attachments;
- final tracked and untracked state.

If the evidence file is modified without a commit, `git diff` should normally show it. If it does not:

- inspect its index flags with read-only commands;
- determine whether it is ignored, assume-unchanged, skip-worktree or otherwise excluded;
- do not silently clear index flags;
- report the exact condition as a blocker if truthful evidence cannot be captured.

### Required final section

Append or replace only the incorrect final closure section. Preserve earlier valid A0.1/A0.2/A0.3 evidence.

Include:

- root cause and correction for the swing test;
- checkpoint-comparison evidence;
- partial-index and all-index route proof;
- missing targeted checks;
- complete acceptance results;
- exact Git state;
- statement that no commit, push or deployment occurred;
- production deployment status.

Use one exact final terminator:

`END_PHASE_A0_3_FINAL_BLOCKER_CLOSURE`

After the final byte:

1. Verify the terminator occurs exactly once.
2. Verify it is the final nonblank line.
3. Calculate the final SHA256 externally.
4. Run the final Git-state commands after the evidence write.
5. Do not describe the working tree as clean if the tracked evidence file or untracked attachments remain.

Do not place the evidence file’s own SHA256 inside the same hashed content.

---

## Step 8 — final Git and governance record

Report:

- starting HEAD;
- final HEAD;
- whether HEAD changed during this task;
- branch;
- upstream;
- locally recorded ahead/behind;
- exact tracked modifications;
- exact staged modifications;
- exact untracked files;
- `git diff --stat`;
- `git diff --name-status`;
- `git diff --cached --stat`;
- checkpoint ancestry;
- whether a commit was executed;
- whether a push was executed;
- whether a deployment/publish action was executed.

The earlier auto-commit `faa1d0ad` must be documented as a governance event. Do not revert it automatically.

Do not claim live remote verification because fetch is prohibited. State only what the locally recorded upstream and current task actions prove.

---

## Acceptance decision

Return:

`ACCEPT_A0_3_AS_UNIT_VERIFIED`

only when:

- swing staging root cause is proven;
- the failing test and complete file pass deterministically;
- full API suite has zero failures;
- partial-index and all-index production route states are valid;
- all-index failure returns the canonical nine availability records;
- no `?? []` availability fallback remains;
- missing targeted checks pass;
- full-workspace typecheck passes;
- all prior A0.3 gates remain green;
- evidence/Git state is internally consistent;
- no commit, push or deployment was performed.

Otherwise return:

`A0_3_NOT_ACCEPTED — <ONE EXACT BLOCKER>`

Production status remains:

`PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`

Unit acceptance must never be presented as production acceptance.

---

## Required final response — no execution diary

Return only:

### 1. Verdict

### 2. Swing regression

- expected invariant;
- reproducibility matrix;
- checkpoint comparison;
- root cause;
- exact correction;
- focused test results.

### 3. Six production route states

A six-row table, explicitly including partial-index and all-index failure.

### 4. Acceptance results

A reconciled table for all targeted, A0.3, scanner and full API gates.

### 5. Typechecks and builds

Exact commands and exit results.

### 6. Skipped-test integrity

Every skipped test and confirmation of no new skip/only markers.

### 7. Git state

Exact tracked, staged and untracked state without calling a dirty tree clean.

### 8. Evidence integrity

- path;
- SHA256;
- terminator verification;
- final evidence chronology.

### 9. Production status

`PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`

Stop there. Do not propose additional features, Phase A0.4, publishing or deployment.
