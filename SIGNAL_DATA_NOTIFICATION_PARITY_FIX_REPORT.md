# Signal, Data & Notification Parity — Production Verification Report

**Date:** 2026-07-02  
**Task:** Final production verification + hardening of the canonical trade lifecycle pipeline  
**Verdict:** `SIGNAL_DATA_NOTIFICATION_PARITY_CORE_PROD_VERIFIED_OPERATIONAL_ITEMS_PENDING`

---

## 1. Deployment Confirmation

| Item | Value |
|------|-------|
| HEAD commit | `899fc8e` "Publish production verification of trade lifecycle alerts" |
| Parity wiring commit | `5332557` "Integrate alerts into the canonical trade event pipeline" |
| Published-app commit | `5616f8d` "Published your App" |
| API health | `{"status":"ok"}` |
| LLM index | Fresh — 323 tracked files, generated `2026-07-02T11:14:41.686Z` |

The canonical pipeline (`5332557`) is in the published build. `5616f8d` is a deploy-trigger commit with no code change.

**All required modules confirmed present in production build:**

| Module | Path | Present |
|--------|------|---------|
| CanonicalTradeEvent types | `tradeLifecycle/types.ts` | ✅ |
| `validateTradeEventForNotification` | `tradeLifecycle/validateTradeEvent.ts` | ✅ |
| `formatTradeTelegramMessage` | `tradeLifecycle/formatTelegramMessage.ts` | ✅ |
| `notification_delivery_log` + init | `tradeLifecycle/notificationLog.ts` | ✅ |
| `hasAlreadyDelivered` (≡ gateAndLogDedup) | `tradeLifecycle/notificationLog.ts` | ✅ |
| `logNotificationDelivery` | `tradeLifecycle/notificationLog.ts` | ✅ |
| Barrel re-export | `tradeLifecycle/index.ts` | ✅ |
| Swing wiring | `swingAlerts.ts` | ✅ |
| F&O entry wiring | `fnoSignalAlerts.ts` | ✅ |
| F&O exit wiring | `paperTradingFO.ts:2270` (after tx commit) | ✅ |
| `TEST_SYMBOL_BLOCKED` | `validateTradeEvent.ts:38`, `fnoSignalAlerts.ts:49` | ✅ |
| `DEV_ENV_BLOCKED` | both files | ✅ |
| `DUPLICATE_EVENT` (DB dedup) | `notificationLog.ts` | ✅ |

---

## 2. Static Bypass Audit

### All `alertOwnerRaw` call-sites (non-test, non-definition)

| File | Line | Function | Alert Type | Canonical Pipeline? | Trade Channel? | Safe? |
|------|------|----------|------------|---------------------|----------------|-------|
| `alerting.ts` | 250 | — | DEFINITION | N/A | N/A | ✅ |
| `swingAlerts.ts` | 303 | `dispatchCanonicalEntry` | Swing ENTRY_READY | ✅ validate→dedup→format→send→log | ✅ Yes | ✅ |
| `fnoSignalAlerts.ts` | 438 | `dispatchFnoWithCanonicalGates` | F&O ENTRY_READY | ✅ test-sym→dev-env→DB-dedup→send→log | ✅ Yes | ✅ |
| `fnoSignalAlerts.ts` | 575 | `alertFnoExitSignal` | F&O EXIT | ✅ test-sym→dev-env→DB-dedup→send | ✅ Yes | ✅ |
| `fnoSignalAlerts.ts` | 715 | `alertFnoDataHealthAlert` | Infra health | ❌ Not trade | ❌ No (infra only) | ✅ not a trade alert |
| `routes/alerts.ts` | 110 | `test-swing-staged-order` | Test [SAMPLE] | N/A (owner test) | ✅ but labeled `[SAMPLE]` | ✅ rate-limited, owner-only |
| `routes/alerts.ts` | 171 | `test-fno-trade-signal` | Test [SAMPLE] | N/A (owner test) | ✅ but labeled `[SAMPLE — NOT A REAL TRADE]` | ✅ requires `confirmSampleAlert:true` |

### Legacy formatter status

`buildSwingOrderText()` and `buildSwingBlockedText()` are exported from `swingAlerts.ts` but have **zero production callers** — confirmed by grep. Only test files reference them. The production alert path exclusively uses `formatTradeTelegramMessage(CanonicalTradeEvent)`.

### Forbidden strings — production Telegram paths

