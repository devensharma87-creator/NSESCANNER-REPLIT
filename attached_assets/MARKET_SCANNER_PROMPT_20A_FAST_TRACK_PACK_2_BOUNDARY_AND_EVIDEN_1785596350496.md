# MARKET SCANNER — PROMPT 20A

## Fast-Track Pack 2: Production-Boundary and Evidence Closure

### Instruction to the Replit coder

Prompt 20 produced useful implementation and lifecycle-function coverage, including:

```text
p20.lifecycleGates.test.ts: 89/89
p20.optionsPageFixes.test.ts: 24/24
api-server full suite: 4,617/4,617
scanner full suite: 902/902
```

Preserve those results and the three reported `options.tsx` fixes.

However, the reported verdict cannot yet freeze Pack 2 because the completion record does not demonstrate all Prompt 20 acceptance gates:

- Gate J — actual API/Zod/OpenAPI/generated-client parity;
- Gate K — real production UI and Telegram lifecycle parity;
- registered HTTP-route execution for the lifecycle responses;
- actual lifecycle-count/report reconciliation;
- complete contract-selection and immutable-plan boundary evidence;
- the full five-package typecheck and three-build battery;
- exact changed-file/Git/SHA integrity;
- the complete text of defect P20-D02, which was truncated in the report.

The current status is:

```text
PACK_2_NOT_FROZEN — PRODUCTION_BOUNDARY_EVIDENCE_INCOMPLETE
```

This prompt authorizes one narrowly bounded closure pass. Do not reopen the broad lifecycle audit and do not create another roadmap.

No manual commit, push, pull, fetch, publish or deployment is authorized.

Do not connect to PostgreSQL, execute DB-only tests, provision a test database, run Prompt 15 or change `DB_TEST_RUNTIME_AUTHORIZED`.

---

# 1. Closure objective

Prove the already-implemented Prompt 20 lifecycle through its real production boundaries, fix only defects revealed by those boundary tests, complete the missing verification/evidence record, and freeze Pack 2.

Use this sequence only:

1. Read the existing Prompt 20 diff, evidence file and affected routes/contracts/components.
2. Reconcile the exact three Prompt 20 production fixes, including P20-D02.
3. Add registered-route and schema/client parity tests.
4. Add production-component and Telegram parity tests.
5. Add lifecycle/report reconciliation proof.
6. Close any genuine defect exposed by those tests.
7. Run the final Pack 2 battery once.
8. Update the existing Pack 2 evidence file.
9. Return the final verdict and stop.

Do not repeat the complete Gate A–I source inventory. The existing 89 lifecycle tests are the starting evidence for those gates.

Do not defer an in-scope boundary defect into another task while claiming acceptance.

---

# 2. Frozen safeguards

Preserve:

- all Prompt 20 production changes and 113 new tests;
- Pack 1 and Prompt 19A UI behavior;
- canonical Kite-first market and option-chain routing;
- Upstox only as an explicitly validated/configured secondary;
- IndianAPI only for non-trading enrichment;
- Yahoo/NSE display fallback exclusion from tradeable paths;
- future-timestamp and stale-data fail-closed behavior;
- A0.3 VWAP/setup-availability honesty;
- signal tiers, confluence weights, thresholds and vetoes;
- immutable signal plans;
- paper-admission, premium-trust and exit-safety gates;
- gross/net/charges/STT separation;
- IST market/session behavior;
- authentication/authorization;
- ordinary-test zero-database-connection safeguards.

Do not add a strategy, retune thresholds, increase trade frequency, alter capital limits, activate a provider, create a migration or modify swing trading.

---

# 3. Closure Gate 1 — Exact Prompt 20 production-change reconciliation

Read the actual Prompt 20 diff and report all production changes exactly.

The previous report identified:

```text
P20-D01 — null change percentage incorrectly shown bullish
P20-D02 — report text truncated after “Single outer ...”
P20-D03 — missing target/stop values rendered as ₹0.00 in toast copy
```

For each defect provide:

- exact production file;
- component/function;
- previous behavior;
- root cause expression/control flow;
- final implementation;
- user-visible result;
- exact test names proving it.

P20-D02 must be reconstructed from the actual diff—not guessed from the truncated report.

Confirm that missing/non-finite percentages, option targets and stops never become bullish, green, `₹0.00` or another fabricated value.

Do not modify already-correct code merely to make the report easier to write.

---

