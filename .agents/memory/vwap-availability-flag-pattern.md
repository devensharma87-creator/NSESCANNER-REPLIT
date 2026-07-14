---
name: VWAP availability flag pattern (vwapAvailable)
description: How to correctly handle zero-volume cash-index VWAP across indicators, confluence engine, and signal detectors.
---

## The problem
NIFTY/BANKNIFTY/SENSEX are cash-settled computed indices. Kite returns `volume=0` for every 15-min bar. Before P0-2, `sessionVwap` returned HLC3 (not null) for zero-volume bars, and `volumeProfile` returned a degenerate all-zero-bucket profile. Downstream code scored `spot ≈ spot` as "near institutional fair value" and cast systematic BEARISH votes from `spot > vwap` always being false.

## The fix pattern (2026-07-07)

### indicators.ts
- `sessionVwap`: returns `null` for every bar where cumVol=0. Series is entirely null for cash indices.
- `rollingVwap`: returns `null` when summed window volume=0.
- `volumeProfile`: returns `null` when totalVol≤0.

### Context flag
`buildContext` in `optionSignals.ts` sets `vwapAvailable = vwapRaw != null`.
This flag is passed to `Ctx`, to the `ConfluenceInputs`, and to the `OptionSignal` output field.

### Confluence engine
`scoreVwap(i)` short-circuits with `weight=0, polarity="neutral"` when `i.vwapAvailable === false`.

### Detectors
- `detectVwapReclaim`: `if (!c.vwapAvailable) return null` — hard-suppress; the setup IS the VWAP cross.
- `detectTrendContinuation`: VWAP-unavailable branch — EMA-stack-only, base conf 20 (vs 45), appends "VWAP data quality" driver.
- `detectBaselineOutlook`: 3-vote system (EMA21, EMA9stack, RSI) when unavailable (was 4-vote including vwap=spot, causing systematic BEARISH bias).
- `detectMeanReversion`: no change — dist=0 when vwap=spot → never fires naturally.
- `detectVolumeBreakout`: no change — `volumeProfile` now returns null → `if (!c.vp) return null` suppresses naturally.

## fullIndicators gate
`vwapRaw != null` was REMOVED from the `fullIndicators` warm-up gate. Zero-volume is a structural gap, not a warm-up gap — including it would suppress ALL detectors for index signals indefinitely.

**Why:** Structural unavailability must NOT be treated as warm-up. Gate individual detectors on the flag, not the full emission.

## API contract
`OptionSignal.vwapAvailable` (boolean, optional) added to openapi.yaml. After codegen, clients can gate VWAP display on this field.
