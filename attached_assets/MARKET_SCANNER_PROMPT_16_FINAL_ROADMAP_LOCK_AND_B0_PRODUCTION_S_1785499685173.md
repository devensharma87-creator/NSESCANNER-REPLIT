# MARKET SCANNER — PROMPT 16

## Final Roadmap Lock and Phase B0: Production-State Accuracy, Alert Reliability, and Market-Status Honesty

### Instruction to the Replit coder

This prompt replaces any tendency to open new audits, infrastructure projects, governance loops, or unrelated tasks.

The owner’s goal is to finish the actual Market Scanner website: correct its bugs, improve its accuracy and efficiency, make its behavior durable, and complete every agreed production feature through a finite roadmap.

Do not roam outside this roadmap.

Do not restart previously accepted phases.

Do not provision an external test database in this phase.

Do not execute Prompt 15.

Do not change `DB_TEST_RUNTIME_AUTHORIZED = false as boolean`.

Do not perform operational test-residue cleanup.

Do not create a broad new audit report before implementing the bounded work below.

---

# 1. Governing objective

Build a professionally reliable personal-use Indian-market trading platform whose:

- UI states are truthful;
- APIs are schema-valid and internally consistent;
- market data has authoritative source and freshness provenance;
- market-open/closed decisions are correct in IST;
- F&O and swing signals use authentic inputs and honest eligibility gates;
- paper trades follow the same immutable plans and risk controls shown to the user;
- P&L, charges, reconciliation and reports are numerically accurate;
- operational alerts are useful, deduplicated and actionable;
- failures degrade safely without fabricating data or silently presenting false certainty;
- performance, security and maintainability are suitable for durable personal production use.

The task must move forward phase by phase. Completion of one phase unlocks the next. A new forensic programme may be opened only if an executable test uncovers a genuinely new cross-cutting defect.

---

# 2. Frozen completed work

Treat these as accepted and frozen unless a new executable regression directly proves otherwise:

1. Phase A0.3 setup-availability and VWAP decision-path honesty.
2. Canonical nine-record index-F&O setup-availability contract.
3. Actual production route proof for normal, partial-index-failure and all-index-failure responses.
4. P0.1B normal-suite database safety and process-wide zero-connection tripwire.
5. Separation of DB-only test files from ordinary test commands.
6. Compile-time DB execution lock remaining `false`.

Do not refactor or rewrite these areas merely for style.

The owner has explicitly deferred isolated-test-database provisioning. Record it as a pre-release validation item only. It must not block ordinary website fixes that do not require destructive database testing.

---

# 3. Locked final roadmap

This is the remaining delivery sequence. Do not reorder it without executable evidence that a dependency makes the order impossible.

## B0 — Production state and alert reliability — execute now

- truthful market-open/closed/degraded UI and API behavior;
- accurate IST/session/calendar handling;
- Telegram/operational alert severity, deduplication, cooldown and recovery;
- reliable clock-drift assessment;
- truthful instrument-refresh and EOD-reconciliation messages;
- `/fno-diagnostics` consistency.

## B1 — Canonical market-data backbone and provider integration

- Kite as authoritative live quote/order source;
- controlled Upstox redundancy without silent source switching;
- IndianAPI for approved fundamentals, news and supported market datasets;
- nselib/public-exchange datasets only where legally and technically appropriate;
- canonical instruments, symbols, timestamps, freshness and source provenance;
- explicit failover and no fabricated fallback.

## B2 — Website-wide API/data/UI correctness

- Home and Market Pulse;
- Watchlist;
- Scanner and Deep Scan;
- sectors and benchmarks;
- Portfolio Analyser;
- charting;
- Option Chain and OI Lab;
- Backtest Lab;
- Daily Analysis;
- loading, empty, stale, partial-failure, error and closed-market states;
- Zod/OpenAPI/client/UI parity.

## B3 — F&O end-to-end production correctness

- candidate creation and setup eligibility;
- signal inputs, scoring, confidence, vetoes and anti-flip behavior;
- option-contract selection and tradability;
- immutable entry, stop and target plans;
- paper-admission rules;
- monitoring, target/stop/expiry exits;
- transaction charges and realized/unrealized P&L;
- signal history and execution truth;
- Telegram and UI parity;
- index-wise and trade-wise reporting.

## B4 — Swing-trading end-to-end production correctness

