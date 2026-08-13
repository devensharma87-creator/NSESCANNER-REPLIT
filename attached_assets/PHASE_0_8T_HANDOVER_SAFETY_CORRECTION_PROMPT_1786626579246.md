# PHASE 0.8T — FINAL HANDOVER-SAFETY CORRECTION
## FEED-DISABLED RESERVED VM DEPLOYMENT AND RUNTIME ATTESTATION

### REPLIT MODE

```text
REPLIT MODE: ECONOMY
```

This is a small correction to Phase 0.8T. Do not reopen the broader topology, pricing or Phase 0.8A work.

---

## 1. WHY THIS CORRECTION IS REQUIRED

The Reserved VM preparation established persistent single-instance operation during steady state. However, official/platform behaviour indicates that republishing can start the new instance before the old process has fully terminated.

Therefore:

```text
Reserved VM steady state ≠ guaranteed single feed owner during deployment handover
```

If both processes automatically open three Kite WebSockets, the same Kite API key could temporarily own six connections.

Phase 0.8T cannot authorize feed activation until the handover contract guarantees:

1. Every newly deployed process starts with feed activation disabled.
2. The old process receives graceful shutdown and closes future sockets.
3. Runtime Reserved VM evidence is observed on the new deployment.
4. The previous deployment identity is confirmed inactive.
5. The owner explicitly authorizes feed activation afterward.

No WebSocket implementation or activation is authorized in this correction.

---

## 2. AUTHORIZED OBJECTIVE

Complete Phase 0.8T by implementing and proving:

- feed activation defaults to disabled;
- deployment overlap/handover is an explicit non-admitted state;
- normal Reserved VM boot never automatically activates Kite;
- generic graceful-shutdown coordination is installed at the real entry point;
- a future Kite close hook exists but remains a no-op until Phase 0.8B;
- runtime attestation can be collected while the feed is disabled;
- first deployment and every later redeployment follow a safe two-stage procedure;
- no database lease, advisory lock or environment flag alone can establish ownership;
- the owner remains the final activation authority.

---

## 3. STRICT SCOPE

Authorized:

- Existing Phase 0.8T runtime-topology contract.
- Existing Phase 0.8A feed-ownership admission.
- Existing boot-capability contract.
- Existing graceful-shutdown module.
- API-server entry-point shutdown installation.
- A pure feed-activation state/admission contract.
- Owner-only topology and activation diagnostics.
- Reserved VM first-deployment/redeployment runbook.
- Targeted tests and relevant TypeScript.
- Documentation and memory directly related to this correction.

Not authorized:

- Publish or deployment.
- Reserved VM purchase or resize.
- Production configuration or secret changes.
- Runtime attestation discovery through a live deployment.
- Kite login, token refresh or API call.
- `KiteTicker` construction.
- WebSocket connections.
- Subscribe/unsubscribe calls.
- Registry refresh or database write.
- Three-shard runtime wiring.
- Quote, candle or indicator work.
- F&O, Swing, paper trading or orders.
- Safety-lock changes.
- Dependencies or lockfiles.
- Push, merge, rebase or deployment.

If completing the correction requires a real deployment, stop with:

```text
PHASE_0_8T_BLOCKED — FEED_DISABLED_RESERVED_VM_DEPLOYMENT_REQUIRES_OWNER_AUTHORIZATION
```

---

## 4. FEED ACTIVATION MUST DEFAULT TO DISABLED

Introduce one explicit runtime activation contract. Use existing terminology where available.

Required initial state on every process boot:

```text
feedActivationState = DISABLED_BY_DEFAULT
activationAuthorized = false
```

This must remain true regardless of:

- `NODE_ENV=production`;
- `.replit` declaring `deploymentTarget = "vm"`;
- process PID or uptime;
- deployment ID being present;
- registry authority being current;
- Kite session being valid;
- HTTP traffic;
- a successful prior deployment;
- a successful prior owner activation on another process.

