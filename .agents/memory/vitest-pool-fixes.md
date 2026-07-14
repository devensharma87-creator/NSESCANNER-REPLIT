---
name: vitest pool fixes
description: Scanner uses vmThreads+forceExit in config; api-server uses --pool=threads in package.json test script; both config files (.ts/.js) crash in vitest 4.1.5 + type:module packages.
---

## Scanner (artifacts/scanner)

**Fix**: `pool: "vmThreads"` + `forceExit: true` in `artifacts/scanner/vitest.config.ts`.

**Root cause**: Default `forks` pool spawns one child process per test file. With 34 test files and only 2 CPUs shared across 4 running workflows, fork startup overhead (Node.js runtime load + jsdom initialization per child) exceeds the 120 s bash tool window before a single test runs. The vitest process prints "RUN v4.1.5" then stalls.

**Why vmThreads not threads**: `pool: "threads"` in a config file crashes vitest 4.1.5 immediately (exit -1, no output) in packages with `"type": "module"`. The CLI flag `--pool=threads` works but jsdom + threads causes OOM. `vmThreads` is the correct pool for jsdom tests: worker threads with per-thread vm context, no process spawn overhead.

**Result**: 711 passed (34 files) in 11.07 s (transform 4.27 s, tests 605 ms, environment 2.91 s).

## api-server (artifacts/api-server)

**Fix**: `"test": "vitest run --pool=threads"` in `artifacts/api-server/package.json`.

**Root cause**: `lib/db/src/index.ts` exports `const pool = new Pool({...})` at module level. Every test that imports `@workspace/db` (directly or transitively) opens idle TCP connections to postgres. With the default `forks` pool, each child process holds these connections open after its tests finish; the event loop never drains; the child never exits; vitest waits indefinitely.

`--pool=threads` solves this because worker threads are killed when the main vitest process exits, so idle pool connections are forcibly terminated — no drain wait.

**Config file caveat**: Creating `vitest.config.ts` or `vitest.config.js` with `pool: "threads"` causes vitest 4.1.5 to crash immediately (exit -1, no output) in packages with `"type": "module"`. This is specific to the `pool: "threads"` option in config files in this environment. CLI flags (`--pool=threads`) work correctly.

**Invalid CLI flags** (exit -1 immediately in vitest 4.1.5):
- `--forceExit` — not a recognized CLI flag (config key is `test.forceExit`)
- `--maxWorkers=N` — not a recognized CLI flag (config key is `poolOptions.threads.maxThreads`)

**Bash window constraint**: The api-server suite (111 files, ~1908 tests) takes ~130 s with `--pool=threads` on a 2-CPU workspace with 4 active workflows. The bash tool hard limit is 120 s. Users can run `pnpm --filter @workspace/api-server run test` directly in the Replit shell (no 120 s limit) to get the full pass line. T07 baseline: 1908 passed (111 files).

**Why**: Both pools needed because the open-handle root cause (module-level pg.Pool) is in the api-server only. The scanner doesn't touch @workspace/db so forks vs threads doesn't matter for handles — the scanner's issue was purely process-spawn throughput on a resource-constrained machine.