- scanner inputs and setup validity;
- event-risk, liquidity and freshness checks;
- staged-order lifecycle and owner approvals;
- immutable plans and risk controls;
- live/paper execution separation;
- monitoring, TTL, stop, target and exit handling;
- P&L, capital events, reconciliation and reporting;
- Telegram and UI parity.

## B5 — Paper ledgers, reports and analytical accuracy

- F&O and equity capital ledgers;
- gross/net/charges/STT accuracy;
- audit-event provenance;
- daily and EOD reconciliation;
- P&L dashboards;
- exportable index/date/trade-wise reports;
- retention, idempotency and recovery.

## B6 — Durability, performance, security and UX completion

- cache correctness and invalidation;
- scheduler idempotency and leader safety;
- API latency and bounded concurrency;
- authentication and authorization;
- secret and log hygiene;
- mobile/responsive/accessibility behavior;
- error boundaries and recoverability;
- removal of contradictory, deprecated and dead paths.

## B7 — Final integrated acceptance and production verification

- full regression and builds;
- complete production smoke matrix;
- live data/source/freshness validation;
- F&O and swing dry-run verification;
- monitoring and alert validation;
- controlled deployment and rollback evidence;
- final accepted/pending inventory.

Only B0 is authorized by this prompt.

---

# 4. Anti-loop execution protocol

Use this exact execution sequence:

1. Perform one read-only preflight.
2. Inspect only files directly connected to B0.
3. Produce one concise defect map.
4. Implement the corrections.
5. Run targeted tests.
6. Run relevant regressions, typechecks and builds.
7. Write one concise evidence record.
8. Return the final result and stop.

Do not repeatedly reread the same source sections.

Do not narrate every small command or turn the final response into an execution diary.

If a test fails, identify its exact cause and correct it. Do not reopen the entire project audit.

If a platform auto-commit adds only documentation, evidence, memory or `attached_assets/` files, record it and continue. Stop only if an unexpected commit changes production source, tests, schemas, migrations, dependencies, build configuration or deployment configuration.

No manual commit, push, pull, fetch, publish or deployment is authorized.

---

# 5. Phase B0 scope

Fix the production-state and alert defects represented by these observed messages and behaviors:

- `INSTRUMENTS_REFRESH_FAILED`;
- `EOD_RECONCILIATION_OK` incorrectly delivered as `[WARN]`/emergency-style F&O data alert;
- repeated identical `EOD_RECONCILIATION_OK` messages;
- repeated identical `CLOCK_DRIFT_EXCEEDED` messages;
- contradictory severity decorations such as warning plus emergency icon;
- unhelpful repeated action text pointing only to `/fno-diagnostics`;
- `/options` or related UI showing “Market is closed” when the actual problem is missing, stale, failed or suppressed data;
- stale cache or deprecated market-state fallbacks overriding authoritative market status.

The objective is not to hide genuine failures. The objective is to emit the right message, at the right severity, once per meaningful state transition, with an explicit recovery message when the incident clears.

---

# 6. Step 1 — Read-only preflight

Record:

- IST timestamp;
- branch and HEAD;
- upstream and ahead/behind without fetching;
- tracked, staged and untracked state;
- exact existing test/build scripts relevant to API, web UI and scanner;
- whether any unexpected source/test changes exist before B0 begins.

Do not stop because Prompt 16 itself appears under `attached_assets/` or because the platform auto-committed documentation-only files.

Do not alter Git state.

---

# 7. Step 2 — B0 source inventory

Search once for the exact event and UI strings, then read the complete relevant functions:

```text
INSTRUMENTS_REFRESH_FAILED
EOD_RECONCILIATION_OK
CLOCK_DRIFT_EXCEEDED
F&O DATA ALERT
/fno-diagnostics
Market is closed
marketState
marketOpen
marketStatus
DEGRADED
instrument refresh
clock drift
reconciliation
Telegram
```

Identify and report:

1. every scheduler/job that can emit the three named events;
2. the common alert formatter and transport;
3. existing dedupe, throttle, cooldown or persistence mechanisms;
4. all direct bypasses around the common dispatcher;
5. the canonical market-calendar/session service;
6. every API field used by `/options` to decide closed/open/degraded state;
7. every frontend fallback that can manufacture a closed state;
8. React Query or other cache settings that can preserve a stale market state;
9. `/fno-diagnostics` data sources and status mapping;
10. existing tests for all of the above.

