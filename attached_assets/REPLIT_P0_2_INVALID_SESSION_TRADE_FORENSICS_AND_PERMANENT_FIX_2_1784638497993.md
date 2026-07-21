# P0.2 — Invalid-Session Trade Forensics and Permanent Market-Session Fix

## Owner direction

Stop P0.1B database provisioning work. The owner does not want to perform third-party database administration at this stage.

Do not ask the owner to create Neon projects, roles, databases, secrets, or identity markers.

Keep all completed P0.1A protections in place:

- `DB_TEST_RUNTIME_NOT_AUTHORIZED` remains hard-blocked;
- no DB-backed/application test suite may run;
- C0 equity auto-open block remains active;
- C0 F&O auto-open block remains active;
- broker execution remains disabled;
- main remains untouched.

P0.1B is now `DEFERRED_WITH_HARD_BLOCK`, not cancelled. Move immediately to the actual trading defect identified by the owner.

## Primary defect

The Portfolio page contains AUTO equity positions with opening dates/times outside valid Indian cash-market sessions, including examples visible in owner screenshots:

| Symbol | Displayed opening value | Expected initial classification |
| --- | --- | --- |
| DLF | 18 Jul · 16:00:28 | Invalid: 18 July 2026 was Saturday; if the stored year is 2027, 18 July 2027 was Sunday. It is invalid either way. |
| ADANIGREEN | 14 Jul · 19:02:54 | Invalid: after normal cash-market session. |
| DLF | 10 Jul · 11:30:30 | Potentially valid if the stored date is a trading day and all other admission gates passed. |
| TITAN | 09 Jul · 23:41:35 | Invalid: after market hours. |
| EXIDEIND | 09 Jul · 23:41:35 | Invalid: after market hours. |
| GRASIM | 09 Jul · 23:41:35 | Invalid: after market hours. |
| DELHIVERY | 01 Jul · 14:55:01 | Potentially valid subject to stored year, holiday, quote, and writer evidence. |
| MARUTI | 30 Jun · 14:56:17 | Potentially valid subject to stored year, holiday, quote, and writer evidence. |
| ABB | 29 Jun · 15:12:03 | Potentially valid but close to session end; validate the strategy entry cutoff. |

Do not assume the displayed year. Determine it from the database and source code. The UI must ultimately display year and timezone explicitly.

## Objective

Perform complete forensics and implement a permanent fail-closed fix so that no equity swing, equity paper, F&O paper, manual paper, scheduler, recovery, reconciliation, test, API, or legacy path can create a new trade outside its valid exchange session.

Preserve all existing features. A blocked trade candidate must remain visible as a rejected/staged decision where appropriate; it must not be silently discarded or falsely converted into a filled position.

## Authorized scope

Work only on:

`phase0/authorized-remediation-20260720`

Authorized:

- read-only operational database evidence queries;
- static source inspection;
- backend market-session service implementation;
- trade-admission integration at every durable open writer;
- pure unit tests with fake repositories/clocks;
- UI timestamp/session-honesty corrections on the Portfolio page;
- evidence documentation.

Not authorized:

- production/development database writes;
- migrations or schema changes;
- deleting, closing, editing, reconciling, quarantining, or backfilling historical positions;
- DB-backed/application test suites;
- broker calls;
- Telegram sends;
- provider calls other than read-only official exchange-calendar research;
- workflow restart;
- publish/deploy;
- merge/push;
- enabling C0 or broker execution;
- strategy threshold tuning;
- changing entry/exit/SL/target formulas unrelated to session admission.

## Stage 1 — Baseline and containment proof

Before editing, report:

- current branch and HEAD;
- main SHA;
- Git status;
- automatic checkpoint disclosure;
- C0 equity constant and line;
- C0 F&O constant and line;
- broker execution state/configuration;
- `DB_TEST_RUNTIME_NOT_AUTHORIZED` state;
- exact proposed file list.

Stop immediately if:

- C0 equity or F&O is not active;
- broker execution is enabled;
- the branch is wrong;
- main moved unexpectedly;
- there are unexplained tracked changes.

## Stage 2 — Read-only trade forensics

Use a direct database client. Do not import application modules.

Safety requirements:

1. Never print `DATABASE_URL` or credentials.
2. Begin an explicit `READ ONLY` transaction.
3. prove `transaction_read_only = on` before business-table queries;
4. use `SELECT` only;
5. set a finite statement timeout;
6. invoke no functions/procedures with side effects;
7. close/roll back the transaction after evidence collection.

