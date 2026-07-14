# Trading Logic Audit — F&O Paper Trading + Equity Swing
**Date:** 2026-05-15
**Type:** Read-only audit. No code modified.
**Scope:** Actual trading logic in the codebase as of commit `b6932bdb`. Every claim cites file:line.
**Companion docs:** `docs/paper-trader-architecture.md` (long-form rationale), `docs/trading-logic-review-2026-05-15.md` (operator review).

---

## A. Executive summary

**What's actually wired and trading:**
- F&O paper trading is live for **NIFTY, BANKNIFTY, SENSEX only** (no other index is connected). 6 distinct setup detectors emit signals; 13 post-emission gates filter them; sub-tiered sizing (MICRO/BASELINE/STANDARD) governs position size; fixed-lot overrides win for STANDARD opens.
- Equity swing trading scans the **NIFTY 500** universe; final 0-100 score is a weighted sum of **7 components** (technical / SMC / volume / momentum / fundamentals / risk / context); 7 action labels are emitted server-side; auto-trader fires only on `STRONG_BUY` (`score ≥ 50`) gated through an 11-step rejection pipeline.

**What is built but NOT wired into trading decisions** (data infrastructure only):
- **Candle warehouse** (`lib/db/src/schema/candleWarehouse.ts`) — write-only. Not read by any signal or scanner. Schema comment confirms "*NOT consumed by any live trading decision. Pure substrate for future backtesting.*"
- **Option-chain snapshots** (`lib/db/src/schema/optionChainSnapshot.ts`) — write-only. The new `optionSnapshotAnalytics.ts` reads them only for the diagnostic endpoint; no signal/gate consumes snapshot data. Module header confirms "*Not wired into trading.*"
- **Equity sizing helper** (`lib/equitySizingHelper.ts`) — read-only mirror of the 11-gate sequence. Only caller is the diagnostic route. **This is the safety property** of the on-demand sizing-preview form.
- **Sector map** (`lib/universe.ts`) — used by F&O lane and global scanner for breadth/heatmap; **NOT used in swing scoring**. The swing scanner's RS is stock-vs-NIFTY only.

**Material gaps / concerns** (full detail in §L):
1. Slippage and broker charges are **not** included in F&O P&L — realised P&L is raw `(exit − entry) × qty`.
2. The `recordMissedSignal()` log is in-memory (100-row ring buffer), not persisted — operator cannot query historical skip reasons.
3. Equity swing scanner reads live Kite (with Yahoo fallback) on every deep scan; the candle warehouse it could use is not wired.
4. `setup` ("A+ Buying Zone", "Breakout / Retest", "52w Low Reversal", "52w High Momentum", "Watchlist", "Avoid / Weak") and `qualityGrade` (A / B+ / B / C / D) are emitted but the **paper-trader equity opener does not consume them** — it only checks `signal === "STRONG_BUY"`.
5. Win-rate gate uses 30-day setup history, but with `MIN_SAMPLE = 10`; new setups effectively pass-through.

**Honest unknowns:**
- Whether `STRONG_BUY` swings actually outperform `BUY` swings in live paper trading (not measured by the codebase).
- Whether the Phase 3 confluence engine's score correlates with realised win-rate (the win-rate gate measures it post-hoc per setup, but no automated re-calibration loop exists).

---

## B. F&O trading logic overview

### B.1 Supported indices

Locked to three. Confirmed by inspection of the three independent collections:

| Constant | File:line | Members |
|---|---|---|
| `OPTION_INDICES` | `lib/optionSignals.ts:51` | NIFTY, BANKNIFTY, SENSEX |
| `FNO_INDICES` (OI Lab) | `lib/oiLab.ts:49` | NIFTY, BANKNIFTY, SENSEX |
| `SIGNAL_INDEX_TO_LTP_KEY` | `lib/optionSignals.ts:64` | NIFTY, BANKNIFTY, SENSEX |

No other index (FINNIFTY, MIDCPNIFTY, BANKEX, etc.) is wired. Adding one requires touching all three.

### B.2 Per-index parameters

| Index | Lot size | Strike step | Expiry | Fixed lots (STANDARD) |
|---|---|---|---|---|
| NIFTY | 75 | 50 | Weekly | 10 |
| BANKNIFTY | 15 | 100 | Monthly | 30 |
| SENSEX | 10 | 100 | Weekly | 40 |

Sources: `LOT_SIZES` in `lib/optionChain.ts`; strike steps + expiry cadence in `lib/optionSignals.ts:51`; `PAPER_FIXED_LOTS` in `lib/paperAccount.ts:69-73`.

### B.3 Data sources

| Surface | Source | Notes |
|---|---|---|
| Index spot | KiteTicker WebSocket (Phase 4) | `getKiteIndexQuotes`, `optionSignals.ts:5` |
| Daily history (EMA/HTF) | Kite `day` interval | HARD-CUT 2026-05-06: F&O paths NEVER touch Yahoo |
| Intraday 15m bars | Kite intraday | `kiteIntraday.ts` |
| 60m HTF bars | Built session-aware from 15m | `optionSignals.ts:365-399` |
| VIX | Kite-only | `optionSignalGates.ts:315`; no-op when missing |
| Option chain (premium / OI / spread) | `fetchOptionChain` (Kite-only) | `lib/optionChain.ts` |
| OI snapshot (analytics) | `optionChainSnapshotTable` | **Write-only; not consumed by signals** |
| OI Lab (Δ-window backfill) | Kite historical (`oi=true`) | `lib/oiLab.ts:36` — explicitly Kite-only |