Classify each observed problem as one of:

- wrong severity;
- duplicate scheduling;
- duplicate dispatch;
- missing idempotency;
- missing recovery transition;
- inaccurate measurement;
- stale cache;
- API/UI semantic mismatch;
- deprecated fallback;
- genuine infrastructure incident.

Do not edit until the inventory identifies the actual production path.

---

# 8. Step 3 — Canonical operational-alert contract

Implement or consolidate one canonical alert decision boundary. Adapt to existing project types, but it must represent at least:

- stable event key;
- subsystem;
- severity: `INFO`, `WARN`, or `CRITICAL`;
- lifecycle state: `OPEN`, `UPDATED`, `RECOVERED`, or routine success;
- IST trading date;
- deterministic incident fingerprint;
- first-seen and latest-seen timestamps;
- occurrence count where available;
- concise truthful detail;
- actionable owner instruction;
- optional diagnostic route;
- dedupe/cooldown policy.

Requirements:

1. Identical open incidents must not generate repeated messages on every scheduler tick.
2. A materially changed incident may produce one update.
3. Escalation to a higher severity must produce one alert.
4. Recovery must produce exactly one recovery notification.
5. A later genuinely new incident must be allowed after recovery.
6. Fingerprints must not contain secrets, tokens or unstable timestamps.
7. The formatter must not combine contradictory labels/icons.
8. All named F&O operational events must use this boundary; direct transport bypasses must be removed or justified.
9. Reuse an existing durable notification/incident store if one already exists.
10. Do not add an ad hoc filesystem store.
11. Do not introduce a database migration merely for this phase unless the repository already requires one and it can be validated safely without enabling DB-only tests.
12. If cross-restart persistence cannot be achieved safely with existing infrastructure, implement process-lifetime state-transition dedupe, state the exact restart limitation, and leave one bounded B6 item. Do not fabricate durability.

---

# 9. Step 4 — Correct event semantics

## 9.1 `EOD_RECONCILIATION_OK`

An OK reconciliation is not a warning or emergency.

Required behavior:

- never format `EOD_RECONCILIATION_OK` as `[WARN]` or critical;
- send it as a single `INFO` completion message or include it once in the normal EOD digest;
- do not send duplicates for the same trading date and reconciliation run;
- distinguish `passed`, `failed`, `skipped-not-applicable`, and `skipped-unverified` checks;
- do not say “all checks OK” if a skipped check was required but unverified;
- a genuine reconciliation failure must remain a warning/critical incident;
- a later transition from failure to OK must be labelled as recovery, not as an unrelated warning.

## 9.2 `INSTRUMENTS_REFRESH_FAILED`

This is operationally relevant but must be stateful and actionable.

Required behavior:

- emit one opening warning when the required daily refresh deadline is missed;
- suppress identical repeats during the configured cooldown/state;
- retain `SystemMode=DEGRADED` and block unsafe auto-opens while the instrument master is unavailable;
- expose the exact reason and last successful refresh time in diagnostics;
- retry according to the established safe refresh policy;
- emit one recovery message after a successful refresh;
- do not label the market itself closed merely because instruments or Kite authentication are unavailable;
- do not expose session credentials or raw provider errors to Telegram/UI.

## 9.3 `CLOCK_DRIFT_EXCEEDED`

Do not treat one HTTP response timestamp as precise NTP truth.

Required measurement behavior:

- inspect the existing algorithm before changing thresholds;
- use multiple bounded samples rather than one sample;
- estimate offset using request-start/response-end midpoint;
- record round-trip time and reject or down-weight high-latency samples;
- account for HTTP `Date` header resolution/quantization;
- use a robust aggregate such as median of valid samples;
- distinguish confirmed clock offset from network latency/measurement uncertainty;
- fail honestly when insufficient reliable samples exist;
- never silently claim clock synchronization;
- warn once when confirmed drift crosses the justified threshold;
- suppress identical repeats;
- emit one recovery message after confirmed return inside the recovery boundary;
- expose offset, uncertainty/RTT, sample count, source and as-of time in diagnostics without secrets.

Do not attempt to install or control a host NTP daemon from the application container.

Do not loosen the threshold only to silence alerts. Any threshold or hysteresis change must be justified by the timestamp-accuracy requirement and tested at its boundaries.

---