# 4. Closure Gate 2 — Registered production HTTP routes

Test actual registered route handlers, middleware, production services, production Zod parsing and JSON serialization. Do not test only constructed response objects.

Identify and invoke the real project routes for the equivalents of:

```text
GET F&O signals/setup/market status
GET signal history/execution truth
GET F&O paper-trading summary
GET open F&O paper positions
GET closed F&O paper positions/history
GET F&O guardrail/risk status
GET F&O P&L/reporting or Daily Analysis F&O section
```

Use the real authentication middleware behavior. At minimum prove:

- unauthenticated access follows the existing access policy;
- authorized owner/subscriber access reaches the production handler;
- normal success returns HTTP 200 and production-schema-valid JSON;
- valid empty returns HTTP 200 with an honest empty state;
- producer failure is not converted into zero totals or empty success;
- partial/degraded data is explicitly labelled;
- market-closed state remains schema-valid;
- unknown/stale/error market state is not serialized as closed;
- partial-index and all-index failures retain the canonical nine-record setup-availability contract;
- execution/plan fields required by history and UI are not stripped;
- `INFO_ONLY` states explicitly show that no paper trade was expected;
- source, `asOf`, freshness, snapshot/fallback/degradation metadata survive serialization where the contract owns them.

Mock only external/provider/store boundaries. Invoke the real registered route code and real production serializers.

If a required endpoint does not exist, determine whether the UI legitimately derives the view from another canonical endpoint. Do not create duplicate APIs merely to satisfy a checklist.

---

# 5. Closure Gate 3 — Zod, OpenAPI and generated-client parity

For every F&O response used by the touched production pages, compare the actual:

```text
domain TypeScript type
production Zod schema
registered route parse/serialization
openapi.yaml schema
generated API client type
frontend query/component consumption
```

Add executable tests that read the actual OpenAPI specification and actual production Zod schemas.

Prove parity for the project equivalents of:

- market and setup state;
- signals;
- signal history and execution;
- paper summary;
- open/closed positions;
- guardrails;
- P&L/report output;
- lifecycle status and exit reason;
- source/freshness/provenance fields.

Required rejection proofs:

- invalid status/tier/exit reason;
- invalid or duplicate setup-availability keys;
- wrong nine-record cardinality;
- `eligibleForEmission: true` where prohibited;
- missing mandatory signal/contract identifiers;
- fabricated null-to-zero totals where the schema requires unavailable/null;
- incompatible execution object;
- invalid timestamp or source enum where those fields are constrained.

TypeScript interfaces alone are not runtime evidence. OpenAPI text-search alone is not structural parity. Parse representative production-shaped states through the actual schema and route boundary.

Do not regenerate or broadly rewrite OpenAPI unless a proven mismatch requires a targeted correction.

---

# 6. Closure Gate 4 — Contract selection and immutable plan

The prior summary states that Gate A–I and L production functions were tested, but it does not identify executable proof for the real contract selector and immutable-plan boundary.

Invoke the actual production functions responsible for:

- instrument-master resolution;
- index-to-exchange mapping;
- expiry choice;
- strike selection;
- CE/PE selection;
- instrument token and tradingsymbol selection;
- lot size and quantity;
- signal-plan creation/persistence boundary;
- duplicate-plan prevention;
- plan reuse by admission/open/history.

At minimum prove for NIFTY, BANKNIFTY and SENSEX:

1. canonical valid contract resolution;
2. correct option side for the existing direction policy;
3. expired contract rejection;
4. missing strike rejection;
5. token/symbol/expiry mismatch rejection;
6. unresolved or ambiguous instrument rejection;
7. lot-size/quantity consistency;
8. invalid or untrusted premium rejection;
9. plan identity remains stable after later quote changes;
10. direction, contract, target, stop and quantity cannot mutate after admission;
11. duplicate invocation cannot create a second plan;
12. UI/history/admission refers to the same plan/contract identity.

Use the actual production selector and plan boundary. Do not duplicate the selection formulas inside a test.

If the current 89-test file already proves any item, cite the exact test name and add only the missing boundary cases.

---

# 7. Closure Gate 5 — Production UI state and cross-tab parity

Render the real production components—or the smallest real routed production boundary—for:

- F&O Intraday/options page;
- signal cards/history execution state;
- paper-trading summary;
- open/closed position rows;
- guardrail/risk state;
- F&O P&L/report display.

Prove these states:

```text
INITIAL_LOADING
READY_WITH_DATA
EMPTY_VALID
MARKET_CLOSED
UNKNOWN_MARKET_STATE
STALE_OR_DEGRADED_WITH_DATA
INITIAL_ERROR_WITHOUT_DATA
REFETCH_ERROR_WITH_CACHED_DATA
```

Required behavior:

- authoritative fresh `marketOpen === false` is the only condition that renders “Market is closed”;
- missing/stale/error market state does not render closed;
- missing change percentage has neutral styling;
- missing target/stop does not render `₹0.00`;
- valid zero is distinguished from missing data;
- initial error renders an explicit error/retry state;
- cached data after refetch failure remains visible with stale/degraded labelling;
- INFO_ONLY explicitly says no paper trade was expected;
- an actually opened trade is visually distinct from a modelled signal;
- open and closed trades display the canonical contract, entry/exit premium, quantity and status;
- gross, charges and net P&L remain distinct;
- timestamps use IST;
- source/freshness/provenance is consistent across Options, Paper Trading, History and Reports.

For one representative signal/trade fixture, assert exact cross-surface equality of:

```text
signalId / planId
index
direction
setup/tier
contract
entry premium
target/stop
quantity
status
exit premium/reason
gross P&L
charges
net P&L
timestamp/session date
source/asOf
```

Do not satisfy this gate only through source-regex or pure-helper tests.

---

# 8. Closure Gate 6 — Telegram lifecycle parity and deduplication

Invoke the actual production formatter/notification boundary with mocked transport.

For existing lifecycle events, prove the project equivalents of:

```text
SIGNAL_CREATED
INFO_ONLY / WATCHLIST
PAPER_ADMISSION_REJECTED where notified
PAPER_OPENED
TARGET1_REACHED where notified
PAPER_CLOSED_TARGET
PAPER_CLOSED_STOP
PAPER_CLOSED_TIME_OR_EXPIRY
DATA_RISK / DEGRADED where notified
RECOVERY where notified
```

Required behavior:

- UI, API and Telegram use the same signal/plan/trade identity;
- INFO_ONLY never claims that a paper trade opened;
- OPEN alert is emitted only after successful open persistence;
- CLOSE alert is emitted only after successful close persistence;
- retry/duplicate scheduler execution cannot send duplicate lifecycle alerts;
- event dedup keys distinguish signal/open/target/close/recovery events;
- contract, premiums, quantity, status, exit reason and P&L match the canonical trade record;
- missing values are omitted or labelled unavailable, never converted to zero;
- timestamps are IST;
- success/recovery messages are not labelled warning/error;
- mocked delivery failure does not mutate the trading state incorrectly.

Do not contact Telegram or another live external service.

If an event is intentionally not notified in production, document that policy and test the absence rather than inventing a new alert.

---

# 9. Closure Gate 7 — Lifecycle reconciliation and reporting

Create one deterministic production-shaped cohort and pass it through the actual reconciliation/report functions.

The cohort must include at least:

- one setup-unavailable candidate;
- one INFO_ONLY or veto-demoted signal;
- one admission rejection;
- one admitted/open trade still open;
- one target-closed trade;
- one stop/time/expiry-closed trade supported by production;
- one data-blocked/exit-pending state if represented in the lifecycle.

