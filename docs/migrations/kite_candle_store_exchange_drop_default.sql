-- Phase 0.7A — remove the database-level exchange default on kite_candle_store.
--
-- WHY
-- `exchange TEXT NOT NULL DEFAULT 'NSE'` meant any writer that omitted the
-- column produced a row that *looks* exchange-qualified. Application code can
-- no longer do this (every writer states the exchange, and the single DB writer
-- validates it against the closed NSE|BSE set before the INSERT), but as long
-- as the column default exists, an ad-hoc SQL insert or a future writer can
-- still create a silently-defaulted row that nothing downstream can identify.
--
-- WHAT THIS DOES
-- Drops the column default only. It does NOT touch data: no row is inserted,
-- updated, deleted or relabelled, and no candle value changes. Rows written
-- before this migration keep whatever exchange text they already hold; their
-- provenance (explicitly written vs. defaulted) is not recoverable and must not
-- be guessed — see PHASE_0_7A dev-data inspection.
--
-- IDEMPOTENT
-- `ALTER COLUMN ... DROP DEFAULT` is a no-op when no default is present, and the
-- whole statement is skipped when the table or column does not exist yet, so
-- this file can be applied repeatedly and to a fresh database.
--
-- EXECUTION STATUS
-- PREPARED — NOT EXECUTED AGAINST PRODUCTION.
--
-- Committing this file, or deploying/publishing the project, does NOT execute
-- it. The file is inert: no runtime or boot path references it, and the
-- platform publish diff reads the Drizzle schema, not this directory.
-- Applying it to production is a separate, explicitly owner-authorized
-- post-deployment operation with a pre-check, one execution, and post-checks.
--
-- Procedure, rollback statement, and the development-execution disclosure:
--   docs/migrations/kite_candle_store_exchange_drop_default.RUNBOOK.md

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'kite_candle_store'
      AND column_name  = 'exchange'
      AND column_default IS NOT NULL
  ) THEN
    EXECUTE 'ALTER TABLE public.kite_candle_store ALTER COLUMN exchange DROP DEFAULT';
    RAISE NOTICE 'kite_candle_store.exchange: column default dropped';
  ELSE
    RAISE NOTICE 'kite_candle_store.exchange: no column default present — nothing to do';
  END IF;
END
$$;

-- Verification (read-only):
--   SELECT column_name, column_default
--   FROM information_schema.columns
--   WHERE table_name = 'kite_candle_store' AND column_name = 'exchange';
-- Expected after apply: column_default IS NULL.