Do not use a permissive default. Missing, malformed or unknown activation evidence must be disabled.

Do not create an automatic activation scheduler.

---

## 5. ACTIVATION STATE MACHINE

Implement a pure, explicit state machine similar to:

```text
DISABLED_BY_DEFAULT
TOPOLOGY_EVIDENCE_PENDING
HANDOVER_CLEARANCE_PENDING
OWNER_AUTHORIZATION_PENDING
READY_FOR_OWNER_ACTIVATION
ACTIVE            // state defined only; unreachable in Phase 0.8T
SHUTTING_DOWN
REFUSED
```

Stable blocker codes must distinguish:

```text
FEED_DISABLED_BY_DEFAULT
RUNTIME_SINGLETON_EVIDENCE_NOT_YET_OBSERVED
DEPLOYMENT_HANDOVER_NOT_CLEARED
PREVIOUS_DEPLOYMENT_IDENTITY_NOT_CONFIRMED_INACTIVE
OWNER_FEED_ACTIVATION_NOT_AUTHORIZED
PROOF_MODE_CANNOT_ACTIVATE_FEED
TOPOLOGY_NOT_STRUCTURAL_SINGLETON
PROCESS_SHUTTING_DOWN
```

In Phase 0.8T, `ACTIVE` must be unreachable by construction. The implementation may produce at most `READY_FOR_OWNER_ACTIVATION` after future runtime evidence.

Do not add a real activation endpoint yet unless one already exists. If a new public or owner endpoint would be required, stop and report rather than broadening this correction.

---

## 6. DEPLOYMENT HANDOVER CONTRACT

Represent handover explicitly:

```text
DeploymentHandoverEvidence {
  currentDeploymentId
  previousDeploymentId
  currentBootId
  currentProcessId
  currentStartedAt
  topologyAttested
  previousDeploymentConfirmedInactive
  confirmationSource
  confirmedAt
  feedDisabledAtBoot
  activationAuthorized
  blockerCode
}
```

Requirements:

1. A new deployment starts feed-disabled.
2. Presence of a new deployment ID does not prove the old deployment is gone.
3. `previousDeploymentConfirmedInactive` must be explicit evidence, not inferred from elapsed time alone.
4. Missing previous-deployment information fails closed.
5. Proof mode always fails activation.
6. A process in shutdown cannot regain activation readiness.
7. Handover evidence is bound to the current deployment and boot identities.
8. Evidence from an older process or deployment cannot be replayed.

Do not represent PostgreSQL locks, leases, heartbeats or advisory locks as proof that old provider sockets are closed.

---

## 7. RUNTIME ATTESTATION PLAN

The existing verified attestation-key list is empty. Do not guess Replit variable names.

Prepare a two-stage runtime evidence procedure:

### Stage 1 — Feed-disabled Reserved VM deployment

After separate owner authorization:

- deploy the prepared Reserved VM configuration;
- keep feed activation disabled;
- collect only safe environment-key names and deployment metadata;
- never display environment values that may be secrets;
- verify one Node entry point;
- verify persistence and deployment identity;
- verify the previous Autoscale/VM process is inactive;
- confirm zero Kite sockets and subscriptions.

### Stage 2 — Code recognition

- add only attestation keys actually observed and independently classified as safe platform evidence;
- review them before checkpointing;
- redeploy feed-disabled if required;
- prove runtime ownership admission can reach `READY_FOR_OWNER_ACTIVATION` but not `ACTIVE`;
- request separate owner authorization before any feed activation.

The current phase prepares this process only. It does not execute either stage.

---

## 8. GRACEFUL SHUTDOWN INSTALLATION

The existing generic shutdown coordinator is prepared but not installed. Install it at the real API-server lifecycle boundary.

Required ordering:

