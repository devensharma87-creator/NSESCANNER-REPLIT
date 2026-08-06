# PROMPT 34 — INDEPENDENT PRODUCTION TRUTH, DATA PARITY AND TRADING-LIFECYCLE AUDIT

## When to run

Run this prompt **after Prompt 31's option-snapshot canary has completed**, while NSE is still open and the Kite session is active. Recommended start: approximately 10:00 IST on a normal trading day.

This is a **read-only audit**. Do not implement fixes during this task. The purpose is to create one authoritative production defect matrix that Prompt 33 and later roadmap packs will close without missing or duplicating anything.

## Project identity and scope

Audit only **Stock Scanner Pro**:

- Production URL: `https://marketscannerbydev.in`
- Repository: `https://github.com/devensharma87-creator/NSESCANNER-REPLIT`
- Scanner frontend: `artifacts/scanner`
- API server: `artifacts/api-server`
- Shared contracts: `lib/api-zod`, `lib/api-client-react`, `lib/db`

`artifacts/global` / Global Multi Asset Scanner is a separate project and is **FROZEN and excluded**.

## Audit objective

Independently verify that everything already built is actually implemented and functioning correctly in the published production website—not merely passing source-level tests.

The audit must determine whether:

1. every production page loads correctly;
2. every displayed value is truthful, timely, internally consistent and correctly labelled;
3. the same data domain uses the same canonical root across all tabs;
4. Indian tradeable prices, candles, indicators, scores, signals and paper trading use Kite—not Yahoo;
5. Upstox remains shadow-only with zero output/trading impact;
6. IndianAPI remains fundamentals/reference-only;
7. F&O signalling and paper trading are safe, reproducible and correctly reconciled;
8. swing signalling, staging, monitoring, exits and paper trading are safe and correctly reconciled;
9. missing/stale/partial/error data is never converted into a false zero, false direction, false signal, false P&L or false success state;
10. production deployment, API, schema, cache, scheduler and frontend are actually aligned.

## Non-negotiable audit boundaries

- No source-code edits.
- No production deployment or restart.
- No operational DB insert, update, delete, migration, cleanup, reset or backfill.
- No paper trade creation, stage approval, capital event or test order.
- No broker order, order modification or cancellation.
- No feature-flag or runtime-lock changes.
- No commit, push, pull, fetch or publish.
- Read-only database queries are allowed.
- Read-only provider/API probes are allowed at bounded rates.
- Use the normal authenticated owner session; never expose credentials or cookies.
- If a destructive button or mutation route must be checked, verify authorization and source wiring without invoking the mutation.
- Do not mark a feature correct based only on tests or code inspection; verify the published runtime wherever possible.

## Canonical data-domain policy to audit

“Same source across tabs” means the same **canonical root for the same data domain**.

| Domain | Canonical/allowed role | Prohibited behaviour |
|---|---|---|
| Indian live equity/index quotes | Kite | Yahoo or Upstox silently replacing Kite |
| Indian scanner candles/indicators/scores/signals | Verified Kite candle facade/warehouse | Yahoo-derived scanner analytics or zero-filled indicators |
| F&O option chain/premiums/OI/trade admission | Kite trade-grade facade | NSE/Yahoo/display fallback entering signals or paper trades |
| Swing candles, quotes and admission | Kite canonical facade | Delayed/unproven data entering stages or trades |
| Upstox | Shadow parity only | Returning canonical values or changing a decision |
| IndianAPI | Fundamentals/reference only | Supplying live prices, option premiums or trading decisions |
| Global macro not supplied by Kite | Yahoo temporarily allowed as delayed `GLOBAL_MACRO_DISPLAY_ONLY` | Feeding Indian trend, breadth, scores, signals or trading |
| Historical/reports/P&L | Cohort-scoped DB ledger | Cross-cohort mixing, false zeros or balance-as-performance |

Any exception must be explicitly documented, labelled and proven to have zero trading impact.

## Required audit method

Use four layers of evidence for every material finding:

1. **Production UI evidence** — visible value/state and screenshot.
2. **Production network/API evidence** — request, response, status, schema, provenance and `asOf`.
3. **Canonical-source evidence** — bounded raw Kite/approved-provider response or authoritative stored input captured at the same observation point.
4. **Code/contract evidence** — production route, facade, Zod schema, calculation and client hook responsible for the output.

A finding without adequate evidence must be classified `UNVERIFIED`, not guessed.

Assign each finding:

- stable audit ID;
- severity `P0`, `P1`, `P2`, `P3`;
- status `PASS`, `FAIL`, `PARTIAL`, `UNVERIFIED`, `NOT_APPLICABLE`;
- affected routes/components/endpoints;
- exact evidence;
- user/trading impact;
- root cause where proven;
- existing roadmap owner: Prompt 31, Prompt 33, cohort migration, swing qualification, F&O qualification, deployment, or a genuinely new item;
- precise acceptance test.

Do not create duplicate tasks when an existing roadmap pack already owns the defect.

## Gate 0 — Repository, deployment and environment identity

Record and reconcile:

- remote, branch and HEAD;
- clean/dirty working-tree state;
- production frontend commit/build ID;
- production API commit/build ID;
- development-preview frontend/API commit IDs;
- API schema version;
- production deployment timestamp;
- API process start timestamp;
- frontend API base URL;
- production/development environment classification;
- redacted presence/absence of provider and scheduler configuration;
- Kite session status;
- Upstox auth mode and shadow state;
- IndianAPI plan/host/capability state;
- option-snapshot capture state;
- V2 cohort hard-lock states;
- broker-execution hard-block state;
- `DB_TEST_RUNTIME_AUTHORIZED` state.

Any build/API/environment mismatch is at least P1 and P0 if it causes incorrect production data.

## Gate 1 — Complete production route and navigation audit

Read the current production route registry. Do not rely on an old count. Audit every registered route, navigation link, redirect and protected surface individually.

Expected functional groups include:

- Home/market overview;
- Full Scanner;
- Watchlist;
- Stock detail;
- Index detail;
- Sector and sector detail;
- Charting;
- Option Chain;
- OI Lab;
- F&O/Options cockpit and signal history;
- Institutional Flows;
- Pre-market;
- Portfolio Analyser;
- Backtest Lab;
- Daily Analysis;
- Paper Trading;
- P&L/reports/history;
- Swing Cash/staging queue;
- provider/data diagnostics;
- infra/health/admin pages;
- settings/auth/legal routes;
- every additional route currently registered.

For each route verify:

- navigation works and no orphan link exists;
- correct auth boundary;
- no blank page or unhandled exception;
- one correct page heading;
- loading, ready, delayed, stale, partial, empty-valid, unavailable, error and market-closed states as applicable;
- retry behaviour;
- mobile/tablet/desktop responsiveness;
- no horizontal clipping of critical controls/data;
- source/provenance/as-of presentation;
- data actually loads in published production;
- API errors do not masquerade as valid empty data.

Capture screenshots at 390×844, 768×1024 and 1440×900 for every major user-facing route and every observed defect state. Avoid redundant screenshots of equivalent legal/static pages.

## Gate 2 — Cross-tab canonical quote parity

During market hours, create one bounded observation set for:

- NIFTY 50;
- BANK NIFTY;
- SENSEX;
- RELIANCE;
- HDFCBANK;
- ICICIBANK;
- INFY;
- SBIN;
- at least five additional actively traded symbols selected deterministically.

For each symbol compare every tab/API displaying its quote, including Home, Scanner, Watchlist, stock/index detail, Charting, Portfolio, F&O/Swing surfaces where applicable.

Record:

- instrument token/key and exchange identity;
- LTP, previous close, change and change percent;
- source;
- provider `asOf` and server receipt time;
- freshness/staleness;
- shared snapshot/correlation ID if supported.

Requirements:

- values sharing the same snapshot must be exactly equal;
- values from different timestamps may differ only consistently with their real `asOf` times;
- no BSE/NSE instrument mix-up;
- no index/future/ETF identity substitution;
- no stale value shown as live;
- no null shown as zero;
- no Yahoo value in an Indian tradeable domain.

