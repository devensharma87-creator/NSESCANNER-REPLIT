# PHASE 0.8T — FINAL ATOMICITY AND STARTUP-PROOF CORRECTION

Use **Economy mode**. This is the final narrow correction before Phase 0.8T checkpoint authorization. Do not reopen accepted topology, cost, rollback-identity, registry, subscription-manifest, sharding, authority, or feed-gating work.

## Current blocker

The previous correction materially improved shutdown installation, but three proof gaps remain:

1. The installation state is claimed only after the externally supplied `target.on()` calls complete. A synchronous re-entrant call from `target.on()` can still observe an uninstalled state and enter installation again.
2. Partial rollback uses optional cleanup (`target.off?.(...)`). If the target lacks a supported removal method, rollback is not guaranteed.
3. Startup refusal is asserted by source-position scanning rather than behaviourally proving that `server.listen()` is never called when lifecycle installation fails.

Current verdict:

`PHASE_0_8T_CHECKPOINT_BLOCKED — INSTALLATION_CLAIM_NOT_REENTRANCY_SAFE — PARTIAL_ROLLBACK_NOT_GUARANTEED — STARTUP_REFUSAL_NOT_BEHAVIOURALLY_PROVEN`

## Objective

Close only these three gaps, with production-code behavioural tests. No server restart, boot proof, deployment, provider activity, or broad test repetition.

## Permitted scope

Only the minimum necessary files:

- `artifacts/api-server/src/lib/lifecycle/gracefulShutdown.ts`
- the minimum startup seam in `artifacts/api-server/src/index.ts`, or a small lifecycle/startup helper extracted from it solely to enable behavioural testing
- directly affected Phase 0.8T lifecycle/startup tests
- directly related report or memory correction

Do not change the already accepted rollback runbook unless a factual reference must be corrected.

## Prohibited

- no Publish, deployment, Reserved VM purchase, billing, DNS or secret change
- no production request
- no provider request, Kite login, `KiteTicker`, WebSocket, subscribe/unsubscribe, feed activation, scheduler, registry refresh, database read/write, schema change, dependency change or generated-file change
- no API-server restart, workflow start/stop, controlled boot, browser session, full suite or production build
- no F&O, Swing, candles, indicators or analytical feature work
- no commit, push, merge, rebase, reset, revert, cherry-pick or history rewrite without separate authorization
- all four frozen safety locks must remain exactly `false as boolean`

## A. Make the lifecycle claim genuinely re-entrancy safe

Replace the implicit null/non-null state with an explicit internal installation state:

```ts
type ShutdownInstallationState = "UNINSTALLED" | "INSTALLING" | "INSTALLED";
```

Required state machine:

1. Initial state: `UNINSTALLED`.
2. On the first installation attempt, synchronously transition to `INSTALLING` **before the first call to external code**, including `target.on()`.
3. Any call made while state is `INSTALLING` or `INSTALLED` must return `ALREADY_INSTALLED` (or a more precise `INSTALLATION_IN_PROGRESS`) without touching listeners or replacing the controller.
4. After both listeners are successfully installed and recorded, transition to `INSTALLED`.
5. If any validation or listener installation fails, remove every listener installed by that attempt, clear controller/target/listener references and return to `UNINSTALLED` before propagating the error.
6. `isShutdownInstalled()` must return true only in state `INSTALLED`; it must return false during `INSTALLING` and after rollback.
7. The test reset must remove installed listeners and restore state to `UNINSTALLED`.

Do not rely only on “JavaScript is single-threaded.” `target.on()` is externally supplied executable code and may synchronously re-enter the installer.

## B. Guarantee that rollback capability exists before installing anything

The installation target contract must guarantee a supported listener-removal operation.

Accept either:

- required `on()` and required `off()`; or
- required `on()` plus at least one validated removal method: `off()` or `removeListener()`.

Before transitioning into listener installation:

1. verify the target has a callable `on()`;
2. resolve a callable cleanup function (`off` or `removeListener`);
3. if cleanup is unavailable, refuse/throw before adding any listener and leave state `UNINSTALLED`;
4. use the resolved cleanup function unconditionally during rollback and test reset—no optional chaining that can silently skip removal.

The production `process` target must satisfy the contract without adapters or monkey-patching.

## C. Behaviourally prove startup refusal and ordering

Character-position scanning in `index.ts` is insufficient as the primary proof.

Extract the smallest testable startup function if necessary. It may accept injected dependencies such as:

- server factory/server object;
- lifecycle installer;
- proof-marker function;
- port/listen callback;
- startup error reporter.

