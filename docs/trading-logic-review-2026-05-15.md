# Trading Logic Review — F&O Paper Trading + Equity Swing
**Date:** 2026-05-15
**Purpose:** Single-document, code-referenced map of how F&O auto-trading (NIFTY / BANKNIFTY / SENSEX) and equity-swing auto-trading actually decide to open and close trades. Every claim below cites a file and line. Use this as the audit baseline.

---

# PART 1 — F&O PAPER TRADER (NIFTY / BANKNIFTY / SENSEX)

## 1.1 Universe and per-index constants

The F&O lane is locked to three underlyings. Adding/removing an index requires touching all three of these collections; they are not derived from each other.

| Constant | File:line | Value |
|---|---|---|
| `OPTION_INDICES` (signal pipeline) | `lib/optionSignals.ts:51` | NIFTY, BANKNIFTY, SENSEX |
| `FNO_INDICES` (OI Lab backfill) | `lib/oiLab.ts:49` | same three |
| `SIGNAL_INDEX_TO_LTP_KEY` | `lib/optionSignals.ts:64` | maps signal index → LTP cache key |
| `LOT_SIZES` | `lib/optionChain.ts` | NIFTY 75 / BANKNIFTY 15 / SENSEX 10 |
| Strike steps | `lib/optionSignals.ts:51` | NIFTY 50 / BANKNIFTY 100 / SENSEX 100 |
| Expiry cadence | `lib/optionSignals.ts:51` | NIFTY weekly · SENSEX weekly · BANKNIFTY monthly |
| `PAPER_FIXED_LOTS` | `lib/paperAccount.ts:69-73` | NIFTY 10 · BANKNIFTY 30 · SENSEX 40 (overrides dynamic budget for STANDARD-tier opens) |

## 1.2 Signal generation (Phases 1-3 in `lib/optionSignals.ts`)

```
Kite ticker spot ─┐
EMA9/21 + EMA20/50─┤
Intraday VP ──────┼─► detectors emit HC candidates
Regime detector ──┤        │
IVR / IVP ────────┤        ▼
OI confluence ────┘   Phase 3 confluenceEngine.scoreConfluence
                            │
                            ▼
                      tier (HC | BASELINE) + confidence (0-100)
```

| Step | File:line | Notes |
|---|---|---|
| Spot from KiteTicker (Phase 4 WebSocket) | `optionSignals.ts:5` | `getKiteIndexQuotes` |
| Context build (EMA20/50, EMA9/21, regime, ATR) | `optionSignals.ts:253-267` | `buildContext` |
| Intraday volume profile (24-30 × 15m bars) | `optionSignals.ts:333` | fixed VP for VPOC/VAH/VAL |
| Regime label TRENDING / RANGING / VOLATILE / EXPIRY_DAY | `optionSignals.ts:432` | `classifyRegime` |
| IV metrics (IVR/IVP) | `optionSignals.ts:8` | `recordAtmIv` + `computeIvMetrics` |
| OI confluence score | `lib/oiLab.ts` via `optionSignals.ts:19` | `fetchOiInsights` |
| True 1h HTF (EMA9/21 on session-aware 60m bars) | `optionSignals.ts:365-399` | feeds gate HTF1H_CONFLICT |
| Phase 3 confluence engine | `lib/confluenceEngine.ts` | REPLACES per-detector confidence; legacy preserved in `lib/optionSignals.legacyEmit.bak.ts` |
| HC emission floor | `optionSignals.ts:518` | `HC_EMISSION_FLOOR = 65`; below 65 → demoted to BASELINE (`optionSignals.ts:1403, 2306`) |
| Auto-trader floor | `tradingConfig.ts` | `MIN_FNO_TRADE = 65` (aligned with HC floor) |

Sweep cadence: `TRIGGER_SWEEP_INTERVAL_MS = 30_000` (`optionSignals.ts:1718`); `setInterval` at `optionSignals.ts:1775` invokes the emission loop, which calls the lifecycle layer (`optionSignalLifecycle.ts`) which in turn fires `openPaperTrade` / `closePaperTradeForSignal`.

## 1.3 Pre-emission gates (Phase 1 / 2)

These gates run **before** a signal is emitted. They either suppress globally (no HC ever leaves) or demote HC → BASELINE.

