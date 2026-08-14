# PHASE 0.8B — REGRESSION AND CLOSURE CORRECTION

Use **Economy mode**. The core Phase 0.8B implementation is materially complete. This is a narrow correction and evidence-closure pass—not a new build.

## Current verdict

Do not checkpoint yet.

The reported Phase 0.8B regression set still has a known failing test:

`feedOwnershipAdmission.p08a.test.ts — O8`

The test expects the real workspace topology to be `autoscale`, while the accepted and committed Phase 0.8T configuration now declares `deploymentTarget = "vm"` in root `.replit`.

This test is directly related to feed ownership and Phase 0.8B activation safety. It cannot be dismissed as out of scope while reporting the affected regression set as accepted.

Required interim verdict:

`PHASE_0_8B_CHECKPOINT_BLOCKED — AFFECTED_OWNERSHIP_REGRESSION_TEST_FAILING — CLOSURE_REPORT_INCOMPLETE`

## Objective

1. Correct the stale O8 test without weakening the ownership contract.
2. Re-run only the minimum affected tests.
3. provide the complete Phase 0.8B closure report required by the original directive.
4. Keep the feed disabled and perform zero real provider/network/subscription activity.

## Non-negotiable scope

Permitted changes:

- `artifacts/api-server/src/lib/registry/feedOwnershipAdmission.p08a.test.ts`
- a directly related test fixture/helper only if necessary;
- Phase 0.8B report/memory files solely to record accepted evidence.

Do not modify `.replit`, deployment topology code, the accepted Phase 0.8B manager, provider adapter, canonical tick path, coverage ledger, shutdown implementation or activation locks unless the targeted verification exposes a genuine production defect. If that happens, stop and report before expanding scope.

Prohibited:

- no real Kite login, SDK client, WebSocket, subscription or provider request;
- no registry refresh or exchange download;
- no database query/write or schema change;
- no server/workflow restart, controlled boot, browser session, build, Publish or Reserved VM purchase;
- no dependency, lockfile, generated-client, F&O, Swing, candle, indicator, score, signal or order change;
- no commit, push, merge, reset, revert, rebase or checkpoint without separate authorization;
- all existing safety locks, including the new feed runtime activation lock, must remain false.

## A. Correct O8 properly

First inspect the exact purpose of O8 and the production function it exercises.

The correction must preserve these distinctions:

1. A fixture explicitly containing `deploymentTarget = "autoscale"` must classify as `MULTI_REPLICA_POSSIBLE` and refuse feed ownership.
2. A fixture explicitly containing `deploymentTarget = "vm"` may classify the **repository configuration** as Reserved VM prepared, but must not by itself grant runtime singleton ownership.
3. The real workspace `.replit` currently containing `vm` must not be expected to classify as `autoscale`.
4. Repository `vm` configuration alone must still leave ownership refused until verified runtime attestation exists.
5. Unknown, malformed or missing topology configuration must fail closed.

Preferred test design:

- Use explicit temporary fixture contents for deterministic `autoscale`, `vm`, missing and malformed cases.
- Keep a separate read-only assertion for the real workspace configuration if useful, expecting the actual committed value (`vm`) without granting runtime ownership.
- Do not hardcode an obsolete mutable workspace state into a general unit test.
- Do not weaken O8 to a type check, remove the assertion, skip it, mark it todo or add conditional pass logic.

## B. Verify Phase 0.8B state semantics

Perform a read-only review of the accepted implementation and report, without changing code unless a genuine blocker is found:

1. `FEED_RUNTIME_ACTIVATION_AUTHORIZED` remains compile-time false and has zero path to true.
2. Production boot constructs zero provider clients while the lock is false.
3. Real SDK dynamic import is reachable only after every activation gate and the compile-time lock.
4. `RUNNING` is a transport-manager state only. It must not imply:
   - provider-confirmed subscription;
   - complete coverage;
   - fresh quotes;
   - trade-grade readiness;
   - authority to signal or trade.
5. `REQUEST_ACCEPTED_UNCONFIRMED` is surfaced honestly and cannot become provider-confirmed through naming or aggregation.
6. Coverage status remains `NOT_OBSERVED`/non-live without accepted tick evidence.
7. A close failure leaves the socket represented in the unreleased ledger and counted against the three-client ceiling.
8. Manager diagnostics expose no tokens, identity lists, credentials or raw payloads.

If `RUNNING` currently leaks into any consumer as proof of complete/live/trade-grade data, stop with:

