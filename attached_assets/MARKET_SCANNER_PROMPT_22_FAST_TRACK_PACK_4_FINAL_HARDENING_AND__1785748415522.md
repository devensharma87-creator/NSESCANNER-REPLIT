# MARKET SCANNER — PROMPT 22

## Fast-Track Delivery Pack 4: Final Integrated Hardening, Security, Performance and Release Readiness

### Instruction to the Replit coder

Fast-Track Packs 1–3 are accepted and frozen.

Preserve the most recent reported baselines:

```text
api-server full non-DB suite: 4,999/4,999
scanner full suite: 947/947
five package typechecks: clean
three production builds: pass
```

The accepted implementation now includes:

- canonical website data-state/UI correctness;
- canonical Kite-first live-data backbone;
- complete F&O signal-to-exit/paper/P&L lifecycle;
- complete Swing scan-to-stage/approval/open/exit/P&L lifecycle;
- atomic Swing stage claim using a database advisory transaction lock;
- API/schema/client/UI/Telegram parity tests;
- ordinary-test zero-database-connection safeguards.

Do not reopen A0.3, P0.1B, B0, B1.1, Pack 1, Pack 2 or Pack 3.

This is the final roadmap implementation pack. Its purpose is to integrate, harden and verify the completed system as one professional release candidate—not to create another feature phase or broad business-logic audit.

Start the complete implementation without asking for another confirmation because of task size.

No manual commit, push, pull, fetch, publish or deployment is authorized.

Do not provision or connect to an external test database. Do not execute Prompt 15. Do not change `DB_TEST_RUNTIME_AUTHORIZED`.

Do not place live broker orders or contact live notification/provider services from tests.

---

# 1. Final pack objective

Leave the repository in one evidence-backed state suitable for the owner's separate deployment decision:

```text
FUNCTIONALLY INTEGRATED
DATA-CONSISTENT
FAIL-CLOSED
SECURITY-HARDENED
RESOURCE-BOUNDED
OBSERVABLE
TESTED
BUILDABLE
ROLLBACK-READY
NOT YET DEPLOYED
```

The pack covers:

- complete navigation and integrated user journeys;
- canonical cross-tab data equality;
- route/auth/security hardening;
- cache, scheduler, WebSocket and provider-call efficiency;
- stale/error/degraded recovery;
- alert/diagnostic/observability quality;
- accessibility and responsive UI correctness for touched critical states;
- full API/schema/client/build parity;
- final non-DB regression;
- release and rollback runbook preparation.

Do not add new trading strategies, new data vendors, new business features or speculative refactors.

---

# 2. Fast-track execution sequence

Use this exact sequence:

1. One read-only release preflight.
2. One integrated route/journey/security/performance inventory.
3. One concise release-blocker defect matrix.
4. Implement all confirmed Pack 4 release blockers in controlled batches.
5. Add integrated production-boundary tests.
6. Run targeted tests after each batch.
7. Run one final repository-wide non-DB battery.
8. Write one final release-readiness evidence file and one operator runbook.
9. Return the final verdict and stop.

Do not repeat completed strategy or lifecycle audits.

Do not modify working production logic merely because code style could be improved.

Classify findings:

```text
RELEASE_BLOCKER
HIGH_RISK_BUT_NON_BLOCKING
FOLLOW_UP_AFTER_RELEASE
ALREADY_PROVEN
NOT_APPLICABLE
```

Implement every `RELEASE_BLOCKER` and every safe in-scope `HIGH_RISK_BUT_NON_BLOCKING` correction. Record genuinely external/owner-controlled items without blocking independent work.

Do not create a new multi-month roadmap.

Stop only for a genuine owner decision such as a destructive production-data action, new credential, provider purchase/activation, required production migration or deployment authorization.

---

# 3. Frozen business behavior

Preserve:

- F&O and Swing strategies;
- thresholds, confidence weights, ranking weights and veto rules;
- signal tiers;
- entry, target, stop and exit formulas unless a clear integration defect exists;
- lot/quantity/capital/risk policies;
- immutable plans;
- paper-only/live-order hard blocks;
- event-risk and approval policies;
- accepted charge and P&L engines;
- existing provider hierarchy;
- Pine import, drawing toolbar and chart library;
- authentication roles and subscription semantics;
- database safety architecture.

