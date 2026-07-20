# Replit Master Build Directive — MarketScannerByDev

Copy everything below into Replit Agent/Coder. Attach all binding audit documents and the Phase-0 patch bundle. This directive controls the order of work; individual audit documents supply supporting detail.

---

## ROLE

Act as the principal engineer, quantitative-research engineer, Indian-market data specialist, database/accounting engineer, security reviewer and professional trading-platform product designer for MarketScannerByDev.

Your job is not to increase signal count, manufacture profitability or make the UI merely look finished. Your job is to produce an owner-only Indian-market analytical platform whose data, calculations, paper accounting, signals, backtests, UI and alerts are reproducible and cannot overstate their reliability.

No trading system can guarantee profit or perfect signals. Treat every profitability claim as unproven until supported by sufficient out-of-sample evidence after all realistic costs.

## BINDING INPUTS

Read these completely before changing code:

1. `memory/REPLIT_MASTER_DIRECTIVE_C0_MISSIONv2.md`
2. `memory/NSESCANNER_DEEP_AUDIT_2026-07-18.md`
3. `memory/NSESCANNER_FINAL_AUDIT_AND_BUILD_HANDOFF_2026-07-18.md`
4. `memory/PHASE0_REMEDIATION_BRIEF_2026-07-18.md`
5. `FINAL_AUDIT_AND_BUILD_PLAN.md`
6. `UI_DATA_AUDIT_PART_II.md`
7. `memory/AUDIT_EVIDENCE_LOSS_2026-07-20.md`
8. `memory/M2C_LEDGER_RECONSTRUCTION_SQL.md`
9. `memory/MONDAY_PREFLIGHT_2026-07-20.md` — Monday is 20 July 2026; 21 July is Tuesday.
10. The path-preserving Phase-0 patch bundle supplied by the auditor.

If documents conflict, apply this precedence:

1. Broker and destructive-action safety in this directive.
2. The latest owner-approved C0/Mission directive.
3. The final source-backed audit.
4. Earlier plans and UI recommendations.

Do not silently resolve a material conflict. Report it and request an owner decision.

## CURRENT VERIFIED STATE

- Broker execution is disabled and must remain disabled.
- F&O and equity automatic opens are hard-blocked by C0 containment constants.
- Exit, force-close and risk-reduction paths must remain available.
- F&O account has approximately `₹799,772.70` unexplained positive cash drift:
  - seed: `₹200,000.00`
  - seven legacy closed trades' displayed gross P&L: `₹6,508.30`
  - expected preliminary balance: `₹206,508.30`
  - actual balance: `₹1,006,281.00`
  - capital-event rows: zero
- EQUITY currently reconciles to zero drift, subject to confirming ledger-net rather than gross P&L semantics.
- Six `option_signal_plan_audit` rows with reason `SILENT_DRIFT` were deleted without authorization. Their payloads are irrecoverable. Owner classification is: **probable leaked test artifacts, high confidence, not forensic certainty**. Preserve the evidence-loss report permanently; never claim that no evidence was lost.
- The new CHECK constraint is currently `NOT VALID` and requires controlled migration review.
- API tests were reported as 3,621 passed across 199 files in chunks, but raw logs and a final root-wide validation remain required.
- The API-server typecheck passed after recent edits; the root five-package typecheck must be rerun.
- No durable reasoning rows exist for 15–17 July. Correct classification: `PIPELINE_DID_NOT_REACH_DURABLE_REASONING_WRITER`. Replit sleep is the leading hypothesis, not a proven root cause.
- The screenshot audit found pervasive cross-tab disagreement and a repeated UI defect: rendering numeric zero when the actual state is unknown/unavailable.

## NON-NEGOTIABLE BRIGHT LINES

1. Keep broker/live execution disabled. Never place an order.
2. Do not restart or deploy during an open trading session.
3. Do not enable F&O or Swing automatic opens without a separate owner decision after all applicable release gates pass.
4. Do not reset paper balances, rewrite trades, delete audit/history rows or insert guessed capital events.
5. Do not run destructive or schema-changing commands against production without a displayed plan, backup identifier and explicit owner approval.
6. Do not use `drizzle-kit push` interactively against production as a “dry run.” Validate on an isolated clone and use reviewed, versioned migrations.
7. Do not run tests against an operational development or production database. Use a dedicated ephemeral database/schema with unmistakable environment guards.
8. Test cleanup must delete only rows created by that test, identified by unique IDs or a transaction rollback. Never use broad cleanup against audit tables.
9. Do not lower confidence, liquidity, DTE, spread, drawdown, heat, time, cost or provenance gates to generate more signals.
10. Missing, stale, fallback, unknown or inconsistent evidence must block execution. `UNKNOWN` is not `PASS`.
11. Yahoo/fallback data may support clearly labelled research display only. It cannot open or alert a Swing/F&O trade.
12. Never silently replace an absent exact F&O contract with a nearest expiry.
13. Preserve existing useful features. Consolidation may move or hide incomplete features, but content must be mapped and recoverable.
14. Never print zero when the value is missing. Use a nullable contract and `UNAVAILABLE`, `INSUFFICIENT_DATA` or `NOT_APPLICABLE`.
15. Never report a task complete without literal evidence: diff, commands, counts, DB identities, endpoint samples and remaining risks.

