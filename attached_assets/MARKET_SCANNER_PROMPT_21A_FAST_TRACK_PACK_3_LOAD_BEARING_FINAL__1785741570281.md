# MARKET SCANNER — PROMPT 21A

## Fast-Track Pack 3: Load-Bearing Final Closure and Freeze

### Instruction to the Replit coder

Prompt 21 produced useful Swing lifecycle work and reported:

```text
p21.swingEqMonitorExit.test.ts: 40/40
p21.swingPnlCharges.test.ts: 31/31
p21.swingSchemaRoutes.test.ts: 45/45
p21.swingTelegramParity.test.ts: 21/21
p21.swingCohortReconciliation.test.ts: 32/32
Pack 3 new tests: 172/172
api-server full suite: 4,916/4,916
scanner full suite: 930/930
five typechecks: clean
three production builds: pass
```

Preserve all these results.

Pack 3 cannot yet be frozen from the submitted summary because three load-bearing gaps remain:

1. The duplicate-stage production fix is a pre-insert `SELECT` followed by `INSERT`. Without an atomic persistence boundary, concurrent requests can both observe no active stage and both insert. This is a time-of-check/time-of-use race.
2. Gates A–F—universe/resolver, data/candle truth, scanner/ranking, signal/plan, staged-order immutability and event-risk approval—were not identified in the submitted five-file evidence matrix.
3. Gate L—real production Swing UI and cross-tab behavior—was absent from the submitted test matrix.

The current status is:

```text
PACK_3_NOT_FROZEN — LOAD_BEARING_CLOSURE_PENDING
```

Perform one narrow closure pass for these exact gaps. Do not reopen the full Swing lifecycle audit and do not create another roadmap.

No manual commit, push, pull, fetch, publish or deployment is authorized.

Do not provision/connect to PostgreSQL in tests, execute `.db.test.ts`, run Prompt 15 or change `DB_TEST_RUNTIME_AUTHORIZED`.

Do not place or contact a live Kite order endpoint.

---

# 1. Closure objective and sequence

Use this sequence only:

1. Read the existing Prompt 21 diff, evidence and exact production boundaries needed below.
2. Make staged-order idempotency atomic and prove concurrency behavior.
3. Cite existing production tests for Gates A–F and add only missing load-bearing cases.
4. Test the real registered Swing routes.
5. Test the real production Swing components for Gate L.
6. Reconfirm outside-hours and live-order hard blocks at the production boundary.
7. Run one final Pack 3 battery.
8. Update the existing Pack 3 evidence file.
9. Return the final verdict and stop.

Do not repeat the Gate H–N source inventory. Preserve their 172 Prompt 21 tests and cite them where applicable.

Do not defer an in-scope defect into a follow-up task while claiming acceptance.

---

# 2. Frozen safeguards

Preserve:

- every accepted Prompt 21 production/test change;
- canonical Kite-first price/candle/instrument routing;
- Upstox only as a configured and validated secondary;
- IndianAPI only for validated enrichment;
- Yahoo exclusion from trading decisions;
- future/stale/fallback/provenance safeguards;
- existing Swing strategies, thresholds, ranking and risk formulas;
- immutable signal-plan semantics;
- staged-order TTL and event-risk policy;
- paper-only/dry-run/live-order hard blocks;
- IST market/session behavior;
- charges/gross/net P&L separation;
- API/schema/client/UI/Telegram parity already proven by Prompt 21;
- ordinary-test zero-database-connection protection;
- the accepted F&O lifecycle.

Do not add a strategy, change thresholds, activate providers, alter capital limits, clean data residue, create unrelated migrations or modify F&O behavior.

---

# 3. Closure Gate 1 — Atomic staged-order idempotency

## 3.1 Confirm the current race

Read the actual `stageSwingOrder` production implementation and its repository/store operations.

Document the current sequence introduced in Prompt 21, expected to be equivalent to:

```text
SELECT active unexpired stage for ownerKey + symbol
if found → DUPLICATE_ACTIVE_STAGE
else → INSERT new stage
```

Explain whether the check and insert execute inside one atomic database operation, a transaction with a cross-process lock, or two independent statements.

Do not call the implementation atomic merely because ordinary sequential tests pass.

## 3.2 Required durable invariant

For a normalized owner/security identity, there may be at most one active unexpired staged order under the existing active-status policy.

The invariant must hold when:

- two calls arrive concurrently in one process;
- two scheduler/request paths overlap;
- two application instances share the same persistence layer;
- a retry occurs after an uncertain response;
- the existing stage is expired;
- the existing stage is rejected/cancelled/terminal;
- two different owners stage the same symbol;
- one owner stages two different symbols;
- NSE/BSE symbol ambiguity is present.