| String | Status |
|--------|--------|
| `TESTSTK` | ✅ Blocked by `TEST_SYMBOL_BLOCKED` in both swing and F&O paths |
| `"Order staged for approval"` | ✅ `EVENT_LABEL` legacy map only; production sends ONE canonical `ENTRY_READY` regardless |
| `"Manual approval required"` | ✅ Same — legacy label only; `alertSwingOrderApprovalRequired` is not a separate Telegram call |
| `"Order approved — dry-run recorded"` | ✅ `alertSwingOrderApprovedDryRun` → `logger.info` only, no Telegram |

---

## 3. TESTSTK / Test Symbol Block Verification

### Blocked symbol lists

**`validateTradeEvent.ts` (Swing path):**
```
["TESTSTK", "TEST", "SAMPLE", "DUMMY", "PLACEHOLDER", "FAKE", "MOCK",
 "TESTNIFTY", "TESTBNK", "DEMOSTOCK"]
+ pattern: /^test/i
```

**`fnoSignalAlerts.ts` (F&O inline gate):**
```
["TESTSTK", "TEST", "SAMPLE", "DUMMY", "PLACEHOLDER", "FAKE", "MOCK",
 "TESTNIFTY", "TESTBNK", "DEMOSTOCK"]
```

### Test endpoint safety

| Endpoint | Symbol used | Label in Telegram | Confirmation required |
|----------|-------------|-------------------|-----------------------|
| `POST /alerts/test-swing-staged-order` | RELIANCE | `[SAMPLE]` + "sample data — not a real order" | None (owner-only + rate-limited 30 s) |
| `POST /alerts/test-fno-trade-signal` | NIFTY (sample) | `[SAMPLE — NOT A REAL TRADE]` + "FORMAT_TEST_ONLY" | `confirmSampleAlert: true` in body |

Neither uses TESTSTK, TEST, DUMMY, or any blocked symbol. Both are `requireOwner`-gated.

**All test cases pass via unit tests (216 tests, 0 failures):**

| Test Case | Expected Block Reason | Verified |
|-----------|----------------------|----------|
| `TESTSTK` | `TEST_SYMBOL_BLOCKED` | ✅ |
| `TEST`, `SAMPLE`, `DUMMY`, `FAKE`, `MOCK` | `TEST_SYMBOL_BLOCKED` | ✅ |
| Unknown symbol, no `instrumentToken` | `INSTRUMENT_NOT_FOUND` | ✅ |
| Valid symbol, `source=yahoo` | `SOURCE_NOT_TRADE_GRADE` | ✅ |
| Valid symbol, `canDriveTradeAlerts=false` | `SOURCE_NOT_TRADE_GRADE` | ✅ |
| Dev/test environment → production Telegram | `DEV_ENV_BLOCKED` | ✅ |
| F&O test endpoint without `confirmSampleAlert` | HTTP 400 `confirmation_required` | ✅ |

---

## 4. Swing Alert Parity

### Lifecycle — one canonical alert, no duplicates

| Event | Telegram sent? | Path |
|-------|---------------|------|
| `STAGED` or `APPROVAL_REQUIRED` → `alertSwingOrderStaged` | ✅ ONE `ENTRY_READY` | canonical: validate→dedup→format→send→log |
| `EXPIRED` → `alertSwingOrderExpired` | ❌ NO | `logger.info("lifecycle-only — no Telegram")` |
| `REJECTED` → `alertSwingOrderRejected` | ❌ NO | `logger.info("lifecycle-only — no Telegram")` |
| Dry-run approval → `alertSwingOrderApprovedDryRun` | ❌ NO | `logger.info("lifecycle-only — no Telegram")` |
| Risk-blocked → `alertSwingOrderBlockedByRisk` | ❌ NO | `logger.info("lifecycle-only — no Telegram")` |

Owner receives exactly **one ENTRY_READY** alert per staged order. Approval, dry-run, rejection, and expiry produce zero additional Telegram messages.

### Dedup layers (Swing ENTRY_READY)

| Layer | Scope | Mechanism |
|-------|-------|-----------|
| Sync `recentlyDispatchedMs` | Same process, rapid re-calls | Map checked+stamped **synchronously** before async pipeline queued |
| `validateTradeEventForNotification` | Pure sync — test symbols, dev env, source | Returns `{allowed:false, reason}` immediately |
| `hasAlreadyDelivered` (DB) | Cross-restart, same orderId+eventType+dest | `SELECT 1 FROM notification_delivery_log WHERE ...` |
| `alertOwnerRaw` in-memory | Within `SWING_ORDER_DEDUP_MS` (60 min) | In-process dedup key `SWING_ENTRY_READY::{orderId}` |

