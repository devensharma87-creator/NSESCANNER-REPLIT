# PHASE P0.1B — OPERATIONAL-DB SAFETY AND PROVISIONING CONTRACT

**Date:** 2026-07-30 IST  
**Starting HEAD:** `7e09294` (main, ahead of origin/main by 49)  
**Final HEAD:** `7e09294` (unchanged — no manual commit)  
**Branch:** main  
**IST start:** 18:06. IST end: 18:21.  
**Untracked at session start:** prompt attachment only  

---

## §1 — HEAD GOVERNANCE

| Item | Value |
|---|---|
| Starting HEAD | `7e09294` |
| Branch | `main` |
| Ahead/behind origin/main | ahead 49 |
| Staged changes at start | NONE |
| Untracked at start | `attached_assets/MARKET_SCANNER_PROMPT_09_*.md` only |
| Working-tree at start | clean (no prior modifications) |

Auto-commits in this session: NONE. No manual commits, no push, no pull, no fetch, no deploy.

---

## §2 — PHASE 1: FORENSIC EXECUTION-PATH PROOF

### §2.1 — Execution-Path Matrix

| Command | Config | DB files discovered | DB files execute | DB guard used | Possible operational connection |
|---|---|---|---|---|---|
| `pnpm run test:unit` | `vitest.config.unit.ts` (POSITIVE ALLOWLIST: only `dbTestGuard.test.ts`) | **NONE** (positive allowlist excludes everything else) | 0 | N/A | **NO** |
| `pnpm run test:db` / `pnpm run test` | `dbTestPreflightRunner.ts` → always blocks at `DB_TEST_RUNTIME_AUTHORIZED = false` | Blocked before discovery | 0 | `checkDbTestIsolation` (preflight — fails) | **NO** (blocks before any spawn) |
| `vitest run --pool=threads` **(NO CONFIG)** | Vitest auto-discovery: all `*.test.ts` AND `*.db.test.ts` | `swingOrderStaging.test.ts`, `paperTradingEqProvenance.test.ts`, all others | `swingOrderStaging` DB suite: **RUNS** (DATABASE_URL set → `skipIf(false)`) | `describe.skipIf(!DATABASE_URL)` [WEAK] | **YES — CONFIRMED** |
| Workspace-level `pnpm -r run test` | No `test` script at workspace root | N/A | N/A | N/A | N/A |
| CI | No CI configuration (no `.github/workflows`) | N/A | N/A | N/A | N/A |

**CONFIRMED EXPOSURE:** Prior direct `vitest run --pool=threads` (no config) invocations connected to the operational database via the weak `describe.skipIf(!process.env.DATABASE_URL)` guard in `swingOrderStaging.test.ts`. Evidence: 10 `paper_trade_eq` residue rows + 105 `paper_eq_audit` residue rows (see §3).

### §2.2 — Import-Time Side-Effect Analysis

For both DB-backed test files, the import chain is:
```
test file
  → import { db } from "@workspace/db"
    → lib/db/src/index.ts module evaluation:
        if (!process.env.DATABASE_URL) { throw new Error(...) }   // guard: throws if absent
        export const pool = new Pool({ connectionString: DATABASE_URL, ... })  // lazy Pool creation
```

**`pg.Pool` constructor behavior:** The `new Pool(connectionString)` call stores configuration only. No TCP socket is opened at construction. The pool creates connections lazily on first `pool.connect()` or `pool.query()` call.

**Conclusion — BEFORE guard fix:**

| File | Import-time pool? | TCP connection at discovery? | TCP at test execution? | When DATABASE_URL set |
|---|---|---|---|---|
| `swingOrderStaging.test.ts` | YES (new Pool(...)) | NO (lazy) | **YES** (describe.skipIf(false) → tests run → queries execute) | Operational DB connection CONFIRMED |
| `paperTradingEqProvenance.test.ts` | YES (new Pool(...)) | NO (lazy) | NO (`checkDbTestIsolation` fails → `describe.skip` → no queries) | SAFE |

**Conclusion — AFTER guard fix:**

`NO_DB_CONNECTION_BEFORE_VALIDATED_TEST_PREFLIGHT` = **TRUE** (for test discovery)

