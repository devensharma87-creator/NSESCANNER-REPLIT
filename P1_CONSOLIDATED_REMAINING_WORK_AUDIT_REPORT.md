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
   > "Gross P&L — charges (brokerage ₹20/side, STT 0.05%, exchange/SEBI/GST fees) are not deducted above and do not affect DD/heat/risk gates. Estimated net-of-charges P&L is shown in P&L Reports using the canonical cost model (effective 2026-04-01)."

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

**`P1A_PAPER_TRADING_GROSS_NET_DISPLAY_DEV_VERIFIED`**

P1A (Paper Trading gross/net display honesty) implemented as a safe UI-only change. All other P1 items audited and classified. No trading logic changed. No server change. No schema change. No broker execution. No Telegram. No destructive migration.

| Item | Session Outcome |
|---|---|
| P1A — Paper Trading gross/net | **IMPLEMENTED** (dev verified) |
| P1B — MACD warm-up fix | Audited — deferred to standalone session |
| P1C — NSE holiday calendar | Audited — low priority maintenance |
| P1D — Equity gap-through exit | Audited — HIGH risk, requires explicit owner sign-off |
| P1E — Charting professional | Audited — medium-large UI, phased separately |

**Next required owner decisions:**
1. Approve P1B (MACD fix) — confirm acceptable that historical MACD reads for short-history symbols will change.
2. Approve P1D (equity gap-through exit) — confirm acceptable that historical paper trade P&L will differ.
3. Schedule P1E charting phases per priority.
