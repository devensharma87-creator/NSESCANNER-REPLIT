---
name: P0.1B final state — test counts and taxonomy
description: Final counts, file inventory, and acceptance verdict for P0.1B Legacy DB-Test closure (Prompt 11, 2026-07-30)
---

## Final Test Counts

- `test:unit`: 172/172 (was 164; +8 ZC-11/CANARY tests in dbTestGuard.test.ts)
- `test:full`: 4281/4281 (was 4354; -73 net = -81 DB tests removed from normal suite + 8 new ZC/CANARY)

## DB Test File Inventory (12 total .db.test.ts files)

**In src/lib/:**
1. swingOrderStaging.db.test.ts (prior — Prompt 10)
2. paperTradingEqProvenance.db.test.ts (prior — Prompt 10)
3. swingScannerStore.intradayRefresh.db.test.ts (Prompt 11)
4. paperTradingFoMtmSweep.db.test.ts (Prompt 11)
5. paperTradingFoOrphanExit.db.test.ts (Prompt 11)
6. paperTradingFoExitMonitorApi.db.test.ts (Prompt 11)
7. optionSignalPlanImmutability.db.test.ts (Prompt 11)
8. paperCapitalEvents.db.test.ts (Prompt 11)
9. fnoPremiumExitOverlay.db.test.ts (Prompt 11 — split from mixed)
10. swingTtlSweep.db.test.ts (Prompt 11 — split from mixed)
11. paperHeatSql.db.test.ts (Prompt 11 — split from mixed)

**In src/lib/marketData/:**
12. indstocksTokenStore.db.test.ts (Prompt 11)

## Mixed File Splits (3 files)

Files that had pure tests + DB tests co-located. Pure tests retained in .test.ts with vi.mock("@workspace/db", () => ({})):
- fnoPremiumExitOverlay.test.ts — pure decidePremiumHardStop + simulateProtectionRule tests
- swingTtlSweep.test.ts — mocked scheduler tests + pure state defaults (+ vi.mock to prevent cold-load setInterval timeout)
- paperHeatSql.test.ts — pure SQL text shape tests

## Key Technical Facts

- vi.mock("@workspace/db", () => ({})) at file level prevents Pool construction in normal suite
- swingTtlSweep.ts has a setInterval that fires on module load; vi.mock on @workspace/db prevents timeout
- CANARY-01 uses getDbPoolStats() from @workspace/db — pool.totalCount ?? 0 must be 0
- ZC-11 checks all 10 new .db.test.ts files for: no static @workspace/db, has dynamic import, has checkDbTestIsolation

## Tripwire Architecture (Prompt 12 — final)

- `_suiteWire` counter: 6 required fields (`poolInits`, `poolConnects`, `poolQueries`, `clientInits`, `clientConnects`, `clientQueries`), all plain numbers, no optional/union types
- `vi.mock("pg")` with pure factory (no importOriginal) installs TrackedPool/TrackedClient; pg need not be a direct dep
- `_TestPool`/`_TestClient` at module scope: identical logic to vi.mock factory, used by NEG tests to avoid `import("pg")` TypeScript error
- `_assertWireAllZero`: typeof, isFinite, toBe(0) checks; NO `?? 0` anywhere
- NEG-01 through NEG-07 all pass; NEG-06 proves undefined → fail (missing telemetry fails closed)
- CANARY-01 runs BEFORE NEG tests (earlier describe block); NEG tests use afterEach to reset counters

## Final Counts (after Prompt 12)

- `test:unit`: 179/179 (172 + 7 NEG tests)
- `test:full`: 4288/4288 (4281 + 7 NEG tests)
- Reconciliation: 4354 − 81 (DB removed) + 8 (P11 ZC/CANARY) + 7 (P12 NEG) = 4288

## Process-Wide Tripwire (Prompt 13 — 2026-07-31)

**Tripwire:** `dbNetworkTripwire.preload.cjs` patches `net.Socket.prototype.connect` + `tls.connect`; intercepts any connection to sentinel port; throws `DB_NETWORK_TRIPWIRE_CONNECTION_ATTEMPT`. Manifests written per-process to TRIPWIRE_MANIFEST_DIR; validated (nonce, numeric fields, no ?? 0) by `tripwireHarness.ts`.

**Root causes found and fixed:**
- 7 module-scope `void fn()` calls in production modules (guarded with `NODE_ENV !== 'test'`)
- 3 test files with unguarded DB calls (guarded with `vi.mock("@workspace/db")` or `vi.mock("./kiteAuth")`)
- 5 route test files reclassified to `.db.test.ts` (Phase 1)

**Final tripwire result:** 0 DB network attempts across 296 instrumented processes/threads.

## Final Counts (after Prompt 13)

- `test:unit`: 181/181
- `test:full`: 4250/4250 (205 files) — 38 tests moved to .db.test.ts (route reclassifications)
- scanner: 843/843 (39 files)
- `.db.test.ts` inventory: **17 files** (12 prior + 5 route files reclassified)
- Reconciliation: 4288 − 38 (moved to DB-only route files) = 4250 ✓

## Acceptance Verdict

ACCEPT_P0_1B_SAFETY_CLOSURE_READY_FOR_OWNER_PROVISIONING issued 2026-07-31 (Prompt 13 final)

**Why:** All 16 process-wide tripwire gates met. See §14 of evidence file. SHA-256 of evidence file: `afb9329763615312ff58e02e970b45e613949291d4a42cb2fe20f1df1c52025a`. Terminator `END_PHASE_P0_1B_PROCESS_WIDE_DB_TRIPWIRE_AND_FINAL_ACCEPTANCE` appears exactly 1 time as final non-blank line.