| Gate | File:line | Effect |
|---|---|---|
| `globalSuppress` (VIX intraday spike ≥5%, day spike ≥7%, circuit breaker) | `optionSignalGates.ts:55-60` | Kills HC emission entirely |
| Sticky daily-stop circuit breaker | `optionSignalGates.ts:34, 425` | `DAILY_STOP_LIMIT = 2` stops in a day |
| Regime EXPIRY_DAY | `optionSignals.ts:432` + paper-trader gate | Forces tier mutation to BASELINE |
| EMA stack alignment | `optionSignals.ts:253-267` | Feeds confluence weights, not a hard reject |
| VIX source | `optionSignalGates.ts` | **Kite-only** as of HARD-CUT 2026-05-06; `tradingConfig.isActionableForFno` returns false for `DELAYED_YAHOO` |

## 1.4 Post-emission gates on the paper-trader side

These run inside `openPaperTrade` (`paperTradingFO.ts:282`) inside a `db.transaction` with `FOR UPDATE` (`paperTradingFO.ts:564`) so two simultaneous opens cannot both clear the heat budget.

The combined `isDemoted` partition (HC → BASELINE) is:
```
isDemoted = volClamped || htfConflictGate || noiseWindow || inExpiryDay
          || htf1hConflictGate || rsConflictGate || lowWinRateGate
```
Demoted setups partition OUT of the top-3 HC pool BEFORE slicing, then append as BASELINE-tier extras. **ATM-OI gate is OUT of the partition** (post-emission tier mutation, not pre-emission demotion). All Phase 3 gates **fail-OPEN** on data failure (the open still happens) — except `PORTFOLIO_HEAT` and `BASELINE_GUARDRAIL_STATS_UNAVAILABLE`, which fail-CLOSED.

| Gate | Constant / file:line | Audit tag | Effect | Data-failure mode |
|---|---|---|---|---|
| F&O option-leg liquidity | `FNO_LIQUIDITY` (LTP≥20, spread≤1.5%, OI≥50k) — `paperAccount.ts:194-201` | `LIQUIDITY_LTP` / `LIQUIDITY_SPREAD` / `LIQUIDITY_OI` | Reject open | Fail-OPEN |
| F&O 15:20 IST force-exit | `forceCloseAllOpenFnoFor1520`, latch `lastForceExit1520Date`; lifecycle sweep `optionSignalLifecycle.ts:760`; close path `paperTradingFO.ts:1370` | `TIME_EXIT_1520` (close-side: `EXPIRED`) | Close all open FNO | — |
| Vol-clamped stop | `MAX_STOP_PCT_OF_SPOT = 0.45%`, `STOP_ATR_MULT = 0.6×`, `VOL_CLAMP_REJECT_RATIO = 1.5` — `optionSignals.ts:481-498` | `VOL_CLAMPED_STOP` | Reject above 1.5×; below → demote HC→BASELINE | Fail-OPEN |
| HTF (daily-EMA50) | `ctx.htfBias` opposes direction | — | Demote HC→BASELINE | Fail-OPEN |
| True 1h HTF | EMA9/21 on session-aware 60m bars — `optionSignals.ts:365-399` | `HTF1H_CONFLICT` | Demote HC→BASELINE | Fail-OPEN |
| Time-of-day windows | 09:15-09:30 / 15:15-15:30 IST; HC late cutoff 15:25; BASELINE late cutoff 14:45 — `paperTradingFO.ts:426, 435` | `OPENING_NOISE` / `CLOSING_NOISE` / `TIME_FILTER_LATE` / `BASELINE_LATE` | Demote HC→BASELINE (or hard-reject BASELINE late) | — |
| Expiry-day | `regime === "EXPIRY_DAY"` | `EXPIRY_DAY` | Demote HC→BASELINE | — |
| Sector relative strength | `RELATIVE_STRENGTH.TOLERANCE_PCT = 1.0` (NIFTY exempt) — `paperAccount.ts:288` | `RS_CONFLICT` | Demote HC→BASELINE | Fail-OPEN |
| 30-day setup win-rate | `WIN_RATE_CALIBRATION {LOOKBACK:30, MIN_SAMPLE:10, MIN_WR:0.4}` — `paperAccount.ts:272` | `LOW_WINRATE` | Demote HC→BASELINE | Fail-OPEN |
| ATM-strike OI confluence | Both legs vote against direction (`|atmVote| ≥ 2`) | `OI_ATM_CONFLICT` | Mutate tier="BASELINE" (post-emission) | Fail-OPEN |
| Post-stop cool-down | 60min, 0.5× lot multiplier, index-scoped — `paperAccount.ts:216` | — | Sizing scale only | — |
| VOLATILE regime sizing | `REGIME_SIZING.VOLATILE_MULT = 0.5` | — | Sizing scale only | — |
| Portfolio heat cap | `PORTFOLIO_HEAT.MAX_FNO_HEAT_PCT = 0.06`, `MAX_EQ_HEAT_PCT = 0.06` — `paperAccount.ts:241, 307` | `HEAT_CAP_BREACHED` | Reject open; runs in same `FOR UPDATE` tx | **Fail-CLOSED** |
| BASELINE guardrail stats unavailable | `getBaselineDayStats` | `BASELINE_GUARDRAIL_STATS_UNAVAILABLE` | Reject BASELINE open | **Fail-CLOSED** |
| Daily DD cap | `MAX_DAILY_LOSS_PCT = 0.025` | `DAILY_DD_CAP` | Block opens; sticky latch | — |
| Weekly DD cap | `MAX_WEEKLY_LOSS_PCT = 0.05` | `WEEKLY_DD_CAP` | Block opens; sticky latch | — |

