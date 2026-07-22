# P0.2 Final Quote-Context Evidence Report Only

The implementation summary was truncated before the evidence needed for acceptance.

## Mode

`STRICTLY_READ_ONLY_REPORT_ONLY`

Do not modify, create or delete code; run tests/typechecks/builds; install packages; query databases; start/restart processes; call providers; commit; merge; push; publish or deploy.

Use only the current source, Git metadata and already-captured outputs. If evidence is unavailable, report `UNKNOWN` or `NOT_PROVEN`. Do not manufacture or rerun proof.

If an automatic checkpoint occurs, disclose it. Do not create an additional commit for this report.

## Required report

### 1. Baseline and exact change inventory

Return:

- branch;
- starting SHA;
- current/final SHA;
- automatic checkpoint SHA and trigger;
- `git status` classification;
- authoritative `git diff --name-status` file list;
- separate implementation, test, dependency/lockfile, evidence-document and automatic-attachment files.

### 2. Phase A / Phase B contract

Document the exact exported types and functions with file references:

- `PreliminaryAdmissionContext`;
- `PreliminaryAdmissionResult`;
- `computePreliminaryAdmission`;
- `FinalExecutionAdmissionContext`;
- `FinalExecutionAdmissionResult`;
- final execution-admission function;
- any compatibility wrapper.

Prove that a preliminary result cannot authorize or be passed as a final execution result. State whether this is compile-time enforced, runtime enforced, or both.

Confirm that no executable lane retains `requireQuoteContext?: boolean` or any equivalent optional bypass.

### 3. Real durable-writer coverage

Populate completely:

| Lane | Phase-A location | Actual modeled fill-price source | Quote timestamp field | Provider/provenance field | Trade-grade decision | Authoritative freshness policy and source | Phase-B location | Durable insert after Phase B? | Missing-context result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Equity AUTO | | | | | | | | | |
| Equity MANUAL | | | | | | | | | |
| Equity staged approval | | | | | | | | | |
| NSE F&O BASELINE | | | | | | | | | |
| NSE F&O Standard | | | | | | | | | |
| BSE F&O | | | | | | | | | |

Do not mark a lane protected solely because C0, missing cutoff or BSE-calendar containment currently makes it unreachable. Prove its eventual final insert path is behind Phase B.

### 4. Equity quote provenance proof

The implementation appears to use `StockRow.updatedAt` as a quote timestamp. Prove what that field means.

Report static source evidence for:

- where `StockRow.updatedAt` is assigned;
- whether it is the upstream provider's quote/event timestamp, scanner-row generation time, cache-write time or API-response time;
- whether it can be refreshed without receiving a new tradable quote;
- the field used for provider/source identity;
- how Yahoo/fallback/synthetic/cached sources are classified;
- which sources can and cannot drive paper fills;
- the authoritative equity-quote freshness policy and exact source.

If `updatedAt` is not a proven quote timestamp, label the lane `NOT_PROVEN` or `FAIL`; do not assume it is valid.

For MANUAL Buy, prove that the final fill does not use prior close or last-observed LTP when a current trade-grade quote is unavailable.

### 5. F&O premium provenance proof

Report:

- the actual option contract/premium field used as the modeled fill;
- the option-chain/premium timestamp used by Phase B;
- provider/provenance identity;
- whether the chain fetch succeeded and was complete enough for the selected contract;
- authoritative 300-second policy source, if used;
- why an index-quote timestamp cannot substitute for the option-premium timestamp;
- exact Phase-B placement relative to contract selection, premium/liquidity validation and durable insert.

If the provider response has no trustworthy timestamp/provenance, state the resulting fail-closed reason.

### 6. Rejection and exit behavior

Using existing source/tests, prove:

- missing quote context invokes the durable-open callback zero times;
- outside-session quote invokes it zero times;
- stale/non-trade-grade quote invokes it zero times;
- valid final context invokes it exactly once;
- preliminary admission alone cannot invoke it;
- manual Close and all exit-only lanes remain callable regardless of entry rejection.

Differentiate pure callback proof from static control-flow proof.

### 7. Test and typecheck evidence

Return each previously executed command and exact counts:

| Command/file | Passed | Failed | Skipped | Timed out | DB/network used? |
| --- | ---: | ---: | ---: | ---: | --- |

Reconcile the reported `111/111` total into per-file counts. Identify the exact 15 new Phase A/Phase B tests and state which production function/harness each exercises.

List typecheck commands and outcomes. Do not rerun anything.

### 8. Safety proof

Confirm from existing evidence:

- no business-database query or mutation;
- no historical-position change;
- no schema migration;
- no application/workflow start or restart;
- no Kite, Telegram, Upstox, IndianAPI/INDstocks, Apify, webhook or email call;
- no merge, push, publish or deployment;
- C0 equity active;
- C0 F&O active;
- broker execution disabled.

Use `UNKNOWN` where proof is unavailable.

### 9. Remaining limitations and final labels

Return one value plus one evidence sentence for:

- `PRELIMINARY_GATE_NON_EXECUTABLE`
- `FINAL_QUOTE_CONTEXT_MANDATORY`
- `EQUITY_AUTO_FINAL_QUOTE_GATE`
- `EQUITY_MANUAL_FINAL_QUOTE_GATE`
- `EQUITY_STAGED_FINAL_QUOTE_GATE`
- `FNO_BASELINE_FINAL_QUOTE_GATE`
- `FNO_STANDARD_FINAL_QUOTE_GATE`
- `BSE_FNO_FINAL_QUOTE_GATE`
- `EQUITY_QUOTE_TIMESTAMP_PROVENANCE`
- `FNO_PREMIUM_TIMESTAMP_PROVENANCE`
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

Allowed values:

- `PASS`
- `FAIL`
- `ACTIVE`
- `DISABLED`
- `YES`
- `NO`
- `UNKNOWN`
- `NOT_APPLICABLE`

Accept only if every real durable opening lane has mandatory, proven quote metadata at Phase B:

`P0_2_ACCEPTED_PENDING_CONTROLLED_DEPLOYMENT_AND_HISTORICAL_LEDGER_DISPOSITION`

Otherwise:

`P0_2_NOT_ACCEPTED`

with exact blockers.

Stop after the report.
