# NSEScanner / MarketScannerByDev — Replacement Deep Audit and Recovery Plan

**Audit date:** 20 July 2026 (IST)  
**Disposition:** **RED / NO-GO** for live broker execution and for autonomous paper-entry evidence collection  
**Scope:** supplied source snapshots, 46 production screenshots, three additional portfolio screenshots, Telegram evidence, prior audit reports, Replit-agent transcripts, and official exchange/broker documentation  
**Method:** read-only forensic review. No database, deployment, constraint, evidence row, trading threshold, or application source was changed during this audit.

---

## 1. Authority of this report

This report **supersedes every earlier release/closure conclusion** that said any of the following:

- Phase C0 was fully closed;
- the equity paper ledger was clean;
- the July 15–17 signal gap was proved to be Replit sleep;
- passing tests established deployment safety;
- the supplied patch and the deployed build were the same;
- public mode was read-only;
- the current paper books could be used to evaluate strategy quality.

The earlier reports remain useful evidence and should not be deleted. Their confirmed findings are carried forward here, but their closure statements are withdrawn.

### Release decision

Keep all of the following disabled:

- real broker order placement;
- automated F&O paper opens;
- automated equity/swing paper opens;
- manual/staged/combo paper opens until the same execution-boundary controls exist on every lane;
- any performance-based threshold tuning;
- any claim of proven accuracy, profitability, or readiness for real capital.

Existing risk-reduction actions must remain possible, but an after-hours click must not fabricate a market fill. It should record an exit request and either execute against a fresh session quote or remain queued/unfilled.

---

## 2. Evidence and version matrix

| Evidence | Result | Consequence |
|---|---|---|
| Uploaded source ZIPs | `marketscannerbydev-src.zip` and `marketscannerbydev-src(1).zip` are identical, SHA-256 `24f946642bae0126424c4752d298de3cda0cf271a64f4659bd1369e535968fc9` | One stable uploaded source baseline exists. |
| Working source snapshot | 1,379 `.ts/.tsx` files; 199 API-server test files; materially differs from uploaded baseline in trading, market calendar, backtest, data, and UI modules | It is a patched analysis copy, not proof of the current Replit workspace or deployed runtime. |
| Repository completeness | No root `package.json`, lockfile, root TypeScript/Vitest configuration, or Git metadata; only a nested API-spec package manifest is present | A clean install, full build, migration replay, and commit-to-deployment proof cannot be reproduced from the export. |
| Screenshots | 46 tab screenshots plus Telegram and portfolio evidence; OCR was generated for all 46 | Strong visual evidence, but not a substitute for database rows or deployment logs. |
| Screenshot archive | `marketscannerbydev.zip`, SHA-256 `59e51d74009778acde7566e2a6bf9ac9f0bbae5ba255710f0272c0307153e149`, is truncated/corrupt; individual screenshots are intact | Preserve individual image hashes; do not use the ZIP as the sole evidence archive. |
| New portfolio images | `image(108).png` and `image(109).png` are exact duplicates, SHA-256 `be8beec824dde65e23fc650db8aee0348305069118c2d0d2d278e26238d07ba7` | They corroborate one screen, not two independent observations. |
| Replit transcript | Reports fixes and 3,621 passing tests in a newer workspace | Useful claim, but cannot establish runtime parity because the supplied source still contains pre-fix test code and no build/deploy fingerprint ties the transcript to the screenshots. |
| Live database | No authenticated, read-only production snapshot was supplied to this audit | Database root causes remain hypotheses until the forensic query pack is run against the exact deployment database. |

### Mandatory interpretation

There are at least four distinct identities in the evidence:

1. uploaded source baseline;
2. patched working source snapshot;
3. Replit's later workspace described in chat;
4. deployed UI/database represented by screenshots.

No conclusion may be moved from one identity to another without a shared `build_sha`, `deployment_id`, environment label, database fingerprint, schema version, and snapshot timestamp.

---

## 3. Why the prior audit missed the invalid trades

The miss was an audit-method failure, not a subtle market judgment.

1. The earlier review concentrated on the F&O writer, expiry configuration, provenance gates, ledger formula, and selected screenshots. It did not apply a row-level temporal invariant to **every visible position**.
2. It reviewed scheduler gates but did not trace every state-changing lane to the final writer. The core equity writer, manual buy, staged approval, and combo writer were not all tested at their persistence boundary.
3. It accepted a Replit database reconciliation that used ten `TESTSTK/GAPTT` positions and exactly ₹50,000 of open capital. That dataset does not match the real-looking nine-position screenshot and is consistent with test pollution.
4. It treated GET endpoints as read-only by HTTP convention without tracing their callees. Several GETs call routines that update/reset/close rows.
5. It inferred Replit sleep as the cause of July 15–17 missing signals. The evidence only proves that the pipeline did not reach the durable reasoning writer.
6. It accepted test counts without first proving test-database isolation or verifying that the tested build was the deployed build.

The corrected audit method is now:

> For every persisted trade, prove session, calendar, quote, contract, risk, ledger, source, environment, writer, and notification identity at the state-changing boundary; then independently prove what every UI surface renders from that row.

---

## 4. Portfolio screenshot forensic reconstruction

The screenshot displays dates without a year or timezone. The user's text mentions 18 July 2027; the screenshot context and current system date suggest 18 July 2026. This ambiguity is itself a defect.

- 18 July 2026 was a **Saturday**.
- 18 July 2027 will be a **Sunday**.
- Therefore the DLF row is invalid under either interpretation.

NSE's regular equity session is 09:15–15:30 IST on trading days. A timestamp after 15:30 is not a valid normal-market equity fill merely because the closing session or trade-modification facilities exist.

| Symbol | Opened shown | Qty | Entry | Capital | Session result | Classification |
|---|---:|---:|---:|---:|---|---|
| DLF | 18 Jul · 16:00:28 | 1 | ₹649.00 | ₹649 | Weekend and after normal close | **Invalid** |
| ADANIGREEN | 14 Jul · 19:02:54 | 35 | ₹1,545.00 | ₹54,075 | Tuesday, but 3h32m after close | **Invalid** |
| DLF | 10 Jul · 11:30:30 | 191 | ₹670.00 | ₹1,27,970 | Friday regular session | Time-valid, other identities unproved |
| TITAN | 09 Jul · 23:41:35 | 32 | ₹4,614.80 | ₹1,47,674 | Thursday, more than 8h after close | **Invalid** |
| EXIDEIND | 09 Jul · 23:41:35 | 465 | ₹426.00 | ₹1,98,090 | Same invalid batch timestamp | **Invalid** |
| GRASIM | 09 Jul · 23:41:35 | 54 | ₹3,139.00 | ₹1,69,506 | Same invalid batch timestamp | **Invalid** |
| DELHIVERY | 01 Jul · 14:55:01 | 147 | ₹471.95 | ₹69,377 | Wednesday regular session | Time-valid, other identities unproved |
| MARUTI | 30 Jun · 14:56:17 | 9 | ₹13,744.00 | ₹1,23,696 | Tuesday regular session | Time-valid, other identities unproved |
| ABB | 29 Jun · 15:12:03 | 23 | ₹7,000.00 | ₹1,61,000 | Monday regular session | Time-valid, other identities unproved |

