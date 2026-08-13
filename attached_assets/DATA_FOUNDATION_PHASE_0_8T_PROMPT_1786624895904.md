# DATA FOUNDATION — PHASE 0.8T
## REPLIT STRUCTURAL-SINGLETON TOPOLOGY AND RESERVED VM PREPARATION

### PRIMARY OBJECTIVE

Prepare the existing API deployment to become one structurally guaranteed, persistent Kite feed owner using a Replit Reserved VM.

This phase must determine—with current official/platform evidence—whether Reserved VM provides:

- exactly one running deployment instance;
- no horizontal replicas;
- no scale-to-zero;
- persistent process ownership;
- graceful restart and shutdown behaviour;
- sufficient resources for the API server and approximately 7,876 Kite subscriptions;
- an acceptable and explicitly reported monthly cost.

If proven, prepare the minimum deployment-configuration and runtime-admission changes on the isolated branch.

Do **not** publish, deploy, open WebSockets, subscribe to tokens or refresh the registry.

---

## A. COST AND EXECUTION CONTRACT

The owner is experiencing excessive Replit expenditure. Cost control is mandatory.

Perform the phase in this order:

1. Inspect the current deployment configuration and account-visible deployment options.
2. Verify Reserved VM behaviour and pricing.
3. Inventory the existing build/run/port/domain/health configuration.
4. Produce the minimum proposed topology.
5. Implement configuration only if singleton and cost evidence are conclusive.
6. Update feed-ownership admission to recognize verified topology.
7. Run targeted configuration/admission tests and TypeScript once.
8. Perform one independent diff review.
9. Correct genuine findings.
10. Report and stop.

Do not repeatedly inspect, build or test the same area.

No new paid deployment may be created. No existing deployment may be resized, replaced, stopped or published without separate owner authorization.

---

## B. STRICT SCOPE

Authorized:

- Read-only inspection of `.replit`, `replit.nix`, deployment manifests, build/run commands, ports, health routes and currently declared deployment target.
- Current official Replit documentation or account-visible configuration needed to verify Reserved VM behaviour and cost.
- Read-only inspection of existing deployment usage/metrics if available without changing anything.
- Minimum branch-only deployment-configuration changes needed to prepare a Reserved VM target.
- Existing `FeedOwnershipAdmission` contract.
- A pure topology-evidence parser/validator.
- Graceful shutdown preparation required for future Kite socket ownership.
- Owner-only topology diagnostics.
- Targeted tests and documentation.
- Rollback and deployment runbook.

Not authorized:

- Deployment or Publish.
- Changing the active production deployment.
- Purchasing or creating a Reserved VM.
- Changing workspace or billing plans.
- Enabling automatic top-ups.
- Changing DNS or custom domain.
- Changing production secrets.
- Registry refresh or rebuild.
- Database writes or migrations.
- Kite login or token refresh.
- Provider calls.
- WebSocket construction.
- Subscribe/unsubscribe operations.
- Three-socket implementation.
- Live-data activation.
- Quote/candle/indicator work.
- F&O, Swing, paper trading or orders.
- Safety-lock activation.
- New dependencies or lockfile changes.
- Push, merge or PR creation.

If proof or preparation requires any prohibited action, stop with:

```text
PHASE_0_8T_BLOCKED — OWNER_DEPLOYMENT_OR_BILLING_ACTION_REQUIRED
```

---

## C. CURRENT TOPOLOGY INVENTORY

Capture the exact existing values for:

- deployment target and type;
- minimum and maximum replicas, if applicable;
- scale-to-zero behaviour;
- build and run commands;
- working directory and exposed port;
- health-check path and timeout;
- custom-domain mapping;
- environment and deployment/build identity;
- CPU, memory and storage allocation, if visible;
- current monthly or usage-based deployment cost;
- restart and graceful-shutdown policies;
- number of Node processes started by the run command;
- whether cluster mode, PM2, workers or child processes create extra API/feed processes.

Label evidence:

- `OBSERVED_CONFIG`
- `OBSERVED_PLATFORM`
- `OFFICIAL_DOCUMENTATION`
- `INFERRED`
- `NOT_YET_VERIFIED`

Do not treat absence of a setting as proof of singleton behaviour.

---

## D. RESERVED VM ACCEPTANCE REQUIREMENTS

Reserved VM may be classified as `STRUCTURAL_SINGLETON` only if current evidence proves:

1. Exactly one deployed VM instance serves the application.
2. The platform cannot automatically create a second replica.
3. The process does not scale to zero.
4. One run command starts one API/feed-owner process.
5. A restart replaces the prior process rather than overlapping it indefinitely.
6. Deployment identity is available to runtime admission.
7. The VM stays active during market hours without HTTP traffic.
8. Outbound persistent WebSockets are supported.
9. The selected size has fixed or clearly bounded recurring cost.
10. Health checks and restarts cannot create uncontrolled concurrent feed owners.

If any requirement is unverified:

```text
TOPOLOGY_UNKNOWN
activationAuthorized = false
```

Do not infer singleton ownership from the word “Reserved.”

