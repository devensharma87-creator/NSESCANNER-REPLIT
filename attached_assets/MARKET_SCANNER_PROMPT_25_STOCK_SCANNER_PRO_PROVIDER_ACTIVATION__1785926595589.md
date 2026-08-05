# STOCK SCANNER PRO — PROMPT 25

## Provider Activation, Shadow Parity and Canonical Cross-Tab Data Finalization

### Starting status

`ACCEPT_FAST_TRACK_PACK_6_PROFESSIONAL_UI_UX_REFINEMENT`

Pack 6 is closed for Stock Scanner Pro. Do not reopen it.

The only project in scope is **Stock Scanner Pro**. Global Multi Asset Scanner and `artifacts/global` remain `SEPARATE_PROJECT — FROZEN`.

This phase activates and validates the already-built provider backbone without compromising data accuracy or changing trading decisions.

---

## 1. Objective

Deliver one canonical, professional-grade data root across Stock Scanner Pro:

- **Kite** remains the authoritative primary source for live prices, trade-grade candles, F&O signalling and paper-trade admission.
- **Upstox** is activated initially in shadow mode for independent parity and resilience measurement; it must not alter canonical outputs during this phase.
- **IndianAPI** is activated only for its documented reference/fundamental capabilities; it must not supply trade-grade prices or signals.
- **Yahoo** remains analytics/display-only and must always be labelled delayed/non-trade-grade. Do not remove it until every dependent analytics path has an approved replacement.

Every tab must consume the same canonical facade for the same data domain. Direct page-level/provider-level fetching, silent substitution, averaging and source-dependent discrepancies are prohibited.

---

## 2. Non-negotiable scope and safety rules

1. Stock Scanner Pro only. Do not touch, test, build or count Global Multi Asset Scanner.
2. Do not change F&O or swing strategy formulas, thresholds, weights, vetoes, entries, stops, targets, position sizing or paper ledgers.
3. Do not enable broker order execution or call any order-placement endpoint.
4. Provider calls in this phase are read-only market-data/reference requests only.
5. Kite remains canonical throughout this phase. Upstox cannot replace, blend with or modify a returned Kite value.
6. IndianAPI cannot enter a live quote, candle, option-chain, signal, risk, P&L or trade-admission path.
7. Yahoo cannot be labelled live and cannot enter trade-grade admission.
8. Never output, log, screenshot, persist in evidence or commit a credential value.
9. Do not create another provider architecture. Use and harden the Pack 5 backbone already implemented.
10. Do not provision a database, clean operational rows, deploy, publish, push, pull or fetch.
11. Do not reopen accepted A0.3, Fast-Track Pack 1 or Pack 6 tasks merely because they remain visible in a stale task queue.
12. Use one bounded implementation pass and a finite parity observation plan; do not start an indefinite audit loop.

---

## 3. Step 1 — Project, Git and evidence preflight

Before editing, record:

- `PROJECT_IDENTITY_CONFIRMED — STOCK_SCANNER_PRO`;
- timestamp, HEAD, branch, upstream and ahead/behind from existing refs without fetching;
- working-tree and index state;
- exact provider-related files currently present;
- exact Pack 5/23A/23B/23C tests and evidence status;
- confirmation that `artifacts/global` has no new diff.

Resolve one documentation inconsistency read-only:

The Pack 6 evidence task reported that the evidence file was appended while also reporting unchanged HEAD and a clean working tree. Determine the actual Git explanation using `git status`, `git diff`, `git log` and blob identity. Correct only the evidence chronology if necessary. Do not manufacture a clean state and do not commit.

If HEAD changes unexpectedly during this task, follow the existing governance rule: inspect the exact intervening range and stop on production/test changes not authorized by this prompt.

---

## 4. Step 2 — Redacted provider configuration gate

Read the production configuration resolvers and report the exact accepted environment-variable names and enum values from source. Do not guess names from earlier reports.

For each provider return only:

- configured: yes/no;
- auth mode;
- plan/capability state;
- selected hostname as a hostname only;
- token/key expiry metadata if exposed without revealing the token;
- last successful probe time;
- circuit-breaker state.

