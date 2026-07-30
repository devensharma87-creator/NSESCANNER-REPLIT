# MARKET SCANNER — P0.1B OPERATIONAL-DB SAFETY AND PROVISIONING CONTRACT

## Role

Act as the senior platform-safety engineer for Devendra’s Market Scanner.

The previous P0.1B audit correctly found that no isolated test database exists, but its proposed provisioning solution is not yet internally consistent. Before the owner creates any database or secret, correct the operational-DB exposure and produce one coherent provisioning contract.

This is not permission to run DB tests or provision an external database.

---

## Current authoritative decisions

### A0.3

`ACCEPT_A0_3_AS_UNIT_VERIFIED`

A0.3 is frozen. Do not reopen, re-plan or modify it.

### P0.1B

Current state:

`P0_1B_PROVISIONING_REQUIRED — DESIGN_CORRECTION_REQUIRED_BEFORE_OWNER_ACTION`

Accepted findings:

- `TEST_DATABASE_URL` is absent.
- `DATABASE_URL` is present and operational.
- The official `test:db` runner correctly blocks.
- `DB_TEST_RUNTIME_AUTHORIZED` remains `false`.
- Child-environment allowlisting and external-service overrides are substantially sound.
- Guard unit tests pass `111/111`.
- No isolated DB test execution has been accepted.

### Critical unresolved findings

1. A fixed `TEST_DATABASE_URL` cannot contain a newly generated unique `TEST_RUN_ID` for every run.
2. `swingOrderStaging.test.ts` uses `describe.skipIf(!DATABASE_URL)`, which may allow the ordinary full suite to execute DB tests against the operational database.
3. Module imports may initialize the DB client before an in-file skip/guard can protect it.
4. Schema/migration bootstrap is missing from the official DB runner.
5. The reported 26-versus-31 swing-test inventory is unreconciled.

---

## Mission

Complete only these deliverables:

1. Prove whether prior ordinary full-suite runs could connect to the operational database.
2. Perform a strictly read-only operational-DB residue assessment for known swing-test markers.
3. Prevent all normal/unit-suite DB access to the operational database.
4. Establish a clear unit-test versus DB-integration-test file and runner boundary.
5. Add load-bearing zero-connection safety tests.
6. Reconcile the complete swing-test inventory.
7. Design one coherent unique-database-per-run provisioning contract.
8. Specify migration/bootstrap and cleanup behavior.
9. Return the exact owner provisioning requirements.

Do not provision the database or enable the DB runtime lock in this task.

---

## Non-negotiable restrictions

### Database safety

- Do not run any DB-backed test.
- Do not run the current unrestricted full API test command until the operational-DB exposure is fixed.
- Do not use `DATABASE_URL` as a test target.
- Do not modify, insert, update, delete, truncate or migrate operational data.
- Do not clean suspected test residue.
- Do not print operational connection strings or credentials.
- Do not copy operational credentials into test variables.
- Do not execute destructive SQL, even for verification.

### Runtime lock

- Do not change `DB_TEST_RUNTIME_AUTHORIZED`.
- Do not bypass `checkDbTestIsolation`.
- Do not add `FORCE`, `BYPASS`, `IGNORE`, `SKIP_GUARD` or similar variables.
- Do not downgrade guard failures.

### External resources

- Do not create a Neon, Supabase, Replit, RDS or other database.
- Do not create cloud branches, users, credentials or secrets.
- Do not recommend a paid provider as mandatory.
- Do not require the owner to take provisioning action until the contract is consistent.

### Repository governance

- Do not commit, push, pull, fetch, deploy, reset, revert, rebase or amend.
- Do not stage files.
- Do not add `.skip`, `.only`, retries or sleeps to conceal failures.
- Do not modify A0.3 logic.
- Do not change production trading behavior.

---

## HEAD governance

Capture before work:

- IST timestamp;
- starting HEAD;
- branch/upstream;
- locally recorded ahead/behind;
- tracked, staged and untracked files;
- current diff and exact pre-existing file inventory.

Preserve accepted prior work.

