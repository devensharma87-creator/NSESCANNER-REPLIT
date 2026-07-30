# MARKET SCANNER — P0.1B SAFE TEST-DATABASE INFRASTRUCTURE

## Role

Act as the senior platform engineer responsible for completing P0.1B: a safe, deterministic and auditable PostgreSQL integration-test environment for Devendra’s Market Scanner.

This is a test-infrastructure task. It is not an F&O strategy task, database-content cleanup task or production deployment task.

---

## Current authoritative status

Phase A0.3 is closed at the unit level:

`ACCEPT_A0_3_AS_UNIT_VERIFIED`

Do not reopen, re-plan or reimplement A0.3.

The following remain authoritative:

- Service-layer option-signal failure tests pass.
- Actual HTTP route tests pass.
- Canonical nine-record setup-availability contract is verified.
- Full non-DB API suite has zero failures.
- Scanner suite, typechecks and builds pass.
- Production deployment remains unverified.

The three `paperTradingEqProvenance.test.ts` DB tests remain skipped because safe DB isolation is unavailable.

Current P0.1B blocker:

`BLOCKED — SAFE_TEST_DATABASE_NOT_CONFIRMED`

Known conditions:

- `NODE_ENV` was not `test`.
- `TEST_DATABASE_URL` was absent.
- `TEST_RUN_ID` was absent.
- `TEST_DB_ISOLATION_CONFIRMED` was absent.
- `TEST_EXTERNAL_SERVICES_CONFIGURED_DISABLED` was absent.
- The official DB runner contains a hard runtime lock:

```ts
const DB_TEST_RUNTIME_AUTHORIZED = false as boolean;
```

Do not change that lock until every prerequisite in this prompt is satisfied.

---

## Mission

Build and prove a professional DB-test boundary that guarantees:

1. No DB-backed test can connect to production, preview-production, staging with operational data or the normal development database.
2. Every test run is isolated from every other test run.
3. External services, brokers and notifications remain disabled.
4. Migrations, test data and cleanup affect only the isolated test namespace.
5. The official `test:db` pathway is the only authorized DB-test entry point.
6. The three provenance tests execute and pass instead of skipping.
7. The stale-date swing tests execute safely.
8. Test residue is deterministically removed or explicitly retained as controlled evidence.
9. The hard runtime lock is enabled only after all safety gates pass.

---

## Non-negotiable restrictions

### Never touch operational data

- Do not use `DATABASE_URL` for DB tests.
- Do not copy `DATABASE_URL` into `TEST_DATABASE_URL`.
- Do not alter, delete, truncate, migrate or inspect sensitive row content in an operational database.
- Do not run destructive SQL against development, preview, staging, production or any shared database.
- Do not use production broker credentials.
- Do not send Telegram, WhatsApp, email or broker orders during tests.
- Do not call Kite, Upstox, IndianAPI or another external market-data service from DB tests.

### No guard bypass

- Do not remove or weaken `checkDbTestIsolation`.
- Do not bypass the preflight runner.
- Do not accept environment-variable aliases that circumvent the official variables.
- Do not add a `FORCE`, `BYPASS`, `IGNORE`, `SKIP_GUARD` or similar escape hatch.
- Do not set `DB_TEST_RUNTIME_AUTHORIZED = true` merely to see what happens.
- Do not downgrade a guard failure to a warning.

### Repository governance

- Do not commit, amend, rebase, merge, reset, revert or cherry-pick.
- Do not push, pull or fetch.
- Do not deploy or publish.
- Do not stage files.
- Do not add `.skip`, `.only`, retries or arbitrary sleeps.
- Do not weaken DB-test assertions.
- Do not modify accepted A0.3 strategy or route behavior.

### External authority boundary

Do not create a cloud database, database branch, credential, secret or paid resource unless it already exists and is explicitly authorized for testing.

If an external resource or credential must be provisioned by the owner, stop after producing the exact provisioning specification. Do not fabricate access.

---

## HEAD and auto-commit governance

Capture:

- IST timestamp;
- starting HEAD;
- branch and upstream;
- locally recorded ahead/behind;
- tracked, staged and untracked files;
- diff statistics;
- exact changed-file inventory already present.

Preserve all accepted A0.3 work.

The existing platform auto-commit exception applies only when the commit contains authorized documentation/evidence or added prompt attachments and no source, test, schema, dependency or configuration change.

