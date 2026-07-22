# P0.2 Equity Validated-Fill Binding — Final Correction

## Decision

The latest evidence report is accepted.

Accepted and frozen:

- F&O deliberately fails closed because Kite option-chain data lacks a trustworthy per-premium event timestamp;
- no F&O durable insert is reachable;
- Phase A/Phase B separation;
- execution-time equity timestamp source from Kite `kq.ts`;
- exact admission reasons;
- session/cutoff/calendar controls;
- C0 and broker containment;
- exit paths;
- generated API/frontend provenance contract;
- historical rows unchanged.

Do not redo or weaken those controls.

Only two related equity defects remain:

1. Phase B accepts caller-supplied `quoteAgeSec` without independently deriving it from `serverTime` and `quoteTimestamp`.
2. Phase B validates no price, while the durable writer inserts separately supplied `signal.entryPrice`.

Current status:

`P0_2_NOT_ACCEPTED`

## Required structural correction

### 1. Remove asserted quote age from final authorization

For final execution admission:

- do not accept `quoteAgeSec` as authoritative caller input;
- derive age internally from the captured decision/evaluation time and the provider quote timestamp;
- validate both timestamps as finite and unambiguous;
- reject future quote timestamps without inventing a clock-skew tolerance;
- resolve the freshness threshold from the canonical price-source policy, not an arbitrary caller number;
- return the computed age and policy identity as output evidence.

If backward compatibility requires retaining `quoteAgeSec` in a legacy analysis interface, it must not participate in final execution authorization.

Delete the F&O rule that rejects only `quoteAgeSec === 0`. A legitimate timestamp-derived quote can have zero age. The safety property is a valid timestamp and internally derived age—not positivity.

F&O must remain fail closed because no provider timestamp exists. It should fail because the required timestamp/evidence is absent, not because a numeric sentinel is zero or NaN.

### 2. Create one canonical equity execution-quote evidence object

Create or reuse a canonical builder that receives the actual `StockRow`/quote object and produces one inseparable evidence object containing at least:

- instrument/symbol;
- price;
- upstream provider quote timestamp;
- provider identity;
- authoritative source/trust tier;
- `notForTradeDecisions`/trade-grade information;
- stale/delayed/overlay status;
- price-source kind;
- freshness-policy identity.

The builder must take price and timestamp from the same upstream quote object (`kq.last_price` and `kq.ts` as represented in the scanner row).

Prefer an opaque/branded type with a canonical factory so ordinary execution callers cannot independently assemble a price from object A and timestamp from object B.

Do not claim cryptographic protection; the requirement is a single controlled construction path and no separate mutable price argument at the durable boundary.

### 3. Phase B must validate and return the fill evidence

The final equity decision must:

1. receive the canonical evidence object;
2. derive age internally from `decisionTime - providerQuoteTimestamp`;
3. derive trade-grade status from the evidence/provenance fields;
4. select the existing authoritative freshness policy by price-source kind;
5. verify symbol/instrument identity matches the intended trade;
6. reject missing, stale, delayed, Yahoo, overlay, synthetic or `notForTradeDecisions` evidence;
7. on success, return a validated fill-evidence object containing the approved price, symbol, provider timestamp, decision time, computed age, provider and policy identity.

An allowed boolean without validated fill evidence is insufficient.

### 4. Durable writer must insert only the Phase-B-approved price

For equity MANUAL and any future AUTO/staged lane:

- the durable writer must use `finalAdmission.validatedFill.price` as `entryPrice`;
- it must use `finalAdmission.validatedFill.instrument`/symbol identity for the same trade;
- it must not use an independent `signal.entryPrice` after validating a different evidence object;
- signal/reference entry values may remain available for analytics, but they cannot silently replace the approved modeled fill;
- the final opened timestamp should use the captured Phase-B decision time, while `signalTriggeredAt` retains the true signal time where those are distinct;
- preserve existing targets, stops, quantity, ledger, risk and exit calculations, but ensure any calculation intended to use the actual entry fill receives the validated fill price consistently.

Do not change historical rows.

### 5. Future AUTO/staged safety

AUTO and staged lanes are currently blocked before Phase B. Their final durable path must nevertheless require the same canonical equity evidence object when later enabled.

If no evidence is supplied, they must fail closed with `TRADE_ADMISSION_CONTEXT_INCOMPLETE` and invoke no durable writer.

Do not add a bypass or fallback to `signal.entryPrice`.

## F&O frozen fail-closed behavior

Do not attempt provider integration in this task.

Required F&O behavior:

- no trusted per-premium event timestamp → `TRADE_ADMISSION_CONTEXT_INCOMPLETE`;
- zero durable F&O inserts;
- signals, reasoning, chain analysis and UI remain available;
- exits remain available;
- no `quoteAgeSec: 0`, `1`, `5`, fetch-time proxy or other numeric sentinel can authorize an open;
- future provider integration may supply proper evidence through a separate reviewed task.

## Focused pure tests

Use fake scanner rows/evidence and fake durable writers. No DB, application startup or provider calls.

Required tests:

1. canonical builder takes price and timestamp from the same Kite quote fixture;
2. decision time minus quote timestamp produces the internally derived age;
3. no caller-provided age field can override the derived age;
4. exact 120-second boundary follows existing semantics;
5. beyond boundary fails with zero open callbacks;
6. future timestamp fails with zero opens;
7. invalid/missing timestamp fails with zero opens;
8. Yahoo/non-trade-grade source fails with zero opens;
9. delayed/stale/overlay source fails with zero opens;
10. symbol mismatch fails with zero opens;
11. valid Kite evidence returns validated fill evidence;
12. fake durable writer inserts exactly `validatedFill.price` and matching symbol;
13. changing an independent signal/reference price does not change the inserted validated price;
14. AUTO without evidence opens zero rows;
15. staged without evidence opens zero rows;
16. manual valid evidence opens exactly once;
17. signal-trigger time and opened/decision time remain correctly distinguished;
18. F&O missing premium timestamp remains fail closed;
19. arbitrary ages `0`, `1`, `5` cannot authorize F&O because no authoritative timestamp exists;
20. exit callback remains invocable after entry rejection.

Remove or rewrite tests whose only purpose is to pass an arbitrary positive age through the final gate.

## Required coverage table

Return:

| Lane | Canonical evidence builder | Age derived internally? | Validated price returned? | Writer uses validated price? | Missing evidence | Result |
| --- | --- | --- | --- | --- | --- | --- |
| Equity MANUAL | | | | | | |
| Equity AUTO | | | | | | |
| Equity staged | | | | | | |
| F&O BASELINE | N/A | N/A | N/A | No insert | Fail closed | |
| F&O Standard | N/A | N/A | N/A | No insert | Fail closed | |
| BSE F&O | N/A | N/A | N/A | No insert | Fail closed | |

## Permitted verification

Run only:

- API-server typecheck;
- focused pure equity validated-fill and admission tests;
- directly affected existing pure admission tests.

Do not run full workspace verification, frontend tests/typecheck unless frontend code changes, dependency installation, DB-backed tests, migrations, application startup or live APIs.

## Hard prohibitions

Do not:

- deploy, publish, merge, push or restart;
- inspect live workflow logs;
- query or mutate business databases;
- modify historical positions;
- enable C0 or broker execution;
- call Kite, Telegram, Upstox, IndianAPI/INDstocks, Apify or webhooks;
- change strategies, scores, cutoffs, risk limits, sizing, contracts, expiry, stops, targets, exits or ledger arithmetic;
- invent a timestamp, age, freshness, fill or slippage policy.

## Final evidence report

Return:

1. branch, starting/final SHA, checkpoint and authoritative changed files;
2. canonical equity evidence type and builder;
3. internal age derivation and policy resolution;
4. validated-fill result structure;
5. exact writer binding from validated price/symbol to insert;
6. completed coverage table;
7. focused per-file test counts and callback assertions;
8. F&O fail-closed proof;
9. exit preservation;
10. typecheck result;
11. proof no DB, historical-row, provider, deployment, restart or log-inspection action occurred;
12. remaining limitations.

Final labels:

- `EQUITY_CANONICAL_QUOTE_EVIDENCE`
- `EQUITY_AGE_INTERNALLY_DERIVED`
- `CALLER_ASSERTED_AGE_BYPASS`
- `EQUITY_VALIDATED_FILL_RETURNED`
- `EQUITY_WRITER_USES_VALIDATED_PRICE`
- `EQUITY_SYMBOL_IDENTITY_BOUND`
- `EQUITY_OPENED_AT_USES_DECISION_TIME`
- `AUTO_STAGED_MISSING_EVIDENCE_FAIL_CLOSED`
- `FNO_MISSING_TIMESTAMP_FAIL_CLOSED`
- `ARBITRARY_FNO_AGE_SENTINEL_BYPASS`
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

Accept only if the writer inserts the exact Phase-B-validated equity price/symbol and F&O remains deterministically fail closed:

`P0_2_ACCEPTED_PENDING_CONTROLLED_DEPLOYMENT_AND_HISTORICAL_LEDGER_DISPOSITION`

Otherwise:

`P0_2_NOT_ACCEPTED`

Do not deploy in this task. Stop after the report.
