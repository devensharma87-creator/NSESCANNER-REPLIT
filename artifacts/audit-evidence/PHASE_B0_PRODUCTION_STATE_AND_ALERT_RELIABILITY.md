# Phase B0 — Production State and Alert Reliability
## Evidence Record

**Phase:** B0  
**Session date (IST):** Thu 31 Jul 2026  
**Completed at:** ~18:00 IST  
**Verdict:** `ACCEPT_B0_PRODUCTION_STATE_AND_ALERT_RELIABILITY`  
**Status at close:** `PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED` (B7 pending)

---

## §1 Scope (from Prompt 16)

Fix six production-state and alert reliability defects observed as:
- `INSTRUMENTS_REFRESH_FAILED` alert using "🚨 F&O DATA ALERT" header
- `EOD_RECONCILIATION_OK` sent at WARN priority
- "all checks OK" message even when checks are SKIPPED
- Generic `/fno-diagnostics` action text for instruments and clock-drift events
- Clock drift: single-sample, no RTT filtering, no recovery alert
- `/options` page: stale React Query cache could show "Market is closed" when real issue is API error

**Not in B0 scope:** B1 through B7 (deferred).  
**Not executed:** Prompt 15 (isolated DB provisioning).  
**Tripwire unchanged:** `DB_TEST_RUNTIME_AUTHORIZED = false as boolean`.

---

## §2 Defect → Fix Map

| Defect | Root location | Fix applied |
|--------|---------------|-------------|
| D1: "🚨 F&O DATA ALERT" header for all events | `alerting.ts:buildTelegramText()` | Extracted `buildAlertText()` (exported, testable); event-category routing with ✅/⚠️/🔴 headers per event type |
| D2: `EOD_RECONCILIATION_OK` at WARN priority | `eodReconciliation.ts:alertOwner(6th arg omitted)` | Explicit `"INFO"` as 6th positional arg |
| D3: "all checks OK" with SKIPPED checks | `eodReconciliation.ts:message string` | Pure `buildEodOkMessage()` exported; distinguishes `checked OK` vs `skipped (N/A)` counts |
| D4: Generic `/fno-diagnostics` action for instruments | `alerting.ts:getActionText()` | `INSTRUMENTS_REFRESH_FAILED` → "Admin → Live Feed → Refresh Instruments (ensure Kite session is active first)" |
| D5: Generic `/fno-diagnostics` action for clock drift | `alerting.ts:getActionText()` | `CLOCK_DRIFT_EXCEEDED` → "Verify host NTP daemon is running; inspect clock drift at /fno-diagnostics → System Health" |
| D6: Clock drift single-sample, no recovery | `clockDrift.ts` | 3 probes; RTT filter (≤3000ms); median computation; `lastAlertedDriftStatus` tracking; `CLOCK_DRIFT_RECOVERED` (INFO) on first drop below `DRIFT_RECOVERY_MS=400ms` |
| D7: No recovery alert for instruments failure | `instrumentsIntegrity.ts` | Added `markInstrumentsRefreshRecovered()` export; emits `INSTRUMENTS_REFRESH_RECOVERED` at INFO; clears `failedDateCache` + DB failure flag; idempotent |
| D8: Options page stale-cache "Market is closed" | `options.tsx:line 1073` | Destructured `isError`; gate is now `(!isError && data?.marketStatus != null && !data.marketStatus.marketOpen)` |

---

## §3 Files Changed

### Modified (production)
```
artifacts/api-server/src/lib/alerting.ts
artifacts/api-server/src/lib/clockDrift.ts
artifacts/api-server/src/lib/eodReconciliation.ts
artifacts/api-server/src/lib/marketData/instrumentsIntegrity.ts
artifacts/scanner/src/pages/options.tsx
```

