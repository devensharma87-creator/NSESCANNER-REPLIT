---
name: Pack 4 Runtime Closure (Prompt 22A)
description: Six p22a gate files; 126 new tests; api-server 5243; sentinel build clean; 5-pkg TSC; ACCEPTED 2026-08-03.
---

## Summary

Prompt 22A Final Runtime Release-Boundary Closure for Pack 4. Previous Pack 4 acceptance had D12 returning HTTP 500, and several tests were source-text only.

## Gates closed

| File | Gate | Tests |
|------|------|-------|
| p22a.d12Auth.test.ts | G1 — D12 auth boundary fix | 23 |
| p22a.runtimeBoundaries.test.ts | G2 — Input/routing/error boundaries | 21 |
| p22a.configRejection.test.ts | G3 — Config startup rejection | 17 |
| p22a.brokerHardBlock.test.ts | G5 — Broker hard-block matrix | 28 |
| p22a.schedulerCache.test.ts | G6 — Scheduler/cache runtime | 13 |
| p22a.ownerJourneys.test.ts | G7 — Owner journeys J1–J4 | 24 |

Gate 4 (sentinel build scan): `grep -r "SENTINEL_" artifacts/{scanner,global}/dist/` → 0 matches.

## Non-obvious findings / gotchas

**D12 root cause:** `getUserById` calls `db.select().from(...).where(...).limit(1)`. The Pack 4 `@workspace/db` mock only had `db.execute`. `db.select` was undefined → caught → HTTP 500. Fix: add a Drizzle-compatible thenable select chain: `db.select = () => { const p = Promise.resolve(rows); const c: any = { from:()=>c, where:()=>c, limit:()=>c, then:p.then.bind(p), catch:p.catch.bind(p), finally:p.finally.bind(p) }; return c; }`.

**vi.isolateModules unavailable in --pool=threads:** vitest 4.1.5 threads pool — `vi.isolateModules` is not a function. Use `child_process.spawnSync` with `tsx src/app.ts` instead. The probe exits 1 for ANY startup failure (may be a different error than the specific guard being tested in ESM env — supplement with source+logic proofs for G3-1b and G3-2b).

**G6 immediate tick NOT via setTimeout:** `startSwingTtlSweepScheduler()` fires first sweep via `applySwingTtlSchemaColumns().catch().then(_tick)` — a Promise chain. `vi.runAllTimersAsync()` causes infinite loop (setInterval keeps firing). Pattern: `for (let i = 0; i < 10; i++) await Promise.resolve()` to flush microtask chain.

**scheduleBootJob signature:** `scheduleBootJob(label: string, delayMs: number, fn: () => void | Promise<void>)` — label is FIRST arg. Common mistake: call as `(fn, delay)`.

**applySwingTtlSchemaColumns is in swingTtlSweep.ts itself** (line 102), not a separate module. Mock `@workspace/db` (for the `db.execute` call it makes) — no separate module mock needed.

**FetchResponse vs Express Response naming collision:** Test files import `type Response` from express for error handler typing, which shadows the global `fetch` Response type. Fix: `type FetchResponse = Awaited<ReturnType<typeof fetch>>;` and use it for all fetch helper return types.

**server.close() callback TS type:** `new Promise<void>(r => server.close(r))` fails TS — resolve's type `(value: void | PromiseLike<void>) => void` ≠ `(err?: Error) => void`. Fix: `new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()))`.

## Final counts
- api-server: 5,243 tests (was 5,117 after Pack 4)
- scanner: 947 tests (unchanged)
- 5-package TSC: 0 errors
