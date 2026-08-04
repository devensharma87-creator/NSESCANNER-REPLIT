# MARKET SCANNER — PROMPT 19

## Fast-Track Delivery Pack 1: Complete the Remaining Website Surfaces

### Instruction to the Replit coder

B2.1 is accepted for fast-track progression:

```text
ACCEPT_B2_1_CORE_WEBSITE_API_UI_DATA_STATE_ACCURACY
```

Preserve its nine production fixes, its 42 tests, the shared `DataProvenanceBadge`, and all accepted A0.3/B0/B1.1/P0.1B safeguards.

Do not open a B2.1 closure task.

This prompt combines the remaining B2.2 and B2.3 work into one delivery pack so that the actual website is completed faster.

Execute the implementation—not another broad audit.

Do not start B3 F&O lifecycle corrections, B4 swing lifecycle corrections, B5 ledger remediation, Prompt 15, database provisioning or deployment.

Do not change strategy formulas, thresholds, confidence weights, vetoes, signal admission, entries, stops, targets, position sizing or capital ledgers in this pack.

No manual commit, push, pull, fetch, publish or deployment is authorized.

---

# 1. Pack objective

Complete API/UI/data-state correctness for the remaining user-facing website surfaces:

- Portfolio Analyser and holdings views;
- stock/security detail pages;
- charting and historical-candle views;
- Option Chain and OI Lab presentation;
- Backtest Lab presentation and result truth;
- Daily Analysis/reporting presentation;
- signal-history/paper-trade summary screens where only display/contract truth is involved;
- common source/freshness/error/empty/partial-state components;
- all remaining navigable pages not explicitly reserved for B3/B4/B5.

The existing platform should leave this pack with every current navigation destination rendering truthfully and usefully under:

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

No page may present missing, failed, stale or partial data as a valid zero, empty success, live value, neutral market conclusion or closed market.

---

# 2. Fast-track rules

Use this exact execution sequence:

1. One read-only preflight.
2. One route/component/API inventory limited to the remaining navigable pages.
3. One concise defect matrix.
4. Implement confirmed defects across the pack.
5. Add actual route and production-component tests.
6. Run targeted tests throughout.
7. Run one complete pack-level regression/typecheck/build battery.
8. Write one concise Pack 1 evidence file.
9. Return the result and stop.

Do not repeatedly reread the same files.

Do not create a new roadmap or task plan.

Do not stop for attachment/documentation-only platform auto-commits; record and continue. Stop only for an unexpected production/test/schema/migration/dependency/build/deployment change.

Do not issue a completion verdict based only on pure helper tests. Test the real registered routes and real production components for the defects being fixed.

---

# 3. Frozen safeguards

Preserve:

- canonical Kite-first data routing;
- TRADE_GRADE exclusion of NSE/Yahoo fallback;
- future-timestamp fail-closed behavior;
- source/fallback/`asOf` provenance;
- B0 alert and market-state behavior;
- B2.1 null/error/count corrections;
- A0.3 VWAP/setup-availability honesty;
- existing authentication and authorization;
- ordinary-test zero-PostgreSQL-connection protection;
- existing Pine import and drawing toolbar behavior;
- chart library choice;
- existing risk limits, P25/guardrails and dynamic-lot policy;
- immutable signal plans.

Upstox and IndianAPI remain `NOT_CONFIGURED`. Do not fabricate activation, endpoints or provider results. Their absence is not a Pack 1 blocker.

---

# 4. Step 1 — Read-only preflight

Record once:

- IST timestamp;
- branch and HEAD;
- upstream and ahead/behind without fetching;
- tracked/staged/untracked state;
- actual API/web/scanner/client/Zod package scripts;
- the Prompt 18 changes present in the working tree/HEAD;
- all currently navigable frontend routes;
- unexpected source/test changes predating Prompt 19.

Inspect provider secret names by presence only. Never print or hash values.

Do not connect to PostgreSQL or a live provider.

---

# 5. Step 2 — Remaining-surface inventory

Map every remaining navigable page to:

- route;
- production component;
- child widgets;
- React Query keys/options;
- API client;
- registered backend route;
- production Zod/OpenAPI contract;
- producer/facade;
- source/`asOf`/freshness origin;
- loading/empty/partial/stale/error rendering;
- calculations and formatting;
- cache/invalidation behavior;
- direct provider bypasses;
- test coverage.

