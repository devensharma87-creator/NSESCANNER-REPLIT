# PHASE 0.8E — CONTROLLED LIVE AUTHORITY REFRESH AND KITE-SESSION PROOF

Use Power mode. This prompt authorizes two tightly bounded development proofs:

1. one authoritative NSE/BSE registry-refresh attempt against current official sources, with a development-database commit only if every accepted gate passes;
2. one Kite `getProfile()` validation attempt against the currently configured Kite session.

This does **not** authorize feed activation, WebSockets, subscriptions, production access, deployment or changing any committed lock.

## Accepted baseline

- Phase 0.8D checkpoint HEAD: `8033c253`.
- Registry-refresh and Kite-validation production compositions are implemented and disabled.
- Registry/feed targeted verification: 679/679 passing.
- Seven locks/authorizations are false.
- `KITE_EXPECTED_USER_ID` has now been added by the owner.

Do not rerun accepted tests or rebuild implementation during preflight.

## Exact authorization granted

This prompt authorizes only:

- read-only preflight inspection of development environment and database identity;
- one logical retrieval of each required official NSE/BSE source for a single registry-refresh attempt;
- no automatic retries;
- no more than one redirect per source and no more than 12 total exchange HTTP transport requests;
- one Kite SDK construction and exactly one `getProfile()` request;
- read-only development DB pre-evidence;
- at most one accepted Schema-5 generation persistence transaction in the development database;
- retention only if that transaction actually inserts a new generation;
- read-only cold-load/post-evidence verification;
- in-memory Kite evidence update through the accepted Phase 0.8C port;
- temporary proof harness files under a throwaway directory, deleted after the proof.

Anything beyond this requires new owner authorization.

## Prohibited

Do not:

- change any of the seven source constants to true, even temporarily;
- allow the platform to auto-commit an enabled lock;
- edit or commit production source merely to run the proof;
- use a production HTTP execution route or create one;
- start a scheduler, timer, retry loop or boot workflow;
- restart the existing API workflow;
- construct `KiteTicker`, open WebSockets or subscribe/unsubscribe;
- call Kite margins, holdings, positions, orders, instruments or any endpoint other than exactly one `getProfile()`;
- call Upstox, IndianAPI, Yahoo or any other provider;
- query or mutate the production database;
- run migrations or change schema;
- publish, deploy, purchase Reserved VM capacity, push or merge;
- print/log secrets, `KITE_EXPECTED_USER_ID`, Kite `user_id`, API key, access token, profile response, source bodies or instrument records;
- retry a failed source/provider call;
- silently substitute cached or third-party data for a failed current official source;
- checkpoint or start Phase 0.8F.

## A. Mandatory preflight before any external call

1. Inspect Git status/HEAD and any auto-commit since `8033c253`. Stop if unrelated runtime changes overlap the production compositions.
2. Confirm all seven locks/authorizations remain false.
3. Confirm `KITE_EXPECTED_USER_ID` is present and non-empty **without printing its value**.
4. Confirm Kite API key/access-token material is present through the existing secret boundary **without printing values**.
5. Resolve the database target using the existing DB boundary and prove it is the development database. Capture safe identity fields only (database name/user/host class without credentials).
6. Stop before all database and external operations if the target is production, ambiguous, or matches the production database identity.
7. Confirm the production database will not be contacted.
8. Derive and list the exact official source ids/hosts and logical request count before execution. Stop if more than the approved limits are required.
9. Confirm the temporary proof mechanism does not import or start the application entry point, route index, scheduler or legacy feed.
10. Record before-state: development manifest row count, latest accepted generation metadata/digest, active in-memory generation metadata if safely available, and `pg_stat_user_tables` counters for the manifest table.

If any preflight item fails, make zero external/provider/database writes and report the exact blocker.

## B. Safe proof mechanism

Do not flip committed authorization constants.

Create a temporary, untracked proof harness in a throwaway directory. It may compose the already-tested production ports with the existing explicitly test/proof-authorized orchestrator factories solely for this owner-authorized development proof.

Requirements:

- harness refuses unless `NODE_ENV` is non-production;
- harness requires an exact one-time local proof flag such as `PHASE_0_8E_OWNER_AUTHORIZED=1` supplied only to that process;
- harness imports no app/server entry point;
- harness never serializes environment values;
- harness enforces request counters and exits non-zero if a limit is exceeded;
- harness records safe coded evidence only;
- harness is deleted after completion;
- no tracked source is changed to enable execution.

If the existing factories cannot be composed safely without a tracked production edit, stop and report. Do not improvise a bypass.

## C. One controlled registry-refresh attempt

Run exactly once using the Phase 0.8D production composition and current official sources.

Required behavior:

1. Fetch each declared required source once, with existing 20-second timeout, 32-MiB cap, exact-200 status, content-type allowlist, redirect/final-host restrictions and no retry.
2. Hash raw bytes and retain only safe source metadata; never print bodies.
3. Run all accepted parsers, truncation/bot-block checks, calendar/timing authority, latest-completed-session resolution, BSE current-reference policy, classification, identity reconciliation, hashes and zero-remainder equations.
4. Re-check authority at commit time using a fresh clock.
5. If any gate fails, perform no persistence and return the exact blocker.
6. If accepted, call the existing transactional `saveRegistryGeneration` once.
7. If duplicate, report `DUPLICATE_GENERATION_ID`; retention must not run.
8. If inserted, retention may run only inside the same accepted transaction.
9. Cold-load and independently verify the exact generation.
10. Promote authority only after successful cold verification.
11. Capture after-state and compare row counts/digests/stat counters.

No second attempt is authorized, even if a transient failure occurs.

## D. One controlled Kite-session validation attempt

Independently of the registry outcome, run at most one Kite validation attempt if Kite preflight passed.

Required behavior:

1. Use the Phase 0.8D production composition.
2. Construct the SDK only after the proof harness’s explicit authorization and secret-presence checks.
3. Make exactly one `getProfile()` call and no other Kite API call.
4. Read only `user_id` from the response.
5. Compare it exactly with `KITE_EXPECTED_USER_ID` inside the secret boundary.
6. Never print either identity; report only `accountIdentityMatched: true|false`.
7. Successful match → accepted VALID in-memory record with the existing next-06:00-IST validity boundary.
8. Mismatch/provider rejection → INVALID and revoke according to accepted policy.
9. Timeout/network/5xx/rate limit/malformed response → distinct PROVIDER_UNAVAILABLE reason; no retry.
10. Capture the safe evidence-port state before and after without exposing secrets or the profile body.

If the current Kite access token is invalid/expired, report it honestly. Do not attempt login or token refresh.

## E. Cross-boundary readiness evaluation

After both attempts, run the production activation-readiness evaluator in-process without starting the feed.

Report all 15 gates and blocker codes, verifying:

- current registry gate reflects the real refresh result;
- Kite-session gate reflects the real validation result and expiry;
- runtime singleton remains unproven until Reserved VM deployment;
- shutdown-lifecycle state is honest for the proof process;
- token reconciliation state is honest and generation-bound;
- owner feed activation and compile-time feed lock still refuse;
- client factory call count is exactly zero;
- socket/subscription counts are zero.

Do not change a gate merely to produce more PASS results.

## F. Evidence and cleanup

1. Delete the temporary harness and its output directory.
2. Confirm no tracked source/test/config file changed.
3. Confirm no unexpected handle/socket remains.
4. Confirm no WebSocket, subscription, scheduler or server listener was created.
5. Confirm request counts:
   - exchange logical/transport requests by safe source id;
   - Kite `getProfile()` count;
   - all other provider calls zero.
6. Confirm DB statements by category and that production DB count is zero.
7. Do not run tests, TypeScript, builds or a real app boot after the proof.

## G. Independent evidence review

Perform one read-only review of the captured safe evidence focused on:

- preflight proved development-only target;
- request limits and no retries;
- exact official-source identities;
- no source/profile/secret payload leaked;
- persistence occurred only after all authority gates;
- duplicate/retention behavior honest;
- cold-load matched committed generation;
- exactly one `getProfile()` and no other Kite call;
- feed/client/socket/subscription counts remained zero;
- all seven locks stayed false.

Do not rerun either live proof to answer a review question.

## H. Required report

Return:

1. preflight verdict and safe environment/database identity;
2. Git/auto-commit state before and after;
3. seven lock values;
4. exact source request plan and actual counts;
5. registry-refresh stage-by-stage result;
6. official/reconciled record counts and zero-remainder equations if reached;
7. generation id, schema/policy, hashes and authority expiry—metadata only;
8. development DB before/after evidence and whether inserted or duplicate;
9. cold-load/promotion result;
10. Kite request count and classified outcome;
11. account identity match Boolean only;
12. session evidence state/validation/expiry metadata;
13. complete 15-gate readiness result;
14. proof of zero WebSockets/subscriptions/client-factory calls;
15. cleanup confirmation;
16. independent review findings;
17. remaining blockers before Reserved VM/live-feed proof.

Successful full-proof verdict:

`PHASE_0_8E_CONTROLLED_DEVELOPMENT_PROOF_COMPLETE — CURRENT_AUTHORITATIVE_REGISTRY_REFRESHED_AND_COLD_VERIFIED — KITE_SESSION_VALIDATED_FOR_EXPECTED_ACCOUNT — ZERO_UNEXPLAINED_UNIVERSE_REMAINDER — ZERO_PRODUCTION_DATABASE_ACCESS — ZERO_WEBSOCKETS_OR_SUBSCRIPTIONS — ALL_SEVEN_AUTHORIZATIONS_REMAIN_FALSE — FEED_REMAINS_DISABLED — OWNER_NEXT_PHASE_AUTHORIZATION_REQUIRED`

If either independent operation fails, use a split honest verdict naming the exact blocker. Do not conceal a registry failure behind a Kite success or vice versa.

Stop after the report. Do not checkpoint, publish, deploy, activate the feed or begin Phase 0.8F.