1. Receive `SIGTERM` or `SIGINT`.
2. Atomically transition activation state to `SHUTTING_DOWN`.
3. Refuse new feed activation attempts.
4. Invoke registered future feed-close hook.
5. Await it within the existing bounded timeout.
6. Close the HTTP listener using the existing bounded contract.
7. Close other existing owned resources only through established hooks.
8. Emit a safe final outcome.
9. Prevent duplicate cleanup when multiple signals arrive.

For Phase 0.8T:

- the feed-close hook must be registered as an explicit no-op/not-installed result;
- it must not pretend that a Kite socket was closed;
- no Kite module may be imported solely for shutdown;
- no WebSocket or subscription code may be introduced.

Normal production boot behaviour must remain unchanged except for safer process shutdown.

---

## 9. OWNER-ONLY DIAGNOSTICS

Extend the existing owner-only topology diagnostic with safe metadata:

- configured deployment target;
- observed topology state;
- runtime-attestation state;
- current deployment ID presence;
- previous deployment ID presence;
- current boot ID;
- feed activation state;
- feed disabled at boot;
- handover-clearance state;
- previous deployment inactive confirmation;
- owner-authorization state;
- shutdown state/readiness;
- blocker codes.

Do not expose:

- raw environment values;
- API keys or tokens;
- database credentials;
- Replit billing/account identifiers;
- complete environment-variable lists;
- instrument/token payloads.

Anonymous access remains 401/403.

Public health must not call the feed live or ready.

---

## 10. FIRST DEPLOYMENT AND REDEPLOYMENT RUNBOOK

Update the Reserved VM runbook with two exact workflows.

### First Reserved VM deployment

1. Confirm current production commit and rollback target.
2. Confirm Reserved VM price and size in the UI.
3. Confirm feed defaults disabled.
4. Publish only after owner authorization.
5. Verify build identity.
6. Verify API/health/authentication/domain.
7. Capture safe runtime attestation.
8. Confirm no Kite socket or subscription exists.
9. Confirm old Autoscale process is inactive.
10. Leave feed disabled.
11. Return for code review and a second owner decision.

### Every later redeployment

1. Disable/refuse feed activation before publishing.
2. Record current deployment and boot identity.
3. Publish replacement.
4. Old process enters graceful shutdown.
5. Verify old process and sockets are gone.
6. Verify new deployment identity and health.
7. Verify new process remains feed-disabled.
8. Re-establish current registry/Kite/session evidence as required.
9. Request separate owner activation.
10. Never auto-reactivate from persisted previous-process state.

Include rollback steps and identify every step that can create additional Replit charges.

---

## 11. TARGETED TESTS

Use production functions, not replicas.

### Activation safety

1. Every boot defaults to disabled.
2. Production mode alone cannot activate.
3. Reserved VM source configuration alone cannot activate.
4. Runtime topology attestation alone cannot activate.
5. Current registry authority alone cannot activate.
6. Valid Kite session alone cannot activate.
7. Missing activation evidence fails closed.
8. Malformed activation evidence fails closed.
9. Proof mode cannot activate.
10. `ACTIVE` is unreachable in Phase 0.8T.

### Handover

11. New deployment ID with unknown old state remains blocked.
12. Previous deployment not confirmed inactive remains blocked.
13. Confirmation bound to another deployment is rejected.
14. Confirmation bound to another boot is rejected.
15. Replayed/expired evidence cannot authorize readiness.
16. Source config plus DB lease remains insufficient.
17. Advisory lock remains insufficient.
18. Correct future evidence may reach `READY_FOR_OWNER_ACTIVATION`, not `ACTIVE`.
19. Owner authorization missing remains blocked.

### Shutdown

20. SIGTERM initiates shutdown once.
21. SIGINT initiates shutdown once.
22. Repeated/mixed signals do not duplicate cleanup.
23. Activation is refused immediately after shutdown begins.
24. Future feed-close hook precedes HTTP close.
25. Uninstalled feed hook reports honestly.
26. Hook failure produces safe failure state.
27. Hook timeout cannot fabricate success.
28. HTTP-close timeout remains bounded.

### Compatibility and safety