`PHASE_0_8B_BLOCKED — TRANSPORT_RUNNING_MISREPRESENTED_AS_DATA_READINESS`

Do not silently rename or rewrite the state machine in this narrow pass.

## C. Minimum verification only

Run only:

1. the corrected `feedOwnershipAdmission.p08a.test.ts` file;
2. the Phase 0.8B ownership/activation safety test file directly dependent on it;
3. the smallest Phase 0.8B diagnostics/coverage test subset needed to substantiate Section B;
4. API-server `tsc --noEmit` only if the test code changed TypeScript types;
5. `git diff --check`;
6. one independent review of the correction and final Phase 0.8B diff.

Do not rerun all 121 Phase 0.8B tests or the 191-test regression set unless a production-code change becomes necessary. Do not run full package suites or builds.

## D. Complete the required Phase 0.8B report

The previous summary omitted several mandatory closure details. Provide a complete but concise report containing:

### 1. Exact scope

- exact changed and new files for all Phase 0.8B work;
- diffstat;
- exact pre-existing paths reused;
- any auto-commit disclosure;
- branch, HEAD and Git status.

### 2. Feed architecture

- provider-neutral port and real adapter boundary;
- manager state machine;
- activation-gate composition and stable refusal codes;
- confirmation that all runtime counts/hashes are derived from the accepted manifest and that 7,876/[2626,2625,2625] were evidence, not hardcoded constants.

### 3. Socket and concurrency invariants

- maximum simultaneous held plus unreleased clients = 3;
- transactional startup rollback;
- reconnect mutex behaviour;
- close-old-before-replacement ordering;
- proof that no fourth client can be created;
- unreleased ledger and shutdown failure semantics.

### 4. Provider honesty

- connection handshake behaviour and timeout;
- subscription result `REQUEST_ACCEPTED_UNCONFIRMED`;
- why manager `RUNNING` does not mean confirmed subscription or LIVE data;
- zero real SDK construction/network calls in this phase.

### 5. Canonical tick path

- exact canonical fields stored;
- provider-token identity resolution;
- NSE/BSE same-symbol separation;
- index-alias handling;
- rejection codes for unknown/conflicted/generation-mismatched/invalid ticks;
- absent OHLC/volume remains absent, never neutral zero;
- SSE snapshot/tick canonical key consistency.

### 6. Coverage and freshness

- exact equations implemented, including:

  `expected = fresh + stale + missing`

  `aggregate expected = sum(per-shard expected)`

- conditions preventing `COMPLETE_LIVE`;
- shard-loss effects;
- pending token reconciliation effect;
- confirmation that development status is `DISABLED`/`NOT_OBSERVED`, not LIVE.

### 7. Shutdown and diagnostics

- real manager close hook integration;
- disabled close is idempotent and side-effect free;
- incomplete cleanup causes shutdown failure/non-zero outcome;
- owner-only diagnostic shape and sensitive-field exclusions.

### 8. Verification

- original Phase 0.8B tests: 121/121 accepted;
- original affected regression set results, clearly separating the previously failing O8;
- corrected O8 and minimal rerun results;
- TypeScript/diff-check results;
- independent-review findings and all corrections;
- explicit statement that the race test was falsified without the mutex and passed when restored.

### 9. Safety and remaining blockers

- `FEED_RUNTIME_ACTIVATION_AUTHORIZED` exact value;
- the four prior safety locks exact values;
- confirmation of zero deployment, provider, socket, subscription, database or registry side effects;
- remaining blockers:
  - current authoritative registry refresh;
  - actual Reserved VM Publish;
  - runtime singleton attestation;
  - Kite-session validation;
  - explicit owner feed-activation authorization;
  - live-market coverage/freshness evidence.

## E. Final verdict

If O8 and the minimum affected checks pass and no Section B blocker exists, stop with:

`PHASE_0_8B_DISABLED_FEED_FOUNDATION_VERIFIED_IN_DEVELOPMENT — AFFECTED_OWNERSHIP_REGRESSION_GREEN — THREE_SHARD_MANAGER_TRANSACTIONAL — NO_FOURTH_SOCKET_PATH — CANONICAL_TICK_AND_COVERAGE_CONTRACTS_FAIL_CLOSED — FEED_RUNTIME_ACTIVATION_LOCKED_FALSE — ZERO_REAL_PROVIDER_OR_SUBSCRIPTION_SIDE_EFFECTS — OWNER_CHECKPOINT_AUTHORIZATION_REQUIRED`

Do not checkpoint automatically.