Explain every mismatch. Do not hide it within a broad tolerance.

## Gate 3 — Candle, indicator and scanner truth audit

Audit the complete scanner pipeline from instrument universe through quote overlay, candle loading, indicator calculation, scoring, filtering, ranking, caching and UI rendering.

Verify:

- universe identity and count;
- quote-covered count;
- candle-covered count;
- indicator-ready count;
- evaluated/scanned count;
- unavailable/quote-only/partial counts;
- count arithmetic reconciliation;
- source and `asOf` per row/domain;
- enough ordered candles for each indicator;
- interval identity;
- duplicate/future/stale candle rejection;
- OHLC invariants;
- EMA20/50/100/200 readiness;
- RSI readiness;
- VWAP uses valid intraday inputs;
- 52-week high/low window;
- volume ratio denominator and readiness;
- delivery/Futures OI null semantics;
- filter and preset eligibility;
- CSV/JSON export parity.

Explicitly reproduce the attached screenshot defect:

- VWAP, EMAs, RSI, 52-week and volume fields are missing;
- row still shows `SCORE +54` and `NEUTRAL`.

This must be classified P0 if production still emits a score/signal without mandatory inputs.

Verify why development preview loads thousands of rows while published production shows `0 of universe scanned`. Determine whether the cause is build drift, environment drift, scheduler state, process-local cache loss, durable-cache hydration, schema mismatch, route failure, auth, provider coverage or another proven cause.

Inventory every Yahoo use in the scanner and prove whether it enters Indian indicators, scores, signals or presets.

## Gate 4 — Home, market breadth, indices and global cues

Verify:

- Indian indices use canonical Kite identity and values;
- market-open/closed status is correct for IST and trading holidays;
- previous close, day range, 52-week range, pivots, support/resistance and volume-profile values use correct inputs and periods;
- breadth advancers/decliners/unchanged reconcile to the eligible evaluated universe;
- A/D ratio denominator is correct and unavailable when inputs are missing;
- overall trend and Market Mood expose their components and do not compute from absent data;
- Market Mood cannot show numeric `51 NEUTRAL` when breadth/trend inputs are unavailable;
- gainers/losers/setups exclude incomplete rows;
- India VIX and US VIX are clearly distinct;
- FII/DII dates and sources are correct;
- F&O ban-list source/date are correct;
- expiry date reflects actual contract calendar;
- global Yahoo values are delayed/info-only and isolated;
- `NO YAHOO DATA` cannot coexist with apparently current Yahoo values unless explicitly labelled stale last-good with timestamp.

Recalculate representative metrics independently from raw API values.

## Gate 5 — F&O data and signal lifecycle

Audit NIFTY, BANKNIFTY and SENSEX end to end:

1. index identity and spot quote;
2. market status and readiness;
3. expiry selection and holiday adjustment;
4. strike-step and ATM selection;
5. option-chain transport and schema;
6. CE/PE identity;
7. premium, OI, volume, IV and Greeks null semantics;
8. provider provenance and freshness;
9. trade-grade versus display-only policy;
10. PCR numerator/denominator and zero-denominator behaviour;
11. max pain/support/resistance calculations;
12. setup availability/retirement disclosure;
13. candidate generation;
14. preliminary/final admission gates;
15. chase/recovery/flip/data-quality vetoes;
16. `TRADEABLE_SIGNAL` versus `INFO_ONLY`;
17. plan immutability;
18. paper trade admission;
19. option-premium monitoring;
20. target/stop/time-exit lifecycle;
21. terminal exit and idempotency;
22. charges and net P&L;
23. reports, statistics and Telegram parity.

Prove:

- no Yahoo/NSE display fallback reaches signals or paper trading;
- future/stale/partial option chains fail closed;
- missing premiums never become ₹0;
- INFO_ONLY never creates a paper trade;
- target/stop values match the immutable admitted plan;
- TARGET1 lifecycle behaviour is labelled correctly;
- no duplicate open trade or duplicate terminal exit;
- closed-market/API-error states do not say merely “Market is closed” incorrectly;
- F&O V2 remains disabled and contains no trades/capital/P&L.

