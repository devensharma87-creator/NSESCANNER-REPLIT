# DATA FOUNDATION PHASE 0.8B — DISABLED THREE-SHARD KITE FEED FOUNDATION

Use **Power mode** for implementation. This is a bounded production-code build, but the feed must remain disabled and no real provider connection may occur.

## Objective

Build the production three-shard Kite WebSocket feed foundation that will eventually provide full authorized NSE/BSE/index live coverage from the accepted Phase 0.8A subscription manifest.

This phase implements and tests the machinery behind closed activation gates. It does **not** activate Kite, open a WebSocket, subscribe to an instrument, publish the Reserved VM, refresh the registry, or label any quote LIVE.

The purpose is to avoid paying for a Reserved VM before the feed implementation is ready.

## Accepted prerequisites—do not reopen

- Phase 0.8A authoritative manifest planning:
  - registry records: 9,702 in the accepted development evidence;
  - LIVE_REQUIRED: 7,880;
  - LIVE_MAPPED: 7,876;
  - LIVE_UNMAPPED: 4;
  - Kite capacity: 9,000;
  - accepted balanced shard counts: `[2626, 2625, 2625]` for that generation;
  - classification remainder: 0;
  - shard policy version: 2;
  - indices prioritized into shard 0.
- These figures are evidence from one generation, **not runtime constants**. Production code must derive all counts and hashes from the currently accepted manifest.
- Phase 0.8T:
  - root `.replit` is committed with `deploymentTarget = "vm"`;
  - it remains undeployed;
  - runtime singleton ownership is not attested;
  - atomic shutdown lifecycle is checkpointed;
  - feed remains disabled.
- Canonical runtime identity is exchange-qualified and provider-token keyed; symbol-only storage is prohibited.
- The authoritative registry and current-time authority checks remain unchanged.

## Hard stop conditions

Stop rather than implementing a workaround if:

- the existing canonical quote store cannot preserve exchange-qualified identity;
- the feed manager would require more than three Kite sockets;
- any admitted token appears in more than one shard;
- an unmapped identity would be silently dropped or symbol-matched;
- the activation contract can be bypassed;
- shutdown cannot close all owned clients within the accepted bound;
- the implementation would create a provider call during import, boot, tests or development;
- a new recurring cost, dependency, schema or deployment resource is required.

## Non-negotiable safety restrictions

- No real Kite login or session validation.
- No `KiteTicker` construction against the real SDK during this phase.
- No WebSocket, subscribe, unsubscribe or provider-network call.
- No registry refresh or exchange download.
- No database read/write or schema/migration change.
- No deployment, Publish, Reserved VM purchase, billing, DNS or secret change.
- No scheduler or import-time timer.
- No feed activation, even in development.
- No F&O/Swing strategy, signal, order, paper-trade, candle, indicator, score or confidence change.
- No generated-client/public-contract change unless a proven consumer requires it; stop and report first.
- All four safety locks remain exactly `false as boolean`.
- Do not commit, push, merge or deploy without separate authorization.

## A. Inventory before implementation

Inspect and report the exact current production paths for:

1. `KiteTicker` construction;
2. subscription/unsubscription calls;
3. token-to-canonical-identity resolution;
4. `liveQuoteStore` writes and reads;
5. SSE tick/snapshot publication;
6. market-data health and aggregate coverage;
7. shutdown `closeFeed` hook;
8. Phase 0.8A manifest, shard plan and activation gates;
9. existing reconnect/watchdog behaviour;
10. every production consumer of live quotes.

Reuse and adapt the existing implementation. Do not create a second parallel live-quote pipeline.

## B. Provider-neutral feed client port

Create a narrow injectable interface around the provider WebSocket client. The production adapter may wrap Kite later, but tests must use fakes.

The interface must support only the required lifecycle:

- connect/open;
- connection-ready event;
- ticks event;
- error/close/reconnect events;
- subscribe exact token set;
- set required quote mode;
- unsubscribe exact token set;
- disconnect/close;
- observable connection identity and shard id.

No credential, access token or raw provider object may appear in diagnostics or canonical quote records.

The real SDK adapter must not be constructed merely by importing the module. Construction is allowed only inside the gated activation path in a later authorized phase.

## C. Three-shard feed manager

Implement one owner-scoped feed manager consuming the accepted Phase 0.8A `FeedShardPlan`.

Required states:

`DISABLED → WAITING_FOR_GATES → STARTING → RUNNING | DEGRADED → STOPPING → STOPPED | FAILED`

Required invariants:

1. Feed begins in `DISABLED`.
2. Activation requires one immutable, accepted activation decision containing:
   - current authoritative registry generation;
   - matching subscription-set hash;
   - matching complete-manifest hash;
   - shard policy version 2;
   - capacity-valid plan;
   - structural singleton ownership admitted;
   - shutdown lifecycle installed;
   - valid Kite session;
   - explicit owner activation authorization.