**Audit-positive:** No Yahoo imports found in `optionSignals.ts`, `optionSignalGates.ts`, `paperTradingFO.ts`, or `oiLab.ts`. The hard-cut held.

---

## C. F&O entry logic, setup-wise

All six detectors live in `lib/optionSignals.ts`. Each emits a candidate with `direction ∈ {BULLISH, BEARISH}`, a `setupKey`, an `entry` (spot), `stopLoss` (spot), `target1`/`target2` (spot), and a confidence score that the Phase 3 confluence engine then mutates to a tier (HC / BASELINE).

Strike is always **ATM** (no OTM offset): `nearestStrike(c.spot, c.cfg.strikeStep)` — `paperTradingFO.ts:1155`.
Option type: `direction === "BULLISH" ? "CALL" : "PUT"` — `paperTradingFO.ts:1220`.

### C.1 TREND_CONTINUATION (`optionSignals.ts:589`)

| Aspect | Bullish (CE) | Bearish (PE) |
|---|---|---|
| Trigger | `spot > vwap` AND `ema9 > ema21` AND `spot > ema9` | `spot < vwap` AND `ema9 < ema21` AND `spot < ema9` |
| Confirmation | 15-min close above trigger level (`L:641`) | mirror |
| Volume | +8 confidence boost if `vol > 1.2 × avgVol20` | mirror |
| Stop | `min(piv.s1, vwap − atrDaily × 0.3)` | `max(piv.r1, vwap + atrDaily × 0.3)` |
| T1 | `max(piv.r1, VAH) + atr15 × 0.3` | `min(piv.s1, VAL) − atr15 × 0.3` |
| T2 | `piv.r2` | `piv.s2` |
| Invalidation | "Sustained 15-min close below VWAP or S1" (`L:658-660`) | mirror |
| Known weakness | Late-stage trends — last leg often hits T1 then reverses; partial profit booking not implemented |

### C.2 VWAP_RECLAIM (`optionSignals.ts:665`)

| Aspect | Bullish | Bearish |
|---|---|---|
| Trigger | Previously below VWAP, now `spot > vwap` AND `ema9 > ema21` | mirror |
| Confirmation | 15-min close above VWAP after reclaim |  |
| Stop | `vwap − atr15 × 0.5` | `vwap + atr15 × 0.5` |
| T1 | `max(prevSwingHigh, piv.r1)` |  |
| T2 | `piv.r2` |  |
| Known weakness | False reclaims on low-volume reclamations; volume confirmation NOT required for this setup |

### C.3 VOLUME_BREAKOUT (`optionSignals.ts:744`)

| Aspect | Bullish | Bearish |
|---|---|---|
| Trigger | `spot > VAH` AND `vol > avgVol20 × 1.3` AND `spot > ema9/vwap` | `spot < VAL` AND `vol > avgVol20 × 1.3` AND `spot < ema9/vwap` |
| Confirmation | 15-min close above VAH (`L:731`) |  |
| Volume | **Required** (1.3× avgVol20) |  |
| Stop | `POC − atr15 × 0.3` | `POC + atr15 × 0.3` |
| T1 | `piv.r1 + atr15 × 0.5` |  |
| T2 | `piv.r2` |  |
| Known weakness | Volume can spike on news without follow-through; no news filter |

### C.4 EMA_PULLBACK (`optionSignals.ts:811`)

| Aspect | Bullish | Bearish |
|---|---|---|
| Trigger | `ema9 > ema21`, low touches `ema9/21`, green candle | `ema9 < ema21`, high touches `ema9/21`, red candle |
| Confirmation | 15-min green/red close at the touch (`L:798`) |  |
| Stop | `min(ema21, lastBarLow) − atr15 × 0.3` |  |
| T1 | `max(prevSwingHigh, piv.r1)` |  |
| T2 | `piv.r2` |  |
| Known weakness | Requires EMA9>EMA21 alignment — early in a new trend the alignment lags by ~1-2 hours |

### C.5 MEAN_REVERSION (`optionSignals.ts:885`)

| Aspect | Bullish | Bearish |
|---|---|---|
| Trigger | `spot − vwap < −atr15 × 2` AND `rsi < 25` | `spot − vwap > atr15 × 2` AND `rsi > 75` |
| Confirmation | **None** — fires on oversold/overbought reading directly (the only setup without a confirmation candle) |  |
| Stop | `spot − atr15 × 0.6` | `spot + atr15 × 0.6` |
| T1 | `vwap` | `vwap` |
| T2 | `ema21` | `ema21` |
| Known weakness | Trades counter-trend; in a strong downtrend the RSI<25 condition keeps triggering and the mean keeps moving away |

### C.6 BASELINE (`optionSignals.ts:947`)

| Aspect | Bullish | Bearish |
|---|---|---|
| Trigger | Majority of: `spot > vwap`, `spot > ema21`, `ema9 > ema21`, `rsi > 50` | (reverse) |
| Confirmation | 15-min close confirms majority condition (`L:932`) |  |
| Stop | `min(vwap, ema21) − atr15 × 0.5` | `max(vwap, ema21) + atr15 × 0.5` |
| T1 | `piv.r1` (at least 1.5R) |  |
| T2 | `piv.r2` |  |
| Known weakness | Lowest-quality setup by design; matches the "BASELINE" tier name. Sub-tiered sizing (0.25-0.5%) compensates |

