# MARKET SCANNER — P0.1B ZERO-CONNECTION CANARY AND FINAL EVIDENCE ACCEPTANCE

## Role

Act as the senior database-safety verification engineer for Devendra’s Market
Scanner.

This is one final, bounded correction-and-evidence pass. Do not reopen the
repository-wide test migration that was just completed unless a load-bearing
verification identifies a specific defect.

The only technical blocker is that the reported zero-connection canary was
weakened to treat missing telemetry as zero. The remaining work is to replace
that false-positive proof, reconcile the test-count change exactly and supply
the complete final verification record.

---

## 1. Authoritative status

### A0.3

`ACCEPT_A0_3_AS_UNIT_VERIFIED`

A0.3 is frozen. Do not modify any trading, F&O, VWAP, paper-admission, API,
route, Zod, OpenAPI or UI behavior.

### P0.1B

Current verdict:

`P0_1B_SAFETY_CLOSURE_NOT_ACCEPTED — ZERO_CONNECTION_PROOF_INVALID`

The preceding task reportedly completed:

- classification of the legacy DB-capable test surface;
- conversion of seven all-DB files to `*.db.test.ts`;
- splitting of three mixed files;
- retention of pure tests in ordinary `*.test.ts`;
- dynamic imports behind `checkDbTestIsolation()`;
- normal/default configuration exclusion of `*.db.test.ts`;
- eight new ZC/canary tests;
- `test:unit` at 172/172;
- `test:full` at 4281/4281;
- scanner at 843/843;
- four typechecks and two builds;
- no DB-backed test execution;
- no operational residue cleanup;
- runtime authorization remaining `false as boolean`.

Preserve this work.

---

## 2. Confirmed blocker

The prior canary reportedly failed because the expected pool-stat property was
undefined. It was then changed to:

```ts
getDbPoolStats().totalCount ?? 0
```

This is invalid safety evidence.

If `totalCount` is unavailable, `undefined ?? 0` reports zero despite the test
having no visibility into connection activity. The assertion passes because
telemetry is missing, not because zero connections were proved.

Missing, optional, malformed or inaccessible telemetry must fail the test.
Never convert missing telemetry into a safe value.

---

## 3. Scope

Complete only:

1. Replace the false-positive canary with a load-bearing executable
   zero-connection proof.
2. Add deliberate negative-control tests proving the canary fails when a
   forbidden DB path is invoked.
3. Verify that all normal/default test entry points collect no DB-backed files.
4. Reconcile `4354 → 4281` exactly by file.
5. Run and report the missing verification matrix.
6. Complete Git and evidence integrity.

Do not perform another repository-wide audit or migration unless the corrected
canary reveals a specific unsafe file.

---

## 4. Prohibited actions

Do not:

- run `test:db`;
- execute any `*.db.test.ts`;
- connect to PostgreSQL;
- query the operational database;
- create or connect to a test database;
- run a real migration;
- use a provisioning secret;
- alter `DB_TEST_RUNTIME_AUTHORIZED`;
- clean, delete or update the 115 operational residue rows;
- modify trading logic, UI, APIs or schemas;
- introduce skipped tests, retries or arbitrary sleeps;
- create a manual commit;
- push, pull, fetch, deploy or publish.

Do not print or store any database URL, host, username, password or token.

---

## 5. Governance

1. Record current HEAD, branch, upstream, ahead/behind and working-tree state.
2. Use the observed HEAD as this task’s baseline.
3. Do not require a historical hash to match.
4. Treat an `attached_assets/`-only platform auto-commit as pre-authorized:
   record it and continue.
5. Record platform auto-commits containing only this task’s already-reviewed
   files.
6. Stop if an unrelated source, test, schema, migration, dependency or build
   file changes unexpectedly.
7. Do not revert platform commits automatically.
8. Preserve unrelated user work.

---

## 6. Step 1 — Inspect the existing canary before editing

Read fully:

- the current `dbTestGuard.test.ts`;
- `getDbPoolStats()` implementation and exact return type;
- `@workspace/db` initialization;
- `pg.Pool` and `pg.Client` construction sites;
- Drizzle initialization and execution wrappers;
- raw SQL wrappers;
- default, full, unit and DB Vitest configurations;
- package test scripts;
- disposable lifecycle adapters and tests;
- all new `*.db.test.ts` files;
- the current P0.1B evidence section.

Determine:

1. What fields `getDbPoolStats()` actually returns.
2. Whether those fields measure:
   - pool object construction;
   - checked-out clients;
   - idle clients;
   - waiting clients;
   - completed connections;
   - queries.
3. Whether the stats object can prove that no constructor, connection or query
   call occurred.
4. Why `totalCount` was undefined.

If the stats API cannot provide complete evidence, do not use it as the primary
canary.

---

## 7. Step 2 — Build a load-bearing connection tripwire

Use an executable, test-only mechanism that observes the actual forbidden
boundaries.

The primary tripwire must cover:

- `pg.Pool` construction;
- `pg.Pool.prototype.connect`;
- `pg.Pool.prototype.query`;
- `pg.Client` construction;
- `pg.Client.prototype.connect`;
- `pg.Client.prototype.query`;
- application DB/Drizzle execution adapter;
- raw SQL execution wrapper;
- disposable provisioning adapter;
- schema-migration adapter.

