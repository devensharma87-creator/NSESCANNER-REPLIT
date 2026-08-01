# MARKET SCANNER — PROMPT 21

## Fast-Track Delivery Pack 3: Complete Swing Trading Signal-to-Exit, Paper Trading, P&L and Reporting

### Instruction to the Replit coder

Fast-Track Pack 2 is accepted and frozen:

```text
ACCEPT_FAST_TRACK_PACK_2_COMPLETE_FNO_LIFECYCLE_FINAL
```

Preserve its final closing baselines:

```text
api-server full suite: 4,744/4,744
scanner full suite: 930/930
five package typechecks: clean
three production builds: pass
```

Do not reopen A0.3, P0.1B, B0, B1.1, Pack 1, Pack 2 or their closure prompts.

This prompt authorizes the full Fast-Track Pack 3 implementation. Start the complete implementation without asking for another confirmation because of task size. Work through the entire Swing coverage checklist in controlled batches so nothing is omitted.

No manual commit, push, pull, fetch, publish or deployment is authorized.

Do not provision or connect to an external test database. Do not execute Prompt 15. Do not change `DB_TEST_RUNTIME_AUTHORIZED`.

Do not place or simulate a real live broker order. `SWING_CASH_EXECUTION_MODE` must remain safely constrained to the existing paper/dry-run policy unless the owner separately authorizes live execution in a future phase.

---

# 1. Pack objective

Complete and prove the existing cash-equity Swing lifecycle:

```text
CANONICAL UNIVERSE AND INSTRUMENT MASTER
  → CANONICAL MARKET / CANDLE / FUNDAMENTAL DATA
  → DATA-QUALITY AND LIQUIDITY GATES
  → CANDIDATE DETECTION
  → TECHNICAL / FUNDAMENTAL / EVENT / RISK FILTERS
  → RANKING AND SIGNAL TIER
  → IMMUTABLE SWING PLAN
  → STAGED ORDER
  → OWNER REVIEW / APPROVAL / REJECTION / EXPIRY
  → PAPER OR DRY-RUN EXECUTION GATE
  → OPEN SWING POSITION
  → DAILY / INTRADAY MONITORING
  → TARGET / STOP / TRAILING / TIME / EVENT EXIT
  → CHARGES / TAXES / GROSS AND NET P&L
  → CLOSED-TRADE LEDGER
  → UI / TELEGRAM / HISTORY / REPORTS / RECONCILIATION
```

Every stage must be accurate, efficient, durable, idempotent, explainable and connected to the same canonical data backbone used across the website.

This pack completes existing Swing functionality. It must not invent new strategies or optimize historical performance.

---

# 2. Fast-track execution rules

Use this sequence only:

1. One read-only preflight.
2. One bounded Swing lifecycle inventory.
3. One concise defect matrix.
4. Implement every confirmed in-scope defect in lifecycle batches.
5. Add real production-function, registered-route and production-component tests.
6. Run targeted tests after each batch.
7. Run one complete Pack 3 regression/typecheck/build battery.
8. Write one Pack 3 evidence file.
9. Return the final result and stop.

Do not repeatedly inspect the same surface.

Do not create another roadmap or resurrect an old phase/task plan.

Do not defer an in-scope Swing defect merely because it crosses scanning, staging, approval, execution, monitoring or reporting. Maintain one coverage checklist and finish it before claiming acceptance.

Stop only for a genuine owner-controlled blocker such as a destructive operational-data mutation, new credential, paid-provider activation, unavoidable schema migration with operational impact or live-order authorization.

Documentation/attachment-only platform auto-commits may be recorded under the existing exception. Stop for an unexpected production, test, schema, migration, dependency, build or deployment change.

---

# 3. Frozen safeguards and scope boundaries

Preserve:

- canonical Kite-first pricing and candle routing;
- Upstox only as a configured, validated secondary;
- IndianAPI only for validated fundamentals/news/corporate-event enrichment;
- Yahoo as delayed display-only during controlled retirement, never a trade decision source;
- future-timestamp, stale-data and provenance safeguards;
- cross-tab canonical-data consistency;
- Prompt 19 UI loading/error/stale/null correctness;
- market-state and alert reliability;
- existing swing strategies, thresholds, ranking weights and risk rules unless objectively broken;
- immutable plan and staged-order semantics;
- event-risk and owner-affirmation gates;
- TTL/stale staged-order expiration;
- paper-only/live-order hard blocks;
- gross/net/charges separation;
- IST dates and NSE session rules;
- authentication/authorization;
- ordinary-test zero-PostgreSQL-connection protection.

