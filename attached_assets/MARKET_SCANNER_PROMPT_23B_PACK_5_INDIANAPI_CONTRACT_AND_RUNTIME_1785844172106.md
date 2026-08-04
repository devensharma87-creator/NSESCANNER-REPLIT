# MARKET SCANNER — PROMPT 23B

## Fast-Track Pack 5 Final Contract Closure

### IndianAPI plan-host correctness, fail-closed configuration, verified endpoint contract, Upstox index-map validation, and real cross-tab runtime parity

## 1. Current verdict

`FAST_TRACK_PACK_5_NOT_ACCEPTED — INDIANAPI_HOST_CONTRACT_AND_RUNTIME_PARITY_INCORRECT`

Prompt 23A made substantial progress and its passing work must be preserved:

- explicit Upstox authentication modes;
- Upstox BOD instrument cache and canonical mapping;
- quote/candle shadow dispatch from canonical facades;
- canonical fundamentals route, schema, client hook and Stock Detail tab;
- API-server `5,427/5,427`;
- scanner `947/947`;
- five clean typechecks and passing scanner build.

Do not reopen those areas broadly.

One confirmed production correctness defect remains:

```ts
INDIANAPI_HOST_ALLOWLIST = {
  "api.indianapi.in",
  "api2.indianapi.in",
}
```

These are not the plan hosts identified by IndianAPI’s current official documentation. The documented mapping is:

| Plan | Documented host |
|---|---|
| Free / Hobby | `stock.indianapi.in` |
| Developer | `dev.indianapi.in` |
| Growth Analyst | `analyst.indianapi.in` |
| Pro | `pro.indianapi.in` |

The prior implementation also reports that a non-allowlisted URL “falls back to default.” Prompt 23A required rejection, not silent fallback. A silently substituted host can call the wrong plan endpoint and misclassify authentication or entitlement failures.

There is also insufficient evidence that the implemented profile/ratio calls match IndianAPI’s actual endpoint contract and that cross-tab parity is proven through real registered routes/components rather than structural source checks.

Fix only these closure items.

---

## 2. Anti-loop rules

1. Start immediately; do not ask whether to begin.
2. Do not perform another provider, website, F&O, swing, UI or security audit.
3. Do not rewrite working Pack 5 foundations without a specific failing requirement below.
4. Do not create follow-up tasks for any requirement in this prompt.
5. Do not enable provider promotion, live orders, DB tests, deployment or publishing.
6. Do not make live IndianAPI or Upstox requests without separate owner authorization.
7. Missing credentials do not block mocked contract and production-wiring tests.
8. Do not commit, push, pull, fetch or deploy.
9. Run targeted tests first and the full battery once.

---

## 3. Step 1 — Focused preflight

Before editing, record:

- timestamp, HEAD, branch and working-tree state;
- exact current IndianAPI config type, plan enum, base-URL resolver, authentication-header builder and endpoint constants;
- exact production URLs constructed by `getStockProfile` and `getStockRatios`;
- exact registered fundamentals route and client hook;
- exact tests currently described as “cross-tab” tests;
- exact Upstox static index mappings and whether each is validated against the current BOD instrument file;
- credential-name presence only—never values.

Do not rely on the previous summary. Read the production code and report the exact findings.

---

## 4. Gate A — Correct IndianAPI plan and host model

Define an explicit plan model:

```ts
type IndianApiPlan =
  | "FREE"
  | "HOBBY"
  | "DEVELOPER"
  | "GROWTH_ANALYST"
  | "PRO";
```

Use one authoritative mapping:

```ts
const INDIANAPI_PLAN_HOST = {
  FREE: "stock.indianapi.in",
  HOBBY: "stock.indianapi.in",
  DEVELOPER: "dev.indianapi.in",
  GROWTH_ANALYST: "analyst.indianapi.in",
  PRO: "pro.indianapi.in",
} as const;
```

### Required behavior

1. Use `https` only.
2. Reject user/configured base URLs whose hostname does not exactly match the selected plan’s documented hostname.
3. Do not use substring, suffix-only or regex matching that could admit attacker-controlled hosts such as `pro.indianapi.in.example.com`.
4. Reject URLs containing username/password credentials.
5. Reject non-default unexpected ports unless the contracted documentation explicitly requires one.
6. Normalize only safe cosmetic differences such as a trailing slash.
7. Invalid plan or host configuration must produce a typed `INVALID_PROVIDER_CONFIG` state and make zero network calls.
8. Never silently fall back to another host or plan.
9. Remove undocumented `api.indianapi.in` and `api2.indianapi.in` defaults unless the owner provides authenticated contracted documentation proving their use. In the absence of that proof, they must be rejected.
10. Diagnostics may expose selected plan, redacted host and configuration state; they must not expose the API key or raw request headers.

### Required tests

