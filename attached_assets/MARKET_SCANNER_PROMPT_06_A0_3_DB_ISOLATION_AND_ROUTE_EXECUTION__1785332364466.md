# MARKET SCANNER — A0.3 FINAL TWO-GATE CLOSURE

## Role

Act as the senior engineer and acceptance-evidence owner for Devendra’s Market Scanner.

Phase A0.3 is functionally green, but final unit acceptance is withheld for exactly two reasons:

1. DB-backed tests were run without proving a safely isolated test database.
2. Partial-index and all-index failure were reasoned from source but not conclusively proved through executable production-handler tests.

Close only these two gates. Do not reopen the broader audit or any already verified A0.3 logic.

---

## Current verified state — preserve it

The latest evidence reports:

- A0.3.3 implementation baseline: `faa1d0ad`.
- Authorized stale-date fixture correction: `be186dd`.
- Current blocker-closure execution baseline at the last verified run: `e201eb146c0f22e40d0965b01919426071bbbbb1`.
- Accepted backend baseline: `160/160`.
- A0.3.3 behavioral suite: `35/35`.
- Other A0.3 acceptance suite: `232/232`.
- Normal-order manifest: `427/427`.
- Reverse-order manifest: `427/427`.
- Scanner: `843/843`.
- Disclosure/scanner targeted tests: `35/35`.
- Trading boundary: `35/35`.
- Swing staging: `31/31`, repeated five times.
- Full API server: `4,298 passed / 3 skipped / 0 failed`.
- Typechecks and builds: passing.
- No production code change, manual commit, push or deployment occurred during the last closure run.
- Production deployment remains unverified.

Do not rerun or rewrite already accepted areas unnecessarily. Preserve all verified behavior.

---

## Controlling verdict

Current status:

`A0_3_NOT_YET_ACCEPTED — DB_ISOLATION_AND_ROUTE_EXECUTION_PROOF_PENDING`

The only acceptable successful conclusion is:

`ACCEPT_A0_3_AS_UNIT_VERIFIED`

Production must still remain:

`PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`

---

## Non-negotiable scope controls

### Do not roam

- Do not reopen VWAP scoring, confluence, veto, setup retirement or EMA-pullback logic.
- Do not change signal thresholds, weights, entry rules, targets, stops, cooldowns or risk controls.
- Do not audit unrelated UI tabs, APIs, providers or trading modules.
- Do not modify Kite, Upstox, IndianAPI, market-hours, scheduler, production DB schema or deployment.
- Do not begin Phase A0.4 or Task #158.

### Do not bypass safety

- Do not run a DB-backed test directly against an unverified `DATABASE_URL`.
- Do not override, patch out, mock away or bypass the DB-isolation guard.
- Do not copy or repurpose production credentials.
- Do not print connection strings, passwords, tokens, host credentials or secrets.
- Do not run destructive SQL against any development, staging, preview-production, production or shared database.
- Do not delete previously created test-looking rows without explicit authorization.

### Repository governance

- Do not commit, amend, merge, rebase, reset, revert, cherry-pick or squash.
- Do not push, pull or fetch.
- Do not deploy or publish.
- Do not stash or discard the working tree.
- Do not stage files.
- Do not add `.skip`, `.only`, retries or arbitrary sleeps.
- Do not weaken an assertion to obtain a passing result.

### Existing attached-assets exception

The owner has already granted a blanket exception for platform auto-commits that:

- have status `A` only;
- add files exclusively under `attached_assets/`;
- contain no symlinks;
- contain no production, test, schema, configuration or dependency changes.

If HEAD changes only because this prompt is auto-added under `attached_assets/`, verify the exact commit inventory, record it and continue without another authorization stop.

Stop immediately for any other unexpected HEAD movement.

---

## Step 1 — fresh preflight

Capture before any test or write:

1. IST timestamp.
2. Current HEAD.
3. Current branch and upstream.
4. Locally recorded ahead/behind.
5. `git status --short --branch`.
6. `git status --porcelain=v2 --untracked-files=all`.
7. `git diff --stat`.
8. `git diff --name-status`.
9. `git diff --cached --stat`.
10. Exact tracked, staged and untracked inventory.

If HEAD differs from `e201eb1`, inspect every intervening commit.

Continue automatically only when every difference satisfies the existing attached-assets-only exception. Otherwise stop with:

`BLOCKED — UNAUTHORIZED_HEAD_MOVEMENT`