Do not:

- add a new Swing strategy;
- loosen filters merely to produce more candidates;
- change entry/target/stop formulas without a proven implementation defect;
- silently substitute Yahoo, previous close or unrelated prices;
- fabricate fundamentals, events, liquidity, volume or corporate-action data;
- activate Upstox or IndianAPI without credentials and parity validation;
- place live orders;
- modify the accepted F&O lifecycle;
- clean operational residue;
- create a production migration without explicit owner approval;
- contact live providers from automated tests.

---

# 4. Canonical Swing data contract

Every Swing page, API, scanner, staged order, paper position and report must consume the same canonical internal data root.

## 4.1 Provider ownership

| Data domain | Authoritative source | Permitted secondary behavior |
|---|---|---|
| live NSE/BSE equity LTP/OHLC/depth | Kite | Upstox only after configuration and parity validation |
| historical candles/volume | canonical Kite candle facade/warehouse | validated Upstox path where policy permits |
| instrument master/token/exchange | canonical Kite instrument resolver | explicit resolution failure if unavailable |
| holdings/positions/orders | Kite account data | no fabricated secondary portfolio |
| company fundamentals/shareholding/corporate actions/news | IndianAPI when configured and validated | honest unavailable state while not configured |
| Swing signals, plans and admission | canonical validated internal snapshot | fail closed for mandatory unavailable inputs |
| entry/monitor/exit price | trade-grade canonical quote | explicit validated secondary only |
| P&L/history | immutable internal trade ledger | never recomputed independently by a UI page |
| Yahoo | prohibited for trading | labelled delayed display-only outside admission/execution |

## 4.2 Canonical identity and snapshot

Verify one normalized equity identity and snapshot contract containing project equivalents of:

```text
exchange
tradingsymbol
ISIN where available
instrumentToken
assetType
snapshotId
source
sourceClass / trustTier
asOf
receivedAt
marketSessionDate
freshnessSec
isStale
isFutureTimestamp
fallbackUsed
dataQuality
degradedReason
```

All tabs must agree on the same instrument mapping, LTP, candle close, timestamps and provenance for the same snapshot.

## 4.3 Data-efficiency rule

Fetch/stream once through the canonical facade, validate once, cache once and fan out to consumers. Do not create page-specific provider requests or duplicate calculation pipelines.

Use request coalescing, bounded concurrency, rate-limit-aware batching and existing caches. Do not trade accuracy for fewer calls: stale or conflicting cache entries must fail honestly.

---

# 5. Lifecycle inventory and defect matrix

Trace the real production code for:

| Stage | Required inventory |
|---|---|
| universe | eligible exchanges/security types, exclusions, delisted/suspended handling |
| instrument resolution | symbol/ISIN/token/exchange mapping and daily master freshness |
| candles/quotes | provider, intervals, session dates, freshness and adjustments |
| fundamentals/events | source, optionality, freshness and fail-closed policy |
| scanner | filters, ranking, concurrency, timeout/cache behavior |
| signal | setup, direction, entry, target, stop, confidence and reasons |
| staged order | limit/reference price, quantity, TTL, event and risk state |
| approval | owner identity, override/affirmation, audit trail and idempotency |
| execution mode | paper/dry-run/live hard blocks |
| open position | actual price, quantity, plan identity and alert |
| monitor | quote freshness, target/stop/trailing/time/event handling |
| close | terminal transition, exit price/reason and deduplication |
| ledger | gross, charges, taxes, net P&L and capital impact |
| UI/API/reports | source parity, lifecycle status, counts and history |

For each confirmed defect record:

```text
ID
severity
production file/function
observable impact
root cause
authorized fix
load-bearing test
```

Implement the matrix after one inventory. Do not run a second broad audit.

---

# 6. Gate A — Universe and instrument resolution