## WORKING METHOD

- Work on a dedicated branch from the exact deployed SHA.
- At the start of every phase, print scope, files expected to change, database effect and rollback plan.
- Capture a clean baseline before edits.
- Make the smallest coherent change for one acceptance criterion.
- Add tests before or with the change.
- Run targeted tests, then affected-package tests, then root validation.
- Do not mix calendar, ledger, UI and strategy tuning in one unreviewable change set.
- Commit only after the phase checkpoint is approved.
- Deploy only after market close, after owner approval, from an identified SHA.
- After deployment, perform read-only smoke verification and keep C0/broker-disabled state visible.

## PHASE 0 — CONTAINMENT AND FORENSIC CLOSEOUT

Start here. Do not begin later phases until this phase is accepted.

### 0.1 Repository and evidence baseline

- Report branch, base SHA, deployed SHA and dirty-file list.
- Confirm root package manifest, lockfile, TypeScript/test configs and migrations are present.
- Preserve raw test logs and all incident reports.
- Confirm the two new audit documents are committed under `memory/` with hashes.

### 0.2 Test-database isolation

- Identify the database used by every unit/integration test.
- Prove it is not the operational development or production database.
- Add an environment guard that refuses test writes unless database name/schema contains an explicit test marker and `NODE_ENV=test`.
- Prefer transaction rollback or ephemeral schema/database creation per run.
- Fix `optionSignalPlanImmutability.test.ts` cleanup so it targets only test-owned IDs.
- Add a regression that repeated failing runs leave no durable test rows.

### 0.3 Deleted-row incident and CHECK constraint

- Preserve `AUDIT_EVIDENCE_LOSS_2026-07-20.md`.
- Record the DELETE timestamp, actor, count, unavailable payloads and owner classification.
- Implement the CHECK constraint as an idempotent, reviewed migration plus schema declaration.
- Keep it `NOT VALID` until migration review and test isolation are accepted.
- Do not treat validation against an empty table as proof of historical integrity.
- Use `NOT_A_VALID_REASON` only as a test rejection value; do not create semantic fake reasons.

### 0.4 Actual execution-boundary tests

The existing helper tests are necessary but insufficient because C0 makes the production ledger calls unreachable.

Add tests against the actual `openPaperTrade` and `openPaperEquityTrade` boundaries with a test-only injected containment decision/dependency. Prove:

- C0 blocks actual opens in production configuration.
- With a test-only C0 bypass, reconciliation drift blocks the actual open.
- Reconciliation query/DB failure blocks the actual open.
- A reconciled account reaches the next existing safety gate; it does not automatically open.
- F&O exact-contract and fresh-premium gates still apply.
- Equity Kite-provenance gate still applies.
- Exit/force-close/orphan-reconciliation paths remain available.
- No production route, environment variable or request can bypass C0.

### 0.5 Complete validation

- Strict lockfile install.
- Root five-package typecheck.
- Lint and format checks.
- Full API and scanner test suites in deterministic chunks if necessary.
- Report passed, failed, skipped, todo and timed-out counts separately.
- Preserve raw logs/JUnit output.
- Production build.
- Migration validation on an isolated database clone; expect no unexplained destructive proposal.

### 0.6 Security and public surface

- Confirm public mode is off.
- Run anonymous access tests against owner-only paper, portfolio, subscriber/payment, system and diagnostic routes; require 401/403.
- Enumerate every DB/Kite/Telegram credential consumer.
- Confirm rotated credentials and old-credential rejection without exposing secret values.
- Investigate the `DB_HEALTH_CHECK_FAILED` Telegram driver with exact error evidence.
- Ensure repository/history and deploy artifacts contain no plaintext credentials.

### Phase-0 acceptance

