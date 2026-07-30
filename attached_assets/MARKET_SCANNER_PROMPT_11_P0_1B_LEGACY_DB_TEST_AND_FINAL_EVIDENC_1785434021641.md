# MARKET SCANNER — P0.1B LEGACY DB-TEST AND FINAL EVIDENCE CLOSURE

## Role

Act as the senior test-infrastructure and database-safety engineer for
Devendra’s Market Scanner.

This is the final, narrowly bounded P0.1B safety-evidence pass. Do not start a
new audit, reopen accepted trading work, provision a database, clean operational
records or expand the scope.

The previous task delivered substantial safety improvements, but P0.1B cannot
be accepted while database-capable tests remain outside the `*.db.test.ts`
taxonomy and the final evidence package is incomplete.

---

## 1. Authoritative status

### A0.3

`ACCEPT_A0_3_AS_UNIT_VERIFIED`

A0.3 is frozen. Do not modify:

- F&O availability behavior;
- VWAP behavior;
- signal detectors;
- confidence or veto logic;
- paper-admission logic;
- route serialization;
- API contracts;
- frontend disclosures;
- thresholds, targets or stops.

### P0.1B

Current verdict:

`P0_1B_SAFETY_CLOSURE_NOT_ACCEPTED — LEGACY_DB_TEST_PATHS_AND_FINAL_EVIDENCE_PENDING`

Preserve the valid work already completed:

- authoritative default `vitest.config.ts`;
- normal-suite exclusion of `*.db.test.ts`;
- DB-only Vitest configuration;
- guarded DB runner;
- DB runtime hard lock;
- dynamic imports in known DB-backed tests;
- restored swing and provenance pure tests;
- disposable lifecycle orchestration;
- mocked lifecycle tests;
- provisioning/runtime credential separation;
- operational-residue cleanup plan;
- prior evidence history.

Do not redo these items unless a load-bearing verification fails.

---

## 2. Current reported results requiring verification

The coder reported:

- `pnpm run test:unit` — 164/164;
- `pnpm run test:full` — 4354/4354;
- prior non-DB result — 4305/4305;
- 24 new lifecycle tests;
- additional zero-connection tests;
- 7 pure/static swing tests;
- 4 pure provenance tests;
- 24 DB-dependent swing tests;
- 31 total swing tests;
- DB runtime authorization unchanged at `false as boolean`.

The likely arithmetic is:

`4305 + 38 new guard/lifecycle tests + 7 swing pure tests + 4 provenance pure tests = 4354`

Do not assume this arithmetic is correct. Prove it using exact per-file runner
output and collection inventory.

---

## 3. Confirmed unresolved issue

The previous response states that legacy patterns such as:

```ts
const dbit = hasDb ? it : it.skip;
```

remain in test files outside `*.db.test.ts`.

Calling them “pre-existing” or “outside scope” is not acceptable. P0.1B’s
central requirement is that ordinary test commands cannot connect to any real
database, especially the operational database.

Every remaining test file containing DB-enablement logic must be classified and
made safe.

---

## 4. Restrictions

This task does **not** authorize:

- execution of any DB-backed test;
- any real PostgreSQL connection;
- any operational-database read or write;
- creation of a test database;
- use or creation of a provisioning secret;
- schema migration against a real endpoint;
- cleanup of the 115 known operational residue rows;
- changing `DB_TEST_RUNTIME_AUTHORIZED`;
- deployment, publishing, pushing or manual committing;
- unrelated production changes;
- broad UI/API/trading audits.

Keep `DB_TEST_RUNTIME_AUTHORIZED = false as boolean`.

Do not print connection strings, secret values, database hosts, usernames,
passwords or provider tokens.

---

## 5. Governance without another HEAD loop

1. Record current HEAD, branch, upstream, ahead/behind and working-tree state.
2. Treat the observed current HEAD as the execution baseline.
3. Do not require an obsolete historical HEAD to match.
4. If the platform auto-commits only a newly uploaded file under
   `attached_assets/`, record it and continue.
5. If the platform auto-commits this task’s own already-reviewed working-tree
   changes, record the exact commit and continue only if its file inventory
   matches this task.
6. Stop only if HEAD moves because of an unrelated production, test, schema,
   dependency, build, migration or configuration change.
7. Do not revert platform commits automatically.
8. Do not run `git reset`, rebase, pull, fetch, checkout-based rollback, stash
   or force operations.
9. Preserve unrelated user work.
10. Do not create a manual commit.

