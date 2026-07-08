# P1B — MACD Warm-Up Fix Report
**Date:** 2026-07-08
**Status:** `P1B_MACD_WARMUP_FIX_DEV_VERIFIED`

---

## 1. Objective

Fix the zero-fill warm-up bug in the canonical NSE MACD signal EMA computation
(`artifacts/api-server/src/lib/indicators.ts`). The bug caused the signal EMA to
be trained on fake zeros during the MACD warm-up period, producing distorted early
histogram values for short-history and new-listing symbols.

---

## 2. Bug — Current Warm-Up Issue

### The Buggy Code (before fix)

```typescript
// indicators.ts lines 91-92 (before fix)
const macdNumeric = macdLine.map(v => v ?? 0);  // ← zero-fills ALL nulls
const sigLine = ema(macdNumeric, signalP);        // ← EMA trained on entire array
```

**What this does:**
- `macdLine` has nulls for bars 0–24 (slow EMA period = 26, so MACD is null until bar 25)
- `macdNumeric` replaces those 25 nulls with zeros
- `ema(macdNumeric, 9)` starts from bar 0, seeds with SMA of bars 0–8 = zeros → signal[8] = 0
- Signal stays zero through bar 24 (pure zero decay: signal[i] = signal[i-1] * 0.8 + 0 * 0.2 = 0)
- At bar 25 (first valid MACD): signal[25] = 0 * 0.8 + macd[25] * 0.2 = macd[25] × 0.2
- Histogram at bar 25 = macd[25] - macd[25] × 0.2 = macd[25] × **0.8** — falsely large/biased

**Correct behavior:** signal must be null until 9 valid MACD bars exist (bar 33). The histogram at bar 25 must be null, not a distorted value equal to 80% of the raw MACD line.

### Why it matters

For **short-history / new-listing symbols** with 26–34 bars of daily data (NSE new listings
rare but present in the 500-stock universe), the distorted signal/histogram can feed a wrong
±8-point scoring contribution via Scoring Rule 6. For **long-history symbols** (250+ bars),
the distortion from the first 17 zero-filled bars decays as 0.8^(250-8) ≈ 0 — negligible.

---

## 3. Files Audited

| File | Role | Has MACD? | Finding |
|---|---|---|---|
| `artifacts/api-server/src/lib/indicators.ts` | Canonical NSE MACD | ✅ | **BUGGY** — zero-fills nulls before signal EMA |
| `artifacts/api-server/src/lib/global/indicators.ts` | Global scanner MACD | ✅ | **CORRECT** — slices from first valid MACD |
| `artifacts/api-server/src/lib/scoring.ts` | NSE scoring Rule 6 | Consumes `macdHistSeries` | Unaffected for long-history; fixes score for 26–34 bar stocks |
| `artifacts/api-server/src/lib/scanner.ts` | NSE scanner compute | Calls `macd(closes)` | Short-listed symbols get null instead of distorted hist |
| `artifacts/api-server/src/lib/fullNseScanner.ts` | Pro Swing Scanner | Calls `macdSeries(closes)` | Guards `closes.length >= 30`; only last value used |
| `artifacts/api-server/src/lib/watchlist.ts` | Watchlist | References MACD | Commentary only — not a computation path |
| `artifacts/scanner/src/pages/deep-scan.tsx` | Frontend deep scan | Displays MACD | Display only — no computation here |
| `artifacts/scanner/src/components/home/index-expanded-panel.tsx` | Index panel | Displays MACD | Display only — no computation here |

### MACD Audit Table

| File | Function | Current MACD Warm-Up Behavior | Zero-Fills Nulls? | Consumer Impact | Fix Needed? |
|---|---|---|---|---|---|
| `indicators.ts` L91-92 | `macd()` canonical | `macdLine.map(v => v ?? 0)` → EMA of full array | ✅ YES | Distorted signal/hist for < 35-bar stocks | **YES — FIXED** |
| `global/indicators.ts` L66-74 | `macd()` global | Finds `startIdx`, slices from first valid MACD | No (slice discards zeros) | Correct | No |
| `scoring.ts` Rule 6 | `computeScore()` | Consumes `lastNonNull(macdHistSeries)` from canonical | N/A (consumer) | Gets corrected histogram after fix | N/A |
| `scanner.ts` | `computeIndicators()` | Calls canonical `macd(closes)` | N/A (consumer) | Short-listed stocks get null hist instead of distorted | N/A |
| `fullNseScanner.ts` | computes daily MACD | Calls canonical `macdSeries(closes)` | N/A (consumer) | Only `lastVal()` used; trivially correct for 250+ bars | N/A |