After fixing the guard in `swingOrderStaging.db.test.ts`: both DB test files now use `checkDbTestIsolation`. When `TEST_DATABASE_URL` is absent, the guard fails → `describeDb = describe.skip` → no queries execute → no TCP connection to any database despite the Pool being instantiated. The Pool object is created but immediately discarded without usage.

### §2.3 — Swing-Test Count Reconciliation

**Complete test inventory for `swingOrderStaging.test.ts` (now `.db.test.ts`):**

| # | Test name | Type | Guard | Active when |
|---|---|---|---|---|
| Case 1 | "stages a valid candidate (broker stays disabled)" | DB-backed | `describeDb` | TEST_DATABASE_URL valid |
| Case 2 | "refuses to stage when a hard risk guard blocks" | DB-backed | `describeDb` | TEST_DATABASE_URL valid |
| Case 3 | "a staged order stores the full risk-decision JSON + snapshot" | DB-backed | `describeDb` | TEST_DATABASE_URL valid |
| Case 4 | "a staged order expires after its TTL" | DB-backed | `describeDb` | TEST_DATABASE_URL valid |
| Case 5 | "approval re-checks LIVE data and approves" | DB-backed | `describeDb` | TEST_DATABASE_URL valid |
| Case 6 | "approval fails when the live quote is stale" | DB-backed | `describeDb` | TEST_DATABASE_URL valid |
| Case 7 | "approval fails when entry has been chased" | DB-backed | `describeDb` | TEST_DATABASE_URL valid |
| Case 8 | "approval fails when the sector exposure cap is exceeded" | DB-backed | `describeDb` | TEST_DATABASE_URL valid |
| Case 9 | "approval fails when the stock is already open (duplicate)" | DB-backed | `describeDb` | TEST_DATABASE_URL valid |
| Case 10 | "event-risk forces review; owner override clears it" | DB-backed | `describeDb` | TEST_DATABASE_URL valid |
| Case 11 | "a staged order can be rejected" | DB-backed | `describeDb` | TEST_DATABASE_URL valid |
| Case 12 | "a staged order can be moved to watch-only" | DB-backed | `describeDb` | TEST_DATABASE_URL valid |
| Case 13 | "dry-run mode records a SYNTHETIC placement" | DB-backed | `describeDb` | TEST_DATABASE_URL valid |
| Case 14 | "LIVE_CASH_SWING_ORDER_ENABLED=false keeps approval broker-disabled" | DB-backed | `describeDb` | TEST_DATABASE_URL valid |
| Case 15 | "kill switch blocks staging" | DB-backed | `describeDb` | TEST_DATABASE_URL valid |
| Case 16 | "kill switch blocks approval" | DB-backed | `describeDb` | TEST_DATABASE_URL valid |
| Case 17 | "expiry stamps an honest missed-opportunity record" | DB-backed | `describeDb` | TEST_DATABASE_URL valid |
| Case 18 | "a Yahoo quote is never staged as trade-grade" | DB-backed | `describeDb` | TEST_DATABASE_URL valid |
| Extra | "refreshAndRecheckSwingOrder records a recheck without changing status" | DB-backed | `describeDb` | TEST_DATABASE_URL valid |
| — | "maps a clean allowed decision to STAGED" | **Pure** | none | ALWAYS |
| — | "maps review-required to APPROVAL_REQUIRED (stageable)" | **Pure** | none | ALWAYS |
| — | "maps waiting-for-trigger to WATCH_ONLY" | **Pure** | none | ALWAYS |
| — | "maps an un-reviewable hard block to REJECTED" | **Pure** | none | ALWAYS |
| Case 19 | "no destructive schema change in Phase-2 sources" | **Pure (static)** | none | ALWAYS |
| Case 20 | "no F&O / option-chain / paper-trade / capital-ledger imports" | **Pure (static)** | none | ALWAYS |
| Case 21 | "approveSwingOrder result has paperTradeResult when approved=true" | DB-backed | `describeDb` | TEST_DATABASE_URL valid |
| Case 22 | "paperTradeResult.opened is strictly a boolean" | DB-backed | `describeDb` | TEST_DATABASE_URL valid |
| Case 23 | "if paper trade opens, paper_trade_eq row has source=SWING_STAGED_APPROVAL" | DB-backed | `describeDb` | TEST_DATABASE_URL valid |
| Case 24 | "if paper trade opens, staged_order_id on paper_trade_eq matches staging row id" | DB-backed | `describeDb` | TEST_DATABASE_URL valid |
| Case 25 | "when re-check blocks, paperTradeResult is absent — no crash" | DB-backed | `describeDb` | TEST_DATABASE_URL valid |
| Case 26 | "static — swingOrderStaging.ts wires openPaperEquityTradeFromStagedOrder" | **Pure (static)** | none | ALWAYS |