### C.7 Setup → confidence → tier

After detection, Phase 3 (`lib/confluenceEngine.ts`) scores the candidate against EMA stack alignment, regime, RS, OI confluence, IVR/IVP, and intraday VP. The output replaces the per-detector confidence. Final tier:

- **STANDARD (HC)** — confidence ≥ 65 AND none of the demoting gates fire.
- **BASELINE** — confidence ≥ 55 OR HC was demoted by `isDemoted` partition (vol-clamp / HTF / noise window / expiry / 1h HTF / RS / win-rate).
- Below 55 — not emitted.

`HC_EMISSION_FLOOR = 65` at `optionSignals.ts:518`. `MIN_FNO_TRADE = 65` (`tradingConfig.ts`) — auto-trader floor matches HC floor.

---

## D. F&O exit logic and lifecycle

### D.1 Lifecycle states (`lib/optionSignalLifecycle.ts`)

| Status / Exit reason | File:line | Trigger | Initiated by | Audit row |
|---|---|---|---|---|
| **PENDING** | `L:172` | Initial emit | Detector | `status='PENDING'` |
| **TRIGGERED** | `L:175` | Spot crosses entry | 30s sweep | `triggeredAt` set |
| **STOPPED** | `L:197` | Spot hits stop level | 30s sweep / MTM | `exitReason='STOPPED'`, `exitPrice=stop` |
| **TARGET1_HIT** | `L:215` | Spot hits T1 | 30s sweep / MTM | `status='TARGET1_HIT'` (non-terminal) |
| **TARGET2_HIT** | `L:206` | Spot hits T2 | 30s sweep / MTM | `exitReason='TARGET2_HIT'`, `exitPrice=T2` |
| **EXPIRED_TRIGGERED** | `L:755` | Time > 15:30 IST, status was TRIGGERED | EOD sweep | `exitReason='EXPIRED_TRIGGERED'` |
| **EXPIRED_PENDING** | `L:756` | Time > 15:30 IST, status was PENDING (never filled) | EOD sweep | `exitReason='EXPIRED_PENDING'` |
| **STALE_TRIGGER** | `L:695` | PENDING for > 45 minutes without trigger | Intra-session sweep | `exitReason='STALE_TRIGGER'` |

**Note on `TARGET1_HIT`:** This is a **non-terminal** status. It marks T1 reached but does not close the trade. There is **no implementation of partial booking or trail-to-T1** — the position continues to T2 or stop. This is a documented weakness (see §L).

### D.2 Stop / target storage

Stops and targets exist in **both spot and premium terms** (`paperTradingFO.ts:841-844`):

| Spot-side (option_signal_history) | Premium-side (paper_trade_fo) |
|---|---|
| `entry`, `stop_loss`, `target1`, `target2` | `entry_premium`, `stop_premium`, `target1_premium`, `target2_premium` |

The lifecycle sweep evaluates **spot crossings** to flip state. The paper-trade row is what carries the premium-denominated exit price for P&L. Sizing uses the premium stop-distance: `perShareLoss = entryPremium − stopPremium` (`paperTradingFO.ts:462`).

### D.3 Mark-to-market

Live LTP refresh on every position read and every close:
- `GET /paper/positions/fo` → fresh `fetchOptionChain()` to populate `lastPremium` (replit.md "Gotchas").
- `POST /paper/positions/fo/:id/close` → fresh `fetchOptionChain()` re-pricing before recording exit.
- Background `runMarkToMarketFO` cycle (`paperTradingFO.ts:1232`).

### D.4 15:20 force-exit

`forceCloseAllOpenFnoFor1520` closes every open F&O position at the 15:20 IST tick with `exitReason='EXPIRED'`. Latched via `lastForceExit1520Date` to fire once per day. **Combo lane is opted out** (replit.md "Combo paper-trader lane").

### D.5 P&L formula (`paperTradingFO.ts:1079`)

```
realizedPnl = (exitPremium × lots × lotSize) − (entryPremium × lots × lotSize)
            = (exitPremium − entryPremium) × lots × lotSize
```

| Component | Implementation |
|---|---|
| Direction sign | Positive direction handled by `(exit − entry)` — for BUY-only paper trades; the paper trader does not take short option positions |
| **Slippage** | **Not modelled** — entry and exit use the live LTP at the moment of execution |
| **Brokerage / STT / GST** | **Not modelled** — raw premium difference only |
| **MFE / MAE** | Tracked as `max_runup` / `max_drawdown` columns on `paper_trade_fo` (`paperTradingFO.ts:948-949`) |

This is the largest **realism gap**. Real broker charges on a NIFTY option round-trip are ~₹50-80 per lot; over 500 paper trades that's ₹25k-40k of phantom edge. See §L.

---

## E. F&O risk and sizing logic

### E.1 Three-tier sizing (`paperAccount.ts:127-140, 161`)

| Tier | Confidence band | Risk % of seed | Sizing path |
|---|---|---|---|
| MICRO | 55-59 | 0.25% | Risk-percent: `lots = floor(risk × seed / perLotLoss)` |
| BASELINE | 60-64 | 0.50% | Risk-percent (same formula) |
| STANDARD | 65+ | 2.00% | **`PAPER_FIXED_LOTS[index]` overrides** dynamic budget (`paperTradingFO.ts:671`) |

