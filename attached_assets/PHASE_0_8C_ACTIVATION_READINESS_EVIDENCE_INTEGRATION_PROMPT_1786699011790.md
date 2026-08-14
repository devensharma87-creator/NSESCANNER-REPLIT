# PHASE 0.8C — REAL ACTIVATION-READINESS EVIDENCE INTEGRATION (FEED REMAINS DISABLED)

Use Power mode. Follow the roadmap exactly. This is the next critical implementation phase after the accepted Phase 0.8B checkpoint.

## Outcome

Replace placeholder/`NOT_EVALUATED` activation evidence with real, typed, fail-closed evidence wherever it can be proven in development—without activating Kite, opening WebSockets, subscribing, publishing, deploying or changing any safety lock.

At the end of this phase, the production feed must still refuse activation. The purpose is to make the refusal precise and reduce the remaining blockers to owner/platform actions and current external authority—not to bypass them.

## Accepted baseline — do not redo

Treat these checkpointed results as accepted unless current source contradicts them:

- Phase 0.8B commit: `420c5c431facf019e209f96bb08e24613b7a64fd`.
- Canonical tick provenance retained.
- Final side-effect boundary independently validates all 15 structured gates.
- Deterministic three-shard manager exists.
- Production test bypass removed.
- Feed remains disabled.
- Five locks are false.

Do not rerun the Phase 0.8B batteries during preflight.

## Non-negotiable restrictions

Do not:

- turn any safety or feed-activation lock true;
- construct `KiteTicker` or any WebSocket;
- call subscribe/unsubscribe;
- request a Kite login or refresh a Kite session;
- download exchange sources;
- refresh/rebuild/persist the registry;
- write to any database or alter schema;
- publish, deploy, purchase a Reserved VM, change billing/DNS/secrets, push or merge;
- start/restart/stop an existing workflow;
- modify trading thresholds, strategies, scores, signals, F&O/Swing runtime or website consumers;
- treat an environment variable, process lock, advisory lock or lease row as proof of structural singleton ownership.

If a requested proof requires a real deployment, provider call, current exchange download or database write, implement only the honest evidence boundary and return the corresponding blocker. Do not fabricate a successful proof.

## A. Preflight and exact inventory

Before editing, inventory the current source for:

1. all 15 activation gate identifiers and every producer/consumer;
2. `FEED_OWNERSHIP_SINGLETON_ATTESTED`;
3. `TOKEN_RECONCILIATION_CLEAR`;
4. `SHUTDOWN_LIFECYCLE_INSTALLED`;
5. registry-current/authority evidence;
6. Kite-session validity evidence;
7. owner activation authorization;
8. compile-time feed lock;
9. all calls to the final feed `start()` boundary;
10. owner-only data-health endpoints displaying readiness.

For each gate report its present source, current state, whether it is real or placeholder, freshness/expiry semantics and what could make it pass.

Stop and report if the accepted Phase 0.8B boundary has been weakened or if unrelated dirty runtime changes overlap this phase.

## B. One typed evidence envelope

Create or consolidate a provider-neutral activation evidence contract. Every gate evaluation must carry:

- `gateId`;
- `state: PASS | FAIL | NOT_EVALUATED`;
- stable `reasonCode`;
- `evaluatedAt`;
- `validUntil` or explicit `null` when no time-based authority can exist;
- `sourceKind`;
- `sourceIdentity`/generation identifier where applicable;
- `detailsSafeForOwnerDiagnostics` containing no credentials, tokens, raw payloads or environment values.

Rules:

1. Missing, malformed, expired or contradictory evidence is not PASS.
2. A previously passing time-bound gate becomes FAIL after `validUntil`.
3. No gate consumer may reinterpret `NOT_EVALUATED` as PASS.
4. Final activation must evaluate the evidence at the actual boundary time, not trust a cached aggregate Boolean.
5. Evidence from different registry generations or manifest hashes must not be combined.

Do not introduce new arbitrary freshness thresholds. Use existing owner-approved policies; otherwise fail closed with a stable blocker.

## C. Shutdown lifecycle gate — real implementation

