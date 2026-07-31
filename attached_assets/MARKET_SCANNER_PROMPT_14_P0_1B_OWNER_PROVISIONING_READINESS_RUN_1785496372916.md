# MARKET SCANNER — P0.1B OWNER PROVISIONING READINESS RUNBOOK

## Role

Act as the senior platform-infrastructure engineer preparing a safe owner
runbook for Devendra’s Market Scanner.

P0.1B test-execution safety has been accepted. This task is documentation and
readiness verification only. Do not provision infrastructure, use secrets,
connect to a database, change the runtime lock or execute DB-backed tests.

---

## 1. Authoritative status

### A0.3

`ACCEPT_A0_3_AS_UNIT_VERIFIED`

A0.3 is frozen.

### P0.1B safety closure

`ACCEPT_P0_1B_SAFETY_CLOSURE_READY_FOR_OWNER_PROVISIONING`

Accepted evidence includes:

- a process-wide preload tripwire around the actual normal suite;
- deliberate sentinel connection detection;
- harmless zero-attempt control;
- malformed-manifest fail-closed proof;
- zero DB network attempts across the complete normal API suite;
- normal-suite exclusion of all 17 DB-only files;
- `test:unit` at 181/181;
- `test:full` at 4250/4250;
- scanner at 843/843;
- runtime authorization still `false as boolean`;
- no real DB connection, provisioning, migration or cleanup;
- evidence SHA-256:
  `afb9329763615312ff58e02e970b45e613949291d4a42cb2fe20f1df1c52025a`;
- exact Prompt 13 terminator count: 1;
- production deployment remains unverified.

Do not reopen the safety closure unless a concrete contradiction is found.

---

## 2. Purpose

Produce a complete, owner-usable runbook for provisioning a dedicated,
isolated PostgreSQL test environment.

The runbook must tell the owner:

- exactly what infrastructure to create;
- exactly which roles/privileges are required;
- exactly which Replit secret names the code expects;
- what each secret’s format must be without exposing any value;
- how operational/test identity separation will be verified;
- what must happen before the runtime lock can be changed;
- which later command will run DB tests;
- how disposable databases and roles are cleaned up;
- what evidence will be required before P0.1B execution acceptance.

Do not perform those steps in this task.

---

## 3. Restrictions

Do not:

- create a database, project, branch or role;
- connect to PostgreSQL;
- test a secret;
- print, read or copy secret values;
- modify Replit Secrets;
- run `test:db`;
- run `*.db.test.ts`;
- execute migrations;
- change `DB_TEST_RUNTIME_AUTHORIZED`;
- clean the 115 operational residue rows;
- modify production/test code unless a documentation fact cannot be derived;
- modify trading, UI, API or schema behavior;
- create a manual commit;
- push, pull, fetch, deploy or publish.

This task must use source inspection and existing accepted evidence only.

---

## 4. Governance

1. Record current HEAD, branch, upstream, ahead/behind and working-tree state.
2. Use observed HEAD as the baseline.
3. Continue past `attached_assets/`-only platform auto-commits after recording
   them.
4. Stop only for an unrelated source, schema, migration, dependency or build
   change.
5. Preserve unrelated user work.
6. Do not revert platform commits.
7. Do not create a manual commit.

---

## 5. Step 1 — Resolve the implemented provisioning contract

Read fully:

- `dbTestPreflightRunner.ts`;
- `dbTestGuard.ts`;
- disposable lifecycle implementation;
- provisioning, migration and Vitest spawn adapters;
- all environment-variable allowlists;
- runtime authorization constant;
- DB-only Vitest configuration;
- Drizzle schema/migration configuration;
- database package connection initialization;
- package scripts;
- existing P0.1B evidence;
- architecture documentation governing DB tests.

Produce an exact contract table:

| Variable/configuration | Required by code? | Parent only? | Child allowed? | Format | Generated or owner-provided | Secret? |
|---|---|---|---|---|---|---|

Include every relevant variable, not only:

- provisioning URL;
- runtime URL;
- `TEST_RUN_ID`;
- `TEST_DATABASE_URL`;
- isolation confirmation;
- external-service disable confirmation;
- runtime authorization;
- migration command/config;
- DB Vitest config.

Use the exact names found in code. Do not invent or rename variables in the
runbook.

---

## 6. Step 2 — Clarify credential and role architecture

Document the actual implemented model.

### Provisioning identity