Verify the real Swing universe and canonical resolver.

Required behavior:

- include only supported NSE/BSE cash equities according to the existing policy;
- exclude indices, derivatives, ETFs or other types unless explicitly supported;
- reject unresolved, ambiguous, delisted, suspended or invalid instruments;
- preserve exchange and ISIN identity;
- resolve canonical Kite tokens from the current instrument master;
- distinguish NSE and BSE listings without symbol collision;
- retain proven BSE handling, including securities resolvable only through BSE;
- do not use a stale instrument master silently;
- prevent a symbol change or token rollover from attaching to the wrong security;
- UI, scanner, staged order and portfolio use the same resolved identity.

Add tests for:

- NSE security;
- BSE-only security;
- same-symbol exchange ambiguity;
- special-character symbol;
- missing token;
- suspended/delisted state where represented;
- stale instrument master;
- resolver parity across Scanner, Stock Detail, Portfolio and Swing.

---

# 7. Gate B — Market, candle and corporate-action truth

Verify:

- daily/intraday candles have correct IST/exchange-session boundaries;
- OHLCV fields are finite and internally consistent;
- future timestamps fail closed;
- stale candles cannot masquerade as current;
- gaps/partial sessions are explicit;
- split/bonus/dividend/corporate-action adjustments follow one documented policy;
- adjusted and unadjusted series are never mixed silently;
- volume is not fabricated when unavailable;
- technical indicators consume the canonical candle series used by charts/backtests;
- live LTP and historical close are clearly distinguished;
- provider/fallback provenance survives into candidate and plan records.

Corporate actions and event data are optional only where the existing strategy permits. If a mandatory risk check cannot run, stage/review must fail safely with a machine-readable reason.

Do not fabricate IndianAPI availability. While it is not configured, render/report `NOT_CONFIGURED` and follow the existing conservative event-risk policy.

---

# 8. Gate C — Swing scanning, candidate detection and ranking

Trace the actual scanner from universe input to ranked candidates.

Required invariants:

- filters use canonical values and one unit convention;
- price, liquidity, volume, volatility, trend and technical inputs are finite and fresh;
- missing data cannot become zero and accidentally pass a filter;
- ranking score contributions reconcile with displayed reasons;
- no score contribution is added for unavailable data;
- candidate ranking is deterministic for identical snapshots;
- concurrent provider fetches preserve symbol/result association;
- timeout/partial-universe behavior is explicit;
- a partial scan cannot claim full-market coverage;
- cached results retain source/asOf and are labelled stale when applicable;
- failed rows do not silently disappear from scan diagnostics;
- duplicate securities cannot enter the candidate list twice;
- UI count matches the actual returned candidate array.

Test normal, empty-valid, partial, timeout, provider-error, stale-cache and all-failure paths.

Do not adjust strategy thresholds to increase the result count.

---

# 9. Gate D — Signal, entry, target, stop and risk honesty

Verify each existing Swing strategy/setup and the shared signal builder.

Each signal must contain project equivalents of:

```text
signalId
symbol/exchange/instrumentToken
setup/strategy
direction
confidence/rank
entry trigger/reference
target(s)
stop
risk per share
reward/risk
quantity or proposed quantity
createdAt IST
snapshot/provenance
drivers
risks/rejection reasons
```

Required behavior:

- entry/target/stop derive from documented canonical inputs;
- no missing value becomes zero;
- target and stop ordering is valid for the direction;
- risk/reward arithmetic uses consistent units;
- price rounding follows tick size;
- confidence/ranking matches displayed drivers;
- a signal is not an executed trade;
- watchlist/information-only candidates cannot open a position;
- invalid or stale data demotes/rejects rather than fabricates a plan;
- later quotes do not rewrite the original plan;
- duplicate scan cycles cannot create duplicate active plans.

Preserve current strategy formulas unless a test proves an objective implementation error.

---

# 10. Gate E — Immutable Swing plan and staged order

Verify one immutable Swing plan flows into the staged order.

The staged order must preserve project equivalents of:

```text
stagedOrderId
signalId / planId
owner/user identity
symbol/exchange/token
side
quantity
staged limit/reference price
target/stop
createdAt/expiresAt IST
market snapshot
event-risk state
risk/guardrail state
approval state
execution mode
audit trail
```