Use one technically sound approach supported by the repository, such as:

- hoisted module mocks/spies applied before importing application modules;
- dependency-injected test adapters;
- a child-process preload tripwire;
- an explicit test-only connection-audit adapter.

Do not rely exclusively on:

- file-name scans;
- source-string searches;
- optional statistics;
- comments;
- configuration text.

Structural checks may supplement but cannot replace executable proof.

### Mandatory telemetry rules

1. Every observed counter must exist.
2. Every observed counter must be a finite number.
3. Missing or malformed telemetry must fail.
4. No `?? 0`, `|| 0`, optional-chain-to-zero or catch-and-return-zero fallback.
5. A counter reset must be explicit and verified.
6. The canary must distinguish:
   - not observed;
   - observed zero;
   - observed non-zero.

---

## 8. Step 3 — Negative-control proof

A safety canary is not load-bearing until it is shown to fail.

Add deliberate negative controls using fake adapters only:

### NEG-01 — Pool construction

Invoke the instrumented fake `Pool` constructor once. Confirm the canary
reports failure.

### NEG-02 — Pool connection

Invoke the instrumented fake `Pool.connect()` once. Confirm failure.

### NEG-03 — SQL query

Invoke a fake query/Drizzle execution once. Confirm failure.

### NEG-04 — Provisioning

Invoke the fake provisioning adapter once. Confirm failure.

### NEG-05 — Migration

Invoke the fake migration adapter once. Confirm failure.

### NEG-06 — Missing telemetry

Remove or corrupt a required counter. Confirm the canary fails closed.

### NEG-07 — Positive zero case

With all instrumentation installed and no forbidden invocation, confirm the
canary passes with explicit observed zeros.

The negative-control tests must not open sockets or contact any external
service.

Do not write tests that merely assert an internal helper returns `false`.
Exercise the same assertion pathway used by the acceptance canary.

---

## 9. Step 4 — Normal-command zero-connection proof

Run the executable tripwire against the safe discovery/execution pathways for:

1. default/bare Vitest configuration resolution;
2. `test:unit`;
3. `test:full`;
4. root/workspace normal test command;
5. committed CI normal test command;
6. Replit normal test workflow, if present.

For each pathway report:

| Entry point | Config | DB files collected | Pool constructed | Connect calls | Query calls | Provision calls | Migration calls | Result |
|---|---|---:|---:|---:|---:|---:|---:|---|

Requirements:

- all counter fields explicitly exist;
- every forbidden count is exactly zero;
- no DB-backed test file is collected;
- no skipped DB file is used as a safety substitute;
- no real network or DB access occurs.

If executing the entire suite inside one instrumented process is not supported,
use a child-process/preload or collection-manifest mechanism plus executable
module-import canaries. Explain the boundary precisely. Do not exaggerate what
was proved.

---

## 10. Step 5 — Verify every DB-only import boundary

For every `*.db.test.ts` file, prove:

- it is excluded from normal/default collection;
- it imports no DB-connected production module statically;
- `checkDbTestIsolation()` runs before dynamic DB imports;
- failed isolation prevents the dynamic import callback;
- no scheduler or external service starts at module load;
- it is included only by the DB-only configuration;
- it was not executed in this task.

Source inventory is acceptable for file classification, but the failed-guard
dynamic-import behavior must have executable tests.

Report the exact number of DB-only files and list every path.

---

## 11. Step 6 — Exact `4354 → 4281` reconciliation

The final report must include an exact table for all ten renamed/split legacy
files:

| Original file | Classification | Tests before | Pure tests retained | DB tests removed from normal suite | New target file(s) |
|---|---|---:|---:|---:|---|

Then reconcile:

| Component | Delta |
|---|---:|
| Previous normal-suite total | 4354 |
| DB-dependent tests removed from normal discovery | |
| Pure tests retained/restored | |
| New Prompt 11 ZC/canary tests | +8 |
| Other additions/removals | |
| Final normal-suite total | 4281 |

Prove the arithmetic.

The likely explanation:

`4354 − 81 DB tests + 8 new safety tests = 4281`

must not be assumed. Confirm the exact 81-test inventory by file.

Also report:

- current `dbTestGuard.test.ts` total;
- current disposable-lifecycle test total;
- swing pure test total;
- provenance pure test total;
- DB-only static test count;
- skipped test count in the normal suite;
- failed test count.

Do not run DB-only tests to obtain their counts. Use static named inventory.

---

## 12. Step 7 — Required verification matrix

After the corrected tripwire passes, run:

1. Corrected zero-connection and negative-control tests.
2. `dbTestGuard.test.ts`.
3. Disposable lifecycle tests.
4. Swing pure tests.
5. Provenance pure tests.
6. A0.3 route-handler tests.
7. A0.3 HTTP route tests.
8. Full non-DB API suite.
9. Full scanner suite.
10. API-server typecheck.
11. API-Zod typecheck.
12. API-client React typecheck.
13. Scanner typecheck.
14. Supported workspace typecheck, if available.
15. API-server production build.
16. Scanner production build.
17. API-client/frontend production build, if supported.
18. `git diff --check`.
19. New-diff audit for:
    - `.skip`;
    - `describe.skip`;
    - `test.skip`;
    - `.only`;
    - retries;
    - arbitrary sleeps;
    - assertion weakening;
    - connection strings;
    - secret values.

