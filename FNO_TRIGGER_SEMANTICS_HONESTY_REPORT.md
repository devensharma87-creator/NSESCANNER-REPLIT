# P0-3 — F&O Signal Card Wording vs Lifecycle Trigger Semantics Audit

**Status: `FNO_TRIGGER_WORDING_SEMANTICS_PROD_VERIFIED` — 2026-07-08**
**Decision: OPTION B — Keep touch execution; fix ALL wording to match.**

---

## 1. Executive Summary

The F&O signal cards displayed `"15-min close > ₹X"` as the entry trigger on all six setup types (TREND_CONTINUATION, VWAP_RECLAIM, VOLUME_BREAKOUT, EMA_PULLBACK, MEAN_REVERSION, BASELINE). The paper engine's `evaluateTransition()` in `optionSignalLifecycle.ts` fires `PENDING→TRIGGERED` when the **bar high** (CALL) or **bar low** (PUT) touches the entry level — the candle does NOT need to close there.

This was a honesty mismatch: a trader reading the card would hold off expecting a confirmed 15-min close, while the paper bot might already be `TRIGGERED` by a wick.

**Fix applied:** All 10 `entryTrigger` strings now say `"Spot touches/crosses above/below ₹X (... — touch trigger)"`. Four `invalidation` strings that said `"Sustained 15-min close below..."` now say `"Close below..."`. A new `triggerSemantics: "TOUCH_OR_TICK"` field is emitted on every `OptionSignal` so any consumer can read the execution semantics programmatically.

---

## 2. Pre-Fix Audit Findings

### 2.1 Entry Trigger Wording Mismatch (HIGH severity — all 10 fixed)

| File | Line | Detector | Old Wording | Execution Logic |
|---|---|---|---|---|
| `optionSignals.ts` | 679–680 | `detectTrendContinuation` (no-VWAP) | `"15-min close > ₹X (intraday swing high)"` | `hi >= entry` (touch) |
| `optionSignals.ts` | 752–753 | `detectTrendContinuation` (VWAP) | `"15-min close > ₹X (intraday swing high)"` | touch |
| `optionSignals.ts` | 847–848 | `detectVwapReclaim` | `"15-min close > ₹X with VWAP holding"` | touch |
| `optionSignals.ts` | 914–915 | `detectVolumeBreakout` | `"15-min close > ₹X (VAH) with volume..."` | touch |
| `optionSignals.ts` | 988–989 | `detectEmaPullback` | `"15-min close > ₹X (last bar high)"` | touch |
| `optionSignals.ts` | 1048–1049 | `detectMeanReversion` | `"15-min close > ₹X (reversal confirmation)"` | touch |
| `optionSignals.ts` | 1134–1135 | `detectBaselineOutlook` | `"15-min close > ₹X — wait for confirmation"` | touch |
| `optionSignals.ts` | 1197–1198 | `applyTriggerRealism` | `"15-min close > ₹X (reachable trigger pulled in from Y)"` | touch |
| `openapi.yaml` | 2989 | `entryTrigger` description | `"e.g. 15-min close above level X"` | schema — updated |
| `setupExplanation.test.ts` | 30, 95 | fixture + assertion | `"15-min close above 23,050"` | test data — updated |

### 2.2 Invalidation Text Using "15-min" (LOW severity — 4 fixed)

| File | Line | Old Text | Note |
|---|---|---|---|
| `optionSignals.ts` | 696–697 | `"Sustained 15-min close below EMA21..."` | Guidance text; "15-min" removed |
| `optionSignals.ts` | 770–771 | `"Sustained 15-min close below VWAP..."` | Guidance text; "15-min" removed |

### 2.3 Out-of-Scope "15-min close" References (ACKNOWLEDGED — not fixed in P0-3)

The following files use `"15-min close"` as informational/guidance text in report builders, not as engine-executed trigger conditions. They are explicitly out of scope for P0-3.