Required invariants:

- staged limit is clearly distinguished from current Kite LTP;
- stage creation is idempotent;
- plan/contract/security identity cannot mutate after staging;
- quantity, target and stop cannot silently change during approval;
- TTL uses a deterministic clock and IST-safe dates;
- expired orders cannot be approved or executed;
- rejected/cancelled orders cannot reopen without a new staged identity;
- stale pending orders are swept exactly once;
- duplicate scheduler/API invocation cannot create duplicate stages;
- UI, API and Telegram refer to the same staged order and plan.

Use deterministic test clocks. Do not use hardcoded future calendar dates that become stale with wall-clock time.

---

# 11. Gate F — Event risk, owner review and approval

Trace the actual event-risk and approval functions.

Required behavior:

- known result/corporate-action risk inside the configured proximity window forces review/block according to existing policy;
- unknown mandatory event data is not treated as safe;
- owner affirmation/override is explicit, authenticated, timestamped and auditable;
- an override changes only the approved gate—not strategy, price, quantity, target or stop;
- `resultDateKnown`, result date and corporate-action risk remain internally consistent;
- invalid or contradictory overrides are rejected;
- approval after expiry is rejected;
- approval is idempotent;
- wrong owner/unauthorized user is rejected;
- rejection reason is stable and machine-readable;
- UI and Telegram clearly distinguish `STAGED`, `APPROVAL_REQUIRED`, `REJECTED`, `EXPIRED`, `APPROVED_DRY_RUN` and risk-blocked states.

Preserve the repaired moving-date fixture behavior; use `now + safe margin` or a fixed fake clock, never a date that expires as real time passes.

---

# 12. Gate G — Market-hours and execution-mode safety

Scanning and staging may legitimately occur outside market hours according to existing policy. Opening/executing a new paper/live position must follow the approved execution-session policy.

Permanently close the known class of defects where an equity paper trade could be recorded on a weekend, holiday or outside the permitted session.

Required behavior:

- authoritative IST market/session service owns execution eligibility;
- weekend/holiday/special-session behavior is explicit;
- missing/stale/error market state does not default to open;
- staged/approved is not equivalent to executed/open;
- outside-hours execution is blocked with a stable reason;
- the next valid session may re-evaluate a still-valid approved stage according to existing policy;
- expired approval cannot carry into a later session;
- paper-only and dry-run modes never call live Kite order placement;
- `LIVE_CASH_SWING_ORDER_ENABLED=false` remains a hard block;
- `SWING_CASH_EXECUTION_MODE=paper_only` remains effective;
- environment-variable combinations cannot bypass the production live-order lock unintentionally;
- test mode cannot contact Kite or another live service.

Add boundary tests for 09:14:59, 09:15:00, 15:30:00, after close, weekend, holiday, unknown market state and a configured special session.

---

# 13. Gate H — Paper/dry-run opening and persistence boundary

Verify the actual production open transition using mocked repository/store boundaries.

An opened Swing paper position must preserve:

```text
tradeId
stagedOrderId
signalId / planId
symbol/exchange/token
side
quantity
actual entry/reference price
openedAt IST
source/asOf/snapshot
target/stop
execution mode
status
approval/event/risk provenance
```

Required behavior:

- modelled, staged, approved and opened remain distinct states;
- a successful owner approval does not itself fabricate an execution;
- entry price comes from the canonical trade-grade quote according to existing policy;
- stale/unavailable/untrusted quote blocks opening;
- duplicate request/job cannot open twice;
- persistence failure cannot emit a false OPEN alert;
- successful open emits at most one alert after persistence;
- opened counts reconcile with successful open transitions;
- live order transport remains uncalled.

Do not connect to PostgreSQL in ordinary tests.

---

# 14. Gate I — Monitoring and exit lifecycle

Trace the real Swing monitor/sweep functions through every terminal transition already supported.

Verify project equivalents of:

```text
TARGET_HIT
STOP_HIT
TRAILING_STOP
TIME_TO_LIVE / MAX_HOLD_EXIT
EVENT_RISK_EXIT
MARKET_RISK / EMERGENCY_EXIT
MANUAL_CLOSE
DATA_BLOCKED / REVIEW_REQUIRED
```

