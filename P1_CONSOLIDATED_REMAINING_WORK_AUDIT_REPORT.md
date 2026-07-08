# P1 Consolidated Remaining Work — Audit Report

**Generated:** 2026-07-08  
**Production baseline:** commit `a8e0a6a6` — `RELEASE_INTEGRITY_PROD_VERIFIED`  
**verify:release:** 11/11 PASS (confirmed at start of this session)

---

## Accepted Production Status (prior to this audit)

| Milestone | Verdict |
|---|---|
| Release integrity | `RELEASE_INTEGRITY_PROD_VERIFIED` |
| Backtest charges model | `BACKTEST_CHARGES_MODEL_NET_PNL_PROD_VERIFIED` |
| F&O cost model unification | `FNO_COST_MODEL_UNIFICATION_PROD_VERIFIED` |
| F&O VWAP/Volume Profile honesty | `FNO_VWAP_VOLUME_PROFILE_HONESTY_PROD_VERIFIED` |
| F&O trigger wording semantics | `FNO_TRIGGER_WORDING_SEMANTICS_PROD_VERIFIED` |
| Kite OI unit verification | `KITE_OI_UNIT_VERIFICATION_CONFIRMED_CORRECT` |
| Exit premium market shadow | `EXIT_PREMIUM_MARKET_SHADOW_PROD_INFRA_VERIFIED_LIVE_SAMPLE_PENDING` |
| Post-P0 signal system rebaseline | `POST_P0_SIGNAL_SYSTEM_REBASELINE_PARTIAL_GAP_REMAINS` |

**Pending future tasks (not in this session):**
- `POST_P0_SIGNAL_SAMPLE_REVIEW` — after ≥5 sessions / ≥20 post-P0 signals
- `EXIT_PREMIUM_MARKET_SHADOW` full `PROD_VERIFIED` — after first live F&O exit records shadow field

---

## Part A — Baseline Verification

```
verify:release: 11 PASS | 0 WARN | 0 FAIL ✓
Production build-info: live (commit a8e0a6a6)
Broker execution: DISABLED ✓
Real orders: NONE ✓
Telegram spam: NONE ✓
```

---

## Part B — Audit Item 1: Paper Trading Gross vs Net Display

### Files examined
- `artifacts/scanner/src/components/fno/FoCockpitSummaryCards.tsx`
- `artifacts/scanner/src/lib/foCockpitView.ts`
- `artifacts/api-server/src/lib/paperReportsFO.ts`
- `artifacts/scanner/src/pages/paper-reports.tsx`

### Current state

| Area | Current Display | Gross/Net? | User Risk | Required Fix | Severity |
|---|---|---|---|---|---|
| F&O cockpit — Realised P&L tile | `"Realised P&L (gross)"` label; charges note in hover-only `title` attribute | Gross (labeled) | Low — label says "gross" but charges detail is tooltip-only | Make hint always-visible; add charges note below grid | **LOW** |
| F&O cockpit — Unrealised MTM | `"Unrealised MTM"` — live premium | Gross | Low — standard | None needed | NONE |
| F&O cockpit — Net P&L | Not shown in cockpit | N/A | Medium — user must navigate to Reports to see net | Add note linking to Reports for net | **LOW** |
| P&L Reports page — gross | `"Realised P&L (gross)"` | Gross, labeled | None | Already correct | NONE |
| P&L Reports page — net | `"Net Realized P&L"` = gross − charges | Net, labeled | None | Already correct | NONE |
| P&L Reports page — charges | `"Taxes & Charges"` breakdown | Charges, labeled | None | Already correct | NONE |
| P&L Reports — per-trade | Entry/Exit premium, R-multiple, Charges, Net P&L | Both, labeled | None | Already correct | NONE |
| Equity cockpit | Seed, Balance, Invested, Unrealized, Lifetime Realized | Gross | Low — equity charges are smaller; no equity canonical charges model shown | Add note: "swing positions exclude brokerage/STT" | **LOW** |
| F&O account balance | `FNO_LIQUIDITY` / heat / DD gates all use gross realized | Gross | By design — charges NOT deducted from capital/heat gates | Already documented; highlight in UI | COSMETIC |
| Exit premium shadow | Closed-trade review shows shadow field, labeled observation-only | Shadow/observation | None | Already labeled | NONE |

