# PROMPT 32 — INDEPENDENT V2 PAPER-TRADING COHORT ISOLATION FOUNDATION

## Execution instruction

Build here. Execute this as one bounded implementation task for **Stock Scanner Pro**.

This prompt creates the isolation foundation for two future cohorts:

- `FNO_PAPER_V2`
- `SWING_PAPER_V2`

Both cohorts must remain hard-disabled. This task does **not** activate paper trading, change strategies, delete history, reset existing P&L, place broker orders, or reopen Pack 9 research.

## Why this task is being done now

The live option-premium warehouse canary must wait for a valid market-hours window. Cohort isolation is independent of that window and can be completed safely now.

The existing F&O and swing history must remain available as immutable legacy evidence. V2 performance must begin from clean, separately identified ledgers rather than deleting or mixing previous records.

## Primary objective

Build one authoritative cohort contract and propagate it through the paper-trading lifecycle so that:

1. existing F&O and swing records remain intact and are deterministically classified as legacy;
2. future `FNO_PAPER_V2` and `SWING_PAPER_V2` records cannot mix with legacy records or with each other;
3. capital, trades, orders, P&L, charges, reports, statistics, alerts, idempotency, and UI queries are cohort-scoped;
4. both V2 cohorts are impossible to write to while their hard locks are false;
5. current legacy production behaviour remains unchanged;
6. no strategy or trading decision logic is modified.

## Frozen boundaries

### Project boundary

- Work only in Stock Scanner Pro:
  - `artifacts/api-server`
  - `artifacts/scanner`
  - `lib/api-zod`
  - `lib/api-client-react`
  - `lib/db` only where an additive schema/migration definition is required
  - `artifacts/audit-evidence`
- `artifacts/global` is a separate project and is **FROZEN**. Do not edit, test, build, screenshot, or count it.

### Trading and strategy boundary

Do not change:

- F&O or swing strategy formulas;
- setup eligibility;
- thresholds, confidence weights, gates, vetoes, or cooldowns;
- entries, stops, targets, trailing rules, time exits, or position sizing;
- option selection, contract selection, expiry selection, or lot sizes;
- capital amounts or seed values;
- market-hours logic;
- Kite/Upstox/IndianAPI routing;
- broker execution controls;
- existing historical records;
- Pack 9/9A research protocol or qualification verdicts.

### Operational safety boundary

- No deletion, truncation, reset, rewriting, or relabelling of existing operational trades.
- No copying legacy trades or legacy P&L into a V2 cohort.
- No operational database migration execution without the exact separate owner authorization:

  `AUTHORIZE_V2_COHORT_ADDITIVE_MIGRATION`

- This prompt is **not** that authorization.
- Create migration definitions and test them through pure/unit/static or isolated-DB tests if available. If the isolated test database remains unavailable, return migration readiness honestly rather than touching the operational DB.
- No commit, push, pull, fetch, publish, deploy, broker call, or live provider probe.

## Required hard locks

Create one authoritative server-side lock module with compile-time constants:

```ts
export const FNO_PAPER_V2_RUNTIME_AUTHORIZED = false as boolean;
export const SWING_PAPER_V2_RUNTIME_AUTHORIZED = false as boolean;
```

Requirements:

- Environment variables must not bypass these constants.
- No route, scheduler, replay, test fixture, force flag, admin request, or internal function may write a V2 row while the corresponding constant is false.
- A blocked attempt must return a stable machine-readable reason:
  - `FNO_PAPER_V2_DISABLED`
  - `SWING_PAPER_V2_DISABLED`
- Legacy paper trading must not be disabled or behaviourally changed by these locks.

## Gate 0 — Read-only preflight and inventory

Before editing, record:

- repository identity, branch, HEAD, remote, upstream, and working-tree state;
- latest accepted test floors;
- redacted provider-secret presence only;
- `DB_TEST_RUNTIME_AUTHORIZED` value;
- every table, schema, type, route, scheduler, query, report, alert, and UI surface involved in:
  - F&O paper admissions and open trades;
  - F&O exits and realised P&L;
  - F&O capital events and account summaries;
  - swing staged orders and approvals;
  - swing paper entries, monitoring, exits, charges, and P&L;
  - combined paper reports and cohort reconciliation.

Build a concise dependency matrix identifying every write path and every aggregation path. Do not edit until the matrix is complete.

## Gate 1 — Authoritative cohort domain contract

Create one canonical, server-owned contract. Use exact stable IDs:

```ts
type PaperCohortId =
  | "FNO_PAPER_LEGACY"
  | "SWING_PAPER_LEGACY"
  | "FNO_PAPER_V2"
  | "SWING_PAPER_V2";
```