An auto-commit may be treated as documentation-only only when its exact diff contains authorized evidence/memory or added attachments and no implementation change. Stop for any other unexpected HEAD movement.

---

# PHASE 1 — FORENSIC EXECUTION-PATH PROOF

## 1.1 Determine whether the normal full suite executes DB tests

Read completely:

- all API-server test scripts;
- all Vitest configurations;
- file include/exclude rules;
- workspace root test scripts;
- `swingOrderStaging.test.ts`;
- `paperTradingEqProvenance.test.ts`;
- DB imports used by those files;
- `lib/db` initialization;
- setup files and global hooks.

Produce a matrix:

| Command | Config | DB files discovered | DB files executed | DB guard used | Possible operational connection |
|---|---|---|---|---|---|

Include:

- official unit-test command;
- official `test:db`;
- previously used `vitest run --pool=threads`;
- full workspace test command;
- CI commands.

Do not execute an unsafe command merely to populate the matrix. Use source/config analysis and safe test discovery/listing modes.

## 1.2 Trace import-time side effects

For each DB-backed test file, identify:

- every static DB import;
- whether import initializes a pool/client;
- which URL is read;
- whether a connection can open during module evaluation;
- whether `describe.skip` occurs before or after initialization;
- whether test discovery alone can connect.

Required conclusion:

`NO_DB_CONNECTION_BEFORE_VALIDATED_TEST_PREFLIGHT`

If this is not currently true, classify the exact file and import path.

## 1.3 Reconcile the swing-test count

List every test in `swingOrderStaging.test.ts`:

- exact test name;
- DB-backed or pure;
- active/skipped under each runner;
- count in the prior `31/31`;
- count represented by the later “26 cases” statement.

Explain the difference arithmetically. Do not leave two competing totals.

---

# PHASE 2 — READ-ONLY RESIDUE ASSESSMENT

## 2.1 Establish read-only behavior before connecting

If the operational DB must be inspected:

- use a genuinely read-only transaction or read-only role when available;
- set transaction mode to read-only before queries;
- run only explicit `SELECT` statements;
- do not invoke application cleanup helpers;
- do not call migrations;
- do not execute test setup or teardown;
- do not expose sensitive row content.

If read-only access cannot be proven, stop:

`BLOCKED — SAFE_READ_ONLY_OPERATIONAL_DB_ASSESSMENT_UNAVAILABLE`

## 2.2 Identify the exact affected tables and markers

From the complete swing-test source, list:

- every table touched;
- symbol/owner/order prefixes;
- deterministic test identifiers;
- date/time ranges from prior runs;
- audit/event markers;
- foreign-key relationships.

Search only for these known markers.

Report counts and redacted identifiers only. Do not output unrelated operational rows.

## 2.3 Residue verdict

Return one:

- `NO_KNOWN_SWING_TEST_RESIDUE_FOUND`
- `POSSIBLE_SWING_TEST_RESIDUE_FOUND — OWNER_REVIEW_REQUIRED`
- `RESIDUE_ASSESSMENT_INCONCLUSIVE`

Do not delete anything.

---

# PHASE 3 — CLOSE THE OPERATIONAL-DB TEST EXPOSURE

## 3.1 Establish a formal test taxonomy

Adopt a deterministic convention:

- pure/unit tests belong to the normal test suite;
- DB integration tests belong only to the official DB suite;
- DB integration files use one unmistakable naming convention, such as `.db.test.ts`, if compatible with the repository;
- the unit Vitest configuration explicitly excludes DB integration patterns;
- the DB Vitest configuration explicitly includes only DB integration patterns.

Do not rely solely on developers remembering which command to run.

If renaming files is necessary:

- preserve all test bodies and assertions;
- update imports/scripts/configuration;
- report every rename;
- do not change test meaning.

## 3.2 Replace the weak swing guard

Remove reliance on:

```ts
describe.skipIf(!DATABASE_URL)
```

The swing DB suite must require the same validated isolation contract as the provenance DB suite.

Required:

- `NODE_ENV=test`;
- `TEST_DATABASE_URL`;
- operational/test URL inequality;
- valid `TEST_RUN_ID`;
- approved isolation naming;
- isolation confirmation;
- external-service-disable confirmation;
- runtime authorization.

The test file must never consider ordinary `DATABASE_URL` sufficient.

## 3.3 Prevent import-time DB initialization

Ensure DB-backed test modules cannot initialize a DB connection until:

1. the official preflight runner validates the environment;
2. the isolated child environment is created;
3. operational `DATABASE_URL` is removed/replaced inside that isolated child;
4. the DB suite starts.

Use the repository’s safest established method:

- dynamic import after validated preflight;
- dependency injection;
- lazy connection factory;
- isolated test setup file.

Do not introduce a broad production DB refactor unless necessary.

## 3.4 Make the normal suite safe by construction

The normal unit/full non-DB suite must:

- exclude DB test files;
- contain no operational DB secret in the test child environment when not required;
- fail if a DB integration file is accidentally included;
- fail if a DB connection attempt occurs;
- never start DB migrations or cleanup.

Do not call a suite “full” without stating whether DB integration tests are excluded.

---

# PHASE 4 — LOAD-BEARING ZERO-CONNECTION TESTS

Add tests proving:

1. Unit-test discovery does not initialize the DB client.
2. Unit-test execution does not connect to PostgreSQL.
3. DB integration files are excluded from the unit config.
4. DB config includes only the intended DB files.
5. Missing `TEST_DATABASE_URL` blocks before first SQL.
6. Operational URL reuse blocks before first SQL.
7. Weak `DATABASE_URL`-only configuration cannot activate swing DB tests.
8. Static module import cannot bypass the preflight.
9. Child environment contains no operational DB URL.
10. External service secrets are absent.

Use connection-factory spies or controlled mocks. Do not connect to an operational database to prove a negative.

Retain all existing 111 guard tests.

---

# PHASE 5 — CORRECT THE PROVISIONING CONTRACT

## 5.1 Reject the inconsistent fixed-secret design

Do not claim that one fixed `TEST_DATABASE_URL` is sufficient while also auto-generating a different `TEST_RUN_ID` whose value must appear in the database name.

Choose one coherent unique-database-per-run model.

## 5.2 Preferred model: dedicated test-only cluster with disposable DB per run

Design the contract:

1. A dedicated test-only PostgreSQL server/cluster/branch exists.
2. It contains no operational data.
3. A restricted provisioning credential can create/drop databases only within this test-only environment.
4. The runner generates `TEST_RUN_ID`.
5. The runner creates:

   `nsc_vitest_<normalized_TEST_RUN_ID>`

6. The runtime test role connects only to that database.
7. Actual migrations are applied.
8. Tests execute.
9. Residue is checked.
10. Connections close.
11. The exact disposable DB is removed or retained under an explicit failure-retention policy.

Required secrets may include:

- a test-only provisioning URL/credential;
- a restricted runtime credential or safe derived connection template.

Do not use a provisioning credential from an operational cluster.

## 5.3 Alternative model: externally supplied URL per run

If no controlled provisioning credential is permitted:

- the owner/CI creates a unique test database for each run;
- the owner supplies both the exact `TEST_RUN_ID` and matching `TEST_DATABASE_URL`;
- the runner verifies the database name contains that exact run ID;
- the runner does not auto-generate a conflicting ID;
- a second run requires a second unique database/URL.

State clearly that this is not one permanent fixed secret.

## 5.4 Do not use schema-per-run

Schema-per-run remains rejected unless all ORM, raw SQL and migrations are first proven schema-aware. Do not modify every query in this task.

## 5.5 Provisioning decision

Select:

- `DYNAMIC_DISPOSABLE_DATABASE_PER_RUN`; or
- `EXTERNALLY_PROVISIONED_DATABASE_PER_RUN`.

Provide:

- exact secret names;
- who generates the run ID;
- who creates the DB;
- naming rule;
- role permissions;
- migration authority;
- cleanup authority;
- failed-run retention policy;
- concurrency behavior;
- cost/resource considerations without claiming a provider is mandatory.

