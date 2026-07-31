# MARKET SCANNER — P0.1B PROCESS-WIDE DB TRIPWIRE AND FINAL ACCEPTANCE

## Role

Act as the senior database-safety verification engineer for Devendra’s Market
Scanner.

This is a single final P0.1B acceptance pass. Do not conduct another broad
audit, redo the legacy test migration, provision infrastructure, execute DB
tests or clean operational records.

The repository restructuring appears substantially correct. The remaining
blocker is that the reported zero-connection proof observes only test-local
fake classes. It does not instrument the real `test:full` process or its Vitest
workers.

---

## 1. Authoritative status

### A0.3

`ACCEPT_A0_3_AS_UNIT_VERIFIED`

A0.3 is frozen. Do not modify F&O, VWAP, paper trading, signals, routes, schemas
or UI behavior.

### P0.1B

Current verdict:

`P0_1B_SAFETY_CLOSURE_NOT_ACCEPTED — PROCESS_WIDE_ZERO_CONNECTION_PROOF_MISSING`

Preserve the accepted work:

- 12 DB-only files using `*.db.test.ts`;
- normal/default exclusion of DB-only files;
- mixed-test splits;
- pure-test retention;
- guarded dynamic imports;
- disposable lifecycle implementation;
- provisioning/runtime credential separation;
- current unit, non-DB and scanner tests;
- runtime DB authorization remaining false;
- operational residue remaining untouched.

---

## 2. Why the current proof is insufficient

The current `_suiteWire`, `_TestPool` and `_TestClient` are local test doubles.

They prove only that:

- the fake constructors increment fake counters;
- the fake assertions detect fake non-zero values;
- missing fake telemetry fails.

They do **not** observe:

- other Vitest test files;
- other module registries;
- worker threads;
- worker processes;
- actual `@workspace/db` transport attempts;
- actual `test:full` execution.

The previous response explicitly states:

> “`vi.mock("pg")` is scoped to `dbTestGuard.test.ts`’s module context.
> Cross-file proof is structural.”

Therefore, the normal-command matrix cannot truthfully claim that the complete
suite made zero DB connection attempts.

Keep the unit negative controls if useful, but do not present them as
process-wide evidence.

---

## 3. Mission

Complete only:

1. Implement an end-to-end process-wide DB network tripwire.
2. Run the real normal non-DB suite under that tripwire using a fake local DB
   endpoint.
3. Prove the same tripwire detects a deliberate connection attempt.
4. Confirm no DB-only files are collected.
5. Re-run the exact acceptance tests, typechecks and builds.
6. Provide the missing Git and evidence integrity.

Do not modify production behavior unless the tripwire reveals a specific
unsafe normal-test path.

---

## 4. Prohibited actions

Do not:

- use the real operational `DATABASE_URL` in any child;
- print or record the real DB URL;
- connect to PostgreSQL;
- start a PostgreSQL server;
- run `test:db`;
- execute `*.db.test.ts`;
- provision a database;
- run schema migration against any endpoint;
- alter `DB_TEST_RUNTIME_AUTHORIZED`;
- clean the 115 operational residue rows;
- modify trading/UI/API/schema behavior;
- weaken or skip tests;
- create a manual commit;
- push, pull, fetch, deploy or publish.

The fake endpoint must use loopback only and must never accept or complete a
database connection.

---

## 5. Governance

1. Record current HEAD, branch, upstream, ahead/behind and working-tree state.
2. Use observed HEAD as the baseline.
3. Do not require a historical HEAD to match.
4. Record and continue past `attached_assets/`-only platform auto-commits.
5. Record platform auto-commits containing only already-reviewed task files.
6. Stop for unrelated source, test, schema, migration, dependency or build
   changes.
7. Do not revert platform commits.
8. Preserve unrelated user work.

---

## 6. Step 1 — Confirm the actual DB transport

Read:

- `@workspace/db` implementation;
- `pg`/Drizzle initialization;
- connection-string parsing;
- all DB transport adapters;
- any Neon HTTP, WebSocket or alternate transport;
- test runner process/worker configuration.

State explicitly:

- whether operational DB access uses TCP through `pg`;
- whether TLS is used;
- whether any DB access can use HTTP, HTTPS, fetch or WebSocket;
- whether Vitest uses threads, forks or both;
- whether `NODE_OPTIONS` propagates to every relevant child.

If the application has another DB transport, the process-wide tripwire must
cover it too. Do not assume `net.Socket` is the only transport without reading
the code.

---

## 7. Step 2 — Implement a process-wide preload tripwire

Create a test-only preload module, for example:

`src/test-infra/dbNetworkTripwire.preload.cjs`

The exact name may differ, but it must load before application and test modules.

### 7.1 Safe environment

The harness must:

1. Create a unique temporary evidence directory using a safe temp API.
2. Generate a random nonce.
3. Choose an unused high loopback port.
4. Replace—not preserve—the child’s `DATABASE_URL` with a fake value such as:

   `postgresql://tripwire:tripwire@127.0.0.1:<port>/tripwire_only`

5. Remove `TEST_DATABASE_URL`.
6. Keep DB runtime authorization false.
7. Disable external services.
8. Pass the tripwire preload through `NODE_OPTIONS`.
9. Ensure the preload configuration propagates to Vitest workers/forks.
10. Never include the operational URL in the child environment.

Do not open a listening database socket on the selected port.

### 7.2 Runtime interception

At minimum intercept the actual low-level pathways used by the DB transport:

- `net.Socket.prototype.connect`;
- TLS connection creation when applicable.

If DB transport can use HTTP/HTTPS/fetch/WebSocket, intercept the matching
sentinel endpoint as well.

The tripwire must match only the sentinel loopback host/port or sentinel URL.
It must not interfere with unrelated safe local test behavior.

On any matching connection attempt:

1. Increment an explicit numeric counter.
2. Record PID, nonce, pathway and timestamp.
3. Persist the manifest synchronously.
4. Throw/fail before the socket or request is opened.
5. Return a stable error such as:

   `DB_NETWORK_TRIPWIRE_CONNECTION_ATTEMPT`

No network connection may be completed.

### 7.3 Per-process manifests

Every process loading the preload must create/update a unique manifest:

`tripwire-<pid>.json`

Each manifest must contain:

- schema version;
- nonce;
- PID;
- preload-loaded flag;
- connection-attempt count;
- per-pathway counts;
- malformed-state flag;
- no credentials or secrets.

The acceptance harness must fail if:

- no manifest exists;
- nonce mismatches;
- required fields are absent;
- counters are not finite numbers;
- a manifest is malformed;
- any attempt count is non-zero.

No `?? 0`, `|| 0`, optional-to-zero or missing-manifest-as-success behavior.

---

## 8. Step 3 — Prove the tripwire itself works

Use the same preload and aggregation path for positive and negative controls.

### NEG-NET-01

Spawn a small child under the preload that deliberately calls
`net.connect()` for the exact sentinel loopback host/port.

Required result:

- child fails with the stable tripwire error;
- manifest exists;
- attempt count is greater than zero;
- no socket connection completes.

### NEG-NET-02

If TLS is part of the actual DB transport, deliberately invoke the matching TLS
path and prove detection.

### NEG-NET-03

Delete/corrupt a required manifest field and prove aggregation fails closed.

### POS-NET-01

Spawn a harmless child under the preload without connecting.

Required result:

- preload manifest exists;
- all required fields exist;
- all attempt counters are explicit numeric zero;
- child succeeds.

These controls must use the exact same preload and manifest parser used for the
full suite.

---

## 9. Step 4 — Run the actual full non-DB suite under the tripwire

Run the authoritative full non-DB API suite in a child process with:

- fake sentinel `DATABASE_URL`;
- actual operational URL removed;
- preload installed through `NODE_OPTIONS`;
- DB-only files excluded;
- external services disabled.

After completion:

1. Confirm the suite passed.
2. Enumerate all tripwire manifests.
3. Validate every manifest.
4. Sum every attempt counter.
5. Require the aggregate to equal exactly zero.
6. Confirm the suite did not collect any `*.db.test.ts`.
7. Confirm no DB-backed test was skipped as a substitute for exclusion.

This is the required end-to-end evidence.

Do not claim that fake `_suiteWire` counters observed the full suite.

Required report:

| Run | Suite exit | Manifests | Processes instrumented | DB files collected | Network attempts | Result |
|---|---:|---:|---:|---:|---:|---|
| Negative control | | | | N/A | >0 | detected |
| Harmless control | | | | N/A | 0 | pass |
| `test:full` | | | | 0 | 0 | pass |

If worker processes do not inherit the preload, stop and correct the harness.
Do not accept parent-only instrumentation.

---

## 10. Step 5 — Preserve structural DB-test proof

Reconfirm all 12 DB-only files:

- are excluded from default/full/unit configs;
- are included only by DB config;
- have no static DB-connected imports;
- call `checkDbTestIsolation()` before dynamic DB imports;
- cannot be evaluated through normal collection.

List all 12 paths.

Do not execute them.

---

## 11. Step 6 — Final count reconciliation

Preserve and verify:

| Component | Delta | Running total |
|---|---:|---:|
| Pre-Prompt 11 baseline | — | 4354 |
| DB-dependent tests removed | −81 | 4273 |
| Prompt 11 safety tests | +8 | 4281 |
| Prompt 12 negative controls | +7 | 4288 |

If Prompt 13 adds test cases, include their exact delta and report the truthful
new total.

Provide the 81 removed DB tests by original file:

- 14
- 16
- 15
- 8
- 5
- 6
- 4
- 8
- 2
- 3

Confirm these sum to 81 and map each count to the correct file.

Report exact current totals for:

- unit suite;
- full non-DB API suite;
- scanner suite;
- A0.3 route-handler test file;
- A0.3 HTTP route test file;
- tripwire tests;
- DB-only static inventory.

---

## 12. Step 7 — Required verification

Run and report exact commands for:

1. Tripwire negative controls.
2. Tripwire harmless control.
3. Full non-DB API suite under the tripwire.
4. Normal unit suite.
5. A0.3 route-handler tests.
6. A0.3 HTTP route tests.
7. Full scanner suite.
8. API-server typecheck.
9. API-Zod typecheck.
10. API-client React typecheck.
11. Scanner typecheck.
12. Supported workspace typecheck, or explicitly state none exists.
13. API-server production build.
14. Scanner production build.
15. API-client/frontend production build, or identify why no supported build
    exists.
16. `git diff --check`.
17. Diff audit for new:
    - `.skip`;
    - `.only`;
    - retries;
    - arbitrary sleeps;
    - assertion weakening;
    - real connection strings;
    - credentials.

For every test command report files, passed, skipped and failed.

Do not describe unnamed “four typechecks” or “two builds.”

---

## 13. Step 8 — Residue status

Do not query or clean the operational database.

Report:

- 115 known rows remain untouched;
- cleanup is not authorized;
- exact primary keys remain a future read-only prerequisite;
- P&L/dashboard impact analysis remains pending if not documented;
- backup SHA-256 procedure remains pending if not documented;
- unrelated-row preservation proof remains pending if not documented.

Do not allow these cleanup-plan gaps to block P0.1B test-safety acceptance.
They block only future operational residue cleanup.

---

## 14. Step 9 — Git record

Report:

- starting HEAD;
- final HEAD;
- branch;
- upstream;
- ahead/behind;
- all platform auto-commits;
- exact current changed-file inventory;
- `git diff --stat`;
- `git diff --name-status`;
- staged state;
- untracked files;
- whether a manual commit occurred;
- whether push, pull, fetch, deploy or publish occurred.

Do not claim a clean tree if evidence or tripwire files are modified/untracked.

---

## 15. Step 10 — Evidence integrity

Append one final bounded section to:

`artifacts/audit-evidence/PHASE_P0_1B_SAFE_TEST_DATABASE_INFRASTRUCTURE.md`

Include:

1. Why test-local `_suiteWire` was insufficient.
2. Actual DB transport determination.
3. Preload tripwire design.
4. Negative-control result.
5. Harmless-control result.
6. Full-suite process-wide result.
7. Manifest schema and aggregate.
8. DB-only file inventory.
9. Final test reconciliation.
10. Exact test/typecheck/build commands.
11. Residue status.
12. Git record.
13. Confirmation:
    - operational URL was not passed to children;
    - `NO_REAL_DATABASE_CONNECTION`;
    - no DB tests;
    - no migration;
    - no provisioning;
    - no cleanup;
    - runtime lock unchanged;
    - no manual commit;
    - no push;
    - no deployment.

After the file is complete:

1. Compute the real SHA-256.
2. Report the 64-character digest in the final response.
3. Count the exact Prompt 13 terminator using exact whole-line matching.
4. Require that exact count to equal `1`.
5. Require it to be the final nonblank line.

Use exactly once:

`END_PHASE_P0_1B_PROCESS_WIDE_DB_TRIPWIRE_AND_FINAL_ACCEPTANCE`

Do not report “three terminators in the file.” Report the count for this exact
terminator string.

Do not place a recursive self-hash claim inside the evidence file.

---

## 16. Acceptance gate

Return:

`ACCEPT_P0_1B_SAFETY_CLOSURE_READY_FOR_OWNER_PROVISIONING`

only if:

1. The full non-DB suite ran with the operational URL removed.
2. The fake loopback URL was used.
3. The preload loaded in every relevant process/worker.
4. The deliberate connection attempt was detected and blocked.
5. The harmless control passed with explicit zero.
6. Every manifest was present, valid and nonce-matched.
7. Aggregate full-suite DB network attempts were exactly zero.
8. No DB-only file was collected or executed.
9. All normal tests passed.
10. A0.3 targeted tests passed.
11. Scanner tests passed.
12. All named typechecks/builds passed or a genuinely unsupported command was
    identified.
13. Counts reconcile.
14. SHA-256 and exact terminator evidence are complete.
15. Runtime authorization remains false.
16. No real DB connection, DB test, provisioning, migration, cleanup, secret,
    manual commit, push or deployment occurred.

If any gate fails, return:

`P0_1B_SAFETY_CLOSURE_NOT_ACCEPTED`

Report only the failed gate and smallest correction. Do not begin another broad
audit.

---

## 17. Required final response

Return one concise evidence report:

1. **Verdict**
2. **Why the prior canary was rejected**
3. **Actual DB transport**
4. **Process-wide tripwire design**
5. **Negative and harmless controls**
6. **Full-suite manifest/attempt results**
7. **DB-only inventory**
8. **Exact test reconciliation**
9. **Targeted/full test results**
10. **Named typecheck/build results**
11. **Residue status**
12. **Git record**
13. **Evidence SHA-256 and exact terminator proof**
14. **Next owner action**
15. **Production status**

If accepted, state that the next step is to prepare the owner’s isolated
test-only infrastructure provisioning instructions. Do not ask for secrets in
chat and do not flip the runtime lock yet.

End with:

`PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`

---

## Final instruction

Complete this once and stop.

Do not add another fake counter that observes only itself. Run the actual normal
suite under a process-wide tripwire with the operational URL removed, prove the
tripwire detects a deliberate attempt, provide the complete evidence and close
P0.1B safety professionally.
