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

### 11. Production verification status

**Not yet performed.** The changes in this checkpoint have not been published/redeployed to
production in this session — the currently-live autoscale deployment predates this checkpoint's
code. Part H (production verification) is pending an explicit publish. See final verdict below.

### 12. Next checkpoint recommendation

Proceed to the next phase of the broader P0 canonical-data initiative (already tracked via
follow-up refs #132/#133) once this checkpoint is published and Part H production verification
passes. Suggested immediate next step: publish this checkpoint, run the Part H production
checklist, then move to the next phase's scoped work rather than widening Checkpoint 1's surface
retroactively.

---

**Checkpoint 1 final verdict: `CANONICAL_DATA_CHECKPOINT_1_DEV_VERIFIED`**

Implementation and the full test/typecheck/LLM-index verification pass in dev. Production
publish/verification is pending (§11) — re-run the Part H checklist after publish to upgrade this
to `CANONICAL_DATA_CHECKPOINT_1_PROD_VERIFIED`.
