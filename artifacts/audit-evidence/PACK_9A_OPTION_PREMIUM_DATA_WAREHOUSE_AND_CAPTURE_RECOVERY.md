# Pack 9A — Option Premium Data Warehouse and Capture Recovery
## Gate 0–9 Closure Evidence

**Generated:** 2026-08-07 (09:37–09:47 IST)  
**Evaluator:** Pack 9A live capture canary and archive readiness closure  
**Branch:** `main` — HEAD `063d393`, Production deployed `d48dbb2`  
**Market window at evaluation:** OPEN (09:20–15:25 IST)

---

## Gate 0 — Preflight

| Prerequisite | Status | Detail |
|---|---|---|
| `OPTION_SNAPSHOT_ENABLED=1` | ✅ PRESENT | Secret confirmed present, value='1', TRUTHY set |
| API server restarted after secret | ✅ CONFIRMED | Server started 03:59:37 UTC (09:29 IST) — after market open |
| Market window (OPEN) | ✅ OPEN | 09:37 IST — within NSE cash session (09:20–15:25) |
| Kite session active | ❌ EXPIRED | Log: `kiteOffline: true`; "Kite session expired / throttled / index uncovered" |
| `OPTION_SNAPSHOT_ARCHIVE_PATH` | ⚠️ ABSENT | Expected per Gate 5 — fail-closed confirmed |
| `option_chain_snapshot` row count | ❌ 0 ROWS | No successful captures despite 4 scheduled ticks |
| NSE option chain API reachable | ❌ TIMEOUT | All 3 indices (NIFTY/BANKNIFTY/SENSEX) → AbortError: operation aborted due to timeout |

**Conclusion:** Prerequisite #3 (valid Kite session) and the NSE option chain reachability condition are both absent. Per prompt rules, all remaining gates are read-only source/DB/test verification.

---

## Gate 1 — Production Boot and Schema

### Scheduler Registration
- `startOptionSnapshotIngestor()` is called at `artifacts/api-server/src/routes/index.ts:112`
- Log confirms scheduler started: `"option-snapshot: starting ingestor"` at 03:59:40 UTC
- Tick timer registered via `setInterval(tick, intervalMs)` at ingestor line 782
- Idempotency guard: `if (tickTimer != null) return;` at line 665

### isOptionSnapshotEnabled
- `OPTION_SNAPSHOT_ENABLED=1` → TRUTHY set includes `"1"` → returns `true`
- Auto-detect: `process.env["REPLIT_DEPLOYMENT"] === "1"` (fallback when override unset)
- Fail-closed on unrecognised value → returns `false`

### Schema Columns (DB introspection — confirmed)

| Column | DB type | Length | Default | Nullable |
|---|---|---|---|---|
| `schema_version` | character varying | 8 | 'v1' | YES |
| `lot_size` | integer | — | — | YES |
| `market_status` | character varying | 16 | — | YES |
| `canary_marker` | character varying | 64 | — | YES |

All 4 Pack 9A columns present in live DB with correct types and constraints. ✅

### Schema Migration Idempotency
- `ensureOptionSnapshotV1Schema()` uses `ALTER TABLE … ADD COLUMN IF NOT EXISTS`
- Called once per process via `migrationComplete` latch (line 26)
- Log at 03:59:40 UTC: `"option-snapshot-migrations: v1 columns ensured (idempotent)"` ✅
- Future-timestamp rows in DB: **0** ✅

### Uniqueness / PK
- Primary key: `(underlying, expiry, strike, opt_type, captured_at)`
- ON CONFLICT DoUpdate: updates mutable fields (ltp, oi, iv, bid, ask, greeks, spot)
- `schema_version` and `canary_marker` are NOT updated on conflict (provenance preserved)

### Owner-Only Routes (source-confirmed)
All 5 routes registered under `strictOwner` middleware:
- `GET  /api/option-snapshots/diagnostics`
- `POST /api/option-snapshots/run-now`
- `GET  /api/option-snapshots/storage`
- `GET  /api/option-snapshots/gaps`
- `GET  /api/option-snapshots/analytics`

Routes are not reachable without owner session cookie — confirmed not bypassable in public mode (uses `requireOwnerStrict`, not `requireOwner`).