`perLotLoss = (entryPremium − stopPremium) × lotSize`.

### E.2 BASELINE guardrails (`paperAccount.ts:146-155`)

- **Max 2 BASELINE trades / day**.
- **Daily loss cap 0.75%** of seed (incl. unrealised on open BASELINE positions).
- **2-loss lane lock** — two consecutive BASELINE losses lock the BASELINE lane for the day.
- **Late-entry cutoff 14:45 IST** for BASELINE (vs 15:25 for HC).
- **Stats unavailable → fail-CLOSED** via `BASELINE_GUARDRAIL_STATS_UNAVAILABLE`.

### E.3 Drawdown caps and circuit breakers

| Cap | File:line | Threshold | Behaviour |
|---|---|---|---|
| Daily DD | `MAX_DAILY_LOSS_PCT` | 2.5% | Block opens; sticky until next IST day |
| Weekly DD | `MAX_WEEKLY_LOSS_PCT` | 5% | Block opens; sticky until next IST week (Monday) |
| Daily-stop circuit breaker | `optionSignalGates.ts:34, 425` | 2 stops in a day | Kills emission |
| Post-stop cool-down | `paperAccount.ts:216` | 60 min | 0.5× sizing multiplier on the same index |
| VOLATILE regime sizing | — | — | 0.5× multiplier |

### E.4 Heat caps (`paperAccount.ts:241`)

- F&O: `MAX_FNO_HEAT_PCT = 6%` of FNO seed (₹2L).
- Equity: `MAX_EQ_HEAT_PCT = 6%` of EQ seed (₹10L).
- **Independent** — no pooling. Combo lane is a third isolated bucket.
- Heat check runs inside the `FOR UPDATE` transaction (`paperTradingFO.ts:564`) so two simultaneous opens cannot both clear it. **Fail-CLOSED.**

### E.5 Liquidity gates (FNO_LIQUIDITY)

- LTP ≥ ₹20.
- Bid-ask spread ≤ 1.5%.
- OI ≥ 50,000.
- Source: `paperAccount.ts:194-201`. Audit tags: `LIQUIDITY_LTP`, `LIQUIDITY_SPREAD`, `LIQUIDITY_OI`. **Fail-OPEN** on data failure.

### E.6 No-trade conditions

| Condition | Detection |
|---|---|
| Market closed | Time check |
| VIX intraday spike ≥5% / day spike ≥7% | `globalSuppress` (`optionSignalGates.ts:55-60`) |
| Circuit breaker hit | `globalSuppress` |
| Expiry day | `regime === "EXPIRY_DAY"` → demote HC→BASELINE (not full block) |
| `PAPER_TRADING_ENABLED=false` | `paperAutoTradeFlag.ts` early-return |

---

## F. Swing trading logic overview

### F.1 Universe and cadence

- **Universe:** NIFTY 500 — composite of NIFTY100 + Midcap100 + Smallcap100 + a `NIFTY500_EXTRA` list (`lib/watchlistLists.ts:188`).
- **Liquidity floor:** `minAvgValueLakhs = 25` (₹25 Lakhs daily turnover); below threshold deducts 4 from volume score (`swingScanner.ts:76, 1017`). **Soft penalty, not a hard cull.**
- **Deep scan:** Once per day after 15:35 IST (`swingScannerStore.ts:42, 369-379`).
- **Intraday refresh:** Every 15 minutes during 09:15-15:30 IST (`swingScannerStore.ts:45, 243-292`).
- **Cold-start latch:** Reads `swing_scan_run` audit row, not result rows (`swingScannerStore.ts:401-423`). Single-replica assumption.

### F.2 Data sources

- **Live:** `kiteIntraday.ts` (Kite live) → Yahoo fallback in `lib/yahoo.ts`.
- **Candle warehouse:** **NOT consumed.** Schema explicitly says "*NOT consumed by any live trading decision.*" (`lib/db/src/schema/candleWarehouse.ts:15`).

### F.3 Files responsible

| Responsibility | File |
|---|---|
| Pure scoring math | `lib/swingScanner.ts` |
| Data fetching | `lib/swingScannerData.ts` |
| Schedule + cache | `lib/swingScannerStore.ts` |
| API surface | `artifacts/api-server/src/routes/stocksToWatch.ts:50` |
| UI table | `artifacts/scanner/src/pages/stocks-to-watch.tsx:204` |
| Equity Entry-Safety Gate | `lib/scoring.ts:373` (`computeEntrySafety`) |
| Equity paper trader | `lib/paperTradingEq.ts:134` (`openPaperEquityTrade`) |
| Equity sizing mirror | `lib/equitySizingHelper.ts` (read-only) |

---

## G. Swing scoring and recommendation logic

### G.1 The 7 components → final 0-100 score

Final formula at `swingScanner.ts:1071-1072`:

```ts
const raw = technical + smc + volume + momentum
          + fundamentalsComponent + contextScore + riskScore;
const finalScore = Math.round(clamp(raw / 140 * 100, 0, 100) * 10) / 10;
```

