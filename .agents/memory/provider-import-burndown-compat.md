---
name: Provider-import burn-down — route new modules through compat, don't allowlist
description: How to satisfy the marketData providerImportGuard when a NEW module needs Kite session/provider access.
---

When a new api-server module needs Kite session/provider access (e.g. `getActiveSession`,
index quotes, option chain), do NOT import `./kiteAuth` / `./kiteFeed` / other providers
directly, and do NOT add the new file to `providerImportAllowlist.json`.

**Why:** the guard runs in **burn-down mode** — the allowlist is a shrinking migration
backlog. It FAILS both when a new non-allowlisted file gains a direct provider import AND
when an allowlisted file becomes clean. Adding a new file to the allowlist grows the
backlog and defeats the guard's purpose; it will also be flagged later.

**How to apply:** re-export what you need through the exempt layer `marketData/compat.ts`
(e.g. `getActiveSession as centralActiveSession`, `type ActiveSession`) and import from the
barrel/compat instead. `import type` is always allowed. The layer itself, provider
wrappers, and tests are exempt. Reseed the allowlist only to REMOVE entries via
`UPDATE_IMPORT_ALLOWLIST=1` after a genuine migration.