### Canonical field parity (Swing)

All fields derive from a single `CanonicalTradeEvent` built by `buildSwingCanonicalEvent(row)`:

| Field | Source | Telegram | DB log |
|-------|--------|----------|--------|
| `orderId` | `row.id` | ✅ dedup key | ✅ `order_id` |
| `symbol` | `row.symbol` | ✅ in message | ✅ `symbol` |
| `exchange` | `row.exchange` | ✅ in message | ✅ `exchange` |
| `instrumentToken` | `row.instrumentToken` | ✅ validated (INSTRUMENT_NOT_FOUND if null) | via validation |
| `entryPrice`, `stopLoss`, `target1`, `target2` | row fields | ✅ in message | message hash |
| `quantity`, `riskPercent`, `capitalRequired` | row fields | ✅ in message | message hash |
| `source` / `sourceAsOf` | `row.dataSource` / `row.dataAsOf` | ✅ in message | message hash |
| `brokerExecutionStatus` | hardcoded `"DISABLED"` | ✅ "Broker execution DISABLED" | — |
| `environment` | `process.env.NODE_ENV` | ✅ blocks non-production | ✅ `environment` column |

Telegram does not recompute any field — it formats the single `CanonicalTradeEvent` via `formatTradeTelegramMessage`.

---

## 5. F&O Alert Parity

### Lifecycle — gated pipeline

| Scenario | Telegram sent? | Gate |
|----------|---------------|------|
| Suppressed signal (regime/DD/confluence) | ❌ NO | `shouldSendFnoTradeAlert` → `false` |
| Info-only / BASELINE below threshold | ❌ NO | `shouldSendFnoTradeAlert` → `false` |
| Watchlist/setup-only (no paper trade opened) | ❌ NO | `paperTradeId` required; no paper trade = no dispatch |
| Tradeable paper-opened signal | ✅ ONE `ENTRY_READY` | gates: test-sym→dev-env→DB-dedup→send→log |
| Exit (stop-loss / target 1 / target 2 / time / manual) | ✅ ONE per exit type | `alertFnoExitSignal` after close tx commits, DB dedup per `paperTradeId+exitType` |
| Repeated signal cycle, same `paperTradeId` | ❌ SKIPPED | DB dedup key `(FNO_INTRADAY, ENTRY_READY, telegram_main, paperTradeId)` |
| Repeated exit attempt, same `paperTradeId`+reason | ❌ SKIPPED | DB dedup key `(FNO_INTRADAY, EXIT_*, telegram_main, paperTradeId::EXIT_*)` |

### Exit wiring (`paperTradingFO.ts:2268–2285`)

```typescript
// Safe-fail — alertFnoExitSignal never throws and never blocks the close path.
// Called AFTER closePaperTradeForSignal transaction commits.
alertFnoExitSignal({ paperTradeId, indexSymbol, ... });
```

The exit alert fires only after the DB row is settled as CLOSED. It cannot trigger if the close transaction rolls back.

---

## 6. F&O Live vs Production Mismatch — Diagnosis

### Previous observation
- Live F&O page: 3 setups across 3 indices
- Replit dev/prod preview: 0 setups with `daily_history_unavailable_kite`

### Root causes

| Factor | Explanation |
|--------|-------------|
| **Process isolation** | Published production and workspace preview are separate OS processes with separate heap. Signal setup counts (warmup cache, intraday VP, option chain snapshots) live in process memory and are always independent. |
| **Kite session state** | The workspace dev process may not have a valid Kite session at startup → `daily_history_unavailable_kite`. Production may have warmed successfully during a prior market session. |
| **Market timing** | Intraday F&O setups are ephemeral — they change every signal cycle. Screenshots taken at different times will naturally differ. |
| **DEV_ENV_BLOCKED resolution** | Even if the workspace preview shows setups and production shows 0 (or vice versa), `DEV_ENV_BLOCKED` in `alertFnoTradeableSignal` ensures ONLY the production process (`NODE_ENV=production`) can dispatch Telegram. A count mismatch between processes cannot produce spurious alerts. |

### Required invariants (confirmed correct in code)

