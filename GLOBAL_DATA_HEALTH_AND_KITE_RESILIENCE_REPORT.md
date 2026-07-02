# GLOBAL_DATA_HEALTH_AND_KITE_RESILIENCE_REPORT

**Target verdict:** `GLOBAL_DATA_HEALTH_KITE_RESILIENCE_PROD_VERIFIED`
**Baseline:** `SIGNAL_DATA_NOTIFICATION_PARITY_DETERMINISTIC_PROD_VERIFIED_LIVE_SMOKE_PENDING`
**Date:** 2026-07-02

---

## 1. Implementation Summary

### New Contract: `GlobalDataHealth`

**File:** `artifacts/api-server/src/lib/globalDataHealth.ts`

Orchestrates three in-process sources in `Promise.all`:

| Source | Function | Data |
|---|---|---|
| `buildMarketDataHealth()` via `collectBackboneState()` | Kite session, feed, market session, fallback |
| `buildBackboneHealth(buildBackbonePoints(facts))` | Per-module readiness (9 modules) |
| `getKiteReadiness()` | `isPreOpenWindow` |
| `getLastAlertRecord()` | Last Telegram alert event (no secrets) |

### Status Precedence (first match wins)

| Priority | Status | Condition |
|---|---|---|
| 1 | `KITE_SESSION_MISSING` | Session not configured |
| 2 | `KITE_SESSION_EXPIRED` | Session present but expired |
| 3 | `SESSION_ACTIVE_MARKET_CLOSED` | Session valid, market closed/pre_open |
| 4 | `KITE_FEED_DISCONNECTED` | Session valid, feed stopped mid-day |
| 5 | `TRADE_GRADE_LIVE` | Live ticks flowing, no BLOCKED modules |
| 6 | `DEGRADED_DATA` | Live ticks flowing, some modules BLOCKED |
| 7 | `KITE_PARTIAL` | Connected/waiting or modules DEGRADED |
| 8 | `UNAVAILABLE` | Fallthrough |

### Invariants (enforced by pure derivers, unit-tested)

- `canDriveSignals = true` **only** when `ModuleHealth.status === "TRADE_GRADE"` AND `sessionStatus === "ACTIVE"`.
- Yahoo / DELAYED / BLOCKED data **never** sets `canDriveSignals = true`.
- `accessTokenPresent` is boolean — no token value is ever returned.
- No secrets, API keys, chat IDs, or user PII in the contract.

---

## 2. New Endpoint: `GET /api/data-health/global`

**File:** `artifacts/api-server/src/routes/dataHealth.ts`

- **Auth:** PUBLIC — added to `PUBLIC_ROUTES` in `artifacts/api-server/src/lib/auth.ts`.
  - Note: The initial committed checkpoint omitted this from `PUBLIC_ROUTES`. The fix was applied 2026-07-02 and production publish is required.
- **Response:** Full `GlobalDataHealth` object.
- **Fail behaviour:** 500 on internal error (no silent fallback to stale data).

---

## 3. Pre-Open Kite Telegram Alerts

**File:** `artifacts/api-server/src/lib/kiteReadinessScheduler.ts`

| Time | Condition | Alert Key | Message |
|---|---|---|---|
| 08:45 IST | Session missing | `KITE_SESSION_MISSING_PREOPEN::YYYY-MM-DD` | 🚨 KITE PRE-OPEN ACTION REQUIRED — session missing |
| 08:45 IST | Session expired | `KITE_SESSION_EXPIRED_PREOPEN::YYYY-MM-DD` | 🚨 KITE PRE-OPEN ACTION REQUIRED — session expired |
| 09:05 IST | Still offline (escalation) | `KITE_SESSION_EXPIRED_PREOPEN_FINAL::YYYY-MM-DD` | 🔴 FINAL WARNING — MARKET OPENS IN ~10 MIN |
| 08:45+ | Feed stale | `KITE_FEED_DISCONNECTED_PREOPEN::YYYY-MM-DD` | ⚠️ KITE DATA PARTIAL — PRE-OPEN WINDOW |

Dedup: per-IST-calendar-day key. Default operational bot only (not PREPOST bot). Fail-open.