# 10. Step 5 — Canonical market-state truth

Correct the backend and UI semantics so that only an authoritative closed-session result can show “Market is closed.”

## 10.1 Required state model

Preserve existing schema names where appropriate, but behavior must distinguish:

- `OPEN`: authoritative calendar/session says the NSE session is open;
- `CLOSED`: authoritative calendar/session explicitly says closed;
- `DEGRADED`: session may be open but required data/provider/instrument state is unavailable or unsafe;
- `STALE`: last known data exists but exceeds its freshness contract;
- `UNKNOWN` or `ERROR`: authoritative status could not be determined.

Do not collapse `DEGRADED`, `STALE`, `UNKNOWN`, API failure, absent payload or schema failure into `CLOSED`.

## 10.2 Backend requirements

- use `Asia/Kolkata` explicitly for market date and session evaluation;
- normal session is 09:15–15:30 IST only when the authoritative trading calendar permits it;
- respect weekends, official holidays and configured special sessions;
- centralize the decision instead of duplicating date logic across routes/jobs;
- `/api/options/signals` and `/fno-diagnostics` must agree on market state and as-of time;
- provider/instrument failures must produce a truthful degraded reason;
- API responses must remain schema-valid under normal, closed, stale, degraded, partial-failure and error conditions;
- never use a stale cached `closed` result past its valid session/date boundary.

## 10.3 Frontend requirements

- the options page may display “Market is closed” only when authoritative `marketStatus.marketOpen === false` or the canonical equivalent is explicitly present and valid;
- missing `marketStatus`, API errors and validation failures must render neutral/error states;
- stale data must render a stale/degraded state with timestamp/source context;
- remove deprecated `marketState="closed"`, hard-coded closed defaults, `?? "closed"`, `|| "closed"`, and equivalent fallbacks;
- invalidate/refetch market-state queries at session boundaries and after authentication/instrument recovery;
- do not allow browser cache from a prior closed session to override a current open-session response;
- ensure active signal counts exclude unavailable, suppressed and information-only items according to existing accepted rules.

---

# 11. Step 6 — Diagnostics and message usability

Make `/fno-diagnostics` useful rather than a generic destination.

It must show, using existing UI/API conventions:

- current canonical market state;
- IST as-of timestamp;
- Kite session availability without exposing tokens;
- instrument-master trading date, last success and freshness;
- current system mode and exact degraded reasons;
- clock offset estimate, measurement confidence/RTT and last check;
- active alert incidents and last transition;
- EOD reconciliation status and skipped-check classification;
- recommended owner action for each unresolved incident.

Telegram action text should identify the action, for example:

- refresh instruments through the existing Admin path;
- renew Kite authentication through the existing authorized flow;
- inspect the specific clock-health diagnostic;
- review a failed reconciliation check.

Do not add fake remediation buttons or routes.

---

# 12. Step 7 — Load-bearing tests

Test production functions, registered routes and real UI components—not only copied fixtures or inline schema mirrors.

At minimum add executable tests for:

## Alert behavior

1. first warning is emitted;
2. identical warning is suppressed;
3. material update is emitted once;
4. severity escalation is emitted once;
5. recovery is emitted exactly once;
6. the same incident may reopen after recovery;
7. fingerprints are stable and secret-free;
8. `EOD_RECONCILIATION_OK` is never warning/critical;
9. duplicate EOD success for the same run/date is suppressed;
10. required-but-unverified skipped checks do not produce “all checks OK”;
11. instrument-refresh failure emits once and recovery emits once;
12. formatter never creates contradictory severity labels/icons.

## Clock-drift behavior

13. high network latency with acceptable bounded offset does not create a false drift alert;
14. one outlier does not dominate the robust aggregate;
15. confirmed drift beyond the boundary emits one warning;
16. repeated confirmed drift is deduplicated;
17. recovery inside the hysteresis boundary emits once;
18. insufficient valid samples returns unknown/unreliable, not false zero drift;
19. threshold and recovery-boundary cases are tested exactly.

## Market-state/API behavior

20. real open session + healthy data => open;
21. real open session + missing provider data => degraded, not closed;
22. real open session + stale data => stale/degraded, not closed;
23. API error or absent status => error/unknown, not closed;
24. official closed session => closed;
25. holiday/weekend => closed with truthful reason;
26. special-session override behaves according to configuration;
27. prior-day cached closed state cannot survive into current open session;
28. `/api/options/signals` and `/fno-diagnostics` agree;
29. production response parses with the real Zod schema;
30. actual options-page component renders each canonical state correctly;
31. contradictory “market closed” fallback searches return zero production hits.