---

## Gate 2 — Live Canary

**STATUS: BLOCKED**

Canary marker: `p9a-canary-20260807-<shortId>` (not executed — prerequisite absent)

### Run History (from `option_chain_snapshot_run`)

| Metric | Value |
|---|---|
| Total run records | 4 |
| Total rows written | 0 |
| Total underlyings_ok | 0 |
| Full-failure runs | 4 |
| First tick | 2026-08-07 03:59:40 UTC (09:29 IST) |
| Last tick | 2026-08-07 04:14:37 UTC (09:44 IST) |
| Span covered | ~15 minutes, 4 × 5-min interval ticks |

### Failure Mode

Each tick attempts `fetchOptionChain("NIFTY" | "BANKNIFTY" | "SENSEX")` which proxies through the NSE option chain endpoint:
```
NSE fetch failed
    path: "/api/option-chain-indices?symbol=NIFTY"
    err: "The operation was aborted due to timeout"
```
Both the Kite path (session expired → 0 chains) and the NSE path (network timeout → 0 chains) fail, producing `src: "none"`, `rows: 0`, `ok: 0`, `err: 3` per tick.

### Circuit State at Evaluation
- `consecutiveFullFailures`: 4 (1 short of the CIRCUIT_BREAKER_THRESHOLD=5 trip)
- `circuitOpenUntil`: null (circuit not yet open)
- At the 5th full-failure tick, the circuit will trip and suppress ticks for 15 minutes

---

## Gate 3 — Scheduler and Resilience (Source-Verified)

| Mechanism | Location | Status |
|---|---|---|
| Advisory lock | `pg_try_advisory_lock(0x534e4150)` — `tryAcquireAdvisoryLock()` lines 313–328 | ✅ Confirmed |
| Fail-open on lock error | `catch { return true; }` — prefers tick over lock starvation | ✅ Confirmed |
| Lock release | `releaseAdvisoryLock()` in `finally` block line 773 | ✅ Confirmed |
| Circuit breaker | `consecutiveFullFailures` counter; threshold=5; reset=15min | ✅ Confirmed |
| Circuit auto-reset | `if (now >= circuitOpenUntil) { circuitOpenUntil = null; ... }` line 569 | ✅ Confirmed |
| Alert dedup | `lastFailureAlertAt`/`lastRecoveryAlertAt` — 60-min cooldown | ✅ Confirmed |
| Tick timeout | `Promise.race([runIngestionTick(), setTimeout(TICK_TIMEOUT_MS)])` line 714–719 | ✅ Confirmed |
| Timeout as full failure | Synthetic RunResult with `errors: [{ underlying: "*", message: "tick_timeout" }]` | ✅ Confirmed |
| Market-closed skip | `if (!force && marketStatus !== "open") return skippedReason: "market_closed"` | ✅ Confirmed |
| Market-closed ≠ full failure | `isFullFailure = underlyingsOk===0 && errors.length>0 && !skippedReason` | ✅ Confirmed |
| Ingestor idempotency | `if (tickTimer != null) return;` | ✅ Confirmed |
| Retention separate timer | `setInterval(retentionSweep, 24 × 60 × 60_000)` — daily, independent | ✅ Confirmed |

### Reliability Constants

| Constant | Value | Rationale |
|---|---|---|
| `CIRCUIT_BREAKER_THRESHOLD` | 5 | 5 consecutive full-failure ticks before circuit trips |
| `CIRCUIT_RESET_MINUTES` | 15 | 15-minute pause before retry after circuit trips |
| `ALERT_COOLDOWN_MINUTES` | 60 | Max 1 Telegram owner alert per hour per kind |
| `TICK_TIMEOUT_MS` | 60,000 ms | Hard abort at 60s — well under the 5-min tick interval |

---

## Gate 4 — Diagnostics Routes (Source-Verified)

All 5 diagnostic routes confirmed registered with `strictOwner` guard. No secrets, connection strings, or archive file paths exposed in raw form — `getArchivePath()` is used internally; diagnostics endpoint reports `archiveConfigured: true/false`, not the path value.

