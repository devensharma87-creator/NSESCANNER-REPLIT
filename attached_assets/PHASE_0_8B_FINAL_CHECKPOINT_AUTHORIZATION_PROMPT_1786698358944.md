# PHASE 0.8B — FINAL CORRECTION CHECKPOINT AND EVIDENCE CLOSURE

Use Power mode. This is a bounded checkpoint/evidence task, not a new implementation phase.

## Objective

Verify and checkpoint the completed Phase 0.8B canonical-record and activation-boundary correction without repeating expensive work or activating the feed.

The reported accepted development evidence is:

- Phase 0.8B tests: 160/160 passing across 9 files.
- Phase 0.5A regression tests: 62/62 passing across 4 files.
- `b2.uiState` and `aggregateCoverage`: 104/104 passing.
- TypeScript clean across all four packages.
- Canonical record tests G1–G13 passing.
- Activation-boundary tests G14–G32 passing.
- All five safety/activation locks remain false.

Do not redo these runs unless inspection proves that production source changed after they were captured.

## A. Preflight and stop conditions

1. Inspect current branch, HEAD, status, staged files and any platform auto-commits created since the report.
2. If an auto-commit exists, inspect its exact file list and diff before proceeding.
3. Retain it only if every runtime/test/documentation change belongs to Phase 0.8B and inert memory/directive files. Stop and report if it contains unrelated runtime, schema, dependency, deployment, generated or configuration changes.
4. Do not reset, revert, amend, squash, rebase or rewrite history.
5. Do not deploy, publish, push, merge, refresh the registry, access production, start/restart a workflow, open a provider session, construct a WebSocket, subscribe/unsubscribe, or write to any database.

## B. Exact correction-scope inventory

Inventory every file changed by the correction and classify it as:

- canonical record/runtime contract;
- feed activation boundary;
- Kite adapter compatibility;
- production factory;
- test-only factory/seam;
- tests;
- inert memory/directive;
- unrelated.

The inventory must include, where applicable:

- `feedManager.ts`;
- `productionFeedManager.ts`;
- canonical tick/store types and their writer/emission path;
- `kiteFeedClientAdapter.ts`;
- `kiteFeed.ts`;
- the Phase 0.8B fixture/factory files;
- all modified `p08b.*` tests;
- all modified `p05a.*` tests;
- both new tests: `p08b.canonicalRecord.test.ts` and `p08b.activationBoundary.test.ts`.

Report exact paths from Git. Do not rely on the earlier narrative.

## C. Canonical record acceptance verification

Read production code and prove that every accepted live tick stored or emitted by the Phase 0.8B path contains the canonical acceptance-contract fields, without invention or consumer reinterpretation:

- `canonicalInstrumentId`;
- `exchange`;
- `segment`;
- `tradingSymbol`;
- provider instrument token and provider exchange token where available;
- `securityId` and `isin` as sourced values or explicit `null`—never fabricated;
- value fields actually supplied by the provider (price/OHLC/volume/OI only when present);
- exchange timestamp as provider supplied or `null`, never replaced with receipt time;
- received timestamp;
- provider;
- freshness state;
- validation status;
- registry generation id;
- subscription-set/complete-manifest identity needed to bind the tick to the admitted generation;
- shard identity;
- conflict status;
- last-valid timestamp.

Verify these invariants:

1. Missing provider fields remain unavailable/null and do not become zeros.
2. `exchangeTimestamp` and `receivedTimestamp` are distinct concepts.
3. Receipt time never masquerades as exchange time.
4. An invalid/unmapped/conflicted tick is rejected before canonical storage and website emission.
5. `lastValidTimestamp` advances only on a newly accepted valid value.
6. No symbol-only key can collapse NSE and BSE listings.
7. No downstream SSE/snapshot path strips the canonical identity or provenance required by the contract.

If the implementation does not actually satisfy any item, stop and report the exact gap. Do not weaken the contract or test.

## D. Final activation-boundary verification

Prove from production code that the final side-effect boundary does not trust a caller-supplied `gatesPass` summary Boolean.

Immediately before any client construction, SDK import, WebSocket connection or subscription request, the production path must independently require every applicable structured gate to be `PASS`, including at least:

- current authoritative registry;
- accepted manifest and checksum/hash bindings;
- exact generation identity;
- deterministic admitted subscription manifest;
- capacity within 9,000 and no truncation;
- structural singleton ownership/runtime attestation;
- shutdown lifecycle installed;
- valid Kite session;
- owner activation authorization;
- production feed runtime compile-time authorization;
- no proof/offline mode conflict;
- no unresolved reconciliation/conflict blocker.

