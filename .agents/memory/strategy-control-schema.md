---
name: strategyControl.ts protects strategy tables
description: strategy_definitions + strategy_engine_state were missing from Drizzle schema; recreated in strategyControl.ts so drizzle-kit push never issues a DROP.
---

## The risk

`strategy_definitions` (custom option strategies, 9 rows) and `strategy_engine_state` (scheduler state, 2 rows) existed in the database but had NO corresponding entry in the Drizzle schema (`lib/db/src/schema/`). On any future run of `drizzle-kit push`, Drizzle would detect "table in DB but not in schema" and prompt to DROP both tables — permanently destroying user-saved strategies.

## Fix

`lib/db/src/schema/strategyControl.ts` reconstructs both table definitions from:
- `pg_constraints` (to get column types and constraints)
- The compiled dist `.d.ts` (to get application-level field names and types)
- Exported from `lib/db/src/schema/index.ts` barrel

## Verification

After adding the file, `drizzle-kit push` output:
```
[✓] Pulling schema from database...
[✓] Changes applied
```
Zero SQL lines between spinners = no DROP, no CREATE, no ALTER. The schema and DB are in sync.

## Row counts after fix (dev DB)

| Table | Rows |
|---|---|
| strategy_definitions | 9 |
| strategy_engine_state | 2 |
| backtest_runs | 74 |
| backtest_trades | 30,162 |
| backtest_blocked_setups | 2,060 |

**Why**: The original schema files were missing because these tables were created by the application at runtime (not via Drizzle migrations), and the schema files were never backfilled. Any future `drizzle-kit push` without this file would attempt a destructive DROP.