### Portfolio totals

- Visible capital: **₹10,52,037**.
- Capital in visibly invalid-time rows: **₹5,69,994**, about **54.2%** of the displayed book.
- Three independent symbols share the exact `09 Jul · 23:41:35` timestamp. That is a strong batch/boot/test/import signature, not three plausible market fills.

### Arithmetic versus trade authenticity

The row arithmetic is mostly internally correct:

- DLF: `1 × (659.50 − 649.00) = ₹10.50`.
- ADANIGREEN: `35 × (1509.10 − 1545.00) = −₹1,256.50`.
- TITAN: `32 × (4642.10 − 4614.80) = ₹873.60`.
- EXIDEIND: `465 × (438.05 − 426.00) = ₹5,603.25`.
- ABB: `23 × (7433.50 − 7000.00) = ₹9,970.50`.

Targets also follow the displayed 2R/3R geometry. For example, DLF risk is `649.00 − 614.93 = 34.07`; T1 is about `entry + 2R`, and T2 about `entry + 3R`.

This proves only that the UI calculator is coherent. It does **not** prove the trade existed, was session-valid, used a fresh quote, or belongs to the correct database/build.

---

## 5. Confirmed root cause of off-session equity opens

### 5.1 The final equity writer has no session gate

In `artifacts/api-server/src/lib/paperTradingEq.ts`, `openPaperEquityTrade()` checks provenance, ledger reconciliation, duplicates, prices, stop geometry, drawdown, balance, and heat. It does **not** call the canonical market-session/calendar service before persisting the position.

The most important persistence lines use caller-controlled time:

```ts
const now = signal.triggeredAt;
signalTriggeredAt: now,
lastEvaluatedAt: now,
openedAt: now,
```

Consequences:

- a stale/future/off-session signal can supply the persisted open time;
- application time, not the database clock, becomes the accounting timestamp;
- scheduler protection can be bypassed by another caller;
- the writer cannot prove which exchange session owned the trade.

### 5.2 The scheduler runs outside market hours

`fullNseScanner.ts::startFullNseScannerBackground()` starts 500 ms after boot and repeats every 60 seconds without a market-session gate. It can call the swing/paper path after close, on weekends, or after a cold start.

A scheduler gate would reduce load, but it is not the permanent safety control. The writer itself must reject an invalid session.

### 5.3 Manual equity buy is equally exposed

`openManualPaperEquityTrade()` obtains a scanner-cache LTP and delegates to the same unguarded writer. It has no explicit market-state, holiday, exchange-timestamp, or quote-age check at the final boundary.

### 5.4 Staged approval is inconsistent and presently blocked in the supplied copy

`openPaperEquityTradeFromStagedOrder()` creates a new `SwingSignal` with `levelsSource: "yahoo"`, while the core writer rejects every non-Kite source. Therefore, in this supplied source, the approved staged-order delegate appears unable to open at all. A newer Replit version may differ; deployment parity must prove it.

### 5.5 The time boundary is one minute too wide

`computeMarketStatus()` uses minute precision and treats `mins <= 15:30` as open. That admits every timestamp from 15:30:00 through 15:30:59. A new-entry gate should use exact instants and normally stop earlier than the exchange close.

### Permanent fix

At the **first executable line of every open writer**—auto, manual, staged, reconciliation/backfill, and combo:

1. obtain authoritative server/database time;
2. resolve a versioned exchange session;
3. require `REGULAR_OPEN` and a lane-specific entry cutoff;
4. reject weekend, holiday, unknown calendar year, pre-open, after-close, and unsanctioned special sessions;
5. require a fresh Kite quote with both `exchange_timestamp` and `last_trade_time` checks;
6. persist `decision_id`, `session_id`, `calendar_version`, `snapshot_id`, `quote_as_of`, `quote_source`, `build_sha`, `deployment_id`, `writer_version`, and database-generated `opened_at`;
7. store the signal trigger time separately; never let it become the fill timestamp;
8. enforce basic invariants in PostgreSQL as defense-in-depth.

---

## 6. Stop-ship finding register

### P0-01 — Invalid-session/future equity positions can be written

**Evidence:** screenshot rows plus unguarded `openPaperEquityTrade()` and caller-controlled `openedAt`.  
**Impact:** paper P&L, risk, drawdown, entry quality, holding duration, and strategy win rate are untrusted.  
**Fix:** writer-first canonical session/quote gate and DB-clock provenance.  
**Exit test:** exhaustive history returns zero invalid opens; boundary tests cover 09:14:59, 09:15:00, lane cutoff, 15:29:59, 15:30:00, weekend, holiday, special session, unknown year, stale quote, future quote, and cold-start cache.

### P0-02 — Public “read-only” mode can mutate trading state

`requireAuth()` bypasses all API authentication in public mode. `requireOwner()` allows anonymous GET/HEAD. Yet:

- GET `/paper/account` calls `ensureDailyReset()`;
- GET F&O/equity position and trade endpoints call `ensureDailyReset()`;
- `ensureDailyReset()` may reconcile or close stale F&O trades and update counters;
- GET combo list/detail lazily re-marks open combos and writes prices.

**Impact:** opening a page can alter records; anonymous public visitors can trigger hidden state transitions.  
**Fix:** GET/HEAD must be mechanically read-only; move maintenance to authenticated commands/workers; disable global public bypass; introduce an explicit redacted audit API.  
**Exit test:** database audit log and transaction counters prove zero INSERT/UPDATE/DELETE/DDL for every GET/HEAD route.

### P0-03 — F&O day rollover can create permanent cash drift

`ensureDailyReset("FNO")` now preserves balance, but `sweepStaleOpenPaperTrades()` still assumes the prior balance was wiped. It closes stale rows and writes realized P&L **without crediting proceeds/capital/charges**.