### New (tests)
```
artifacts/api-server/src/lib/alerting.b0.test.ts       (34 tests)
artifacts/api-server/src/lib/clockDrift.test.ts         (replaced 27-line stub → 30 tests)
artifacts/api-server/src/lib/eodReconciliation.test.ts  (9 tests)
artifacts/api-server/src/lib/marketData/instrumentsIntegrity.b0.test.ts  (7 tests)
```

### Not changed
```
artifacts/api-server/src/lib/systemAlertDedup.ts  — dedup infrastructure already correct
artifacts/api-server/src/lib/fnoDataRecoveryTransition.ts  — already uses CAS correctly
artifacts/api-server/src/lib/marketData/instrumentsIntegrity.test.ts  — existing diffBaselines tests untouched
```

---

## §4 SHA-256 Fingerprints (implementation files)

```
97d6e93c8112801f6177343966b2690dae8a98b4b75394a2a4cd667033c1dee6  alerting.ts
1f6558a350f48d615f69756d88be7b4d7cc1115bafd8d3f350e9a2a6d8597986  clockDrift.ts
5546086149296c50935e4877c9a003c5c32aca7e6fc2b6d303062298d4657f2c  eodReconciliation.ts
da9754f2d50638b73d60c9a483396ddb37b3befb75b422e86d90362a18c27bcf  instrumentsIntegrity.ts
1c34a857e8885284acae0ff268cc6ab6e83d7dfc8f7a1161f73024878abef570  alerting.b0.test.ts
e67cac711e8168d35b9e1dee82f115ed1aea9411e07918768f9993c3ffbd9734  clockDrift.test.ts
c99a5a6e6215518386be9b5fdf5c49975a8d95b9bc73a9c8415ceb2e4953e6a3  eodReconciliation.test.ts
3d954134c6deda1dd0eb225d28d347483cb28274776172eb9ed45f87e2ea2931  instrumentsIntegrity.b0.test.ts
69d1cb4f402c667d4d965139ab3d59a1d07bbc843e1bf2a30a0404623778b80d  options.tsx (scanner)
```

---

## §5 Verification Results

### §5.1 New B0 tests — all pass

| Test file | Tests | Result |
|-----------|-------|--------|
| `alerting.b0.test.ts` | 34 | ✅ PASS |
| `clockDrift.test.ts` | 30 | ✅ PASS |
| `eodReconciliation.test.ts` | 9 | ✅ PASS |
| `instrumentsIntegrity.b0.test.ts` | 7 | ✅ PASS |
| `instrumentsIntegrity.test.ts` (regression) | 5 | ✅ PASS |
| `alerting.test.ts` (regression) | 22 | ✅ PASS |

Total B0 new/expanded: **107 tests across 6 files** (including expanded clockDrift.test.ts replacing 27-line stub)

### §5.2 Full non-DB suite

```
pnpm run test:full
  Test Files  208 passed (208)
       Tests  4326 passed (4326)
    Duration  50.30s
```

P0.1B baseline: 205 files / 4250 tests  
B0 delta: **+3 files / +76 tests** (clockDrift.test.ts replacement adds to existing count; 3 new files add distinct counts)

### §5.3 Strict unit suite (P0.1B tripwire)

```
pnpm run test:unit
  Test Files  2 passed (2)
       Tests  181 passed (181)
```

`DB_TEST_RUNTIME_AUTHORIZED = false as boolean` — **UNCHANGED**.  
DB guard blocks printed: `[dbTestPreflight] DB_TEST_RUNTIME_NOT_AUTHORIZED` ✅

### §5.4 TypeScript compilation

```
artifacts/api-server:  tsc --noEmit  → clean (0 errors)
artifacts/scanner:     tsc --noEmit  → clean (0 errors)
artifacts/global:      tsc --noEmit  → clean (0 errors)
```

### §5.5 Scanner production build

```
artifacts/scanner:  pnpm run build
  ✓ 2945 modules transformed
  ✓ built in 11.96s
```

### §5.6 Whitespace / style

```
git diff --check HEAD  → exit 0 (no trailing whitespace)
```