Diagnostics state classifications (source-verified):
- `CONFIGURED_AND_RUNNING` — enabled + timer running + last run exists
- `CONFIGURED_NOT_RUNNING` — enabled + timer not started (startup failure)
- `DISABLED` — `isOptionSnapshotEnabled()` returns false
- `NO_RUNS_YET` — timer running but no ticks completed yet

---

## Gate 5 — Archive Infrastructure (Fail-Closed)

| Item | Value |
|---|---|
| `OPTION_SNAPSHOT_ARCHIVE_PATH` | **NOT SET** |
| `getArchivePath()` return value | `null` |
| Retention sweep outcome when unset | `SKIPPED_ARCHIVE_REQUIRED` |
| Rows deleted | 0 (deletion refused) |
| Log message | `"option-snapshot: retention BLOCKED — configure OPTION_SNAPSHOT_ARCHIVE_PATH"` |

### Archive Fail-Closed Logic (source-confirmed)
```
if (!archivePath) {
  return { outcome: "SKIPPED_ARCHIVE_REQUIRED", snapshotRowsDeleted: 0, runRowsDeleted: 0 };
}
```
Second guard: archive write failure also blocks deletion:
```
if (archiveResult !== "WRITE_AND_VERIFIED") {
  return { outcome: "SKIPPED_ARCHIVE_FAILED", snapshotRowsDeleted: 0, ... };
}
```
**No unarchived row can be deleted. Current retention=825 days → no rows at risk.**

### Storage Projections (from `projectStorage()`)

| Period | Trading Days | Conservative Rows | Worst-Case Rows | Conservative Total | Worst-Case Total |
|---|---|---|---|---|---|
| 1 trading day | 1 | 15,000 | 18,900 | 6.8 MB | 8.6 MB |
| 30 trading days | 30 | 450,000 | 567,000 | 205.6 MB | 259.0 MB |
| 90 trading days | 90 | 1,350,000 | 1,701,000 | 616.8 MB | 776.9 MB |
| 6 months (~130d) | 130 | 1,950,000 | 2,457,000 | 890.7 MB | 1.12 GB |
| 12 months (~260d) | 260 | 3,900,000 | 4,914,000 | 1.74 GB | 2.24 GB |
| 24 months (~520d) | 520 | 7,800,000 | 9,828,000 | 3.47 GB | 4.49 GB |

Formula: `rows = days × 75 ticks/day × 200–252 rows/tick`; `total = rows × 454 bytes/row`.

**6-month capture (~130 trading days, ~890 MB–1.1 GB) fits within Replit's operational DB tier. Archive required before 12-month mark.**

### Archive Infrastructure Decision Required

Owner must set `OPTION_SNAPSHOT_ARCHIVE_PATH` to ONE of:
1. **Replit Object Storage FUSE mount** — recommended for Replit-native durability
2. **NFS mount** — durable across restarts, requires external provider
3. **S3-backed FUSE mount** — large scale, requires AWS credentials

Archive format: JSONL files partitioned by `(date, underlying)` with SHA-256 manifest per partition. Two-step delete guard: WRITE_AND_VERIFIED before any row deletion.

---

## Gate 6 — Data-Foundation Clock

| Metric | Value |
|---|---|
| Rows in `option_chain_snapshot` | **0** |
| First capture timestamp | Not yet |
| Required coverage for backtest eligibility | 130 trading days (~6 months) |
| Estimated qualification date (from first successful capture) | ~February 2027 |

**Current state: Day 0 of the data accumulation phase. No data yet.**

The data-foundation clock starts the moment the first successful capture lands. Backtest-Lab replay capability requires unbroken daily coverage across ≥ 130 trading days.

---

## Gate 7 — Test Coverage (27 new tests)

**New file:** `artifacts/api-server/src/lib/p31.pack9aCanary.test.ts`  
**Test count:** 27 tests across 9 describe blocks — all pass ✅

