# MARKET SCANNER PROMPT 26 — PACK 7 PROVIDER ACTIVATION, SHADOW PARITY AND CROSS-TAB CANONICALIZATION

## 1. Mission

Proceed with Pack 7 for **Stock Scanner Pro only**. Activate and verify Upstox and IndianAPI through the already-built canonical provider backbone without changing the canonical Kite trading path, without allowing shadow data to affect signals or paper trading, and without compromising accuracy anywhere on the website.

This prompt also closes two narrowly defined visual-evidence carryovers from Prompt 25C. Do not create another separate visual-closure task.

Do not create a new roadmap. Execute this bounded prompt directly.

## 2. Project boundary

In scope:

- `artifacts/scanner/**`
- `artifacts/api-server/**`
- `lib/api-zod/**`
- `lib/api-client-react/**`
- relevant audit evidence

Out of scope and frozen:

- `artifacts/global/**` — separate Global Multi Asset Scanner project;
- strategy research or formula changes;
- `FNO_PAPER_V2` and `SWING_PAPER_V2` activation;
- Yahoo retirement;
- operational data deletion or ledger rewriting;
- live broker execution;
- deployment/publish.

## 3. Non-negotiable data policy

### Canonical trading data

- Kite remains the canonical provider for trade-grade live quotes, option chains, candles used by signals, F&O/swing admission, exits, and paper trading.
- Upstox begins in `SHADOW_ONLY` mode. Its values are observation/parity evidence only.
- IndianAPI is limited to its documented and allowlisted fundamentals domains. It must never supply live prices, candles, option chains, trade admissions, exits, targets, stops, P&L marks, or broker decisions.
- Yahoo remains delayed analytics-only during Pack 7. Do not remove it until the separate retirement gate proves complete replacement coverage.

### Shadow non-interference invariant

For every canonical call:

`returned canonical result before shadow dispatch === returned canonical result after shadow dispatch`

Shadow success, timeout, rate limit, malformed data, future timestamp, extreme price, or exception must never change the canonical response or delay it beyond the existing bounded dispatch design.

## 4. Git governance

Record HEAD, branch, upstream, working tree, and current Prompt 25A/B/C evidence terminators.

Documentation/attachment-only platform auto-commits may be recorded and accepted without stopping when the complete intervening range contains no production, test, schema, migration, dependency, build, or deployment file. Stop for any other unexpected HEAD change and report the exact range inventory.

No manual commit, push, pull, fetch, publish, or deployment.

## 5. Gate 0 — Close the two Prompt 25C carryovers

Do not reopen completed Prompt 25A/B logic.

### 0A. Viewport completeness

For the seven Prompt 25C surfaces, ensure the evidence inventory contains all three required viewports:

- 390×844;
- 768×1024;
- 1440×900.

Seven surfaces × three viewports requires at least 21 valid screenshots. Reuse existing valid screenshots and capture only missing combinations.

### 0B. OI Lab state proof

Do not use a generic 503 fixture as proof of all OI Lab states. Build schema-valid, production-shaped deterministic fixtures and visually prove:

- `LOADING`;
- `NO_SNAPSHOTS` with explicit text;
- `BUFFER_WARMING` with one snapshot;
- `RENDERED` with valid chart data;
- provider `ERROR/UNAVAILABLE` as a separate state.

Add rendered-component tests if fixture work reveals a visual regression. The development bypass must remain tree-shaken from production.

Append this carryover proof to the existing Prompt 25 evidence before proceeding to provider activation gates.

## 6. Gate 1 — Redacted configuration and capability preflight

Report only presence/absence and derived mode; never output values.

Check:

- Kite session/capability state;
- `UPSTOX_ANALYTICS_TOKEN` presence;
- `UPSTOX_ACCESS_TOKEN` presence;
- derived `UpstoxAuthMode`;
- `INDIANAPI_API_KEY` presence;
- `INDIANAPI_PLAN` presence and validated plan;
- resolved IndianAPI host from the strict plan→host allowlist;
- current provider routing states.

Required Upstox auth precedence:

1. `UPSTOX_ANALYTICS_TOKEN` → `ANALYTICS_TOKEN`;
2. otherwise `UPSTOX_ACCESS_TOKEN` → `STANDARD_DAILY_TOKEN`;
3. otherwise `NOT_CONFIGURED`.

Fix the policy layer if it activates shadow only for `UPSTOX_ACCESS_TOKEN` and ignores the preferred analytics token.

Invalid IndianAPI plan/host configuration must fail closed with `INVALID_PROVIDER_CONFIG` and zero outbound calls. Do not silently fall back.

If credentials are absent, complete every non-live gate using injected transports and return the exact missing secret names for the live observation gate. Missing credentials must not block code hardening or deterministic tests.