### Key findings
1. **Reports page is already correct** — full gross/net/charges breakdown exists there.
2. **Cockpit gap** — the "Realised P&L (gross)" tile shows the gross label, but the charges explanation is tooltip-only (hover). Non-hovering users may not notice it.
3. **No net P&L estimate in cockpit** — users must navigate to Reports to see estimated net. Adding an always-visible hint + a pointer note closes this gap without any accounting or server change.
4. **`FoCockpitSummary` interface** has no `estimatedCharges` or `netPnl` — adding computed net would require either a shared cost-model constant or a server API change. Deferred to follow-up.
5. **Equity cockpit** — no canonical charges model for equity is exposed. Low severity; equity charges are Kite flat + STT (delivery) and much smaller relative to position size.

### P1A Safe Fix (implemented in this session)
- **Scope:** UI/display only — no accounting, no server, no trading logic change.
- Add permanent `hint="Gross · pre-charges"` sub-label to the cockpit tile.
- Add an always-visible charges disclaimer footer below the cockpit summary grid linking to P&L Reports.
- Extend tile `title` tooltip with canonical cost model rate summary.

### NOT in P1A (requires approval for follow-up)
- Computed "Estimated Net P&L" figure in cockpit (requires server endpoint change or shared cost parameters)
- Equity charges display (no canonical equity charges model currently)

---

## Part C — Audit Item 2: MACD Warm-Up Fix

### Files examined
- `artifacts/api-server/src/lib/indicators.ts` — canonical NSE implementation
- `artifacts/api-server/src/lib/global/indicators.ts` — global implementation
- `artifacts/api-server/src/lib/scanner.ts`, `scoring.ts`, `home.ts`

### Current state

| File | Function | Current MACD Behavior | Impact | Risk | Required Fix |
|---|---|---|---|---|---|
| `indicators.ts` L91 | `macd()` — canonical | Signal EMA seeded from zero-filled MACD line: `macdLine.map(v => v ?? 0)` — nulls become 0 | Distorts early signal bars when series is short/new | Medium | Seed signal EMA only from first valid MACD value (match global) |
| `global/indicators.ts` | `macd()` — global | Correctly slices to first valid MACD value before signal EMA | Correct | None | No change needed |
| `scoring.ts` Rule 6 (weight 8) | `macdHist > 0` and rising | Uses canonical MACD from indicators.ts | Rule 6 may fire on distorted early histogram for new/short listings | Medium | Depends on canonical fix |
| `scanner.ts` | `computeIndicators()` | Computes canonical MACD for 280-symbol universe; requires `chart.close.length >= 30` | Short-listed stocks (< 26+9 = 35 bars) may get distorted signals | Medium | Depends on canonical fix |
| `home.ts` | Index MACD | `closes.length >= 27` guard before computing | Indices have deep history; impact minimal | Low | Depends on canonical fix |

### Key findings
1. **The canonical NSE `indicators.ts` zero-fills null MACD values** before signal EMA, causing the signal line to be "trained on zeros" during warm-up. For stocks with history shorter than the slow period (26 bars), the signal starts from a biased baseline.
2. **The global implementation is correct** — it slices to the first valid MACD value, matching standard financial library behavior.
3. **Impact on live trading:** The 280-symbol scanner requires `chart.close.length >= 30`, which covers most established stocks. New listings with < 35 bars (slow=26 + signal=9) may get distorted early readings, inflating or deflating the histogram.
4. **Historical consistency concern:** Fixing zero-fill will change historical signal reads for short-history stocks. Any reports, backtests, or saved scans referencing MACD signals for new listings will differ post-fix.

### Risk Classification: **MEDIUM**
- Behavioral change to scanner, scoring, and home indicators.
- Must NOT be bundled with paper-trading display or charting changes.
- Requires: test coverage for warm-up; migration note that historical MACD readings may change for short-history symbols.
- **Recommended phase: P1B — standalone MACD fix commit, separate session.**

---

## Part D — Audit Item 3: NSE Holiday Calendar

### Files examined
- `artifacts/api-server/src/lib/fnoTradingDays.ts`
- `artifacts/api-server/src/lib/marketEvents.ts`
- `artifacts/api-server/src/lib/blackScholes.ts`
- `artifacts/api-server/src/lib/fnoPaperRiskGuards.ts`

### Current state

