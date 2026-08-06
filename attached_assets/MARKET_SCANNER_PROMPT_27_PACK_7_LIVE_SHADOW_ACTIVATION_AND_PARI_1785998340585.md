# MARKET SCANNER PROMPT 27 — PACK 7 LIVE SHADOW ACTIVATION AND PARITY OBSERVATION

## Objective

The deterministic Pack 7 implementation is accepted:

- API server: 5,881 tests passing;
- scanner: 1,250 tests passing;
- four package typechecks clean;
- Upstox shadow non-interference implemented;
- IndianAPI entitlement/host controls implemented;
- parity classifications and owner diagnostics implemented;
- cross-tab canonicalization tests passing;
- Prompt 25C visual carryovers closed.

This task performs only the remaining **live provider activation and bounded shadow observation**. Kite remains canonical. No shadow result may influence displayed canonical prices, signals, paper trading, P&L, exits, or broker execution.

## Owner prerequisite — do not expose values

Before running this prompt, the owner must add these settings in Replit Secrets:

1. `UPSTOX_ANALYTICS_TOKEN` — preferred; **or** `UPSTOX_ACCESS_TOKEN` as the daily-token fallback. Only one valid Upstox token is required.
2. `INDIANAPI_API_KEY`.
3. `INDIANAPI_PLAN=PRO` for the selected IndianAPI plan.

Keep existing Kite credentials/session unchanged. Never paste any token or key into chat, source, evidence, tests, or logs.

If these settings are not present, do not edit code or create another plan. Return only:

`WAITING_FOR_OWNER_PROVIDER_SECRETS — MISSING: <secret names only>`

## Project boundary

Work only on Stock Scanner Pro:

- `artifacts/scanner/**`
- `artifacts/api-server/**`
- `lib/api-zod/**`
- `lib/api-client-react/**`
- audit evidence

`artifacts/global/**` is a separate frozen project and must remain untouched and excluded from every count.

## Prohibitions

- Do not retire Yahoo in this task.
- Do not change strategy logic, signals, thresholds, entries, exits, targets, stops, confidence, vetoes, sizing, or capital rules.
- Do not activate `FNO_PAPER_V2` or `SWING_PAPER_V2`.
- Do not perform DB cleanup or rewrite history.
- Do not enable broker execution.
- Keep `DB_TEST_RUNTIME_AUTHORIZED = false as boolean` unchanged.
- No commit, push, pull, fetch, publish, or deployment.
- Do not print environment values, authorization headers, raw provider payloads containing account information, or credential-derived URLs.

## Gate 1 — Read-only preflight

Record:

- HEAD, branch, upstream, working tree;
- Pack 7 evidence terminator;
- provider-secret presence/absence only;
- derived Upstox auth mode;
- validated IndianAPI plan and capability state;
- Kite session state;
- IST timestamp and market status.

Required Upstox precedence:

1. analytics token;
2. otherwise standard access token;
3. otherwise not configured.

Invalid provider configuration must fail closed with zero outbound calls. Do not silently change plan or host.

## Gate 2 — Safe authentication probes

Run minimum, redacted, owner-authorized probes through the existing provider clients:

### Upstox

- verify token authentication without exposing user/account data;
- verify the required market-data capability;
- verify instrument-master/BOD access used by canonical mapping;
- record only HTTP/result classification, latency, capability, and redacted failure reason.

### IndianAPI

- verify the configured `PRO` plan→host mapping;
- call only the documented fundamentals endpoint through the canonical server-side provider;
- verify `x-api-key` remains server-side;
- record capability, latency, typed result and `asOf` only;
- do not probe unsupported live-quote, candle, option-chain or trading domains.

Rate limits, timeouts and circuit breakers must remain active.

## Gate 3 — Instrument identity validation

Before any parity observation, validate mappings for:

- NIFTY 50;
- BANKNIFTY;
- SENSEX;
- RELIANCE;
- HDFCBANK;
- ICICIBANK;
- INFY;
- SBIN.

For each record, compare canonical symbol, exchange, segment, ISIN where applicable, Kite token and Upstox instrument key. Do not compare values when identity is ambiguous or mismatched.

Any `INSTRUMENT_MISMATCH`, stale derivative contract, or ambiguous mapping must be quarantined from observation and reported. Never repair an identity mismatch through fuzzy symbol matching.

## Gate 4 — Bounded live shadow observation

Run only during a meaningful market-data window, preferably 09:20–15:25 IST on an NSE/BSE trading day with a valid Kite session.

Observation requirements:

- minimum 30 minutes;
- the three verified indices and at least five verified equities;
- bounded sampling respecting provider rate limits;
- at least 20 comparable quote observations per included instrument where provider availability permits;
- candle comparisons only for identical interval and completed-candle timestamp;
- no option-chain comparison unless both identity and expiry contracts are explicitly verified and the existing Pack 7 policy permits it;
- no provider value substitution, averaging, voting or fallback.