This comment/code pair is internally contradictory: the balance-preserving change invalidated the old stale-sweep accounting model.

**Impact:** deployed capital can remain stranded while the trade is marked closed; the ledger drifts permanently.  
**Fix:** one append-only, transactionally balanced settlement event per close; no state transition without cash/proceeds/charges entries in the same transaction.  
**Exit test:** crash at every statement boundary, retry, and next-day catch-up all preserve the full cash identity exactly.

### P0-04 — Missed 15:20 F&O force exit is not safely recovered

The 15:20 force close runs inside a sweep that first returns when `computeMarketStatus() !== "open"`. If the worker sleeps through 15:20 and resumes after 15:30, it misses the close. Next-day recovery uses the defective stale sweep above.

**Impact:** stale premium settlement and ledger drift; open overnight risk is hidden by a later `EXPIRED` close.  
**Fix:** durable scheduled jobs with session ownership and a catch-up state machine; never close from an unqualified stored premium.  
**Exit test:** process down from 15:19–15:40 and overnight; restart must produce a documented incident/queued resolution, not a fictitious fill.

### P0-05 — F&O account identity is unresolved and corrupts risk sizing

Replit evidence reports:

- seed capital: ₹2,00,000.00;
- capital events: ₹0.00;
- seven closed trades' realized P&L: ₹6,508.30;
- expected balance: ₹2,06,508.30;
- actual balance: ₹10,06,281.00;
- unexplained drift: **₹7,99,772.70**.

The UI then uses the corrupt cash as performance and as the risk/heat base.

**Impact:** position sizes and limits scale from unexplained money.  
**Fix:** incident quarantine; reconstruct from immutable events; post an owner-approved adjustment only if fully documented; return `riskBase=null` while unreconciled. Never reset or guess.  
**Exit test:** exact-zero unexplained drift, all close/open/capital events balanced, and 30 consecutive trading sessions with zero unexplained drift before paper opens are considered.

### P0-06 — Test and operational environments are not isolated

The screenshot with ten `TESTSTK/GAPTT` positions totals exactly ₹50,000 open capital, matching the value used to declare the equity ledger clean. The supplied source contains at least 22 API test files that can use `DATABASE_URL`; 11 call the shared pool's `end()`.

The supplied immutability test explicitly says it runs against the live dev DB, inserts an invalid `SILENT_DRIFT` row, and does not delete from `option_signal_plan_audit`. Replit later reported deleting six rows, with individual contents irrecoverable.

Historical memory also records TESTSTK alerts reaching a real Telegram bot. The working source now appears to contain a notification validator, but the runtime and historical deliveries remain unproved.

**Impact:** operational tables, reports, alerts, and reconciliation can be polluted by tests; evidence was destroyed during cleanup.  
**Fix:** mandatory `TEST_DATABASE_URL`, ephemeral database/schema, distinct DB role/host marker, test-only Telegram credentials or complete mocks, and a hard abort if a test points to a non-test database.  
**Exit test:** deliberately point tests at the operational DB and prove startup refuses; operational row counts/hashes and Telegram delivery log remain unchanged after full suites.

### P0-07 — Combo paper trading bypasses the main safety architecture

`paperTradingCombo.ts::openCombo()` has no canonical session/calendar gate, no common paper-auto/C0/system-mode gate, no account reconciliation gate, no shared F&O heat/drawdown budget, and no 15:20 forced-exit state machine.

Its capital calculation is also suspect:

```ts
grossDebitRupees = snap.netDebit * sum(snap.legs.qty)
```

`netDebit()` already sums `premium × leg.qty`; multiplying by total leg quantity double-counts quantity. Correct rupee debit should derive once from signed leg cash flows and lot size.

**Impact:** an isolated lane can open outside the session, mis-size capital, and create P&L outside the primary ledger.  
**Fix:** remove lane-specific accounting; all strategies emit one canonical execution decision and settle through one F&O journal. Use broker/exchange margin data or label estimates as model-only.  
**Exit test:** unequal-lot multi-leg property tests, shared heat concurrency tests, session boundary tests, charges, and forced/catch-up exits.

### P0-08 — Missing OI/volume data becomes a directional market opinion

`optionAnalytics.ts` sets PCR to `0` when the denominator is unavailable. The PCR UI tests bearish thresholds before checking insufficient OI, and volume PCR `0.00` is described as more call volume.

**Impact:** “no data” can render “strongly bearish.” This is analytical misinformation.  
**Fix:** nullable ratios with numerator, denominator, coverage, source, and as-of; insufficient-data check first; no sentiment, max-pain, flow, or confidence when coverage is inadequate.  
**Exit test:** zero denominator, missing side, partial chain, no prior snapshot, closed market, and stale chain all render `UNAVAILABLE/INSUFFICIENT`, never zero or directional bias.

### P0-09 — EOD reconciliation can falsely declare all ledgers consistent

`eodReconciliation.ts` checks open counts, missing P&L, and same-day gross P&L. It does not call the full lifetime account reconciliation before sending:

> “Paper ledgers are consistent.”

It is weekday-only rather than exchange-calendar-aware, and its interval has no immediate missed-job catch-up.

**Impact:** Telegram can report green while the F&O balance has ₹7.99 lakh unexplained drift.  
**Fix:** EOD status must include full cash identity, charges identity, event continuity, session validity, environment/build identity, and job completeness. `UNKNOWN` or any skipped critical check cannot produce a green message.  
**Exit test:** inject the known drift and prove the only outcome is `INCIDENT/BLOCKED`.

### P0-10 — Build, database, and runtime identity are not provable

The supplied source still contains code Replit says it fixed. Screenshots show datasets inconsistent with the queried database. The UI does not display a build/database fingerprint.

**Impact:** tests can be green for code that is not deployed, and database analysis can target the wrong environment.  
**Fix:** immutable deployment manifest and visible environment strip: build SHA, deployment ID, environment, DB host hash/OID, schema version, snapshot ID, market session, Kite state, broker state, and data age.  
**Exit test:** API, UI, log, DB audit row, and artifact checksum all agree in one captured proof bundle.

### P0-11 — Public session export exposes broker credentials behind the app password

`GET /api/kite/export-session` is exempt from the cookie gate and returns the Kite API key and access token when supplied the same password used for app login.

**Impact:** compromise/reuse of one shared password yields a trading-session credential.  
**Fix:** remove the route from public deployment or use a short-lived one-time peer exchange with dedicated secret, source allowlist, strict rate limit, audit log, and token envelope encryption.  
**Exit test:** anonymous/app-password-only requests cannot retrieve broker tokens.

