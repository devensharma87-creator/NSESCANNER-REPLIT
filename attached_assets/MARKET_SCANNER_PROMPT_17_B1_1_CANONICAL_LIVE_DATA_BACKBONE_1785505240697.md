# MARKET SCANNER — PROMPT 17

## Phase B1.1: Canonical Live-Market Data Backbone

### Instruction to the Replit coder

Phase B0 is closed for roadmap progression. Do not reopen its alert work unless a new B1.1 executable regression directly proves a defect.

Execute only B1.1: build and migrate the authoritative live-market data backbone used by trade-sensitive website paths.

Do not execute Prompt 15.

Do not provision an isolated database.

Do not change the DB runtime lock.

Do not change F&O or swing strategy formulas, thresholds, confidence weights, vetoes, entries, stops, targets, capital limits or paper-trade admission rules.

Do not redesign the website.

Do not start B1.2 fundamentals/news/FII-DII integration, B2 website-wide UI remediation, B3 F&O lifecycle work, B4 swing work or deployment.

No manual commit, push, pull, fetch, publish or deployment is authorized.

---

# 1. Objective

Create one canonical, source-honest and freshness-aware market-data layer for the highest-risk live paths.

The website must never:

- silently substitute one provider for another;
- label delayed or stale data as live;
- use Yahoo or an unverified public source to admit a tradeable signal;
- mix timestamps or values from multiple providers without explicit provenance;
- use browser receipt time as evidence that the provider payload itself is fresh;
- manufacture a market-closed state when data is missing;
- reuse a prior-session cache as current-session truth;
- expose provider credentials or raw authentication errors;
- create duplicate provider calls when one in-flight request can be shared;
- exceed known provider limits through uncontrolled fan-out.

The backbone must fail safely, expose why data is unavailable, and preserve enough provenance for APIs, diagnostics, UI, signal gates and paper trading to make the same decision.

---

# 2. Frozen work and carry-forward boundary

Preserve:

- A0.3 VWAP and setup-availability honesty;
- the nine-record F&O availability contract;
- B0 alert severity, deduplication, recovery and clock-health corrections;
- B0 market-closed UI guard;
- P0.1B ordinary-test zero-DB-connection safety;
- all existing immutable signal-plan and paper-trading safety rules.

Carry forward one B0 accuracy requirement into the canonical data layer:

> Provider/server payload freshness must be calculated from authoritative payload timestamps and trading-session context. React Query `dataUpdatedAt` may describe local cache receipt age, but it must not independently prove that the underlying market data or `marketStatus` is fresh.

---

# 3. B1 subdivision

This phase is intentionally divided to prevent another oversized implementation.

## B1.1 — execute now

- provider capability inventory;
- canonical envelopes and normalized errors;
- Kite-first live routing;
- controlled Upstox secondary routing where genuinely configured and supported;
- explicit IndianAPI capability state without fabricating endpoints;
- live index/equity quote truth;
- live/historical candle truth required by signal paths;
- instrument/contract-master truth;
- option-chain/OI provenance required by F&O paths;
- canonical market-status and freshness integration;
- rate limiting, request coalescing, cache boundaries and provider health;
- migration of the highest-risk trade-sensitive consumers.

## B1.2 — not authorized

- company fundamentals;
- corporate financial statements;
- shareholding and announcements;
- news;
- FII/DII datasets;
- participant-wise OI not already required by the current trade-sensitive path;
- global indices and lower-priority analytics datasets.

Do not start B1.2 in this task.

---

# 4. Anti-loop execution protocol

Use this exact sequence:

1. One read-only preflight.
2. One focused provider/data-flow inventory.
3. One concise migration map.
4. Implement the canonical contracts and routing.
5. Migrate only the authorized high-risk consumers.
6. Run targeted tests.
7. Run the regression/build battery once.
8. Write one concise evidence file.
9. Return the result and stop.

Do not repeatedly reread the same files.

Do not open a new forensic programme.

Do not spend the task writing plans instead of code.

If a platform auto-commit changes only documentation, evidence, memory or `attached_assets/`, record it and continue. Stop only if an unexpected commit changes production source, tests, schemas, migrations, dependencies, build or deployment configuration.

---

# 5. Step 1 — Read-only preflight

Record once:

- IST timestamp;
- branch and HEAD;
- upstream and ahead/behind without fetching;
- tracked, staged and untracked state;
- actual workspace package names and scripts;
- presence/absence of provider-related environment-variable names without displaying values;
- whether Prompt 16/16A changes are present;
- whether any unexpected source/test changes predate B1.1.

Allowed secret inspection is name/presence only. Never print, hash, partially reveal or test-log any credential value.