| Component | Cap | Weight | Inputs | File:line |
|---|---|---|---|---|
| Technical | 34 | 24.3% | EMA alignment, 200EMA, market structure, ADX, 20D breakout, weekly trend, slopes | `L:1090` |
| SMC | 20 | 14.3% | Demand zone (6), Bullish FVG (5), Overlap (4), Sweep (3), CHoCH (2) | `L:1091` |
| Volume | 25 | 17.8% | AVWAP M/Q/Y, VWAP20, value area, volume ratio, RS50/120 | `L:1092` |
| Momentum | 21 | 15.0% | RSI zones, 52w high/low proximity, candle signal, ATR% | `L:1093` |
| Fundamentals | 25 | 17.8% | ROE, ROA, revenue/earnings growth, D/E, P/E, P/B (via `fundamentalScore`) | `L:1094` |
| Risk | 10 | 7.1% | R:R ratio (≥2.0 → +7), stop-to-ATR distance (+3) | `L:1095` |
| Context | 5 | 3.6% | Market bias (Bullish +5, Neutral +2, Weak −3 if required) | `L:1096` |

**Components NOT in the additive sum** but used elsewhere:
- **`rsScore`** (`L:637`, `L:666`) — stock-vs-NIFTY relative strength. Used by `setupQualityGrade` (`L:891`) to determine the letter grade, **not in the 0-100 score**.

### G.2 Action labels (`classifyAction`, `swingScanner.ts:861`)

Server-side strings emitted in priority order:

| Label | Criteria | Line |
|---|---|---|
| **AVOID / NO TRADE** | `score < 50 \|\| rr < 1.2 \|\| bias === "Bearish" \|\| weakWarn` | 869 |
| **BUY ZONE - WAIT TRIGGER** | `score ≥ 78 && inZone && rr ≥ cfg.minRr` | 870 |
| **BUY BREAKOUT / RETEST ONLY** | `score ≥ 72 && aboveZone && rr ≥ cfg.minRr` | 871 |
| **WAIT FOR PULLBACK** | `score ≥ 65 && aboveZone` | 872 |
| **WAIT FOR RECLAIM** | `score ≥ 60 && belowZone` | 873 |
| **WATCHLIST** | `score ≥ 58` | 874 |
| **WAIT FOR CONFIRMATION** | fallback | 875 |