The contract must also define:

- asset family: `FNO` or `SWING_CASH`;
- generation: `LEGACY` or `V2`;
- status: `ACTIVE_LEGACY`, `DISABLED_PENDING_QUALIFICATION`, or another narrowly justified stable enum;
- trading impact: always `PAPER_ONLY` for these cohorts;
- activation state and disabled reason;
- whether the cohort may admit new trades;
- whether it may appear in combined informational views.

Rules:

- Do not infer cohort from labels, timestamps, owner names, setup names, or current feature flags.
- Every new write command must carry an explicit cohort.
- Existing rows lacking a cohort field must resolve deterministically to the correct table-specific legacy cohort.
- Unknown cohort values fail closed; they must never silently resolve to legacy or V2.
- Export the contract through API Zod/client types as required, without duplicating enums in multiple packages.

## Gate 2 — Additive persistence design

After inventory, implement the smallest safe additive persistence design that covers every affected record.

Preferred two-phase compatibility pattern where existing tables are shared:

1. add a nullable `cohort_id` column with no destructive rewrite;
2. treat existing `NULL` values as the table-specific legacy cohort at the read boundary;
3. require all new application writes to supply an explicit non-null cohort;
4. prepare, but do not execute, a bounded legacy backfill migration;
5. prepare later enforcement of default/`NOT NULL` only after reconciliation and separate authorization.

If dedicated V2 tables or a different structure are demonstrably safer for the actual schema, document the evidence and use that design. Do not duplicate the entire platform merely for convenience.

Persistence requirements:

- preserve every existing primary key and historical timestamp;
- preserve existing ledger/account balances exactly;
- no existing row may be assigned to V2;
- V2 begins with zero trades, zero realised P&L, zero charges, and no inherited positions;
- a future V2 seed-capital event must be a new explicit event, not a copied legacy balance;
- indexes must support cohort-scoped owner/date/status queries;
- unique/idempotency constraints must include cohort where cross-cohort collisions are possible;
- foreign-key relationships must not permit a V2 child row to reference a legacy parent or the other asset family;
- migrations must be rerunnable/idempotent and include a rollback plan that does not delete historical data.

Produce a static migration-impact report with expected table locks, index-build method, row-count queries, and reconciliation SQL. Do not run it operationally.

## Gate 3 — Write-path isolation

Propagate explicit cohort identity through every paper write path found in Gate 0.

At minimum verify:

- F&O preliminary/final admission;
- F&O paper trade creation;
- F&O monitoring and terminal exit;
- F&O capital events and adjustments;
- swing staging and approval;
- swing paper entry;
- swing monitoring and exit;
- charges/cost rows;
- P&L/ledger events;
- replay/recovery/idempotency paths;
- schedulers and manual owner actions;
- Telegram/owner alerts where records are created or updated.

Rules:

- legacy schedulers and admissions write only to the correct legacy cohort;
- V2 functions reject before any DB call when their lock is false;
- no generic default may write a V2 record;
- the cohort must remain immutable for the lifetime of a trade/order/event;
- child events inherit and validate the parent cohort;
- deduplication/idempotency keys include cohort where necessary;
- alert deduplication keys include cohort so future V2 alerts cannot suppress legacy alerts;
- broker execution remains hard-disabled and outside this task.

Add a static/runtime zero-write tripwire proving disabled V2 paths invoke no insert, update, delete, provisioning, provider, or broker function.

## Gate 4 — Read, aggregation, and reconciliation isolation

Update all relevant read paths so that cohort scope is explicit and cannot be accidentally omitted.

Requirements:

- every performance query accepts a validated cohort;
- every cache/query key includes cohort;
- open positions, closed trades, P&L, win rate, charges, drawdown, setup statistics, and reports are computed per cohort;
- F&O and swing metrics never share a denominator;
- legacy and V2 metrics are never silently combined;
- missing/no-trade V2 metrics render as unavailable/empty, not fabricated zero performance;
- an optional combined informational view, if retained, must be explicitly labelled `COMBINED_COHORTS_INFORMATIONAL` and must not be used for qualification or headline strategy performance;
- reconciliation equations hold independently for each cohort;
- totals of separately scoped cohorts reconcile to a deliberately requested combined informational total;
- errors for one cohort must not overwrite last-good data for another cohort.

No query may use an unscoped `SELECT`/aggregation over cohort-bearing paper tables unless it is an explicitly documented administrative reconciliation query.

## Gate 5 — Capital and ledger isolation

Create an authoritative per-cohort capital contract.

Prove:

