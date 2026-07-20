# NSESCANNER — SUPERSEDING REPLIT CODER WORK ORDER

**Directive date:** 20 July 2026 (IST)  
**Mode:** Phase 0 containment, forensic preservation, isolated-test repair  
**Authority for this run:** Local branch changes and isolated tests only  
**Forbidden in this run:** merge to `main`, restart, deployment, production/dev database mutation, historical-row cleanup, live Telegram sends, broker execution, and lifting any C0 block

---

## Paste everything below into Replit Coder

You are taking over a safety-critical Indian equity, swing-trading, and equity-derivatives analytics platform. Work as a senior Indian-market quant engineer, broker-integration engineer, database auditor, SRE, security reviewer, and professional risk manager.

Do **not** behave as a feature demo agent. This system displays and records trades, P&L, risk, market data, contract identity, expiry information, backtests, and Telegram alerts. Incorrect timestamps, stale quotes, synthetic fills, wrong expiry dates, polluted ledgers, or inconsistent data can create financial harm.

Your objective is not to promise profits or create a “money-generating machine.” Your objective is to build a truthful, reproducible, fail-closed professional decision-support and paper-trading platform whose live-trading eligibility can be judged only after evidence, isolated testing, shadow observation, cost-aware validation, and explicit owner approval.

This work order **supersedes every earlier unsent implementation prompt**. Earlier audits remain evidence inputs, not authority to overwrite newer code. If any older instruction conflicts with this document, follow this document.

## 1. Read these artifacts in this precedence order

1. `NSESCANNER_REPLACEMENT_DEEP_AUDIT_AND_RECOVERY_PLAN_2026-07-20.md` — current replacement audit and issue register.
2. The latest read-only Replit Coder reply supplied by the owner (`Pasted text(241).txt`) — current repository/ZIP comparison evidence. Its output is visibly truncated in the `PARTIALLY_PRESENT` table; complete the missing part rather than assuming it was completed.
3. Portfolio screenshots showing the suspicious open timestamps:
   - DLF opened `18 Jul 16:00:28`;
   - ADANIGREEN opened `14 Jul 19:02:54`;
   - TITAN, EXIDEIND and GRASIM opened at the identical time `09 Jul 23:41:35`;
   - the remaining displayed rows and their quantities, entry, LTP, SL, targets, capital and P&L.
4. Telegram screenshots showing weekend pre/post-market messages and the degraded/read-only alert.
5. Earlier audit and incident documents, including the DLF and invalid-session-cluster addenda. Use them as historical evidence only.
6. The supplied source/patch ZIP. Treat it as a **candidate diff and forensic evidence**, never as an authoritative replacement tree.
7. The current repository and current database schema, which must be inspected before changing anything.

Record the exact filename, byte size and SHA-256 of every input artifact used. If an attachment is unavailable, mark it `UNAVAILABLE`; do not invent its contents.

## 2. Evidence classification and reporting standard

Every material statement must be labelled one of:

- `PROVED` — supported by a reproducible command, exact source location, immutable artifact, isolated test, database query result, or official primary source.
- `LIKELY` — supported by evidence but not uniquely established.
- `UNPROVED` — not established or missing required evidence.
- `DISPROVED` — contradicted by stronger evidence.

Never upgrade `LIKELY` to `PROVED` in prose. Preserve exact command output for SHAs, hashes, row counts, test counts and constraints. Report tests as passed/failed/skipped/timed-out separately. Do not use words such as “perfect,” “fully accurate,” “safe,” “production-ready,” or “profitable” unless the stated acceptance evidence actually proves the narrower claim.

## 3. Current working baseline — reverify before relying on it

The latest read-only report states:

- repository `HEAD` and `main`: `c45c624713b306cc153953c0badc599bd4e5aa07`;
- running workspace build SHA: `dafc941d00fcd63b9a64758ad1dc8b1e82eedb6e`;
- workspace is one auto-checkpoint ahead of that running build;
- independently published production SHA is unconfirmed;
- patch ZIP SHA-256: `335e198d67db1420b8f51fd9edb7f781d5d85648edeee7eb6886955b1f652392`;
- patch classification: 5 already present, 1 missing, 6 conflicting, 44 partially present;
- the latest reply ends before the complete 44-file table is shown.