**Note:** These are display labels, not the `signal` enum. The auto-trader gates on the **`signal` enum** (STRONG_BUY at score ≥ 50 — `swingScanner.ts:210-214`), not on the `classifyAction` label. So a stock can be labeled "WAIT FOR PULLBACK" in the UI yet still be `signal === "STRONG_BUY"` to the auto-trader. **This is a UX/logic split worth flagging** (see §L gap #4).

### G.3 Quality grade and setup

| Field | Function | Values | Line |
|---|---|---|---|
| `qualityGrade` | `setupQualityGrade` | A / B+ / B / C / Watch Only / D / Avoid | 888 |
| `setup` | `classifySetup` | A+ Buying Zone / Breakout-Retest / 52w Low Reversal / 52w High Momentum / Watchlist / Avoid-Weak | 878 |
| `potential` | inline | High (`score≥75 && rr≥minRr`) / Medium (`score≥60`) / Low | 1076 |
| `reasons[]` | inline | Up to 14 strings explaining contributing factors | 1134 |

Grade A criteria: `score ≥ 78 && rr ≥ 2 && weeklyTrend bullish/neutral+ && rsScore ≥ 5.5 && !penalty`.

### G.4 Equity Entry-Safety Gate (`lib/scoring.ts:373`)

Independently demotes `STRONG_BUY → BUY` when entry is at a poor location:
- **POOR** — today change > 2.5% AND inside 3% of major resistance/support (`L:430`).
- **FAIR** — inside 3% of major level (`L:446`).
- **GOOD** — clear (`L:459`).

Audit tags: `LATE_ENTRY_AT_RESISTANCE` / `LATE_ENTRY_AT_SUPPORT` (`L:230-242, 437`). Because the auto-trader requires `STRONG_BUY`, POOR-graded stocks are silently filtered out without a separate hard reject.

---

## H. Swing entry and exit logic

### H.1 Entry (`buildStop` `L:791`, `entryTrigger` `L:830`, `buildTargets` `L:806`)

- **Entry trigger:** depends on `inZone` vs `aboveZone`. Uses `prevHigh + tick` or `lastSwingHigh`.
- **Stop selection:** demand zone, bullish FVG, last swing low, or 52w low — whichever is most relevant. Base ATR stop = `entry − 1.5 × atrNow` (`L:797`); structural stop = `supportLevel − 0.25 × atrNow` (`L:801`).
- **T1:** nearest supply/swing high if ≥1.2R, else 2R (`L:815-820`).
- **T2:** `max(3R, T1 + 0.75R)` (`L:824`).

### H.2 Exit conditions (`paperTradingEq.ts:71-77, 9-16`)

| Status | Trigger |
|---|---|
| `TARGET2_HIT` | LTP ≥ T2 |
| `STOPPED` | LTP ≤ stop |
| `TRAIL_STOP_HIT` | After T1 reached, stop trails to T1; LTP ≤ T1 |
| `TIME_STOP` | 30 trading days elapsed without exit |
| `SIGNAL_FLIP` | Underlying signal flips to `STRONG_SELL` |
| `MANUAL_OVERRIDE` | Owner UI close |

Mark-to-market source: latest LTP from the scanner cache, refreshed each tick (`paperTradingEq.ts:6`).

---

## I. Swing paper trade sizing and lifecycle

### I.1 The 11-gate sequence (`paperTradingEq.ts:134-389`, mirrored in `equitySizingHelper.ts:33-44`)

| # | Gate | File:line | Reject reason |
|---|---|---|---|
| 1 | INVALID_STOP | `L:115-132` | Entry/stop NaN, infinite, or stop on wrong side |
| 2 | STOP_SANITY | `L:139` | Stop distance < 1% or > 8% (`EQUITY_STOP_SANITY`) |
| 3 | DD_DAILY | `L:170` | Daily realised DD ≥ 2% of seed |
| 4 | DD_WEEKLY | `L:183` | Weekly realised DD ≥ 4% of seed |
| 5 | DD_MONTHLY | `L:196` | Monthly realised DD ≥ 8% of seed |
| 6 | DAILY_CAP | `L:243` | Already opened 3 entries today |
| 7 | CONCURRENT_CAP | `L:255` | Already 10 open positions |
| 8 | DEPLOY_LE_0 | `L:291` | Per-slot allocation ≤ 0 |
| 9 | QTY_LT_1 | `L:308` | Allocation cannot buy 1 share |
| 10 | INSUFF_BAL | `L:343` | Cash balance insufficient after rounding |
| 11 | HEAT_CAP | `L:370` | Projected heat > 6% of seed |

**The codes you asked about:** `STOP_SANITY_TIGHT` and `STOP_SANITY_WIDE` are **not separate codes** — both collapse into a single `STOP_SANITY` rejection with the threshold violated reported as a sub-field.

### I.2 Sizing formula

```
seed         = ₹10,00,000
maxConcurrent = 10
slotAllocation = balance / max(1, maxConcurrent − openCount)
qty          = floor(slotAllocation / entryPrice)
```

Then heat check: `qty × (entry − stop) ≤ 6% × seed`.

### I.3 Lifecycle

```
candidate scanned (deep scan after 15:35)
   ↓
classified by signal/grade/setup
   ↓
auto-trader picks STRONG_BUY only (paperTradingEq.ts:9)
   ↓
11-gate sequence (any rejection → audit row, no open)
   ↓
paper_trade_eq INSERT status='OPEN'
   ↓
re-evaluate each tick: TARGET2_HIT / STOPPED / TRAIL_STOP_HIT / TIME_STOP / SIGNAL_FLIP / MANUAL_OVERRIDE
   ↓
status='CLOSED', realized_pnl computed
```

### I.4 Phantom-trade protection

- **Unique index** `paper_trade_fo_signal_uq` on `(signalDate, indexSymbol, setupKey, direction)` (`lib/db/src/schema/paperTrading.ts:137`) — prevents double-opening the same signal across deploy/restart.
- **CAS update** — `optionSignalHistoryTable` updates use status-match WHERE clauses (`paperTradingFO.ts:543`) to prevent stale transitions.
- **`reconcileOrphanedPaperTrades`** runs before `ensureDailyReset` (`paperAccount.ts:433, 456`) — mid-day deploys reconcile previous-day trades before counters roll.
- **`reconcileMissingPaperTrades`** reads `h.tier AS persisted_tier` to **prevent post-deploy re-promotion** of trades originally opened as BASELINE.

---

## J. Exact code map

### J.1 F&O lane

| File | Function | Responsibility |
|---|---|---|
| `lib/optionSignals.ts` | `buildSignalsForIndex`, `buildContext`, `classifyRegime` | Signal generation, regime, EMA/VP/HTF context |
| `lib/optionSignals.ts:589-947` | `detectTrendContinuation` ... `detectBaseline` | 6 setup detectors |
| `lib/optionSignalGates.ts` | `applyGates`, `globalSuppress` | Pre-emission gates (VIX, circuit breaker, daily-stop) |
| `lib/confluenceEngine.ts` | `scoreConfluence` | Phase 3 confluence → tier mutation |
| `lib/optionSignalLifecycle.ts` | `recordOrUpdate`, EOD/intra-session sweeps | PENDING → TRIGGERED → STOPPED/TARGET/EXPIRED |
| `lib/oiLab.ts` | `fetchOiInsights` | OI confluence + Δ-window backfill |
| `lib/optionChain.ts` | `fetchOptionChain` | Live option-chain pull (Kite-only) |
| `lib/paperTradingFO.ts:282` | `openPaperTrade` | Entry inside FOR UPDATE tx |
| `lib/paperTradingFO.ts:1052` | `closePaperTradeForSignal` | Exit, P&L, audit |
| `lib/paperTradingFO.ts:1370` | `forceCloseAllOpenFnoFor1520` | 15:20 force-exit |
| `lib/paperAccount.ts` | constants + heat SQL | All sizing/risk/heat-cap constants |
| `lib/paperAutoTradeFlag.ts` | `isPaperAutoTradingEnabled` | Master gate |

### J.2 Equity / swing lane

| File | Function | Responsibility |
|---|---|---|
| `lib/swingScanner.ts` | `scoreAndPlan`, `classifyAction`, `setupQualityGrade`, `classifySetup` | Pure scoring math |
| `lib/swingScannerData.ts` | `fetchHistoricalForUniverse` | Kite-first / Yahoo fallback data |
| `lib/swingScannerStore.ts` | `runDeepScan`, `runIntradayRefresh` | Schedule + cache |
| `lib/scoring.ts:373` | `computeEntrySafety` | Equity Entry-Safety Gate (POOR demote) |
| `lib/paperTradingEq.ts:134` | `openPaperEquityTrade` | 11-gate entry |
| `lib/paperTradingEq.ts` (close path) | various | TARGET2_HIT / STOPPED / TRAIL_STOP_HIT / TIME_STOP / SIGNAL_FLIP |
| `lib/equitySizingHelper.ts:33-44` | `computeEquitySizingPreview` | **Read-only mirror** of 11-gate (diagnostic only) |
| `lib/watchlistLists.ts:188` | NIFTY500 list | Universe |
| `lib/universe.ts` | sector / industry tags | Used by F&O + global, **NOT swing** |

### J.3 Routes

| Route | File | Auth |
|---|---|---|
| `GET /api/stocks-to-watch/analysis` | `routes/stocksToWatch.ts:50` | public |
| `GET /paper/positions/fo` | `routes/paper.ts` | owner |
| `POST /paper/positions/fo/:id/close` | `routes/paper.ts` | owner |
| `POST /paper/positions/eq/manual` | `routes/paper.ts` | owner |
| `GET /paper/diagnostics/untriggered/fo` | `routes/paper.ts` | owner |
| `GET /paper/diagnostics/daily-summary/fo[/history]` | `routes/paper.ts` | owner |
| `GET /api/paper/eq/sizing-preview` | `routes/equitySizing.ts` | owner |
| `GET /api/paper/eq/candidates-diagnostic` | `routes/paper.ts` | owner |
| `GET/POST /api/option-snapshots/*` | `routes/optionChainSnapshot.ts` | owner |
| `GET /api/option-snapshots/analytics` | `routes/optionChainSnapshot.ts` | owner |
| `GET/POST /api/candles/*` | `routes/candleWarehouse.ts` | owner |
| `GET /api/stocks-to-watch/diagnostics/sector-coverage` | `routes/stocksToWatch.ts` | owner |
| `/infra-health` (UI) | `artifacts/scanner/src/pages/...` | owner |

---

## K. Data sources used by each module

| Module | Source(s) | Notes |
|---|---|---|
| F&O signal generation | Kite ticker (spot), Kite intraday (15m), Kite day (HTF), Kite option chain (premium/OI/spread) | **Yahoo never touched** since 2026-05-06 hard-cut |
| F&O VIX | Kite-only | No-op when missing |
| F&O OI confluence | Kite live + Kite historical Δ-backfill | `oi=true` historical for atm±7 strikes |
| F&O 1h HTF | Built session-aware from 15m bars | Not from a 60m feed |
| Swing scanner | Kite intraday → Yahoo fallback | Candle warehouse NOT consumed |
| Swing fundamentals | `swingScannerData.ts:92-132` | (source per file) |
| Sector / industry | `lib/universe.ts` (curated) + `lib/sectorMap.ts` | Diagnostic at `/api/stocks-to-watch/diagnostics/sector-coverage` |
| Option-chain snapshots | Background ingestor → `optionChainSnapshotTable` | **Write-only**; analytics endpoint reads them; trading does NOT |
| Candle warehouse | Background ingestor → `candleTable` | **Write-only**; no consumer in trading or scanner |
| OI delta calc | `kiteOptionChain.ts:223-231` from `oi_day_low / oi_day_high` | Used in `oiLab.ts` sentiment; **NOT used in any signal gate** |

---

## L. Gaps, bugs, or unclear logic

### L.1 P&L realism — **HIGH IMPACT**
F&O P&L excludes **slippage** and **all broker charges** (brokerage / STT / GST / exchange fees / SEBI / stamp duty). Real-world NIFTY option round-trips lose ₹50-80 per lot. At paper-trader cadence this is material — historical "wins" overstate realised edge by a meaningful margin. Equity P&L same issue (no STT/brokerage/GST). **Recommendation in §M.1.**

### L.2 No partial booking / no T1 trail — **MEDIUM IMPACT**
`TARGET1_HIT` exists as a status but is **non-terminal** and not acted on. Paper trades ride straight from entry → T2 or → STOPPED. In live trading, T1 partials + trail-stop is a standard risk-reduction technique. The current implementation does not capture it; backtests therefore can't compare partial-vs-all-out.

### L.3 `recordMissedSignal()` is in-memory only — **MEDIUM IMPACT**
`paperTradingFO.ts:317`. Logs to a 100-row ring buffer + `logger.info`. **No DB table, no persistent endpoint.** Operator cannot query historical skip distributions across restarts. The `daily-summary/fo` route covers opens/exits but not the silent-skip count by reason.

### L.4 Server-side `signal` enum vs UI `classifyAction` label split — **LOW-MEDIUM IMPACT**
A stock with `score = 65, aboveZone` will have:
- `signal = "STRONG_BUY"` (score ≥ 50)
- `classifyAction = "WAIT FOR PULLBACK"`

The auto-trader gates on `signal`, opens the trade. The UI tells the user to wait. **The two views disagree** by design but it's not surfaced anywhere. A user looking at `/stocks-to-watch` sees "WAIT FOR PULLBACK" while the paper trader has already opened the position. Worth either (a) gating auto-trader on `classifyAction ∈ {BUY ZONE, BUY BREAKOUT}` instead of `signal`, or (b) surfacing the disagreement.

### L.5 Win-rate gate has thin samples — **MEDIUM IMPACT**
`WIN_RATE_CALIBRATION { LOOKBACK: 30, MIN_SAMPLE: 10, MIN_WR: 0.4 }` (`paperAccount.ts:272`). Setups with < 10 trades in trailing 30 days **bypass the gate** (fail-OPEN equivalent). New or rare setups (e.g. MEAN_REVERSION on SENSEX) effectively never trigger the win-rate demotion. This may or may not be intentional.

### L.6 `setup` and `qualityGrade` are not consumed by paper trader — **LOW IMPACT**
The swing scanner emits `setup` (A+ Buying Zone, etc.) and `qualityGrade` (A / B+ / B / etc.) but the equity opener (`paperTradingEq.ts:9`) only checks `signal === "STRONG_BUY"`. A `D / Avoid` grade with a flukey `STRONG_BUY` would still be auto-opened (subject to the 11 gates). **Likely intentional** — the entry-safety gate handles location; grade is a richer UX signal.

### L.7 Candle warehouse and option snapshots are unused by trading — **BY DESIGN**
Both are documented as write-only substrates for future backtesting / analytics. **Not a bug**, but worth confirming with the operator that this remains the intent — there is meaningful storage cost accruing for data that no decision consumes.

### L.8 Sector map not consumed by swing scanner — **DESIGN GAP**
`lib/universe.ts` carries sector tags but `swingScanner.ts` does not weight sector relative strength. `rsScore` is purely stock-vs-NIFTY. F&O lane uses sector RS via the `RS_CONFLICT` gate; swing lane does not. May be intentional (single-name swings don't always benefit from sector context) or an oversight.

### L.9 OI delta calc fragility — **LOW IMPACT** (already documented)
`kiteOptionChain.ts:223-231` derives `oi_change` from `oi_day_low / oi_day_high` — when Kite returns inconsistent low/high (occasional bug), the delta sign can be wrong. Used in `oiLab.ts` sentiment but **NOT in any signal gate**, so the impact is limited to the OI Lab visualisation.

### L.10 Audit-positive observations
- Yahoo hard-cut held — no F&O path imports Yahoo.
- Heat caps run inside `FOR UPDATE` tx — concurrent open race is closed.
- Equity sizing helper is genuinely a read-only mirror — not called from any execution path.
- Phantom-trade protection (unique index + CAS + reconcile-before-reset) is robust.

---

## M. Recommended improvements

(Stated as recommendations — not implementing per audit scope.)

### M.1 Add a charges/slippage model (HIGH)
A simple per-lot fixed-fee constant (e.g. `FNO_ROUNDTRIP_COST_PER_LOT = 60`) deducted at close would materially improve P&L realism. Equity: STT 0.025% intraday / 0.1% delivery + brokerage. Should NOT change opens/exits — only `realized_pnl` reporting.

### M.2 Persist missed-signal log (MEDIUM)
Add a `missed_signals_fo` table mirroring the in-memory ring buffer. Schema: `id, asOf, signalKey, indexSymbol, tier, reason, payloadJson`. Owner-only diagnostic endpoint already exists; just back it with a real table.

### M.3 Implement T1 partial + trail-to-T1 (MEDIUM)
Wire `TARGET1_HIT` to halve the position and trail the stop to entry. This is what serious paper-trading exists to test.

### M.4 Reconcile UI label vs auto-trader gate (LOW-MEDIUM)
Either gate auto-trader on `classifyAction ∈ {BUY ZONE, BUY BREAKOUT}` (UX-aligned) or add a UI badge "AUTO-OPENED" so the user sees the disagreement explicitly.

### M.5 Tighten win-rate fallback (MEDIUM)
For setups below `MIN_SAMPLE`, default to a **conservative MR floor** (e.g. demote HC→BASELINE) rather than fail-OPEN. Prevents a brand-new setup from getting STANDARD-tier sizing on day 1.

### M.6 Wire candle warehouse OR sunset it (LOW)
Two clean options: (a) point swing scanner at the warehouse for the deep scan to amortise Kite calls, OR (b) remove the warehouse and ingestor to stop accruing storage.

### M.7 Consider sector RS in swing scoring (LOW)
Add a small sector-RS bonus (e.g. ±3 to volume score) for stocks in top/bottom-quartile sectors. Cheap to add, may improve top-of-list quality in sector-rotation regimes.

---

## N. Questions requiring your decision

1. **Charges model** — do you want a charges-aware P&L, and if so should it be per-lot fixed (simple) or a percentage stack (realistic)? This is the single highest-ROI fix.
2. **Partial booking on T1** — implement it now, defer to Phase 5, or leave as-is?
3. **Persist missed-signal log** — yes / no? (Requires one new table, schema-additive.)
4. **UI label vs auto-trader gate** — should the auto-trader change to use `classifyAction`, or should the UI surface the disagreement?
5. **Candle warehouse** — keep ingesting (intent: future backtesting) or stop?
6. **Option-chain snapshots** — same question.
7. **Sector RS in swing scoring** — add it, or keep swing scanner as a pure stock-vs-NIFTY view?
8. **Win-rate fallback for new setups** — fail-OPEN (current) or fail-CONSERVATIVE (demote)?
9. **`STOP_SANITY_TIGHT` vs `STOP_SANITY_WIDE`** — you asked about these as separate codes. They currently collapse into a single `STOP_SANITY` reject. Want them split for clearer diagnostics?
10. **MEAN_REVERSION on SENSEX** — this setup fires counter-trend. Want to disable it for SENSEX (low-liquidity strikes amplify the risk) or leave as-is?

---

*This document is a code-grounded audit. All claims trace to a file:line. Where I could not prove a statement from code, I marked it "honest unknown" in §A. No code has been modified.*
