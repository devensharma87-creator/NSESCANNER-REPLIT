# P0-2 Zero-Volume VWAP / Volume Profile Honesty Fix
**Status:** `FNO_VWAP_VOLUME_PROFILE_HONESTY_DEV_VERIFIED`
**Date:** 2026-07-07

---

## Problem Statement

NIFTY, BANKNIFTY and SENSEX are **cash-settled computed indices** — Kite returns
`volume = 0` for every bar. The codebase was fabricating indicator values from
zero-volume data and using them as if they were real:

| Bug | Old behaviour | Root cause |
|-----|---------------|------------|
| `sessionVwap` | Returned HLC3 when cumVol = 0 | Computed `pv / v` without guarding `v === 0` |
| `rollingVwap` | Returned close-price proxy when v = 0 | Same pattern |
| `volumeProfile` | Returned a degenerate all-zero-bucket profile | Missing `totalVol ≤ 0` guard |
| `detectBaselineOutlook` | `spot > vwap` always false (vwap = spot placeholder) → +1 unconditional BEARISH vote | 4-vote system included the zero-volume VWAP placeholder |
| `confluenceEngine.scoreVwap` | Scored `spot ≈ vwap` as "near institutional fair value" | No gate on `vwapAvailable` |
| `detectTrendContinuation` | Emitted with a ±25-pt VWAP confidence driver from fabricated data | No gate on `vwapAvailable` |
| `detectVwapReclaim` | Could emit a VWAP_RECLAIM cross from all-null series | No gate on `vwapAvailable` |
| `OptionSignal` output | No `vwapAvailable` field — clients could not distinguish real from fabricated VWAP | Missing from OpenAPI spec |

---

## Fix Summary

### `indicators.ts` — root cause fixes
- **`sessionVwap`**: Returns `null` for every bar whose cumulative volume is still 0. The entire series is `null` for cash indices — callers check the flag, not the value.
- **`rollingVwap`**: Returns `null` when the summed volume over the window is 0. Never returns close/HLC3.
- **`volumeProfile`**: Returns `null` when `totalVol ≤ 0`. Degenerate all-zero-bucket profiles are now rejected at source.

### `confluenceEngine.ts` — propagation fix
- **`ConfluenceInputs.vwapAvailable?: boolean`** added to the interface.
- **`scoreVwap`**: When `vwapAvailable === false`, immediately returns `{ weight: 0, polarity: "neutral" }` with an honest detail string. The VWAP factor contributes zero to `adjustedConfidence`.

### `optionSignals.ts` — propagation fixes
- **`Ctx.vwapAvailable: boolean`** added to the shared market context.
- **`buildContext`**: `vwapAvailable = vwapRaw != null`. Removed `vwapRaw != null` from the `fullIndicators` warm-up gate (structurally unavailable ≠ not-yet-warm).
- **`detectTrendContinuation`**: New VWAP-unavailable branch — degrades to EMA-stack-only with base confidence 20 (vs 45 with VWAP). Appends a "VWAP data quality" driver on the signal card. The ±25-pt fabricated VWAP confidence driver is omitted.
- **`detectVwapReclaim`**: Hard-suppressed (`return null`) when `!vwapAvailable`. The "reclaim" IS the VWAP cross — without real VWAP there is no cross to detect.
- **`detectMeanReversion`**: No change needed. When `vwapAvailable=false`, `effectiveVwap = spot` → dist = 0 → `extendedUp` and `extendedDn` are both false → detector returns `null` naturally.
- **`detectVolumeBreakout`**: No change needed. `volumeProfile` now returns `null` for zero-volume data → `if (!c.vp) return null` at detector start naturally suppresses it.
- **`detectBaselineOutlook`**: 3-vote system (EMA21, EMA9vsEMA21, RSI) when `!vwapAvailable` — eliminates the systematic false BEARISH vote from `spot > spot` (always false). Base confidence reduced to 30 (from 35) to reflect one fewer information source.
- **Signal output**: `vwapAvailable: c.vwapAvailable` added to every emitted `OptionSignal`. `confluenceInputs` passes `vwapAvailable: ctx.vwapAvailable` to the engine.
- **Comment fixed**: Wrong comment about `volumeProfile` returning a "degenerate profile" corrected to document the actual null-return behaviour.

### `lib/api-spec/openapi.yaml` — contract fix
- `OptionSignal.vwapAvailable` (boolean, optional) added with an honest description. Ran `pnpm --filter @workspace/api-spec run codegen` — types regenerated cleanly.

---

## Tests Written

| File | Tests | Covers |
|------|-------|--------|
| `indicators.test.ts` (new) | 15 | `sessionVwap`, `rollingVwap`, `volumeProfile` zero-volume guard; null-return invariants; degenerate-value regression traps |
| `confluenceEngine.vwapGuard.test.ts` (new) | 7 | `scoreVwap` weight=0 when `vwapAvailable=false`; honest detail; no spurious confidence boost; backward-compat when `vwapAvailable` omitted |
| `optionSignals.zeroVolume.test.ts` (new) | 14 | Schema field presence; 3-vote vs 4-vote direction logic; VWAP_RECLAIM hard-suppress; EMA-stack-only confidence arithmetic; vp null → detector suppression chain |
| `optionSignals.vwapLabel.test.ts` (existing) | — | Pre-existing driver-label invariants (all passing) |

**Total new tests: 36. All 41 P0-2 tests pass. Full typecheck clean.**

---

## Invariants Enforced (Post-Fix)

1. **`sessionVwap` null contract**: Every bar with `cumVol = 0` returns `null`. The series is entirely `null` for cash indices.
2. **`rollingVwap` null contract**: Returns `null` when window volume is 0. Never returns HLC3 or close as a VWAP proxy.
3. **`volumeProfile` null contract**: Returns `null` when `totalVol ≤ 0`. No degenerate bucket profiles.
4. **`confluenceEngine` weight-0 contract**: `scoreVwap` returns `weight=0, polarity=neutral` when `vwapAvailable=false`. Cannot silently boost/suppress adjusted confidence.
5. **`detectVwapReclaim` suppression contract**: Returns `null` unconditionally when `vwapAvailable=false`. No VWAP_RECLAIM signal emitted for cash indices.
6. **`detectBaselineOutlook` vote-system contract**: Uses 3 votes (EMA21, EMA9stack, RSI) when `vwapAvailable=false`. Zero systematic BEARISH bias from `spot == vwap` placeholder.
7. **`OptionSignal.vwapAvailable` contract**: Field present and boolean on every emitted signal. Clients can gate VWAP display on this flag.

---

## What Did NOT Change

- **Trading logic, sizing, DD caps, heat, paper-trader gate sequence** — zero changes.
- **Signal emission floor** (`MIN_FNO_TRADE = 65`) — unchanged. The lower confidence in VWAP-unavailable detectors may suppress some previously-emitted low-confidence signals; this is correct behaviour, not a regression.
- **`detectMeanReversion` and `detectVolumeBreakout`** — no code changes needed; fixed naturally by upstream null contracts.
- **Any existing signal, paper trade, or backtest run** — no retroactive changes.

---

## Test Command

```bash
pnpm --filter @workspace/api-server exec vitest run --pool=threads \
  "src/lib/indicators.test.ts" \
  "src/lib/confluenceEngine.vwapGuard.test.ts" \
  "src/lib/optionSignals.zeroVolume.test.ts" \
  "src/lib/optionSignals.vwapLabel.test.ts"
# → 4 test files, 41 tests, all passed
```