Required validation:

### Kite

- API key configured;
- valid session/access token available;
- session freshness and expiry handled honestly;
- canonical provider state is `AVAILABLE` only after a safe read-only probe succeeds.

### Upstox

- use the exact supported token variables from `upstoxClient.ts`;
- prefer the configured analytics/read-only mode where supported;
- instrument BOD mapping passes the existing NIFTY/BANKNIFTY/SENSEX and equity mapping validation;
- no order permission is requested or exercised.

### IndianAPI

- use the exact key and plan variables from `indianApiClient.ts`;
- plan-to-host resolution must match the accepted documented allowlist already closed in Prompt 23B;
- invalid plan or host must fail with `INVALID_PROVIDER_CONFIG` and make zero fetch calls;
- use only the documented `/stock?name=` contract unless source documentation already in the repository proves another endpoint.

If a required credential is absent, do not roam into unrelated code. Return:

`BLOCKED — OWNER_PROVIDER_CREDENTIALS_REQUIRED`

and list only the missing secret names and the safe owner action. Never ask the owner to paste a value into chat.

---

## 5. Step 3 — Canonical domain policy

Create or verify one executable provider-policy matrix covering every data domain:

| Domain | Canonical | Shadow/reference | Allowed fallback | Trade-grade rule |
|---|---|---|---|---|
| Equity quote | Kite | Upstox shadow | Explicit delayed display only | Kite required |
| Index quote | Kite | Upstox shadow | Explicit delayed display only | Kite required |
| Equity candles | Kite | Upstox shadow | Yahoo analytics delayed | Kite required for signals |
| Index candles | Kite | Upstox shadow where supported | Yahoo analytics delayed | Kite required for signals |
| Option chain | Kite trusted facade | parity observation only if supported | display-only NSE path | trusted Kite required |
| Fundamentals/profile | Canonical API route | IndianAPI reference | honest unavailable | never trade-grade |
| News/reference | existing canonical route | IndianAPI only if documented | delayed/reference | never trade-grade |

Do not assume a provider capability. Derive it from implemented/documented endpoints and expose `UNSUPPORTED`, `NOT_CONFIGURED`, `AUTH_EXPIRED`, `RATE_LIMITED`, `DEGRADED` or `UNAVAILABLE` honestly.

Add a load-bearing test proving that an absurd Upstox shadow value cannot change any canonical return value, signal input, paper-trade input, UI quote or serialized API response.

---

## 6. Step 4 — Complete cross-tab consumer inventory

Inventory every Stock Scanner Pro route and backend consumer that reads:

- quote/LTP/change;
- candles/OHLC/volume;
- option chain/OI/IV;
- fundamentals/profile;
- market status/time;
- provenance/freshness.

For every consumer record:

| Consumer | Domain | Canonical facade | Direct provider import | Cache key | Provenance rendered | Trade impact |
|---|---|---|---|---|---|---|

Requirements:

- no Scanner page may import Kite, Upstox, IndianAPI, Yahoo or NSE transports directly;
- the same symbol/domain must resolve through the same canonical service across Dashboard, Watchlist, Stock Detail, Charting, Portfolio, Scanner, F&O and Swing;
- identical canonical data must carry identical `source`, `asOf`, freshness and fallback metadata across tabs;
- cache keys must include every result-changing parameter;
- errors cannot overwrite last-good data;
- no `?? 0` or equivalent may fabricate missing market data.

Fix only confirmed bypasses or parity defects.

---

## 7. Step 5 — Upstox shadow activation

Activate the existing Upstox shadow dispatch behind a server-side configuration state.

Required behavior:

1. Canonical Kite response returns immediately; shadow work is fire-and-forget and bounded.
2. Shadow timeout, rate limit, auth failure and circuit-breaker state are recorded without affecting the caller.
3. Instrument mapping is validated before a request.
4. Shadow samples store only non-secret comparison metadata.
5. No price averaging, fallback substitution or signal input occurs.
6. A shadow failure never marks canonical Kite data unavailable.
7. A canonical Kite failure still fails trade-grade paths closed; Upstox is not silently promoted in this phase.

