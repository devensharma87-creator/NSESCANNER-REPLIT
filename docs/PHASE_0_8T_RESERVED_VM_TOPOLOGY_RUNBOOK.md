# PHASE 0.8T — RESERVED VM TOPOLOGY RUNBOOK

**Status:** DEVELOPMENT PREPARATION COMPLETE — AWAITING OWNER CHECKPOINT AUTHORIZATION
**Branch:** pack33c-p1-1-isolated (no commits by agent; platform auto-commits tracked separately)

---

## 1. What Changed in Phase 0.8T

### Configuration change (inert until publish)

| Property | Before | After | Effect |
|---|---|---|---|
| `.replit` `deploymentTarget` | `"autoscale"` | `"vm"` | Publish will target Reserved VM |

The change is read only at publish time. The running Autoscale deployment is untouched.

### New code (zero boot side effects)

| File | Kind | Purpose |
|---|---|---|
| `src/lib/lifecycle/feedActivationContract.ts` | runtime | Feed activation state machine and handover evidence contract |
| `src/lib/lifecycle/gracefulShutdown.ts` | runtime | Graceful shutdown boundary — NOW INSTALLED before server.listen() |
| `src/lib/registry/runtimeTopologyEvidence.ts` | runtime | Runtime topology evidence and Phase 0.8T contract |
| `src/routes/dataHealth.ts` | runtime | `GET /api/data-health/topology` (owner-only) extended with activation/handover state |
| `src/index.ts` | runtime | Shutdown coordinator installed synchronously before server.listen() |
| `src/lib/lifecycle/p08t.feedActivation.test.ts` | test | 38 activation/handover/shutdown/safety tests |
| `src/lib/registry/p08t.topologyAdmission.test.ts` | test | 34 topology/evidence/runbook tests |
| `src/lib/lifecycle/gracefulShutdown.p08t.test.ts` | test | 12 shutdown lifecycle tests |
| `docs/PHASE_0_8T_RESERVED_VM_TOPOLOGY_RUNBOOK.md` | docs | This file |

---

## 2. Republish Overlap Risk

Reserved VM is NOT zero-overlap. On every publish:

1. Replit starts the **new** process.
2. Replit sends SIGTERM to the **old** process.
3. There is a bounded window in which **both processes exist**.

If both automatically open Kite WebSockets, the same API key could temporarily own six connections. Phase 0.8T prevents this by:

- Feed activation defaults to `DISABLED_BY_DEFAULT` at every boot.
- The state machine requires explicit owner clearance of the handover before activation can be requested.
- The old process's shutdown coordinator closes HTTP, then emits an honest result.
- ACTIVE is unreachable by construction in this phase.

---

## 3. Feed Activation State Machine

```
DISABLED_BY_DEFAULT         ← every boot starts here
    ↓ (topology evidence arrives)
TOPOLOGY_EVIDENCE_PENDING   ← no runtime attestation yet
    ↓ (Reserved VM evidence confirmed)
HANDOVER_CLEARANCE_PENDING  ← previous deployment not yet confirmed inactive
    ↓ (owner verifies old process gone)
OWNER_AUTHORIZATION_PENDING ← owner hasn't explicitly authorised
    ↓ (owner authorises)
READY_FOR_OWNER_ACTIVATION  ← Phase 0.8T ceiling; never goes further
ACTIVE                      ← defined; unreachable in Phase 0.8T
SHUTTING_DOWN               ← entered on SIGTERM/SIGINT
REFUSED                     ← proof mode, regression, or permanent violation
```

Single-factor attacks that CANNOT activate the feed (each checked):
- `NODE_ENV=production`
- `.replit` `deploymentTarget = "vm"` (source configuration)
- Runtime topology attestation alone
- Current registry authority
- Valid Kite session
- DB lease / advisory lock / heartbeat
- Elapsed time

---

## 4. Deployment Handover Contract

