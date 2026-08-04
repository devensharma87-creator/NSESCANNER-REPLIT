# MARKET SCANNER — PROMPT 23

## Fast-Track Pack 5: Canonical Upstox and IndianAPI Integration

### Read-only shadow integration, cross-tab data parity, and provider activation readiness

You are working on the Market Scanner repository after completion of Fast-Track Pack 4.

The following checkpoint is accepted and frozen:

- API-server full non-DB suite: **5,282/5,282 passing**.
- Scanner suite: **947/947 passing**.
- TypeScript: API server, API Zod, API client React, scanner, and global app all clean.
- Production builds: API server, scanner, and global app all passing.
- Exact production configuration rejection is verified.
- Live cash swing execution remains disabled.
- Production deployment remains unverified.

Do not reopen or re-audit completed A0, B0, B1.1, B2, or Fast-Track Packs 1–4 unless a new Pack 5 change causes a specific regression in them.

---

## 1. Governing objective

Implement **Upstox** and **IndianAPI** behind the existing canonical market-data backbone so that every website tab consumes consistent canonical data rather than calling providers independently.

The target source policy is:

1. **Kite remains the authoritative live/trading-grade source** during this pack.
2. **Upstox is integrated as a read-only shadow provider** for live quotes, candles, instruments, and option data supported by the owner’s plan.
3. **IndianAPI is integrated as a read-only reference/fundamentals provider** only for capabilities confirmed by its contracted documentation and plan.
4. Yahoo remains analytics-only during this pack. Do not remove it yet; retirement is a later, separate pack after replacement coverage and parity are proven.
5. No Upstox or IndianAPI value may affect signal direction, confidence, entry, target, stop, veto, paper admission, exit monitoring, or broker execution in this pack.

The core invariant is:

> A page or tab must request a canonical domain object. It must never select, merge, average, or silently substitute providers itself.

All provider selection, normalization, freshness, trust, provenance, fallback, and disagreement handling must live in the server-side canonical provider layer.

---

## 2. Anti-loop and scope rules

Follow these rules strictly:

1. Do not ask whether to begin. Start with the scoped preflight and continue.
2. Do not perform another broad website audit.
3. Do not revisit safe-test-database provisioning or operational-residue cleanup.
4. Do not commit, push, pull, fetch, deploy, publish, or place a live order.
5. Do not enable `LIVE_CASH_SWING_ORDER_ENABLED`.
6. Do not weaken assertions, thresholds, trust gates, freshness gates, or existing fail-closed behavior.
7. Do not redesign the UI. Only add the minimum provider/provenance/diagnostic UI needed for this pack.
8. Do not change trading thresholds, confluence weights, setups, targets, stops, vetoes, or admission policies.
9. Do not fabricate an endpoint, provider capability, response field, market status, timestamp, zero, or fallback value.
10. Do not print or persist secret values. Report presence only.
11. If credentials are absent, complete every credential-independent implementation and test. Mark only live shadow activation as blocked; do not stop the whole pack.
12. If an official provider capability is unavailable on the current plan, represent it honestly as `UNSUPPORTED` or `NOT_ENTITLED`. Do not imitate it with another provider under the same label.
13. Make changes in focused batches and run targeted tests before the full battery. Do not repeat successful full batteries without a concrete reason.

---

## 3. Step 1 — Immutable preflight

Before editing:

1. Record timestamp, HEAD, branch, upstream, ahead/behind, tracked changes, staged changes, and untracked files.
2. Classify any intervening HEAD movement by exact commit and file inventory.
3. Attached prompt/evidence-only platform auto-commits may be recorded and accepted as documentation events.
4. Stop only if an intervening change touches production code, tests, schemas, dependencies, migrations, builds, or deployment configuration in a way that overlaps Pack 5.
5. Inventory existing provider abstractions, capability registry, canonical result/meta types, diagnostics, caches, schemas, client types, and provider-facing UI.
6. Record existing environment-variable **names only** for Kite, Upstox, and IndianAPI. Never print values, token prefixes, URLs containing credentials, or headers.

---

## 4. Step 2 — Authoritative capability inventory

Inspect the project and the provider documentation available to the owner. Build a provider/domain matrix before implementation.

At minimum classify:

| Domain | Kite | Upstox | IndianAPI | Yahoo | Intended Pack 5 authority |
|---|---|---|---|---|---|
| Instrument identity/master | inspect | inspect | inspect | inspect | canonical server mapping |
| Live quotes | inspect | inspect | inspect | analytics only | Kite; Upstox shadow |
| Intraday candles | inspect | inspect | inspect | analytics only | Kite; Upstox shadow |
| Historical candles | inspect | inspect | inspect | analytics only | canonical policy |
| Option contracts | inspect | inspect | not assumed | unsupported | Kite; Upstox shadow |
| Option chain/Greeks/OI | inspect | inspect | not assumed | unsupported | Kite; Upstox shadow |
| Expired derivatives | inspect | inspect/entitlement | not assumed | unsupported | capability-dependent |
| Fundamentals/financials | inspect | inspect | inspect | analytics fallback | IndianAPI only if confirmed |
| Corporate actions | inspect | inspect | inspect | analytics fallback | canonical reference policy |
| News/analyst/shareholding | inspect | inspect | inspect | analytics fallback | IndianAPI only if confirmed |

For every cell, use one of:

- `AVAILABLE`
- `NOT_CONFIGURED`
- `AUTH_EXPIRED`
- `NOT_ENTITLED`
- `UNSUPPORTED`
- `DEGRADED`
- `RATE_LIMITED`
- `UNAVAILABLE`

Do not infer IndianAPI endpoint coverage from marketing copy alone. Confirm against the actual accessible contract/documentation. If that cannot be done without credentials, implement an explicit capability manifest and leave unconfirmed domains disabled.

---

## 5. Step 3 — Provider configuration and secret boundary

### 5.1 Required behavior

1. Reuse existing project secret names where they already exist.
2. If no names exist, introduce clear server-only names and document them, for example:
   - `UPSTOX_ANALYTICS_TOKEN` for read-only market-data access, if this matches the chosen official authentication path.
   - `INDIANAPI_API_KEY` for IndianAPI, if this matches the contracted API.
3. Never expose these values through API responses, logs, error strings, diagnostics, HTML, JS bundles, or evidence.
4. Add a redacted configuration snapshot that returns only:
   - configured/not configured;
   - authentication mode;
   - capability state;
   - last successful request time;
   - last failure category;
   - rate-limit state;
   - circuit state.
5. Missing credentials must not crash the app. The provider must become `NOT_CONFIGURED` and remain outside routing.
6. Invalid/expired credentials must become `AUTH_EXPIRED`, with sanitized errors.

### 5.2 Upstox authentication boundary

This pack is read-only. Do not integrate Upstox order placement, portfolio mutation, or trading APIs.

Use the official authentication option appropriate for owner-only read-only market data. Keep token acquisition/rotation separate from the provider adapter. Never initiate an interactive browser login during tests or startup.

### 5.3 IndianAPI boundary

Do not assume an authentication scheme or endpoint path. Model the adapter from the owner’s actual plan documentation. Missing or unconfirmed capabilities remain disabled.

---

## 6. Step 4 — Canonical instrument identity

Implement or extend one canonical instrument registry.

### 6.1 Required identifiers

Where applicable retain:

- canonical internal instrument ID;
- exchange and segment;
- exchange symbol/trading symbol;
- ISIN for cash equities;
- Kite instrument token;
- Upstox `instrument_key`;
- provider-specific token only as provider metadata;
- expiry, strike, option type, lot size, tick size, underlying, and contract status for derivatives.

### 6.2 Mapping rules

1. Treat the Upstox `instrument_key` as the stable Upstox identity; do not rely solely on exchange tokens.
2. Match cash instruments primarily by exchange + ISIN, then by validated symbol rules.
3. Match derivatives by exchange/segment + underlying + expiry + strike + option type.
4. Detect and reject ambiguous, duplicate, missing, expired, and suspended mappings.
5. Never fall back from an unmapped derivative to a similarly named cash instrument.
6. Persist/display mapping provenance and mapping version without exposing provider secrets.
7. Produce deterministic mapping diagnostics:
   - total provider instruments;
   - mapped;
   - unmapped;
   - ambiguous;
   - suspended;
   - expired;
   - duplicate canonical keys.
8. If mapping integrity is insufficient, affected domains fail closed.

---

## 7. Step 5 — Upstox read-only adapter

Implement Upstox through the canonical server provider layer. No component or route may call Upstox directly.

