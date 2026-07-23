# P0.3 Final Correction and Acceptance

## Complete the work — do not deploy

Act as a senior backend engineer, PostgreSQL migration specialist, trading-system safety engineer and independent release auditor.

This is the final P0.3 corrective task. Resolve the remaining defects completely and provide reliable evidence. Do not merely rewrite the report or relabel failed evidence as passed.

## Verified production baseline

Production/origin main SHA:

`e7ae078368ff076e3f2d27322b353397327ab2e5`

The latest P0.3 corrective work exists only locally and must remain unpushed and undeployed until acceptance.

## Current accepted work

Preserve these corrections:

- Runtime DDL was removed.
- Schema preflight is read-only.
- Seven evidence-column definitions are verified.
- Controlled owner-run migration source exists.
- Operational `DATABASE_URL` is rejected by the test guard.
- Pure and regression test suites are green.
- Development DB schema mutation was disclosed.
- No production migration or deployment occurred.

## Remaining defects

1. No dedicated test database exists, so PostgreSQL integration proof is incomplete.
2. Equity AUTO/STAGED C0 claims are incorrect:
   - `ENTRY_CUTOFF_PASSED` is a cutoff rule, not the hard C0 kill switch.
   - One test reports AUTO `allowed=true` before cutoff.
3. F&O fail-closed evidence was incorrectly labelled as independent F&O C0 proof.
4. The DDL incident report contains a `paper_trace_eq` versus `paper_trade_eq` inconsistency.
5. The corrective working tree is uncommitted and has no final SHA.
6. Production non-contact and database fingerprints are incomplete.

## Non-negotiable restrictions

Do not:

- Push to `origin/main`.
- Publish or deploy.
- Execute the production migration.
- Modify the development business database.
- Drop the seven development columns.
- Modify historical rows.
- Use `DATABASE_URL` for tests.
- Weaken test isolation.
- Reintroduce runtime DDL.
- Expose credentials or connection strings.
- Enable broker execution.
- Start Upstox, IndianAPI or Yahoo-removal work.
- Change strategy thresholds, indicators, P25, position sizing or unrelated logic.

A local corrective commit is allowed. No remote push is allowed.

## Task 1 — Determine the actual C0 architecture

Search the complete repository for the real hard controls, including but not limited to:

- `EQUITY_AUTO_OPEN_C0_BLOCKED`
- `FNO_AUTO_OPEN_C0_BLOCKED`
- `C0_EQUITY`
- `C0_FNO`
- Auto-open disable constants
- Entry-lane kill switches
- All AUTO, STAGED, `nse_fo` and `bse_fo` insertion paths

Produce a complete call-path map:

```text
request/scheduler
→ admission
→ C0 gate
→ evidence validation
→ transaction
→ INSERT
```

For each lane identify:

- Exact gate constant/function.
- Exact source file and line.
- Whether it is called.
- Whether it executes before `INSERT`.
- Exact rejection reason.
- Whether zero insertion calls are guaranteed.

Do not confuse these controls:

- Entry cutoff.
- Missing evidence.
- Stale quote.
- Calendar unavailable.
- Strategy rejection.
- C0 hard kill switch.

## Task 2 — Fix C0 enforcement if necessary

Required permanent safety state:

- Manual equity may proceed only with valid P0.2/P0.3 evidence.
- Equity AUTO must be hard-blocked by C0.
- Equity STAGED/AUTO-open execution must be hard-blocked by C0.
- NSE F&O automatic opening must be hard-blocked by C0.
- BSE F&O automatic opening must be hard-blocked by C0.
- Broker execution must remain disabled.

If the C0 constants exist but are not enforced on every high-level writer path, make the smallest necessary correction.

Requirements:

1. C0 must execute before any insert or broker call.
2. C0 must not depend on cutoff time.
3. C0 must not depend on evidence being absent.
4. Valid session, valid cutoff and valid evidence must still result in a C0 block.
5. C0 rejection must produce zero insertion calls.
6. C0 rejection must produce zero broker calls.
7. Manual equity must not be accidentally blocked.
8. Do not change trading strategy logic.

Use the existing repository-standard C0 reason code. Do not invent a second competing reason if one already exists.

## Task 3 — Add real C0 tests

Add focused high-level tests, not only `computeFinalExecutionAdmission` unit tests.

### A. Equity AUTO

- Valid NSE session.
- Cutoff not passed.
- Valid authoritative Kite evidence.
- Valid price and symbol.
- Expected: blocked specifically by equity C0.
- Insert callback count: zero.

### B. Equity STAGED/AUTO-open execution

- Valid session.
- Valid staged approval.
- Cutoff not passed.
- Valid Kite evidence.
- Expected: blocked specifically by equity C0.
- Insert callback count: zero.

### C. Manual equity control case