---

## 6. Step 1 — Complete repository-wide DB-test inventory

Search all test, spec, setup, helper and configuration files for at least:

- `DATABASE_URL`;
- `TEST_DATABASE_URL`;
- `hasDb`;
- `dbit`;
- `describeDb`;
- `describe.skipIf`;
- `it.skip`;
- `test.skip`;
- `pg`;
- `Pool`;
- `Client`;
- Drizzle imports;
- `db.`;
- `.execute(`;
- `.query(`;
- raw SQL tags;
- migration helpers;
- DB cleanup hooks;
- transaction helpers;
- testcontainers or provider SDKs.

Search package scripts, CI workflows and Replit workflows for every Vitest/test
entry point.

Produce one exhaustive table:

| File | Test count | DB-related pattern | Real DB import? | Can issue SQL? | Collected by normal suite? | Required classification/action |
|---|---:|---|---|---|---|---|

For each file, assign exactly one classification:

1. `PURE_NON_DB_TEST`
2. `MOCKED_DB_UNIT_TEST`
3. `REAL_DB_TEST`
4. `MIXED_TEST_FILE_REQUIRES_SPLIT`
5. `STATIC_SOURCE_INVENTORY_TEST`

Do not classify by filename alone. Read the imports, hooks and executed code.

---

## 7. Step 2 — Resolve every legacy DB-capable test

### 7.1 Real DB tests

If a test can execute SQL against a real connection:

- rename/move it into `*.db.test.ts`;
- make it discoverable only by the DB-only configuration;
- guard it with `checkDbTestIsolation`;
- prevent DB-connected production imports before the guard passes;
- retain all assertions;
- do not run it.

### 7.2 Mixed files

Split mixed files:

- pure/mocked/static tests remain in ordinary `*.test.ts`;
- real DB tests move to `*.db.test.ts`;
- shared fixtures may move to non-test helper modules;
- do not duplicate or delete tests.

### 7.3 Mocked DB tests

Mocked tests may remain in the normal suite only if executable proof shows:

- the real DB module is not evaluated;
- no pool/client is constructed;
- no connection method is called;
- no SQL reaches a real adapter;
- the operational `DATABASE_URL` is irrelevant.

### 7.4 Skip-based DB tests

Remove `hasDb ? it : it.skip` as a safety boundary for real DB tests.

Safety must come from:

- file taxonomy;
- configuration exclusion;
- guarded DB runner;
- pre-import isolation enforcement.

Do not replace one weak skip expression with another.

### 7.5 Legacy exclusions

No remaining real DB test may exist outside `*.db.test.ts`.

If an apparent DB pattern is genuinely non-DB, document executable evidence
instead of ignoring it as legacy.

---

## 8. Step 3 — Prove every ordinary test command is safe

Inventory and verify:

- root `test` command;
- API-server `test`;
- API-server `test:unit`;
- API-server `test:full`;
- workspace recursive test commands;
- CI test commands;
- Replit workflow test commands;
- bare/default Vitest discovery;
- any documented developer command.

Required matrix:

| Entry point | Resolved config | Includes normal tests | Excludes `*.db.test.ts` | DB canary calls | Result |
|---|---|---|---|---:|---|

Acceptance requirements:

1. Every ordinary entry point resolves to the authoritative safe configuration.
2. Every ordinary entry point excludes every `*.db.test.ts`.
3. No ordinary entry point relies on skipped DB tests for safety.
4. The DB-only configuration includes only `*.db.test.ts`.
5. The DB-only configuration is reachable only through the guarded runner.
6. Missing configuration must fail closed.
7. Bare Vitest discovery must exclude DB tests.
8. CI cannot accidentally invoke unconfigured Vitest.

If a package script is unsafe, fix that script. Do not merely document a safer
alternative.

---

## 9. Step 4 — Runtime zero-connection proof

Extend or reuse the existing connection canary.

Without contacting a real DB, prove that normal collection/execution makes zero
calls to:

- `pg.Pool` connection acquisition;
- `pg.Client.connect`;
- Drizzle execution;
- raw SQL execution;
- the disposable provisioning adapter;
- the migration adapter.

Required cases:

1. Operational-looking `DATABASE_URL` present, no test URL.
2. `DATABASE_URL` absent.
3. Invalid isolation flags.
4. Bare/default Vitest discovery.
5. `test:unit`.
6. `test:full`.
7. Root/workspace normal test entry point.
8. CI-resolved normal entry point.