```typescript
DeploymentHandoverEvidence {
  currentDeploymentId               // null on first deploy until env key confirmed
  previousDeploymentId              // null = first deployment (vacuously cleared)
  currentBootId                     // randomUUID for this incarnation
  currentProcessId                  // process.pid
  currentStartedAt                  // ISO-8601
  topologyAttested                  // VERIFIED_PLATFORM_ATTESTATION only
  previousDeploymentConfirmedInactive  // MUST be explicit evidence
  confirmationSource                // "OWNER_MANUAL_VERIFICATION" | "OWNER_CONFIRMED_VIA_DIAGNOSTICS"
  confirmationBoundToDeploymentId   // must === currentDeploymentId
  confirmationBoundToBootId         // must === currentBootId
  confirmedAt                       // ISO-8601
  feedDisabledAtBoot                // ALWAYS true in Phase 0.8T
  activationAuthorized              // ALWAYS false at boot
}
```

### Why locks/leases are insufficient

DB advisory locks, pg leases, and heartbeats confirm database connectivity. They do not confirm that the old process's WebSocket connections to Kite are closed. A process can hold an advisory lock while its sockets remain open. Only explicit owner verification (checking the old process list, the Kite console, and the diagnostics endpoint) constitutes valid confirmation.

---

## 5. Graceful Shutdown — Installed Ordering

The shutdown coordinator is installed **synchronously** after `createServer(app)` and **before** `server.listen()` is called. Any SIGTERM or SIGINT arriving in the startup window — after the server object is created, before the listen callback fires — is handled correctly.

SIGTERM or SIGINT →
1. Atomically set `phase = SHUTTING_DOWN`
2. Refuse new feed activation (`isFeedActivationPermitted() → false`)
3. Invoke registered feed-close hook (Phase 0.8T: NO_OP, reports NOT_OWNED)
4. Await hook — bounded to `feedCloseTimeoutMs` (5 000 ms)
5. Close HTTP listener — bounded to `httpCloseTimeoutMs` (5 000 ms)
6. Emit `ShutdownResult` (exitCode 0 if feed NOT_OWNED + HTTP closed, else 1)
7. `process.exit(exitCode)` via injected callback

Duplicate signals: idempotent — second and later signals return the first run's promise.

`registerShutdownController` is idempotent: a second call returns `false` without registering a new controller, preventing duplicate handlers.

---

## 6. Runtime Attestation Collection Plan

### Stage 1 — Feed-disabled Reserved VM deployment (after owner authorises publish)

1. Publish with Reserved VM selected (see §7).
2. Keep feed activation disabled (default — nothing to do).
3. Call `GET /api/data-health/topology` with owner cookie.
4. Record the **names** of environment variables present (never values).
5. Independently classify each name: Replit platform metadata vs application secret.
6. Classify only safe platform-metadata keys as candidates for `VERIFIED_PLATFORM_ATTESTATION_KEYS`.
7. Verify `isDeployment: true` in the response.
8. Verify `processTopology: SINGLE_ENTRYPOINT_ARGV`.
9. Verify `feedActivation.state` is `TOPOLOGY_EVIDENCE_PENDING` (attestation list still empty).
10. Confirm zero Kite sockets: Kite console + process `lsof` (no WebSocket FDs).
11. Confirm old Autoscale process is inactive: Replit dashboard.
12. Leave feed disabled. Return for Stage 2.

### Stage 2 — Code recognition (separate owner decision)

1. Add confirmed safe env-var names to `VERIFIED_PLATFORM_ATTESTATION_KEYS`.
2. Review with owner before committing.
3. Redeploy (feed still disabled).
4. Verify `attestationSource: VERIFIED_PLATFORM_ATTESTATION` in response.
5. Supply explicit handover confirmation matching current deploymentId + bootId.
6. Verify state reaches `READY_FOR_OWNER_ACTIVATION` — never `ACTIVE`.
7. Request separate owner authorisation before any Phase 0.8B work.

---

## 7. First Reserved VM Deployment Procedure