Reverify those facts literally. Do not call the workspace preview “production.” Query build identity anonymously from each actual public origin provided by the owner and keep the origins distinct. If a published origin is unavailable, report it; do not infer parity.

Before editing, create and switch to:

`phase0/containment-forensics-20260720`

If the Replit environment cannot prevent edits or automatic checkpoints on `main`, **stop before editing** and report the blocker. Do not silently change `main`.

## 4. Non-negotiable safety constraints

For this run:

1. Keep broker execution disabled.
2. Keep `FNO_AUTO_OPEN_C0_BLOCKED = true` and `EQUITY_AUTO_OPEN_C0_BLOCKED = true` unchanged.
3. Do not enable paper auto-open, manual open, staged open, combo open, live order placement, or shadow-to-live promotion.
4. Do not merge, deploy, restart workflows, publish, or change Replit deployment settings.
5. Do not run `drizzle-kit push`, migrations against a shared database, ad-hoc `UPDATE`/`DELETE`, `TRUNCATE`, constraint validation, balance reset, guessed backfill, or historical-row rewrite.
6. Do not delete or reclassify any audit, signal, plan, trade, ledger, capital-event or test-looking row. Preserve evidence first.
7. Do not run tests against the development, preview, staging or production operational database. Do not use the ordinary `DATABASE_URL` for tests.
8. Do not send test messages to production Telegram chats. Mock Telegram or use an explicitly isolated test bot/chat.
9. Do not apply the ZIP wholesale, copy complete ZIP files over the repository, or revert stronger current code to an older patch version.
10. Do not tune signal thresholds, weights, confidence cutoffs, stop distances, targets or strategy parameters while data integrity and execution truth are unresolved.
11. Do not claim that an endpoint is read-only merely because it uses HTTP `GET`.
12. Do not calculate a synthetic exit fill from a stale stored LTP/premium when the market is closed or the quote is stale.
13. Never use a client/signal timestamp as the authoritative database opening time. Store signal time separately from server receipt, decision and persisted-open times.
14. A close request may remain available for risk control, but it must not become a fabricated fill. Outside an executable session, reject it explicitly or record an idempotent pending-close request; do not book P&L until an admissible fresh quote exists.

If this work is run during 09:00–15:30 IST on a trading day, confine operational-data investigation to bounded, read-only, non-locking queries with a statement timeout. Do not run heavy historical scans against an operational database during the live session. The no-restart/no-deploy rule applies for this entire Phase 0 run, not merely during market hours.

If any requested task requires violating these constraints, stop that task and report the conflict.

## 5. Facts that must remain unresolved until evidence closes them

Do not silently “fix” these by changing data:

### 5.1 Six deleted `SILENT_DRIFT` rows

Six rows were deleted before their complete contents were captured. The current hypothesis is that they were leaked test artifacts because the only located writer was an immutability test with incomplete cleanup. That is a high-confidence hypothesis, **not recovered evidence**.

- Keep the incident classified `UNRESOLVED_OWNER_CLASSIFICATION`.
- Do not state that no evidence was lost.
- Do not validate the related constraint or start the 30-session clock based on an assumption.
- Preserve the incident report and the fact that individual row payloads are irrecoverable from the available transcript.

### 5.2 F&O paper-account drift

Current evidence reports:

- seed capital: ₹200,000.00;
- capital events: none recorded;
- seven closed trades’ total realised P&L: ₹6,508.30;
- expected balance: ₹206,508.30;
- actual balance: ₹1,006,281.00;
- unexplained difference: ₹799,772.70.

Reproduce this read-only. Do not reset the balance or invent capital events. The risk base is untrusted until an owner-approved ledger incident procedure identifies or explicitly adjudicates the divergence.

### 5.3 Equity “clean reconciliation” claim

Do not carry forward the earlier “EQUITY drift = zero” conclusion as proof. The visible/open-position dataset contains `TESTSTK`/`GAPTT`-style test contamination, and prior tests were able to reach the shared operational database. Recompute only after classifying all rows by provenance and isolating test data. Until then use `UNPROVED`.

### 5.4 15–17 July signal gap

The strongest supported statement is:

`PIPELINE_DID_NOT_REACH_DURABLE_REASONING_WRITER`

Replit sleep/process inactivity is a leading hypothesis, not a proved root cause. Do not absolve the scheduler, Kite session, worker topology or error handling without durable worker-heartbeat and job-run evidence.

## 6. Confirmed or high-priority defects to cover

Create one traceability register mapping every item below to source location, evidence, remediation, test and status. Do not omit an item because C0 currently masks it.

### 6.1 Impossible and suspicious equity opening timestamps

Audit all historical automatic, staged and manual equity opens—not only the screenshot rows—against Asia/Kolkata time, official exchange trading calendar, special sessions and configured entry window.

The screenshot establishes at least these incidents for investigation:

- DLF, `18 Jul 16:00:28`: invalid. If the year is 2026, 18 July is Saturday; if the UI/year meant 2027, 18 July is Sunday. It is also after the regular cash-market session.
- ADANIGREEN, `14 Jul 19:02:54`: after market hours.
- TITAN, EXIDEIND and GRASIM, `09 Jul 23:41:35`: impossible regular-session time and suspicious identical batch timestamp.
- DLF `10 Jul 11:30:30`, DELHIVERY `01 Jul 14:55:01`, MARUTI `30 Jun 14:56:17`, and ABB `29 Jun 15:12:03` are time-of-day plausible but still require calendar, quote freshness, source, writer, build and signal provenance.

Across the nine visible rows, displayed deployed capital is approximately ₹10,52,037. Rows with visibly invalid opening times account for approximately ₹5,69,994, or 54.2%. Recalculate these values from the underlying rows rather than trusting the screenshot transcription, and label any difference.

The screenshot rows’ arithmetic can be internally correct while the trades are operationally invalid. Treat accounting arithmetic and fill admissibility as separate dimensions.

The replacement audit found a likely writer defect: `openPaperEquityTrade()` does not enforce the canonical exchange-session gate at the writer boundary and uses `signal.triggeredAt` as `now` for multiple event timestamps. Verify every caller and writer. A caller-only guard is insufficient.

### 6.2 Market-session boundary defects

- Centralise official session state in one Asia/Kolkata calendar service.
- Use half-open boundaries where appropriate; do not let `15:30:59` pass because logic only checks the minute `<= 15:30`.
- Separate exchange session, strategy entry window, quote-admissibility window, 15:20 risk exit, and special-session rules.
- Weekend detection alone is insufficient; support official holidays and verified special sessions.
- Fail closed when calendar data is missing, stale, ambiguous or outside its validity interval.

### 6.3 Writer-boundary timestamp and provenance controls

Every state-changing trade writer must enforce, at its first effective boundary:

- canonical market/session decision;
- permitted strategy window;
- hard C0 block and system mode;
- ledger/reconciliation gate;
- fresh canonical quote with exchange timestamp and receive timestamp;
- source/provenance grade;
- instrument/contract token identity;
- idempotency key;
- risk, heat, drawdown, exposure and duplicate-position limits;
- decision reason and rejected reason;
- build SHA and writer version.

Persist separate immutable fields for signal timestamp, server received timestamp, decision timestamp, exchange quote timestamp and database-created timestamp. Any schema migration required must be generated but **not applied** in this run.

Inventory and cover automatic EQ, manual EQ, staged EQ, reconciliation/resume writers, automatic F&O, manual F&O, combo, force exit, stale-position sweep, Telegram-triggered action if any, and administrative repair paths.

### 6.4 GET/HEAD endpoint impurity and public access

Prove which `GET`/`HEAD` routes write to the database or mutate account/trade state. The replacement audit reports that paper-account/position/trade reads call `ensureDailyReset()`, while combo reads may remark and persist values. Also verify the global authentication bypass and `requireOwner` behaviour for GET routes.

Refactor so:

- all public `GET` and `HEAD` routes are transactionally read-only and have integration tests proving zero durable writes;
- resets, reconciliation, marking and maintenance run through explicit authenticated owner commands or idempotent scheduled jobs;
- a missing/failed maintenance job appears as stale/degraded status, never as a side effect of viewing a page.

### 6.5 F&O rollover, stale-open settlement and missed 15:20 exits