## 1.5 Sizing — sub-tiered BASELINE + fixed-lot overrides

Two sizing systems coexist: **fixed-lot overrides** for STANDARD tier (so a 10-lot NIFTY trade is always 10 lots regardless of notional risk math), and **risk-percent sizing** for the sub-tiered BASELINE lane.

| Tier | Confidence band | Risk % of seed | File:line |
|---|---|---|---|
| MICRO | 55-59 | 0.25% | `paperAccount.ts:127-140, 161` (`FNO_BASELINE_RISK`) |
| BASELINE | 60-64 | 0.50% | same |
| STANDARD | 65+ | 2.00% | same |

`PAPER_FIXED_LOTS` (`paperAccount.ts:69-73`) overrides dynamic budget for STANDARD-tier opens only. The interaction: dynamic budget computes `lots = budget / perLotLoss`, but if `PAPER_FIXED_LOTS[index]` is set and the tier is STANDARD, that count wins (`paperTradingFO.ts:671`).

**`FNO_BASELINE_GUARDRAILS`** (`paperAccount.ts:146-155`):
- Max **2 BASELINE trades/day**.
- Daily loss cap **0.75%** (incl. unrealised on open BASELINE positions).
- **2-loss lane lock** (`MAX_CONSECUTIVE_LOSSES = 2`).
- BASELINE-only **14:45 IST late-entry cutoff** (vs 15:25 HC).
- `getBaselineDayStats` **fails CLOSED** via `BASELINE_GUARDRAIL_STATS_UNAVAILABLE`.

## 1.6 Entry path — `openPaperTrade` (`paperTradingFO.ts:282`)

Inside `db.transaction`:

1. **Identity lock**: `SELECT ... FOR UPDATE` on the paper account row (`paperTradingFO.ts:564`) — serializes opens.
2. **Liquidity check**: fresh `fetchOptionChain` call to verify LTP/spread/OI on the ATM strike (`paperTradingFO.ts:494-550`).
3. **Heat budget**: computes current open risk via the canonical `HEAT_SQL_FNO` fragment (`paperAccount.ts:307`). **Critical:** column names must match `paper_trade_fo.entry_premium / stop_premium` exactly — typos here surface as a `Failed query` warn that silently skips trade opens (the 2026-05-13 fix).
4. **Strike selection**: ATM via `nearestStrike` (`optionSignals.ts:76`), respecting per-index strike step.
5. **Premium fetch**: from the same `fetchOptionChain` pull (`paperTradingFO.ts:497`).
6. **Persistence**: insert into `paper_trade_fo` with `status='OPEN'` (`paperTradingFO.ts:738`).

## 1.7 Exit path — `closePaperTradeForSignal` (`paperTradingFO.ts:1052`)

Triggers (any one closes the position):
- `STOPPED` — premium hits stop (mark-to-market via fresh `fetchOptionChain`, `paperTradingFO.ts:1232`).
- `TARGET2_HIT` — premium hits final target.
- `EXPIRED` — 15:20 IST force-exit via lifecycle sweep (`optionSignalLifecycle.ts:760`).
- Manual close — owner UI calls `POST /paper/positions/fo/:id/close`, which **also refreshes `lastPremium` from a fresh `fetchOptionChain` pull** (replit.md "Gotchas").

Audit trail recorded on close (`paperTradingFO.ts:1145`): `exit_reason`, `exit_premium`, `realized_pnl`, `exited_at`. The closed row anchors next-day reconciliation.