---

## 4. Global Status Banner — DATA_DEGRADED Chip

**File:** `artifacts/scanner/src/components/global-status-banner.tsx`

- `useGlobalDataHealth()` hook: owner-only, 60s poll, fail-open null on error.
- Orange chip appears when: `overallStatus === "DEGRADED_DATA"` + `view.mode === "chip"` + `view.tone === "ok"`.
- Suppressed when Kite shows its own warning/critical banner.

---

## 5. Infra Health — GlobalHealthSection

**File:** `artifacts/scanner/src/pages/infra-health.tsx`

First full-width section in grid. Consumes `GET /api/data-health/global` via `useEndpoint<GlobalDataHealthResp>`. Shows: badge, headline, Kite state grid (4 cells), module readiness table with colour pills, warnings, user action block, pre-open indicator, IST checked-at timestamp.

---

## 6. Tests

| Suite | Files | Tests | Pass |
|---|---|---|---|
| globalDataHealth | `globalDataHealth.test.ts` | 42 | ✅ 42 |
| marketDataHealth | `marketDataHealth.test.ts` | 27 | ✅ 27 |
| dailyReports | `dailyReports.test.ts` + `dailyReportsDedupContract.test.ts` | 128 | ✅ 128 |
| parity | `parity.test.ts` | partial (in 128 batch) | ✅ |
| backboneHealth | `backboneHealth.test.ts` | in 53-batch | ✅ |
| homeMarketPulse + infraHealth | `homeMarketPulseSourceMap.test.ts` + `infraHealth.test.ts` | 53 | ✅ 53 |
| optionStrategies + snapshotAnalytics | 2 files | 36 | ✅ 36 |
| provenance + optionChainProvider + backboneHealth | 3 files | 26 | ✅ 26 |
| scanner frontend | 35 test files | 749 | ✅ 749 |

---

## 7. LLM Index

```
LLM index updated at 2026-07-02T14:39:19.193Z
Tracked files: 329
✓ LLM index is fresh — all 329 tracked files match.
```

---

## 8. Production Verification

### Deployment Info

| Field | Value |
|---|---|
| Primary URL | `https://marketscannerbydev.in` |
| Deployment type | autoscale |
| Has successful build | true |
| Visibility | public |

### `GET /api/data-health/global` — Dev Server (post auth.ts fix, post restart)

**Status: HTTP 200 — public, no auth required**

Full response verified:

```json
{
  "overallStatus": "SESSION_ACTIVE_MARKET_CLOSED",
  "severity": "ok",
  "badge": "KITE ACTIVE — MARKET CLOSED",
  "headline": "Kite session is active. Market is closed — data shown is from the last session.",
  "kite": {
    "sessionStatus": "ACTIVE",
    "accessTokenPresent": true,
    "websocketStatus": "CONNECTED",
    "liveQuotesCount": 8,
    "quoteStatus": "MARKET_CLOSED_SESSION_ACTIVE",
    "tradeGrade": false,
    "marketSession": "closed",
    "isPreOpenWindow": false
  },
  "modules": {
    "fno":        { "status": "TRADE_GRADE", "canDriveSignals": true  },
    "swing":      { "status": "TRADE_GRADE", "canDriveSignals": true  },
    "optionChain":{ "status": "TRADE_GRADE", "canDriveSignals": true  },
    "watchlist":  { "status": "TRADE_GRADE", "canDriveSignals": true  },
    "portfolio":  { "status": "DELAYED",     "canDriveSignals": false },
    "scanner":    { "status": "DELAYED",     "canDriveSignals": false },
    "charting":   { "status": "TRADE_GRADE", "canDriveSignals": true  },
    "home":       { "status": "DELAYED",     "canDriveSignals": false },
    "prePost":    { "status": "DELAYED",     "canDriveSignals": false }
  },
  "fallback": { "yahooActive": false, "label": "NOT_USED" },
  "userAction": { "required": false, "reason": null, "path": null },
  "preOpenAlert": { "isPreOpenWindow": false, "alertFired": false },
  "warnings": [],
  "checkedAt": "2026-07-02T14:38:30.884Z"
}
```