- Same valid session/evidence.
- Source `MANUAL`.
- Expected: C0 does not block it.
- Normal P0.2/P0.3 admission continues.

### D. NSE F&O

- Otherwise valid context.
- Expected: blocked specifically by F&O C0.
- Insert callback count: zero.
- Broker-call count: zero.

### E. BSE F&O

- Otherwise valid context where possible.
- Expected: blocked by F&O C0 before execution.
- Also retain independent calendar-unavailable/fail-closed testing.
- Insert callback count: zero.

### F. Independent secondary protections

Retain separate tests for:

- Entry cutoff passed.
- Missing F&O premium timestamp.
- Stale evidence.
- Future timestamp.
- Yahoo evidence.
- Symbol mismatch.
- Invalid price.
- Unverified BSE calendar.

The tests must prove which gate blocked the operation. Passing because an earlier unrelated gate failed is not acceptable.

## Task 4 — Correct the database-incident record

Resolve this discrepancy:

The previous report listed:

```sql
ALTER TABLE paper_trace_eq
ADD COLUMN fill_policy_max_age_sec ...
```

but also claimed all seven columns exist on `paper_trade_eq`.

Using read-only evidence only:

1. Recover the exact SQL executed if logs/history are available.
2. Determine whether `paper_trace_eq` was a report typo.
3. Check whether `paper_trace_eq` exists.
4. Check which table actually contains `fill_policy_max_age_sec`.
5. Report the exact result.

Do not alter either table.

Final disclosure must state one of:

```text
DDL_REPORT_TYPO_CONFIRMED=TRUE
```

or

```text
DDL_TARGET_DISCREPANCY_UNRESOLVED=TRUE
```

Never silently correct the report without evidence.

## Task 5 — Complete database identity evidence

Without exposing credentials, produce stable fingerprints for:

- Operational development database.
- Dedicated test database, if present.
- Production database, using already available read-only configuration/evidence only.

A fingerprint may be a SHA-256 hash derived from non-secret target identity components. Do not output connection URLs or passwords.

For each report:

- Environment classification.
- Database name.
- Schema.
- Redacted role.
- Host fingerprint.
- Isolation relationship.

Do not connect to production merely to create evidence unless a pre-existing authorised read-only method exists.

Git SHA difference alone is not proof that the production DB was not contacted.

## Task 6 — Dedicated test-database gate

Check whether all of these are present:

- `TEST_DATABASE_URL`
- `TEST_DB_ISOLATION_CONFIRMED=true`
- `TEST_RUN_ID`
- Isolation guard returns `ok=true`

Never use `DATABASE_URL` as fallback.

### If a dedicated test database exists

Only after the guard passes, DDL/DML is authorised against that dedicated test database.

Then:

1. Apply the P0.3 migration to the dedicated test DB.
2. Run successful persistence round-trip.
3. Run atomic rollback test.
4. Run legacy-null read test.
5. Run `numeric(10,3)` precision test.
6. Run `timestamptz` round-trip test.
7. Run rejection zero-row tests.
8. Clean test fixtures through the approved harness.
9. Report exact test-DB mutation counts.

### If no dedicated test database exists

Do not provision a chargeable external resource without owner authorisation.

Do not use development or production.

Complete every non-DB task and report exactly:

```text
TEST_DATABASE_URL_PRESENT=FALSE
P0_3_INTEGRATION_TESTS=BLOCKED_DEDICATED_TEST_DATABASE_REQUIRED
ATOMIC_ROLLBACK_PROVEN=FALSE
LEGACY_NULL_READ_PROVEN=FALSE
```

Also provide one concise `OWNER ACTION` section explaining exactly what the owner must create or configure. Do not pretend that skipped tests passed.

## Task 7 — Required integration tests

When an authorised dedicated test database becomes available, prove:

1. Successful manual equity insertion persists:
   - Symbol.
   - Entry price.
   - Provider.
   - Provider timestamp.
   - Decision time.
   - Computed age.
   - Policy ID.
   - Policy maximum age.
   - Evidence version.
2. All values originate from one `ValidatedFillEvidence` instance.
3. Forced transaction failure commits:
   - Zero trade rows.
   - Zero partial evidence rows.
4. Legacy row with all seven fields null:
   - Remains readable.
   - Is not assigned invented provenance.
   - Is not backfilled.
5. PostgreSQL round-trip preserves:
   - Timestamp meaning.
   - Numeric precision and scale.
   - Nullable fields.
   - Evidence version.
6. Rejected inputs commit zero rows:
   - Null evidence.
   - Stale evidence.
   - Future timestamp.
   - Yahoo evidence.
   - Symbol mismatch.
   - Invalid price.
   - AUTO C0.
   - STAGED C0.
   - NSE F&O C0.
   - BSE F&O C0.