## 7. Gate 2 — Canonical consumer inventory and bypass elimination

Build a machine-readable inventory of every Stock Scanner Pro surface consuming:

- equity quotes;
- index quotes;
- candles;
- option chains;
- fundamentals;
- news/institutional data where applicable.

For each consumer record:

- UI route/component;
- API-client hook/query key;
- backend registered route;
- Zod response boundary;
- canonical facade;
- canonical provider/source policy;
- source/asOf/freshness fields rendered;
- shadow dispatch eligibility;
- trade impact (`NONE`, `ANALYTICS_ONLY`, or `TRADE_GRADE_KITE_ONLY`).

Reject/fix any direct provider SDK/client import from scanner pages or route handlers that bypasses the canonical facade. Test files, provider implementations, and explicitly owner-only diagnostics may import provider modules where architecturally required.

## 8. Gate 3 — Upstox shadow activation and mapping safety

Verify the complete mapping chain before dispatch:

- canonical symbol, exchange, segment, ISIN and instrument key;
- BOD instrument-master cache freshness;
- index bootstrap validation against BOD data;
- single-flight cache refresh;
- no ambiguous symbol-only derivative mapping;
- no stale instrument key after expiry/contract roll.

Shadow dispatch must be fire-and-forget and bounded. It must:

- never substitute, average, merge, vote, or fallback into canonical results;
- never enter signal, paper admission, exit monitoring, P&L or broker paths;
- swallow/log typed shadow failures without altering the canonical response;
- redact tokens and request headers;
- record provider latency and result classification.

Add executable non-interference tests in which Upstox returns:

- an extreme price such as 999,999,999;
- null/malformed payload;
- stale timestamp;
- future timestamp;
- rate limit;
- timeout;
- exception.

The caller must still receive the unchanged Kite result in every case.

## 9. Gate 4 — IndianAPI activation and entitlement safety

Use only the verified plan→host mapping and documented `/stock?name=` contract already accepted in Pack 5.

Verify:

- strict host allowlist;
- `x-api-key` server-side header only;
- plan entitlement/capability state;
- company profile and financial-ratio fields;
- typed unavailable, unauthorized, rate-limited and malformed responses;
- timeout/circuit behavior;
- source/asOf/provenance returned through the canonical fundamentals route;
- no credentials, provider hosts or raw provider errors leak to the client bundle or response.

IndianAPI must remain `UNSUPPORTED` for live quote, candle, option-chain, signal and execution domains.

The Stock Fundamentals UI must call only the canonical Stock Scanner Pro API route. It must render loading, ready, partial, unavailable, rate-limited and error states without fabricated zeros.

## 10. Gate 5 — Shadow parity model

Create a typed parity observation record containing at minimum:

- canonical instrument identity;
- Kite source and `asOf`;
- Upstox source and `asOf`;
- observation timestamp in IST;
- Kite and Upstox latency;
- comparable fields present/missing;
- absolute and basis-point price delta;
- timestamp skew;
- candle interval and OHLC deltas when applicable;
- classification;
- zero trading impact flag.

Required classifications:

- `MATCH_WITHIN_TOLERANCE`;
- `PRICE_DIVERGENCE`;
- `TIMESTAMP_DIVERGENCE`;
- `INSTRUMENT_MISMATCH`;
- `STALE_PROVIDER`;
- `FUTURE_TIMESTAMP`;
- `FIELD_MISSING`;
- `PROVIDER_UNAVAILABLE`;
- `NOT_COMPARABLE`.

Define thresholds centrally and document their purpose. Thresholds are monitoring thresholds only and must not affect trading behavior. Do not invent “corrections” by averaging providers.

Maintain bounded parity samples with aggregation by provider/domain/symbol:

- sample count;
- match count/rate;
- divergence count/rate;
- unavailable count;
- p50/p95 price delta in bps;
- p50/p95 timestamp skew;
- p50/p95 latency;
- latest classification and time.

## 11. Gate 6 — Cross-tab canonical equality

For the same canonical symbol and observation, prove across Home, Watchlist, Scanner, Stock Detail, Charting, Portfolio, Option Chain/OI, and trading surfaces that:

- instrument identity is identical;
- canonical quote/candle value comes from the same canonical response/cache root;
- source and `asOf` are consistent;
- market-open/closed status is consistent;
- different values are permitted only when the metric, timestamp, interval, expiry, strike window, or model scope is visibly different;
- React Query keys include every result-changing parameter;
- errors do not overwrite usable last-good canonical data;
- shadow data never appears as the displayed canonical value.

Use runtime hooks/routes/components where possible, not only source scans.

