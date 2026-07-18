---
name: runtimeTables.ts — DROP landmine fix
description: Runtime-created tables must be declared in lib/db/src/schema/runtimeTables.ts to prevent drizzle-kit push from scheduling DROP TABLE.
---

# Runtime Tables Drizzle Declaration

## The rule
Any table created via raw SQL at runtime (CREATE TABLE IF NOT EXISTS in application code) must ALSO be declared in `lib/db/src/schema/runtimeTables.ts`.

**Why:** drizzle-kit push compares the Drizzle schema against the live DB. Tables that exist in the DB but not in the schema are scheduled for DROP. Without a TTY, the prompt hangs and `set -e` in post-merge.sh aborts — tables survive by coincidence, not design.

**How to apply:** When adding a new runtime-created table:
1. Add the raw SQL CREATE TABLE IF NOT EXISTS in the application code (startup or lazy ensure).
2. Also add a matching pgTable declaration in `lib/db/src/schema/runtimeTables.ts`.
3. Export it from `lib/db/src/schema/index.ts`.
4. Run `pnpm --filter @workspace/db run push` (no --force) to confirm zero diff.

## Current declarations (as of 2026-07-18)
- `daily_report_runs` — dedup for daily Telegram reports
- `notification_delivery_log` — trade/signal notification delivery tracking
- `system_alert_dedup` — system health alert dedup (in-memory Map + DB)
- `system_alert_state` — system alert state machine (NORMAL/ALERTING)

## What is NOT here
- `reconciliation_report` — does not exist in this Replit environment (was on Emergent pod only)
- Strategy tables — in `strategyControl.ts` (already in schema)
