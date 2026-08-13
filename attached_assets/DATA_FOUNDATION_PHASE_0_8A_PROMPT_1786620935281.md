# DATA FOUNDATION — PHASE 0.8A
## AUTHORITATIVE SUBSCRIPTION MANIFEST AND SINGLETON FEED-OWNERSHIP ADMISSION

### PRIMARY OBJECTIVE

Build the deterministic, fail-closed admission layer required before opening the three Kite WebSockets.

This phase must produce:

1. An authoritative subscription manifest derived from the accepted Schema-5 registry.
2. Exact reconciliation of every `LIVE_REQUIRED` identity.
3. A deterministic three-shard assignment plan.
4. A structural feed-ownership admission contract.
5. An explicit refusal to start the live feed unless exactly one persistent feed owner is guaranteed.

This phase must **not open WebSockets or subscribe to any token**.

---

## A. EXECUTION AND COST CONTRACT

Complete this bounded phase in one controlled pass:

1. Correct the two stale documentation statements.
2. Trace existing registry-to-subscription inputs.
3. Define the manifest contract.
4. Implement manifest construction and validation.
5. Implement feed-ownership admission.
6. Run targeted tests and relevant TypeScript once.
7. Perform one independent review of the phase diff.
8. Correct genuine findings.
9. Rerun only affected targeted checks.
10. Report and stop.

Do not repeat accepted registry, capacity, calendar or boot-restoration audits.

Do not run:

- full package suites;
- production builds;
- development server boots;
- browsers;
- performance benchmarks;
- registry rebuilds;
- database writes;
- provider calls;
- WebSocket connections;
- subscription operations.

---

## B. MANDATORY DOCUMENTATION CORRECTIONS

Before implementation, correct the durable report/memory statements without reopening their technical phases.

Remove the retracted claim:

```text
Full coverage needs approximately 22,800 subscription tokens.
```

That figure counted raw Kite cash-master rows, including debt, government securities, NCDs, mutual funds and other non-stock instruments.

Record the accepted figures distinctly:

```text
Authoritative LIVE_REQUIRED identities: 7,880
Exactly mapped live identities:         7,876
Explicitly unmapped identities:             4
Kite subscription capacity:             9,000
Mapped-token headroom:                   1,124
```

Do not hardcode these figures as permanent runtime constants. They are the accepted development evidence for the current Schema-5 generation; runtime values must be derived from the active generation.

Also replace:

```text
AGGREGATE_LIVE_STATUS_NOT_FRESHNESS_OR_COVERAGE_AWARE
```

with the precise retained issue:

```text
DEPRECATED_LIVE_TICKS_SERIALIZATION_REQUIRES_REMOVAL
```

Phase 0.5B already prevents a non-zero tick count from granting complete or trade-grade authority. Confirm that no current authority gate relies on `LIVE_TICKS`; if one does, stop and report the exact consumer instead of changing it in this phase.

---

## C. STRICT SCOPE

Authorized:

- Existing Schema-5 registry readers.
- Existing settled boot-restoration accessor.
- Existing coverage bridge.
- A new pure subscription-manifest builder.
- A new pure deterministic shard planner.
- A new feed-ownership admission contract.
- Safe owner-only diagnostics for the proposed manifest and ownership state.
- Targeted tests.
- Directly related reports/memory corrections.

Not authorized:

- Registry refresh or rebuild.
- BSE/NSE source download.
- Database mutation or schema change.
- Kite login or token refresh.
- Kite/Upstox/Yahoo/IndianAPI calls.
- `KiteTicker` construction.
- WebSocket connections.
- Subscribe/unsubscribe calls.
- Runtime expansion beyond the legacy feed.
- Reconnect implementation.
- Per-tick storage.
- Canonical quote/OHLC/volume service.
- Candle processing.
- Indicators.
- F&O or Swing logic.
- Paper trading or orders.
- Dependencies, lockfiles or deployment configuration.
- Safety-lock changes.
- Production migration or deployment.

If any correct implementation requires these, stop with:

```text
PHASE_0_8A_BLOCKED — SCOPE_EXPANSION_REQUIRES_OWNER_AUTHORIZATION
```

---

## D. AUTHORITATIVE MANIFEST INPUT

The manifest may read only from a settled, integrity-valid Schema-5 registry generation.

It must consume:

- generation ID;
- schema and policy versions;
- record-set hash;
- eligible-live-set hash;
- authoritative identity count;
- each record’s canonical instrument identity;
- exchange;
- segment;
- security class;
- listing status;
- live/snapshot/excluded tier;
- provider instrument token;
- provider exchange token where available;
- exact mapping state;
- current-authority state;
- blocker state.

