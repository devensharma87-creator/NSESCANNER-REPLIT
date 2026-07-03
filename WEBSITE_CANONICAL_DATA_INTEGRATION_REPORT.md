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

### 6. Production verification status — NOT YET PERFORMED

This checkpoint's code has **not** been published. The live production deployment
(`https://marketscannerbydev.in`, autoscale) is still serving the Checkpoint-1 build (`0f48ee3` /
`9b109de` — a docs-only commit after it); none of the T001–T006 schema, write-path, endpoint, or UI
changes are present in production yet. Publishing requires the user to click the Publish button
(the agent cannot trigger a deploy directly) — `suggestDeploy()` was called at the end of this
session to prompt that action. Once published, the recommended prod verification (read-only,
`environment: "production"`) is: (1) confirm the new `source`/`staged_order_id`/`paper_trade_id`
columns exist and the backfill has converged on the prod `paper_trade_eq`/`paper_eq_audit` tables,
specifically re-checking the `INDUSINDBK` and `RELIANCE` rows identified in the Phase 0 prod audit;
(2) `GET /api/paper/lifecycle/INDUSINDBK` and `/RELIANCE` against prod with an owner session:
`INDUSINDBK` should show a linked `AUTO_STRONG_BUY` trade with a non-null `paper_eq_audit.paper_trade_id`,
`RELIANCE` should show its expired staging row(s) with `paperTrades: []` (still no fabricated link);
(3) visually confirm the `EqSourceBadge` column renders on `/paper-trading` and the "not
converted (staged-only)" note renders on `/swing-cash`.

### 7. Next checkpoint recommendation

Checkpoint 2's code is complete, dev-verified, and ready to publish. No further scope should be
added to this checkpoint. Once the user publishes, run the §6 prod checklist to close this out as
`CANONICAL_DATA_CHECKPOINT_2_PROD_VERIFIED`; this does not require re-opening any code changes if the
checks pass as expected. The broader P0 canonical-data initiative follow-ups (#132/#133) remain
correctly separately tracked and out of this checkpoint's scope.

---

**Checkpoint 2 final verdict: `CANONICAL_DATA_CHECKPOINT_2_DEV_VERIFIED`**

Every equity paper trade is now traceable to a source (`AUTO_STRONG_BUY` / `SWING_STAGED_APPROVAL`
[reserved, unused] / `MANUAL_BUY` / `LEGACY_UNKNOWN`), backed by additive-only DB columns, an
idempotent backfill verified convergent against real dev data, a new owner-only lifecycle diagnostic
endpoint, honest UI source badges and a no-fabricated-link note on the Swing Queue, and 213 passing
regression tests (14 new) alongside a clean full-workspace typecheck. Production has **not** been
published with this checkpoint's changes yet — that is a user-initiated action outside the agent's
control (`suggestDeploy()` invoked to request it) — so the production leg of the audit (§6) remains
pending and this verdict correctly stops at `DEV_VERIFIED` rather than overclaiming
`PROD_VERIFIED`. No source/link gap remains in the code itself: every path that opens a paper trade
is now covered (`AUTO`, `MANUAL`, and the confirmed-absent `SWING_STAGED_APPROVAL` path is honestly
represented as never occurring today, not silently ignored).