---

## 4. Files Changed

| File | Change | Scope |
|---|---|---|
| `artifacts/api-server/src/lib/indicators.ts` | Fixed `macd()` warm-up — replaced `macdLine.map(v => v ?? 0)` + full-array EMA with slice-from-startIdx approach matching `global/indicators.ts` | Indicator math only |
| `lib/indicators/src/index.ts` | Updated package comment — removed outdated note that api-server MACD "seeds the signal over zero-filled nulls"; now correctly states both implementations slice from the first real value (P1B 2026-07-08) | Comment only |
| `artifacts/api-server/src/lib/indicators.test.ts` | Added 57 new MACD warm-up regression tests across 12 fixture groups | Tests only |

---

## 5. The Fix

### Fixed Code (`indicators.ts`)

```typescript
export function macd(values: number[], fast = 12, slow = 26, signalP = 9): {
  macd: (number | null)[];
  signal: (number | null)[];
  hist: (number | null)[];
} {
  const e1 = ema(values, fast);
  const e2 = ema(values, slow);
  const macdLine: (number | null)[] = values.map((_, i) => {
    const a = e1[i];
    const b = e2[i];
    return a == null || b == null ? null : a - b;
  });
  // Signal line: seed the EMA only from the first valid MACD value.
  // Do NOT zero-fill nulls before the first valid MACD bar — that trains
  // the signal EMA on fake zeros and produces distorted early histogram
  // values for short-history / new-listing symbols.
  const startIdx = macdLine.findIndex(v => v !== null);
  const sigSeed = startIdx >= 0
    ? ema(macdLine.slice(startIdx).map(v => v ?? 0), signalP)
    : [];
  const sigLine: (number | null)[] = new Array(values.length).fill(null);
  if (startIdx >= 0) {
    for (let i = 0; i < sigSeed.length; i++) {
      sigLine[startIdx + i] = sigSeed[i] ?? null;
    }
  }
  const hist = macdLine.map((m, i) => {
    const s = sigLine[i];
    return m == null || s == null ? null : m - s;
  });
  return { macd: macdLine, signal: sigLine, hist };
}
```

**Pattern:** Identical to `global/indicators.ts` — find first valid MACD index, slice from there
before seeding the signal EMA. Output length is always equal to `values.length`.

---

## 6. Before / After MACD Warm-Up Behavior

Default periods: fast=12, slow=26, signalP=9

| Fixture | Old: First Valid MACD | Old: First Valid Signal | New: First Valid MACD | New: First Valid Signal | Expected Change |
|---|---|---|---|---|---|
| n=10 (very short) | Never (null) | Never (null) | Never (null) | Never (null) | No change — all null |
| n=26 (= slow) | Bar 25 (index 25) | Bar 8 (zero-seeded!) | Bar 25 (index 25) | Never (null) | **Bug fixed**: early signal removed |
| n=33 (MACD only) | Bar 25 | Bar 8 (zero-seeded!) | Bar 25 | Never (null) | **Bug fixed**: early signal removed |
| n=34 (just enough) | Bar 25 | Bar 8 (zero-seeded, distorted!) | Bar 25 | Bar 33 (correct) | **Bug fixed**: first correct signal at bar 33 instead of bar 8 |
| n=50 (medium) | Bar 25 | Bar 8 (distorted bars 8–32) | Bar 25 | Bar 33 (correct) | **Bug fixed**: bars 8–32 signal/hist now null |
| n=200 (long-history) | Bar 25 | Bar 8 (distortion washes out by bar 200) | Bar 25 | Bar 33 | Negligible change at last bar (0.8^167 ≈ 0 residual) |

**Key invariant after fix:** `firstValidSignal = (slow - 1) + (signalP - 1)` = 25 + 8 = **33** for default periods.

---

## 7. Consumer Impact

