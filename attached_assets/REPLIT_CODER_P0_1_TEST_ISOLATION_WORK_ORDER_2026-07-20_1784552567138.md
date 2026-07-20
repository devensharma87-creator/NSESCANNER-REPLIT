# NSESCANNER — P0.1 TEST-ISOLATION FOUNDATION

**Authorized branch:** `phase0/authorized-remediation-20260720`  
**Authorized starting SHA:** `47611aa6fad3785f02f97280570f025c71fb975a`  
**Scope:** Test discovery, fail-closed test-environment enforcement, and pure guard verification only  
**No authority:** Trading-engine changes, operational DB access, external service calls, migrations, deployment, restart, merge, push, or live/paper-trading activation

---

## Copy everything below into Replit Coder

You are executing one narrowly scoped recovery task for a safety-critical Indian-market analytics and paper-trading platform.

This is **P0.1 only: test-environment isolation**. Do not start any other Phase 0 item. Do not “fix nearby issues.” Do not create forward plans until the implementation and evidence are complete.

The previous unauthorized work was recovered. Its code remains preserved only on forensic branches and is not accepted implementation. Do not copy it wholesale.

## 1. Mandatory starting-state verification

Before reading or editing source, run read-only Git checks and provide their literal output:

```bash
git branch --show-current
git rev-parse --verify HEAD
git rev-parse --verify main
git status --short --branch
git log -1 --oneline --decorate
```

Required state:

- current branch exactly `phase0/authorized-remediation-20260720`;
- `HEAD` exactly `47611aa6fad3785f02f97280570f025c71fb975a` at task start, unless a new attachment-only checkpoint was automatically created on this same authorized branch;
- `main` exactly `47611aa6fad3785f02f97280570f025c71fb975a`;
- no unexplained source changes.

If the branch is `main`, `main` moved, or overlapping source changes exist, **stop before editing**. Do not rationalize a deviation.

Record but do not modify these forensic references:

- `phase0/forensic-review-20260720` → expected `9bd8f92a541427b421804020a8df2a8c19115a3a`;
- `phase0/forensic-full-state-20260720` → expected `1672167ff51afeaaba9bbd50bcbf4edfcbfbc6e0`.

## 2. Hard prohibitions for this work order

Do not:

1. Connect to any database, including a test database.
2. Execute SQL or inspect operational table contents.
3. Run any existing test that imports application modules or `@workspace/db`.
4. Run the full API, scanner, workspace or integration test suites.
5. Run migrations, `drizzle-kit push`, schema ensure functions, seeders or cleanup scripts.
6. invoke any application endpoint, including `GET` endpoints.
7. start, stop or restart a Replit workflow.
8. call Kite, a broker SDK, Telegram or any external network service.
9. modify C0 constants, trading configuration, broker configuration, signals, writers, ledgers, account logic, schema, routes, UI or production runtime code.
10. copy `testIsolationGuard.ts`, its test file, or any unreviewed source file from the forensic branch.
11. merge, rebase, push, publish or deploy.
12. write completion documents before implementation and verification finish.
13. claim test-database isolation is proved; no database connection is authorized in this task.

Permitted execution is limited to:

- read-only filesystem/Git/source searches;
- typechecking files/packages only if the command cannot execute application code;
- pure guard unit tests that import only the new guard and Node standard-library modules;
- child-process tests that use dummy environment strings and cannot load project application code;
- one local commit or Replit checkpoint on the authorized branch after verification.

If you cannot prove a command is free of application imports and database/network side effects, do not run it.

## 3. Required sequential workflow

Do these stages in order. Do not run dependent stages in parallel.

### Stage A — Read-only test-coupling inventory

Inventory the entire repository without executing tests. Locate:

- every `vitest`, Jest or other test configuration;
- package test scripts;
- setup files, global setup/teardown and hooks;
- all test files importing `@workspace/db`, DB helpers, schemas or modules that import the DB transitively;
- every use of `DATABASE_URL`, `TEST_DATABASE_URL`, `NODE_ENV`, `pg.Pool`, Drizzle connections, schema-ensure functions and migrations in test-related code;
- test files that insert/update/delete/truncate data;
- test cleanup and transaction/rollback patterns;
- tests that call `.end()`/close a shared pool;
- tests explicitly labelled “live DB,” “dev DB,” “production,” “integration,” “migration” or similar;
- tests that can call Telegram, Kite, broker adapters, public HTTP endpoints or external network;
- current test-file grouping and which default scripts include DB-backed tests.