### P0-12 — Manual exits can fabricate fills from stored prices

- Equity manual close always settles at `row.lastPrice` (or entry fallback).
- F&O manual close tries a fresh chain but falls back to stored `lastPremium` on failure.

**Impact:** an after-hours or data-outage click realizes P&L at a stale/non-executable price.  
**Fix:** distinguish `EXIT_REQUESTED`, `EXIT_EXECUTABLE`, `EXIT_FILLED`, and `MARK_ONLY`; require current bid/ask or exchange-defined settlement; otherwise queue or reject the paper fill.  
**Exit test:** after-hours, stale quote, no bid, missing contract, and chain failure never create a filled exit.

---

## 7. Swing-trading audit

### What is strong and should be preserved

- Provenance policy that Kite is required for trade-grade levels.
- Atomic account lock/debit and same-symbol/day idempotency.
- Stop sanity, drawdown, balance, open-count, and portfolio-heat checks.
- Separate signal/target geometry and visible source warnings.
- Decision audit concept and staged approval workflow.

### Remaining defects

1. **No writer-level session gate** — the confirmed invalid-trade cause.
2. **No authoritative fill model** — scanner LTP or caller trigger time becomes the fill; bid/ask and exchange timestamps are not frozen.
3. **Auto sizing is allocation-first, not pure risk-budget sizing.** It allocates account value by slots, then checks heat. A professional swing engine should derive quantity primarily from permitted loss, liquidity, gap risk, concentration, and cash constraints.
4. **Manual quantity overrides bypass the standard per-position allocation.** Heat/balance still apply, but the reason and owner authorization should be explicit and journaled.
5. **Staged approval in the supplied copy cannot satisfy its own Kite provenance gate.**
6. **Trading-day holding logic ignores exchange holidays.** The source says a 1–2 day difference does not matter; that is not an acceptable invariant for automated exits.
7. **Open prices and stop/target evaluation use cached LTP without a complete bar/tick ordering contract.** Gap-through stops require explicit fill rules.
8. **Autonomous performance is mixed with manual overrides.** Strategy evidence must exclude or separately cohort manual entries/exits.
9. **Sector and liquidity inputs are weak.** The scanner shows SM/ST/BZ names and sector `NSE EQ`; these cannot drive professional swing selection.
10. **Corporate actions are not demonstrated.** Splits, bonuses, dividends, symbol changes, surveillance series changes, and delistings need an immutable adjustment ledger.

### Required swing decision contract

Every candidate should persist:

- universe eligibility and series;
- liquidity/turnover and impact-cost grade;
- source snapshot and daily-bar cut;
- trend, regime, relative-strength, breadth, sector, and benchmark inputs;
- entry model and freshness;
- stop model, gap risk, risk per share, maximum loss, quantity, and concentration impact;
- all vetoes and numeric values tested;
- intended session, expiry/TTL, and revalidation policy;
- execution outcome or canonical block reason.

Do not tune thresholds until a clean shadow cohort exists. Off-session and test-polluted rows must never be used as strategy evidence.

---

## 8. F&O and option-analytics audit

### 8.1 Contract identity

The working source has corrected NIFTY/BANKNIFTY Tuesday expiry logic and the 2026 cost rates, but live use must resolve each contract from the current instrument master. Static lot-size maps previously went stale and oversized NIFTY paper trades.

For each F&O decision, freeze:

- exchange, segment, underlying, tradingsymbol, instrument token;
- actual expiry, option type, strike, tick size, lot size;
- instrument-master download date/hash;
- quote and depth timestamps;
- fallback reason if any. A fallback contract is research-only, never executable.

### 8.2 Signal and execution quality

- The main working-copy F&O writer has several fail-closed improvements. Preserve them.
- A C0 hard constant reported by Replit may block entry before ledger gates, but the supplied copy cannot prove that current deployed ordering.
- Entry economics need executable premium hierarchy: fresh ask for a buy, bid for a sell, depth, spread, volume/OI, and slippage model—not a theoretical premium presented as a fill.
- Expected edge must be net of brokerage, exchange charges, SEBI fees, GST, stamp duty, STT, spread, and conservative slippage.
- Missing/NaN inputs must block before comparisons; JavaScript comparisons with `NaN` can fail open.
- Shared Kite throttling, timeout, and OI backfill caps exist in the working copy, but runtime parity and queue-health telemetry are required.

### 8.3 OI, PCR, max pain, and flow

- OI is an exchange-wide stock, not proof of long or short creation by itself.
- “Put writing”/“call writing” cannot be inferred from OI alone without price/change and an explicit classification method.
- Zero OI change without a valid previous snapshot must be `NO_PRIOR_SNAPSHOT`, not zero flow.
- Post-close volume should be session cumulative; a zero/missing mapping must not become PCR 0.
- Max pain is descriptive/modelled and should never independently trigger a trade.
- Sentiment across Overview, PCR, and Multi-OI must use one `BiasResult` with one snapshot ID.

### 8.4 GEX is overstated

The UI labels a model as “Zero Gamma Level,” but the implementation:

- assumes calls are positive dealer gamma and puts negative from aggregate OI;
- cannot know dealer positioning from exchange aggregate OI;
- computes a cumulative per-strike crossing, rather than recomputing total GEX over hypothetical spot prices;
- omits the rupee/per-1%-move unit from headline numbers.

Rename it **“OI-weighted gamma proxy (modelled)”**. Remove “Zero Gamma Level” until a defensible spot-sweep model and positioning assumptions are documented. It must not feed execution or risk gates.

### 8.5 Option strategies and combos

- The screenshot showing Long Put max profit as unbounded is mathematically wrong. The working source appears to have corrected theoretical extrema, which again proves deployed/source version uncertainty.
- Suppress “suggested” when all legs are poor liquidity.
- Monte Carlo EV to the rupee is false precision; show assumptions, interval, and sample/model uncertainty.
- Multi-leg paper positions must use the primary ledger, cost model, heat cap, session service, and exit state machine.

---

## 9. Backtest audit

The captured run shows:

- 133 triggered/taken rows;
- only 25 decided rows with captured P&L;
- 108 stale/expired rows without captured option exit;
- 19 rows outside 09:15–15:30;
- gross P&L about −₹15,189;
- costs about −₹5,349;
- net P&L about −₹20,538.

### Confirmed methodology defects

