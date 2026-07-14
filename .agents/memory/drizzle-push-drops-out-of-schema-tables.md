---
name: drizzle-kit push drops out-of-schema tables on this repo
description: Why an unguarded drizzle-kit push is dangerous here, and how to apply additive column changes safely instead.
---

# drizzle-kit push is destructive on this repo — prefer direct ALTER for additive columns

Running `drizzle-kit push` against the dev DB prompts to **DROP** tables that
exist in the database but are not present in the Drizzle schema
(`lib/db/src/schema/`). As of 2026-06-09 those include `strategy_engine_state`
and `strategy_definitions` (live data). Answering "yes" causes unrelated data
loss; the prompt is interactive and easy to mis-handle from a non-tty shell.

**Rule:** for purely *additive* schema changes (new nullable columns), do NOT
run push. Apply the change with idempotent direct SQL instead:
`psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "ALTER TABLE <t> ADD COLUMN IF NOT EXISTS ..."`.
Keep the Drizzle schema file in sync so the ORM types match, but skip push.

**Why:** the schema is not a complete mirror of the DB (some tables are managed
outside the Drizzle schema), so push's "make DB match schema" semantics want to
delete them.

**How to apply:** any time a task says "add column / drizzle-kit push", reach for
`ADD COLUMN IF NOT EXISTS` first; only use push if you have confirmed the schema
fully covers every live table and you actually intend any drops it proposes.

**Binary location:** `drizzle-kit` is installed in `lib/db`, NOT api-server.
Invoke via `pnpm --filter @workspace/db exec drizzle-kit ...` (config:
`lib/db/drizzle.config.ts`). The `pnpm --filter @workspace/api-server exec drizzle-kit push`
form noted elsewhere fails with "Command not found".
