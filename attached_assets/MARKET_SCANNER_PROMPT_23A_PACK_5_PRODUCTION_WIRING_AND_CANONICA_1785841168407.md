# MARKET SCANNER — PROMPT 23A

## Fast-Track Pack 5 Final Closure

### Production router wiring, Upstox instrument identity, IndianAPI canonical consumption, and exact authentication semantics

## 1. Current verdict

`FAST_TRACK_PACK_5_NOT_ACCEPTED — PRODUCTION_WIRING_AND_CANONICAL_CONSUMPTION_INCOMPLETE`

The Pack 5 foundation is useful and must be preserved:

- shadow routing state and parity buffer;
- bounded Upstox and IndianAPI clients;
- read-only provider facades;
- owner-only diagnostics routes;
- provider capability registry;
- 70 new tests;
- API-server baseline `5,352/5,352`;
- scanner baseline `947/947`;
- five clean typechecks and three passing production builds;
- shadow non-interference tests.

However, the prior report explicitly deferred three tasks that were core Prompt 23 acceptance gates:

1. Upstox equity/derivative instrument-key mapping;
2. real canonical router call-site wiring;
3. IndianAPI fundamentals consumption in the production API/client/UI path.

Isolated adapters and diagnostics do not yet prove that the website uses the new providers through the canonical backbone. Do not create another broad provider layer. Close only these missing boundaries.

---

## 2. Anti-loop instructions

1. Start immediately with a read-only preflight; do not ask whether to begin.
2. Do not reopen completed A0/B0/B1/B2 or Fast-Track Packs 1–4.
3. Do not rewrite the seven Pack 5 foundation files unless a concrete closure defect requires it.
4. Do not add another abstraction parallel to the existing canonical backbone.
5. Do not create new follow-up tasks for any item listed in this prompt.
6. Do not enable live orders, provider promotion, deployment, DB tests, or operational cleanup.
7. Do not require credentials to complete mock-backed production wiring.
8. Do not make live Upstox or IndianAPI calls without separate owner authorization.
9. Do not commit, push, pull, fetch, deploy, or publish.
10. Run targeted tests first, then one final closing battery.

---

## 3. Step 1 — Preflight and exact gap confirmation

Before editing, record:

- timestamp, HEAD, branch, upstream and ahead/behind;
- tracked, staged, and untracked changes;
- exact Pack 5 changed-file inventory;
- current secret-name presence only—never values;
- all current call sites of:
  - canonical quote facade;
  - canonical candle facade;
  - canonical option-chain facade;
  - `dispatchShadowQuote`;
  - `dispatchShadowCandles`;
  - IndianAPI profile/ratio facade;
  - provider-diagnostics router;
- every remaining client-side direct provider import or request.

Confirm whether the reported new routes are actually registered under the production route tree and protected by the real owner middleware.

---

## 4. Gate A — Correct Upstox authentication semantics

The previous report describes `UPSTOX_ACCESS_TOKEN` and “V2 bearer auth.” That is insufficiently precise.

The official Upstox Analytics Token is a long-lived, one-year, read-only token supporting market-data APIs and cannot place or modify orders. Implement explicit authentication modes:

```ts
type UpstoxAuthMode =
  | "ANALYTICS_TOKEN"
  | "STANDARD_DAILY_TOKEN"
  | "NOT_CONFIGURED";
```

### Required behavior

1. Prefer a dedicated server-only `UPSTOX_ANALYTICS_TOKEN` for this personal, read-only integration.
2. Retain `UPSTOX_ACCESS_TOKEN` only if the repository already needs the standard daily token for an existing, separately identified flow.
3. Never silently treat the two token types as interchangeable in diagnostics.
4. Both may use a bearer header at transport level, but configuration and expiry semantics must remain distinct.
5. Diagnostics must disclose mode and configured status only—not the token, length, prefix, suffix, hash, or expiry claim derived by decoding opaque credentials.
6. Missing analytics token must result in `NOT_CONFIGURED`, not a startup failure.
7. The Upstox adapter must remain incapable of order placement. No order endpoint, mutation verb, portfolio mutation, or trading SDK may be imported.
8. Inventory every Upstox endpoint used and record its official API version. Do not label the entire adapter “V2” merely because some REST URLs use `/v2/`.
9. If streaming is present, use the official Market Data Feed V3 authorization/stream path.

