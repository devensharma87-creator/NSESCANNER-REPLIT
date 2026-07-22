# P0.2 Fill-Price Provenance — Final Focused Correction

## Decision

The read-only report is accepted as evidence, but its acceptance label is contradicted by its own findings:

- `FNO_PREMIUM_TIMESTAMP_PROVENANCE = UNKNOWN`;
- `ACTUAL_FILL_SOURCE_POLICY_MATCH = UNKNOWN`;
- equity final quote age is underestimated because scan-build-time `freshnessSec` is used at execution time.

These are blockers because Phase B must validate the exact price source used as the modeled fill at the moment of admission.

Current status:

`P0_2_NOT_ACCEPTED`

Correct only the two issues below. Retain the completed Phase A/Phase B architecture, exact reason codes, API types, timestamp badges, cutoff policies, C0 gates and exit behavior.

## Correction 1 — Equity must compute age at execution time

Current defect:

`prov.freshnessSec` represents age at scanner-row construction, not age when the paper open is evaluated. It can underestimate real age by the scanner interval and permit a quote that has crossed the 120-second budget.

Required:

1. Capture one explicit `decisionTime` at the durable open attempt.
2. Parse the proven upstream Kite quote timestamp from `row.quote.updatedAt`/the canonical quote field.
3. Compute final age from `decisionTime - quoteTimestamp` at Phase B.
4. Do not use scan-build `prov.freshnessSec` as the final execution-age authority.
5. Preserve `prov.freshnessSec` only as diagnostic/preliminary metadata if useful.
6. Apply the existing `MODULE_REQUIREMENTS.watchlist.quote.maxFreshnessSec` boundary with its existing documented comparison semantics. Do not change the threshold.
7. Invalid, missing or future quote timestamps must fail closed using the appropriate existing structured reason. Do not invent a clock-skew tolerance.
8. Pass the same captured decision time through the preliminary and final decision where practical; do not hide `Date.now()` inside the pure final gate.
9. Apply this to MANUAL, AUTO and staged equity final entry paths. AUTO/staged may remain blocked earlier by cutoff/C0, but their eventual Phase B must be safe.
10. Manual Close and all exit paths remain unchanged.

Required tests:

- quote age was 100 seconds at scan build, 130 seconds at decision → zero open callback;
- current age within the authoritative limit → one open callback;
- exact freshness boundary follows the repository's existing equality semantics;
- one millisecond/appropriate smallest supported unit beyond boundary → zero open callback;
- missing/invalid/future quote timestamp → zero open callback;
- Yahoo, overlay, stale or `notForTradeDecisions` provenance → zero open callback;
- valid current Kite quote → one open callback;
- manual Close remains invocable.

## Correction 2 — F&O must validate the actual modeled fill premium

Current defect:

The ledger fill uses:

`signal.optionEntry ?? signal.optionLtp`

from signal-generation time, while Phase B validates a separate synchronous option-chain fetch and assigns `quoteAgeSec: 0`. The newly fetched chain proves only that a request returned; it does not timestamp or validate the older cached premium written as the fill.

`quoteAgeSec: 0` must not be used as a proxy for an unavailable provider/event timestamp.

Required approach:

1. Inspect the selected contract row returned by the current Kite option-chain fetch.
2. Identify all available fields for:
   - selected strike/expiry/side identity;
   - current LTP/bid/ask or executable-premium field;
   - provider/event timestamp;
   - market-depth/liquidity provenance.
3. Locate and reuse the repository's existing owner-approved modeled-fill convention for long/short option entries (for example LTP, ask, bid or an existing slippage model). Do not invent a new fill convention.
4. Phase B must validate the same current premium source that will be written as `entryPremium`.
5. The contract identity validated by Phase B must be the exact contract inserted.
6. Keep signal-time `optionEntry`/`optionLtp` as signal/reference analytics where existing structures support it; do not treat the reference price as a current fill without a proven timestamp and age.
7. If the current chain provides a trustworthy contract timestamp and existing fill-price convention, use those exact fields for Phase B and the modeled fill.
8. If the response does not provide sufficient timestamp/provenance or no approved current-fill convention exists, fail closed with `TRADE_ADMISSION_CONTEXT_INCOMPLETE`. Preserve F&O analysis/signals but create no paper position.
9. Do not use fetch receipt time, `quoteAgeSec: 0`, hardcoded `kite_option_chain`, index-quote time or chain success alone as proof of the fill premium's event time.
10. Do not call Kite, Upstox or IndianAPI in this task. Provider integration remains a later shadow/parity phase.