---

## E. COST EVIDENCE

Report current visible pricing for every relevant Reserved VM size:

- CPU/vCPU;
- RAM;
- storage, where applicable;
- hourly charge;
- approximate 30-day monthly charge;
- whether billing continues while idle;
- included allowances/credits;
- taxes where displayed;
- separate network or deployment charges;
- current Autoscale cost for comparison, where actual account evidence is available.

Use:

```text
monthlyEstimate = hourlyRate × 24 × 30
```

State when tax or network usage is excluded. Do not guess prices from memory.

Recommend the smallest size reasonably capable of:

- one Node API process;
- three future Kite WebSockets;
- approximately 7,876 in-memory quote identities;
- subscription reconciliation;
- SSE/API clients;
- scheduled analysis;
- existing application routes.

Do not activate or purchase it.

If needs cannot be measured, recommend a conservative starting size and define upgrade triggers for CPU, memory, event-loop delay, reconnect delay, API latency and process restarts.

If account pricing requires owner interaction, report the exact UI evidence needed and stop with:

```text
PHASE_0_8T_BLOCKED — RESERVED_VM_COST_REQUIRES_OWNER_CONFIRMATION
```

---

## F. PROPOSED TOPOLOGY

Preferred topology, if verified:

```text
One Replit Reserved VM
├── One Node API-server process
├── One future Kite feed owner
├── Three future Kite WebSockets
├── In-memory canonical live quote map
├── HTTP/SSE consumers
└── Neon PostgreSQL durable data
```

Do not introduce a second worker deployment, Redis, Kafka, extra databases, Kubernetes, leader election, advisory-lock ownership, duplicate APIs or another paid service.

A separate worker may be considered only if measured evidence proves the application cannot safely share one process.

---

## G. CONFIGURATION PREPARATION

Only after singleton behaviour and cost are verified, prepare the minimum configuration diff for a future owner-authorized deployment.

Preserve:

- existing build and run commands unless invalid;
- custom domain compatibility;
- environment/secrets contract;
- application port contract;
- `/api/build-info`;
- health endpoints;
- authentication;
- PostgreSQL connection;
- rollback target.

Show the exact before/after meaning of every changed field. Do not invent unsupported `.replit` fields.

The prepared configuration must not activate merely by existing in the branch. Activation occurs only through a later owner-authorized Publish/deployment action.

If Reserved VM selection can only be made through the Replit UI, produce a precise UI runbook and leave configuration unchanged.

---

## H. RUNTIME OWNERSHIP EVIDENCE CONTRACT

Update `FeedOwnershipAdmission` only if reliable runtime topology evidence exists.

Admission requires:

```text
topologyState = STRUCTURAL_SINGLETON
singletonGuaranteed = true
persistentProcessGuaranteed = true
deploymentIdentity = present
apiKeyOwnerId = present or deterministically derived without exposing secrets
```

Do not authorize from `NODE_ENV`, developer-set flags alone, hostname/PID/uptime, local lock, in-memory boolean, PostgreSQL lock, lease, heartbeat, HTTP traffic, expected Reserved VM status or source `.replit` declaration without matching runtime evidence.

If runtime evidence cannot exist until deployment:

```text
RESERVED_VM_CONFIGURATION_PREPARED
ownershipAdmitted = false
blocker = RUNTIME_SINGLETON_EVIDENCE_NOT_YET_OBSERVED
```

Proof mode must never authorize feed ownership.

---

## I. GRACEFUL SHUTDOWN PREPARATION

Prepare—but do not use—the lifecycle boundary required before WebSockets are implemented:

1. Handle `SIGTERM` and `SIGINT`.
2. Stop accepting feed activation.
3. Mark feed state as shutting down.
4. Invoke a future socket-close hook.
5. Wait for future close acknowledgement within a bounded timeout.
6. Close HTTP and existing owned resources.
7. Exit with an explicit result.
8. Prevent duplicate shutdown execution.

Do not add fake Kite close logic. Define an injectable no-op lifecycle hook for Phase 0.8B. Do not add arbitrary long sleeps.

---

## J. HEALTH AND OWNER DIAGNOSTICS

Expose safe owner-only metadata:

- configured deployment target;
- observed runtime topology;
- singleton evidence source;
- persistence guarantee;
- deployment identity;
- process and boot IDs;
- feed-ownership admission and blocker;
- configured resource class, where safely available;
- proof-mode state;
- shutdown-lifecycle readiness.

Do not expose keys, tokens, credentials, full environment variables, billing/account identifiers or platform secrets. Anonymous access remains 401/403. Public health must not claim the feed is live.

---

## K. ROLLBACK PLAN

Prepare a precise runbook covering:

1. Current production commit and deployment type.
2. Prepared Reserved VM commit.
3. Predeployment build and identity verification.
4. Domain, environment, secrets and database continuity.
5. Health-check failure response.
6. Return to the existing Autoscale deployment.
7. Confirmation that no Reserved VM process remains after rollback.
8. Confirmation that no Kite WebSocket exists during this topology phase.
9. Owner deployment authorization.
10. Actions that create charges.