Required invariants:

- monitoring uses canonical current price and timestamps;
- target/stop come from the immutable plan;
- stale/unavailable price does not fabricate an exit;
- same-candle target/stop ambiguity follows one deterministic documented rule;
- gaps through target/stop follow the existing explicit fill model;
- corporate actions do not silently corrupt target/stop/quantity;
- one trade can close only once;
- retry and scheduler overlap are idempotent;
- closed trades leave active monitoring once;
- failed persistence cannot emit a false CLOSE alert;
- exit alert uses the persisted exit price/reason;
- timestamps and holding period use IST/trading dates correctly;
- data-risk states remain visible and recoverable.

Do not invent a new trailing-stop or exit strategy. Test only implemented policies and correct objective defects.

---

# 15. Gate J — Equity charges, taxes, P&L and capital

Verify the centralized cash-equity charge and P&L engine.

For each closed Swing paper trade reconcile project equivalents of:

```text
grossPnl
brokerage
exchangeTransactionCharges
regulatory/sebi charges
GST on applicable charges
stamp duty where applicable
STT according to delivery/intraday and side policy
other configured levies
totalCharges
netPnl
capital impact
```

Required arithmetic:

```text
grossPnl = signed(exitPrice - entryPrice) × quantity
netPnl = grossPnl - totalCharges
```

Required behavior:

- delivery versus intraday treatment follows the existing product policy;
- charges use one centralized versioned configuration;
- UI does not contain a second rate table;
- gross, charges and net remain separate;
- unrealized and realized P&L remain separate;
- missing entry/exit/quantity does not become zero P&L;
- capital is affected once after a terminal close;
- duplicate close/reconciliation cannot double-apply P&L;
- day, symbol, setup, trade and cumulative reports reconcile to ledger rows;
- staged/rejected/modelled outcomes are excluded from realized P&L.

Do not guess or silently update statutory rates. If an existing rate appears outdated, identify its source/date and report the exact blocker for owner review.

---

# 16. Gate K — API, schema, OpenAPI and client parity

For every Swing response changed in this pack, maintain parity across:

```text
domain type
production Zod schema
registered route serializer
openapi.yaml
generated API client type
frontend query/component
```

Test real registered routes for project equivalents of:

- Swing candidates/scanner;
- signal/plan detail;
- staged orders;
- approval/rejection/expiry;
- open Swing paper positions;
- closed positions/history;
- Swing P&L/summary/reports;
- diagnostics/skip reasons.

Required route states:

```text
normal data
valid empty
partial/degraded scan
provider/data error
staged
approval required
approved dry-run
rejected
expired
opened
closed
```

Prove authentication and owner authorization on mutation/review routes.

No schema/serializer may strip plan, approval, execution, provenance, exit or P&L fields needed by UI/history.

Do not let `?? []`, `?? 0` or a default object convert producer failure into successful empty/zero output.

---

# 17. Gate L — Production UI and cross-tab consistency

Render the actual production Swing components or smallest real routed production boundaries for:

- Swing Scanner/candidate list;
- Swing candidate/signal detail;
- staged-order review;
- approval/rejection controls;
- open Swing paper trades;
- closed/history rows;
- P&L/report summary;
- portfolio linkage where applicable.

Required states:

```text
LOADING
READY
EMPTY_VALID
STALE
PARTIAL
DEGRADED
ERROR
STAGED
APPROVAL_REQUIRED
APPROVED_DRY_RUN
REJECTED
EXPIRED
OPEN
CLOSED
DATA_BLOCKED
```

Rules:

- missing values render unavailable, never zero/green/up;
- failed requests do not appear as empty success;
- cached data after refetch failure remains visible with stale/degraded label;
- partial scans do not claim full-universe coverage;
- staged limit and current Kite LTP are labelled separately;
- modelled/staged/approved/opened/closed states cannot be confused;
- all timestamps are IST;
- source/freshness/provenance is visible where decision-relevant;
- Scanner, Stock Detail, Portfolio, Swing, Paper Trading and Reports agree on shared identity/prices for the same snapshot;
- gross, charges and net P&L remain distinct.