Wire `SHUTDOWN_LIFECYCLE_INSTALLED` to the real atomic lifecycle installation state from Phase 0.8T.

Acceptance:

- PASS only when the atomic shutdown lifecycle is installed in the current process;
- FAIL before installation;
- FAIL while shutdown is in progress or complete;
- no test reset helper has a production caller;
- no duplicate signal listener can create a false PASS;
- the final feed boundary rechecks this live state immediately before client construction.

Do not merely serialize a Boolean captured at app construction.

## D. Token reconciliation gate — real implementation

Wire `TOKEN_RECONCILIATION_CLEAR` to the real pending-reconciliation state.

Acceptance:

- PASS only when pending reconciliation count is exactly zero and the evidence belongs to the same registry generation/provider-token mapping as the shard plan;
- FAIL with `TOKEN_RECONCILIATION_PENDING` when one or more items exist;
- FAIL when reconciliation state is unavailable, malformed or belongs to another generation;
- an identity pending reconciliation cannot be labelled current/live or admitted to activation;
- no scheduler or automatic queue drain is added in this phase;
- public diagnostics expose only safe state/count; owner diagnostics may retain safe item metadata already approved, never credentials or raw provider payloads.

## E. Runtime singleton gate — honest attestation boundary

Do not mark singleton ownership PASS in development.

Build the complete evidence verifier required for a future Reserved VM proof:

- accept only explicitly allowlisted platform-provided attestation fields established from an observed Reserved VM deployment;
- reject user-controlled/custom environment names;
- require production environment, deployment target identity and single-process evidence;
- distinguish repository configuration (`deploymentTarget = "vm"`) from observed runtime topology;
- reject Autoscale, unknown topology, scale-to-zero, multiple replicas, conflicting deployment ids and absent attestation;
- record `RUNTIME_SINGLETON_EVIDENCE_NOT_YET_OBSERVED` until a real deployment is published and inspected;
- never use a DB lock, lease or leader election as provider socket-budget proof.

If no real platform attestation key is currently proven, keep the allowlist empty and the gate FAIL/NOT_EVALUATED. Do not guess field names.

## F. Registry-current authority gate

Connect the activation gate to the accepted Schema-5 restoration/current-authority result.

Acceptance:

- PASS only for an integrity-verified, accepted generation whose authority is current at evaluation time;
- `RESTORED_LAST_KNOWN` is never PASS;
- expired BSE reference authority fails at its approved expiry boundary;
- calendar coverage and current-year checks remain enforced;
- generation id, eligible-live-set hash, subscription-set hash and complete-manifest hash must agree with the plan being activated;
- DB outage, restoration unsettled, incompatible schema/policy or checksum failure all fail closed;
- no disk fallback may mask a database outage.

Do not refresh the expired generation in this phase. Report `REGISTRY_AUTHORITY_NOT_CURRENT` if that is the real state.

## G. Kite-session gate — validator only, zero provider calls

Implement the production boundary for Kite-session evidence, but do not contact Kite.

The evidence contract must distinguish:

- `VALID`;
- `INVALID`;
- `EXPIRED`;
- `NOT_EVALUATED`;
- `PROVIDER_UNAVAILABLE`.

PASS requires evidence from the approved Kite-session validation path with a provider timestamp/validation timestamp and an explicit validity boundary. The mere presence of credentials, an access-token string or an earlier successful login is not proof.

In this phase the real state should remain `KITE_SESSION_NOT_EVALUATED` unless a previously accepted, still-current provider validation record already exists and can be proven without a provider call. Never invent one.

Credentials and token values must never enter logs or diagnostics.

## H. Owner authorization and compile-time lock

Keep both separate:

- owner runtime authorization evidence;
- `FEED_RUNTIME_ACTIVATION_AUTHORIZED` compile-time lock.

Neither can imply the other. Both must independently PASS before activation. Both remain refusing in this phase.

No route may mutate either authorization. Diagnostics are read-only.

## I. Unified owner-only readiness endpoint

Extend or consolidate the existing owner-only diagnostic route so it reports:

- every activation gate;
- state and stable blocker code;
- evaluation/expiry timestamps;
- safe source identity;
- cross-generation/hash consistency;
- overall readiness `REFUSED`;
- exact set of blocking gates;
- feed manager state;
- socket count/ledger count (expected zero in this phase);
- five lock values, without providing any mutation capability.

Requirements:

- `requireOwnerStrict`;
- anonymous request → 401;
- no provider tokens, credentials, raw environment values, instrument payloads or full identity lists;
- no diagnostic request may initialize providers, schedulers, WebSockets or subscriptions;
- no public API contract change unless a verified consumer requires it.

## J. Final boundary integration

The production `start()` path must obtain/re-evaluate the real evidence immediately before any side effect. Verify ordering:

1. compile-time lock;
2. owner authorization;
3. registry/manifest/generation/hash consistency;
4. current authority;
5. runtime singleton attestation;
6. shutdown readiness;
7. token reconciliation clearance;
8. Kite-session validity;
9. deterministic shard/capacity re-proof;
10. only then client factory/SDK/WebSocket/subscription.

The exact order may preserve an even stricter existing boundary, but no side effect may precede all required checks.

In this phase, tests must prove the client factory call count remains zero for every real development evidence combination.

## K. Targeted tests

Add the minimum tests needed to prove production functions, including:

1. each gate passes and fails independently;
2. missing/expired/contradictory evidence fails;
3. shutdown lifecycle before install, installed and shutting down;
4. pending reconciliation count 0 vs 1 and foreign generation;
5. runtime VM config without observed attestation fails;
6. spoofed/custom environment evidence fails;
7. last-known registry fails;
8. current registry with mismatched plan hash fails;
9. Kite credentials without provider validation fail;
10. expired Kite validation fails;
11. owner authorization and compile-time lock are independent;
12. all non-lock evidence PASS still refuses because the feed lock is false;
13. final client factory remains uncalled;
14. diagnostics anonymous 401 and owner 200 using isolated route proof only;
15. diagnostic payload contains no secrets/tokens/instrument lists;
16. no provider imports/calls, sockets, subscriptions, DB writes, schedulers or automatic reconciliation drains are introduced;
17. five locks remain false.

Use test-only factories only through clearly test-only modules with zero production callers.

## L. Verification economy

- Run new/changed targeted tests first.
- Run TypeScript only for affected packages.
- Run directly impacted existing lifecycle/reconciliation/registry/feed tests once.
- Do not run full repository suites, production builds, real boots, browser sessions, provider sweeps or database proofs.
- One independent read-only diff review after targeted checks pass; fix genuine findings and rerun only affected tests.

## M. Required report

Report:

1. preflight inventory of all 15 gates;
2. exact files changed;
3. typed evidence-envelope contract;
4. gate-by-gate source, state, expiry and blocker;
5. final activation-boundary ordering;
6. current real readiness verdict;
7. diagnostics contract and authentication proof;
8. targeted tests/typecheck results;
9. independent review findings and fixes;
10. five lock values;
11. Git/auto-commit state;
12. precise zero-side-effect statement;
13. remaining owner/platform/external-authority actions.

Expected development result:

`PHASE_0_8C_ACTIVATION_READINESS_EVIDENCE_VERIFIED_IN_DEVELOPMENT — SHUTDOWN_AND_RECONCILIATION_GATES_WIRED_TO_REAL_STATE — REGISTRY_AUTHORITY_AND_KITE_SESSION_FAIL_CLOSED — RUNTIME_SINGLETON_ATTESTATION_PENDING_REAL_RESERVED_VM — ALL_FIVE_LOCKS_FALSE — CLIENT_FACTORY_NEVER_CALLED — ZERO_PROVIDER_SUBSCRIPTION_DATABASE_OR_DEPLOYMENT_SIDE_EFFECTS — OWNER_CHECKPOINT_AUTHORIZATION_REQUIRED`

Stop after the report. Do not checkpoint unless separately authorized. Do not start Phase 0.8D, activate the feed, refresh the registry, publish or migrate website consumers.
