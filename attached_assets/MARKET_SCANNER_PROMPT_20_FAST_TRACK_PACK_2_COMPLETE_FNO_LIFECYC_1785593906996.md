# MARKET SCANNER — PROMPT 20

## Fast-Track Delivery Pack 2: Complete F&O Signal-to-Exit, Paper Trading, P&L and Reporting

### Instruction to the Replit coder

Fast-Track Pack 1 is accepted and frozen:

```text
ACCEPT_FAST_TRACK_PACK_1_COMPLETE_WEBSITE_SURFACES_FINAL
```

Preserve its production corrections and closing baselines:

```text
api-server: 4,528/4,528
scanner: 878/878
p19.packTests.test.ts: 51/51
p19a.indexDetail.test.tsx: 16/16
p19a.foSummary.test.tsx: 19/19
```

Do not reopen A0.3, B0, B1.1, B2.1, Prompt 19 or Prompt 19A.

This prompt authorizes the full Fast-Track Pack 2 implementation. Do not ask whether to begin because of task size. Work through the complete coverage checklist in controlled batches so nothing is omitted.

No manual commit, push, pull, fetch, publish or deployment is authorized.

Do not provision or connect to an external test database. Do not execute Prompt 15. Do not alter `DB_TEST_RUNTIME_AUTHORIZED`.

---

# 1. Pack objective

Complete and prove the existing Index-F&O lifecycle for the supported cash indices:

```text
NIFTY
BANKNIFTY
SENSEX
```

The lifecycle to complete is:

```text
CANONICAL MARKET DATA
  → DATA-QUALITY GATES
  → SETUP AVAILABILITY
  → CANDIDATE DETECTION
  → CONFLUENCE / CONFIDENCE / VETOES
  → SIGNAL TIER
  → CONTRACT SELECTION
  → IMMUTABLE SIGNAL PLAN
  → PAPER-ADMISSION GATES
  → PAPER POSITION OPEN
  → LIVE PREMIUM MONITORING
  → TARGET / STOP / TIME / EXPIRY EXIT
  → CHARGES / STT / NET P&L
  → CLOSED-TRADE LEDGER
  → UI / TELEGRAM / HISTORY / REPORTS / RECONCILIATION
```

Every transition must be accurate, explainable, idempotent, observable and backed by the same canonical data root.

This pack completes existing F&O functionality. It must not invent a new strategy, retune the system for more signals or optimize historical returns.

---

# 2. Fast-track execution rules

Use this exact sequence:

1. One read-only preflight.
2. One bounded F&O lifecycle inventory.
3. One concise defect matrix with severity and production impact.
4. Implement all confirmed Pack 2 defects in lifecycle batches.
5. Add actual production-function, registered-route and production-component tests.
6. Run targeted tests after each batch.
7. Run one complete Pack 2 regression/typecheck/build battery.
8. Write one Pack 2 evidence file.
9. Return the result and stop.

Do not repeatedly audit the same file.

Do not create another roadmap or resurrect an old task plan.

Do not defer an in-scope defect merely because it touches another F&O lifecycle stage. Maintain a live coverage checklist and close every listed stage before returning an acceptance verdict.

Stop only for a genuine blocker that requires an owner decision, such as an unavoidable destructive production-data operation, a new credential, an external paid-provider activation or a required schema migration with operational impact.

Documentation/attachment-only platform auto-commits may be recorded and treated according to the existing governance exception. Stop for unexpected production, test, schema, migration, dependency, build or deployment changes.

---

# 3. Frozen safeguards and boundaries

Preserve all accepted safeguards, including:

- canonical Kite-first data routing;
- B1.1 future-timestamp fail-closed handling;
- explicit provenance, freshness, fallback and degradation metadata;
- Prompt 19 cross-tab data consistency;
- A0.3 authoritative VWAP and setup-availability honesty;
- recovery veto, chase veto and anti-flip protections;
- existing strategy thresholds, weights and confidence bands unless a calculation is objectively broken;
- immutable signal plans;
- P1 exit-premium market shadow safeguards;
- P1 Kite OI unit verification;
- P1A gross-versus-net P&L and STT separation;
- B0 market-state and alert reliability;
- authentication and authorization;
- ordinary-test zero-PostgreSQL-connection protection;
- existing capital limits, P25/guardrails and dynamic-lot policy.

Do not:

- add a new F&O strategy;
- increase signal volume by weakening admission gates;
- change a threshold merely because few trades are emitted;
- substitute spot for VWAP, OI, volume, option premium or another unavailable indicator;
- use Yahoo or NSE display fallback for trading decisions;
- fabricate provider activation;
- place live broker orders;
- modify swing-trading behavior;
- clean operational residue;
- create a production migration without explicit owner approval;
- contact live providers from automated tests.

Upstox and IndianAPI remain optional until configured. Their absence must not block the Kite-first F&O engine.

---

# 4. Canonical F&O data contract

All F&O stages and all related tabs must consume the same canonical internal data backbone.

## 4.1 Provider policy

| Data domain | Authoritative source | Permitted secondary behavior |
|---|---|---|
| index spot/LTP/OHLC | Kite | Upstox only after configuration and parity validation |
| live option chain, strikes, expiry, bid/ask, OI | Kite | Upstox only through an approved canonical facade |
| intraday/historical candles | Kite | validated Upstox/canonical warehouse path |
| signal and paper-admission inputs | canonical Kite-derived snapshot | fail closed if unavailable |
| option premium for entry/monitor/exit | trade-grade canonical premium path | explicit validated secondary only |
| fundamentals/news | not a signal input in this pack | IndianAPI may enrich display later |
| Yahoo | prohibited | delayed display-only paths outside trading decisions |

## 4.2 Canonical snapshot identity

Verify or implement one shared snapshot/provenance contract containing the project equivalents of:

```text
snapshotId
indexSymbol
instrumentToken
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

The signal engine, contract selector, paper admission, monitoring, UI and reports must not independently refetch and reinterpret the same event as conflicting market truth.

## 4.3 Fail-closed requirements

The tradeable path must fail closed when any required authoritative input is:

- missing;
- stale beyond the accepted boundary;
- materially future-dated;
- from an unauthorized provider;
- display-only;
- marked `notForSignals` or `visualOnly`;
- internally inconsistent;
- mapped to an unresolved instrument;
- outside the permitted market session;
- associated with a stale/expired instrument master.

The response must give a machine-readable reason and an honest user-facing explanation.

Never replace a missing value with zero, spot, previous close, cached data from another session or a display fallback merely to keep the pipeline running.

---

# 5. Lifecycle inventory and defect matrix

Trace the real production code for every stage below:

| Stage | Required inventory |
|---|---|
| market status | IST session/holiday/special-session source, cache and UI |
| instruments | daily master refresh, expiry/strike/token resolution |
| spot/candles | provider, timeframe, freshness and snapshot identity |
| option chain | facade mode, source, OI units, bid/ask and premium provenance |
| setup availability | canonical nine-record contract and detector eligibility |
| detectors | inputs, fail-closed behavior, output reasons |
| confluence/vetoes | weights, missing-data neutrality, driver truth |
| signal tiers | tradeable, watchlist and information-only transitions |
| contract selector | expiry, strike, CE/PE, token, lot size and liquidity |
| signal plan | immutable entry, target, stop, quantity and provenance |
| paper admission | market/data/risk/tier/duplicate/capital gates |
| paper open | idempotent create, actual premium, timestamps and alerts |
| monitoring | premium refresh, stale behavior and status transitions |
| exit | target, stop, trailing/time/expiry/emergency rules already present |
| ledger | gross P&L, charges, taxes, net P&L and capital impact |
| reporting | open/closed/history/counts/P&L/UI/Telegram parity |

For each confirmed defect record:

```text
ID
severity
production file/function
observable impact
root cause
authorized correction
test proving the correction
```

Implement the defects after this single matrix. Do not conduct a second inventory.

---

# 6. Gate A — Market session and data readiness

Verify the F&O engine uses one authoritative IST market-state contract.

Required behavior:

- normal session: 09:15–15:30 IST unless official session configuration overrides it;
- holidays and weekends: closed;
- special sessions: driven by explicit configuration, not hardcoded guesswork;
- missing/stale/error market status: `UNKNOWN`/`DEGRADED`, never `CLOSED` by fallback;
- stale browser cache must not show “Market is closed” during a live session;
- signal creation and paper entry outside the permitted session must be blocked;
- monitoring and required risk exits must follow the existing approved after-entry policy rather than being accidentally disabled by the entry-hours gate.

Prove the real `/api/options/signals` and related production routes distinguish:

```text
OPEN
CLOSED
UNKNOWN
STALE
ERROR
```

Preserve the Prompt 19A UI corrections.

---

# 7. Gate B — Setup availability, detection and signal honesty

Preserve the canonical nine-record availability contract:

```text
3 indices × 3 setup keys = 9 unique indexSymbol::setupKey records
eligibleForEmission must remain explicit and truthful
```

Verify:

- unavailable setups cannot reach a detector emission path;
- unavailable session VWAP contributes zero confluence weight and no VWAP driver;
- missing authoritative VWAP cannot execute a VWAP veto;
- volume breakout fails closed when required inputs are unavailable;
- mean reversion and no-VWAP trend-continuation follow their accepted availability policy;
- spot geometry used by an explicitly permitted stop anchor is not labelled VWAP;
- the service still returns all nine records on normal, partial-index-failure and all-index-failure paths;
- no `?? []` fallback exists on the mandatory availability contract.

Verify each emitted signal has an honest setup key, direction, confidence, drivers, risks and unavailable-data explanation.

---

# 8. Gate C — Confluence, vetoes and signal tiers

Inventory the real scoring and veto pipeline and close objective defects without retuning the strategy.

Required invariants:

- every confidence contribution is backed by available authoritative data;
- unavailable inputs have neutral polarity and zero effective weight;
- the displayed driver list reconciles with the computed confidence;
- no driver is created from a fallback value that was not actually scored;
- confidence remains within the documented range;
- recovery and chase vetoes use authoritative inputs and cannot be bypassed by missing-data substitution;
- anti-flip/cooldown behavior is deterministic and test-resettable;
- the same event cannot become bullish in one surface and bearish in another;
- `TRADEABLE_SIGNAL`, `WATCHLIST_SETUP` and `INFO_ONLY` are mutually clear and machine-readable;
- `INFO_ONLY` and veto-demoted signals can never open a paper trade;
- UI and Telegram copy must explicitly say when no paper trade is expected.

Reconcile each signal's tier, confidence, gate results and paper-admission eligibility.

---

# 9. Gate D — Contract selection and liquidity truth

Verify the complete contract-resolution path for NIFTY, BANKNIFTY and SENSEX.

Each selected contract must have:

```text
indexSymbol
exchange
tradingsymbol
instrumentToken
expiry
strike
optionType (CE/PE)
lotSize
tickSize where available
selectionAsOf
chainSnapshotId
premiumSource
liquidity evidence
```

Required behavior:

- resolve from the current canonical instrument master;
- use the correct index/exchange mapping;
- exclude expired contracts;
- select expiry according to the existing documented policy;
- preserve the selected contract once the signal plan is created;
- reject unresolved/ambiguous/mismatched token-symbol contracts;
- reject stale instrument masters where the existing policy requires it;
- reject contracts with unusable premium or liquidity data;
- never substitute a different strike/expiry after admission without an explicit new plan;
- never serialize a spot/index token as an option-contract token;
- maintain lot-size and quantity consistency.

Add boundary tests around expiry rollover, missing strikes, CE/PE direction, instrument-token mismatch and all three supported indices.

---

# 10. Gate E — Immutable signal plan

At signal creation, persist or construct one immutable plan containing the project equivalents of:

```text
signalId
createdAt IST
index and direction
setup/tier/confidence
spot snapshot
selected contract identity
entry trigger/reference
target
stop
quantity/lots
time/expiry exit policy
data provenance
gate decisions
plan version/hash
```

Required invariants:

- later quote refreshes may update market observations but cannot silently rewrite the original plan;
- target, stop, contract, direction, setup and quantity remain immutable after admission;
- an intentional replacement requires a new plan identity and explicit relationship to the old signal;
- UI, Telegram, paper trade and history all refer to the same plan;
- no route serializer strips execution/plan fields needed by the UI;
- no missing execution field is shown as false `NOT_CONFIRMED`;
- duplicate scheduler/route calls cannot create duplicate plans.

Preserve existing immutability safeguards and strengthen only where tests expose a real defect.

---

# 11. Gate F — Paper-admission truth

Trace the actual production admission function, not a reconstructed helper.

A paper trade may open only when every required gate passes, including the project equivalents of:

- market session open;
- signal tier is tradeable;
- authoritative fresh data;
- valid canonical option chain;
- valid immutable plan;
- supported index/setup;
- no recovery/chase veto;
- anti-flip/cooldown pass;
- contract and premium trustworthy;
- bid/ask/liquidity acceptable under existing rules;
- quantity and lot size valid;
- capital/risk/guardrail capacity available;
- no duplicate open trade or duplicate admission;
- no conflicting active position under the existing policy.

Required output:

```text
ADMITTED
or
REJECTED with one or more stable machine-readable reasons
```

Prove directly:

- `INFO_ONLY` cannot be admitted;
- display-only Yahoo/NSE data cannot be admitted;
- stale/future data cannot be admitted;
- outside-hours entry cannot be admitted;
- duplicate invocation is idempotent;
- absence of an optional provider does not fabricate admission;
- a valid Kite-backed tradeable signal can pass when all existing gates genuinely pass.

Do not weaken admission assertions to increase trade counts.

---

# 12. Gate G — Paper position opening

Verify the production open transition is atomic and idempotent at the application boundary.

The opened trade must preserve:

```text
paperTradeId
signalId / planId
contract identity
side
lots and quantity
actual admitted premium
spot reference
openedAt IST
source/asOf/snapshot
entry charges state
status
admission reasons/gates
```

Required behavior:

- a modelled signal is not the same as an opened paper trade;
- entry uses a trustworthy option premium, not underlying spot;
- duplicate jobs/requests cannot open a second position;
- open counts reconcile with successful admissions;
- failed persistence does not emit a false OPEN alert;
- successful opening emits at most one correctly labelled alert;
- user-facing history distinguishes signal-created, admission-rejected and paper-opened states.

Use mocked repository/store boundaries in ordinary tests. Do not connect to PostgreSQL.

---

# 13. Gate H — Monitoring and exit lifecycle

Trace the actual monitoring scheduler/service through every existing terminal transition.

At minimum verify the existing project rules for:

```text
TARGET_HIT
STOP_HIT
TRAILING_STOP where implemented
TIME_EXIT
MARKET_CLOSE_EXIT where implemented
EXPIRY_RISK_EXIT
DATA_RISK / EMERGENCY handling
MANUAL_CLOSE where implemented
```

Required invariants:

- exit decisions use the option contract premium, not underlying spot, unless a rule explicitly documents otherwise;
- premium source and timestamp are stored;
- stale/unavailable premium cannot be presented as a confirmed exit price;
- missing data must follow the existing safe risk policy with explicit status, not fabricate a close;
- target/stop values come from the immutable plan;
- contradictory target-and-stop hits in the same interval follow one deterministic documented ordering rule;
- the same trade can close only once;
- monitoring retries are idempotent;
- closed trades are removed from active monitoring exactly once;
- expiry and session boundaries use IST/exchange dates;
- alerts are emitted after successful state transition, not before;
- UI, Telegram and history show the same exit reason and premium.

Add deterministic tests for gaps, same-candle target/stop conflict, stale premium, retry, duplicate close and each supported terminal reason already present in production.

Do not invent a new exit strategy.

---

# 14. Gate I — Charges, STT, gross/net P&L and capital

Preserve and verify the accepted centralized F&O charge engine.

For every closed paper trade reconcile:

```text
grossPnl
brokerage
exchangeTransactionCharges
regulatory/sebi charges
GST on applicable charges
stamp duty where applicable
STT according to the existing instrument/side policy
other explicitly configured levies
totalCharges
netPnl
capital impact
```

Required arithmetic:

```text
grossPnl = signed(exitPremium - entryPremium) × quantity
netPnl = grossPnl - totalCharges
```

Use the project's accepted direction conventions and versioned charge configuration. Do not hardcode a second charge table in UI code or tests.

Prove:

- CALL/PUT direction does not invert premium P&L incorrectly;
- quantity equals lots × authoritative lot size;
- entry and exit premiums use consistent units;
- gross, charges and net never overwrite one another;
- open trades show unrealized P&L separately from realized P&L;
- realized P&L changes capital once;
- duplicate close/reconciliation cannot apply P&L twice;
- missing premium/quantity does not become zero P&L;
- day, trade, index and cumulative totals reconcile to the same ledger rows.

Do not change current statutory rates without authoritative, dated evidence and explicit disclosure. If a potentially outdated rate is discovered, report it as an exact blocker rather than guessing.

---

# 15. Gate J — API, schema and client parity

For every F&O response changed in this pack, maintain parity across:

```text
domain type
production Zod schema
registered route serializer
OpenAPI specification
generated API client type
frontend query/component
```

At minimum verify the routes for the project equivalents of:

- F&O signals and market/setup state;
- signal history and execution truth;
- paper-trading summary;
- open paper positions;
- closed paper positions/history;
- guardrail/risk status;
- P&L/reporting;
- diagnostics needed by the F&O UI.

Required contract behavior:

- execution details are not stripped;
- `INFO_ONLY` explicitly communicates that no paper trade is expected;
- nullability/optionality matches real production responses;
- empty arrays mean valid empty only, not producer failure;
- errors cannot be serialized as successful zero summaries;
- source/freshness/provenance fields survive route serialization;
- identifiers and numeric units are consistent;
- no `?? []`, `?? 0` or default object masks a mandatory producer failure.

Tests must read the actual production schema/OpenAPI and invoke the registered production routes where practical.

---

# 16. Gate K — UI and Telegram lifecycle parity

Verify production surfaces for F&O Intraday, paper trading, signal history, trade details, P&L and Daily Analysis.

Every user-visible event must agree on:

```text
index
direction
setup
tier
contract
entry premium
target
stop
quantity
status
exit premium
exit reason
gross P&L
charges
net P&L
timestamp IST
source/freshness
```

Required UI states:

```text
LOADING
READY
EMPTY_VALID
STALE
DEGRADED
ERROR
MARKET_CLOSED
UNKNOWN_MARKET_STATE
```

Rules:

- missing values render `—`/unavailable, never fabricated zero;
- missing percentage never becomes green/up;
- initial API error never becomes skeleton forever or empty success;
- cached data after refetch failure remains visible but is labelled stale/degraded;
- the options page shows “Market is closed” only when authoritative `marketOpen === false` and the state is fresh enough;
- alerts are deduplicated by stable lifecycle-event identity;
- signal, open and close alerts are not sent before successful state transitions;
- recovery/OK events use appropriate severity and do not appear as warnings;
- INFO_ONLY copy never implies that a paper trade opened.

Add production-component tests for the lifecycle states changed by this pack.

---

# 17. Gate L — Reconciliation and reports

Create or verify one machine-readable lifecycle reconciliation for a selected date/session:

```text
candidatesDetected
setupEligible
signalsEmitted
tradeableSignals
watchlistSignals
infoOnlySignals
admissionPassed
admissionRejected
paperOpened
paperStillOpen
paperClosed
exitPendingOrDataBlocked
```

Required invariants include:

```text
signalsEmitted = tradeableSignals + watchlistSignals + infoOnlySignals
tradeableSignals = admissionPassed + admissionRejected
admissionPassed = paperOpened + explicitly recorded open failure
paperOpened = paperStillOpen + paperClosed for the reconciled cohort
```

Adapt the equations to the actual lifecycle model, but explain every category and prevent double counting.

Reports must reconcile by:

- date/session;
- index;
- signal/setup;
- tier;
- trade;
- exit reason;
- gross P&L;
- charges;
- net P&L;
- open versus realized state.

Do not include modelled or INFO_ONLY outcomes in realized paper-trade P&L.

Daily Analysis, paper-trading summary, history and downloadable/exported reports must use the same canonical ledger/calculation functions.

---

# 18. Required tests

Use ordinary non-DB tests with mocked store/provider boundaries.

At minimum add load-bearing coverage for:

## 18.1 Data and market state

- fresh Kite snapshot;
- stale snapshot;
- future timestamp;
- provider error;
- display-only fallback;
- unknown market state;
- market closed;
- valid market open;
- partial-index and all-index failures.

## 18.2 Signals and contract selection

- setup unavailable;
- neutral missing-data confluence;
- veto-demotion to INFO_ONLY;
- tradeable signal path;
- contract token/expiry/strike/side mapping for all three indices;
- expiry rollover;
- invalid/missing contract;
- invalid premium/liquidity;
- plan immutability and duplicate-plan prevention.

## 18.3 Admission and opening

- every major rejection class;
- positive admission path;
- INFO_ONLY cannot open;
- outside-hours cannot open;
- stale/future/display-only data cannot open;
- duplicate admission/open is idempotent;
- persistence failure cannot emit a false OPEN event.

## 18.4 Monitoring and exits

- target, stop, time and expiry exits already implemented;
- stale/unavailable premium;
- same-interval target/stop ordering;
- retry and duplicate close;
- failed persistence cannot emit false close;
- premium source/provenance retained.

## 18.5 P&L and reporting

- CALL and PUT premium P&L;
- winning, losing and flat trades;
- quantity/lot arithmetic;
- every charge component used by production;
- gross-to-net reconciliation;
- unrealized versus realized separation;
- day/index/trade/cumulative reconciliation;
- modelled/INFO_ONLY exclusion;
- UI/Telegram/API parity.

## 18.6 Real boundaries

Include tests invoking:

- the real production F&O service functions;
- registered HTTP routes and production serializers;
- real production Zod schemas;
- actual OpenAPI specification where changed;
- real production React components for changed user-visible states.

Pure-helper or source-regex tests may supplement but cannot replace behavior tests.

---

# 19. Verification battery

Run targeted tests after each implementation batch. At the end run the closing battery once.

## 19.1 Preserved acceptance suites

Run the existing accepted F&O suites, including the real project equivalents of:

- indicators baseline;
- zero-volume behavior;
- confluence/VWAP guards;
- setup availability;
- A0.3.1/A0.3.3 acceptance;
- paper admission;
- route serializer and HTTP route proof;
- OpenAPI/Zod/client parity;
- C0/guardrail enforcement;
- signal-plan immutability;
- option-premium/provenance/exit safety;
- gross/net/STT calculations;
- Prompt 19 and Prompt 19A component guards.

Report per-file counts and reconcile the combined total. Do not rely only on an aggregate.

## 19.2 Full regression

Preserve at minimum:

```text
api-server: 4,528 passing / 0 failing
scanner: 878 passing / 0 failing
```

New tests should increase the relevant totals. Explain the exact increase.

Run:

- full API-server non-DB suite;
- full Scanner suite;
- all Pack 2 targeted tests;
- all affected frontend/component tests.

Do not execute DB-only suites and do not weaken exclusions protecting the operational database.

## 19.3 Typechecks and builds

Run the actual project commands for:

- API server TypeScript;
- API Zod TypeScript;
- API client React TypeScript;
- Scanner TypeScript;
- Global/web TypeScript;
- relevant library/database TypeScript if touched;
- API-server production build;
- Scanner production build;
- Global/web production build;
- `git diff --check`.

## 19.4 Integrity scan

Prove that this pack introduced no:

- `.skip`, `.only`, quarantine or retry markers;
- arbitrary sleeps;
- weakened assertions;
- live-provider calls from tests;
- PostgreSQL connections from ordinary tests;
- hardcoded secrets or printed credentials;
- Yahoo/NSE display fallback in a tradeable path;
- direct provider calls from UI components;
- silent null-to-zero market/trade values;
- unrelated swing or deployment changes.

---

# 20. Evidence file

Create one concise evidence file:

```text
artifacts/audit-evidence/FAST_TRACK_PACK_2_COMPLETE_FNO_LIFECYCLE.md
```

It must contain:

1. final verdict;
2. lifecycle coverage matrix;
3. confirmed defects and exact fixes;
4. canonical-data/provider disposition;
5. signal/setup/confluence/veto results;
6. contract-selection and plan-immutability proof;
7. paper-admission/open/monitor/exit proof;
8. charges and P&L reconciliation;
9. API/schema/client/UI/Telegram parity;
10. lifecycle count reconciliation;
11. targeted and full test counts;
12. typecheck/build results;
13. exact changed-file inventory;
14. Git start/end state and platform auto-commit chronology;
15. confirmation of no manual commit, push or deployment;
16. SHA-256 after the final write;
17. production deployment status.

Use exactly one final terminator as the last nonblank line:

```text
END_FAST_TRACK_PACK_2_COMPLETE_FNO_LIFECYCLE
```

Do not modify A0.1/A0.2/A0.3/P0.1B/B0/B1.1/Pack 1 evidence except where an existing file is automatically included in a platform documentation commit. Do not rewrite historical verdicts.

---

# 21. Required final response

Return a concise completion report—not an execution diary—with:

1. Verdict.
2. F&O lifecycle matrix.
3. Canonical data and provider result.
4. Signal/setup/confluence/veto result.
5. Contract and immutable-plan result.
6. Admission/open/monitor/exit result.
7. Charges and P&L reconciliation.
8. API/UI/Telegram/report parity.
9. Exact test totals.
10. Typecheck/build results.
11. Git/evidence integrity.
12. Remaining genuine blockers.
13. Production status.

The only successful verdict is:

```text
ACCEPT_FAST_TRACK_PACK_2_COMPLETE_FNO_LIFECYCLE
```

Use it only when every Gate A–L passes and all in-scope confirmed defects are implemented. Do not defer an in-scope defect into a new task while claiming acceptance.

If a genuine owner-controlled blocker prevents safe completion, return:

```text
BLOCKED_FAST_TRACK_PACK_2_COMPLETE_FNO_LIFECYCLE
```

and identify the exact gate, production impact and minimum owner decision required. Continue all independent in-scope work before stopping.

Production must remain:

```text
PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED
```

After acceptance, freeze Pack 2 and stop. Do not begin the swing-trading pack, operational cleanup or deployment without a separate owner instruction.
