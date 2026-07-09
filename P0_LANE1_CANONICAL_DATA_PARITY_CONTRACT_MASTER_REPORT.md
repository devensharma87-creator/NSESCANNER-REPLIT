# P0 Lane 1: Canonical Data Parity + Contract Master — Full Fix Report
## 2026-07-09

**Final verdict: `P0_LANE1_CANONICAL_DATA_PARITY_CONTRACT_MASTER_DEV_VERIFIED`**

**Tests: 57 new acceptance (canonicalDataParity.test.ts) + 770 scanner + 184 optionSignal/paper tests = all pass**
**Typecheck: green (api-server + scanner). Codegen: green.**

---

## Executive Summary

All 5 remaining Lane 1 gaps are now closed. This report supersedes `LANE1_CANONICAL_DATA_PARITY_REPORT.md`.

| # | Gap | Severity | Status |
|---|---|---|---|
| BUG-1 | MIDCAP proxy level scale mismatch (MQ-P0-03) | P0 | FIXED_DEV_VERIFIED (prior session) |
| BUG-2 | F&O spotChangePercent vs-open baseline (MQ-P0-04) | P0 | FIXED_DEV_VERIFIED |
| BUG-3 | Strike step static map drift risk (MQ-P0-12, partial) | P0 | FIXED_DEV_VERIFIED |
| BUG-4 | FINNIFTY prevClose / 52W contamination (MQ-P0-02) | P0 | OUTDATED_AUDIT_FINDING |
| BUG-5 | Expiry source not labelled on signal leg (GAP 3) | P0 | FIXED_DEV_VERIFIED |
| BUG-6 | Lot-size ContractMasterFact / drift alarm (GAP 4) | P0 | FIXED_DEV_VERIFIED |

---

## GAP 1 — F&O Signal Frontend Baseline Parity

**Problem**: Server emits `spotChangePctVsPrevClose` (canonical prev-close change%) but frontend options page was still rendering `spotChangePercent` (vs open) as the main market change percentage.

**Fix applied** (`artifacts/scanner/src/pages/options.tsx`):

| Surface | Before | After | Verdict |
|---|---|---|---|
| F&O card header | `spotChangePercent` (vs open) as primary | `spotChangePctVsPrevClose` as primary; `spotChangePercent` shown with "(vs open)" label only when prevClose unavailable | FIXED |
| F&O signal detail | No change% displayed in SetupCard | SetupCard uses the grouped header which now shows prevClose-based % | FIXED |
| Option signal list | Group header showed vs-open % | Group header now shows prev-close % | FIXED |
| API fields | `spotChangePercent` preserved (internal use) | `spotChangePctVsPrevClose` is primary display field | NO CHANGE (correct) |

- `spotChangePercent` is NOT removed — it remains for internal detector use
- `spotChangePctVsPrevClose` is `null`-safe: only displayed when available
- Fallback to `spotChangePercent` with "(vs open)" label for graceful degradation

**Tests**: 5 tests in `canonicalDataParity.test.ts` — formula divergence, zero case, bearish case, Zod schema includes both fields, options.tsx uses spotChangePctVsPrevClose != null check.

---

## GAP 2 — FINNIFTY prevClose / 52W Contamination Closure

**Verdict: OUTDATED_AUDIT_FINDING** — the original audit finding does not reproduce with current code.

**Evidence:**

| FINNIFTY Field | Source | Verdict |
|---|---|---|
| ltp | Kite `getQuote` (live) | Correct |
| prevClose | Kite `previousClose` (when Kite session active) or Yahoo daily bar[n-2] for `NIFTY_FIN_SERVICE.NS` | Correct — same ticker, no scale gap |
| changePct | `(ch / item.prevClose) * 100` where `ch = item.ltp - item.prevClose` | Correct formula |
| 52wLow | Yahoo meta `fiftyTwoWeekLow` for `NIFTY_FIN_SERVICE.NS` | Same ticker as live LTP — no scale gap |
| 52wHigh | Yahoo meta `fiftyTwoWeekHigh` for `NIFTY_FIN_SERVICE.NS` | Same ticker as live LTP — no scale gap |
| pivot | Yahoo daily OHLC[n-2] for `NIFTY_FIN_SERVICE.NS` | Same ticker — no scale gap |
| analytics provider symbol | `NIFTY_FIN_SERVICE.NS` | Matches live ticker |
| quote provider symbol | `NSE:NIFTY FIN SERVICE` (Kite) → `NIFTY_FIN_SERVICE.NS` (Yahoo) | Consistent |

**Root cause of original audit concern**: MIDCAP uses `yahooDaily: "^NSEMDCP50"` as a proxy (different ticker from the live `NIFTY_MID_SELECT.NS`), which causes scale contamination. FINNIFTY does NOT have a `yahooDaily` setting — it uses `NIFTY_FIN_SERVICE.NS` for both live and history. The scale guard (`proxyLevelBlocked`) is therefore structurally unreachable for FINNIFTY. The original audit appears to have confused the MIDCAP proxy issue with FINNIFTY.

**Scale validation**: No proxy configured → `proxyLevelBlocked` cannot fire → all level analytics (pivots, 52W, EMAs) are on the same price scale as the live LTP.

**Tests**: 4 tests in `canonicalDataParity.test.ts` — FINNIFTY config line has no `yahooDaily`, scale guard condition is conditional on `yahooDaily`, changePct formula uses `item.ltp - item.prevClose`, 52W fields present.