### 7.1 Capability modules

Implement only officially supported and entitled capabilities:

- instrument master ingestion and refresh;
- market quote/OHLC;
- intraday and historical candles;
- WebSocket V3 market feed, if used by the architecture;
- option contracts;
- put/call option chain;
- expired-instrument/candle access only when the plan supports it.

### 7.2 Transport requirements

Every request must have:

- bounded timeout;
- abort/cancellation support;
- typed success and typed failure result;
- sanitized error classification;
- request batching within official limits;
- bounded retry only for retryable failures;
- exponential backoff with jitter;
- explicit 401/403, 404, 429, 5xx, timeout, malformed-payload, and partial-data handling;
- single-flight suppression for identical concurrent requests;
- cache TTL appropriate to the domain;
- circuit-breaker state;
- rate-limit/Retry-After respect;
- no unbounded intervals or request storms.

### 7.3 Normalization

Normalize into existing canonical domain types:

- prices and currency units;
- exchange timestamps to UTC plus IST display metadata;
- candle interval and boundary semantics;
- OI, volume, strike, lot size, tick size, expiry, option type;
- source, source endpoint, requested mode, received time, provider time, age, freshness, trust tier, fallback state, warnings, and correlation ID.

Reject:

- future timestamps outside the accepted clock-skew tolerance;
- stale data outside domain policy;
- incomplete option rows required for trading-grade comparison;
- non-finite, negative, or impossible numeric fields;
- mismatched instrument identity;
- partial pages/batches presented as complete.

### 7.4 WebSocket behavior

If WebSocket V3 is implemented:

- use the official V3 authorization flow;
- reconnect with bounded backoff and jitter;
- restore subscriptions deterministically;
- deduplicate ticks;
- detect sequence/time gaps;
- expose health without token material;
- prevent multiple socket loops per process;
- fall back to the canonical REST refresh policy only for display, never silently for trading-grade data.

---

## 8. Step 6 — IndianAPI reference-data adapter

Implement only capabilities confirmed by contracted documentation/plan.

Potential domains to inventory include:

- company profile and identifiers;
- financial statements;
- ratios and metrics;
- quarterly/annual results;
- shareholding patterns;
- corporate actions and dividends;
- announcements/news;
- analyst views;
- sector/industry classification.

These are not automatically authorized merely because they appear in this list.

### 8.1 Normalization rules

For every accepted value preserve:

- company/instrument identity;
- reporting period and fiscal year;
- standalone versus consolidated scope;
- quarterly versus year-to-date cumulative meaning;
- currency and numeric unit multiplier;
- announced/published/effective timestamps;
- restatement/amendment flag where available;
- source and endpoint;
- fetched time, provider time, age, freshness, and warnings.

Never compare or display financial values until their units and periods are normalized. Missing values remain null/unknown—not zero.

### 8.2 Usage policy

IndianAPI reference data may feed canonical Stock Detail, Daily Analysis, Reports, corporate-action, and research surfaces after schema validation. It must not enter live F&O or swing signal calculations in Pack 5.

---

## 9. Step 7 — Shadow mode and parity engine

### 9.1 Provider states

Add explicit routing states:

- `NOT_CONFIGURED`
- `SHADOW_ONLY`
- `PARITY_PENDING`
- `APPROVED_SECONDARY`
- `DISABLED`

Upstox and IndianAPI start as `NOT_CONFIGURED` or `SHADOW_ONLY`. They must not become `APPROVED_SECONDARY` automatically.

### 9.2 Shadow rules

1. The canonical Kite result is returned to consumers as before.
2. A shadow request may be issued asynchronously within bounded resource limits.
3. Shadow failure must not delay or replace the authoritative response.
4. Store only safe comparison metrics, not secrets or uncontrolled payloads.
5. Never average providers.
6. Never choose the value that looks more favorable.
7. Disagreement must produce diagnostics, not silent substitution.

### 9.3 Comparison metrics

At minimum compare, where supported:

- instrument identity and contract metadata;
- spot/LTP, OHLC, bid/ask, timestamp age;
- candle count, boundary, OHLCV, gaps, and last completed candle;
- option expiry/strike coverage;
- CE/PE LTP, OI, volume, IV/Greeks when semantically comparable;
- missing/extra rows;
- stale/future timestamps;
- provider latency and failure rate.