- all five plan mappings;
- exact-host acceptance;
- wrong-plan host rejection;
- undocumented host rejection;
- subdomain-confusion rejection;
- username/password URL rejection;
- `http` rejection;
- unexpected-port rejection;
- trailing-slash normalization;
- invalid plan rejection;
- zero fetch calls on every invalid configuration;
- no silent fallback.

---

## 5. Gate B — Verify the actual IndianAPI endpoint and authentication contract

IndianAPI’s public documentation describes company data through:

```http
GET /stock?name=<company-or-symbol>
```

The documented response includes company profile, current prices, technical data, financials, key metrics, analyst views, shareholding, corporate actions and news in one structured response. The implementation must not invent separate `/profile` or `/ratios` endpoints unless the owner’s subscribed-plan documentation explicitly defines them.

### Required work

1. Inventory the exact endpoint paths currently used by `getStockProfile` and `getStockRatios`.
2. Compare them with current official or authenticated plan documentation.
3. If both functions call invented/unverified endpoints, replace them with one canonical `/stock?name=` transport and separate pure normalizers/selectors for profile and ratios.
4. If authenticated contracted documentation proves different endpoints, preserve them only after recording:
   - exact method;
   - path template;
   - required query parameters;
   - authentication-header name;
   - plan entitlement;
   - response schema version.
5. Do not guess the authentication header. Use the actual contracted documentation/current provider client example.
6. Encode the `name` query parameter with `URL`/`URLSearchParams`; never concatenate unescaped user input.
7. Validate the upstream response before extraction.
8. Preserve missing fields as null/unknown. Do not convert an omitted field to zero, false, bullish, bearish or “current.”
9. Treat the provider’s omission of null-valued fields as missing data—not proof of zero.
10. Keep IndianAPI price fields outside canonical live-price authority. Kite remains the live price source.

### Response-normalization requirements

At minimum normalize confirmed fields into the canonical response:

- ticker/canonical symbol;
- company name;
- industry/sector where provided;
- company profile;
- key metrics/ratios with explicit units;
- provider/fetched timestamps when available;
- source, plan, endpoint category and freshness state;
- warnings and unavailable fields.

If the provider lacks reliable `asOf`, disclose `providerAsOf: null` and use `fetchedAt` separately. Do not fabricate an as-of time.

### Required tests

- official `/stock?name=Reliance`-shape fixture;
- symbol and company-name encoding;
- profile extraction;
- key-metric/ratio extraction;
- missing nested objects;
- omitted null fields remain unknown;
- string-number normalization only where contract permits it;
- invalid/non-finite number rejection;
- malformed JSON/schema rejection;
- 401/403/404/429/5xx classifications;
- no IndianAPI current price can replace Kite canonical price;
- exact endpoint and header proof without secret values.

---

## 6. Gate C — Fail-closed plan entitlement and capability registry

Align the provider capability registry with the selected plan and verified endpoints.

### Required behavior

1. A marketing-page feature is not automatically `AVAILABLE`.
2. A capability is `AVAILABLE` only when:
   - the endpoint contract is implemented and schema validated;
   - the selected plan permits the host/endpoint;
   - required credentials are configured;
   - the provider is healthy.
3. Without credentials, implemented capabilities remain `NOT_CONFIGURED`.
4. Known plan exclusions become `NOT_ENTITLED`.
5. Unimplemented domains remain `UNSUPPORTED`.
6. Invalid plan/host becomes `INVALID_PROVIDER_CONFIG` and zero calls.
7. 429/credit exhaustion becomes `RATE_LIMITED`, not `AUTH_EXPIRED`.
8. Capability diagnostics must not claim live verification when only mocked contract tests ran.

Add executable state-transition tests for all cases.

---

## 7. Gate D — Validate Upstox static index bootstrap against BOD data

Do not reopen the working Upstox mapping layer. Close one durability concern:

1. Treat hardcoded NIFTY/BANKNIFTY/SENSEX `instrument_key` values only as bootstrap candidates.
2. On a valid BOD instrument-master refresh, verify each bootstrap candidate exists with the expected index segment and identity.
3. If a bootstrap key disagrees with BOD data, prefer the validated unique BOD mapping and record a mapping-change diagnostic.
4. If BOD mapping is missing or ambiguous, suppress the affected shadow comparison; do not use an unverified hardcoded key.
5. Add tests for unchanged, changed, missing, ambiguous and wrong-segment index mappings.

This gate must not alter Kite canonical output.

---

## 8. Gate E — Real registered-route and component runtime proof

The previous report describes “12 executable structural tests.” Structural source assertions are insufficient by themselves.

### Required executable proof

Use the real production registrations with mocked provider transport:

