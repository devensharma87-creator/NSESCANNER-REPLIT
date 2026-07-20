# NSESCANNER — P0.1 CORRECTIVE WORK ORDER

**Branch:** `phase0/authorized-remediation-20260720`  
**Expected starting SHA:** `83c58dd797a13b5607035231a25c180e4b6f4ca4`  
**Purpose:** Make the test-isolation guard mandatory and correct the P0.1 acceptance failures  
**Authority:** Test infrastructure and P0.1 evidence only

---

## Copy everything below into Replit Coder

P0.1 is **not accepted**. The existing checkpoint is retained as a reviewable partial implementation. Correct it in place on the authorized branch; do not revert or copy from forensic branches.

This corrective task is limited to the verified P0.1 failures:

1. the default `test` script bypasses the guard;
2. the current `test:unit` config treats unclassified files as safe through a manually approximated exclusion list;
3. the DB preflight spawns Vitest with the original operational `DATABASE_URL`, while existing DB modules read `DATABASE_URL` rather than `TEST_DATABASE_URL`;
4. external-service/broker test-mode enforcement is absent;
5. `TEST_RUN_ID` is only checked for non-emptiness and is not tied to the isolated target;
6. tests 25–26 prove weak script properties instead of mandatory enforcement;
7. P0.1 evidence/memory overstates the current safety boundary.

Do not begin P0.2 or modify any trading/runtime logic.

## 1. Mandatory baseline check

First provide literal read-only output for:

```bash
git branch --show-current
git rev-parse --verify HEAD
git rev-parse --verify main
git status --short --branch
git log -2 --oneline --decorate
```

Required:

- branch: `phase0/authorized-remediation-20260720`;
- starting HEAD: `83c58dd797a13b5607035231a25c180e4b6f4ca4`, except an attachment-only checkpoint on this branch;
- main: `47611aa6fad3785f02f97280570f025c71fb975a`;
- no unexplained source changes.

If branch/main/source state differs, stop before editing.

## 2. Hard prohibitions

Do not:

- connect to any database;
- execute SQL, migrations, schema ensures, seeders or cleanup;
- run existing application, DB-backed, route, integration, scanner or full-suite tests;
- invoke any application endpoint;
- call or authenticate to Kite, Telegram, a broker or any external service;
- start/restart workflows;
- change production DB modules, trading code, C0 constants, signals, writers, routes, schema, UI or runtime adapters;
- merge, rebase, push, publish or deploy;
- delete forensic branches or rewrite history;
- claim runtime DB/network isolation is proved.

Permitted commands are static inspection, TypeScript typecheck, and focused pure tests that import only test-infrastructure files plus Node/Vitest.

## 3. Exact permitted change set

Modify only:

1. `artifacts/api-server/package.json`
2. `artifacts/api-server/src/test-infra/dbTestGuard.ts`
3. `artifacts/api-server/src/test-infra/dbTestPreflightRunner.ts`
4. `artifacts/api-server/src/test-infra/dbTestGuard.test.ts`
5. `artifacts/api-server/vitest.config.unit.ts`
6. `memory/P0_1_TEST_COUPLING_INVENTORY_2026-07-20.md`
7. `memory/P0_1_TEST_ISOLATION_IMPLEMENTATION_AND_EVIDENCE_2026-07-20.md`

If Replit system-level memory instructions require `.agents/memory/MEMORY.md` or its P0.1 topic file to be updated, limit the update to factually correcting P0.1 status and clearly label it platform memory, not production evidence. Otherwise do not touch it.

Do not stage/commit new `attached_assets/Pasted-*` files. If automatic checkpointing cannot exclude them, disclose it; do not hide it.

State the exact intended edits before writing.

## 4. Make the safety boundary mandatory

Change package scripts so:

- the ordinary/default `test` command invokes the fail-closed DB preflight wrapper;
- `test:db` invokes the same wrapper;
- no package script provides a raw all-tests Vitest bypass;
- `test:unit` invokes the strict pure-unit configuration only.

Do not retain an `unsafe`, `legacy`, `all`, `full`, or similarly named raw Vitest bypass.

The focused pure-test command may remain direct because its allowlist will contain only positively reviewed test-infrastructure tests.

Add source-based tests that read `package.json` and prove:

1. `test` routes through the preflight;
2. `test:db` routes through the preflight;
3. neither is a raw Vitest command;
4. no other package script launches the unguarded full API test set;
5. `test:unit` uses only the strict unit config.

## 5. Replace exclusion guessing with a positive unit allowlist

`vitest.config.unit.ts` must not include `src/**/*.test.ts` and then exclude guessed-dangerous files.

For this P0.1 correction, positively allow only:

`src/test-infra/dbTestGuard.test.ts`

No wildcard may admit other application tests. Remove the manual exclusion list or make it irrelevant through the exact include.

The coupling inventory must state:

- `PURE_UNIT_CONFIRMED = 1` for this configuration;
- all other tests remain DB/external/unknown until individually classified;
- “not matched by grep” does not mean pure.

Do not migrate or run other tests in this task.

## 6. Ensure DB tests cannot inherit the operational target

After guard validation and before spawn, build a dedicated child environment.

It must:

1. set child `NODE_ENV=test`;
2. set child `DATABASE_URL` to the already validated `TEST_DATABASE_URL`;
3. not pass the original operational `DATABASE_URL` value to the child;
4. keep `TEST_DATABASE_URL` available only if needed by test infrastructure;
5. preserve only ordinary process/runtime variables needed to launch Node/Vitest;
6. remove/redact production service credentials from the child environment, including project-verified Kite, Telegram and broker secrets;
7. force every existing project-recognized broker/live-order/paper-auto-open/test-notification kill switch to its disabled value;
8. require an explicit `TEST_EXTERNAL_SERVICES_MOCKED=true` confirmation before any DB-backed run;
9. never log either database URL or any secret.

First use static source inspection to identify the actual project environment-variable names. Do not invent a flag and claim enforcement if runtime adapters do not read it.

Add a pure exported function such as `buildIsolatedChildEnv()` and test it with in-memory dummy environments. Do not spawn a real process in tests.

Prove in tests:

- child `DATABASE_URL` equals the dummy test URL;
- the dummy operational URL is absent from all child values;
- dummy Kite/Telegram/broker secrets are absent;
- actual recognized execution switches are disabled;
- missing external-service mock confirmation blocks spawn;
- guard failure blocks environment construction and spawn.

If complete outbound-network blocking cannot be guaranteed without modifying production adapters or adding infrastructure, report:

`EXTERNAL_NETWORK_RUNTIME_ISOLATION: UNPROVED`

Do not overclaim.

## 7. Strengthen run-specific isolation

Strengthen `TEST_RUN_ID`:

- require a conservative format such as 8–64 characters using only letters, digits, `_` or `-`;
- normalize consistently;
- require the isolated database name to contain the normalized run ID, or implement an equally strong test-only per-run schema mechanism without changing production DB code;
- reject a generic shared name such as merely `app_test`;
- retain canonical host/port/database comparison;
- retain explicit confirmation;
- retain operational-name/fingerprint deny controls.

Add stable reason codes for invalid run-ID format and run-ID/target mismatch.

Use `.invalid` or otherwise non-routable dummy URLs only.

## 8. Correct the tests

Replace weak tests 25–26 and expand focused coverage for:

- mandatory default-script preflight;
- no alternate raw full-suite bypass;
- strict one-file positive unit allowlist;
- operational `DATABASE_URL` replaced in child environment;
- secrets removed and real kill switches disabled;
- external-service mock confirmation required;
- invalid `TEST_RUN_ID` formats rejected;
- run ID must appear in the isolated target;
- fake spawn remains the only spawn used;
- failed guard never invokes spawn.

The focused test file may import only Vitest, Node standard-library modules and the test-infrastructure modules under review.

Report every run separately, including failed attempts. Do not state “first run passed” if an earlier command or run failed.

## 9. Permitted verification

You may run only:

- API-server TypeScript typecheck (`tsc --noEmit`), which does not execute modules;
- the exact positively allowlisted guard test through `vitest.config.unit.ts`;
- a static package-script assertion contained in that pure guard test.

Do not run the default `test` or `test:db` command because no isolated DB is provisioned. Their fail-closed/spawn behaviour must be verified with injected fake spawn and source assertions only.

## 10. Evidence corrections

Update both P0.1 documents only after verification. They must clearly distinguish:

- configuration/preflight structure: locally proved;
- actual isolated DB connection and migrations: not run;
- full suite: not run;
- network runtime isolation: unproved unless independently enforced;
- DB/transitive inventory: incomplete where only inferred;
- P0.1 status: locally corrected, runtime proof pending.

Correct any platform memory statement that calls `test:unit` the safe general CI suite. It is only the narrowly allowlisted guard suite at this stage.

## 11. Required final evidence

Return:

- branch, starting SHA, final SHA and main SHA;
- complete changed-file list and diff statistics from `83c58dd`;
- exact package scripts before/after;
- exact positive include list;
- guard/preflight imports;
- child-environment key policy, with values/secrets redacted;
- actual recognized project kill switches found and enforced;
- all reason codes;
- all focused test names and results;
- exact typecheck result;
- confirmation that no database, endpoint or external service was contacted;
- confirmation of no restart/deploy/merge/push;
- all scope deviations;
- untracked/auto-captured attachments;
- acceptance matrix.

Required labels:

`DEFAULT_TEST_FAIL_CLOSED: PROVED|FAILED`

`OPERATIONAL_DATABASE_CHILD_LEAK: PROVED_ABSENT|FAILED|UNPROVED`

`PURE_UNIT_ALLOWLIST: PROVED|FAILED`

`EXTERNAL_NETWORK_RUNTIME_ISOLATION: PROVED|UNPROVED`

`TEST_DATABASE_ISOLATION_RUNTIME_PROOF: NOT_RUN_NO_DATABASE_AUTHORITY`

## 12. Stop rule

Make at most one corrective local commit/checkpoint on the authorized branch. Do not begin P0.2.

Final line must be exactly:

`P0.1 STATUS: LOCALLY CORRECTED — OWNER-PROVISIONED ISOLATED DATABASE AND NETWORK RUNTIME PROOF STILL REQUIRED`

or

`P0.1 STATUS: NOT ACCEPTED — <blocker>`

Wait for owner review.