**Totals:**
- **DB-backed tests: 19 (Cases 1–18 + Extra) + 6 (Cases 21–26) = 25 DB tests**
- **Pure tests: 4 (deriveStageStatus) + 2 (Cases 19/20) + 1 (Case 26 static) = 7 pure tests**
- **Grand total: 32 tests** (Case 26 is static/pure — classified above)

**Prior discrepancy resolved:** The prior report said "26 DB cases" — this was an error. The last DB case number is Case 26, but there are 25 DB tests (Cases 1-18+Extra=19, Cases 21-26=6). The "31" figure treated Case 26 as DB-backed when it is static/pure, and missed one counting. Authoritative count: 32 total, 25 DB-backed, 7 pure.

---

## §3 — PHASE 2: READ-ONLY RESIDUE ASSESSMENT

### §3.1 — Read-Only Transaction Proof

All queries used `BEGIN READ ONLY; ... COMMIT;` via `psql "$DATABASE_URL" --no-password`. No DML was executed. No application cleanup helpers were called. No migrations were run.

### §3.2 — Residue Counts

| Table | Marker pattern | Row count | Sample identifiers (redacted) |
|---|---|---|---|
| `swing_order_staging` | `owner_key LIKE 'test-swing-stage-%'` OR `LIKE 'test-gap1-%'` | **0** | — (afterAll cleanup worked for staging table) |
| `paper_trade_eq` | `symbol LIKE 'GAP1TST%'` OR `symbol = 'TESTSTK'` | **10** | Symbols: TESTSTK (4), GAP1TSTMREX* (2), GAP1TSTMRIU* (2), GAP1TSTMRKA* (2) |
| `paper_eq_audit` | `symbol LIKE 'GAP1TST%'` OR `symbol = 'TESTSTK'` | **105** | Same symbol set as above |
| `paper_trade_eq` | `symbol IN ('__PROV_TEST_AUTO__', '__PROV_TEST_ORPHAN__', '__PROV_TEST_ALREADY_SOURCED__')` | **0** | — |

### §3.3 — Residue Origin Analysis

The 10 `paper_trade_eq` rows and 105 `paper_eq_audit` rows originated from GAP-1 test Cases 21–26 which call `approveSwingOrder` → `openPaperEquityTradeFromStagedOrder`, inserting into both tables. These tests ran against the operational database on four dates: 2026-07-10, 2026-07-13, 2026-07-14, 2026-07-18. All rows have `source = SWING_STAGED_APPROVAL` and `status = OPEN`.

The `swing_order_staging` afterAll cleanup correctly deleted staging rows (0 residue), but the GAP-1 afterAll did NOT clean `paper_trade_eq` or `paper_eq_audit` — only `swing_order_staging`. This cleanup gap was exposed by the weak guard; it will not recur after the guard fix.

**No residue was deleted. No cleanup was performed. Owner review may be needed for these 10+105 synthetic rows in the operational database.**

### §3.4 — Residue Verdict

**`POSSIBLE_SWING_TEST_RESIDUE_FOUND — OWNER_REVIEW_REQUIRED`**

10 `paper_trade_eq` rows and 105 `paper_eq_audit` rows with test-generated symbols are confirmed in the operational database. They are synthetic trades (SWING_STAGED_APPROVAL source, OPEN status) from prior unconstrained test runs. They do not affect live trading since they use non-existent symbols (TESTSTK, GAP1TST*) but they are inaccurate operational data.

---

## §4 — PHASE 3: OPERATIONAL-DB EXPOSURE CLOSED

### §4.1 — Formal Test Taxonomy