Record the actual execution baseline used for this task.

---

# GATE 1 — SAFE TEST-DATABASE ISOLATION

## Step 2 — inspect the existing DB safety contract

Read completely:

- the official `test:db` script;
- DB isolation guard and helper files;
- `paperTradingEqProvenance.test.ts`;
- `swingOrderStaging.test.ts`;
- their setup, cleanup and teardown hooks;
- test environment documentation;
- package scripts and CI configuration relevant to DB tests.

Document the exact conditions required for the guard to pass, including:

- `NODE_ENV`;
- `TEST_DATABASE_URL`;
- `TEST_RUN_ID`;
- database-name or schema-name restrictions;
- forbidden production/development fingerprints;
- cleanup guarantees;
- concurrency restrictions.

Do not modify the guard merely because it blocks execution.

## Step 3 — establish or confirm an isolated test target

Use an already available dedicated test database or disposable test schema only if its isolation can be proven.

Required proof:

1. `TEST_DATABASE_URL` exists and is distinct from operational `DATABASE_URL`.
2. The database or schema name clearly identifies a test target.
3. `NODE_ENV=test`.
4. A unique `TEST_RUN_ID` is assigned for this run.
5. The isolation guard returns success.
6. The test target contains no production or shared operational data.
7. Test rows are namespaced by run ID or isolated by disposable database/schema.
8. Cleanup can affect only the current test target/run.
9. Parallel workers cannot share the same mutable namespace unless the harness explicitly supports it.

Report only redacted fingerprints:

- engine/type;
- redacted host classification;
- database/schema classification;
- whether operational and test targets differ;
- isolation-guard result.

Never disclose credentials.

### If no isolated target exists

Do not create a new database, schema, credential or external resource unless that authority already exists in the task environment and is explicitly intended for tests.

If new infrastructure or credentials are required, stop with:

`BLOCKED — SAFE_TEST_DATABASE_NOT_CONFIRMED`

State exactly what the owner must provision:

- dedicated test database or disposable schema;
- `TEST_DATABASE_URL`;
- permissions limited to the test target;
- `TEST_RUN_ID` support.

Do not fall back to `DATABASE_URL`.

## Step 4 — assess prior direct-test impact read-only

Because earlier DB tests were run directly with `DATABASE_URL`, perform only a read-only assessment of the relevant tables:

- identify whether test-specific symbols, IDs or timestamps remain;
- compare expected setup/teardown counts;
- inspect audit records associated with the known test identifiers;
- determine whether cleanup completed;
- do not delete or modify any row.

Report:

- tables inspected;
- test markers searched;
- remaining suspected rows;
- whether operational records may have been affected;
- confidence and limitations.

If material unexplained test residue exists, stop with:

`BLOCKED — PRIOR_UNISOLATED_TEST_RESIDUE_REQUIRES_OWNER_REVIEW`

Do not clean it automatically.

## Step 5 — run DB tests through the approved pathway

Only after the isolation guard passes, use the official approved DB-test command.

Run:

1. Case 10 in isolation five times, if the official runner supports safe name filtering.
2. Complete `swingOrderStaging.test.ts` five times.
3. `swingCashEventRisk.test.ts`.
4. All three `paperTradingEqProvenance.test.ts` DB tests that previously skipped.
5. Any existing DB-isolation self-tests.

If the official runner safely supports only complete-file execution, do not bypass it to obtain an isolated case run. Record that limitation and use repeated complete-file runs.

Required results:

- isolation guard passes before every DB test batch;
- Case 10 remains deterministic;
- swing staging is fully green;
- all three provenance tests execute and pass;
- no DB test remains skipped due to missing isolation;
- cleanup succeeds;
- post-run residue for the unique `TEST_RUN_ID` is zero or exactly matches the harness’s documented retained evidence.

## Step 6 — DB gate verdict

Return:

`DB_ISOLATION_GATE_PASS`

only when:

- the isolated target is proven;
- the guard passes;
- DB tests use the official pathway;
- previously skipped provenance tests run;
- every DB test passes;
- cleanup and residue checks pass.

Otherwise stop with one exact blocker. Do not proceed to Gate 2 after an unsafe or failed DB gate.

---

# GATE 2 — EXECUTABLE PRODUCTION-ROUTE FAILURE STATES

## Step 7 — identify the real production call chain

Read completely:

- the production HTTP route/handler for option signals;
- the production serializer;
- `getOptionSignals`;
- per-index processing and error handling;
- `computeAllIndexFnoSetupAvailability`;
- production Zod response schema;
- existing route and setup-availability tests.

Document the exact call chain:

`HTTP handler → signal service → per-index processing → result assembly → serializer/Zod → HTTP response`

Confirm through source search that:

- no setup-availability `?? []` fallback remains in production;
- the nine-record availability contract is computed independently of signal success;
- failures are caught at the intended per-index boundary;
- the route can return a schema-valid response after partial or total index-signal failure.

## Step 8 — use an executable failure-injection method

Prefer an existing test seam:

- dependency injection already present;
- module spy/mock;
- provider mock;
- deterministic test adapter;
- existing fixture-controlled throw.

Do not merely construct a response object and parse it.
Do not rely solely on source inspection.
Do not call only `computeAllIndexFnoSetupAvailability()` and treat that as route proof.

The test must invoke the actual production handler or the real exported production route function at the closest executable boundary used by HTTP registration.

### If no safe test seam exists

You are authorized to add the smallest possible testability seam only if all conditions below are met:

- default production behavior is byte-for-byte or semantically unchanged;
- the seam is not exposed through the public API;
- the default dependency remains the current production implementation;
- it changes no strategy, signal, response or availability logic;
- it introduces no environment-based production behavior;
- it is strongly typed;
- tests prove the default path is unchanged.

Before editing, record:

- why existing mocks cannot reach the failure boundary;
- exact file and signature to change;
- proof that runtime behavior will remain unchanged.

Do not add a broad service abstraction or refactor unrelated code.

## Step 9 — required executable tests

### Test A — partial index failure

Force exactly one supported index computation to throw while at least one other supported index succeeds.

Invoke the real production handler/route function and assert:

- HTTP/status result is `200`;
- production Zod response parsing succeeds;
- successful-index signals remain present when fixtures produce them;
- failed index is truthfully represented in diagnostics/suppression;
- exactly nine availability records are present;
- exactly three records exist for each of NIFTY, BANKNIFTY and SENSEX;
- all composite `indexSymbol + setupKey` keys are unique;
- every entry has `eligibleForEmission: false`;
- no avoidable HTTP 500 occurs.

### Test B — all-index failure

Force all supported index computations to throw.

Invoke the real production handler/route function and assert:

- HTTP/status result is `200`;
- production Zod response parsing succeeds;
- signals array is empty;
- diagnostics/suppression truthfully records the failures;
- exactly nine availability records remain present;
- three records exist for each supported index;
- composite keys are unique;
- every entry has `eligibleForEmission: false`;
- no `?? []` fallback executes;
- no avoidable HTTP 500 occurs.

### Test C — normal-path preservation

Invoke the same handler without injected failures and prove:

- existing normal response remains unchanged;
- availability still contains the canonical nine records;
- no test seam affects production defaults.

## Step 10 — route gate verdict

Return:

`PRODUCTION_ROUTE_FAILURE_GATE_PASS`

only when Tests A, B and C execute against the real production route boundary and pass.

If only source reasoning or constructed-object parsing is available, return:

`BLOCKED — ACTUAL_PRODUCTION_ROUTE_NOT_EXECUTABLY_PROVEN`

Do not describe inferred behavior as executable proof.

---

# FINAL VERIFICATION

## Step 11 — focused regression

After both gates pass, run:

- safe DB swing/provenance tests;
- new production-route failure tests;
- route serializer suite;
- setup-availability suite;
- A0.3.3 behavioral suite `35/35`;
- accepted backend baseline `160/160`;
- disclosure/scanner targeted tests;
- trading-boundary tests.

Every test must pass.

## Step 12 — reconciled A0.3 manifest

Run the complete A0.3 acceptance manifest:

1. normal order;
2. exact reverse order.

The earlier total was `427/427`.

If two or more new route tests are added:

- calculate the new total from the displayed per-file counts;
- explain the delta from `427`;
- do not repeat the old aggregate;
- require the same reconciled total in both directions.

## Step 13 — final API and scanner verification

Run:

- complete API-server suite using the safe test environment;
- complete scanner suite;
- API-server typecheck;
- scanner typecheck;
- full workspace typecheck;
- API-server production build;
- scanner production build;
- `git diff --check`.

Expected full API arithmetic:

- previous total: `4,298 passed + 3 skipped = 4,301 existing tests`;
- the three provenance tests should now execute instead of skip;
- new route tests may increase the total;
- report the new exact passed/skipped/failed counts and reconcile the delta.

Required:

- zero failures;
- zero A0.3-related skips;
- the three provenance tests are no longer skipped;
- every remaining skip, if any, is individually named and justified;
- no new `.skip`, `.only`, retry or arbitrary sleep appears.

If any production file changed for the minimal test seam, all typechecks and builds are mandatory.

---

# EVIDENCE AND GIT INTEGRITY

## Step 14 — update the existing evidence file only

Update:

`artifacts/audit-evidence/PHASE_A0_3_SETUP_VIABILITY_AND_HONEST_RETIREMENT.md`

Do not create a competing A0.3 evidence file.

Add a final two-gate closure section containing:

1. Execution baseline and HEAD chronology.
2. DB-isolation contract and redacted proof.
3. Prior direct-test residue assessment.
4. Safe DB command results.
5. All three provenance test results.
6. Partial-index actual production-route result.
7. All-index actual production-route result.
8. Normal-path preservation result.
9. Reconciled normal/reverse A0.3 totals.
10. Full API and scanner results.
11. Typechecks/builds.
12. Exact changed-file inventory.
13. No-commit/no-push/no-deploy declaration.
14. Unit verdict.
15. Production status.

Use the exact final terminator:

`END_PHASE_A0_3_DB_ISOLATION_AND_ROUTE_EXECUTION_CLOSURE`

After the final byte:

- verify the terminator occurs exactly once;
- verify it is the final nonblank line;
- calculate SHA256 externally;
- do not place the file’s SHA256 inside itself.

## Step 15 — final Git record

Capture after the evidence write:

- starting execution HEAD;
- final HEAD;
- branch and upstream;
- locally recorded ahead/behind;
- exact tracked modifications;
- exact staged modifications;
- exact untracked files;
- `git diff --stat`;
- `git diff --name-status`;
- `git diff --cached --stat`;
- all attached-assets-only auto-commits observed;
- whether any manual commit occurred;
- whether any push/fetch/pull occurred;
- whether any deployment occurred.

Do not call a working tree clean when tracked evidence changes or untracked attachments exist.

If HEAD changes because production, test or evidence files are auto-committed, stop and report it. The blanket exception covers additions under `attached_assets/` only.

---

# ACCEPTANCE RULE

Return:

`ACCEPT_A0_3_AS_UNIT_VERIFIED`

only if:

- safe isolated DB is proven;
- isolation guard passes;
- official DB-test pathway is used;
- swing DB tests pass deterministically;
- all three provenance tests execute and pass;
- DB cleanup/residue checks pass;
- actual production handler passes partial-index failure;
- actual production handler passes all-index failure;
- canonical nine-record contract survives both states;
- normal route behavior is preserved;
- normal/reverse manifests reconcile and pass;
- full API suite has zero failures;
- scanner, typechecks, builds and diff check pass;
- evidence and Git chronology are complete;
- no manual commit, push or deployment occurred.

Otherwise return one exact blocker:

- `BLOCKED — SAFE_TEST_DATABASE_NOT_CONFIRMED`
- `BLOCKED — PRIOR_UNISOLATED_TEST_RESIDUE_REQUIRES_OWNER_REVIEW`
- `BLOCKED — ACTUAL_PRODUCTION_ROUTE_NOT_EXECUTABLY_PROVEN`
- `A0_3_NOT_ACCEPTED — <EXACT_FAILED_GATE>`

Production status remains:

`PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`

---

# REQUIRED FINAL RESPONSE

Return only the final evidence record:

## 1. Verdict

## 2. DB isolation

- redacted isolation proof;
- guard result;
- approved command;
- swing/provenance results;
- cleanup/residue results.

## 3. Production-route execution

Three rows:

- normal;
- partial-index failure;
- all-index failure.

Include HTTP status, schema parse, signal count, diagnostics and nine-record assertions.

## 4. Acceptance results

Reconciled per-file and aggregate counts.

## 5. Typechecks and builds

Exact commands and exit results.

## 6. Skipped-test integrity

Every skip and reason; confirm provenance tests executed.

## 7. Git record

Exact HEAD chronology and file state.

## 8. Evidence integrity

Path, SHA256 and terminator verification.

## 9. Production status

`PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`

Stop there. Do not propose Phase A0.4, deployment or unrelated improvements.
