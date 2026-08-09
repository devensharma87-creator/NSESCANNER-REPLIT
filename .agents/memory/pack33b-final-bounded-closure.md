---
name: Pack 33B Final Bounded Closure
description: 3 blocker fixes from PROMPT_33B_FINAL_BOUNDED_CLOSURE; commit db0333e
---

## 3 blockers fixed — commit db0333e

### Blocker 1 — ETF/REIT/InvIT comment correction + live reconciliation

**Live evidence (2026-08-09, NSE live fetch):**
- EQUITY_L.csv total rows: 2388 (EQ: 2066, BE: 294, BZ: 28)
- ETF cross-check: eq_etfseclist.csv has 342 ETF symbols; 0 of them appear in EQUITY_L EQ series
- REIT/InvIT: 0 company names with "REIT" or "INVIT" in EQUITY_L EQ series
- CONCLUSION: EQUITY_L.csv series=EQ IS a clean ordinary equity universe

**Code fix:** Removed 3 false LIMITATION lines from `instrumentEligibility.ts` claiming ETFs/REITs appear as EQ. Replaced with verified live evidence. Fixed `detectReitOrInvit` function comment.

**Live reconciliation (Kite master × EQUITY_L.csv 2026-08-09):**
```
Kite raw NSE count:          10036
Kite EQ candidates:          9899 (kiteEqSegmentCount)
Post-filter list:            8920 (isLikelyTradeableEquity)
NSE EQUITY_L.csv rows:       2388
Symbol matches:              2077
Kite-only unmatched:         6843
NSE-only unmatched:          311
Ordinary eligible (AUTH):    2065
  ETF_OR_FUND:               257
  REIT_OR_INVIT:             6
  DEBT_GOVERNMENT_SECURITY:  3889
  TRADE_TO_TRADE_EXCLUDED:   11
  UNRESOLVED:                2692
  Blocked:                   0
Final scanner universe:      2065
Accounting difference:       0  ← MUST=0 ✔
```

**Full scanner generation (gen-1786293513835-1, 2026-08-09):**
- eligible: 2065, nseRefRecords: 2388, snapshot committed (snapshotId:62)
- requested: 2065, returned: 2065

### Blocker 2 — SnapshotPersistenceResult.ok=false no longer claims durableStore

**Type fix in `nseSecurityMaster.ts`:**
- `ok=true` branch: `durableStore: "POSTGRESQL"`, `durablyCommitted: true`
- `ok=false` branch: `durablyCommitted: false` ONLY — no `durableStore` field

**Runtime proof (tsx script, live DB):**
- Scenario 1 (success): `ok=true, durablyCommitted=true, durableStore=POSTGRESQL, snapshotId=60`
- Scenario 2 (failure, circular-ref entry): `ok=false, durablyCommitted=false, "durableStore" present: false`
  - DIAGNOSTIC_EVENT=NSE_MASTER_PERSISTENCE_FAILURE logged with canAuthorizeUniverse=false
  - Previous durable snapshot preserved (no overwrite on ok=false)
- Scenario 3 (refresh failure): fullNseScanner.ts:1597-1604 — reconciliationFailed gate prevents cache swap
- Scenario 4 (restart): `_selectBetterSnapshot(diskSnap, dbSnap)` — 4-step selection, DB preferred on tie

**Advisory lock:** `pg_advisory_xact_lock(DB_ADVISORY_LOCK_KEY)` inside `db.transaction()` → auto-released on commit/rollback (transaction-scoped, safe on pooled connections).

**Caller check:** `nseSecurityMaster.ts:764 — if (!persistResult.ok) { logger.warn(...) }` — caller never sets `canAuthorizeUniverse=true` when ok=false.

### Blocker 3 — F&O admission gate runtime proof (unchanged from prior pass)

Live runtime proof (checkFnoBanAdmission, 2026-08-09):
- NIFTY (index): status=CURRENT, banned=false, canAuthorizeAdmission=true
- RELIANCE (stock, clear): status=CURRENT, banned=false, canAuthorizeAdmission=true  
- HINDCOPPER (stock): status=CURRENT, banned=false, canAuthorizeAdmission=true (not on ban list today)
- LAST_KNOWN_STALE + UNAVAILABLE: proven in p33b.admissionBanGate.test.ts (36/36 PASS)
- Swing Cash (CNC): fnoBanAdmission is advisory metadata; ACTIVE_STATUSES has no FNO_BAN* entries

### Final battery — commit db0333e

- api-server: 6916/6916 PASS (297 files)
- scanner: 1305/1305 PASS (55 files)
- 4-package TSC: all EXIT:0
- Build: EXIT:0 (678ms)
- All debug markers → 0 in dist/
- V2 locks: all `= false as boolean` at source
- .skip/.only: conditional only (data-driven, no static suppression)
- git diff --check: PASS
- Broker: placeOrderDryRun only

**OWNER_DEPLOYMENT_AUTHORIZATION_REQUIRED** — no deployment performed.