Use fake, canary or instrumented adapters only.

Do not use source-string inspection as the only proof. At least one executable
test must fail if a connection/provisioning/migration function is invoked.

Also prove no real DB-connected module is evaluated before the isolation guard
in every `*.db.test.ts` file.

---

## 10. Step 5 — Exact count reconciliation

Reconcile all totals without relying on a narrative estimate.

### 10.1 Required per-file results

Report exact collected/passed totals for:

- `dbTestGuard.test.ts`;
- `disposableDbLifecycle.test.ts`;
- `swingOrderStaging.pure.test.ts`;
- `paperTradingEqProvenance.pure.test.ts`;
- every file changed due to the legacy DB-test inventory;
- route-handler tests preserved from A0.3;
- HTTP route tests preserved from A0.3.

For DB-only files, provide static collection inventory without executing:

- file;
- exact test names;
- exact count;
- guard used;
- dynamic-import boundary.

### 10.2 Required arithmetic

Prove:

| Component | Count |
|---|---:|
| Prior non-DB suite | 4305 |
| New guard/zero-connection tests | |
| New lifecycle tests | |
| Restored swing pure/static tests | |
| Restored provenance pure tests | |
| Legacy tests newly retained in normal suite | |
| Tests removed from normal suite because they require a real DB | |
| Other explained delta | |
| Final non-DB suite | |

The sum must equal the actual final runner output.

Explain precisely:

- why “26” was previously reported;
- why swing now contains 24 DB tests and 7 pure/static tests;
- how that becomes 31 overall;
- why the non-DB suite moved from 4305 to 4354;
- whether the legacy DB-test correction changes 4354 again.

Do not preserve 4354 as a target if correct reclassification produces a
different total. Report the truthful final number and arithmetic.

---

## 11. Step 6 — Verify Prompt 10 deliverables without reopening them

Perform a read-only/code-level verification of:

- disposable lifecycle remains behind injected adapters;
- provisioning credential never enters child environment;
- child receives only restricted runtime URL;
- operational `DATABASE_URL` never enters child;
- migration happens before DB-test spawn in the mocked lifecycle;
- success/failure cleanup behavior remains tested;
- generated identifiers remain validated;
- runtime authorization remains false;
- operational residue cleanup remains unexecuted.

Only modify Prompt 10 implementation if one of these specific checks fails.

Do not provision a database or run the DB lifecycle.

---

## 12. Step 7 — Operational residue cleanup-plan completeness

Do not authorize or execute cleanup.

Verify that the existing plan for:

- 10 `paper_trade_eq` rows;
- 105 `paper_eq_audit` rows;
- `TESTSTK`;
- `GAP1TST*`;
- 2026-07-10 through 2026-07-18

contains:

1. exact primary-key status;
2. dependency/foreign-key inventory status;
3. affected P&L/report/dashboard pathways;
4. deterministic backup/export procedure;
5. pre-delete SHA-256 and row-count checks;
6. transaction start;
7. exact predicate revalidation;
8. fail-closed count assertions;
9. correct dependency deletion order;
10. post-delete zero-residue verification;
11. proof unrelated operational rows remain unchanged;
12. rollback procedure;
13. explicit owner authorization boundary.

If exact primary keys or dependencies have not been captured, record them as a
future read-only prerequisite. Do not connect to the operational DB now.

The future authorization phrase remains:

`AUTHORIZE_OPERATIONAL_TEST_RESIDUE_CLEANUP`

Do not treat this prompt as that authorization.

---

## 13. Step 8 — Required verification commands

Run only after proving the resolved normal configuration excludes all
`*.db.test.ts`.

Required:

1. Targeted legacy DB-test classification/safety tests.
2. `dbTestGuard.test.ts`.
3. `disposableDbLifecycle.test.ts`.
4. Swing pure/static tests.
5. Provenance pure tests.
6. A0.3 service route-handler tests.
7. A0.3 HTTP route tests.
8. Full authoritative non-DB API suite.
9. Full scanner suite.
10. API-server TypeScript typecheck.
11. API-Zod TypeScript typecheck.
12. API-client React TypeScript typecheck.
13. Scanner TypeScript typecheck.
14. Full workspace typecheck, if a supported command exists.
15. API-server production build.
16. Scanner production build.
17. Relevant frontend/API-client production build, if supported.
18. `git diff --check`.
19. Search for newly added:
    - `.skip`;
    - `describe.skip`;
    - `test.skip`;
    - `.only`;
    - retries;
    - arbitrary sleeps;
    - connection strings;
    - hardcoded credentials.

