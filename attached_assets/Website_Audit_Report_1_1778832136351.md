# Website / Trading Data Audit Report

**Backup reviewed:** `db_backup_20260513_132619.tar.gz`  
**Unpacked content:** one PostgreSQL dump, `db_backup_20260513_132619.sql`  
**SQL size:** 3,795 lines  
**Data tables:** 22  
**Total copied rows parsed:** 2,709

> Note: the archive contains database data only. It does not contain frontend source, backend source, page templates, CSS, UI components, API integration code, cron jobs, strategy code, or deployment configuration. UI/code review is therefore limited to what can be inferred from database design and stored outputs.

---

## Executive verdict

The database shows a promising trading-product skeleton: FII/DII, participant OI, IV history, option signals, swing scans, paper trading, alerts, watchlists, screener presets, and global instruments are already represented. However, it is not yet data-rich enough for professional-grade Indian market F&O and swing trading.

The biggest blockers are:

1. `global_candles` has **0 rows**, so there is no persistent OHLCV/OI candle base for backtests, regime detection, or prediction validation.
2. `global_instruments` is mostly global/US/crypto/FX, not an Indian-market master. It has **206 Yahoo equities, 91 crypto pairs, 35 FX pairs, 30 commodities, 30 indices**, but no full NSE/BSE/Kite instrument universe.
3. F&O signals have too little live outcome evidence: **98 signals**, **79 expired**, **16 stopped**, only **3 target hits**.
4. High-conviction F&O signals are not currently proving themselves: **20 high-conviction rows = 15 expired + 5 stopped + 0 targets**.
5. Swing scans are broad but not actionable enough: **1,168 rows**, but **0 BUY NOW**, 100% missing sector/industry, 100% missing intraday trigger fields, and 37 rows scored `>=70` are still marked `AVOID / NO TRADE`.
6. Paper equity sizing has a major bug: **354 of 378 audit rows skipped because allocation was below 1 share**, often around ₹55 per candidate. This makes the paper system unrealistic.
7. The SQL dump includes a Kite session/token row. Even if expired, API/session credentials should not be present in portable database dumps.
8. There are no foreign keys/check constraints, very few data-integrity rules, and no production-grade audit trail for strategy versions.

---

## Table inventory

| Table | Rows | Review |
|---|---:|---|
| fii_dii_daily | 44 | Useful but short history. 29 rows have buy/sell as zero and only net values. |
| global_candles | 0 | Critical gap. No historical OHLCV/OI store. |
| global_instruments | 392 | Global universe, not India-rich. Missing NSE/BSE full master. |
| global_live_prices | 392 | Current snapshots exist, but not Indian-focused. |
| global_sync_logs | 5 | Sync status exists but error logic inconsistent: prior full failures remain while err_count is 0. |
| iv_history | 32 | Too short; no IV rank/percentile, term structure, skew, realized volatility comparison. |
| kite_session | 1 | Sensitive credentials/session storage issue. |
| option_signal_history | 98 | Core F&O system table exists but sample/outcome quality is weak. |
| paper_account | 2 | FNO and EQUITY accounts exist; equity balance/open capital should be reconciled. |
| paper_daily_summary_fo | 3 | Summary pipeline broken/incomplete; 14 signals on 2026-05-13 but 0 valid candidates/trades. |
| paper_eq_audit | 378 | Excellent idea, but mostly skip logs caused by sizing bug. |
| paper_trade_eq | 12 | Too small for performance inference; 2 rows have stop above entry. |
| paper_trade_fo | 7 | Too small; all closed; realized P&L positive but not statistically meaningful. |
| participant_oi_daily | 168 | Good table; 42 trading dates x 4 participant types. Needs derived analytics. |
| swing_scan_result | 1,168 | Broad scanner output, but missing live trigger and sector data. |
| swing_scan_run | 3 | Only 3 scan runs; one day scanned 214 with 286 errors. |
| tv_alerts | 4 | Test alerts only. |
| users | 0 | No subscriber/user data in backup. |
| watchlist/presets tables | 0 | Product personalization not being used yet. |

---

## F&O system audit

### What exists

The F&O model stores:

- index symbol, setup key, direction, strike, option type
- spot entry/SL/targets
- option entry/SL/targets for many recent rows
- confidence, tier, setup name
- triggered/exited timestamps
- status, exit reason, MFE/MAE

This is a good foundation.

### Actual evidence in the backup

- Total F&O signals: **98** from 2026-04-27 to 2026-05-13
- Status split: **79 expired**, **16 stopped**, **2 target1**, **1 target2**
- Tier split: **78 baseline**, **20 high-conviction**
- High-conviction performance: **15 expired**, **5 stopped**, **0 target hits**
- Non-expired actionable outcomes: 19 rows; only 3 target hits, about **15.8% target-hit rate** among non-expired rows
- Option premium fields are missing in **29 rows**
- Four spot setups had RR to target1 below 1R
- Exit reasons include `EXPIRED_TRIGGERED`, `EXPIRED_PENDING`, `STALE_TRIGGER`, `STOPPED`, `TARGET2_HIT`