Never construct the subscription universe from:

- raw Kite cash-master row count;
- a trading-symbol list;
- the current legacy NIFTY-50 feed;
- disk cache alone;
- a stale stored authority boolean;
- UI rows;
- scanner results;
- fuzzy symbol matching;
- symbol-only deduplication;
- ISIN deduplication across exchanges.

NSE and BSE listings remain separate instruments even when symbol or ISIN matches.

---

## E. TWO DISTINCT OUTPUTS

### 1. Candidate manifest

May be constructed from an integrity-valid but expired/last-known Schema-5 generation for deterministic planning and diagnostics.

It must be labelled:

```text
CANDIDATE_LAST_KNOWN
activationAuthorized = false
```

### 2. Activatable manifest

May be granted only when all admission gates pass at the current runtime instant.

It must be labelled:

```text
ACTIVATABLE_CURRENT
activationAuthorized = true
```

An expired generation must never be silently upgraded merely because the records and checksum remain valid.

The currently stored August 12 generation should therefore produce a candidate manifest only during August 13 evaluation unless refreshed with separately authorized current-day evidence.

---

## F. RECORD-LEVEL CLASSIFICATION

Every authoritative registry record must end in exactly one manifest classification:

- `LIVE_MAPPED`
- `LIVE_UNMAPPED`
- `SNAPSHOT_ONLY`
- `EXCLUDED`
- `IDENTITY_INVALID`
- `PROVIDER_TOKEN_CONFLICT`
- `UNSUPPORTED_SECURITY_CLASS`
- `LISTING_NOT_ACTIVE`

No unexplained remainder is allowed.

Required reconciliation:

```text
totalRegistryRecords
=
LIVE_MAPPED
+ LIVE_UNMAPPED
+ SNAPSHOT_ONLY
+ EXCLUDED
+ IDENTITY_INVALID
+ PROVIDER_TOKEN_CONFLICT
+ UNSUPPORTED_SECURITY_CLASS
+ LISTING_NOT_ACTIVE
```

And separately:

```text
LIVE_REQUIRED
=
LIVE_MAPPED
+ LIVE_UNMAPPED
+ IDENTITY_INVALID
+ PROVIDER_TOKEN_CONFLICT
```

Reuse existing accepted classification fields. Do not reclassify securities by symbol patterns or Kite `instrument_type = EQ`.

Every exclusion must carry a stable reason code.

---

## G. PROVIDER-TOKEN INVARIANTS

For `LIVE_MAPPED`:

- canonical identity must be exact;
- exchange must be `NSE` or `BSE`;
- provider instrument token must be a positive safe integer;
- one canonical identity maps to exactly one active Kite token;
- one Kite token maps to exactly one canonical identity;
- token must belong to the expected exchange/segment;
- no duplicate token appears in the final subscription set;
- no symbol-only key participates in identity;
- cross-listed instruments remain separate;
- indices remain exchange-qualified;
- token conflicts fail closed.

Do not silently choose one record when a conflict exists.

---

## H. DETERMINISTIC THREE-SHARD PLAN

Create a pure shard planner for mapped live tokens.

Kite constraints:

```text
maximum sockets = 3
maximum tokens per socket = 3,000
total maximum = 9,000
```

Required output:

- shard ID: `0 | 1 | 2`;
- ordered canonical identities;
- ordered Kite tokens;
- token count;
- deterministic shard hash;
- complete-manifest hash;
- priority class;
- generation ID;
- policy version.

Requirements:

1. Same generation and policy always produce the same plan.
2. Input record order must not affect output.
3. No token appears in multiple shards.
4. Every `LIVE_MAPPED` token appears exactly once.
5. No shard exceeds 3,000 tokens.
6. Total mapped tokens must not exceed 9,000.
7. Required indices are placed in priority shard 0.
8. Remaining identities are distributed deterministically and reasonably evenly.
9. Shard hashes change when membership changes.
10. Generation identity and manifest hash bind the plan to the registry.
11. Empty or partial planning must not be labelled complete.
12. The planner must not open or inspect WebSockets.

Do not hardcode “approximately 2,625” as an invariant. Compute actual counts from the generation.

If the derived set exceeds capacity, return:

```text
PROVIDER_CAPACITY_EXCEEDED
activationAuthorized = false
```

Do not truncate the universe.

---

## I. SINGLETON FEED-OWNERSHIP ADMISSION

