# MARKET SCANNER — P0.1B SAFETY CLOSURE AND DISPOSABLE TEST-DB RUNNER

## Role

Act as the senior platform-safety engineer for Devendra’s Market Scanner.

This is a bounded continuation of P0.1B. Do not reopen completed phases, conduct
another broad audit, or claim that P0.1B is fully complete merely because a
provisioning design exists.

Your job is to close the remaining test-safety defects, restore all non-DB test
coverage, implement the disposable-test-database lifecycle behind testable
abstractions, and prepare an owner-reviewable cleanup plan for confirmed test
residue in the operational database.

This prompt does **not** authorize:

- connection to or creation of a real external test database;
- execution of DB-backed test suites;
- mutation or cleanup of the operational database;
- changing the DB runtime authorization lock;
- deployment, publishing, pushing or manual committing.

---

## 1. Authoritative status

### Phase A0.3

`ACCEPT_A0_3_AS_UNIT_VERIFIED`

A0.3 is frozen. Do not modify its F&O detector logic, VWAP behavior, route
contract, UI disclosure, thresholds, confidence weights, targets, stops or
paper-admission rules.

### P0.1B

Current verdict:

`P0_1B_SAFETY_REPAIR_PARTIALLY_ACCEPTED — IMPLEMENTATION_AND_EVIDENCE_GAPS_REMAIN`

Accepted findings from the previous task:

- `DATABASE_URL` is present and operational.
- No isolated test database has been provisioned.
- `DB_TEST_RUNTIME_AUTHORIZED` remains `false as boolean`.
- The official DB runner is still hard-blocked.
- A weak DB-test guard allowed ordinary Vitest execution to run DB tests when
  the operational `DATABASE_URL` was present.
- A read-only operational-database assessment found:
  - 10 rows in `paper_trade_eq`;
  - 105 rows in `paper_eq_audit`;
  - marker symbols `TESTSTK` and `GAP1TST*`;
  - dates from 2026-07-10 through 2026-07-18.
- No residue was deleted.
- DB-backed tests were renamed to the `*.db.test.ts` taxonomy.
- Separate DB and non-DB Vitest configurations were introduced.
- `dbTestGuard.test.ts` reports 126/126.
- The non-DB API suite was reported as 4305/4305.
- Scanner tests were reported as 843/843.

Do not discard these improvements. Verify them and correct only what remains
incomplete or contradictory.

---

## 2. Confirmed remaining defects

You must address all of the following and no unrelated work.

### P0.1B-01 — Pure tests were moved into a DB-only file

The prior inventory says `swingOrderStaging` contains:

- 19 DB-dependent tests in the main DB block;
- 6 DB-dependent GAP-1 tests;
- 4 pure `deriveStageStatus` tests;
- 2 static Cases 19/20;
- 31 tests overall.

Renaming the entire file to `swingOrderStaging.db.test.ts` removes the six
non-DB tests from the ordinary suite.

The six pure/static tests must remain part of normal non-DB regression coverage.

### P0.1B-02 — Test totals do not reconcile

The prior accepted full API result was:

`4325 passed / 3 skipped`

The new non-DB result was:

`4305 passed / 0 skipped`

Fifteen new guard tests were reportedly added.

These numbers cannot be accepted without exact per-file arithmetic explaining:

- every removed DB-dependent test;
- every restored pure test;
- every newly added guard test;
- the three formerly skipped provenance tests;
- any other count difference.

### P0.1B-03 — Ordinary test commands are not yet conclusively safe

Creating `vitest.config.noDb.ts` is not enough by itself.

Every ordinary package, workspace and CI test command must be proven to use a
configuration that excludes `**/*.db.test.ts`.

Bare/default Vitest discovery must also fail safe. A developer must not be able
to accidentally run DB-backed tests against `DATABASE_URL` by invoking the
normal test command.

### P0.1B-04 — Import-time safety is not executable-proofed

An in-file `describe.skip` or `describe.skipIf` occurs after module imports.
Static imports must not initialize a DB client, create a pool connection,
register a DB hook or start an external service before the isolation guard has
passed.