| Consumer | Uses MACD? | Impact From Fix | Trading Logic Changed? |
|---|---|---|---|
| `scoring.ts` Rule 6 (weight ±8) | `lastNonNull(macdHistSeries)` | Short-history stocks (26–34 bars): Rule 6 now returns 0 (null) instead of distorted ±8. Long-history: no observable change. | No — weight unchanged, threshold unchanged |
| `scanner.ts` NSE 280-stock universe | `macdHistSeries` + last/prev values | Same as scoring: new listings in warm-up get null instead of distorted score | No |
| `fullNseScanner.ts` Pro Swing Scanner | `lastVal(m.hist)` | `closes.length >= 30` guard; only last bar; long-history only — no change | No |
| F&O signal pipeline (`optionSignals.ts`) | ❌ Not used | MACD does not feed F&O confluence engine | No |
| Paper trade open/close logic | ❌ Not used | Not in the execution path | No |
| Account balance / realized P&L | ❌ Not used | No | No |
| Backtest / replay | ❌ Not directly | MACD is a display/scoring indicator | No |

**Expected scoring drift for short-history symbols:**
Stocks with exactly 26–34 daily bars (new NSE listings) will see MACD Rule 6 contribute 0
instead of a distorted ±8 score. This is the correct behavior. These are edge-case new listings;
NIFTY 500 incumbents all have 250+ bars. This drift is acceptable and expected — documented here
as required by the prompt.

---

## 8. Confirmation: No Trading Logic / Weights / Thresholds Changed

✅ No F&O signal thresholds changed
✅ No swing thresholds changed
✅ No detector weights changed
✅ No entry logic changed
✅ No exit logic changed
✅ No SL/target formula changed
✅ No account balance logic changed
✅ No realized P&L logic changed
✅ No paper-trade open/close logic changed
✅ No DB/schema migration
✅ No historical trade rewrite
✅ No broker execution
✅ No real orders
✅ No Telegram messages
✅ No market shadow coupling
✅ No stale/report-grade data driving live trades
✅ Scoring Rule 6 weight (±8) unchanged — only the histogram input is now correct

---

## 9. Tests

### Test Table

| Test Group | Purpose | Expected Result |
|---|---|---|
| Fixture 1 (n=10, very short) | All null — below slow EMA warm-up | All macd/signal/hist null ✅ |
| Fixture 2 (n=26, = slow) | MACD valid, signal still null | macd[25] non-null, signal all null ✅ |
| Fixture 3 (n=33, MACD only) | 8 valid MACD bars, not enough for signal | signal all null, hist all null ✅ |
| Fixture 4 (n=34, minimum signal) | First valid signal at bar 33; null before 33 | signal[33] non-null, signal[0..32] null ✅ |
| Fixture 5 (flat, n=50) | Zero-seed regression: signal null before bar 33 | signal/hist null before index 33, MACD ≈ 0 ✅ |
| Fixture 6 (rising, n=50) | Distortion test: signal[25] must be null | signal[25] null (not macd[25]×0.2) ✅ |
| Fixture 7 (long, n=200) | Stability for long-history symbols | All arrays length 200, last hist finite, hist = macd - signal ✅ |
| Fixture 8 (choppy, n=100) | Mixed series correctness | All values finite where non-null, correct first-valid indices ✅ |
| Fixture 9 (custom periods fast=3 slow=5 sig=3) | Hand-verifiable SMA seed | signal[6] = SMA(macd[4..6]); signal[4,5] null ✅ |
| Fixture 10 (empty) | Edge case | Returns three empty arrays without throwing ✅ |
| Canonical vs Global alignment | Both conventions match after fix | firstNonNull(signal) = slow-1 + signalP-1 ✅ |
| Output-shape invariant (9 cases) | Length always preserved | Arrays always match input length for n=0,1,10,25,26,33,34,50,100 ✅ |

### Exact Test Counts

| Suite | Files | Tests | Duration | Result |
|---|---|---|---|---|
| `indicators.test.ts` + `indicatorsShared.test.ts` | 2 / 2 | **83 / 83** | 1.46s | ✅ PASS |
| All indicator/scanner/swing tests (16 files) | 16 / 16 | **336 / 336** | 24.68s | ✅ PASS |
| Scanner vitest full suite | 35 / 35 | **770 / 770** | 10.05s | ✅ PASS |
| `api-server typecheck` | — | 0 errors | — | ✅ PASS |
| `scanner typecheck` | — | 0 errors | — | ✅ PASS |
| `verify:release` | — | **11 / 11** | — | ✅ PASS |
| LLM index check | — | **350 / 350** fresh | — | ✅ PASS |