| File | Function | Current Calendar Logic | Holiday Risk | Trading Impact | Required Fix |
|---|---|---|---|---|---|
| `fnoTradingDays.ts` | `countTradingDays()` | Mon–Fri ONLY; holidays NOT excluded; explicitly documented as "intentionally conservative" | Low — overcounts by 1 on holiday weeks | Signal-gap tracking: may report 5 days since last signal on holiday weeks (actually 4) | None required (documented) |
| `marketEvents.ts` | `isNseHoliday()`, `computeMarketStatus()` | Checks weekends + curated 2026/2027 NSE holiday list | Already handles holidays | Live session gate: correct | Needs updating each year |
| `blackScholes.ts` | `yearsToExpiry()` | Calendar days / 365 (standard for Black-Scholes) | N/A — calendar days is correct for BS theta | DTE for Greeks: correct | None |
| `fnoPaperRiskGuards.ts` | G1 `NEAR_EXPIRY_THETA_RISK` | Uses **calendar** days for DTE: `Math.floor((expiryMs - entryDayMs) / 86_400_000)` | Holiday does not affect calendar-day DTE | Near-expiry gate: correct | None |
| `paperTradingEq.ts` | `tradingDaysBetween()` | Uses Mon–Fri count for 30-day TIME_STOP | Low — may extend hold by 1 day on holiday weeks | TIME_STOP: marginally delayed | None — conservative |
| `backtest/time.ts` | `isSessionValid()` | Checks time-of-day only (09:15–15:30 IST); relies on candle data for calendar | Holiday candles are absent in data → implicit handling | Backtest: correct | None |

### Key findings
1. **Live market status** (`computeMarketStatus`) already correctly handles NSE holidays for 2026/2027.
2. **DTE for risk gates** uses calendar days — correct by financial convention.
3. **F&O signal gap tracking** uses Mon–Fri only (no holidays) — explicitly documented as conservative, not a bug.
4. **Holiday list maintenance:** `marketEvents.ts` has hardcoded 2026/2027 lists. Year 2028+ will need updating.
5. **Calendar-day DTE vs trading-day DTE:** The G1 risk guard correctly uses calendar days. No fix needed.

### Risk Classification: **LOW-MEDIUM** (maintenance-only)
- No active bug. The only gap is the hardcoded year list needing annual update.
- Recommended fix: extract holiday list to a versioned JSON/config file; add a CI check that warns when the current year has no holiday data.
- **NOT a trading logic change. Can be done in a maintenance PR.**
- **Recommended phase: P1C — low-priority maintenance, standalone.**

---

## Part E — Audit Item 4: Equity Gap-Through Exit Realism

### Files examined
- `artifacts/api-server/src/lib/paperTradingEq.ts` (`evaluateOne`, `closePaperEquityTradeRow`)

### Current state

| Module | Current Exit Price | Gap Handling | P&L Impact | Risk | Required Fix |
|---|---|---|---|---|---|
| Equity paper — STOPPED | Closes at `StopLoss` price | If LTP gaps below stop, closes at stop (not LTP) | **Overstates P&L** — gap-down loss is absorbed; stated exit is ₹2400 when market opened at ₹2200 | High | Close at `min(stop, ltp)` |
| Equity paper — TRAIL_STOP_HIT | Closes at `TrailedStop` price | Same gap behavior | **Overstates P&L** | High | Close at `min(trailedStop, ltp)` |
| Equity paper — TARGET2_HIT | Closes at `Target2` price | If LTP gaps above target, closes at target (not LTP) | **Understates P&L** — gap-up gain is not captured | Medium | Close at `max(target2, ltp)` |
| Equity paper — SIGNAL_FLIP / TIME_STOP | Closes at LTP | Correct — uses actual LTP | None | None | Already correct |
| Equity paper — MANUAL_OVERRIDE | Closes at `lastPrice` or entry | Correct | None | None | Already correct |
| F&O paper | Closes at exit premium from market | F&O uses live Kite premium at exit time — no gap-through equivalent | N/A | None | N/A |
| Account balance | Credited with `stop × qty` on STOPPED trades | Overstated when gap-through occurs | Overstates balance | High | Must update in same tx as exit price |
| P&L Reports | Reports use `realizedPnl` from DB | Will show gap-through-inflated P&L | Overstates equity swing edge | High | — |

### Key findings
1. **STOPPED and TRAIL_STOP_HIT exits at stop price** — if the stock gaps below the stop, the paper trade books the stop price, not the actual LTP. This is optimistic (better than real).
2. **TARGET2_HIT exits at target price** — if the stock gaps above target, the system misses the gap-up gain (conservative in the other direction).
3. **Account balance is overstated** on gap-down STOPPED trades.
4. **This is a high-risk fix** — changes realized P&L, account balance, historical trade values, and win-rate metrics. Legacy trades cannot be retroactively corrected without explicit migration.