Verify the rollover sequence end-to-end. Current evidence indicates the balance is preserved but `sweepStaleOpenPaperTrades()` can close old `OPEN` trades without returning deployed capital/proceeds/charges because older logic assumed the daily reset wiped the balance.

Also verify the case where the worker sleeps or crashes through 15:20 and wakes after the session. A next-day stale sweep must not fabricate the previous exit, lose deployed capital, or make the ledger identity look reconciled.

Create isolated property/integration tests proving conservation of capital, charges and realised P&L across:

- normal open/close;
- 15:20 force exit;
- process asleep across 15:20;
- restart after close;
- next-day stale sweep;
- partial/missing quote;
- idempotent retry;
- holiday/weekend rollover.

### 6.6 Test contamination and unsafe database coupling

Current evidence says multiple API tests inherit `DATABASE_URL`, several close a shared pool, and at least one “live dev DB” test inserted an invalid reason without complete cleanup. Treat every previous DB-backed suite count as non-authoritative for isolation.

Implement a hard test harness rule:

- DB-backed tests require explicit `TEST_DATABASE_URL`;
- test startup fingerprints the host/database/schema and refuses known operational targets;
- use a unique disposable database or schema per run/worker;
- migrations are applied only to the disposable target;
- cleanup is scoped to that disposable target;
- absence of the isolated target causes DB tests to skip/fail clearly, never fall back to `DATABASE_URL`;
- external network, Kite order routes, broker execution and production Telegram are mocked/disabled;
- tests cannot close a global operational pool.

Add a sentinel test proving that setting only `DATABASE_URL` cannot cause any DB-backed test write.

### 6.7 Source provenance and a single canonical data pipeline

The same instrument and observation time must resolve to one canonical snapshot shared by dashboard, swing scanner, F&O engine, portfolio, charts, backtests and Telegram. Each value must expose source, exchange time, receive time, age, quality grade and fallback reason.

Programmatically detect same-snapshot contradictions for NIFTY spot/change, India VIX, GIFT NIFTY, PCR, breadth/universe counts and market regime across all tabs and Telegram. Missing values must remain missing, not become numeric zero. A component may transform a canonical value for display, but it must not independently refetch or reinterpret the market under the same label without declaring a different source/time.

Current-repo issues reported by the comparison:

- `isTradeGradeSwingRow()` is absent;
- swing levels use Yahoo research bars without a persisted level source;
- `paperTradingEq.ts` lacks the level/provenance open gate;
- `scanner.tsx` grades the page using a broad Kite-offline flag instead of row-level provenance;
- F&O open lacks the final contract-grade/token backstop.

Preserve the current hard C0 blocks and the stronger ledger gate while restoring these missing fail-closed provenance controls hunk-by-hunk. Yahoo or another fallback may remain for clearly labelled research/display continuity, but must never be silently called trade-grade or used for an executable/paper fill.

### 6.8 Contract identity and expiry rules

The latest comparison reports the current repository has BANKNIFTY and SENSEX weekday values reversed, and related backtest/tests may repeat the error. Do not blindly trust the ZIP or audit text. Verify the effective-dated rule using official exchange circulars, current contract master/instrument dump and a sampled Kite instrument token.

Requirements:

- expiry rules are effective-dated, not timeless constants;
- distinguish weekly and monthly contracts and discontinued weekly series;
- generate/resolve expiry from the current contract master;
- reject display-only or tokenless contracts from trade-grade paths;
- test NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY and SENSEX around rule-change dates, holidays and shifted expiries;
- render expiry source/effective date in diagnostics.

Do not change calendar dates or expiry rules until the supporting official source URL/document, publication/effective date and sampled live contract identity are recorded.

### 6.9 Official holidays, RBI/FOMC/event calendar

The ZIP and repository contain materially conflicting 2026 dates. Neither list is authoritative merely because it is newer. Verify separately against official NSE/BSE holiday circulars, RBI MPC calendar and Federal Reserve meeting schedule. Store source and validity metadata. If an official schedule is unavailable, mark the event calendar degraded and fail closed for any safety-sensitive blackout decision.

### 6.10 F&O combo debit and quantity arithmetic