1. `isSessionValid()` checks only time of day and explicitly does not consult an official calendar. Any weekend candle between 09:15 and 15:30 passes unless separately handled.
2. `buildReplayTrades()` accepts every row with `triggered_at`; it does not exclude invalid-session rows before performance construction.
3. Headline statistics use only decided trades, while the table presents 133 taken rows. The 25/133 denominator must be dominant, not hidden.
4. Real-premium replay must be unavailable when no option-chain snapshots exist.
5. A historical +05:30 persistence defect required a backfill script. Original timestamps and adjustment lineage must remain immutable/auditable.
6. The current sample is too small and selected to support claims of edge.

### Professional rebuild

- Versioned official exchange calendar including declared special sessions.
- Point-in-time instrument master and corporate-action data.
- No look-ahead: universe, indicator, contract, expiry, and quote must be available at the simulated decision instant.
- Bid/ask/spread/liquidity-based fills and gap rules.
- Net-cost ledger identical to paper trading.
- Walk-forward and untouched out-of-sample periods.
- Regime, index, setup, DTE, time-of-day, and liquidity cohorts.
- Purged/embargoed validation for overlapping signals.
- Confidence intervals, drawdown duration, tail loss, exposure, turnover, and capacity.
- Explicit rejected/unknown rows; invalid data never enters headline performance.

Minimum status today: **INSUFFICIENT TRUSTED EVIDENCE**, not profitable/not-profitable strategy validation.

---

## 10. Cross-tab data and UI truth audit

### Confirmed contradictions

- NIFTY values/change disagree across Home, OI Lab, Market Pulse, and Deep Scan.
- India VIX appears as 18.77, 13.15, and unavailable; historical reasoning rows also recorded values around 2–3 that match change-percent rather than VIX level.
- Full-scanner universe/scanned/live counts use different denominators.
- Full scanner prints scores when technical indicators are missing.
- Option-chain OI change and volume print zero when the evidence is missing.
- OI Lab produces multiple biases for the same instrument/snapshot.
- F&O diagnostics can say `OK` while all spot rows are unavailable.
- Market Pulse prose can say neutral, strong bearish, and gap-up in one plan.
- GIFT NIFTY is described in different modules as live TradingView/NSEIX, Yahoo, or not integrated.
- System health can show all systems operational while Telegram reports degraded/read-only due to Kite and DB failures.

### Canonical data architecture

“Same pipeline” should not mean one provider for every datum. It should mean one immutable envelope and one truth contract:

```text
MarketSnapshot
  snapshot_id
  build_sha / deployment_id / environment / db_fingerprint
  session_id / calendar_version / session_state
  instrument identity
  value + unit
  provider + raw source timestamp + ingested_at
  last_trade_time + exchange_timestamp where applicable
  freshness/coverage/quality grade
  transformation version
  warnings/blocking reasons
```

All tabs must render the same `snapshot_id` for the same metric. Client code must not independently recompute previous close, percent change, PCR, bias, or health.

### UI cleanup without feature loss

1. One compact global status strip: session, mode, Kite, DB, snapshot age, broker state, build, and environment.
2. Five data states only: `LIVE`, `EOD`, `DELAYED`, `MODELLED`, `UNAVAILABLE`.
3. Never display `0` for unknown. Use `—` plus a reason.
4. Net P&L is headline; gross and costs are secondary.
5. Every performance card displays sample size and eligibility denominator.
6. Merge OI Lab PCR/Max Pain/Gamma into Analytics without deleting content.
7. Merge duplicated Home/Markets and levels surfaces.
8. Hide or clearly label placeholders as Preview.
9. Shared chart component with units, autoscale, and true empty state.
10. Tables get sticky headers, column presets, filters, and responsive layouts.
11. Portfolio timestamps display full `YYYY-MM-DD HH:mm:ss IST`, source, session validity, and environment/build.
12. Preserve the strong honesty components: skip-reason funnel, data-quality exclusions, and explicit “not computable” notices.

---

## 11. Telegram and operations audit

### Confirmed scheduler problems

- Pre/post schedulers check weekday, not the canonical NSE calendar.
- They run only inside narrow 08:50–09:10 and 15:45–16:15 windows.
- An autoscale worker that sleeps through a window has no durable missed-job recovery.
- Database claim failure proceeds fail-open, allowing duplicate messages.
- `CONFIG_MISSING` burns the in-memory daily latch, so configuration recovery inside the window does not retry.
- In-memory alert dedup resets on cold start and is unsafe across replicas.
- UI delivery counters are not reconciled with manual-test messages.

### Required event/outbox model

Every notification should originate from one immutable domain event and use:

- deterministic event/idempotency key;
- intended session/date and calendar version;
- snapshot/build/database identity;
- destination and template version;
- outbox row, claim, attempt count, response code, delivered timestamp;
- `MISSED`, `FAILED`, `CONFIG_MISSING`, and `BLOCKED_DATA_INCONSISTENT` states;
- catch-up/incident logic after downtime;
- test destination isolated from production.

Pre-market and post-market reports must not send a directional conclusion when their canonical snapshot is incomplete or internally inconsistent.

### July 15–17 gap wording

The only defensible conclusion is:

> `PIPELINE_DID_NOT_REACH_DURABLE_REASONING_WRITER`.

Replit idle/sleep is a leading hypothesis, not a proved fact. Proving it requires deployment uptime logs, boot IDs, scheduler heartbeats, Kite-session history, DB connectivity logs, and durable per-cycle start/finish events.

---

## 12. Security, schema, and reproducibility

### Security

- Disable global public mode for all owner, paper-trade, admin, system, token, and subscriber surfaces.
- Replace shared-password owner auth with a proper owner identity, MFA where available, session revocation, shorter cookie TTL, CSRF protection, rate limiting, and auditable login events.
- Rotate all credentials that appeared in source/memory or were shared between environments.
- Remove `memory/test_credentials.md` and other secrets from distributable artifacts while preserving a confidential incident hash/reference.
- Separate development, test, staging, and production secrets, Telegram destinations, broker API keys, and databases.

### Schema/accounting defense-in-depth

The paper schemas lack comprehensive database CHECK constraints for positive quantities/prices, allowed status/source transitions, close-field consistency, and timestamp/session identities. Application-only unions are insufficient.

Use versioned migrations, not runtime `CREATE TABLE`/`ALTER TABLE` spread across request paths. Because the current repo has out-of-schema tables and known `drizzle-kit push` hazards, validate migrations against an isolated production clone and review every proposed destructive action.

