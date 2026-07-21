# P0.2 Final Policy-Provenance Stop Gate

## Verdict

The latest correction materially improves reason-code and test coverage, but P0.2 is not yet accepted.

Do not repeat completed work. Correct and prove only the remaining items below.

Current status:

`P0_2_NOT_ACCEPTED`

## Retain completed work

Preserve:

- exact binding admission reason codes;
- segment-aware admission context;
- manual-entry session protection;
- callback/fake-writer harness;
- generated API/Zod provenance fields;
- distinct ambiguous-timestamp badge;
- verified BASELINE 14:45 cutoff and exact boundary test;
- BSE/SENSEX calendar-unavailable fail-closed behavior;
- C0 equity/F&O containment and disabled broker execution;
- all historical rows unchanged.

## Stop Gate 1 — Prove or remove the F&O Standard 15:25 policy

Creating `FNO_STANDARD_LATE_ENTRY_CUTOFF_IST_MIN = 15 * 60 + 25` does not make the value authoritative.

Determine its provenance using static Git/source evidence:

1. Inspect the last known pre-P0.2 baseline and Git blame/history for the original Standard-tier late-entry logic.
2. Specifically establish whether 15:25 existed before the P0.2 correction series or was first introduced during these correction tasks.
3. Report the first commit/SHA and file in which 15:25 appeared.
4. If the value existed in an owner-approved pre-P0.2 strategy policy, retain it and cite that policy source.
5. If it was introduced during P0.2 or has no owner-approved provenance, remove the new constant and every dependency on it. Standard AUTO must fail closed with `ENTRY_CUTOFF_CONFIG_UNAVAILABLE`.
6. Do not replace it with another value and do not treat exchange close as the strategy cutoff.

Do not call a constant authoritative solely because it is named or documented.

## Stop Gate 2 — Prove real callers supply mandatory quote context

Direct unit calls to `computeTradeAdmission` do not prove durable entry callers provide the required quote evidence.

For every real opening lane, report and verify the supplied fields:

| Lane | Caller | Quote source | Quote timestamp | Trade-grade/provenance | Authoritative max-age source | Missing-context behavior |
| --- | --- | --- | --- | --- | --- | --- |
| Equity AUTO | | | | | | |
| Equity MANUAL | | | | | | |
| Equity staged approval | | | | | | |
| NSE F&O BASELINE | | | | | | |
| NSE F&O Standard | | | | | | |
| BSE F&O | | | | | | |

Requirements:

- AUTO and staged opening lanes must not omit mandatory quote context and still receive `allowed: true`.
- Passing neither `quoteAgeSec` nor `quoteMaxAgeSec` must not silently bypass freshness checks for a lane whose fill depends on a market quote.
- Use the authoritative requirement for the actual price source being used to model the fill. An index-quote freshness policy is not automatically valid for an option-premium quote.
- If no authoritative freshness/provenance rule exists for that price source, fail closed with `TRADE_ADMISSION_CONTEXT_INCOMPLETE` or `QUOTE_STALE_OR_NOT_TRADE_GRADE`; do not invent a threshold.
- Manual Buy must use a current, trade-grade quote during an open session. It must never turn a cached prior close/last-observed value into a new fill.
- The durable writer remains the final guard even when a route/tick pre-check exists.

Add focused pure orchestration tests that invoke the actual production admission adapter with realistic caller contexts and fake durable writers. Prove zero open-callback calls when quote context is missing, outside-session, stale or non-trade-grade.

## Stop Gate 3 — Generated frontend type must be authoritative

Your report says OpenAPI/Zod types were generated, but the prior frontend still maintained a hand-written `OpenEqPosition` session-field interface.

Required:

1. Use the generated/shared API position type directly where practical.
2. If a view model is needed, derive it from the generated type using TypeScript composition rather than duplicating the admission unions manually.
3. Remove conflicting duplicate field unions.
4. Add a focused compile-time or pure contract test proving the frontend-consumed fields match the generated response schema.
5. Preserve all UI behavior and badges.

## Stop Gate 4 — Timestamp-confidence proof

Provide static source evidence, not an assertion:

- schema file and exact `openedAt` declaration;
- PostgreSQL type (`timestamptz` or timestamp without time zone);
- ORM mode/mapping;
- writer input semantics;
- whether all historical writer versions used the same semantics.

Rules:

- `timestamptz` plus proven writer semantics may justify `HIGH` confidence.
- Parseability or `toISOString()` alone does not justify `HIGH` confidence.
- If old writer-version semantics cannot be proven, historical rows must remain `TIMESTAMP_AMBIGUOUS` or lower confidence even when the current schema is timezone-aware.
- Do not edit historical rows.

## Stop Gate 5 — Return the missing final evidence report

The preceding response was an implementation summary, not the required acceptance report.

Return:

1. branch, starting SHA and final SHA;
2. authoritative changed-file list;
3. auto-checkpoint disclosure;
4. 15:25 provenance verdict with first-introduction SHA;
5. final Standard-tier behavior;
6. completed real-caller quote-context table;
7. authoritative freshness policy for each actual fill-price source;
8. generated frontend-type proof;
9. timestamp schema/driver/writer-version evidence;
10. per-test-file passed, failed, skipped and timed-out counts;
11. exact typecheck/codegen results;
12. proof no database, historical row, deployment, restart or external action occurred;
13. remaining limitations;
14. final labels.

Required labels:

- `FNO_STANDARD_1525_PROVENANCE`
- `FNO_STANDARD_CUTOFF`
- `REAL_CALLER_QUOTE_CONTEXT`
- `QUOTE_POLICY_PER_FILL_SOURCE`
- `ZERO_INSERT_ON_MISSING_QUOTE_CONTEXT`
- `GENERATED_FRONTEND_TYPE`
- `TIMESTAMP_SCHEMA`
- `HISTORICAL_TIMESTAMP_CONFIDENCE`
- `BINDING_REASON_CODES`
- `EXIT_PATHS_PRESERVED`
- `C0_EQUITY`
- `C0_FNO`
- `BROKER_EXECUTION`
- `HISTORICAL_ROWS_MODIFIED`
- `PURE_TESTS`
- `TYPECHECK`
- `DEPLOYED`
- `P0_2_ACCEPTANCE`

## Permitted work

You may perform static reads and make only the narrow code/test/type corrections required by the four stop gates above.

Run only:

- API-server typecheck;
- scanner/frontend typecheck;
- focused P0.2 pure tests;
- API code generation only if the existing API schema must be corrected.

Do not run full suites, DB-backed tests, migrations, application startup or live APIs.

## Hard prohibitions

Do not:

- deploy, publish, merge, push or restart;
- query or mutate business databases;
- change or dispose of historical positions;
- enable C0 or broker execution;
- call Kite, Telegram, Upstox, IndianAPI/INDstocks, Apify or webhooks;
- tune strategy scores, risk limits, contracts, expiry, stops, targets, sizing or exits;
- invent any policy value.

Accept only if all evidence is proven:

`P0_2_ACCEPTED_PENDING_CONTROLLED_DEPLOYMENT_AND_HISTORICAL_LEDGER_DISPOSITION`

Otherwise return:

`P0_2_NOT_ACCEPTED`

Do not deploy in this task. Stop after the report.
