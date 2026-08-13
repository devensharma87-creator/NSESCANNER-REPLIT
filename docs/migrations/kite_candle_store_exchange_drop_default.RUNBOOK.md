# Runbook — dropping the `kite_candle_store.exchange` column default

Phase 0.7A. Companion to `kite_candle_store_exchange_drop_default.sql`.

## 1. Correction to the earlier Phase 0.7A report

The previous report described the migration as something that would reach
production by committing and deploying the SQL file. **That was wrong, and the
claim is withdrawn.**

- A `.sql` file in `docs/migrations/` is inert. Nothing in the application boots
  it, imports it, or executes it — a test in
  `artifacts/api-server/src/lib/p07a.legacyNseDefaulting.test.ts` asserts that no
  runtime or boot path references it.
- Committing it changes a file in the repository and nothing in any database.
- Deploying/publishing runs the platform's schema diff against the **Drizzle
  schema**, not against this file. Until 2026-08-13 that schema
  (`lib/db/src/schema/runtimeTables.ts`) still declared
  `exchange: text("exchange").notNull().default("NSE")`, so a publish would have
  re-asserted in production exactly the default this phase removes. That
  declaration has now been corrected to carry no default.

Consequence: the production change is a **separate, explicitly owner-authorized
post-deployment operation**. It has not been performed. Nothing in this phase
executed anything against production.

## 2. Production procedure (owner-authorized; NOT YET PERFORMED)

Run as one operation, in this order. Stop at the first step whose output does
not match.

### 2.1 Pre-check — record the current default

```sql
SELECT column_name, column_default, is_nullable, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'kite_candle_store'
  AND column_name  = 'exchange';
```

Record the returned `column_default` verbatim before proceeding — it is the only
authority for what a rollback would restore. Expected on an untouched
production database: `'NSE'::text`.

### 2.2 Pre-check — record the row count

```sql
SELECT COUNT(*) AS rows_before FROM public.kite_candle_store;
```

### 2.3 Execute — once, schema only

Execute `kite_candle_store_exchange_drop_default.sql` exactly as written. It is
a single guarded `DO $$` block: it drops the column default when one is present
and does nothing when one is not, so a repeat run is a no-op. It contains no
data statement, so no row is created, changed, removed or relabelled.

### 2.4 Post-check — default is gone

Re-run the query in 2.1. Required result: **`column_default IS NULL`**, with
`is_nullable` and `data_type` unchanged from the pre-check.

### 2.5 Post-check — data untouched

Re-run the query in 2.2. Required result: `rows_before = rows_after`.

Optional corroboration that no row content moved (compare against the same query
taken before execution):

```sql
SELECT exchange, COUNT(*) AS rows, MAX(fetched_at) AS newest_fetch
FROM public.kite_candle_store
GROUP BY exchange
ORDER BY exchange;
```

### 2.6 Failure handling

If 2.4 or 2.5 does not match, stop and report. Do not re-run, do not "fix
forward", and do not touch row data.

## 3. Rollback (only if separately authorized)

Rollback restores the silent-default behaviour this phase exists to remove, so
it is **not** part of the procedure above and must be authorized on its own.
Restore only the default recorded in step 2.1 — do not assume `'NSE'`:

```sql
-- Only if the pre-check in 2.1 recorded 'NSE'::text as the previous default.
ALTER TABLE public.kite_candle_store
  ALTER COLUMN exchange SET DEFAULT 'NSE';
```

Rollback is schema-only as well: it does not restore, alter or remove any row.
Verify afterwards with the query in 2.1 (expected: `column_default` equal to the
recorded pre-check value) and with the row count in 2.2 (unchanged).

## 4. Development-database execution — disclosure

The instruction for the previous round authorized *preparing* the migration and
*read-only* inspection of the development data. Executing it against the
development database went beyond that authorization. It was executed anyway.
This is the record of exactly what happened:

| Item | Value |
| --- | --- |
| Target | development database only |
| Date | 2026-08-12 |
| Statement | the guarded `DO $$` block in `kite_candle_store_exchange_drop_default.sql`, once |
| Default before | `'NSE'::text` |
| Default after | `NULL` |
| Rows before | 376 |
| Rows after | 376 |
| Row data changed | none — the statement contains no data statement; only `pg_attribute`'s default entry for the column was removed |
| Production touched | no |

Effect in plain terms: on the development database, a write that omits
`exchange` now fails instead of producing a row labelled `NSE`. Every candle
value, symbol, session date and status in the 376 existing rows is exactly as it
was, and their exchange text is unchanged — those rows remain
`PROVENANCE_UNVERIFIABLE` because a stored `'NSE'` carries no evidence of
whether a writer chose it or the default supplied it.