3. Any failed or unevaluated gate returns a stable refusal code and creates zero clients.
4. Maximum clients ever owned simultaneously: 3.
5. Exactly one client per non-empty shard.
6. Every admitted provider token appears in exactly one shard.
7. Tokens are subscribed exactly as committed by the plan—no truncation, symbol fallback or ad-hoc additions.
8. Shard 0 retains the committed index-first placement.
9. The manager records the generation id and hashes it activated against; plan drift after activation forces stop/refusal, not silent mutation.
10. A second activation call is idempotently refused or returns the existing state; it cannot create another client set.

## D. Transactional startup and rollback

Startup must be fail-closed and rollback-safe:

1. Revalidate every activation gate at the activation boundary.
2. Validate the complete shard plan before creating the first client.
3. Create/connect clients through the injected factory only.
4. Subscribe only that client's committed shard tokens.
5. Set the provider mode required for accurate LTP/OHLC/volume fields.
6. Mark a shard ready only after connection and subscription acknowledgement/evidence available from the client contract.
7. Mark the manager `RUNNING` only when every required shard is ready.
8. If any shard fails during startup:
   - stop further creation;
   - unsubscribe/close every client already opened;
   - clear owned-client state;
   - leave no listener, timer or token ownership behind;
   - report `FAILED` with a safe blocker code;
   - never publish partial coverage as complete or LIVE.

## E. Reconnect and shard-loss policy

Do not redistribute a lost shard onto surviving clients: approximately 7,876 tokens use all three sockets, and redistribution could exceed the 3,000-token per-socket ceiling.

Required behaviour:

- lost shard → manager `DEGRADED`;
- every identity on that shard becomes `LAST_KNOWN`, `STALE` or `UNAVAILABLE` according to the existing owner-approved freshness policy—never LIVE merely because an old tick exists;
- surviving shards may remain current only for their own proven-fresh identities;
- fully close the old shard client before constructing its replacement;
- reconnect only the same committed shard membership;
- never transiently own a fourth client;
- bounded backoff may be represented as an injected scheduler/clock in tests, but no runtime scheduler should start in this phase;
- plan, generation or authority drift during reconnect forces refusal and manager stop.

## F. Canonical tick ingestion

Route every accepted tick through the existing canonical identity and quote-store path.

Required tick contract:

- canonical instrument id;
- exchange;
- segment;
- trading symbol;
- provider instrument token;
- provider exchange token where available;
- value/LTP;
- OHLC fields only when provider-supplied and finite;
- volume only when provider-supplied and finite;
- provider/exchange timestamp when present;
- local received timestamp;
- provider id = Kite;
- registry generation id;
- subscription-manifest hash;
- shard id;
- validation status;
- freshness state;
- last valid timestamp;
- conflict status.

Rules:

1. Resolve by provider token to one canonical exchange-qualified identity.
2. Unknown, ambiguous, token-conflicted or generation-mismatched ticks are rejected and counted—never symbol-matched.
3. No field may be invented, estimated, set to a neutral zero or copied from another provider.
4. Invalid numeric values, impossible timestamps and identity mismatches fail closed.
5. Store remains keyed by provider token/canonical id, never bare symbol.
6. SSE snapshot and tick events use the same canonical key and must not collapse NSE/BSE listings or duplicate index aliases.
7. This phase must not label fake test ticks as production data outside tests.

## G. Coverage and freshness ledger

Implement a per-shard and aggregate evidence ledger derived from the committed manifest:

- expected token count;
- client constructed;
- connected;
- subscribed token count;
- acknowledged/owned token count where provider contract supports it;
- tokens with at least one accepted tick;
- fresh token count;
- stale token count;
- missing token count;
- rejected tick count by safe reason;
- last tick received time;
- shard state;
- generation id and hashes.

Aggregate completeness must satisfy exact equations. At minimum:

`expected = fresh + stale + missing`

and

`expected = sum(expected per shard)`

No aggregate state may be `COMPLETE_LIVE` unless:

- all activation gates remain valid;
- all shards are ready;
- every expected identity has a valid, field-appropriate fresh tick;
- no pending token reconciliation exists;
- no unresolved identity/provider conflict exists.

Since this phase performs no real subscription, development evidence must remain `DISABLED`/`NOT_OBSERVED`, never LIVE.

## H. Shutdown integration

Replace the Phase 0.8T no-op feed-close hook only with a real manager close function that is still inert while the manager is disabled.

Required close behaviour:

1. transition once to `STOPPING`;
2. refuse new activation/reconnect work;
3. for each owned shard, unsubscribe its exact tokens when safe and close the client;
4. bound each client and whole-manager close;
5. report per-shard close success/failure without credentials or tokens;
6. clear listeners and injected timers;
7. finish `STOPPED` only if ownership is released;
8. return failure honestly so Phase 0.8T shutdown exits non-zero when cleanup is incomplete.

Calling close while `DISABLED` or already `STOPPED` must be safe, idempotent and side-effect free.