Do not connect to PostgreSQL.

---

# 6. Step 2 — Provider and consumer inventory

Search once and read the complete relevant adapters/facades/functions for:

```text
Kite
Zerodha
Upstox
IndianAPI
Indian API
INDstocks
Yahoo
nselib
quote
ltp
ohlc
candle
instrument master
option chain
open interest
marketStatus
marketOpen
source
asOf
fresh
stale
fallback
provider
contractInstrumentToken
```

Inventory the production path for each data domain:

1. index spot quote;
2. equity quote;
3. intraday candles;
4. historical candles;
5. NSE/BSE instrument identity;
6. F&O contract resolution;
7. option-chain strikes, premiums and OI;
8. market calendar/status;
9. quote/candle caches;
10. provider authentication/health state.

For every domain report:

- current producer(s);
- current consumers;
- raw provider timestamp available;
- current source/freshness fields;
- cache key and TTL;
- fallback behavior;
- whether the result can affect signal emission, paper admission, entry, stop, target, exit or P&L;
- whether any silent or mislabeled substitution exists.

Also enumerate every direct provider call that bypasses an existing central facade.

Do not edit until this migration map is complete.

---

# 7. Step 3 — Provider capability truth

Create or consolidate a machine-readable capability registry. Adapt names to existing project conventions, but each provider/domain combination must resolve to an explicit state such as:

```text
AVAILABLE
NOT_CONFIGURED
AUTH_EXPIRED
UNSUPPORTED
DEGRADED
RATE_LIMITED
UNAVAILABLE
```

## 7.1 Provider policy

### Kite

- primary authoritative source for live Indian quotes used by trade-sensitive decisions;
- primary broker/session and order-related source;
- instrument master and contract-token truth where supported;
- never claim availability when the session is absent/expired;
- session absence must fail trade-sensitive live data closed and produce a truthful degraded reason.

### Upstox

- controlled secondary source only for domains proven equivalent and actually configured;
- never silently replace Kite;
- every Upstox result must retain `UPSTOX` provenance through API/UI/gates;
- do not place broker orders or mutate user brokerage state in B1.1;
- if credentials or verified API specification are unavailable, mark `NOT_CONFIGURED`; do not invent endpoints, payloads or successful fixtures.

### IndianAPI

- inspect existing repository integration and documented contracted endpoints;
- do not treat it as an authoritative live tradeable-price source unless the paid contract and executable timestamps/freshness prove that capability;
- for B1.1 expose truthful capability states only for any already-supported trade-sensitive endpoint;
- defer fundamentals/news/FII-DII and unimplemented analytics endpoints to B1.2;
- if credentials/specification are missing, return `NOT_CONFIGURED`/`UNSUPPORTED`, not fabricated data.

### Yahoo

- delayed/informational fallback only according to the accepted project policy;
- never admit `TRADEABLE_SIGNAL`, open a paper trade, choose an order price, or confirm an exit using Yahoo-delayed/stale data;
- retain an explicit informational/delayed label.

### nselib/public exchange files

- reference/EOD/public-file use only where existing code and licensing/availability permit;
- never mislabel a bhavcopy/public file as a live quote stream;
- retain file date and publication time provenance.

### INDstocks or other legacy sources

- classify actual existing use;
- do not expand use in B1.1;
- keep only if source, capability and freshness are explicit;
- mark for later retirement if it duplicates the canonical backbone or violates the approved provider policy.

---

# 8. Step 4 — Canonical data contracts

Implement or consolidate one shared typed envelope for provider-backed market data. Reuse existing accepted types where possible.

It must represent, without fabricated defaults:

- requested canonical instrument identity;
- returned exchange/instrument identity;
- data payload;
- provider/source;
- provider capability/domain;
- exchange timestamp when supplied;
- provider timestamp when distinct;
- application receipt timestamp;
- authoritative `asOf` timestamp;
- IST trading date/session identity;
- measured age/freshness;
- freshness classification;
- quality/completeness state;
- fallback status and reason;
- provider request/trace identifier sanitized for logs;
- normalized error/reason code when unavailable.

Recommended semantic classifications, adapted to existing schemas:

```text
LIVE
DELAYED
STALE
PARTIAL
UNAVAILABLE
```

Requirements:

1. Never populate `asOf` with `Date.now()` merely because the provider timestamp is missing.
2. `receivedAt` and `asOf` must remain distinct.
3. Do not alter exchange timestamps to compensate for local clock drift.
4. Preserve original timezone/epoch semantics and expose normalized IST/UTC values consistently.
5. Reject impossible/future timestamps beyond the justified clock-uncertainty window.
6. Treat missing timestamps as unverified freshness, not live.
7. Preserve partial/missing fields; do not replace them with zero unless zero is the provider’s valid value.
8. Do not use `price || fallbackPrice`; zero/null/missing must be handled intentionally.
9. Do not mix spot, VWAP, candle close, option premium or underlying quote fields.
10. All public API fields must have real Zod/OpenAPI/client parity.

