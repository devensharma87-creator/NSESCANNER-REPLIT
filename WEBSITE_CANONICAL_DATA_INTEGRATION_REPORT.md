# Website-wide Canonical Data Integration — Report

This report tracks the P0 canonical-data initiative checkpoint-by-checkpoint. Each checkpoint
section below is self-contained; earlier checkpoints are not re-litigated in later sections.

---

## Checkpoint 1 — F&O Readiness + Telegram Report Data Connection (2026-07-03)

### 1. Phase 0 audit summary

The originating audit found three concrete defects in the F&O data-health / Telegram-report
surface:

- F&O warmup failures (`fnoFailureDiagnosis` / `alertWarmupFailures`) collapsed every distinct
  failure cause — missing intraday bars, missing daily bars, no live ticks, expired Kite session,
  market simply closed — into a single generic `UNKNOWN` reason, so the on-call owner couldn't
  tell a real outage from a normal closed-market state without opening `/fno-diagnostics`.
- Pre-market and post-market Telegram reports did not consume any real F&O readiness signal.
  Several sections printed `"Unavailable — not tracked yet"` even when the underlying readiness
  data existed and could have been rendered.
- There was no safe way to preview a report's exact rendered text/data without it counting as a
  real send (mutating the `daily_report_runs` dedup row) — every "test" of report content was a
  live Telegram message.

### 2. What was fixed now

- `fnoFailureDiagnosis.ts`: reason classifier now distinguishes `INTRADAY_BARS_MISSING`,
  `DAILY_BARS_MISSING`, `WEBSOCKET_NO_TICKS`/`KITE_FEED_NO_TICKS`, `KITE_SESSION_EXPIRED`, and
  `MARKET_CLOSED` (explicitly non-critical), each with a distinct owner-facing message. Wired
  into `kiteWarmup.ts` / `fnoSignalAlerts.ts`; the alert remains a single digest (no per-index
  spam regression).
- `canonicalFnoReadiness.ts` (new pure adapter, Part B): composes already-computed Kite
  session/feed/bars/option-chain/signal-cycle facts into one `CanonicalFnoReadiness` object plus
  a derived label (`READY` / `PARTIAL` / `DATA_BLOCKED` / `MARKET_CLOSED` / `NO_SETUP`). No new
  data sources, no new polling — pure composition.
- Pre-market and post-market report builders (`dailyReports.ts`) now source F&O status entirely
  from `CanonicalFnoReadiness` instead of ad hoc fields; `SOURCE_NOT_INTEGRATED` providers (GIFT
  Nifty, overnight global cues, India VIX, FII/DII, news/events) collapse into one footer instead
  of ten placeholder sections, keeping Telegram compact while `/daily-analysis` keeps full detail.
- `GET /api/daily-analysis/telegram/preview?type=pre|post` (Part E): renders the exact report
  text + underlying data contract by calling the pure gatherer/builder directly — never
  `sendPreMarketReport`/`sendPostMarketReport` — so it cannot send Telegram or mutate dedup state.
  Gated with `requireOwnerStrict` (blocks anonymous access even in public-access mode).
- Full test rewrite of `dailyReports.test.ts` (Part F) plus a new route-auth/contract test file
  for the preview endpoint.

### 3. What was intentionally deferred

- Scanner/charting/option-chain data-source migration (out of Checkpoint 1 scope per the
  governing spec).
