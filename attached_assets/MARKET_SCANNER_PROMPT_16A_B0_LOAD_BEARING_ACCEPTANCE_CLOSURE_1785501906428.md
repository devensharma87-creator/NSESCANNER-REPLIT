# MARKET SCANNER — PROMPT 16A

## Phase B0 Load-Bearing Acceptance Closure

### Instruction to the Replit coder

The first Prompt 16 implementation is directionally correct and must be preserved. This is one bounded closure pass for Phase B0. It is not a new audit and it does not authorize B1.

Do not revisit A0.3, P0.1B, isolated database provisioning, Prompt 15, the data-provider backbone, F&O strategy logic, swing strategy logic, deployment or unrelated code.

Do not replace working Prompt 16 changes merely for style.

Do not create another broad task plan. Execute the six missing acceptance gates below, run verification once, update the existing B0 evidence file, return the result and stop.

No manual commit, push, pull, fetch, deployment or operational-data mutation is authorized.

Keep:

```ts
DB_TEST_RUNTIME_AUTHORIZED = false as boolean
```

---

# 1. Why closure is required

The prior response reported these useful completed corrections:

- per-event Telegram headers instead of one universal warning header;
- `EOD_RECONCILIATION_OK` changed to `INFO`;
- more honest EOD skipped-check wording;
- three clock samples, RTT filtering, median calculation and recovery event;
- instrument-refresh recovery handling;
- an options-page guard using `!isError` and explicit `marketStatus`;
- `test:full` at 4326/4326 and scanner/typecheck results.

Preserve them.

However, the acceptance response did not prove several mandatory Prompt 16 requirements. Most importantly, it did not demonstrate that the duplicate EOD success messages shown to the owner are actually suppressed. Changing their severity alone does not fix the duplicate alert defect.

The report also did not prove canonical incident transitions, robust clock-offset uncertainty, prior-session cache invalidation, diagnostics parity, all required builds/typechecks, or evidence/Git integrity.

Do not claim B0 acceptance until these six gates are executable and green.

---

# 2. Scope and anti-loop rule

Perform only this sequence:

1. Record current read-only Git state once.
2. Read the existing Prompt 16 changed files and B0 tests once.
3. Map each of the six gates below to the current implementation.
4. If already correctly implemented, add or identify load-bearing proof without rewriting it.
5. If missing, make the smallest production correction.
6. Run the targeted B0 closure suite.
7. Run the required regression/build battery once.
8. Correct the existing B0 evidence file and stop.

If an unexpected auto-commit changes only documentation, evidence, memory or `attached_assets/`, record and continue. Stop only for an unexpected production, test, schema, migration, dependency, build or deployment change.

Do not repeatedly inspect HEAD or stop for the Prompt 16A attachment itself.

---

# 3. Gate B0-C1 — EOD duplicate suppression

The owner received identical `EOD_RECONCILIATION_OK` messages at approximately 15:37 and 15:39 for the same trading date and result.

Required production behavior:

1. Generate a deterministic dedupe identity from stable semantic fields such as:
   - event key;
   - IST trading date;
   - reconciliation run/result identity;
   - material result classification.
2. Do not include `Date.now()`, send time, random IDs or unstable wording in the dedupe identity.
3. Two scheduler/handler invocations for the same completed reconciliation must result in one Telegram message.
4. A materially different result must be eligible for an update.
5. A failure followed by a successful reconciliation must produce one recovery/success transition.
6. A new trading date must be eligible for its own result message.
7. Routine OK messages must remain `INFO` or be folded into the established daily digest—never warning/critical.
8. The fix must occur at the canonical decision/dispatch boundary, not only inside one test fixture.

Required executable tests:

- same date + same result + two invocations => one outbound call;
- same date + three invocations => one outbound call;
- same date + materially changed result => one update allowed;
- failure then OK => one recovery/success transition;
- next IST trading date => new message allowed;
- restarted/recreated scheduler path uses the strongest existing project persistence available.

If the repository has no safe persistent incident store, state that exact cross-process/restart limitation. Do not call process-memory dedupe durable.

---

# 4. Gate B0-C2 — Canonical incident transitions

The prior report described formatting and individual recovery functions but did not prove one load-bearing incident state machine.

For each of these events:

```text
INSTRUMENTS_REFRESH_FAILED
INSTRUMENTS_REFRESH_RECOVERED
CLOCK_DRIFT_EXCEEDED
CLOCK_DRIFT_RECOVERED
EOD_RECONCILIATION_FAILED
EOD_RECONCILIATION_OK
```

