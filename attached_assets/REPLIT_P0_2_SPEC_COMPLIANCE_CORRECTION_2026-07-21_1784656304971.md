# P0.2 Specification-Compliance Correction — No New Policy Invention

## Verdict

The latest implementation is not accepted. It contains useful foundations, but it deviated from the binding P0.2 specification.

Current status:

`P0_2_NOT_ACCEPTED`

This is a bounded correction, not another audit.

## Retain these completed improvements

Preserve unless a correction below requires a narrow adjustment:

- canonical backend admission context with lane, segment and instrument;
- manual equity Buy session pre-check plus durable-writer session check;
- manual Close and exit-only separation;
- backend-derived historical session fields;
- canonical OpenAPI/Zod response fields and successful code generation;
- visible `TIMESTAMP_AMBIGUOUS` badge;
- callback/fake-writer testing infrastructure;
- C0 equity and F&O blocks;
- broker execution disabled;
- all historical rows unchanged.

Do not remove features or revert these valid improvements.

## Confirmed specification deviations to correct

### 1. Restore the binding reason-code contract

The implementation replaced required codes with new generic codes such as `EXCHANGE_CLOSED`, `HOLIDAY`, `STALE_SERVER_TIME`, `QUOTE_STALE`, `QUOTE_UNAVAILABLE`, `RISK_GATE_BLOCKED`, `SESSION_UNKNOWN`, `TIMESTAMP_AMBIGUOUS` and `ALLOWED`.

These are not substitutes for the binding admission reasons.

The externally returned and audit-persisted rejection contract must use these exact codes:

- `MARKET_CLOSED_WEEKEND`
- `MARKET_CLOSED_HOLIDAY`
- `BEFORE_MARKET_SESSION`
- `AFTER_MARKET_SESSION`
- `ENTRY_CUTOFF_CONFIG_UNAVAILABLE`
- `ENTRY_CUTOFF_PASSED`
- `SPECIAL_SESSION_NOT_AUTHORIZED`
- `CALENDAR_UNAVAILABLE`
- `INVALID_SERVER_TIMESTAMP`
- `QUOTE_OUTSIDE_SESSION`
- `QUOTE_STALE_OR_NOT_TRADE_GRADE`
- `TRADE_ADMISSION_CONTEXT_INCOMPLETE`

Requirements:

- every code must be reachable through a real branch;
- every rejection branch must fail closed;
- audit storage, API response and UI mapping must preserve the exact code;
- maintain backward compatibility for already-stored legacy reasons;
- do not rewrite historical audit rows;
- an allowed outcome is a decision state, not a rejection reason;
- `TIMESTAMP_AMBIGUOUS` remains a historical-display validity state, not a replacement for `INVALID_SERVER_TIMESTAMP`;
- risk-gate decisions remain in the existing risk layer and reason vocabulary; do not move `RISK_GATE_BLOCKED` into session admission.

Internal aliases may exist only if they deterministically map to the exact external/audit contract above.

### 2. Remove invented policy values

The following values were invented and are not authorized:

- `TRADE_GRADE_MAX_AGE_SEC = 90`;
- F&O Standard cutoff `15:25` / `FNO_STANDARD_CUTOFF_15:25`.

Remove these invented policy values from admission decisions.

For quote freshness/trade-grade:

1. Locate and reuse the repository's existing authoritative quote-age and provenance/trade-grade policy.
2. Cite its file, symbol and value/source in the final report.
3. If no authoritative policy exists for a lane, fail closed with `TRADE_ADMISSION_CONTEXT_INCOMPLETE` or `QUOTE_STALE_OR_NOT_TRADE_GRADE`, as semantically appropriate.
4. Do not invent a replacement threshold.

For F&O cutoff:

1. Preserve the existing verified BASELINE cutoff at 14:45 IST and its existing boundary semantics.
2. Locate the existing authoritative Standard-tier cutoff, if one exists.
3. If no authoritative Standard-tier cutoff exists, Standard AUTO admission must fail closed with `ENTRY_CUTOFF_CONFIG_UNAVAILABLE`.
4. Do not use exchange close or a newly invented time as the Standard strategy cutoff.