For one representative trade fixture, assert exact cross-surface parity of identity, plan, prices, quantity, status, exit, P&L and timestamps.

---

# 18. Gate M — Telegram lifecycle and deduplication

Invoke the actual Swing alert formatter/notification boundary using mocked transport.

Verify existing project events such as:

```text
STAGED
APPROVAL_REQUIRED
EXPIRED
REJECTED
APPROVED_DRY_RUN
BLOCKED_BY_RISK
PAPER_OPENED
TARGET/STOP/TIME/EVENT CLOSED
DATA_DEGRADED
RECOVERY
```

Required behavior:

- alert identity matches API/UI trade/plan/stage identity;
- staged limit is not presented as Kite LTP;
- approval does not claim execution;
- live execution is never claimed in paper/dry-run mode;
- OPEN/CLOSE alerts occur only after persisted transitions;
- retry/scheduler overlap cannot duplicate alerts;
- event-specific dedup keys do not suppress later recovery/close events;
- missing data is omitted/labelled unavailable, never zero;
- severity/icon matches the event;
- timestamps use IST;
- transport failure does not incorrectly mutate trading state.

Do not contact live Telegram.

---

# 19. Gate N — Lifecycle reconciliation and reporting

Create one deterministic production-shaped Swing cohort including:

- scanned but rejected candidate;
- valid signal not staged;
- staged order awaiting approval;
- rejected or expired stage;
- approved dry-run stage;
- paper-opened trade still open;
- target-closed trade;
- stop/time/event-closed trade supported by production;
- data-blocked/review-required state where represented.

Reconcile project equivalents of:

```text
universeEligible
symbolsAttempted
symbolsSucceeded
symbolsFailed
candidatesDetected
signalsCreated
staged
approvalRequired
approved
rejected
expired
paperOpened
paperStillOpen
paperClosed
dataBlocked
```

Explain the exact production equations and exclusions. Do not force an invalid identity merely to make totals add up.

For the same cohort prove:

- candidate/stage/open/close counts reconcile;
- rejected/expired/modelled records are excluded from realized P&L;
- open unrealized and closed realized P&L are separate;
- gross, charges and net reconcile;
- date, symbol, setup, status and exit-reason reports sum to canonical totals;
- Swing UI, Portfolio, Paper Trading, Daily Analysis and exports use the same ledger/calculation functions.

---

# 20. Required tests

Use ordinary non-DB tests with mocked provider/store/notification/order-transport boundaries.

At minimum include:

## 20.1 Data/universe/scanner

- canonical resolver for NSE/BSE cases;
- stale/future/missing/partial data;
- canonical candle and quote consistency;
- corporate-action/event unavailable states;
- full, partial, timeout, empty and all-failure scans;
- deterministic ranking and no duplicate candidates.

## 20.2 Signal/staging/approval

- valid and invalid signal plans;
- immutable entry/target/stop/quantity;
- stage idempotency;
- TTL expiry using fake clock;
- result/event proximity gate;
- valid owner affirmation;
- contradictory/unauthorized override;
- approval after expiry;
- staged limit versus LTP truth.

## 20.3 Execution/opening

- market boundary times;
- weekend/holiday/special session;
- unknown/stale market state;
- paper-only/dry-run hard blocks;
- valid paper open;
- stale/untrusted quote rejection;
- duplicate-open prevention;
- persistence failure and alert ordering;
- proof no live order transport call occurs.

## 20.4 Monitoring/exits

- target, stop and every existing exit reason;
- same-candle ambiguity;
- gap handling;
- stale/missing price;
- retry and duplicate close;
- failed persistence;
- corporate-action impact policy;
- exit alert parity.

## 20.5 P&L/reports

- winning, losing and flat trades;
- long/short only where supported;
- quantity and tick-size arithmetic;
- every production charge component;
- gross/net reconciliation;
- realized/unrealized separation;
- no double capital application;
- cohort count/report reconciliation.

## 20.6 Real boundaries

Include tests invoking:

- actual production Swing services;
- registered HTTP routes and middleware;
- production Zod schemas;
- actual OpenAPI specification where changed;
- generated-client contract;
- real production React components for changed states;
- real Telegram formatter/notification service with mocked delivery.