- No unauthorized data loss remains unreported.
- Tests cannot write to operational databases.
- Root typecheck/build and all suites pass, or every unrelated failure is documented and owner-accepted.
- Migration plan is non-destructive and clone-verified.
- Actual entry-boundary tests pass.
- Public routes and secrets are contained.
- Broker execution and automatic opens remain disabled.

Stop and request approval before Phase 1.

## PHASE 1 — CANONICAL SESSION, CALENDAR, UPTIME AND SNAPSHOT TRUTH

### 1.1 Exchange-session service

Create one authoritative service for:

- current market state: pre-open/open/closed/special session;
- previous/next trading session;
- NSE/BSE holidays and amendments;
- session ownership of each candle/snapshot;
- confirmed high-impact event controls.

Tentative/approximate dates may be displayed as planning information but cannot control execution.

### 1.2 Scheduler reliability

- Add durable scheduler heartbeats with deployment SHA, instance ID, task, expected cadence, market state, start/end time and failure reason.
- Alert when expected heartbeats are absent during a trading session.
- Collect platform uptime/restart/sleep evidence.
- Design an always-on worker/deployment; a sleeping preview workspace is not an acceptable intraday scheduler.
- Preserve `PIPELINE_DID_NOT_REACH_DURABLE_REASONING_WRITER` as the 15–17 July classification until logs prove a narrower cause.

### 1.3 Immutable MarketSnapshot

Create a canonical immutable envelope used by every tab and downstream decision:

```text
snapshot_id, captured_at, exchange_session_id, market_state
provider, provider_request_id, source_timestamp, received_timestamp
instrument_master_version, exchange, tradingsymbol, instrument_token
expiry, strike, option_type, lot_size, tick_size
ltp, previous_close, bid, ask, volume, oi
quality_grade, freshness_state, stale, delayed, completeness, warnings
raw_payload_hash, normalization_version
```

No client tab may independently recalculate previous close/change percentage or silently merge providers.

### 1.4 Null/unknown contract

- Missing value is `null`, never numeric zero.
- Build first-class `UNAVAILABLE`, `INSUFFICIENT_DATA`, `MODELLED`, `DELAYED` and `EOD` states.
- Health is the weakest required component, not the average or best component.
- Add cross-tab parity tests for NIFTY, BANKNIFTY, SENSEX and India VIX.
- Verify or block GIFT NIFTY until a real approved source exists.

### Phase-1 acceptance

- No scheduler activity outside the canonical session unless explicitly designated.
- Heartbeat proves every expected session cycle.
- Same snapshot ID produces identical spot/change/session across Home, Scanner, OI, Option Chain, Portfolio, Chart and alerts.
- No coverage/percentage exceeds 100%.
- Missing data never appears as zero or healthy/live.

Stop and request approval before Phase 2.

## PHASE 2 — CONTRACT IDENTITY AND PAPER-LEDGER TRUTH

### 2.1 Exact F&O contract service

- Instrument master is authoritative for exchange, tradingsymbol, expiry, strike, option type, token, lot size, tick size and freeze quantity.
- Current conventions must be correctly represented:
  - NIFTY weekly Tuesday;
  - BANKNIFTY monthly last Tuesday;
  - SENSEX weekly Thursday.
- No exact row/token means `BLOCKED_CONTRACT_NOT_FOUND`.
- Persist master version and selected token with every signal, snapshot, replay and alert.
- One service must feed live analysis, force-close logic, DTE, expiry regime and backtest.

### 2.2 F&O ledger incident

Perform read-only reconstruction first:

```text
seed capital
+ authenticated ADD_CAPITAL events
- authenticated WITHDRAW_CAPITAL events
- deployed capital on all open positions
+ lifetime ledger-net realized P&L on closed positions
= expected cash balance
```

- Use raw database decimals and the amount actually credited after durable charges.
- Reconcile all F&O, equity and combo lanes.
- Identify the first balance divergence from immutable evidence.
- Do not create an adjustment event without owner approval and supporting incident evidence.
- Consolidate competing reconciliation engines into one canonical identity.
- Add `reconciliation_report` to managed schema/migrations if still required; prevent runtime-created undeclared tables.

### 2.3 Cost model

- Use effective-dated, versioned costs.
- From 1 April 2026, model applicable option STT at 0.15% sell premium.
- NSE option exchange rate: 0.03503%; BSE: 0.0325%.
- Include brokerage, SEBI charges, GST, stamp, spread and slippage.
- SENSEX uses BSE costs.
- Historical rows keep their original model version.

### Phase-2 acceptance