| Invariant | Status |
|-----------|--------|
| If all indices suppressed → no ENTRY_READY Telegram | ✅ `shouldSendFnoTradeAlert` gates before any dispatch |
| If setup cards appear → suppression table shows candidate state | ✅ Both derive from the same in-memory signal state |
| Stale setup cards don't trigger alerts | ✅ `openedAt` freshness check in `shouldSendFnoTradeAlert` |
| Dev process alerts blocked regardless of setup count | ✅ `DEV_ENV_BLOCKED` confirmed in code + 216 tests |

---

## 7. Notification Delivery Log Verification

### Schema (17 columns, 2 indexes)

```sql
id, event_id, domain, event_type, signal_id, order_id, paper_trade_id,
symbol, exchange, destination, message_hash, status, error_code,
error_message, sent_at, environment, created_at
```

### Dedup index

```sql
CREATE INDEX ndl_dedup_idx ON notification_delivery_log
USING btree (domain, event_type, destination,
             COALESCE(order_id, signal_id, paper_trade_id, event_id))
```

Covers: domain + eventType + destination + (orderId OR signalId OR paperTradeId OR eventId fallback). Matches the required dedup key exactly.

### Live production records (queried 2026-07-02)

| Domain | Event Type | Symbol | Env |
|--------|-----------|--------|-----|
| `SWING_CASH` | `ENTRY_READY` | TATASTEEL | production |
| `SWING_CASH` | `ENTRY_READY` | RELIANCE | production |
| `SWING_CASH` | `ENTRY_READY` | RELIANCE | production |
| `SWING_CASH` | `ENTRY_READY` | RELIANCE | production |
| `FNO_INTRADAY` | `ENTRY_READY` | NIFTY | production |
| `FNO_INTRADAY` | `EXIT_STOP_LOSS` | BANKNIFTY | production |
| `FNO_INTRADAY` | `EXIT_TARGET_1` | BANKNIFTY | production |
| `FNO_INTRADAY` | `EXIT_TARGET_2` | BANKNIFTY | production |
| `FNO_INTRADAY` | `EXIT_TIME` | BANKNIFTY | production |

**Total: 9 records. Duplicate query result: 0 rows** — dedup is working. The 3 RELIANCE rows have distinct `order_id` values (different staged orders, not duplicates).

### Dedup scenario matrix (confirmed)

| Event | 1st attempt | 2nd attempt | Result |
|-------|-------------|-------------|--------|
| Swing ENTRY_READY, same orderId | SENT + logged | Skipped (`hasAlreadyDelivered`) | ✅ |
| Swing APPROVAL same order | No trade alert | No trade alert | ✅ (lifecycle-only) |
| F&O ENTRY_READY same paperTradeId | SENT + logged | Skipped (DB dedup) | ✅ |
| F&O EXIT same paperTradeId+reason | SENT + logged | Skipped (DB dedup) | ✅ |
| TESTSTK any path | Blocked | Blocked | ✅ |
| Dev env → prod Telegram | Blocked | Blocked | ✅ |

---

## 8. Telegram Message Format Verification

### Swing ENTRY_READY — required fields

✅ Symbol · Exchange · Side · Setup name · Entry (₹) · SL (₹) · Target 1 (₹) · Target 2 (₹, when present) · Quantity · Risk amount + Risk % · Capital required · Source (`kite`) · Source timestamp · Broker execution status (`DISABLED`) · App link (`/swing-queue`) · Lifecycle status

### F&O ENTRY_READY — required fields

✅ Underlying · Option contract (strike + CE/PE + expiry) · Direction · Setup key · Entry premium (₹) · Stop (₹) · Target 1 + Target 2 (₹) · Lots × lot size · Signal date · Confidence · Source (`kite`) · Broker execution (`DISABLED — no order placed`) · Paper trade ID

### F&O EXIT — required fields

✅ Underlying · Option contract · Direction · Setup · Entry premium / Exit premium (₹) · Exit reason · Lots × lot size · Realized P&L (₹ with sign) · Entry time / Exit time (IST) · Holding duration · Broker execution (`DISABLED`) · Paper trade ID

### Forbidden strings — confirmed absent from live trade alerts

✅ `TESTSTK` — blocked at gate  
✅ `n/a setup` — only in legacy `buildSwingOrderText`, not the production formatter  
✅ `Manual approval required` / `Order staged for approval` / `Order approved — dry-run recorded` — legacy labels only, no Telegram call in any lifecycle handler  
✅ Every message includes source + timestamp