Define tolerances per domain. Do not use one global percentage. Record exact formulas and units.

### 9.4 Promotion boundary

Pack 5 does not authorize promotion. `APPROVED_SECONDARY` requires a later owner decision based on:

- adequate market-session sample size;
- documented parity thresholds;
- mapping completeness;
- freshness and latency evidence;
- rate-limit stability;
- zero secret leakage;
- no regressions in trading decisions.

---

## 10. Step 8 — Cross-tab consistency

Implement one canonical request/snapshot policy so the same instrument and time window displays the same canonical values across tabs.

### Required proof

1. Dashboard, Watchlist, Stock Detail, Charts, Scanner, Options, OI Lab, Portfolio, Reports, and any shared header/status surface do not select providers independently.
2. All use server canonical APIs or shared client hooks generated from those APIs.
3. The same `snapshotId`/`asOf`/source provenance flows to every relevant consumer.
4. Tabs with different refresh cadences may show different snapshots, but must disclose their `asOf` time and never label older data as current.
5. Missing data remains missing—not zero, flat, bullish, bearish, fresh, or market-closed.
6. No client-side provider merge or direct Upstox/IndianAPI request exists.
7. Provider switching occurs only in canonical server routing and is visible in provenance.

Add a shared, unobtrusive provenance display where useful:

- canonical source;
- as-of time;
- live/delayed/stale/unavailable state;
- shadow comparison status only in owner diagnostics, not noisy public UI.

---

## 11. Step 9 — API, schema, client, and UI contract

Update all layers together:

1. server domain types;
2. production Zod schemas;
3. OpenAPI specification;
4. generated or maintained API client types;
5. scanner/global client hooks;
6. owner diagnostics UI.

Expose safe provider diagnostics through an owner-protected route. Include:

- capability state by provider/domain;
- configured flag;
- routing state;
- last success/failure category;
- freshness/latency aggregates;
- mapping counts;
- rate-limit/circuit state;
- shadow sample count and parity summary;
- activation/promotion state.

Never expose tokens, headers, raw credential URLs, account identifiers, or complete upstream error bodies.

---

## 12. Step 10 — Load-bearing tests

Tests must execute real production adapters/facades with mocked transports. Source-text checks may supplement but never replace behavioral proof.

### 12.1 Provider configuration

Prove:

- absent credentials → `NOT_CONFIGURED`, no upstream call;
- expired/invalid auth → `AUTH_EXPIRED`;
- secret values never appear in errors, diagnostics, logs, API JSON, or built client assets;
- provider failures do not crash startup.

### 12.2 Instrument identity

Prove:

- valid cash and derivative mappings;
- stable Upstox instrument-key preservation;
- ambiguous mapping rejection;
- duplicate key rejection;
- suspended/expired isolation;
- contract mismatch fail-closed behavior.

### 12.3 Transport resilience

Prove:

- timeout and abort;
- 401/403/404/429/5xx classification;
- Retry-After handling;
- bounded retry and jitter;
- circuit opening/recovery;
- single-flight deduplication;
- batch partial-failure honesty;
- malformed and schema-invalid payload rejection;
- no infinite timers or retry loops.

### 12.4 Freshness and normalization

Prove:

- fresh, stale, boundary, future-within-tolerance, and future-beyond-tolerance cases;
- IST/UTC conversions at date/session boundaries;
- candle interval/boundary parity;
- non-finite/impossible numeric rejection;
- null is never converted to zero;
- reporting-period and unit normalization for IndianAPI fixtures.

### 12.5 Shadow non-interference

This is load-bearing:

- changing every Upstox/IndianAPI shadow value to absurd values must not change returned Kite canonical values;
- must not change signal count, direction, confidence, driver, entry, target, stop, veto, paper admission, or exit result;
- shadow timeout/failure must not delay the canonical response beyond the defined bound;
- no provider averaging;
- no silent fallback.

### 12.6 Cross-tab parity

Using real schemas/client selectors and representative fixtures, prove:

- all relevant surfaces resolve the same canonical source/snapshot for the same request;
- no direct provider imports in client applications;
- stale/unknown/error states render honestly;
- provider diagnostics are owner-protected;
- OpenAPI, Zod, server type, and client parity.

### 12.7 Official fixtures

Use sanitized fixtures whose shapes reflect the official/provider-contracted schemas. Do not store real tokens, account data, or uncontrolled production payloads.

