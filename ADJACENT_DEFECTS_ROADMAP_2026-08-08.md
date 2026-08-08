# Adjacent Defects Roadmap — Pack 33 Corrective

**Date:** 2026-08-08  
**Scope:** Defects identified during canary failure forensics that are adjacent to but outside the scope of Pack 33 Corrective.

---

## P1 — INSTRUMENTS_REFRESH_FAILED Keeps F&O Automation Gated

**Category:** Data-availability defect (not cosmetic)  
**Severity:** P1 — actively gates F&O automation

**Description:**  
The `INSTRUMENTS_REFRESH_FAILED` alert fires when the Kite instrument master refresh fails at startup (BOD initialization). This blocks F&O automation because:
- The F&O signal sweep requires a fresh instrument master to resolve lot sizes (`getCachedLotSizeForIndex()`)
- When the instrument master is stale or unavailable, the `INSTRUMENTS_REFRESH_FAILED` alert puts the system in a degraded state
- F&O lot sizing falls back to the static `LOT_SIZES` table (memory note: fno-lot-size-staleness.md)
- However, the F&O tick guard checks `instrumentsRefreshFailed` and suppresses signal processing

**Impact:** Every F&O signal cycle is gated until the instrument master refreshes successfully. During BOD or post-restart windows where Kite is slow to respond, this causes multi-minute F&O automation gaps.

**Contained impact:** No data-integrity violation. F&O positions are not opened without a fresh instrument master. The gap is availability, not correctness.

**Remediation needed:** Add exponential-retry with jitter for instrument master refresh at startup. Decouple F&O automation gate from the "initial refresh failed" state — use stale-but-valid instrument master for continuation if lot sizes are within 10% of static fallback.

**Separate from Pack 33:** This is a Kite connectivity/retry issue unrelated to the warehouse candle store.

---

## P1 — Missing Legacy `candle` Table Affects Backtest Lab Data Readiness

**Category:** Data-readiness defect (not just logging)  
**Severity:** P1 — Backtest Lab functionality degraded

**Description:**  
The Backtest Lab strategy research engine uses a `candle` table (legacy) that was never created in the production schema. The missing table causes:
- Backtest Lab to fall back to synthetic premium calculation (~0.40% spot, ~0.50 delta, no theta/IV)
- Stop-doc documentation mismatch (the stop conditions reference actual candle data but synthetic premiums are used)
- Backtester never showed this issue in dev because the candle table was never added to `runtimeTables.ts`

**Impact:** All Backtest Lab P&L metrics are synthetic and not based on actual historical premium data. The backtest results are labeled as approximations in the UI, but the limitation is more severe than the labels suggest. This is a known gap (memory: backtest-lab-synthetic-premium.md).

**Contained impact:** No production trade decisions use backtest results. Backtest is advisory-only. No financial data at risk. The limitation is clearly a separate task from Portfolio/T003.

**Remediation needed:** Implement the `candle` table schema in `runtimeTables.ts`, populate from Kite historical data for the relevant instruments and timeframes, wire the Backtest Lab to use real OHLCV premiums.

**Separate from Pack 33:** Backtest is a different subsystem. The warehouse (Pack 33) stores equity daily candles for the 199-symbol universe; Backtest needs F&O option candles for strike/expiry resolution.

---

## P2 — Database Latency Requires Monitoring

**Category:** Operational — DB performance  
**Severity:** P2 — no current incidents, but risk surface

**Description:**  
During Pack 34 production audit, DB query latency was observed at elevated levels during market hours (production replica lag: memory note prod-read-replica-lag.md). Specific concerns:
- The `kite_candle_store` table will grow to ~8,454 rows × ~23 KB/row = ~195 MB when the warehouse completes
- The `getKiteCandleStorePhysicalMetrics()` aggregation query (new in Pack 33 Corrective) runs a full table scan with conditional aggregation — no index on `symbol` yet
- Advisory lock polling adds DB round-trips (every 5s for up to 10 min in the losing-replica path)

**Impact:** No current incidents. Risk increases as warehouse population grows. The physicalStoreMetrics query could become expensive at full scale (~8,454 rows).

**Remediation needed:** 
1. Add `CREATE INDEX IF NOT EXISTS kite_candle_store_symbol_idx ON kite_candle_store (symbol)` (can be done with `ALTER TABLE ADD COLUMN IF NOT EXISTS` pattern)
2. Add DB connection pool monitoring via Replit's monitoring pane
3. Consider caching `getKiteCandleStorePhysicalMetrics()` with a 60s TTL

**Separate from Pack 33:** Monitoring and index creation are operational tasks, not control remediation.

---

## P2 — Silent DB Write Failures in Warehouse (storeKiteCandleEntry best-effort)

**Category:** Data-integrity gap (not correctness, but completeness)  
**Severity:** P2 — confirmed in canary: 12/50 writes lost silently

**Description:**  
The warehouse's `storeKiteCandleEntry()` calls are wrapped in a best-effort try/catch that swallows DB write errors. In the Aug 7 canary:
- 12 of 50 symbols have no persisted row in `kite_candle_store`
- Their write attempts failed silently
- The in-memory metrics counted them (successCount=22) but DB does not reflect this
- The canary cursor counted them as successes (batchSuccessCount++), which made the actual DB state inconsistent with the reported metrics

**Impact:** Warehouse metrics (successCount) can overcount actual stored rows. The `physicalStoreMetrics` endpoint (new in Pack 33 Corrective) will surface this gap by querying the DB directly.

**Remediation needed:** Add retry-with-backoff to `storeKiteCandleEntry()` (3 attempts, 2s exponential backoff). Surface write-failure count in warehouse metrics separately from success count.

**Separate from Pack 33:** This is a robustness improvement, not the root cause of the CANARY_VALIDATION_FAILED (the root cause was the bond-heavy symbol list). Fixing this would make metrics more accurate but does not affect the correctness of the eligibility fix.

---

## P2 — STOPPED State Not Durable Across Midnight IST (Pre-Fix)

**Category:** Control defect — resolved in Pack 33 Corrective  
**Severity:** Was P2 — now FIXED

**Description:**  
Prior to Pack 33 Corrective, STOPPED status was reset to CANARY whenever the IST date changed (snapshotId mismatch logic). A STOPPED state set by the owner at 23:00 IST would be silently cleared at 00:00 IST the next day, and the warehouse would restart from CANARY on the next scheduler tick.

**Status:** FIXED in Pack 33 Corrective (fullNseWarehouse.ts durable STOPPED logic).

---

## Summary Table

| ID | Category | Severity | Status | Separate from Pack 33? |
|----|----------|----------|--------|------------------------|
| INSTRUMENTS_REFRESH_FAILED | Data availability | P1 | Open | ✅ Separate |
| Missing `candle` table (Backtest Lab) | Data readiness | P1 | Open | ✅ Separate |
| DB latency + index | Operational | P2 | Open | ✅ Separate |
| Silent storeKiteCandleEntry failures | Data completeness | P2 | Open | ✅ Separate |
| STOPPED not durable across midnight | Control | P2 | **FIXED** | Part of Pack 33 Corrective |

---

*Generated: 2026-08-08 | Pack 33 Corrective Forensics*
