# PHASE 0.8B — CANONICAL RECORD AND ACTIVATION-BOUNDARY CORRECTION

Use **Power mode**. This is a bounded production-contract correction. Do not checkpoint until every requirement below is satisfied.

## Current blocker

The Phase 0.8B transport and concurrency work is strong, but the closure report reveals three roadmap-critical gaps:

1. The reported stored tick contains raw market fields but does not prove the complete canonical provenance record required by the owner’s data contract.
2. Feed startup reportedly trusts a summary `gatesPass` value instead of independently validating the structured activation evidence at the final side-effect boundary.
3. The report verifies a different set of four locks and does not reconfirm the four long-standing frozen owner locks used throughout the roadmap.

Current verdict:

`PHASE_0_8B_CHECKPOINT_BLOCKED — CANONICAL_QUOTE_PROVENANCE_INCOMPLETE — ACTIVATION_BOUNDARY_TRUSTS_SUMMARY_BOOLEAN — REQUIRED_OWNER_LOCKS_NOT_RECONFIRMED`

## Objective

Correct the Phase 0.8B foundation so that:

- every stored or emitted quote is a complete canonical market-data record;
- the final socket-creation boundary revalidates every activation gate from structured evidence rather than trusting a caller’s Boolean;
- test authorization cannot bypass production safety through an ordinary production option;
- all required safety locks are explicitly verified;
- the already accepted no-fourth-socket, rollback, reconnect, coverage and shutdown protections remain intact.

## Non-negotiable restrictions

- No real Kite login, SDK client, WebSocket, subscription or provider request.
- No registry refresh, exchange download, database access or schema change.
- No server/workflow restart, controlled boot, browser, build, Publish or Reserved VM purchase.
- No dependency, lockfile, generated-client, F&O, Swing, candle, indicator, signal, score, confidence, paper-trade or order change.
- No fake, inferred, reconstructed, neutral-zero or stale value may be stored as real production data.
- No commit, push, merge, reset, revert, rebase or checkpoint without separate authorization.
- Preserve the accepted Phase 0.8B socket manager and change only what is required for these contracts.

## A. Trace the real write and emission path first

Before editing, document the exact current path:

`provider tick → tickIngestion → identity resolution → liveQuoteStore → snapshot/SSE → consumers`

For each boundary, list the exact TypeScript type and fields currently retained or discarded.

Answer explicitly:

1. Does `ingestTick()` write directly to `liveQuoteStore`, return a normalized record for another caller, or only validate raw fields?
2. Where is provider token resolved to `canonicalInstrumentId`, exchange, segment and trading symbol?
3. Where are registry generation, manifest hash, shard id, provider, validation, freshness, conflict and last-valid time attached?
4. Does SSE serialize the same canonical record, or rebuild/reduce it?
5. Do any current consumers still receive only the old `LiveTick` shape?

Do not claim completion from comments or intended flow; prove it from actual production call sites.

## B. Implement the complete canonical quote record

Create or extend one canonical production record used by storage and SSE. Do not create another parallel quote store.

Every accepted canonical quote must contain:

### Identity

- `canonicalInstrumentId`
- `exchange` (`NSE` or `BSE`, closed set)
- `segment`
- `tradingSymbol`
- `providerInstrumentToken`
- `providerExchangeToken` where provider-supplied
- `securityId` where authoritative, otherwise explicit `null`
- `isin` where authoritative, otherwise explicit `null`
- `securityClass`

### Market values

- `value` / LTP
- OHLC fields individually present only when provider-supplied and finite
- volume only when provider-supplied and finite
- OI fields only when applicable, provider-supplied and finite
- buy/sell quantities only when provider-supplied and finite

### Time and provenance

- `exchangeTimestamp`: provider/exchange timestamp when present; never replaced by receipt time
- `receivedTimestamp`: local receipt timestamp
- `provider: "KITE"`
- `registryGenerationId`
- `subscriptionSetHash`
- `completeManifestHash` if available at this boundary
- `shardId`
- `validationStatus`
- `freshnessState`
- `conflictStatus`
- `lastValidTimestamp`

### Contract rules

