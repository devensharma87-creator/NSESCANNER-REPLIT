---
name: Pack 34 — Independent Production Truth Audit closure
description: Read-only audit of marketscannerbydev.in; no code changes; three deliverable files; partial verdict due to market-closed window.
---

# Pack 34 — Production Truth Audit Closure

**Date:** 2026-08-06  
**Method:** Read-only (no DB mutations, no code edits, no orders)  
**Verdict:** PRODUCTION_TRUTH_AUDIT_PARTIAL — LIVE MARKET WINDOW REQUIRED  
**Market window:** Closed (17:35 IST) — Gate 14 and Gate 2 (cross-tab parity) unverifiable

## Deliverables

- `artifacts/audit-evidence/INDEPENDENT_PRODUCTION_TRUTH_DATA_PARITY_AND_LIFECYCLE_AUDIT.md`
- `artifacts/audit-evidence/INDEPENDENT_PRODUCTION_TRUTH_DEFECT_MATRIX.csv`
- `artifacts/audit-evidence/INDEPENDENT_PRODUCTION_ROUTE_AND_DATA_MATRIX.csv`
- Screenshots: `artifacts/audit-evidence/screenshots/production-truth-audit/` (7 images)

## Key Facts

- Production commit: `d48dbb2` (2026-08-06 11:24:52 UTC, Build ID `7ff387fb-4e14-4fec-ae8c-9a448a4658d5`)
- Dev HEAD: `10e047a` (Pack 32 — 1 commit ahead; only V2 cohort foundation missing from prod)
- Production JS: `assets/index-Cfl5lfd9.js`; Dev JS: `assets/index-DQAqkQYa.js` (different hashes)
- All production API endpoints return AUTH_REQUIRED (site is application-level password-gated)
- Test floor maintained: api-server 6,241/272, scanner 1,250/52; 4-pkg TSC clean

## Defect Matrix Summary

| ID | Severity | Finding |
|---|---|---|
| P34-P1-01 | P1 | Pack 32 not deployed (1 commit drift; V2 locks are false as boolean — operationally zero impact) |
| P34-P1-02 | P1 | All production API endpoints return AUTH_REQUIRED including registered PUBLIC_ROUTES (/api/build-info, /api/health) |
| P34-P2-01 | P2 | Cross-tab quote parity unverifiable (market closed; Gate 14 re-run required) |
| P34-P2-02 | P2 | Scanner emits numeric score with partial Yahoo indicator inputs (EMA computable, RSI/VWAP null); no trading impact (canDriveSignals=false) |
| P34-P2-03 | P2 | Option chain shows lot_size=25 (NSE EOD stale); Pack 9A ingestor constant NIFTY=65; paper trade lot sizing path unverified |
| P34-P3-01 | P3 | Scanner JS bundle 2,858 KB / 758 KB gzip — above Vite 500 KB chunk warning; no code-splitting |
| P34-P3-02 | P3 | Scanner footer label understates Yahoo indicator role (says fallback price only; actually computes RSI/EMA/VWAP) |

## Key Architecture Findings (PASS)

- `assertTradeable()` + `isTradeableMeta()`: stale/non-authoritative/notForSignals all rejected
- `FNO_PAPER_V2_RUNTIME_AUTHORIZED = false as boolean` — confirmed
- `SWING_PAPER_V2_RUNTIME_AUTHORIZED = false as boolean` — confirmed
- `DB_TEST_RUNTIME_AUTHORIZED = false as boolean` — confirmed
- All broker execution types: PAPER_ONLY (no live orders possible)
- Upstox: shadow-only (fireShadow), zero trading impact, no import in scanner/F&O lifecycle
- IndianAPI: fundamentals/reference only, no live quotes or option chains
- Yahoo: scanner display enrichment only; shouldDemoteSignal() enforces canDriveSignals=false
- Security headers (CSP, HSTS, XCTO, XFO) all present in production
- VITE_PREVIEW_BYPASS gated behind DEV+VITE_PREVIEW_BYPASS env — absent from production bundle
- No secrets in frontend source (only setup instruction text)

## Screenshots Verified (off-market 17:35 IST)

- Home: India strip "No data", Global UNAVAILABLE, Breadth UNAVAILABLE — all correctly labeled
- Scanner: DEGRADED banner, 0/8,891 scanned, source 2026-08-05 (expected post-market)
- Option Chain: "Mixed sources · 26h ago", lot_size=25 (stale NSE), MARKET CLOSED badge
- F&O Cockpit: "Market opens at 09:15 IST", 0 live setups — correct
- Paper Trading (768px): Pack 32 CohortSelector visible in dev (F&O V2 Pending tab, "Analysis mode — automation suspended")

## What to Verify on Next Live Session

1. Cross-tab quote parity: NIFTY/BANKNIFTY/SENSEX same value across Home/Scanner/Option Chain at same Kite snapshot
2. Scanner row count recovery: confirms 8,841 rows appear during market hours (not 0)
3. Option chain lot_size: live Kite session returns NIFTY lot_size=65 for paper trade sizing
4. Gate 14: continuous 30-minute live observation during market hours

**Why:** The audit must be re-run in a live market window to close P34-P2-01 and P34-P2-03. The P34-P1-01 deployment drift closes when Pack 32 is published.
