# P0.1 — Test Isolation Implementation & Evidence
**Date**: 2026-07-20  
**Branch**: phase0/authorized-remediation-20260720  
**Work order**: REPLIT_CODER_P0_1_TEST_ISOLATION_WORK_ORDER_2026-07-20_1784552567138.md

---

## Deliverables produced

| File | Role |
|---|---|
| `artifacts/api-server/src/test-infra/dbTestGuard.ts` | Stage B — Fail-closed guard module |
| `artifacts/api-server/src/test-infra/dbTestPreflightRunner.ts` | Stage C — Preflight wrapper that gates vitest spawn |
| `artifacts/api-server/src/test-infra/dbTestGuard.test.ts` | Stage D — 26 pure unit tests |
| `artifacts/api-server/vitest.config.unit.ts` | Stage C — Unit-only vitest config |
| `artifacts/api-server/package.json` | Added `test:unit` and `test:db` scripts |
| `memory/P0_1_TEST_COUPLING_INVENTORY_2026-07-20.md` | Stage A — full file classification |

---

## Stage B — Guard module (`dbTestGuard.ts`)

### Design invariants

- **Zero application imports** — Node standard-library only (`node:url`, `node:crypto` intent; only `node:url` used). No `@workspace/*`, no `drizzle-orm`, no `pg`.
- **No network I/O** — validates configuration structure only; never opens a socket.
- **Injectable env** — accepts `Record<string, string | undefined>` defaulting to `process.env`; pure function.

### Reason codes implemented

| Code | Trigger |
|---|---|
| `NOT_TEST_ENV` | `NODE_ENV !== "test"` |
| `TEST_DATABASE_URL_MISSING` | `TEST_DATABASE_URL` absent + no `DATABASE_URL` present; or non-postgres URL |
| `OPERATIONAL_DATABASE_FALLBACK_FORBIDDEN` | `TEST_DATABASE_URL` absent but `DATABASE_URL` IS present |
| `TEST_EQUALS_OPERATIONAL_TARGET` | Canonical host:port/db of test URL matches operational URL |
| `TEST_TARGET_NOT_ISOLATED` | DB name contains denylist fragment OR lacks isolation keyword |
| `TEST_RUN_ID_MISSING` | `TEST_RUN_ID` absent or empty |
| `TEST_DB_CONFIRMATION_MISSING` | `TEST_DB_ISOLATION_CONFIRMED !== "true"` |
| `VALID_ISOLATED_TEST_CONFIGURATION` | All checks pass |

### URL canonicalization

- Hostname: `.toLowerCase()`
- Port: explicit `parseInt` with default `5432` when omitted
- Database: leading slash stripped, `.toLowerCase()`
- Fingerprint: `host:port/database` only — no username, password, or query params

### Denylist

```typescript
const OPERATIONAL_DB_DENYLIST = ["nse_scanner"];
```

Any test URL whose database name contains `nse_scanner` is rejected regardless of host.

### Isolation keywords

```typescript
["vitest", "test", "ephemeral", "tmp", "spec", "sandbox"]
```

The test database name must contain at least one of these.

---

## Stage C — Preflight runner (`dbTestPreflightRunner.ts`)

- Imports only `dbTestGuard.ts` and `node:child_process`.
- Exports `runPreflightCheck(env, spawnFn?)` — injectable spawn for unit testing.
- On guard failure: writes structured stderr block with Code + Reason; `Promise.reject(code)`.
- On guard pass: writes confirmation block with fingerprint + runId; spawns `vitest run --pool=threads`.
- CLI entry point guarded by `process.argv[1].includes("dbTestPreflightRunner")`.

### Package scripts

```json
"test":      "vitest run --pool=threads",           // UNSAFE — runs all including DB-backed; preserved for compatibility
"test:unit": "vitest run --config vitest.config.unit.ts --pool=threads",  // SAFE — excludes DB-backed files
"test:db":   "tsx src/test-infra/dbTestPreflightRunner.ts"  // GATED — requires TEST_DATABASE_URL + isolation env
```

---

## Stage C — Unit vitest config (`vitest.config.unit.ts`)

- Excludes all 51 DB_DIRECT files plus 24 UNKNOWN_REQUIRES_TRACE files.
- Excludes all `src/routes/__tests__/**` (DB_TRANSITIVE via express app).
- Excludes `src/__tests__/**`, `src/scripts/**`, `src/lib/global/**`.
- Any file NOT in the exclude list is classified as PURE_UNIT_CONFIRMED provisionally.
- Use `pool: "threads"` (matches memory note `api-server-vitest-pool.md`).

---

## Stage D — Test evidence