Use the central Pack 7 parity thresholds and classifications. Do not invent new trading thresholds.

For every sample record:

- canonical identity;
- Kite and Upstox `asOf`;
- observation time in IST;
- absolute/basis-point delta;
- timestamp skew;
- provider latency;
- comparable/missing fields;
- classification;
- `tradingImpact: NONE`.

Required safety outcome:

- the canonical result returned to consumers remains byte/field equivalent before and after shadow dispatch;
- zero shadow data enters signal, paper, P&L, exit, target/stop or broker paths;
- zero future-timestamp samples are treated as fresh;
- every divergence is classified rather than “corrected.”

## Gate 5 — Cross-tab live canonical proof

During the same observation window, inspect registered Stock Scanner Pro routes/components for the sampled symbols.

Prove that Home, Watchlist, Scanner, Stock Detail, Charting, Portfolio and trading surfaces use the same canonical Kite identity/value root for the same observation, with consistent source and `asOf`.

Different values are acceptable only when interval, timestamp, expiry, strike scope or model is visibly different. Document the scope; do not force unlike metrics to match.

Upstox shadow values must appear only in owner diagnostics/parity evidence, never as the canonical displayed quote.

## Gate 6 — IndianAPI live fundamentals proof

Through the registered canonical Stock Scanner Pro fundamentals route, verify at least RELIANCE and HDFCBANK:

- HTTP and Zod success where entitlement/data are available;
- symbol/company identity;
- profile/ratios source and `asOf`;
- null remains null and is not converted to zero;
- partial/unavailable fields are labelled honestly;
- scanner client never imports or calls IndianAPI directly;
- no provider host, key, authorization header or raw provider error appears in the response or built client.

IndianAPI fundamentals must not alter canonical quotes or trading behavior.

## Gate 7 — Diagnostics and parity report

Verify the existing owner-only diagnostics UI/API displays:

- provider state and auth mode without secrets;
- instrument mapping status;
- observation sample count;
- match/divergence/unavailable rates;
- p50/p95 price delta in bps;
- p50/p95 timestamp skew;
- p50/p95 provider latency;
- latest typed failures;
- explicit statement that shadow provider data has no trading, signalling, paper-trading, P&L or broker impact.

Anonymous and subscriber access must fail safely. Capture authenticated screenshots at 390×844, 768×1024 and 1440×900. Redact account identifiers if any are returned unexpectedly.

## Gate 8 — Acceptance classification

Classify each provider/domain separately:

- `ACTIVATED_SHADOW_VERIFIED`;
- `ACTIVATED_DEGRADED`;
- `AUTH_FAILED`;
- `ENTITLEMENT_UNAVAILABLE`;
- `RATE_LIMITED`;
- `MAPPING_BLOCKED`;
- `INSUFFICIENT_COMPARABLE_SAMPLES`;
- `NOT_CONFIGURED`.

Do not call activation verified merely because authentication succeeded. Live parity requires comparable samples and the non-interference proof.

## Gate 9 — Verification battery

If no code changes are required, run:

- Pack 7 targeted provider/parity tests;
- scanner and API-server typechecks;
- `git diff --check`;
- client credential/sentinel scan;
- confirmation that Global, DB lock and broker hard blocks are unchanged.

If any production or test code changes, run the full accepted battery:

- API server floor: 5,881 tests;
- scanner floor: 1,250 tests;
- four package typechecks;
- scanner and API-server production builds;
- skip/only/retry/sleep/assertion audit;
- client credential/sentinel scan.

No operational DB mutation is authorized.

## Evidence and final verdict

Append the live activation section to:

`artifacts/audit-evidence/FAST_TRACK_PACK_7_PROVIDER_ACTIVATION_SHADOW_PARITY_AND_CROSS_TAB_CANONICALIZATION.md`

Include:

- redacted configuration state;
- provider/domain classifications;
- instrument mapping matrix;
- observation window and sample counts;
- aggregate parity statistics;
- cross-tab canonical proof;
- IndianAPI fundamentals proof;
- diagnostics screenshot inventory;
- test/build results;
- every blocker and owner action;
- confirmation of zero strategy, history, DB, broker, Yahoo-policy and Global changes.

Final nonblank line:

`END_FAST_TRACK_PACK_7_LIVE_SHADOW_ACTIVATION_AND_PARITY_OBSERVATION`

Return one:

- `ACCEPT_PACK_7_LIVE_SHADOW_ACTIVATED_AND_PARITY_VERIFIED`;
- `PARTIAL_PACK_7_LIVE_ACTIVATION — <provider/domain classifications and exact remaining blocker>`;
- `WAITING_FOR_OWNER_PROVIDER_SECRETS — MISSING: <secret names only>`;
- `BLOCKED_PACK_7_LIVE_ACTIVATION — <exact safety failure>`.

After full acceptance, the next roadmap stage is Yahoo coverage/retirement qualification—not immediate removal—followed by professional F&O strategy research and then the independent V2 paper cohorts.