Audit whether `netDebit` already includes leg quantity before multiplying by total leg quantity again. Add dimensional/unit tests for premiums, lot size, leg ratio, debit/credit, deployed capital, maximum loss, charges and ledger effect. One canonical contract/quantity representation must feed strategy display, order simulation, portfolio and backtest.

### 6.11 PCR, OI, GEX and missing-data semantics

- A missing PCR denominator must produce `null/unknown/insufficient_data`, not numeric zero.
- UI/Telegram must not turn missing data into bearish/bullish interpretation.
- GEX/zero-gamma outputs must disclose model assumptions, sign convention, open-interest source, spot/forward basis and unavailable inputs.
- No options metric may be trade-grade when the option chain or timestamp is stale, partial or reconstructed from incompatible sources.

### 6.12 Backtest integrity

Rebuild validation rules so a bar/time is not considered valid solely because its clock time looks intraday. Enforce official trading date/session/special session and source provenance. Report:

- total candidates;
- admissible candidates;
- entries actually simulated;
- closed/decided trades;
- open/unresolved/no-exit cases;
- rejected reasons;
- data coverage and missingness;
- costs, slippage and liquidity assumptions;
- walk-forward/out-of-sample windows;
- max drawdown, expectancy, profit factor, hit rate, payoff ratio and tail losses.

Do not include unresolved/no-exit cases in a win-rate denominator without explicit disclosure. No F&O premium backtest may claim real-premium performance without stored, timestamped option-chain/quote history and contract identity.

### 6.13 Telegram scheduling and truthfulness

Pre-market, post-market, swing and F&O alerts require:

- official calendar and session awareness;
- persistent worker/job heartbeat;
- durable idempotency/deduplication;
- bounded catch-up after sleep/restart;
- explicit `NO_DATA`, `STALE`, `DEGRADED`, `BLOCKED` and `MARKET_CLOSED` states;
- shared canonical snapshot/provenance;
- no test symbols or test messages in production;
- no claim that the ledger is consistent unless full reconciliation succeeds.

Narrow in-memory scheduler windows and weekday-only checks are insufficient. A weekend manual test must be labelled as a test and must not create a trade, fill, signal-history row or misleading production alert.

### 6.14 Security and secret exposure

Audit `/api/kite/export-session` and equivalent endpoints. A cookie exemption plus app-password access must not expose a Kite access token or API key. Remove or tightly owner-authenticate secret-export routes, never return raw broker secrets to the browser, redact logs/responses and add negative authorization tests. Inspect CORS, auth bypasses, admin/owner boundaries, debug routes, build-info exposure and rate limiting.

### 6.15 UI truth, duplication and professional presentation

Do not begin a cosmetic redesign until data contracts are truthful. Preserve every important feature, but remove duplicated representations only after identifying their consumer and canonical source.

Plan one compact global status strip with:

- market/session state;
- system mode;
- Kite state;
- DB state;
- worker/scheduler heartbeat;
- canonical snapshot time and age;
- broker execution state;
- deployed build SHA.

Every market value should distinguish `0` from `missing`, display timestamp/source/staleness, and show why a signal is blocked. The portfolio must show signal time separately from actual persisted open/fill time. Invalid legacy records must be visibly quarantined/labelled—not silently rewritten or deleted.

## 7. ZIP merge policy — mandatory hunk-by-hunk adjudication

Complete the truncated 54-file comparison matrix. For every file classify each meaningful hunk as:

- `KEEP_REPO`;
- `ADOPT_PATCH_HUNK`;
- `REIMPLEMENT_CLEANLY`;
- `REJECT_STALE_PATCH`;
- `NEEDS_OFFICIAL_FACT`;
- `DEFER`.

The following repo improvements must not be overwritten:

- hard C0 equity and F&O auto-open blocks;
- `checkLedgerReconciliationGate` and its earlier placement;
- capital-event-aware reconciliation identity;
- the current effective 2026 rate schedule where independently verified;
- newer durable writer/version/identity protections;
- any newer schema/API compatibility not present in the ZIP.

In particular, do not replace current `paperAccountReconciliation.ts` with the ZIP version. Reimplement missing provenance/contract gates against the current API.

For rates and statutory charges, verify official effective dates and instrument/side applicability before changing code. A numerically newer rate in the repo is not enough without an effective-dated schedule and official source.

