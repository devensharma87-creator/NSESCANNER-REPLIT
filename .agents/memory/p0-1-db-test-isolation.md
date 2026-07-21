---
name: P0.1 DB test isolation guard
description: dbTestGuard.ts fail-closed guard, unit config, preflight runner, path isolation, hard runtime lock for DB-backed api-server tests
---

# P0.1 DB Test Isolation Guard

**Stages 1-9 shipped**: 2026-07-20/21, branch `phase0/authorized-remediation-20260720`

## The guard (`src/test-infra/dbTestGuard.ts`)

Pure Node stdlib only — zero application imports. Call `checkDbTestIsolation(env)` before any DB connection.

Required env keys (must be exact):
- `NODE_ENV=test`
- `TEST_DATABASE_URL` — valid `postgres://` URL with isolation keyword + run ID in db name
- `TEST_RUN_ID` — non-empty, `[A-Za-z0-9_-]{8,64}`, must appear in db name
- `TEST_DB_ISOLATION_CONFIRMED=true`
- `TEST_EXTERNAL_SERVICES_CONFIGURED_DISABLED=true`  ← NOT "mocked"; terminology is intentional

Rejection codes (in order): `NOT_TEST_ENV`, `TEST_DATABASE_URL_MISSING`, `OPERATIONAL_DATABASE_FALLBACK_FORBIDDEN`, `TEST_EQUALS_OPERATIONAL_TARGET`, `TEST_DB_CONFIRMATION_MISSING`, `TEST_RUN_ID_MISSING`, `TEST_RUN_ID_FORMAT_INVALID`, `TEST_RUN_ID_TARGET_MISMATCH`, `TEST_TARGET_NOT_ISOLATED`, `TEST_EXTERNAL_SERVICES_NOT_CONFIGURED_DISABLED`.

Denylist: `nse_scanner` in db name always rejected. Canonical target compare: host/port/db case-insensitive, implicit port=5432.

**Why:** `pnpm run test` with `DATABASE_URL` set ran 51+ DB-backed tests live against the operational database.

## Preflight runner (`src/test-infra/dbTestPreflightRunner.ts`)

### CHILD_PROCESS_ENV_ALLOWLIST (Stage 4 — shrunk from PATH+HOME+TMPDIR to locale-only)

`["LANG", "LC_ALL", "LC_CTYPE"]` only. PATH, HOME, TMPDIR/TMP/TEMP, XDG_* replaced with isolated paths — never inherited from parent.

### buildIsolatedChildEnv — new signature (Stage 4)

```typescript
buildIsolatedChildEnv(
  validated: { testDatabaseUrl: string; testRunId: string },
  isolatedPaths: IsolatedPaths,
  parentEnv?: Readonly<Record<string, string | undefined>>,
): Record<string, string>
```

Old signature was `buildIsolatedChildEnv(parentEnv)`. Tests use `bb()` helper that wraps `DUMMY_VALIDATED + DUMMY_ISOLATED_PATHS + DUMMY_PARENT_ENV`.

Child env sets explicitly (never inherited from parent):
- `HOME` → `isolatedPaths.home`; `TMPDIR/TMP/TEMP` → `isolatedPaths.tmp`
- `XDG_CONFIG_HOME/CACHE_HOME/DATA_HOME/RUNTIME_DIR` → isolated subdirs
- `TZ=Asia/Kolkata`, `CI=true`, `TERM=dumb`, `NO_COLOR=1` (deterministic, forced)
- `TEST_EXTERNAL_SERVICES_CONFIGURED_DISABLED=true` (NOT `TEST_EXTERNAL_SERVICES_MOCKED`)
- `DATABASE_URL` → `validated.testDatabaseUrl` (overrides operational DB)

### EXECUTION_SWITCH_OVERRIDES (Stage 5 additions)

Added to existing switches: `ALLOW_TEST_DB_WRITES: "0"`, `LOG_LEVEL: "silent"`, `SWING_CASH_EXECUTION_MODE: "paper_only"`.

### Isolated run context and trusted executables (Stage 3/8 — unreachable until P0.1B)

`RUN_CONTEXT_DIR_PREFIX = "nsescanner-vitest-"`. `createIsolatedRunContext()` creates a unique run root under `os.tmpdir()`. `safeCleanupRunRoot()` refuses: symlinks, wrong prefix, non-direct-child of tmpdir, already-deleted paths (throws `CleanupSafetyError:`). `resolveVitestExecutable()` resolves via `createRequire().resolve("vitest/package.json")`, never PATH; containment check via `path.relative()`. Throws `VitestResolutionFailed:` on any failure.

### Hard runtime block (Stage 7)

`runPreflightCheck` contains compile-time `false as boolean` constant (`DB_TEST_RUNTIME_AUTHORIZED`). Even on valid env, rejects with `"DB_TEST_RUNTIME_NOT_AUTHORIZED"` and never calls `spawnFn`. Cannot be bypassed by any env var. To unlock: complete P0.1B prerequisites and change the constant.

## Package scripts

- `test` — UNSAFE (runs all 146 files; preserved for compatibility)
- `test:unit` — safe; vitest.config.unit.ts includes only `src/test-infra/dbTestGuard.test.ts`
- `test:db` — gated; routes through dbTestPreflightRunner (hard-blocked by Stage 7)

## Test file (`src/test-infra/dbTestGuard.test.ts`)

111 tests passing. Imports `fs`/`path`/`os` for cleanup/resolution tests. Temporary dirs in cleanup tests use `nse-guard-*` prefix (not `RUN_CONTEXT_DIR_PREFIX`) to avoid accidental safeCleanupRunRoot interaction. Test helper `bb(extraParent?)` = `buildIsolatedChildEnv(DUMMY_VALIDATED, DUMMY_ISOLATED_PATHS, DUMMY_PARENT_ENV)`.

Key test sections added in Stages 3-9:
- Stage 4/5: PATH absent, HOME/TMPDIR/XDG isolated, TZ/CI/TERM/NO_COLOR forced, all paths share one run root
- Stage 3: `resolveVitestExecutable` fail-closed: bad resolver, missing bin field, escaping CLI path
- Stage 8: `safeCleanupRunRoot`: accepts valid, refuses symlink / wrong-prefix / nested / double-cleanup
- Stage 7: Hard block — 4 tests verify no env var bypasses `DB_TEST_RUNTIME_NOT_AUTHORIZED`
- Stage 6: Terminology — `TEST_EXTERNAL_SERVICES_CONFIGURED_DISABLED`; reason contains "disabled"+"UNPROVEN", not "mock"

## How to apply

When adding any new DB-backed test: add it to `exclude` in `vitest.config.unit.ts` and document in `P0_1_TEST_COUPLING_INVENTORY_2026-07-20.md`.

When adding a new operational database: add its name to `OPERATIONAL_DB_DENYLIST` in `dbTestGuard.ts`.