## 1.8 Scheduler

- `setInterval(TRIGGER_SWEEP_INTERVAL_MS = 30_000)` in `optionSignals.ts:1775`.
- Hard rule from replit.md "Gotchas": **do not poll faster than 15s** (Kite throttling).
- Master gate: `isPaperAutoTradingEnabled()` (`paperAutoTradeFlag.ts`) checks `PAPER_TRADING_ENABLED` env (1/true/yes/on enable; anything else disable; fail-closed on unrecognised) → falls back to `REPLIT_DEPLOYMENT === "1"` auto-detect.
- When the gate is false, `runEquityPaperTradingTick`, `tryOpenPaperTrades`, `reconcileMissingPaperTrades`, and the inner `openPaperTrade` (FO) all **early-return**. Manual buys/closes are NOT gated.

---

# PART 2 — EQUITY SWING (Pro Swing Scanner v3 → Equity Paper Trader)

## 2.1 Universe and cadence

| Item | File:line | Value |
|---|---|---|
| Universe | `lib/swingScannerStore.ts:36` | NIFTY 500 |
| Deep scan | `swingScannerStore.ts:42, 369-379` | once-per-day after **15:35 IST** |
| Intraday LTP refresh | `swingScannerStore.ts:45, 243-292` | every **15 minutes** during 09:15-15:30 IST |
| Cold-start latch | `swingScannerStore.ts:401-423` | keys off `swing_scan_run` audit row, not result rows. Single-replica assumption. |

## 2.2 Scoring inputs — `lib/swingScanner.ts` (pure math)

| Group | Inputs | File:line |
|---|---|---|
| Trend | EMA 20 / 50 / 200 stack | `swingScanner.ts:77-102` |
| Trend | RSI 14 | `swingScanner.ts:146-153` |
| Trend | ADX 14 | `swingScanner.ts:128-138` |
| Volume | Volume ratio vs 20-day avg | `swingScanner.ts:185-190` |
| Volume | Volume profile (VAH / VAL / POC) | `swingScanner.ts:198-203` |
| Structure | Pivot-based BOS / CHoCH, bullish/bearish sweeps | `swingScanner.ts:402-446` |
| Structure | Fair-value-gap (FVG) detection | `swingScanner.ts:453-469` |
| Relative strength | vs NIFTY 50 over 20 / 50 / 120 days | `swingScanner.ts:123-126` |
| Fundamentals | P/E, P/B, ROE, D/E, revenue/earnings growth | `swingScanner.ts:83-99` + `swingScannerData.ts:92-132` |

Final score (`scoreAndPlan`): weighted technical+momentum+volume, clamped 0-100 (`swingScanner.ts:205-206`). Signal classification (`swingScanner.ts:210-214`):
- `STRONG_BUY` — score ≥ 50
- `BUY` — score ≥ 22
- (lower bands: NEUTRAL / SELL / STRONG_SELL)

## 2.3 API surface — `GET /api/stocks-to-watch/analysis`

Route: `artifacts/api-server/src/routes/stocksToWatch.ts:50`. Returns `asOf`, `scanDate`, `runMeta`, `scheduler`, and `rows[]`. Each row exposes `score`, `signal`, `qualityGrade`, `setup`, `potential`, S/R levels, target, SL, and `reasons[]` (`swingScannerStore.ts:95-155`).

UI: `artifacts/scanner/src/pages/stocks-to-watch.tsx:204` renders the "Technical Analysis — NIFTY 500" section. The page has 3 sections total:
1. News Catalyst Deck (Watch / Avoid columns) — `lines 403-416`.
2. Summary meta (scan stats / scheduler state) — `lines 212-218`.
3. Analysis table (16 columns: Score, Action, Setup, Grade, R:R, Live LTP/Change) — `lines 251-329`.

## 2.4 Equity Entry-Safety Gate — `lib/scoring.ts:computeEntrySafety()` (line 373)

Surfaces `entryQuality` ∈ {GOOD, FAIR, POOR} + `entryPlan`:
- **POOR** — price extended (today change > 2.5%) into major resistance/support (`scoring.ts:430`).
- **FAIR** — inside the 3% proximity ring of a major level (`scoring.ts:446`).
- **GOOD** — no immediate overhead resistance or extension concerns (`scoring.ts:459`).