Use read-only records and deterministic replay. Do not create a trade.

## Gate 6 — Swing signal, staging and paper lifecycle

Audit the swing-cash lifecycle end to end:

- canonical universe and symbol resolution;
- candles and quote provenance;
- corporate-action integrity;
- setup calculation and eligibility;
- data freshness and trust;
- admission gates and capital/risk checks;
- stage creation logic without invoking it;
- stage price versus current quote;
- TTL and expiry;
- duplicate active-stage prevention;
- approval/rejection/dry-run boundaries;
- real-order hard block;
- paper entry evidence;
- monitoring, target/stop/TTL exits;
- charges and net P&L;
- reports and alerts;
- orphan/reconciliation checks.

For existing staged rows, classify each as active, expired, requote-required, invalid identity, corporate-action risk, incomplete provenance or otherwise. Do not approve or delete anything.

Prove:

- no Yahoo value enters swing signals or staging;
- no missing metric becomes zero/positive;
- no broker order can be placed;
- staging and terminal actions are idempotent;
- `SWING_PAPER_V2` remains disabled with no trades/capital/P&L;
- legacy swing history remains unchanged.

## Gate 7 — Paper accounts, cohorts, P&L and reports

Perform read-only reconciliation separately for:

- legacy F&O paper trading;
- legacy swing/equity paper trading;
- `FNO_PAPER_V2` disabled state;
- `SWING_PAPER_V2` disabled state.

For each applicable legacy cohort reconcile:

- seed capital;
- deposits/withdrawals/adjustments;
- reserved/deployed/free capital;
- open-position value;
- realised gross P&L;
- charges by component;
- realised net P&L;
- unrealised P&L;
- account balance;
- net-vs-seed account-reconciliation metric;
- wins, losses and scratches;
- win-rate denominator;
- average win/loss and expectancy;
- largest win/loss null behaviour;
- daily/monthly/setup statistics;
- trade counts across dashboard, detail, report and database.

Verify exact equations and identify unexplained differences. `Net vs. seed` must never be labelled strategy P&L. No-trade statistics must render unavailable—not false zero percentages.

Confirm:

- no legacy row was deleted or relabelled;
- no V2 migration was executed;
- null legacy cohort resolution is deterministic;
- `paper_trade_eq` versus true swing-cash table ownership is correctly classified;
- deferred `paper_account` isolation is clearly disclosed;
- combined totals, if any, are explicitly informational.

## Gate 8 — Portfolio, charts, watchlist and stock intelligence

Audit:

- Watchlist loading/error/empty and null-direction behaviour;
- stock-detail quote, indicators, recommendation, fundamentals and news;
- index-detail constituent identity and null direction;
- chart source/interval/range/query-key completeness;
- candle ordering, duplicates, future bars and OHLC validity;
- Portfolio instrument resolution, NSE/BSE identity and canonical quotes;
- missing-price handling and excluded/unpriced holdings;
- invested/current/P&L/return arithmetic;
- sector allocation and benchmark availability;
- IndianAPI fundamentals route, plan/host, null fields and key redaction;
- no direct provider imports in frontend pages.

Cross-check representative calculations manually.

## Gate 9 — Option Chain, OI Lab, Flows, Pre-market and Backtest

Verify:

- Option Chain freshness uses provider `asOf`, not React Query timestamps;
- missing OI/premium/IV remains null;
- exact strike pairing and ATM identity;
- OI Lab loading/error/no-strikes/all-zero/no-snapshot/warming/rendered states;
- since-open versus buffered-delta labels;
- OI sentiment scope labels;
- Institutional Flows gross-versus-net availability and monthly aggregation;
- IST date handling;
- Pre-market data source and stale/partial treatment;
- Backtest query keys include every result-changing parameter;
- zero trades differs from failed backtest;
- gross, charges and net results reconcile;
- modelled/proxy research is labelled and excluded from professional qualification;
- no unsupported provider output enters trade decisions.