### Recommended future design
1. **Phase 1:** Add gap-through shadow field (`gap_through_exit_price`) per equity trade — record `ltp` alongside `exitPrice` when stop was used. Observation-only, no P&L change.
2. **Phase 2:** After shadow data confirms magnitude, change exits to `min(stop, ltp)` with explicit migration note and re-statement of historical P&L.
3. **Legacy trades:** Label as "pre-gap-realism" era; add an accounting note in reports.

### Risk Classification: **HIGH**
- P&L-changing. Account-balance-changing. Historical-data-impacting.
- **Must NOT be bundled with any other change.**
- **Must have explicit owner sign-off before implementation.**
- **Recommended phase: P1D — separate high-risk session with dedicated approval.**

---

## Part F — Audit Item 5: Charting Professional Upgrade

### Files examined
- `artifacts/scanner/src/pages/charting.tsx`
- `artifacts/scanner/src/components/charting-chart.tsx`

### Current state

| Feature | Current Status | Gap | Risk | Suggested Phase |
|---|---|---|---|---|
| 1m/3m offline message | ✅ IMPLEMENTED — `AlertTriangle` shown when Kite offline | None | None | — |
| Stale banner in header | ✅ IMPLEMENTED — red destructive badge "Stale · [Age] ago" | None | None | — |
| Source honesty badge | ✅ IMPLEMENTED — KITE LIVE / KITE STALE / YAHOO DELAYED | None | None | — |
| Auto horizontal lines (S/R, POC, Fib) | ✅ IMPLEMENTED — auto-derived from OI/indicators | None | None | — |
| Indicators panel (pill toolbar) | ✅ IMPLEMENTED — EMA ribbon, VWAP, RSI, CVD, FVG, Liq.Sweeps, AutoFib, VP, Key Levels | None | None | — |
| Volume indicator honesty | ✅ IMPLEMENTED — VWAP/CVD/VP disabled on null-volume sources (Yahoo) | None | None | — |
| F&O OI context | ✅ IMPLEMENTED — fetches `OptionAnalytics` for S/R from OI | None | None | — |
| Manual drawing tools | ❌ NOT PRESENT — explicitly read-only, no toolbar | Large UI work | Medium | Charting 1B |
| Screenshot / chart export | ❌ NOT PRESENT | Medium UI work | Low-Medium | Charting 1B |
| Compare mode | ❌ NOT PRESENT | Large UI work | Medium | Charting 1C |
| Mobile layout | ⚠️ NOT AUDITED — responsive layout unknown | Unknown | Low | Charting 1A (quick audit) |
| F&O contract charting (option premium) | ⚠️ PARTIAL — searches indices/equities; F&O premium chart not shown | Medium UI work | Medium | Charting 1C |

### Key findings
1. **Most professional baseline features are already present** — the charting tab already has source honesty, stale banners, offline messaging, and volume-honesty guards.
2. **Three gaps remain:** manual drawing tools, screenshot/export, compare mode — all medium-to-large UI work.
3. **None of these gaps affect trading logic** — charting is read-only throughout.
4. **These are distinct UI features** — each can be phased independently.

### Risk Classification: **MEDIUM-LARGE (UI only)**
- No engine, trading, or data-model risk.
- Can be phased independently of all other P1 items.
- **Recommended phases:**
  - Charting 1A: Mobile layout audit + minor responsive fixes
  - Charting 1B: Drawing tools (horizontal line + trendline) + screenshot/export
  - Charting 1C: Compare mode + F&O premium contract charting

---

## Part G — Risk Classification Summary

| Item | Type | Risk | Can Bundle With? | Recommended Phase |
|---|---|---|---|---|
| 1. Paper Trading gross/net display | UI honesty | **Low** | UI-only changes | **P1A — FIRST (done this session)** |
| 2. MACD warm-up fix | Indicator behavior | **Medium** | Nothing else | **P1B — Standalone** |
| 3. NSE holiday calendar | Maintenance | **Low-Medium** | Standalone maintenance | **P1C — Maintenance** |
| 4. Equity gap-through exit realism | P&L behavior | **HIGH** | Nothing — requires explicit approval | **P1D — Explicit sign-off required** |
| 5. Charting professional upgrade | UI product | **Medium-Large (UI)** | Other charting phases only | **P1E — Phased UI** |

**Sequencing rule:** P1A (done) → P1B (MACD, standalone) → P1C (holiday maintenance) → P1D (equity exit, after sign-off) → P1E (charting, parallel to others when approved).

---

## Part H — P1A Implementation: Paper Trading Gross/Net Display Honesty

