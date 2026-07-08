---
name: MACD signal warm-up — canonical now matches global
description: P1B fix — both indicators.ts MACD copies now slice from startIdx before signal EMA; behavioral details and post-fix baseline rules.
---

## The Rule

Both `artifacts/api-server/src/lib/indicators.ts` and `artifacts/api-server/src/lib/global/indicators.ts` now use the same correct warm-up approach for MACD signal EMA:
1. Find `startIdx = macdLine.findIndex(v => v !== null)` (first valid MACD bar = slow-1 = 25 for default periods)
2. Slice from `startIdx` before passing to the signal EMA
3. Place signal results back at offset `startIdx` in a null-padded output array
4. Signal first valid at `(slow-1) + (signalP-1)` = 33 for default (12,26,9)

**Why:** The old canonical code did `macdLine.map(v => v ?? 0)` then `ema(full_array, signalP)`, training the signal EMA on 25 leading zeros. At bar 25 (first valid MACD), the signal was `macd[25] × 0.2` (not null), and the histogram was `macd[25] × 0.8` — falsely biased, not a real cross.

**How to apply:**
- Any future MACD signal analysis should treat P1B (2026-07-08) as the new baseline
- New NSE listings with < 35 daily bars now return null MACD histogram instead of a distorted value
- Long-history symbols (250+ bars) are unaffected — distortion decays as 0.8^(250-8) ≈ 0
- The `@workspace/indicators` package comment has been updated to reflect the alignment
- 57 MACD regression tests in `indicators.test.ts` lock this behavior
