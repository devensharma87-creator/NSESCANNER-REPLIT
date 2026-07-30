# MARKET SCANNER — A0.3 HTTP ROUTE PROOF ONLY

## Controlling instruction

Do not restart, re-plan or reimplement Phase A0.3.

The newly displayed “Task plan created — Phase A0.3” block is stale and unauthorized. Ignore it completely. The setup-availability, VWAP-honesty and service-layer work already exists and must remain frozen.

This task is limited to completing the missing HTTP route proof for Gate 2.

Gate 1 remains blocked by the absence of a safely isolated test database and the P0.1B runtime lock. Do not touch Gate 1 in this task.

---

## Current accepted evidence

Preserve these results:

- Backend baseline: `160/160`.
- A0.3.3 behavioral suite: `35/35`.
- Other A0.3 acceptance: `232/232`.
- Normal order: `427/427`.
- Reverse order: `427/427`.
- Scanner: `843/843`.
- Full API server: `4,298 passed / 3 skipped / 0 failed`.
- Swing staging fixture repair: accepted.
- Service-layer Gate 2 tests: `6/6`.
- `getOptionSignals()` reportedly returns exactly nine setup-availability records for normal, partial and all-index conditions.
- API-server typecheck passed after the service-test changes.

Do not claim that `routeHandler.a033.test.ts` is an HTTP route test merely because of its filename. It currently proves the `getOptionSignals()` service boundary only.

---

## Current blockers

### Gate 1

`BLOCKED — SAFE_TEST_DATABASE_NOT_CONFIRMED`

Do not:

- run DB tests;
- use operational `DATABASE_URL`;
- change `DB_TEST_RUNTIME_AUTHORIZED`;
- bypass the DB guard;
- create a database or credential;
- modify P0.1B infrastructure.

### Gate 2

Service-level proof exists, but the registered HTTP route/handler, HTTP status, production serialization and final Zod response boundary are not yet executably proven.

---

## Non-negotiable scope

- Do not reopen VWAP, confluence, veto, detector, strategy or setup-retirement logic.
- Do not alter thresholds, confidence, entries, stops, targets or signals.
- Do not modify database code.
- Do not audit unrelated UI or APIs.
- Do not start Phase A0.4.
- Do not create another project task plan.
- Do not update memory files.
- Do not commit, push, pull, fetch or deploy.
- Do not weaken, skip or delete tests.
- Do not add `.skip`, `.only`, retry loops or arbitrary sleeps.

The only permitted production change is the smallest testability seam required to invoke the real registered HTTP route while preserving identical default runtime behavior.

---

## HEAD governance

Capture:

- starting HEAD;
- branch/upstream;
- ahead/behind;
- tracked, staged and untracked files;
- current diff statistics.

The existing documentation auto-commit exception remains valid only for:

- added attachments under `attached_assets/`;
- authorized evidence/memory material created in the immediately preceding session;
- no source, test, schema, configuration or dependency change.

If this prompt is auto-committed as an added attachment, record it and continue.

Stop for any other unexpected HEAD change.

---

# PART 1 — VERIFY THE EXISTING SERVICE TEST ACCURATELY

## 1.1 Classify the six existing tests

List the exact name of every test in `routeHandler.a033.test.ts`.

For each test, state whether it invokes:

- `getOptionSignals()` directly;
- the registered HTTP route;
- the production serializer;
- the production Zod schema;
- a real per-index exception;
- a non-exception `continue`/suppression branch.

Do not describe a continue branch as an exception.

## 1.2 Correct the partial-failure proof if necessary

The partial-index test must force exactly one supported index computation to throw while the remaining supported indices continue.

Required assertions:

- one index exception is caught;
- other indices are still processed;
- successful signals remain when the fixtures produce them;
- failed index appears truthfully in suppression/diagnostics;
- exactly nine availability records remain;
- every entry has `eligibleForEmission: false`;
- all nine `indexSymbol::setupKey` pairs are unique.