Source inspection alone is not sufficient for the final proof.

### P0.1B-05 — Evidence contains a factual contradiction

The previous report says both:

- a `BEGIN READ ONLY` operational-DB assessment found 115 residue rows; and
- “No DB connection.”

The correct statement is:

`READ_ONLY_OPERATIONAL_DB_CONNECTION_USED — NO_OPERATIONAL_DB_MUTATION`

Correct the evidence without concealing the read-only access.

### P0.1B-06 — Disposable DB lifecycle is designed but not implemented

The previous response describes generation, creation, migration, execution and
cleanup of a per-run database, but its changed-file summary only proves
test-configuration and runner-selection changes.

The lifecycle must be implemented behind dependency-injected/testable adapters
and verified without contacting a real database.

### P0.1B-07 — Provisioning credential would be over-privileged in the child

Do not derive the child test URL using a credential that retains `CREATEDB`,
`CREATEROLE`, superuser, replication or bypass-RLS privileges.

The provisioning credential must never enter the Vitest child environment.

### P0.1B-08 — Operational residue requires an owner-approved cleanup plan

The 115 confirmed rows may distort paper-trading history, P&L, reconciliation,
performance analytics and UI reports.

Do not delete or update them in this task. Produce a precise, reversible,
transaction-safe remediation plan for later authorization.

---

## 3. Governance and anti-loop rules

1. Record the current HEAD, branch, upstream, ahead/behind and working-tree
   state before editing.
2. Treat the observed current HEAD as this task’s execution baseline.
3. Do not require an obsolete historical HEAD hash to match.
4. If the platform auto-commits only newly uploaded files under
   `attached_assets/`, record the event and continue. Do not enter a stop-and-
   authorization loop.
5. If HEAD changes with any production, test, schema, dependency, build,
   migration or configuration file that was not changed by this task, stop and
   report the exact commit and file inventory.
6. Preserve unrelated user changes.
7. Do not use `git reset`, checkout-based rollback, force operations, stash,
   rebase, pull, fetch or push.
8. Do not create a manual commit.
9. Do not deploy or publish.
10. Do not modify `DB_TEST_RUNTIME_AUTHORIZED`.
11. Do not set, print, copy or request secrets in chat.
12. Do not run any DB-backed test command.
13. Do not connect to a real test database.
14. Do not execute any SQL against the operational database in this task.
    Use the already-recorded read-only residue evidence.
15. If a required fact is unavailable, report that exact fact as pending
    instead of guessing.

---

## 4. Step 1 — Preflight and exact changed-surface inventory

Before editing:

1. Record IST timestamp.
2. Record:
   - `git rev-parse HEAD`;
   - branch;
   - upstream;
   - ahead/behind;
   - `git status --short`;
   - `git diff --stat`;
   - `git diff --cached --stat`.
3. List all current P0.1B changes by status:
   - added;
   - modified;
   - renamed;
   - deleted.
4. Confirm the old `*.test.ts` DB-backed paths and the new
   `*.db.test.ts` paths.
5. Read fully before editing:
   - root `package.json`;
   - workspace/package test scripts;
   - all Vitest configuration files;
   - `dbTestPreflightRunner.ts`;
   - `dbTestGuard.ts`;
   - `dbTestGuard.test.ts`;
   - both DB-backed test files;
   - the production modules imported by those test files;
   - relevant CI/workflow definitions;
   - `lib/db` initialization code;
   - Drizzle configuration and schema/migration commands;
   - current P0.1B evidence.

Do not perform another repository-wide product audit.

---

## 5. Step 2 — Restore the six non-DB tests

Classify every test in the swing staging file individually.

Create a table containing:

| Test name | Case number | DB required? | External service required? | Target file |
|---|---:|---|---|---|

Then:

1. Keep only truly DB-dependent tests in
   `swingOrderStaging.db.test.ts`.
2. Move the four pure `deriveStageStatus` tests and the two static Cases 19/20
   into an ordinary non-DB test file, for example:

   `swingOrderStaging.pure.test.ts`

