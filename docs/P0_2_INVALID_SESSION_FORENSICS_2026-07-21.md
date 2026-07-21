# P0.2 — Invalid-Session Equity Trade Forensics
**Date:** 2026-07-21  
**Branch:** `phase0/authorized-remediation-20260720`  
**Status:** Root cause identified, session gate implemented, tests passing.

---

## Root Cause

`openPaperEquityTrade` (paperTradingEq.ts) had **no market-session check**. The NSE equity scanner in `fullNseScanner.ts` fires every 60 seconds around the clock via `runSwingTickForLatestScan → runEquityPaperTradingTick → openPaperEquityTrade`. Every overnight tick that found STRONG_BUY candidates in the scanner cache could open paper positions — even at 23:41 IST, 06:13 IST, or on a Saturday.

`computeMarketStatus` existed in `marketEvents.ts` and is correct (checks weekdays, 09:15–15:30 IST, NSE holidays), but was never imported or called in the equity trade writer.

---

## Fix Applied

1. **`paperTradingEq.ts` — Durable writer gate**: `computeMarketStatus(new Date())` checked after the duplicate-row guard, before stop-sanity. `AUTO` and `SWING_STAGED_APPROVAL` sources are blocked when session ≠ `"open"`. `MANUAL` source bypasses (owner override allowed at any time). Rejection recorded as `MARKET_CLOSED` in `paper_eq_audit`.

2. **`paperTradingEq.ts` — Belt-and-braces in tick runner**: `runEquityPaperTradingTick` also checks the session before iterating signals — avoids one DB audit-row write per signal on every closed-market tick. Mark-to-market still runs regardless.

3. **`paperEqAudit.ts`**: `"MARKET_CLOSED"` added to `EqAuditReason` union.

4. **`paper-trading.tsx`**: `fmtDateTime` updated to show year + `IST` suffix, forced to `Asia/Kolkata` timezone. `isOffSessionTimestamp` helper added. OFF-SESSION badge (orange) shown on any open position whose `openedAt` timestamp falls outside 09:15–15:30 IST Mon–Fri.

5. **`equitySessionGate.test.ts`**: 23 pure unit tests anchored to the exact invalid timestamps found in production.

---

## Production Forensics — Complete Invalid-Session Inventory

Query run against production read-only replica 2026-07-21. Total: **43 equity positions, 14 invalid-session**.

### OPEN positions with invalid session timestamps (need owner review)

| Symbol | opened_at IST | DOW | Reason | Capital |
|--------|--------------|-----|--------|---------|
| GRASIM | 2026-07-09 23:41:35 | Thu | INVALID_AFTER_SESSION | ₹1,69,506 |
| EXIDEIND | 2026-07-09 23:41:35 | Thu | INVALID_AFTER_SESSION | ₹1,98,090 |
| TITAN | 2026-07-09 23:41:35 | Thu | INVALID_AFTER_SESSION | ₹1,47,674 |
| ADANIGREEN | 2026-07-14 19:02:54 | Tue | INVALID_AFTER_SESSION | ₹54,075 |
| DLF | 2026-07-18 16:00:28 | **Sat** | INVALID_WEEKEND | ₹649 |

**Note:** The GRASIM/EXIDEIND/TITAN cluster (23:41:35 with sub-millisecond spread) was opened by a single scanner tick running at 23:41:35 IST on 2026-07-09 (Wednesday night). The DLF Saturday position carries `writer_version = paper-writer-v1.2.0-ledger-net` confirming it used the production code path; C0 block had not yet been deployed to production main at time of write.

### CLOSED positions with invalid session timestamps (historical record)

| Symbol | opened_at IST | DOW | Reason | Exit |
|--------|--------------|-----|--------|------|
| ASIANPAINT | 2026-05-14 06:13:32 | Thu | INVALID_BEFORE_SESSION | TRAIL_STOP_HIT |
| GRASIM | 2026-05-14 06:13:32 | Thu | INVALID_BEFORE_SESSION | TRAIL_STOP_HIT |
| GRASIM | 2026-05-15 19:34:00 | Fri | INVALID_AFTER_SESSION | TRAIL_STOP_HIT |
| JSWSTEEL | 2026-05-15 19:34:00 | Fri | INVALID_AFTER_SESSION | STOPPED |
| MANAPPURAM | 2026-05-19 07:28:07 | Tue | INVALID_BEFORE_SESSION | STOPPED |
| GMRINFRA | 2026-05-31 15:38:22 | **Sun** | INVALID_WEEKEND | MANUAL_OVERRIDE |
| PHOENIXLTD | 2026-06-16 21:25:33 | Tue | INVALID_AFTER_SESSION | TRAIL_STOP_HIT |
| TORNTPHARM | 2026-06-29 17:05:28 | Mon | INVALID_AFTER_SESSION | TRAIL_STOP_HIT |
| INDUSINDBK | 2026-07-03 21:32:00 | Fri | INVALID_AFTER_SESSION | TRAIL_STOP_HIT |

---

## Timestamp Cluster Analysis

| Cluster IST | Count | Symbols | Inference |
|------------|-------|---------|-----------|
| 2026-05-14 06:13:32 | 2 | ASIANPAINT, GRASIM | Single pre-session scanner tick |
| 2026-05-15 19:34:00 | 2 | GRASIM, JSWSTEEL | Single after-hours scanner tick |
| 2026-07-09 23:41:35 | 3 | GRASIM, EXIDEIND, TITAN | Single after-hours scanner tick (ms-spread) |
| 2026-06-30 14:56:17 | 2 | MAZDOCK, MARUTI | Valid-session tick (not invalid) |

Multi-symbol opens within the same millisecond confirm a single `runSwingTickForLatestScan` call opened multiple positions per tick.

---

## Valid OPEN Positions (session-clean)

| Symbol | opened_at IST | DOW | Capital |
|--------|--------------|-----|---------|
| ABB | 2026-06-29 15:12:03 | Mon | ₹1,61,000 |
| MARUTI | 2026-06-30 14:56:17 | Tue | ₹1,23,696 |
| DELHIVERY | 2026-07-01 14:55:01 | Wed | ₹69,377 |
| DLF | 2026-07-10 11:30:30 | Fri | ₹1,27,970 |

---

## Test Validation

- `equitySessionGate.test.ts`: **23/23 passing** — anchored to every invalid timestamp above
- `pnpm --filter @workspace/api-server exec tsc --noEmit`: **clean**
- `pnpm --filter @workspace/scanner exec tsc --noEmit`: **clean**
- `pnpm --filter @workspace/scanner run test`: **799/799 passing**
- Existing api-server equity/market-events tests: **31/31 passing**

---

## Owner Action Required

The 5 OPEN invalid-session positions (GRASIM, EXIDEIND, TITAN, ADANIGREEN, DLF-Sat) are real paper positions with capital deployed. Options:
1. **Manual close** via the Paper Trading → Equity → Open Positions → "Close" button (records as MANUAL_OVERRIDE)
2. **Leave open** — they will close normally via stop/target/time-stop evaluation; their invalid-session origin is now visible via the OFF-SESSION badge in the UI

The fix prevents any new invalid-session positions from being created. Existing ones are grandfathered and remain OPEN until their normal exit conditions are met.
