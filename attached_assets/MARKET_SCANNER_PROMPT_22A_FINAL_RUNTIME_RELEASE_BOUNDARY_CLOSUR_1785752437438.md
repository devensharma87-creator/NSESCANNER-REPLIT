# MARKET SCANNER — PROMPT 22A

## Final Runtime Release-Boundary Closure

### Instruction to the Replit coder

Prompt 22 reported:

```text
Pack 4 new tests: 118
api-server: 5,117 passing
scanner: 947 passing
five package typechecks: clean
```

Preserve these results.

Do not deploy yet. The submitted release-readiness verdict cannot be accepted because:

1. Auth test D12 received HTTP 500 and was replaced with a source-text assertion. A production authorization path returning 500 is not an acceptable runtime proof, even if the failure is caused by an incomplete test mock.
2. Several Pack 4 tests were converted from executable behavior into source-text scans. Source scans can supplement but cannot prove runtime authentication, route ordering, configuration rejection, scheduler behavior, client-secret exclusion or broker hard blocks.
3. The final report does not show the three production builds, exact Pack 3A lineage, Git/SHA integrity or the full owner release-boundary evidence required before publishing.

Current status:

```text
PACK_4_NOT_ACCEPTED — RUNTIME_RELEASE_BOUNDARY_CLOSURE_PENDING
```

This is one final, narrowly bounded runtime closure. Do not reopen feature audits, add features, change strategies or start provider activation.

No manual commit, push, pull, fetch, publish or deployment is authorized.

Do not connect to PostgreSQL, execute `.db.test.ts`, run Prompt 15 or change `DB_TEST_RUNTIME_AUTHORIZED`.

Do not contact Kite, Upstox, IndianAPI, Yahoo, Telegram or any live external service from tests.

---

# 1. Execution sequence

Use this sequence only:

1. Reconcile Pack 3A and Pack 4 test-count lineage.
2. Replace the D12 source proof with a real registered-route authorization test.
3. Convert security-critical source-only checks into executable runtime/bundle proofs.
4. Execute one mocked end-to-end owner journey through registered production routes.
5. Run the complete final test/typecheck/build battery once.
6. Update the existing Pack 4 evidence and owner runbook.
7. Return the final owner-decision verdict and stop.

Do not perform another broad codebase inventory.

Fix only defects exposed by these release-boundary tests.

Do not weaken a failing runtime assertion into source inspection, a broader accepted status code or a trivial truth assertion.

---

# 2. Frozen platform behavior

Preserve:

- Pack 1 website/UI/data-state fixes;
- Pack 2 F&O lifecycle and its final closure;
- Pack 3 Swing lifecycle and its final closure;
- canonical Kite-first data backbone;
- Upstox controlled-secondary policy;
- IndianAPI enrichment-only policy until configured;
- Yahoo exclusion from trade decisions;
- authentication/authorization policy;
- market-session, stale/future data and provenance controls;
- F&O and Swing strategy formulas, thresholds and risk rules;
- immutable plans and atomic staged-order behavior;
- paper-only/live-order hard blocks;
- gross/net/charges/STT separation;
- alert deduplication;
- zero-database-connection ordinary-test protection;
- production deployment status as unverified.

Do not add providers, credentials, dependencies, migrations, strategies, routes or UI features unless a missing runtime safety boundary requires a narrowly targeted existing-route correction.

---

# 3. Gate 0 — Release lineage and baseline reconciliation

Before modifying anything, reconcile these observed baselines:

```text
Pack 3 initial close: api-server 4,916; scanner 930
Pack 4 stated starting baseline: api-server 4,999; scanner 947
Pack 4 final: api-server 5,117; scanner 947
```

The unexplained intervening increase is:

```text
api-server: +83
scanner: +17
combined: +100
```

Determine whether these 100 tests are the Prompt 21A final Swing closure.

Provide:

- exact Prompt 21A test filenames and counts;
- exact production changes, especially the atomic staged-order invariant;
- final Prompt 21A verdict;
- evidence terminator and SHA if recorded;
- confirmation that no in-scope Swing defect remained deferred;
- exact commit/working-tree chronology explaining when the 100 tests entered the baseline.

Then reconcile Pack 4:

```text
29 + 16 + 18 + 16 + 20 + 19 = 118
4,999 + 118 = 5,117
```

If the 100-test Swing closure is not actually present or did not receive the required final verdict, do not claim release readiness. Complete only the missing runtime evidence authorized by Prompt 21A, then proceed with the remaining gates.

Do not re-run the full Swing audit.

---

# 4. Gate 1 — Real authentication and authorization boundaries

## 4.1 Correct D12 properly

Identify the exact D12 registered route, middleware chain and reason it returned HTTP 500.

Configure a complete deterministic test harness by mocking the subscriber/owner validity repository or entitlement service at its real boundary. Do not connect to a database.

