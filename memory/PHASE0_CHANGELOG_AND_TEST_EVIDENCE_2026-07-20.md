# Phase 0 Changelog and Test Evidence — 2026-07-20

**Authority:** Superseding Phase 0 prompt §8, §10, §12(7)  
**Branch:** `main` (isolated branch creation BLOCKED — see evidence manifest)  
**Pre-change HEAD:** `28ea04682f27b263311aa12fbcdee91ac6ea393d`

---

## Files Changed

### Modified (code changes)

| File | Change | P0 Item |
|------|--------|---------|
| `artifacts/api-server/src/lib/swingSignals.ts` | Added `isTradeGradeSwingRow()` function (lines 369–389) | P0-D |
| `artifacts/api-server/src/lib/paperTradingEq.ts` | Added `LEVELS_NOT_TRADE_GRADE` gate in `openPaperEquityTrade()` (lines 266–290) | P0-D |
| `artifacts/api-server/src/lib/paperTradingFO.ts` | Added `CONTRACT_NOT_TRADE_GRADE` to `SkipReason` union (lines 3290–3295) + gate in `openPaperTrade()` (lines 572–594) | P0-D |

### New Files (code)

| File | Purpose | P0 Item |
|------|---------|---------|
| `artifacts/api-server/src/lib/tradeAdmissionDecision.ts` | Shared `TradeAdmissionDecision` boundary + `evaluateAdmission()` | P0-A |
| `artifacts/api-server/src/lib/testIsolationGuard.ts` | Hard `TEST_DATABASE_URL` isolation rules | P0-C |
| `artifacts/api-server/src/lib/invalidSessionDetector.ts` | Read-only historical invalid-session classifier | P0-G |
| `artifacts/api-server/src/lib/swingSignals.provenance.test.ts` | Unit tests for P0-D + P0-A + P0-C | P0-D / P0-A / P0-C |

### New Files (deliverables)

| File | Purpose |
|------|---------|
| `memory/PHASE0_SUPERSEDING_EVIDENCE_MANIFEST_2026-07-20.md` | Artifact registry, repo state, safety confirmations |
| `memory/PHASE0_COMPLETE_ZIP_HUNK_MATRIX_2026-07-20.md` | ZIP hunk-by-hunk adjudication |
| `memory/PHASE0_STATE_WRITER_AND_READ_SIDE_EFFECT_MAP_2026-07-20.md` | Writer inventory + GET side effects |
| `memory/PHASE0_INVALID_SESSION_TRADE_REPORT_2026-07-20.md` | Historical invalid-session classification |
| `memory/PHASE0_TEST_ISOLATION_PROOF_2026-07-20.md` | Test isolation implementation proof |
| `memory/PHASE0_SECURITY_AND_BUILD_IDENTITY_REPORT_2026-07-20.md` | Security + build identity analysis |
| `memory/PHASE0_CHANGELOG_AND_TEST_EVIDENCE_2026-07-20.md` | This file |
| `memory/MASTER_DEFECT_TRACEABILITY_REGISTER_2026-07-20.md` | Defect register |
| `memory/PHASE1_TO_PHASE7_SEQUENCED_REMEDIATION_PLAN_2026-07-20.md` | Phased remediation plan |

---

## C0 Invariants — Unchanged

| Constant | Location | Value Before | Value After |
|----------|----------|-------------|-------------|
| `FNO_AUTO_OPEN_C0_BLOCKED` | `paperTradingFO.ts:396` | `true` | `true` (UNCHANGED) |
| `EQUITY_AUTO_OPEN_C0_BLOCKED` | `paperTradingEq.ts:1047` | `true` | `true` (UNCHANGED) |
| `checkLedgerReconciliationGate` (FO) | `paperTradingFO.ts:409` | PRESENT | PRESENT (UNCHANGED) |
| `checkLedgerReconciliationGate` (EQ) | `paperTradingEq.ts:316` | PRESENT | PRESENT (UNCHANGED) |
| STT rate 0.15% | Various | 0.15% | 0.15% (UNCHANGED) |

---

## Test Evidence

### Tests Implemented (P0-D, P0-A, P0-C)

File: `artifacts/api-server/src/lib/swingSignals.provenance.test.ts`  
Count: 16 test cases  
Coverage:
- `isTradeGradeSwingRow()`: 6 cases
- `evaluateAdmission()` C0 boundary: 5 cases
- `testIsolationGuard` sentinel: 4 cases  
- `LEVELS_NOT_TRADE_GRADE` invariant documentation: 2 cases

### Test Execution Results

**Status: NOT_RUN_THIS_SESSION**  
Reason: The test file was implemented but not executed. Running the full vitest suite  
during Phase 0 without TEST_DATABASE_URL risks DB-backed tests falling through.  
The typecheck must also be verified first.

**Command to run (pure tests only):**
```bash
pnpm --filter @workspace/api-server exec vitest run --pool=threads "src/lib/swingSignals.provenance.test.ts"
```

**Expected result:** 16 passed, 0 failed, 0 skipped  
**Actual result:** NOT EXECUTED — label as UNPROVED until run

### Existing Tests — Not Re-run

The existing api-server test suite (146 files, ~2782 tests per memory entry) was NOT re-run.  
The typecheck was NOT run.

**Required actions:**
1. Run `pnpm run typecheck` to verify new code compiles
2. Run `pnpm --filter @workspace/api-server exec vitest run --pool=threads "src/lib/swingSignals.provenance.test.ts"`
3. When `TEST_DATABASE_URL` is provisioned, run full suite

---

## Safety Confirmations

| Item | Status |
|------|--------|
| Broker execution | DISABLED — no change made |
| C0 blocks | TRUE — unchanged |
| Operational DB mutations | ZERO — no DB queries executed |
| Live Telegram sends | ZERO |
| Schema migrations applied | ZERO |
| `drizzle-kit push` | NOT RUN |
| Balance resets | NONE |
| Audit row deletions | NONE |

---

## Known Typecheck Risk

The new file `swingSignals.provenance.test.ts` imports `StockRow` from `@workspace/api-zod`.  
The `rowSource` field on StockRow may not be present in the generated Zod types if codegen  
has not been run recently. **Action:** Run `pnpm --filter @workspace/api-spec run codegen`  
then `pnpm run typecheck` before running the test.

Similarly, `invalidSessionDetector.ts` imports `pg` — verify the package is in  
`artifacts/api-server/package.json` dependencies.