For equity AUTO/staged entry:

- keep cutoff unavailable/fail-closed until an owner-approved cutoff exists;
- do not describe exchange close as the strategy cutoff;
- manual Buy remains subject to a valid exchange session but may remain outside automatic-strategy cutoff policy if that matches the existing owner-directed lane.

### 3. Separate evaluation time from quote freshness

`serverTime` is the decision's evaluation instant. It must not be called stale merely because it differs from the process's current `Date.now()` during a deterministic test or historical classification.

Required model:

- validate that evaluation/server time is finite and structurally valid;
- use explicit supplied quote timestamp to assess quote session/date and freshness;
- compare quote timestamp with the supplied evaluation time using the existing authoritative quote policy;
- do not hide a `new Date()`/`Date.now()` dependency inside the pure admission function;
- historical stored-open classification must not run live quote-freshness logic;
- invalid evaluation timestamp produces `INVALID_SERVER_TIMESTAMP`;
- missing mandatory quote/context produces `TRADE_ADMISSION_CONTEXT_INCOMPLETE`;
- a quote belonging to an unauthorized session/date produces `QUOTE_OUTSIDE_SESSION`;
- a stale or non-trade-grade quote produces `QUOTE_STALE_OR_NOT_TRADE_GRADE`.

### 4. Keep exchange calendars segment-specific

- NSE equity and NSE F&O use the authoritative NSE calendar/session source.
- BSE F&O/SENSEX must use an authoritative BSE calendar/session source.
- Until the BSE calendar is verified, BSE F&O must fail closed with `CALENDAR_UNAVAILABLE`.
- Do not silently substitute the NSE calendar for BSE.
- A calendar must report its coverage/version. A date outside verified coverage must fail closed with `CALENDAR_UNAVAILABLE`.
- Special/pre-open sessions require explicit authorization; otherwise return `SPECIAL_SESSION_NOT_AUTHORIZED`.

### 5. Finish the canonical response contract

The generated OpenAPI/Zod/client contract is authoritative.

Required:

- use the generated/shared position response type in the frontend where available;
- do not maintain a conflicting hand-written duplicate session-field union;
- if a local view model is necessary, derive it from the generated type and document why;
- ensure Zod validation preserves every optional provenance field;
- keep full year and explicit `IST` formatting;
- render `VALID SESSION`, `OFF-SESSION`, `SESSION UNKNOWN` and `TIMESTAMP AMBIGUOUS` distinctly;
- absence of provenance must never look valid.

### 6. Prove timestamp confidence correctly

The final report must cite:

- the exact database schema declaration for `openedAt`;
- whether it is PostgreSQL `timestamptz` or timestamp without time zone;
- the ORM/driver mapping;
- why historical writer semantics do or do not justify `HIGH` confidence.

Parseability alone is not sufficient. If any historical timestamp provenance remains unprovable, classify it honestly as ambiguous/unknown without modifying the row.

## Required pure tests

Use the existing fake-writer/callback harness and production admission orchestration. No DB or application startup.

Add or correct tests for all of the following:

1. weekend → `MARKET_CLOSED_WEEKEND`;
2. official holiday → `MARKET_CLOSED_HOLIDAY`;
3. before 09:15 → `BEFORE_MARKET_SESSION`;
4. after 15:30 → `AFTER_MARKET_SESSION`;
5. unauthorized pre-open/special session → `SPECIAL_SESSION_NOT_AUTHORIZED`;
6. unavailable/out-of-coverage calendar → `CALENDAR_UNAVAILABLE`;
7. invalid evaluation time → `INVALID_SERVER_TIMESTAMP`;
8. quote from unauthorized session/date → `QUOTE_OUTSIDE_SESSION`;
9. stale or non-trade-grade quote using the existing policy → `QUOTE_STALE_OR_NOT_TRADE_GRADE`;
10. incomplete mandatory context → `TRADE_ADMISSION_CONTEXT_INCOMPLETE`;
11. missing equity AUTO cutoff → `ENTRY_CUTOFF_CONFIG_UNAVAILABLE`;
12. later than configured cutoff → `ENTRY_CUTOFF_PASSED`;
13. exact BASELINE 14:45 boundary follows the existing code's documented equality semantics;
14. F&O Standard without an authoritative cutoff fails closed;
15. BSE/SENSEX without verified calendar fails closed;
16. rejected MANUAL after-hours open invokes durable-open callback zero times and rejection callback once;
17. rejected AUTO/staged open invokes durable-open callback zero times;
18. valid admission invokes durable-open callback exactly once;
19. exit callback remains invocable after entry rejection;
20. ambiguous timestamp maps to a visible distinct badge/view state;
21. missing session provenance never renders as valid;
22. generated response schema accepts and preserves all provenance fields.

The final report must show the per-file test count and passed/failed/skipped/timed-out totals. Do not claim coverage that is absent from the test output/source.

## Permitted files and verification

Modify only the admission module, its direct equity/F&O callers, audit reason typing, canonical API schema/generated output, frontend provenance rendering/type usage, and focused pure tests required for this correction.

Run only:

- API specification code generation if the schema changes;
- API-server typecheck;
- scanner/frontend typecheck;
- the focused P0.2 pure test files;
- directly affected pure schema/UI tests.

Do not run full suites, DB-backed tests, migrations, application startup or live APIs.

## Hard safety rules

Do not:

- deploy, publish, merge, push or restart;
- query or mutate production/development business data;
- modify or dispose of historical positions;
- enable C0 or broker execution;
- call any external provider or Telegram;
- change strategy scores, signals, contracts, expiry, sizing, stops, targets, exits or ledger logic.

If an automatic checkpoint occurs, disclose its SHA and exact files. Do not trigger an extra commit solely for the report.

## Required final evidence report

Return one report containing:

1. branch, starting/final SHA and exact changed files;
2. removal of invented 90-second and 15:25 policies;
3. authoritative policy sources actually reused;
4. exact canonical reason-code generation map;
5. equity, NSE F&O and BSE F&O caller/guard table;
6. cutoff behavior including exact 14:45 boundary;
7. quote-time/freshness decision evidence;
8. generated API/shared frontend type proof;
9. timestamp schema/driver/provenance evidence;
10. per-test-file counts and callback invocation assertions;
11. typecheck/codegen results;
12. proof no DB, historical row, deployment, restart or external action occurred;
13. remaining limitations.

Final labels:

- `BINDING_REASON_CODES`
- `INVENTED_POLICY_VALUES`
- `DETERMINISTIC_TIME_MODEL`
- `QUOTE_ADMISSION_POLICY`
- `SEGMENT_CALENDAR_ISOLATION`
- `EQUITY_CUTOFF_POLICY`
- `FNO_BASELINE_CUTOFF`
- `FNO_STANDARD_CUTOFF`
- `CANONICAL_API_CONTRACT`
- `TIMESTAMP_CONFIDENCE`
- `ZERO_INSERT_ON_REJECTION_PROVEN`
- `EXIT_PATHS_PRESERVED`
- `C0_EQUITY`
- `C0_FNO`
- `BROKER_EXECUTION`
- `HISTORICAL_ROWS_MODIFIED`
- `PURE_TESTS`
- `TYPECHECK`
- `DEPLOYED`
- `P0_2_ACCEPTANCE`

Accept only if all binding requirements are proven:

`P0_2_ACCEPTED_PENDING_CONTROLLED_DEPLOYMENT_AND_HISTORICAL_LEDGER_DISPOSITION`

Otherwise:

`P0_2_NOT_ACCEPTED`

Do not deploy in this task. Stop after the report.