### Tests

- analytics token selected when present;
- standard token classified separately;
- neither token present → no upstream call;
- no token material in logs/errors/diagnostics/builds;
- adapter source has no Upstox order/mutation endpoint;
- endpoint-version inventory matches production constants.

---

## 5. Gate B — Canonical Upstox instrument mapping

Implement the missing mapping required before any meaningful quote/candle/option comparison.

### Required canonical fields

- internal canonical instrument ID;
- exchange and segment;
- trading symbol;
- ISIN for cash equity where available;
- Kite instrument token;
- Upstox `instrument_key`;
- provider token only as provider metadata;
- derivative underlying, expiry, strike, option type, lot size and tick size;
- active/suspended/expired status;
- mapping version and source timestamp.

### Mapping rules

1. Use Upstox `instrument_key` as Upstox’s stable identity; do not rely on reusable `exchange_token`.
2. Cash equity primary key: exchange + ISIN. Validated symbol matching may only be a secondary controlled rule.
3. Index key: exchange segment + normalized official index identity.
4. Derivative key: exchange/segment + underlying + expiry + strike + option type.
5. Reject ambiguous, duplicate, incomplete, expired and suspended mappings.
6. Never map a derivative to a cash instrument with a similar name.
7. Never select the first result from an ambiguous list.
8. Mapping failure must suppress the shadow request for that instrument and record an honest mapping diagnostic.

### Required production behavior

Add a deterministic BOD instrument-master loader/cache with:

- JSON schema validation;
- bounded download timeout;
- atomic cache replacement;
- last-known-good retention only when explicitly fresh enough;
- suspended-instrument handling;
- mapping counts and failure categories;
- single-flight refresh;
- no startup crash when the provider is not configured.

### Load-bearing tests

At minimum cover:

- NSE cash equity by ISIN;
- BSE cash equity by ISIN;
- NIFTY/BANKNIFTY/SENSEX index mapping;
- CE and PE contracts;
- futures contract;
- expiry, strike and lot-size mismatch;
- ambiguous symbol collision;
- duplicate `instrument_key`;
- reused `exchange_token` not treated as stable identity;
- suspended and expired instruments;
- malformed/partial BOD payload;
- last-known-good freshness boundary;
- zero silent fallback.

---

## 6. Gate C — Real production canonical-router wiring

The prior report lists router call-site wiring as deferred. Close it now.

### Required wiring

1. Identify the existing canonical production facades for:
   - quotes;
   - candles;
   - option chain/contracts where implemented.
2. After the authoritative Kite result is finalized, dispatch the relevant Upstox shadow request from those real facades.
3. Shadow dispatch must use the canonical mapped `instrument_key`, not raw UI symbols.
4. The authoritative response must be returned without awaiting the shadow network result.
5. If the repository runtime cannot safely detach a promise, use a bounded background mechanism that cannot create unhandled rejections or keep the process alive indefinitely.
6. The shadow result may update only parity/health diagnostics. It must never mutate the returned canonical object, cache entry, trading state, signal context, paper-trade state or DB ledger.
7. Do not dispatch when:
   - provider is `NOT_CONFIGURED`/`DISABLED`;
   - mapping is absent or ambiguous;
   - authoritative result is invalid for comparison;
   - circuit is open;
   - request budget is exhausted.
8. Ensure single-flight/deduplication prevents duplicate shadow calls when multiple tabs request the same canonical snapshot.
9. Wire the provider-diagnostics router into the real production route tree and prove owner middleware executes.

### Production execution tests

Invoke the real canonical facades with mocked transports and prove:

- quote success dispatches exactly one matching Upstox shadow request;
- candle success dispatches exactly one matching request;
- option-chain dispatch occurs only if that adapter/domain actually exists;
- repeated same-snapshot calls are deduplicated;
- missing credentials cause zero Upstox calls;
- mapping failure causes zero Upstox calls;
- shadow timeout, absurd values and thrown errors do not change canonical output;
- exact canonical object deep equality before/after shadow completion;
- signals, confidence, drivers, entries, targets, stops, vetoes, paper admission and exits remain unchanged;
- diagnostics endpoints return 401/403 when unauthorized and valid redacted JSON for owner.

Source-text tests alone are not sufficient for this gate.

---

## 7. Gate D — IndianAPI contracted capability and base-URL correctness

The report confirms only `company_profile` and `financial_ratios`. Preserve that honest scope unless the owner’s actual plan documentation proves more.

### Required behavior

1. Model IndianAPI plan/base-URL selection explicitly. The provider documents different hosts by plan; do not hardcode an unverified host.
2. Configuration should identify the selected plan/host safely without exposing the key.
3. Reject a base URL outside an allowlist of documented IndianAPI hosts.
4. Keep unconfirmed domains `UNSUPPORTED` or `NOT_ENTITLED`.
5. Do not mark live quotes, option chain, financial statements, shareholding, corporate actions, news or analyst data as available merely because the marketing page lists them.
6. If actual contracted documentation/credentials are absent, keep profile and ratios behind validated mocked contracts and report live activation pending.
7. Preserve rate-limit/credit exhaustion as a distinct `RATE_LIMITED` state.

### Tests

- plan-to-host mapping;
- unapproved host rejection;
- missing key → no call;
- 401/403/404/429/5xx categories;
- schema-invalid response rejection;
- null financial fields remain null;
- unit/reporting-period semantics cannot be fabricated;
- unsupported capabilities remain unavailable.

---

## 8. Gate E — Canonical IndianAPI API/client/UI consumption

The previous report deferred “surfacing IndianAPI fundamentals in the UI.” This is a Pack 5 acceptance requirement.

### Server contract

Implement or extend one canonical fundamentals endpoint. The UI must never call IndianAPI directly.

The canonical response must include:

- canonical instrument/company identity;
- validated company profile fields;
- validated ratio fields;
- source and source endpoint category;
- provider `asOf` and server `fetchedAt`;
- freshness/state;
- configured/capability state;
- warnings;
- nulls for unavailable values;
- no secret or raw upstream error body.

Update together:

1. server domain types;
2. production Zod schema;
3. OpenAPI specification;
4. API client React types/hooks;
5. production route registration;
6. actual UI consumer.

### UI scope

Integrate the confirmed data into the most relevant existing surfaces only:

- Stock/Instrument Detail: company profile and ratios;
- Daily Analysis or Reports: only if its existing design has a legitimate place for the same canonical values.

Do not redesign navigation or create a duplicate fundamentals page.

### UI state requirements

- loading;
- initial error with retry;
- stale cached data retained with stale label;
- provider not configured;
- capability unsupported/not entitled;
- empty/null values shown as `—`/unavailable, never zero;
- canonical provenance and as-of time;
- no bullish/green classification from null values;
- no raw provider name presented as a guarantee of accuracy.

### Tests

Use real registered route/schema/client selector/component paths with mocked provider transport:

- valid profile/ratios render;
- missing key renders not-configured state without HTTP 500;
- unsupported field remains absent/null;
- stale data is labelled;
- first-load error differs from cached-data refetch error;
- malformed upstream payload cannot reach the UI as valid data;
- no client source imports Upstox/IndianAPI clients or provider URLs;
- server/Zod/OpenAPI/client parity.

---

## 9. Gate F — Cross-tab canonical consistency

Prove that adding Pack 5 does not create another independent data path.

### Required proof