1. Invoke the registered `GET /api/data/fundamentals/:symbol` route through the Express app or isolated production router.
2. Prove anonymous/unauthorized access behavior matches the intended policy.
3. Prove configured valid response returns HTTP 200 and passes the production Zod schema.
4. Prove missing credentials returns a truthful schema-valid not-configured response—not HTTP 500.
5. Prove invalid host/plan makes zero provider calls and returns sanitized configuration state.
6. Prove 429, malformed payload and upstream timeout produce truthful bounded responses.
7. Render the actual `FundamentalsCard`/Stock Detail tab using the production hook contract and prove:
   - loading;
   - first-load error and retry;
   - not configured;
   - unsupported/not entitled;
   - valid profile/ratios;
   - stale cached data retained with label;
   - null metrics shown as `—`, never zero;
   - no IndianAPI current-price field replaces the canonical Kite price displayed elsewhere on the page.

### Cross-tab runtime parity

Using actual selectors/hooks/components where practical, prove:

- Dashboard/Watchlist/Stock Detail live price originates from canonical live-price data, not IndianAPI;
- Stock Detail fundamentals originate from the canonical fundamentals route;
- the same canonical live-price fixture produces the same price/source/as-of presentation across relevant tabs;
- Upstox shadow values never render as canonical values;
- no browser bundle or client source directly calls an IndianAPI or Upstox hostname.

Source scans may supplement these tests but cannot replace them.

---

## 9. Gate F — Contract parity and security

Confirm exact parity among:

- server response type;
- production Zod schema;
- OpenAPI schema/path;
- API-client React type and hook;
- rendered UI assumptions.

Prove:

- the actual OpenAPI file is parsed in the test;
- the registered route matches the documented path and method;
- all required/optional/null fields agree;
- no API key, secret header, provider error body or configured credential URL appears in diagnostics or client builds;
- owner-only provider diagnostics remain protected;
- provider configuration cannot be changed through a public route.

---

## 10. Closing battery

After targeted tests pass, run once:

1. All Prompt 23, 23A and 23B targeted tests with exact per-file totals.
2. B1.1 canonical provider tests.
3. F&O and swing lifecycle boundary tests.
4. Pack 4 security/runtime/config tests.
5. API-server full non-DB suite: floor `5,427` plus legitimate new tests.
6. Scanner full suite: floor `947` plus legitimate new tests.
7. Five typechecks:
   - API server;
   - API Zod;
   - API client React;
   - scanner;
   - global.
8. Three production builds:
   - API server;
   - scanner;
   - global.
9. `git diff --check`.
10. Audit for new `.skip`, `.only`, arbitrary sleeps, weakened assertions, direct provider imports and live provider calls in tests.
11. Scan built JS/CSS/HTML for credential sentinels and server-only provider configuration.
12. Confirm zero DB connections, zero live provider calls, zero live orders, unchanged broker hard blocks and unchanged `DB_TEST_RUNTIME_AUTHORIZED`.

No regression exceptions and no unreconciled totals.

---

## 11. Evidence update

Append the Prompt 23B closure record to:

`artifacts/audit-evidence/FAST_TRACK_PACK_5_CANONICAL_PROVIDER_INTEGRATION.md`

Include:

1. final verdict;
2. old incorrect host list and corrected plan-host table;
3. proof that invalid configuration now rejects with zero calls;
4. exact IndianAPI endpoint/header/response contract used;
5. capability/entitlement state matrix;
6. Upstox index BOD validation result;
7. registered-route results;
8. actual component and cross-tab runtime results;
9. schema/OpenAPI/client parity;
10. exact test/typecheck/build totals;
11. secret/direct-call/skip-only audits;
12. Git state and confirmation of no commit/push/deploy;
13. credential/live-validation items still pending;
14. production status.

Final nonblank line:

`END_FAST_TRACK_PACK_5_INDIANAPI_CONTRACT_AND_RUNTIME_PARITY_FINAL_CLOSURE`

---

## 12. Final verdicts

### Accept only when every closure gate passes

`ACCEPT_FAST_TRACK_PACK_5_PROVIDER_INTEGRATION_IMPLEMENTED_SHADOW_ACTIVATION_PENDING`

Credentials may remain absent. This verdict requires correct hosts, verified endpoint contracts, fail-closed configuration, real registered-route/component tests and cross-tab runtime proof.

### Otherwise

`FAST_TRACK_PACK_5_NOT_ACCEPTED — <EXACT_REMAINING_BLOCKER>`

Do not create another task for an item in this prompt.

---

## 13. Final response format

Return only:

1. Verdict
2. Corrected plan-host matrix
3. Endpoint and authentication contract
4. Fail-closed configuration result
5. Capability/entitlement result
6. Upstox index validation result
7. Registered-route and component results
8. Cross-tab runtime parity result
9. Exact test/typecheck/build totals
10. Credential/live-activation status
11. Git/evidence integrity
12. Remaining owner actions
13. Production status

No execution diary. No deployment. No live calls. No new roadmap item.

`PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`