3. Preserve test names and assertions.
4. Do not weaken, delete, skip, quarantine or rewrite their business
   expectations.
5. Do not duplicate tests across the two files.
6. If Cases 19/20 are source-inventory tests, make their file targeting
   explicit and stable.
7. Confirm:
   - 25 DB-dependent tests;
   - 6 normal non-DB tests;
   - 31 total swing tests.

If the source proves a different total, provide the exact named inventory and
correct the earlier statement. Do not force the count to 31.

---

## 6. Step 3 — Make all normal test entry points DB-safe

Inventory every test entry point, including:

- root scripts;
- API-server scripts;
- workspace recursive scripts;
- CI commands;
- Replit workflows;
- developer documentation commands;
- default/bare Vitest behavior.

Use one authoritative non-DB configuration.

Required behavior:

1. The ordinary full API test command includes normal `*.test.ts` files.
2. It explicitly excludes `**/*.db.test.ts`.
3. The unit command explicitly excludes `**/*.db.test.ts`.
4. Workspace test commands cannot bypass that exclusion.
5. CI commands cannot bypass that exclusion.
6. The DB configuration includes only `**/*.db.test.ts`.
7. The DB configuration can only be reached through the official guarded DB
   runner.
8. A missing configuration file must cause the script to fail, not fall back
   to default discovery.
9. The normal suite must not depend solely on in-file skips for DB safety.
10. Direct default Vitest discovery must be safe:
    - either the default configuration excludes `**/*.db.test.ts`; or
    - the repository has an equally strong fail-closed mechanism.

Do not leave several competing “full suite” commands with different inclusion
rules.

Update documentation only where needed to make the safe commands unambiguous.

---

## 7. Step 4 — Remove import-time DB exposure

For each `*.db.test.ts` file:

1. Identify every value import.
2. Classify whether the imported module:
   - creates a pool;
   - opens a socket;
   - reads `DATABASE_URL`;
   - registers hooks;
   - starts a scheduler;
   - initializes a provider;
   - performs top-level SQL.
3. Keep `import type` statements where harmless.
4. Ensure DB-connected production modules are not evaluated until after
   `checkDbTestIsolation()` returns `ok: true`.
5. Prefer guarded dynamic imports inside a setup function executed only by the
   official DB suite.
6. Ensure a failed guard reaches no DB-module evaluation path.
7. Ensure the guard itself imports no DB client.

Do not change production behavior merely to accommodate a test.

---

## 8. Step 5 — Add executable zero-connection safety proofs

Add load-bearing tests that fail if DB-backed modules or connection functions
are reached from normal commands.

At minimum prove:

### ZC-01 — Normal configuration exclusion

The authoritative normal configuration excludes all `*.db.test.ts` files.

### ZC-02 — Unit configuration exclusion

The unit configuration excludes all `*.db.test.ts` files.

### ZC-03 — Package-script wiring

Every ordinary API/root/workspace test script selects the safe configuration.

### ZC-04 — CI/Replit wiring

Every committed automated non-DB test workflow selects the safe configuration.

### ZC-05 — DB config isolation

The DB configuration includes only DB tests and is invoked only by the guarded
runner.

### ZC-06 — Missing test DB blocks before imports

With an operational-looking `DATABASE_URL` and no `TEST_DATABASE_URL`, the DB
guard blocks before importing a DB-connected module.

### ZC-07 — Invalid isolation flags block before imports

For every required isolation flag, a missing/invalid value prevents DB-module
evaluation.

### ZC-08 — Connection canary

Use an instrumented/mock/fail-fast connection canary to prove that ordinary
test discovery and the normal suite’s configuration-loading path make zero
calls to:

- `pg.Pool.connect`;
- `pg.Client.connect`;
- Drizzle query execution;
- raw SQL execution.

A source-string assertion alone is not sufficient for ZC-08.

### ZC-09 — No skip-based safety

Prove that the ordinary suite excludes DB files rather than collecting and
skipping them.

### ZC-10 — Pure-test retention

Prove the six pure/static swing tests are collected by the normal suite.

The tests must not make any real network connection.