## 8. Authorized Phase 0 implementation for this run

After the branch and evidence manifest are secure, implement only the following locally:

### P0-A — Containment invariants

1. Preserve the hard C0 blocks.
2. Add one shared fail-closed `TradeAdmissionDecision` boundary used by every new-position writer. It must return a typed allowed/blocked decision with structured reasons. During C0 it must remain blocked.
3. Add writer-boundary structural guards so no caller can bypass session/provenance/contract/ledger checks when C0 is eventually lifted.
4. Separate externally supplied signal time from server/database event time.
5. Add exact session boundary tests, including `15:30:00` and `15:30:59`, weekends, holidays and special-session unknown state.

Do not enable the writer and do not apply schema migrations.

### P0-B — Read purity

1. Remove durable mutation from public `GET`/`HEAD` paths.
2. Move reset/reconcile/mark work behind explicit authenticated commands/jobs.
3. Add integration/SQL-observer tests proving representative reads cause zero inserts, updates, deletes, closes, balance changes or audit rows.

### P0-C — Test isolation

Implement the hard `TEST_DATABASE_URL` isolation rules in §6.6. Convert affected tests to the isolated harness. If a disposable database cannot be provisioned, run only pure/unit/static tests and report DB-backed tests as `NOT_RUN_NO_ISOLATED_DB`.

### P0-D — Missing fail-closed provenance/contract guards

Reimplement against current code, without replacing stronger repo logic:

- `isTradeGradeSwingRow()` and its focused tests;
- source returned/persisted by swing-level computation;
- the EQ level/provenance block at the shared admission boundary;
- row-level scanner provenance display;
- the final F&O contract-grade and instrument-token block;
- fail-closed PCR missing-data semantics.

Keep C0 active, so these are defence-in-depth tests and future-unmasking protection.

### P0-E — Build and runtime identity

Keep or implement a safe build-info endpoint/status display containing commit SHA, build time, boot time, environment and deployment identifier, without secrets. Capture identity for source, workspace preview and any anonymously reachable published origin. Do not deploy to make them match.

### P0-F — Security containment

Close raw Kite session/token export exposure and add authorization/redaction tests. Do not rotate credentials or change external broker state in this run; report if rotation is required for the owner.

### P0-G — Historical invalid-session detector

Create a read-only detector/report that classifies every historical open and close using canonical session/calendar rules and emits reason codes. It must not modify rows. Include writer/version/source/build/signal/quote fields when present and explicitly show `UNKNOWN` when absent.

## 9. Items to design and test now but not activate or deploy

Produce implementation designs and isolated failing-then-passing tests where feasible for:

- F&O rollover/15:20/stale-sweep capital conservation;
- close-request versus executable-fill state machine;
- canonical market snapshot shared across tabs;
- official effective-dated contract/calendar service;
- combo quantity/debit correction;
- full-account EOD reconciliation;
- durable scheduler heartbeat, job runs and catch-up;
- backtest coverage/admissibility rebuild;
- invalid legacy-record quarantine display;
- UI consolidation and professional redesign.

Do not perform live data repair, schema application, threshold tuning, UI-wide redesign or deployment under this Phase 0 authority.

## 10. Required isolated tests and acceptance evidence

At minimum provide tests/evidence for:

1. Auto, manual, staged, resume/reconcile and combo new-position paths all reach the same admission boundary.
2. Saturday/Sunday/official holiday/unknown calendar/after-close/pre-open opens are blocked.
3. `15:30:00` and `15:30:59` cannot create a new regular-session position.
4. A forged/backdated `signal.triggeredAt` cannot set the persisted open/fill time or bypass session rules.
5. Yahoo/research/missing-provenance swing rows cannot create positions.
6. Tokenless/display-only/wrong-expiry F&O contracts cannot create positions.
7. C0 remains the first effective hard stop and stays true.
8. Ledger reconciliation stays in the admission chain even though C0 masks it; unit-test it directly and via an injected admission context without changing the constant.
9. GET/HEAD requests produce zero durable writes.
10. DB tests cannot run with only operational `DATABASE_URL` configured.
11. Production Telegram and broker adapters are unreachable from tests.
12. Missing PCR is `unknown`, never numeric zero or a directional label.
13. Secret-export routes reject anonymous/non-owner access and never return raw broker secrets.
14. Historical detector flags the screenshot timestamps correctly and does not update any row.
15. Build identity distinguishes source, preview and published origin.
16. Current reconciliation module, C0 constants and newer repo protections are unchanged unless a narrowly documented, tested hunk is required.
17. The F&O risk base cannot use the unexplained ₹799,772.70 balance difference.
18. The EOD reconciler cannot announce “all consistent” unless full cash, deployed capital, realised P&L, charges, capital events, open positions and writer identity reconcile.

