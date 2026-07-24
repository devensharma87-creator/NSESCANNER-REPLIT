---
name: VP quarantine pattern — D-FAB-03/D-FAB-04
description: How "Above/Below POC" was quarantined from the index F&O decision path, and why C0 tests must use readFileSync.
---

## The rule
Remove VP-derived directional checks (`if (c.vp && ...)`) from the `!vwapAvailable` branch of any detector. This branch is the structural cash-index path (NIFTY/BANKNIFTY/SENSEX). When adding new detectors or modifying existing ones in `optionSignals.ts`, VP must NOT contribute directional points or target widening inside `if (!c.vwapAvailable)` blocks.

## Why
Cash indices have zero exchange volume from the Kite feed. `volumeProfile()` already returns `null` when `totalVol <= 0` (D-FAB-01, applied 2026-07-24). But the `if (c.vp && c.spot > c.vp.pointOfControl) { conf += 8 }` checks in the `!vwapAvailable` branch were structurally defective: any future data anomaly (OI misread as volume, provider change) would silently re-activate ±8 directional bias and widen targets without any other code change. The quarantine closes this at the decision boundary.

## How to apply
- Any new detector inside `if (!c.vwapAvailable)` must NOT reference `c.vp`, `c.vpIntraday`, `c.vp?.valueAreaHigh`, or `c.vp?.valueAreaLow` for confidence scoring or target calculation.
- Lines 767/775 of optionSignals.ts (VWAP-available path, equity stocks) ARE correct — VP IS trustworthy there. Do not remove those.
- `confluenceEngine.ts::scoreVolumeProfile` null-guards at line 160 (weight=0 for null VP) — already correct for indices since `i.vp = ctx.vpIntraday = null` for indices. No change needed there.

## C0 tests must use readFileSync
`paperTradingFO.ts` and `paperTradingEq.ts` have `setInterval` and DB-init side effects at module top level. Dynamic `import("./paperTradingFO")` in vitest causes a 5-second timeout. Use `readFileSync` to check the constant text in source instead:
```typescript
const src = readFileSync(resolve(__dirname, "paperTradingFO.ts"), "utf-8");
expect(src).toMatch(/export const FNO_AUTO_OPEN_C0_BLOCKED\s*=\s*true/);
```