Do not:

- retune for more trades;
- update statutory rates without authoritative dated evidence;
- activate Upstox/IndianAPI without credentials;
- remove Yahoo before replacement coverage is proven;
- introduce a new database or migration unless an unavoidable release blocker is reported and authorized;
- clean operational test residue;
- place live orders;
- deploy.

The global Swing advisory lock introduced in Pack 3 is accepted as a conservative correctness mechanism for this personal-use system. Record its coarse-grained serialization as a future scale optimization, not a Pack 4 release blocker, unless tests demonstrate material user impact.

---

# 4. Release preflight

Record once:

- IST timestamp;
- branch and HEAD;
- upstream and ahead/behind without fetching;
- tracked/staged/untracked state;
- platform auto-commit chronology since Pack 3;
- exact package scripts for tests, typechecks and builds;
- current route manifests for Global/web, Scanner and API server;
- required environment-variable names by presence only;
- provider capability states without printing credentials;
- live-order and DB-test hard-lock states;
- current production/preview configuration files;
- current evidence-file inventory for Packs 1–3.

Do not print, hash or partially reveal secret values.

Do not connect to PostgreSQL or a live provider during preflight.

If the Pack 3 closure evidence was written to:

```text
docs/PACK3_LOAD_BEARING_FINAL_CLOSURE_2026-08-03.md
```

record it as the authoritative Pack 3 closure supplement. Do not rewrite completed Pack 3 production logic merely because the evidence path differed from the earlier requested path.

---

# 5. Gate A — Complete navigation and route integrity

Inventory every current user-facing navigation destination and route in both frontend applications.

At minimum cover project equivalents of:

```text
Login/session
Home / Market Pulse
Watchlist
Scanner / Deep Scan
Sector/index detail
Stock/security detail
Portfolio / Portfolio Analyser / Holdings
Charts
Option Chain / OI Lab
Backtest Lab
Daily Analysis / reports
F&O Intraday
F&O paper trading / history / P&L
Swing Scanner
Swing staged orders / approval
Swing open/closed trades / P&L
Diagnostics / system mode / provider health
Admin / live-feed controls available to the owner
```

Required behavior:

- every navigation link resolves to an existing route;
- every route renders its intended production component;
- protected routes enforce the existing auth/subscription policy;
- unknown routes use the intended 404/fallback behavior;
- no route imports a provider directly from UI code;
- no route crashes from missing optional fields;
- route-level errors reach an error boundary or explicit error state;
- deep-link refresh works;
- route parameters are validated/encoded safely;
- stale navigation state does not leak one symbol/account/session into another;
- no completed page remains an unreachable orphan.

Add a route-manifest test comparing navigation destinations with registered frontend routes and relevant backend endpoints.

Do not create placeholder pages merely to make the manifest pass. Implement or remove only confirmed broken navigation according to current product intent.

---

# 6. Gate B — Canonical cross-tab data consistency

This is a final mandatory architecture gate.

Every page, route, engine and report must consume the canonical internal data backbone. No UI component or feature module may call Kite, Upstox, IndianAPI, Yahoo or NSE directly.

## 6.1 Canonical provider policy

| Domain | Authoritative source |
|---|---|
| live/index/equity/F&O quotes and trading inputs | Kite canonical facade |
| instrument master and broker portfolio/order truth | Kite canonical services |
| validated secondary quotes/candles | Upstox only when configured and parity-approved |
| fundamentals/shareholding/corporate actions/news | IndianAPI only when configured and validated |
| paper/live trade history and P&L | immutable internal ledger |
| Yahoo | labelled delayed display-only; prohibited from decisions/execution/P&L |

## 6.2 Shared data contract

Verify project equivalents of:

```text
canonical instrument identity
snapshotId
source / trust tier
asOf / receivedAt
marketSessionDate
freshness
future/stale flags
fallbackUsed
dataQuality
degradedReason
```

## 6.3 Cross-surface parity scenarios

For representative:

- NSE equity;
- BSE-only equity;
- NIFTY option contract;
- BANKNIFTY option contract;
- SENSEX option contract;
- F&O paper trade;
- Swing staged/open/closed trade;

prove exact equality, where the field is shared, across relevant pages/APIs for:

```text
exchange/symbol/token/ISIN
LTP/OHLC/change percentage
candle close/timeframe
market/session state
option-chain spot/strike/expiry/OI/premium
signal/plan/trade identities
entry/target/stop/quantity
status/exit reason
gross/charges/net P&L
source/asOf/snapshot
IST timestamp
```

Different refresh times may legitimately produce different market values only when each surface displays its own `asOf`/snapshot and does not claim equality. Prefer shared snapshot/cache reuse within the same refresh cycle.

## 6.4 Fail-honest rule

When canonical data is unavailable, show:

```text
UNAVAILABLE
STALE
DEGRADED
AUTH_EXPIRED
NOT_CONFIGURED
```

Never fabricate zero, previous close, spot-as-indicator, closed market or another provider silently.

---

# 7. Gate C — API, Zod, OpenAPI and client completeness

Generate one route-contract manifest containing:

- method/path;
- auth middleware;
- request schema;
- response Zod schema;
- OpenAPI operation/schema;
- generated client method/type;
- consuming frontend query/component;
- cache key/invalidation;
- tested normal/empty/degraded/error states.

For every currently consumed API route prove:

- route is registered exactly as expected;
- authentication/authorization is correct;
- request parameters/body are validated;
- production response parses through production Zod;
- OpenAPI matches the response;
- generated client matches OpenAPI/Zod;
- required data is not stripped;
- nullability/optionality matches production reality;
- valid empty is distinct from producer error;
- errors do not become HTTP 200 zero/empty success unless explicitly designed;
- source/freshness/provenance survives serialization;
- unsafe internal errors/secrets are not exposed.

Reject malformed identifiers, enums, timestamps, duplicate composite keys, contradictory statuses and invalid numeric values.

Do not broadly regenerate clients/contracts unless a proven mismatch requires it.

---

# 8. Gate D — Authentication, authorization and session security

Inspect and test the real auth boundaries without contacting production identity systems.

Required coverage:

- anonymous user;
- authenticated owner;
- authenticated non-owner/subscriber where applicable;
- expired/invalid session;
- missing/invalid cookie/header;
- logout/session revocation behavior;
- public-mode routes where intentionally supported;
- F&O entitlement enforcement;
- owner-only admin/live-feed actions;
- Swing approval/rejection ownership;
- mutation-route authorization;
- cross-user object access prevention.

Security requirements:

- secure, HTTP-only and appropriate same-site cookie policy in production configuration;
- CSRF protection or a documented equivalent for cookie-authenticated mutations;
- safe CORS allowlist;
- no auth token in URL/query/log/client error;
- no open redirect;
- session identifiers not exposed to UI unnecessarily;
- timing/error responses do not disclose sensitive account existence;
- provider access tokens remain server-side;
- live-order/owner controls cannot be enabled by client-supplied fields.

Fix confirmed vulnerabilities only. Do not replace the authentication system speculatively.

---

# 9. Gate E — Input validation and application security

Review production boundaries for:

- SQL injection;
- command injection;
- path traversal;
- SSRF;
- unsafe provider URL construction;
- reflected/stored XSS;
- unsafe HTML rendering;
- prototype pollution/object spreading of untrusted payloads;
- oversized request bodies;
- abusive query ranges;
- invalid numeric values (`NaN`, infinity, negatives where prohibited);
- unsafe symbol/exchange/date/timeframe values;
- log injection and secret leakage;
- webhook/notification injection where applicable.

Required controls:

- parameterized SQL/ORM operations;
- allowlisted provider hosts and route values;
- request/body size limits;
- bounded date ranges/page sizes/batch sizes;
- safe text rendering/escaping;
- error redaction;
- normalized identifiers;
- server-side ownership checks;
- no dynamic code execution from user/provider content.

Test the real validators/routes with malicious and boundary payloads. Do not perform destructive or live attacks.

---

# 10. Gate F — Secrets and configuration safety

Inventory environment-variable names and configuration flow by name/presence only.

Verify:

- Kite, Upstox, IndianAPI, Telegram, database and encryption credentials never reach browser bundles;
- no secret is hardcoded in source, fixtures, evidence, logs or error responses;
- missing required production configuration fails with an actionable safe message;
- optional provider absence becomes `NOT_CONFIGURED` rather than fabricated availability;
- development/test defaults cannot enable live orders;
- `SWING_CASH_EXECUTION_MODE=paper_only` and live-order hard blocks remain effective;
- `DB_TEST_RUNTIME_AUTHORIZED` remains false;
- test child environment allowlist excludes production secrets;
- diagnostics expose capability states, not credentials;
- encryption-at-rest/key-rotation paths already present remain functional.

Use secret scanning that reports paths and key names only. Never print matching values.

---

# 11. Gate G — Rate limiting, abuse and expensive operations

Identify high-cost or sensitive routes, including:

- login/session endpoints;
- provider refresh/admin actions;
- full-universe scans;
- option-chain requests;
- chart/history ranges;
- backtests;
- report/export generation;
- mutation/approval/open/close actions;
- diagnostics capable of triggering work.

Verify or implement proportional controls:

- authentication/authorization before expensive work;
- bounded request ranges and result sizes;
- route-level rate limiting where appropriate;
- per-owner idempotency for mutation routes;
- request coalescing for identical provider reads;
- bounded concurrency and provider timeouts;
- retry budgets with backoff/jitter;
- circuit-breaker/degraded behavior where already supported;
- cancellation/timeout cleanup;
- no unbounded queue, loop or recursive retry.

This is a personal-use system; controls may be simple but must prevent accidental storms and repeated scheduler/manual-trigger overlap.

---

# 12. Gate H — Cache, freshness and consistency hardening

Inventory central cache/query keys for live quotes, candles, option chain, scanner results, market status, portfolio, reports and provider health.

Required behavior:

- cache keys include canonical identity and all relevant parameters;
- user/account-specific data cannot leak across owners/sessions;
- market-session date prevents yesterday's state from masquerading as today;
- freshness uses provider `asOf`, not only local fetch time;
- future timestamps fail closed;
- stale data retains provenance and is labelled;
- cache invalidation follows writes/session/provider changes;
- refresh errors with usable data preserve stale data visibly;
- initial errors do not become cached empty success;
- no `?? []`/`?? 0` hides mandatory producer failure;
- single-flight/request coalescing prevents duplicate provider calls;
- cache size/TTL is bounded;
- no provider response object is mutated across consumers.

Specifically preserve the corrected `/options` market-state rule: only fresh authoritative `marketOpen === false` may show “Market is closed.”

---

# 13. Gate I — Scheduler, background-job and lifecycle safety

Inventory every production scheduler, interval, timeout, cron and startup side effect.

At minimum include project equivalents of:

- instruments refresh;
- scanner refresh;
- F&O signal generation/monitoring;
- F&O paper exits;
- Swing scan/stage/TTL sweep/monitoring;
- EOD reconciliation;
- pre/post daily reports;
- premium/option snapshots;
- market/clock diagnostics;
- Telegram alerts.

Required behavior:

- each scheduler registers once per intended process;
- imports in tests do not start real intervals;
- overlapping executions are prevented or idempotent;
- job claims are atomic where needed;
- timeouts/intervals are cleaned up on shutdown/test teardown;
- retries are bounded;
- failures are observable and do not stop unrelated jobs;
- market/date/holiday rules use IST;
- background jobs cannot bypass data/risk/market/live-order gates;
- repeated startup does not duplicate schedules;
- manual admin trigger and scheduled trigger cannot create duplicate business transitions;
- no scheduler creates provider-call storms.

Use fake timers and mocked external boundaries in tests.

---

# 14. Gate J — WebSocket and live-data resource management

Inspect the canonical Kite/Upstox WebSocket and live-data fan-out lifecycle where present.

Verify:

- one intended connection per account/provider/process policy;
- subscription sets are deduplicated;
- resubscription after reconnect is correct;
- exponential/bounded reconnect behavior;
- authentication expiry is surfaced and stops futile loops;
- malformed messages cannot crash the process;
- stale connection state becomes degraded;
- listeners are removed on shutdown/reconnect;
- heartbeats/timeouts are bounded;
- UI consumers use the canonical fan-out/cache rather than separate connections;
- no token or raw sensitive payload reaches logs/browser unexpectedly;
- test imports create no real socket.

If the architecture intentionally uses REST polling instead of WebSocket for a path, document that and verify its bounded polling behavior rather than introducing a new connection.

---

# 15. Gate K — Performance and data efficiency

Measure representative local/test execution without live-provider calls.

Identify objective release blockers such as:

- repeated identical provider calls;
- sequential full-universe fetches that should use bounded concurrency;
- N+1 database/provider calls;
- unbounded arrays/maps/caches;
- repeated heavy computation on React render;
- excessive refetch on focus/render;
- duplicate JSON parsing/normalization;
- oversized API payloads;
- missing pagination/virtualization for large histories;
- blocking synchronous work on request paths;
- memory/timer/listener leaks.

Correct confirmed material inefficiencies while preserving accuracy.

Do not introduce caching that compromises freshness or cross-tab equality.

For key pages/routes report before/after or final measured values for:

```text
request/provider call count
cache hit/coalescing behavior
payload size where material
render/query repetition
bounded concurrency/retry limit
```

Use practical personal-use budgets based on existing behavior. Do not invent arbitrary production SLAs without measurement.

---

# 16. Gate L — UI reliability, accessibility and responsive behavior

Preserve the accepted page behavior and test the critical integrated states using real production components.

Required state matrix:

```text
LOADING
READY_LIVE
READY_DELAYED
READY_STALE
READY_PARTIAL
EMPTY_VALID
DEGRADED
UNAVAILABLE
AUTH_EXPIRED
ERROR
MARKET_CLOSED
UNKNOWN_MARKET_STATE
```

Required UI behavior:

- no missing number becomes zero/green/up;
- no error becomes empty success or permanent skeleton;
- stale cached data remains visible with a warning;
- provider/source/asOf is understandable;
- retry actions work and are keyboard-accessible;
- important status is not communicated by colour alone;
- buttons/links have accessible names;
- form controls have labels;
- focus behavior is usable for dialogs/menus;
- loading/error/status messages use appropriate semantics where existing UI infrastructure supports it;
- narrow/mobile layouts do not hide critical trade/risk/P&L information;
- tables/cards handle long symbols/reasons without destructive overflow;
- confirmation is required for sensitive owner actions according to existing policy;
- no UI claims live execution while in paper/dry-run mode.

Do not redesign the visual system. Fix functional accessibility/responsiveness defects only.

---

# 17. Gate M — Observability, diagnostics and alert quality

Verify production diagnostics expose safe machine-readable status for:

- provider capabilities/session health;
- instrument-master freshness;
- market/session state;
- clock drift probe state;
- scheduler/job state;
- scanner partial/failure counts;
- F&O signal/admission/open/exit counts;
- Swing candidate/stage/approval/open/exit counts;
- cache/data freshness;
- system mode/degradation reasons;
- EOD reconciliation status.

Required behavior:

- diagnostics never expose secrets;
- `OK`, `WARN`, `ERROR`, `RECOVERED` severities are truthful;
- recovery alerts are distinct from incident alerts;
- dedup suppresses repeats but not recovery or different events;
- “all checks OK” never includes skipped checks without disclosure;
- action text is executable in the actual Replit/container environment;
- success events are not labelled warnings;
- alert counts/source data reconcile with diagnostics;
- clocks/timestamps use IST where user-facing.

Test alert formatter/dedup boundaries with mocked transport only.

---

# 18. Gate N — Integrated end-to-end user journeys

Build production-shaped tests through real routes/services/components with mocked external/store boundaries.

## Journey 1 — Session and provider readiness

```text
owner login/session
→ provider capability/session state
→ instruments/market readiness
→ global status banner/diagnostics
```

Prove ready, auth-expired, not-configured, degraded and recovery states.

## Journey 2 — Equity discovery and analysis

```text
Dashboard/Watchlist
→ Scanner
→ Stock/Index/Sector detail
→ Charts
→ Portfolio
```