Exactly one persistent process may own all three Kite WebSockets for one Kite API key.

Before implementing admission, inspect the actual Replit deployment topology and existing configuration read-only.

Classify it as one of:

- `STRUCTURAL_SINGLETON`
- `MULTI_REPLICA_POSSIBLE`
- `SCALE_TO_ZERO_POSSIBLE`
- `TOPOLOGY_UNKNOWN`

Structural ownership means the deployed runtime configuration itself guarantees exactly one persistent feed process.

The following are not sufficient by themselves:

- process-local boolean;
- in-memory mutex;
- module singleton;
- PostgreSQL advisory lock;
- expiring database lease;
- Redis lock;
- leader-election heartbeat;
- “usually one replica”;
- first process to start;
- one HTTP request selecting an owner.

These mechanisms cannot independently guarantee that an old process has closed all Kite sockets before a new process opens replacements.

For this phase, implement only an admission decision:

```text
FeedOwnershipAdmission {
  topologyState
  singletonGuaranteed
  persistentProcessGuaranteed
  apiKeyOwnerId
  deploymentIdentity
  activationAuthorized
  blockerCode
  evaluatedAt
}
```

Activation requires:

```text
singletonGuaranteed = true
persistentProcessGuaranteed = true
```

If current Replit autoscale configuration permits multiple replicas or scale-to-zero, return:

```text
FEED_OWNER_TOPOLOGY_NOT_SINGLETON
activationAuthorized = false
```

Do not create a database-lock workaround and do not change deployment configuration in this phase.

If the topology cannot be established from available configuration, return:

```text
FEED_OWNER_TOPOLOGY_UNVERIFIED
```

---

## J. COMPLETE ACTIVATION GATE

The final manifest may become activatable only when all are true:

- settled Schema-5 restoration;
- payload and record integrity valid;
- current calendar authority valid;
- current BSE reference authority valid;
- exact `LIVE_REQUIRED` reconciliation;
- no identity-invalid record in the live-required set;
- no token conflict;
- mapped total within 9,000;
- every shard within 3,000;
- deterministic shard hashes valid;
- structural singleton feed ownership proven;
- persistent process ownership proven;
- valid deployment identity available;
- all four safety locks unchanged.

Kite session validity is not checked by a provider call in this phase. Represent it as:

```text
KITE_SESSION_NOT_EVALUATED_IN_PHASE_0_8A
```

Therefore, this phase may produce a manifest that is structurally ready but must not actually subscribe.

---

## K. OWNER-ONLY DIAGNOSTICS

Add or extend one owner-only diagnostic surface showing safe metadata:

- registry generation ID;
- authority state;
- candidate/activatable state;
- total records;
- `LIVE_REQUIRED`;
- `LIVE_MAPPED`;
- `LIVE_UNMAPPED`;
- every classification count;
- reconciliation result;
- mapped token count;
- capacity;
- headroom;
- shard counts;
- shard hashes;
- complete-manifest hash;
- topology state;
- ownership admission;
- blocker codes;
- generated/evaluated timestamp.

Do not expose:

- Kite API key;
- access token;
- secrets;
- database credentials;
- full instrument payload;
- raw provider responses.

The endpoint must remain owner-only. Anonymous access must be 401/403 under the existing authentication contract.

If this requires changing an unknown public/generated API contract, stop and report before changing it.

---

## L. REQUIRED TARGETED TESTS

Use production functions and accepted registry fixtures.

### Manifest tests

1. Accepted current Schema-5 generation produces deterministic manifest.
2. Integrity-valid expired generation produces candidate-last-known only.
3. Expired generation cannot authorize activation.
4. Schema 1–4 cannot produce an activatable manifest.
5. Integrity-invalid generation is refused.
6. All records reconcile with zero remainder.
7. `LIVE_REQUIRED` reconciliation closes exactly.
8. Current accepted evidence reproduces the accepted mapped/unmapped relationship.
9. Raw Kite non-equity rows cannot enter `LIVE_MAPPED`.
10. NSE and BSE same-symbol listings remain separate.
11. Unmapped identities remain explicit.
12. Invalid identity fails closed.
13. Duplicate provider token fails closed.
14. Missing provider token cannot be treated as mapped.
15. Input order does not change manifest output.
16. Repeated construction is deterministic.

### Shard tests

17. Every mapped token appears exactly once.
18. No token appears twice.
19. No shard exceeds 3,000.
20. Total does not exceed 9,000.
21. Capacity overflow refuses rather than truncates.
22. Required indices occupy shard 0.
23. Input order does not alter assignment.
24. Same input produces the same hashes.
25. Membership change alters the appropriate hash.
26. Empty and partial inputs cannot be labelled complete.