### Reproducibility

Required from a clean clone:

1. lockfile-enforced install;
2. secret scan;
3. typecheck, lint, production build;
4. unit/property tests;
5. API tests against an ephemeral DB only;
6. scanner/browser tests;
7. migration up/down or forward-only clone validation;
8. build manifest/signature;
9. deploy once outside market hours;
10. prove served build and database identity.

The Replit report of 3,621 passing tests is encouraging but is not a release gate until these conditions hold.

---

## 13. Official fact verification

The audit rechecked the most execution-sensitive external facts against official sources:

- NSE equity and equity-derivatives regular sessions are 09:15–15:30, excluding Saturdays, Sundays, and declared holidays.
- NIFTY weekly/monthly options and BANKNIFTY monthly contracts use Tuesday expiry under the current specifications, adjusted to the preceding trading day for a holiday.
- Options are European style; UI education must not call them American.
- Lot sizes and quantity-freeze limits are periodically published and must be sourced from the current permitted-lot/contract file or instrument master.
- Kite full quotes distinguish the quote packet's exchange timestamp from `last_trade_time`; missing instrument keys must be handled explicitly.
- From 1 April 2026, option-sale STT is 0.15%; options stamp duty is 0.003% on the buyer side, and SEBI turnover fees are ₹10 per crore.

Primary references:

- NSE Market Timings & Holidays: https://www.nseindia.com/resources/exchange-communication-holidays
- NSE NIFTY 50 F&O: https://www.nseindia.com/static/products-services/equity-derivatives-nifty50
- NSE BANKNIFTY F&O: https://www.nseindia.com/static/products-services/equity-derivatives-banknifty
- NSE FINNIFTY F&O: https://www.nseindia.com/static/products-services/equity-derivatives-finnifty
- NSE Contract Information: https://www.nseindia.com/static/products-services/equity-derivatives-contract-information
- Kite Market Quotes: https://kite.trade/docs/connect/v3/market-quotes/
- NSE STT: https://www.nseindia.com/static/products-services/equity-derivatives-securities-transaction-tax
- NSE Other Levies: https://www.nseindia.com/static/invest/first-time-investor-sebi-turnover-fees-stt-other-levies

Regulatory implementation for any future real-money algorithm must be separately reviewed with the broker/compliance professional against current SEBI and exchange requirements. This report is technical, not legal advice.

---

## 14. Remediation roadmap in the correct order

### Phase −1 — Evidence freeze and identity baseline

**No application or database mutation.**

- Snapshot every relevant table with row counts, min/max timestamps, hashes, and schema.
- Export deployment/worker logs, environment flags, scheduler heartbeats, Kite session history, and Telegram delivery logs.
- Capture build SHA, deployment ID, exact Replit workspace commit, DB host hash/OID/name/schema, and UI screenshot together.
- Run the read-only invalid-session and ledger queries below.
- Classify the six deleted `SILENT_DRIFT` rows. If the owner accepts test-artifact classification, record why; otherwise declare irrecoverable evidence loss.
- Preserve original screenshots and prior reports; never rewrite or delete them.

**Exit:** one signed evidence manifest; no unexplained environment mismatch.

### Phase 0 — Containment

- Keep broker execution and every paper open lane disabled, including combo/manual/staged.
- Turn public mode off and remove credential export from public deployment.
- Provision isolated test DB/roles and test Telegram destination.
- Make every GET/HEAD route provably non-mutating.
- Quarantine F&O risk base and all performance claims.
- Add system-level `INCIDENT` status if any critical dependency or reconciliation is not PASS.

**Exit:** no new positions, no anonymous state changes, no test writes/messages to operational systems.

### Phase 1 — Canonical time, session, calendar, and durable jobs

- One exchange calendar/session service with versioned official source and explicit special sessions.
- Exact-time writer gates at all open/close/fill boundaries.
- Database clock for financial event timestamps.
- Durable job/outbox/heartbeat/catch-up for scan, 15:20 exit, EOD reconciliation, and Telegram reports.
- Quote-age, last-trade-time, exchange-timestamp, and future-clock checks.

**Exit:** boundary, holiday, special-session, future/stale quote, and sleep/restart tests all pass.

### Phase 2 — Unified append-only paper ledger

- One journal for cash, capital events, entries, exits, charges, adjustments, and combo legs.
- Reconstruct the F&O incident without deleting or guessing.
- Remove stale-sweep assumptions and settle every close atomically.
- Full reconciliation is the only source of ledger health.
- Risk/sizing unavailable while identity is not exact.

**Exit:** exact-zero drift and successful crash/retry/concurrency property tests. Start the 30-session clean clock only after all preconditions pass.

### Phase 3 — Canonical market snapshot pipeline

- Immutable snapshot envelope and one server-side derived-metric layer.
- Null/unknown contract across API, database, and UI.
- Single NIFTY/VIX/GIFT/PCR/bias/health value per snapshot.
- Current instrument master, series/liquidity eligibility, and coverage denominators.

**Exit:** automated cross-tab parity tests and no zero-filled missing data.

### Phase 4 — Swing shadow engine

- Risk-first sizing, execution-quality model, gap/corporate-action handling, and decision audit.
- Rebuild staged approval on current Kite data.
- Shadow only; no paper entry until clean observations are sufficient.

**Exit:** end-to-end trace for each candidate and at least 30 clean sessions with no invariant breach; strategy evaluation remains separate from plumbing validation.

### Phase 5 — F&O shadow engine

- Exact contract/depth identity; one execution-decision contract.
- Correct OI/PCR missing semantics and relabelled GEX proxy.
- Unified combo lane and realistic costs/slippage/margins.
- Durable lifecycle/force-exit/catch-up.

**Exit:** complete signal-to-net-P&L traces, no unknown critical gates, and a predefined untouched evaluation sample.

### Phase 6 — Backtest rebuild

- Point-in-time calendar/instrument/snapshot data, identical costs/fills, no invalid-session rows, walk-forward/OOS.

**Exit:** reproducible runs from immutable data; all denominators and exclusions explicit.

### Phase 7 — Professional UI, Telegram, and security review

- Consolidate—not delete—features; implement the truth/status/empty-state system.
- Canonical outbox notifications and missed-job incidents.
- Independent security and operational review.

**Exit:** signed release checklist. Live trading remains a separate owner decision and broker/compliance approval; it is never automatically enabled.

---

## 15. Non-negotiable acceptance suite

### Environment and evidence