Prove canonical identity, shared snapshot values and honest stale/error states.

## Journey 3 — Option research

```text
Option Chain/OI Lab
→ F&O signal context
→ contract identity/provenance
```

Prove display fallback cannot enter a tradeable path.

## Journey 4 — F&O lifecycle

```text
market/data readiness
→ signal tier
→ contract/plan
→ paper admission/open
→ monitoring/exit
→ P&L/history/report/alert
```

Prove identity and arithmetic parity through the entire cohort.

## Journey 5 — Swing lifecycle

```text
scan/candidate
→ signal/plan
→ atomic stage
→ review/approval
→ paper open
→ monitor/exit
→ P&L/history/report/alert
```

Prove duplicate/outside-hours/live-order protection.

## Journey 6 — Failure and recovery

```text
provider/session failure
→ degraded UI/diagnostics/alert
→ no unsafe trade transition
→ provider/session recovery
→ recovered state without duplicate alerts/actions
```

No test may contact a live provider, broker, Telegram or operational database.

---

# 19. Gate O — Release configuration and rollback readiness

Inspect production build/start/runtime configuration.

Verify:

- production entrypoints exist and match package scripts;
- environment-variable requirements are documented by name;
- startup fails safely for missing mandatory configuration;
- health/readiness endpoints represent actual readiness;
- graceful shutdown closes servers/sockets/timers;
- migrations are not run unexpectedly on every request/start unless explicitly designed;
- static assets/client routing are served correctly;
- source maps/logging follow production policy;
- live-order and DB-test locks remain safe;
- no development/test flag is enabled in production config;
- rollback target and steps are documented;
- no irreversible step is required merely to deploy the existing code;
- provider/session login requirements after restart are documented;
- post-deploy smoke tests are read-only until separately authorized.

Prepare a release runbook, but do not deploy.

---

# 20. Required tests

Add only load-bearing tests for confirmed gaps. Reuse accepted suites rather than cloning them.

At minimum the final test manifest must cover:

- navigation/route completeness;
- API/Zod/OpenAPI/client parity;
- auth/authorization;
- malicious/boundary inputs;
- secret/config redaction;
- rate limits/idempotency/expensive-route bounds;
- cache/freshness/single-flight;
- scheduler duplicate registration/overlap;
- WebSocket/polling resource cleanup;
- cross-tab canonical data equality;
- UI state/accessibility essentials;
- diagnostics/alert dedup/recovery;
- integrated F&O journey;
- integrated Swing journey;
- production startup/health/shutdown where locally testable.

Tests must invoke real production boundaries where practical. Pure helpers/source-regex may supplement but cannot replace behavior.

---

# 21. Final verification battery

## 21.1 Preserve accepted baselines

Preserve at minimum:

```text
api-server: 4,999 passing / 0 failing
scanner: 947 passing / 0 failing
```

New tests should increase appropriate totals. Reconcile exact increases.

## 21.2 Targeted suites

Run exact per-file results for:

- Pack 1/1A production UI guards;
- Pack 2/2A F&O lifecycle/boundaries;
- Pack 3/3A Swing lifecycle/boundaries;
- B0/B1.1 data/alert safeguards;
- new Pack 4 hardening tests.

Report per-file counts and a reconciled aggregate.

## 21.3 Full suites

Run:

- full API-server non-DB suite;
- full Scanner suite;
- all Global/web tests;
- all API Zod tests;
- all generated API client tests where present;
- all relevant shared-library ordinary tests.

Do not execute `.db.test.ts` files.

## 21.4 Typechecks

Run actual commands for:

- API server;
- API Zod;
- API client React;
- Scanner;
- Global/web;
- shared DB/library packages touched by the pack;
- workspace/root aggregate if configured.

## 21.5 Production builds

Run:

- API-server production build;
- Scanner production build;
- Global/web production build;
- workspace/root production build if it is a distinct configured target.

## 21.6 Integrity

Run:

- `git diff --check`;
- skip/only/retry audit;
- secret-path/name-only scan;
- direct-provider-call inventory;
- ordinary-test zero-DB/zero-live-network tripwire;
- dependency-lock consistency check;
- static confirmation of live-order hard blocks.