For DB-backed tests, provide the disposable target fingerprint with secrets redacted. For every test command report test files, passed, failed, skipped and timed out. A timed-out batch is not a pass.

## 11. Official-source rule

For temporally changeable market facts, use only primary sources:

- NSE/BSE circulars, holiday notices, contract specifications and instrument/contract files;
- RBI MPC calendar/releases;
- Federal Reserve official meeting calendar;
- SEBI and exchange statutory levy notices;
- official Zerodha Kite Connect documentation and the live Kite instruments/quotes available to the owner.

Record source URL/document number, publication date, effective date, retrieval time and the exact rule derived. Secondary blogs, search snippets, memory and comments in the ZIP are not sufficient to change a trading rule.

## 12. Deliverables before you stop

Create/update these files on the Phase 0 branch:

1. `memory/PHASE0_SUPERSEDING_EVIDENCE_MANIFEST_2026-07-20.md`
2. `memory/PHASE0_COMPLETE_ZIP_HUNK_MATRIX_2026-07-20.md`
3. `memory/PHASE0_STATE_WRITER_AND_READ_SIDE_EFFECT_MAP_2026-07-20.md`
4. `memory/PHASE0_INVALID_SESSION_TRADE_REPORT_2026-07-20.md`
5. `memory/PHASE0_TEST_ISOLATION_PROOF_2026-07-20.md`
6. `memory/PHASE0_SECURITY_AND_BUILD_IDENTITY_REPORT_2026-07-20.md`
7. `memory/PHASE0_CHANGELOG_AND_TEST_EVIDENCE_2026-07-20.md`
8. `memory/MASTER_DEFECT_TRACEABILITY_REGISTER_2026-07-20.md`
9. `memory/PHASE1_TO_PHASE7_SEQUENCED_REMEDIATION_PLAN_2026-07-20.md`

The final response must contain:

- branch and exact pre/post commit SHA;
- dirty/clean worktree state;
- files changed and why;
- complete 54-file ZIP matrix totals;
- every finding labelled `PROVED`, `LIKELY`, `UNPROVED` or `DISPROVED`;
- historical invalid-session counts and reason breakdown;
- source/preview/published build identities;
- all tests with pass/fail/skip/timeout counts;
- DB isolation proof;
- confirmation that C0 constants remain true;
- confirmation that broker execution remained disabled;
- confirmation of zero operational DB mutations and zero live Telegram sends;
- unresolved owner decisions;
- exact Phase 1 proposal, but no Phase 1 execution.

The 30-consecutive-trading-session qualification clock must remain `NOT_STARTED`. It can start only after the F&O incident is owner-resolved, equity test contamination is classified, isolated reconciliation passes, the six deleted-row incident receives an explicit owner classification, durable worker/session evidence exists, and the admission gates are verified without changing C0. Thirty clean sessions are an observation qualification—not permission for live broker execution.

## 13. Stop conditions

Stop immediately and report without improvising if:

- the repository cannot be placed on the isolated branch;
- the working tree contains unexplained user changes that overlap this work;
- test isolation cannot distinguish the target from an operational DB;
- a command would mutate operational data;
- official facts conflict or cannot be verified;
- a fix requires lifting C0, enabling broker execution, changing balances or rewriting history;
- the published build cannot be identified;
- a migration must be applied to continue;
- any secret appears in output.

At the end, make **one deliberate local commit on the Phase 0 branch only** with a descriptive message. Do not merge, deploy, restart or publish. Wait for explicit owner review and approval.

Professional standard: capital preservation, evidence preservation, deterministic data lineage and truthful uncertainty take priority over signal volume, attractive UI, green-looking dashboards, test-count optics and speed.
