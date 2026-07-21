# P0.2 Focused Correction — Complete Session Admission Without Feature Loss

## Decision

The current P0.2 implementation is **partially accepted**. Do not redo the forensics and do not create another broad audit.

Confirmed and retained:

- root cause: the equity durable writer lacked a market-session gate;
- 14 historical invalid-session equity positions identified;
- five invalid-session positions remain open and preserved;
- C0 equity and F&O blocks remain active in production;
- broker execution remains disabled;
- production containment remains active;
- initial 23/23 pure tests and typechecks passed;
- no production rows were changed.

Apply only the focused corrections below on `phase0/authorized-remediation-20260720`.

Do not deploy, merge, push, restart, modify schemas, or alter historical rows.

## Correction 1 — Remove false-fill manual bypass

Current defect:

`MANUAL` equity opens bypass the session gate and can create a filled paper position outside market hours.

Required behaviour:

1. No AUTO, MANUAL, staged-approval, recovery, reconciliation, API, or other open source may create a filled position outside a valid exchange session.
2. Manual Close/exit remains available at all times under its existing modeled-exit semantics.
3. A manual after-hours Buy/Open request must return a structured rejection or use an existing non-filled staged state.
4. If an existing `STAGED_FOR_NEXT_VALID_SESSION`, `WATCHLIST_SETUP`, or equivalent state exists, use it without creating a new execution lane.
5. Do not silently discard the request.
6. Do not represent last-observed LTP or prior close as an exchange fill.
7. Preserve the existing manual-buy UI; show an actionable message explaining that the request was not filled because the market is closed.

No entry-source bypass is permitted at the durable writer.

## Correction 2 — Enforce the approved strategy entry cutoff

Exchange close and strategy entry cutoff are different controls.

Required:

1. Inspect the existing approved equity/swing entry-cutoff configuration.
2. Do not invent or tune a new cutoff.
3. Pass the configured cutoff into the session-admission decision.
4. Reject new positions after the configured cutoff even if the exchange remains open.
5. Continue mark-to-market and exit evaluation after the entry cutoff.
6. Re-evaluate the ABB position opened at `2026-06-29 15:12:03 IST` against the actual existing cutoff and classify it accurately.
7. If no authoritative cutoff exists, fail closed for automatic entry and report `ENTRY_CUTOFF_CONFIG_UNAVAILABLE`; do not guess.

## Correction 3 — Structured reason codes

Replace the generic `MARKET_CLOSED` outcome with precise admission reasons while retaining backward compatibility where required.

Required reason codes:

- `MARKET_CLOSED_WEEKEND`
- `MARKET_CLOSED_HOLIDAY`
- `BEFORE_MARKET_SESSION`
- `AFTER_MARKET_SESSION`
- `ENTRY_CUTOFF_PASSED`
- `SPECIAL_SESSION_NOT_AUTHORIZED`
- `CALENDAR_UNAVAILABLE`
- `INVALID_SERVER_TIMESTAMP`
- `QUOTE_OUTSIDE_SESSION`
- `QUOTE_STALE_OR_NOT_TRADE_GRADE`
- `TRADE_ADMISSION_CONTEXT_INCOMPLETE`

Requirements:

- audit records preserve the exact reason;
- API responses preserve the exact reason;
- UI maps each reason to a clear user-facing message;
- no unknown/error state may default to market open;
- no client field may override the backend result.

Do not add a schema migration. Use existing text/reason storage and backward-compatible optional response fields.

## Correction 4 — One backend session truth

Current defect:

The frontend `isOffSessionTimestamp` independently checks weekday and 09:15–15:30. It cannot correctly identify exchange holidays, special sessions, entry cutoffs, or calendar-unavailable states.

Required:

1. Remove the frontend's authority to classify session validity independently.
2. Backend/API must supply optional derived fields for each position, for example:
   - `openedSessionValidity`;
   - `openedSessionReason`;
   - `openedAtIst` or an unambiguous timestamp plus timezone metadata;
   - `calendarVersion` where available;
   - `timestampConfidence`.
3. The frontend renders the backend classification.
4. The frontend may use a formatter only; it may not recreate market-calendar logic.
5. Preserve full year and explicit `IST` display.
6. Use badges such as:
   - `VALID SESSION` only when positively confirmed;
   - `OFF-SESSION` for confirmed invalid rows;
   - `SESSION UNKNOWN` when evidence/calendar is unavailable;
   - `TIMESTAMP AMBIGUOUS` when storage semantics are not provable.