No test may rely on arbitrary sleeps or a hardcoded date that becomes stale.

---

# 22. Final release evidence

Create:

```text
artifacts/audit-evidence/FAST_TRACK_PACK_4_FINAL_HARDENING_AND_RELEASE_READINESS.md
```

It must contain:

1. final verdict;
2. frozen-pack inventory and baselines;
3. release-blocker defect matrix and fixes;
4. navigation/route manifest result;
5. canonical cross-tab data result;
6. API/schema/client result;
7. auth/security/input-validation result;
8. secrets/configuration result;
9. cache/scheduler/WebSocket/performance result;
10. UI/accessibility result;
11. diagnostics/alerts result;
12. integrated journey results;
13. exact targeted/full test totals;
14. typecheck/build results;
15. exact changed-file inventory;
16. Git start/end state and platform auto-commit chronology;
17. confirmation of no manual commit, push, deploy, DB or live-order action;
18. provider activation status;
19. production deployment status;
20. SHA-256 after final write.

The final nonblank line must be exactly:

```text
END_FAST_TRACK_PACK_4_FINAL_HARDENING_AND_RELEASE_READINESS
```

It must occur exactly once.

---

# 23. Owner/operator release runbook

Create:

```text
artifacts/audit-evidence/MARKET_SCANNER_OWNER_RELEASE_AND_ROLLBACK_RUNBOOK.md
```

The runbook must be concise, redacted and executable. Include:

- required secret/configuration names only;
- provider/session prerequisites;
- pre-deploy checklist;
- exact build/start commands;
- read-only health/readiness checks;
- authentication smoke test;
- navigation smoke matrix;
- canonical-data parity smoke checks;
- F&O paper-only smoke test that cannot place a live order;
- Swing paper/dry-run smoke test that cannot place a live order;
- alert/diagnostic smoke test using safe method;
- log/metric checks;
- failure/rollback criteria;
- exact rollback procedure using known safe deployment mechanics;
- post-rollback verification;
- explicit prohibition on destructive SQL, live orders and credential disclosure;
- distinction between code readiness and provider activation.

Use exactly one terminator as the final nonblank line:

```text
END_MARKET_SCANNER_OWNER_RELEASE_AND_ROLLBACK_RUNBOOK
```

Do not deploy while writing or validating the runbook.

---

# 24. Acceptance and pending external items

The following owner/external items do not block code readiness when honestly reported:

- Upstox account/API activation and parity validation;
- IndianAPI subscription/key activation and endpoint validation;
- controlled Yahoo retirement after replacement coverage;
- isolated DB-test infrastructure deferred by owner;
- operational residue cleanup requiring separate authorization;
- actual production deployment and post-deploy smoke verification.

They must remain clearly marked:

```text
PROVIDER_ACTIVATION_PENDING
PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED
```

Kite-first functionality must remain usable without fabricating the optional providers.

---

# 25. Required final response

Return a concise release-readiness report—not an execution diary—with:

1. Verdict.
2. Release-blocker fixes.
3. Navigation and integrated journeys.
4. Canonical data consistency.
5. API/schema/client status.
6. Security/auth/secrets status.
7. Performance/cache/scheduler/WebSocket status.
8. UI/accessibility/diagnostics status.
9. Exact test totals.
10. Typecheck/build results.
11. Git/evidence/runbook integrity.
12. External pending items.
13. Production status.

The only successful code-readiness verdict is:

```text
ACCEPT_FAST_TRACK_PACK_4_FINAL_HARDENING_AND_RELEASE_READINESS
```

Use it only when Gates A–O pass and no in-scope release blocker is deferred.

If a genuine owner-controlled blocker prevents code readiness, return:

```text
BLOCKED_FAST_TRACK_PACK_4_FINAL_HARDENING_AND_RELEASE_READINESS
```

with the exact gate, production impact and minimum owner action. Complete all independent work before stopping.

On successful acceptance, also report:

```text
CODEBASE_READY_FOR_OWNER_DEPLOYMENT_DECISION
PROVIDER_ACTIVATION_PENDING
PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED
```

Stop after the report. Do not deploy, activate providers, modify production data or begin another development pack.
