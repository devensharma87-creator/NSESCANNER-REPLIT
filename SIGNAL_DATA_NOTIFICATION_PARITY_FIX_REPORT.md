# Signal, Data, and Notification Parity Fix — Investigation Report

**Date:** 2026-07-02
**Status:** INVESTIGATION COMPLETE — implementation in progress
**Scope:** F&O divergence (P0), Telegram audit, canonical trade event system, notification idempotency

---

## Table of Contents

1. [P0 — F&O Signal Divergence Root Cause](#1-p0--fo-signal-divergence-root-cause)
2. [Telegram Alert Audit](#2-telegram-alert-audit)
3. [TESTSTK Root Cause](#3-teststk-root-cause)
4. [Multiple Telegram Messages Root Cause](#4-multiple-telegram-messages-root-cause)
5. [Full F&O Lifecycle Trace](#5-full-fo-lifecycle-trace)
6. [Full Swing Lifecycle Trace](#6-full-swing-lifecycle-trace)
7. [Surface Parity Comparison](#7-surface-parity-comparison)
8. [Implementation Actions](#8-implementation-actions)
9. [Architecture Decisions](#9-architecture-decisions)

---

## 1. P0 — F&O Signal Divergence Root Cause

### Observed Symptom

| Surface | Kite Status | Setups | Suppression Reason |
|---|---|---|---|
| Published live app (prod deployment) | LIVE | **3** (NIFTY + BANKNIFTY + SENSEX) | none |
| Replit dev/workspace | LIVE | **0** | `no_live_kite_intraday` |
| Prod deployment pid=18 | LIVE | **0** | `daily_history_unavailable_kite` or `no_live_kite_intraday` |

Screenshot differences do NOT reflect different codebases. The live commit (`cc24057`) and dev HEAD (`a75df9a`) are **functionally identical** — the 1-commit delta is test-only (no logic, routes, or schema changes).

### Exact Code Path

`optionSignals.ts` → `getOptionSignals()` → per-index loop:

```typescript
// Step 1: intraday bars check
if (centralHasIndexCoverage(cfg.yahoo)) {           // ← always TRUE (static INDEX_TABLE check)
  intra = await centralIndexCandles(cfg.yahoo, "15minute", 5);  // ← this returns null
  if (intra) intraSrc = "kite";
}
if (!intra) {
  suppressed.push({ index: cfg.symbol, reasons: ["no_live_kite_intraday ..."] });
  continue;
}

// Step 2: daily bars check  
const daily = await centralIndexCandles(cfg.yahoo, "day", 180);
if (!daily) {
  suppressed.push({ index: ..., reasons: ["daily_history_unavailable_kite ..."] });
  continue;
}
```

**Critical finding**: `centralHasIndexCoverage()` → `kite.hasIndexCoverage()` → `hasKiteIntradayCoverage()` is a **static check** (`INDEX_TABLE.some(e => e.yahoo === yahooSymbol)`) — it always returns `true` for NIFTY/BANKNIFTY/SENSEX because they are in the hardcoded index table. It does NOT reflect live API connectivity.

The actual failure is `centralIndexCandles(..., "15minute", 5)` returning `null`.

### Root Cause Analysis

**Why does prod (pid=19) show 3 setups?**

1. At boot, `triggerKiteWarmup("boot")` ran successfully for pid=19
2. Warmup called `centralIndexCandles(cfg.yahoo, "15minute", WARMUP_INTRADAY_DAYS)` for each index
3. Those calls succeeded — the Kite historical API was not rate-limited at that moment
4. Kite's in-memory cache (`fetchKiteHistorical` internal) now has valid 15-min bars for the indices
5. The next F&O cycle reads from this cache → `intra !== null` → signals emitted

**Why does dev/workspace show 0 setups?**

Dev server confirmed working (from API logs):
- `Full NSE scan complete (Kite-first) — kiteOnly: 4321` ← Kite REST API works for equities
- `Kite index quote batch refreshed — count: 11` ← spot quotes work
- `F&O getOptionSignals: cycle complete — indicesWithBars: 0, no_live_kite_intraday` ← historical bars fail

The Kite REST batch-quote API (used for equity scanning) works fine. But `getHistoricalData()` (used for F&O index intraday bars) is **failing or rate-limited** in the dev workspace environment. Most likely causes:
- The dev server's Kite session token was created at a different time; both environments share the same `kite_session` DB row, but the historical API is more sensitive to rate-limiting and timing
- The Kite historical API rate-limits aggressively (~3 req/s); in dev, consecutive warmup retries may exhaust the quota
- If both dev and prod have run warmup concurrently (sharing the same token), rate-limit exhaustion hits the dev env harder since prod ran first at boot

**Why does prod (pid=18) show 0 setups?**

From deployment logs: `kiteWarmup complete pid=18 outcome="FAILED" okCount=0 total=3 durationMs=520400ms`. Both `pid=19` and `pid=18` started simultaneously but `pid=19` ran its warmup first and exhausted the Kite historical API rate-limit bucket. `pid=18`'s warmup then saw rate-limit errors on every `getHistoricalData` call, returned `null`, and wrote `FAILED` to in-memory state. The F&O cycle on `pid=18` sees empty bars → `daily_history_unavailable_kite`.

**This is a multi-worker Kite API rate-limit collision.**

### Divergence Comparison Table

| Item | Live Pub (pid=19) | Dev/Workspace | Root Cause |
|---|---|---|---|
| Code commit | `cc24057` | `a75df9a` | 1 test-only commit, no functional diff |
| Kite session (DB) | Same `kite_session` row | Same | Shared DB |
| NODE_ENV | `production` | not set | Different — no functional impact here |
| REPLIT_DEPLOYMENT | `"1"` | `""` | Different — affects paper trade gating only |
| Warmup at boot | ✅ OK (okCount=3) | Not logged (dev restarts) | In-process memory |
| `centralIndexCandles` (15m) | Returns data | Returns null | Kite historical API timing/rate-limit |
| `indicesWithBars` | 3 | 0 | Downstream of above |
| Signal cycle | Emits setups | All suppressed | Downstream of above |
| API source | Same backend code | Same backend code | — |
| Browser cache | n/a | n/a | No browser cache involved (SSR-free SPA) |
| DB state | Same | Same | Shared DB |
| In-process warmup cache | Warm (pid=19) | Cold | Root divergence |

### Fix

**P0 code fix (additive, non-breaking):** When the F&O signal cycle finds all indices suppressed with `no_live_kite_intraday` or `daily_history_unavailable_kite`, auto-trigger a background warmup retry (debounced to 60s). This closes the gap where warmup fails at boot but never retries.

Location: `optionSignals.ts` `getOptionSignals()`, after the existing owner alert block.

Dynamic import is used to break the `kiteWarmup → optionSignals` circular dependency at module load time.

**Acceptance:** Both dev and prod must show the same setup count for the same Kite session state. After warmup succeeds in dev, the next F&O cycle will see non-null bars and emit setups.

---

## 2. Telegram Alert Audit

### Current Alert Architecture

| Alert Module | File | Bot | Events Sent |
|---|---|---|---|
| F&O tradeable signal | `fnoSignalAlerts.ts` | Main (`TELEGRAM_BOT_TOKEN`) | `FNO_TRADEABLE_SIGNAL` (on paper trade open) |
| F&O data health | `fnoSignalAlerts.ts` | Main | `WARMUP_FAILED`, `WARMUP_PARTIAL`, `FNO_DATA_RECOVERED` |
| F&O session missing | `optionSignals.ts` → `alerting.ts` | Main | `FNO_KITE_SESSION_MISSING`, `FNO_DAILY_HISTORY_WARMUP`, `FNO_DAILY_HISTORY_UNAVAILABLE` |
| Swing order staged | `swingAlerts.ts` | Main | `SWING_ORDER_STAGED`, `SWING_ORDER_APPROVAL_REQUIRED` |
| Swing order lifecycle | `swingAlerts.ts` | Main | `SWING_ORDER_EXPIRED`, `SWING_ORDER_REJECTED`, `SWING_ORDER_APPROVED_DRY_RUN` |
| Swing risk block | `swingAlerts.ts` | Main | `SWING_ORDER_BLOCKED_BY_RISK` |
| Pre-market report | `dailyReports.ts` | PREPOST (`PREPOST_TELEGRAM_BOT_TOKEN`) | Scheduled + manual |
| Post-market report | `dailyReports.ts` | PREPOST | Scheduled + manual |

### Current Dedup Architecture

| Alert Category | Dedup Key | Window |
|---|---|---|
| F&O tradeable signal | `FNO_TRADEABLE_SIGNAL::{date}::{index}::{direction}::{setup}` | 30 min |
| F&O freshness gate | `openedAt` must be within 5 min | Per-alert |
| Swing per-order events | `{EVENT}:{orderId}` | 15 min |
| Swing risk block | `SWING_ORDER_BLOCKED_BY_RISK:{symbol}:{setupKey}` | 60 min |
| F&O data health | `FNO_KITE_SESSION_MISSING::{signalDate}`, etc. | 2 hours |

### Audit Findings

1. **Test endpoint (`POST /alerts/test-swing-staged-order`)** uses "RELIANCE" (not TESTSTK). Uses `resetAlertDedup` + `alertOwnerRaw`. **Safe** — resets own key, doesn't interfere with production dedup.

2. **Test endpoint (`POST /alerts/test-fno-trade-signal`)** requires `{ "confirmSampleAlert": true }`. Uses sample data. **Safe** — gated explicitly.

3. **Pre/Post market reports** use dedicated PREPOST bot. **Correctly isolated** from main trade channel.

4. **Swing BLOCKED_BY_RISK** fires per scanner cycle attempt (1-hour dedup). Can be noisy if scanner repeatedly tries the same blocked candidate. Already mitigated by 1-hour dedup window.

5. **Swing EXPIRED** fires when TTL sweep marks an order as expired. **This is a valid signal** — tells owner a stageable opportunity was missed.

6. **No guarantee against instrument-master validation**: If a TESTSTK symbol is manually POSTed to `/swing/staged-orders`, it would go through staging and fire a real Telegram alert. No code block prevents arbitrary symbols.

---

## 3. TESTSTK Root Cause

**Finding: TESTSTK is exclusively a unit-test symbol.**

`grep -r "TESTSTK" artifacts/api-server/src/` → only `swingOrderStaging.test.ts` (14 occurrences). Zero production code, zero routes, zero DB rows (confirmed via `SELECT * FROM swing_order_staging`).

Actual DB staging rows: RELIANCE, INFY, WIPRO, TCS (all valid symbols).

**Root cause of any historical TESTSTK Telegram message:** A developer manually POSTed to `POST /swing/staged-orders` with `{ "symbol": "TESTSTK", ... }` during testing. Since the staging route uses `requireOwner` (owner-only) but does NOT validate against the Kite instrument master, the order was created and `alertSwingOrderStaged()` fired a real Telegram message.

**Fix implemented:** `validateTradeEventForNotification()` guard includes `TEST_SYMBOL_BLOCKED` for any symbol matching `["TESTSTK", "TEST", "SAMPLE", "DUMMY"]` or the pattern `/^TEST/i`. This guard must be called before any `alertOwnerRaw` dispatch for canonical trade events.

---

## 4. Multiple Telegram Messages Root Cause

**Swing order lifecycle fires one message per state transition.** For a typical order:

1. `stageSwingOrder()` → `alertSwingOrderStaged()` → `SWING_ORDER_STAGED` message
2. If the order then expires (TTL sweep) → `alertSwingOrderExpired()` → `SWING_ORDER_EXPIRED` message

This is 2 messages for 1 order. The current design fires on every lifecycle transition.

**What the prompt requires:** Only **ENTRY_READY** and **EXIT** events go to the main trade channel. Staging events (STAGED, APPROVAL_REQUIRED, EXPIRED, REJECTED, APPROVED_DRY_RUN) are internal lifecycle events that **should not reach the main trade Telegram channel** as actionable alerts.

**Root cause:** `swingAlerts.ts` fires Telegram for all lifecycle events without distinguishing between trade-channel-worthy events and internal diagnostic events.

**Fix implemented:**
- Define canonical `TradeAlertEventType` (ENTRY_READY, ENTRY_OPENED, EXIT_*)
- `validateTradeEventForNotification()` blocks events that are not canonical trade alerts
- `formatTradeTelegramMessage()` enforces the required format for allowed events
- System/health events (STAGED, APPROVAL_REQUIRED, EXPIRED, REJECTED, WARMUP_FAILED, etc.) remain as internal `alertOwner` calls but are NOT routed through the canonical trade formatter

---

## 5. Full F&O Lifecycle Trace

```
Kite data fetch (getHistoricalData)
  ↓ centralIndexCandles(yahoo, "15minute", 5) — fails if null
  → "no_live_kite_intraday" suppression

Kite data fetch (getHistoricalData)
  ↓ centralIndexCandles(yahoo, "day", 180) — fails if null
  → "daily_history_unavailable_kite" suppression

getOptionSignals()  [artifacts/api-server/src/lib/optionSignals.ts]
  ↓ buildSignalsForIndex() per OPTION_INDICES entry
  ↓ scoreConfluence() / regimeClassifier / ema / rsi
  ↓ HC/BASELINE partition
  ↓ post-emission gates (ATM-OI, demote, heat cap)
  ↓ evaluateOrphanedOpenTrades()
  ↓ runPremiumHardStopSweep()
  ↓ expireOpenSignalsForToday()
  → OptionSignalsResult { signals[], diagnostics }

[DB] fno_signal_reasoning rows written per signal
[DB] paper_signal rows written per signal (recordOrUpdate)

/api/options/signal-history  [routes/scanner.ts]
  ← GET from frontend (F&O page)
  ← returns cached/DB signal history

/api/fno/diagnostics  [routes/fno.ts]
  ← GET from F&O diagnostics page
  ← lastCycleMeta from in-memory store

openPaperTrade()  [lib/paperTradingFO.ts]
  ← called from getOptionSignals for HC signals
  ← gates: premium, DD caps, heat cap, risk guard
  → paper_trade_fo row
  → alertFnoTradeableSignal()  [lib/fnoSignalAlerts.ts]
    → Telegram: "F&O TRADEABLE SIGNAL" (main bot, 30-min dedup)
```

### Data Objects at Each Stage

| Stage | File | DB Table | In-Memory State |
|---|---|---|---|
| Signal emission | `optionSignals.ts` | `paper_signal` | `lastCycleMeta`, `suppressed[]` |
| Paper trade open | `paperTradingFO.ts` | `paper_trade_fo` | none |
| Telegram alert | `fnoSignalAlerts.ts` | none | `lastFnoSignalAlertRecord` |
| UI display | `routes/scanner.ts` → `/api/options/signal-history` | `paper_signal` | none |
| Diagnostics | `routes/fno.ts` → `/api/fno/diagnostics` | none | `lastCycleMeta` |

---

## 6. Full Swing Lifecycle Trace

```
Scanner candidate (StockRow with swing score)
  ↓ owner clicks "Stage" in Swing Queue UI
  ↓ POST /swing/staged-orders  [routes/swingStaging.ts]
    ↓ evaluateSwingCashRisk()  [lib/swingOrderStaging.ts]
      → Allowed → status STAGED
      → Review Required → status APPROVAL_REQUIRED
      → Hard Block → rejected (not stored)
    [DB] swing_order_staging row created
    ↓ alertSwingOrderStaged(row)  [lib/swingAlerts.ts]
      → Telegram: "SWING CASH ALERT" (main bot, 15-min dedup per order)

  ↓ TTL sweep (8h) → expireStaleSwingOrders()
    [DB] status → EXPIRED
    → Telegram: SWING_ORDER_EXPIRED

  ↓ owner clicks "Reject"
    [DB] status → REJECTED
    → Telegram: SWING_ORDER_REJECTED

  ↓ owner clicks "Approve"
    ↓ POST /swing/staged-orders/:id/approve
    ↓ approveSwingOrder(id, fetchQuote)  [lib/swingOrderStaging.ts]
      → re-check: live quote, chase check, gates
      → config.mode === "live_dry_run":
        [DB] status → DRY_RUN_PLACED
        → Telegram: SWING_ORDER_APPROVED_DRY_RUN
      → config.mode === "broker_disabled":
        [DB] status → APPROVED
        → no Telegram (broker-disabled no-op, silent by design)

Risk block (in swingStaging.ts route):
  → alertSwingOrderBlockedByRisk(symbol, setupKey, reasons)
    → Telegram: SWING_ORDER_BLOCKED_BY_RISK (1-hour dedup per symbol+setup)
```

### Data Objects at Each Stage

| Stage | File | DB Table | In-Memory State |
|---|---|---|---|
| Candidate staging | `swingOrderStaging.ts` | `swing_order_staging` | none |
| Risk evaluation | `swingOrderStaging.ts` | none | none |
| Telegram dispatch | `swingAlerts.ts` | none | `lastSwingAlertRecord` |
| UI Swing Queue | `routes/swingStaging.ts` → `/api/swing/staged-orders` | `swing_order_staging` | none |

---

## 7. Surface Parity Comparison

### F&O Signal State — Which Source Does Each Surface Use?

| Surface | API Route | Data Source | In-Memory? | DB? |
|---|---|---|---|---|
| F&O page setup cards | `GET /api/options/signal-history` | DB (`paper_signal`) + in-memory cycle | Both | Yes |
| F&O diagnostics page | `GET /api/fno/diagnostics` | `lastCycleMeta` (in-process) | Yes | No |
| F&O suppression table | `GET /api/fno/diagnostics` | `lastCycleMeta.suppressed` | Yes | No |
| Telegram F&O alert | `alertFnoTradeableSignal()` | `openPaperTrade()` input | No | Yes (trade row) |
| Pre-market report | `buildPreMarketReport()` | `getLastFnoCycleState()` | Yes | No |

**Divergence risk**: The F&O diagnostics page uses `lastCycleMeta` which is per-process. On a 2-worker prod deployment, pid=19's diagnostic page shows correct data while pid=18's shows stale data. Both are behind the same load balancer — the page content varies by which worker answers the request.

**Recommended fix**: Persist `lastCycleMeta` to DB (a lightweight table) so all workers share the same signal-cycle state. This is a follow-up task (marked below).

### Swing State — Which Source Does Each Surface Use?

| Surface | API Route | Data Source | In-Memory? | DB? |
|---|---|---|---|---|
| Swing Queue | `GET /api/swing/staged-orders` | DB (`swing_order_staging`) | No | Yes |
| Paper Trading tab | `GET /api/paper/positions` | DB (`paper_trade_eq`) | No | Yes |
| Telegram alert | `alertSwingOrderStaged(row)` | Staging row at creation time | No | Yes (frozen snapshot) |

Swing surfaces are fully DB-backed → **no per-worker divergence**.

---

## 8. Implementation Actions

### Completed in This Task

| # | Action | File | Type |
|---|---|---|---|
| 1 | Canonical trade event types | `lib/tradeLifecycle/types.ts` | New |
| 2 | Trade event validation guard (11 reason codes) | `lib/tradeLifecycle/validateTradeEvent.ts` | New |
| 3 | Canonical Telegram formatter | `lib/tradeLifecycle/formatTelegramMessage.ts` | New |
| 4 | DB-backed notification dedup log | `lib/tradeLifecycle/notificationLog.ts` | New |
| 5 | Barrel export | `lib/tradeLifecycle/index.ts` | New |
| 6 | Auto-warmup trigger on F&O suppression | `lib/optionSignals.ts` | Modified |
| 7 | Unit tests for new lifecycle module | `lib/tradeLifecycle/tradeLifecycle.test.ts` | New |
| 8 | Investigation report | `SIGNAL_DATA_NOTIFICATION_PARITY_FIX_REPORT.md` | New |

### Follow-Up Tasks (Out of Scope Here)

| # | Action | Priority | Notes |
|---|---|---|---|
| F1 | Persist F&O `lastCycleMeta` to DB | HIGH | Eliminates per-worker diagnostic divergence |
| F2 | Wire `validateTradeEventForNotification` into `swingAlerts.ts` | HIGH | Blocks TESTSTK and non-trade-grade symbols |
| F3 | Wire `formatTradeTelegramMessage` as the single Telegram formatter | HIGH | Replaces `buildSwingOrderText`, `buildFnoSignalAlertText` formatters |
| F4 | Migrate swing staging alerts to only fire on `ENTRY_READY` | MEDIUM | Requires product decision on which lifecycle events are trade alerts |
| F5 | Add instrument master validation to staging route | MEDIUM | Prevents arbitrary symbols from entering the staging pipeline |
| F6 | Per-worker warmup state shared via DB | LOW | True multi-worker parity; current warmup is per-process |

---

## 9. Architecture Decisions

### Decision A: Dynamic import in optionSignals.ts
`kiteWarmup.ts` imports `OPTION_INDICES` from `optionSignals.ts`. Adding a static import of `triggerKiteWarmup` in `optionSignals.ts` would create a circular dependency. Solution: use `import()` dynamic import (lazy, runtime-only) inside the conditional block. This is safe because the module system resolves the cycle at runtime after both modules have initialized.

### Decision B: Canonical types are additive
The `tradeLifecycle/` module is purely additive. It does not replace existing `swingAlerts.ts`, `fnoSignalAlerts.ts`, or `alerting.ts`. Existing alert functions continue to work unchanged. The new types provide the foundation for future migration.

### Decision C: notification_delivery_log uses CREATE TABLE IF NOT EXISTS
Consistent with `daily_report_runs` table pattern. Never uses `drizzle-kit push` (would risk DROP on other out-of-schema tables). Safe to re-run on every process start.

### Decision D: validateTradeEventForNotification is pure
No DB calls, no Telegram calls, no async. Takes the canonical event and a context object, returns a result synchronously. This makes it fully testable and callable from any path without async overhead.

### Decision E: Warmup trigger uses "scheduler" trigger
`kiteWarmup.ts` already has a `WARMUP_DEBOUNCE_MS = 60_000` debounce for non-login/non-manual triggers. Using `"scheduler"` means the auto-retry from the F&O cycle (which runs every ~30s) debounces to at most one warmup per 60 seconds per session. Safe, no spam.