**Command run**:
```
cd artifacts/api-server && \
  node_modules/.bin/vitest run --config vitest.config.unit.ts --pool=threads \
  "src/test-infra/dbTestGuard.test.ts"
```

**Result**: 26 tests passed, 0 failed, 0 skipped  
**Duration**: ~476 ms (transform 156 ms, import 189 ms, tests 22 ms)  
**No DB connection opened** — confirmed by: all env objects use `test-db.invalid` (non-routable) + pure structure tests.

### Test scenarios covered

| # | Scenario | Code verified |
|---|---|---|
| 1a | NODE_ENV absent | NOT_TEST_ENV |
| 1b | NODE_ENV = 'development' | NOT_TEST_ENV |
| 1c | NODE_ENV = 'production' | NOT_TEST_ENV |
| 2a | TEST_DATABASE_URL absent, DATABASE_URL also absent | TEST_DATABASE_URL_MISSING |
| 2b | TEST_DATABASE_URL empty string (no fallback) | TEST_DATABASE_URL_MISSING |
| 2c | TEST_DATABASE_URL is a mysql:// URL | TEST_DATABASE_URL_MISSING |
| 3 | TEST_DATABASE_URL absent, DATABASE_URL present | OPERATIONAL_DATABASE_FALLBACK_FORBIDDEN |
| 4 | TEST and operational URLs textually identical | TEST_EQUALS_OPERATIONAL_TARGET |
| 5 | Port omitted vs. explicit :5432 (same target) | TEST_EQUALS_OPERATIONAL_TARGET |
| 6 | Hostname case differs (PROD-DB vs prod-db) | TEST_EQUALS_OPERATIONAL_TARGET |
| 7a | TEST_DB_ISOLATION_CONFIRMED absent | TEST_DB_CONFIRMATION_MISSING |
| 7b | TEST_DB_ISOLATION_CONFIRMED = 'false' | TEST_DB_CONFIRMATION_MISSING |
| 7c | TEST_DB_ISOLATION_CONFIRMED = '1' (not 'true') | TEST_DB_CONFIRMATION_MISSING |
| 8a | TEST_RUN_ID absent | TEST_RUN_ID_MISSING |
| 8b | TEST_RUN_ID empty/whitespace | TEST_RUN_ID_MISSING |
| 9a | DB name contains denylist fragment 'nse_scanner' | TEST_TARGET_NOT_ISOLATED |
| 9b | DB name exactly 'nse_scanner' | TEST_TARGET_NOT_ISOLATED |
| 9c | DB name has no isolation keyword | TEST_TARGET_NOT_ISOLATED |
| 10a | Valid dummy isolated config accepted | VALID_ISOLATED_TEST_CONFIGURATION |
| 10b | DATABASE_URL absent (offline CI) — still accepted | VALID_ISOLATED_TEST_CONFIGURATION |
| 11 | Fingerprint contains no password/username/querystring | Redaction verified |
| 12a | Preflight blocks when NODE_ENV wrong; spawn NOT called | runPreflightCheck rejects |
| 12b | Preflight blocks on missing TEST_DATABASE_URL; spawn NOT called | runPreflightCheck rejects |
| 13 | Injected fake-spawn called with `vitest run` on valid config | Sentinel reached |
| 14a | package.json `test` script does not reference DATABASE_URL | Wiring verified |
| 14b | package.json `test:db` script references dbTestPreflightRunner | Wiring verified |

---

## Typecheck result

```
pnpm --filter @workspace/api-server run typecheck
→ tsc -p tsconfig.json --noEmit
→ Exit 0 (clean)
```

---

## Hard prohibitions confirmed not violated

- ✅ No DB connection opened at any point in this task
- ✅ No existing tests executed (only the 3 new guard test files run)
- ✅ No production source files modified
- ✅ No workflow restart
- ✅ No merge/push/deploy
- ✅ No Kite/Telegram API calls
- ✅ Branch remains `phase0/authorized-remediation-20260720`

---

## Remaining migration backlog (for follow-on tasks)

1. **24 UNKNOWN_REQUIRES_TRACE files** need full transitive trace (see inventory doc).
2. **The existing `pnpm run test` command is still unsafe** — runs all 146 files including live-DB-backed ones against operational `DATABASE_URL`. A follow-on task should either gate the default command or document and enforce that `test:unit` is the CI command.
3. **6+ files** use the `DATABASE_URL ? describe : describe.skip` anti-pattern; should be ported to `TEST_DATABASE_URL` + guard.
4. **`test:db` is not yet executable** — a disposable PostgreSQL test database must be provisioned before the DB-backed suite can be run safely.
