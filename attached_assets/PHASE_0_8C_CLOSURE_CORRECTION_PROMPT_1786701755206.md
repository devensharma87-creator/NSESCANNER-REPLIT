# PHASE 0.8C — CLOSURE CORRECTION: OWNER AUTH PROOF AND REAL KITE-SESSION EVIDENCE PORT

Use Power mode. This is a narrow correction to the completed Phase 0.8C implementation. Do not repeat or redesign the phase.

## Why correction is required

The Phase 0.8C report is substantially accepted, but two required closure items remain:

1. The owner-only readiness endpoint was proven only for anonymous `401`. The authenticated `200` contract was not exercised; asserting the snapshot directly is not proof that the actual authenticated route returns the same safe payload.
2. `getAcceptedKiteSessionValidationRecord()` reportedly returns `null` unconditionally. That safely blocks activation today, but it gives production no legitimate future path for an independently validated Kite-session record to reach the gate. A permanently-null stub is not a completed evidence boundary.

Correct only these gaps plus any directly resulting test/type errors. Feed activation remains prohibited.

## Restrictions

Do not:

- activate the feed or change any of the five locks;
- call Kite or any provider;
- log in, refresh or validate a real Kite session;
- construct WebSockets or subscribe/unsubscribe;
- start/restart workflows or perform a real server boot;
- read/write a database, refresh the registry or download exchange data;
- publish, deploy, push, merge or change configuration/dependencies/schema;
- weaken `requireOwnerStrict`, introduce a test authentication bypass into production, or expose secrets;
- rerun the already accepted 573-test battery.

## A. Preflight

Inspect current HEAD/status/auto-commits and exact Phase 0.8C diff. Confirm no overlapping unrelated runtime changes. Correct the report’s file inventory arithmetic: list every new and modified file exactly—do not say “modified 5” if seven files are listed.

## B. Real authenticated owner-route proof

Prove the actual `GET /api/data-health/activation-readiness` route through the real authentication middleware:

1. Mount the real router on an isolated ephemeral Express app.
2. Use the repository’s supported owner-session creation/login mechanism. Do not forge a cookie, bypass middleware, replace `requireOwnerStrict`, or add a test-only production branch.
3. Anonymous request must return `401 AUTH_REQUIRED`.
4. Authenticated owner request must return `200`.
5. Compare the complete normalized response tree with the direct production readiness evaluator at the same logical evaluation instant. Do not compare only selected fields.
6. Allow normalization only for explicitly identified wall-clock/request-generated fields. No blocker, gate, lock, generation/hash, socket/ledger or readiness field may be ignored.
7. Assert all 15 gates appear exactly once.
8. Assert `blockingGateIds`/`blockingCodes` equal the aggregate judgment used by the feed boundary.
9. Assert zero credentials, secrets, access tokens, cookies, raw environment values, instrument payloads, provider-token lists or full identity lists appear in keys or values.
10. Shut down only the isolated ephemeral listener and prove no handles remain.

If the supported owner-login path truly cannot be used in an isolated test, stop with:

`PHASE_0_8C_BLOCKED — AUTHENTICATED_OWNER_READINESS_ROUTE_CANNOT_BE_PROVEN_WITH_SUPPORTED_AUTH_FLOW`

Do not substitute a snapshot-only assertion.

## C. Provider-neutral Kite-session evidence port

Replace the permanently-null getter with a real provider-neutral evidence port that can accept only a validated session result from an approved validation adapter in a future authorized phase. Do not implement or call that adapter now.

Required contract:

- record states: `VALID | INVALID | EXPIRED | PROVIDER_UNAVAILABLE`;
- `provider = KITE` fixed by the typed contract;
- `validatedAt`;
- `validUntil`;
- safe `validationPathId` constrained to the existing safe format;
- optional provider/account identity only as a non-secret stable fingerprint if already supported; otherwise omit it;
- no access token, API key, request token, secret, cookie or raw provider response;
- provenance showing the record was produced by the approved validation port, not arbitrary request/config data.