## Gate 10 — Daily analysis, reports, alerts and schedulers

Audit:

- Daily Analysis IST date and prior-day labelling;
- partial-section errors;
- EOD reconciliation mismatch/OK dedup keys;
- alert severity/header correctness;
- recovery alerts and hysteresis;
- instrument refresh failure/recovery;
- clock-drift diagnostics/action text;
- scheduler registration exactly once;
- process-restart behaviour;
- last-good cache persistence;
- market-open/close and holiday schedules;
- Telegram messages match UI/database truth;
- no duplicate alerts or contradictory success/failure messages.

Do not trigger operational alerts merely for testing.

## Gate 11 — API, schema and client parity

For every production endpoint used by audited pages:

- route is registered;
- correct auth boundary;
- input validation and bounded limits;
- production Zod validation;
- OpenAPI/api-zod/api-client-react agreement;
- no undocumented fields silently dropped;
- no null-to-zero client transformation;
- query keys include all result-changing parameters;
- errors preserve last-good data where intended;
- response exposes source, `asOf`, freshness and completeness where material;
- correlation IDs support UI-to-log traceability;
- unknown route returns 404, malformed JSON 400, oversized request 413 and server failures sanitized 500.

## Gate 12 — Provider integration and non-interference

### Kite

- session/auth health;
- instrument identity mapping;
- quote/candle/option-chain capabilities;
- rate-limit and timeout behaviour;
- canonical use across same-domain tabs.

### Upstox

- correct analytics-token mode;
- 8-instrument mapping sanity;
- shadow observations and parity classifications;
- no returned output substitution;
- no scanner-page imports;
- no trading impact.

### IndianAPI

- configured plan and exact allowed host;
- documented `/stock?name=` contract only;
- entitlement/capability states;
- fundamentals route parity;
- null preservation;
- no API key leakage;
- no live quote or option-chain use.

### Yahoo

- complete current-use inventory;
- global-macro-only containment;
- no Indian scanner/signal/paper path;
- accurate delay/stale labels;
- no contradictory unavailable/current state.

## Gate 13 — Security, performance and durability

Verify read-only:

- owner/subscriber/public route boundaries;
- production config rejection;
- CORS and security headers;
- server-secret absence from frontend bundles;
- input bounds and rate limits;
- no debug/fixture bypass in production;
- broker hard block;
- cache size/TTL and stale policy;
- API latency p50/p95 for critical routes;
- route payload size;
- frontend console errors and failed requests;
- scheduler/cache recovery after restart evidence;
- process-local versus durable state;
- N+1/provider fan-out risks;
- database query plans for materially slow read-only queries where safe;
- no credentials in logs, diagnostics, screenshots or evidence.

## Gate 14 — Live observation window

During a continuous minimum 30-minute market-hours window, sample at a bounded interval:

- the three indices;
- at least five equities;
- Home;
- Scanner;
- Watchlist;
- one stock detail;
- Option Chain/OI Lab;
- F&O readiness/signals;
- Swing readiness/stages;
- provider diagnostics.

Record:

- availability;
- source and `asOf`;
- quote/candle freshness;
- cross-tab equality;
- stale/future timestamps;
- API errors/timeouts;
- scanner coverage changes;
- signal/decision changes and their input evidence;
- Upstox parity with zero impact;
- option-snapshot capture continuity from Prompt 31.

Do not create or modify trades. If the market window is unavailable, finish all other gates and return the partial verdict rather than fabricating live proof.

## Gate 15 — Existing tests and builds as supporting evidence

Without editing code, run and record:

- api-server full non-DB suite — expected floor **6,241**;
- scanner full suite — expected floor **1,250**;
- TypeScript checks for api-server, scanner, api-zod and api-client-react;
- API-server and scanner production builds;
- canonical/provider/F&O/swing/P&L/cohort test subsets;
- `git diff --check` before and after audit;
- proof no tracked source file changed;
- proof no operational DB row changed;
- `artifacts/global` untouched.

Tests support but do not replace production runtime findings.

## Gate 16 — Unified defect matrix and roadmap reconciliation

