---
name: Pack 33B Evidence Remediation Closure
description: 10-gate PROMPT_33B_REJECTED-EVIDENCE_REMEDIATION closure; commit 437e389; all gates PASS
---

## Closure state — commit 437e389

### Gate 1 — ClassificationAuthority contract
- **3-value type**: `"AUTHORITATIVE_NSE_REFERENCE" | "HEURISTIC_DIAGNOSTIC_ONLY" | "UNRESOLVED"`
- **Only** NSE EQUITY_L.csv series=EQ join → `AUTHORITATIVE_NSE_REFERENCE`
- All suffix/name-pattern detections (GB, SG, ST, SM, PP, BZ, REIT, ETF) → `HEURISTIC_DIAGNOSTIC_ONLY`
- `ORDINARY_COMPANY_EQUITY_ELIGIBLE` is the new canonical eligible class (replaces deprecated `ORDINARY_MAIN_BOARD_EQUITY`)
- Deprecated `ORDINARY_MAIN_BOARD_EQUITY` added to `WAREHOUSE_EXCLUDED_CLASSES` (stale-cache guard)
- `InstrumentClassification` type added with all contract-required fields

### Gate 2 — Live reconciliation
- `p33b.liveReconciliation.ts` — live evidence script (no synthetic fixtures)
- Uses `getNseSecurityMaster()` + `centralKiteNseEqInstruments()` (compat layer)
- Reports full breakdown + reconciliation equations

### Gate 3 — F&O admission runtime
- `p33b.fnoAdmissionRuntime.ts` — all 8 admission states documented
- States 3–6 covered by `p33b.admissionBanGate.test.ts` (36 tests PASS)
- States 1, 2, 7 verified live; State 8 confirmed by export inspection

### Gate 4 — Swing cash runtime
- `p33b.swingCashRuntime.ts` — proves F&O ban does NOT hard-block CNC equity
- `StageSwingOrderResult.fnoBanAdmission` field confirmed at compile time
- NSE regulatory basis documented: MWPL breach = derivatives only

### Gate 5 — Persistence contract
- `SnapshotPersistenceResult.durableStore: "POSTGRESQL"` on BOTH ok and !ok branches
- `persistenceFailureCount` module-level counter exported from nseSecurityMaster.ts
- Structured `DIAGNOSTIC_EVENT=NSE_MASTER_PERSISTENCE_FAILURE` log on every write failure
- INSERT_RETURNING_EMPTY path also increments counter + logs diagnostic event

### Gate 6 — Lock scope (bounded design alternative)
- 50-line documented proof in nseSecurityMaster.ts:
  A) Duplicate fetches harmless: NSE CSV is static daily file (same SHA-256)
  B) Rate-safe: inflight Promise de-dups in-process; 6h TTL per replica
  C) No conflicting durable snapshots: pg_advisory_xact_lock serializes INSERTs
  D) Lock release guaranteed on commit/rollback/drop (transaction-scoped)

### Gate 7 — Snapshot selection
- `_selectBetterSnapshot(diskSnap, dbSnap)` function with 4-step multi-field logic:
  1. row_count < 100 → invalid; prefer other
  2. sourceHash presence (integrity signal)
  3. fetchedAt newer wins
  4. Equal fetchedAt → prefer DB (authoritative PostgreSQL store)

### Gate 8 — Immutable generation
- `p33b.immutableGeneration.ts` — uses test hooks to prove:
  - 0-row scan NOT published (last-good generation preserved)
  - reconciliation-fail scan NOT published
  - valid scan IS published (generation advances)

### Gate 9 — Production build scan
- Build at 2026-08-09 16:00:22 UTC (commit pre-437e389; scripts added post-build)
- All 11 debug markers → 0 matches in dist/
- `FNO_PAPER_V2_RUNTIME_AUTHORIZED=true` → 0 assignments; `SWING_PAPER_V2_RUNTIME_AUTHORIZED=true` → 0 assignments
- `console.log.*DEBUG` hit → pino bundled library (`exports.log = console.debug || console.log`), not our code (false positive)
- `FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED.*=.*true` hits → in `reason:` string literals, not lock mutations (false positive)

### Gate 10 — Full battery
- api-server: **6916/6916 PASS** (297 test files)
- scanner: **1305/1305 PASS** (55 test files)
- 4-package TSC: all 4 EXIT:0
- .skip/.only: NONE
- git diff --check: PASS
- V2 locks source: FNO_PAPER_V2=false, SWING_PAPER_V2=false, WAREHOUSE_POP=false, CANDLE_EVAL=false
- Broker: placeOrderDryRun only (no real placeOrder in swing production path)

### DISK_CACHE_VERSION: 19 → 20
Invalidates blobs carrying deprecated ORDINARY_MAIN_BOARD_EQUITY class name.

### Files created
- `artifacts/api-server/src/lib/p33b.liveReconciliation.ts`
- `artifacts/api-server/src/lib/p33b.fnoAdmissionRuntime.ts`
- `artifacts/api-server/src/lib/p33b.swingCashRuntime.ts`
- `artifacts/api-server/src/lib/p33b.immutableGeneration.ts`

**Why:** Required by PROMPT_33B_REJECTED-EVIDENCE_REMEDIATION (prior Pack 33B verdict rejected for lacking live runtime evidence and proper authority-level semantics). Owner deployment authorization required before any canary.
