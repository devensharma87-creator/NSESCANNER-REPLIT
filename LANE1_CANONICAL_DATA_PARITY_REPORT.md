# Lane 1: P0 Canonical Data Parity + Contract Master
## Fix Report — 2026-07-09

**Status: DEV_VERIFIED**
**Tests: 30 new acceptance + 88 regression = 118 total. All pass.**
**Typecheck: green. Codegen: green.**

---

## Executive summary

Three bugs found by the forensic audit were fixed in this session. All three are in the server-layer data pipeline; none touches trading logic, paper-trade execution, risk gates, or the DB schema.

| # | Bug | Severity | Status |
|---|---|---|---|
| BUG-1 | MIDCAP proxy level scale mismatch | P0 | FIXED_DEV_VERIFIED |
| BUG-2 | F&O signal spotChangePercent vs open, not prevClose | P0 | PARTIAL_FIX (server layer complete) |
| BUG-3 | Strike step static map overrode live instrument master | P0 partial | PARTIAL_FIX improved |

---

## BUG-1: MIDCAP proxy level scale mismatch

### Confirmed root cause

`MIDCPNIFTY` in `INSTRUMENTS` is configured with `yahoo: "NIFTY_MID_SELECT.NS"` (live price) and `yahooDaily: "^NSEMDCP50"` (daily history proxy). The proxy comment stated "The two midcap baskets historically track within ~1%." **This was structurally false.**

- `^NSEMDCP50` (Nifty Midcap 50): trades at ~17 845
- `NIFTY_MID_SELECT.NS` (Nifty Midcap Select): trades at ~14 618
- Scale gap: **22.1%** — a permanent, structural divergence between two different indices

`buildItem()` computed EMAs (9/20/50/100/200), floor pivots (P, S1, S2, S3, R1, R2, R3), 52-week high/low, and previous session OHLC from the proxy basket's price series. The live LTP and change% were correctly overridden by Kite (Kite path was fine), but all level analytics were at the wrong scale:

- EMA50 shown: ~17 800 (proxy scale) → live index: ~14 618 → 22% error
- Pivot shown: ~17 900 area → level-based trade anchor is wrong
- 52W high: reflects ^NSEMDCP50 extrema, not MIDCAP SELECT extrema

### Fix

`artifacts/api-server/src/lib/indicesBoard.ts` — `buildItem()`:

**Step 1**: Declare `let proxyPrevClose: number | undefined` before the daily block. Inside the `if (prevIdx != null)` block, when `cfg.yahooDaily && cfg.yahooDaily !== cfg.yahoo`, capture the proxy basket's prevClose before any live override:
```typescript
if (cfg.yahooDaily && cfg.yahooDaily !== cfg.yahoo && c != null) {
  proxyPrevClose = round(c, 4);
}
```