## Task 8 — Migration safety

Do not execute the production migration.

Verify the runbook includes:

- Explicit target-identity preflight.
- Owner confirmation.
- Schema-qualified `public.paper_trade_eq`.
- Transaction.
- `lock_timeout`.
- `statement_timeout`.
- Pre-migration inventory.
- Seven idempotent additive columns.
- Post-migration type verification.
- Application deployment only after migration success.
- Fail-closed behaviour when schema is missing.
- Manual rollback-impact explanation.
- No automatic `DROP COLUMN`.

The application must contain no runtime `ALTER`, `CREATE` or `DROP` path for P0.3.

## Task 9 — Verification

Run and report the exact command, exit code, pass/fail/skip counts and warnings for:

- `fillEvidencePersistence.test.ts`
- `schemaPreflightVerifier.test.ts`
- `paperTradingEqProvenance.test.ts`
- `tradeAdmission.test.ts`
- `equitySessionGate.test.ts`
- `sessionAdmission.test.ts`
- `dbTestGuard.test.ts`
- New high-level C0 tests
- P0.3 integration tests if authorised
- API-server typecheck
- Shared-library typecheck
- Full workspace typecheck
- `git diff --check`
- Repository-wide runtime-DDL search

Do not count skipped integration tests as passed.

## Task 10 — Create an immutable local checkpoint

After all authorised corrections:

1. Review the complete diff.
2. Confirm no unrelated files changed.
3. Create one local corrective commit.
4. Do not push.
5. Report:
   - Starting SHA.
   - Final SHA.
   - Branch.
   - `origin/main` SHA.
   - Ahead/behind count.
   - `git status --short`.
   - Complete changed-file list.

If attached prompt files remain untracked, report them separately. Do not include them accidentally unless they are intentional project evidence.

## Task 11 — Final untruncated report

Return a complete report containing:

A. Actual C0 architecture  
B. C0 fixes, if required  
C. Exact gate-test results  
D. Runtime-DDL proof  
E. Migration readiness  
F. Database-incident correction  
G. Database fingerprints  
H. Test-isolation evidence  
I. Integration results or exact blocker  
J. Git identity  
K. Production identity  
L. Residual blockers  
M. Mandatory labels

## Mandatory labels

```text
FINAL_SHA=
HEAD_SHA=
ORIGIN_MAIN_SHA=e7ae078368ff076e3f2d27322b353397327ab2e5
PRODUCTION_SHA=e7ae078368ff076e3f2d27322b353397327ab2e5

RUNTIME_DDL_PRESENT=FALSE
SCHEMA_PREFLIGHT_READ_ONLY=TRUE
SCHEMA_PREFLIGHT_EXACT_TYPES_VERIFIED=
CONTROLLED_MIGRATION_SOURCE_READY=
PRODUCTION_MIGRATION_EXECUTED=FALSE

DEVELOPMENT_DB_SCHEMA_ALREADY_MUTATED=TRUE
DDL_REPORT_TYPO_CONFIRMED=
DDL_TARGET_DISCREPANCY_UNRESOLVED=
CORRECTION_PASS_ADDITIONAL_DB_MUTATIONS=0
PRODUCTION_DB_MUTATIONS=0
HISTORICAL_ROWS_MODIFIED=0

TEST_DATABASE_URL_PRESENT=
TEST_DB_ISOLATION_PROVEN=
P0_3_PURE_TESTS=
P0_3_INTEGRATION_TESTS=
ATOMIC_ROLLBACK_PROVEN=
LEGACY_NULL_READ_PROVEN=

EQUITY_AUTO_C0=
EQUITY_STAGED_C0=
MANUAL_EQUITY_C0_UNAFFECTED=
NSE_FNO_C0=
BSE_FNO_C0=
NSE_FNO_FAIL_CLOSED=
BSE_FNO_FAIL_CLOSED=
YAHOO_TRADE_ELIGIBLE=FALSE
BROKER_EXECUTION=DISABLED

PUSHED=NO
PUBLISHED=NO
DEPLOYED=NO
```

## Acceptance rule

End with exactly one:

```text
P0_3_ACCEPTED_NOT_DEPLOYED
```

or

```text
P0_3_BLOCKED: <specific evidence-backed reason>
```

`P0_3_ACCEPTED_NOT_DEPLOYED` is permitted only if:

- Actual C0 kill switches are proven.
- All code and typechecks pass.
- Runtime DDL is absent.
- The final checkpoint is committed.
- Dedicated PostgreSQL integration tests pass.

If the dedicated test database is unavailable, the only permitted ending is:

```text
P0_3_BLOCKED: DEDICATED_TEST_DATABASE_REQUIRED
```

Do not start Upstox, IndianAPI or Yahoo-removal implementation after completing this task.