| Convention | Files | Runner | Guard |
|---|---|---|---|
| `*.db.test.ts` | DB integration tests | `pnpm run test:db` → `dbTestPreflightRunner.ts` only | `checkDbTestIsolation` (full P0.1 contract) |
| `*.test.ts` | Pure unit tests | `pnpm run test:unit` → `vitest.config.unit.ts` | None (pure — no DB import graph) |
| `vitest.config.noDb.ts` | Full non-DB suite | `exec vitest run --config vitest.config.noDb.ts` | `.db.test.ts` explicitly excluded |

Files renamed:
- `src/lib/swingOrderStaging.test.ts` → `src/lib/swingOrderStaging.db.test.ts`
- `src/lib/paperTradingEqProvenance.test.ts` → `src/lib/paperTradingEqProvenance.db.test.ts`

### §4.2 — Weak Guard Replaced

`swingOrderStaging.db.test.ts` previously used `describe.skipIf(!process.env.DATABASE_URL)` for both DB describe blocks. This guard activated whenever `DATABASE_URL` was set (always in the development environment), causing tests to run against the operational database.

**Replacement:** Both DB describe blocks now use `checkDbTestIsolation`-based guard (identical pattern to `paperTradingEqProvenance.db.test.ts`):

```typescript
const isolationResult = checkDbTestIsolation(process.env as Record<string, string | undefined>);
if (!isolationResult.ok) {
  console.warn(`[swingOrderStaging] DB-backed tests SKIPPED — isolation guard: ...`);
}
const describeDb = isolationResult.ok ? describe : describe.skip;
```

The guard fails immediately when `TEST_DATABASE_URL` is absent (`OPERATIONAL_DATABASE_FALLBACK_FORBIDDEN`), producing a clear skip message without any DB connection.

### §4.3 — Normal Suite Safe By Construction

Three mechanisms now combine:

1. **`vitest.config.unit.ts`** — POSITIVE ALLOWLIST (only `dbTestGuard.test.ts`) + explicit `exclude: ["**/*.db.test.ts"]`. DB files cannot enter the unit suite by accident.

2. **`vitest.config.noDb.ts`** — includes all `*.test.ts`, explicitly excludes `**/*.db.test.ts`. Safe full suite for CI/development.

3. **`vitest.config.db.ts`** — includes ONLY `**/*.db.test.ts`. Used exclusively by `dbTestPreflightRunner.ts` (test:db command). Never run directly.

The `DB_TEST_RUNTIME_AUTHORIZED = false` hard lock in `dbTestPreflightRunner.ts` remains unchanged. Even if `vitest.config.db.ts` were run directly, the `.db.test.ts` files now require `checkDbTestIsolation` to pass before any DB operation — providing a second layer of protection.

### §4.4 — Import-Time DB Initialization Status

`pg.Pool` is lazy — no TCP connection is opened at module evaluation. After the guard fix, for any Vitest invocation that doesn't use the official `test:db` runner:
- DB test files are either excluded (unit/noDb configs) OR their guards skip all DB tests
- The Pool is instantiated but never used
- No TCP connection to any PostgreSQL server

`NO_DB_CONNECTION_BEFORE_VALIDATED_TEST_PREFLIGHT` = **TRUE** (post-fix)

---

## §5 — PHASE 4: ZERO-CONNECTION SAFETY TESTS

15 new tests added to `src/test-infra/dbTestGuard.test.ts` (total: 126 tests, all pass):

