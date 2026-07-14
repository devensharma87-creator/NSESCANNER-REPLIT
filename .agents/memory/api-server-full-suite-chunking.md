---
name: Full api-server suite needs file-chunking to fit the bash tool window
description: The api-server vitest suite has grown to 146 files / ~2782 tests; a single foreground OR backgrounded invocation consistently exceeds the bash tool's 120s window and its output gets cut off with no summary line.
---

As of 2026-07-02 the api-server suite is large enough (146 test files, ~2782 tests) that a single `vitest run --pool=threads` invocation reliably runs past the bash tool's 120s timeout — this reproduced identically across three different attempts: plain foreground with a 120000ms timeout, `--silent` foreground, and a fully detached `setsid nohup ... & disown` background job (which itself doesn't even survive: verified with a standalone `sleep 20` test that a detached/disowned background process is still killed when the invoking bash tool call returns, contradicting the older assumption that `setsid`+`disown` protects a job past the call boundary in this sandbox).

**Why:** the older "~33s for the full suite" memory note predates the exit-monitoring work; the suite has since grown enough that it now straddles the timeout boundary, and there's no reliable way to keep a process alive across tool-call boundaries here.

**How to apply:** when the full suite needs verifying, don't retry the same single-invocation command — split the test file list into ~4 chunks (`find src -name "*.test.ts" | sort > list.txt; split -n l/4 list.txt chunk_`) and run each chunk as its own `pnpm exec vitest run --pool=threads $(cat chunk_X | tr '\n' ' ')` invocation (each comfortably finishes in well under 115s). Sum the per-chunk "Test Files"/"Tests" pass counts to confirm the whole suite is green. Note vitest 4.1.5's CLI requires `--silent=true`, not bare `--silent` with a following positional arg — pass file lists without `--silent` to avoid a parse error, or use `--silent=true` explicitly if quieting logger output.