## I. Diagnostics

Extend an existing owner-only diagnostic surface rather than creating a public data route.

Safe metadata only:

- manager state;
- activation blocker;
- expected shard count;
- per-shard state and counts;
- aggregate expected/fresh/stale/missing counts;
- registry generation id;
- truncated hashes if existing policy permits;
- last transition timestamps;
- close/reconnect state;
- feed remains disabled flag.

Never expose:

- provider tokens;
- canonical identity lists;
- credentials/access tokens;
- raw errors;
- instrument payloads;
- tick payloads.

Owner authentication must remain strict. No generated public client change unless already required by an existing owner-only contract.

## J. Required targeted tests

Use fake clients, injected clocks/schedulers and real production functions. Cover at least:

### Activation and capacity

1. any one failed gate → zero clients;
2. shutdown not installed → zero clients;
3. topology not admitted → zero clients;
4. registry last-known/stale → zero clients;
5. Kite session invalid/not evaluated → zero clients;
6. owner authorization false → zero clients;
7. over-capacity or malformed plan → zero clients;
8. valid three-shard plan → exactly three fake clients;
9. no token duplicated or omitted;
10. second activation creates zero additional clients.

### Startup rollback

11. shard 1 failure rolls back shard 0;
12. shard 2 failure rolls back shards 0 and 1;
13. subscription failure leaves zero owned clients;
14. mode-setting failure leaves zero owned clients;
15. rollback failure is reported honestly;
16. manager never reports RUNNING with partial readiness.

### Reconnect

17. shard loss produces DEGRADED, not complete/live;
18. lost-shard tokens become non-live;
19. surviving shard tokens do not inherit lost-shard coverage;
20. old client closes before replacement construction;
21. maximum simultaneous clients remains three;
22. same exact shard membership is reused;
23. manifest/authority drift blocks reconnect.

### Tick identity and integrity

24. NSE and BSE same symbol remain separate;
25. index aliases store one canonical quote;
26. unknown token rejected;
27. ambiguous/conflicted identity rejected;
28. generation mismatch rejected;
29. NaN/infinite/invalid price rejected;
30. absent OHLC/volume remains absent, not zero;
31. provider timestamp and receipt timestamp remain distinct;
32. snapshot then tick uses one canonical client key.

### Coverage and freshness

33. coverage equations balance;
34. one missing identity prevents COMPLETE_LIVE;
35. one stale identity prevents COMPLETE_LIVE;
36. pending reconciliation prevents COMPLETE_LIVE;
37. shard loss updates aggregate counts exactly;
38. no tick evidence means NOT_OBSERVED, not LIVE.

### Shutdown and diagnostics

39. close while disabled has zero side effects;
40. close is idempotent;
41. close order and per-shard cleanup are bounded;
42. incomplete close returns failure;
43. owner endpoint rejects anonymous access;
44. diagnostics expose no token, identity list, credential or raw payload;
45. no import-time client, socket, timer or provider call;
46. all four safety locks remain false.

## K. Cost-controlled verification

Run only:

1. new Phase 0.8B targeted tests;
2. directly affected canonical identity/store/SSE/shutdown tests;
3. API-server TypeScript `--noEmit`;
4. `git diff --check`;
5. one independent diff review.

Do not run full suites, production builds, workflows, server restarts, controlled boots, browser sessions, provider calls or database evidence.

If independent review finds a genuine issue, correct it and rerun only affected targeted checks.

## L. Required report

Report:

1. inventory of pre-existing paths and what was reused;
2. exact changed files;
3. feed manager state machine;
4. activation gate composition and stable refusal codes;
5. shard/client count invariants;
6. transactional startup and rollback behaviour;
7. reconnect policy and proof of no fourth socket;
8. canonical tick validation/storage path;
9. coverage/freshness equations;
10. shutdown integration;
11. owner-only diagnostic contract;
12. targeted tests, TypeScript and diff-check results;
13. independent-review findings/corrections;
14. explicit zero-provider/zero-WebSocket/zero-subscription evidence;
15. Git status, branch, HEAD and any auto-commit disclosure;
16. all four safety-lock values;
17. remaining blockers before live activation:
    - current authoritative registry refresh;
    - actual Reserved VM Publish;
    - runtime singleton attestation;
    - Kite-session validation;
    - explicit owner activation authorization;
    - live-market coverage/freshness evidence.

Do not checkpoint automatically. Stop with:

`PHASE_0_8B_DISABLED_FEED_FOUNDATION_VERIFIED_IN_DEVELOPMENT — THREE_SHARD_MANAGER_TRANSACTIONAL — CANONICAL_TICK_PATH_ENFORCED — COVERAGE_AND_FRESHNESS_FAIL_CLOSED — SHUTDOWN_INTEGRATED — ZERO_REAL_PROVIDER_OR_SUBSCRIPTION_SIDE_EFFECTS — OWNER_CHECKPOINT_AUTHORIZATION_REQUIRED`