---

## 9. Tests Run and Counts

### Targeted trade lifecycle suite

```
Test Files  6 passed (6)
Tests       216 passed (216)
Duration    15.20s

Files:
  tradeLifecycle/tradeLifecycle.test.ts
  swingAlerts.test.ts
  fnoSignalAlerts.test.ts
  tradeLifecycleParity.test.ts
  paperTradingFO.premiumPath.test.ts
  swingOrderStaging.test.ts
```

### Full api-server suite (all 80+ files, batched — all exit 0)

All 10 batches (A, B1, B2, C, D1–D5) exited 0. Zero failures across the entire suite.

### Scanner suite

`pnpm --filter @workspace/scanner exec vitest run --pool=vmThreads` → Exit 0

### LLM index

```
✓ LLM index is fresh — all 323 tracked files match.
Exit: 0
```

---

## 10. Production Safety Confirmation

| Requirement | Status |
|-------------|--------|
| No secrets exposed | ✅ |
| No paper trade created by blocked tests | ✅ Validation blocks before any paper-trade path |
| No real order placed | ✅ `brokerExecutionStatus: "DISABLED"` hardcoded |
| Broker execution disabled | ✅ Throughout all code paths |
| No strategy/threshold change | ✅ Only alert pipeline wired; zero signal logic touched |
| No destructive DB migration | ✅ `CREATE TABLE IF NOT EXISTS` only |
| No unapproved backfill | ✅ Not triggered |
| No Telegram spam during verification | ✅ Verification used DB queries, static analysis, and unit tests |
| No fake trade-looking messages | ✅ All test messages labeled `[SAMPLE]` or `[SAMPLE — NOT A REAL TRADE]` |

---

## 11. Remaining Operational Items

These are **not code defects** — they require live Kite session + market hours to close:

| Item | Impact | Owner action required |
|------|--------|-----------------------|
| F&O setup count parity — live vs workspace preview | Low — `DEV_ENV_BLOCKED` prevents any alert mismatch | Observe during next live market session |
| Full end-to-end field parity matrix (F&O Page ↔ Paper Trading ↔ Telegram ↔ DB) for one concurrent signal | Low — DB records confirm pipeline is live (9 production records today) | Verify field values during next signal open |
| `fno/data-health` + `fno/no-signal-gap` response details | Low — code structure confirmed correct | Check via browser owner-auth during trading hours |

---

## 12. Final Verdict

```
SIGNAL_DATA_NOTIFICATION_PARITY_CORE_PROD_VERIFIED_OPERATIONAL_ITEMS_PENDING
```

All code-level parity requirements confirmed:

- ✅ Published production includes all canonical alert wiring  
- ✅ No real trade alert bypasses the canonical pipeline (complete static bypass audit — 7 `alertOwnerRaw` call-sites accounted for)  
- ✅ TESTSTK cannot reach production Telegram under any path  
- ✅ Test/sample/dummy symbols cannot reach production Telegram  
- ✅ Dev/test environment events cannot reach production Telegram (`DEV_ENV_BLOCKED`)  
- ✅ Swing entry alert sends at most once (sync + DB dedup, 0 duplicate records in DB)  
- ✅ Swing approval/dry-run/staging/expiry/rejection send NO Telegram (lifecycle-only, `logger.info` only)  
- ✅ F&O suppressed/info-only/watchlist signals send no trade Telegram (`shouldSendFnoTradeAlert` gate)  
- ✅ F&O tradeable entry sends at most once (confirmed: 1 NIFTY ENTRY_READY in production DB)  
- ✅ F&O exit sends at most once after transaction commit (4 exit records in DB, 0 duplicates)  
- ✅ Notification delivery log active with correct schema, dedup index, and 9 live production records  
- ✅ Broker execution disabled — no real orders placed  
- ✅ No secrets exposed  
- ✅ 216 trade lifecycle tests pass, all api-server batches exit 0, scanner exit 0  
- ✅ LLM index fresh (323 files)

**"CORE" qualifier:** Full live-market field-parity matrix (F&O Page ↔ Paper Trading ↔ Telegram ↔ DB for a single concurrent trade) requires Kite session + market hours. The 9 live production DB records confirm the pipeline is actively exercised in production, but the complete field comparison cannot be done from the workspace shell. The `DEV_ENV_BLOCKED` gate ensures safety regardless of this gap.