1. Dashboard, Watchlist, Stock Detail, Charts, Scanner, Options/OI, Portfolio and Reports continue to obtain live market values from canonical server APIs.
2. No tab can choose Upstox, IndianAPI, Kite or Yahoo directly.
3. For the same canonical request/snapshot:
   - price/source/as-of values are consistent across relevant selectors;
   - provider provenance is produced server-side;
   - refresh differences are disclosed by snapshot/as-of time;
   - null remains null.
4. IndianAPI fundamentals do not override Kite live prices.
5. Upstox shadow values do not render as canonical values.
6. Yahoo remains analytics-only and is not expanded by this closure.

Add executable cross-tab selector/component tests, not only a source inventory.

---

## 10. Gate G — Acceptance and regression battery

Run targeted tests first. When all targeted gates pass, run the closing battery once:

1. All Pack 5 and Prompt 23A targeted tests with exact per-file totals.
2. Existing B1.1 canonical-provider tests.
3. F&O lifecycle boundary tests.
4. Swing lifecycle boundary tests.
5. Pack 4 security/runtime/config tests.
6. API-server full non-DB suite: accepted floor `5,352` plus legitimate new tests.
7. Scanner full suite: accepted floor `947` plus legitimate new tests.
8. Five typechecks:
   - API server;
   - API Zod;
   - API client React;
   - scanner;
   - global.
9. Three production builds:
   - API server;
   - scanner;
   - global.
10. `git diff --check`.
11. Audit for new `.skip`, `.only`, retries, arbitrary sleeps and weakened assertions.
12. Scan production client builds for credential sentinels, IndianAPI/Upstox secrets and server-only provider URLs.
13. Prove normal tests make zero live provider calls and zero DB connections.
14. Confirm `DB_TEST_RUNTIME_AUTHORIZED`, live cash execution and broker hard blocks remain unchanged.

Do not claim success with an unreconciled failure.

---

## 11. Evidence update

Append a Prompt 23A closure section to:

`artifacts/audit-evidence/FAST_TRACK_PACK_5_CANONICAL_PROVIDER_INTEGRATION.md`

Required contents:

1. final verdict;
2. exact changed-file inventory;
3. authentication-mode and endpoint-version inventory;
4. instrument mapping implementation/results;
5. exact canonical production call sites wired;
6. shadow non-interference execution proof;
7. IndianAPI contracted capability/host matrix;
8. actual canonical API/client/UI consumers;
9. cross-tab consistency proof;
10. exact test/typecheck/build totals;
11. secret, direct-provider-import, skip/only and live-call audits;
12. Git state and confirmation of no commit/push/deploy;
13. credential/live-validation items marked pending;
14. production status.

Final nonblank line:

`END_FAST_TRACK_PACK_5_PRODUCTION_WIRING_AND_CANONICAL_CONSUMPTION_CLOSURE`

---

## 12. Permitted final verdicts

### If all credential-independent closure gates pass and credentials/live validation remain pending

`ACCEPT_FAST_TRACK_PACK_5_PROVIDER_INTEGRATION_IMPLEMENTED_SHADOW_ACTIVATION_PENDING`

This verdict is valid only when instrument mapping, production router wiring, and canonical API/client/UI consumption are all implemented and tested. Credentials may remain absent.

### If separately authorized live shadow validation also passes

`ACCEPT_FAST_TRACK_PACK_5_PROVIDER_INTEGRATION_AND_SHADOW_PARITY_VERIFIED`

### Otherwise

`FAST_TRACK_PACK_5_NOT_ACCEPTED — <EXACT_REMAINING_BLOCKER>`

Do not create another follow-up task for a requirement in this prompt.

---

## 13. Final response format

Return only the closure record:

1. Verdict
2. Authentication and endpoint-version result
3. Instrument-mapping result
4. Production canonical-router wiring result
5. IndianAPI capability and host result
6. Canonical API/client/UI consumption result
7. Cross-tab consistency and shadow non-interference result
8. Exact test/typecheck/build totals
9. Credential/live-validation status
10. Git/evidence integrity
11. Remaining owner actions
12. Production status

No execution diary. No deployment. No live orders. No new roadmap item.

`PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`
