---
name: Pack 25B closure
description: Prompt 25B omitted-gate and performance-truth closure — 2 source fixes, 125 new tests, all 6 gates closed.
---

# Prompt 25B — Omitted-Gate and Performance-Truth Closure

**Date:** 2026-08-05 | **Status:** COMPLETE

## Key verdicts
- **Gate 1:** NET_VS_SEED is an account-reconciliation metric; trade-attributed P&L is the headline. Source fix: label changed to "balance only, not strategy P&L"; stat moved to last in Section A grid.
- **Gate 2:** HDFCBANK ~₹1,920 staged order verdict = `STALE_OR_EXPIRED_STAGE`. DB table empty (dev). Admission gate tests formalise 5-check rule: expiry → instrument identity → CA risk → null provenance → quote-age/price-drift.
- **Gate 3:** OI Lab `bufLen=0` now shows "No snapshots buffered — falling back to broker since-open Δ" inline (not tooltip-only).
- **Gate 4:** All count arithmetic invariants pass: `available + unavailable ≤ configured`, breadth denominator = available, Sensex 29/30 reconciles correctly.
- **Gate 5:** MARICO probe = NOT_REPRODUCED (no category field in NewsItem). Score ordering correct (STRONG_BUY≥50 > BUY≥22). GODREJPROP/GODREJCP full names present. R:R "2R target / structure cap" already labeled.
- **Gate 6:** GIFT NIFTY separation, IST single-shift, PCR scope labels, Bull Call Spread payoff invariant — all VALID_DIFFERENT_SCOPE with executable proof.

## Test counts
- Scanner: 1,210 (was 1,176; +34 from Gate 3/4 tests in p25b.gate3and4.chartStatesAndCounts.test.tsx)
- API server: 5,673 (was 5,603; +91 from 3 new files: gate1 9 tests, gate2 12 tests, gate5and6 70 tests)

## Source files changed
- `artifacts/scanner/src/pages/paper-trading.tsx` — NET_VS_SEED reordered + label updated
- `artifacts/scanner/src/pages/oi-lab.tsx` — bufLen=0 inline text

## Why
netVsSeed includes capital deposits (₹8L deposited; only ₹15k from trades) — it cannot serve as a strategy-performance headline without clear labelling. OI Lab tooltip-only state message didn't satisfy "No snapshots buffered must be explicit."

**How to apply:** Any future stat that includes capital movements (deposits/withdrawals) must be labeled "balance only, not strategy P&L" and positioned after trade-attributed metrics in the card grid.