**POOR demotes `STRONG_BUY → BUY`** (audit tags `LATE_ENTRY_AT_RESISTANCE` / `LATE_ENTRY_AT_SUPPORT`, `scoring.ts:230-242, 437`). Because the equity paper-trader auto-open path **requires `STRONG_BUY`** (`paperTradingEq.ts:9`), this demotion is what naturally blocks "buying into resistance" without needing a separate hard gate.

`entryPlan` returns suggested entry logic ("Wait for pullback to VWAP", etc.) surfaced via `EntryPlanCard` on stock-detail (`scoring.ts:462-520`).

## 2.5 Equity paper trader — `openPaperEquityTrade` 11-gate sequence

Order is identical between the actual opener (`lib/paperTradingEq.ts:134-389`) and the read-only mirror (`lib/equitySizingHelper.ts:33-44`) used by `/api/paper/eq/sizing-preview`. **This identity is the safety property** — operator can preview the verdict without taking a position.

| # | Gate | File:line | Check |
|---|---|---|---|
| 1 | `INVALID_STOP` | `paperTradingEq.ts:115-132` | entry/stop are valid finite numbers; stop on the correct side |
| 2 | `STOP_SANITY` | `paperTradingEq.ts:139` | stop distance in **[1%, 8%]** (`EQUITY_STOP_SANITY`) |
| 3 | `DD_DAILY` | `paperTradingEq.ts:170` | daily realised DD ≥ **2%** of seed |
| 4 | `DD_WEEKLY` | `paperTradingEq.ts:183` | weekly realised DD ≥ **4%** |
| 5 | `DD_MONTHLY` | `paperTradingEq.ts:196` | monthly realised DD ≥ **8%** |
| 6 | `DAILY_CAP` | `paperTradingEq.ts:243` | max **3 new entries/day** |
| 7 | `CONCURRENT_CAP` | `paperTradingEq.ts:255` | max **10 concurrent open** positions |
| 8 | `DEPLOY_LE_0` | `paperTradingEq.ts:291` | per-slot allocation > 0 |
| 9 | `QTY_LT_1` | `paperTradingEq.ts:308` | allocation buys at least 1 share |
| 10 | `INSUFF_BAL` | `paperTradingEq.ts:343` | cash balance ≥ rounded notional |
| 11 | `HEAT_CAP` | `paperTradingEq.ts:370` | projected heat ≤ **6%** of seed |

`EQUITY_DD_CAPS` definition: `paperAccount.ts:341` (2/4/8% of ₹10L).
Date anchors: daily = current IST date (`paperAccount.ts:381`); weekly = current IST week Monday (`paperAccount.ts:47, 49`); monthly = first day of current month (`paperAccount.ts:48`).

## 2.6 Exit conditions

`paperTradingEq.ts:71-77, 9-16`:
- `TARGET2_HIT` — final target reached.
- `STOPPED` — stop-loss hit.
- `TRAIL_STOP_HIT` — stop trails to T1 after T1 reached.
- `TIME_STOP` — 30 trading days elapsed.
- `SIGNAL_FLIP` — underlying signal turns `STRONG_SELL`.
- `MANUAL_OVERRIDE` — owner UI close.

Mark-to-market: re-evaluated against the latest LTP from the scanner cache during each re-evaluation tick (`paperTradingEq.ts:6`).

## 2.7 Scheduler + reconciliation

- `runEquityPaperTradingTick` is gated by `isPaperAutoTradingEnabled()` (`paperAutoTradeFlag.ts:26`).
- `ensureDailyReset("EQUITY")` rolls day counters but **preserves balance and open positions** (`paperAccount.ts:467, 480-485`).
- `reconcileMissingPaperTrades` reads `h.tier AS persisted_tier` (replit.md "Gotchas") to **prevent post-deploy re-promotion** of trades that were originally opened as BASELINE.

---

# PART 3 — Cross-cutting properties

## 3.1 F&O ↔ Equity isolation (verified)

| Surface | F&O lane | Equity lane |
|---|---|---|
| Account segment | FNO | EQUITY |
| Seed capital | ₹2 L | ₹10 L |
| Heat cap | `MAX_FNO_HEAT_PCT = 6%` (`paperAccount.ts:241`) | `MAX_EQ_HEAT_PCT = 6%` (`paperAccount.ts:241`) — **independent** |
| DD caps | 2.5% / 5% (daily / weekly) | 2% / 4% / 8% (daily / weekly / monthly) |
| Tables | `paper_trade_fo` | `paper_trade_eq` |
| Schedulers | 30s sweep | per-tick on scanner refresh |

