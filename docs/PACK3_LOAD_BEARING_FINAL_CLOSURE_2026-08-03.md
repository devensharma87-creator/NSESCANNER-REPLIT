# Pack 3 Load-Bearing Final Closure Evidence Report

**Date:** 2026-08-03  
**Prompt:** 21A — Pack 3 Load-Bearing Final Closure  
**Status at entry:** `PACK_3_NOT_FROZEN — LOAD_BEARING_CLOSURE_PENDING`

---

## §1 Production Fix — Atomic Stage Claim

### 1.1 Problem
`stageSwingOrder` contained a TOCTOU race: the idempotency check (SELECT existing
active stage for `ownerKey+symbol`) and the INSERT were not atomic. Two concurrent
HTTP requests could both read an empty result and both insert a row, double-investing
the same cash position.

### 1.2 Fix Applied
`artifacts/api-server/src/lib/swingOrderStaging.ts`

The non-atomic `SELECT + INSERT` pair was wrapped in:
```typescript
await db.transaction(async (tx) => {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(8274615)`);
  const existingActive = await tx.select().from(swingOrderStagingTable)
    .where(and(eq(swingOrderStagingTable.ownerKey, ...), eq(...symbol, ...), ...))
    .limit(1);
  if (existingActive[0]) { return { duplicate: true, row: existingActive[0] }; }
  const [inserted] = await tx.insert(swingOrderStagingTable).values(values).returning();
  return { duplicate: false, row: inserted };
});
```

**Advisory lock key:** `8274615` (reserved "swing stage claim"; distinct from `7593721`
used by the combo-open cap to avoid unnecessary serialization between the two paths).

---

## §2 Gate Results

### Gate 1 — Atomic Staged-Order Claim
**File:** `artifacts/api-server/src/lib/p21a.swingAtomicClaim.test.ts`  
**Tests:** 12 | **Result:** ✅ 12/12 PASS

| # | Test | Result |
|---|------|--------|
| T1 | Two concurrent identical calls create exactly one row | ✅ |
| T2 | Batch of 4 concurrent identical calls creates exactly one row | ✅ |
| T3 | Losers receive stable DUPLICATE_ACTIVE_STAGE reason | ✅ |
| T4 | Exactly one alertSwingOrderStaged call after concurrent requests | ✅ |
| T5 | Alert failure does not create a second row on retry | ✅ |
| T6 | Expired active stage permits one new active stage | ✅ |
| T7 | Terminal (REJECTED) stage permits a new active stage | ✅ |
| T8 | Two different owners independently stage the same symbol | ✅ |
| T9 | One owner independently stages two different symbols | ✅ |
| T10 | Advisory lock called once per transaction | ✅ |
| T11 | Genuine persistence error not mistaken for DUPLICATE_ACTIVE_STAGE | ✅ |
| T12 | Source: SELECT and INSERT inside db.transaction + pg_advisory_xact_lock(8274615) | ✅ |

### Gate 2 — Missing Load-Bearing Gaps A–F
**File:** `artifacts/api-server/src/lib/p21a.swingGatesAF.test.ts`  
**Tests:** 24 | **Result:** ✅ 24/24 PASS

| Gate | Tests | Result |
|------|-------|--------|
| A — Instrument resolver | A1–A4 | ✅ 4/4 |
| B — Candle truth + freshness | B1–B4 | ✅ 4/4 |
| C — Scanner ranking determinism | C1–C4 | ✅ 4/4 |
| D — Signal/plan immutability | D1–D4 | ✅ 4/4 |
| E — Staged-order immutability | E1–E4 | ✅ 4/4 |
| F — Event-risk gates | F1–F4 | ✅ 4/4 |

### Gate 3 — Registered Route Execution
**File:** `artifacts/api-server/src/routes/__tests__/p21a.swingRoutes.test.ts`  
**Tests:** 18 | **Result:** ✅ 18/18 PASS

All 18 route tests pass using a real Express app + `http.createServer` on port 0 +
global fetch. Auth guard, kill-switch, Zod validation, response shape, and all
middleware ordering verified.

### Gate 4 — Swing Cash UI Production Component
**File:** `artifacts/scanner/src/lib/p21a.swingCashUI.test.tsx`  
**Tests:** 17 | **Result:** ✅ 17/17 PASS

The real `SwingCashLiveQueue` component rendered via `createRoot + act` with all API
hooks mocked. Data-state coverage: loading, empty, kill-switch active, STAGED,
APPROVAL_REQUIRED, REJECTED, WATCH_ONLY, EXPIRED, live_dry_run mode. Safety
invariants: no `[object Object]`, no fabricated money values, no dedup loss.

### Gate 5 — Outside-Hours + Live-Order Execution Safety
**File:** `artifacts/api-server/src/lib/p21a.swingExecutionSafety.test.ts`  
**Tests:** 29 | **Result:** ✅ 29/29 PASS

| Sub-gate | Tests | Result |
|----------|-------|--------|
| 5A — getSwingExecutionMode fail-closed | 7 | ✅ |
| 5B — isLiveCashSwingOrderEnabled hard flag | 7 | ✅ |
| 5C — Broker hard block + source proofs | 8 | ✅ |
| 5D — computeMarketStatus session boundaries | 7 | ✅ |

---

## §3 Full Suite Verification

| Suite | Files | Tests | Result |
|-------|-------|-------|--------|
| api-server (full) | 227 | 4,999 | ✅ ALL PASS |
| scanner (full) | 44 | 947 | ✅ ALL PASS |

**Baseline:** api-server 4,916 → 4,999 (+83 new).  
**Baseline:** scanner 930 → 947 (+17 new).  
**Total new load-bearing tests added in P21A:** 100.

---

## §4 TypeScript Clean

| Package | TSC Result |
|---------|-----------|
| @workspace/api-server | ✅ 0 errors |
| @workspace/scanner | ✅ 0 errors |
| @workspace/global | ✅ 0 errors |

---

## §5 Production Builds

| Artifact | Build Result |
|----------|-------------|
| artifacts/api-server | ✅ PASS (esbuild, 819ms) |
| artifacts/scanner | ✅ PASS (Vite, 9.51s) |
| artifacts/global | ✅ PASS (Vite, 3.39s) |

---

## §6 Whitespace / Conflict Check

```
git diff --check HEAD → EXIT:0 (clean)
```

---

## §7 New Files Delivered

| File | Purpose |
|------|---------|
| `artifacts/api-server/src/lib/p21a.swingAtomicClaim.test.ts` | Gate 1: 12 tests |
| `artifacts/api-server/src/lib/p21a.swingGatesAF.test.ts` | Gate 2: 24 tests |
| `artifacts/api-server/src/routes/__tests__/p21a.swingRoutes.test.ts` | Gate 3: 18 tests |
| `artifacts/scanner/src/lib/p21a.swingCashUI.test.tsx` | Gate 4: 17 tests |
| `artifacts/api-server/src/lib/p21a.swingExecutionSafety.test.ts` | Gate 5: 29 tests |

---

## §8 Production Changes

| File | Change |
|------|--------|
| `artifacts/api-server/src/lib/swingOrderStaging.ts` | Wrapped non-atomic SELECT+INSERT in `db.transaction` + `pg_advisory_xact_lock(8274615)` |

---

## §9 Closure Checklist

1. ✅ Production race condition fixed (TOCTOU in stageSwingOrder)
2. ✅ Advisory lock key documented: 8274615 (distinct from 7593721)
3. ✅ Gate 1: 12 concurrent-claim tests pass (atomicity proven in test isolation)
4. ✅ Gate 2: 24 gap-filling tests pass (A–F all covered by real production calls)
5. ✅ Gate 3: 18 route tests pass (real Express app, port-0 HTTP)
6. ✅ Gate 4: 17 UI tests pass (real React component, jsdom, createRoot+act)
7. ✅ Gate 5: 29 safety tests pass (E5A–E5D: env-reading + market session boundary)
8. ✅ api-server test count: 4,999 (was 4,916 + 83 new)
9. ✅ scanner test count: 947 (was 930 + 17 new)
10. ✅ TSC: 0 errors across all 3 checked packages
11. ✅ Prod builds: api-server + scanner + global all pass
12. ✅ git diff --check: EXIT:0
13. ✅ No .skip / .only / fabricated assertions in any test
14. ✅ No live DB, no live Kite, no live Telegram in any test
15. ✅ swingOrderStaging.ts: db.transaction + pg_advisory_xact_lock(8274615) confirmed
16. ✅ Existing tests unchanged (all 4,999 api-server + 947 scanner pass)
17. ✅ LLM index updated (docs/llm-index/)

---

END_FAST_TRACK_PACK_3_LOAD_BEARING_FINAL_CLOSURE
