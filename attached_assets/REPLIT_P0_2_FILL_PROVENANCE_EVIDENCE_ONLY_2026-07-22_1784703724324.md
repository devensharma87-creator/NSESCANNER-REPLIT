# P0.2 Fill-Provenance Final Evidence Only

## Mode

`STRICTLY_READ_ONLY_REPORT_ONLY`

The implementation action log is not the required acceptance report. Do not modify code, tests, documentation or memory. Do not rerun tests/typechecks, inspect live workflows, query databases, call providers, commit, merge, push, publish, deploy or restart.

Use only current static source, Git metadata and already-captured outputs. Report `UNKNOWN` or `NOT_PROVEN` where evidence is missing.

## Deciding concern

Two tests were changed from `quoteAgeSec: 0` to `quoteAgeSec: 5` to pass a new check.

Merely requiring a positive caller-supplied age is not provenance enforcement. A fabricated `5` is no safer than a fabricated `0`.

The report must establish whether age is derived inside the final gate from an actual provider/event timestamp and the captured decision time, and whether the validated price/contract is the exact object inserted.

## Required report

### 1. Baseline and changes

Return branch, starting SHA, final SHA, auto-checkpoint disclosure, clean/dirty status and authoritative `git diff --name-status` categorized into implementation, tests, documentation/memory and automatic attachments.

### 2. Equity execution-time age

Show exact source references and formulas for:

- captured decision time;
- provider quote timestamp;
- calculation of execution-time quote age;
- freshness-policy source and boundary comparison;
- handling of missing, invalid and future timestamps;
- value passed to Phase B;
- exact equity price passed to Phase B;
- exact price inserted.

Answer explicitly:

1. Is `prov.freshnessSec` still used as final execution age?
2. Can a caller supply an arbitrary `quoteAgeSec` without a timestamp from which Phase B independently derives/verifies it?
3. Does Phase B reject inconsistent `quoteAgeSec` and `quoteTimestamp` values?
4. Is the same captured decision time used throughout the attempt?
5. Does the inserted equity entry price equal the Phase-B-validated price?

### 3. F&O current premium evidence

Inventory the actual selected option-chain row fields used by the correction:

- expiry;
- strike;
- option type/side;
- token/tradingsymbol or stable contract identity;
- LTP/bid/ask/current premium;
- provider/event timestamp;
- fetch/receipt timestamp;
- liquidity/depth fields;
- provenance/provider identity.

Then show:

- existing approved modeled-fill convention and its static policy source;
- price selected under that convention;
- exact timestamp bound to that price;
- freshness age derived from that timestamp;
- Phase-B input evidence object;
- validated evidence returned from Phase B;
- exact `entryPremium` and contract identity passed to the durable insert.

If Kite provides no trustworthy option-premium timestamp, show the fail-closed branch and prove no F&O insert is reachable. Do not call fetch receipt time or an arbitrary positive age a provider timestamp.

### 4. Zero-versus-five test change

For each test changed from age `0` to `5`, report:

- test name;
- why zero was rejected;
- where five comes from;
- whether five is computed from a real fixture timestamp or is a literal;
- what production invariant the test actually proves.

If `5` is merely a literal used to bypass `age > 0`, label the provenance fix `FAIL`.

Legitimate zero-age quotes must not be rejected solely because their computed age is zero; the safety property is a valid bound timestamp, not positivity.

### 5. Final evidence binding

Document the types connecting:

- fill price;
- fill convention/source;
- quote timestamp;
- provider/provenance;
- instrument/contract identity;
- freshness policy source;
- final validated result;
- durable insert parameters.

State whether the writer can validate evidence object A and insert price/contract B. If yes, label `FAIL`.

### 6. Tests and verification

Return the exact previously executed commands and per-file counts for the reported 60 tests. Identify all 14 new tests and whether each uses:

- computed timestamp-derived age;
- a caller-supplied literal age;
- fake durable-writer price/contract equality assertions;
- zero-open callback assertions;
- exit invocation assertions.

Report passed, failed, skipped and timed-out separately. Do not rerun.

### 7. Workflow-log disclosure

The action log states that API-server workflow logs were checked and showed Kite 429 responses and DB connection timeouts.

Clarify:

- whether logs were only read;
- whether the agent initiated any workflow, request, Kite call or DB connection;
- timestamps of the observed events;
- whether they predated this implementation;
- whether they produced durable mutations.

Do not inspect the logs again.

### 8. Safety and final labels

Confirm no business-data mutation, historical-row change, migration, provider call, Telegram send, workflow restart, merge, push or deployment. Use `UNKNOWN` where unproven.

Return one value and one evidence sentence for:

- `EQUITY_AGE_DERIVED_FROM_PROVIDER_TIMESTAMP`
- `EQUITY_AGE_VERIFIED_NOT_CALLER_ASSERTED`
- `EQUITY_VALIDATED_PRICE_EQUALS_INSERTED_PRICE`
- `FNO_PREMIUM_PROVIDER_TIMESTAMP`
- `FNO_AGE_DERIVED_NOT_ASSERTED`
- `FNO_VALIDATED_PRICE_EQUALS_INSERTED_PREMIUM`
- `FNO_CONTRACT_IDENTITY_BOUND_TO_INSERT`
- `FNO_FAIL_CLOSED_IF_TIMESTAMP_UNAVAILABLE`
- `FETCH_TIME_PROXY_REMOVED`
- `ARBITRARY_POSITIVE_AGE_BYPASS`
- `ZERO_INSERT_ON_UNPROVEN_FILL`
- `EXIT_PATHS_PRESERVED`
- `C0_EQUITY`
- `C0_FNO`
- `BROKER_EXECUTION`
- `HISTORICAL_ROWS_MODIFIED`
- `PURE_TESTS`
- `TYPECHECK`
- `DEPLOYED`
- `P0_2_ACCEPTANCE`

Allowed values: `PASS`, `FAIL`, `ACTIVE`, `DISABLED`, `YES`, `NO`, `UNKNOWN`, `NOT_APPLICABLE`.

Accept only if age is derived from real timestamp evidence and the exact validated price/contract is inserted:

`P0_2_ACCEPTED_PENDING_CONTROLLED_DEPLOYMENT_AND_HISTORICAL_LEDGER_DISPOSITION`

If F&O lacks adequate timestamp evidence, acceptance is permitted only if all F&O durable opens deterministically fail closed before insert.

Otherwise:

`P0_2_NOT_ACCEPTED`

Stop after the report.