For each command report:

- exact command;
- exit code;
- files;
- passed;
- skipped;
- failed;
- duration where available.

Do not summarize “four typechecks” or “two builds.” Name every package and
command.

---

## 13. Step 8 — Residue-plan status

Do not connect to the operational database and do not execute cleanup.

Report only whether the existing plan contains:

- exact primary-key inventory or a declared future read-only prerequisite;
- dependency/foreign-key inventory;
- backup/export procedure;
- pre-cleanup hash and count checks;
- fail-closed transaction assertions;
- dependency-order cleanup;
- rollback;
- post-cleanup verification;
- owner authorization boundary.

The 115 rows remain untouched.

Do not return:

`AUTHORIZE_OPERATIONAL_TEST_RESIDUE_CLEANUP`

as an executed decision. It remains a future owner-controlled authorization
phrase.

---

## 14. Step 9 — Git record

Report:

- starting HEAD;
- final HEAD;
- branch;
- upstream;
- ahead/behind;
- platform auto-commits;
- exact changed-file inventory;
- rename inventory inherited from Prompt 11;
- current task’s diff;
- `git diff --stat`;
- `git diff --name-status`;
- staged changes;
- untracked files;
- working-tree state;
- whether a manual commit occurred;
- whether push, pull, fetch, deploy or publish occurred.

Do not claim “clean” while the evidence file is modified.

---

## 15. Step 10 — Evidence integrity

Append one final bounded section to:

`artifacts/audit-evidence/PHASE_P0_1B_SAFE_TEST_DATABASE_INFRASTRUCTURE.md`

Preserve prior history.

Include:

1. Why `totalCount ?? 0` was rejected.
2. Corrected tripwire architecture.
3. Explicit telemetry schema.
4. Negative-control results.
5. Normal-command zero-connection matrix.
6. Complete DB-only file inventory.
7. Exact `4354 → 4281` reconciliation.
8. Exact test/typecheck/build commands.
9. Residue-plan status.
10. Git record.
11. Confirmation:
    - `NO_DATABASE_CONNECTION`;
    - no DB-backed tests;
    - no provisioning;
    - no migration;
    - no cleanup;
    - runtime lock unchanged;
    - no manual commit;
    - no push;
    - no deployment.
12. Final evidence SHA-256 computed after writing.
13. Terminator count.
14. Final-nonblank-line verification.

Use exactly once as the final nonblank line:

`END_PHASE_P0_1B_ZERO_CONNECTION_CANARY_AND_EVIDENCE_ACCEPTANCE`

Do not store a recursive “self-validating” SHA claim inside the file.

---

## 16. Acceptance gate

Return:

`ACCEPT_P0_1B_SAFETY_CLOSURE_READY_FOR_OWNER_PROVISIONING`

only if:

1. Missing telemetry fails closed.
2. No fallback converts missing telemetry to zero.
3. Every required counter explicitly exists.
4. All negative controls make the canary fail.
5. The explicit zero case passes.
6. Every normal command reports zero forbidden calls.
7. No DB-only test is collected normally.
8. All DB-only imports remain behind the isolation guard.
9. `4354 → 4281` reconciles exactly.
10. All non-DB tests pass.
11. Scanner tests pass.
12. All named typechecks and builds pass.
13. No assertion, test or safety boundary was weakened.
14. Git/evidence integrity is complete.
15. Runtime authorization remains false.
16. No DB connection, DB test, migration, provisioning, cleanup, secret,
    commit, push or deployment occurred.

If any gate fails, return:

`P0_1B_SAFETY_CLOSURE_NOT_ACCEPTED`

and report only:

- failed gate;
- exact evidence;
- smallest corrective action.

Do not start another broad audit.

Acceptance means P0.1B safety architecture is ready for the owner’s separate
test-only infrastructure provisioning decision.

It does not mean:

- a test database exists;
- DB tests passed;
- residue was cleaned;
- production was deployed or verified.

---

## 17. Required final response

Return one evidence report—not an execution diary:

1. **Verdict**
2. **Invalid-canary correction**
3. **Telemetry schema**
4. **Negative-control results**
5. **Normal-command zero-connection matrix**
6. **DB-only file/import-boundary inventory**
7. **Exact `4354 → 4281` reconciliation**
8. **Targeted and full test results**
9. **Named typecheck/build results**
10. **Skip/only/retry/assertion integrity**
11. **Residue-plan status**
12. **Git record**
13. **Evidence SHA-256 and terminator proof**
14. **Next owner action**
15. **Production status**

End with:

`PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`

---

## Final instruction

Do this once and stop.

Do not roam into trading logic, UI, APIs, schemas, provisioning or cleanup.
Replace the false-positive canary with real executable evidence, reconcile the
counts and close the P0.1B safety record professionally.
