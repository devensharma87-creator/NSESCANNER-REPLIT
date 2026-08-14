# PHASE 0.8E — CALENDAR DIAGNOSTICS, REDIRECT/BUNDLE RETRIEVAL FIX, AND ONE FINAL REGISTRY RETRY

Use Power mode. This combines a narrow production correction with exactly one final registry-refresh proof attempt to avoid paying for separate rounds.

## Accepted results from the first proof

- Development-only database target proved (`heliumdb`/workspace Postgres).
- Kite `getProfile()` was called exactly once and validated the expected account.
- Kite evidence was VALID until the accepted next-06:00-IST boundary.
- Zero WebSockets, subscriptions, feed-client calls or production DB access.
- Registry refresh correctly refused before persistence at `EXCHANGE_CALENDAR_INVALID`.
- Development manifest table remained unchanged.
- All seven authorizations remained false.

Do not repeat Kite validation in this phase. The previous Kite proof is accepted.

## Why correction is required

1. Calendar failure details were collapsed to `EXCHANGE_CALENDAR_INVALID`; the specific calendar blockers were lost.
2. Three official HTML sources redirected and may have returned application shells rather than authoritative embedded content/bundles.
3. The transport budget counted logical requests but not redirect/bundle hops and exceeded its ceiling by one.
4. With no shard plan, readiness reported `SHARD_PLAN_EXCEEDS_PROVIDER_CAPACITY`; missing/unavailable evidence must not be described as proven overflow.
5. The proof redactor blanked safe `tokenReconciliation` diagnostics because it treated every occurrence of “token” as a credential.

Correct these issues, verify with fixtures, then run one—and only one—new registry-refresh attempt.

## Restrictions

Do not:

- call Kite or any other broker/provider;
- repeat `getProfile()`;
- open WebSockets or subscribe/unsubscribe;
- change any of the seven authorization constants;
- access the production database;
- add an execution route, scheduler, timer, retry loop or boot invocation;
- silently accept a page shell, incomplete bundle, cached approximation or weekday fallback;
- weaken calendar floors, source authority, timing requirements or parsing checks merely to obtain a successful run;
- print/log source bodies, instrument records, credentials, secrets or identities;
- make more than one final registry-refresh attempt;
- publish, deploy, push, merge or begin Phase 0.8F.

## A. Preflight and first-proof evidence preservation

1. Inspect Git/auto-commit state and preserve the first proof report as evidence; do not modify accepted results.
2. Confirm all seven locks remain false.
3. Confirm the database target is development-only before any final proof DB access.
4. Read the exact captured source metadata/hashes/status/content lengths from the first attempt if available locally; do not refetch during diagnosis.
5. Trace every calendar blocker from parsers → `buildExchangeCalendar` → orchestrator result → owner diagnostics/proof report.
6. Identify each redirected HTML/application source’s authoritative content-discovery rule from accepted Phase 0.6A code and official-page structure. Do not guess bundle filenames.

## B. Preserve specific calendar blockers

Extend the typed refusal/result contract so calendar resolution retains a bounded, safe list of specific blockers.

Requirements:

- stable blocker codes, source id and validation stage;
- no raw HTML, body fragments, URLs containing secrets, parser exception text or payloads;
- include source validation state, observed byte length and required floor where safe;
- distinguish at least: retrieval failure, redirect-policy failure, content-type failure, page-shell detected, bundle reference absent/ambiguous, bundle retrieval failure, truncation/size floor, table/section missing, parser contradiction, timing not authoritative, calendar-source disagreement and latest-session unresolved;
- orchestrator top-level blocker remains stable while carrying safe sub-blockers;
- owner diagnostics and proof output use the same typed result, not a separate interpretation;
- tests prove two simultaneous blockers are both retained rather than first-error-only.

## C. Redirect-aware authoritative document retrieval

Correct the production retrieval composition for HTML/application sources.

Rules:

1. Use `redirect: "manual"` or an equivalent explicit hop loop.
2. Maximum one HTTP redirect hop per document request unless current official evidence proves another bound is required; never follow an unbounded chain.
3. Validate every redirect target before following: HTTPS, approved host, no credentials in URL, no protocol downgrade, no loop.
4. Count every transport request—including redirects and discovered bundle requests.
5. For an application shell, discover the authoritative script/data asset using a deterministic parser over the served HTML and accepted Phase 0.6A source contract.
6. Bundle/data asset host must remain approved; content type and size bounds apply independently.
7. Reject zero, multiple ambiguous or malformed candidate assets.
8. Reject page shells as authoritative source bytes.
9. Preserve the exact final authoritative asset URL only as safe source metadata and hash; do not hardcode a build-specific fingerprint.
10. Continue enforcing the accepted parser/table/end-boundary/truncation rules after extraction.
11. No cached or third-party fallback.

Do not lower `MIN_ANNUAL_HOLIDAY_EVENTS`, NSE timing byte floors, BSE bundle floors or any authority threshold without separate owner authorization.

## D. Transport budget contract

Replace the misleading logical-only ceiling with a declared per-source transport plan.

Before the final retry, calculate:

- base document requests;
- permitted redirect hops;
- permitted discovered bundle/data requests;
- total maximum exchange transport requests.

Authorize a maximum of **18 exchange transport requests** for the single final retry, with:

- one logical retrieval per required source;
- at most one redirect per document;
- at most one discovered bundle/data request for each application-shell source;
- zero retries after timeout/status/parser failure;
- immediate refusal if count would exceed 18.

Report planned and actual counts by source id and hop type.

## E. Readiness reason correction

Correct `SHARD_PLAN_CAPACITY_ADMITTED` evidence semantics:

- no registry generation/manifest/plan → `NOT_EVALUATED` or FAIL with `SHARD_PLAN_UNAVAILABLE`, not `PROVIDER_CAPACITY_EXCEEDED`;
- only an actually computed requirement above 9,000 may report `PROVIDER_CAPACITY_EXCEEDED`;
- an admitted plan at/below 9,000 reports PASS with exact capacity/headroom metadata;
- malformed plan uses a distinct structural blocker;
- aggregate judgment still fails closed.

Add regression tests for missing, malformed, within-capacity and true-overflow cases.

## F. Safe diagnostic redaction correction

Replace substring-based secret redaction with key-aware structured rules:

- continue rejecting/blanking actual API keys, access tokens, request tokens, refresh tokens, secrets, cookies, authorization headers and credential values;
- preserve safe domain fields such as `tokenReconciliation`, `providerInstrumentTokenCount` or coded reconciliation state only where they contain no secret-bearing values;
- scan both keys and values;
- test that `tokenReconciliation` survives while `accessToken`, `api_key` and bearer values are removed/refused;
- do not expose token/identity lists.

This change must apply to durable proof/diagnostic serializers, not only one harness.

## G. Targeted implementation verification before live retry

Run only new/affected tests:

- calendar blocker propagation;
- manual redirect policy;
- final-host validation;
- redirect loop/hop overflow;
- page-shell detection;
- zero/ambiguous bundle discovery;
- bundle size/content-type/truncation;
- authoritative bundle/table extraction using stored/synthetic fixtures;
- transport request accounting;
- missing plan vs true capacity overflow;
- structured redaction;
- no provider/DB/feed calls during tests;
- all seven locks false.

Run api-server TypeScript and directly impacted registry/readiness tests once. One independent diff review. Fix genuine findings before the retry and rerun only affected tests.

If targeted checks are not fully green, do not perform the live retry.

## H. One final registry-refresh proof attempt

After G passes, the owner authorizes exactly one new registry-refresh attempt against official sources and the development database.

Use the same safe temporary proof-harness constraints as the first attempt:

- non-production process only;
- no tracked lock change;
- no app/server entry point;
- temporary files deleted afterward;
- no Kite/provider call;
- max 18 exchange transport requests;
- no retries;
- current official sources only;
- development DB only;
- at most one accepted persistence transaction;
- cold-load and promotion only after all gates pass.

Capture specific calendar blockers if it fails again. A second live retry is not authorized.

## I. Final proof acceptance

If the calendar succeeds, require:

- all required source validations accepted;
- authoritative current session/timing established;
- BSE current-reference authority accepted;
- Schema-5 generation built;
- zero unexplained classification/reconciliation remainder;
- all manifest/hash/count equations balance;
- mapped live count and 9,000-capacity result derived from the new generation;
- persistence inserted or honest duplicate;
- retention only after real insert;
- exact generation cold-loaded and verified;
- active authority promoted only after cold verification;
- development DB before/after evidence;
- production DB zero access;
- WebSocket/subscription/client-factory counts zero;
- seven authorizations remain false.

If it fails, stop at the exact stage and report every safe sub-blocker. Do not manufacture counts from the old generation.

## J. Required report

Return:

1. files changed and exact correction summary;
2. first-proof root-cause diagnosis from code/evidence;
3. calendar blocker contract;
4. redirect/bundle discovery contract;
5. transport plan and actual request counts;
6. targeted tests/typecheck and independent review;
7. final retry stage-by-stage result;
8. specific calendar sub-blockers if any;
9. registry counts/equations/hashes if reached;
10. dev DB before/after, insert/duplicate/retention result;
11. cold-load/promotion result;
12. corrected 15-gate readiness semantics;
13. structured redaction proof;
14. zero provider/feed/production side effects;
15. seven lock values;
16. Git/auto-commit state;
17. remaining blockers.

Successful verdict:

`PHASE_0_8E_REGISTRY_PROOF_COMPLETE — AUTHORITATIVE_CALENDAR_AND_CURRENT_REFERENCE_VERIFIED — CURRENT_SCHEMA_5_GENERATION_COLD_VERIFIED — ZERO_UNEXPLAINED_REMAINDER — SHARD_CAPACITY_DERIVED_HONESTLY — PRIOR_KITE_SESSION_PROOF_RETAINED_WITHOUT_REPEAT_CALL — ZERO_PRODUCTION_DATABASE_WEBSOCKET_OR_SUBSCRIPTION_ACCESS — ALL_SEVEN_AUTHORIZATIONS_FALSE — FEED_REMAINS_DISABLED — OWNER_CHECKPOINT_AUTHORIZATION_REQUIRED`

If refused, use:

`PHASE_0_8E_REGISTRY_PROOF_BLOCKED — <TOP_LEVEL_CODE> — <SPECIFIC_SUB_BLOCKERS>`

Stop after reporting. Do not checkpoint, publish, deploy, activate the feed or start Phase 0.8F.
