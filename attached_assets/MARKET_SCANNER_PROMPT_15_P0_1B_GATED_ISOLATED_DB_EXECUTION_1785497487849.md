# MARKET SCANNER — P0.1B GATED ISOLATED DATABASE EXECUTION

## Important owner notice

**Do not execute this prompt yet.**

Use it only after the owner has manually:

1. created a dedicated test-only PostgreSQL cluster;
2. confirmed its hostname/project identity differs from operational;
3. created the required provisioning identity;
4. added `TEST_DB_PROVISIONING_URL` to Replit Secrets without exposing it;
5. supplied the two exact authorization statements defined below.

This file by itself is not authorization to connect, provision, migrate or run
DB tests.

---

## Role

Act as the senior database-test execution engineer for Devendra’s Market
Scanner.

The normal-suite database safety architecture is accepted. This task performs
the first controlled execution of the isolated disposable-database lifecycle.

Do not touch operational data, trading logic, UI, APIs or the 115 known residue
rows.

---

## 1. Mandatory authorization gate

Before doing anything beyond read-only local preflight, require the owner’s
current message to contain both exact statements:

`TEST_DB_PROVISIONING_URL_PRESENT_REDACTED_AND_TEST_HOST_SEPARATE`

`AUTHORIZE_P0_1B_ISOLATED_DB_TEST_EXECUTION`

If either statement is absent, stop immediately and return:

`WAITING_FOR_OWNER_P0_1B_PROVISIONING_AND_EXECUTION_AUTHORIZATION`

Do not inspect secret presence, connect, modify the runtime lock or execute any
command after that stop.

Never infer authorization from this prompt’s text.

---

## 2. Authoritative status

### A0.3

`ACCEPT_A0_3_AS_UNIT_VERIFIED`

A0.3 remains frozen.

### P0.1B safety

`ACCEPT_P0_1B_SAFETY_CLOSURE_READY_FOR_OWNER_PROVISIONING`

### Owner runbook

`P0_1B_OWNER_PROVISIONING_RUNBOOK_READY`

Runbook evidence:

- path:
  `artifacts/audit-evidence/PHASE_P0_1B_OWNER_PROVISIONING_READINESS_RUNBOOK.md`;
- SHA-256:
  `60c32409bbfd09986b26619c6b447b70d2d6b98aa93091af16fccf164dee5490`;
- terminator count: 1.

### Production

`PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`

---

## 3. Scope

Complete only:

1. authorization and secret-presence preflight;
2. redacted endpoint-separation validation;
3. two small pre-execution evidence corrections;
4. temporary runtime-lock enablement;
5. two isolated disposable DB-test runs;
6. schema bootstrap and cleanup verification;
7. restoration of the runtime lock to false;
8. non-DB regression confirmation;
9. evidence and Git reporting.

Do not perform operational residue cleanup or production deployment.

---

## 4. Prohibited actions

Never:

- print or log either database URL;
- display hostname, username, password or query parameters;
- copy secrets into source, evidence, comments or test fixtures;
- connect to the operational database;
- reuse the operational server for test databases;
- run DB tests without both authorization statements;
- disable endpoint-separation guards;
- weaken identifier validation;
- omit cleanup;
- clean the 115 operational residue rows;
- commit, push, pull, fetch, deploy or publish;
- start another product phase.

Do not use a real secret value in shell command text that may be logged.

---

## 5. Governance

1. Record current HEAD, branch, upstream, ahead/behind and working-tree state.
2. Use current HEAD as the execution baseline.
3. Record `attached_assets/`-only platform auto-commits and continue.
4. Stop for any unrelated source/schema/migration/dependency/build change.
5. Preserve unrelated user changes.
6. No manual commit is authorized.
7. Do not revert platform commits automatically.

---

## 6. Step 1 — Authorization and environment preflight

After confirming both authorization statements:

1. Confirm `TEST_DB_PROVISIONING_URL` is present without printing its value.
2. Confirm operational `DATABASE_URL` is present without printing its value.
3. Parse both URLs in memory.
4. Compare normalized endpoint identity.
5. Confirm test and operational host/project identity differ.
6. Confirm test URL uses PostgreSQL protocol.
7. Confirm test endpoint/project naming satisfies test-only policy.
8. Confirm the provisioning role matches the minimum required privilege model.
9. Confirm the test cluster is not a production replica.
10. Confirm the provisioning URL remains parent-only.