Heat budgets **do not pool**. The combo lane (`paper_trade_combo`) is a third, fully-isolated bucket — it is **opted out of the 15:20 force-exit** (replit.md "Combo paper-trader lane").

## 3.2 Dev-vs-prod isolation

`PAPER_TRADING_ENABLED` env override (1/true/yes/on enable; anything else disable; fail-closed on unrecognised) → falls back to `REPLIT_DEPLOYMENT === "1"`. Dev workspace is **read-only** for the auto-trader by default; manual buys (`POST /paper/positions/eq/manual`) and manual closes are NOT gated. EQ mark-to-market still runs in dev so existing OPEN positions move correctly.

## 3.3 Audit observability surfaces

| Endpoint | What it shows | Gating |
|---|---|---|
| `GET /paper/diagnostics/untriggered/fo` | Skip reasons grouped by reason / index / tier; 50-row recent log | owner-only |
| `GET /paper/diagnostics/daily-summary/fo` | Today's IST-day metrics with two date anchors (opened-today vs closed-today) | owner-only |
| `GET /paper/diagnostics/daily-summary/fo/history?from=&to=` | Trailing 30-day persisted history from `paper_daily_summary_fo` | owner-only |
| `GET /api/paper/eq/sizing-preview?symbol=&entry=&stop=` | Read-only mirror of the 11-gate sequence | owner-only |
| `GET /api/paper/eq/candidates-diagnostic` | Today's candidate evaluations + rejection histogram + DD bars | owner-only |
| `getOperationalAlerts()` | Process-level counters (e.g. `baselineStatsUnavailableAlertCount`) | owner-only |
| `/infra-health` | Read-only dashboard rolling all of the above | owner-only |

## 3.4 Known gotchas (replit.md)

- **Heat-SQL column-name typos** are silent in logs ("Failed query" + "continuing" warn) but skip trade opens entirely. `paper_trade_fo` uses `entry_premium / stop_premium`; `paper_trade_eq` uses `entry_price / stop_price`.
- **F&O hard-cut from Yahoo (2026-05-06)**: F&O paths NEVER touch Yahoo. `optionSignals.ts` daily history → Kite `day` interval; VIX → Kite-only (no-op when missing); `tradingConfig.isActionableForFno` returns false for `DELAYED_YAHOO`. Yahoo remains only for non-F&O segments.
- **Buy column gating in scanner**: `Row` Buy pill renders only when `signal === "STRONG_BUY" || "BUY"`; everything else shows muted `—`.

---

# PART 4 — Suggested review checklist

Use this when auditing the pipelines:

**For F&O (per index):**
- [ ] `OPTION_INDICES`, `FNO_INDICES`, `SIGNAL_INDEX_TO_LTP_KEY` all contain the index.
- [ ] `LOT_SIZES`, strike step, expiry cadence are correct.
- [ ] `PAPER_FIXED_LOTS[index]` is the value you actually want for STANDARD-tier opens.
- [ ] HC_EMISSION_FLOOR=65 and MIN_FNO_TRADE=65 still aligned.
- [ ] All 13 post-emission gates have current audit-tag emissions in production logs.
- [ ] Portfolio heat cap (`MAX_FNO_HEAT_PCT`) and DD caps are at intended values.
- [ ] No `paper_trade_fo` opens timestamped during a deploy-window outside market hours.

**For equity swing:**
- [ ] Deep-scan ran once today after 15:35 IST (check `swing_scan_run` audit row).
- [ ] `entryQuality` POOR is correctly demoting `STRONG_BUY→BUY` for stocks at resistance.
- [ ] Equity paper-trader 11-gate order in `paperTradingEq.ts` matches `equitySizingHelper.ts` exactly (this is the safety property of the read-only mirror).
- [ ] EQUITY_DD_CAPS daily/weekly/monthly latches are sticky (don't reset until the IST anchor rolls).
- [ ] Equity heat cap (`MAX_EQ_HEAT_PCT`) and concurrent cap (10) at intended values.

**Cross-cutting:**
- [ ] F&O and equity heat budgets are not pooled (separate SQL fragments).
- [ ] Combo lane is opted out of 15:20 force-exit.
- [ ] `PAPER_TRADING_ENABLED=true` set explicitly in production.

---

*This document is a code-referenced map of the trading logic on the main branch as of commit `d0abd123`. It does not advocate for any change. Any future modification should update both this file and the `docs/paper-trader-architecture.md` long-form rationale in the same commit.*
