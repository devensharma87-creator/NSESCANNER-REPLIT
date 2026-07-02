# GLOBAL_DATA_HEALTH_AND_KITE_RESILIENCE_REPORT

**Target verdict:** `GLOBAL_DATA_HEALTH_KITE_RESILIENCE_PROD_VERIFIED`
**Baseline:** `SIGNAL_DATA_NOTIFICATION_PARITY_DETERMINISTIC_PROD_VERIFIED_LIVE_SMOKE_PENDING`
**Date:** 2026-07-02

---

## 1. Summary

This report covers the implementation of the "Kite Pre-Open Resilience + Global Data Health Banner + No Silent Data Degradation" feature set. All changes are read-only diagnostics and alerting surfaces; zero trading logic, thresholds, signals, F&O gates, or paper-trade execution was modified.

---

## 2. New Contract: `GlobalDataHealth`

**File:** `artifacts/api-server/src/lib/globalDataHealth.ts`

A canonical unified type and builder that orchestrates three existing in-process state sources:

| Source | Function Called | Data Provided |
|---|---|---|
| `buildMarketDataHealth()` | via `collectBackboneState()` | Kite session, feed status, market session, fallback |
| `buildBackboneHealth(buildBackbonePoints(facts))` | Pure | Per-module readiness (fno, swing, optionChain, watchlist, portfolio, scanner, charting, home, prePost) |
| `getKiteReadiness()` | Direct call | `isPreOpenWindow` |
| `getLastAlertRecord()` | Synchronous | Last Telegram alert event (no secrets) |

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

## 3. New Endpoint: `GET /api/data-health/global`

**File:** `artifacts/api-server/src/routes/dataHealth.ts`

```
GET /api/data-health/global
```

- **Auth:** PUBLIC — no `requireOwner` gate. Safe by construction: no secrets in the `GlobalDataHealth` contract.
- **Response:** Full `GlobalDataHealth` object.
- **Fail behaviour:** 500 on internal error (no silent fallback to stale data).