---

## 9. Step 6 — Reconcile all test counts

Produce exact test-runner output and arithmetic.

Required table:

| Component | Before Prompt 09 | Added | Removed from non-DB | Restored | Final |
|---|---:|---:|---:|---:|---:|
| Existing ordinary API tests | | | | | |
| Swing DB-dependent tests | | | | | |
| Swing pure/static tests | | | | | |
| Provenance DB tests | | | | | |
| Guard/safety tests | | | | | |
| Route tests | | | | | |
| Other | | | | | |
| Total | | | | | |

Also report exact per-file totals for:

- `dbTestGuard.test.ts`;
- `swingOrderStaging.pure.test.ts`;
- `swingOrderStaging.db.test.ts` by static inventory only—do not run it;
- `paperTradingEqProvenance.db.test.ts` by static inventory only—do not run it;
- the full normal API suite;
- the scanner suite.

Explain the prior:

- 26-case statement;
- 31-test statement;
- 4325 result;
- 4305 result;
- final result.

No unreconciled aggregate is acceptable.

---

## 10. Step 7 — Implement the disposable-DB lifecycle without using a DB

Implement the orchestration as a testable module with injected adapters.

Do not connect it to a real database in this task.

### 10.1 Required lifecycle

The logical lifecycle must be:

1. Validate execution authorization.
2. Validate the provisioning endpoint is a dedicated test-only cluster.
3. Generate a cryptographically strong `TEST_RUN_ID`.
4. Normalize it under the existing guard rules.
5. Derive an exact database name such as:

   `nsc_vitest_<normalized_run_id>`

6. Derive a unique restricted runtime-role name.
7. Create the disposable database using the provisioning adapter.
8. Create or assign a restricted runtime role.
9. Bootstrap/migrate the schema.
10. Spawn Vitest with:
    - `NODE_ENV=test`;
    - the generated `TEST_RUN_ID`;
    - the per-run restricted `TEST_DATABASE_URL`;
    - isolation confirmations;
    - external-service disable switches;
    - DB-only Vitest configuration.
11. Capture exit status and sanitized diagnostics.
12. Clean up the database and restricted role.
13. Return the test exit status.

### 10.2 Privilege separation

The provisioning credential:

- may exist only in the parent provisioning process;
- must never be passed to Vitest;
- must never be mapped to child `DATABASE_URL`;
- must never be logged;
- must never be written to evidence;
- must point to a dedicated test-only project/server;
- must be rejected if its normalized host/port/project identity matches the
  operational database.

The child runtime credential must have:

- no `CREATEDB`;
- no `CREATEROLE`;
- no superuser;
- no replication;
- no bypass-RLS;
- access only to its disposable database and required schema objects.

If PostgreSQL/provider capabilities make ephemeral-role creation unsuitable,
use a pre-created restricted runtime role supplied through a second test-only
secret. Do not reuse the provisioning credential in the child for convenience.

### 10.3 Identifier safety

Database and role identifiers must:

- derive only from validated run IDs;
- use strict length and character rules;
- be quoted through a safe identifier mechanism;
- never be interpolated into SQL without identifier quoting;
- be rejected if they contain production names or fall outside the expected
  prefix.

### 10.4 Cleanup policy

Default behavior:

- clean up after success;
- clean up after failure;
- preserve only sanitized logs.

Optional failure retention may exist only when:

- explicitly enabled;
- the cluster is test-only;
- a TTL is recorded;
- a janitor pathway exists;
- the database name is validated again before deletion.

Do not silently retain failed databases indefinitely.

### 10.5 Schema bootstrap

Define one canonical schema bootstrap method.

It must:

- target only the generated test URL;
- fail before Vitest if migration/bootstrap fails;
- never use operational `DATABASE_URL`;
- use the same schema version expected by the application;
- emit sanitized, non-secret diagnostics;
- be idempotent for a fresh disposable database.

---

## 11. Step 8 — Mocked lifecycle tests

Using fake adapters only, prove:

1. Authorization false blocks before provisioning.
2. Missing provisioning configuration blocks before provisioning.
3. Operational/test endpoint identity collision blocks.
4. Invalid run ID blocks.
5. Invalid database name blocks.
6. Invalid role name blocks.
7. Provisioning credential never enters child environment.
8. Child URL uses only the restricted runtime credential.
9. External services are disabled in the child.
10. Schema bootstrap occurs before Vitest.
11. Bootstrap failure prevents Vitest.
12. Vitest success triggers cleanup.
13. Vitest failure triggers cleanup by default.
14. Create-database failure produces no unsafe drop attempt.
15. Partial provisioning triggers only valid compensating cleanup.
16. Cleanup validates the exact database prefix and run ID.
17. Logs redact usernames, passwords, hosts, query strings and tokens where
    required.
18. Two generated runs receive distinct IDs, database names and runtime roles.
19. The operational `DATABASE_URL` is never passed to the child.
20. No real `pg`, Drizzle, provider API or network call occurs in these tests.

Keep `DB_TEST_RUNTIME_AUTHORIZED = false as boolean`.

Implementation readiness does not authorize execution.

---

## 12. Step 9 — Prepare the 115-row remediation plan

Do not query or mutate the operational database in this task.

Use the already-recorded residue evidence. If exact IDs were safely recorded
previously, reference those records. If not, mark exact-ID extraction as a
separate future read-only prerequisite.

Produce a cleanup plan containing:

### 12.1 Scope

- exact marker predicates;
- table names;
- expected row counts;
- date range;
- primary-key inventory status;
- foreign-key/dependency inventory;
- any related P&L, capital ledger, order, notification or reconciliation rows.

### 12.2 Impact

Identify whether the residue can affect:

- paper-trading positions;
- realized/unrealized P&L;
- daily reconciliation;
- dashboards;
- performance history;
- capital balances;
- Telegram reports;
- exports;
- audit evidence.

### 12.3 Backup

Define a deterministic export containing:

- all candidate rows;
- dependent rows;
- primary keys;
- timestamps;
- row counts;
- SHA-256;
- export timestamp;
- no unrelated operational records.

### 12.4 Cleanup transaction

Prepare but do not execute SQL/pseudocode that:

1. begins a transaction;
2. re-selects the exact candidate keys;
3. checks expected counts;
4. aborts if counts or predicates differ;
5. handles dependent tables in the correct order;
6. deletes or quarantines only the authorized rows;
7. verifies zero remaining test-marker rows;
8. verifies operational rows are unchanged;
9. commits only after all invariants pass;
10. can be rolled back before commit.

### 12.5 Owner decision

Return one explicit future authorization request:

`AUTHORIZE_OPERATIONAL_TEST_RESIDUE_CLEANUP`

Do not execute cleanup under this prompt.

---

## 13. Step 10 — Safe verification

Run only non-DB verification.

Required:

1. P0.1B guard/safety tests.
2. Restored six pure/static swing tests.
3. Relevant configuration/script tests.
4. Disposable-runner mocked lifecycle tests.
5. Full authoritative non-DB API suite.
6. Scanner suite.
7. API-server typecheck.
8. API-Zod typecheck.
9. API client typecheck.
10. Scanner typecheck.
11. API-server production build.
12. Scanner production build.
13. `git diff --check`.
14. Search for newly introduced:
    - `.skip`;
    - `describe.skip`;
    - `test.skip`;
    - `.only`;
    - retries;
    - arbitrary sleeps;
    - leaked connection strings.

Forbidden verification:

- DB-backed tests;
- provisioning commands;
- migrations against a real endpoint;
- operational SQL;
- any command that could fall back to operational `DATABASE_URL`.

Before running the full non-DB suite, prove its resolved configuration excludes
`*.db.test.ts`.

---

## 14. Evidence correction and update

Update the existing file:

`artifacts/audit-evidence/PHASE_P0_1B_SAFE_TEST_DATABASE_INFRASTRUCTURE.md`

Append a new bounded section. Do not rewrite prior evidence silently.

The new section must contain:

1. Starting and final HEAD.
2. Changed-file inventory.
3. Pure-vs-DB test classification.
4. Test-script/configuration matrix.
5. Import-time safety proof.
6. Zero-connection test results.
7. Exact count reconciliation.
8. Mocked disposable-lifecycle architecture and results.
9. Privilege-separation proof.
10. Operational residue impact and unexecuted cleanup plan.
11. Correct disclosure:

    `READ_ONLY_OPERATIONAL_DB_CONNECTION_USED_IN_PRIOR_TASK — NO_OPERATIONAL_DB_MUTATION`

12. Confirmation that this task used:

    `NO_DATABASE_CONNECTION`

13. Confirmation:
    - DB runtime lock unchanged;
    - no DB test executed;
    - no secret created or printed;
    - no cleanup executed;
    - no commit;
    - no push;
    - no deploy.
14. Exact commands and results.
15. Evidence SHA-256.
16. Terminator count and final-nonblank-line proof.

Use this terminator exactly once as the final nonblank line:

`END_PHASE_P0_1B_SAFETY_CLOSURE_AND_DISPOSABLE_DB_RUNNER`

Do not claim that a hash stored inside the hashed file recursively validates
itself. Report final SHA-256 after the file is complete.

---

## 15. Acceptance gates

Return:

`ACCEPT_P0_1B_SAFETY_CLOSURE_READY_FOR_OWNER_PROVISIONING`

only if all are true:

1. All DB-dependent tests use `*.db.test.ts`.
2. All six pure/static swing tests run in the normal suite.
3. Every normal package/workspace/CI test command excludes DB tests.
4. Default discovery cannot accidentally run DB tests.
5. DB-connected modules are not evaluated before isolation approval.
6. Executable zero-connection tests pass.
7. All totals reconcile exactly.
8. The disposable lifecycle is implemented behind adapters.
9. Mocked lifecycle tests pass without network/DB access.
10. Provisioning and runtime credentials are separated.
11. The provisioning credential never enters the child.
12. Schema bootstrap order is implemented and mocked.
13. Cleanup behavior is implemented and mocked.
14. Operational residue cleanup is only planned, not executed.
15. The evidence contradiction is corrected.
16. All non-DB regressions, typechecks and builds pass.
17. The DB runtime lock remains false.
18. No secret, DB connection, DB test, commit, push or deployment occurred.

If any gate fails, return:

`P0_1B_SAFETY_CLOSURE_NOT_ACCEPTED`

and list only the failed gate, evidence and exact next action. Do not start
another broad audit.

This acceptance means only:

- ordinary test execution is safe;
- non-DB coverage is restored;
- the disposable runner is implementation-ready;
- owner provisioning can begin safely.

It does **not** mean:

- a real isolated database exists;
- DB tests passed;
- operational residue was cleaned;
- production was deployed or verified.

---

## 16. Required final response

Return one final report—not an execution diary—with these sections:

1. **Verdict**
2. **Files changed**
3. **Pure/DB test classification**
4. **Test-entry-point safety matrix**
5. **Import-time and zero-connection proof**
6. **Exact test-count reconciliation**
7. **Disposable DB lifecycle**
8. **Credential and privilege separation**
9. **Mocked lifecycle test results**
10. **Operational residue impact**
11. **Unexecuted cleanup plan**
12. **Regression, typecheck and build results**
13. **Skipped/only/retry integrity**
14. **Git record**
15. **Evidence integrity**
16. **Owner action required**
17. **Production status**

The owner-action section must state precisely what to create later without
printing or requesting any credential value in chat.

End with:

`PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`

---

## Final instruction

Work linearly and stop when this bounded P0.1B safety closure is complete.

Do not:

- reopen A0.3;
- modify trading logic;
- clean the 115 operational rows;
- provision an external database;
- run DB-backed tests;
- flip the runtime authorization lock;
- add unrelated features;
- initiate another audit;
- commit, push or deploy.

The immediate goal is not to make a DB test pass at any cost. The goal is to
make accidental operational-DB access structurally impossible, preserve all
normal regression coverage, and make the future disposable-DB execution
path safe enough for explicit owner provisioning.
