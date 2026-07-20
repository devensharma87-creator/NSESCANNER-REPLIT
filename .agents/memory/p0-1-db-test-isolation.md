---
name: P0.1 DB test isolation guard
description: dbTestGuard.ts fail-closed guard, unit config, and preflight runner for DB-backed api-server tests
---

# P0.1 DB Test Isolation Guard

**Shipped**: 2026-07-20, branch `phase0/authorized-remediation-20260720`

## The guard (`src/test-infra/dbTestGuard.ts`)

Pure Node stdlib only — zero application imports. Call `checkDbTestIsolation(env)` before any DB connection.

Required env:
- `NODE_ENV=test`
- `TEST_DATABASE_URL` — a valid `postgres://` URL with isolation keyword in db name
- `TEST_RUN_ID` — non-empty unique run identifier
- `TEST_DB_ISOLATION_CONFIRMED=true`

Will reject if `TEST_DATABASE_URL` points to the same canonical target as `DATABASE_URL` (host/port/db canonicalized — case and implicit port 5432 handled).

Denylist: `nse_scanner` in db name is always rejected.

**Why:** `pnpm run test` with `DATABASE_URL` set runs 51+ DB-backed tests live against the operational database. The guard is the enforcement gate to prevent this.

## Package scripts

- `test` — UNSAFE (runs all 146 files; preserved for compatibility)
- `test:unit` — safe; excludes 51 DB_DIRECT + 24 UNKNOWN_REQUIRES_TRACE files via `vitest.config.unit.ts`
- `test:db` — gated; spawns vitest only after guard passes

## How to apply

When adding any new DB-backed test: add it to the `exclude` list in `vitest.config.unit.ts` and document the classification in `memory/P0_1_TEST_COUPLING_INVENTORY_2026-07-20.md`.

When adding a new operational database: add its name to `OPERATIONAL_DB_DENYLIST` in `dbTestGuard.ts`.