Do not delete or overwrite Autoscale configuration history.

---

## L. TARGETED TESTS

### Configuration and topology

1. Autoscale classifies `MULTI_REPLICA_POSSIBLE`.
2. Scale-to-zero blocks admission.
3. Verified Reserved VM fixture classifies `STRUCTURAL_SINGLETON`.
4. Unknown target fails closed.
5. Missing runtime deployment evidence fails closed.
6. Source configuration alone cannot authorize ownership.
7. Proof mode cannot authorize ownership.
8. Development cannot impersonate production singleton.
9. Missing deployment identity blocks admission.
10. Malformed topology evidence blocks admission.
11. One-process run command passes.
12. Cluster/multi-process command blocks admission.

### Ownership and lifecycle

13. Structural singleton plus persistent runtime may reach topology-ready state.
14. Advisory lock, process mutex and DB lease remain insufficient.
15. Ownership response contains no secret.
16. Phase 0.8A manifest/shard hashes remain unchanged.
17. SIGTERM and SIGINT invoke shutdown once.
18. Repeated signals do not duplicate cleanup.
19. Feed activation refuses after shutdown begins.
20. Future close hook runs before HTTP close.
21. Hook failure is reported safely.
22. Timeout is bounded and cannot fabricate success.
23. No WebSocket or subscription call exists.

### Safety and compatibility

24. Normal boot remains unchanged when preparation is inactive.
25. Provider-free proof mode remains isolated.
26. Owner diagnostics remain owner-only.
27. No provider call, DB write, scheduler or deployment action occurs.
28. All four safety locks remain `false as boolean`.

Use production functions, not replicas.

---

## M. INDEPENDENT REVIEW

Review for unsupported singleton assumptions, source config used as runtime proof, environment spoofing, accidental activation, multiple processes, scale-to-zero, health/domain breakage, missing rollback, uncontrolled billing, WebSocket/subscription side effects, shutdown races, authentication weakening, secret exposure, unrelated changes and safety-lock modifications.

Correct genuine findings and rerun only affected tests and TypeScript once.

---

## N. VERIFICATION AND COST LIMITS

Allowed:

- focused source/config inspection;
- official/current Replit documentation or account-visible pricing inspection;
- targeted tests;
- relevant TypeScript;
- one topology/admission proof;
- one independent review.

Prohibited:

- full suites or production builds;
- server restart or Publish;
- deployment/billing changes;
- provider calls;
- registry refresh;
- database mutation;
- WebSockets/subscriptions;
- performance benchmarks.

---

## O. GIT CONTROL

Do not commit, push, merge, deploy, reset, revert, rebase or cherry-pick.

Report exact changed files, purpose, configuration before/after, runtime/test/docs classification, diff, public-contract effect, Git status, auto-commit status, branch, `main` and origin status.

If Replit auto-commits, inspect and report it without rewriting history.

---

## P. FOUR SAFETY LOCKS

Confirm exactly:

```ts
FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED = false as boolean
SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED = false as boolean
FNO_PAPER_V2_RUNTIME_AUTHORIZED = false as boolean
SWING_PAPER_V2_RUNTIME_AUTHORIZED = false as boolean
```

---

## Q. REQUIRED FINAL REPORT

Report:

1. Current topology evidence.
2. Reserved VM singleton/persistence evidence.
3. Current Autoscale cost evidence.
4. Reserved VM price options.
5. Recommended minimum size and monthly estimate.
6. Assumptions and excluded costs.
7. Proposed topology.
8. Configuration changes prepared.
9. Runtime singleton-evidence contract.
10. Ownership-admission result.
11. Graceful-shutdown preparation.
12. Owner-only diagnostic result.
13. Rollback procedure.
14. Targeted tests and TypeScript.
15. Independent review findings.
16. Exact changed files and diff.
17. Zero deployment/provider/WebSocket/subscription/database side effects.
18. Git and auto-commit status.
19. Four safety-lock values.
20. Owner action required.

Required verdict if preparation succeeds but runtime evidence awaits deployment:

```text
REPLIT_RESERVED_VM_SINGLETON_CONFIGURATION_PREPARED_IN_DEVELOPMENT —
COST_AND_ROLLBACK_DOCUMENTED —
ZERO_DEPLOYMENT_OR_FEED_SIDE_EFFECTS —
RUNTIME_SINGLETON_ADMISSION_PENDING_ACTUAL_RESERVED_VM_DEPLOYMENT —
OWNER_CHECKPOINT_AUTHORIZATION_REQUIRED
```

If suitability cannot be proven:

```text
PHASE_0_8T_BLOCKED — REPLIT_RESERVED_VM_SINGLETON_OR_PERSISTENCE_NOT_VERIFIED
```

If cost cannot be verified:

```text
PHASE_0_8T_BLOCKED — RESERVED_VM_COST_REQUIRES_OWNER_CONFIRMATION
```

Stop after reporting. Do not begin Phase 0.8B, deploy, refresh the registry or open Kite connections.