1. Resolve identity exactly by provider token within the accepted generation and plan.
2. Never use symbol-only fallback.
3. Unknown, ambiguous, conflicted or generation-mismatched identity fails closed.
4. Missing optional provider fields remain absent/null according to the type; never become zero.
5. `exchangeTimestamp` and `receivedTimestamp` remain distinct.
6. A missing provider timestamp cannot be fabricated.
7. `lastValidTimestamp` must reflect the last accepted canonical value, not merely the latest received invalid tick.
8. `freshnessState` must come from the approved policy and evidence; tests may use an injected clock but production must not label test/fake ticks LIVE.
9. `conflictStatus` cannot default to “no conflict” if cross-provider conflict was not evaluated; use an honest explicit state such as `NOT_EVALUATED` where appropriate.
10. Storage key remains provider-token/canonical identity based, never bare symbol.
11. NSE and BSE same-symbol listings remain separate.
12. Index aliases resolve to one canonical record.

## C. SSE and consumer compatibility

The SSE snapshot and individual tick event must serialize the same canonical record and use the same `canonicalInstrumentId` key.

Required:

- snapshot then tick updates one entry;
- no NSE/BSE collapse;
- no index-alias duplication;
- no consumer may reinterpret receipt time as exchange time;
- no consumer may remove provenance and then label the value LIVE independently;
- existing consumers must either accept the new record or receive a clearly named compatibility projection that cannot grant freshness/trade authority.

Inventory every affected consumer. If a public/generated contract must change, stop and report before modifying generated files.

## D. Replace summary-Boolean activation trust with structured evidence

At the final boundary immediately before the first client factory call, the manager must validate a structured immutable activation decision.

Do not accept `gatesPass: true` as authority.

The decision must expose individual evidence for at least:

- registry restoration settled;
- registry authority CURRENT;
- supported registry schema and policy;
- accepted subscription manifest;
- registry generation id;
- subscription-set hash;
- complete-manifest hash;
- shard policy version;
- shard-plan admission/capacity;
- feed ownership structural singleton admitted from verified runtime attestation—not repository `vm` configuration alone;
- shutdown lifecycle installed;
- Kite session valid and not expired;
- token reconciliation clear;
- explicit owner activation authorization;
- compile-time runtime activation lock.

Required behaviour:

1. Recompute `allPassed` inside the manager from individual gate states.
2. Treat `NOT_EVALUATED`, missing, malformed, stale or contradictory evidence as refusal.
3. Revalidate generation and hashes against the plan consumed by the manager.
4. Reject a caller-supplied summary Boolean that disagrees with any component.
5. Return the first stable blocker plus the full safe blocker-code list for owner diagnostics.
6. Create zero clients until every component passes.
7. Perform this validation inside the existing operation mutex and immediately before client construction so evidence cannot be checked outside the serialized side-effect boundary.
8. Do not let repository `.replit = vm` satisfy runtime singleton ownership without verified platform/runtime attestation.

## E. Remove the ordinary production test-bypass option

The closure report states that `FeedManagerOptions` accepts `_forTesting_authorizeActivation: true`. Because this is an ordinary production constructor option, production code can technically bypass the compile-time lock.

Correct this boundary:

- remove `_forTesting_authorizeActivation` from ordinary production options;
- production `start()` must always enforce `FEED_RUNTIME_ACTIVATION_AUTHORIZED === false` in this phase;
- test the post-lock manager core through a clearly separated test-only harness/factory or internal seam;
- any `_forTesting_*` export must have zero production callers, asserted repo-wide;
- importing or constructing the production singleton must remain incapable of creating a client.

Do not turn the activation constant true.

## F. Reconfirm every safety lock accurately

The final report must inspect and state the exact values of the four frozen roadmap locks:

- `FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED`
- `SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED`
- `FNO_PAPER_V2_RUNTIME_AUTHORIZED`
- `SWING_PAPER_V2_RUNTIME_AUTHORIZED`

All must remain exactly `false as boolean`.

Also inventory and report any additional data/feed locks, including:

- `FEED_RUNTIME_ACTIVATION_AUTHORIZED`
- `LIVE_TICK_DATA_GATE_AUTHORIZED`
- `MARKET_DATA_WRITE_GATE_AUTHORIZED`
- `SIGNAL_GENERATION_GATE_AUTHORIZED`
- `PAPER_TRADING_GATE_AUTHORIZED`