Report only redacted booleans and reason codes.

If any check fails:

- do not connect;
- do not change the runtime lock;
- return `P0_1B_EXECUTION_BLOCKED_BY_PREFLIGHT`;
- report only the failed check and owner action.

---

## 7. Step 2 — Correct two evidence-quality issues

Complete these before enabling DB execution.

### 7.1 Manifest collision hardening

The current 4-byte random manifest instance ID has a low but non-zero collision
probability. “No overwrite races possible” is not mathematically correct.

Change the tripwire manifest identity to include:

- OS PID;
- `worker_threads.threadId`;
- cryptographically generated UUID or equivalent high-entropy nonce.

Create manifest files with exclusive/fail-if-exists semantics, such as `wx`.
If a path collision occurs, fail closed.

Add tests proving:

- same PID with different thread IDs produces different paths;
- same PID/thread ID with different UUIDs produces different paths;
- an existing path causes a hard failure, not overwrite;
- aggregation accepts the new schema;
- missing thread/UUID telemetry fails closed.

### 7.2 Prior transient failure correction

The earlier report did not identify the exact failed file/test. Therefore, do
not claim it was a timing/race condition without evidence.

Record it honestly as:

`UNIDENTIFIED_NONREPRODUCED_PRIOR_TEST_FAILURE`

If the original log still exists, report the exact file/test and failure.

If it does not exist:

- state that exact attribution is unavailable;
- cite the two later successful normal-suite runs;
- do not fabricate a cause;
- carry it as a non-blocking test-stability observation unless it recurs.

If it recurs in this task, stop and diagnose it before DB execution.

---

## 8. Step 3 — Pre-connection lifecycle dry verification

Before any connection:

1. Run guard/unit tests.
2. Run disposable-lifecycle mocked tests.
3. Confirm all 17 `*.db.test.ts` files are included only by DB config.
4. Confirm normal config excludes them.
5. Confirm provisioning credential cannot enter the Vitest child.
6. Confirm generated runtime role has no elevated privileges.
7. Confirm database/role names include validated run ID.
8. Confirm cleanup validates exact prefixes and identifiers.
9. Confirm schema bootstrap targets only generated `TEST_DATABASE_URL`.
10. Confirm external services are disabled in child environment.

Any failure blocks execution.

---

## 9. Step 4 — Temporary runtime-lock enablement

Only after all preceding checks pass, change:

`DB_TEST_RUNTIME_AUTHORIZED = false as boolean`

to:

`DB_TEST_RUNTIME_AUTHORIZED = true as boolean`

This change is temporary for the two authorized runs.

Do not commit it.

Record its diff and verify no other authorization guard changed.

---

## 10. Step 5 — Isolated DB execution Run A

Run only the official guarded command found in the package scripts.

Expected lifecycle:

1. generate unique run ID A;
2. derive validated disposable DB name A;
3. derive/create restricted runtime role A;
4. create database A on the test-only cluster;
5. bootstrap schema A;
6. run all 17 DB-only test files;
7. capture exact file/pass/skip/fail output;
8. drop database A and role A;
9. verify cleanup.

Fail closed if:

- endpoint identity changes;
- generated names are invalid;
- schema bootstrap fails;
- any child receives the provisioning credential;
- external service is reachable/enabled;
- cleanup cannot identify the exact run resources.

On failure, perform only validated test-resource cleanup and stop. Never broaden
the cleanup target.

---

## 11. Step 6 — Isolation Run B

Only if Run A completes safely, execute a second official run.

Require:

- run ID B differs from A;
- database B differs from A;
- role B differs from A;
- no Run A resources exist before Run B;
- all DB tests run against B only;
- B resources are removed afterward.

This proves per-run isolation and cleanup repeatability.

Do not reuse A’s database or runtime role.

---

## 12. Step 7 — Mandatory lock restoration

After Run B—or after any Run A/B failure—restore:

`DB_TEST_RUNTIME_AUTHORIZED = false as boolean`

Verify the final working tree contains the false value.

Acceptance is prohibited if the lock remains true.

Do not rely on memory or a later cleanup task to restore it.

---

## 13. Step 8 — Required post-run verification