- legacy F&O capital remains legacy F&O;
- legacy swing capital remains legacy swing;
- `FNO_PAPER_V2` and `SWING_PAPER_V2` do not inherit any balance;
- deposits, withdrawals, reserved capital, deployed capital, realised P&L, unrealised P&L, charges, and net-vs-seed are cohort-scoped;
- a capital event for one cohort cannot affect another cohort;
- future seed capital requires a separately authorized, explicit event per V2 cohort;
- no fallback converts missing V2 seed/balance into `0` and presents that as an initialized account;
- no legacy account reconciliation metric is presented as V2 strategy P&L.

Add invariant checks for cross-cohort foreign keys, negative/invalid capital states, duplicate seed events, and unsupported transfers between cohorts.

## Gate 6 — API, schema, client, and route parity

For every affected route:

- validate cohort IDs with production Zod at the route boundary;
- reject unknown or asset-mismatched cohorts with a stable 4xx response;
- include cohort metadata in responses;
- preserve backward compatibility for existing legacy clients using an explicit server-side legacy default only where necessary;
- never default a mutation request to V2;
- update OpenAPI/generated Zod/client types and hooks;
- include cohort in React Query keys;
- prevent stale data from one cohort appearing under another cohort after switching;
- preserve source/provenance and data-state honesty.

Direct frontend database/provider access remains prohibited.

## Gate 7 — Stock Scanner Pro UI

On the existing paper-trading/reporting surfaces, add the smallest professional cohort selector/status treatment needed for clarity.

Required states:

- `FNO_PAPER_LEGACY` — historical/current legacy view;
- `SWING_PAPER_LEGACY` — historical/current legacy view;
- `FNO_PAPER_V2` — `Not activated — awaiting qualified option-premium research`;
- `SWING_PAPER_V2` — `Not activated — qualification/owner activation pending`.

UI rules:

- default existing users to the current appropriate legacy view;
- never show a disabled V2 cohort as live, active, profitable, empty-success, or initialized with ₹0;
- V2 empty state must say that the cohort has not started;
- clearly label cohort on trade tables, reports, P&L summaries, exports, and detail drawers where ambiguity is possible;
- keep F&O and swing controls visually distinct;
- do not redesign unrelated pages;
- preserve responsive behaviour and accessibility;
- one cohort's loading/error/empty state must not replace another cohort's data;
- no direct Kite, Upstox, IndianAPI, Yahoo, DB, or server-secret import in scanner code.

Capture authenticated visual evidence at 390×844, 768×1024, and 1440×900 for:

1. legacy F&O history;
2. legacy swing history;
3. disabled `FNO_PAPER_V2` state;
4. disabled `SWING_PAPER_V2` state.

Fixtures may be used only under the existing DEV-only preview harness and must be absent from production bundles.

## Gate 8 — Legacy-history preservation proof

Create a read-only reconciliation report using the current operational database, with secrets and personal identifiers redacted.

Record before-change baselines by legacy asset family:

- row counts per affected table;
- earliest/latest timestamps;
- open/closed/status counts;
- realised P&L and charge aggregates;
- capital-event counts and balances;
- orphan counts;
- representative hash/checksum over stable fields.

Because operational migration is not authorized, the after-state must show no operational mutation during this task.

Prove:

- zero rows deleted;
- zero rows rewritten or moved;
- zero rows assigned to either V2 cohort;
- legacy APIs still return the same historical records and aggregates;
- no prior trade history or P&L was erased;
- V2 read models return `NOT_ACTIVATED`, not legacy data.

Do not expose trade-owner identifiers, credentials, or connection strings in evidence.

## Gate 9 — Load-bearing tests

Add a focused professional test pack. Cover at least these categories:

1. canonical cohort enum and metadata;
2. unknown cohort fail-closed;
3. asset-family mismatch rejection;
4. null existing F&O row → F&O legacy only;
5. null existing swing row → swing legacy only;
6. explicit cohort required on new writes;
7. F&O V2 hard lock;
8. swing V2 hard lock;
9. environment variable cannot bypass locks;
10. force/admin/replay cannot bypass locks;
11. disabled V2 zero-DB-write tripwire;
12. disabled V2 zero-provider/broker-call tripwire;
13. cohort immutability;
14. parent/child cohort consistency;
15. idempotency key cohort isolation;
16. alert-dedup cohort isolation;
17. scheduler legacy-only behaviour;
18. open-position cohort filter;
19. closed-trade cohort filter;
20. P&L cohort filter;
21. charges cohort filter;
22. win-rate denominator isolation;
23. drawdown isolation;
24. setup-statistics isolation;
25. capital-event isolation;
26. duplicate seed prevention;
27. no inherited V2 balance;
28. combined view explicitly informational;
29. route Zod validation;
30. API response cohort metadata;
31. client query-key cohort isolation;
32. switching cohorts cannot show stale prior-cohort data;
33. V2 `NOT_ACTIVATED` empty state;
34. missing metrics render `—`/unavailable, not fake zero;
35. legacy backward compatibility;
36. export/report cohort labelling;
37. Telegram text/dedup cohort labelling where applicable;
38. migration idempotency/static safety;
39. operational-row non-interference source proof;
40. Global project untouched.

