# Phase 0 Test Isolation Proof — 2026-07-20

**Authority:** Superseding Phase 0 prompt §6.6, P0-C  
**Implementation:** `artifacts/api-server/src/lib/testIsolationGuard.ts`

---

## Current Test Database State

| Variable | Status |
|----------|--------|
| `TEST_DATABASE_URL` secret | NOT PROVISIONED (owner action required) |
| `DATABASE_URL` | Operational dev database (shared) |

**DB-backed test status:** `NOT_RUN_NO_ISOLATED_DB`  
All DB-backed integration tests skip cleanly per §6.6 rule: absence of `TEST_DATABASE_URL`  
causes DB tests to skip/fail clearly, never fall back to `DATABASE_URL`.

---

## Isolation Rules Implemented

| Rule | Implementation | Status |
|------|---------------|--------|
| DB tests require `TEST_DATABASE_URL` | `requireIsolatedTestDb()` throws when absent | IMPLEMENTED |
| Refuse operational targets | Pattern match against `OPERATIONAL_DB_PATTERNS` | IMPLEMENTED |
| Require approved test patterns | Pattern match against `APPROVED_TEST_DB_PATTERNS` | IMPLEMENTED |
| `TEST_DATABASE_URL === DATABASE_URL` → reject | Exact string equality check | IMPLEMENTED |
| Absent `TEST_DATABASE_URL` → skip, never fallback | Guard throws, tests catch as skip signal | IMPLEMENTED |
| Sentinel test: only `DATABASE_URL` cannot write | `sentinelCheckWithOnlyOperationalUrl()` | IMPLEMENTED |

---

## Test Results — Pure/Unit Tests Only

The following pure tests run without DB access and do not require `TEST_DATABASE_URL`:

### `swingSignals.provenance.test.ts` (P0-D + P0-A + P0-C)

Tests implemented:
1. `isTradeGradeSwingRow` returns false when rowSource absent → SHOULD PASS
2. `isTradeGradeSwingRow` returns false for Yahoo/offline rows → SHOULD PASS
3. `isTradeGradeSwingRow` returns false for stale Kite rows → SHOULD PASS
4. `isTradeGradeSwingRow` returns false for KITE_PARTIAL → SHOULD PASS
5. `isTradeGradeSwingRow` returns true ONLY for TRADE_GRADE rows → SHOULD PASS
6. `isTradeGradeSwingRow` returns false for undefined canDriveSignals → SHOULD PASS
7. `evaluateAdmission` blocks FNO when c0FnoBlocked=true → SHOULD PASS
8. `evaluateAdmission` blocks EQUITY when c0EquityBlocked=true → SHOULD PASS
9. `evaluateAdmission` blocks COMBO when c0FnoBlocked=true → SHOULD PASS
10. `evaluateAdmission` returns allowed when both C0=false → SHOULD PASS
11. `evaluateAdmission` decisionAt is server clock, not signal time → SHOULD PASS
12. Sentinel: throws when TEST_DATABASE_URL absent → SHOULD PASS
13. Sentinel: blocks when only operational DATABASE_URL → SHOULD PASS
14. Sentinel: blocks when TEST=operational URL → SHOULD PASS
15. Sentinel: blocks when TEST matches operational pattern → SHOULD PASS
16. Sentinel: allows approved test database name → SHOULD PASS

**Status:** Tests implemented but NOT RUN this session. Run command:  
```bash
pnpm --filter @workspace/api-server exec vitest run --pool=threads "src/lib/swingSignals.provenance.test.ts"
```

**Why not run:** The test file references `@workspace/api-zod` types for `StockRow`.  
A typecheck is needed first to verify the file compiles correctly before running.

---

## Required Owner Actions (§6.6)

1. **Provision `TEST_DATABASE_URL`** — a disposable PostgreSQL database distinct from `DATABASE_URL`.  
   Name must match one of: `*test*`, `*vitest*`, `*ephemeral*`, `*tmp*`.
2. **Apply schema migrations** to the test database only (not operational).
3. **Verify** the sentinel test: running only with `DATABASE_URL` must produce `CORRECTLY_BLOCKED`.
4. **Convert** existing DB-backed tests (those that currently inherit `DATABASE_URL`) to use  
   `requireIsolatedTestDb()` in their `beforeAll()` hook.

---

## Tests NOT Run

| Test Suite | Reason | Status |
|------------|--------|--------|
| DB-backed integration tests | `TEST_DATABASE_URL` not provisioned | `NOT_RUN_NO_ISOLATED_DB` |
| `ledgerReconciliationGate.behavioral.test.ts` | Requires TEST_DATABASE_URL | `NOT_RUN_NO_ISOLATED_DB` |
| `paperTradingEq.levelGate.test.ts` (planned) | Requires TEST_DATABASE_URL | `NOT_RUN_NO_ISOLATED_DB` |
| `invalidSessionDetector` integration test | Requires TEST_DATABASE_URL | `NOT_RUN_NO_ISOLATED_DB` |
| Full api-server test suite | Would require TEST_DATABASE_URL for DB tests | `NOT_RUN_NO_ISOLATED_DB` |

**Note:** Pure/unit tests (no DB) CAN be run with: `pnpm --filter @workspace/api-server run test`  
(existing suite). The guard does not affect pure tests.