> ⚠️ Every step that involves clicking Publish creates a Replit charge. Confirm pricing before proceeding.

### Pre-publish: capture live production rollback identity (REQUIRED)

Before opening the Publish UI, capture the identity of the process currently serving production. This is the **only admissible rollback target** — branch ancestry, local Git state, or any prior report cannot substitute for this live pre-publish evidence.

1. `[A]` Call `GET /api/build-info` on the **production** URL (owner-only) and record all of the following:

   | Field | Where | Purpose |
   |---|---|---|
   | Production URL | known | Identifies the endpoint |
   | HTTP status | response | Must be 200 |
   | `commitSha` | response body | Full commit SHA of the running build |
   | `commitShort` | response body | Short SHA for cross-reference |
   | `buildTime` | response body | When this build was compiled |
   | `bootTime` | response body | When this process started |
   | `deploymentId` | response body or `/api/data-health/topology` | Replit deployment identity |
   | `apiBuildId` | response body | Internal build identifier |
   | `environment` / `nodeEnv` | response body | Must be `production` |
   | Current deployment type | Replit dashboard | Must be `autoscale` before this step |
   | Capture timestamp | UTC | When this evidence was collected |

2. `[A]` Cross-check: verify `deploymentId` in the build-info response agrees with the Replit platform deployment record (dashboard → Deployments).

3. `[A]` If the identity endpoint is missing, unreachable, non-production, internally inconsistent (fields disagree), or the `deploymentId` does not match the platform record, stop immediately:

   `PREPUBLISH_BLOCKED — PRODUCTION_ROLLBACK_IDENTITY_NOT_PROVEN`

   Do not publish until the identity is resolved.

4. `[A]` Record the captured evidence securely (not in the codebase). It is the input to the rollback procedure in §9.

5. `[A]` Confirm `feedActivation.state` is `TOPOLOGY_EVIDENCE_PENDING` or `DISABLED_BY_DEFAULT` on the diagnostics route.

6. `[A]` Confirm all four safety locks are `false` via the test suite or source inspection.

**Publish (creates a charge)**

7. `[O]` Open the Publish UI (Replit header → Deploy / Publish).
8. `[O]` Select **Reserved VM** (not Autoscale).
9. `[O]` Select machine size — 1 vCPU / 4 GiB recommended ($0.0486/h ≈ $34.99/mo at 720 h).
10. `[O]` Confirm the price shown matches the documented rate before clicking Publish.
11. `[O]` Click Publish. Old Autoscale instance will receive SIGTERM.

**Verification (after Publish)**

12. `[A]` Wait for build to complete and health check to pass.
13. `[A]` `GET /api/healthz` → 200.
14. `[A]` `GET /api/data-health/topology` (owner cookie) → `isDeployment: true`, `feedActivation.state` not `ACTIVE`.
15. `[A]` Confirm build identity via `GET /api/build-info` matches the published commit.
16. `[A]` Record safe env-var names from topology response (never values).
17. `[A]` Confirm `feedDisabledAtBoot: true` in the response.
18. `[A]` Verify no Kite sockets: check Kite API console for active connections.
19. `[A]` Verify old Autoscale process is inactive (Replit dashboard shows no running Autoscale instance).

**Leave feed disabled. Do not proceed to Stage 2 without separate owner sign-off.**

`[A]` = agent action (safe, no charge)
`[O]` = owner action required

---

## 8. Every Later Redeployment Procedure

> Each publish creates a new Reserved VM charge until the old instance is replaced.