At minimum identify the real project equivalents of:

```text
Portfolio
Portfolio Analyser
Holdings
Stock Detail
Security Detail
Charts
Option Chain
OI Lab
Backtest
Daily Analysis
Reports
Signal History
Paper Trading
```

Classify routes owned by later packs:

- B3: F&O decision/execution lifecycle;
- B4: swing decision/execution lifecycle;
- B5: ledger mutation/reconciliation internals.

Their display contracts may be corrected here, but their business logic must remain frozen.

Search remaining production paths for semantic fabrication:

```text
?? []
|| []
?? 0
|| 0
?? "closed"
|| "closed"
marketState="closed"
dataUpdatedAt
Date.now()
Yahoo
Live
Fresh
No data
No trades
No signals
No results
N/A
--
```

Classify before changing. Preserve safe display fallbacks that clearly mean “not available”; correct fallbacks that change business meaning.

---

# 6. Step 3 — Complete shared provenance integration

The B2.1 report created `DataProvenanceBadge.tsx` but did not explicitly prove that it is rendered by production pages.

Required action:

1. Inventory every B2.1 and Prompt 19 production surface that displays provider-backed market data.
2. Integrate the shared provenance component/helper where it improves truth and avoids duplicate logic.
3. If an existing surface-specific component is already more accurate, reuse the shared resolver without forcing a visual rewrite.
4. Remove the new component if it is unused and redundant; do not retain dead code solely because it has tests.

The integrated display must derive from canonical provider metadata:

- source/provider;
- authoritative `asOf`;
- live/delayed/stale/partial/unavailable state;
- fallback/secondary status;
- coverage/failure summary where relevant.

React Query `dataUpdatedAt` may indicate local cache age only. It must not establish provider freshness.

Required tests:

- actual Dashboard component renders null change neutrally and API failure explicitly;
- actual Watchlist component renders null values and error state correctly;
- actual StatusStrip distinguishes missing counts from zero;
- actual Scanner/Deep Scan component distinguishes no-data/failures from zero;
- at least one real page renders the shared provenance display from canonical metadata;
- delayed Yahoo metadata always renders delayed/informational, never live.

These are pack-level integration tests, not a B2.1 reopening.

---

# 7. Step 4 — Portfolio Analyser and holdings accuracy

Inspect and correct confirmed production defects across portfolio/holdings/detail surfaces.

## 7.1 Canonical identity and pricing

- use the accepted canonical resolver;
- retain exchange, symbol, token and ISIN where applicable;
- prevent NSE/BSE collisions;
- unresolved instruments remain explicit, never silently priced using another symbol;
- current price source and `asOf` remain visible;
- stale/delayed price remains labelled and cannot appear live;
- one unresolved holding must not erase the entire portfolio.

## 7.2 Portfolio calculations

Verify with exact boundary tests:

- quantity;
- average acquisition cost;
- invested value;
- current value;
- absolute P&L;
- percentage P&L;
- realized versus unrealized P&L where exposed;
- day change where exposed;
- allocation percentage;
- portfolio totals;
- cash/other assets where exposed;
- corporate-action-adjusted quantities/cost only if the production system already supports them.

Required mathematical behavior:

- missing price => value/P&L unavailable, not zero;
- zero cost/quantity handled intentionally without division by zero;
- negative/short values handled according to supported product policy;
- totals disclose excluded/unpriced holdings;
- percentages use the correct denominator;
- currency rounding occurs at display boundaries, not prematurely inside aggregation;
- no double counting across exchanges/accounts;
- sorting places unavailable values intentionally.

## 7.3 UI states

- loading skeleton;
- valid empty portfolio;
- partial pricing;
- stale pricing;
- resolver failure;
- API error;
- authorization failure;
- closed-market last-known price presentation.

Do not change actual holdings, broker data or operational portfolio rows.

---

# 8. Step 5 — Stock/security detail and charting truth

## 8.1 Security header

- canonical exchange/symbol/name;
- quote source and `asOf`;
- current/last-close distinction;
- price, absolute change and percentage from the same session/source;
- no green/red direction when change is unavailable;
- corporate/fundamental sections display honest unavailability if provider not configured.