**New MACD tests added:** 57 (83 total − 26 pre-existing = 57 new)

---

## 10. Final Verdict

**`P1B_MACD_WARMUP_FIX_PROD_VERIFIED`**

The zero-fill bug in canonical NSE MACD warm-up is confirmed fixed and live in
production. Signal EMA is seeded only from the first valid MACD value, matching
the global implementation and standard financial library behavior.
See "Production Verification" section below.

---

## Production Verification — 2026-07-08

### Part A — Fresh Deploy Proof

| Check | Detail | Result |
|---|---|---|
| HTTP 200 on `/api/build-info` | — | ✅ 200 OK |
| `commitShort` after MACD fix `f224e41` | `8f41f811` ← prod commit | ✅ Confirmed |
| Production no longer shows old P1A STT commit `64337231` | Different commit confirmed | ✅ Confirmed |
| `buildTime` | 2026-07-08T13:07:44.329Z | ✅ After publish |
| `bootTime` | 2026-07-08T13:09:39.402Z | ✅ After publish |
| `environment` | `production` | ✅ |
| All 7 checkpoint markers | `checkpoint1/2/2_5/3`, `dataParityApi`, `reportGradeFacade`, `providerImportCompat` = `true` | ✅ All true |
| No secrets exposed | No tokens/keys in response | ✅ |
| `verify:release` | **11 / 11 PASS** | ✅ |

**Commit ordering (git log):**
```
9ec9413  Published your App                                    ← HEAD (live)
8f41f81  Update verification summary                          ← prod commit
f224e41  Fix MACD calculation for short-history symbols       ← MACD fix commit
e64a1c2  Update financial reports
3336b8b  Update F&O cockpit STT fix
cdd0fa3  Update STT label fix
```
Production commit `8f41f811` is AFTER MACD fix `f224e41` → fix is live.

### Part B — Production Code Proof

`indicators.ts` is server-side Express code — it is NOT bundled into the frontend JS.
Proof via source verification + commit ordering:

| Production Proof Item | Expected | Result |
|---|---|---|
| Full-array zero-fill `macdLine.map(v => v ?? 0)` feeding EMA | Absent | ✅ Absent — confirmed via grep |
| `startIdx = macdLine.findIndex(v => v !== null)` | Present (line 95) | ✅ Confirmed |
| `ema(macdLine.slice(startIdx).map(v => v ?? 0), signalP)` | Present (line 97) | ✅ Confirmed |
| Null padding: `sigLine[startIdx + i] = sigSeed[i] ?? null` | Present (line 102) | ✅ Confirmed |
| Histogram waits for valid signal: `m == null \|\| s == null ? null : m - s` | Present | ✅ Confirmed |
| Output length = input length: `new Array(values.length).fill(null)` | Present (line 102) | ✅ Confirmed |
| Production deploy includes MACD fix commit `f224e41` | `8f41f811` > `f224e41` in git log | ✅ Confirmed |

### Part C — Functional Production Verification

Server-side code verified via source + commit ordering. No dedicated MACD diagnostic
endpoint exists in production — functional verification is covered by:
- 57 MACD regression tests in `indicators.test.ts` (all passing against fixed code)
- Source inspection confirms fix is deployed

| Fixture | Expected | Result |
|---|---|---|
| n=10 | MACD/signal/hist all null | ✅ (test-verified) |
| n=26 | MACD[25] valid, signal null (no zero-seeded fake signal) | ✅ (test-verified) |
| n=33 | MACD 8 valid bars, signal/hist null | ✅ (test-verified) |
| n=34 | First valid signal at bar 33, null before | ✅ (test-verified, hand-verified SMA seed) |
| n=50 | Bars 25–32 correctly null for signal/hist | ✅ (test-verified) |
| n=200 | Long-history last-bar impact negligible (0.8^167 ≈ 0) | ✅ (test-verified) |

### Part D — Impact Confirmation

**This fix changes MACD histogram/scoring behavior for short-history / new-listing symbols.
This is expected and correct — it is an indicator-correctness change, not a trading-rule change.**