prove or implement the canonical transition behavior:

```text
healthy → open incident → repeated unchanged → material update/escalation → recovery → repeated recovery → later new incident
```

Required invariants:

- first incident emits once;
- unchanged repeats are suppressed;
- material update emits once;
- severity escalation emits once;
- recovery emits exactly once;
- repeated recovery is suppressed;
- a later genuinely new incident can reopen;
- fingerprint contains no secret, raw token or unstable timestamp;
- contradictory icons/severity labels cannot be produced;
- all named events pass through the canonical alert boundary or have an explicit tested justification.

Add a compact event-transition table to the evidence record containing event key, open severity, repeat policy, update condition, recovery key and persistence scope.

Do not build a new notification platform. Consolidate the minimum existing paths necessary to make these named production events correct.

---

# 5. Gate B0-C3 — Clock-drift measurement honesty

The prior report states “3 probes → RTT filter → median,” but does not prove midpoint correction, `Date`-header quantization/uncertainty or insufficient-sample behavior.

Inspect the actual implementation and enforce all of the following:

1. For each request capture local send time `t0` and receive time `t1`.
2. Estimate the local comparison point using the midpoint `(t0 + t1) / 2`.
3. Record RTT as `t1 - t0`.
4. Account for the HTTP `Date` header’s coarse timestamp resolution when determining certainty.
5. Reject or down-weight samples above the configured RTT ceiling.
6. Aggregate valid samples robustly, such as by median.
7. Require a justified minimum number of valid samples.
8. If too few samples remain, return `UNKNOWN`/`UNRELIABLE`; never substitute zero drift.
9. Warn only when confirmed offset beyond measurement uncertainty crosses the justified warning boundary.
10. Use a tested recovery/hysteresis boundary to prevent flapping.
11. Diagnostics must expose sanitized offset, RTT/uncertainty, valid sample count, source and as-of time.
12. No credential or complete request URL may appear in logs, UI or Telegram.

Correct the action text. The Replit/container application cannot itself ensure that a host NTP daemon is installed or running. Do not instruct the owner to perform a remediation that is unavailable from the application environment.

Use truthful action wording along these lines, adapted to real project capabilities:

```text
Recheck System Health. If confirmed drift persists, restart the compute/runtime or escalate the host-clock issue to the platform provider. Signal timestamps remain guarded while degraded.
```

Required executable tests:

- midpoint calculation with known `t0`, `t1` and server time;
- acceptable offset plus high RTT does not create a false confirmed warning;
- HTTP-date quantization boundary is handled honestly;
- one outlier does not dominate the median;
- insufficient valid samples => unknown/unreliable;
- confirmed drift => one warning;
- repeat drift => suppressed;
- recovery => one recovery message;
- action text contains no impossible host-NTP instruction.

Do not merely raise the drift threshold to silence notifications.

---

# 6. Gate B0-C4 — Stale closed-state invalidation and market-state truth

This change alone is not sufficient proof against stale session data:

```tsx
!isError && data?.marketStatus != null && !data.marketStatus.marketOpen
```

It prevents an explicit query error or absent status from being labelled closed, which is good. Preserve it. Now close the remaining stale-data path.

Required behavior:

1. A prior closed-session response must not remain authoritative after the next IST market-session boundary.
2. A prior-day closed state must not render “Market is closed” during a current open session while a refetch is pending.
3. Stale status must render `STALE`/`DEGRADED` or loading/verification state—not `CLOSED`.
4. Missing or schema-invalid status must render neutral/error—not `CLOSED`.
5. Provider failure, instrument failure or Kite-session absence during an open session must render `DEGRADED`—not `CLOSED`.
6. Only a fresh authoritative market-status payload that explicitly says `marketOpen === false` may render the closed-market UI.
7. Query keys, `staleTime`, refetch triggers and invalidation must respect IST trading-date/session boundaries.
8. Recovery of Kite session or instruments must invalidate/refetch affected options and diagnostics queries.
9. `/api/options/signals`, `/fno-diagnostics` and the options-page component must agree on the state and as-of timestamp.

Required executable production-component/route tests:

- yesterday closed + today 09:20 IST + refetch pending => not closed;
- same-day pre-open closed => closed with correct reason;
- open session + fresh healthy data => open;
- open session + stale data => stale/degraded;
- open session + API error => error/unknown;
- open session + no Kite session => degraded;
- open session + instrument refresh failed => degraded;
- weekend/official holiday => closed;
- special-session configuration => canonical configured result;
- recovery invalidation/refetch updates the rendered state;
- production search finds no `?? "closed"`, `|| "closed"`, deprecated `marketState="closed"` or equivalent fabricated fallback.