---

## 13. Step 11 — Credential-dependent live validation

Do not make live provider calls merely because credentials exist.

If owner authorization for read-only provider validation is absent:

- skip live calls;
- run all mock/contract/integration tests;
- report `LIVE_SHADOW_VALIDATION_NOT_AUTHORIZED`.

If credentials are absent:

- report exact missing secret names only;
- keep provider state `NOT_CONFIGURED`;
- do not block credential-independent completion.

If separately authorized later, live validation must be read-only, low-volume, rate-limited, redacted, and performed during an appropriate market/session window. It must not place, modify, or cancel orders.

---

## 14. Step 12 — Required closing battery

Run once after targeted tests pass:

1. New Pack 5 targeted tests with exact per-file totals.
2. Existing B1.1 canonical provider tests.
3. Existing F&O lifecycle and swing lifecycle boundary tests.
4. All Pack 4 security/runtime tests.
5. API-server full non-DB suite; accepted floor is **5,282 passing** plus legitimate new tests.
6. Scanner full suite; accepted floor is **947 passing** plus legitimate new tests.
7. Typecheck:
   - API server;
   - API Zod;
   - API client React;
   - scanner;
   - global app.
8. Production builds:
   - API server;
   - scanner;
   - global app.
9. `git diff --check`.
10. Audit for new `.skip`, `.only`, retries, arbitrary sleeps, live provider calls in normal tests, secrets, and client-side provider imports.
11. Build-sentinel scan proving no fake or real provider credential can appear in JS/CSS/HTML artifacts.
12. Confirm `DB_TEST_RUNTIME_AUTHORIZED` and live cash execution remain unchanged.

Do not hide or excuse a regression. If a full suite fails, classify and repair the root cause within Pack 5 scope before claiming completion.

---

## 15. Evidence record

Create or update:

`artifacts/audit-evidence/FAST_TRACK_PACK_5_CANONICAL_PROVIDER_INTEGRATION.md`

It must contain:

1. final verdict;
2. exact changed-file inventory;
3. provider capability matrix;
4. exact credential names and presence status—never values;
5. canonical routing policy;
6. instrument mapping results;
7. transport/cache/rate-limit/circuit behavior;
8. normalization/freshness rules;
9. shadow non-interference proof;
10. cross-tab consistency proof;
11. targeted and full test totals;
12. all typecheck/build results;
13. skip/only/secret/build-sentinel audits;
14. Git state and confirmation of no commit/push/deploy;
15. credential-dependent items honestly marked pending;
16. production status.

Final nonblank line:

`END_FAST_TRACK_PACK_5_CANONICAL_PROVIDER_INTEGRATION`

---

## 16. Accepted verdicts

Use exactly one:

### A. Implementation complete; credentials/live shadow validation pending

`ACCEPT_FAST_TRACK_PACK_5_PROVIDER_INTEGRATION_IMPLEMENTED_SHADOW_ACTIVATION_PENDING`

Use only when all credential-independent code/tests/contracts pass, secrets are absent or live validation is unauthorized, and neither provider affects production decisions.

### B. Implementation and authorized live shadow parity verified

`ACCEPT_FAST_TRACK_PACK_5_PROVIDER_INTEGRATION_AND_SHADOW_PARITY_VERIFIED`

Use only when owner-authorized read-only live validation ran successfully, sufficient evidence exists, and providers still remain shadow-only unless separately promoted.

### C. Blocked

`FAST_TRACK_PACK_5_NOT_ACCEPTED — <EXACT_BLOCKER>`

Use only for a real unresolved implementation or regression blocker. Missing credentials alone do not invalidate credential-independent implementation; they block activation only.

---

## 17. Required final response format

Return a concise evidence report—not an execution diary:

1. Verdict
2. Provider capability matrix
3. Canonical source/routing policy
4. Upstox adapter result
5. IndianAPI adapter result
6. Instrument mapping result
7. Shadow non-interference and parity result
8. Cross-tab consistency result
9. Test/typecheck/build totals
10. Credential and activation status
11. Git/evidence integrity
12. Remaining owner actions
13. Production status

Do not create a new unrelated roadmap task. The next roadmap pack after this is professional UI/UX refinement, followed by evidence-based Yahoo retirement and then owner deployment validation.

`PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`