---

## §6 Key Design Decisions

### buildAlertText() export
`buildTelegramText()` was private and untestable. It is now exported as `buildAlertText()` — a **pure function** that takes `(event, message, metadata?, priority?)` and returns a string. The internal alias `buildTelegramText` delegates to it unchanged for all production call sites. This enables direct unit testing of message format without any delivery infrastructure.

### Clock drift: multi-probe + hysteresis
- **3 sequential probes** per check cycle (worldtimeapi.org primary, google.com/generate_204 HTTP-date fallback per attempt)
- **RTT filter**: probes with RTT > 3000ms are rejected as too noisy to yield a reliable ±500ms reading
- **Minimum 2 valid probes** required; otherwise `INSUFFICIENT_SAMPLES` (not fabricated zero-drift)
- **Median** of valid probe drifts (not mean — one outlier cannot dominate)
- **Recovery boundary**: `DRIFT_RECOVERY_MS = 400ms` (100ms below `DRIFT_WARN_MS = 500ms`) creates hysteresis; prevents flip-flopping near the alert threshold
- **State machine**: `lastAlertedDriftStatus` tracks the last emitted state per process; ALERT → recovery only fires once when drift drops below 400ms; repeated OKs do not re-emit

### EOD reconciliation honesty
`buildEodOkMessage()` is exported as a pure function. It distinguishes:
- **All OK**: `"all N checks passed. Paper ledgers are consistent."`
- **Some skipped**: `"X of N checks passed; Y skipped (not applicable — no trading activity for those checks). Paper ledgers are consistent for active checks."`
The phrase "all checks OK" is never produced when any check is SKIPPED.

### Instruments recovery
`markInstrumentsRefreshRecovered(date)` is a no-op when `failedDateCache !== date` (nothing to recover). On a real recovery it: clears `failedDateCache`, updates `status.lastResult = "OK"`, deletes the DB failure flag via `deleteAppState()` (prevents re-hydration on restart), and emits `INSTRUMENTS_REFRESH_RECOVERED` at INFO priority with a 2h dedup window per date. Idempotent by design.

### Options page market-closed gate
Gate changed from:
```tsx
(data?.marketStatus != null && !data.marketStatus.marketOpen)
```
to:
```tsx
(!isError && data?.marketStatus != null && !data.marketStatus.marketOpen)
```
When React Query's background refetch fails and the cached response has `marketOpen: false` (stale prior-session data), `isError` is true → the closed-market card is suppressed → rendering falls through to `deriveFnoEmptyReason()` which can surface an appropriate data-unavailable state rather than falsely claiming the market is closed.

---

## §7 Out-of-Scope Notes (deferred to B1+)

- `CLOCK_DRIFT_EXCEEDED` at WARN level (500–1000ms) does not emit an alert — only ALERT level (>1000ms) does. WARN-level alerting deferred to B3.
- React Query `staleTime`/`gcTime` configuration for the options page signals hook — the stale-data window is at most 30 seconds (the refetch interval). B6 item.
- Kite-offline-banner fallback `marketSession` mapping — B2 item.
- System alert dedup is in-memory-only (resets on replica restart). Existing DB-backed `claimSystemAlert` handles cross-process; in-process in-memory map is the fast path. B6 architectural hardening.

---

## §8 Constraints Confirmed

| Constraint | Status |
|------------|--------|
| `DB_TEST_RUNTIME_AUTHORIZED = false as boolean` | ✅ UNCHANGED |
| No manual git commit/push/fetch/deploy | ✅ None performed |
| No operational data modification | ✅ None |
| No residue cleanup (115 rows untouched) | ✅ None |
| Prompt 15 not executed | ✅ Not executed |
| No new audit/infrastructure projects beyond B0 scope | ✅ None |
| B1 not started | ✅ Correct — only B0 |

---

`END_PHASE_B0_PRODUCTION_STATE_AND_ALERT_RELIABILITY`