Run and report:

1. guard/unit tests;
2. full normal API suite under the process-wide tripwire;
3. A0.3 route-handler tests;
4. A0.3 HTTP route tests;
5. scanner suite;
6. API-server typecheck;
7. API-Zod typecheck;
8. API-client React typecheck;
9. scanner typecheck;
10. workspace/global typecheck if supported;
11. API-server build;
12. scanner build;
13. API-client/frontend build if supported;
14. `git diff --check`;
15. exact runtime-lock value;
16. no new skip/only/retry/sleep/assertion weakening;
17. no secret or connection-string leakage.

Report exact commands and counts.

---

## 14. Step 9 — Test-resource cleanup proof

Using sanitized identifiers only, prove:

- disposable DB A absent;
- runtime role A absent;
- disposable DB B absent;
- runtime role B absent;
- no orphan test database matching this task’s run IDs;
- no orphan runtime role matching this task’s run IDs;
- operational DB was never targeted;
- provisioning URL was never passed to tests.

Do not enumerate or modify unrelated test resources.

---

## 15. Operational residue remains separate

The known 115 operational rows remain untouched.

This prompt does not authorize:

`AUTHORIZE_OPERATIONAL_TEST_RESIDUE_CLEANUP`

Do not query, export, delete or update those records.

---

## 16. Evidence

Append an execution section to:

`artifacts/audit-evidence/PHASE_P0_1B_SAFE_TEST_DATABASE_INFRASTRUCTURE.md`

Include:

1. owner authorization statements present;
2. redacted preflight results;
3. manifest collision hardening;
4. prior failure’s honest classification;
5. temporary lock enablement;
6. Run A identifiers in sanitized/hash form;
7. Run A DB-test results;
8. Run A cleanup;
9. Run B distinctness;
10. Run B DB-test results;
11. Run B cleanup;
12. final lock restoration;
13. normal regression results;
14. no secret leakage;
15. Git record;
16. production status.

Use exactly once as the final nonblank line:

`END_PHASE_P0_1B_GATED_ISOLATED_DB_EXECUTION`

After writing:

- compute SHA-256;
- verify exact terminator count is 1;
- verify it is the final nonblank line.

Do not put a recursive self-hash inside the evidence file.

---

## 17. Git record

Report:

- starting/final HEAD;
- branch/upstream/ahead/behind;
- platform auto-commits;
- exact changed files;
- diff stat/status;
- staged/untracked state;
- runtime-lock diff and restoration;
- manual commit: none;
- push/pull/fetch/deploy: none.

---

## 18. Acceptance decision

Return:

`ACCEPT_P0_1B_ISOLATED_DB_EXECUTION_VERIFIED`

only if:

1. both authorization statements were present;
2. endpoint separation passed;
3. no secret was exposed;
4. manifest identity was hardened;
5. prior failure was classified honestly;
6. Run A and Run B used distinct resources;
7. all 17 DB-test files passed in both runs;
8. schema bootstrap passed in both runs;
9. all A/B resources were cleaned;
10. no operational endpoint was targeted;
11. child never received provisioning credentials;
12. external services remained disabled;
13. normal regressions/typechecks/builds passed;
14. runtime lock was restored to false;
15. evidence/Git integrity is complete;
16. no commit, push, deployment or operational cleanup occurred.

If any gate fails, return:

`P0_1B_ISOLATED_DB_EXECUTION_NOT_ACCEPTED`

Report the failed gate, sanitized evidence and smallest safe correction. Do not
rerun repeatedly or broaden scope.

---

## 19. Required final response

Return one concise evidence report:

1. **Verdict**
2. **Authorization/preflight**
3. **Manifest hardening**
4. **Prior failure classification**
5. **Run A results and cleanup**
6. **Run B results and cleanup**
7. **DB test totals**
8. **Post-run normal regressions**
9. **Final runtime-lock state**
10. **Secret/redaction proof**
11. **Git/evidence integrity**
12. **Remaining operational residue**
13. **Production status**

End with:

`PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`

---

## Final instruction

Do not execute this file until the owner has provisioned the isolated cluster,
added the required secret and supplied both authorization statements.

Once authorized, execute exactly two isolated runs, restore the lock to false,
verify cleanup and stop. Do not touch operational data or production.