---

# PHASE 6 — MIGRATION AND CLEANUP DESIGN

Implement or specify:

1. Validated preflight.
2. Unique DB creation/resolution.
3. Active-target fingerprint verification.
4. Production migrations applied to the isolated database.
5. Required table/constraint verification.
6. DB tests.
7. Residue check.
8. Connection-pool closure.
9. Exact database cleanup or controlled retention.

Safety requirements:

- no unqualified cleanup target;
- no database name derived from an empty value;
- exact prefix and run-ID verification;
- no wildcard deletion;
- no operational host/cluster match;
- cleanup idempotency;
- cleanup cannot affect another run.

Do not enable the runtime lock in this task.

---

# PHASE 7 — SAFE VERIFICATION

Until an isolated DB exists, run only:

- guard/unit safety tests;
- test-discovery/exclusion tests;
- zero-connection tests;
- typechecks;
- builds;
- scanner suite;
- full non-DB API suite using the corrected safe unit configuration;
- `git diff --check`.

Do not run:

- official DB suite;
- swing DB tests;
- provenance DB tests;
- migrations;
- cleanup;
- unrestricted `vitest run` that discovers DB files.

Report the non-DB suite explicitly as:

`FULL_NON_DB_API_SUITE`

Do not present it as complete DB-integrated verification.

---

# PHASE 8 — EVIDENCE

Update:

`artifacts/audit-evidence/PHASE_P0_1B_SAFE_TEST_DATABASE_INFRASTRUCTURE.md`

Include:

1. Operational-DB execution-path analysis.
2. Import-time connection analysis.
3. Swing-test count reconciliation.
4. Read-only residue assessment.
5. Test taxonomy and runner separation.
6. Weak-guard correction.
7. Zero-connection tests.
8. Selected provisioning model.
9. Corrected owner provisioning checklist.
10. Migration/bootstrap design.
11. Non-DB regression results.
12. Exact changed-file inventory.
13. Git chronology.
14. No-commit/no-push/no-deploy declaration.
15. Runtime lock remains disabled.

Use the final terminator:

`END_PHASE_P0_1B_OPERATIONAL_DB_SAFETY_AND_PROVISIONING_CONTRACT`

Verify:

- exactly one occurrence;
- final nonblank line;
- SHA256 calculated externally after the final write;
- no secret or operational row content appears.

---

# ACCEPTANCE

Return:

`ACCEPT_P0_1B_SAFETY_REPAIR_AND_PROVISIONING_CONTRACT`

only when:

- ordinary/unit suites cannot discover or execute DB integration tests;
- operational `DATABASE_URL` cannot activate swing DB tests;
- no import-time DB connection bypass exists;
- zero-connection tests pass;
- all 111 existing guard tests remain green;
- swing test counts reconcile;
- residue assessment is complete or safely classified;
- the provisioning/run-ID contract is coherent;
- migration and cleanup design is complete;
- runtime authorization remains disabled;
- safe non-DB regressions pass;
- evidence is complete.

This verdict does not mean the isolated DB has been provisioned or DB tests have executed.

If blocked, return:

- `BLOCKED — SAFE_READ_ONLY_OPERATIONAL_DB_ASSESSMENT_UNAVAILABLE`
- `BLOCKED — POSSIBLE_OPERATIONAL_DB_TEST_RESIDUE`
- `P0_1B_NOT_ACCEPTED — <EXACT_BLOCKER>`

Production remains:

`PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`

---

# REQUIRED FINAL RESPONSE

Return only:

## 1. Verdict

## 2. Operational-DB exposure and correction

## 3. Swing-test inventory reconciliation

## 4. Read-only residue assessment

## 5. Unit-versus-DB runner boundary

## 6. Zero-connection safety tests

## 7. Corrected provisioning contract

## 8. Migration and cleanup design

## 9. Safe non-DB regression results

## 10. Git/evidence integrity

## 11. Exact owner provisioning action

Do not enable the DB runtime lock, run DB tests, provision a database or start another audit task.