| Test ID | Coverage |
|---|---|
| P9A-T01 | `isCircuitOpen`: returns false on fresh state |
| P9A-T02 | `isCircuitOpen`: auto-resets after `CIRCUIT_RESET_MINUTES` |
| P9A-T03 | `updateCircuitBreaker`: counter increments, no trip before threshold |
| P9A-T04 | `updateCircuitBreaker`: trips exactly at threshold, sets `openUntil` |
| P9A-T05 | `updateCircuitBreaker`: any partial success resets counter to 0 |
| P9A-T06 | `updateCircuitBreaker`: market-closed result does NOT count as full failure |
| P9A-T07 | `shouldSendOwnerAlert`: first alert of each kind always allowed |
| P9A-T08 | `shouldSendOwnerAlert`: second alert within cooldown suppressed (dedup) |
| P9A-T09 | `shouldSendOwnerAlert`: allowed again after cooldown expires |
| P9A-T10 | `shouldSendOwnerAlert`: failure/recovery channels are independent |
| P9A-T11 | `SNAPSHOT_LOT_SIZES`: NIFTY=65, BANKNIFTY=30, SENSEX=20 |
| P9A-T12 | `SNAPSHOT_LOT_SIZES`: entry exists for every SNAPSHOT_INDEX (no universe drift) |
| P9A-T13 | `CIRCUIT_BREAKER_THRESHOLD` = 5 |
| P9A-T14 | `CIRCUIT_RESET_MINUTES` = 15 |
| P9A-T15 | `ALERT_COOLDOWN_MINUTES` = 60 |
| P9A-T16 | `TICK_TIMEOUT_MS` = 60,000 ms |
| P9A-T17 | `projectStorage`: returns 6 time-horizon projections |
| P9A-T18 | `projectStorage`: 1-day projection matches formula exactly |
| P9A-T19 | `projectStorage`: conservative always < worst-case |
| P9A-T20 | `projectStorage`: 130-day data estimate < 2 GB (fits Replit tier) |
| P9A-T21 | `getArchivePath`: returns null when env var unset |
| P9A-T22 | `getArchivePath`: returns configured value when set |
| P9A-T23 | `getArchiveInfrastructureRequirement`: returns non-empty requirement string |
| P9A-T24 | `runRetentionSweep`: SKIPPED_ARCHIVE_REQUIRED, 0 deletions, no DB hit when archive absent |
| P9A-T25 | `startOptionSnapshotIngestor`: idempotent safe no-op when ENABLED=0 |
| P9A-T26 | `FNO_PAPER_V2_RUNTIME_AUTHORIZED` = `false as boolean` (Pack 32 compile-time lock) |
| P9A-T27 | `SWING_PAPER_V2_RUNTIME_AUTHORIZED` = `false as boolean` (Pack 32 compile-time lock) |

**Existing tests (prior to this task):**
- `optionChainSnapshotIngestor.test.ts`: 9 test cases covering `bucketTimestamp`, `selectStrikesAroundAtm`, `flattenChainToRows`, `isOptionSnapshotEnabled`, `getSnapshotConfig`, `SNAPSHOT_INDICES`
- `optionSnapshotAnalytics.test.ts` + `canonicalFnoReadiness.test.ts`: 72 additional tests

**Total Pack 9A test surface:** 108 tests ✅

---

## Gate 8 — Verification Battery

| Suite | Test Files | Tests | Status |
|---|---|---|---|
| `@workspace/api-server` | 273 | **6,268** | ✅ ALL PASS |
| `@workspace/scanner` | 52 | **1,250** | ✅ ALL PASS |
| `@workspace/api-zod` TSC | — | — | ✅ CLEAN |
| `@workspace/api-client-react` TSC | — | — | ✅ CLEAN |
| `@workspace/api-server` TSC | — | — | ✅ CLEAN |
| `@workspace/scanner` TSC | — | — | ✅ CLEAN |

Previous floor (Pack 32): api-server 6,241 / scanner 1,250  
**New floor (Pack 9A Gate 7): api-server 6,268 (+27) / scanner 1,250**

---

## Gate 9 — Verdict

```
WAITING_FOR_OPTION_SNAPSHOT_ACTIVATION
  — Kite session expired (prerequisite #3 absent)
  — NSE option chain API timeout for all 3 indices (NIFTY/BANKNIFTY/SENSEX)
  — 0 rows captured across 4 scheduled ticks (03:59–04:14 UTC, 2026-08-07)
```

### What IS Confirmed Operational