## 8.2 Candle contract

Verify:

- interval and requested range;
- timestamp ordering and uniqueness;
- timezone normalization;
- OHLC invariant `high >= max(open, close)` and `low <= min(open, close)`;
- nonnegative volume where volume is valid;
- missing volume remains unavailable rather than zero when source lacks it;
- session/date alignment;
- no future candles;
- no duplicate last candle;
- incomplete current candle labelled/handled according to existing policy;
- gaps visible rather than interpolated as fabricated candles;
- source/`asOf` retained through transforms.

## 8.3 Chart UI

- loading, empty, partial, stale and error states;
- source/freshness display;
- interval/range changes use complete query keys;
- old-range data cannot flash as current without a previous/stale label;
- cancellation prevents slower previous requests overwriting newer selections;
- no drawing-tool or chart-library replacement;
- indicators never fabricate missing inputs;
- indicator warm-up gaps remain honest.

---

# 9. Step 6 — Option Chain and OI Lab display accuracy

This pack covers display/calculation truth only. B3 will handle F&O decision and execution logic.

Verify and correct:

- underlying/index identity;
- spot source and `asOf`;
- expiry list and selected expiry;
- strike ordering;
- CE/PE pairing by exact strike/expiry/instrument identity;
- ATM determination from the correct spot/step;
- option premium source/trust;
- OI units;
- change-in-OI semantics;
- volume, bid/ask and spread fields;
- IV and Greeks source/calculation provenance;
- PCR calculation and denominator;
- max-pain calculation and coverage;
- missing strikes/legs;
- partial chain coverage;
- stale/delayed/display-only fallback labels;
- TRADE_GRADE versus DISPLAY distinction.

Required invariants:

- missing OI/change OI/premium is not zero;
- NSE/Yahoo display fallback remains visibly non-tradeable;
- display fallback cannot mutate signal/paper/execution state;
- calculations exclude unavailable legs and disclose coverage;
- selected expiry cannot silently switch after a failed request;
- previous-expiry cached data cannot appear under a new expiry;
- PCR/max-pain unavailable when coverage is insufficient;
- closed market may show last chain only with last-session/stale context.

Do not change F&O signal thresholds or add new strategies.

---

# 10. Step 7 — Backtest Lab presentation and result honesty

Correct API/UI/result-contract defects without redesigning strategy logic.

Required truth fields where the engine supports them:

- strategy/version;
- instruments/universe;
- interval;
- requested and effective date range;
- data source and coverage;
- number of candles/trading sessions;
- assumptions;
- slippage/charges model;
- trades;
- gross/net P&L;
- win rate;
- drawdown;
- benchmark comparison;
- warnings/limitations.

Required behavior:

- no result displayed as complete when data coverage is partial;
- no synthetic/fallback data presented as real without explicit label;
- no future/look-ahead candle consumption;
- no trade using data unavailable at the decision timestamp;
- ambiguous same-candle stop/target ordering follows the established conservative policy and is disclosed;
- charges/slippage settings shown with results;
- zero trades differs from unavailable/failed backtest;
- empty result does not become 0% return by default;
- gross and net P&L not conflated;
- stale cached result cannot appear under different parameters;
- query/cache key includes all result-changing parameters.

If the current backtest engine cannot substantiate a metric, show it as unavailable rather than calculate from insufficient inputs. Record algorithmic improvements for the later business-logic pack; do not fabricate completion.

---

# 11. Step 8 — Daily Analysis, reports and history presentation

Correct display/API contract truth for:

- Daily Analysis;
- pre-market/post-market summaries;
- signal history;
- paper-trade summaries;
- existing export/report pages;
- health/reconciliation summaries shown to the user.

Requirements:

- IST trading date and report-generation time explicit;
- do not show a prior-day report as today’s;
- market holiday/closed-day report states truthful;
- each section retains source and `asOf`;
- partial section failure remains visible;
- INFO_ONLY signals explicitly say no paper trade expected;
- execution truth remains present and schema/client-safe;
- signal generated, passed, admitted, opened, closed and modeled-only states remain distinct;
- no missing P&L rendered as zero;
- gross/net/charges not conflated;
- export totals reconcile with visible filtered records;
- loading/error/empty states are distinct;
- report cache/query keys include trading date and parameters.

