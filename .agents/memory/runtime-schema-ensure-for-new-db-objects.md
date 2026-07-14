---
name: Runtime schema-ensure for new DB objects
description: Any new column/table applied to dev via manual SQL must ship with a lazy runtime ensure, or prod breaks on publish.
---

**Rule**: When a task adds a DB column or table by running manual SQL against the dev DB (the required pattern here, since `drizzle-kit push` offers to DROP out-of-schema tables), the code MUST also ship a memoized, idempotent runtime ensure (`ALTER TABLE … ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`) gating every code path that reads or writes the new object.

**Why:** Drizzle `db.select()` enumerates every declared column, so after publish a fresh prod environment fails ALL selects on that table until the DDL exists — silently disabling whole subsystems (architect caught this as a blocking pre-publish gap on the plan-immutability work; the fix was already established project practice: `daily_report_runs`, `system_alert_dedup`, fno exit-monitor columns, option-signal plan schema).

**How to apply:** Copy the memoized-promise pattern (first caller runs DDL, failure clears the memo for retry, `__reset…ForTests` helper). Call it lazily at the entry of each reader/writer with `.catch(() => {})` on fail-open paths. Include CHECK constraints in the raw DDL — Drizzle table declarations exist only so drizzle-kit doesn't propose a DROP; they don't create anything. Mention the ensure log line in the publish checklist instead of a manual prod SQL step.