The test must invoke the real registered route and middleware—not call a helper in isolation and not read source text.

HTTP 500 is never an acceptable authorization outcome.

## 4.2 Required identity matrix

Test actual production middleware for:

| Identity | Read route allowed by policy | Restricted tab read | Owner mutation | Expected result |
|---|---|---|---|---|
| anonymous, private mode | no | no | no | 401/redirect according to existing API policy |
| anonymous, public/shared mode | only explicitly public safe GET | no | no | 200 only for allowlisted safe read; mutation still 401/403 |
| authenticated user without entitlement | base authenticated route only | no | no | 403 on restricted tab |
| entitled subscriber | subscribed tab read | according to policy | no | 200 read; 403 owner mutation |
| owner | all owner-authorized reads | yes | yes | 200/expected mutation status |
| malformed/expired/tampered cookie | no | no | no | 401; never 500 |

At minimum cover real routes representing:

- core dashboard/read;
- F&O restricted read;
- Swing restricted read;
- owner-only settings/admin mutation;
- staged-order approval/rejection mutation;
- any public shared-link read path.

## 4.3 Public-mode boundary

The statement “`requireOwner` bypasses anonymous GET in public mode by design” must be verified against intended middleware ownership.

Prove:

- only explicitly intended safe GET routes are public;
- public mode does not expose owner/admin/secrets/configuration/trade mutation data;
- method override, query parameters and alternate path forms cannot turn a mutation into a public read bypass;
- POST/PUT/PATCH/DELETE always require the documented identity;
- F&O/Swing trading or approval mutations remain protected;
- sensitive personal portfolio/trade history is not made public unless explicitly intended and documented.

If `requireOwner` itself globally bypasses every GET rather than a narrow public-read middleware, classify the exposed routes. Correct the boundary to an explicit allowlist if any sensitive owner-only GET can be reached anonymously.

## 4.4 Error semantics

Prove auth failures return stable 401/403 responses and sanitized bodies. Repository/entitlement failure must return a sanitized 503/500 according to the existing error contract—not grant access and not expose internals.

Do not broaden assertions to “one of 200/401/403/500.” Each test must assert the exact intended outcome.

---

# 5. Gate 2 — Executable input, routing and error boundaries

Invoke the real Express application/registered routers with mocked service boundaries.

Prove:

- malformed JSON returns 400;
- oversized payload follows the configured safe rejection status;
- invalid path/query/body Zod input returns the production validation status and sanitized details;
- unknown route returns 404;
- thrown route error reaches the error middleware and returns sanitized 500;
- 404 middleware is ordered after routes and before the terminal error handler as required by Express semantics;
- error handler never turns 404 into 500 or leaks stack/SQL/secret text;
- authentication middleware runs before protected handler mutation;
- rate limits apply to the intended sensitive routes;
- proxy/IP trust configuration matches the deployment topology and cannot be spoofed trivially;
- CORS permits configured production origins and rejects unauthorized origins;
- preflight/OPTIONS behavior is correct;
- security headers are present according to existing middleware.

Source-order scans may document wiring, but every critical status must also be observed through a runtime HTTP request.

No live network or database is permitted.

---

# 6. Gate 3 — Runtime production-configuration rejection

Test configuration through the real production config/bootstrap boundary in an isolated child process or module context.

Use fake sentinel values only. Never read or print actual secrets.

Required cases:

- production startup with `CORS_ORIGINS=*` fails before listening;
- missing `SESSION_SECRET` fails according to policy;
- weak/default session secret fails if the existing policy requires strength;
- missing `APP_ACCESS_PASSWORD` follows the documented public/private deployment policy;
- missing `KITE_API_KEY`/`KITE_API_SECRET` produces explicit provider-unavailable behavior without crashing unrelated pages;
- missing `KITE_TOKEN_ENC_KEY` blocks unsafe token persistence/decryption according to policy;
- malformed encryption key is rejected;
- unknown/contradictory Swing execution settings fail closed to paper-only/no live order;
- production/test environment mix-ups do not enable DB tests or live transports;
- config errors do not echo secret values.

Do not satisfy these only by checking that constant names exist in source.

---

# 7. Gate 4 — Client-secret and bundle leakage proof

Source text proving the client does not access `process.env` is useful but insufficient. Prove the actual production bundles.

## 7.1 Sentinel build

Run the Global/web and Scanner production builds with unique fake sentinel values for server-only secret names, including project equivalents of:

```text
SESSION_SECRET
APP_ACCESS_PASSWORD
KITE_API_SECRET
KITE_TOKEN_ENC_KEY
TELEGRAM_BOT_TOKEN
DATABASE_URL
TEST_DB_PROVISIONING_URL
```

Do not use real values.

Scan generated JavaScript, CSS, HTML, manifest and source-map artifacts for the unique sentinel values.

