# PHASE 0.8D — CONTROLLED AUTHORITY REFRESH AND KITE-SESSION VALIDATION ADAPTERS

Use Power mode. This is real implementation work, not a read-only audit.

## Objective

Build the two controlled operational adapters needed before live-feed proof:

1. a one-shot authoritative registry refresh orchestrator using the already accepted Phase 0.6/0.6A source, calendar, classification, reconciliation and persistence contracts;
2. a real Kite-session validation adapter that can populate the accepted Phase 0.8C in-memory evidence port.

Both adapters must be implemented and fully testable, but they must remain disabled and must not make real provider/exchange calls or database writes in this phase.

Do not publish the Reserved VM or activate the feed. Runtime singleton attestation remains a later owner-controlled phase.

## Accepted baseline

- Phase 0.8C checkpoint: `38090c7a0a11be4f31f8da29ff72be11886e4724`.
- Schema-5 registry authority, calendar commitment and storage gates accepted in development.
- Phase 0.8B canonical tick/three-shard feed foundation accepted but disabled.
- Phase 0.8C activation evidence boundary and Kite-session evidence port accepted.
- Five locks are false.

Do not rerun accepted batteries during preflight.

## Non-negotiable restrictions

Do not:

- download NSE/BSE files or call Kite/Upstox/IndianAPI/Yahoo;
- validate a real Kite session;
- read or write development/production databases;
- rebuild or persist a real registry generation;
- construct WebSockets or subscribe/unsubscribe;
- start an automatic refresh scheduler;
- expose an unauthenticated operational route;
- create a production route that directly accepts provider credentials or a fabricated validation result;
- turn any lock true;
- publish, deploy, purchase Reserved VM capacity, change billing/DNS/secrets/config/dependencies/schema, push or merge;
- change strategies, signals, scores, F&O/Swing runtime or website consumers.

Use fixtures/injected ports only in tests. Production adapters must default to disabled/refused.

## A. Preflight inventory

Inventory before editing:

1. all existing Phase 0.6 registry build/refresh scripts and modules;
2. official-source retrieval adapters and cached-source paths;
3. exchange-calendar/timing sources and current-year coverage;
4. manifest validation and `saveRegistryGeneration` transaction boundary;
5. BSE current-day authority rules and expiry;
6. current boot restoration and coverage bridge;
7. all Kite REST/session/profile/margins validation calls already present;
8. login/token refresh paths and credential ownership;
9. `acceptKiteSessionValidationRecord()` and all callers;
10. every scheduler/route/boot path that could invoke either operation.

For every existing component classify it as reusable, incomplete, unsafe, duplicated or unrelated. Reuse accepted logic; do not build a parallel registry or a second session store.

Stop if exact provider validation semantics cannot be established from the installed official Kite SDK/API contract. Do not infer a successful session from token presence.

## B. Provider-neutral operational ports

Define narrow injected ports separating orchestration from side effects.

### Registry refresh ports

- authoritative source fetch port;
- trusted current-time/IST clock;
- current exchange-calendar/timing source port;
- manifest builder/validator;
- transactional generation persistence port;
- post-write cold-load verifier;
- safe audit logger.

### Kite validation ports

- credential/session material reader owned by the existing secret boundary;
- one approved Kite REST validation operation;
- clock;
- Phase 0.8C evidence-port writer;
- safe audit logger.

No raw credential, access token, request token, cookie or provider response may cross into diagnostics or returned reports.

## C. One-shot registry refresh orchestrator

Implement one idempotent, manually invoked production service. It must not schedule itself.

Required order:

1. refuse unless an explicit compile-time refresh authorization remains separately controlled and false by default;
2. acquire an in-process single-flight guard so overlapping refreshes cannot run concurrently;
3. fetch every required official source exactly once through injected ports;
4. retain source identity, URL, retrieval timestamp, effective date and content hash;
5. validate source completeness/truncation/bot-block conditions before classification;
6. build the authoritative exchange calendar and resolve the latest completed session using sourced session timings;
7. apply the owner-approved BSE current-day/session authority policy;
8. build and reconcile the Schema-5 generation;
9. require zero unexplained remainder and all accepted hashes/equations;
10. refuse if authority is already expired at commit time;
11. persist only through the accepted transactional manifest store;
12. distinguish actual insert from duplicate no-op;
13. run retention only after a real insert;
14. cold-load and independently verify the committed generation;
15. update active authority/coverage only after cold-load verification succeeds;
16. return a safe structured operation result.

Fail closed without persistence on any download, parsing, timing, identity, reconciliation, checksum, capacity, authority or database failure.

No partial generation and no fallback to old cached bytes may be silently called CURRENT. Cached bytes may be used only when the operation explicitly selects an owner-approved cache mode and the result remains correctly labelled according to its authority.

## D. Registry refresh authorization boundary

Keep refresh authorization separate from feed activation and the four trading locks.

- New refresh authorization constant/default must remain false.
- No HTTP route may flip it.
- Production service must refuse before any source/network/database port is called when false.
- A test-only factory may override it only from a clearly test-only module with zero production callers.
- Owner diagnostics may report state/result metadata but cannot trigger refresh in this phase.

