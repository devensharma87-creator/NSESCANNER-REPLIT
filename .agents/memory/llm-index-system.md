---
name: LLM index system
description: Token-saving onboarding index under docs/llm-index/ — how to use it, what to update after each task.
---

# LLM Index System

## The rule
Every agent session MUST start with `docs/llm-index/AGENT_START_HERE.md` (or at minimum `AGENT.md`). Then read ONE targeted index file. Do NOT scan the raw codebase without reading the index first.

## What exists
- `AGENT.md` (root) — entry gate, 5-line routing table
- `docs/llm-index/AGENT_START_HERE.md` — full onboarding (~2 min read)
- `docs/llm-index/PROJECT_MAP.md` — every file by domain + risk
- `docs/llm-index/API_ROUTES_INDEX.md` — every route with auth + risk
- `docs/llm-index/DATABASE_INDEX.md` — every table, columns, safe migration procedure
- `docs/llm-index/DATA_SOURCES_AND_PROVENANCE.md` — Kite/Yahoo/INDstocks policy
- `docs/llm-index/CRITICAL_FLOWS.md` — 8 end-to-end system flows
- `docs/llm-index/TEST_AND_VERIFICATION_INDEX.md` — all test suites + what they guard
- `docs/llm-index/CHANGELOG_FOR_AGENTS.md` — reverse-chrono change log
- `docs/llm-index/FILE_SUMMARIES.json` — generated per-file metadata (472 files)
- `docs/llm-index/INDEX_MANIFEST.json` — SHA-256 hashes of 307 tracked source files

## Update protocol (MANDATORY after each task)
1. `pnpm --filter @workspace/scripts run index:llm` — regenerates FILE_SUMMARIES.json + INDEX_MANIFEST.json
2. `pnpm --filter @workspace/scripts run index:llm:check` — verify exits 0
3. Append entry to `docs/llm-index/CHANGELOG_FOR_AGENTS.md`

## Staleness checker
`checkLlmIndex.ts` exits 1 when any of the 307 tracked files changed since last `index:llm` run. Pre-commit hook (warn-only, never blocks) installed via `bash scripts/install-git-hooks.sh`.

**Why:** Without the index, a new agent scans 472+ files to understand the repo. With it, 5 targeted reads are enough — saves 50+ context reads per session.

**How to apply:** Always — before any code change, before any file search.
