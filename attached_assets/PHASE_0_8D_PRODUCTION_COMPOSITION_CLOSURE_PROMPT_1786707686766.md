# PHASE 0.8D — PRODUCTION COMPOSITION CLOSURE

Use Power mode. This is a narrow correction to Phase 0.8D, not a repeat of the orchestration work.

## Why this correction is required

The reported orchestration and tests are strong, but the phase is not checkpoint-ready for two reasons:

1. The report says official-source retrieval became an injected port and the review confirmed no provider/database import. That proves the abstract orchestrator, but not a runnable production composition binding it to the accepted official-source retrieval, manifest-store, cold-load and promotion paths.
2. The Kite validator similarly needs a production composition binding the approved `getProfile()` operation and existing secret/session boundary to the abstract adapter—while still refusing before SDK/network access because authorization is false.
3. The impacted verification finished at 948/950. Even if the two failures predate Phase 0.8D, checkpoint closure must repair these stale assertions narrowly or explicitly isolate them in a separately passing baseline test. Do not checkpoint a knowingly red affected suite.

Implement only these corrections. Do not execute either operation.

## Restrictions

Do not:

- make any real provider, exchange or database call;
- download sources or validate a Kite session;
- refresh/persist/promote a real registry generation;
- add an execution HTTP route, scheduler, timer or boot invocation;
- construct WebSockets or subscribe/unsubscribe;
- turn any of the seven locks/authorizations true;
- expose credentials, access tokens, raw provider responses or source payloads;
- publish, deploy, push, merge, restart workflows, change schema/dependencies/configuration, or begin Phase 0.8E;
- weaken stale tests merely to make them green.

## A. Production composition inventory

Before editing, trace the exact production functions for:

- official NSE/BSE source HTTP retrieval and response constraints;
- calendar/timing source retrieval;
- Schema-5 generation building;
- `saveRegistryGeneration`;
- read-only cold load and commitment verification;
- active authority/coverage promotion;
- existing Kite credential/session reader;
- installed Kite SDK construction;
- `getProfile()`;
- expected account identity source;
- Phase 0.8C session-evidence port.

Report which already exist and which require a minimal binding. Do not duplicate accepted implementations.

## B. Registry production composition

Add one production factory/service that binds the existing Phase 0.8D orchestrator to real production ports.

Requirements:

1. The first operation remains the compile-time authorization refusal. With authorization false, factory creation may occur but invoking refresh must call zero network/database/persistence ports.
2. Official-source fetches use the accepted authoritative URLs and strict parser/completeness contracts. No Yahoo/third-party/weekday fallback.
3. Use bounded timeouts, response-size limits, HTTP status/content-type checks and redirect policy already approved in the project; if none exists, define explicit conservative limits and disclose them—do not allow unbounded fetches.
4. Retrieval returns raw bytes plus source URL, retrieved timestamp and hash. Parsing remains in accepted modules.
5. Bind to existing Schema-5 builder/validator, `saveRegistryGeneration`, cold loader and active-authority promotion. Do not reproduce their logic.
6. Environment/database selection must use existing boundaries; no new connection string handling.
7. Promotion must occur only after the exact committed generation cold-loads and verifies.
8. No module-scope IO, no automatic invocation and no route/scheduler.
9. Export a pure readiness description stating `DISABLED` while authorization is false.

If a real production binding cannot be made without introducing a new dependency or guessing an exchange endpoint, stop with the exact missing component. Do not leave another abstract port and call it complete.

## C. Kite production composition

Add one production factory/service binding the Phase 0.8D validator to:

- the existing secret-owned Kite API key/access-token reader;
- expected Kite account/user id from the accepted owner configuration boundary;
- official installed `kiteconnect` SDK;
- `getProfile()` only;
- next-06:00-IST validity boundary already used by `kiteAuth.ts`;
- Phase 0.8C `acceptKiteSessionValidationRecord()`.