| Component | Status |
|---|---|
| Scheduler registered and firing | ✅ 4 ticks fired at correct 5-min intervals |
| Run records written to `option_chain_snapshot_run` | ✅ 4 rows, correct schema |
| Pack 9A schema columns in DB | ✅ All 4 present with correct types |
| Schema migration idempotency | ✅ ADD COLUMN IF NOT EXISTS confirmed |
| Circuit breaker state machine | ✅ 4 consecutive full failures tracked (1 short of trip) |
| Advisory lock (pg_try_advisory_lock) | ✅ Confirmed in source and logs |
| Alert dedup (cooldown 60 min) | ✅ Confirmed in source |
| Tick timeout (60s) | ✅ Confirmed in source |
| Archive fail-closed (no deletion without ARCHIVE_PATH) | ✅ Confirmed in source and DB |
| Owner-only routes (strictOwner) | ✅ Confirmed in source |
| FNO V2 compile-time lock unchanged | ✅ `false as boolean` in v2PaperLocks.ts |
| Test suite floor | ✅ 6,268 api-server + 1,250 scanner |
| 4-package TSC clean | ✅ |

### What Is Blocking Capture

| Blocker | Root Cause | Owner Action Required |
|---|---|---|
| Kite session expired | The Zerodha Kite session token is stale — this happens automatically when the Kite access token expires (typically daily) | Re-authenticate via `GET /api/kite/callback` from the owner dashboard |
| NSE option chain API timeout | The NSE option chain endpoint (`/api/option-chain-indices?symbol=…`) is timing out from the Replit server environment — likely NSE's anti-bot protection or geo-blocking | (a) Renew Kite session — Kite path is the primary; NSE is fallback. With a live Kite session, the Kite option chain path should succeed. (b) If Kite option chain also fails, an NSE proxy may be needed. |

### Recovery Path

1. **Owner renews Kite session** via `/api/kite/callback` (standard Zerodha Kite login flow)
2. API server detects Kite online → Kite path in `fetchOptionChain` becomes available
3. Next scheduled tick (within 5 minutes of Kite session renewal) → capture fires
4. `option_chain_snapshot` rows begin accumulating
5. Circuit breaker resets on first successful tick
6. Canary can be re-run via `POST /api/option-snapshots/run-now?force=1&canaryMarker=p9a-canary-20260807-<shortId>` (owner-only)
7. Verify ≥ 1 row with `canary_marker IS NOT NULL` in DB

### Outstanding Infrastructure Items (non-blocking for capture restart)

- **`OPTION_SNAPSHOT_ARCHIVE_PATH` not set** — retention sweep is fail-closed, no rows deleted. Required before 12-month mark. Owner must provision durable storage (Replit Object Storage FUSE, NFS, or S3-FUSE) and set the secret.
- **Telegram owner alert for circuit trips** — noted as `TODO` in ingestor line 747 — not wired yet. Alert fires to owner logger only (visible in Replit logs), not Telegram. Separate task.

---

## Appendix — Canary Execution Instructions (When Kite Session Active)

Once Kite session is renewed and capture resumes:

```bash
# 1. Trigger a force-run with canary marker (from api-server container)
cd /home/runner/workspace
pnpm --filter @workspace/api-server exec tsx -e "
  import('@workspace/api-server/src/lib/optionChainSnapshotIngestor.js').then(m =>
    m.runIngestionTick({ force: true, canaryMarker: 'p9a-canary-20260807-001' })
      .then(r => console.log(JSON.stringify(r, null, 2)))
  );
"

# 2. Verify canary rows landed in DB
# SELECT underlying, expiry, strike, opt_type, canary_marker, captured_at, ltp, oi
# FROM option_chain_snapshot
# WHERE canary_marker = 'p9a-canary-20260807-001'
# ORDER BY underlying, expiry, strike, opt_type;
```

Expected: ≥ 42 rows per underlying per expiry (ATM ± 10 strikes × 2 legs), 2 expiries = ~168 rows per underlying, ~504 rows total (3 underlyings). Partial success (1–2 underlyings) is also acceptable for PARTIAL verdict.

---

*Evidence generated: Pack 9A, 2026-08-07*  
*Next action: Owner renews Kite session → capture resumes automatically → re-run Gates 2–6 for ACCEPT verdict*