## Regression integrity

32. A0.3 availability records remain exactly nine and truthful;
33. missing authoritative VWAP remains neutral and cannot create a VWAP driver/veto;
34. DB-only tests remain excluded from normal commands;
35. process-wide ordinary-test tripwire remains at zero connection attempts.

Do not weaken existing assertions, introduce arbitrary sleeps, add retries to hide races, or add `.skip`/`.only`.

Use deterministic injected clocks and calendars for time-dependent tests.

---

# 13. Step 8 — Verification

Run and report exact commands and per-suite counts for:

1. all new B0 targeted tests;
2. existing alert/Telegram tests;
3. market-calendar and market-status tests;
4. options API route tests;
5. production options-page component tests;
6. A0.3 accepted baseline/behavioral tests;
7. API-server normal full suite, excluding DB-only files through the accepted config;
8. scanner full suite;
9. API server typecheck;
10. API Zod typecheck;
11. API client typecheck;
12. web application typecheck;
13. scanner typecheck;
14. API server production build;
15. web application production build;
16. scanner production build;
17. process-wide zero-connection tripwire;
18. `git diff --check`.

First inspect the actual workspace package names and scripts. Do not invent commands or substitute an unrelated package.

If a broad suite fails:

- identify the exact file and test;
- reproduce it alone;
- determine whether B0 caused it;
- fix the root cause if related;
- report it honestly if unrelated;
- do not call an unidentified failure “pre-existing” or “timing-related” without executable evidence.

---

# 14. Evidence record

Create or update one concise evidence file:

```text
artifacts/audit-evidence/PHASE_B0_PRODUCTION_STATE_AND_ALERT_RELIABILITY.md
```

It must contain:

1. starting and final HEAD;
2. exact changed-file inventory;
3. defect-to-fix mapping;
4. alert event/state matrix;
5. market-state mapping;
6. clock-measurement method and boundary values;
7. targeted and regression test counts;
8. typecheck/build results;
9. remaining limitations;
10. confirmation that Prompt 15/isolated DB execution was not performed;
11. confirmation that no operational data was changed;
12. SHA-256;
13. exactly one final terminator as the last nonblank line:

```text
END_PHASE_B0_PRODUCTION_STATE_AND_ALERT_RELIABILITY
```

Do not append this evidence to the old A0.3 or P0.1B files.

---

# 15. Acceptance criteria

Return:

```text
ACCEPT_B0_PRODUCTION_STATE_AND_ALERT_RELIABILITY
```

only when all of the following are true:

1. an OK EOD reconciliation cannot be emitted as a warning;
2. identical named incidents no longer spam Telegram;
3. open, update, escalation and recovery transitions are executable and tested;
4. clock drift is measured with bounded multi-sample uncertainty rather than a naive single response;
5. an instrument-refresh failure remains safely degraded but emits one actionable incident and one recovery;
6. the options UI cannot display “Market is closed” for missing, stale, degraded or failed data;
7. backend APIs and diagnostics use the same canonical IST market state;
8. production component and route tests pass;
9. A0.3 behavior remains intact;
10. normal test commands remain unable to connect to PostgreSQL;
11. all relevant regressions, typechecks and builds pass;
12. no assertion was weakened and no test was hidden;
13. no commit, push, deployment or operational-data mutation occurred.

If any item fails, return exactly:

```text
B0_NOT_ACCEPTED — <single precise blocker>
```

Do not start B1 in the same task.

---

# 16. Required final response format

Return only:

1. **Verdict**
2. **Production defects fixed**
3. **Alert transition matrix**
4. **Market-state truth table**
5. **Clock-drift measurement result**
6. **Exact tests and counts**
7. **Typechecks and builds**
8. **Changed-file inventory**
9. **Git/evidence integrity**
10. **Remaining bounded limitations**
11. **Next roadmap phase: B1 — not started**
12. **Production deployment status**

Do not provide a command-by-command diary.

Do not suggest a new audit.

Do not create a new task plan outside the locked roadmap.

Production remains:

```text
PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED
```

until B7 is completed and explicitly authorized.

