# MARKET SCANNER — PROMPT 23C

## Fast-Track Pack 5 Registered-Route and Final Evidence Acceptance

### One final closure pass — no broad coding or new roadmap work

## 1. Current status

Prompt 23B appears to have corrected the substantive IndianAPI contract defects:

- documented plan hosts are used;
- `/stock?name=` replaces the unverified `/stock_ratios` endpoint;
- invalid configuration is fail-closed with zero calls;
- capability states were corrected;
- Upstox index bootstrap keys are validated against BOD data;
- API-server reports `5,562/5,562` passing;
- five-package TypeScript checking is clean.

Do not revisit these changes unless the final route test exposes a specific defect.

Pack 5 acceptance is withheld for two narrow reasons:

1. The report labels direct invocation of `handleGetFundamentals(req, res)` as a registered-route runtime test. A direct handler call does not execute the production Express registration, path matching, middleware order, authentication, parameter decoding, production serialization or error middleware.
2. The closing report omits several required final-battery results: scanner tests, API/global builds, `git diff --check`, skip/only audit, zero-live-call proof, zero-DB proof and Git/evidence integrity.

This prompt closes only those items.

---

## 2. Anti-loop rules

1. Start immediately; do not perform another provider or website audit.
2. Do not create another provider abstraction, route, schema or UI page.
3. Do not modify production code unless the actual registered-route test reveals a real defect.
4. Do not weaken, delete or replace existing Prompt 23/23A/23B tests.
5. Do not make live provider calls, DB calls, commits, pushes or deployments.
6. Do not create follow-up tasks.
7. Run the full closing battery once after the focused tests pass.

---

## 3. Step 1 — Read-only preflight

Record:

- timestamp, HEAD, branch, upstream/ahead-behind and working-tree state;
- exact production route-registration chain for `GET /api/data/fundamentals/:symbol`;
- middleware executed before the handler;
- error middleware executed after it;
- current handler-direct test and its limitations;
- whether the cross-tab tests render actual components/hooks or merely inspect source text;
- exact test commands available in each package.

Do not edit before this inventory is complete.

---

## 4. Gate A — Actual registered HTTP route execution

Create one focused route test file using the repository’s established Express test harness. Mount the actual production fundamentals router under the same prefix used in production.

The test must send real HTTP requests through Express. Do not call `handleGetFundamentals` directly in this gate.

### Required cases

1. Anonymous request:
   - proves the intended authentication/public-mode boundary;
   - must not accidentally access provider transport.
2. Authorized owner request with valid mocked IndianAPI response:
   - `GET /api/data/fundamentals/RELIANCE`;
   - HTTP 200;
   - JSON content type;
   - production Zod response parse succeeds;
   - decoded `symbol` parameter reaches the canonical service;
   - canonical profile and ratios are present;
   - provider current-price fields do not become canonical live price.
3. URL-encoded symbol/name:
   - Express parameter decoding and safe upstream `URLSearchParams` encoding are proven.
4. Missing credentials:
   - schema-valid not-configured response;
   - no HTTP 500;
   - zero upstream fetches.
5. Invalid plan/host:
   - sanitized fail-closed response;
   - zero upstream fetches;
   - no fallback host.
6. Provider 429:
   - truthful `RATE_LIMITED` response/state;
   - no secret leakage.
7. Timeout or network failure:
   - bounded response;
   - sanitized error;
   - no unhandled rejection.
8. Malformed upstream payload:
   - cannot serialize as a valid success response.
9. Unknown route:
   - existing 404 behavior remains intact.
10. Provider diagnostics route:
   - actual owner middleware protects it;
   - response is redacted.

### Required source wiring proof

In addition to HTTP execution, assert that:

- the same router exported by production is mounted in the test;
- the route is registered exactly once;
- the production Zod schema, not a mirrored test schema, validates the response;
- the real error middleware is included where the production harness permits it.

---

## 5. Gate B — Actual UI/hook runtime confirmation

First classify the existing `p23f2.crossTabRuntime` tests:

- `RUNTIME_COMPONENT_HOOK_PROOF`; or
- `STRUCTURAL_SOURCE_PROOF_ONLY`.

If they already render the actual `FundamentalsCard`/Stock Detail component and execute the production hook contract, report the exact test names and do not duplicate them.

If they are structural only, add the minimum executable component tests required to prove:

1. loading state;
2. valid profile and ratios;
3. missing credentials/not configured;
4. initial error with retry;
5. stale cached data retained with a stale label;
6. null metric rendered as `—`, never zero;
7. IndianAPI `currentPrice` cannot replace the canonical Kite live-price display;
8. Upstox shadow values cannot render as canonical values;
9. browser-side code calls only the canonical application API, never an IndianAPI/Upstox hostname.

Use actual production components/hooks where feasible. Source scanning may supplement but may not be the only proof.

---

## 6. Gate C — Authentication-header contract record

Prompt 23B required the actual IndianAPI authentication contract. The summary does not state it.

Read the production client and record:

- exact header name or query mechanism used;
- the documentation/contract source supporting it;
- confirmation that the value is server-only;
- confirmation that no value, prefix, suffix, length or hash appears in responses, logs, evidence or builds.

If the authentication mechanism is unsupported by the available official/contracted documentation, do not guess. Mark live activation blocked and keep mocked transport tests credential-independent.

No live request is authorized.

---

## 7. Gate D — Final closing battery

After Gates A–C pass, run and report all of the following exactly once:

### Targeted suites

1. New Prompt 23C registered-route tests.
2. Prompt 23B Gate A–F tests with exact per-file totals.
3. Existing Prompt 23/23A tests.
4. B1.1 canonical-provider tests.
5. Pack 4 security/runtime/config tests.
6. Relevant F&O and swing lifecycle non-interference tests.

### Full suites

1. API-server full non-DB suite:
   - accepted floor `5,562` plus legitimate new tests;
   - zero failures;
   - explain any skip.
2. Scanner full suite:
   - accepted floor `947` plus legitimate new tests;
   - zero failures.

### Typechecks

1. API server;
2. API Zod;
3. API client React;
4. scanner;
5. global.

### Production builds

1. API server;
2. scanner;
3. global.

### Integrity checks

1. `git diff --check`.
2. New `.skip`, `.only`, retries and arbitrary-sleep audit.
3. Assertion-weakening audit.
4. Built JS/CSS/HTML scan for provider credential sentinels and server-only configuration.
5. Client-source scan for direct Upstox/IndianAPI host calls.
6. Normal-test zero-live-provider-call proof.
7. Normal-test zero-DB-connection tripwire proof.
8. Confirm `DB_TEST_RUNTIME_AUTHORIZED` is unchanged.
9. Confirm live cash execution and broker hard blocks are unchanged.

No regression exception is allowed.

---

## 8. Git and evidence integrity

Report:

- starting and final HEAD;
- whether HEAD changed during this task;
- branch and upstream;
- ahead/behind;
- tracked, staged and untracked inventory;
- exact changed/new files for Prompt 23C;
- `git diff --stat` and `git diff --name-status`;
- no manual commit;
- no push/pull/fetch;
- no deployment/publish;
- no live provider request;
- no DB operation.

Append the final record to:

`artifacts/audit-evidence/FAST_TRACK_PACK_5_CANONICAL_PROVIDER_INTEGRATION.md`

Include the exact registered-route and component test results, authentication contract record and complete closing battery.

Final nonblank line:

`END_FAST_TRACK_PACK_5_REGISTERED_ROUTE_AND_FINAL_EVIDENCE_ACCEPTANCE`

Report the evidence SHA-256 and prove the terminator occurs exactly once as the final nonblank line.

---

## 9. Final verdict

Use this only if every gate above passes:

`ACCEPT_FAST_TRACK_PACK_5_PROVIDER_INTEGRATION_IMPLEMENTED_SHADOW_ACTIVATION_PENDING`

This verdict means:

- provider code and canonical consumption are complete;
- registered HTTP and UI runtime boundaries are verified;
- Kite remains authoritative;
- Upstox remains shadow-only;
- IndianAPI remains reference/fundamentals-only;
- credentials and authorized live shadow validation may remain pending;
- production deployment remains unverified.

Otherwise return:

`FAST_TRACK_PACK_5_NOT_ACCEPTED — <EXACT_REMAINING_BLOCKER>`

---

## 10. Required final response

Return only:

1. Verdict
2. Registered HTTP route results
3. UI/hook runtime classification and results
4. IndianAPI authentication contract record
5. Exact targeted/full test totals
6. Five typechecks and three builds
7. Integrity/security tripwires
8. Git/evidence integrity
9. Credential/live-activation status
10. Remaining owner action
11. Production status

No execution diary. No broad audit. No new task. No deployment.

`PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`