**Step 2**: After the Kite live override (which sets `item.prevClose` to the live index's previousClose), compute the scale gap:
```typescript
const scaleGapPct = Math.abs(proxyPrevClose - item.prevClose) / item.prevClose * 100;
if (scaleGapPct > 1.0) {
  item.proxyLevelBlocked    = true;
  item.proxyLevelBlockReason = `proxy ${cfg.yahooDaily} scale gap ${scaleGapPct.toFixed(1)}% vs ${cfg.yahoo} — level analytics suppressed`;
  // Null out all 13 price-level fields
  item.ema9 = item.ema20 = item.ema50 = item.ema100 = item.ema200 = undefined;
  item.pivot = undefined;
  item.support = []; item.resistance = [];
  item.fiftyTwoWeekHigh = item.fiftyTwoWeekLow = undefined;
  item.prevOpen = item.prevHigh = item.prevLow = undefined;
  item.notes.push(`proxy blocked: level scale mismatch (${scaleGapPct.toFixed(1)}% gap — ${cfg.yahooDaily} ≠ ${cfg.yahoo})`);
}
```

**Intentionally preserved** (computed from live data, not proxy):
- `change` / `changePercent` — derived from live `ltp` vs live `prevClose` (after Kite override)
- `prevClose` — already overridden to live index previousClose by Kite
- `vwap` / `poc` / `vah` / `val` — from live intraday bars (not daily proxy)
- `ltp` / `open` / `high` / `low` — from Kite live feed

### New interface fields

```typescript
// IndexBoardItem
proxyLevelBlocked?: boolean;
proxyLevelBlockReason?: string;
```

### Threshold rationale

1% is chosen because:
- The two Midcap baskets co-move within 0–1% under normal conditions (component overlap)
- The current structural gap (~22%) is permanent, not a transient market event
- Any gap > 1% between a proxy basket and the live underlying invalidates level-based analytics for trade decisions
- False positive risk at 1% threshold: essentially zero for the current MIDCAP SELECT / Midcap 50 pairing

### What this does NOT change

- Live LTP, change%, VWAP are correct for all indices including MIDCPNIFTY
- No trading logic, signal, paper-trade, or risk gate is touched
- `yahooDaily` config is unchanged — it is still used for dimensionless indicators (IVR/IVP computed from IV series) which do not depend on absolute price level

---

## BUG-2: F&O signal spotChangePercent uses open as baseline, not prevClose

### Confirmed root cause

In `optionSignals.ts`, the `buildContext()` function computed:
```typescript
sessionChangePct: ((spot - open0) / open0) * 100
```
and the emission mapped this directly to `spotChangePercent`:
```typescript
spotChangePercent: round2(c.sessionChangePct),
```

`open0` is the index's opening price for the current session. Market convention for "change%" displayed on an index card is `(spot − prevClose) / prevClose × 100`. The two quantities diverge after the open tick and can differ by 1–3% on volatile sessions (e.g., after a 1% gap-up open, the session-change and day-change differ by the full gap).

This affected:
- Every `OptionSignal` card (index section showing spot change)
- Any downstream consumer of the `spotChangePercent` field

### Fix

`artifacts/api-server/src/lib/optionSignals.ts`:

**Ctx interface**: Add `prevClose: number | null`:
```typescript
/** Previous completed session's daily close. Null when daily series < 2 bars. */
prevClose: number | null;
```

**buildContext()**: Compute from `daily.close[dn - 2]` — the second-to-last bar in the daily series, which is the previous completed session (consistent with the `pivotsR3` reference frame that uses the same index):
```typescript
const prevClose: number | null = dn >= 2 && daily.close[dn - 2] != null
  ? (daily.close[dn - 2] as number)
  : null;
```

**Emission** (alongside the existing `spotChangePercent`):
```typescript
spotChangePctVsPrevClose: (c.prevClose != null && c.prevClose > 0)
  ? round2((c.spot - c.prevClose) / c.prevClose * 100)
  : undefined,
spotPrevClose: c.prevClose != null ? round2(c.prevClose) : undefined,
```

### Why `spotChangePercent` was not renamed

`spotChangePercent` (vs open) is used internally by detectors:
- The BULLISH/BEARISH direction flip logic reads `sessionChangePct` to decide which direction has momentum
- Renaming or changing its semantics would require auditing all 8+ setup detectors

The new `spotChangePctVsPrevClose` is the correct field for display. Frontend consumers showing change% to users should migrate to `spotChangePctVsPrevClose` in a subsequent frontend pass (Lane 2).

### Deferred

Frontend migration: the F&O signal card in `artifacts/scanner` currently renders `spotChangePercent`. Updating the display to use `spotChangePctVsPrevClose` is a frontend-only change, deferred to Lane 2 / frontend pass to keep this fix narrowly scoped.

---

## BUG-3: Strike step static map overrode live instrument master

### Confirmed root cause

In `kiteOptionChain.ts`, strike step was resolved as:
```typescript
const strikeStep = STRIKE_STEPS[sym] ?? inferStrikeStep(rows.map(r => r.strike));
```

The `??` operator means: **static map wins; inference only used when static map has no entry**. This is backwards from what we want — the live instrument master dump (from which `rows` is built) is the authoritative source. The static map `STRIKE_STEPS` (`{ NIFTY: 50, BANKNIFTY: 100, SENSEX: 100 }`) has no expiry date and no drift alarm.

There was also no way for operations to know if the static map had diverged from actual exchange strike spacing — the drift was silent.

### Fix

`artifacts/api-server/src/lib/kiteOptionChain.ts`:

```typescript
const inferredStep = inferStrikeStep(rows.map(r => r.strike));
const staticStep   = STRIKE_STEPS[sym];
let strikeStep: number;
let strikeStepSource: "instrument_master" | "static_map_fallback";

if (inferredStep > 0 && Number.isFinite(inferredStep)) {
  strikeStep       = inferredStep;
  strikeStepSource = "instrument_master";
  if (staticStep != null && Math.abs(inferredStep - staticStep) / staticStep > 0.10) {
    logger.warn(
      { sym, inferredStep, staticStep, gapPct: ... },
      "kiteOptionChain: STRIKE_STEP_DRIFT — instrument master differs from static map by >10%; static map is stale",
    );
  }
} else {
  strikeStep       = staticStep ?? 50;
  strikeStepSource = "static_map_fallback";
  logger.warn(..., "strike step inference failed; using static map fallback");
}
```

**Drift alarm**: logs `STRIKE_STEP_DRIFT` when the static map and inferred step diverge by > 10%. This is the observability mechanism that will alert ops when exchange changes strike spacing. The 10% threshold catches real step changes (e.g., SENSEX changing from 100 to 50, or NIFTY changing from 50 to 100) while ignoring floating-point rounding in the inference.

**NSE direct path** (`optionChain.ts`): stamps `strikeStepSource: "inferred_from_nse" as const` — computed from actual NSE strike list spacing.

### New OcResponse field

```typescript
strikeStepSource?: "instrument_master" | "static_map_fallback" | "inferred_from_nse";
```

This lets option chain consumers (UI, analytics) know whether the displayed strike step is authoritative or a fallback, and enables monitoring dashboards to surface fallback occurrences.

---

## Files changed

| File | Change |
|---|---|
| `artifacts/api-server/src/lib/indicesBoard.ts` | + `proxyLevelBlocked` + `proxyLevelBlockReason` to `IndexBoardItem`; `buildItem()` scale guard (proxyPrevClose capture + post-Kite suppression block) |
| `artifacts/api-server/src/lib/optionSignals.ts` | + `prevClose: number | null` to `Ctx`; prevClose computation in `buildContext()`; + `spotChangePctVsPrevClose` + `spotPrevClose` at emission |
| `artifacts/api-server/src/lib/optionChain.ts` | + `strikeStepSource?` to `OcResponse`; NSE path stamps `"inferred_from_nse"` |
| `artifacts/api-server/src/lib/kiteOptionChain.ts` | instrument-master-first strike step with STRIKE_STEP_DRIFT alarm; + `strikeStepSource` to returned object |
| `lib/api-spec/openapi.yaml` | + `proxyLevelBlocked`/`proxyLevelBlockReason` on `IndexBoardItem`; + `spotChangePctVsPrevClose`/`spotPrevClose` on `OptionSignal`; + `strikeStepSource` on `OptionChainResponse` |
| `artifacts/api-server/src/lib/canonicalDataParity.test.ts` | 30 new acceptance tests (11 BUG-1, 7 BUG-2, 8 BUG-3, 3 contract/codegen) |
| `MASTER_QUANT_BUG_REGISTER_2026_07_09.csv` | MQ-P0-03: OPEN_P0 → FIXED_DEV_VERIFIED; MQ-P0-04: OPEN_P0 → PARTIAL_FIX; MQ-P0-12: PARTIAL_FIX improved |
| `MASTER_QUANT_REMEDIATION_ROADMAP_2026_07_09.md` | Section 3: Lane 1 summary added |

## What was NOT changed

- No trading logic, signal scoring, confluence, or risk gates
- No paper-trade execution path
- No DB schema (no migrations needed)
- No `INSTRUMENTS` config entries (the proxy configuration is kept; the runtime guard handles scale mismatches)
- No F&O session scheduling or Kite auth
- `spotChangePercent` semantics preserved — internal momentum detectors continue to work correctly

## Production verification checklist

After next deploy + build-info confirms this commit:
1. **BUG-1**: Visit `/` or `/markets`, inspect `MIDCAP NIFTY` row. EMAs, pivot, 52W should be absent/hidden (not shown as ~17 800 levels). Change%, VWAP (if session live) should remain. Check `/api/indices/board` JSON for `proxyLevelBlocked: true` on `MIDCPNIFTY`.
2. **BUG-2**: Call `/api/fno/signals`. Inspect any signal's `spotChangePctVsPrevClose` vs `spotChangePercent`. They should differ by the day's open gap. `spotPrevClose` should match NSE/Kite reported previous close.
3. **BUG-3**: Call `/api/option-chain/NIFTY`. Inspect `strikeStepSource`. Should be `"instrument_master"` when Kite session is live. Check api-server logs for any `STRIKE_STEP_DRIFT` alarms.