### Ownership tests

27. Structural singleton topology may pass ownership admission.
28. Multi-replica topology fails closed.
29. Scale-to-zero topology fails closed.
30. Unknown topology fails closed.
31. Process-local singleton alone is insufficient.
32. Database/advisory lock alone is insufficient.
33. Missing deployment identity fails closed.
34. Proof mode cannot authorize feed ownership.
35. Production must not infer singleton status from development configuration.

### Side-effect and safety tests

36. Manifest construction creates no WebSocket.
37. No provider call occurs.
38. No subscribe/unsubscribe occurs.
39. No database mutation occurs.
40. No scheduler starts.
41. Diagnostics remain owner-only.
42. No secret appears in serialized diagnostics.
43. All four safety locks remain exactly `false as boolean`.

---

## M. INDEPENDENT DIFF REVIEW

Review the complete phase diff for:

- reappearance of the 22,800-token error;
- debt/non-equity inclusion;
- symbol-only identity;
- NSE/BSE collapse;
- token truncation;
- duplicate token membership;
- input-order-dependent sharding;
- capacity overflow hidden by filtering;
- stale registry considered activatable;
- calendar authority substituted for BSE authority;
- singleton inferred from a process-local lock;
- advisory lock presented as structural ownership;
- scale-to-zero ignored;
- provider or subscription side effects;
- public diagnostics leaking identity payloads or secrets;
- authentication weakening;
- unrelated changes;
- safety-lock modification.

Correct genuine findings and rerun only affected targeted tests and TypeScript.

---

## N. CHANGE AND GIT CONTROL

Do not commit, push, merge, deploy, reset, revert, rebase or cherry-pick.

Before checkpoint authorization report:

- exact changed-file list;
- purpose of each file;
- runtime vs test/documentation files;
- diff summary;
- public-contract effect;
- Git status;
- auto-commit status;
- branch and `main` status.

If Replit auto-commits:

1. Stop and inspect the commit.
2. Report SHA and author.
3. List every committed file.
4. Confirm whether unrelated runtime, schema, dependency, configuration or generated files were captured.
5. Do not repair history without owner authorization.

---

## O. FOUR FROZEN SAFETY LOCKS

Confirm exactly:

```ts
FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED = false as boolean
SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED = false as boolean
FNO_PAPER_V2_RUNTIME_AUTHORIZED = false as boolean
SWING_PAPER_V2_RUNTIME_AUTHORIZED = false as boolean
```

No activation is authorized.

---

## P. REQUIRED FINAL REPORT

Report:

1. Documentation corrections made.
2. Registry generation used for planning.
3. Current authority state.
4. Exact classification counts and reconciliation equations.
5. Exact mapped/unmapped counts derived at runtime.
6. Capacity and headroom.
7. Shard counts and hashes.
8. Manifest hash and determinism proof.
9. Index-priority placement.
10. Deployment topology classification.
11. Feed-ownership admission result.
12. Every blocker code.
13. Targeted tests and TypeScript results.
14. Independent review findings and corrections.
15. Exact changed-file list and diff summary.
16. Confirmation of zero providers, WebSockets, subscriptions, schedulers and database writes.
17. Git and auto-commit status.
18. Four safety-lock values.
19. Anything not verified.

Expected result under an expired registry or non-singleton autoscale topology is a correctly blocked activation—not a failed implementation.

Required verdict when the manifest and ownership admission are correctly implemented:

```text
AUTHORITATIVE_SUBSCRIPTION_MANIFEST_VERIFIED_IN_DEVELOPMENT —
ZERO_UNEXPLAINED_UNIVERSE_REMAINDER —
DETERMINISTIC_THREE_SHARD_PLAN_VERIFIED —
NO_PROVIDER_OR_SUBSCRIPTION_SIDE_EFFECTS —
FEED_ACTIVATION_BLOCKED_UNTIL_CURRENT_AUTHORITY_AND_STRUCTURAL_SINGLETON_OWNERSHIP —
OWNER_CHECKPOINT_AUTHORIZATION_REQUIRED
```

If reconciliation or identity remains incorrect:

```text
PHASE_0_8A_BLOCKED — AUTHORITATIVE_SUBSCRIPTION_MANIFEST_INVALID
```

Stop after the report. Do not begin WebSocket construction, live subscription, current-day registry refresh, deployment changes, canonical quote integration, F&O or Swing work.
