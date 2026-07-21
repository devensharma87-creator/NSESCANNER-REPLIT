# P0.2 Final Evidence Report Only — No Further Implementation

The preceding implementation narrative is not the required P0.2 acceptance report. Do not make further code changes merely to improve the report.

## Mode

`READ_ONLY_EVIDENCE_REPORT_ONLY`

Do not:

- edit, create, delete, stage, commit, merge, push or deploy files;
- run tests, typechecks, builds, migrations or application processes again;
- restart or stop a workflow;
- query or mutate any database;
- call Kite, Telegram, Upstox, IndianAPI/INDstocks, Apify, email or webhooks;
- close, edit, reconcile or backfill historical paper positions;
- change C0 flags, broker flags, strategy thresholds, entry cutoffs or session rules.

Use only the existing working-tree diff, source, git metadata and already-captured test output. If evidence was not captured, report `UNKNOWN` or `NOT_PROVEN`; do not manufacture proof and do not rerun work.

## Required report

### 1. Baseline and change inventory

Report:

- branch;
- starting SHA;
- current/final SHA;
- whether an automatic checkpoint occurred;
- tracked, staged and untracked status;
- exact changed-file list with one-line purpose for every file.

Resolve the earlier count inconsistency: the narrative said both “File 1 of 8” and “All 7 files are done.” State the authoritative number from `git diff --name-status`.

### 2. Manual-open false-fill proof

Give source references showing:

- no equity entry source, including `MANUAL`, can create a filled row outside an authorized exchange session;
- an after-hours manual Buy/Open returns or stages a non-filled result with its exact structured reason;
- no last-observed LTP or prior close is represented as a fresh fill;
- manual Close and all exit-only paths remain available.

State whether this was proven by a pure writer-spy/insert-count test or only by static inspection.

### 3. Entry-cutoff evidence

Identify the existing authoritative cutoff without inventing a new value:

- configuration file and symbol;
- resolved IST cutoff;
- exact boundary semantics (`<`, `<=`, `>`, or `>=`);
- behavior when configuration is absent or invalid;
- confirmation that mark-to-market and exits continue after the cutoff.

Then give the explicit classification of ABB opened at `2026-06-29 15:12:03 IST`:

- `VALID_SESSION`, `OFF_SESSION`, `SESSION_UNKNOWN`, or `TIMESTAMP_AMBIGUOUS`;
- exact reason code;
- evidence used.

### 4. Structured reason-code map

For every required reason, state where it is generated, stored, returned and rendered:

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

If any reason is declared but unreachable, label it `DECLARED_NOT_WIRED`.

### 5. Backend session truth and UI proof

List the exact optional API fields added and their types. Prove that:

- the backend owns session classification;
- the frontend no longer calculates weekday, holiday, session-window or cutoff validity;
- the frontend only formats timestamps and renders the backend result;
- timestamps display the full year and explicit `IST`;
- `VALID SESSION`, `OFF-SESSION`, `SESSION UNKNOWN` and `TIMESTAMP AMBIGUOUS` are distinguishable;
- unknown/calendar-unavailable cases never render as valid.

### 6. Complete durable-writer coverage

Return this fully populated table with file/function references:

| Lane | Durable writer | Final session guard | C0 | Entry cutoff | Quote/session check | Can insert outside valid session? | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Equity AUTO | | | | | | | |
| Equity MANUAL | | | | | | | |
| Equity staged approval | | | | | | | |
| Equity recovery/reconciliation | | | | | | | |
| F&O AUTO | | | | | | | |
| F&O MANUAL, if present | | | | | | | |
| F&O recovery/reconciliation | | | | | | | |

Use `NOT_PRESENT` where a lane does not exist. Do not describe a close/recovery-only path as an opening lane. Explicitly confirm that all exits remain separate from entry admission.

### 7. Tests and typechecks

Report each command already run and separate counts:

| Command/suite | Passed | Failed | Skipped | Timed out | DB/network used? |
| --- | ---: | ---: | ---: | ---: | --- |

Explain how the reported `80/80` total is divided between test files. State whether each required scenario was actually asserted, including zero durable inserts and preserved exit invocation.

List the five artifacts/packages included in the reported typecheck and explain why this exceeded the requested relevant-only typechecks. Do not rerun anything.

### 8. Safety and historical evidence

Confirm from existing evidence:

- no production or development database row was modified;
- no historical invalid position was closed, edited, reconciled or backfilled;
- no migration/schema command ran;
- no application/workflow started or restarted;
- no external provider or Telegram call occurred;
- no deployment, merge or push occurred;
- C0 equity and F&O blocks remain true;
- broker execution remains disabled;
- the five invalid open rows, four previously valid open rows subject to ABB classification, and nine closed invalid rows remain preserved.

If any item cannot be proven, state `UNKNOWN` rather than assuming.

### 9. Final labels

Return exactly one value and one evidence sentence for each:

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

Allowed values:

- `PASS`
- `FAIL`
- `ACTIVE`
- `DISABLED`
- `YES`
- `NO`
- `UNKNOWN`
- `NOT_APPLICABLE`

The acceptance label may be:

- `P0_2_ACCEPTED_PENDING_CONTROLLED_DEPLOYMENT_AND_HISTORICAL_LEDGER_DISPOSITION`; or
- `P0_2_NOT_ACCEPTED` followed by precise blockers.

Do not claim acceptance if any durable opening lane remains unproven, any required reason is not wired, the cutoff source is guessed, or exit preservation is unproven.

Stop after the report.