If the current partial test only returns null, continues early or suppresses without throwing, add one focused service test for the real exception path.

Do not remove the existing continue-branch test; it proves a different state.

## 1.3 Preserve the all-index exception proof

Confirm that the all-index test forces all supported index computations to throw, rather than merely return no signals.

Required assertions:

- signals are empty;
- all failures are recorded truthfully;
- exactly nine availability records remain;
- the result passes the production response schema.

---

# PART 2 — IDENTIFY THE ACTUAL HTTP BOUNDARY

## 2.1 Read the complete route chain

Read completely:

- the route registration file containing `/api/options/signals` or its actual equivalent;
- middleware applied to that route;
- the route handler;
- `getOptionSignals()`;
- response serialization;
- production Zod schema;
- existing HTTP/integration test harness.

Document:

`test client → registered application/router → middleware → route handler → getOptionSignals → serializer/Zod → HTTP response`

State the exact function that writes the HTTP status and JSON body.

## 2.2 Use the repository’s existing HTTP harness

Prefer the existing supported method:

- `app.inject`;
- Supertest;
- exported router invocation;
- existing request-test helper.

Do not start a persistent server.
Do not call a live or deployed URL.
Do not use a browser.
Do not perform external network requests.

If authentication middleware applies, use the repository’s normal test authentication mechanism. Do not weaken or disable production authentication globally.

---

# PART 3 — TWO-LAYER EXECUTABLE PROOF

The acceptable proof consists of both layers:

1. Actual `getOptionSignals()` service execution with real per-index failure behavior.
2. Actual registered HTTP handler execution with production serialization and schema validation.

Neither layer may be replaced by constructed-object parsing alone.

## 3.1 HTTP normal-state test

Invoke the registered HTTP route through the test application.

Assert:

- HTTP status `200`;
- JSON content type;
- production Zod response parsing succeeds;
- normal signals/diagnostics match the controlled service fixture;
- exactly nine setup-availability records;
- three records per supported index;
- nine unique `indexSymbol::setupKey` pairs;
- every entry has `eligibleForEmission: false`.

## 3.2 HTTP partial-index-failure test

Use the already proved actual service-layer partial-exception result or wire the handler to the real service test seam.

Invoke the registered HTTP route and assert:

- HTTP status `200`;
- production Zod parse succeeds;
- successful-index results survive;
- failed index is represented truthfully;
- exactly nine availability records remain;
- no `?? []` fallback;
- no avoidable HTTP `500`.

## 3.3 HTTP all-index-failure test

Use the already proved actual service-layer all-exception behavior or wire the handler to the real service test seam.

Invoke the registered HTTP route and assert:

- HTTP status `200`;
- production Zod parse succeeds;
- signals array is empty;
- failures/suppression are truthful;
- exactly nine availability records remain;
- three records per supported index;
- nine composite keys are unique;
- every entry has `eligibleForEmission: false`;
- no `?? []` fallback;
- no avoidable HTTP `500`.

## 3.4 Acceptable mocking boundary

It is acceptable to mock external providers and broker/data dependencies.

It is not acceptable to replace:

- the registered route handler;
- final response serialization;
- production Zod parsing;
- canonical availability validation.

If the HTTP route test mocks `getOptionSignals()`, the service-level tests must independently prove the real partial and all-index exception behavior. The final evidence must clearly describe this as a two-layer proof.

Do not claim a single end-to-end test if the evidence is actually split across service and HTTP layers.

---

# PART 4 — TESTABILITY-SEAM GOVERNANCE

The existing `_resetOptionSignalsCacheForTest()` production export must be reviewed.

Prove:

- it changes no runtime behavior unless explicitly called;
- it is not exposed through OpenAPI;
- it is not exported through the generated public API client;
- production code never invokes it;
- it only clears in-memory test state;
- it follows an existing internal test-helper pattern.

Mark it internal/test-only using the repository’s established convention if such a convention exists. Do not invent an environment-dependent production branch.

If another seam is necessary:

- keep it optional;
- preserve the existing production default;
- make no behavioral change;
- add a normal-path equivalence test;
- document the exact reason.

Do not perform a broad dependency-injection refactor.

---

# PART 5 — REQUIRED VERIFICATION

Run:

1. Updated service-level Gate 2 test file.
2. New actual HTTP route test file.
3. Existing route serializer tests.
4. Existing setup-availability tests.
5. A0.3.3 behavioral tests.
6. Accepted backend baseline.
7. API-server typecheck.
8. Scanner typecheck.
9. Full-workspace typecheck.
10. API-server production build.
11. Scanner production build.
12. Full non-DB API-server suite.
13. Scanner suite.
14. `git diff --check`.

Do not run DB-backed tests.

## Count reconciliation

The prior A0.3 manifest was `427/427`.

If new service or HTTP tests are added:

- show the per-file counts;
- calculate the new normal-order total;
- run the same files in reverse order;
- show the same reconciled reverse-order total;
- explain the exact delta from `427`.

The previous full API result was:

`4,298 passed / 3 skipped / 0 failed`

New tests will increase the passed count. Reconcile the new total. The same three DB-isolation skips may remain until Gate 1 is provisioned; list them exactly.

---

# PART 6 — EVIDENCE

Update only:

`artifacts/audit-evidence/PHASE_A0_3_SETUP_VIABILITY_AND_HONEST_RETIREMENT.md`

Do not create another A0.3 evidence file.
Do not modify memory files.

Record:

- service-layer test names and exact coverage;
- whether partial failure throws or continues;
- actual HTTP route path and harness;
- normal HTTP result;
- partial-index HTTP result;
- all-index HTTP result;
- production Zod parse results;
- nine-record assertions;
- testability-seam disposition;
- test/typecheck/build results;
- exact changed-file inventory;
- HEAD chronology;
- no-commit/no-push/no-deploy statement;
- Gate 1 remains blocked.

Use the exact terminator:

`END_PHASE_A0_3_HTTP_ROUTE_PROOF`

Verify:

- terminator occurs exactly once;
- it is the final nonblank line;
- SHA256 is calculated after the final write and reported externally.

If evidence is auto-committed by the platform, record the exact commit and stop only if it includes unauthorized paths.

---

# ACCEPTANCE DECISION

Return:

`PRODUCTION_ROUTE_FAILURE_GATE_PASS — HTTP_VERIFIED`

only when:

- actual service exception paths pass;
- registered HTTP route is invoked;
- HTTP `200` is proven for normal, partial and all-index failure;
- production Zod parsing passes;
- canonical nine-record contract survives every state;
- no avoidable HTTP `500` occurs;
- testability seams preserve normal production behavior;
- all required non-DB regressions pass.

Then state:

`A0_3_FINAL_ACCEPTANCE_BLOCKED_ONLY_BY_SAFE_TEST_DATABASE`

Do not return `ACCEPT_A0_3_AS_UNIT_VERIFIED` because Gate 1 remains blocked.

If the HTTP boundary cannot be tested, return:

`BLOCKED — ACTUAL_HTTP_ROUTE_NOT_EXECUTABLY_PROVEN`

---

# FINAL RESPONSE FORMAT

Return only:

## 1. Gate 2 verdict

## 2. Service-layer proof

Test-by-test table distinguishing exception and continue branches.

## 3. HTTP route proof

Three-row table:

- normal;
- partial-index failure;
- all-index failure.

Include HTTP status, Zod parse, signals, diagnostics and availability.

## 4. Testability seams

Exact production/test changes and normal-path preservation.

## 5. Verification

Tests, typechecks, builds, full non-DB API suite and scanner.

## 6. Git/evidence integrity

HEAD chronology, working-tree state, evidence SHA and terminator.

## 7. Remaining blocker

`BLOCKED — SAFE_TEST_DATABASE_NOT_CONFIRMED`

## 8. Production status

`PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`

Stop. Do not create another Phase A0.3 task plan or propose unrelated work.