Do not mutate ledger rows or recalculate historical operational records in this pack.

---

# 12. Step 9 — Remaining-route completeness

After the named surfaces are corrected, enumerate every registered navigable frontend route.

For each route, classify:

```text
COMPLETED_IN_B2_1
COMPLETED_IN_PROMPT_19
RESERVED_FOR_B3_FNO
RESERVED_FOR_B4_SWING
RESERVED_FOR_B5_LEDGER
ADMIN_INTERNAL
DEPRECATED_WITH_REDIRECT
BROKEN_OR_ORPHANED
```

Requirements:

- no navigation link to a missing/broken page;
- deprecated routes have an intentional redirect or are removed from navigation;
- authorization is enforced on protected routes;
- unconfigured features render an honest unavailable state;
- no blank white page or swallowed render exception;
- shared error boundary provides recover/refetch/navigation action;
- preserve admin-only boundaries.

Fix confirmed broken/orphaned routing defects within the existing product scope. Do not add new product modules.

---

# 13. Step 10 — API/schema/client and cache parity

For every response shape changed:

- production Zod validates at the route boundary;
- OpenAPI updated when applicable;
- generated/manual API client updated;
- real production component migrated;
- contradictory state/provenance combinations rejected;
- tests read actual production schema/specification;
- optional/null/unavailable semantics remain intentional.

For every query touched:

- complete stable query key;
- bounded retry;
- justified `staleTime`/refetch interval;
- interval/date/expiry/symbol/account inputs included;
- cancellation or latest-request protection;
- previous-data display visibly marked;
- session/trading-date invalidation;
- authentication/instrument-recovery invalidation where relevant;
- errors do not overwrite last-good state as valid empty data.

Reuse B1.1 request coalescing/rate controls. Do not add another cache layer without necessity.

---

# 14. Step 11 — Load-bearing tests

Use actual registered routes and production components, plus pure tests for calculations.

At minimum cover:

## Pack-level B2.1 integration carry-forward

1. Dashboard null change/error rendering;
2. Watchlist null change/error rendering;
3. StatusStrip missing versus zero counts;
4. Scanner no-data/failure display;
5. production provenance badge integration.

## Portfolio

6. complete pricing and P&L;
7. one unpriced holding produces partial totals;
8. zero-cost/division boundary;
9. NSE/BSE identity separation;
10. stale/delayed quote rendering;
11. API error versus valid empty portfolio;
12. totals/filtered rows reconcile.

## Charts

13. OHLC invariant validation;
14. timestamp ordering/duplicates/future candles;
15. missing volume honesty;
16. interval/range query-key separation;
17. stale previous request cannot overwrite current selection;
18. source/`asOf` reaches the production chart component;
19. loading/empty/partial/error rendering.

## Option Chain/OI

20. exact expiry/strike/CE-PE identity pairing;
21. ATM determination;
22. OI unit and missing-value behavior;
23. PCR denominator and insufficient-coverage state;
24. max-pain coverage behavior;
25. display fallback labelled non-tradeable;
26. TRADE_GRADE still fails closed;
27. expiry cache isolation;
28. partial chain rendering.

## Backtest

29. parameter-complete cache identity;
30. zero trades versus failed/unavailable;
31. gross/net/charges presentation;
32. partial coverage warning;
33. no future/look-ahead input;
34. same-candle ambiguity disclosure/conservative policy;
35. result metrics unavailable when unsupported.

## Reports/history

36. IST report date correctness;
37. prior-day report not presented as today;
38. partial section failure;
39. INFO_ONLY says no paper trade expected;
40. execution truth retained through schema/client/UI;
41. missing P&L not zero;
42. export/visible totals reconcile.

## Route completeness and safety

43. all navigation destinations resolve intentionally;
44. protected route authorization;
45. no swallowed component error/blank page;
46. unconfigured provider feature renders unavailable;
47. actual Zod/OpenAPI/client parity;
48. zero live-provider calls in ordinary tests;
49. zero PostgreSQL connections in ordinary tests;
50. no `.skip`, `.only`, arbitrary sleeps, retry masking or weakened assertions.