### Concerns

1. **Too many expired signals**  
   Expired/pending/stale outcomes dominate. This suggests the system is producing levels but not sufficiently filtering for time-to-trigger, liquidity, volatility window, or session context.

2. **High-conviction label is not justified yet**  
   High-conviction rows had higher average confidence but no targets in the available sample. Confidence must be calibrated against outcomes.

3. **Missing option premium data weakens risk validation**  
   Option trades should be judged on option premium behavior, not only spot levels. Every signal should store option token, bid/ask, spread, IV, delta, gamma, theta, vega, OI, volume, and depth at signal time.

4. **Need option-chain context**  
   There is no complete option-chain snapshot table. For Indian F&O, entry quality depends heavily on PCR, OI buildup, IV skew, max pain, ATM straddle, premium decay, liquidity, spread, and expiry-day behavior.

5. **No strategy versioning**  
   Signals do not store the exact rules/version/features used to produce them. Backtesting and improvement become unreliable without this.

6. **No market-regime gate**  
   F&O entries should behave differently in trend day, range day, gap day, expiry day, event day, high-VIX day, and low-liquidity periods.

### F&O improvements

Add these tables/features:

- `kite_instruments_daily` with exchange, tradingsymbol, instrument_token, expiry, strike, lot_size, tick_size, segment, instrument_type
- `index_candles` for NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, SENSEX, BANKEX across 1m/3m/5m/15m/day
- `option_chain_snapshots` for every tracked expiry/underlying
- `option_greeks_snapshots`
- `straddle_snapshots`
- `pcr_history`
- `oi_buildup_history`
- `market_regime_daily_intraday`
- `signal_feature_snapshot`
- `strategy_versions`
- `signal_backtest_results`

Minimum F&O signal filter to add before trade eligibility:

- option spread below defined maximum
- option volume/OI above threshold
- IV not extremely elevated unless using momentum scalp logic
- entry only if price confirms after 5m/15m close and market breadth agrees
- avoid fresh longs into nearby supply or max pain magnet unless breakout confirmed
- avoid signals after a time cutoff unless intraday scalping strategy is explicitly enabled
- separate expiry-day rules from non-expiry rules
- separate index behavior by instrument; BANKNIFTY/SENSEX risk is not same as NIFTY/FINNIFTY

---

## Swing cash trading audit

### What exists

The swing scan table is strong in structure. It stores:

- action, setup, grade, potential, score
- technical, SMC, volume, momentum, fundamental, risk, context, RS scores
- entry, stop, target, RR
- RSI, ADX, ATR, volume ratio, value traded
- 52-week high/low distance
- trend/candle/market-structure labels
- reasons and warnings as JSON arrays

This is a good base for a serious scanner.

### Actual evidence in the backup

- Rows: **1,168**
- Unique symbols: **477**
- Scan dates: 2026-05-11, 2026-05-12, 2026-05-13
- Latest scan count: **477** on 2026-05-13
- Actions overall: **960 Avoid**, **147 Watchlist**, **54 Wait for Confirmation**, **7 Wait for Pullback**, **0 Buy Now**
- Latest scan actions: **408 Avoid**, **52 Watchlist**, **16 Wait for Confirmation**, **1 Wait for Pullback**
- Sector and industry are null in **100%** of rows
- Intraday fields are null in **100%** of rows
- `trigger_hit` is null in **100%** of rows
- 37 rows scored `>=70` but were still marked `AVOID / NO TRADE`
- 2026-05-12 scan had only **214 scanned** and **286 errors**

### Concerns

1. **Scanner is descriptive, not executable**  
   It produces many watch/avoid rows, but no live trigger state. A swing trader needs “alert me when X closes above trigger with Y volume and Z market regime”.

2. **Sector/industry missing**  
   Indian swing trading is sector-rotation heavy. Missing sector data weakens relative-strength scoring.

3. **No trigger lifecycle**  
   A candidate should progress from `watchlist` → `triggered` → `active` → `invalidated` → `closed`. Currently it is mostly static scan output.

4. **Scores and action labels are inconsistent**  
   High scores marked avoid will confuse users. Either scoring weights or action thresholds need revision.

5. **Only three scan days**  
   No professional strategy evaluation can be done from three scan dates.

6. **Risk and position sizing are disconnected**  
   Entries/stops/targets exist, but the paper account sizing logic is faulty.

### Swing improvements

Add:

- sector and industry mapping for every NSE/BSE symbol
- sector breadth, sector RS, stock-vs-sector RS, stock-vs-NIFTY RS
- daily and weekly candles for at least 3–5 years
- corporate-action adjusted historical candles
- delivery quantity, delivery %, volume shock, value traded filters
- earnings date, results recency, pledge, promoter holding, debt/equity, sales/profit growth
- trigger lifecycle table
- alert table with close-confirmed triggers
- invalidation rules
- portfolio-level exposure caps by sector and correlation