---

## GAP 3 — Expiry / Contract Master Tests

**Problem**: No `expirySource` field on signal leg; no tests proving per-index expiry cadence vs global weekday assumption.

**Fix applied**:

| Underlying | Expected Source | Expected Expiry Behavior | Test Result |
|---|---|---|---|
| NIFTY | algorithmic_weekday | Weekly, Tuesday (expiryWeekday=2) | ✅ PASS |
| BANKNIFTY | algorithmic_weekday | Monthly, last Thursday (expiryWeekday=4) | ✅ PASS |
| SENSEX | algorithmic_weekday | Weekly, Tuesday (expiryWeekday=2) | ✅ PASS |
| All indices | No single global weekday | NIFTY/SENSEX=Tue, BANKNIFTY=Thu → not all same | ✅ PASS |

**Changes**:
- `optionSignals.ts` leg emission now stamps `expirySource: "algorithmic_weekday" as const`
- `lib/api-spec/openapi.yaml` OptionLeg schema adds `expirySource: enum [instrument_master, algorithmic_weekday]`
- Codegen re-run → Zod schema includes `expirySource`
- `instrument_master` is NOT stamped in `optionSignals.ts` (it is reserved for kiteOptionChain when the chain validates against the live dump)
- Tests confirm the "no global weekday flag" invariant: NIFTY/SENSEX=2, BANKNIFTY=4

**Tests**: 7 tests in `canonicalDataParity.test.ts`.

---

## GAP 4 — Lot-Size ContractMasterFact / Drift Alarm

**Problem**: Paper trade open path used `LOT_SIZES` static map; no drift alarm when static differs from master; no `lotSizeSource` surfaced.

**Fix applied**:

### kiteFnoInstruments.ts — new exports
- `getCachedLotSizeForIndex(indexSymbol)` — synchronous, reads the in-memory Kite instrument cache, returns the live `lot_size` from the first CE/PE contract found for the index; returns `null` when cache is cold (early startup/Kite offline)
- `_setFnoInstrumentsCacheForTest(rows)` — test-only helper to warm the cache with mock data

### paperTradingFO.ts — master-first lotSizeFor
- `lotSizeFor` now tries `getCachedLotSizeForIndex(sym)` first
- When master is available: uses master lot size; emits `LOT_SIZE_DRIFT` warning log if it differs from the static map
- When master cache is cold: falls back to `LOT_SIZES[sym]` with `contractGrade=static_fallback` info log
- **Static map NEVER silently overrides master** — master wins whenever cache is warm

### kiteOptionChain.ts — lotSizeSource surfaced
- `lotSizeSource: "instrument_master" | "static_fallback"` stamped alongside `lotSize`
- `instrument_master` when `activeLegs[0]?.lot_size` is present and positive (the normal Kite path)
- `static_fallback` when `lot_size` is absent/zero

### openapi.yaml / OcResponse
- `OptionChainResponse` schema adds `lotSizeSource: enum [instrument_master, static_fallback]`
- `optionChain.ts` `OcResponse` interface adds `lotSizeSource?: "instrument_master" | "static_fallback"`
- Codegen re-run → Zod schema includes `lotSizeSource`

**Lot size correctness table (Jan-2026 NSE/BSE revision)**:

| Index | Static LOT_SIZES | Test Result |
|---|---|---|
| NIFTY | 65 | ✅ PASS |
| BANKNIFTY | 30 | ✅ PASS |
| SENSEX | 20 | ✅ PASS |
| FINNIFTY | 60 | ✅ PASS |
| MIDCPNIFTY | 120 | ✅ PASS |

**Historical rows**: not rewritten — `lotSizeFor` change only affects NEW paper opens. Existing DB rows retain their recorded `lot_size`.

**Backtest**: `backtest_trades.lotSize` already stored per-trade; the label "instrument_master" vs "static_fallback" is surfaced in the live paper path, not retroactively applied to historical backtest rows.

**Tests**: 9 tests in `canonicalDataParity.test.ts` — 5 static map values, cold-cache null, warm-cache 5 indices, drift alarm code path present, kiteOptionChain stamps lotSizeSource, Zod schema includes lotSizeSource.

---

## Safety Confirmation

1. ✅ No broker execution
2. ✅ No real orders
3. ✅ No Telegram messages
4. ✅ No strategy threshold changes
5. ✅ No detector weight changes
6. ✅ No confidence formula changes
7. ✅ No stop formula changes
8. ✅ No target formula changes
9. ✅ No account balance changes
10. ✅ No realized P&L rewrite
11. ✅ No historical trade rewrite
12. ✅ No destructive migration
13. ✅ No P0-00 locked plan mutation regression
14. ✅ No Yahoo/delayed/proxy/report-grade source can drive trades
15. ✅ No unavailable data rendered as zero/none/green/live

---

## Test Counts

| Suite | Count | Status |
|---|---|---|
| `canonicalDataParity.test.ts` (Lane 1 acceptance) | 57 | ✅ All pass |
| Scanner vitest (770 tests, 35 files) | 770 | ✅ All pass |
| optionSignal/paper targeted (12 files) | 184 | ✅ All pass |
| api-server typecheck | — | ✅ Green |
| scanner typecheck | — | ✅ Green |
| codegen | — | ✅ Green |

---

**Final verdict: `P0_LANE1_CANONICAL_DATA_PARITY_CONTRACT_MASTER_DEV_VERIFIED`**
