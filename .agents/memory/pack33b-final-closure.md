---
name: Pack 33B final closure
description: 10-gate pre-deployment evidence correction — all gates closed; OWNER_DEPLOYMENT_AUTHORIZATION_REQUIRED.
---

# Pack 33B Final Evidence Remediation — Closure

**Commit:** eaec2a3 (2026-08-09)

## Closing battery

| Gate | Result |
|---|---|
| api-server TSC | CLEAN |
| scanner TSC | CLEAN |
| api-server tests | **6911 PASS** / 297 files |
| scanner tests | **1305 PASS** / 55 files |
| git diff --check | CLEAN (no whitespace errors) |
| .skip/.only audit | PASS (all conditional, no unconditional) |

## Gate-by-gate status

### Gate 1 — instrumentEligibility.ts class split (AUTHORITATIVE vs HEURISTIC_FAIL_CLOSED)
- `PARTLY_PAID_OR_PREFERENCE` split into:
  - `PARTLY_PAID_EQUITY` (AUTHORITATIVE: Kite -PP suffix or "PARTLY PAID" NSE name)
  - `PREFERENCE_SHARE` (HEURISTIC_FAIL_CLOSED: "PREFERENCE" name pattern only)
- `PARTLY_PAID_OR_PREFERENCE` kept as @deprecated never-emitted for cache compat
- `authorityLevel: "AUTHORITATIVE" | "HEURISTIC_FAIL_CLOSED"` added to `InstrumentEligibilityResult`
- `REIT_OR_INVIT` and `ETF_OR_FUND` now annotated `HEURISTIC_FAIL_CLOSED`
- All three new classes added to `WAREHOUSE_EXCLUDED_CLASSES`
- Detailed authority-level classification doctrine comment block added

### Gate 2 — F&O ban callers use .canAuthorizeAdmission (not .allowed)
- `fnoSignalAlerts.ts` line 607: `!banResult.canAuthorizeAdmission` ✓
- `paperTradingFO.ts` line 416: `!banResult.canAuthorizeAdmission` ✓
- `swingOrderStaging.ts` line 368: `!fnoBanAdmission.canAuthorizeAdmission` ✓

### Gate 3 — FnoBanAdmissionResult primary field contract
- PRIMARY: `status`, `banned`, `canAuthorizeAdmission`, `reasonCode`, `asOf`
- DIAGNOSTIC-ONLY: `verdict`, `reason` (must not drive gate logic)
- REMOVED: `allowed`, `rawBanResult`, `banListStatus`
- Index derivatives: `status="CURRENT"`, `banned=false`, `asOf=null` (authoritative non-ban)

### Gate 4 — Swing staging F&O ban is informational only
- `swingOrderStaging.ts`: `fnoBanAdmission.canAuthorizeAdmission` is logged but does not hard-block
- `StageSwingOrderResult.fnoBanAdmission` is optional metadata field

### Gate 5 — _saveSnapshotToDb returns SnapshotPersistenceResult
- Returns `{ok:true; snapshotId; committedAt; sha256}` or `{ok:false; reasonCode; errorClass}`
- Uses `db.transaction()` with `pg_advisory_xact_lock` (transaction-scoped, auto-released)
- `RETURNING id::text AS id, saved_at` from INSERT
- Empty RETURNING → `{ok:false, reasonCode:"INSERT_RETURNING_EMPTY"}`
- `refresh()` logs persistence result; continues on ok=false (non-fatal)

### Gate 6 — L1+L2 fallback precedence fix
- Session advisory lock functions removed (unsafe on pooled connections)
- L1 disk + L2 DB loaded in parallel on L3 failure
- Newer validated snapshot (by `fetchedAt`) is used, preventing blindly preferring stale instance-local disk
- Cross-replica write serialization: `pg_advisory_xact_lock` inside `db.transaction()` in `_saveSnapshotToDb`

### Gate 7 — Safety locks (authorization flags)
- No `AUTHORIZE_PROMPT_33*` flags wired in current codebase (confirmed grep: 0 matches)
- OWNER_DEPLOYMENT_AUTHORIZATION_REQUIRED: manually enforced (no code changes deploy themselves)
- Test-suite authorization flags unchanged: all false

### Gate 8 — Full test battery
- api-server: 6911 PASS (297 files, 69.7s) — 2 warn logs "no db in unit test env" expected
- scanner: 1305 PASS (55 files)
- All p33b.* test files: 231 PASS (13 files)

### Gate 9 — git diff --check
- CLEAN — no whitespace errors, no trailing spaces

### Gate 10 — .skip/.only audit
- All `.skip` uses are conditional (`describeCandles = candlesPresent ? describe : describe.skip`)
- 0 unconditional `.skip` or `.only` in non-db test files

## Files changed in this session (commit eaec2a3)
- `artifacts/api-server/src/lib/kiteCandle/instrumentEligibility.ts` (+243/-149)
- `artifacts/api-server/src/lib/nseFnoBanGate.ts` (+228/-154, prior session)
- `artifacts/api-server/src/lib/nseSecurityMaster.ts` (+260/-173)
- `artifacts/api-server/src/lib/fnoSignalAlerts.ts` (4 lines: .allowed → .canAuthorizeAdmission)
- `artifacts/api-server/src/lib/paperTradingFO.ts` (4 lines: .allowed → .canAuthorizeAdmission)
- `artifacts/api-server/src/lib/swingOrderStaging.ts` (8 lines: .allowed → .canAuthorizeAdmission)
- `artifacts/api-server/src/lib/p33b.admissionBanGate.test.ts` (64 lines)
- `artifacts/api-server/src/lib/p33b.correctionFinal.test.ts` (206 lines)
- `artifacts/api-server/src/lib/p33b.nseMasterPersistence.test.ts` (23 lines: add db.transaction mock)

**Why:** Final pre-deployment evidence gate for Pack 33B. Owner must authorize deployment manually.
**VERDICT:** PACK_33B_FINAL_EVIDENCE_REMEDIATION_COMPLETE — OWNER_DEPLOYMENT_AUTHORIZATION_REQUIRED