Rules:

1. With no accepted record, the gate remains `NOT_EVALUATED / KITE_SESSION_NOT_EVALUATED`.
2. Merely having credentials remains `NOT_EVALUATED`, never PASS.
3. PASS only for `VALID`, `validatedAt <= now < validUntil`, structurally valid provenance and the approved source.
4. `INVALID`, `EXPIRED`, `PROVIDER_UNAVAILABLE`, malformed, future-dated or expired records fail closed with distinct stable codes.
5. Clearing/replacing a record must be explicit through the port; no environment variable or HTTP route may write it.
6. The store must not persist across process restart unless a future separately authorized durable design is added.
7. A clearly named test reset helper may exist only with zero production callers.
8. Owner diagnostics may expose only safe state/timestamps/path id, never credentials or raw payloads.
9. The final feed boundary must evaluate the record at boundary time, so an expired record cannot remain PASS from an earlier snapshot.

Do not create a fake VALID production record. The real development verdict remains NOT_EVALUATED.

## D. Concurrency and lifecycle

The session-evidence port must have deterministic in-process semantics:

- reject an older record overwriting a newer accepted record unless an explicit invalidation operation is used;
- use copy-on-write or immutable records so callers cannot mutate stored evidence by retaining an object reference;
- reads return immutable/copies;
- no timer/scheduler is needed—expiry is evaluated on read/boundary;
- no database/provider/network dependency.

## E. Targeted tests only

Add/run only the tests directly required for this correction:

### Owner route

- anonymous 401;
- supported owner login/session → 200;
- whole-tree parity with production evaluator;
- 15 unique gates;
- exact blocker parity;
- secret/payload absence;
- zero side effects/handles.

### Kite evidence port

- empty → NOT_EVALUATED;
- credentials alone → NOT_EVALUATED;
- valid accepted record → PASS before expiry;
- exact expiry boundary → FAIL;
- invalid, expired and unavailable → distinct failures;
- future timestamp/malformed interval rejected;
- unapproved source/provenance rejected;
- unsafe `validationPathId` rejected;
- older overwrite rejected;
- explicit invalidation works;
- caller mutation cannot change stored record;
- diagnostics safe;
- final client factory remains uncalled because the compile-time lock and other real blockers remain;
- test reset helper has zero production callers;
- no provider/socket/subscription/DB/timer imports or calls.

Run TypeScript only for api-server and `git diff --check` once. Do not rerun the 573 accepted tests unless production code outside these two surfaces changes.

## F. Independent review

One read-only review focused on:

- authentication not bypassed;
- route/evaluator parity;
- session record cannot be spoofed through HTTP/env/config;
- no secret-bearing fields;
- expiry checked at final boundary;
- immutable record ownership;
- no production test helper callers;
- five locks unchanged.

Fix genuine findings and rerun only affected targeted tests.

## G. Required report

Return:

1. corrected exact file inventory;
2. authenticated route proof method and results;
3. whole-tree parity result and normalized fields;
4. Kite-session evidence-port contract;
5. present real session state;
6. expiry/fail-closed behavior;
7. targeted test/typecheck results;
8. independent review findings;
9. all five lock values;
10. Git/auto-commit status;
11. precise zero-side-effect statement;
12. remaining external/owner actions.

Successful verdict:

`PHASE_0_8C_READY_FOR_CHECKPOINT — AUTHENTICATED_OWNER_READINESS_ROUTE_PROVEN — KITE_SESSION_EVIDENCE_PORT_IMPLEMENTED_WITH_ZERO_PROVIDER_CALLS — EMPTY_SESSION_STATE_REMAINS_NOT_EVALUATED — EXPIRY_RECHECKED_AT_FINAL_BOUNDARY — ALL_FIVE_LOCKS_FALSE — FEED_REMAINS_DISABLED — OWNER_CHECKPOINT_AUTHORIZATION_REQUIRED`

Stop after the report. Do not checkpoint, start Phase 0.8D, publish, refresh authority or activate the feed.