Pure-helper/source-regex tests may supplement but cannot replace behavioral tests.

---

# 21. Verification battery

## 21.1 Preserved baselines

Preserve at minimum:

```text
api-server: 4,744 passing / 0 failing
scanner: 930 passing / 0 failing
```

New tests must increase the appropriate totals. Reconcile the exact increase.

## 21.2 Targeted Swing suites

Run and report exact per-file results for existing and new Swing suites, including project equivalents of:

- scanner/store tests;
- staged-order tests;
- pure Swing staging tests;
- event-risk tests;
- TTL sweep tests;
- guardrail/admission tests;
- paper open/monitor/exit tests;
- capital/P&L/charges tests;
- API/schema/route tests;
- UI/component tests;
- Telegram alert tests;
- new Pack 3 lifecycle tests.

Do not execute `.db.test.ts` files.

## 21.3 Full suites

Run:

- full API-server non-DB suite;
- full Scanner suite;
- all affected frontend/component suites;
- all Pack 3 targeted tests.

## 21.4 Typechecks and builds

Run actual repository commands for:

- API server TypeScript;
- API Zod TypeScript;
- API client React TypeScript;
- Scanner TypeScript;
- Global/web TypeScript;
- relevant shared/database library TypeScript if touched;
- API-server production build;
- Scanner production build;
- Global/web production build;
- `git diff --check`.

## 21.5 Integrity

Prove no new:

- `.skip`, `.only`, quarantine or retry markers;
- arbitrary sleeps or wall-clock-dependent fixture dates;
- weakened assertions;
- live provider/Telegram/Kite-order calls in tests;
- PostgreSQL connections in ordinary tests;
- secret output;
- direct provider calls from UI;
- Yahoo data in decision/execution paths;
- null-to-zero fabrication;
- unrelated F&O, migration, dependency or deployment changes.

---

# 22. Evidence file

Create one concise evidence file:

```text
artifacts/audit-evidence/FAST_TRACK_PACK_3_COMPLETE_SWING_TRADING_LIFECYCLE.md
```

It must contain:

1. final verdict;
2. complete Swing lifecycle matrix;
3. confirmed defects and exact fixes;
4. canonical-data/provider result;
5. universe/resolver/scanner proof;
6. signal/plan/staging/approval proof;
7. market-hours and execution-mode safety;
8. open/monitor/exit proof;
9. charges and P&L reconciliation;
10. API/schema/client/UI/Telegram parity;
11. lifecycle-count/report reconciliation;
12. targeted and full test counts;
13. typecheck/build results;
14. exact changed-file inventory;
15. Git starting/final observed state and platform auto-commit chronology;
16. confirmation of no manual commit, push, deployment, DB or live-order action;
17. SHA-256 after final write;
18. production deployment status.

Use exactly one terminator as the final nonblank line:

```text
END_FAST_TRACK_PACK_3_COMPLETE_SWING_TRADING_LIFECYCLE
```

Do not rewrite historical evidence files.

---

# 23. Required final response

Return a concise completion report—not an execution diary—with:

1. Verdict.
2. Swing lifecycle matrix.
3. Canonical data and resolver result.
4. Scanner/signal/plan result.
5. Staging/event-risk/approval result.
6. Market-hours and execution-mode safety.
7. Open/monitor/exit result.
8. Charges/P&L/report reconciliation.
9. API/UI/Telegram parity.
10. Exact test totals.
11. Typecheck/build results.
12. Git/evidence integrity.
13. Remaining genuine blockers.
14. Production status.

The only successful verdict is:

```text
ACCEPT_FAST_TRACK_PACK_3_COMPLETE_SWING_TRADING_LIFECYCLE
```

Use it only when Gates A–N pass and no in-scope defect is deferred.

If a genuine owner-controlled blocker prevents safe completion, return:

```text
BLOCKED_FAST_TRACK_PACK_3_COMPLETE_SWING_TRADING_LIFECYCLE
```

with the exact gate, production impact and minimum owner decision. Complete all independent work before stopping.

Production must remain:

```text
PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED
```

After acceptance, freeze Pack 3 and stop. Do not begin final hardening, operational cleanup, provider activation or deployment without the separate owner instruction.