Stop for any unexpected commit containing implementation changes.

---

# PHASE 1 — READ-ONLY ARCHITECTURE AUDIT

## 1.1 Read the entire P0.1B surface

Read completely:

- `dbTestPreflightRunner.ts`;
- `checkDbTestIsolation` and every referenced helper;
- official `test:db` package scripts;
- `paperTradingEqProvenance.test.ts`;
- `swingOrderStaging.test.ts`;
- DB client initialization;
- schema/migration tooling;
- cleanup helpers;
- environment allowlists;
- child-process environment filtering;
- `docs/paper-trader-architecture.md`;
- existing DB-test evidence and guard tests;
- CI configuration relevant to PostgreSQL tests.

Do not make changes until this read is complete.

## 1.2 Produce the connection map

Document:

```text
test command
  → preflight runner
  → environment allowlist
  → isolation guard
  → test DB connection
  → migration/bootstrap
  → test runner
  → cleanup/residue verification
```

Identify every location where DB connection information can enter the process:

- environment variables;
- config files;
- defaults;
- child processes;
- imported singleton clients;
- test helpers;
- migrations.

Prove that no hidden fallback can select `DATABASE_URL`.

## 1.3 Evaluate the current naming contract

The earlier report suggested both:

- a unique `TEST_RUN_ID` for each run; and
- requiring the database name itself to contain that run ID.

Determine whether the current design requires a newly provisioned database URL for every run. If so, classify whether that is operationally practical.

Do not weaken isolation merely for convenience.

Evaluate these professional models:

### Model A — disposable database per run

- Dedicated test-only PostgreSQL server/branch.
- Runner creates `nsc_vitest_<TEST_RUN_ID>`.
- Restricted administrative credential creates and drops only test databases.
- Best isolation, but requires controlled database-creation authority.

### Model B — dedicated test database plus schema per run

- Fixed test-only database such as `nsc_vitest`.
- Restricted test role has no access outside that database.
- Runner creates schema `run_<TEST_RUN_ID>`.
- Connection/search path is forced to that schema.
- Migrations and tests run only inside it.
- Schema is dropped after the run.

Model B is acceptable only if the application, ORM, SQL and migrations do not hardcode `public` or another shared schema.

### Model C — externally provisioned database per run

- Owner or CI provides a complete `TEST_DATABASE_URL` containing the run identity.
- Runner never creates external resources.
- Safe but operationally heavier.

Reject:

- using the operational development database with row prefixes;
- relying only on transactions when tests use multiple connections;
- using a shared `public` schema;
- name-only isolation without permission isolation;
- test cleanup based on broad pattern matching.

Select the safest model supported by the actual repository and environment. Explain the decision.

---

# PHASE 2 — PROVISIONING GATE

## 2.1 Inspect only the presence of prerequisites

Without printing secret values, report whether the following exist:

- `TEST_DATABASE_URL`;
- any explicitly authorized test-database administrative URL;
- `TEST_RUN_ID`;
- migration access for the test target;
- restricted test role;
- external-service-disable configuration.

Report presence/absence only.

## 2.2 Stop condition when infrastructure is absent

If no authorized isolated test target exists, do not change production/test infrastructure code merely to simulate completion.

Return:

`P0_1B_PROVISIONING_REQUIRED`

Provide an exact owner checklist:

- database/branch/schema to create;
- recommended safe name;
- restricted role requirements;
- required secret names;
- minimum PostgreSQL privileges;
- forbidden privileges;
- migration prerequisites;
- required external-service-disable variables;
- whether the resource may be automatically destroyed;
- expected cost/resource implication if known from the configured provider;
- how to verify it is distinct from operational databases without exposing secrets.

Stop after the checklist. Do not enable the runtime lock.

## 2.3 Proceed condition

Proceed only when an authorized isolated test target exists and its identity can be safely verified.

Capture redacted fingerprints:

- PostgreSQL server/cluster classification;
- database name classification;
- schema name;
- role name classification;
- SSL mode;
- operational-vs-test distinction;
- isolation model;
- `TEST_RUN_ID`.

Never display passwords, tokens or complete URLs.

---

# PHASE 3 — IMPLEMENT THE SAFE RUNNER

## 3.1 Fail before connecting

The runner must reject unsafe configuration before opening any DB connection or running any migration.

Mandatory negative conditions:

- `NODE_ENV !== "test"`;
- missing `TEST_DATABASE_URL`;
- `TEST_DATABASE_URL === DATABASE_URL`;
- same redacted host/database/schema fingerprint as the operational target;
- missing or malformed `TEST_RUN_ID`;
- missing test/isolation naming markers;
- forbidden operational database name;
- missing explicit isolation confirmation;
- missing external-service-disable confirmation;
- missing SSL when required;
- unapproved database role;
- unapproved schema;
- unsupported isolation model.

## 3.2 Environment contract

Use only explicit test variables:

- `NODE_ENV=test`;
- `TEST_DATABASE_URL`;
- `TEST_RUN_ID`;
- `TEST_DB_ISOLATION_CONFIRMED=true`;
- `TEST_EXTERNAL_SERVICES_CONFIGURED_DISABLED=true`.

If additional variables are genuinely required, document and allowlist them explicitly. Do not pass the full parent environment to child processes.

Strip or override:

- operational `DATABASE_URL`;
- broker credentials;
- Telegram/WhatsApp/email delivery credentials;
- production API tokens;
- deployment variables;
- webhook secrets;
- scheduler-enable flags.

Tests must fail closed if an external service could be called.

## 3.3 Restricted permissions

The test role must:

- connect only to the isolated test database;
- create/use/drop only the permitted per-run schema or test database;
- create and modify test tables;
- run required migrations;
- never access operational databases or schemas;
- never possess unrestricted cluster administration unless using a separately controlled provisioning role.

Separate provisioning authority from the runtime test role whenever possible.

## 3.4 Bootstrap and migration

Implement deterministic steps:

1. Validate environment.
2. Generate/validate `TEST_RUN_ID`.
3. Establish the isolated namespace.
4. Set and verify the active database/schema.
5. Apply the actual production migrations to the isolated target.
6. Verify required tables and constraints.
7. Start the test runner.
8. Collect results.
9. Run residue checks.
10. Clean only the current run namespace.
11. Verify cleanup.
12. Close all connections.

Do not manually recreate only selected tables as a substitute for migrations.

## 3.5 Concurrency and idempotency

Prove:

- two test runs cannot share a mutable namespace;
- repeated runner invocation does not reuse stale state;
- interrupted runs are identifiable;
- cleanup targets the exact run ID;
- retry does not delete another run;
- connection pools close before cleanup;
- migrations are deterministic.

## 3.6 Hard runtime authorization

Keep:

```ts
DB_TEST_RUNTIME_AUTHORIZED = false
```

throughout implementation and negative testing.

Change it to the repository’s approved enabled state only after:

- authorized isolated infrastructure exists;
- all isolation guard tests pass;
- external services are proven disabled;
- dry-run preflight selects only the test target;
- owner authorization in this prompt is satisfied;
- no operational target can pass the guard.

The final code must not introduce an environment-variable bypass for this compile-time decision.

---

# PHASE 4 — LOAD-BEARING SAFETY TESTS

## 4.1 Negative tests

The runner must reject:

- missing `NODE_ENV=test`;
- missing test URL;
- operational URL reused as test URL;
- forbidden database name;
- missing test marker;
- missing/mismatched run ID;
- wrong schema;
- missing isolation confirmation;
- missing external-service-disable confirmation;
- operational credentials present in child environment;
- unsafe role;
- another run’s namespace;
- malformed URL;
- unsupported driver;
- migration against an unverified target.

Assert that rejection occurs before the first SQL statement.

## 4.2 Positive isolation tests

Prove:

- authorized isolated target passes;
- active database/schema matches the run;
- production/development fingerprint cannot be reached;
- required migrations apply;
- test data is visible only inside the run;
- a second run cannot see the first run’s rows;
- cleanup removes only the current run;
- all pools/connections close.

## 4.3 External-service tests

Prove that DB tests cannot:

- place broker orders;
- fetch live Kite/Upstox data;
- send Telegram/WhatsApp/email;
- call production webhooks;
- start schedulers;
- trigger production background jobs.

Any attempted external call must fail the test.

## 4.4 Destructive-operation canaries

Add canary tests proving:

- broad `DROP DATABASE`, `DROP SCHEMA public`, `TRUNCATE` of unqualified operational tables and unsafe cleanup patterns are rejected or impossible;
- cleanup requires an exact validated run namespace;
- an empty or malformed run ID cannot generate a cleanup target.

Do not execute destructive canaries against an operational connection.