Use static searches and source inspection only. Do not import modules to discover dependencies.

Produce a machine-readable inventory file after implementation is complete:

`memory/P0_1_TEST_COUPLING_INVENTORY_2026-07-20.md`

For each test file classify:

- `PURE_UNIT_CONFIRMED`;
- `DB_DIRECT`;
- `DB_TRANSITIVE`;
- `EXTERNAL_SERVICE_DIRECT`;
- `EXTERNAL_SERVICE_TRANSITIVE`;
- `UNKNOWN_REQUIRES_TRACE`.

One file may have multiple classifications. Record exact source evidence and do not guess transitive safety.

### Stage B — Design the fail-closed boundary

Implement a small test-only isolation module in the existing test-infrastructure location, or create a clearly test-only location if none exists.

It must:

1. Use only Node standard-library functionality. It must not import application packages, database libraries, network libraries or runtime configuration modules.
2. Require `NODE_ENV === "test"` for DB-backed test mode.
3. Require a non-empty `TEST_DATABASE_URL` for DB-backed test mode.
4. Never fall back to ordinary `DATABASE_URL`.
5. Canonicalize URLs before comparison, including hostname case, default PostgreSQL port and normalized database name.
6. Reject when `TEST_DATABASE_URL` and `DATABASE_URL` resolve to the same host, port and database, even if textual formatting differs.
7. Require a clearly isolated database name or schema naming convention such as a dedicated name containing `test` plus a unique run identifier. Do not rely on the word `test` as the only control.
8. Require an explicit owner/environment confirmation variable for DB-backed mode, for example `TEST_DB_ISOLATION_CONFIRMED=true`.
9. Generate or require a unique `TEST_RUN_ID` suitable for per-run database/schema isolation.
10. Return a redacted fingerprint only; never print usernames, passwords, query secrets or full URLs.
11. Set broker execution and production notification modes to disabled in the test environment.
12. Reject known production/development database names or fingerprints through explicit configuration, not vague host-name guessing.
13. Produce typed, stable reason codes such as:
   - `NOT_TEST_ENV`;
   - `TEST_DATABASE_URL_MISSING`;
   - `OPERATIONAL_DATABASE_FALLBACK_FORBIDDEN`;
   - `TEST_EQUALS_OPERATIONAL_TARGET`;
   - `TEST_DB_CONFIRMATION_MISSING`;
   - `TEST_RUN_ID_MISSING`;
   - `TEST_TARGET_NOT_ISOLATED`;
   - `VALID_ISOLATED_TEST_CONFIGURATION`.

Do not open a socket or test a connection. This task validates configuration structure only.

### Stage C — Enforce it before application imports

The earlier failed implementation merely created and unit-tested a helper. That is insufficient.

Wire enforcement into the actual test runner so it executes **before any DB-backed test or application module import**.

Requirements:

1. Separate pure-unit and DB-backed configurations/scripts when necessary.
2. A DB-backed command must terminate before test discovery/import if the guard fails.
3. Default/full API test commands must not silently run DB-backed files against ordinary `DATABASE_URL`.
4. When no isolated DB is provisioned, DB-backed tests must report a clear blocked status; they must not silently fall back, pass or mutate an operational target.
5. Pure-unit configuration must not import `@workspace/db` through setup hooks.
6. The guard must be invoked by real configuration/script wiring—not only from its own unit test.
7. Existing developer commands must be documented with safe replacements.
8. Do not rewrite hundreds of tests in this task. Establish the boundary, classify files and document the remaining migration set.

If the existing Vitest lifecycle cannot guarantee pre-import enforcement, use a small Node preflight wrapper that validates the environment and only then spawns Vitest. The wrapper itself must contain no application imports.

Do not run the DB-backed command in this work order.

### Stage D — Block unintended external services in test mode

Within test-only infrastructure:

- require broker execution disabled;
- require production Telegram disabled;
- make any future DB-backed test command require explicit mock/test adapter configuration;
- document every adapter that is not yet globally intercepted;
- do not claim network isolation until a later dedicated proof run verifies it.

Do not modify production adapter behaviour in this task.

## 4. Pure verification permitted in this task

Create focused tests for the guard only. They may import only:

- the guard/preflight module;
- Node standard-library modules;
- the test framework itself, provided the chosen pure-test config has no application setup imports.

Test at minimum:

1. missing `NODE_ENV=test` is rejected;
2. missing `TEST_DATABASE_URL` is rejected;
3. only ordinary `DATABASE_URL` is rejected;
4. identical operational/test URLs are rejected;
5. equivalent URLs with implicit/explicit port 5432 are rejected;
6. hostname case differences do not bypass comparison;
7. missing owner confirmation is rejected;
8. missing/invalid `TEST_RUN_ID` is rejected;
9. production/development target denylist is rejected;
10. a structurally valid dummy isolated configuration is accepted without connecting;
11. redacted fingerprint contains no password, username or sensitive query value;
12. the actual DB-test command wrapper refuses to spawn Vitest when the guard fails;
13. the actual DB-test command wrapper can reach a harmless injected fake-spawn sentinel when configuration is structurally valid, without starting Vitest or connecting anywhere;
14. default test-script wiring does not use ordinary `DATABASE_URL` as a fallback.

Use dummy, non-routable connection strings. Do not use or print real secrets.

Report first and final test runs separately. Do not hide initial failures.

## 5. Files allowed to change

Only these categories may change:

- test-only guard/preflight module;
- test-only unit tests for that guard;
- Vitest/test-runner configuration needed to enforce the preflight;
- package scripts needed to separate safe unit tests and blocked DB tests;
- the two evidence documents listed below;
- a minimal test-infrastructure README if essential.

Do not change production source, runtime DB resolution, application routes, schemas, migrations, trading logic, UI, Telegram/Kite adapters, `MEMORY.md`, or unrelated tests.

Before editing, state the exact proposed file list. If another file becomes necessary, stop and explain why before touching it.

## 6. Required deliverables

After implementation and pure verification, create:

1. `memory/P0_1_TEST_COUPLING_INVENTORY_2026-07-20.md`
2. `memory/P0_1_TEST_ISOLATION_IMPLEMENTATION_AND_EVIDENCE_2026-07-20.md`

The evidence report must include:

- starting branch/SHA and final SHA;
- exact files changed;
- inventory totals by classification;
- existing unsafe/default test commands found;
- guard architecture and reason codes;
- proof that the real DB-test wrapper invokes the guard before test discovery;
- permitted pure-test commands and exact results;
- passed, failed, skipped and timed-out counts;
- explicit confirmation that no database connection/query was made;
- explicit confirmation that no application endpoint was called;
- explicit confirmation that no Telegram, Kite or broker call was made;
- explicit confirmation that no workflow was restarted and nothing was deployed;
- `TEST_DATABASE_ISOLATION_RUNTIME_PROOF: NOT_RUN_NO_DATABASE_AUTHORITY`;
- remaining DB-backed test migration list;
- remaining external-network isolation gaps;
- stop conditions encountered.

Every substantive claim must be `PROVED`, `LIKELY`, `UNPROVED` or `DISPROVED`.

## 7. Acceptance criteria for P0.1

This work order passes only if:

1. Branch and baseline are correct.
2. No production/runtime file changed.
3. Repository-wide test coupling inventory exists with source evidence.
4. DB-backed test execution fails closed when `TEST_DATABASE_URL` is absent.
5. Ordinary `DATABASE_URL` can never be the implicit test target.
6. Guard enforcement is wired into the real DB-test command before application imports.
7. Pure guard tests pass without importing application/DB modules.
8. No database or external service was contacted.
9. No migration, restart, deployment, merge or push occurred.
10. Runtime isolation remains honestly labelled unproved until an isolated database is separately provisioned and tested.

If any criterion fails, report `P0.1 STATUS: NOT ACCEPTED`.

## 8. Completion and stop rule

After verification, make at most one deliberate local commit/checkpoint on `phase0/authorized-remediation-20260720`. Do not merge or deploy.

Final line must be exactly one of:

`P0.1 STATUS: LOCALLY IMPLEMENTED — RUNTIME DB ISOLATION PROOF PENDING OWNER-PROVISIONED TEST DATABASE`

or

`P0.1 STATUS: NOT ACCEPTED — <concise blocker>`

Stop and wait for owner review. Do not begin writer/session, GET-purity, security, provenance, ledger, historical-detector, backtest, Telegram or UI work.

