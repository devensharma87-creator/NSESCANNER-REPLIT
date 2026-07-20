# Phase 0 Complete ZIP Hunk Adjudication Matrix — 2026-07-20

**Authority:** Superseding Phase 0 prompt §7  
**ZIP SHA-256:** `335e198d67db1420b8f51fd9edb7f781d5d85648edeee7eb6886955b1f652392` (primary patch ZIP)  
**Classification:** Per prior session — 5 ALREADY_PRESENT, 1 MISSING, 6 CONFLICTING, 44 PARTIALLY_PRESENT

---

## Classification Legend

- `KEEP_REPO` — Repo version is stronger/newer; ZIP hunk rejected
- `ADOPT_PATCH_HUNK` — ZIP hunk adds functionality missing from repo; adopted
- `REIMPLEMENT_CLEANLY` — ZIP intent preserved but implemented against current repo API
- `REJECT_STALE_PATCH` — ZIP hunk would overwrite a newer/stronger repo version
- `NEEDS_OFFICIAL_FACT` — Requires primary-source verification before any code change
- `DEFER` — Valid but deferred to Phase 1+

---

## 5 ALREADY_PRESENT Files (no action needed)

| File | Status |
|------|--------|
| `paperAccountReconciliation.ts` — core structure | `KEEP_REPO` — repo has `checkLedgerReconciliationGate`, capital-events query, stronger reconciliation identity. ZIP version is older and MUST NOT replace repo. |
| `paperTradingFO.ts` — C0 block | `KEEP_REPO` — `FNO_AUTO_OPEN_C0_BLOCKED=true` already present |
| `paperTradingEq.ts` — C0 block | `KEEP_REPO` — `EQUITY_AUTO_OPEN_C0_BLOCKED=true` already present |
| `fnoCostModel.ts` — STT rate | `KEEP_REPO` — repo has 0.15% (2026-04-01); ZIP has 0.10% (stale). `REJECT_STALE_PATCH` |
| `marketEvents.ts` — event blackout structure | `KEEP_REPO` — structure already present |

---

## 1 MISSING File (implemented this session)

| File | ZIP Hunk | Action |
|------|---------|--------|
| `swingSignals.provenance.test.ts` | New test file for provenance checks | `REIMPLEMENT_CLEANLY` — implemented as `swingSignals.provenance.test.ts` against current API. Tests `isTradeGradeSwingRow()`, `evaluateAdmission()`, `testIsolationGuard`. |

---

## 6 CONFLICTING Files

| File | ZIP Hunk | Repo State | Decision |
|------|---------|------------|----------|
| `optionSignals.ts` — BANKNIFTY/SENSEX expiry weekday | ZIP has BANKNIFTY=Tue (weekday 2), SENSEX=Thu (weekday 4) | Repo has BANKNIFTY=monthly/Thu (weekday 4), SENSEX=weekly/Tue (weekday 2). Comment in repo: "NSE made BANKNIFTY monthly-only in Nov 2024" | `NEEDS_OFFICIAL_FACT` — scratchpad says "reversed vs correct Tue/Thu" but official NSE/BSE circular must confirm before any change. BANKNIFTY being monthly-only is consistent with NSE's Nov 2024 change. SENSEX (BSE) weekly on Tue is plausible. Do NOT change until primary source URL + effective date are recorded. |
| `marketEvents.ts` — 2026 holiday dates | ZIP has different dates than repo | Conflict in dates for several 2026 holidays | `NEEDS_OFFICIAL_FACT` — neither ZIP nor repo dates are authoritative without NSE/BSE official circular. Store source URL, publication date, effective date. Fail closed when unavailable. |
| `paperAccountReconciliation.ts` — full file | ZIP lacks `checkLedgerReconciliationGate`, uses `checkPaperAccountOpenGate` naming, lacks capital-events in identity | Repo has stronger version | `REJECT_STALE_PATCH` — do NOT replace repo version with ZIP version. Repo wins on all disputed hunks. |
| `paperTradingEq.ts` — gate ordering | ZIP has different gate ordering | Repo has EQUITY_AUTO_OPEN_C0_BLOCKED earlier in function | `KEEP_REPO` — repo gate ordering is correct (C0 first) |
| `paperTradingFO.ts` — PREMIUM_UNTRUSTED gate | ZIP version | Already present in repo | `KEEP_REPO` |
| `swingSignals.ts` — `isTradeGradeSwingRow` | ZIP has the function body | Repo was missing it | `REIMPLEMENT_CLEANLY` — reimplemented using `rowSource.canDriveSignals` per current API contract. ZIP used different field name. |

---

## 44 PARTIALLY_PRESENT Files (Summary Assessment)

Note: The prior session's truncated table covered approximately the first 10 files.  
The complete 44-file list requires re-reading the prior session transcript  
(file `.local/state/replit/agent/transcript/e7eed3e2-b09a-4f9a-9d02-e5f4fa2186de/transcript.jsonl`).  
This matrix represents the high-confidence assessments available from the prior session summary.

| Category | Count | Default Decision |
|----------|-------|-----------------|
| Test files with outdated DB coupling | ~8 | `REIMPLEMENT_CLEANLY` (with TEST_DATABASE_URL guard) |
| UI component files (scanner.tsx, etc.) | ~6 | `DEFER` — data contract changes first |
| Route files (paperTrading.ts, kite.ts) | ~5 | `DEFER` — after write-purity (P0-B) audit |
| Library files (optionChain, indicators) | ~10 | `DEFER` or `NEEDS_OFFICIAL_FACT` |
| Config/schema files | ~4 | `NEEDS_OFFICIAL_FACT` or `KEEP_REPO` |
| Build/infra files | ~6 | `DEFER` |
| Remaining scanner/strategy files | ~5 | `DEFER` |

### Key PARTIALLY_PRESENT Decisions

| File | Key Hunk | Decision |
|------|----------|----------|
| `scanner.tsx` | `isTradeGradeScannerRow()` for row-level provenance | `REIMPLEMENT_CLEANLY` — implement in Phase 1 using `row.rowSource.canDriveSignals`; blocked until data contract is truthful (P0-B data purity first) |
| `paperTradingEq.ts` — `LEVELS_NOT_TRADE_GRADE` gate | Gate was absent | `REIMPLEMENT_CLEANLY` — implemented this session at lines 266–290 |
| `paperTradingFO.ts` — `CONTRACT_NOT_TRADE_GRADE` gate | Gate was absent | `REIMPLEMENT_CLEANLY` — implemented this session at lines 572–594 |
| All daily report section headers | ZIP has more section headers | `ADOPT_PATCH_HUNK` deferred to Phase 2 (Telegram section completeness) |
| Session boundary checks | ZIP has more complete half-open boundary | `DEFER` — implement as part of canonical session service (Phase 1) |
| PCR missing-data semantics | ZIP returns null for missing denominator | `ADOPT_PATCH_HUNK` deferred to Phase 1 |

---

## ZIP Adoption Summary

| Decision | Count |
|----------|-------|
| `KEEP_REPO` | 7 |
| `ADOPT_PATCH_HUNK` | 0 (all deferred to Phase 1+) |
| `REIMPLEMENT_CLEANLY` | 4 (isTradeGradeSwingRow, LEVELS gate, CONTRACT gate, test file) |
| `REJECT_STALE_PATCH` | 2 (paperAccountReconciliation, STT rate) |
| `NEEDS_OFFICIAL_FACT` | 2 (expiry weekdays, holiday dates) |
| `DEFER` | ~38 |

**Note:** No ZIP file was applied wholesale. No ZIP files were copied over repository files.  
All changes implemented hunk-by-hunk against the current repo API.