Use deterministic injected IST clocks/calendars. Do not use wall-clock sleeps.

---

# 7. Gate B0-C5 — Diagnostics and response parity

The prior response did not report executable `/fno-diagnostics` parity.

Prove that the actual registered diagnostics route/facade and actual options response expose mutually consistent sanitized values for:

- canonical market state;
- IST as-of time;
- market-state reason;
- Kite session availability;
- instrument refresh date, last success and freshness;
- system mode and degraded reasons;
- clock state, offset, RTT/uncertainty, valid-sample count and last check;
- EOD reconciliation state and skipped-check classification;
- active named incidents and last transition, where supported by the existing contract.

Requirements:

1. Do not fabricate unavailable fields.
2. Do not expose tokens, credentials, database URLs or raw provider secrets.
3. Do not add an untested inline schema mirror.
4. Update the real Zod/OpenAPI/client contract if production response shape changes.
5. Test the actual route/facade and parse with the production schema.
6. Test the actual diagnostic UI component if the route is user-facing.
7. Ensure the Telegram action refers to a real route/action and matches the diagnostic state.

If a desired field cannot be added without expanding B0 materially, omit it honestly and record the exact bounded B2 follow-up. Do not claim diagnostics completeness for a field that does not exist.

---

# 8. Gate B0-C6 — Complete verification and evidence integrity

Run the targeted closure tests and report exact per-file counts. Reconcile the prior statement “85 B0 tests” with named test files and counts.

Then run the actual available commands for:

1. B0 targeted tests;
2. alert/Telegram tests;
3. market-calendar/status tests;
4. options API route tests;
5. `/fno-diagnostics` route/facade tests;
6. actual options-page component tests;
7. A0.3 accepted behavioral tests;
8. API-server `test:full` under the accepted non-DB config;
9. scanner full suite;
10. API-server typecheck;
11. API-Zod typecheck;
12. API client typecheck;
13. actual web application typecheck;
14. scanner typecheck;
15. API-server production build;
16. actual web application production build;
17. scanner production build;
18. process-wide zero-PostgreSQL-connection tripwire;
19. `git diff --check`.

Inspect package scripts first and report the exact package/command. If a listed package does not exist, report the actual package that owns the code; do not silently omit the check.

Any failure must be identified by exact file/test and classified with evidence. Do not call it pre-existing, flaky or timing-related without proof.

## Evidence-file requirements

Update only:

```text
artifacts/audit-evidence/PHASE_B0_PRODUCTION_STATE_AND_ALERT_RELIABILITY.md
```

The final evidence must include:

- implementation starting HEAD and final observed HEAD;
- branch, upstream and ahead/behind without fetching;
- tracked/staged/untracked state;
- whether platform auto-commits occurred;
- exact production/test/evidence changed-file inventory;
- defect-to-fix mapping;
- incident transition matrix;
- market-state truth table;
- clock algorithm and numeric boundaries;
- exact per-file test results and reconciled totals;
- all typecheck/build commands and results;
- process-wide zero-connection result;
- confirmation that Prompt 15 was not executed;
- confirmation the DB runtime lock remains false;
- confirmation no operational data changed;
- confirmation no manual commit/push/deployment occurred;
- SHA-256 after the final evidence write;
- exactly one occurrence of this terminator as the final nonblank line:

```text
END_PHASE_B0_LOAD_BEARING_ACCEPTANCE_CLOSURE
```

Do not leave an earlier terminator after it.

---

# 9. Acceptance decision

Return:

```text
ACCEPT_B0_PRODUCTION_STATE_AND_ALERT_RELIABILITY
```

only if all six closure gates pass.

Otherwise return:

```text
B0_NOT_ACCEPTED — <one precise remaining blocker>
```

Do not start B1 in this task.

Do not provision a database.

Do not execute Prompt 15.

Do not deploy.

---

# 10. Required final response

Return only:

1. **Verdict**
2. **Six closure-gate results**
3. **Incident transition matrix**
4. **Market-state truth table**
5. **Clock-measurement proof**
6. **Diagnostics parity result**
7. **Exact tests and reconciled counts**
8. **Typechecks and builds**
9. **Changed-file and Git record**
10. **Evidence SHA-256 and terminator proof**
11. **Remaining bounded limitations**
12. **Next roadmap phase: B1 — not started**
13. **Production status**

No command diary. No new roadmap. No unrelated recommendations.

Production remains:

```text
PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED
```