- Tested commit equals deployed commit equals UI build ID.
- Database fingerprint displayed and logged.
- Full tests cannot connect to operational DB or Telegram.
- Evidence rows cannot be deleted by application/test roles.

### Session and quote invariants

- Zero historical opens outside an approved session.
- Zero future opens/quotes.
- Exact cutoff behavior at the second/millisecond.
- Unknown calendar closes entries.
- Quote missing/stale/future/last-trade-stale blocks entry.
- Warm disk cache cannot become an executable quote.

### HTTP/security invariants

- All GET/HEAD routes produce zero database writes/DDL.
- Anonymous and subscriber access cannot read owner accounts, trades, admin data, tokens, or security internals.
- No app password alone can export broker credentials.

### Ledger invariants

- `cash + open capital + cumulative net realized + capital movements + documented adjustments = canonical account equity` under the approved accounting policy.
- Every financial mutation has one idempotent journal event.
- Charges are frozen/versioned and included in risk/performance.
- Concurrent opens/closes and crash recovery preserve exact identity.
- EOD green is impossible with skipped critical checks or lifetime drift.

### Analytics invariants

- Missing is null, never zero.
- One snapshot gives identical price/change/VIX/PCR/bias/health on all tabs.
- Scores require minimum feature coverage.
- Modelled metrics carry formula, unit, assumptions, and cannot trigger execution.

### Research invariants

- Invalid-session/test/manual-contaminated rows excluded from autonomous evidence.
- Denominators and exclusions shown.
- No threshold changes during the locked sample.
- No claims of “perfect,” guaranteed accuracy, or a “money-generating machine.” The professional target is controlled risk, honest evidence, and positive out-of-sample expectancy after costs—not certainty.

---

## 16. Read-only forensic SQL pack

Run only after confirming the connection is the intended environment. Save output verbatim. Do not add UPDATE/DELETE/ALTER statements.

```sql
-- A. Environment/database fingerprint
SELECT current_database() AS db_name,
       current_user AS db_user,
       inet_server_addr()::text AS server_addr,
       inet_server_port() AS server_port,
       current_schema() AS schema_name,
       version() AS postgres_version,
       now() AS db_now;

-- B. Full equity open-time evidence, preserving timezone
SELECT id, symbol, source, writer_version, signal_date,
       signal_triggered_at, opened_at, created_at,
       qty, entry_price, capital_deployed, status
FROM paper_trade_eq
ORDER BY opened_at, id;

-- C. Obviously invalid/future equity rows by IST clock.
-- Join to the canonical exchange_session table once it exists; until then this
-- query identifies weekend/time candidates but is not a full holiday audit.
SELECT id, symbol, source, writer_version, signal_date, opened_at,
       opened_at AT TIME ZONE 'Asia/Kolkata' AS opened_ist,
       EXTRACT(ISODOW FROM opened_at AT TIME ZONE 'Asia/Kolkata') AS iso_dow,
       qty, entry_price, capital_deployed, status
FROM paper_trade_eq
WHERE EXTRACT(ISODOW FROM opened_at AT TIME ZONE 'Asia/Kolkata') IN (6, 7)
   OR (opened_at AT TIME ZONE 'Asia/Kolkata')::time < TIME '09:15:00'
   OR (opened_at AT TIME ZONE 'Asia/Kolkata')::time >= TIME '15:30:00'
   OR opened_at > clock_timestamp()
ORDER BY opened_at, id;

-- D. Exact timestamp clusters (boot/test/import signature)
SELECT opened_at, count(*) AS rows,
       array_agg(symbol ORDER BY symbol) AS symbols,
       sum(capital_deployed) AS capital
FROM paper_trade_eq
GROUP BY opened_at
HAVING count(*) > 1
ORDER BY opened_at;

-- E. Source/writer cohorts
SELECT source, writer_version, status, count(*) AS rows,
       min(opened_at) AS first_open, max(opened_at) AS last_open,
       sum(capital_deployed) AS capital
FROM paper_trade_eq
GROUP BY source, writer_version, status
ORDER BY source, writer_version, status;

-- F. F&O account and event identity inputs
SELECT * FROM paper_account ORDER BY segment;
SELECT segment, kind, amount, balance_after, created_at, note, created_by
FROM paper_capital_event
ORDER BY created_at, id;
SELECT id, signal_date, index_symbol, setup_key, status,
       opened_at, exited_at, entry_premium, exit_premium,
       lots, lot_size, capital_deployed, realized_pnl,
       gross_pnl, charges_total, net_pnl, charges_status,
       exit_reason, writer_version
FROM paper_trade_fo
ORDER BY opened_at, id;

-- G. Stale/force-exit cohorts
SELECT signal_date, exit_reason, status, count(*) AS rows,
       sum(capital_deployed) AS capital,
       sum(realized_pnl) AS gross_pnl
FROM paper_trade_fo
GROUP BY signal_date, exit_reason, status
ORDER BY signal_date, exit_reason, status;

-- H. Test-symbol contamination across known tables
SELECT 'paper_trade_eq' AS table_name, count(*) AS rows
FROM paper_trade_eq WHERE symbol ~* '^(TEST|DUMMY|SAMPLE|GAP)'
UNION ALL
SELECT 'swing_order_staging', count(*)
FROM swing_order_staging WHERE symbol ~* '^(TEST|DUMMY|SAMPLE|GAP)';

-- I. Deleted-row incident current state and constraint state
SELECT count(*) AS audit_rows,
       count(*) FILTER (WHERE reason = 'SILENT_DRIFT') AS silent_drift_rows
FROM option_signal_plan_audit;
SELECT conname, convalidated, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'option_signal_plan_audit'::regclass;

-- J. July 15-17 durable pipeline evidence only
SELECT generated_at AT TIME ZONE 'Asia/Kolkata' AS generated_ist,
       index_symbol, decision, reason_code, canonical_reason
FROM fno_signal_reasoning
WHERE generated_at >= TIMESTAMPTZ '2026-07-15 00:00:00+05:30'
  AND generated_at <  TIMESTAMPTZ '2026-07-18 00:00:00+05:30'
ORDER BY generated_at;
```

The permanent invalid-session query must join every trade to a canonical versioned `exchange_session` table, not merely use weekday/time heuristics.

---

## 17. Professional Replit prompt — execute only the next safe phase

Attach this report plus the prior audit/evidence files, then send the prompt below. Do **not** ask Replit to “fix everything” in one run.

