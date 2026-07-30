---
name: P0.1B lifecycle and vitest default config
description: Dynamic import pattern for DB test files, disposable lifecycle module, and vitest.config.ts as default non-DB config.
---

## P0.1B finalized conventions (confirmed 2026-07-30)

### vitest config hierarchy
- `vitest.config.ts` — authoritative DEFAULT (bare `vitest run` picks this up). Includes `src/**/*.test.ts`, excludes `**/*.db.test.ts`. Do NOT create `vitest.config.noDb.ts` again.
- `vitest.config.unit.ts` — STRICT POSITIVE ALLOWLIST. Currently: dbTestGuard.test.ts + disposableDbLifecycle.test.ts (PURE_UNIT_CONFIRMED=2). Added via `pnpm run test:unit`.
- `vitest.config.db.ts` — DB-only config. Invoked by dbTestPreflightRunner only. Scope: `src/**/*.db.test.ts`.

### package.json scripts
- `test:unit` — strict allowlist (vitest.config.unit.ts)
- `test:full` — full non-DB suite (vitest.config.ts, excludes *.db.test.ts)
- `test` / `test:db` — preflight runner (DB_TEST_RUNTIME_AUTHORIZED=false blocks)
- Guard test 715 allows BOTH test:unit and test:full as legitimate `vitest run` invocations.

### DB test file import pattern (P0.1B-04)
Any `*.db.test.ts` file that imports from DB-touching modules MUST use dynamic imports inside `beforeAll()`, not static top-level imports. Pattern:
```typescript
let db: any; let like: any; /* etc. */
let _loaded = false;
async function loadDbModules(): Promise<void> {
  if (_loaded) return; _loaded = true;
  const [dbMod, drizzle] = await Promise.all([import("@workspace/db"), import("drizzle-orm")]);
  db = (dbMod as any).db; like = drizzle.like; /* etc. */
}
describeDb("...", () => {
  beforeAll(async () => { await loadDbModules(); });
  // tests use module-scope `let` vars
});
```
**Why:** `checkDbTestIsolation()` runs synchronously at module eval time. Static imports from `@workspace/db` run BEFORE it, creating a `pg.Pool` regardless of guard result. Dynamic imports inside `beforeAll` run only when `describeDb = describe` (guard passed).

### Test file taxonomy
- `*.db.test.ts` — DB integration tests. Never discovered by vitest.config.ts or vitest.config.unit.ts.
- `*.pure.test.ts` — Pure/static tests extracted from DB files. Ends in `.test.ts` so matched by vitest.config.ts include.
- `*.test.ts` — Normal unit/functional tests. Note: may be DB-transitive (lazy Pool OK in dev).

### Disposable DB lifecycle
Module: `src/test-infra/disposableDbLifecycle.ts`
- Adapter interfaces: ProvisioningAdapter, MigrationAdapter, VitestSpawnAdapter
- Identifiers: `nsc_vitest_<runId>` (DB), `nsc_vitest_role_<runId>` (role). Both validated before any DROP.
- Privilege separation: provisioningUrl NEVER enters VitestSpawnAdapter or MigrationAdapter args.
- spawnVitest receives `{ testDatabaseUrl: runtimeUrl, testRunId }` ONLY.
- DB_TEST_RUNTIME_AUTHORIZED = false as boolean — must NOT change until P0.1B provisioned cluster exists.

### Test counts (2026-07-30 baseline)
- unit (test:unit): 164 tests
- full noDb (test:full): 4354 tests
- DB tests awaiting cluster: 27 (24 swing + 3 provenance)