Produce one deduplicated matrix grouped by:

- production deployment/runtime;
- canonical data/provenance;
- scanner/candle coverage;
- Home/market state;
- F&O lifecycle;
- swing lifecycle;
- paper accounts/cohorts/P&L;
- portfolio/chart/watchlist/stock intelligence;
- option chain/OI/flows/backtest;
- API/schema/client;
- providers;
- UI/accessibility;
- security/performance/durability.

For every defect assign it to the existing roadmap in this order:

1. Prompt 33 for production scanner, canonical candle and Yahoo-containment defects;
2. Prompt 31 follow-up only for option-snapshot capture defects;
3. V2 additive migration closure for cohort-persistence defects;
4. swing qualification pack for swing-research/activation defects;
5. frozen-protocol F&O qualification for strategy-research defects;
6. production deployment closure for deployment-only defects;
7. a new task only when none of the above owns it.

List dependencies and recommended execution order. Do not propose cosmetic redesigns, new providers, new strategies or unrelated features.

## Required deliverables

Create:

1. `artifacts/audit-evidence/INDEPENDENT_PRODUCTION_TRUTH_DATA_PARITY_AND_LIFECYCLE_AUDIT.md`
2. `artifacts/audit-evidence/INDEPENDENT_PRODUCTION_TRUTH_DEFECT_MATRIX.csv`
3. `artifacts/audit-evidence/INDEPENDENT_PRODUCTION_ROUTE_AND_DATA_MATRIX.csv`
4. screenshot directory under `artifacts/audit-evidence/screenshots/production-truth-audit/`

The Markdown report must include:

- executive verdict;
- exact audit date/time and market window;
- production/build identity;
- route matrix summary;
- canonical-source matrix;
- cross-tab parity results;
- F&O lifecycle results;
- swing lifecycle results;
- paper/P&L/cohort reconciliation;
- provider non-interference;
- calculation spot checks;
- API/schema/client parity;
- security/performance/durability;
- test/build results;
- defect counts by severity;
- deduplicated roadmap mapping;
- limitations and unverified items;
- file/database mutation proof.

Final nonblank line must be exactly one:

- `END_INDEPENDENT_PRODUCTION_TRUTH_AUDIT_VERIFIED`
- `END_INDEPENDENT_PRODUCTION_TRUTH_AUDIT_DEFECTS_FOUND`
- `END_INDEPENDENT_PRODUCTION_TRUTH_AUDIT_LIVE_WINDOW_PENDING`
- `END_INDEPENDENT_PRODUCTION_TRUTH_AUDIT_BLOCKED`

## Permitted final verdicts

Return exactly one:

### `PRODUCTION_TRUTH_VERIFIED — NO MATERIAL DEFECTS FOUND`

Use only if all material routes, calculations, provenance, cross-tab parity, F&O, swing, paper ledgers and live-window checks pass.

### `PRODUCTION_TRUTH_AUDIT_COMPLETE — DEFECTS FOUND`

Use when the audit is complete and one or more evidence-backed defects exist. Report exact P0/P1/P2/P3 counts and roadmap ownership.

### `PRODUCTION_TRUTH_AUDIT_PARTIAL — LIVE MARKET WINDOW REQUIRED`

Use when off-market gates are complete but live quote/parity/lifecycle truth could not be verified.

### `PRODUCTION_TRUTH_AUDIT_BLOCKED — <exact reason>`

Use when production access, owner authentication, runtime logs or required read-only evidence is unavailable.

## Required final response

Lead with the verdict. Then report concisely:

- routes audited versus total registered routes;
- market observation start/end IST;
- P0/P1/P2/P3 counts;
- canonical-source and cross-tab parity result;
- production scanner result;
- F&O result;
- swing result;
- paper/P&L/cohort result;
- provider integration result;
- tests/builds;
- exact deliverable paths and terminator;
- deduplicated next execution order.

Do not fix anything during the audit. Do not claim accuracy merely because the UI loads. Do not claim same-source compliance unless the provider and `asOf` lineage are proven through UI, API and canonical input evidence.