Inspect every currently open equity and F&O paper position, not only the screenshot rows.

For each position collect, where columns/tables exist:

- immutable row/trade ID;
- symbol;
- exchange and segment;
- status;
- source: AUTO, MANUAL, TEST, RECOVERY, MIGRATION, UNKNOWN;
- strategy/setup key;
- full stored `opened_at`/`created_at` value;
- PostgreSQL column type (`timestamp`, `timestamptz`, text, etc.);
- database session timezone;
- value interpreted in UTC;
- value interpreted in Asia/Kolkata;
- entry price and quantity;
- quote/provider source;
- quote exchange timestamp;
- quote ingestion timestamp;
- quote freshness at admission;
- decision/reasoning/audit ID;
- scheduler/run ID;
- writer/writer-version;
- user/manual actor if present;
- account and capital effect;
- corresponding signal time;
- whether the date was weekend, official holiday, special session, or normal session;
- configured entry cutoff applicable to that strategy;
- forensic classification and confidence.

Required classifications:

- `VALID_SESSION_CONFIRMED`
- `INVALID_WEEKEND`
- `INVALID_EXCHANGE_HOLIDAY`
- `INVALID_BEFORE_SESSION`
- `INVALID_AFTER_SESSION`
- `INVALID_AFTER_ENTRY_CUTOFF`
- `TIMESTAMP_DISPLAY_DEFECT_ONLY`
- `TIMESTAMP_STORAGE_AMBIGUOUS`
- `LEGACY_OR_TEST_ARTIFACT`
- `ORPHAN_NO_DECISION_TRAIL`
- `UNDETERMINED`

Explicitly answer:

1. What is the actual stored year for the DLF 18 Jul position?
2. Was the row inserted at that time, or was an older row later assigned/displayed with that time?
3. Did its entry price come from a live quote, stale cache, prior close, fallback, manual value, or unknown source?
4. Which exact code path inserted it?
5. Did that code path evaluate a market calendar/session gate?
6. Why did C0 not prevent it: pre-C0 historical row, bypass path, manual/test insertion, or another reason?
7. Why do TITAN, EXIDEIND, and GRASIM share the identical 23:41:35 timestamp?
8. Did any automated test or migration write these rows?
9. Are P&L and capital calculations treating invalid-session rows as genuine fills?
10. Are any F&O rows also invalid by session, expiry, or contract timestamp?

Do not modify any row regardless of the answer.

## Stage 3 — Complete durable-writer map

Statically identify every code path capable of opening or inserting an equity or F&O trade.

Search for:

- all inserts/upserts into equity and F&O paper-trade tables;
- `openPaperEquityTrade` and equivalents;
- F&O open functions;
- manual-buy routes;
- API routes;
- scheduler ticks;
- signal-to-trade bridges;
- reconciliation/recovery/orphan paths;
- seed/demo/test helpers imported by runtime code;
- migration/backfill scripts;
- direct SQL writers;
- database triggers/default timestamps;
- startup/bootstrap writers.

For every writer, document:

- file/function/line;
- caller chain;
- AUTO/MANUAL/TEST/RECOVERY classification;
- current market-session check;
- current calendar source;
- timestamp source;
- quote source/freshness check;
- C0 position in the call order;
- whether it can bypass upstream guards;
- durable audit/rejection behaviour;
- required fix.

No trade-opening writer may remain unclassified.

## Stage 4 — Canonical market-session service

Implement one authoritative backend service for exchange-session decisions. Reuse and consolidate existing correct calendar code rather than creating competing services.

Required API semantics:

Input:

- exchange: NSE or BSE;
- segment: CASH, INDEX_FUTURES, INDEX_OPTIONS, STOCK_FUTURES, STOCK_OPTIONS;
- strategy/use case;
- server evaluation instant;
- optional quote exchange timestamp;
- configured strategy entry cutoff.

Output:

- `allowed` boolean;
- exchange;
- segment;
- canonical evaluation time in UTC;
- canonical evaluation time in Asia/Kolkata;
- trading date;
- trading-day boolean;
- session state;
- official open/close boundaries;
- strategy entry cutoff;
- holiday/special-session identity;
- reason code;
- calendar version/source;
- quote-session compatibility;
- fail-closed diagnostics.

