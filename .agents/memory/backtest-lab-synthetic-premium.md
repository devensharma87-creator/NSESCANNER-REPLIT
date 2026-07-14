---
name: Backtest Lab — real vs synthetic option premiums
description: SNAPSHOT_PREMIUM_REPLAY (Stage 4) ships real premium replay for DIRECTIONAL runs. Strategy Research still uses the synthetic delta-proxy layer.
---

# Backtest Lab — real vs synthetic option premiums

## SNAPSHOT_PREMIUM_REPLAY (Stage 4, shipped)
The DIRECTIONAL backtest mode now has a `SNAPSHOT_PREMIUM_REPLAY` path that prices
trades from real `option_chain_snapshot` rows (LTP → mid → BS-from-IV priority).
Every ₹ is traceable or loudly flagged as UNAVAILABLE. Coverage gate: if <60% of
trades can be priced, a LOW COVERAGE warning is emitted. Cost model uses real NSE
rates effective 2026-04-01 (STT 0.05% sell, stamp 0.003% buy, exchange 0.053%, etc.).

The key files:
- `artifacts/api-server/src/lib/backtest/premiumReplay.ts` — pure pricer (BS, costs, coverage)
- `artifacts/api-server/src/lib/backtest/snapshotPremiumBacktest.ts` — DB-backed runner
- `artifacts/api-server/src/routes/backtest.ts` — SNAPSHOT_PREMIUM_REPLAY branch

## Strategy Research still uses the synthetic layer
- premium ≈ fixed ~0.40% of spot, fixed ~0.50 delta, no theta/no IV
- This is an honest label limitation in the Strategy Research lane only
- A separate "Strategy Research premium labelling" task is needed if that mode should also get real premiums

**Why the lanes are separate:** SNAPSHOT_PREMIUM_REPLAY only works with the
DIRECTIONAL signal engine (it uses captured option-chain snapshots that align with
directional signal timestamps). Strategy Research generates its own synthetic trades
on real spot candles and has no corresponding snapshot anchor.

**How to apply:**
- For DIRECTIONAL / Official Engine runs: use SNAPSHOT_PREMIUM_REPLAY
- Strategy Research synthetic premiums: still a deferred audit item
- Full deferred spec for Strategy Research: `docs/backtest-lab-rectification-backlog.md`
  (37.5% vs 30% stop mismatch, missing export columns, etc.)
