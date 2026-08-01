# MARKET SCANNER — PROMPT 18

## Phase B2.1: Core Website API, UI and Data-State Accuracy

### Instruction to the Replit coder

The automatically generated “Phase A0.3 — Index-F&O Setup Viability and Honest Retirement” task plan is stale. A0.3 is already completed, accepted and frozen.

Do not execute, recreate, edit or reopen that A0.3 task.

B1.1 is accepted:

```text
ACCEPT_B1_1_CANONICAL_LIVE_DATA_BACKBONE
```

Provider activation remains honestly pending:

```text
UPSTOX / INDIANAPI = NOT_CONFIGURED
```

That must not block the roadmap. Execute only Phase B2.1: make the core user-facing website surfaces consume the accepted canonical data contracts and render every state truthfully, efficiently and consistently.

Do not start B2.2, B2.3, B3, B4, B5, B6, B7, Prompt 15, database provisioning or deployment.

Do not change F&O or swing strategy formulas, signal thresholds, weights, vetoes, entry/stop/target logic, paper-admission rules, position sizing or capital ledgers.

No manual commit, push, pull, fetch, publish or deployment is authorized.

---

# 1. B2 delivery subdivision

This phase is intentionally divided so the website is fixed without another unbounded “everything at once” task.

## B2.1 — execute now

Core discovery and monitoring surfaces:

- global application shell and status banners;
- Home dashboard;
- Market Pulse/market overview;
- Watchlist;
- Scanner;
- Deep Scan;
- sector and benchmark summaries displayed on those surfaces;
- common source/freshness components;
- their registered API routes, schemas, clients and React Query behavior.

## B2.2 — not authorized

- Portfolio Analyser;
- individual stock detail;
- charting and drawing tools;
- holdings/resolver UI;
- portfolio P&L analytics.

## B2.3 — not authorized

- Option Chain/OI Lab UI completion;
- Backtest Lab;
- Daily Analysis/reporting surfaces;
- remaining secondary pages.

B3 and B4 will separately address the complete F&O and swing lifecycles.

---

# 2. Governing outcome

For every B2.1 surface, a user must be able to tell:

- what data is being displayed;
- which approved source produced it;
- when it was valid `asOf`;
- whether it is live, delayed, stale, partial, unavailable or informational;
- whether the market is open, closed, degraded or unknown;
- which parts failed when a response is partial;
- whether an empty list means “no matching results” or “data could not be obtained”;
- what safe action, if any, the user should take.

The UI must never convert missing/failed data into:

- `0`;
- an empty successful list;
- “Market is closed”;
- “No opportunities”;
- “No signals”;
- a live/fresh badge;
- a positive/negative market conclusion;
- a fabricated index/sector/benchmark value.

---

# 3. Frozen safeguards

Preserve without stylistic refactoring:

- A0.3 setup-availability/VWAP honesty;
- B0 alert and market-state work;
- B1.1 provider capability, TRADE_GRADE routing, timestamp/freshness and fallback provenance;
- P0.1B ordinary-test zero-PostgreSQL-connection protection;
- existing authentication/subscription/owner authorization;
- established Kite-first provider policy;
- explicit Yahoo informational-only restrictions;
- immutable signal-plan and paper-trading safety gates.

Do not enable the DB runtime lock.

Do not activate Upstox or IndianAPI using guessed endpoints or credentials.

---

# 4. Anti-loop execution protocol

Use this exact sequence:

1. One read-only preflight.
2. One bounded B2.1 route/page inventory.
3. One concise defect matrix.
4. Implement fixes for those defects.
5. Run targeted route/component tests.
6. Run regression/typecheck/build verification once.
7. Write one concise evidence file.
8. Return the result and stop.

Do not repeatedly reread the same files.

Do not create another audit programme or roadmap.

Do not spend the task only documenting issues; implement confirmed B2.1 defects.

If a platform auto-commit changes only documentation, evidence, memory or `attached_assets/`, record it and continue. Stop only for an unexpected production, test, schema, migration, dependency, build or deployment change.

---

# 5. Step 1 — Read-only preflight

Record once:

- IST timestamp;
- branch and HEAD;
- upstream and ahead/behind without fetching;
- tracked, staged and untracked state;
- actual API/web/scanner package names and scripts;
- presence of Prompt 17/17A implementation;
- any pre-existing unexpected source/test modifications;
- provider secret names present/absent without exposing values.

Do not connect to PostgreSQL or a live external provider.

Do not stop for the Prompt 18 attachment or documentation-only auto-commits.

---

# 6. Step 2 — Exact B2.1 surface inventory

Identify the real routes, API clients, schemas, queries and components for:

1. application shell/header/navigation status;
2. Home dashboard;
3. Market Pulse/market overview;
4. Watchlist;
5. Scanner;
6. Deep Scan;
7. sector summaries;
8. benchmark/index summaries;
9. global Kite/data-health banners;
10. shared loading/error/empty/source/freshness components.

For each surface map:

- registered frontend route;
- real production component;
- React Query key and options;
- API client function;
- actual registered backend route;
- production Zod/OpenAPI contract;
- data producer/facade;
- source and `asOf` origin;
- cache TTL/invalidation;
- market-state dependency;
- loading, success, empty, partial, stale, delayed, unavailable and error rendering;
- user actions/refetch behavior;
- direct provider calls bypassing B1.1;
- duplicated requests or redundant transforms.

Search for dangerous fallbacks in B2.1 production paths:

```text
?? []
|| []
?? 0
|| 0
?? "closed"
|| "closed"
marketState="closed"
Market is closed
No opportunities
No signals
Live
Fresh
Yahoo
fetchOptionChain
dataUpdatedAt
Date.now()
```

Classify every hit. Do not mechanically delete safe uses; correct only those that fabricate semantic truth.

---

# 7. Step 3 — Canonical UI/API state contract

Reuse the accepted B1.1 envelope. Do not invent a competing data-provenance model.

Every migrated B2.1 API/surface must distinguish, using existing project naming where possible:

```text
LOADING
READY_LIVE
READY_DELAYED
READY_STALE
READY_PARTIAL
EMPTY_VALID
DEGRADED
UNAVAILABLE
ERROR
CLOSED
```

Required semantics:

## `LOADING`

- request has not produced a usable current result;
- do not show last-session data as current without a stale label;
- do not show zero/empty placeholders as facts.

## `READY_LIVE`

- approved provider;
- authoritative provider/exchange `asOf` exists;
- freshness evaluator says live for the domain/session;
- canonical identity is valid;
- no blocking partial failure.

## `READY_DELAYED`

- delayed/informational source is permitted for this display;
- visible delayed/informational label;
- cannot be interpreted as tradeable.

## `READY_STALE`

- last known data may be shown only with original `asOf`, age and stale label;
- no live badge;
- no tradeable implication.

## `READY_PARTIAL`

- successful records remain visible;
- failed partitions/indices/sectors are enumerated;
- totals and breadth calculations exclude missing partitions rather than treating them as zero;
- no “all market” conclusion when coverage is incomplete.

## `EMPTY_VALID`

- request completed successfully against adequate data coverage;
- filters genuinely matched zero records;
- user-facing copy says no matches/results, not data unavailable.

## `DEGRADED` / `UNAVAILABLE` / `ERROR`

- preserve stable reason code and actionable text;
- do not show “Market is closed” unless the canonical market-status service explicitly says closed;
- do not convert to successful empty data.

## `CLOSED`

- only a fresh authoritative market-status result may establish it;
- display last-close values only if explicitly labelled as previous close/last session;
- weekend, holiday, scheduled close and special-session reasons must be truthful.

---

# 8. Step 4 — Source, timestamp and freshness presentation

Create or consolidate one shared display component/helper for B2.1 data provenance.

It must show context-appropriate information such as:

- source/provider label;
- live/delayed/stale/partial/unavailable state;
- `asOf` in IST;
- age/freshness when useful;
- fallback/secondary-source label;
- coverage or failed-partition count for partial data.

Requirements:

1. Use B1.1 `asOf`; never derive provider freshness only from React Query `dataUpdatedAt`.
2. `dataUpdatedAt` may be used only for local cache/refetch diagnostics.
3. Do not expose tokens, raw URLs, provider account identifiers or verbose internal errors.
4. Avoid technical clutter: ordinary healthy live states may use a compact badge; degraded/stale/partial states require clear detail.
5. Do not claim `LIVE` when timestamp is missing, future-invalid or stale.
6. Yahoo/public-file data must retain delayed/informational/reference wording.
7. Secondary Upstox data, when eventually configured, must remain labelled Upstox; it must never be presented as Kite.
8. Provider `NOT_CONFIGURED` belongs in diagnostics/admin context; normal users should see the resulting capability/state, not secret-setup instructions.

---

# 9. Step 5 — Market-state consistency

All B2.1 surfaces must use the B0/B1.1 canonical market state.

Requirements:

- use `Asia/Kolkata` explicitly;
- use the authoritative holiday/special-session configuration;
- never infer `CLOSED` from an API error, empty data, missing Kite session, failed instruments, stale cache or provider outage;
- prior-session status cannot survive into a new IST trading session as current truth;
- a freshly fetched prior-session payload remains stale/degraded;
- global banner, Home, Market Pulse, Watchlist, Scanner and Deep Scan must agree on state/reason/as-of;
- refetch/invalidate affected queries after Kite authentication or instrument-master recovery;
- closed-market screens must not suppress legitimate historical/reference functionality.

Add one executable parity test that feeds the same canonical state into all B2.1 surface selectors and proves they classify it consistently.

---

# 10. Step 6 — Surface-specific requirements

## 10.1 Global shell and banners

- one authoritative global data-health banner;
- no duplicate/conflicting Kite, market-closed and degraded banners;
- priority order: critical safety block, authentication/instrument issue, stale/partial data, informational notice;
- banner recovery/removal when the incident clears;
- no persistent prior-day banner after successful recovery;
- links/actions must point to real routes.

## 10.2 Home and Market Pulse

- index values retain canonical identity/source/as-of;
- breadth, advances/declines and sentiment calculations must disclose coverage;
- missing constituents are excluded and counted, not converted to zero;
- no bullish/bearish conclusion from inadequate coverage;
- previous close, intraday change and percentage change use the correct denominator/session;
- sector/benchmark cards cannot silently mix providers or timestamps;
- empty/degraded state must not appear as a flat/neutral market.

## 10.3 Watchlist

- NSE/BSE instrument identity remains unambiguous;
- last price, change and percentage use the same canonical quote/session;
- unresolved instruments display an explicit resolution problem;
- stale quotes remain visibly stale;
- one failed symbol does not erase successful symbols;
- sorting places unknown/missing values intentionally rather than as zero;
- add/remove/edit behavior and authorization remain unchanged unless a confirmed bug exists.

## 10.4 Scanner and Deep Scan

- canonical quote/candle data only;
- source/trust tier visible at result or summary level;
- delayed Yahoo results remain `YAHOO_INFO_ONLY`/equivalent and cannot look tradeable;
- partial universe coverage is reported numerically;
- timeouts return partial/degraded results where safe, not false empty success;
- cached results retain original `asOf` and source;
- result counts distinguish scanned, passed, failed, unavailable and cached;
- sorting/filtering cannot promote missing values;
- no duplicate provider fan-out for identical instruments;
- no hidden 198-row or other arbitrary truncation presented as full NSE coverage;
- any deliberate limit must be disclosed and tested.

## 10.5 Sectors and benchmarks

- index/sector composition source/date is explicit where relevant;
- aggregation denominators exclude unavailable members and disclose coverage;
- no mixed-session values;
- benchmark comparison uses aligned timestamps/session;
- missing sector data does not become zero performance.

---

# 11. Step 7 — API, schema and client parity

For every B2.1 API touched:

- use the production Zod schema at the route boundary;
- keep OpenAPI and generated/client types aligned;
- do not maintain inline test mirrors;
- reject contradictory state/source/freshness combinations;
- reject “live” without valid `asOf`/approved source;
- reject closed plus open-session/degraded contradictions;
- represent partial failures structurally;
- preserve stable machine-readable reason codes;
- avoid optional-field ambiguity where the UI needs to distinguish unavailable from absent/not-applicable.

Add parity tests against actual OpenAPI where these contracts are documented.

Do not change a response shape without migrating its real client and production component in the same task.

---

# 12. Step 8 — React Query and cache correctness