> **ROLE AND OBJECTIVE**  
> You are the principal engineer and forensic trading-systems reviewer for MarketScannerByDev, an Indian-market analytical and paper-trading platform. Treat `NSESCANNER_REPLACEMENT_DEEP_AUDIT_AND_RECOVERY_PLAN_2026-07-20.md` as the latest governing audit. It supersedes earlier closure/release conclusions but does not erase prior evidence. Your immediate job is **Phase −1 evidence freeze and Phase 0 containment only**. Do not start strategy tuning, UI redesign, backtest optimisation, or later phases.
>
> **HARD SAFETY RULES**  
> 1. Broker execution stays disabled. All automatic, manual, staged, reconciliation/backfill, and combo paper **opens** stay disabled. Existing positions may not be silently modified.  
> 2. Do not deploy, publish, restart a market-hours workflow, merge, or change environment flags without explicit owner approval. No deploy from 09:00–15:30 IST.  
> 3. Do not run UPDATE, DELETE, TRUNCATE, DROP, ALTER, data backfill, constraint validation, balance reset, guessed capital event, or cleanup against any existing database. No destructive evidence handling.  
> 4. Do not change trading thresholds, scoring weights, vetoes, expiry rules, lot sizes, risk percentages, entry/exit geometry, or performance rows.  
> 5. Tests must not use the operational dev/prod database, production Telegram bot/chat, or live broker credentials. If isolated test infrastructure is absent, stop before running DB/integration tests.  
> 6. Do not trust HTTP GET to be read-only until its complete call graph is proved mutation-free.  
> 7. Do not assume this workspace equals the deployed build. Prove identity.  
> 8. Never delete prior reports, screenshots, logs, or incident rows. Preserve originals and append corrections.
>
> **STEP 1 — VERSION AND EVIDENCE BASELINE (READ-ONLY)**  
> Capture and return: Git commit/branch/dirty diff; build SHA; deployment ID; Replit workspace/environment; broker-enabled flags from workspace and deployment scopes; database name/user/server hash/OID/schema/migration version; Node/pnpm versions; source/archive SHA-256; worker boot ID and uptime; current canonical market status. Create an evidence manifest containing file paths, hashes, row counts, and timestamps. If the deployed build cannot be tied to the workspace commit, declare `BUILD_RUNTIME_PARITY_UNPROVED` and stop all behavioral conclusions.
>
> **STEP 2 — DATABASE FORENSICS (READ-ONLY)**  
> Run the audit's SQL pack against the exact database used by the captured UI. Export raw results without editing. Specifically classify every equity row by exchange session; identify the DLF 18 Jul 16:00:28 row, ADANIGREEN 14 Jul 19:02:54 row, and TITAN/EXIDEIND/GRASIM 09 Jul 23:41:35 cluster. Display full year and timezone. Trace source, writer version, signal/decision/staging IDs, created/opened timestamps, server logs, boot ID, and account journal for each. Do not delete or “correct” rows.
>
> **STEP 3 — EXECUTION-BOUNDARY CALL GRAPH (READ-ONLY FIRST)**  
> Enumerate every function that can INSERT an open position or transition OPEN/CLOSED for equity, F&O, and combos: auto, manual, staged approval, restart reconciliation, orphan/stale sweep, forced exit, API routes, scripts, and tests. For each, report session gate, system/C0 gate, quote source/age, contract identity, reconciliation gate, account transaction, database timestamp, and notification path. Prove which gate is the first executable line. Do not patch until this matrix is reviewed.
>
> **STEP 4 — GET/HEAD PURITY AND AUTHORIZATION MATRIX**  
> Enumerate every GET/HEAD route, auth middleware, and transitive DB mutation. Flag `ensureDailyReset`, reconciliation, stale close, mark-to-market, runtime DDL, cache persistence, or any INSERT/UPDATE/DELETE. Produce an anonymous/subscriber/owner status matrix. Prove `/api/kite/export-session` cannot expose credentials in the target design. No route changes until the matrix is delivered.
>
> **STEP 5 — TEST/TELEGRAM ISOLATION DESIGN**  
> Inventory every `DATABASE_URL`, pool, test setup, `pool.end`, Telegram sender, and broker credential consumer. Propose `TEST_DATABASE_URL` with an ephemeral database/schema and restricted role; hard-fail when test DB marker is absent; mock or use test-only Telegram. Include an acceptance test proving the full suite leaves operational DB counts/hashes and production Telegram delivery log unchanged. Do not run the current DB tests before isolation exists.
>
> **STEP 6 — INCIDENTS AND CONTAINMENT PROPOSAL**  
> Recompute the F&O cash identity; analyze the balance-preserving rollover versus stale-sweep non-credit bug; analyze missed 15:20 recovery; classify the deleted six `SILENT_DRIFT` rows without guessing; and propose append-only incident handling. Confirm all open lanes, including combo/manual/staged, are contained. Do not reset or backfill.
>
> **DELIVERABLE FORMAT**  
> Return exactly: (A) executive status; (B) environment/build/DB identity table; (C) evidence manifest; (D) invalid-trade row-by-row trace; (E) complete state-writer matrix; (F) GET/auth mutation matrix; (G) test/Telegram isolation plan; (H) ledger incident reconstruction; (I) proposed minimal Phase-0 code diff, migrations, and tests—proposal only; (J) blockers/owner decisions. Every claim must cite file/function or raw query/log evidence. Mark each item `PROVED`, `LIKELY`, `UNPROVED`, or `NOT APPLICABLE`.
>
> **STOP CONDITION**  
> Stop after delivering the evidence and proposed Phase-0 diff. Do not commit, mutate the database, run unsafe tests, deploy, or proceed to Phase 1 until the owner explicitly approves the reviewed proposal.

---

## 18. Final conclusion

The platform contains substantial useful analytical work, strong observability concepts, and several good fail-closed controls. It is not a fake project. However, the current evidence proves that the system is **not yet a trustworthy trading record or strategy-validation environment**.

The most important newly consolidated conclusion is:

> The visible P&L formulas can be arithmetically correct while the underlying trade is operationally impossible.

Off-session equity opens, a corrupted F&O account, hidden writes on GET, test/database contamination, isolated combo accounting, false missing-data sentiment, stale-price manual exits, and unproved build/runtime identity invalidate any current claim of trading accuracy or profitability.

The correct next move is not threshold tuning or a visual redesign. It is evidence freeze, containment, canonical time/session enforcement at every state-changing writer, test isolation, and one append-only accounting identity. Only after those foundations survive 30 consecutive clean trading sessions should shadow strategy evidence begin.