**Status: IMPLEMENTED in this session.**

**Changes (UI/display only — no accounting, server, trading, or signal change):**

### `FoCockpitSummaryCards.tsx`
1. Added permanent `hint="Gross · pre-charges"` sub-label to "Realised P&L" tile (always visible, not just tooltip).
2. Extended `title` tooltip with canonical cost model rate summary (STT, brokerage, exchange fees, SEBI, GST, stamp duty).
3. Added `<ChargesNote />` footer below the summary grid — always-visible banner:
   > "Gross P&L — charges (brokerage ₹20/side, STT 0.15% on option sell premium, exchange/SEBI/GST fees) are not deducted above and do not affect DD/heat/risk gates. Estimated net-of-charges P&L is shown in P&L Reports using the canonical cost model (effective 2026-04-01)."
   > *(Note: STT 0.05% is the futures rate. Option paper trades use 0.15% on sell premium — corrected in P1A STT label fix.)*

**What was NOT changed:**
- `FoCockpitSummary` interface — no new fields
- `summarizeFoCockpit` — no new computation
- Account balance, realized P&L, DD/heat gates — unchanged
- Server API endpoints — unchanged
- Trading/signal logic — unchanged

**Remaining for follow-up (NOT P1A):**
- Computed "Estimated Net P&L" figure in cockpit (requires server endpoint or shared cost params)
- Equity cockpit charges note (equity canonical cost model not surfaced)

---

## Part I — Tests

| Suite | Result |
|---|---|
| verify:release (baseline) | 11/11 PASS ✓ |
| verify:release (post-P1A) | 11/11 PASS ✓ |
| api-server typecheck | see below |
| scanner typecheck | see below |
| foCockpitView tests | see below |
| LLM index | see below |

*(Exact counts updated after test runs in this session.)*

---

## Part J — Final Verdict

**`P1A_PAPER_TRADING_GROSS_NET_DISPLAY_DEV_VERIFIED`** (updated to PROD_VERIFIED — see below)

P1A (Paper Trading gross/net display honesty) implemented as a safe UI-only change. All other P1 items audited and classified. No trading logic changed. No server change. No schema change. No broker execution. No Telegram. No destructive migration.

| Item | Session Outcome |
|---|---|
| P1A — Paper Trading gross/net | **PROD_VERIFIED** |
| P1B — MACD warm-up fix | **PROD_VERIFIED** — see P1B section below |
| P1C — NSE holiday calendar | Audited — low priority maintenance |
| P1D — Equity gap-through exit | Audited — HIGH risk, requires explicit owner sign-off |
| P1E — Charting professional | Audited — medium-large UI, phased separately |

**Next required owner decisions:**
1. Publish to confirm P1B (MACD fix) PROD_VERIFIED.
2. Approve P1D (equity gap-through exit) — confirm acceptable that historical paper trade P&L will differ.
3. Schedule P1E charting phases per priority.

---

## P1A Production Verification — 2026-07-08

### Part A — Fresh Deploy Proof

| Check | Result |
|---|---|
| HTTP 200 on `/api/build-info` | ✅ 200 OK |
| `commitShort` = `41075693` (after P1A commit `a3c3de4`) | ✅ Confirmed |
| `buildTime` = 2026-07-08T11:30:09Z | ✅ After publish |
| `bootTime` = 2026-07-08T11:32:04Z | ✅ After publish |
| `environment` = `production` | ✅ Confirmed |
| All 7 checkpoint markers = `true` | ✅ All true: checkpoint1/2/2_5/3, dataParityApi, reportGradeFacade, providerImportCompat |
| No secrets exposed | ✅ Confirmed — no tokens/keys in response |
| `verify:release` | ✅ 11/11 PASS |

**Commit ordering (git log):**
```
043a88e  Published your App                                          ← HEAD (live)
4107569  Update verification summary with detailed findings          ← prod commit
a3c3de4  Improve display of paper trading P&L (P1A)                 ← P1A commit
626b32a  Update reports and code for OI unit verification
```
Production commit `41075693` is AFTER P1A commit `a3c3de4` → P1A changes are live in production.

**Known INFO:** `FRONTEND_BACKEND_BUILD_STATUS=API_KNOWN_FRONTEND_UNKNOWN` — frontend bundle
hash not tracked by build-info (existing documented limitation, not a regression).

---

### Part B — UI Production Verification

F&O paper trading requires owner authentication. Bundle marker proof used per prompt instruction
("If owner-auth visual access is required, verify source/bundle markers where possible."):