For each B2.1 query inspect and correct:

- query key completeness;
- `staleTime`;
- refetch interval;
- refetch on focus/reconnect where appropriate;
- enabled/auth/market-state conditions;
- placeholder/initial data behavior;
- `keepPreviousData` or equivalent stale-data behavior;
- retry policy;
- session-boundary invalidation;
- provider/instrument-recovery invalidation;
- mutation invalidation for Watchlist.

Requirements:

1. Query keys include all inputs that change results.
2. Prior-user or prior-filter data cannot leak into another query identity.
3. Retry is bounded and does not amplify provider outages.
4. `keepPreviousData` may improve UX only when previous data is visibly marked stale/previous.
5. Browser cache age cannot override provider `asOf` freshness.
6. Empty API errors cannot overwrite last-good data as valid empty success.
7. Duplicate components should share/coalesce the same query where appropriate.
8. No arbitrary polling during closed sessions unless the endpoint’s function requires it.

---

# 13. Step 9 — Efficiency and durability

Measure existing B2.1 request behavior with deterministic tests/instrumentation.

Correct confirmed issues involving:

- duplicate API calls;
- N+1 provider requests;
- unbounded concurrent symbol requests;
- repeated transformations on every render;
- unstable query keys;
- oversized API payloads containing unused raw provider data;
- unnecessary high-frequency polling;
- cache invalidation storms;
- unbounded retries;
- missing cancellation/timeouts.

Requirements:

- reuse B1.1 request coalescing and provider rate controls;
- use bounded concurrency;
- preserve partial results safely;
- memoize only where measured/reasonable;
- avoid premature architecture rewrites;
- never trade accuracy for speed;
- never hide stale/failed data to improve appearance.

Report before/after request counts or a deterministic proxy for every performance correction claimed.

---

# 14. Step 10 — Load-bearing tests

Test actual registered routes and actual production components.

At minimum add executable tests for:

## Shared state/provenance

1. live approved data renders live with provider `asOf`;
2. delayed informational data renders delayed and non-tradeable;
3. stale data renders stale with original `asOf`;
4. future-invalid timestamp renders unavailable/degraded;
5. missing timestamp cannot render live;
6. partial data lists failed partitions and coverage;
7. valid empty differs from unavailable/error;
8. API error cannot render “Market is closed”;
9. canonical closed status renders closed;
10. prior-session cached status cannot render current live/closed truth incorrectly;
11. source/freshness component exposes no secret.

## Home/Market Pulse

12. index/benchmark source and timestamp alignment;
13. missing members excluded from breadth denominator;
14. inadequate coverage blocks directional conclusion;
15. previous-close/change/percentage math boundary cases;
16. partial sector failure remains visible and schema-valid.

## Watchlist

17. NSE/BSE identity collision prevention;
18. one failed symbol does not erase others;
19. unresolved/stale symbol rendering;
20. missing numeric values do not sort as zero;
21. watchlist mutation invalidates the correct query only.

## Scanner/Deep Scan

22. delayed Yahoo result remains informational;
23. timeout produces partial/degraded state, not false empty;
24. scanned/passed/failed/unavailable/cached counts reconcile;
25. cache preserves original source/as-of;
26. universe truncation is disclosed;
27. identical requests coalesce;
28. concurrency is bounded;
29. missing values cannot rank above valid values.

## Cross-surface parity

30. one canonical market state produces consistent classifications on all B2.1 surfaces;
31. one canonical provider envelope produces consistent source/freshness labels;
32. global banner and page state cannot contradict each other;
33. real API response parses through production Zod;
34. real client type/component integration compiles;
35. actual OpenAPI parity where applicable.

## Regression safety

36. B1.1 future timestamp remains fail-closed;
37. B1.1 TRADE_GRADE cannot use display fallback;
38. B0 alert/market-state tests remain green;
39. A0.3 VWAP/setup-availability behavior remains green;
40. ordinary tests make zero live-provider calls;
41. ordinary tests make zero PostgreSQL connections;
42. no `.skip`, `.only`, arbitrary sleep, retry masking or assertion weakening.

Use injected IST clocks/calendars. Do not depend on the wall clock.

---

# 15. Step 11 — Verification battery