## E. Real Kite-session validation adapter

Using the installed official Kite SDK/API contract, implement an adapter that performs the cheapest authoritative authenticated REST operation capable of proving the current access token is accepted for the expected account.

Rules:

1. No provider call when the adapter authorization is false.
2. Missing credentials → `NOT_EVALUATED`/`CREDENTIALS_UNAVAILABLE`, never INVALID unless the provider actually rejects them.
3. A successful provider response is not accepted until response shape and expected account identity are validated.
4. Provider authentication rejection → `INVALID`.
5. Network/timeout/5xx/rate-limit → `PROVIDER_UNAVAILABLE`, not INVALID.
6. Locally expired evidence → `EXPIRED` without another provider call.
7. On success write exactly one safe record through `acceptKiteSessionValidationRecord()`.
8. Never store or return the token, key, secret or raw response.
9. Validation validity must have a sourced/approved boundary. Do not invent a long-lived duration. If the API supplies no expiry, use the narrowest existing owner-approved session boundary; otherwise stop and report the missing policy.
10. Concurrent validations use single-flight behavior and must not overwrite newer evidence with an older result.
11. Failed validation must not preserve an earlier VALID record as current unless the evidence remains independently valid and policy explicitly permits it; report the exact behavior.

The adapter exists but remains disabled in this phase. Tests use a fake injected provider port, never the real SDK network path.

## F. Safe owner diagnostics

Extend the existing owner-only readiness diagnostics with operation metadata only:

- registry refresh adapter: disabled/ready/running/last result, timestamps, generation id and safe blocker;
- Kite validator: disabled/ready/running/last state, validation timestamp/expiry and safe blocker;
- no source payloads, instrument lists, provider responses or credentials;
- anonymous 401, authenticated owner 200;
- diagnostics must never trigger either operation.

Do not add an execution endpoint in this phase.

## G. Failure recovery

Prove:

- registry refresh failure leaves the previously accepted generation untouched;
- duplicate generation does not run retention or falsely report committed;
- post-write cold-load failure does not promote the generation to active authority;
- Kite validation failure never produces VALID evidence;
- stale/expired session evidence cannot pass the final feed boundary;
- operation mutex/single-flight state is released on every success/failure/throw path;
- process restart honestly loses the in-memory Kite evidence and requires validation again;
- no automatic retry loop or scheduler exists.

## H. Tests

Add targeted production-function tests for at least:

### Registry

- authorization false → zero ports called;
- happy path ordering with fakes;
- one fetch per required source;
- source truncation/bot block;
- unknown/expired calendar;
- BSE reference not current;
- classification/reconciliation remainder;
- checksum/hash mismatch;
- duplicate no-op;
- insert then retention ordering;
- persistence failure;
- cold-load mismatch;
- no promotion on failure;
- overlapping invocation single-flight;
- safe diagnostic serialization.

### Kite validation

- authorization false → zero provider calls;
- missing credentials;
- success with matching account;
- success response with wrong account rejected;
- auth rejection vs network/timeout/rate-limit distinction;
- malformed response;
- approved validity boundary;
- exact expiry;
- concurrent calls single-flight;
- older result cannot replace newer evidence;
- no secret/raw response in outputs/logs;
- accepted record reaches Phase 0.8C judge;
- feed still refuses because other gates and feed lock remain closed.

### Guards

- no scheduler/timer/cron;
- no execution HTTP route;
- test override zero production callers;
- all five existing locks plus the new refresh/session-operation authorizations remain false;
- no provider/network/database side effects during tests.

## I. Verification economy

- Run new targeted tests first.
- Run TypeScript for api-server only.
- Run only directly impacted registry/session/activation tests once.
- No full suites, production build, real server boot, browser, provider call, source download or DB proof.
- One independent read-only diff review; correct genuine findings and rerun affected tests only.

## J. Required report

Return:

1. preflight reuse/gap inventory;
2. exact files changed;
3. registry refresh state machine and call ordering;
4. Kite validation method and response classification;
5. authorization boundaries and default values;
6. failure/rollback semantics;
7. owner diagnostic contract;
8. targeted tests/typecheck;
9. independent review findings;
10. all lock/authorization values;
11. Git/auto-commit state;
12. precise zero-side-effect statement;
13. remaining real-world proof actions.

Expected verdict:

`PHASE_0_8D_CONTROLLED_OPERATIONS_FOUNDATION_VERIFIED_IN_DEVELOPMENT — AUTHORITATIVE_REGISTRY_REFRESH_ORCHESTRATOR_IMPLEMENTED_DISABLED — KITE_SESSION_VALIDATION_ADAPTER_IMPLEMENTED_DISABLED — ZERO_REAL_PROVIDER_SOURCE_OR_DATABASE_CALLS — NO_SCHEDULER_OR_EXECUTION_ROUTE — ALL_EXISTING_AND_NEW_AUTHORIZATIONS_FALSE — FEED_REMAINS_DISABLED — OWNER_CHECKPOINT_AUTHORIZATION_REQUIRED`

Stop after reporting. Do not checkpoint unless separately authorized. Do not begin Reserved VM publication, run either operation, activate the feed or migrate website consumers.