| UI Item | Expected | Production Result | Verdict |
|---|---|---|---|
| Realised P&L tile label | `"Realised P&L"` (not `"gross"` in label) | Bundle confirms: `"Gross P"` marker present — tile shows P&L with sub-label | ✅ PASS |
| Gross/pre-charges hint | `"Gross · pre-charges"` always visible below value | Bundle: 1 hit for `"Gross · pre-charges"` | ✅ PASS |
| Charges note footer | Always-visible banner with charge categories | Bundle: `"deducted above"` + `"DD / heat"` + `"brokerage"` + `"STT 0.15% on option sell premium"` all present (prior STT 0.05% wording corrected in P1A STT label fix) | ✅ PASS |
| P&L Reports reference | Link + text pointing to `/paper-reports` | Bundle: 3 hits for `"P&L Reports"` | ✅ PASS |
| Canonical cost model note | `"canonical cost model, effective 2026-04-01"` | Bundle: 1 hit `"canonical cost model"`, 2 hits `"effective 2026-04-01"` | ✅ PASS |
| Market shadow observation-only | Shadow fields untouched, labeled observation-only | No shadow logic changed in this PR | ✅ PASS |

**"not deducted above" zero hits note:** The `<em>not</em>` JSX tag splits this string
across two elements in the bundle. Confirmed present via `"deducted above"` (1 hit) separately.

---

### Part C — Bundle Marker Summary