Required result:

```text
zero sentinel-value matches in browser-delivered artifacts
```

Distinguish harmless UI label strings such as `KITE_API_SECRET` from actual secret-value inclusion. A source file containing the label is not itself a leak; a built bundle containing the fake secret value is.

## 7.2 Runtime config endpoint

Invoke any public/system/config/diagnostics endpoint and prove it returns capability/presence state only—never credential values, encrypted tokens, connection strings or internal stack information.

---

# 8. Gate 5 — Broker/live-order hard block

Execute the real production Swing/F&O broker-admission and transport boundary with mocked transports under an environment matrix.

Required combinations include:

```text
LIVE_CASH_SWING_ORDER_ENABLED unset / false / true
SWING_CASH_EXECUTION_MODE unset / paper_only / dry_run / any unsupported value
deployment and development modes
owner-approved staged order
valid market/data/risk gates
```

Prove:

- unsupported or missing values fail closed;
- `paper_only` cannot invoke order placement;
- hard-disabled broker execution cannot be bypassed by environment settings;
- owner approval alone cannot invoke a live order;
- a fully valid staged order still uses paper/dry-run outcome under the current code policy;
- Kite order transport spy remains at zero calls;
- Upstox or another broker transport remains at zero calls;
- UI/API/Telegram never claims a live execution;
- configuration response states that live execution is disabled without exposing secrets.

Source proof that `brokerExecutionEnabled` is always false may supplement the runtime spy; it cannot replace it.

---

# 9. Gate 6 — Scheduler, cache and single-flight runtime behavior

Use fake timers and mocked job/provider/store boundaries to execute the real scheduler/cache registration code.

Prove:

- importing/initializing the application twice does not register duplicate schedules;
- overlapping ticks cannot run the same protected job concurrently where a claim/lock exists;
- a job failure is recorded/reported and does not crash the scheduler loop;
- a later successful run can recover after failure;
- schedule times use IST and expected trading-day rules;
- weekends/holidays follow the existing policy;
- cache keys include required symbol/source/timeframe/session dimensions;
- stale/future/degraded cache entries remain labelled and cannot become fresh through read;
- cache invalidation does not mix sessions/providers;
- partial producer results are not cached as complete success;
- request coalescing returns one provider call for concurrent identical reads;
- failure does not poison the cache as successful empty/zero;
- cleanup intervals/timers are bounded and do not keep ordinary test workers hanging.

Do not replace dynamic runtime checks with regex/source scans unless module side effects make direct import unsafe; in that case extract/use an existing pure registration factory rather than weakening the assertion.

---

# 10. Gate 7 — Mocked production owner journeys

Run integrated journeys through the real HTTP application and production components/services with mocked external/store boundaries.

## 10.1 Read journey

Prove an authorized owner can access representative:

- Dashboard/Market Pulse;
- Watchlist/Scanner;
- Portfolio/Stock Detail/Charts;
- Option Chain/F&O;
- Swing;
- Paper Trading/History/Reports;
- system diagnostics.

Responses must be production-schema-valid and use one canonical snapshot/source contract.

## 10.2 F&O safety journey

Use one deterministic fixture to prove:

```text
canonical data
→ signal
→ admission
→ paper open
→ monitor
→ close
→ P&L/report
```

No live order or provider call is permitted.

## 10.3 Swing safety journey

Use one deterministic fixture to prove:

```text
candidate
→ immutable plan
→ atomic stage
→ owner approval
→ market/session gate
→ paper open
→ monitor
→ close
→ P&L/report
```

Include concurrent duplicate staging and prove one active stage.

## 10.4 Failure journeys

Prove:

- expired/tampered session does not return 500;
- provider unavailable shows degraded/unavailable state;
- stale/future data cannot become tradeable/open;
- failed persistence does not emit false OPEN/CLOSE alerts;
- malformed input returns 400;
- unauthorized mutation returns 401/403;
- unknown route returns 404;
- internal error is sanitized.

Source-text route manifests may prove inventory completeness but cannot replace these journeys.

---

# 11. Verification battery

## 11.1 Preserve baselines

Preserve at minimum:

```text
Prompt 21A reconciled baseline: api-server 4,999; scanner 947
Prompt 22 new tests: 118/118
Prompt 22 final baseline: api-server 5,117; scanner 947
```

New Prompt 22A runtime tests should increase the appropriate totals. Reconcile the exact increase.

Do not delete, skip, quarantine or weaken existing tests.

## 11.2 Targeted files

Run and report exact per-file results for:

- all six Prompt 22 files;
- new Prompt 22A runtime authorization tests;
- config/bootstrap tests;
- bundle-leak tests;
- broker hard-block tests;
- scheduler/cache tests;
- integrated journey tests;
- relevant Pack 1, Pack 2 and Pack 3 closure boundary tests.