---

# 9. Step 5 — Canonical instrument identity

Build on the existing Kite-master/canonical resolver work. Do not create a second symbol resolver.

For every migrated request, resolve and retain as applicable:

- exchange;
- trading symbol;
- instrument token;
- ISIN for cash equities where available;
- index canonical symbol;
- F&O underlying;
- expiry;
- strike;
- option type;
- segment;
- lot size;
- tick size;
- contract status and source master date.

Requirements:

- no symbol-only joining when token/exchange/expiry/strike is required;
- no NSE/BSE collision;
- no expired contract reused as current;
- no current contract selected from a stale master without an explicit block/degraded state;
- deterministic tie-breaking with evidence;
- `contractInstrumentToken` must remain schema-compatible;
- instrument refresh recovery must invalidate dependent resolution/data caches.

---

# 10. Step 6 — Routing and failover policy

Centralize routing by data domain and decision purpose.

At minimum distinguish purposes such as:

```text
TRADE_DECISION
PAPER_ADMISSION
EXIT_MONITORING
DISPLAY_LIVE
DISPLAY_INFORMATIONAL
HISTORICAL_ANALYSIS
REFERENCE_DATA
```

Required routing rules:

1. Trade-sensitive purposes use only an approved fresh authoritative source.
2. Kite is attempted first where policy designates it primary.
3. Upstox may be used only when:
   - configured and authenticated;
   - the domain is supported;
   - instrument identity is equivalent;
   - the payload timestamp is fresh;
   - the result is explicitly labelled Upstox;
   - the consumer’s policy allows secondary-source use.
4. A secondary result must include the primary failure reason.
5. Yahoo or delayed sources may serve informational display only.
6. No source may be silently promoted from informational to tradeable.
7. If no approved live source exists, return `UNAVAILABLE`/`DEGRADED` and fail trade admission closed.
8. Do not merge quote fields from one provider with timestamps/OI from another into a supposedly single-source object.
9. Cross-provider comparison may exist as diagnostics but must not silently overwrite the selected canonical value.
10. Provider error normalization must preserve whether failure is auth, rate limit, timeout, validation, stale data, unsupported instrument or provider outage.

---

# 11. Step 7 — Freshness and session correctness

Define one tested freshness evaluator using domain, purpose and session context.

Requirements:

- use authoritative provider/exchange `asOf` when available;
- use `receivedAt` only for transport/cache age;
- evaluate dates/times consistently in `Asia/Kolkata` for Indian-market session decisions;
- respect authoritative holiday and special-session configuration;
- never infer live freshness solely from React Query `dataUpdatedAt`;
- verify the payload’s trading date/session identity;
- reject prior-day live payloads during a new open session;
- distinguish closed-market last-known-close display from a live quote;
- use explicit per-domain/per-purpose freshness budgets already justified by project policy;
- if no policy exists, introduce named configuration with boundary tests and document the chosen values;
- no arbitrary scattered millisecond literals;
- stale trade-sensitive data must fail closed;
- informational UI may display stale data only with a visible stale/delayed label and original `asOf`.

Close the B0 carry-forward:

- the options page’s local `dataUpdatedAt` guard may remain as a secondary browser-cache safeguard;
- the canonical server response must independently classify `marketStatus` and data freshness from authoritative payload `asOf` and IST session context;
- a freshly fetched prior-session payload must still be classified stale/degraded, never fresh merely because it was just received.

---

# 12. Step 8 — Cache, concurrency and rate-limit durability

Inspect and consolidate existing caches rather than adding parallel caches.

Requirements:

1. Cache keys include sufficient canonical identity: provider/domain/exchange/instrument/interval/trading session as applicable.
2. Do not let prior-day/session values survive as current live truth.
3. Invalidate dependent caches after instrument-master refresh or authentication recovery.
4. Coalesce identical in-flight requests.
5. Bound concurrency per provider.
6. Respect documented provider quotas/configuration.
7. Normalize rate-limit responses and apply bounded exponential backoff with jitter where safe.
8. No unbounded retry loops.
9. Use circuit-breaker/cooldown behavior for repeated provider failures if an existing abstraction supports it.
10. Do not cache authentication failures as valid empty data.
11. Negative-cache identical failures only for a short justified period.
12. Stale-while-revalidate must never make stale data tradeable.
13. Expose sanitized cache age, last success, failure and circuit state in diagnostics.