The real entry point must call this production function. Do not create a test-only replica of startup logic.

Behavioural requirements:

1. When lifecycle installation throws, `server.listen()` is called **zero times**.
2. When installation returns a refusal (`ALREADY_INSTALLED` or equivalent where startup requires a fresh install), `server.listen()` is called zero times.
3. When installation succeeds, lifecycle state is `INSTALLED` before `server.listen()` is called.
4. The `SHUTDOWN_INSTALLED` proof marker occurs after successful installation and before `server.listen()`.
5. The listening callback occurs after all the above.
6. No provider, feed, scheduler or database dependency may be imported into the extracted startup seam.
7. Existing restoration-before-server-start ordering must remain unchanged.

Source guards may remain as secondary regression locks, but the acceptance evidence must come from executing the production startup function with fakes/spies.

## D. Required targeted tests

Add or correct focused tests proving:

1. initial state is `UNINSTALLED` and `isShutdownInstalled() === false`;
2. state changes to `INSTALLING` before the first `target.on()` call;
3. a target whose first `on()` synchronously re-enters installation cannot install another listener pair or replace the controller;
4. after successful listener installation, state becomes `INSTALLED` and readiness becomes true;
5. exactly one SIGTERM and one SIGINT listener exist after success;
6. a second normal installation changes no listener count and replaces no controller;
7. a target without `off()` and without `removeListener()` is refused before any listener is added;
8. a target using `removeListener()` instead of `off()` rolls back correctly, if that compatibility is supported;
9. failure on the second listener removes the first listener and restores `UNINSTALLED`;
10. reset removes both listeners and restores a clean false baseline;
11. re-entrant failure or thrown callback leaves no partial listener and no stuck `INSTALLING` state;
12. installation throw → production startup function calls `listen()` zero times;
13. installation refusal → production startup function calls `listen()` zero times;
14. installation success → observed call order is `install complete → proof marker → listen`;
15. listening callback cannot run before lifecycle readiness is true;
16. feed activation remains `REFUSED / SHUTDOWN_NOT_INSTALLED` unless installation state is `INSTALLED`;
17. all previously accepted topology, authority, Kite-session, handover and owner-authorization gates remain unchanged;
18. test-only reset/helper functions have zero production callers;
19. no provider, WebSocket, subscription, scheduler, database or deployment behaviour is introduced;
20. all four safety locks remain exactly `false as boolean`.

Tests must not depend on execution order, weaken exact assertions into type checks, or reproduce production logic in the test.

## E. Verification budget

Run only:

- directly affected graceful-shutdown tests;
- directly affected startup/lifecycle tests;
- directly affected feed-activation tests if the readiness accessor changes;
- API-server `tsc --noEmit`;
- `git diff --check`;
- one independent diff review.

If review finds a genuine defect, fix it and rerun only the affected targeted tests. Do not restart the API server or run a controlled boot, full suite, build, browser, provider proof or database evidence pass.

## F. Required report

Report concisely:

1. exact files changed;
2. old state model and new `UNINSTALLED → INSTALLING → INSTALLED` model;
3. exact point at which the exclusive installation claim is acquired;
4. re-entrant `target.on()` test result;
5. target cleanup capability validation;
6. partial-failure rollback proof;
7. production startup function used by both real entry point and tests;
8. behavioural proof that `listen()` is never called on installation throw/refusal;
9. successful runtime call order observed in the test;
10. targeted tests, TypeScript and `git diff --check` results;
11. independent-review findings and corrections;
12. confirmation that the earlier restart was not repeated;
13. Git status, branch, HEAD and any auto-commit disclosure;
14. confirmation that nothing was deployed, purchased, pushed, merged, activated or written to a database;
15. confirmation that all four safety locks remain false;
16. remaining blockers: final checkpoint, Reserved VM publication, pre-publish production identity capture, runtime singleton attestation, current registry authority, Kite-session validation and owner activation authorization.

Do not checkpoint automatically. Stop with:

`PHASE_0_8T_READY_FOR_FINAL_CHECKPOINT — SHUTDOWN_INSTALLATION_REENTRANCY_SAFE — ROLLBACK_CAPABILITY_GUARANTEED — STARTUP_REFUSAL_BEHAVIOURALLY_PROVEN — LISTENING_IMPOSSIBLE_BEFORE_LIFECYCLE_READINESS — ZERO_RUNTIME_OR_FEED_SIDE_EFFECTS — OWNER_CHECKPOINT_AUTHORIZATION_REQUIRED`