| Consumer | Uses MACD? | Production Impact | Trading Rule Changed? |
|---|---|---|---|
| `scoring.ts` Rule 6 (weight ±8) | `lastNonNull(macdHistSeries)` | New listings < 35 bars: Rule 6 now correctly returns 0 (null hist) instead of distorted ±8. 250+ bars: no change. | No |
| `scanner.ts` NSE 280-stock | `macdHistSeries` → scoring | Same as above — edge-case new listings only | No |
| `fullNseScanner.ts` Pro Swing | `lastVal(m.hist)` | 250+ bar stocks only → no change | No |
| F&O signal pipeline | ❌ Not used | Zero impact | No |
| Paper trade open/close | ❌ Not used | Zero impact | No |
| Account balance / realized P&L | ❌ Not used | Zero impact | No |
| Frontend MACD display | Display only | Null displays as "—" — no UI component change needed | No |

### Part E — Safety / Regression Checks

| Prior Milestone | Status |
|---|---|
| `RELEASE_INTEGRITY_PROD_VERIFIED` | ✅ verify:release 11/11 PASS |
| `BACKTEST_CHARGES_MODEL_NET_PNL_PROD_VERIFIED` | ✅ Unchanged |
| `FNO_COST_MODEL_UNIFICATION_PROD_VERIFIED` | ✅ Unchanged |
| `FNO_VWAP_VOLUME_PROFILE_HONESTY_PROD_VERIFIED` | ✅ Unchanged |
| `FNO_TRIGGER_WORDING_SEMANTICS_PROD_VERIFIED` | ✅ Unchanged |
| `KITE_OI_UNIT_VERIFICATION_CONFIRMED_CORRECT` | ✅ Unchanged |
| `P1A_PAPER_TRADING_GROSS_NET_DISPLAY_PROD_VERIFIED` | ✅ Unchanged |
| `EXIT_PREMIUM_MARKET_SHADOW_PROD_INFRA_VERIFIED_LIVE_SAMPLE_PENDING` | ✅ Unchanged |
| `POST_P0_SIGNAL_SYSTEM_REBASELINE_PARTIAL_GAP_REMAINS` | ✅ Unchanged |
| No broker execution | ✅ |
| No real orders | ✅ |
| No Telegram messages | ✅ |
| No DB/schema migration | ✅ |
| No account balance change | ✅ |
| No realized P&L change | ✅ |
| No historical trade rewrite | ✅ |
| Stale/report-grade data cannot drive live trades | ✅ |

### Part F — Tests (Production Verification Run)

| Suite | Files | Tests | Result |
|---|---|---|---|
| `verify:release` | — | **11 / 11** | ✅ PASS |
| `api-server typecheck` | — | **0 errors** | ✅ PASS |
| `typecheck:libs` | — | **0 errors** | ✅ PASS |
| `indicators.test.ts` + `indicatorsShared.test.ts` | **2 / 2** | **83 / 83** | ✅ PASS |
| Indicator + scanner + swing (16 files) | **16 / 16** | **336 / 336** | ✅ PASS |
| `scanner typecheck` | — | **0 errors** | ✅ PASS |
| Scanner vitest full suite | **35 / 35** | **770 / 770** | ✅ PASS |
| LLM index | — | 350 files | ✅ Fresh |
| LLM index check | — | **350 / 350** | ✅ PASS |

### Final Verdict

**`P1B_MACD_WARMUP_FIX_PROD_VERIFIED`**

Production commit `8f41f811` (after MACD fix `f224e41`) is live. Source code confirmed:
`startIdx`-based slicing is present, full-array zero-fill is absent. No accounting,
signal, trading, or gate logic changed. All prior P0/P1 milestones remain verified.

---

## Pending Items (not in P1B scope)

| Item | Status |
|---|---|
| P1C — NSE holiday calendar | Audited — low priority maintenance |
| P1D — Equity gap-through exit | **Requires explicit owner sign-off** — changes realized P&L |
| P1E — Charting professional | Phased separately |
| EXIT_PREMIUM_MARKET_SHADOW full verification | Pending first live F&O exit post-deploy |
| POST_P0_SIGNAL_SAMPLE_REVIEW | Pending ≥20 post-P0 signals |
