---
name: Publish-time diff propagates dev schema to prod
description: Replit Publish introspects dev+prod DBs and diffs them; any column added to dev DB reaches prod on next Publish automatically.
---

# Publish-Time Schema Propagation

## The rule
When the user clicks Publish, Replit's publish flow:
1. Introspects the workspace (dev) DB and the production DB
2. Computes a SQL diff
3. Surfaces renames for user confirmation in the Publish UI
4. Applies the diff to prod as part of the publish

This means: **ALTER TABLE ADD COLUMN IF NOT EXISTS applied to the dev DB will reach prod on the next Publish.** No separate prod migration script needed.

**Why:** This is the supported and documented path. See `.local/skills/database/references/database-migrations-on-publish.md`.

**How to apply:**
- For additive schema changes: apply `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` to dev DB, verify the feature works in dev, then Publish.
- NEVER: write direct DDL scripts against prod, run drizzle-kit push with a prod DATABASE_URL, or add deploy-time DDL hooks.

## Evidence (2026-07-18, R0.3)
14 Stage-2 reasoning-writer columns were applied to the dev DB via direct ALTER TABLE in this session. The Publish event that fired immediately after (`b54e7ca60`) propagated all 14 columns to prod. Confirmed via `executeSql({ environment: "production" })` — all 15 rows present with correct widths.

## Corollary
The post-merge.sh `pnpm --filter db push` applies to the DEV DB only (it reads DATABASE_URL which is the workspace DB). Prod schema is managed exclusively by the Publish flow — never by post-merge.sh.