- Any strategy, threshold, sizing, broker, or order-path change — none was touched.
- Production republish/live verification — see §11.
- The remaining 10 phases of the broader P0 canonical-data initiative (tracked separately;
  follow-up refs #132/#133 already filed).
- Wiring the preview endpoint's F&O readiness data into any UI page — Checkpoint 1 is
  API/report-text only, no frontend page changes.

### 4. F&O warmup reason mapping

| Reason code | Meaning | Owner-facing message |
|---|---|---|
| `KITE_SESSION_EXPIRED` | Kite auth token expired/missing | "Reconnect Zerodha (Kite session expired)." |
| `MARKET_CLOSED` | Market genuinely closed — not a failure | "Market is closed — data refreshes automatically next session." |
| `DAILY_BARS_MISSING` | Daily historical bars unavailable | "Daily historical bars unavailable — trigger a Kite warmup or check /fno-diagnostics." |
| `INTRADAY_BARS_MISSING` | Intraday historical bars unavailable | "Intraday historical bars unavailable — trigger a Kite warmup or check /fno-diagnostics." |
| `WEBSOCKET_NO_TICKS` / `KITE_FEED_NO_TICKS` | Live tick feed disconnected | "Live tick feed (KiteTicker WebSocket) disconnected — check the feed connection; retries automatically." |

`MARKET_CLOSED` is explicitly treated as non-critical and does not raise the same alert severity
as the other four. All five reasons replace the previous single `UNKNOWN` bucket. The alert
remains one digest across NIFTY/BANKNIFTY/SENSEX (no per-index message regression).

### 5. CanonicalFnoReadiness contract

Pure composition, no new I/O. Key shape (`canonicalFnoReadiness.ts`):

- `kiteSession: "ACTIVE" | "MISSING" | "EXPIRED" | "UNKNOWN"`
- `feedStatus: "CONNECTED" | "DISCONNECTED" | "STALE" | "UNKNOWN"`
- `marketSession: "preopen" | "open" | "closed" | "holiday" | "unknown"`
- `dailyBars` / `intradayBars`: `{ status: READY|PARTIAL|MISSING|UNKNOWN, readyCount, totalCount, reason? }`
- `optionChain: { status: READY|PARTIAL|MISSING|STALE|UNKNOWN, reason? }`
- `signalCycle: { status: READY|NO_SETUP|DATA_BLOCKED|MARKET_CLOSED|UNKNOWN, generatedSignals, tradeableSignals, suppressedSignals }`
- `deriveFnoReadinessLabel(r)` → single top-line label: `READY | PARTIAL | DATA_BLOCKED | MARKET_CLOSED | NO_SETUP`, used by both reports and, in principle, any future UI surface.

### 6. Pre-market before/after example

**Before** — F&O status was a hardcoded placeholder regardless of real readiness:

```
F&O: Unavailable — not tracked yet
```

**After** — driven by `CanonicalFnoReadiness`:

```
Kite: ACTIVE
Feed: CONNECTED
Market mode: open
F&O readiness: READY
Daily bars: 3/3
Intraday bars: 3/3
Option chain: READY
Signals: 4 generated | 2 tradeable | 2 suppressed
```

(When readiness is `DATA_BLOCKED`/`NO_SETUP`, an extra `Status: <label> — <reason>` line is
appended instead of silently omitting the gap.)

### 7. Post-market before/after example

**Before**: ten near-identical `"Unavailable — not tracked yet"` sections regardless of which
providers were actually integrated, and F&O signal/paper-trade counts were not rendered at all.

**After** — compact, only real sections expand, everything else folds into one footer:

```
Market close:
NIFTY: 24,512.30 (+0.42%) H 24,580.10 L 24,410.55
(Kite, as of 15:30 IST)

F&O:
Signals: generated 4 | tradeable 2 | suppressed 2
Paper trades: opened 2 | closed 1 | open 1
Realized P&L: +₹1,240
Exit monitor: DEV_VERIFIED

Swing staging:
Pending 3 | Approved 1 | Expired 0

Not included this run — data source not integrated yet:
GIFT Nifty, overnight global cues, India VIX, FII/DII, news & events
```

### 8. Preview endpoint evidence

`GET /api/daily-analysis/telegram/preview?type=pre|post` (exact route; the spec's suggested
`/api/daily-reports/telegram/preview` name does not match this codebase's existing
`dailyAnalysisRouter` mount point, so the equivalent endpoint under the existing `/daily-analysis`
namespace was used and documented here, per the spec's "if equivalent routes already exist, use
them and document exact names" instruction).

- Auth: `requireOwnerStrict` — verified this rejects anonymous access with `401` even when public
  read-only mode is enabled (unlike `requireOwner`, which would let a GET through).
- Calls `gatherPreMarketData`/`gatherPostMarketData` + `buildPreMarketReport`/
  `buildPostMarketReport` directly — never `sendPreMarketReport`/`sendPostMarketReport`.
- Response always includes `isManualTest: true`, `telegramSent: false`,
  `dedupStateChanged: false`, `brokerExecution: "DISABLED"`.
- No secrets in the response body (checked in the route contract test).

### 9. Tests and counts

| Suite | Result |
|---|---|
| `dailyReports.test.ts` (rewritten, Part F) | 83/83 passed |
| `dailyAnalysisTelegramPreviewRoute.test.ts` (new) | 13/13 passed |
| Scoped Part F regression (fno\*/daily\*/alerting/paper\*/routes **tests, 48 files, chunked 4-way) | 874/874 passed (381 + 206 + 173 + 114) |
| `@workspace/scanner` full suite | 762/762 passed (35 files) |
| `pnpm run typecheck` (all 5 workspace packages: api-server, global, mockup-sandbox, scanner, scripts) | clean |

No pre-existing test was weakened or skipped to make these pass; all `dailyReportsDedupContract`,
alerting, paper-trading, and route-auth suites in scope stayed green.

### 10. LLM index status

`pnpm --filter @workspace/scripts run index:llm` regenerated cleanly (336 tracked files, 526
summarized). `index:llm:check` confirms **fresh** — all 336 tracked files match the manifest.

### 11. Production verification status — PERFORMED 2026-07-04

Published to production (autoscale, `https://marketscannerbydev.in`) at deploy `0f48ee3`, which
contains this checkpoint's code unchanged since implementation commit `70ae0b7`
(`git diff --stat 70ae0b7 a18b8de` shows only an unrelated attached-assets `.txt` file was added
after `70ae0b7`; `a18b8de → 0f48ee3` is the publish marker with no further code changes). All
verification below was run against the live deployment using the owner's real session (logged in
via `POST /api/auth/login` with the `APP_ACCESS_PASSWORD` secret read programmatically — the value
was never displayed, printed, or requested from the user), or via the workspace's committed test
suite run unmodified against the identical deployed source tree. No real Telegram messages were
sent, no orders were placed, and no dedup state was mutated.

**Part H checklist results (21 items):**

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Prod build contains checkpoint code | ✅ CONFIRMED | Git diff shows zero code drift `70ae0b7→a18b8de→0f48ee3`; live preview endpoints return the Checkpoint-1-only `CanonicalFnoReadiness` JSON shape (fields that do not exist pre-checkpoint) |
| 2 | `/api/healthz` returns 200 | ✅ CONFIRMED | `curl` → `200 {"status":"ok"}` |
| 3 | Preview routes exist and are registered | ✅ CONFIRMED | Owner-auth calls to both `?type=pre` and `?type=post` return 200 with full contract; deployment logs show the exact request lines |
| 4 | Anonymous access blocked | ✅ CONFIRMED | Both preview endpoints + a nonexistent path all return `401 {"error":"unauthorized","code":"AUTH_REQUIRED"}` |
| 5 | Owner-authenticated preview works | ✅ CONFIRMED | 200 JSON for both `pre` and `post` after owner cookie login |
| 6 | Response contract matches spec | ✅ CONFIRMED | `telegramSent`, `dedupStateChanged`, `data.canonicalFno`, `data.indexPerformance` etc. all present and correctly typed |
| 7 | Preview never sends real Telegram | ✅ CONFIRMED | `telegramSent:false` on both calls |
| 8 | Preview never mutates dedup state | ✅ CONFIRMED | `dedupStateChanged:false` on both calls; `/api/daily-analysis/status` `lastPreMarket`/`lastPostMarket`/`recentHistory` count identical before and after |
| 9 | No secrets/tokens leaked in response | ✅ CONFIRMED | Reviewed both full response bodies — no keys, tokens, or session data present |
| 10 | Pre-market weekday-detail fields render correctly | ⚠️ PARTIAL (environmental, not a defect) | Prod wall-clock was Saturday 4 Jul 2026 IST during this run, so the live text used the intentional weekend short-message branch, not the full weekday-detail branch. The underlying `data.canonicalFno` fields (Kite `ACTIVE`, feed `CONNECTED`, bar counts, option-chain status, signal cycle, `telegramSummary`) were all populated with real computed values, not placeholders. The full weekday formatting is exercised by 83/83 passing `dailyReports.test.ts` cases against this exact deployed code, but was not observed live today. |
| 11 | Post-market weekday-detail fields render correctly | ⚠️ PARTIAL (same environmental reason) | Same weekend short-circuit; `indexPerformance.rows` populated with real NIFTY/BANKNIFTY/SENSEX data; full weekday format covered only by unit tests, not live observation |
| 12 | Warmup reason codes are specific, never `UNKNOWN` | ⚠️ NOT LIVE-OBSERVABLE TODAY | No warmup cycle has run in this fresh deploy's short log window (published minutes before this check, and it's a non-trading weekend day) — nothing to grep. Verified instead via 100%-passing `fnoFailureDiagnosis.test.ts` (part of the 4-chunk run below) against the identical deployed module |
| 13 | Warmup failures fire one consolidated digest, not per-index spam | ⚠️ NOT LIVE-OBSERVABLE TODAY | Same reason as #12 — no warmup cycle ran. Verified via code (`FNO_WARMUP_DIGEST_DEDUP_MS`, single IST-day dedup key, consolidated message text) and passing `fnoDataHealthAlerts.test.ts`/`fnoSignalAlerts.test.ts` |
| 14 | Broker execution disabled | ✅ CONFIRMED | `brokerExecution: "DISABLED"` present in both live preview payloads |
| 15 | No real orders placed | ✅ CONFIRMED | This checkpoint touches zero order-placement code paths; nothing in the diff to place an order |
| 16 | No Telegram spam | ✅ CONFIRMED | Dedup status endpoint unchanged pre/post; passing dedup test suites; no repeated messages in the reviewed boot-window logs |
| 17 | `/api/data-health/global` still works | ✅ CONFIRMED | 200 with full payload |
| 18 | Telegram alert dedup still works | ✅ CONFIRMED | Live boot log shows `systemAlertDedup self-test: ALL CHECKS PASSED`; `systemAlertDedup.test.ts` + `systemAlertDedupSelfTest.test.ts` both green |
| 19 | Swing TTL sweep scheduler still green | ✅ CONFIRMED | Live boot log shows the scheduler starting (10-min interval, all-owners expiry); `swingAlerts.test.ts` green |
| 20 | F&O exit monitoring remains at its prior verdict | ✅ CONFIRMED UNCHANGED | This checkpoint's diff does not touch exit-monitoring code; `FNO_EXIT_MONITORING_RELIABILITY_REPORT.md` verdict remains `FNO_EXIT_MONITORING_DEV_VERIFIED` (owner-accepted 2026-07-03), untouched by this work |
| 21 | Test/typecheck/index counts re-run against the deployed tree | ✅ CONFIRMED | See table below |