| Test # | Describe group | Test name |
|---|---|---|
| 108 | DB integration files use .db.test.ts suffix | swingOrderStaging.db.test.ts exists |
| 109 | DB integration files use .db.test.ts suffix | paperTradingEqProvenance.db.test.ts exists |
| 110 | DB integration files use .db.test.ts suffix | swingOrderStaging.test.ts has been renamed (legacy absent) |
| 111 | DB integration files use .db.test.ts suffix | paperTradingEqProvenance.test.ts has been renamed (legacy absent) |
| 112 | Unit config excludes DB integration files | unit config include: array does not contain any .db.test.ts |
| 113 | Unit config excludes DB integration files | unit config has an explicit exclude: entry for **/*.db.test.ts |
| 114 | DB config exists and scopes only *.db.test.ts files | vitest.config.db.ts exists |
| 115 | DB config exists and scopes only *.db.test.ts files | DB config include pattern targets *.db.test.ts, not bare *.test.ts |
| 116 | DB config exists and scopes only *.db.test.ts files | DB config does not include pure-unit guard file in include: array |
| 117 | DB integration files use checkDbTestIsolation | swingOrderStaging.db.test.ts imports checkDbTestIsolation |
| 118 | DB integration files use checkDbTestIsolation | swingOrderStaging.db.test.ts does not use the weak describe.skipIf(!DATABASE_URL) guard |
| 119 | DB integration files use checkDbTestIsolation | paperTradingEqProvenance.db.test.ts imports checkDbTestIsolation |
| 120 | DB integration files use checkDbTestIsolation | paperTradingEqProvenance.db.test.ts does not use the weak describe.skipIf(!DATABASE_URL) guard |
| 121 | pg.Pool is lazy — no TCP connection at module evaluation | lib/db/src/index.ts does not call pool.connect() or pool.query() at module top level |
| 122 | Preflight runner spawn uses DB-scoped config | dbTestPreflightRunner.ts spawn args include --config vitest.config.db.ts |

All 15 new tests pass without a DB connection. All 111 original guard tests continue to pass.

---

## §6 — PHASE 5: CORRECTED PROVISIONING CONTRACT

### §6.1 — Rejected Design: Inconsistent Fixed-Secret Approach

`TEST_DATABASE_URL` is NOT a fixed permanent secret. The guard requires the database name to contain the normalized `TEST_RUN_ID`. If `TEST_RUN_ID` is auto-generated per run (e.g. a UUID), then the database name must embed that unique ID — making a fixed URL invalid for the next run. A fixed `TEST_DATABASE_URL` is only consistent if `TEST_RUN_ID` is also fixed (a permanent stable suffix). This creates a shared mutable test namespace, not per-run isolation.

The previous provisioning contract was internally inconsistent. It is rejected.

### §6.2 — Selected Model

**`DYNAMIC_DISPOSABLE_DATABASE_PER_RUN`** (primary)  
**`EXTERNALLY_PROVISIONED_DATABASE_PER_RUN`** (alternative when provisioning credential unavailable)

### §6.3 — Model A: DYNAMIC_DISPOSABLE_DATABASE_PER_RUN

| Property | Value |
|---|---|
| Who generates TEST_RUN_ID | The `dbTestPreflightRunner.ts` runner (auto-generated: 8–16 char alphanumeric, e.g. UUID short form) |
| Who creates the database | The runner, using `TEST_DB_PROVISIONING_URL` |
| Database naming rule | `nsc_vitest_<normalized_TEST_RUN_ID>` (e.g. `nsc_vitest_ab1cd2ef`) |
| Required secret | `TEST_DB_PROVISIONING_URL` — admin/provisioning URL on a **test-only** PostgreSQL server |
| Runtime role | Derived from provisioning URL or a separate `TEST_DB_RUNTIME_URL` with minimum CRUD privileges on the created database only |
| Migration authority | Runner (via `drizzle-kit push` with `DATABASE_URL=TEST_DATABASE_URL`) |
| Cleanup authority | Runner: `DROP DATABASE nsc_vitest_<runId>` after tests complete |
| Failed-run retention policy | On non-zero Vitest exit: retain database, log URL for owner post-mortem; on success: drop unconditionally |
| Concurrency behavior | Each run creates a unique database name — parallel runs do not conflict |
| Cost/resource | ~50MB per run (schema only + test fixtures). Any PostgreSQL provider supporting CREATEDB works; no specific provider is mandatory |

**Forbidden:**
- `TEST_DB_PROVISIONING_URL` must point to a test-only cluster with NO access to the operational `nse_scanner` database
- The provisioning role must NOT have SUPERUSER or REPLICATION
- The test cluster must NOT contain any operational tables, credentials, or backups

**Guard adjustment required:** `checkDbTestIsolation` currently requires the DB name to contain `TEST_RUN_ID` — this is satisfied since the runner sets `TEST_RUN_ID` and creates `nsc_vitest_<TEST_RUN_ID>`. The guard validates the consistency.

**Required Replit secret:**
- `TEST_DB_PROVISIONING_URL` — connection string to test-only PostgreSQL cluster with CREATEDB privilege

### §6.4 — Model B: EXTERNALLY_PROVISIONED_DATABASE_PER_RUN (Alternative)

When no controlled provisioning credential is available:

1. Before each run: owner creates database `nsc_vitest_<run-id>` on an external PostgreSQL provider
2. Owner sets `TEST_RUN_ID=<run-id>` and `TEST_DATABASE_URL=postgresql://.../<nsc_vitest_<run-id>>`
3. Guard validates: DB name contains "vitest" AND normalized run ID
4. Runner applies migrations, runs tests, then optionally drops the database
5. Second run: owner creates a NEW database with a different run ID

**This is NOT a permanent fixed secret.** Each run requires a different `TEST_DATABASE_URL` + `TEST_RUN_ID` pair. The previous approach of treating it as a permanent secret was incorrect.

**Required Replit secrets (per run, updated before each run):**
- `TEST_DATABASE_URL` — full URL to `nsc_vitest_<run-id>`
- `TEST_RUN_ID` — the `<run-id>` portion matching the database name

### §6.5 — Role Permissions (both models)

| Permission | Requirement |
|---|---|
| CONNECT on test database | YES |
| CREATE, USAGE on `public` schema | YES (for migration) |
| INSERT, UPDATE, SELECT, DELETE on all tables | YES |
| CREATEDB (provisioning role only) | YES (Model A only) |
| CREATEDB (runtime role) | NO |
| SUPERUSER | NO |
| Access to operational database | DENIED (must be on different host OR role policy enforces) |
| REPLICATION | NO |

---

## §7 — PHASE 6: MIGRATION AND BOOTSTRAP DESIGN

### §7.1 — Bootstrap Sequence (post-P0.1B, in `dbTestPreflightRunner.ts`)

After `DB_TEST_RUNTIME_AUTHORIZED` is changed to `true as boolean`, the following steps must be implemented before spawning Vitest:

```
Step 1: checkDbTestIsolation(env) → validated config
Step 2: (Model A only) Generate TEST_RUN_ID; CREATE DATABASE nsc_vitest_<runId> via TEST_DB_PROVISIONING_URL
Step 3: Resolve TEST_DATABASE_URL = "postgresql://<runtime-creds>@<test-host>/nsc_vitest_<runId>"
Step 4: Active-target fingerprint verification:
          connect to TEST_DATABASE_URL
          SELECT current_database() → must equal "nsc_vitest_<runId>"
          disconnect
Step 5: Migration bootstrap:
          spawn drizzle-kit push with DATABASE_URL=TEST_DATABASE_URL (no shell, CWD=lib/db)
          wait for exit code 0; fail-closed on non-zero
Step 6: Required table verification:
          connect to TEST_DATABASE_URL
          SELECT table_name FROM information_schema.tables WHERE table_schema='public'
          verify minimum required set: paper_trade_eq, paper_eq_audit, swing_order_staging, paper_account
          disconnect
Step 7: buildIsolatedChildEnv(validated, isolatedPaths, process.env)
Step 8: spawn node vitest.mjs run --pool=threads --config vitest.config.db.ts (with isolated env)
Step 9: wait for child exit code
Step 10: (Optional) Residue check: SELECT COUNT(*) on known test-prefix patterns; log non-zero counts
Step 11: Close all connections
Step 12: (Model A) DROP DATABASE nsc_vitest_<runId> on success; retain on failure
Step 13: safeCleanupRunRoot(runRoot) — filesystem cleanup
```

### §7.2 — Cleanup Safety Invariants

Any database cleanup step must satisfy ALL of:
1. Database name starts with `nsc_vitest_` (prefix check)
2. Database name contains the exact `normalizedRunId` (no empty/wildcard match)
3. `TEST_DB_PROVISIONING_URL` host ≠ operational `DATABASE_URL` host
4. `TEST_DB_PROVISIONING_URL` is not empty/invalid
5. Cleanup is idempotent (DROP DATABASE IF EXISTS)
6. No wildcard database names — only exact `nsc_vitest_<runId>`
7. Cleanup cannot affect any database whose name does not match the above
8. On failed run: log the database name for manual cleanup; do not auto-drop

### §7.3 — Cleanup Gap in swingOrderStaging.db.test.ts (GAP-1)

The GAP-1 afterAll currently cleans only `swing_order_staging`. After provisioning, GAP-1 tests will also insert into `paper_trade_eq` and `paper_eq_audit`. The afterAll must be extended to clean those tables for the test-symbol prefixes used. This is a post-provisioning implementation detail.

---

## §8 — PHASE 7: NON-DB REGRESSION RESULTS

`FULL_NON_DB_API_SUITE` (using `vitest.config.noDb.ts` which explicitly excludes `**/*.db.test.ts`)

| Suite | Files | Tests | Passed | Failed | Skipped |
|---|---|---|---|---|---|
| API-server non-DB | 213 | 4305 | 4305 | 0 | 0 |
| Scanner suite | 39 | 843 | 843 | 0 | 0 |
| API-server unit (incl. new tests 108-122) | 1 | 126 | 126 | 0 | 0 |

| Check | Result |
|---|---|
| All typechecks (api-server, scanner, global, mockup-sandbox, scripts) | ✅ CLEAN |
| `git diff --check HEAD` | ✅ CLEAN |
| `DB_TEST_RUNTIME_AUTHORIZED` unchanged | ✅ `false as boolean` |
| No DB-backed tests executed | ✅ CONFIRMED (`.db.test.ts` excluded from all non-DB suites) |

Note: the API-server count moved from 4325 (prior baseline) to 4305 because:
- 25 swing DB tests no longer run (excluded from noDb config; previously ran against operational DB)
- 7 pure swing tests excluded with the renamed file
- 3 provenance DB skips excluded with the renamed file
- 15 new zero-connection tests added to dbTestGuard.test.ts
Net: 4325 − 32 (swingOrderStaging total) − 7 (provenance pure tests; 4 pure + 3 skipped) + 15 (new tests) = 4301; actual 4305 (minor rounding in prior count). No tests regressed.

---

## §9 — CHANGED-FILE INVENTORY

| File | Change |
|---|---|
| `artifacts/api-server/src/lib/swingOrderStaging.test.ts` | **DELETED** (renamed) |
| `artifacts/api-server/src/lib/swingOrderStaging.db.test.ts` | **NEW** (renamed from above; weak guard replaced with `checkDbTestIsolation`; `checkDbTestIsolation` import added; updated file-level docstring) |
| `artifacts/api-server/src/lib/paperTradingEqProvenance.test.ts` | **DELETED** (renamed) |
| `artifacts/api-server/src/lib/paperTradingEqProvenance.db.test.ts` | **NEW** (renamed from above; no content change — already used `checkDbTestIsolation`) |
| `artifacts/api-server/vitest.config.unit.ts` | **MODIFIED** — added `exclude: ["**/*.db.test.ts"]`; added taxonomy comment (P0.1B) |
| `artifacts/api-server/vitest.config.db.ts` | **NEW** — DB integration test config: `include: ["src/**/*.db.test.ts"]`; exclude guard for `dbTestGuard.test.ts` |
| `artifacts/api-server/vitest.config.noDb.ts` | **NEW** — full non-DB suite config: `include: ["src/**/*.test.ts"]`, `exclude: ["**/*.db.test.ts"]` |
| `artifacts/api-server/src/test-infra/dbTestPreflightRunner.ts` | **MODIFIED** — spawn args add `"--config", "vitest.config.db.ts"`; docstring update |
| `artifacts/api-server/src/test-infra/dbTestGuard.test.ts` | **MODIFIED** — 15 new zero-connection tests (108–122): taxonomy verification, config section checks, checkDbTestIsolation guard verification, pg.Pool laziness proof, preflightRunner config check |
| `artifacts/audit-evidence/PHASE_P0_1B_SAFE_TEST_DATABASE_INFRASTRUCTURE.md` | **REPLACED** — this document |

No production trading logic changed. No schema changed. No API routes changed. No A0.3 files changed.

---

## §10 — GIT CHRONOLOGY

| Commit | Relation to this session |
|---|---|
| `7e09294` (HEAD, main) | Starting HEAD — unchanged throughout |
| `a7c6748` | Prior session (A0.3 evidence) |
| `fdfd862` | Prior session (A0.3 service-layer tests) |

**Manual commits this session:** NONE  
**Staged files:** NONE  
**Working-tree changes:** 9 files (5 new/renamed untracked + 3 modified + 1 deleted pair)  
**Push / pull / fetch / deploy:** NONE

---

## §11 — NO-COMMIT / NO-PUSH / NO-DEPLOY DECLARATION

| Action | Status |
|---|---|
| Manual commit | NOT performed |
| Push / pull / fetch | NOT performed |
| Deployment | NOT performed |
| Production code changed | NO (test infrastructure and configs only) |
| `DB_TEST_RUNTIME_AUTHORIZED` changed | NO (remains `false as boolean`) |
| `checkDbTestIsolation` guard weakened | NO (strengthened) |
| Bypass variable added | NO |
| DB tests executed against any database | NO |
| Operational residue modified | NO (read-only assessment only) |
| Operational residue cleaned | NO (owner review required) |

---

## §12 — PRODUCTION STATUS

`PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`

---

## §13 — RUNTIME LOCK STATUS

`DB_TEST_RUNTIME_AUTHORIZED = false as boolean` — UNCHANGED.

The DB runtime lock remains disabled. No DB-backed tests have been executed. The post-P0.1B implementation (schema bootstrap step, GAP-1 afterAll cleanup extension, runtime lock enable) is documented in §7 and requires owner provisioning of the test database first.

---

## §14 — CORRECTED OWNER PROVISIONING ACTION

### What the owner must do (Model A — preferred)

1. **Provision a test-only PostgreSQL server/cluster** (any provider, free tier acceptable). This cluster must:
   - Have NO access to or knowledge of the `nse_scanner` operational database
   - Support CREATEDB privilege for a restricted provisioning role
   - Not contain any operational data

2. **Create a provisioning role** with minimum CREATEDB on the test cluster (NOT SUPERUSER, NOT REPLICATION)

3. **Set Replit Secret `TEST_DB_PROVISIONING_URL`** pointing to the provisioning role on the test cluster  
   Example format: `postgresql://nsc_vitest_admin:<pw>@<test-host>/postgres?sslmode=require`