For every command report:

- exact command;
- exit code;
- test files;
- passed;
- skipped;
- failed;
- duration where available.

Forbidden:

- DB-only Vitest configuration execution;
- `test:db`;
- migration commands;
- provisioning commands;
- any operational SQL;
- any command capable of falling back to operational `DATABASE_URL`.

---

## 14. Step 9 — Git and evidence record

Report:

- starting HEAD;
- final HEAD;
- branch;
- upstream;
- ahead/behind;
- every HEAD movement;
- author and subject of any platform auto-commit;
- exact changed-file inventory;
- rename inventory;
- `git diff --stat`;
- `git diff --name-status`;
- staged state;
- untracked files;
- whether a manual commit occurred;
- whether push, pull, fetch, deploy or publish occurred.

Do not claim the tree is clean if evidence remains modified.

Update:

`artifacts/audit-evidence/PHASE_P0_1B_SAFE_TEST_DATABASE_INFRASTRUCTURE.md`

Append one final bounded section. Preserve prior chronology and correct factual
errors explicitly.

Required disclosures:

`READ_ONLY_OPERATIONAL_DB_CONNECTION_USED_IN_PRIOR_TASK_PROMPT_09 — NO_OPERATIONAL_DB_MUTATION`

For this task:

`NO_DATABASE_CONNECTION`

Record:

- final SHA-256 after the evidence file is complete;
- exact terminator count;
- final nonblank line;
- evidence working-tree state;
- implementation HEAD before evidence write.

Use exactly once as the final nonblank line:

`END_PHASE_P0_1B_LEGACY_DB_TEST_AND_FINAL_EVIDENCE_CLOSURE`

Do not write the evidence file’s own final SHA-256 inside itself as a recursive
integrity claim.

---

## 15. Acceptance decision

Return:

`ACCEPT_P0_1B_SAFETY_CLOSURE_READY_FOR_OWNER_PROVISIONING`

only if:

1. Every real DB test is classified as `*.db.test.ts`.
2. Mixed files are split without losing pure coverage.
3. Every normal command excludes DB tests.
4. Bare/default discovery excludes DB tests.
5. No real DB module is evaluated before guard approval.
6. Runtime zero-connection canaries pass.
7. All count deltas reconcile.
8. Prompt 10 lifecycle and credential separation remain intact.
9. All required non-DB tests pass.
10. Scanner tests pass.
11. All required typechecks and builds pass.
12. No new skip/only/retry/sleep workaround was added.
13. Runtime DB authorization remains false.
14. No DB connection, DB execution, secret, cleanup, commit, push or deployment
    occurred.
15. Git and evidence integrity are complete.

If any condition fails, return:

`P0_1B_SAFETY_CLOSURE_NOT_ACCEPTED`

List only:

- failed gate;
- exact evidence;
- smallest corrective action.

Do not begin another audit or unrelated implementation.

Acceptance at this step means:

- the repository is safe from accidental DB-backed tests during normal test
  execution;
- P0.1B is ready for explicit owner provisioning of a dedicated test-only
  database environment.

It does not mean:

- a test database exists;
- DB-backed tests passed;
- the 115 residue rows were cleaned;
- production was deployed or verified.

---

## 16. Required final response

Return one concise evidence report, not an execution diary:

1. **Verdict**
2. **Legacy DB-test inventory**
3. **Files renamed/split/changed**
4. **Normal-command safety matrix**
5. **Runtime zero-connection proof**
6. **DB-only import-boundary proof**
7. **Exact test-count reconciliation**
8. **Prompt 10 lifecycle verification**
9. **Residue cleanup-plan status**
10. **Test results**
11. **Typecheck/build results**
12. **Skip/only/retry integrity**
13. **Git record**
14. **Evidence integrity**
15. **Owner action still withheld or now permitted**
16. **Production status**

If accepted, the owner-action statement must say only that provisioning may now
be planned. It must not ask the owner to paste secrets into chat.

End with:

`PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`

---

## Final instruction

Complete this once, linearly and without roaming.

Do not:

- reopen A0.3;
- modify trading, UI or API behavior;
- provision a database;
- run DB-backed tests;
- query or clean the operational database;
- flip the runtime lock;
- start the next product phase;
- commit, push or deploy.

The only goal is to prove that **every** normal test pathway is incapable of
reaching a real database and to deliver the complete P0.1B safety evidence
needed before owner provisioning.