## 12. Gate 7 — Owner-only diagnostics UI and APIs

Extend the existing provider diagnostics surface rather than creating a parallel dashboard.

Display:

- provider capability and routing state;
- Upstox auth mode without token details;
- IndianAPI plan/capability without key or raw host leakage to public clients;
- last shadow observation;
- sample count and match/divergence rates;
- p50/p95 price delta, skew and latency;
- recent typed failures;
- instrument-mapping failures;
- explicit statement: `Shadow provider data has no trading, signalling, paper-trading, P&L or broker impact.`

Routes must remain owner-only. Anonymous/subscriber access must fail safely. Responses must pass Zod validation and contain no credentials.

## 13. Gate 8 — Deterministic tests

Add load-bearing tests covering at least:

1. analytics-token policy activation;
2. standard-token fallback;
3. absent-token dormant mode;
4. invalid IndianAPI plan/host zero-fetch rejection;
5. mapping correctness and ambiguity rejection;
6. index BOD validation;
7. single-flight refresh;
8. canonical-result immutability under all shadow outcomes;
9. shadow timeout non-blocking behavior;
10. no shadow imports/values in trade paths;
11. IndianAPI entitlement and endpoint contract;
12. fundamentals route and rendered UI states;
13. parity calculations and classifications;
14. bounded sample aggregation;
15. cross-tab canonical equality;
16. query-key completeness;
17. owner-only diagnostics auth;
18. credential/sentinel non-leakage;
19. Prompt 25C viewport and OI-state carryover;
20. Global-project exclusion.

Tests must use injected transports. They must make zero live provider calls and zero DB connections unless an explicitly authorized live observation gate is running.

## 14. Gate 9 — Optional live shadow observation

Run only when all required credentials are present and valid, and only during a suitable observation window. Do not expose values.

Observe a bounded allowlist such as NIFTY, BANKNIFTY, SENSEX and a small equity set with verified mappings. Record parity statistics; do not alter canonical behavior.

If credentials are missing, return:

`LIVE_SHADOW_OBSERVATION_BLOCKED — MISSING: <secret names only>`

This does not invalidate deterministic Pack 7 implementation acceptance, but final provider activation status must remain `PENDING`.

Do not run live observation outside configured rate limits or when market/source timestamps cannot be meaningfully compared.

## 15. Full verification battery

Run and record:

- scanner tests: floor `1,210`;
- API-server non-DB tests: floor `5,673`;
- typechecks: scanner, api-server, api-zod, api-client-react;
- scanner production build;
- API-server production build;
- `git diff --check`;
- `.skip`, `.only`, retry, arbitrary sleep and assertion-weakening audit;
- zero-DB/zero-live-provider proof for deterministic tests;
- built-client credential/provider sentinel scan;
- confirmation that `DB_TEST_RUNTIME_AUTHORIZED` and broker hard blocks remain unchanged;
- confirmation that `artifacts/global/**` is untouched.

Capture authenticated Stock Scanner Pro diagnostics/fundamentals screenshots at 390×844, 768×1024 and 1440×900 using deterministic fixtures. Label them fixture evidence, not live parity evidence.

## 16. Evidence and final verdict

Write:

`artifacts/audit-evidence/FAST_TRACK_PACK_7_PROVIDER_ACTIVATION_SHADOW_PARITY_AND_CROSS_TAB_CANONICALIZATION.md`

Include:

- preflight and Git chronology;
- Prompt 25C carryover closure;
- redacted configuration matrix;
- consumer inventory;
- mapping and non-interference proof;
- IndianAPI entitlement proof;
- parity schema/thresholds/classifications;
- cross-tab equality matrix;
- diagnostics evidence;
- deterministic and optional live results;
- test/build/screenshot inventory;
- exact remaining owner actions and missing secret names;
- confirmation that strategy logic, history, DB data, Yahoo policy, broker execution and Global remained unchanged.

Final nonblank line:

`END_FAST_TRACK_PACK_7_PROVIDER_ACTIVATION_SHADOW_PARITY_AND_CROSS_TAB_CANONICALIZATION`

Return one implementation verdict:

- `ACCEPT_FAST_TRACK_PACK_7_SHADOW_PARITY_IMPLEMENTED_LIVE_ACTIVATION_PENDING`, when deterministic gates pass but credentials/live observation are unavailable; or
- `ACCEPT_FAST_TRACK_PACK_7_PROVIDER_SHADOW_ACTIVATED_AND_PARITY_VERIFIED`, when deterministic and authorized live gates pass; or
- `BLOCKED_PACK_7 — <exact failed mandatory gate>`.

Do not retire Yahoo or begin strategy research in this task. Those remain the next separately gated roadmap stages.