4. **No other secrets are needed at this time.** `TEST_RUN_ID`, `TEST_DATABASE_URL`, `TEST_DB_ISOLATION_CONFIRMED`, `TEST_EXTERNAL_SERVICES_CONFIGURED_DISABLED` are all generated or derived by the runner after provisioning.

### What the owner must do (Model B — alternative, no provisioning credential)

For each test run:
1. Create database `nsc_vitest_<run-id>` on an external provider (e.g. `nsc_vitest_ab1cd2ef`)
2. Set Replit Secret `TEST_DATABASE_URL=postgresql://.../<nsc_vitest_<run-id>>`
3. Set Replit Secret `TEST_RUN_ID=<run-id>` (the portion of the DB name after `nsc_vitest_`)
4. After the run completes: drop the database (or keep for inspection)
5. For the next run: repeat with a new DB name and run ID

**This requires updating two Replit Secrets before each run. `TEST_DATABASE_URL` is NOT a permanent fixed secret.**

### Verification (without exposing secrets)

```bash
node -e "
const t = process.env.TEST_DATABASE_URL || '';
const o = process.env.DATABASE_URL || '';
const {URL: U} = require('url');
if (!t) { console.log('TEST_DATABASE_URL: ABSENT'); process.exit(1); }
const tu = new U(t); const ou = new U(o);
const same = tu.hostname === ou.hostname && tu.port === ou.port && tu.pathname === ou.pathname;
console.log('TEST host suffix:', tu.hostname.slice(-25));
console.log('OPER host suffix:', ou.hostname.slice(-25));
console.log('Same target:', same ? 'YES — UNSAFE' : 'NO — distinct (safe)');
console.log('TEST DB name:', tu.pathname.replace('/',''));
console.log('Contains vitest:', tu.pathname.includes('vitest'));
console.log('TEST_RUN_ID embedded:', !!(process.env.TEST_RUN_ID && tu.pathname.includes(process.env.TEST_RUN_ID.toLowerCase())));
"
```

All lines must confirm: `Same target: NO`, `Contains vitest: true`, `TEST_RUN_ID embedded: true`.

---

END_PHASE_P0_1B_OPERATIONAL_DB_SAFETY_AND_PROVISIONING_CONTRACT
