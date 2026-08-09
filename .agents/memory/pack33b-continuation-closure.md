---
name: Pack 33B Continuation Closure (including Final Predeploy Corrections)
description: PROMPT_33B_CONTINUATION + PROMPT_33B_FINAL_PREDEPLOY_CORRECTIONS — all 10 sections + 5 blockers; Phase A performance; 3-dim data contract; generation atomicity; fnoBanList tri-state; Home false-zeros; DataSourceBadge freshness-only; classifier provisional disclosure; full battery PASS.
---

## Sections Implemented (ADDENDUM_33B)

### Section 1 — Three independent quality dimensions (scannerDataContract.ts)
- Types: `DataState`, `EvaluationState`, `Actionability`
- `computeScannerGrade()` computes all three independently from their own inputs
- 38 tests proving invariants (scannerDataContract.test.ts)
- INVARIANT: Phase A + READY_LIVE → NOT_ACTIONABLE (never TRADE_GRADE)

### Section E — Performance fix (Phase A enrichment skip)
- Cold Phase A scan: 1294.5s → 4.2s (308× improvement)
- Warm-cache: p50=26ms, p95=33ms

### Section F1 — Home false-zero: tradeSetups skip when bias is null
### Section 7 — Trust badge: fallbackUsed = actionability !== "TRADE_GRADE"
### Section 3 — Immutable generation identity (generationId, DISK_CACHE_V18)
### Sections 2/4/5/D — Classifier provenance + count reconciliation + Phase A banner

## Five Predeploy Blockers Fixed

### Blocker 1 — DataSourceBadge freshness-only
**Problem:** Badge showed "delayed" when evaluation locked (evaluation ≠ freshness).
**Fix:** DataSourceBadge status maps ONLY from dataState:
  READY_LIVE→live, READY_CLOSED/READY_PARTIAL→delayed, READY_STALE→stale, ERROR→down
  fallbackActive = kiteOffline only (not actionability)
**New UI:** Separate evaluation-state-indicator + actionability-indicator badges added below header
**Tests:** p33b.dataGradeIndicators.test.tsx — 23 tests (source + inline logic + invariants)

### Blocker 2 — Home false-zero and false-neutral
**Fixes in preMarket.ts:**
- classifySentiment(null) → null (not NEUTRAL); return type: Sentiment|null
- buildOvernightCues: score: number|null (null when no valid global inputs); catch returns null
- buildPostMarketDigest: null changePercent rows excluded from adv/dec/breadthScore/avgChange
  breadthScore/avgChangePercent/totalVolume are null when no valid data (not 0)
  narrative says "Breadth data unavailable" when breadthScore=null
  adRatio narrative uses "N/A" not "0" when adRatio missing
- PreMarketReportData.sentiment/sentimentScore now nullable
**Tests:** p33b.homeConsumers.test.ts — 30 tests (source guards + classifySentiment logic + buildDigest logic)

### Blocker 3 — F&O ban legacy false path
**Status:** No production callers of isFnoBanned/isFnoBannedLegacy exist.
  instFlows.ts uses getFnoBanList() directly and already handles null (available:false).
**Fix:** Reinforced isFnoBannedLegacy JSDoc: "TEST/COMPAT-ISOLATED ONLY — no production route may import"
**Tests:** p33b.fnoBanGuard.test.ts — 6 tests (import guard scanning all production files)

### Blocker 4 — Immutable generation behaviour
**Fix added:** Swap guard now checks countReconciliation.allValid — reconciliation failure prevents publication:
  `const reconciliationFailed = !next.countReconciliation.allValid`
  `if (!downgrading && !reconciliationFailed) cache = next`
  Logs warning when generation NOT published due to reconciliation failure.
**Tests:** p33b.generationSwap.test.ts — 12 tests (source guards + ID logic + dev trace)
**Dev trace:** before=null, during="gen-1786261246177-1", after="gen-1786261246177-1" (scanMs=4219, reconciliationValid=true)

### Blocker 5 — Eligibility status and disclosure
**Fix:** canaryStatus updated:
  FROM: "CANARY_BLOCKED"
  TO:   "CANARY_BLOCKED_AUTHORITATIVE_NSE_SECURITY_REFERENCE_REQUIRED"
Defect status: MITIGATED_PROVISIONALLY (not FIXED)
ClassifierProvenance.canaryStatus type updated accordingly.

## Final Battery (2026-08-09)
- api-server TSC: CLEAN
- scanner TSC: CLEAN
- global TSC: CLEAN
- 4-pkg TSC: ALL CLEAN
- api-server tests: **6,718 / 287 files** PASSED
- scanner tests: **1,273 / 53 files** PASSED
- git diff --check: CLEAN
- Scanner prod build: SUCCESS (9.41s)
- api-server prod build: SUCCESS (707ms)
- Skip/only audit: CLEAN
- Secret sentinel: CLEAN
- Provider import guard: CLEAN
- artifacts/global: UNTOUCHED

**Verdict:**
PROMPT_33B_PRODUCTION_DATA_SURFACE_AND_API_CONTRACT_IMPLEMENTED_IN_DEVELOPMENT — PREDEPLOY_ACCEPTANCE_REVIEW_REQUIRED