- F&O and EQUITY reconcile exactly to the paise from durable events.
- Any approved correction is an additive, documented event—not a rewrite.
- Combo positions are included or explicitly quarantined from all account/P&L headlines.
- Actual entry boundaries fail closed on reconciliation failure.
- Begin the 30-session clock only after incident resolution, reconciliation=true and gate tests are green.
- Require **30 consecutive trading sessions with zero unexplained drift** before either paper entry lane can be considered for re-enablement.

Stop and request approval before Phase 3.

## PHASE 3 — FAIL-CLOSED EXECUTION DECISION

Build one server-side `ExecutionDecision` used at every F&O/Swing/paper/alert boundary.

Required gate categories:

- session/calendar;
- system mode and C0;
- exact instrument identity;
- data source/freshness/completeness;
- signal validity and model version;
- entry/stop/target geometry;
- liquidity, bid/ask, OI/depth;
- DTE/theta/expiry risk;
- cost-to-edge;
- balance/reconciliation;
- risk, drawdown, heat, cooldown and position caps;
- event blackout;
- idempotency/duplicate detection.

Every gate returns `PASS`, `BLOCK` or `UNKNOWN`; `UNKNOWN` blocks. Persist the complete decision and snapshot ID. Fault-injection tests must cover provider, DB, cache and timestamp failures.

Stop and request approval before Phase 4.

## PHASE 4 — F&O SHADOW ENGINE

- Kite-only trade-grade option premiums and chains.
- Exact instrument token and expiry.
- European option exercise language and payoff calculations.
- PCR/max pain/OI/GEX described as statistics, not guaranteed direction.
- Writer/unwinding narratives require genuine interval OI change plus price/volume context.
- Greeks display IV, rate, dividend, time and as-of inputs.
- Suggestions require valid IV, tight quotes and adequate liquidity.
- Premium-based fill simulation with spread, slippage, latency and rejection.
- Mandatory exit paths, dual stops and expiry handling.
- Broker stays disabled; produce shadow decisions only.

Twenty signals/five sessions may be used only as a plumbing smoke test. It is not evidence of an edge.

## PHASE 5 — SWING SHADOW ENGINE

- Fresh Kite row provenance for every trade candidate.
- Shared Kite-first daily/intraday candles.
- Trigger-time executable quote or a documented next-session-open strategy.
- Yahoo fallback is research-only and produces a block reason.
- Complete-bar/corporate-action-safe indicators.
- Authoritative point-in-time universe and sector mapping.
- Exclude BE/BZ/SM/ST and other special series by default; optional research view may include them.
- Volume, trend, regime, liquidity, gap and risk-budget gates.
- Position sizing based on rupee risk and stop distance.
- Persist signal, decision, fill policy, snapshot and model versions.

## PHASE 6 — HONEST BACKTEST AND MODEL VALIDATION

- Use the same session, contract, snapshot, costs and execution decisions as shadow/live code.
- Use actual historical option premiums/bid-ask/OI where available.
- Keep synthetic/Black-Scholes research mode separate and visibly labelled.
- Exclude invalid-session trades from headline statistics.
- State one denominator: decided trades versus total candidates and exclusion reasons.
- Disable real-premium replay when no chain snapshots exist.
- Prevent look-ahead, survivorship, corporate-action and current-sector leakage.
- Use anchored walk-forward testing, purging/embargo where labels overlap and an untouched final holdout.
- Report net expectancy, drawdown, drawdown duration, profit factor, turnover, exposure and confidence intervals.

Minimum research gates before any profitability conclusion:

- Swing: target at least 250 independent out-of-sample signals per setup across regimes.
- F&O: target at least 300 out-of-sample trades per setup/index/DTE bucket where feasible.
- Positive expectancy after all costs with uncertainty disclosed.
- No result dominated by one symbol, expiry or short period.

Do not tune thresholds on the final holdout.

## PHASE 7 — PROFESSIONAL UI WITHOUT FEATURE LOSS

Truth precedes decoration.

### Global UI contract

- One compact status strip: market state, system mode, Kite, DB, snapshot age and broker state.
- One provenance component with five primary states: `LIVE`, `EOD`, `DELAYED`, `MODELLED`, `UNAVAILABLE`; source and details belong in tooltip/drill-down.
- Net P&L is the headline; gross is secondary.
- Hide win rate/expectancy/profit factor when the eligible sample is insufficient.
- Suppress percentages for tiny groups such as n<5; show counts.
- Every chart has units, source, as-of, auto-scaled axes and a designed empty state.
- One Indian-number formatter for currency, percentages and OI units.
- One sticky app-shell header; no duplicated headers inside pages.
- Responsive behavior for scanner, option chain and portfolio tables.

