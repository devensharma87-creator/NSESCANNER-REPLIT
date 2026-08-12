---
name: api-server vitest pool / sandbox background jobs
description: Why the api-server test suite appears to "hang" and how to actually run it to completion in this environment.
---

# Running the api-server vitest suite

The `@workspace/api-server` vitest suite under its DEFAULT pool (forks) is very slow
to start up (huge `import` phase) and routinely exceeds the 120s bash-tool cap,
returning exit -1 with NO output (vitest's reporter buffers to a non-TTY and the
buffer is lost when the process is killed). It looks like a hang but isn't.

**Run it with the threads pool instead** — it completes in ~30-35s:

```
pnpm --filter @workspace/api-server exec vitest run --pool=threads
```

**Why:** the forks pool's per-worker process startup dominates; threads share the
loaded module graph. Output also only appears at the very end, so a killed run
shows just the banner.

**How to apply:** for the full api-server suite (or any large suite) prefer
`vitest run --pool=threads` inline within one bash call. Do NOT try to background
it: detached processes (`setsid`, `nohup &`) are killed when the bash tool call
returns in this sandbox, so completion markers/log writes never happen.

## `scripts/` escapes the package type-check

`artifacts/api-server/tsconfig.json` has `"include": ["src"]`, so anything under
`scripts/` is **never** type-checked by `tsc -p tsconfig.json` even though it imports from
`src/`. Adding a required field to a shared input type compiles clean while leaving a
script that passes `undefined` and crashes at runtime.

To check one: write a temp tsconfig **inside the package directory** that extends the real
one and adds the script to `include`. A temp config placed outside the package (e.g. in
`/tmp`) fails on `types: ["node"]` resolution — that error is a path artifact, not a code
defect.