Better swing labels:

- `BUY NOW` only after trigger close + volume confirmation
- `BUY ON PULLBACK` for structurally strong but extended stocks
- `WATCH ABOVE TRIGGER` for breakout candidates
- `AVOID - WEAK TREND`
- `AVOID - OVEREXTENDED`
- `AVOID - LIQUIDITY`
- `AVOID - FUNDAMENTAL RISK`

---

## Kite API architecture recommendation

Use Kite as the primary Indian market data and trading bridge, but do not treat it as an unlimited historical warehouse. Store your own clean database.

Recommended pipeline:

1. Download Kite instrument master daily around pre-market.
2. Store it by `exchange + tradingsymbol`, not only `instrument_token`.
3. Cache derivative instruments daily because expired derivative tokens are not available later unless you saved them.
4. Use REST quote APIs for snapshots and reconciliation.
5. Use WebSocket for live ticks and build your own 1m/3m/5m/15m candles.
6. Use historical API to backfill candles gradually while respecting rate limits.
7. Partition candles by timeframe/date/symbol.
8. Store raw tick/candle source, fetch time, and data-quality flags.
9. Never call Kite directly from browser; use backend only.
10. Never store API secret/session tokens in exported backups.

---

## Database/schema improvements

Add constraints:

- CHECK status in allowed status list
- CHECK action in allowed action list
- CHECK direction in `BULLISH/BEARISH/NEUTRAL`
- CHECK stop/target sanity based on long/short direction
- CHECK option premium, lot size, quantity > 0
- CHECK score between 0 and 100
- CHECK RR positive

Add foreign keys:

- trades → signal history
- scans → scan run
- instruments → price/candle/signal tables
- watchlists → users/session

Add indexes:

- `swing_scan_result(symbol, scan_date)` already has PK; add `(scan_date, action, score desc)`, `(sector, scan_date, score desc)`, `(symbol, action)`
- `option_signal_history(signal_date, index_symbol, tier, status)`
- `paper_trade_fo(signal_date, index_symbol, status)`
- `participant_oi_daily(date, client_type)`
- `global_live_prices(source, updated_at)`
- Candle hypertables/partitions by timeframe/date

Add versioning:

- `strategy_versions`
- `feature_snapshots`
- `model_predictions`
- `backtest_runs`
- `walk_forward_results`
- `trade_journal_events`

---

## UI/UX recommendations

The data should be displayed as decision intelligence, not as raw tables.

Suggested layout:

1. **Market cockpit**: NIFTY/BANKNIFTY/SENSEX, India VIX, breadth, advance/decline, sector heatmap, FII/DII, participant OI, top gainers/losers.
2. **F&O cockpit**: option chain, PCR, OI change, IV rank, ATM straddle, max pain, support/resistance, live signal feed, risk panel.
3. **Swing cockpit**: sector rotation, top watchlist, trigger-near stocks, pullback candidates, risk per trade, active positions.
4. **Signal detail page**: why signal came, features, entry/SL/targets, option liquidity, invalidation, similar historical examples, backtest stats.
5. **Data quality banner**: stale feeds, missing candles, API errors, scan error count.

Visual design:

- Dark theme default for trading desks: deep navy/charcoal background.
- Use green/red carefully and always pair with icons/text because red-green color blindness is common.
- Font: Inter or IBM Plex Sans for UI; JetBrains Mono/Roboto Mono for prices, Greeks, OI, and tabular numbers.
- Use heatmaps for OI, breadth, sectors, and score components.
- Use badges: `Live`, `Delayed`, `Stale`, `Backtest Missing`, `Low Liquidity`, `High Spread`.
- Make all numbers scan-friendly: Indian separators, consistent decimals, timestamps in IST.
- Keep “trade action” visually separate from “analysis only”.

---

## Highest-priority fixes

1. Rotate/remove Kite credentials from database exports.
2. Populate `global_candles` or create a proper Indian candle warehouse.
3. Build a daily Kite instrument master cache.
4. Add option-chain snapshots and derived F&O analytics.
5. Fix equity paper-trading position sizing.
6. Add sector/industry mapping and relative-strength calculations.
7. Add intraday trigger updates for swing scans.
8. Add strategy versioning and feature snapshots.
9. Add constraints and foreign keys.
10. Add backtesting/walk-forward reporting before showing confidence labels.

---

## Final assessment

The current system is a good prototype database for a trading dashboard, but it is not yet “pro trader” grade. The direction is right, especially with participant OI, FII/DII, IV history, swing scan reasons/warnings, and paper-trading tables. The missing professional layer is historical market depth, complete Indian market coverage, option-chain intelligence, robust backtesting, signal calibration, live trigger management, and data-quality controls.

The most important shift: move from “scanner outputs” to a full evidence loop:

**raw data → features → signal → execution eligibility → paper/live outcome → attribution → recalibrated strategy**

Without this loop, confidence scores and predictions will look precise but will not be trustworthy.