Do not conflate the two sets, rename them, or treat verification of one set as verification of the other.

## G. Required targeted tests

Use production functions and fake provider clients only.

### Canonical record

1. accepted tick produces every mandatory identity/provenance field;
2. NSE/BSE same symbol produces separate canonical records;
3. index aliases produce one canonical record;
4. missing OHLC/volume/OI stays absent, never zero;
5. securityId/ISIN absent remains explicit null, never inferred;
6. exchange and receipt timestamps remain distinct;
7. missing exchange timestamp remains missing/null;
8. unknown token rejected;
9. generation/hash mismatch rejected;
10. invalid value rejected without updating `lastValidTimestamp`;
11. conflict not evaluated is represented honestly;
12. snapshot and tick serialize the same canonical fields/key;
13. compatibility projection cannot grant LIVE/trade-grade authority.

### Activation boundary

14. `gatesPass: true` with one failed component creates zero clients;
15. missing/NOT_EVALUATED component creates zero clients;
16. repository vm without runtime attestation creates zero clients;
17. generation mismatch creates zero clients;
18. subscription/complete hash mismatch creates zero clients;
19. shutdown not installed creates zero clients;
20. token reconciliation pending creates zero clients;
21. Kite session invalid/expired creates zero clients;
22. owner authorization false creates zero clients;
23. compile-time feed lock false creates zero clients;
24. validation happens inside mutex before factory construction;
25. structured all-pass test through the test-only core creates exactly the committed fake-client count without bypassing production `start()`.

### Safety and regression

26. `_forTesting_authorizeActivation` absent from production options;
27. test-only bypass/helper has zero production callers;
28. production singleton uses refusing factory and constructs zero clients;
29. all nine listed locks are present and false in their intended files;
30. no fourth-socket, unreleased-ledger, reconnect mutex and shutdown tests remain green;
31. corrected O8 ownership test remains green;
32. no provider/network/database/import-time side effect.

## H. Cost-controlled verification

Run only:

- new/changed canonical-record tests;
- new/changed activation-boundary tests;
- directly affected liveQuoteStore/SSE identity tests;
- the minimum no-fourth-socket/shutdown regression tests;
- corrected O8 ownership test;
- API-server and scanner TypeScript only if scanner types change;
- `git diff --check`;
- one independent review.

Do not rerun full package suites, production builds, workflows, servers, browser sessions, provider proofs or database evidence.

If review finds a real issue, fix it and rerun only affected tests.

## I. Required closure report

Report:

1. exact previous tick shape and final canonical record shape;
2. exact storage and SSE call path;
3. consumer inventory and compatibility impact;
4. structured activation-decision schema;
5. every activation gate and refusal code;
6. proof that summary Boolean cannot authorize;
7. proof validation occurs inside mutex before factory construction;
8. removal/isolation of the test activation bypass;
9. all five feed/data locks and all four frozen roadmap locks, separately;
10. preservation of socket ceiling, rollback, reconnect and shutdown invariants;
11. exact changed files and diffstat;
12. targeted test results, TypeScript and diff-check;
13. independent-review findings and corrections;
14. zero real provider/WebSocket/subscription/database/deployment evidence;
15. Git branch, HEAD, status and auto-commit disclosure;
16. remaining blockers: current registry authority, Reserved VM Publish, runtime attestation, Kite-session validation, explicit owner activation and live-market proof.

Do not checkpoint automatically. Stop with:

`PHASE_0_8B_CANONICAL_FEED_FOUNDATION_VERIFIED_IN_DEVELOPMENT — COMPLETE_CANONICAL_QUOTE_PROVENANCE_RETAINED — STRUCTURED_ACTIVATION_EVIDENCE_REVALIDATED_AT_SIDE_EFFECT_BOUNDARY — PRODUCTION_TEST_BYPASS_REMOVED — ALL_OWNER_AND_FEED_LOCKS_FALSE — NO_FOURTH_SOCKET_PATH_RETAINED — ZERO_REAL_PROVIDER_OR_SUBSCRIPTION_SIDE_EFFECTS — OWNER_CHECKPOINT_AUTHORIZATION_REQUIRED`