Report and prove the actual project-equivalent counts:

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
dataBlockedOrPending
```

Reconcile the equations appropriate to the actual production model. Explain exclusions instead of forcing an invalid arithmetic identity.

For the same cohort, prove:

- modelled/INFO_ONLY outcomes are excluded from realized paper P&L;
- unrealized and realized P&L are separate;
- gross P&L, every production charge component and net P&L reconcile;
- closed-trade net P&L affects capital once;
- duplicate reconciliation does not double-count;
- date, index, setup, tier, trade and exit-reason groupings sum to the same canonical totals;
- Paper Trading, Signal History and Daily Analysis/report outputs agree.

Use actual production report/calculation functions. Do not reconstruct totals only inside the test.

---

# 10. Closure Gate 8 — Complete verification battery

## 10.1 Preserve Prompt 20 results

Preserve at minimum:

```text
p20.lifecycleGates.test.ts: 89/89
p20.optionsPageFixes.test.ts: 24/24
api-server: 4,617 passing / 0 failing
scanner: 902 passing / 0 failing
```

New closure tests should increase the relevant totals. Reconcile the increase exactly.

Do not delete, skip, quarantine or weaken Prompt 20 tests.

## 10.2 Per-file accepted F&O suites

Run and report exact per-file results for the existing project equivalents of:

- indicators baseline;
- option-signals zero-volume behavior;
- confluence/VWAP guard;
- setup availability;
- A0.3 acceptance and VWAP non-fabrication;
- paper admission;
- service/registered-route failure proof;
- route serializer;
- OpenAPI parity;
- Zod/client parity;
- guardrail/C0 enforcement;
- signal-plan immutability;
- option-premium/provenance/exit safety;
- charges/gross/net/STT;
- Prompt 19/19A UI guards;
- Prompt 20 lifecycle and UI tests;
- new Prompt 20A boundary tests.

Report each file separately and reconcile the combined total. Do not replace this with an unreconciled aggregate.

## 10.3 Full suites

Run:

- full API-server non-DB suite;
- full Scanner suite;
- all affected frontend/component suites;
- all Prompt 20/20A targeted tests.

Do not execute `.db.test.ts` files.

## 10.4 Typechecks

Run the actual repository commands for:

- API server;
- API Zod;
- API client React;
- Scanner;
- Global/web;
- relevant shared/database library only if touched.

The previous report documented only Scanner, Global and API-server TypeScript. API Zod and API-client React must be explicitly run and reported.

## 10.5 Production builds

Run and report:

- API-server production build;
- Scanner production build;
- Global/web production build.

If a target has no build script, report the inspected package script and the actual workspace build command that covers it. Do not claim a build without command output.

## 10.6 Integrity

Run `git diff --check` and prove the closure introduced no:

- `.skip`, `.only`, quarantine or retry markers;
- arbitrary sleeps;
- assertion weakening;
- direct live-provider/Telegram calls from tests;
- PostgreSQL connections;
- secret output;
- direct provider calls from UI;
- Yahoo/NSE display fallback in trading decisions;
- null-to-zero fabrication;
- unrelated swing, migration, dependency or deployment changes.

---

# 11. Evidence and Git record

Update the existing file only:

```text
artifacts/audit-evidence/FAST_TRACK_PACK_2_COMPLETE_FNO_LIFECYCLE.md
```

Add a final closure section containing:

1. exact P20-D01/D02/D03 reconciliation;
2. registered-route results;
3. Zod/OpenAPI/client parity;
4. contract-selector and immutable-plan proof;
5. production-component results;
6. Telegram lifecycle/dedup proof;
7. lifecycle-count and P&L reconciliation;
8. per-file targeted test results;
9. full-suite totals and exact increase;
10. five-package typechecks;
11. three production builds;
12. exact changed/new/deleted file inventory;
13. starting HEAD and final observed HEAD;
14. branch, upstream and ahead/behind without fetching;
15. tracked/staged/untracked state;
16. platform auto-commit chronology;
17. confirmation of no manual commit, push or deployment;
18. evidence SHA-256 after the final write;
19. production status.

The final nonblank line must be exactly:

```text
END_FAST_TRACK_PACK_2_BOUNDARY_AND_EVIDENCE_CLOSURE
```

It must occur exactly once.

Do not create another evidence file. Do not rewrite historical evidence. Do not create another follow-up task for an in-scope defect.

---

# 12. Required final response

Return a concise closure report—not another execution diary—with:

1. Verdict.
2. Exact Prompt 20 defect reconciliation.
3. Registered-route and schema/client parity.
4. Contract and immutable-plan proof.
5. Production UI and Telegram parity.
6. Lifecycle/P&L reconciliation.
7. Per-file and full-suite test totals.
8. Typecheck/build results.
9. Git/evidence integrity.
10. Remaining genuine blockers.
11. Production status.

The only successful verdict is:

```text
ACCEPT_FAST_TRACK_PACK_2_COMPLETE_FNO_LIFECYCLE_FINAL
```

Use it only when all eight closure gates pass and no in-scope defect is deferred.

If a genuine owner-controlled blocker prevents safe completion, return:

```text
BLOCKED_FAST_TRACK_PACK_2_BOUNDARY_AND_EVIDENCE_CLOSURE
```

with the exact boundary, failing assertion, production impact and minimum owner decision. Complete all independent closure work before stopping.

Production remains:

```text
PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED
```

After acceptance, freeze Pack 2 and stop. Do not begin the swing-trading pack, database work, cleanup or deployment without the separate owner instruction.