Expose owner-only diagnostics for:

- activation state;
- auth mode;
- mapping state;
- sample count;
- success/missing/error/rate-limit counts;
- latency distribution;
- timestamp skew;
- price/candle divergence distribution;
- circuit-breaker status;
- last sample time.

No credential material may appear.

---

## 8. Step 6 — Finite live parity observation

If both Kite and Upstox are configured, run a bounded read-only shadow observation during market hours.

### Instrument cohort

At minimum:

- NIFTY 50;
- NIFTY BANK;
- SENSEX where both providers support a verified mapping;
- RELIANCE;
- HDFCBANK;
- one additional liquid NSE equity selected from the verified instrument master.

Do not fabricate support for an index unavailable from one provider; classify it honestly.

### Time coverage

Collect samples across one complete trading session or, when started mid-session, across these three finite windows on the next available session:

- opening stabilization: `09:20–10:00 IST`;
- mid-session: `11:30–13:30 IST`;
- closing period: `14:30–15:25 IST`.

Use a rate-limit-safe cadence. Do not block the request path or exhaust provider quotas.

### Metrics

For synchronized comparable observations report:

- sample count and coverage rate;
- missing/error/rate-limit rate;
- provider `asOf` and receive-time skew;
- absolute and basis-point LTP divergence;
- median, p95, p99 and maximum divergence;
- OHLC divergence for matching candle interval/time;
- candle gaps/duplicates/out-of-order timestamps;
- response latency median/p95/p99;
- stale/future timestamp count;
- mapping mismatch count.

Do not invent a universal tolerance that ignores tick size, instrument type or timestamp skew. Propose instrument/domain-specific promotion thresholds from observed distributions and documented exchange/provider precision. Upstox remains shadow until a later explicit owner promotion decision.

If the market is closed, complete activation/tests and return:

`PROVIDER_ACTIVATION_COMPLETE — LIVE_PARITY_OBSERVATION_PENDING_MARKET_SESSION`

with the exact finite observation command/process. Do not generate fake market-session evidence.

---

## 9. Step 7 — IndianAPI activation and entitlement proof

Using the canonical server-side fundamentals route:

- probe a small bounded cohort such as RELIANCE, HDFCBANK and TCS;
- verify the request uses the resolved allowlisted host and `x-api-key` server-side only;
- validate the documented `/stock?name=` response at the provider adapter and production route boundary;
- report populated, null, unavailable and warning fields honestly;
- verify cache TTL, retry/backoff, rate-limit and circuit-breaker behavior;
- verify client responses contain no key, provider host internals or raw upstream payload;
- verify all Stock Detail/Fundamentals consumers use the canonical route, not direct IndianAPI calls.

IndianAPI is reference/fundamental data only in this phase. Add negative tests proving it cannot enter quote, candle, option-chain, signal, veto, entry, stop, target, P&L or paper-admission paths.

---

## 10. Step 8 — Cross-tab parity and provenance proof

For the same symbol and observation snapshot, test the relevant APIs/components used by:

- Dashboard/Home;
- Watchlist;
- Stock Detail;
- Charting;
- Portfolio Analyser;
- Scanner/Screener;
- F&O and Option Chain;
- Swing views.

Prove:

- canonical price values agree where the domain/time is identical;
- any difference is explained by interval, timestamp or domain—not by different hidden providers;
- provenance labels match response metadata;
- stale/delayed/partial/unavailable states are consistent;
- no tab promotes shadow/reference data;
- trade-grade F&O and swing paths still require their accepted authoritative inputs.

Add executable cross-tab tests against real canonical facades and route serializers, not source-string checks alone.

---

## 11. Step 9 — Diagnostics and UI

Use the existing owner-only provider diagnostics surfaces. Add only missing fields required to understand activation/parity.

The UI must display:

- canonical provider per domain;
- shadow/reference provider state;
- configured/auth-expired/rate-limited/degraded status;
- last successful sample;
- freshness and parity summary;
- an explicit statement that Upstox shadow and IndianAPI reference data do not influence trading decisions.

Do not add another dashboard or redesign Pack 6 UI.

---

## 12. Step 10 — Load-bearing tests

Add tests covering at minimum:

1. secret absence and invalid-config fail-closed behavior;
2. valid Upstox auth modes without exposing token values;
3. instrument mapping success/failure;
4. Kite canonical result immutability under absurd shadow output;
5. shadow timeout/error/rate-limit/circuit breaker non-interference;
6. no shadow promotion on Kite failure;
7. IndianAPI plan/host allowlist and `/stock?name=` contract;
8. IndianAPI exclusion from all trade-grade domains;
9. cross-tab canonical equality and provenance consistency;
10. delayed Yahoo honesty;
11. future/stale timestamp fail-closed behavior;
12. diagnostics serialization with no credentials;
13. no direct provider transport imports in Scanner pages;
14. F&O and swing admission/exit safety regressions;
15. zero broker-order calls and zero DB mutation.

Do not add `.skip`, `.only`, arbitrary sleeps or retries that hide failures.

---

## 13. Step 11 — Closing battery

Run and report exact commands/results:

- all new Prompt 25 tests;
- Pack 5 provider tests;
- Pack 4 security/runtime tests;
- Pack 2 F&O lifecycle tests;
- Pack 3 swing lifecycle tests;
- Scanner full suite: floor `1,112` plus additions;
- API-server full non-DB suite: floor `5,603` plus additions;
- API server, API Zod, API client React and Scanner typechecks;
- API-server and Scanner production builds;
- `git diff --check`;
- skip/only/retry/sleep audit;
- client/server secret sentinel scan;
- zero broker order and zero operational DB mutation proof;
- `DB_TEST_RUNTIME_AUTHORIZED` unchanged;
- `artifacts/global` unchanged.

---

## 14. Evidence file

Create:

`artifacts/audit-evidence/FAST_TRACK_PACK_7_PROVIDER_ACTIVATION_SHADOW_PARITY_AND_CROSS_TAB_FINALIZATION.md`

Include:

1. project/Git preflight and Pack 6 chronology correction;
2. redacted configuration matrix;
3. provider-domain policy;
4. consumer inventory;
5. activation results;
6. live parity observation or exact pending-market status;
7. IndianAPI entitlement results;
8. cross-tab parity results;
9. diagnostics/API/UI changes;
10. tests/typechecks/builds;
11. secret and safety proof;
12. Git integrity and SHA-256.

Final nonblank line:

`END_FAST_TRACK_PACK_7_PROVIDER_ACTIVATION_SHADOW_PARITY_AND_CROSS_TAB_FINALIZATION`

It must occur exactly once.

---

## 15. Verdict rules

Use exactly one:

- `BLOCKED — OWNER_PROVIDER_CREDENTIALS_REQUIRED`
- `PROVIDER_ACTIVATION_COMPLETE — LIVE_PARITY_OBSERVATION_PENDING_MARKET_SESSION`
- `ACCEPT_FAST_TRACK_PACK_7_PROVIDER_ACTIVATION_AND_PARITY`

Acceptance does **not** promote Upstox to canonical. It accepts safe activation, observation and cross-tab correctness. A provider promotion requires a later explicit owner decision supported by completed parity evidence.

After this phase, the roadmap proceeds to the dedicated professional F&O strategy research/qualification pack, then independent `FNO_PAPER_V2` and `SWING_PAPER_V2` cohorts. Do not start those phases here.

---

## 16. Required final response format

Return only:

1. Verdict
2. Project/Git preflight
3. Redacted configuration and capability matrix
4. Canonical provider-domain policy
5. Cross-tab consumer inventory summary
6. Upstox activation and parity results
7. IndianAPI activation/entitlement results
8. Cross-tab data/provenance results
9. Diagnostics and safety proof
10. Tests, typechecks and builds
11. Git/evidence integrity
12. Owner action or remaining roadmap status

Do not return an execution diary.