`FAIL`, `NOT_EVALUATED`, missing, malformed or contradictory evidence must all refuse activation.

Cross-check the decision's generation id, subscription-set hash, complete-manifest hash and shard-policy/hash against the objects actually passed to the feed manager. A self-consistent but foreign decision must fail closed.

## E. Remove production bypasses

Confirm that `_forTesting_authorizeActivation` or any equivalent bypass is absent from ordinary production options and production constructors.

The test-only factory may exist only if:

- its name is unmistakably test-only;
- it is outside the production activation path;
- it has zero production callers;
- production code cannot reach it through environment variables, request data or configuration;
- it cannot weaken the production factory's compile-time refusal.

Search all tracked runtime source, not just the two edited modules.

## F. Lock inventory — do not conflate the two sets

Report both groups separately and verify every value directly from source.

Roadmap frozen owner locks:

1. `FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED = false as boolean`
2. `SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED = false as boolean`
3. `FNO_PAPER_V2_RUNTIME_AUTHORIZED = false as boolean`
4. `SWING_PAPER_V2_RUNTIME_AUTHORIZED = false as boolean`

Phase 0.8B feed activation lock:

5. `FEED_RUNTIME_ACTIVATION_AUTHORIZED = false as boolean`

If other data gates exist, list them separately; do not substitute them for these five. No lock may be changed in this checkpoint.

## G. Side-effect and compatibility evidence

Using source/Git evidence only unless a source change forces a targeted rerun, prove:

- zero provider calls;
- zero Kite login/session attempt;
- zero SDK construction outside the guarded dynamic import;
- zero WebSocket connections;
- zero subscribe/unsubscribe operations;
- zero schedulers/timers started;
- zero database reads or writes in this checkpoint;
- zero registry refresh/rebuild;
- zero deployment, publish, billing, DNS or secret change;
- normal production factory remains refusing while the feed lock is false;
- old adapter callers remain source-compatible only where compatibility is intentional and safe.

Do not claim that source scanning proves a runtime event did not occur outside this task. Phrase evidence precisely.

## H. Verification economy

Do not repeat the already accepted test batteries or TypeScript runs if the relevant production tree is byte-identical to the tested state.

If source changed after the evidence:

1. run only the directly affected tests first;
2. run TypeScript only for the affected package;
3. do not run full suites, builds, server boots, browsers or provider proofs;
4. stop on the first material failure and report it.

Run `git diff --check` once before checkpointing if there is an uncommitted diff.

## I. Checkpoint authorization

If—and only if—Sections A–H pass:

1. Create or retain one development checkpoint containing only the accepted Phase 0.8B correction, tests and directly related inert documentation/memory.
2. Exclude uploaded owner directives unless the platform already swept them into an otherwise acceptable auto-commit; disclose them as inert.
3. Do not push, merge or deploy.
4. If the platform already created a correct checkpoint, do not create a redundant commit.
5. Report final SHA, author, exact committed file list, diffstat, branch, HEAD, Git status, excluded files and any auto-commit mechanism.

## J. Required final report

Return, in this order:

1. verdict;
2. exact changed-file inventory;
3. canonical-record field matrix and source for each field;
4. missing-field/fail-closed behavior;
5. final activation-gate matrix and boundary ordering;
6. proof that summary Boolean trust was removed;
7. production/test-factory separation and zero production callers;
8. both lock groups with all five exact values;
9. accepted test/typecheck evidence and whether anything was rerun;
10. side-effect statement with precise evidence basis;
11. independent read-only diff review findings and corrections, if any;
12. Git/checkpoint details;
13. remaining blockers before real activation.

Required successful verdict:

`PHASE_0_8B_CANONICAL_RECORD_AND_ACTIVATION_BOUNDARY_CHECKPOINT_COMPLETE — FULL_CANONICAL_TICK_PROVENANCE_RETAINED — FINAL_SIDE_EFFECT_BOUNDARY_REVALIDATES_ALL_STRUCTURED_GATES — ZERO_PRODUCTION_TEST_BYPASS — ALL_FIVE_LOCKS_FALSE — FEED_REMAINS_DISABLED — ZERO_PROVIDER_SUBSCRIPTION_OR_DEPLOYMENT_SIDE_EFFECTS — OWNER_NEXT_PHASE_AUTHORIZATION_REQUIRED`

If any required invariant is not proven, do not checkpoint. Return:

`PHASE_0_8B_BLOCKED — <EXACT_BLOCKER_CODE>`

Stop after the report. Do not begin Phase 0.8C, activate the feed, refresh authority, publish the Reserved VM or migrate website consumers.