Use the canonical identity actually required by production. If `ownerKey + symbol` is insufficient because exchange/security identity can differ, correct the key to the existing canonical `owner + exchange + token/ISIN` equivalent without broad schema redesign.

## 3.3 Authorized implementation

Implement a persistence-enforced atomic claim using the safest existing repository pattern, such as:

- an existing atomic claim/`INSERT ... ON CONFLICT DO NOTHING` abstraction backed by an appropriate uniqueness invariant;
- a transaction-scoped PostgreSQL advisory lock plus check-and-insert;
- another existing cross-process persistence primitive that demonstrably serializes the owner/security stage claim.

The exact implementation must be compatible with the repository's current schema and transaction layer.

Do not rely only on:

- an in-memory `Map`, mutex or boolean;
- a pre-insert query outside the atomic transaction;
- a catch of a generic insertion error without a stable duplicate result;
- a test-only mock that serializes calls artificially.

If the schema cannot support a durable atomic invariant without a production migration, stop only this gate and report the exact schema limitation and minimal non-destructive migration proposal. Continue every other independent closure gate. Do not create the migration without owner authorization.

## 3.4 Required behavior

- one winner returns the existing successful staged result;
- all concurrent losers return stable `DUPLICATE_ACTIVE_STAGE` or the repository's equivalent;
- exactly one row/record is created;
- no loser emits a false STAGED or APPROVAL_REQUIRED notification;
- retries return deterministic state rather than creating another stage;
- expired/terminal records do not block a legitimate new stage;
- persistence failure is distinct from duplicate-active-stage;
- the implementation remains idempotent if the alert transport fails after persistence.

## 3.5 Load-bearing tests

Add deterministic tests using the real production service and an instrumented store/transaction boundary:

1. two concurrent identical calls via `Promise.all` create one record;
2. a larger concurrent batch creates one record;
3. losers receive the stable duplicate result;
4. exactly one notification is requested after successful persistence;
5. notification failure does not permit a second row on retry;
6. an expired stage permits one new active stage;
7. rejected/cancelled/terminal stage permits one new stage according to policy;
8. two owners may independently stage the same security;
9. one owner may independently stage two securities;
10. canonical exchange/token identity prevents symbol collision;
11. persistence error remains an error, not `DUPLICATE_ACTIVE_STAGE`;
12. source/static proof confirms the check and insert share the actual atomic boundary.

Ordinary tests must not connect to PostgreSQL, but they must exercise the real service and transaction/claim abstraction rather than duplicating the logic inside the test.

---

# 4. Closure Gate 2 — Gates A–F executable evidence

Do not rewrite existing test coverage. Build a manifest mapping each requirement below to an exact existing test name and production function. Add tests only where no real behavioral proof exists.

## 4.1 Gate A — Universe and canonical resolver

Prove through real production resolver/universe functions:

- supported NSE equity;
- BSE-only equity;
- same-symbol exchange ambiguity;
- special-character symbol;
- missing/invalid token;
- unsupported asset type;
- stale instrument master behavior;
- consistent identity across Scanner, Stock Detail, Portfolio and Swing stage.

The test must not reproduce resolver logic locally.

## 4.2 Gate B — Candle, quote and corporate-event truth

Prove through canonical production facades/validators:

- fresh valid candle/quote;
- stale input;
- materially future timestamp;
- partial/missing OHLCV;
- invalid OHLC relationship/non-finite value;
- source/fallback/provenance propagation;
- adjusted/unadjusted policy where represented;
- IndianAPI/event source `NOT_CONFIGURED` behavior;
- mandatory event-risk uncertainty fails safely rather than becoming “no risk.”

No live provider call is permitted.

## 4.3 Gate C — Scanner, candidate and ranking

Invoke the real production scanner/ranker and prove:

- deterministic ranking for identical snapshot;
- missing data does not become zero and pass a filter;
- duplicate security is emitted once;
- concurrency preserves symbol/result mapping;
- partial scan is labelled partial;
- timeout/provider failure is counted and visible;
- valid empty differs from all-failure;
- cached result retains source and `asOf`;
- UI count equals returned candidate count.

Do not change strategy thresholds.

## 4.4 Gate D — Signal and immutable plan

Invoke the actual production signal/plan builder and prove:

- valid entry/target/stop ordering;
- finite risk/reward arithmetic;
- missing required input rejects/demotes honestly;
- tick-size/price rounding uses the shared production helper;
- displayed reasons reconcile with score/rank;
- later quote changes cannot mutate entry, target, stop, quantity, direction or identity;
- duplicate scan cannot create duplicate active plans;
- modelled/watchlist signal cannot be treated as opened.

## 4.5 Gate E — Staged-order TTL and immutability

In addition to the atomic claim tests, prove:

- staged limit and current Kite LTP remain separate;
- `createdAt`/`expiresAt` uses deterministic IST-safe timing;
- expired stage cannot be approved/executed;
- approval does not modify plan/price/quantity/target/stop;
- stale sweep transitions once;
- wall-clock-independent fixtures use fake time or relative safe dates.

## 4.6 Gate F — Event risk and owner approval

Invoke the actual production event/approval boundary and prove:

- event/result proximity inside boundary blocks/requires review;
- date just outside boundary follows policy;
- unknown mandatory event data is not safe by default;
- valid owner affirmation clears only the event review gate;
- contradictory override rejects;
- unauthorized owner rejects;
- approval after expiry rejects;
- repeated approval is idempotent;
- stable audit/reason fields survive to API/UI/Telegram.

Produce a concise table:

```text
Gate | Production function | Existing/new test file | Exact test count | Result
```

Do not claim a gate based on source-text inspection alone.

---

# 5. Closure Gate 3 — Registered Swing route execution

The Prompt 21 file `p21.swingSchemaRoutes.test.ts` must be classified honestly: identify which tests invoke registered HTTP handlers and which only parse schemas/constructed payloads.

Add or identify actual registered-route tests for project equivalents of:

```text
GET Swing candidates/scanner result
GET staged orders
POST/PUT stage Swing order
POST/PUT owner approve/reject
GET open Swing positions
GET closed Swing history
GET Swing summary/P&L/report
```

Use the real authentication/authorization middleware and production Zod serializer.

At minimum prove:

- anonymous/unauthorized behavior;
- owner-authorized behavior;
- normal HTTP 200 schema-valid response;
- valid empty response;
- partial/degraded scan response;
- producer failure is not empty success;
- duplicate-stage response uses stable code/status;
- unauthorized approval rejects;
- approval after expiry rejects;
- staged/approved/open/closed statuses preserve plan/trade identity;
- source/freshness/provenance survives serialization;
- missing values remain null/optional/unavailable, never fabricated zero;
- no registered route can bypass paper-only/live-order safety.

Mock provider/store/order-transport boundaries only. Invoke the real registered route and serializers.

---

# 6. Closure Gate 4 — Gate L real production UI

Add real production-component tests for the actual Swing surfaces. Pure helpers and source regex may supplement but cannot satisfy this gate.

Render the actual project components or smallest routed production boundaries for:

- Swing candidate/scanner list;
- staged-order review card/table;
- owner approval/rejection controls;
- open Swing paper trade row/card;
- closed/history row;
- Swing P&L/summary;
- data/provenance state used by these surfaces.

## 6.1 Required data states

Prove:

```text
INITIAL_LOADING
READY_WITH_DATA
EMPTY_VALID
PARTIAL_SCAN
STALE_WITH_DATA
INITIAL_ERROR_WITHOUT_DATA
REFETCH_ERROR_WITH_CACHED_DATA
```

Rules:

- loading does not fabricate rows/counts/P&L;
- producer error does not become empty success;
- partial scan shows coverage/failure truth;
- cached data after refetch failure remains visible and stale/degraded;
- missing numeric values render unavailable, not zero/green/up;
- source/`asOf`/freshness is visible where decision-relevant.

## 6.2 Required lifecycle states

Prove real UI behavior for:

```text
MODELLED / WATCHLIST
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

- staged limit is not labelled Kite LTP;
- approval is not displayed as execution;
- paper/dry-run never displays live-order success;
- expired/rejected stage disables inappropriate approval action;
- retry/repeated click cannot create a duplicate active stage;
- open/closed displays retain canonical plan/trade identity;
- entry/exit prices, quantity, gross, charges and net match the API fixture;
- timestamps render in IST;
- missing fields do not become `₹0.00` or false neutral/positive values.

## 6.3 Cross-tab parity

For one representative production-shaped Swing trade, assert equality across relevant Swing, Portfolio/Paper Trading, History and Report components for:

```text
symbol/exchange/token
signalId / planId / stagedOrderId / tradeId
side and quantity
staged limit versus current LTP labels
entry/target/stop
status
exit price/reason
gross P&L
charges
net P&L
session/timestamps
source/asOf
```

Do not create component-specific provider calls or calculations.

---

# 7. Closure Gate 5 — Outside-hours and live-order safety

Preserve Prompt 21 Gate G/H tests and identify the exact production function enforcing the market/execution gate.

Add or identify production-boundary proof for:

- 09:14:59 IST blocked;
- 09:15:00 IST permitted only when all other gates pass;
- 15:30:00 boundary according to existing policy;
- after-close blocked;
- weekend blocked;
- official holiday blocked;
- unknown/stale market state blocked;
- configured special session follows configuration;
- an approved stage does not equal executed/open;
- expired approval cannot execute next session;
- `SWING_CASH_EXECUTION_MODE=paper_only` prevents live order call;
- `LIVE_CASH_SWING_ORDER_ENABLED=false` remains a hard block;
- contradictory environment values cannot bypass the hard block;
- no test contacts Kite.

Include a regression specifically covering the historical defect class: an equity paper trade must not be recorded outside the permitted market session merely because a stage or approval already exists.

---

# 8. Verification battery

## 8.1 Preserve Prompt 21

Preserve at minimum:

```text
Prompt 21 targeted tests: 172/172
api-server full suite: 4,916 passing / 0 failing
scanner full suite: 930 passing / 0 failing
```

New closure tests should increase the appropriate totals. Reconcile the increase exactly.

Do not delete, skip, quarantine or weaken Prompt 21 tests.

## 8.2 Per-file Swing results

Run and report exact per-file results for:

- resolver/universe tests;
- candle/quote/provenance tests;
- scanner/ranking tests;
- signal/plan tests;
- staged-order/TTL/event-risk tests;
- market/execution safety tests;
- open/monitor/exit tests;
- charges/P&L tests;
- schema/registered-route tests;
- Telegram tests;
- production-component UI tests;
- cohort/reconciliation tests;
- all Prompt 21/21A tests.

Report an exact combined total and explain new test-count arithmetic.

## 8.3 Full suites

Run:

- full API-server non-DB suite;
- full Scanner suite;
- affected Global/web component suites if Swing surfaces exist there;
- all Pack 3 targeted tests.

Do not execute `.db.test.ts` files.

## 8.4 Typechecks

Run actual commands for:

- API server;
- API Zod;
- API client React;
- Scanner;
- Global/web;
- relevant shared/database library if touched.

## 8.5 Production builds

Run:

- API-server build;
- Scanner build;
- Global/web build.

## 8.6 Integrity

Run `git diff --check` and prove no new:

- `.skip`, `.only`, retries or quarantine;
- arbitrary sleeps/stale fixed dates;
- assertion weakening;
- live provider/Telegram/Kite-order calls from tests;
- PostgreSQL connections in ordinary tests;
- secret output;
- direct provider calls from UI;
- Yahoo data in trading decisions;
- null-to-zero fabrication;
- unrelated F&O, migration, dependency or deployment changes.

---

# 9. Evidence and Git record

Update the existing file only:

```text
artifacts/audit-evidence/FAST_TRACK_PACK_3_COMPLETE_SWING_TRADING_LIFECYCLE.md
```

Add a final closure section containing:

1. Prompt 21 production-change reconciliation;
2. atomic staged-order implementation and concurrency proof;
3. Gates A–F manifest with exact production functions/tests;
4. registered-route results;
5. production UI/cross-tab results;
6. outside-hours/live-order safety proof;
7. preserved H–N results;
8. exact per-file and full-suite totals;
9. typecheck/build results;
10. exact changed/new/deleted file inventory;
11. starting and final observed HEAD;
12. branch/upstream/ahead-behind without fetching;
13. tracked/staged/untracked status;
14. platform auto-commit chronology;
15. confirmation of no manual commit, push, deployment, DB or live-order action;
16. SHA-256 after the final evidence write;
17. production status.

The final nonblank line must be exactly:

```text
END_FAST_TRACK_PACK_3_LOAD_BEARING_FINAL_CLOSURE
```

It must occur exactly once.

Do not create a new evidence file or a new follow-up task for an in-scope defect.

---

# 10. Required final response

Return a concise closure report—not an execution diary—with:

1. Verdict.
2. Atomic staged-order concurrency result.
3. Gates A–F production-test manifest.
4. Registered-route result.
5. Production UI and cross-tab result.
6. Market-hours/live-order safety.
7. Preserved H–N result.
8. Exact targeted/full-suite counts.
9. Typecheck/build results.
10. Git/evidence integrity.
11. Remaining genuine blockers.
12. Production status.

The only successful verdict is:

```text
ACCEPT_FAST_TRACK_PACK_3_COMPLETE_SWING_TRADING_LIFECYCLE_FINAL
```

Use it only when all five closure gates pass, the staged-order claim is genuinely atomic across concurrent production callers, and no in-scope defect is deferred.

If a persistence-level schema limitation prevents durable atomicity, return:

```text
BLOCKED_FAST_TRACK_PACK_3_ATOMIC_STAGE_INVARIANT
```

with the exact current schema/index/transaction limitation and minimal safe owner decision. Complete every independent closure gate before returning the blocker.

For another genuine owner-controlled blocker, return:

```text
BLOCKED_FAST_TRACK_PACK_3_LOAD_BEARING_FINAL_CLOSURE
```

with the exact failing boundary, assertion and production impact.

Production remains:

```text
PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED
```

After acceptance, freeze Pack 3 and stop. Do not begin final hardening, provider activation, cleanup or deployment without the separate owner instruction.