29. Normal startup remains unchanged outside proof/activation decisions.
30. Provider-free proof mode remains isolated.
31. Owner diagnostics remain owner-only.
32. Diagnostics contain no secret values.
33. No Kite provider/WebSocket/subscription import or call is added.
34. No database write or scheduler is introduced.
35. Phase 0.8A manifest and shard hashes remain unchanged.
36. All four safety locks remain exactly `false as boolean`.

---

## 12. INDEPENDENT REVIEW

Perform one review of the complete Phase 0.8T diff for:

- feed automatically enabled at boot;
- source configuration treated as runtime attestation;
- spoofable environment variables;
- overlap treated as harmless;
- previous deployment inferred inactive from time alone;
- DB/advisory lock treated as socket closure proof;
- activation state replayed across deployment identities;
- shutdown handler not installed;
- duplicate signal handling;
- HTTP closing before future feed sockets;
- fake/no-op hook reported as successful socket closure;
- public diagnostics or secret leakage;
- accidental deployment or provider side effects;
- unrelated changes;
- safety-lock changes.

Correct genuine findings and rerun only affected tests and relevant TypeScript once.

---

## 13. COST AND EXECUTION LIMITS

Use Economy mode.

Allowed:

- focused code/config inspection;
- bounded implementation;
- targeted tests;
- relevant TypeScript;
- one independent review;
- documentation updates.

Prohibited:

- deployment or Publish;
- Reserved VM purchase;
- production build;
- full suites;
- server restart or browser;
- database query/write;
- provider call;
- registry refresh;
- WebSocket/subscription;
- performance benchmark.

---

## 14. GIT CONTROL

Do not commit, push, merge, deploy, reset, revert, rebase or cherry-pick.

If Replit auto-commits, stop and inspect it. Report SHA, author and exact files. Do not alter history.

Final report must list:

- exact changed files;
- purpose of each;
- configuration before/after;
- runtime/test/docs classification;
- diff summary;
- Git status;
- branch, `main` and origin status;
- auto-commit status.

---

## 15. FROZEN SAFETY LOCKS

Confirm exactly:

```ts
FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED = false as boolean
SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED = false as boolean
FNO_PAPER_V2_RUNTIME_AUTHORIZED = false as boolean
SWING_PAPER_V2_RUNTIME_AUTHORIZED = false as boolean
```

---

## 16. REQUIRED FINAL REPORT

Report:

1. Exact republish-overlap risk.
2. Feed activation default and state machine.
3. Handover-evidence contract.
4. Why locks/leases remain insufficient.
5. Runtime-attestation collection plan.
6. Installed shutdown ordering.
7. Owner-only diagnostic changes.
8. First-deployment procedure.
9. Future-redeployment procedure.
10. Rollback procedure.
11. Targeted tests and TypeScript results.
12. Independent review findings/corrections.
13. Exact changed files and diff.
14. Confirmation of zero deployment/provider/WebSocket/subscription/database side effects.
15. Git and auto-commit status.
16. Four safety-lock values.
17. Exact owner action required next.

Required verdict only if preparation is complete:

```text
PHASE_0_8T_READY_FOR_CHECKPOINT —
FEED_DISABLED_BY_DEFAULT —
DEPLOYMENT_HANDOVER_CANNOT_AUTO_ACTIVATE —
GRACEFUL_SHUTDOWN_COORDINATOR_INSTALLED —
RUNTIME_ATTESTATION_AND_PREVIOUS_PROCESS_CLEARANCE_REQUIRED —
ZERO_DEPLOYMENT_OR_FEED_SIDE_EFFECTS —
OWNER_CHECKPOINT_AUTHORIZATION_REQUIRED
```

Otherwise:

```text
PHASE_0_8T_BLOCKED — RESERVED_VM_HANDOVER_SAFETY_NOT_PROVEN
```

Stop after reporting. Do not deploy, collect runtime attestation or begin Phase 0.8B.