Run and report exact commands and per-file counts for:

1. new shared state/provenance tests;
2. global shell/banner tests;
3. Home/Market Pulse production component and route tests;
4. Watchlist production component and route tests;
5. Scanner/Deep Scan production component and route tests;
6. sector/benchmark tests;
7. React Query cache/invalidation tests;
8. API Zod/OpenAPI/client parity tests;
9. B1.1 canonical data regression;
10. B0 regression;
11. A0.3 regression;
12. API-server full normal suite under the accepted non-DB config;
13. actual web-application full relevant suite;
14. scanner full suite;
15. API-server typecheck;
16. API-Zod typecheck;
17. API-client typecheck;
18. actual web-application typecheck;
19. scanner typecheck;
20. API-server production build;
21. actual web-application production build;
22. scanner production build;
23. process-wide zero-PostgreSQL-connection tripwire;
24. ordinary-test zero-live-provider-network proof;
25. `git diff --check`.

Inspect actual scripts and package names. Do not silently omit packages or substitute unrelated commands.

If a broad suite fails, identify the exact file/test and prove the classification. Do not call an unidentified failure pre-existing, flaky or timing-related.

---

# 16. Evidence record

Create:

```text
artifacts/audit-evidence/PHASE_B2_1_CORE_WEBSITE_API_UI_DATA_STATE_ACCURACY.md
```

Include:

1. starting/final HEAD and Git state;
2. exact changed-file inventory;
3. B2.1 surface/route/client/schema matrix;
4. defect-to-fix mapping;
5. canonical UI-state truth table;
6. source/freshness rendering matrix;
7. market-state cross-surface parity;
8. API/Zod/OpenAPI/client parity result;
9. React Query/cache corrections;
10. before/after request-efficiency evidence;
11. exact tests and totals;
12. typechecks/builds;
13. zero-DB and zero-live-provider-network results;
14. remaining B2.2/B2.3 inventory;
15. confirmation stale A0.3 task was not executed;
16. confirmation Prompt 15/DB provisioning was not executed;
17. confirmation no strategy logic changed;
18. confirmation no operational-data mutation, commit, push or deployment;
19. SHA-256 after final write;
20. exactly one terminator as the final nonblank line:

```text
END_PHASE_B2_1_CORE_WEBSITE_API_UI_DATA_STATE_ACCURACY
```

Do not append this evidence to A0.3, P0.1B, B0 or B1.1 files.

---

# 17. Acceptance

Return:

```text
ACCEPT_B2_1_CORE_WEBSITE_API_UI_DATA_STATE_ACCURACY
```

only when:

- all B2.1 surfaces use truthful canonical states;
- empty, unavailable, stale, partial, error and closed are distinguishable;
- source and provider `asOf` propagate to the UI;
- no false “Market is closed,” no false zero and no false empty success remain;
- Home/Market Pulse calculations respect coverage and aligned timestamps;
- Watchlist identity/stale/partial behavior is correct;
- Scanner/Deep Scan source, coverage, cache and partial-result behavior is correct;
- APIs, production schemas, clients and components agree;
- relevant efficiency defects are corrected without sacrificing accuracy;
- all required tests/typechecks/builds pass;
- B1.1, B0, A0.3 and DB/network safety remain green.

If an accuracy gate fails, return:

```text
B2_1_NOT_ACCEPTED — <single precise blocker>
```

Upstox/IndianAPI remaining `NOT_CONFIGURED` is not a B2.1 blocker. Do not turn it into a new provisioning task.

Do not start B2.2 or B2.3 in the same task.

---

# 18. Required final response

Return only:

1. **Verdict**
2. **Surfaces and routes migrated**
3. **Production defects fixed**
4. **UI-state truth table**
5. **Source/freshness and market-state parity**
6. **API/schema/client parity**
7. **Cache and efficiency result**
8. **Exact tests and totals**
9. **Typechecks and builds**
10. **Changed-file and Git record**
11. **Evidence SHA-256 and terminator**
12. **Remaining B2.2/B2.3 inventory**
13. **Next roadmap phase — not started**
14. **Production status**

No execution diary. No new audit. No new roadmap. No database provisioning. No deployment.

Production remains:

```text
PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED
```