1. `[A]` Capture live production rollback identity (all fields from §7 pre-publish steps 1–4).
2. `[A]` If identity cannot be proven, stop with `PREPUBLISH_BLOCKED — PRODUCTION_ROLLBACK_IDENTITY_NOT_PROVEN`.
3. `[A]` Verify current `feedActivation.state` (should not be `ACTIVE` in Phase 0.8T).
4. `[A]` Record `currentDeploymentId` and `currentBootId` from topology diagnostic.
5. `[O]` Authorise publish.
6. **Platform**: old process receives SIGTERM → graceful shutdown runs (feed NOT_OWNED, HTTP closes within 10 s total).
7. `[A]` Verify old shutdown result: check that the old process's log emitted `SHUTDOWN_INSTALLED` + clean exit.
8. `[A]` Verify new process health: `GET /api/healthz` → 200.
9. `[A]` Verify new process is feed-disabled: `feedActivation.state` ≠ `ACTIVE`.
10. `[A]` Verify new `currentDeploymentId` ≠ old one.
11. `[A]` Re-confirm registry/Kite/session evidence as needed for the new deployment's topology response.
12. `[O]` Request separate owner activation if Phase 0.8B has been reached and the new process is to own the feed.
13. **Never** auto-reactivate from a previous process's persisted state.

---

## 9. Rollback Procedure

### Rollback target identification

The admissible rollback target is the **production identity captured in the pre-publish evidence record** (§7 steps 1–4). Branch ancestry, local Git state, and old reports cannot substitute for live pre-publish evidence.

### Rollback to Autoscale (revert deploymentTarget)

1. `[O]` Open Publish UI → switch deployment type back to Autoscale.
2. `[O]` Click Publish. **Creates a charge** for the Autoscale instance.
3. Reserved VM billing stops when the Reserved VM instance is replaced.
4. `[A]` Verify `GET /api/healthz` → 200 and `GET /api/data-health/topology` shows Autoscale topology.

### Rollback to pre-Phase-0.8T code

1. `[O]` Open Replit Checkpoints. Find the checkpoint whose identity matches the pre-publish evidence record (`commitSha`, `buildTime`, `deploymentId`).
2. `[O]` Restore checkpoint. **This reverts ALL Phase 0.8T code.**
3. `[O]` Publish the restored code with Autoscale.
4. `[A]` Verify the production identity **matches the rollback target**: the `commitSha`, `commitShort`, `buildTime`, and `deploymentId` from `GET /api/build-info` must match the captured pre-publish evidence record.
5. `[A]` Verify health endpoint succeeds: `GET /api/healthz` → 200.
6. `[A]` Verify authentication boundary is intact: an unauthenticated GET to an owner-only route must return 401 (not 200 or 500).
7. `[A]` Verify no new Kite WebSocket or subscription activation occurred as part of rollback verification.

> Note: branch ancestry and local Git state cannot substitute for verifying the live production identity in step 4.

### Steps that create additional Replit charges

- Every Publish (any type): build compute.
- Running a Reserved VM: per-second billing from first publish until explicitly stopped/switched.
- Switching from Reserved VM to Autoscale: Autoscale compute units from the first request.

---

## 10. Cost Reference

| Tier | vCPU | GiB RAM | Rate | Monthly (720 h) |
|---|---|---|---|---|
| Entry | 0.5 | 2 | $0.0208/h | ≈ $14.98 |
| **Recommended** | **1** | **4** | **$0.0486/h** | **≈ $34.99** |
| Standard | 2 | 8 | $0.0694/h | ≈ $49.97 |
| Large | 4 | 16 | $0.1806/h | ≈ $130.03 |
| XL | 8 | 32 | $0.3611/h | ≈ $259.99 |
| 2XL | 16 | 64 | $0.7222/h | ≈ $519.98 |

Taxes excluded. Verify current rates at Settings → Billing before publishing.
Actual current Autoscale spend: **NOT_YET_VERIFIED** — check Settings → Account → Account usage.

---

## 11. Owner Actions Required

1. Review this runbook and the Phase 0.8T code diff.
2. Authorize the development checkpoint.
3. When ready to deploy: follow §7 (First Reserved VM Deployment Procedure) step by step, beginning with live production rollback identity capture.
4. After collecting runtime attestation: follow Stage 2 (§6) and obtain a separate owner decision before Phase 0.8B.