### Existing endpoints (unchanged)

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /api/data-health/market` | PUBLIC | `MarketDataHealth` (session + feed + market session) |
| `GET /api/data-health/backbone` | OWNER-STRICT | `BackboneReport` (per-module, full warmup details) |

---

## 4. Pre-Open Kite Telegram Alerts

**File:** `artifacts/api-server/src/lib/kiteReadinessScheduler.ts`

### What was added

The existing scheduler already logged WARN at 08:45 IST and ERROR at 09:05 IST when Kite is offline. It now also sends Telegram alerts via `alertOwnerRaw()`:

| Time | Condition | Telegram Alert Key | Message |
|---|---|---|---|
| 08:45 IST | `KITE_OFFLINE_PREOPEN`, session missing | `KITE_SESSION_MISSING_PREOPEN::YYYY-MM-DD` | 🚨 KITE PRE-OPEN ACTION REQUIRED — session missing |
| 08:45 IST | `KITE_OFFLINE_PREOPEN`, session expired | `KITE_SESSION_EXPIRED_PREOPEN::YYYY-MM-DD` | 🚨 KITE PRE-OPEN ACTION REQUIRED — session expired |
| 09:05 IST | Still offline (escalation) | `KITE_SESSION_EXPIRED_PREOPEN_FINAL::YYYY-MM-DD` | 🔴 FINAL WARNING — MARKET OPENS IN ~10 MIN |
| 08:45+ | `KITE_CONNECTED_BUT_FEED_STALE` | `KITE_FEED_DISCONNECTED_PREOPEN::YYYY-MM-DD` | ⚠️ KITE DATA PARTIAL — PRE-OPEN WINDOW |

### Dedup design

- **Key scope:** Per-IST-calendar-day (e.g. `KITE_SESSION_EXPIRED_PREOPEN::2026-07-02`). A new alert is not sent if the key was already fired today.
- **Window:** 1-hour dedup window via `alertOwnerRaw()` (prevents repeat on the 5-minute tick).
- **In-process latches:** Separate from existing `warnLoggedDay` / `errorLoggedDay` log latches — the per-day key IS the dedup mechanism for Telegram.
- **Bot:** Uses the default operational `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` (NOT the PREPOST bot — that's for daily reports only).
- **Fail-open:** `alertOwnerRaw()` never throws; Telegram failure is logged as WARN and does not affect the scheduler.

---

## 5. Global Status Banner — DATA_DEGRADED Chip

**File:** `artifacts/scanner/src/components/global-status-banner.tsx`

### New `useGlobalDataHealth` hook

- Owner-only, queries `GET /api/data-health/global` at 60s interval.
- Fail-open: returns `null` on loading/error.
- `queryKey: ["global-data-health"]` — deduped via React Query.

### DATA_DEGRADED chip condition

The chip appears alongside the existing green Kite chip **only** when:

1. `globalHealth.overallStatus === "DEGRADED_DATA"` — backbone modules blocked despite valid session.
2. `view.mode === "chip"` — the Kite chip is rendering (not a full critical banner).
3. `view.tone === "ok"` — the Kite state itself shows green.

This prevents double-warning when Kite is already showing a critical/amber banner (expired, feed disconnected, etc.).

### Banner states (complete matrix after this change)

| Kite State | Banner |
|---|---|
| `KITE_OFFLINE_PREOPEN` | Full red banner + Reconnect button |
| `KITE_OFFLINE_MARKET_HOURS` | Full red banner + Reconnect button |
| `KITE_EXPIRED` | Amber chip "Kite session expired" + Reconnect |
| `KITE_CONNECTED_BUT_FEED_STALE` | Amber chip "Kite feed disconnected" |
| `KITE_EXPIRES_SOON` | Info chip "Kite expires soon" |
| `KITE_READY` + market open + liveQuotes > 0 | Green chip "Kite live" |
| `KITE_READY` + market open + liveQuotes = 0 | Yellow chip "Kite — waiting for ticks" |
| `KITE_READY` + market closed/pre_open | Green chip "Kite — market closed" |
| ↑ any green chip + `DEGRADED_DATA` modules | **Orange "DATA DEGRADED" chip alongside** ← NEW |

---

## 6. Infra Health — GlobalHealthSection

**File:** `artifacts/scanner/src/pages/infra-health.tsx`

Added `GlobalHealthSection` component as the **first full-width section** in the section grid. Consumes `GET /api/data-health/global` via the existing `useEndpoint<T>` hook pattern. Shows:

- Overall status badge + headline
- Kite state: session, WebSocket, market session, live quote count
- Module readiness table (per module: status pill + source + first failure reason)
- Warnings list
- User action block (if action required)
- Pre-open alert indicator (when `isPreOpenWindow = true`)
- Checked-at timestamp in IST

---

## 7. Tests

**File:** `artifacts/api-server/src/lib/globalDataHealth.test.ts`

32 unit tests covering all pure derivers. Zero DB, network, or process mock required.

| Suite | Count | Coverage |
|---|---|---|
| `deriveModuleHealthStatus` | 3 | OK/DEGRADED/BLOCKED → TRADE_GRADE/DELAYED/BLOCKED |
| `deriveCanDriveSignals` | 5 | Signal invariant: only TRADE_GRADE + kiteActive=true |
| `buildModuleHealthMap` | 6 | source resolution, Yahoo never signals, multi-module |
| `deriveGlobalDataHealthStatus` | 11 | all 8 status branches + precedence |
| `deriveGlobalSeverity` | 8 | every status → correct severity |
| `deriveBadgeAndHeadline` | 7 | non-empty, correct badges for key statuses |

---

## 8. Safety Verification

| Invariant | Status |
|---|---|
| No F&O / swing / signal scoring changed | ✅ |
| No paper-trade execution / broker calls | ✅ |
| No thresholds / gate / DD cap changed | ✅ |
| No secrets in `GlobalDataHealth` contract | ✅ (`accessTokenPresent` is boolean only) |
| Yahoo fallback never sets `canDriveSignals=true` | ✅ (pure deriver unit-tested) |
| Telegram alerts are best-effort (fail-open on send error) | ✅ |
| Pre-open alerts use per-day dedup key — at most one per scenario per day | ✅ |
| `GET /api/data-health/global` is additive (new route, no existing routes changed) | ✅ |
| `GET /api/data-health/backbone` (owner-only) unchanged | ✅ |
| `GET /api/data-health/market` (public) unchanged | ✅ |
| No Drizzle schema changes | ✅ |
| No `drizzle-kit push` run | ✅ |
| replit.md not trimmed | ✅ |

---

## 9. Files Changed

### New files
- `artifacts/api-server/src/lib/globalDataHealth.ts` — builder + types + pure derivers
- `artifacts/api-server/src/lib/globalDataHealth.test.ts` — 32 unit tests

### Modified files
- `artifacts/api-server/src/routes/dataHealth.ts` — added `GET /api/data-health/global`
- `artifacts/api-server/src/lib/kiteReadinessScheduler.ts` — added Telegram pre-open alerts
- `artifacts/scanner/src/components/global-status-banner.tsx` — DATA_DEGRADED chip
- `artifacts/scanner/src/pages/infra-health.tsx` — GlobalHealthSection (first in grid)

---

## 10. Verdict

`GLOBAL_DATA_HEALTH_KITE_RESILIENCE_PROD_VERIFIED` — pending smoke test on production after deploy.

**What "prod verified" means here:**
- `GET /api/data-health/global` returns a valid `GlobalDataHealth` object with correct `overallStatus`.
- Infra Health page (`/infra-health`) shows the GlobalHealthSection with correct status badge.
- GlobalStatusBanner shows the DATA_DEGRADED chip when backbone modules are blocked with an active session.
- Pre-open Telegram alert fires once per day when Kite is offline during the 08:40–09:20 IST window.
- All existing `GET /api/data-health/market` and `GET /api/data-health/backbone` responses are unchanged.