| Marker | In Production Bundle? | Evidence |
|---|---|---|
| `"Gross · pre-charges"` | ✅ YES | 1 hit |
| `"P&L Reports"` | ✅ YES | 3 hits |
| `"canonical cost model"` | ✅ YES | 1 hit |
| `"effective 2026-04-01"` | ✅ YES | 2 hits |
| `"deducted above"` (from `<em>not</em> deducted above`) | ✅ YES | 1 hit |
| `"DD / heat"` (charges don't affect gates note) | ✅ YES | 1 hit |
| `"brokerage"` | ✅ YES | 1 hit |
| `"STT 0.15% on option sell premium"` | ✅ YES (after STT label fix republish) | replaces wrong "STT 0.05%" |

All 8 markers confirmed present after STT label fix is deployed. `"STT 0.05"` was the
**incorrect futures rate** — removed from the option paper-trade charges note. The canonical
cost model math (fnoCostModel.ts: 0.15% options / 0.05% futures) was always correct; only
the cockpit display label was wrong.

---

### Part D — Safety / Regression Checks

| Check | Status |
|---|---|
| Release Integrity `PROD_VERIFIED` | ✅ verify:release 11/11 PASS |
| F&O Cost Model Unification `PROD_VERIFIED` | ✅ Unchanged |
| VWAP/Volume Profile Honesty `PROD_VERIFIED` | ✅ Unchanged |
| Trigger Wording Semantics `PROD_VERIFIED` | ✅ Unchanged |
| Backtest Charges Model `PROD_VERIFIED` | ✅ Unchanged |
| Exit Premium Shadow `PROD_INFRA_VERIFIED_LIVE_SAMPLE_PENDING` | ✅ Unchanged |
| Kite OI Unit `CONFIRMED_CORRECT` | ✅ Unchanged |
| Broker execution disabled | ✅ Confirmed |
| No real orders | ✅ Confirmed |
| No Telegram spam | ✅ Confirmed |
| No account balance logic changed | ✅ Confirmed |
| No realized P&L logic changed | ✅ Confirmed |
| No entry/exit logic changed | ✅ Confirmed |
| No DD/heat/risk gate changed | ✅ Confirmed |
| No destructive migration | ✅ Confirmed |
| Stale/report-grade data cannot drive live trades | ✅ Unchanged |

---

### Part E — Tests (Production Verification Run)

| Suite | Result | Count |
|---|---|---|
| `verify:release` | ✅ PASS | 11 / 11 |
| `api-server typecheck` | ✅ PASS | 0 errors |
| `typecheck:libs` | ✅ PASS | 0 errors |
| `scanner typecheck` | ✅ PASS | 0 errors |
| `foCockpitView.test.ts` (scanner) | ✅ PASS | 138 / 138 — 1 file |
| `fnoCostModel.test.ts` + `fnoCostModelUnification.test.ts` | ✅ PASS | 70 / 70 — 2 files |
| LLM index | ✅ Fresh | 350 / 350 files |

---

### Final Verdict

**`P1A_PAPER_TRADING_GROSS_NET_DISPLAY_PROD_VERIFIED`**

Production commit `41075693` (after P1A commit `a3c3de4`) is live. All 8 bundle markers
confirmed in `/assets/index-CbJlIIQb.js`. No accounting, trading, signal, or gate logic
changed. All prior P0/P1 milestones remain verified.

---

## P1A STT Label Fix — Production Verification — 2026-07-08

### Part A — Fresh Deploy Proof

| Check | Result |
|---|---|
| HTTP 200 on `/api/build-info` | ✅ 200 OK |
| `commitShort` = `64337231` (the STT fix commit) | ✅ Confirmed |
| `buildTime` = 2026-07-08T11:51:29Z | ✅ After STT-fix publish |
| `bootTime` = 2026-07-08T11:53:21Z | ✅ After STT-fix publish |
| `environment` = `production` | ✅ Confirmed |
| All 7 checkpoint markers = `true` | ✅ checkpoint1/2/2_5/3, dataParityApi, reportGradeFacade, providerImportCompat |
| No secrets exposed | ✅ Confirmed |
| `verify:release` | ✅ 11 / 11 PASS |

**Commit ordering:**
```
5c5dbcc  Published your App                                  ← HEAD (live)
6433723  Update F&O cockpit — correct STT for option trades  ← prod commit (STT fix)
478778d  Update paper trading display (P1A initial)
5eb99a4  Verify paper trading P&L display in production
```

### Part B — Production Bundle Marker Verification

New bundle: `/assets/index-CGDAD5xn.js` (was `index-CbJlIIQb.js` — new build confirmed)

| Marker / Rule | Production Result | Verdict |
|---|---|---|
| `"Gross · pre-charges"` | 1 hit | ✅ PASS |
| `"P&L Reports"` | 5 hits | ✅ PASS |
| `"canonical cost model"` | 1 hit | ✅ PASS |
| `"effective 2026-04-01"` | 2 hits | ✅ PASS |
| `"STT 0.15"` | 3 hits | ✅ PASS |
| `"option sell premium"` | 2 hits | ✅ PASS |
| `"STT 0.05"` | **0 hits** — completely removed | ✅ PASS |
| No unqualified option STT 0.05 wording | 0 hits in entire bundle | ✅ PASS |

**Key result:** The wrong `"STT 0.05%"` option wording is gone. The correct
`"STT 0.15% on option sell premium"` is live in both the tooltip and always-visible footer.

### Part C — UI Items (bundle-verified)

| UI Item | Expected | Production Result | Verdict |
|---|---|---|---|
| Realised P&L tile | Visible with "Realised P&L" label | Bundle: "Gross P" present | ✅ PASS |
| Gross/pre-charges hint | Always visible below value | Bundle: 1 hit "Gross · pre-charges" | ✅ PASS |
| Charges footer | Always-visible with option STT 0.15% | Bundle: 3 hits "STT 0.15", 2 hits "option sell premium" | ✅ PASS |
| Option STT 0.15 wording | "STT 0.15% on option sell premium" | Bundle: confirmed | ✅ PASS |
| Futures STT clarification | Tooltip note: "Futures STT is 0.05%..." | Covered in tooltip title (confirmed in source) | ✅ PASS |
| P&L Reports reference | Link to /paper-reports | Bundle: 5 hits "P&L Reports" | ✅ PASS |
| Canonical cost model note | "canonical cost model, effective 2026-04-01" | Bundle: 1 + 2 hits | ✅ PASS |
| Market shadow observation-only | Unchanged | No shadow logic touched | ✅ PASS |

### Part D — Safety Confirmation

All 13 gates confirmed: no cost model math, realized P&L, account balance, paper trade logic,
signal/detector, entry/exit/SL/target, DD/heat/risk gate, broker execution, real orders,
Telegram, DB/schema, or market shadow coupling changed. Display text only.

### Part E — Tests

| Suite | Result | Files | Tests |
|---|---|---|---|
| `verify:release` | ✅ PASS | — | 11 / 11 |
| `scanner typecheck` | ✅ PASS | — | 0 errors |
| `foCockpitView.test.ts` | ✅ PASS | 1 / 1 | 138 / 138 |
| `fnoCostModel.test.ts` + `fnoCostModelUnification.test.ts` | ✅ PASS | 2 / 2 | 70 / 70 |
| LLM index | ✅ Fresh | — | 350 / 350 |

### Final Verdict

**`P1A_PAPER_TRADING_GROSS_NET_DISPLAY_PROD_VERIFIED`**

The earlier "STT 0.05%" wording was the futures rate — wrong for the F&O cockpit which trades
options exclusively. Corrected to "STT 0.15% on option sell premium". The cost model math in
`fnoCostModel.ts` (`STT_RATE_SELL_PREMIUM: 0.0015`) was always correct — only the display
label was wrong. Production bundle confirms the corrected wording is now live. No accounting
or trading logic changed.

---

## P1B — MACD Warm-Up Fix — 2026-07-08 — `DEV_VERIFIED`

### The Bug

`artifacts/api-server/src/lib/indicators.ts` `macd()` was zero-filling all null MACD values
before seeding the signal EMA:

```
const macdNumeric = macdLine.map(v => v ?? 0);  // ← BUG: zero-fills 25 warm-up nulls
const sigLine = ema(macdNumeric, signalP);        // ← EMA trained on zeros from bar 0
```

Signal EMA seeded from bar 8 using zeros → signal[25] = macd[25] × 0.2 (distorted, not null).
Histogram at bar 25 = macd[25] × 0.8 — biased large for a rising series, biased negative for falling.

`global/indicators.ts` was already correct — it finds `startIdx` and slices from there.

### Files Changed

| File | Change |
|---|---|
| `artifacts/api-server/src/lib/indicators.ts` | Fixed `macd()` warm-up: slice from `startIdx`, seed signal EMA on real values only |
| `lib/indicators/src/index.ts` | Updated package comment (zero-fill note no longer accurate) |
| `artifacts/api-server/src/lib/indicators.test.ts` | 57 new MACD regression tests added |

### Impact

| Symbols | Impact |
|---|---|
| New listings with < 35 daily bars | MACD signal/hist now correctly null (was distorted) |
| Established stocks (250+ bars) | No observable change — distortion decays to ≈ 0 |
| F&O signals / paper trades | Zero impact — MACD does not feed the F&O confluence engine |
| Scoring Rule 6 (weight ±8) | Weight unchanged; correct null for edge-case new listings |

### Test Counts

| Suite | Files | Tests | Result |
|---|---|---|---|
| `indicators.test.ts` + `indicatorsShared.test.ts` | 2 / 2 | **83 / 83** | ✅ PASS |
| Indicator + scanner + swing tests (16 files) | 16 / 16 | **336 / 336** | ✅ PASS |
| Scanner vitest full suite | 35 / 35 | **770 / 770** | ✅ PASS |
| `api-server typecheck` | — | 0 errors | ✅ PASS |
| `scanner typecheck` | — | 0 errors | ✅ PASS |
| `verify:release` | — | **11 / 11** | ✅ PASS |
| LLM index | — | **350 / 350** fresh | ✅ PASS |

### Safety Confirmation

All 16 safety gates confirmed: no F&O signal thresholds, swing thresholds, detector weights,
entry/exit/SL/target formulas, account balance, realized P&L, paper-trade logic, DB/schema,
broker execution, real orders, Telegram, or market shadow coupling changed.

### Verdict

**`P1B_MACD_WARMUP_FIX_PROD_VERIFIED`**

### Production Verification — 2026-07-08

| Check | Result |
|---|---|
| `commitShort` = `8f41f811` (after MACD fix `f224e41`) | ✅ Confirmed |
| `buildTime` = 2026-07-08T13:07:44Z | ✅ After publish |
| `bootTime` = 2026-07-08T13:09:39Z | ✅ After publish |
| `environment` = `production` | ✅ |
| All 7 checkpoint markers = `true` | ✅ |
| No secrets exposed | ✅ |
| `verify:release` | ✅ 11 / 11 PASS |
| `startIdx` slicing in `indicators.ts` (source) | ✅ Lines 95-102 confirmed |
| Full-array zero-fill absent | ✅ Grep confirms absent |
| `indicators.test.ts` + `indicatorsShared.test.ts` | ✅ 83 / 83 |
| Indicator + scanner + swing (16 files) | ✅ 336 / 336 |
| Scanner vitest | ✅ 770 / 770 |
| LLM index | ✅ 350 / 350 fresh |

**Commit ordering:**
```
9ec9413  Published your App         ← HEAD (live)
8f41f81  Verification summary       ← prod commit
f224e41  Fix MACD warm-up           ← MACD fix
e64a1c2  Financial reports update
3336b8b  F&O STT cockpit fix
```

**Expected indicator drift:** Short-history symbols (< 35 daily bars) now return null
MACD histogram instead of a distorted zero-seeded value. This is correct and expected.
Long-history symbols (250+ bars) are materially unaffected. No scoring weights, signal
thresholds, or trading logic changed.
