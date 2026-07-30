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

## Acceptance Verdict

ACCEPT_P0_1B_SAFETY_CLOSURE_READY_FOR_OWNER_PROVISIONING issued 2026-07-30

**Why:** All 15 criteria from Prompt 11 §15 met. See §12 of evidence file.