State whether it requires:

- `LOGIN`;
- `CREATEDB`;
- `CREATEROLE`;
- database ownership;
- schema creation;
- role grants;
- role deletion;
- database deletion.

It must not have access to the operational cluster.

### Runtime identity

State how the disposable runtime identity is created or supplied.

It must have:

- no superuser;
- no `CREATEDB`;
- no `CREATEROLE`;
- no replication;
- no bypass-RLS;
- no access to the operational cluster;
- access only to the disposable database and required schema objects.

### Child-environment boundary

Prove from source that:

- the provisioning credential remains parent-only;
- the Vitest child receives only the restricted runtime URL;
- operational `DATABASE_URL` is not inherited;
- unrelated production secrets are not inherited;
- broker, scheduler and notification integrations are disabled.

If the implementation requires two owner secrets, say so. Do not force a
one-secret design if it violates least privilege.

---

## 7. Step 3 — Define infrastructure requirements

The required environment must be:

- a dedicated test-only PostgreSQL project/server/cluster;
- physically/logically separate from the operational project;
- identified by a distinct hostname/project identity;
- disposable and cost-controlled;
- TLS-enabled where supported;
- restricted from public/untrusted administration where possible;
- able to create and delete per-run databases and roles if required by the
  implementation;
- compatible with the application’s PostgreSQL and Drizzle versions.

The runbook must prohibit:

- using the operational server with another database name;
- using the operational role;
- using a production replica;
- using a fixed database while claiming per-run isolation;
- placing operational credentials in any test secret;
- passing the provisioning credential to test code.

Do not recommend a specific paid provider unless the source/project already
requires it. You may describe provider-neutral requirements and optionally list
verified-compatible examples as non-binding choices.

---

## 8. Step 4 — Owner creation checklist

Write a numbered owner checklist covering:

1. Create a separate test-only PostgreSQL project/server.
2. Give it a clear non-production name.
3. Confirm its hostname/project ID differs from operational infrastructure.
4. Create the minimum provisioning identity required by the implemented
   lifecycle.
5. Create or permit creation of the restricted runtime identity.
6. Confirm privilege exclusions.
7. Capture the required connection material privately.
8. Add only the exact required secret names in Replit Secrets.
9. Do not replace operational `DATABASE_URL`.
10. Do not paste any URL or credential into chat, source, logs or evidence.
11. Do not flip the runtime authorization lock.
12. Return only a redacted confirmation that provisioning inputs are present.

For every owner step include:

- purpose;
- exact expected result;
- redacted verification;
- common mistake;
- rollback/revoke action.

Do not put real values or realistic credentials in examples.

---

## 9. Step 5 — Endpoint-identity separation checks

Define the checks the next execution phase must perform before connecting:

- URL parses as PostgreSQL;
- test endpoint is present;
- operational and test normalized host/port/project identity differ;
- test database/project naming contains an isolation marker;
- denylisted operational names are absent;
- provisioning and runtime usernames differ where required;
- provisioning URL never becomes child `DATABASE_URL`;
- generated DB/role identifiers contain the validated run ID;
- identifier lengths and characters are valid;
- TLS requirements match policy;
- no secret is logged.

Specify exactly which checks can be performed without connecting and which
require the separately authorized execution phase.

Do not connect now.

---

## 10. Step 6 — Disposable lifecycle runbook

Describe the later authorized run in exact order:

1. Preflight environment validation.
2. Runtime authorization confirmation.
3. Unique run-ID generation.
4. Disposable DB-name derivation.
5. Restricted runtime-role derivation/creation.
6. Disposable DB creation.
7. Schema bootstrap/migration.
8. DB-only Vitest execution.
9. Test-result capture.
10. Database and role cleanup.
11. Cleanup verification.
12. Sanitized evidence output.

For every step identify:

- executing component;
- credential used;
- failure behavior;
- cleanup behavior;
- evidence emitted;
- secret-redaction requirement.

Document success and failure cleanup separately.

---

## 11. Step 7 — Runtime-lock authorization boundary

The lock currently remains:

`DB_TEST_RUNTIME_AUTHORIZED = false as boolean`

The runbook must state that provisioning alone does not authorize changing it.

Before a later prompt may change the lock, require:

1. owner confirms dedicated test-only infrastructure exists;
2. required Replit secret names are present;
3. no secret value was placed in source/chat/evidence;
4. endpoint identity checks pass in redacted form;
5. provisioning/runtime privilege model matches the implementation;
6. schema bootstrap pathway is ready;
7. disposable cleanup pathway is ready;
8. owner explicitly authorizes DB-test execution;
9. operational residue cleanup remains a separate decision.

Define the exact future owner authorization phrase:

`AUTHORIZE_P0_1B_ISOLATED_DB_TEST_EXECUTION`

Do not treat this prompt as that authorization.

---

## 12. Step 8 — Clarify remaining evidence items

Without reopening accepted safety work, resolve these reporting ambiguities:

### Transient test failure

The prior execution log mentions one failed `test:full` run followed by a pass.

Report:

- exact file and test name;
- exact failure message;
- whether it was reproduced;
- whether resource contention/concurrency caused it;
- why it does or does not affect acceptance.

Do not simply label it “transient” without evidence.

### Tripwire worker identity

Explain how 296 manifests map to:

- OS PIDs;
- worker-thread IDs;
- fork IDs or unique manifest IDs.

Confirm there are no same-PID overwrite races.

### Exact verification commands

List the exact commands previously described as:

- four typechecks;
- two builds.

Identify whether each is a typecheck or a production build. Confirm whether
API-Zod, API-client React, API-server and scanner were each covered.

If a required supported check was omitted, run only that non-DB check now and
report it. Do not run broad suites again unnecessarily.

---

## 13. Step 9 — Required deliverable

Create:

`artifacts/audit-evidence/PHASE_P0_1B_OWNER_PROVISIONING_READINESS_RUNBOOK.md`

It must contain:

1. authoritative accepted status;
2. exact implemented environment contract;
3. infrastructure requirements;
4. provisioning/runtime role matrix;
5. owner creation checklist;
6. redacted separation checks;
7. disposable lifecycle sequence;
8. failure and cleanup behavior;
9. runtime-lock authorization boundary;
10. future execution authorization phrase;
11. transient-failure clarification;
12. manifest identity clarification;
13. exact typecheck/build mapping;
14. Git record;
15. confirmation that no connection, provisioning or secret access occurred.

Use exactly once as the final nonblank line:

`END_PHASE_P0_1B_OWNER_PROVISIONING_READINESS_RUNBOOK`

After writing:

- compute SHA-256;
- verify exact terminator count is 1;
- verify it is the final nonblank line.

Do not embed a recursive self-hash inside the file.

---

## 14. Git record

Report:

- starting HEAD;
- final HEAD;
- branch;
- upstream;
- ahead/behind;
- platform auto-commits;
- exact changed-file inventory;
- diff stat/status;
- staged/untracked state;
- manual commit: no/yes;
- push/pull/fetch/deploy/publish: no/yes.

No manual commit is authorized.

---

## 15. Acceptance decision

Return:

`P0_1B_OWNER_PROVISIONING_RUNBOOK_READY`

only if:

1. every required variable is sourced from code;
2. owner-provided versus generated values are distinguished;
3. provisioning and runtime privileges are separated;
4. operational infrastructure reuse is explicitly prohibited;
5. owner steps are complete and reversible;
6. endpoint separation checks are specified;
7. disposable lifecycle and cleanup are documented;
8. runtime lock remains false;
9. future authorization boundary is explicit;
10. transient failure and manifest identity are clarified;
11. exact build/typecheck commands are reconciled;
12. no DB connection, provisioning, migration, secret access, cleanup, commit,
    push or deployment occurred;
13. SHA-256 and terminator proof are complete.

If any item is unresolved, return:

`P0_1B_OWNER_PROVISIONING_RUNBOOK_NOT_READY`

and list only the missing fact and smallest next action.

---

## 16. Required final response

Return one concise owner-facing report:

1. **Verdict**
2. **Infrastructure to create**
3. **Required roles and privileges**
4. **Exact Replit secret names—names only**
5. **Owner checklist**
6. **What must never be reused or shared**
7. **Future execution sequence**
8. **Runtime-lock boundary**
9. **Evidence clarifications**
10. **Git/evidence integrity**
11. **Next owner decision**
12. **Production status**

Do not ask the owner to paste secrets into chat.

End with:

`PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`

---

## Final instruction

Produce the runbook once and stop.

Do not provision, connect, migrate, execute DB tests, flip the lock, clean
operational residue or begin another product phase. The purpose is to make the
owner’s next manual infrastructure action exact, safe and reversible.