The result may safely be:

- F&O Phase B admits using a proven current selected-contract premium and timestamp; or
- F&O opening remains fail-closed until a provider with adequate per-contract timestamp/provenance is integrated.

Both preserve features. The second outcome is safer than creating a false fill.

Required tests:

- cached signal premium plus newly fetched chain with no event timestamp → zero open callback;
- `quoteAgeSec: 0` proxy without timestamp is rejected;
- selected-contract identity mismatch → zero open callback;
- timestamp/provenance belongs to index rather than option premium → zero open callback;
- missing current selected-contract premium → zero open callback;
- stale/non-trade-grade selected-contract premium → zero open callback;
- current selected-contract price with matching identity, provider timestamp, provenance and approved fill convention → one open callback, only if those fields actually exist;
- inserted/modeled premium equals the Phase-B-validated premium in the fake-writer test;
- BASELINE and Standard cutoff behavior remains unchanged;
- BSE calendar-unavailable remains fail closed;
- F&O exits remain invocable.

## Compile-time contract

Final execution context must make these inseparable:

- fill price;
- fill-price source/convention;
- quote timestamp;
- provider/provenance;
- contract/instrument identity;
- freshness policy source.

A final admission result should carry the validated fill evidence or a stable identifier/digest sufficient for the durable writer to prove it is inserting the same price/contract that Phase B approved.

Do not allow the writer to validate one quote object and insert a price from another object.

## Required lane outcomes

Return this table:

| Lane | Inserted fill source | Phase-B validated source | Same object/identity? | Execution-time age? | Missing evidence behavior | Result |
| --- | --- | --- | --- | --- | --- | --- |
| Equity MANUAL | | | | | | |
| Equity AUTO | | | | | | |
| Equity staged | | | | | | |
| F&O BASELINE | | | | | | |
| F&O Standard | | | | | | |
| BSE F&O | | | | | | |

No lane may receive PASS because C0 makes it unreachable. Its eventual final path must either validate the actual fill or fail closed.

## Permitted verification

Run only:

- API-server typecheck;
- focused pure Phase B/fill-evidence tests;
- directly affected existing pure admission tests.

Do not run full workspace tests, frontend typecheck unless frontend code changes, package installation, DB-backed tests, migrations, application startup or live APIs.

## Hard prohibitions

Do not:

- deploy, publish, merge, push or restart;
- query or mutate business databases;
- modify historical positions;
- enable C0 or broker execution;
- call Kite, Telegram, Upstox, IndianAPI/INDstocks, Apify or webhooks;
- change strategy scores, cutoffs, risk rules, contracts, expiry selection, sizing, stops, targets, exits or ledger arithmetic;
- invent fill, freshness, timestamp or slippage policy.

## Final evidence report

Return:

1. branch, starting/final SHA, checkpoint and authoritative changed files;
2. equity execution-time age calculation and policy source;
3. F&O selected-contract field inventory;
4. approved modeled-fill convention source or explicit absence;
5. completed lane-outcome table;
6. proof the durable writer inserts the exact Phase-B-approved price/contract;
7. zero-open and valid-open callback tests with per-file counts;
8. cutoff, C0 and exit regression evidence;
9. typecheck result;
10. proof no DB, historical-row, provider, deployment or restart action occurred;
11. remaining limitations.

Final labels:

- `EQUITY_EXECUTION_TIME_QUOTE_AGE`
- `EQUITY_ACTUAL_FILL_SOURCE_MATCH`
- `FNO_CURRENT_PREMIUM_TIMESTAMP`
- `FNO_ACTUAL_FILL_SOURCE_MATCH`
- `FNO_CONTRACT_IDENTITY_MATCH`
- `FNO_FETCH_TIME_PROXY_REMOVED`
- `FINAL_VALIDATED_EVIDENCE_BOUND_TO_INSERT`
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

Accept only when every admitted fill is the exact price/contract whose timestamp and provenance Phase B validated:

`P0_2_ACCEPTED_PENDING_CONTROLLED_DEPLOYMENT_AND_HISTORICAL_LEDGER_DISPOSITION`

If F&O remains deliberately fail-closed due unavailable provider timestamp/provenance, P0.2 may still be accepted only when the report proves zero durable F&O opens are possible until that evidence exists.

Otherwise:

`P0_2_NOT_ACCEPTED`

Do not deploy in this task. Stop after the report.
