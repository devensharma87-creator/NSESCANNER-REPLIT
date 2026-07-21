# P0.2 Final Quote-Context Enforcement — Single Remaining Blocker

## Decision

The following stop gates are accepted based on the latest evidence and must not be redone:

- F&O Standard 15:25 cutoff provenance existed before P0.2 and is documented in the architecture policy;
- binding admission reason codes;
- generated frontend/API provenance typing;
- `openedAt` timestamptz/JavaScript Date historical confidence;
- ambiguous timestamp badge;
- BASELINE 14:45 cutoff boundary;
- BSE calendar-unavailable fail-closed behavior;
- C0 and broker containment.

One critical blocker remains.

Current status:

`P0_2_NOT_ACCEPTED`

## Confirmed defect

The new `requireQuoteContext?: boolean` is optional. Your own lane audit confirms that real production callers omit quote context and still receive an allowed decision:

- F&O Standard/BASELINE proceeds before the option-chain/premium quote is available;
- equity AUTO/staged is currently blocked by missing cutoff, but would bypass quote validation if the cutoff is later configured;
- equity MANUAL can be admitted without final trade-grade quote evidence.

Tests that expect F&O admission to proceed without quote context prove the bypass rather than close it.

No quote-dependent lane may reach a durable open callback by omitting an optional flag.

## Required architecture

Use two explicit phases if quote data is unavailable at the early session check:

### Phase A — Preliminary session/policy admission

This phase may run before fetching market data and may check only:

- valid server timestamp;
- lane/segment/instrument context;
- exchange calendar/session;
- special-session authorization;
- applicable entry-cutoff policy;
- C0/system/broker/ledger gates already present.

Its result must be named and typed as preliminary. It must not authorize a fill or durable insert.

### Phase B — Final execution admission

After the real fill-price source has been fetched, and immediately before the durable insert/open callback, run final admission with mandatory:

- evaluation timestamp;
- quote/option-premium timestamp;
- quote source/provider/provenance identity;
- trade-grade status;
- applicable authoritative freshness limit and its policy source;
- current-session/date relationship;
- the already-approved session/cutoff context or a fresh re-evaluation;
- lane/segment/instrument identity.

Only Phase B may return a result that permits the durable open callback.

If any mandatory field is absent, final admission must reject with `TRADE_ADMISSION_CONTEXT_INCOMPLETE`.

If the quote is outside the valid session/date, reject with `QUOTE_OUTSIDE_SESSION`.

If stale or non-trade-grade, reject with `QUOTE_STALE_OR_NOT_TRADE_GRADE`.

Do not fetch or call live providers in this task. Wire existing quote metadata already available in each lane. If the existing source does not provide sufficient timestamp/provenance, fail closed and document the limitation.

## Lane requirements

### Equity AUTO and staged approval

- Preliminary gate may reject early because the equity AUTO cutoff is currently unavailable.
- Nevertheless, the final durable writer must require quote context so that configuring a cutoff later cannot silently expose a quote-validation bypass.
- Pass metadata for the actual entry-price quote, not unrelated scanner metadata.
- If scanner-cache LTP lacks authoritative timestamp or trade-grade provenance, reject rather than model a new fill from it.

### Equity MANUAL Buy

- Preserve the manual Buy feature during a valid session.
- Before a filled paper position is created, require a current trade-grade quote with timestamp/provenance.
- If unavailable, return a structured non-filled rejection; do not use prior close or last-observed LTP as a new fill.
- Manual Close remains available and unchanged.

### NSE F&O BASELINE and Standard

- Run Phase A before the option-chain fetch if desired.
- After fetching the actual option contract/premium quote and before inserting, run Phase B using the metadata for the premium used as the modeled fill.
- Do not validate an option-premium fill solely with an index-quote freshness rule.
- Use the authoritative requirement that applies to the actual option-chain/premium source. If none exists, fail closed rather than inventing a threshold.

### BSE F&O/SENSEX

- Preserve the existing `CALENDAR_UNAVAILABLE` fail-closed state until the BSE calendar is verified.
- Final quote admission must still be structurally mandatory so it cannot be bypassed after the calendar becomes available.

## Type-safety requirement

Remove the optional-bypass design for execution admission.

Preferred approaches:

- separate `PreliminaryAdmissionContext` and `FinalExecutionAdmissionContext`; or
- a discriminated union where `phase: "FINAL_EXECUTION"` makes all quote fields required at compile time.

An omitted boolean must never mean “quote checks not required” at the final durable boundary.

Keep backward-compatible wrappers only for analysis/historical classification. They must not be callable as final execution authorization.

## Focused pure tests

Use fake quote sources and fake durable writers. No DB, provider, application startup or live clock.

Required assertions:

1. Preliminary admission alone cannot invoke an open callback.
2. Final equity AUTO without quote context invokes open zero times.
3. Final equity staged approval without quote context invokes open zero times.
4. Final equity MANUAL without quote context invokes open zero times and returns the exact structured rejection.
5. Equity quote outside session/date invokes open zero times.
6. Equity stale/non-trade-grade quote invokes open zero times.
7. Valid equity MANUAL session plus valid quote invokes open exactly once.
8. F&O preliminary admission may proceed to data collection but cannot insert.
9. Final F&O without option-premium quote metadata invokes open zero times.
10. F&O using only index-quote metadata cannot authorize an option-premium fill unless the actual fill source is proven to be that quote.
11. Stale option-premium/chain evidence invokes open zero times.
12. Valid F&O final context invokes open exactly once.
13. BSE calendar-unavailable remains blocked.
14. Exit callback remains invocable regardless of entry rejection.
15. Every real durable opening caller is compile-time/runtime connected to Phase B.

Delete or correct any existing test that treats omission of required quote context as a valid final admission.

## Required writer-coverage table

Return:

| Lane | Phase-A caller | Actual fill-price source | Quote timestamp/provenance source | Authoritative freshness policy | Phase-B location | Durable insert/open callback after Phase B? | Missing-context result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Equity AUTO | | | | | | | |
| Equity MANUAL | | | | | | | |
| Equity staged approval | | | | | | | |
| NSE F&O BASELINE | | | | | | | |
| NSE F&O Standard | | | | | | | |
| BSE F&O | | | | | | | |

No lane may be marked PASS solely because C0 or another temporary gate makes its final path unreachable today. The final path must be safe when containment is eventually lifted.

## Evidence integrity

The latest summary omitted at least the workspace lockfile from the changed-file list even though a dependency was added and `pnpm install` ran.

In the final report, use authoritative `git diff --name-status` output and include:

- `pnpm-lock.yaml` or any other dependency metadata changed;
- evidence report/memory files;
- automatic attachment/checkpoint files separately from implementation files.

Do not describe `pnpm install` or full-workspace typecheck as if they were within the narrow permission; disclose them as prior scope deviations. Do not repeat them.

## Permitted verification

Run only:

- API-server typecheck;
- scanner/frontend typecheck only if frontend types change;
- focused P0.2 quote-admission pure tests.

Do not run codegen unless the API schema changes. Do not run full workspace tests/typecheck, install dependencies, DB-backed tests, migrations, application startup or provider calls.

## Hard prohibitions

Do not:

- deploy, publish, merge, push or restart;
- query or mutate production/development business data;
- modify historical positions;
- enable C0 or broker execution;
- call Kite, Telegram, Upstox, IndianAPI/INDstocks, Apify or webhooks;
- change signals, scores, risk rules, cutoffs, sizing, contracts, expiry, stops, targets, exits or ledger logic;
- invent a freshness policy.

## Final report

Return:

1. starting/final SHA and authoritative changed files;
2. Phase-A/Phase-B type contract;
3. completed writer-coverage table;
4. actual fill-price and quote-provenance source per lane;
5. authoritative freshness-policy source per lane;
6. zero-open callback evidence for every rejected/missing-context case;
7. valid-open callback evidence;
8. exit preservation evidence;
9. per-test-file passed, failed, skipped and timed-out counts;
10. typecheck results;
11. proof no DB, historical-row, external, deployment or restart action occurred;
12. disclosed prior scope deviations;
13. remaining limitations.

Final labels:

- `PRELIMINARY_GATE_NON_EXECUTABLE`
- `FINAL_QUOTE_CONTEXT_MANDATORY`
- `EQUITY_AUTO_FINAL_QUOTE_GATE`
- `EQUITY_MANUAL_FINAL_QUOTE_GATE`
- `EQUITY_STAGED_FINAL_QUOTE_GATE`
- `FNO_BASELINE_FINAL_QUOTE_GATE`
- `FNO_STANDARD_FINAL_QUOTE_GATE`
- `BSE_FNO_FINAL_QUOTE_GATE`
- `ACTUAL_FILL_SOURCE_POLICY_MATCH`
- `ZERO_INSERT_ON_MISSING_CONTEXT`
- `EXIT_PATHS_PRESERVED`
- `C0_EQUITY`
- `C0_FNO`
- `BROKER_EXECUTION`
- `HISTORICAL_ROWS_MODIFIED`
- `PURE_TESTS`
- `TYPECHECK`
- `DEPLOYED`
- `P0_2_ACCEPTANCE`

Accept only if every durable opening lane is protected at the final boundary:

`P0_2_ACCEPTED_PENDING_CONTROLLED_DEPLOYMENT_AND_HISTORICAL_LEDGER_DISPOSITION`

Otherwise:

`P0_2_NOT_ACCEPTED`

Do not deploy in this task. Stop after the evidence report.