7. Historical rows remain visible and unchanged.

## Correction 5 — Durable writer coverage proof

Do not rebuild F&O strategy logic. Perform a focused static proof that every durable open writer is protected.

Required output:

| Lane | Durable writer | Final session guard | C0 | Entry cutoff | Quote/session check | Result |
| --- | --- | --- | --- | --- | --- | --- |
| Equity AUTO | | | | | | |
| Equity MANUAL | | | | | | |
| Equity staged approval | | | | | | |
| Equity recovery/reconciliation | | | | | | |
| F&O AUTO | | | | | | |
| F&O MANUAL, if present | | | | | | |
| F&O recovery/reconciliation | | | | | | |

If an F&O opening path lacks final session protection, add the same authoritative admission check without changing strategy thresholds, contract logic, expiry rules, or exits.

Exit-only paths must remain separate and available.

## Correction 6 — Focused pure tests

Add/adjust only pure tests using fake writers, clocks, calendars, and quotes.

Required:

- MANUAL open after session creates zero trade rows;
- MANUAL open on weekend creates zero trade rows;
- manual after-hours request returns/stages a non-filled result with exact reason;
- manual Close remains unaffected;
- AUTO open after entry cutoff creates zero rows;
- exactly at the configured cutoff follows the existing approved boundary semantics;
- missing cutoff fails closed for AUTO;
- weekend, holiday, before-session, after-session, cutoff, special-session, invalid-time, stale-quote, and missing-context reasons remain distinguishable;
- frontend consumes backend classification rather than recalculating it;
- full year and `IST` remain displayed;
- DLF Saturday is `OFF-SESSION`;
- TITAN/EXIDEIND/GRASIM overnight rows are `OFF-SESSION`;
- an official holiday is `OFF-SESSION`;
- calendar-unavailable is `SESSION UNKNOWN`, not valid;
- ABB at 15:12:03 is evaluated using the real configured cutoff;
- rejected durable writer insert count is zero;
- exit writer invocation remains possible.

## Permitted verification

Run only:

- relevant API-server typecheck;
- relevant scanner/frontend typecheck;
- new/modified pure P0.2 tests;
- directly affected existing pure tests.

Do not run:

- full API suite;
- full scanner suite;
- DB-backed tests;
- migrations;
- application startup;
- live API/browser checks;
- production database writes;
- deployment or restart.

Report passed, failed, skipped, and timed-out counts separately.

## Historical positions

Do not close, delete, edit, reconcile, or backfill the five open invalid-session positions.

Update only the forensic classification for owner review in documentation. Do not mutate the database.

Required classification update:

- five invalid open rows: preserve pending owner-approved ledger disposition;
- four apparently valid open rows: retain, subject to ABB cutoff verification;
- nine closed invalid historical rows: preserve as incident evidence;
- no manual corrective action yet.

## Final report

Return one concise report containing:

1. Starting/final SHA and exact changed files.
2. Manual-open bypass removal proof.
3. Actual entry-cutoff source and boundary.
4. ABB reclassification.
5. Structured reason-code map.
6. Backend-derived UI fields and rendering proof.
7. Complete durable-writer coverage table.
8. Pure test counts.
9. Typecheck results.
10. Proof no production/database/deployment action occurred.
11. Remaining limitations.

Final labels:

- `MANUAL_FALSE_FILL_BYPASS`
- `ENTRY_CUTOFF_ENFORCEMENT`
- `STRUCTURED_SESSION_REASONS`
- `BACKEND_SESSION_TRUTH`
- `FRONTEND_SESSION_RECALCULATION`
- `ALL_EQUITY_OPEN_WRITERS_GUARDED`
- `ALL_FNO_OPEN_WRITERS_GUARDED`
- `EXIT_PATHS_PRESERVED`
- `HISTORICAL_ROWS_MODIFIED`
- `C0_EQUITY`
- `C0_FNO`
- `BROKER_EXECUTION`
- `PURE_TESTS`
- `TYPECHECK`
- `DEPLOYED`
- `P0_2_ACCEPTANCE`

Expected final status:

`P0_2_ACCEPTED_PENDING_CONTROLLED_DEPLOYMENT_AND_HISTORICAL_LEDGER_DISPOSITION`

Do not deploy in this task. Stop after the report.