---

# PHASE 5 — EXECUTE THE OFFICIAL DB TEST PATH

After all safety gates pass and the runtime lock is legitimately enabled, run only:

`pnpm --filter @workspace/api-server run test:db`

or the repository’s actual official equivalent.

Do not invoke DB test files directly through Vitest.

Execute:

1. DB isolation self-tests.
2. `paperTradingEqProvenance.test.ts` — all three previously skipped tests.
3. `swingOrderStaging.test.ts`.
4. Stale-date owner-override case.
5. Relevant paper-trading DB integration tests.

Required:

- zero DB guard bypasses;
- zero skipped provenance tests;
- zero failures;
- deterministic repeated execution;
- no external calls;
- zero unexplained residue.

Run the complete official DB suite twice with different run IDs and prove isolation between runs.

---

# PHASE 6 — REGRESSION AND BUILD GATES

Run:

- all P0.1B guard/unit tests;
- official DB suite twice;
- full API-server suite;
- accepted A0.3 manifest;
- scanner suite;
- API-server typecheck;
- scanner typecheck;
- full-workspace typecheck;
- API-server production build;
- scanner production build;
- `git diff --check`.

Report exact per-file and aggregate results.

Reconcile:

- previously skipped provenance tests now executed;
- any new P0.1B tests;
- new full-suite totals;
- all remaining skips individually.

No regression exception is permitted for P0.1B acceptance.

---

# PHASE 7 — EVIDENCE AND GOVERNANCE

Create one separate evidence file:

`artifacts/audit-evidence/PHASE_P0_1B_SAFE_TEST_DATABASE_INFRASTRUCTURE.md`

Do not overwrite the accepted A0.3 evidence.

Include:

1. Scope and threat model.
2. Selected isolation model.
3. Redacted database/role fingerprints.
4. Environment contract.
5. Guard matrix.
6. Negative-test results.
7. Positive isolation results.
8. Migration/bootstrap results.
9. External-service-disable proof.
10. Two-run isolation proof.
11. Provenance and swing DB-test results.
12. Cleanup/residue results.
13. Full regression results.
14. Exact changed-file inventory.
15. Git chronology.
16. No-commit/no-push/no-deploy declaration.
17. Final verdict.
18. Production status.

Use the exact terminator:

`END_PHASE_P0_1B_SAFE_TEST_DATABASE_INFRASTRUCTURE`

Verify:

- terminator appears exactly once;
- it is the final nonblank line;
- SHA256 is calculated after the final write and reported externally;
- no secret appears in evidence or test output.

---

# GIT RECORD

Capture:

- starting HEAD;
- final HEAD;
- branch/upstream;
- locally recorded ahead/behind;
- tracked modifications;
- staged modifications;
- untracked files;
- diff statistics;
- auto-commit chronology;
- manual commit status;
- push/pull/fetch status;
- deployment status.

Stop for any unexpected auto-commit that contains source, test, schema, dependency or configuration changes.

Do not call a dirty tree clean.

---

# ACCEPTANCE

Return:

`ACCEPT_P0_1B_SAFE_TEST_DATABASE_INFRASTRUCTURE`

only if:

- isolated infrastructure is authorized and proven;
- no operational DB can pass the guard;
- runtime lock is enabled only after proof;
- official DB runner is used;
- three provenance tests execute and pass;
- swing DB tests pass;
- two independent run IDs are isolated;
- migrations and cleanup are deterministic;
- external services are disabled;
- no unexplained residue remains;
- full regressions, typechecks and builds pass;
- evidence is complete;
- no secret is exposed;
- no commit, push or deployment occurred.

If infrastructure is absent, return:

`P0_1B_PROVISIONING_REQUIRED`

If safety cannot be proven, return:

`P0_1B_NOT_ACCEPTED — <EXACT_BLOCKER>`

Production remains:

`PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`

---

# REQUIRED FINAL RESPONSE

Return only:

## 1. Verdict

## 2. Isolation model and threat controls

## 3. Redacted provisioning status

## 4. Guard matrix

## 5. DB test results

## 6. Two-run isolation and cleanup proof

## 7. External-service-disable proof

## 8. Full regression/typecheck/build results

## 9. Git and evidence integrity

## 10. Remaining production status

Do not create another A0.3 plan. Do not move to alerting, deployment or another audit workstream until P0.1B either passes or returns the exact owner provisioning requirement.