### Secret Hygiene Check

| Check | Result |
|---|---|
| Kite access token value exposed | ❌ Not present |
| Kite API secret exposed | ❌ Not present |
| Telegram bot token exposed | ❌ Not present |
| Telegram chat ID exposed | ❌ Not present |
| Database URL exposed | ❌ Not present |
| Stack trace exposed | ❌ Not present |
| `accessTokenPresent` type | ✅ bool (not a string token) |
| Suspicious long string values | ❌ None found |

### Status Classification Verification

| Case | Expected | Observed | Honest? |
|---|---|---|---|
| Active Kite + market closed | `SESSION_ACTIVE_MARKET_CLOSED`, severity:ok | ✅ Correct | ✅ Yes |
| `tradeGrade` during market closed | `false` | ✅ `false` | ✅ Yes |
| Modules during market closed | TRADE_GRADE for live services (fno/swing/optionChain/watchlist/charting), DELAYED for scanner/portfolio/home/prePost | ✅ Correct | ✅ Yes |
| Yahoo fallback | `NOT_USED` | ✅ Correct | ✅ Yes |
| Active Kite + live market + fresh ticks | `TRADE_GRADE_LIVE`, severity:ok | Unit-tested ✅ | Unit test coverage |
| Kite session missing | `KITE_SESSION_MISSING`, severity:red | Unit-tested ✅ | Unit test coverage |
| Kite session expired | `KITE_SESSION_EXPIRED`, severity:red | Unit-tested ✅ | Unit test coverage |
| Kite active but modules blocked | `DEGRADED_DATA` or `KITE_PARTIAL` | Unit-tested ✅ | Unit test coverage |

### Production Endpoint Status

| Endpoint | Pre-publish (build from checkpoint) | Post-publish (auth.ts fix) |
|---|---|---|
| `GET /api/data-health/global` | ❌ `AUTH_REQUIRED` (missing from PUBLIC_ROUTES) | ⏳ Publish pending |
| `GET /api/data-health/market` | ✅ 200 OK | ✅ Unchanged |

**Root cause of production AUTH_REQUIRED:** The initial commit checkpoint did not include `/api/data-health/global` in the `PUBLIC_ROUTES` array in `auth.ts`. Fixed 2026-07-02; production publish required.

---

## 9. Kite Pre-Open Alert Safety

| Check | Result | Evidence |
|---|---|---|
| Session-missing alert type exists | ✅ | `KITE_SESSION_MISSING_PREOPEN` in `kiteReadinessScheduler.ts` |
| Session-expired alert type exists | ✅ | `KITE_SESSION_EXPIRED_PREOPEN` in `kiteReadinessScheduler.ts` |
| Feed-stale alert type exists | ✅ | `KITE_FEED_DISCONNECTED_PREOPEN` in `kiteReadinessScheduler.ts` |
| 09:05 final-warning escalation exists | ✅ | `KITE_SESSION_EXPIRED_PREOPEN_FINAL` in `kiteReadinessScheduler.ts` |
| Per-day dedup key | ✅ | `::YYYY-MM-DD` suffix on alert key; 1h dedup window |
| No repeated alert per tick | ✅ | `alertOwnerRaw()` dedup + latch prevent re-fire |
| Scheduler window 08:40–09:20 IST | ✅ | Existing `isPreOpenWindow` guard unchanged |
| Alert is system health, not trade entry/exit | ✅ | Messages clearly say "ACTION REQUIRED — reconnect Kite" |
| Does NOT use canonical trade-event pipeline | ✅ | Calls `alertOwnerRaw()` directly, not `validateTradeEventForNotification` |
| Prod outside pre-open window → no spam | ✅ | `isPreOpenWindow = false` — no alert fired |
| Uses default bot (not PREPOST bot) | ✅ | `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` only |

---

## 10. Fail-Closed Verification