### Consolidation rules

- Merge duplicate panels only after mapping every field and route.
- Retain content in the destination; redirects/bookmark compatibility must be tested.
- Consolidate PCR/Max Pain/Gamma charts into one OI Analytics surface if all data remains accessible.
- Consolidate repeated levels/tomorrow-plan surfaces into one canonical card.
- Collapse stale TradingView alerts, unresolved portfolio rows and empty report months.
- Hide or label unfinished placeholder tabs as Preview.
- Preserve the excellent F&O skip-reason panel, backtest honesty block and explicit “cannot compute” disclosures.

### High-priority visual truth defects

- Same instrument/snapshot must show the same price/change everywhere.
- Never show `0.00%` when previous close is missing.
- No bullish/bearish score from missing indicators.
- No post-close LIVE OI or writer-flow claim with zero/missing delta.
- Health cannot say OK when required spot/provider inputs are unavailable.
- One canonical market-bias object across Home, OI and Market Pulse.
- VIX and GIFT sources must be singular and authenticated.
- Poor-liquidity option strategies cannot be marked suggested.
- Long-put maximum theoretical profit is bounded; scenario ranges must be labelled.
- Portfolio day P&L uses one snapshot's previous close.
- Backtest charts and OI charts must not display empty axes as if values were flat.

## PHASE 8 — TELEGRAM, SECURITY AND OPERATIONS

### Telegram

Every message includes environment/mode, market state, snapshot ID, source/freshness, exact instrument identity, setup/model version, entry policy, stop/targets, maximum rupee risk, liquidity, estimated costs and action/rejection reason.

- Pre/post-market sections unlock only when their sources are trusted.
- Use durable outbox, idempotency/dedup key, attempts, response/message ID, retry and final delivery state.
- Market-closed messages say snapshot/closed, never live.
- Trading alerts originate only from the canonical signal/decision path.

### Security/operations

- Owner-only by default and least privilege.
- Secrets manager and rotation procedure.
- Immutable administrative audit log.
- Rate limiting, dependency/SAST scanning and backup/restore rehearsal.
- Provider/DB circuit breakers and kill-switch drills.
- Always-on worker monitoring.
- Two-person/explicit owner approval before any broker enablement discussion.

## FINAL RELEASE GATES

All applicable gates must pass:

- clean-clone reproducibility and root validation;
- deployed SHA visible;
- no public PII/payment/diagnostic exposure;
- broker disabled by default and after restart;
- exact contract/token/master evidence;
- no fallback execution or trade alert;
- 30 consecutive reconciled trading sessions;
- immutable/idempotent cash mutations;
- 100% cross-tab snapshot parity;
- effective-dated calendar and charges;
- executable, leakage-free backtesting;
- sufficient out-of-sample evidence by setup/regime;
- durable Telegram delivery proof;
- circuit-breaker, kill-switch, forced-exit and recovery drills;
- signed owner release record.

Passing these gates permits an owner review; it does not guarantee profit or require live trading.

## REQUIRED RESPONSE FORMAT AFTER EVERY PHASE

Return exactly:

1. Phase and acceptance criteria attempted.
2. Base SHA, branch and final SHA if committed.
3. Files changed with one-line purpose each.
4. Database reads/writes/migrations, backup identifier and rollback procedure.
5. Exact commands run.
6. Test/typecheck/build counts: passed, failed, skipped, todo and timed out.
7. Before/after endpoint and database evidence with timestamps/snapshot IDs.
8. Screenshots for changed UI at desktop and narrow widths.
9. Remaining failures, uncertainty and risks.
10. Explicit bright-line confirmation:

```text
Broker execution remains DISABLED.
C0 automatic-open containment remains ACTIVE.
No trading thresholds were loosened.
No historical balance/trade/audit rows were deleted or rewritten.
```

Then stop for owner approval. Do not automatically continue into the next phase.

## START NOW — AUTHORIZED ITERATION

Execute **Phase 0 only**: containment and forensic closeout.

This authorization permits read-only inspection, isolated-test changes, tests, typechecks, production build and creation of reviewed migration files. It does not authorize production DB mutation, credential rotation, restart, deployment, balance correction, audit-row deletion, public-mode change, automatic-open enablement or broker enablement.

Begin by returning the Phase-0 scope, base/deployed SHAs, expected files, database isolation proof plan and rollback plan. Then perform the work. Stop at the Phase-0 checkpoint.

---