Target at least **80 load-bearing assertions/tests**, but prioritise real invariants over inflated counts. Use real production functions and registered route handlers where safe. No live provider calls or operational DB writes from tests.

## Gate 10 — Verification battery

Run and record:

- new cohort-foundation tests;
- existing F&O lifecycle suites;
- existing swing lifecycle suites;
- capital/P&L/reconciliation suites;
- `@workspace/api-server` full non-DB suite — accepted floor: **6,129** passing;
- `@workspace/scanner` full suite — accepted floor: **1,250** passing;
- TypeScript checks for api-server, scanner, api-zod, api-client-react, and db if changed;
- API-server production build;
- scanner production build;
- `git diff --check`;
- `.skip`, `.only`, retry, and arbitrary-sleep audit;
- secret sentinel scan;
- production bundle check proving preview fixtures and server secrets are absent;
- zero live-provider calls;
- zero broker calls;
- zero operational DB mutations;
- `DB_TEST_RUNTIME_AUTHORIZED` unchanged;
- `FNO_PAPER_V2_RUNTIME_AUTHORIZED === false`;
- `SWING_PAPER_V2_RUNTIME_AUTHORIZED === false`;
- `artifacts/global` untouched.

Fix failures caused by this task. Do not weaken assertions, suppress tests, or classify a failing invariant as a harmless flake.

## Gate 11 — Evidence and roadmap handoff

Write:

`artifacts/audit-evidence/V2_PAPER_COHORT_ISOLATION_FOUNDATION.md`

Include:

1. verdict;
2. project identity and git record;
3. complete affected-surface inventory;
4. cohort contract;
5. persistence/migration design;
6. hard-lock proof;
7. write-path matrix;
8. read/aggregation matrix;
9. capital isolation proof;
10. API/client/UI parity;
11. legacy baseline and zero-mutation reconciliation;
12. screenshots;
13. tests/typechecks/builds;
14. files changed;
15. risks and remaining prerequisites;
16. exact next roadmap steps.

The final nonblank line must be exactly one of:

- `END_V2_PAPER_COHORT_ISOLATION_FOUNDATION_ACCEPTED`
- `END_V2_PAPER_COHORT_ISOLATION_FOUNDATION_PARTIAL`
- `END_V2_PAPER_COHORT_ISOLATION_FOUNDATION_BLOCKED`

## Permitted verdicts

Return exactly one:

### 1. `ACCEPT_V2_PAPER_COHORT_ISOLATION_FOUNDATION`

Use only if:

- the code foundation is complete;
- all legacy behaviour and records are preserved;
- all read/write/capital/report paths are cohort-safe;
- both V2 locks are demonstrably false and non-bypassable;
- migration is ready but was not executed operationally;
- all required tests and builds pass.

### 2. `PARTIAL_V2_PAPER_COHORT_ISOLATION_FOUNDATION — <exact gap>`

Use if the safe code foundation is complete but a required isolated-DB migration proof, generated-client update, UI proof, or existing-schema dependency remains pending.

### 3. `BLOCKED_V2_PAPER_COHORT_ISOLATION_FOUNDATION — <exact blocker>`

Use if cohort identity cannot be propagated safely without risking historical data or changing trading logic.

## Required final response

Lead with the verdict, then state concisely:

- what was implemented;
- exact legacy row/history preservation result;
- whether any operational DB row changed;
- lock values and bypass results;
- affected API/UI surfaces;
- test counts and verification battery;
- evidence path and terminator;
- remaining owner authorization, if any;
- next roadmap order:
  1. Pack 9A live canary during market hours;
  2. additive cohort migration under separate authorization;
  3. swing qualification and separate `SWING_PAPER_V2` activation decision;
  4. option-premium data accumulation;
  5. frozen-protocol F&O requalification;
  6. separate `FNO_PAPER_V2` activation decision.

Do not claim either V2 cohort is active. Do not ask the owner to delete historical trades. Do not mix tomorrow's option-snapshot canary into this task.