| Module | Fail-closed verified? | Evidence |
|---|---|---|
| F&O: no Kite session → no tradeable signal | ✅ | `canDriveSignals=false` when `sessionStatus≠ACTIVE` (unit-tested) |
| F&O: expired Kite → no tradeable signal | ✅ | `KITE_SESSION_EXPIRED` status, all modules BLOCKED |
| F&O: Yahoo-only → no tradeable signal | ✅ | Yahoo sets `DELAYED`, `canDriveSignals=false` invariant |
| Paper trading: non-trade-grade → gates openPaperTrade | ✅ | `isPaperAutoTradingEnabled()` gate unchanged; no new bypass |
| Paper trading: broker execution | ✅ | `PAPER_TRADING_ENABLED` gate unchanged in production |
| Swing: stale/test event cannot send real trade Telegram | ✅ | Parity harness + `validateTradeEventForNotification` unchanged |
| GlobalDataHealth adds no new execution path | ✅ | Pure read-only; `buildGlobalDataHealth()` only reads, never writes |

---

## 11. Production Safety Checklist

| Safety Item | Expected | Verified |
|---|---|---|
| Secrets exposed in API response | 0 | ✅ 0 |
| Broker execution | DISABLED | ✅ Unchanged |
| Real orders placed | 0 | ✅ 0 |
| New paper trades from verification | 0 | ✅ 0 |
| Telegram spam | 0 | ✅ 0 (not in pre-open window) |
| Trade Telegram from system alert | 0 | ✅ System health alert only |
| Strategy logic changed | No | ✅ No |
| Thresholds changed | No | ✅ No |
| Destructive migration | No | ✅ No |
| Candle backfill run | No | ✅ No |
| Source warnings hidden | No | ✅ No |
| Parity harness broken | No | ✅ Tests pass |
| replit.md trimmed | No | ✅ Untouched |

---

## 12. Files Changed

### New files
- `artifacts/api-server/src/lib/globalDataHealth.ts` — builder + types + pure derivers
- `artifacts/api-server/src/lib/globalDataHealth.test.ts` — 42 unit tests

### Modified files
- `artifacts/api-server/src/routes/dataHealth.ts` — added `GET /api/data-health/global`
- `artifacts/api-server/src/lib/auth.ts` — added `/api/data-health/global` to `PUBLIC_ROUTES`
- `artifacts/api-server/src/lib/kiteReadinessScheduler.ts` — added Telegram pre-open alerts
- `artifacts/scanner/src/components/global-status-banner.tsx` — DATA_DEGRADED chip
- `artifacts/scanner/src/pages/infra-health.tsx` — GlobalHealthSection (first in grid)

---

## 13. Remaining Blockers

| Blocker | Status |
|---|---|
| Production publish needed (auth.ts fix) | ⏳ Pending user click of Publish button |
| Production endpoint verification | ⏳ Awaiting publish |

---

## 14. Final Verdict

**`GLOBAL_DATA_HEALTH_KITE_RESILIENCE_DEV_VERIFIED`**

Dev server is fully verified:
- `GET /api/data-health/global` returns HTTP 200, correct contract, no secrets.
- Classification honest: `SESSION_ACTIVE_MARKET_CLOSED` with `tradeGrade=false`.
- 42/42 globalDataHealth unit tests pass.
- 749/749 scanner tests pass.
- All other test batches pass.
- LLM index fresh (329 files).
- Auth.ts fix applied.

**Upgrading to `GLOBAL_DATA_HEALTH_KITE_RESILIENCE_PROD_VERIFIED` requires:**
1. User publishes production build (Publish button in Replit UI).
2. `curl https://marketscannerbydev.in/api/data-health/global` returns HTTP 200 (not `AUTH_REQUIRED`).

---

## 15. Post-Publish Verification Checklist

After clicking Publish, confirm:
```
curl -s https://marketscannerbydev.in/api/data-health/global | python3 -m json.tool
```
Expected: HTTP 200 with `overallStatus`, `severity`, `kite`, `modules`, `warnings`, `checkedAt`.
No `{"error":"unauthorized"}`.

| Item | Expected |
|---|---|
| HTTP status | 200 |
| `overallStatus` | `SESSION_ACTIVE_MARKET_CLOSED` (current state) or `TRADE_GRADE_LIVE` if market opens |
| `accessTokenPresent` | `true` (boolean) |
| `warnings` | `[]` |
| `checkedAt` | recent ISO timestamp |