**Re-run test/typecheck evidence (2026-07-04, against the exact deployed source tree):**

| Suite | Result |
|---|---|
| Targeted api-server report/F&O/alert/data-health suite (27 files, chunked 4-way) | 713/713 passed (194 + 138 + 217 + 164) |
| `@workspace/scanner` full suite | 762/762 passed (35 files) |
| `pnpm run typecheck` (all 5 workspace packages) | clean |
| `index:llm:check` | fresh — 336/336 tracked files match |

**Honest gap summary:** items 10, 11, 12, and 13 could not be observed against live weekday
production traffic during this verification window because production's wall-clock fell on a
non-trading Saturday and the deployment had only minutes of log history since publish (no warmup
cycle had run). This is a timing/environmental fact, not a code defect or missing data source —
the same code paths are exercised and passing in the automated suite run directly against the
deployed commit, and the live responses already show real computed values (not "Unavailable — not
tracked yet" placeholders) flowing through the weekend branch. **Recommended (non-blocking)
follow-up**: a brief spot-check of the pre-market and post-market preview endpoints on the next
trading day to visually confirm the full weekday-detail Telegram text and to grep deployment logs
for a live warmup reason code / consolidated digest, purely to close out items 10–13 with direct
observation rather than test-suite inference.

### 12. Next checkpoint recommendation

Checkpoint 1 is complete and production-verified. Proceed to the next phase of the broader P0
canonical-data initiative (already tracked via follow-up refs #132/#133) as separately scoped work
— do not widen Checkpoint 1's surface retroactively.

---

**Checkpoint 1 final verdict: `CANONICAL_DATA_CHECKPOINT_1_PROD_VERIFIED`**

Published to production, confirmed live at commit `70ae0b7`-equivalent (no code drift since). All
directly-observable production safety and functional checks (auth gate, no real Telegram sends, no
dedup mutation, no secret leakage, broker disabled, no orders, existing dedup/TTL/exit-monitoring
systems unaffected) passed against the live deployment. The full weekday-detail Telegram text and a
live warmup reason-code/digest observation could not be captured today because production's
wall-clock is on a non-trading weekend and the deploy is fresh — both are proven correct via the
full passing test suite (713 targeted api-server tests + 762 scanner tests, clean typecheck, fresh
LLM index) run against the identical deployed code, and are recommended as a lightweight follow-up
spot-check on the next trading day (see §11).

---

## Checkpoint 2 — Swing ↔ Paper Trading Lifecycle Source/Link Audit + Fix (2026-07-03)

### 1. Phase 0 audit summary

- `openPaperEquityTrade` already took `opts.source: "AUTO" | "MANUAL"` (passed through to
  `recordEqDecision`'s audit row), but the `paper_trade_eq` row itself carried **no** source or link
  column — every position/closed-trade in the UI and API was indistinguishable by origin.
- `runEquityPaperTradingTick` always calls with `AUTO`; `openManualPaperEquityTrade` always calls
  with `MANUAL`. Confirmed by reading both call sites — no third caller exists today.
- `approveSwingOrder` (the Swing Queue "approve" action) **never** calls `openPaperEquityTrade`. The
  swing-staging approval pipeline is fully separate, dry-run/broker-disabled by design. Any UI text
  implying a swing-approved order becomes a paper trade would be a fabrication — confirmed false by
  reading the code path end to end, not assumed.
- Prod data pulled during Phase 0 (read-only): an `INDUSINDBK` `paper_trade_eq` OPEN row with a
  matching `paper_eq_audit` source=`AUTO` pair and zero `swing_order_staging` rows for that symbol
  (100% auto-originated, unconnected to swing staging); a `RELIANCE` `swing_order_staging` row that
  expired in staging with **zero** corresponding `paper_trade_eq`/`paper_eq_audit` rows (staged order
  expired without ever becoming a paper trade — exactly as the code predicts, not a bug).

### 2. What was fixed

- **DB (additive only)**: `paper_trade_eq` gained nullable `source TEXT` (enum-by-convention:
  `AUTO_STRONG_BUY | SWING_STAGED_APPROVAL | MANUAL_BUY | LEGACY_UNKNOWN`) and nullable
  `staged_order_id TEXT` (no DB-level FK, reserved for a future swing→paper wiring that does not
  exist yet); `paper_eq_audit` gained nullable `paper_trade_id TEXT`. Applied via
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (never `drizzle-kit push`, which would have tried to
  drop unrelated out-of-schema tables — see memory `drizzle-push-drops-out-of-schema-tables`).
- **Idempotent backfill**: `applyPaperEqProvenanceColumns()` correlates every pre-checkpoint
  `paper_trade_eq` row against its matching `paper_eq_audit` OPENED row (by symbol + IST day) to
  stamp `AUTO_STRONG_BUY` / `MANUAL_BUY` and back-link `paper_eq_audit.paper_trade_id`; any row still
  unmatched is honestly labeled `LEGACY_UNKNOWN` — never fabricated as `AUTO`/`MANUAL`. Re-running is
  a guaranteed no-op (never re-stamps an already-sourced row). Verified against the dev DB: real rows
  now show `CIPLA/ASIANPAINT/BERGEPAINT → AUTO_STRONG_BUY`, older rows predating the audit trail
  (`MOTHERSON`, `LICHSGFIN`, `AARTIIND`, `MARICO`, `SIEMENS`, `BAJAJ-AUTO`, `GODREJPROP`, ...) →
  `LEGACY_UNKNOWN`. Zero `staged_order_id` values are populated anywhere (correct — no live caller
  produces one yet).
- **Write path**: new trades now stamp `source` at creation time (`AUTO`→`AUTO_STRONG_BUY`,
  `MANUAL`→`MANUAL_BUY`) and thread the new trade's id into the OPENED `recordEqDecision` call so
  `paper_eq_audit.paper_trade_id` is set going forward without a backfill dependency.
- **Lifecycle diagnostic endpoint**: `GET /api/paper/lifecycle/:symbol` (owner-only, symbol validated
  `/^[A-Z0-9&-]{1,20}$/i`) returns the full cross-table picture for one symbol — `paper_trade_eq` rows
  (with `source`/`stagedOrderId`), `paper_eq_audit` rows, `swing_order_staging` rows, and
  `notification_delivery_log` rows — plus a pure `summary` block (`tradeCount`,
  `tradesMissingSource`, `stagingOrderCount`, `expiredWhilePendingCount`, `notificationCount`).
- **UI**: `paper-trading.tsx` open-positions and closed-trades tables (equity segment) gained a
  tone-coded `EqSourceBadge` "Source" column (`AUTO` / `MANUAL` / `SWING QUEUE` / `LEGACY`, the last
  with a tooltip honestly explaining it predates provenance tracking). `swing-cash.tsx`'s `OrderCard`
  gained an explicit "Paper trade link: not converted (staged-only)" note next to the existing
  "Approval does NOT place a real order" badge — reflecting the confirmed Phase 0 reality that
  approval never opens a paper trade, with no fabricated link ever rendered.
- **Reports/infra health**: audited `dailyReports.ts` and `infraHealth.ts` for any swing→paper
  linkage assumption — found none. The post-market report's "F&O:" and "Swing:" sections were
  already reported as two separate, non-conflated blocks; no change was needed (verified no-op, not
  skipped).

### 3. What was intentionally deferred / out of scope

- Wiring `approveSwingOrder` to actually open a paper trade (would create `SWING_STAGED_APPROVAL`
  sources) — explicitly out of scope per the coder prompt ("no forcing trades into Swing Queue").
  `SWING_STAGED_APPROVAL` exists in the type union and UI badge set as forward-compatible plumbing
  only; zero live rows will ever carry it until that future work is separately scoped and approved.
- No strategy, threshold, sizing, or broker-execution changes. No destructive migrations — every
  schema change is an additive nullable column.

### 4. Tests

- `paperEqLifecycleSummary.test.ts` (new, 7 tests): pure `computeLifecycleSummary()` covering missing
  source, empty-string source, expired-while-pending detection, non-actionable staging rows, and an
  empty-symbol edge case.
- `paperTradingEqProvenance.test.ts` (rewritten, 7 tests): 4 pure `mapWriteSourceToProvenance`
  mapping tests + 3 live dev-DB tests covering (a) AUTO-audit correlation + back-link + backfill
  idempotency, (b) an orphan trade row (no matching audit row) correctly resolving to
  `LEGACY_UNKNOWN` and never being fabricated as AUTO/MANUAL, (c) an already-sourced row never being
  overwritten even when a contradicting audit row exists. These use real insert + `finally`-block
  cleanup rather than the usual tx-rollback pattern, because `applyPaperEqProvenanceColumns()`
  re-issues `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` on every call, which always takes an ACCESS
  EXCLUSIVE lock even as a no-op — running it from a separate pool connection while a test
  transaction held open row locks on the same table deadlocked until timeout; switching to
  real-commit + explicit cleanup avoided the cross-connection lock conflict entirely.
- Owner-only auth on the lifecycle endpoint has no supertest/route-level test precedent anywhere in
  this codebase (confirmed by grep — zero hits); left as curl-verified only (401 unauthenticated /
  200 owner / 400 malformed symbol), consistent with the pre-existing
  `owner-only-e2e-auth-limitation` constraint (owner is a shared-secret cookie, not a DB user row, so
  the standard Playwright "[DB] elevate to admin" trick does not apply).
- Full regression run: 16 files / 213 tests passed (`paper*.test.ts` + `dailyReports*.test.ts`,
  `--pool=threads`), plus the full `pnpm run typecheck` (libs + api-server + scanner + global +
  mockup-sandbox + scripts) — all clean.

### 5. Dev verification (performed 2026-07-03)

- Live curl against the dev API server (owner-authenticated, cookie login via
  `POST /api/auth/login` using the `APP_ACCESS_PASSWORD` secret — never displayed or printed):
  - `GET /api/paper/lifecycle/INDUSINDBK` → 200, `paperTrades: []`, `stagingOrders: []` (that
    specific position has since closed/rotated out of the live book; endpoint behaves correctly on a
    now-empty symbol).
  - `GET /api/paper/lifecycle/RELIANCE` → 200, `paperTrades: []`, `stagingOrders: [3 EXPIRED rows]`,
    `notifications: [3 rows]` — matches the Phase 0 finding exactly: staged orders expired without
    ever becoming paper trades, `summary.tradeCount: 0`, `summary.stagingOrderCount: 3`.
  - Direct dev-DB query (`psql`, read-only) on `paper_trade_eq` confirms the backfill converged
    correctly: real historical rows show `AUTO_STRONG_BUY` (recent, audit-trail-covered) and
    `LEGACY_UNKNOWN` (older, pre-audit-trail) — no row left `NULL`, no row misclassified.
- Full Playwright browser e2e login is blocked by the pre-existing owner-only shared-secret-cookie
  limitation (the login screen requires an email/password DB user; the owner is a separate
  cookie-based identity) — substituted curl + direct DB verification per that established precedent
  instead of grinding on browser login.

### 6. Production verification status — PERFORMED 2026-07-04

Published to production (autoscale, `https://marketscannerbydev.in`) at workspace HEAD `02c5418`
("Published your App") on top of `ff9c651` (this checkpoint's code commit); `getDeploymentInfo()`
confirms `hasSuccessfulBuild: true`. All checks below were run against the live deployment using the
owner's real session (`POST /api/auth/login` with the `APP_ACCESS_PASSWORD` secret read
programmatically — never displayed, printed, or requested from the user), direct read-only queries
against the production DB replica (`environment: "production"`, SELECT-only), and production
deployment logs. No fake trades were created, no real Telegram was sent, no owner password was
requested from the user, and no destructive or write migration was run against production.

**Part A/C — Deploy + endpoint security:** ✅ CONFIRMED. `/api/healthz` → 200. Anonymous GET to
`/api/paper/lifecycle/INDUSINDBK`, `/RELIANCE`, and a malformed-symbol path (`..%2F..%2Fbad`) all
return `401`. Owner-authenticated: `INDUSINDBK` → 200, `RELIANCE` → 200, malformed symbol → `400
{"error":"Invalid symbol format"}`.

**Part D — INDUSINDBK:** ✅ CONFIRMED (resolved during this pass — see Part B). `GET
/api/paper/lifecycle/INDUSINDBK` (owner) → 200, `paperTrades[0].source: "AUTO_STRONG_BUY"`,
`summary.tradesMissingSource: 0`. The linked `paper_eq_audit` row is present and correlates correctly
(`decision: "OPEN"`, `source: "AUTO"`, same IST calendar day as the trade's `signalDate`).

**Part E — RELIANCE:** ✅ CONFIRMED matches Phase 0 expectation. 0 `paper_trade_eq` rows, 1 `EXPIRED`
staging row, `paperTrades: []` — no fabricated swing→paper link. `stagedOrderId` is `null` on every
`paper_trade_eq` row site-wide (0/36) — correct, since `approveSwingOrder` never calls
`openPaperEquityTrade` (confirmed again by re-reading `mapWriteSourceToProvenance`'s own doc comment
in `paperTradingEq.ts`, which explicitly labels `SWING_STAGED_APPROVAL` "reserved... no live caller
passes anything but AUTO/MANUAL today" — an intentional, self-documented architecture boundary, not a
hidden gap).

**Part B — Schema + backfill convergence — RESOLVED live, mid-verification:** Direct read-only
production DB query at the **start** of this pass showed `paper_trade_eq.source` `NULL` on all 36/36
rows — reproducing the prior pass's finding exactly. A **re-query roughly 10–15 minutes later** (after
the process had run its periodic `evaluateOpenEquityPositions` mark-to-market tick at least once) showed
the backfill had converged: **30/36 rows → `AUTO_STRONG_BUY`** (each correlated to a real
`paper_eq_audit` row, and `paper_eq_audit.paper_trade_id` now back-linked for the same 30 rows) and
**6/36 rows → `LEGACY_UNKNOWN`**. The live API (`/api/paper/lifecycle/INDUSINDBK`) was re-fetched and
independently confirms the same state (`source: "AUTO_STRONG_BUY"`, `tradesMissingSource: 0`) — this is
not a read-replica artifact, the app's own DB connection reports the same value.

Root cause of the two-phase observation, confirmed from `paperTradingEq.ts`'s own doc comments and
call sites: `ensurePaperEqProvenanceColumns()` is memoized **per process**, and only invoked from
`openPaperEquityTrade` / `evaluateOpenEquityPositions`. A freshly booted/restarted autoscale replica
therefore serves `NULL` source until the *first* call to either function in its lifetime — which, for
`evaluateOpenEquityPositions`, is gated behind that replica's own periodic mark-to-market schedule, not
instant on boot. This pass's process (booted ~06:14 UTC today) crossed that first-tick threshold
partway through verification, which is exactly the transition observed. This is the **same lazy-trigger
design** flagged as a "timing/environmental gap" in the prior pass's report — that gap is now
demonstrated, live, to close itself correctly without any agent action, exactly as predicted.

The 6 `LEGACY_UNKNOWN` rows were individually checked and are legitimate, not a bug: all 6
(`CROMPTON`, `RBLBANK`, `LAURUSLABS`, `GODREJPROP`, `JINDALSTEL`, `MARICO`) were opened
2026-04-29 → 2026-05-05, which **predates the earliest `paper_eq_audit` row in the entire database**
(2026-05-13) — there is structurally no audit row that could ever correlate to them, so the backfill
correctly leaves them honestly unattributed rather than guessing. `paper_eq_audit.source` has zero
`'MANUAL'` rows in production (1,913/1,913 are `'AUTO'`), so no `MANUAL_BUY` trades exist yet either —
consistent with production having only ever run the autonomous tick to date.

Frontend fabrication check (`paper-trading.tsx`): `EqSourceBadge` defaults a `null`/`undefined` source
to the same `LEGACY_UNKNOWN` badge and tooltip used for genuine legacy rows — so even during the
narrow pre-first-tick window on a freshly booted replica, the UI never invents a false `AUTO`/`MANUAL`
attribution; worst case it shows the same honest "cannot be attributed" state a moment early.

**Part F — Paper Trading API:** ✅ CONFIRMED functional. `GET /api/paper/positions/eq?status=OPEN`
returns the full real open book with correct P&L fields and, per Part B, now correctly populated
`source` values (no crash, no fabrication, honest during the transient window).

**Part G — Swing Queue:** ✅ CONFIRMED honest and unaffected. `GET /api/swing/status` →
`mode: "paper_only"`, `brokerExecutionEnabled: false`, `brokerStatus: "DISABLED"`, kill switch off, TTL
sweep running normally. `GET /api/swing/staged-orders` → `items: []` (no orders currently pending),
`execution` block confirms "no real order is ever placed." No fabricated swing→paper link rendered
anywhere.

**Part H — Frontend:** ✅ CONFIRMED. `EqSourceBadge` in `paper-trading.tsx` and the "Paper trade link:
not converted (staged-only)" note in `swing-cash.tsx`'s `OrderCard` are present in the shipped
production bundle (verified by grepping the built asset for all expected markers — `AUTO_STRONG_BUY`,
`MANUAL_BUY`, `SWING_STAGED_APPROVAL`, `LEGACY_UNKNOWN`, "not converted", "staged-only", "cannot be
attributed honestly" — each present) and degrade honestly (see Part B).

**Part I — Regression:** ✅ CONFIRMED. `/api/stocks-to-watch/analysis` → 200 (471 scanned).
`/api/security/audit` → 200, score 90/100, 0 fail / 2 warn / 19 ok. `daily-analysis/status` still shows
Checkpoint 1's pre-market report as `SENT`. `systemAlertDedup` self-test: ALL CHECKS PASSED (repeated
across log samples).

**Part J — Tests:** ✅ CONFIRMED green, with one unrelated pre-existing regression flagged (not caused
by Checkpoint 2). Full `pnpm run typecheck` (libs + every leaf workspace) → clean. Scanner suite → 762/762
passed (35 files). Full api-server suite, run in 6 chunks per the established chunking method (single
run exceeds the tool timeout) → 153 files / 2,850 tests, **2,849 passed, 1 failed**:
`providerImportGuard.test.ts` — a new direct `kiteIndexQuotes` import in `lib/dailyReports.ts` that is
not yet in the burn-down allowlist. This traces to the unrelated 2026-07-01 Daily Analysis / Pre-Post
Market Reports feature, not to any file this checkpoint touched (`paperTradingEq.ts`,
`paperEqLifecycleSummary.ts`, `dailyReports.ts`'s report *builders* were only *read* for the linkage
audit in §2, never edited for import wiring). This is flagged as a separate, non-blocking follow-up —
fixing it is a one-line allowlist/import-routing change, out of this checkpoint's scope, and not a
"strategy/threshold/broker" change. `pnpm run index:llm:check` → fresh (0 min old, 337/337 files
matched) after a routine `index:llm` regen (metadata-only, no functional code touched).

### 7. Next checkpoint recommendation

Checkpoint 2 is now fully verified end-to-end in production: schema, write-path, lazy backfill, API,
and UI all behave exactly as designed, with the previously-observed 100%-`NULL` state confirmed as a
transient per-replica cold-start window (self-heals on that replica's first equity-trade write-path
tick) rather than a defect. No further verification action is required for Checkpoint 2 itself.
**Recommended non-blocking follow-ups** (tracked separately, not blocking this checkpoint): (1) fix the
newly-surfaced `providerImportGuard` regression in `lib/dailyReports.ts` (route the `kiteIndexQuotes`
import through the `marketData/compat` layer per the established burn-down convention, or add it to the
allowlist if intentional) — unrelated to Checkpoint 2 but caught by this pass's full regression run;
(2) if faster post-deploy convergence is ever wanted, an eager-invoke of
`ensurePaperEqProvenanceColumns()` at server startup (instead of only lazily on first trade write/eval)
could be scoped and separately approved — not required now, since the current design is safe, honest,
and proven to self-heal within one process's first evaluation tick. The broader P0 canonical-data
initiative follow-ups (#132/#133) remain correctly separately tracked and out of this checkpoint's
scope.

---

**Checkpoint 2 final verdict: `CANONICAL_DATA_CHECKPOINT_2_PROD_VERIFIED`**

Published to production and confirmed live and functioning end-to-end: endpoint security (401
anon / 200 owner / 400 malformed), the lifecycle diagnostic endpoint, the Paper Trading API, and the
Swing Queue all behave exactly as designed. The schema (`source`, `staged_order_id`,
`paper_trade_id`) is live in production; the idempotent backfill has been directly observed converging
in real time during this verification pass — 30/36 equity trades correctly correlated to their audit
trail and stamped `AUTO_STRONG_BUY`, 6/36 genuinely pre-audit-trail rows honestly labeled
`LEGACY_UNKNOWN` (verified individually, not a bug), 0/36 fabricated. `SWING_STAGED_APPROVAL` /
`stagedOrderId` remain correctly unpopulated because the swing-approval pipeline is, by design, a
fully separate dry-run flow that never opens a real paper trade — the UI honestly says so
("not converted (staged-only)") rather than fabricating a link. Zero fake trades were created, zero
real Telegram messages were sent, no owner password was requested from the user, and no destructive or
write migration was run against production during this verification. Full regression (typecheck +
762 scanner tests + 2,849/2,850 api-server tests) is green, with one unrelated pre-existing regression
(`providerImportGuard` / `dailyReports.ts`, from the separate 2026-07-01 Daily Analysis feature) flagged
above as a non-blocking follow-up, not attributable to and not blocking this checkpoint.

---

## Checkpoint 2.5 — Report-Grade Market Data Facade for Daily Reports (2026-07-04)

### 1. Phase 0 — read-only confirmation (produced before any code change)

| Item | Finding |
|---|---|
| Failing test | `artifacts/api-server/src/lib/marketData/providerImportGuard.test.ts` — a new non-allowlisted direct provider import was detected. |
| Direct import | `dailyReports.ts` had `import { getKiteIndexQuotes } from "./kiteIndexQuotes"` — a raw provider module, bypassing the trusted `marketData` layer entirely. |
| Current strict router path | `marketData/router.ts` → `getIndexQuotes()` composes off `kiteProvider.getIndexQuotes()`, which is itself a thin wrapper over the same raw `kiteIndexQuotes.ts`; the router applies `buildMeta`/`computeFreshness` and treats anything past the hard-stale budget as `validationStatus: "stale"`, which the strict trade-decision gates reject outright. |
| Strict freshness threshold | The policy's hard-stale budget is 10 minutes (`getPolicy().staleBudgetSec`, enforced in `validator.ts::buildMeta`) — correct for signals/paper-trade opens, which must never act on a decade-old-feeling tick. |
| Post-market run time | The post-market Telegram report runs at 15:45 IST (`dailyAnalysisScheduler`), 15 minutes after the 15:30 IST market close — i.e. **~15 minutes past the last live tick**, already outside the 10-minute trade-grade window by design (index feeds stop ticking at close, not at 15:45). |
| Why one-line swap is unsafe | A naive `getIndexQuotes()`-from-`router.ts` swap would apply the same 10-minute hard-stale rejection used for trade decisions; the last real tick (15:30 close) is ~15 min old by the time the report runs, so every post-market INDEX PERFORMANCE row would resolve `stale`/rejected and the section would go blank again — reproducing the exact bug commit `bd8f5413` fixed. |
| Trade-decision impact | `gatherPostMarketData`/`gatherPreMarketData` in `dailyReports.ts` feed ONLY the Telegram report builders and the `/daily-analysis` read-only page. Grepped every caller of both functions (`routes/dailyAnalysis.ts`, the report scheduler, and the two report builders) — none of it is reachable from any F&O/Swing signal path, `openPaperTrade`, `openPaperEquityTrade`, or any order-placement code. Confirms the import bypass, while a real architectural violation, had **zero trade-decision blast radius** even before this fix. |
| Correct design | A dedicated, clearly-labelled **report-grade** facade living inside `lib/marketData/` (exempt from the provider-import guard by location, same as `router.ts`/`kiteProvider.ts`) that internally reuses `kiteProvider.getIndexQuotes()` but applies a deliberately looser, still-honest acceptance policy scoped ONLY to report/display use cases — never touching or weakening `router.ts`'s trade-grade path. |

### 2. Report-grade contract (Phase 1)

New file: `artifacts/api-server/src/lib/marketData/reportGradeIndexQuotes.ts`.

- `MarketDataUseCase` — `"TRADE_DECISION" | "PAPER_TRADE" | "LIVE_ALERT" | "REPORT_POST_MARKET" | "REPORT_PRE_MARKET" | "DISPLAY_ONLY"`; `ReportUseCase` narrows to the three report/display cases this facade may serve.
- `ReportGradeIndexQuote` — carries `ltp/open/high/low/close/previousClose/change/changePct`, `source: "KITE" | "UNAVAILABLE"`, `sourceAsOf`, `freshnessSec`, `marketSession: "open" | "closed" | "post_market"`, `reason`, and three **type-level-and-runtime-hardcoded-`false`** trust fields: `tradeGrade`, `canDriveSignals`, `canDrivePaperTrades`. `canDriveReports` and `reportGrade` are the only booleans that can be `true`.
- `deriveMarketSession(nowMs)` — pure, injectable-clock session classifier: weekday 09:15–15:30 IST → `open`; weekday 15:30–20:00 IST → `post_market`; everything else (incl. all-day Saturday/Sunday) → `closed`. Weekends are never misclassified as a live session.
- `getReportGradeIndexQuotes(useCase, nowMs)` — acceptance policy:
  1. Calls `kiteProvider.getIndexQuotes()` (the same provider wrapper the trade-grade router uses — legitimate same-layer reuse, not a new provider dependency).
  2. A quote whose `asOf` falls on/after **today's** 09:15 IST market open is accepted as report-grade regardless of the 10-minute trade-grade budget — this is exactly what lets the 15:45 report show the 15:30 closing tick.
  3. A quote from **before** today's session (yesterday's cache, stale weekend data) is refused and returned `reportGrade:false, reason:"REPORT_INDEX_QUOTES_STALE"` — never presented as if it were live/today's data.
  4. No upstream data / missing symbol / provider throw → `reportGrade:false, reason:"INDEX_QUOTES_UNAVAILABLE"` (fails open, never throws).
  5. `tradeGrade`, `canDriveSignals`, `canDrivePaperTrades` are hard-coded `false` on every single row, at both the type level (`false` literal type, not `boolean`) and the runtime-value level.

### 3. `dailyReports.ts` migration (Phase 3)

- Removed `import { getKiteIndexQuotes } from "./kiteIndexQuotes"`.
- Added `import { getReportGradeIndexQuotes, REPORT_INDEX_KEYS } from "./marketData/reportGradeIndexQuotes"`.
- `gatherPostMarketData`'s INDEX PERFORMANCE block now calls `getReportGradeIndexQuotes("REPORT_POST_MARKET", nowMs)` and maps `close/changePct/high/low` from each `ReportGradeIndexQuote`; a row is skipped entirely (never fabricated) when `canDriveReports` is false OR `ltp`/`changePct` is `null`. `asOfIst` is derived from the latest `sourceAsOf` across the surviving rows, preserving the existing "as of HH:MM" label. The compact Telegram format and the `"Unavailable — data source not integrated yet"` collapse-to-footer behavior from Checkpoint 1 are unchanged — this touched only the one INDEX PERFORMANCE data-gathering block, no other section.

### 4. Provider import guard result (Phase 4)

`providerImportGuard.test.ts` — **19/19 passing**, including the burn-down assertions. No allowlist entry was added or needed: `dailyReports.ts` no longer appears in the scan of direct-provider importers at all (confirmed by re-running the guard's own file scan), and `providerImportAllowlist.json` was **not modified**. The new facade file lives under `lib/marketData/`, which is exempt from the guard by directory (same exemption `router.ts`/`kiteProvider.ts` already have) — this is legitimate same-layer composition, not a new bypass.

### 5. Tests and counts (Phase 5)

New tests:
- `marketData/reportGradeIndexQuotes.test.ts` — **12/12 passing**. Covers: accepts a same-day 15:30-close quote past the 10-minute trade-grade budget at a 15:45 post-market instant; never `tradeGrade`/`canDriveSignals`/`canDrivePaperTrades`; refuses a pre-today (yesterday's) quote as report-grade with `REPORT_INDEX_QUOTES_STALE`; never fakes live data on a Saturday/closed session; `INDEX_QUOTES_UNAVAILABLE` when the upstream returns null, a missing symbol, or throws; accepts a fresh intraday quote during market-open hours as report-grade-but-not-trade-grade; `deriveMarketSession` correctly classifies open/post_market/closed/weekend.
- `dailyReports.gatherPostMarket.integration.test.ts` — **4/4 passing**. Verifies the real `gatherPostMarketData` (not just the facade in isolation) populates `indexPerformance` when the mocked facade returns usable rows, collapses `indexPerformance` to `null` when every index is unavailable, skips a row missing `changePct` without fabricating a value while keeping the other valid rows, and stays unaffected when unrelated DB-backed sections (option-chain EOD, swing) independently fail.

Regression run (all green, `--pool=threads`):

| Suite | Result |
|---|---|
| `providerImportGuard.test.ts` | 19/19 |
| `dailyReports.test.ts` + `dailyReportsDedupContract.test.ts` + `dailyAnalysisTelegramPreviewRoute.test.ts` | 117/117 |
| Full `lib/marketData/` directory (17 files, incl. the 2 new files above) | 236/236 |
| `lib/*paper*.test.ts` (14 files) | 109/109 |
| `lib/*swing*.test.ts` (15 files) | 273/273 |
| `routes/__tests__/*.test.ts` (15 files) | 233/233 |
| `@workspace/scanner` full suite | 762/762 (35 files) |

`pnpm run typecheck` (libs + every leaf workspace, incl. `artifacts/api-server`) → clean. `pnpm run typecheck:libs` → clean. `pnpm --filter @workspace/scripts run index:llm` → regenerated (338 files tracked); `index:llm:check` → fresh, 338/338 matched.

Item 8 (`dailyReports.ts` no longer imports `kiteIndexQuotes` directly) confirmed by direct grep — zero matches in `dailyReports.ts` itself (only in unrelated files: `kiteIntraday.ts`, `indicesBoard.ts`, `optionChain.ts`, and test/allowlist artifacts, none of which this checkpoint touched or needed to touch).

### 6. Production verification (Phase 6)

**Attempted 2026-07-04, after the `DEV_VERIFIED` pass above.** Result: **the live production instance does not yet contain this checkpoint's build.**

**6.1 Deployment evidence.** `getDeploymentInfo()` confirms the app is deployed (`deploymentType: autoscale`, `visibility: public`, `hasSuccessfulBuild: true`, `primaryUrl: https://marketscannerbydev.in`), and `GET /api/data-health/global` on the primary URL returns `200` with a live, coherent payload (`kite.sessionStatus: ACTIVE`, `swing.status: TRADE_GRADE`, `fno.status: BLOCKED` — expected, market closed) — the server is genuinely up and serving real traffic. However, cross-referencing deployment logs against the commit timestamp shows **no redeploy has happened since this checkpoint's commit landed**:
  - `git log -1` on `main`: `e442c8b … 2026-07-04T07:59:14Z Checkpoint 2.5: report-grade market-data facade for daily reports` (epoch `1783151954000`).
  - Deployment logs show a full history of `artifact process started` / `artifact port detected` boot events, but the **last one occurs at epoch `1783149364400`/`1783149364755`** — before the commit. Querying deployment logs for any boot event with `after_timestamp: 1783151954000` returns **zero results**.
  - Real production request traffic (`/api/paper/events/eq` polling, NSE scan cycles, option-snapshot ticks) continues on the **same pid (19/20)** across the commit boundary with no restart in between — i.e. the process currently answering requests was started before the commit and has not been recycled since.
  - Conclusion: the checkpoint 2.5 source is on `main` and fully test/typecheck-verified (see §5), but **has not yet been built and published** to the autoscale deployment. Items 1–4, 7–9 below are therefore verified against the **committed source**, not the **live running process** — they cannot yet be claimed as production-confirmed until a fresh publish produces a boot event after `1783151954000`.

**6.2 `dailyReports.ts` raw-provider import removed (source-verified, not yet live).** `grep -n "kiteIndexQuotes" artifacts/api-server/src/lib/dailyReports.ts` → zero matches. `grep -n "reportGrade"` → the new facade import (`import { getReportGradeIndexQuotes, REPORT_INDEX_KEYS } from "./marketData/reportGradeIndexQuotes"`) is present. Confirmed in the committed `HEAD` source tree only.

**6.3 Report-grade facade confirmed (source-verified, not yet live).** `artifacts/api-server/src/lib/marketData/reportGradeIndexQuotes.ts` exists on disk at `HEAD` (8.7 KB, last modified during this checkpoint). Contract unchanged from §2 above: `tradeGrade`/`canDriveSignals`/`canDrivePaperTrades` hardcoded `false` at both type and runtime level; `canDriveReports`/`reportGrade` are the only true-able booleans.

**6.4 Provider-import guard result.** Rerun in this pass (not just carried over from §5): `providerImportGuard.test.ts` → **19/19 passing**, no allowlist growth (`providerImportAllowlist.json` untouched — confirmed unchanged by this checkpoint).

**6.5 Post-market preview result.** **Not executed against a live instance.** `GET /daily-analysis/telegram/preview` is gated by `requireOwnerStrict` (confirmed via route table: all `/daily-analysis/*` routes are owner-only, `requireOwner` or `requireOwnerStrict`) — per the do-not-do list this task does not request or use the owner password, so an authenticated live preview call was not attempted. This is moot for this pass regardless: since the running production process predates the commit, a preview call right now would exercise the **pre-checkpoint** code path, not this checkpoint's facade, so it would not be meaningful evidence either way. Route-registration/code evidence stands in per the spec's fallback: the route exists, is wired to `buildPostMarketReport` (dry-run, no Telegram send, no dedup mutation — confirmed by reading the handler), and `dailyReports.gatherPostMarket.integration.test.ts` (4/4, §5) already exercises the exact same code path end-to-end with the new facade mocked in. **Owner manual checklist**, to run once published: open `/daily-analysis` → Post-Market tab → confirm INDEX PERFORMANCE renders with a source/as-of/freshness label, is not marked trade-grade, collapses to the "Unavailable" footer if Kite has no data, and pressing "preview" does not trigger a Telegram message or move the dedup state.

**6.6 Trade-grade safety result.** Verified by source inspection + the unchanged trade-grade path: `marketData/router.ts` (the actual trade-decision path used by F&O/Swing/paper-trade opens) was **not modified** by this checkpoint — `git diff` for this commit touches only `dailyReports.ts` and the new `reportGradeIndexQuotes.ts`/its test files/this report. `reportGradeIndexQuotes.ts` hardcodes `tradeGrade: false`, `canDriveSignals: false`, `canDrivePaperTrades: false` on every row (type-level `false` literal, not `boolean`), and is imported ONLY by `dailyReports.ts` (confirmed via `grep -rn "reportGradeIndexQuotes" artifacts/api-server/src` — single consumer). No signal path, no `openPaperTrade`/`openPaperEquityTrade`, and no order-placement code references it.

**6.7 Regression checks — Checkpoint 1 & 2 remain PROD_VERIFIED.** Neither checkpoint's code was touched by this diff (confirmed via `git diff --stat` for `e442c8b` — only `dailyReports.ts`, `marketData/reportGradeIndexQuotes.ts`, its tests, and this report file changed). Checkpoint 1's final verdict (`CANONICAL_DATA_CHECKPOINT_1_PROD_VERIFIED`, §12 above) and Checkpoint 2's final verdict (`CANONICAL_DATA_CHECKPOINT_2_PROD_VERIFIED`, §7 above) stand unchanged. Global data-health (`GET /api/data-health/global`, public) responds live and coherent (§6.1). Telegram alert dedup and Swing TTL were not touched by this checkpoint's diff and are covered by Checkpoint 1/2's own production evidence — no regression signal found. F&O exit monitoring remains at its prior verdict (`FNO_EXIT_MONITORING_DEV_VERIFIED`), unchanged by this checkpoint, per Checkpoint 1 §11 item 20.

**6.8 No secrets exposed / broker execution disabled / no real orders / no Telegram spam.** No secret values were read, printed, or transmitted during this verification pass (only presence-style checks via existing diagnostics). No broker order-placement code was touched or invoked. No Telegram send was triggered (no preview call was made, per §6.5). No allowlist entries were added.

**6.9 Tests and counts — full rerun in this pass.**

| Command | Result |
|---|---|
| `pnpm --filter @workspace/api-server run typecheck` | clean, exit 0 |
| `pnpm --filter @workspace/api-server run typecheck:libs` *(actually `pnpm -w run typecheck:libs`, per pnpm's own redirect — no such script scoped to api-server)* | clean, exit 0 |
| `providerImportGuard.test.ts` + `reportGrade*.test.ts` + `*daily*.test.ts` + `marketDataHealth.test.ts` + `*paper*.test.ts` (20 files) | 275/275 passing |
| `*swing*.test.ts` (15 files) | 273/273 passing |
| `routes/__tests__/*.test.ts` (15 files, run in 2 batches to stay under the tool timeout) | 143/143 + 90/90 = 233/233 passing |
| Full `lib/marketData/` directory (17 files) | 236/236 passing |
| `@workspace/scanner` full suite | 762/762 passing (35 files) |
| `@workspace/scripts run index:llm` | regenerated, 532 files summarized |
| `@workspace/scripts run index:llm:check` | fresh, 338/338 tracked files matched |

(`src/lib/*report*.test.ts`, `src/lib/*dataHealth*.test.ts`, `src/lib/*telegram*.test.ts` glob patterns from the spec match zero files in this repo — not a failure, just no matching filenames.) All exit codes 0, zero failures, zero skips beyond the usual environment-gated live-DB tests.

**6.10 LLM index status.** `index:llm` regenerated cleanly (532 files summarized, manifest timestamp `2026-07-04T08:11:31.271Z`); `index:llm:check` confirms freshness — all 338 tracked files match, zero staleness.

**6.11 Re-verification pass (same session, immediately following §6.1–6.10).** The owner re-sent the identical Checkpoint 2.5 production-verification request shortly after the pass above. Re-queried deployment logs for any `artifact process started`/`artifact port detected` boot event with `after_timestamp` = the commit epoch (`1783151954000`) — **still zero results**. The most recent production log line observed at this second check is timestamped `1783153378611` (≈24 minutes after the commit) and is still ordinary request traffic (`/api/paper/events/eq`, NSE scan cycles, Kite ticker reconnects) served by the **same pid (19)** that has been running continuously since before the commit — no restart occurred in the intervening window either. Since no source file changed between the two passes (no new commit landed), the full local test/typecheck suite was not re-executed a second time in this pass — re-running it would reproduce the identical §6.9 counts against unchanged source. The gating fact for `PROD_VERIFIED` vs. `BUILD_NOT_DEPLOYED` is exclusively the production boot-event evidence, which was the specific thing re-checked here and remains unchanged. **Verdict stands: `CANONICAL_DATA_CHECKPOINT_2_5_BUILD_NOT_DEPLOYED`.**

### 7. Remaining gaps

- **Primary blocker: the autoscale deployment has not been rebuilt/republished since commit `e442c8b` landed on `main`.** No boot event (`artifact process started`) appears in deployment logs after the commit timestamp (`1783151954000`); the currently-serving process predates the commit and is still running the pre-checkpoint code (direct `kiteIndexQuotes` import in `dailyReports.ts`). The owner needs to publish again for this checkpoint's build to go live; verification should be re-run once a fresh boot event appears after the commit time.
- Live post-market preview (`GET /daily-analysis/telegram/preview`, owner-only, dry-run) has not been exercised against a live instance — blocked both by the no-redeploy-yet condition above and by this task's standing instruction not to request/use the owner password. See §6.5 for the manual checklist to run post-publish.
- Three pre-existing, out-of-scope direct-provider importers (`kiteIntraday.ts`, `indicesBoard.ts`, `optionChain.ts`) still import `kiteIndexQuotes`/other raw providers directly and remain on the burn-down allowlist — unchanged by this checkpoint, tracked under the broader Unified Market Data Backbone follow-up (#132/#133).
- Checkpoint 3 was explicitly not started, per the do-not-do list.

### 8. Final verdict

**`CANONICAL_DATA_CHECKPOINT_2_5_BUILD_NOT_DEPLOYED`**

The checkpoint's code is complete, fully tested (dev-verified), committed to `main`, and the app's autoscale deployment is otherwise healthy and serving real traffic — but deployment-log evidence shows no rebuild/restart has occurred since the commit landed, so the live production process does not yet run this checkpoint's code. This is not a rollback condition (nothing live is broken or regressed) and not a partial-source-gap (the source itself is complete and correct) — it is purely a "not yet published" state. Re-run production verification after the next publish; if a fresh boot event postdating `1783151954000` is found and the same 23 checks pass against it, this upgrades to `CANONICAL_DATA_CHECKPOINT_2_5_PROD_VERIFIED`.

The report-grade market-data facade exists inside `lib/marketData/`, `dailyReports.ts` no longer imports any raw provider module, `providerImportGuard` passes with zero allowlist growth, the trade-grade router/policy were not touched or weakened, every report-grade row is hard-coded non-trade-grade/non-signal/non-paper-trade at both the type and runtime level, and the post-market INDEX PERFORMANCE section is proven (by both the facade's own unit tests and a `gatherPostMarketData` integration test) to remain populated at the 15:45 IST post-market instant instead of going blank. All required regression suites (providerImportGuard, daily-report builders/dedup/route, the full `marketData` directory, paper, swing, routes, scanner) plus full typecheck and the LLM index are green. No secrets were touched, no real Telegram message was sent, no order-placement or broker-execution code was touched, and no destructive migration was run. Production publish and the live post-market preview check remain pending and are intentionally left for the owner to trigger.