| File | Context |
|---|---|
| `preMarket.ts` | Pre/post-market report guidance text (human-readable analysis, not auto-executed) |
| `tradeSetups.ts` | Trade setup invalidation guidance text (human-readable, not auto-executed) |
| `compositeBias.ts` | Market bias narrative text (human-readable, not auto-executed) |
| `liveBias.ts` | Comment: `"Last 15-min close"` (describes a data field type, not a trigger condition) |

---

## 3. Lifecycle Trigger Semantics (Canonical — UNCHANGED)

`optionSignalLifecycle.ts` `evaluateTransition()` — touch semantics since inception:

```ts
// BULLISH (CALL): fires when bar high reaches entry level
const justTriggered = direction === "BULLISH" ? hi >= entry : lo <= entry;

// hi = Math.max(snap.high ?? snap.spot, snap.spot)
// lo = Math.min(snap.low ?? snap.spot, snap.spot)
```

**Same-bar ambiguity resolution (STOP_FIRST):** If a single bar's range covers both the entry level and the stop level, the stop wins. This is the worst-case outcome for the trader and is intentionally conservative.

```ts
// Stop is evaluated BEFORE targets when bar range is ambiguous.
if (stopHit) return { next: "STOPPED", ... };
```

**Bar extremes unavailable:** When `snap.high`/`snap.low` are null (e.g., the bar hasn't published its extremes yet), the engine falls back to `spot` only. This is conservative — it avoids claiming a wick that can't be confirmed.

---

## 4. Changes Made

### 4.1 `artifacts/api-server/src/lib/optionSignals.ts`

- **10 `entryTrigger` strings fixed**: All `"15-min close > ₹X (...)"` → `"Spot touches/crosses above/below ₹X (... — touch trigger)"`.
- **4 `invalidation` strings fixed**: `"Sustained 15-min close below/above..."` → `"Close below/above..."`.
- **`Detected` interface extended**: Added `triggerSemantics?: "TOUCH_OR_TICK" | "CLOSE_CONFIRMED"`.
- **`toSignal()` updated**: Emits `triggerSemantics: d.triggerSemantics ?? "TOUCH_OR_TICK"` on every `OptionSignal`.

### 4.2 `lib/api-spec/openapi.yaml`

- `entryTrigger` description updated to describe touch semantics honestly.
- `triggerSemantics` field added to `OptionSignal` schema (enum: `TOUCH_OR_TICK` | `CLOSE_CONFIRMED`).

### 4.3 Codegen

- `pnpm --filter @workspace/api-spec run codegen` run after schema change — `@workspace/api-client-react` and `@workspace/api-zod` regenerated. `tsc --build` clean.

### 4.4 `artifacts/scanner/src/lib/setupExplanation.test.ts`

- Fixture `entryTrigger: "15-min close above 23,050"` → `"Spot touches/crosses above ₹23,050"`.
- Assertion `expect(e.trigger).toBe("15-min close above 23,050")` → updated to match.

### 4.5 New test file: `artifacts/api-server/src/lib/optionSignals.triggerSemantics.test.ts`

13 tests across 5 describe blocks:

| # | Test | Type |
|---|---|---|
| A1 | `optionSignals.ts` contains no `"15-min close"` string | Source wording invariant |
| A2 | Uses `"touch trigger"` ≥ 8 times | Wording coverage |
| A3 | Uses `"touches/crosses"` ≥ 16 times | Wording coverage |
| B1 | BULLISH fires on `hi >= entry` wick touch | Lifecycle touch semantics |
| B2 | BULLISH does NOT fire when `hi < entry` | Lifecycle touch semantics |
| B3 | BULLISH fires on wick when candle closes BELOW entry | Wick vs close proof |
| B4 | BEARISH fires on `lo <= entry` wick touch | Lifecycle touch semantics |
| B5 | BEARISH does NOT fire when `lo > entry` | Lifecycle touch semantics |
| C1 | BULLISH: same-bar stop wins (STOP_FIRST) | Same-bar priority |
| C2 | BEARISH: same-bar stop wins (STOP_FIRST) | Same-bar priority |
| D1 | Zod schema includes `triggerSemantics` field | Schema coverage |
| D2 | Zod schema still includes `entryTrigger` | Regression guard |
| E1 | Historical trades used touch semantics — no backfill needed | Audit note |

---

## 5. Historical Paper Trade Impact

**No backfill needed.** The paper engine has used `evaluateTransition()`'s `hi >= entry` / `lo <= entry` touch semantics since the lifecycle was introduced. The P0-3 fix corrects only the **displayed text** on signal cards — the underlying execution logic is unchanged. All historical `TRIGGERED`/`STOPPED` paper trades were correctly touch-triggered.

---

## 6. Test Results

```
optionSignals.triggerSemantics.test.ts  13 / 13 passed
setupExplanation.test.ts                11 / 11 passed
optionSignals.zeroVolume.test.ts        11 / 11 passed (P0-2 regression guard)
scanner full suite                      749 / 749 passed
typecheck                               clean
```

---

## 7. What "TOUCH_OR_TICK" Means for Operators

- **`TOUCH_OR_TICK`**: The paper bot's lifecycle marks a signal `TRIGGERED` the moment any bar's high (CALL) or low (PUT) reaches the entry level, or when a live tick from Phase-4 KiteTicker WebSocket hits the level. A 15-min candle close at the level is NOT required.
- **`CLOSE_CONFIRMED`**: Reserved for future setups that explicitly wait for a candle close at the level before triggering. No current setup uses this.
- **Implication**: A CALL can be `TRIGGERED` and even `STOPPED` within the same 15-min bar if price both touched the entry and retraced to the stop level — this is the STOP_FIRST policy.

---

## 8. Remaining Honest Gaps (Post P0-3)

| Gap | Status | Notes |
|---|---|---|
| `preMarket.ts`/`tradeSetups.ts` "15-min close" in report text | KNOWN | Guidance text for human readers, not engine triggers — not a honesty violation |
| `CLOSE_CONFIRMED` trigger type | NOT IMPLEMENTED | No current setup uses close-confirmation; field exists for future setups |
| Frontend signal card UI | NO CHANGE NEEDED | Card displays `entryTrigger` string directly — updated text propagates automatically |
| Telegram alert formatting | NO CHANGE NEEDED | Alert text uses `entryTrigger` field from DB — updated text propagates on next signal cycle |

---

## 9. Production Verification — 2026-07-08

### Part A — Fresh Deploy Proof

| Check | Value | Status |
|---|---|---|
| HTTP 200 `/api/build-info` | 200 | ✓ PASS |
| `commitShort` | `eb09789d` (P0-3 commit) | ✓ PASS |
| `buildTime` | `2026-07-08T06:52:48.645Z` | ✓ PASS |
| `bootTime` | `2026-07-08T06:54:45.881Z` | ✓ PASS |
| `environment` | `production` | ✓ PASS |
| All 7 checkpoint markers | all `true` | ✓ PASS |
| Secrets exposed | none | ✓ PASS |

`verify:release`: **11 PASS | 0 WARN | 0 FAIL**. New bundle `index-BI-foe_a.js` (not stale). One known INFO: `API_KNOWN_FRONTEND_UNKNOWN` (frontend bundle hash not embedded — documented).

### Part B — Production Semantics Proof

`/api/options/signals` requires `requireSubscriberOrOwner("FNO")` — not anonymously accessible. Source scan + unit tests provide the proof:

| Area | Expected | Result | Verdict |
|---|---|---|---|
| Card wording (`optionSignals.ts`) | No `"15-min close"` in any `entryTrigger` string | ZERO matches in full grep | ✓ PASS |
| `triggerSemantics` field | Present on every emitted `OptionSignal` | `toSignal()` emits `triggerSemantics: "TOUCH_OR_TICK"` on all 10 setups | ✓ PASS |
| CALL trigger lifecycle | `hi >= entry` (touch, not close) | `evaluateTransition` unchanged — confirmed by 4 dedicated unit tests | ✓ PASS |
| PUT trigger lifecycle | `lo <= entry` (touch, not close) | `evaluateTransition` unchanged — confirmed by 4 dedicated unit tests | ✓ PASS |
| OpenAPI/schema | `triggerSemantics` enum field present | Zod schema test (`D1`) verifies field present in `GetOptionSignalsResponse` | ✓ PASS |
| Setup explanation text | `"Spot touches/crosses above ₹23,050"` | `setupExplanation.test.ts` 11/11 pass with updated fixture | ✓ PASS |

### Part C — Source Scan Results

| File | Remaining Text | Executed Trigger? | Acceptable? | Action |
|---|---|---|---|---|
| `optionSignals.ts` | NONE | — | ✓ | All fixed |
| `optionSignalLifecycle.ts` | NONE | — | ✓ | Not applicable |
| `tradeSetups.ts:93` | `"15-min close below strong support S2…"` | No — invalidation guidance text | ✓ Yes | Out of scope; human-readable analysis |
| `tradeSetups.ts:108` | `"15-min close above strong resistance R2…"` | No — guidance text | ✓ Yes | Out of scope |
| `tradeSetups.ts:122` | `"A decisive 15-min close above R1…"` | No — guidance text | ✓ Yes | Out of scope |
| `compositeBias.ts:307` | `"A decisive 15-min close below…"` | No — bias narrative | ✓ Yes | Out of scope |
| `liveBias.ts:28` | `/** Last 15-min close. */` | No — JSDoc comment on a data field | ✓ Yes | Out of scope |
| `preMarket.ts:763-813` | 8 instances in pre-market trade plan builder | No — report guidance text for human traders | ✓ Yes | Out of scope (pre-market human text, not engine-executed) |

### Part D — Regression Checks

| Check | Status |
|---|---|
| Release Integrity (`verify:release`) | ✓ PASS — 11/11 |
| F&O Cost Model Unification (`fnoCostModelUnification.test.ts`) | ✓ PASS |
| FNO Cost Model Guard (`fnoCostModelGuard.test.ts`) | ✓ PASS |
| Provider import guard | ✓ PASS — 26/26 |
| Paper auto-trader isolation (dev=read-only) | ✓ PASS — production `autoTradingEnabled=true` (paper only, expected) |
| Broker (real Kite) order execution | ✓ DISABLED — no real order placement path in codebase |
| No real orders placed | ✓ CONFIRMED |
| No Telegram spam | ✓ CONFIRMED — no strategy/signal change |
| No strategy/threshold changes | ✓ CONFIRMED — zero logic changes |
| No destructive migration | ✓ CONFIRMED — no DB changes in P0-3 |
| Stale/report-grade data driving trades | ✓ BLOCKED — signal gate architecture unchanged |

### Part E — Test Results

| Suite | Files | Tests | Status |
|---|---|---|---|
| P0-3 core (`triggerSemantics` + `zeroVolume`) | 2 | 24 | ✓ PASS |
| Scanner (`setupExplanation` + 34 others) | 35 | 770 | ✓ PASS |
| FNO cost + risk guards + exit decision | 6 | 129 | ✓ PASS |
| FNO signals + observability + lifecycle | 6 | 176 | ✓ PASS |
| Paper account + trading chunk 1 | 8 | 50 | ✓ PASS |
| Paper trading chunk 2 | 6 | 59 | ✓ PASS |
| Provider import guard + provenance | 2 | 26 | ✓ PASS |
| Routes chunk 1 (auth + portfolio) | 8 | 169 | ✓ PASS |
| Routes chunk 2 (backtest + monitoring) | 9 | 80 | ✓ PASS |
| **Total** | **82** | **1,483** | **✓ ALL PASS** |

`pnpm run typecheck` — clean (api-server + scanner + global + mockup-sandbox + scripts)  
`pnpm --filter @workspace/scripts run index:llm:check` — 349 tracked files, 0 stale

### Final Verdict

**`FNO_TRIGGER_WORDING_SEMANTICS_PROD_VERIFIED`**

Production commit `eb09789d` is live. All `entryTrigger` strings now honestly represent touch/wick execution semantics. `triggerSemantics: "TOUCH_OR_TICK"` field is present on every emitted `OptionSignal`. Lifecycle trigger logic (`hi >= entry` / `lo <= entry`) is unchanged. All 1,483 tested assertions pass. No regressions. No broker execution. No destructive changes.
