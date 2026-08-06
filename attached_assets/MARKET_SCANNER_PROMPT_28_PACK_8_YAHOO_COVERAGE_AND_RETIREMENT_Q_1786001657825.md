# MARKET SCANNER PROMPT 28 — PACK 8 YAHOO COVERAGE AND RETIREMENT QUALIFICATION

## 1. Mission

Qualify and safely retire Yahoo from Stock Scanner Pro wherever authoritative Kite, verified Upstox shadow evidence, IndianAPI fundamentals, exchange data, or existing canonical services provide complete replacement coverage.

Do **not** remove Yahoo blindly. Every removal must prove equal or better identity, coverage, freshness, correctness, availability, rate-limit safety, and UI behavior. Any Yahoo-dependent domain without a verified replacement must remain explicitly delayed/analytics-only and be documented for a later replacement decision.

This is a coverage and controlled-cutover pack—not a strategy pack, provider redesign, or blanket search-and-delete exercise.

## 2. Current accepted provider roles

- **Kite:** canonical trade-grade provider for Indian-market live quotes, eligible candles, option chains, signals, F&O/swing admission, exits, paper marks and trading decisions.
- **Upstox:** authenticated and verified in shadow observation only. It remains zero trading impact during this pack.
- **IndianAPI PRO:** authenticated reference provider for documented fundamentals only; `notForSignals` remains enforced.
- **Yahoo:** delayed analytics-only legacy provider pending this coverage audit.

Never substitute, average, vote or merge provider values to create a synthetic “better” price.

## 3. Project boundary

Work only on Stock Scanner Pro:

- `artifacts/scanner/**`
- `artifacts/api-server/**`
- `lib/api-zod/**`
- `lib/api-client-react/**`
- relevant evidence

`artifacts/global/**` is the separate frozen Global Multi Asset Scanner project. Do not read it into the migration inventory, edit it, test it, build it, screenshot it, or count it.

## 4. Prohibitions

- Do not change F&O or swing strategies, signals, thresholds, confidence, vetoes, targets, stops, entries, exits, sizing, costs or capital rules.
- Do not activate `FNO_PAPER_V2` or `SWING_PAPER_V2`.
- Do not promote Upstox into a trading fallback.
- Do not expand IndianAPI beyond documented/entitled fundamentals.
- Do not delete or rewrite trade, paper, P&L, ledger or audit history.
- Do not perform operational DB cleanup.
- Do not enable broker execution.
- Keep `DB_TEST_RUNTIME_AUTHORIZED = false as boolean` unchanged.
- Never expose provider secrets.
- No manual commit, push, pull, fetch, publish or deployment.

## 5. Gate 0 — Complete Pack 7 observation rigor

The initial live activation produced good preliminary results—23 observations per instrument and maximum reported delta 3.78 bps—but used quick rounds rather than the required minimum 30-minute observation window.

During an open-market period with valid Kite and Upstox sessions:

- run a continuous bounded observation for at least 30 minutes;
- use the three verified indices and at least five verified equities;
- retain at least 20 comparable observations per instrument;
- use the central Pack 7 thresholds and rate limits;
- prove every returned canonical value remains unchanged by shadow dispatch;
- record p50/p95/max price delta, timestamp skew and latency;
- report every unavailable/missing/mismatch classification.

Investigate the earlier `FUTURE_TIMESTAMP` timing artifact. Observation `nowMs` must be sampled at the correct comparison point. Do not weaken the production future-timestamp fail-closed rule or tolerance to hide probe latency. Add a regression test proving fetch latency cannot create a false future-timestamp classification while an actually future provider timestamp still fails closed.

Only after this gate passes may Pack 7 live status be considered fully verified.

## 6. Gate 1 — Repository-wide Yahoo consumer inventory

Inventory every production import, wrapper, endpoint, scheduler, cache, test fixture, environment flag and UI reference associated with Yahoo. Use call-graph and runtime routing evidence, not filename search alone.

For each consumer record:

- file/function;
- UI route or downstream consumer;
- data domain;
- symbols/asset classes;
- interval/range;
- current source and endpoint;
- canonical facade or bypass;
- freshness and `asOf` behavior;
- cache and retry behavior;
- trade impact;
- current fallback chain;
- proposed replacement;
- replacement coverage proof;
- retirement classification.

Classify each usage:

- `REMOVE_CONFIRMED_DEAD_CODE`;
- `MIGRATE_TO_EXISTING_CANONICAL_KITE`;
- `MIGRATE_TO_CANONICAL_EXCHANGE_SOURCE`;
- `MIGRATE_TO_INDIANAPI_FUNDAMENTALS`;
- `RETAIN_YAHOO_DELAYED_GLOBAL_ANALYTICS`;
- `RETAIN_TEMPORARILY_NO_VERIFIED_REPLACEMENT`;
- `TEST_FIXTURE_ONLY`;
- `BLOCKED_UNKNOWN_CONSUMER`.

## 7. Gate 2 — Domain-by-domain replacement matrix

Build and execute a replacement decision for at least:

### Indian equities and Indian indices

- quotes/LTP/change/previous close;
- candles and chart history;
- scanner/watchlist/portfolio enrichment;
- sector/index breadth;
- pre-market and post-market displays;
- index context used by analysis.

These should use the existing canonical Kite/exchange path wherever coverage and rate-limit safety are proven.

### Derivatives

- option chains;
- expiries/strikes/contracts;
- option premiums and exits;
- OI and Greeks;
- F&O analysis context.

Yahoo must have zero trade-grade role. Preserve the accepted Kite-only/fail-closed policies.

### Fundamentals and company reference data

Use the registered IndianAPI canonical fundamentals route only for documented/entitled fields. Do not use it for prices or signals. Preserve honest partial/unavailable states.

### Global cues and unsupported non-Indian assets

Identify S&P 500, Nasdaq, Dow, US VIX, DXY, gold, crude, global futures or other domains that Kite/Upstox/IndianAPI do not authoritatively cover.

Do not remove Yahoo from these domains unless a verified, legally usable, operationally configured replacement already exists. Retained Yahoo data must remain:

- `DELAYED_ANALYTICS_ONLY`;
- explicitly sourced and timestamped;
- excluded from trade-grade signals/admission unless an existing accepted policy explicitly permits informational use;
- incapable of silently populating Indian-market canonical fields.

## 8. Gate 3 — Canonical Indian-market cutover

For every Indian-market Yahoo consumer with verified replacement coverage:

- route through the existing canonical facade;
- preserve symbol/instrument identity;
- preserve provider `asOf` and freshness;
- preserve complete query keys;
- preserve last-good/error semantics;
- remove direct Yahoo imports and fallback branches only after executable parity tests pass;
- remove obsolete config flags and dead wrappers only when no runtime consumer remains.

Do not create a second canonical layer or page-specific provider choice.

## 9. Gate 4 — Coverage, correctness and resilience qualification

Before each cutover prove:

- expected symbol coverage, including problematic equity aliases/BSE holdings;
- index identity and no GIFT/NIFTY substitution;
- interval/range coverage for charts;
- OHLC invariants and ordered timestamps;
- no future candles or duplicate terminal candle;
- cache TTL and stale-state honesty;
- bounded request volume under normal page usage;
- rate-limit behavior;
- timeout and provider-unavailable behavior;
- no empty-array or zero fallback hiding failure;
- same canonical value/source/`asOf` across tabs.

If replacement coverage is worse or incomplete, do not cut over that domain. Retain and label Yahoo until a real replacement is available.

## 10. Gate 5 — Yahoo isolation enforcement

Add load-bearing guards proving:

- no Yahoo import/call in option-signal, swing-signal, paper-admission, exit-monitoring, P&L marking or broker paths;
- no Yahoo value can satisfy `TRADE_GRADE`, `PAPER_ADMISSION` or `EXIT_MONITORING`;
- Yahoo cannot populate canonical Indian equity/index quote fields after migration;
- retained Yahoo global analytics remains `notForSignals`/delayed as required;
- client pages call only Stock Scanner Pro canonical APIs, never Yahoo directly;
- retained and removed usages match the inventory exactly.

## 11. Gate 6 — API, schema, client and UI parity

For every modified response:

- validate with production Zod at the registered route boundary;
- update api-zod and api-client-react where necessary;
- preserve stable query keys and last-good behavior;
- render loading, ready, delayed, stale, partial, unavailable, error and closed states honestly;
- display source and `asOf`;
- render missing values as unavailable, not zero;
- avoid provider-specific wording where the route is canonical.

Visually verify affected Stock Scanner Pro routes at 390×844, 768×1024 and 1440×900. Fixture screenshots must be labelled as fixture evidence; live screenshots must be labelled separately.

## 12. Gate 7 — Runtime tests

Add executable tests covering at least:

1. full Yahoo consumer inventory classification;
2. no unclassified production usage;
3. Indian equity/index canonical migration;
4. quote identity and timestamp parity;
5. candle interval/range and OHLC correctness;
6. no future/duplicate candle;
7. portfolio and watchlist canonical equality;
8. derivatives zero-Yahoo trade-grade enforcement;
9. IndianAPI fundamentals isolation;
10. retained global Yahoo delayed labelling;
11. source/asOf propagation;
12. last-good and error behavior;
13. rate-limit/request-volume bounds;
14. no direct client Yahoo call;
15. no provider secret leakage;
16. Pack 7 30-minute parity carryover;
17. future-timestamp timing regression;
18. Global-project exclusion.

Use real facades, registered routes and rendered components. Source inspection may support but cannot replace runtime proof.

Deterministic tests must use injected transports and make zero live provider calls and zero DB connections.

## 13. Gate 8 — Verification battery

Run and record:

- API-server non-DB floor: 5,881 tests;
- scanner floor: 1,250 tests;
- typechecks: scanner, api-server, api-zod, api-client-react;
- scanner and API-server production builds;
- `git diff --check`;
- `.skip`, `.only`, retry, sleep and assertion-weakening audit;
- deterministic zero-DB/zero-live-call proof;
- built-client provider/credential sentinel scan;
- confirmation that provider credentials remain server-side;
- confirmation that broker blocks, DB lock and Global remain unchanged.

## 14. Evidence and acceptance

Write:

`artifacts/audit-evidence/FAST_TRACK_PACK_8_YAHOO_COVERAGE_AND_RETIREMENT_QUALIFICATION.md`

Include:

- Git chronology;
- Pack 7 30-minute carryover result;
- full Yahoo consumer inventory;
- domain replacement matrix;
- migrated, retained and blocked paths;
- coverage/rate-limit evidence;
- cross-tab/API/schema/client/UI proof;
- retained Yahoo risk and labelling;
- tests/builds/screenshots;
- exact owner actions or missing replacement services;
- confirmation that strategy logic, history, DB data, Upstox trading role, IndianAPI scope, broker execution and Global were unchanged.

Final nonblank line:

`END_FAST_TRACK_PACK_8_YAHOO_COVERAGE_AND_RETIREMENT_QUALIFICATION`

Return exactly one:

- `ACCEPT_PACK_8_YAHOO_RETIRED_FROM_INDIAN_MARKET_CANONICAL_PATHS_GLOBAL_ANALYTICS_RETAINED_DELAYED`;
- `ACCEPT_PACK_8_YAHOO_FULLY_RETIRED_WITH_COMPLETE_REPLACEMENT_PROOF`;
- `PARTIAL_PACK_8 — <retained domains and exact reason>`;
- `BLOCKED_PACK_8 — <failed mandatory safety gate>`.

Do not begin professional F&O strategy research in this task. That becomes the immediate next roadmap stage only after Indian-market Yahoo retirement qualification is accepted and the historical option-premium data foundation remains verified.
