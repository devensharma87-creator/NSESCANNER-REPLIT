# P0.2 Acceptance-Blocker Correction — Focused Final Pass

## Decision

The read-only evidence report is accepted as honest evidence, but its final acceptance label is not supported.

Current status:

`P0_2_NOT_ACCEPTED`

Confirmed blockers from your own report:

1. Four mandatory reason codes are declared but not wired.
2. `TIMESTAMP_AMBIGUOUS` is visually indistinguishable from a valid row.
3. No fake-writer test proves that a rejected admission invokes zero durable inserts.
4. No invocation test proves exit-only execution remains available.
5. Equity has no authoritative strategy entry-cutoff configuration, but the implementation silently treats exchange close as the strategy cutoff instead of failing closed for automatic entry.
6. F&O calls `computeEquitySessionAdmission`, which is not an acceptable segment-aware final admission boundary for NSE F&O and BSE F&O instruments.
7. The new response fields are appended after parsing but are absent from the canonical Zod/OpenAPI/shared response contract.
8. `timestampConfidence = HIGH` is based on parseability rather than proven storage/provenance semantics.

Apply only the corrections below on `phase0/authorized-remediation-20260720`.

Do not redo the historical forensics. Do not change signal thresholds, scoring, contract selection, expiry logic, stops, targets, sizing, ledger arithmetic, Telegram behavior or any exit rule.

## Hard prohibitions

Do not:

- deploy, publish, merge, push or restart;
- modify production or development database rows;
- run migrations or change database schemas;
- close, edit, reconcile, annotate or backfill historical positions;
- enable C0 equity, C0 F&O or broker execution;
- call Kite, Telegram, Upstox, IndianAPI/INDstocks, Apify, email or webhooks;
- run full test suites, DB-backed tests or application startup;
- create a new trading lane or remove an existing feature.

## Correction A — Make admission segment-aware

Replace the F&O dependency on the equity-specific decision with one canonical, backend-owned, segment-aware admission contract.

Required context must include at least:

- lane: equity cash, NSE F&O or BSE F&O;
- exchange/segment;
- instrument/index identity;
- server time;
- quote timestamp and quote trade-grade/provenance status;
- canonical calendar result and version;
- applicable entry-cutoff policy and its source.

You may retain `computeEquitySessionAdmission` as a compatibility wrapper, but every durable writer must ultimately call a neutral final decision such as `computeTradeAdmission(context)`.

For SENSEX/BSE derivatives, do not assume an NSE calendar. For NSE instruments, do not assume BSE rules. If the calendar, segment or instrument mapping is unavailable, fail closed with an exact structured reason.

Do not alter F&O strategy tiers or the existing F&O 14:45 cutoff. Pass the existing approved F&O cutoff into the final admission context.

## Correction B — Resolve equity cutoff honestly

Your report confirms there is no authoritative equity/swing strategy cutoff separate from exchange close.

Therefore:

1. Do not describe 15:30 exchange close as an approved strategy cutoff.
2. Add/use a backward-compatible configuration contract for the equity automatic-entry cutoff without inventing a value.
3. When the cutoff is absent or invalid, AUTO, staged-approval and any opening recovery lane must fail closed with `ENTRY_CUTOFF_CONFIG_UNAVAILABLE`.
4. A configured cutoff must be validated as an IST time inside the authorized continuous session.
5. `ENTRY_CUTOFF_PASSED` must be emitted when server time is inside the exchange session but later than the configured cutoff, using the configuration's documented boundary semantics.
6. Manual Buy inside a valid exchange session may retain its existing owner-directed behavior unless an existing policy explicitly subjects it to the strategy cutoff. It must never fill outside the valid exchange session.
7. Mark-to-market and all exits remain available after the entry cutoff.

ABB at `2026-06-29 15:12:03 IST` must not be labelled valid against a nonexistent strategy-cutoff policy. Report two separate facts:

- exchange-session validity; and
- automatic-strategy cutoff validity.

If the historical cutoff policy cannot be proven, cutoff validity must be `UNKNOWN`, while exchange-session validity may remain `VALID_SESSION`.

## Correction C — Wire every mandatory reason

The following must be reachable through real final-admission branches, not merely declared in a union:

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

Required semantics:

- `QUOTE_OUTSIDE_SESSION`: the quote timestamp belongs to an unauthorized session/date or cannot represent a current-session executable quote.
- `QUOTE_STALE_OR_NOT_TRADE_GRADE`: the existing quote-age/provenance/trade-grade controls reject it. Reuse existing authoritative thresholds; do not invent new ones.
- `TRADE_ADMISSION_CONTEXT_INCOMPLETE`: mandatory lane, segment, instrument, quote timestamp, calendar context or policy identity is absent.
- `ENTRY_CUTOFF_CONFIG_UNAVAILABLE`: the applicable automatic-entry cutoff is absent, invalid or not authoritative.

If an existing quote threshold or provenance policy is unavailable, fail closed and report which required policy is missing. Do not substitute an arbitrary threshold.

Every active rejection must be preserved in the existing audit reason storage and returned to the caller. Unknown/default cases must fail closed.

## Correction D — Canonical API contract

Add the backend-derived fields to the existing canonical response validation/shared type contract, not only to a local frontend interface:

- `openedSessionValidity`;
- `openedSessionReason`;
- unambiguous IST display value or timestamp with timezone metadata;
- `calendarVersion`;
- `timestampConfidence`;
- separate cutoff validity/reason where needed.

Requirements:

- no database migration;
- optional/backward-compatible response fields;
- server response validation must not strip them;
- scanner/frontend consumes the shared/generated contract where the repository architecture supports it;
- no duplicate client-side session union or calendar calculation when a shared type exists.

## Correction E — Honest timestamp confidence and badges

Do not equate “JavaScript could parse the timestamp” with `HIGH` confidence.

Statically inspect the database schema type and driver mapping for `openedAt`:

- if timezone/provenance semantics are demonstrably unambiguous, document the proof and assign the appropriate confidence;
- if stored as timezone-naive or historical writer semantics cannot be proven, return `TIMESTAMP_AMBIGUOUS`/non-high confidence;
- never fabricate timezone certainty by calling `toISOString()` on an ambiguous value.

Render all states distinctly:

- `VALID SESSION` only when positively proven;
- `OFF-SESSION` for confirmed invalid session;
- `SESSION UNKNOWN` for unavailable calendar/policy evidence;
- `TIMESTAMP AMBIGUOUS` for unprovable timestamp semantics.

`TIMESTAMP_AMBIGUOUS` must have its own visible badge. A missing/null/unknown value must not render like valid.

Preserve full year and explicit `IST` display.

## Correction F — Real pure orchestration tests

Add focused pure tests with fake callbacks/writers. They must not connect to a database or import a module that initializes runtime services.

The production entry orchestration must use the same tested admission-controlled helper so the test is not disconnected from production control flow.

Required assertions:

1. Rejected MANUAL after-hours admission calls the durable-open callback zero times and the rejection callback exactly once with the exact reason.
2. Rejected AUTO after-cutoff admission calls the durable-open callback zero times.
3. Missing equity AUTO cutoff configuration calls the durable-open callback zero times and returns `ENTRY_CUTOFF_CONFIG_UNAVAILABLE`.
4. Stale/non-trade-grade quote calls the durable-open callback zero times.
5. Quote outside session calls the durable-open callback zero times.
6. Incomplete context calls the durable-open callback zero times.
7. Valid admission calls the open callback exactly once.
8. Exit-only callback remains invocable regardless of entry admission rejection, proving entry admission is not placed around exits.
9. `TIMESTAMP_AMBIGUOUS` maps to a distinct visible UI state through a pure mapping/formatter test.
10. All mandatory reasons are reachable and distinguishable.
11. NSE F&O and BSE F&O use their correct segment/calendar context or fail closed when that context is unavailable.

Do not use a real insert, real DB driver, network client or application startup.

## Correction G — Reconcile the labels honestly

After implementation, `STRUCTURED_SESSION_REASONS` cannot be `PASS` if any required reason is `DECLARED_NOT_WIRED`.

`FRONTEND_SESSION_RECALCULATION` cannot be `PASS` while an ambiguous row is visually indistinguishable from valid.

`P0_2_ACCEPTANCE` cannot be accepted while any mandatory blocker remains.

## Permitted verification

Run only:

- API-server typecheck;
- scanner/frontend typecheck;
- new/modified P0.2 pure tests;
- directly affected pure response-contract or UI mapping tests.

Do not run full suites, DB-backed tests, migrations, browser/live checks or provider calls.

Report passed, failed, skipped and timed-out counts separately for every command.

## Final evidence report

Return:

1. starting and final SHA;
2. exact changed files;
3. segment-aware admission contract and caller table;
4. equity cutoff source/status and exact fail-closed behavior;
5. ABB's separate exchange-session and cutoff-policy classifications;
6. all mandatory reason codes with real generation locations;
7. canonical API response schema/type proof;
8. timestamp storage/provenance proof and UI badge mapping;
9. durable-writer coverage table for equity and F&O;
10. fake-writer/callback test evidence;
11. per-command verification counts;
12. proof no database, historical row, external call, deployment or restart occurred;
13. remaining limitations.

Final labels must include:

- `SEGMENT_AWARE_ADMISSION`
- `MANUAL_FALSE_FILL_BYPASS`
- `EQUITY_CUTOFF_POLICY`
- `STRUCTURED_SESSION_REASONS`
- `CANONICAL_API_CONTRACT`
- `BACKEND_SESSION_TRUTH`
- `TIMESTAMP_CONFIDENCE`
- `ALL_EQUITY_OPEN_WRITERS_GUARDED`
- `ALL_FNO_OPEN_WRITERS_GUARDED`
- `ZERO_INSERT_ON_REJECTION_PROVEN`
- `EXIT_PATHS_PRESERVED`
- `HISTORICAL_ROWS_MODIFIED`
- `C0_EQUITY`
- `C0_FNO`
- `BROKER_EXECUTION`
- `PURE_TESTS`
- `TYPECHECK`
- `DEPLOYED`
- `P0_2_ACCEPTANCE`

Expected final status only if all blockers are closed:

`P0_2_ACCEPTED_PENDING_CONTROLLED_DEPLOYMENT_AND_HISTORICAL_LEDGER_DISPOSITION`

Otherwise return:

`P0_2_NOT_ACCEPTED`

with exact remaining blockers.

Do not deploy in this task. Stop after the evidence report.