Required session states:

- `PRE_OPEN`
- `OPEN`
- `ENTRY_CUTOFF_PASSED`
- `POST_CLOSE`
- `WEEKEND`
- `EXCHANGE_HOLIDAY`
- `SPECIAL_SESSION_OPEN`
- `SPECIAL_SESSION_CLOSED`
- `CALENDAR_UNAVAILABLE`
- `INVALID_TIMESTAMP`

Rules:

1. Use `Asia/Kolkata` explicitly.
2. Store/compare instants safely in UTC; never compare locale-formatted strings.
3. Normal cash/F&O session is 09:15–15:30 IST unless an official exchange special-session record overrides it.
4. Strategy entry cutoff is separate from exchange close and must use existing approved configuration.
5. Do not invent a new cutoff.
6. Saturday/Sunday are closed unless an explicit official special-session record says otherwise.
7. Holidays are exchange/segment specific.
8. Missing, stale, ambiguous, or invalid calendar data must fail closed.
9. A stale/prior-close quote cannot create a filled position outside session.
10. Client/browser time must never control admission.
11. Scheduler state must never be the sole protection.
12. No fallback may interpret `unknown` as `open`.

Use official NSE/BSE calendar sources for verification. Persist a versioned reviewed calendar/configuration appropriate to the existing architecture; do not make trade admission depend on a fragile live web scrape.

## Stage 5 — Final durable trade-admission guard

Implement one fail-closed trade-admission guard called immediately before every durable trade-opening insert/upsert.

The guard must verify at least:

- C0/open-lane authorization;
- broker/paper execution mode;
- exchange and segment identity;
- canonical market-session decision;
- strategy entry cutoff;
- server timestamp validity;
- quote exchange timestamp and session compatibility;
- quote freshness/trade-grade provenance;
- duplicate/idempotency key;
- ledger/reconciliation gate where already implemented;
- required contract identity for F&O;
- test/runtime isolation classification.

Required rejection codes include:

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
- existing C0, broker, ledger, data-quality, and contract-identity reasons.

Requirements:

1. Guard the durable writer, not only upstream callers.
2. No caller may pass `marketOpen=true` to override it.
3. No client timestamp may override server time.
4. No manual route may create a false fill outside session.
5. No recovery/reconciliation path may create a new position outside session.
6. Exit-only safety paths must remain available and clearly separate from open paths.
7. A blocked candidate must produce a structured reason before returning.
8. Never silently drop a candidate.
9. Do not write a paper-trade row when rejected.
10. Preserve C0 hard blocks and broker-disabled state.

For a legitimate after-hours swing candidate, preserve the analysis as `WATCHLIST_SETUP`, `STAGED_FOR_NEXT_VALID_SESSION`, or the closest existing non-filled state. Do not represent it as an executed/fill position. Do not build a new execution lane in this phase.

## Stage 6 — Timestamp and Portfolio UI honesty

Correct the Portfolio page without removing features.

Requirements:

- display full year;
- display timezone explicitly as `IST`;
- use one reviewed formatter;
- do not convert a missing timezone silently;
- show `Timestamp ambiguous` when storage semantics are not provable;
- add a compact invalid-session badge/warning for historical rows derived as invalid;
- distinguish `recorded at`, `signal time`, and `market fill time` when available;
- do not label an invalid/stale modeled entry as a genuine exchange fill;
- preserve Close/manual-exit functionality;
- do not mutate or hide historical rows;
- do not recalculate historical values silently.

If the current API does not expose sufficient provenance, add only backward-compatible optional response fields. Do not add a database migration in this phase.

## Stage 7 — Pure tests only

Run only pure tests that use injected clocks, calendars, repositories, quotes, and fake durable writers.

Required date/time cases:

- Saturday rejection;
- Sunday rejection;
- official holiday rejection;
- normal session before 09:15 IST rejection;
- exactly 09:15 IST boundary;
- valid intraday time;
- strategy entry-cutoff boundary;
- one instant after cutoff;
- exactly 15:30 IST close semantics;
- after 15:30 rejection;
- calendar unavailable rejection;
- invalid timestamp rejection;
- UTC-to-IST date rollover;
- special session explicitly configured;
- special session missing/unknown fails closed.

Required screenshot regressions:

- DLF 18 Jul 2026 16:00:28 IST rejects as weekend;
- DLF 18 Jul 2027 16:00:28 IST rejects as weekend;
- ADANIGREEN 14 Jul 19:02:54 IST rejects after session;
- TITAN/EXIDEIND/GRASIM 09 Jul 23:41:35 IST reject after session;
- DLF 10 Jul 11:30:30 IST can pass the session layer only if it is a valid trading day;
- ABB 29 Jun 15:12:03 IST is evaluated against the existing strategy cutoff, not assumed valid.

Required writer tests:

- rejected guard means repository insert count is zero;
- every AUTO writer calls the guard;
- every MANUAL open writer calls the guard;
- recovery/reconciliation cannot create an out-of-session position;
- exit-only paths are unaffected;
- missing exchange/segment/quote/calendar context fails closed;
- client-supplied `marketOpen` and client time cannot bypass the guard;
- C0 remains the first/strongest containment where currently required;
- F&O contract identity requirements remain intact.

Do not run DB-backed tests or the full application suite.

## Stage 8 — Verification

Permitted:

- API-server typecheck;
- scanner/libs typecheck only if changed;
- newly added pure session/admission tests;
- existing positive test-infrastructure unit test if required by imports;
- static search proving all durable open writers are guarded.

Not permitted:

- default `test`;
- `test:db`;
- full API suite;
- migrations;
- application startup;
- browser calling the live app;
- operational DB writes;
- workflow restart;
- deployment.

Report passed, failed, skipped, and timed-out counts separately.

## Stage 9 — Historical-row disposition plan

Do not alter historical rows in this phase.

Produce a row-by-row proposed disposition:

- retain as valid;
- mark invalid-session legacy;
- mark timestamp-display-only defect;
- mark test artifact;
- mark orphan/unknown;
- owner review required.

For every invalid row calculate, read-only:

- capital deployed;
- current unrealized P&L impact;
- ledger/account impact;
- whether exclusion would change portfolio totals;
- whether the row generated Telegram/reporting activity.

Do not propose deletion. A later owner-approved incident migration must preserve the original row and append classification/audit evidence.

## Stage 10 — Final report

Return one concise report. Do not narrate every tool call.

Include:

1. Baseline/final SHAs and automatic checkpoints.
2. Exact changed files and classifications.
3. Forensic table for every open position.
4. Root cause for each invalid timestamp cluster.
5. Complete writer map.
6. Canonical session-service design and calendar source/version.
7. Durable guard call-site proof.
8. Portfolio UI timestamp changes.
9. Tests and exact counts.
10. Typecheck result.
11. Proof of zero operational DB writes.
12. Proof C0 and broker-disabled state remain unchanged.
13. Historical-row disposition plan.
14. Remaining limitations requiring P0.1B or a later migration.

Final status table:

- `INVALID_SESSION_ROOT_CAUSE`
- `ALL_EQUITY_OPEN_WRITERS_MAPPED`
- `ALL_FNO_OPEN_WRITERS_MAPPED`
- `CANONICAL_SESSION_SERVICE`
- `WEEKEND_GUARD`
- `HOLIDAY_GUARD`
- `ENTRY_CUTOFF_GUARD`
- `DURABLE_WRITER_GUARD`
- `MANUAL_OPEN_GUARD`
- `RECOVERY_OPEN_GUARD`
- `EXIT_PATHS_PRESERVED`
- `TIMESTAMP_STORAGE_TRUTH`
- `PORTFOLIO_TIMESTAMP_UI`
- `HISTORICAL_ROWS_MODIFIED`
- `C0_EQUITY_BLOCK`
- `C0_FNO_BLOCK`
- `BROKER_EXECUTION`
- `PRODUCTION_DB_WRITES`
- `PURE_TESTS`
- `TYPECHECK`
- `DEPLOYED`
- `P0_2_ACCEPTANCE`

## Stop conditions

Stop and report `CRITICAL` if:

- C0 is inactive;
- broker execution is enabled;
- read-only DB mode cannot be proven;
- an operational DB write occurs;
- a new out-of-session trade is discovered after C0 activation;
- a durable open writer cannot be guarded without a migration or production-state change;
- an exit-only path would be blocked;
- current timestamps cannot be interpreted safely;
- implementation requires strategy threshold changes;
- a workflow restart/deploy is requested.

Do not provision a new database. Do not ask the owner for infrastructure work. Execute this bounded remediation, report once, and wait for owner review.