Use injected clocks/calendars and deterministic provider fixtures.

---

# 15. Step 12 — One pack-level verification battery

Run and report exact commands/counts for:

1. B2.1 production-component carry-forward tests;
2. portfolio/detail targeted suites;
3. chart/candle targeted suites;
4. Option Chain/OI targeted suites;
5. Backtest targeted suites;
6. Daily Analysis/history/report targeted suites;
7. route-completeness tests;
8. API/Zod/OpenAPI/client parity suites;
9. B1.1 canonical-data regression;
10. B0 market-state/alert regression;
11. A0.3 regression;
12. API-server full normal suite;
13. actual global/web application full relevant suite;
14. scanner full suite;
15. API-server typecheck;
16. API-Zod typecheck;
17. API-client-react typecheck;
18. global/web application typecheck;
19. scanner typecheck;
20. database package typecheck if part of the workspace baseline;
21. API-server production build;
22. global/web application production build;
23. scanner production build;
24. zero-DB tripwire;
25. zero-live-provider-network proof;
26. `git diff --check`.

Inspect actual scripts/package names and report them exactly.

Run the broad regression once at the end of the pack, not after every small edit.

If a failure occurs, identify exact file/test and fix the root cause if related. Do not open a new audit or call an unidentified failure flaky/pre-existing.

---

# 16. Evidence record

Create one concise Pack 1 file:

```text
artifacts/audit-evidence/FAST_TRACK_PACK_1_COMPLETE_WEBSITE_SURFACES.md
```

Include:

- starting/final HEAD and Git state;
- exact changed-file inventory;
- B2.1 carry-forward integration result;
- complete route classification;
- defect-to-fix matrix;
- portfolio calculation truth table;
- candle/chart invariant result;
- Option Chain/OI calculation/provenance result;
- Backtest result-truth matrix;
- Daily Analysis/history/report parity;
- API/schema/client/cache changes;
- exact test counts;
- typechecks/builds;
- zero-DB/zero-live-provider results;
- remaining items reserved specifically for B3/B4/B5;
- confirmation no strategy/ledger logic changed;
- confirmation Prompt 15/database provisioning was not executed;
- confirmation no operational data mutation, commit, push or deployment;
- SHA-256 after final write;
- exactly one final terminator:

```text
END_FAST_TRACK_PACK_1_COMPLETE_WEBSITE_SURFACES
```

Do not append to older phase evidence files.

---

# 17. Acceptance

Return:

```text
ACCEPT_FAST_TRACK_PACK_1_COMPLETE_WEBSITE_SURFACES
```

only when:

- B2.1 production components have pack-level integration proof;
- all remaining navigable pages resolve intentionally;
- Portfolio/holdings calculations and partial-pricing states are truthful;
- chart/candle contracts and UI states are truthful;
- Option Chain/OI display calculations and provenance are truthful;
- Backtest results disclose coverage/assumptions and do not fabricate metrics;
- Daily Analysis/history/report states and dates are truthful;
- API/schema/client/query-cache parity is maintained;
- no false zero, false empty, false live or false closed state remains in the pack scope;
- full tests/typechecks/builds pass;
- zero-DB and zero-live-provider safety remains intact.

If a genuine production blocker remains, return:

```text
FAST_TRACK_PACK_1_NOT_ACCEPTED — <single precise blocker>
```

Do not create a second broad Pack 1 audit. Report any noncritical bounded carry-forward directly under B3/B4/B5 ownership.

Do not start B3 in the same task.

---

# 18. Final response format

Return only:

1. **Verdict**
2. **Pages/routes completed**
3. **Production defects fixed**
4. **Portfolio calculation result**
5. **Chart/candle result**
6. **Option Chain/OI result**
7. **Backtest result**
8. **Daily Analysis/history/report result**
9. **API/schema/client/cache parity**
10. **Exact tests and totals**
11. **Typechecks and builds**
12. **Changed-file/Git/evidence record**
13. **Items reserved for B3/B4/B5**
14. **Next delivery pack — B3 F&O lifecycle, not started**
15. **Production status**

No execution diary. No new audit. No new roadmap. No provider provisioning. No database provisioning. No deployment.

Production remains:

```text
PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED
```