## 11.3 Full suites

Run:

- full API-server non-DB suite;
- full Scanner suite;

- affected Global/web component suite;
- all Prompt 22/22A targeted tests.

Do not execute `.db.test.ts` files.

## 11.4 Typechecks

Run actual commands for:

- API server;
- API Zod;
- API client React;
- Scanner;
- Global/web;
- relevant shared/database library if touched.

## 11.5 Production builds

Run and report exact commands/results for:

- API-server production build;
- Scanner production build;
- Global/web production build.

The sentinel secret-leak build may satisfy the Scanner/Global build requirement if it uses the real production build command and clean fake environment.

## 11.6 Integrity

Run `git diff --check` and prove no new:

- `.skip`, `.only`, retries or quarantine;
- arbitrary sleeps;
- broadened status assertions accepting 500;
- source-only replacement for required runtime proof;
- live provider/Telegram/broker calls;
- PostgreSQL connections in ordinary tests;
- real secret values in logs/artifacts/evidence;
- direct provider calls from UI;
- Yahoo data in trading decisions;
- null-to-zero fabrication;
- unrelated strategy, migration, dependency or feature changes.

---

# 12. Evidence and owner runbook

Update the existing files only:

```text
artifacts/audit-evidence/FAST_TRACK_PACK_4_FINAL_HARDENING_AND_RELEASE_READINESS.md
artifacts/audit-evidence/MARKET_SCANNER_OWNER_RELEASE_AND_ROLLBOOK_RUNBOOK.md
```

## 12.1 Evidence additions

Add a final runtime-closure section containing:

1. Pack 3A/Pack 4 baseline reconciliation;
2. D12 root cause and real runtime correction;
3. exact auth/public-mode route matrix;
4. runtime input/404/error/CORS/rate-limit results;
5. configuration rejection results;
6. client sentinel bundle-scan results;
7. broker transport zero-call results;
8. scheduler/cache runtime results;
9. F&O and Swing mocked owner journeys;
10. targeted/full-suite totals;
11. typecheck/build results;
12. exact changed/new/deleted file inventory;
13. starting/final observed HEAD;
14. branch/upstream/ahead-behind without fetching;
15. tracked/staged/untracked status;
16. platform auto-commit chronology;
17. confirmation of no manual commit, push, deploy, DB or live external action;
18. evidence SHA-256;
19. production status.

The final nonblank line must be exactly:

```text
END_FAST_TRACK_PACK_4_FINAL_RUNTIME_RELEASE_BOUNDARY_CLOSURE
```

It must occur exactly once.

## 12.2 Owner runbook corrections

Ensure the runbook contains:

- exact required secret names, never values;
- public/private access-mode decision and exposure warning;
- exact CORS origin format;
- Kite daily session/login procedure;
- provider capability expectations;
- pre-publish typecheck/build/test commands;
- deployment health checks;
- representative UI/API smoke checks;
- F&O and Swing paper-only verification;
- Telegram test procedure that cannot create a trade;
- rollback trigger conditions;
- rollback/redeploy steps compatible with the platform;
- post-rollback verification;
- statement that Upstox/IndianAPI activation is separate and pending;
- statement that live broker execution remains disabled;
- statement that external isolated DB execution remains deferred.

The final runbook terminator must remain correct and occur exactly once.

Do not claim production smoke testing occurred. No deployment is authorized in this prompt.

---

# 13. Required final response

Return a concise runtime closure report—not an execution diary—with:

1. Verdict.
2. Pack 3A/Pack 4 baseline reconciliation.
3. D12 authorization result.
4. Public/private route-access matrix.
5. Runtime config/input/error/CORS results.
6. Client-bundle secret scan.
7. Broker zero-call proof.
8. Scheduler/cache runtime result.
9. F&O/Swing owner journeys.
10. Exact test totals.
11. Typecheck/build results.
12. Git/evidence/runbook integrity.
13. Remaining owner actions.
14. Production status.

The only successful verdict is:

```text
ACCEPT_FAST_TRACK_PACK_4_FINAL_HARDENING_RUNTIME_VERIFIED
```

Use it only when every Gate 0–7 passes, no required runtime assertion accepts HTTP 500, and no source-only test substitutes for required executable proof.

On success, report readiness only as:

```text
CODEBASE_READY_FOR_OWNER_DEPLOYMENT_DECISION
PROVIDER_ACTIVATION_PENDING
PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED
```

If a genuine blocker remains, return:

```text
BLOCKED_FAST_TRACK_PACK_4_FINAL_RUNTIME_RELEASE_BOUNDARY
```

with the exact runtime boundary, failing assertion, production impact and minimum owner action. Complete all independent gates before returning the blocker.

Do not deploy, publish, push or activate providers after acceptance. Stop for the owner's separate deployment decision.