Requirements:

1. Authorization false must refuse before SDK import/construction and before credential values are read if possible. At minimum no secret value may leave the secret boundary.
2. Use dynamic SDK loading only inside the authorized operation.
3. Validate `user_id` exactly against expected account identity.
4. Map authentication rejection, timeout, network, rate limit, 5xx and malformed response to the already defined distinct states.
5. Never serialize/log key, token, secret, profile body or balances.
6. No module-scope provider construction and no automatic invocation.
7. Existing valid evidence retention/revocation semantics remain as reported.
8. Production diagnostics expose only safe readiness/result metadata.

Tests must mock the SDK construction boundary. No real Kite call.

## D. Repair the two stale affected tests

Correct only the obsolete assertions:

1. `registryBootRestore.p07b.test.ts` T27 must verify the current supported ordering invariant using `server.listen(...)`, while still proving restoration settles and shutdown protection installs before listening. It must not simply accept either arbitrary string.
2. `p08aSafety.test.ts` P7 must distinguish secret credential keys from the safe owner-identity field `apiKeyOwnerId`. Do not broadly remove `apiKey` detection. Use a structural/key-aware check or a narrowly justified safe field assertion, and continue rejecting actual `apiKey`, access token and secret values.

Add non-vacuity assertions so both repaired guards fail when their protected defect is reintroduced.

## E. Targeted verification

Run only:

- new production-composition tests;
- Phase 0.8D tests;
- the two repaired stale tests;
- directly impacted Phase 0.8C session/readiness tests;
- api-server TypeScript;
- `git diff --check` once.

The affected set must finish fully green. Do not run full repository suites, real builds, boots, browsers, providers or databases.

Required production-composition tests:

- authorization false → zero real-port/SDK/secret/DB calls;
- production factory has no test override;
- test-only composition has zero production callers;
- registry ports bind to accepted builder/store/cold-load/promotion functions;
- Kite path binds only to `getProfile()`;
- fake authorized happy paths reach the injected mocks in exact order;
- sync throw/async reject releases single-flight guard;
- no route/scheduler/boot caller;
- source scan rejects module-scope IO and credential serialization;
- all seven authorization constants false.

## F. Independent review

One read-only review focused on:

- composition is genuinely runnable when separately authorized, not another port-only shell;
- authorization refusal precedes every side effect;
- no duplicated registry logic;
- no real SDK/network/DB call during tests;
- stale test repairs preserve their original safety intent;
- no secret leakage;
- no execution surface or scheduler.

Fix genuine findings and rerun only affected tests.

## G. Required report

Return:

1. exact production bindings created/reused;
2. exact files changed;
3. authorization-before-side-effect ordering;
4. registry production composition call chain;
5. Kite production composition call chain;
6. stale-test repairs and non-vacuity proof;
7. fully green targeted counts and TypeScript;
8. independent review findings;
9. all seven lock/authorization values;
10. Git/auto-commit state;
11. precise zero-side-effect statement;
12. remaining real-world actions.

Successful verdict:

`PHASE_0_8D_READY_FOR_CHECKPOINT — REGISTRY_REFRESH_PRODUCTION_COMPOSITION_BOUND_TO_ACCEPTED_AUTHORITY_PIPELINE — KITE_VALIDATION_PRODUCTION_COMPOSITION_BOUND_TO_GET_PROFILE — AUTHORIZATION_REFUSES_BEFORE_ALL_SIDE_EFFECTS — AFFECTED_TEST_SURFACE_FULLY_GREEN — ALL_SEVEN_AUTHORIZATIONS_FALSE — ZERO_REAL_PROVIDER_SOURCE_OR_DATABASE_CALLS — FEED_REMAINS_DISABLED — OWNER_CHECKPOINT_AUTHORIZATION_REQUIRED`

Stop after reporting. Do not checkpoint, run either operation, publish, deploy or start Phase 0.8E.
