# PHASE 0.8T — FINAL CHECKPOINT CORRECTION

Use Economy mode. This is a narrow correction pass, not a new implementation phase.

## Objective

Correct exactly two Phase 0.8T issues before checkpoint authorization:

1. The rollback target must be the actual production deployment identity captured immediately before publishing—not local `main`, not the development branch base, and not an assumed commit.
2. Graceful-shutdown protection must be installed during the earliest safe server-startup window, before the listening callback and before any future feed activation can occur.

Do not reopen the accepted topology, cost, sharding, registry, authority, or subscription-manifest work.

## Non-negotiable scope

Permitted changes:

- `docs/PHASE_0_8T_RESERVED_VM_TOPOLOGY_RUNBOOK.md`
- the Phase 0.8T graceful-shutdown module
- the minimum API-server entry-point wiring needed to install shutdown handling safely
- targeted Phase 0.8T tests
- directly related report or memory corrections

Prohibited:

- no deployment or Publish action
- no production request in this correction pass
- no billing or machine purchase
- no Kite login, WebSocket creation, subscription, provider call, scheduler, registry refresh, database write, schema change, dependency change, generated-client change, F&O work, Swing work, candle work, indicator work, or safety-lock change
- do not activate the feed
- do not commit, push, merge, rebase, reset, revert, cherry-pick, or rewrite history unless separately authorized
- do not rerun full suites, production builds, boot proofs, browser tests, or broad evidence batteries

## A. Correct the rollback identity contract

The runbook must distinguish these three identities explicitly:

1. local `main`
2. the development/checkpoint branch and commit
3. the build actually serving production immediately before Publish

Only item 3 is an admissible rollback target.

### Required correction

- Remove any statement that treats local `main`—including `e37a4a32` or any other local commit—as the production rollback target.
- Do not replace it with another hardcoded commit.
- State that the exact rollback target must be captured immediately before Publish from the live production build-identity endpoint and the platform deployment record.
- The pre-publish evidence record must include, where exposed:
  - production URL
  - HTTP status
  - `commitSha` and `commitShort`
  - `buildTime`
  - `bootTime`
  - `deploymentId`
  - `apiBuildId`
  - environment / `nodeEnv`
  - current deployment type
  - capture timestamp in UTC
- If the identity endpoint is missing, unreachable, non-production, internally inconsistent, or disagrees with the platform deployment record, publishing must stop with:

  `PREPUBLISH_BLOCKED — PRODUCTION_ROLLBACK_IDENTITY_NOT_PROVEN`

- The runbook must say that branch ancestry, local Git state, or an old report cannot substitute for this live pre-publish evidence.
- The rollback procedure must select the captured prior production deployment/build, then verify after rollback:
  - the production identity matches the recorded rollback target
  - health endpoint succeeds
  - authentication boundary remains intact
  - the replacement Reserved VM/process is no longer serving
  - no new Kite WebSocket or subscription activation occurred as part of rollback verification

Do not contact production now. This pass only corrects the executable runbook contract.

## B. Install shutdown handling in the earliest safe startup window

The current pattern installs handlers inside the `app.listen(...)` callback. That leaves a startup interval after the HTTP server object exists but before SIGTERM/SIGINT protection is installed.

### Required implementation

- Preserve the existing requirement that registry restoration settles before the listener is started.
- Obtain the HTTP server object through the existing startup path.
- Create/install the shutdown coordinator synchronously immediately after obtaining that server object—before the listen callback body can execute and before any future feed-activation call is reachable.
- Do not install duplicate process listeners.
- Shutdown installation must be idempotent or explicitly refuse a second installation.
- The coordinator must retain the accepted bounded shutdown order:
  1. mark shutdown in progress and refuse new activation
  2. stop/unsubscribe the future feed through the registered hook, if one exists
  3. close the HTTP listener within its bound
  4. report timeout/failure honestly and use a non-zero exit outcome when cleanup is incomplete
- Do not add or start a Kite feed in this phase.
- Do not register a fake feed hook merely to make tests pass.
- Expose a fail-closed readiness assertion that future feed activation must satisfy. Feed activation must be impossible unless shutdown handling is already installed.

If the existing `app.listen` structure cannot prove this ordering reliably, make the smallest safe structural adjustment (for example, explicitly creating the HTTP server before calling its `listen` method). Do not refactor unrelated boot logic.

## C. Required targeted tests

Add or update focused tests proving all of the following against production code:

1. shutdown handlers are installed before the listening callback executes
2. a simulated SIGTERM in the startup window is handled exactly once
3. a simulated SIGINT in the startup window is handled exactly once
4. repeated installation cannot create duplicate process listeners
5. a future feed activation attempt before shutdown installation fails closed
6. a future feed activation attempt after installation can pass only this lifecycle prerequisite; all Phase 0.8A authority, ownership, Kite-session, and owner-authorization gates remain unchanged
7. shutdown order is feed hook before HTTP close
8. a hung feed hook or HTTP close remains bounded and reports failure honestly
9. normal non-proof boot behaviour remains unchanged apart from earlier handler registration
10. proof mode remains impossible in production
11. the runbook no longer names local `main` or `e37a4a32` as the production rollback target
12. the runbook requires live pre-publish build identity and stops on missing/mismatched evidence
13. no provider, WebSocket, subscription, scheduler, database write, deployment, or billing action is introduced
14. all four safety locks remain exactly `false as boolean`

Avoid fragile comment-only regex assertions. Prefer testing exported lifecycle state and startup ordering. A source guard is acceptable only for the runbook requirements and forbidden imports/actions.

## D. Verification budget

Run only:

- the targeted Phase 0.8T topology/lifecycle tests affected by these changes
- API-server `tsc --noEmit`
- `git diff --check`
- one independent diff review

If the review finds a genuine defect, fix it and rerun only the affected targeted checks. Do not run full suites, production builds, controlled boots, provider proofs, or browser sessions.

## E. Required report

Report concisely:

1. exact files changed
2. the corrected rollback-identity rule
3. the exact startup ordering before and after
4. how duplicate signal handlers are prevented
5. how future feed activation is lifecycle-gated
6. targeted tests and TypeScript result
7. independent-review findings and corrections
8. Git status, branch, HEAD, and any auto-commit disclosure
9. confirmation that nothing was deployed, purchased, pushed, merged, or activated
10. confirmation that all four safety locks remain false
11. remaining blockers, including actual Reserved VM publication/runtime attestation and current registry authority

Stop with:

`PHASE_0_8T_READY_FOR_FINAL_CHECKPOINT — PRODUCTION_ROLLBACK_IDENTITY_CAPTURE_CONTRACT_CORRECTED — SHUTDOWN_PROTECTION_INSTALLED_BEFORE_LISTEN_CALLBACK — FUTURE_FEED_ACTIVATION_REQUIRES_LIFECYCLE_READINESS — ZERO_DEPLOYMENT_OR_FEED_SIDE_EFFECTS — OWNER_CHECKPOINT_AUTHORIZATION_REQUIRED`