---

# 13. Step 9 — Authorized consumer migration

Migrate only the highest-risk existing production consumers in B1.1:

1. `/api/options/signals` live underlying/index inputs;
2. F&O option-chain/premium/OI inputs used for signal display, paper admission or exit monitoring;
3. the `/options` page market/data status contract;
4. `/fno-diagnostics` or its actual registered replacement routes;
5. scanner/index quote path that currently supplies F&O/market-pulse state;
6. instrument/contract resolver calls used by those paths.

For each migrated consumer:

- remove direct provider calls or route them through the canonical facade;
- preserve accepted business logic;
- propagate source, as-of, freshness and normalized reason;
- fail closed where trade-sensitive data is not approved/fresh;
- preserve informational display with honest labels where allowed;
- update real schemas and clients if response fields change.

Do not migrate every low-risk page in the repository during B1.1. Record remaining consumers as the input inventory for B2.

---

# 14. Step 10 — Provider health and diagnostics

Expose sanitized provider/domain health through the existing diagnostics architecture.

At minimum report:

- provider configured/not-configured state;
- auth/session state without tokens;
- domain capability;
- last successful authoritative `asOf` and receipt time;
- current freshness classification;
- last normalized failure reason;
- rate-limit/circuit state;
- selected primary/secondary source for each migrated domain;
- cache age and instrument-master date;
- fallback reason when a secondary/informational source is selected.

Do not expose:

- API keys;
- access/refresh tokens;
- complete request URLs containing credentials;
- raw connection strings;
- full provider response bodies containing account data.

Provider-health incidents must use the accepted B0 alert boundary. Do not create a second alert system or emit success spam.

---

# 15. Step 11 — Load-bearing tests

Use deterministic fixtures and mocked provider transports. Do not call live providers in ordinary CI/test commands.

At minimum add executable tests for:

## Contract and timestamp truth

1. exchange/provider timestamp is preserved as `asOf`;
2. `receivedAt` cannot make an old payload fresh;
3. missing provider timestamp is unverified, not live;
4. prior-day payload received now is stale;
5. future/impossible timestamp is rejected/degraded;
6. zero, null and missing numeric values are distinguished;
7. source and fallback fields survive API serialization;
8. real Zod/OpenAPI/client types remain in parity.

## Provider routing

9. fresh Kite result is selected for trade-sensitive use;
10. expired/missing Kite session fails truthfully;
11. approved fresh Upstox secondary is selected only when policy allows;
12. Upstox result remains explicitly labelled Upstox;
13. primary failure reason accompanies secondary selection;
14. unconfigured Upstox/IndianAPI is `NOT_CONFIGURED`, not simulated success;
15. Yahoo-delayed data cannot become tradeable;
16. no approved live source => paper admission blocked;
17. informational display may use delayed data only with an honest label;
18. provider auth/rate-limit/timeout/stale/unsupported errors normalize distinctly.

## Identity and data mixing

19. NSE/BSE symbols cannot collide;
20. expired F&O contract cannot resolve as current;
21. stale instrument master blocks/degrades contract selection;
22. option premium/OI cannot be paired with a different contract identity;
23. fields from different providers cannot masquerade as one single-source record;
24. instrument refresh invalidates resolution/data caches.

## Cache and rate limits

25. identical concurrent requests coalesce to one provider call;
26. cache key separation by provider/domain/instrument/interval;
27. prior-session cache invalidates at the IST boundary;
28. stale-while-revalidate remains non-tradeable;
29. bounded concurrency is enforced;
30. rate-limit backoff is bounded and does not loop indefinitely;
31. auth failures are not cached as successful empty data.

## Production consumers

32. actual options-signals route uses canonical live input provenance;
33. actual route remains schema-valid under primary, secondary, stale and unavailable states;
34. actual options UI renders source/freshness truth;
35. freshly received prior-day payload does not show fresh/open-live state;
36. actual diagnostics route shows sanitized provider health;
37. paper-admission boundary rejects delayed/stale/unverified data;
38. option-exit monitoring does not use an unauthorized delayed source;
39. A0.3 availability/VWAP behavior remains unchanged;
40. B0 closed/degraded/alert behavior remains unchanged.

## Safety regressions

41. ordinary tests make zero live provider network calls;
42. ordinary tests make zero PostgreSQL connection attempts;
43. no secret value appears in snapshots, logs or evidence;
44. no new `.skip`, `.only`, arbitrary sleep or assertion weakening.

---

# 16. Step 12 — Verification battery

Run and report exact commands and per-file counts for:

1. B1.1 canonical contract tests;
2. provider routing/failover tests;
3. timestamp/freshness tests;
4. cache/rate-limit tests;
5. canonical instrument/contract resolver tests;
6. options-signals production route tests;
7. option-chain/paper-admission/exit boundary tests;
8. options-page production component tests;
9. provider-health/diagnostics tests;
10. A0.3 behavioral regression;
11. B0 alert/market-state regression;
12. API-server normal full suite under the accepted non-DB config;
13. scanner full suite;
14. API-server typecheck;
15. API-Zod typecheck;
16. API-client typecheck;
17. actual web-application typecheck;
18. scanner typecheck;
19. API-server production build;
20. actual web-application production build;
21. scanner production build;
22. process-wide zero-PostgreSQL-connection tripwire;
23. a test-only outbound-network tripwire/proof showing ordinary tests do not reach live providers;
24. `git diff --check`.

Inspect actual package scripts and report exact commands. Do not silently substitute or omit packages.

If a broad suite fails, identify the exact file/test and prove its classification. Do not call an unidentified failure pre-existing, flaky or timing-related.

---

# 17. Provider-credential/specification boundary

The phase must remain useful even when Upstox or IndianAPI is not configured.

Allowed outcomes:

## Full acceptance

Use when the canonical backbone, Kite path and every already-configured authorized secondary path are implemented and tested.

## Bounded partial acceptance

Use only when the backbone and Kite path are complete but an external provider cannot be activated because a required credential or verified contracted endpoint is genuinely unavailable.

In that case:

- implement the capability registry and disabled adapter boundary;
- mark it `NOT_CONFIGURED`/`UNSUPPORTED` honestly;
- do not fabricate calls;
- do not expose or request credentials in chat;
- list the exact secret name or official specification required;
- keep all live decisions safely on the approved available path;
- return the bounded verdict defined below.

Missing external credentials must not cause another broad audit or block completion of the Kite-first canonical backbone.

---

# 18. Evidence record

Create:

```text
artifacts/audit-evidence/PHASE_B1_1_CANONICAL_LIVE_DATA_BACKBONE.md
```

Include:

1. starting/final HEAD and Git state;
2. exact changed-file inventory;
3. provider capability matrix;
4. domain/consumer migration matrix;
5. canonical envelope fields;
6. routing/failover truth table;
7. timestamp/freshness rules and numeric boundaries;
8. cache/rate-limit policy;
9. secrets/network-safety proof;
10. exact tests and counts;
11. typecheck/build results;
12. remaining B1.2/B2 consumers;
13. confirmation Prompt 15/DB provisioning was not executed;
14. confirmation DB runtime lock remains false;
15. confirmation no strategy thresholds/formulas changed;
16. confirmation no operational data mutation, commit, push or deployment;
17. SHA-256;
18. exactly one final terminator as the last nonblank line:

```text
END_PHASE_B1_1_CANONICAL_LIVE_DATA_BACKBONE
```

Do not append this to A0.3, P0.1B or B0 evidence files.

---

# 19. Verdicts

Return:

```text
ACCEPT_B1_1_CANONICAL_LIVE_DATA_BACKBONE
```

only if:

- the canonical envelope/routing/freshness layer is production-integrated;
- Kite-first trade-sensitive paths are migrated;
- every configured secondary path is truthful and tested;
- stale/delayed/unverified data cannot become tradeable;
- authorized consumers and diagnostics are migrated;
- all required tests/typechecks/builds pass;
- no provider secret or live test call is exposed;
- A0.3, B0 and DB-safety regressions remain green.

If the backbone/Kite path passes but an external provider is not configured, return:

```text
B1_1_ACCEPTED_WITH_PROVIDER_ACTIVATION_PENDING — <provider and exact missing prerequisite>
```

If a production/data-integrity gate fails, return:

```text
B1_1_NOT_ACCEPTED — <single precise blocker>
```

Do not start B1.2 or B2 in the same task.

---

# 20. Required final response

Return only:

1. **Verdict**
2. **Provider capability matrix**
3. **Canonical contract and freshness result**
4. **Routing/failover truth table**
5. **Migrated production consumers**
6. **Cache/rate-limit result**
7. **Provider health/diagnostics result**
8. **Exact tests and counts**
9. **Typechecks and builds**
10. **Changed-file and Git record**
11. **Evidence SHA-256 and terminator proof**
12. **Exact provider activation prerequisites, if any**
13. **Remaining B1.2/B2 inventory**
14. **Next roadmap phase — not started**
15. **Production status**

No command diary. No new audit. No new roadmap. No deployment.

Production remains:

```text
PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED
```

