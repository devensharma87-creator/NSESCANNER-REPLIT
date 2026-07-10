# Full Platform Route & Dataflow Map
**Generated:** 2026-07-09  
**Audit program:** FULL_PLATFORM_AUDIT_AND_FIX_PROGRAM Phase 0  
**Status:** FULL_PLATFORM_AUDIT_BASELINE_CREATED

---

## 1. All API Routes (prefix: /api/)

### Auth & Session
| Method | Path | File | Auth | Description |
|---|---|---|---|---|
| GET | /auth/status | auth.ts | public | Session cookie status |
| GET | /auth/public-mode | auth.ts | public | Is public-access on? |
| POST | /auth/public-mode | auth.ts | owner | Toggle public access |
| POST | /auth/login | auth.ts | public | HMAC-SHA256 password login |
| POST | /auth/logout | auth.ts | session | Logout |
| GET | /auth/me | userAuth.ts | session | Current user info |
| POST | /auth/signup | userAuth.ts | public | Create user account |
| POST | /auth/user-login | userAuth.ts | public | User login (non-owner) |

### System & Health
| Method | Path | File | Auth | Description |
|---|---|---|---|---|
| GET | /healthz | health.ts | public | Liveness probe |
| GET | /build-info | buildInfo.ts | public | Build markers, commit SHA, checkpoint markers |
| GET | /system/status | system.ts | session | System status aggregate |
| GET | /security/audit | system.ts | owner | Security audit |
| GET | /data-health/market | dataHealth.ts | session | Kite/Yahoo/NSE health |
| GET | /data-health/global | dataHealth.ts | session | Global data health |
| GET | /data-health/backbone | dataHealth.ts | session | Market data backbone health |
| GET | /provider/status | scanner.ts | session | Provider (Kite/Yahoo) status |
| GET | /scan/health | scanner.ts | session | Scanner health |
| GET | /alerts/status | alerts.ts | session | Alert system status (incl. Telegram bots) |
| GET | /alerts/system-health | alerts.ts | owner | System-level health alerts |

### Kite Connect
| Method | Path | File | Auth | Description |
|---|---|---|---|---|
| GET | /kite/status | kite.ts | owner | Session active? Token age? |
| GET | /kite/login-url | kite.ts | owner | OAuth login URL |
| GET | /kite/callback | kite.ts | public | OAuth callback handler |
| POST | /kite/warmup | kite.ts | owner | Warm up Kite data |
| POST | /kite/logout | kite.ts | owner | Invalidate Kite session |
| POST | /kite/refresh-instruments | kite.ts | owner | Reload instrument master |
| GET | /kite/export-session | kite.ts | ownerStrict | Export session token |
| GET | /kite/export-instruments | kite.ts | ownerStrict | Export instrument CSV |
| POST | /kite/import-session | kite.ts | ownerStrict | Import session token |
| POST | /kite/subscribe | kite.ts | owner | Subscribe WebSocket tickers |
| GET | /kite/quotes | kite.ts | session | Batch quotes |
| GET | /kite/quote/:symbol | kite.ts | session | Single quote |
| GET | /kite/stream | kite.ts | owner | SSE live stream |

### Market Data & Indices
| Method | Path | File | Auth | Description |
|---|---|---|---|---|
| GET | /market/summary | scanner.ts | session | Market-wide summary (breadth, VIX, movers) |
| GET | /market/global | scanner.ts | session | Global indices (Dow, S&P, Asia, Europe) |
| GET | /market/trend | scanner.ts | session | NIFTY trend classification |
| GET | /market/macroHistory | scanner.ts | session | Macro history data |
| GET | /market/events | scanner.ts | session | Market events calendar |
| GET | /market/premarket | scanner.ts | session | Pre-market data |
| GET | /indices | indices.ts | session | NSE indices board (NIFTY50, MidCap, SmallCap etc.) |
| GET | /index/:slug | scanner.ts | session | Single index detail (NIFTY50, BANKNIFTY etc.) |
| GET | /home/enrichment | home.ts | session | Home page enrichment (sectoral, MMI, breadth) |

### Stocks & Scanner
| Method | Path | File | Auth | Description |
|---|---|---|---|---|
| GET | /stocks | scanner.ts | session | All stocks (NIFTY 500) with quotes |
| GET | /stocks/:symbol | scanner.ts | session | Single stock detail |
| GET | /stocks/:symbol/statements | scanner.ts | session | Financial statements |
| GET | /stocks/:symbol/history | scanner.ts | session | Price history |
| GET | /sectors | scanner.ts | session | Sector list with performance |
| GET | /sectors/:sector | scanner.ts | session | Single sector detail |
| GET | /scan/top | scanner.ts | session | Top movers/signals |
| GET | /scan/full-nse | scanner.ts | session | Full NSE 500 scan results |
| GET | /scan/full-nse/status | scanner.ts | session | Full scan status |
| GET | /scan/full-nse/export | scanner.ts | owner | Export full scan as CSV |
| GET | /stocks-to-watch | stocksToWatch.ts | session | Combined stocks-to-watch (setup signals + Pro Swing v3) |
| GET | /stocks-to-watch/analysis | stocksToWatch.ts | session | Pro Swing Scanner v3 analysis |
| GET | /deepscan/lookup | deepscan.ts | session | Deep scan symbol lookup |
| GET | /deepscan/snapshot/:symbol | deepscan.ts | session | Deep scan snapshot for symbol |
| GET | /news | scanner.ts | session | News RSS feed |
| GET | /watchlist/:key | scanner.ts | session | Named watchlist |
| GET | /watchlist/basket/:basketKey | scanner.ts | session | Basket watchlist |
| GET | /personal-watchlist | userAuth.ts | session | Personal watchlist |
| POST | /personal-watchlist | userAuth.ts | session | Add to personal watchlist |
| DELETE | /personal-watchlist/:symbol | userAuth.ts | session | Remove from personal watchlist |

### ETF
| Method | Path | File | Auth | Description |
|---|---|---|---|---|
| GET | /etf/diagnostics | scanner.ts | owner | ETF data diagnostics |
| GET | /etf/:symbol/quote | scanner.ts | session | ETF quote |
| GET | /etf/:symbol/nav | scanner.ts | session | ETF NAV |

### F&O Signals
| Method | Path | File | Auth | Description |
|---|---|---|---|---|
| GET | /options/signals | scanner.ts | session | Current F&O signals (live cycle result) |
| GET | /options/signal-history | scanner.ts | session | Historical signal rows |
| GET | /options/signal-report | scanner.ts | session | Signal report by date |
| GET | /options/signal-report/dates | scanner.ts | session | Available report dates |
| GET | /options/signal-report/export | scanner.ts | owner | Export signal report CSV |
| GET | /fno/data-health | fno.ts | session | F&O data health (bars, chain, readiness) |
| GET | /fno/diagnostics/today | fno.ts | owner | Today's F&O diagnostics |
| GET | /fno/diagnostics/gate-waterfall | fno.ts | owner | Signal gate waterfall |
| GET | /fno/diagnostics/no-trade-reasons | fno.ts | owner | No-trade reason breakdown |
| GET | /fno/diagnostics/setup-performance | fno.ts | owner | Setup historical performance |
| GET | /fno/diagnostics/blocked-signals | fno.ts | owner | Blocked signal log |
| GET | /fno/no-signal-gap | fno.ts | owner | No-signal gap analysis |

### Option Chain & Analytics
| Method | Path | File | Auth | Description |
|---|---|---|---|---|
| GET | /options/chain/:underlying | optionChain.ts | session | Live option chain |
| GET | /options/analytics/:underlying | optionChain.ts | session | OI analytics (PCR, max pain, ATM IV) |
| GET | /options/chain/:underlying/export | optionChain.ts | session | Export chain CSV |
| GET | /option-snapshots/diagnostics | optionChainSnapshot.ts | owner | Snapshot diagnostics |
| GET | /option-snapshots/analytics | optionChainSnapshot.ts | ownerStrict | Snapshot analytics (PCR, OI delta, max pain) |
| POST | /option-snapshots/run-now | optionChainSnapshot.ts | owner | Trigger snapshot |

### OI Lab
| Method | Path | File | Auth | Description |
|---|---|---|---|---|
| GET | /options/oi-lab/universe | oiLab.ts | session | OI Lab index universe |
| GET | /options/oi-lab/insights/:underlying | oiLab.ts | session | OI insights (buildup, delta-window) |
| POST | /options/oi-lab/snapshot | oiLab.ts | owner | Manual OI snapshot |
| GET | /options/oi-lab/heatmap | oiLab.ts | session | OI heatmap |
| POST | /options/oi-lab/tracker/start | oiLab.ts | owner | Start OI tracker |
| POST | /options/oi-lab/tracker/stop | oiLab.ts | owner | Stop OI tracker |
| GET | /options/oi-lab/tracker/status | oiLab.ts | session | Tracker status |
| GET | /options/oi-lab/tracker/series | oiLab.ts | session | Tracker time series |
| GET | /options/oi-lab/heatmap/export | oiLab.ts | owner | Export heatmap CSV |
| GET | /options/oi-lab/tracker/export | oiLab.ts | owner | Export tracker CSV |

### Option Strategies
| Method | Path | File | Auth | Description |
|---|---|---|---|---|
| GET | /options/strategies/:underlying | optionStrategies.ts | session | Recommended strategy bundle (13 strategies) |
| POST | /options/strategies/:underlying/custom | optionStrategies.ts | session | Custom strategy builder |

### Paper Trading — F&O
| Method | Path | File | Auth | Description |
|---|---|---|---|---|
| GET | /paper/account | paper.ts | session | Paper account balance, heat caps |
| GET | /paper/positions/fo | paper.ts | session | Open F&O paper positions |
| GET | /paper/trades/fo | paper.ts | session | All F&O paper trades (history) |
| POST | /paper/positions/fo/:id/close | paper.ts | owner | Manually close F&O position |
| GET | /paper/missed/fo | paper.ts | owner | Missed F&O trade opportunities |
| GET | /paper/analytics/fo | paper.ts | owner | F&O paper analytics |
| GET | /paper/analytics/fo/shadow-costs | paper.ts | owner | Shadow cost analysis |
| GET | /paper/analytics/fo/shadow-exits | paper.ts | owner | Shadow exit analysis |
| GET | /paper/analytics/fo/failure-diagnosis | paper.ts | owner | Failure diagnosis |
| GET | /paper/diagnostics/daily-summary/fo | paper.ts | owner | Daily F&O summary |
| GET | /paper/diagnostics/daily-summary/fo/history | paper.ts | owner | Historical daily summaries |
| GET | /paper/diagnostics/fno-reasoning | paper.ts | owner | Signal reasoning log |
| GET | /paper/diagnostics/fno-reasoning/analytics | paper.ts | owner | Reasoning analytics |
| GET | /paper/diagnostics/fno-observability | paper.ts | owner | F&O observability metrics |
| GET | /paper/diagnostics/untriggered/fo | paper.ts | owner | Untriggered F&O trades |
| GET | /paper/diagnostics/environment | paper.ts | public | Env/auto-trading status |
| GET | /paper/diagnostics/fo/mtm-sweep | paper.ts | owner | MTM sweep status |
| GET | /paper/diagnostics/fo/exit-safety | paper.ts | owner | Exit safety check |
| GET | /paper/diagnostics/fo/exit-monitor/status | paper.ts | owner | Exit monitor health |
| POST | /paper/diagnostics/fo/exit-monitor/run-dry | paper.ts | owner | Dry-run exit monitor |
| POST | /paper/diagnostics/fo/exit-monitor/run-now | paper.ts | owner | Run exit monitor now |
| GET | /paper/reports/fo/monthly | paper.ts | owner | Monthly F&O report |
| GET | /paper/reports/fo/yearly | paper.ts | owner | Yearly F&O report |
| PATCH | /paper/trades/fo/:id/journal | paper.ts | owner | Add journal note to F&O trade |

### Paper Trading — Equity Swing
| Method | Path | File | Auth | Description |
|---|---|---|---|---|
| GET | /paper/positions/eq | paper.ts | session | Open equity paper positions |
| GET | /paper/trades/eq | paper.ts | session | All equity paper trades (history) |
| POST | /paper/positions/eq/manual | paper.ts | owner | Manual equity paper buy |
| POST | /paper/positions/eq/:id/close | paper.ts | owner | Close equity paper position |
| GET | /paper/reports/eq/monthly | paper.ts | owner | Monthly equity report |
| GET | /paper/reports/eq/yearly | paper.ts | owner | Yearly equity report |
| GET | /paper/audit/eq | paper.ts | owner | Equity paper audit log |
| GET | /paper/audit/eq/summary | paper.ts | owner | Equity audit summary |
| GET | /paper/events/eq | paper.ts | owner | Equity trade events |
| GET | /paper/lifecycle/:symbol | paper.ts | session | Trade lifecycle for symbol |
| PATCH | /paper/trades/eq/:id/journal | paper.ts | owner | Add journal note to equity trade |
| GET | /paper/journal-analytics | paper.ts | owner | Journal analytics |

### Paper Trading — Account
| Method | Path | File | Auth | Description |
|---|---|---|---|---|
| POST | /paper/account/topup | paper.ts | owner | Top up paper capital |
| POST | /paper/account/withdraw | paper.ts | owner | Withdraw paper capital |

### Paper Trading — Combo (Tier C)
| Method | Path | File | Auth | Description |
|---|---|---|---|---|
| POST | /paper/combos | paperCombo.ts | owner | Create multi-leg combo |
| GET | /paper/combos | paperCombo.ts | owner | List combos |
| GET | /paper/combos/:id | paperCombo.ts | owner | Get combo detail |
| POST | /paper/combos/:id/close | paperCombo.ts | owner | Close combo |

### Equity Sizing (Diagnostics only)
| Method | Path | File | Auth | Description |
|---|---|---|---|---|
| GET | /paper/eq/sizing-preview | equitySizing.ts | owner | Sizing preview (read-only) |
| GET | /paper/eq/candidates-diagnostic | equitySizing.ts | owner | Candidate diagnostic |

### Swing Cash Queue
| Method | Path | File | Auth | Description |
|---|---|---|---|---|
| GET | /swing/status | swingStaging.ts | owner | Queue status |
| GET | /swing/staged-orders | swingStaging.ts | owner | List staged orders |
| GET | /swing/staged-orders/:id | swingStaging.ts | owner | Get staged order |
| POST | /swing/staged-orders | swingStaging.ts | owner | Stage new candidate |
| POST | /swing/staged-orders/:id/approve | swingStaging.ts | owner | Approve (re-check + mark approved) |
| POST | /swing/staged-orders/:id/reject | swingStaging.ts | owner | Reject |
| POST | /swing/staged-orders/:id/expire | swingStaging.ts | owner | Manually expire |
| POST | /swing/staged-orders/:id/refresh | swingStaging.ts | owner | Refresh live quote |
| POST | /swing/staged-orders/:id/watch | swingStaging.ts | owner | Watch-only mode |
| POST | /swing/staged-orders/expire-stale | swingStaging.ts | owner | Expire all stale |
| GET | /swing/ttl-sweep/status | swingStaging.ts | owner | TTL sweep status |
| POST | /swing/ttl-sweep/run-dry | swingStaging.ts | owner | Dry-run TTL sweep |
| POST | /swing/ttl-sweep/run-now | swingStaging.ts | owner | Run TTL sweep now |
| POST | /swing/kill-switch | swingStaging.ts | owner | Toggle kill switch |

### Portfolio Analyser
| Method | Path | File | Auth | Description |
|---|---|---|---|---|
| GET | /portfolios | portfolio.ts | session | List portfolios |
| POST | /portfolios | portfolio.ts | session | Create portfolio |
| GET | /portfolios/:id | portfolio.ts | session | Get portfolio |
| PATCH | /portfolios/:id | portfolio.ts | session | Update portfolio |
| DELETE | /portfolios/:id | portfolio.ts | session | Delete portfolio |
| PUT | /portfolios/:id/holdings | portfolio.ts | session | Replace holdings |
| GET | /portfolio/resolve-debug | portfolio.ts | owner | Portfolio resolution debug |

### Backtest Lab
| Method | Path | File | Auth | Description |
|---|---|---|---|---|
| GET | /parity/status | parity.ts | session | Backtest/parity status |
| POST | /parity/trade-event/verify | parity.ts | owner | Verify trade event |
| GET | /parity/trade-event/replay/:id | parity.ts | owner | Replay trade event |

### Institutional Flows
| Method | Path | File | Auth | Description |
|---|---|---|---|---|
| GET | /inst/fii-dii | instFlows.ts | session | FII/DII cash flow data |
| GET | /inst/participant-oi | instFlows.ts | session | F&O participant OI breakdown |
| GET | /inst/participant-oi/audit | instFlows.ts | owner | Participant OI audit log |
| GET | /inst/fno-ban | instFlows.ts | session | F&O ban list |
| POST | /inst/refresh | instFlows.ts | owner | Force refresh institutional data |

### Daily Analysis (Pre/Post Market Reports)
| Method | Path | File | Auth | Description |
|---|---|---|---|---|
| GET | /daily-analysis/status | dailyAnalysis.ts | owner | PREPOST bot status |
| GET | /daily-analysis/history | dailyAnalysis.ts | owner | Report history (DB rows) |
| GET | /daily-analysis/telegram/preview | dailyAnalysis.ts | owner | Preview without send |
| POST | /daily-analysis/generate-pre-market | dailyAnalysis.ts | owner | Send pre-market report |
| POST | /daily-analysis/generate-post-market | dailyAnalysis.ts | owner | Send post-market report |

### Data Diagnostics & Parity
| Method | Path | File | Auth | Description |
|---|---|---|---|---|
| GET | /data/diagnostics | data.ts | owner | Full data diagnostics |
| GET | /data/diagnostics/symbol/:symbol | data.ts | owner | Per-symbol data diagnostic |
| GET | /data/diagnostics/portfolio | data.ts | owner | Portfolio data diagnostic |
| GET | /data/diagnostics/portfolio-resolution | data.ts | owner | Portfolio resolution debug |
| POST | /data/compare | data.ts | owner | Side-by-side Kite vs INDstocks |
| GET | /data/indstocks/token/status | data.ts | owner | INDstocks token status |
| POST | /data/indstocks/token | data.ts | ownerStrict | Store INDstocks token |
| DELETE | /data/indstocks/token | data.ts | ownerStrict | Delete INDstocks token |
| GET | /data-parity/symbol/:symbol | dataParity.ts | owner | Data parity check per symbol |
| POST | /data-parity/check | dataParity.ts | owner | Batch data parity check |

### Candle Warehouse
| Method | Path | File | Auth | Description |
|---|---|---|---|---|
| GET | /candles/diagnostics | candleWarehouse.ts | owner | Candle warehouse diagnostics |
| POST | /candles/sync | candleWarehouse.ts | owner | Sync candles for symbol |
| POST | /candle-warehouse/backfill | candleWarehouse.ts | owner | Backfill historical candles |
| GET | /candle-warehouse/backfill/status | candleWarehouse.ts | owner | Backfill status |

### Chart
| Method | Path | File | Auth | Description |
|---|---|---|---|---|
| GET | /chart/instruments | chart.ts | session | All chartable instruments |
| GET | /chart/candles | chart.ts | session | OHLCV candle data for charting |
| GET | /chart/audit | chart.ts | owner | Chart data audit |

### Admin
| Method | Path | File | Auth | Description |
|---|---|---|---|---|
| GET | /admin/users | admin.ts | owner | List users |
| GET | /admin/users/:id | admin.ts | owner | Get user |
| PATCH | /admin/users/:id | admin.ts | owner | Update user |
| DELETE | /admin/users/:id | admin.ts | owner | Delete user |
| GET | /admin/download/codebase-summary | admin.ts | ownerStrict | Download codebase summary |

### TradingView Webhooks
| Method | Path | File | Auth | Description |
|---|---|---|---|---|
| GET | /webhooks/tradingview | tradingview.ts | public | TV webhook status |
| POST | /webhooks/tradingview | tradingview.ts | hmac | TV webhook receiver |
| DELETE | /webhooks/tradingview | tradingview.ts | owner | Delete TV webhook config |

### Global Multi-Asset Scanner (artifact/global)
| Method | Path | File | Auth | Description |
|---|---|---|---|---|
| GET | /global/auth/status | global/index.ts | public | Global auth status |
| POST | /global/auth/login | global/index.ts | public | Global login |
| POST | /global/auth/logout | global/index.ts | session | Global logout |
| GET | /global/instruments | global/index.ts | session | All global instruments |
| GET | /global/dashboard | global/index.ts | session | Global dashboard data |
| GET | /global/instruments/:symbol | global/index.ts | session | Single instrument detail |
| GET | /global/instruments/:symbol/candles | global/index.ts | session | Candles for instrument |
| GET | /global/instruments/:symbol/indicators | global/index.ts | session | Indicators for instrument |
| POST | /global/screen | global/index.ts | session | Screen instruments |
| GET | /global/watchlist | global/index.ts | session | Global watchlist |
| POST | /global/watchlist | global/index.ts | session | Add to watchlist |
| DELETE | /global/watchlist/:symbol | global/index.ts | session | Remove from watchlist |
| GET | /global/screener-presets | global/index.ts | session | List screener presets |
| POST | /global/screener-presets | global/index.ts | session | Create preset |
| PATCH | /global/screener-presets/:id | global/index.ts | session | Update preset |
| DELETE | /global/screener-presets/:id | global/index.ts | session | Delete preset |
| POST | /global/screener-presets/:id/run-now | global/index.ts | session | Run preset now |
| GET | /global/status | global/index.ts | session | Global service status |

---

## 2. Database Tables

### Drizzle-Managed (in lib/db/src/schema/)

| Table | Schema file | Purpose |
|---|---|---|
| `paper_account` | paperTrading.ts | Paper trading capital ledger |
| `paper_trade_fo` | paperTrading.ts | F&O paper trades (auto + manual) |
| `paper_trade_eq` | paperTrading.ts | Equity paper trades (auto + manual) |
| `paper_eq_audit` | paperTrading.ts | Equity paper trade audit events |
| `paper_daily_summary_fo` | paperTrading.ts | Daily F&O paper summary snapshots |
| `paper_capital_event` | paperTrading.ts | Capital top-up/withdrawal events |
| `backtest_runs` | backtest.ts | Backtest run metadata |
| `backtest_trades` | backtest.ts | Backtest individual trade rows |
| `backtest_blocked_setups` | backtest.ts | Backtest blocked setups |
| `option_signal_history` | optionSignals.ts | Historical F&O signal rows |
| `option_signal_plan_audit` | optionSignals.ts | Signal plan immutability audit |
| `portfolios` | portfolio.ts | Portfolio definitions |
| `portfolio_holdings` | portfolio.ts | Portfolio holdings rows |
| `swing_scan_result` | swingScan.ts | Pro Swing Scanner v3 results |
| `swing_scan_run` | swingScan.ts | Swing scan run metadata |
| `tv_alerts` | tvAlerts.ts | TradingView webhook alerts |
| `option_chain_snapshot` | optionChainSnapshot.ts | Option chain raw snapshots |
| `option_chain_snapshot_run` | optionChainSnapshot.ts | Snapshot run metadata |
| `iv_history` | ivHistory.ts | IV history (ATM IV per index) |
| `candle` | candleWarehouse.ts | OHLCV candle warehouse |
| `candle_sync_run` | candleWarehouse.ts | Candle sync run log |
| `instrument_map` | instrumentMap.ts | Kite × INDstocks instrument mapping |
| `paper_trade_combo` | paperTradeCombo.ts | Multi-leg combo paper trades |
| `paper_trade_combo_leg` | paperTradeCombo.ts | Legs of combo trades |
| `strategy_definitions` | strategyControl.ts | Strategy definitions |
| `strategy_engine_state` | strategyControl.ts | Strategy engine state |
| `app_state` | appState.ts | Global app state (kill switch etc.) |
| `fii_dii_daily` | instFlows.ts | FII/DII daily cash flow rows |
| `global_instruments` | globalScanner.ts | Global multi-asset instrument definitions |
| `global_instrument_overrides` | globalScanner.ts | Per-instrument overrides |
| `global_live_prices` | globalScanner.ts | Global live price cache |
| `global_sync_logs` | globalScanner.ts | Global sync log |
| `indstocks_token` | indstocksToken.ts | INDstocks API token storage |
| `kite_session` | kiteSession.ts | Kite Connect session token |
| `swing_order_staging` | swingOrderStaging.ts | Swing cash staged order queue |

### Raw SQL (outside Drizzle schema — CREATE TABLE IF NOT EXISTS only)

| Table | Created in | Purpose |
|---|---|---|
| `daily_report_runs` | dailyReports.ts | Pre/post market report dedup log |
| `notification_delivery_log` | tradeLifecycle/notificationLog.ts | Trade alert delivery dedup |
| `system_alert_dedup` | systemAlertDedup.ts | System health alert dedup |
| `system_alert_state` | systemAlertDedup.ts | System alert state tracker |

### Additive ALTER TABLE columns (outside Drizzle schema)

| Table | Column(s) | Added in |
|---|---|---|
| `paper_trade_eq` | Multiple lifecycle columns | paperTradingEq.ts |
| `candle` | 15 provenance columns | candleWarehouseIngestor.ts (trusted layer) |
| `paper_trade_fo` | lot_size_source, contract_instrument_token, contract_grade, contract_fallback_reason | ensureContractMasterColumns.ts |
| `swing_order_staging` | expired_at, expiry_reason | swingTtlSweep.ts |
| `paper_trade_fo` | fno_exit_monitor health columns | fnoExitMonitorHealth.ts |

---

## 3. Frontend Pages

### NSE Scanner (artifacts/scanner)

| Page file | Route | Nav section | Auth | Description |
|---|---|---|---|---|
| dashboard.tsx | / | Home | public | Home / Market Pulse |
| indices.tsx | /indices | Markets | public | Indices board |
| index-detail.tsx | /indices/:slug | Markets | public | Single index detail |
| scanner.tsx | /scanner | Scan | public | NIFTY 500 stock scanner |
| deep-scan.tsx | /deep-scan | Scan | public | Deep scan per symbol |
| stock-detail.tsx | /stocks/:symbol | — | public | Stock detail (chart, signals, fundamentals) |
| stocks-to-watch.tsx | /stocks-to-watch | Scan | public | Setup signals + Pro Swing v3 |
| sectors.tsx | /sectors | Markets | public | Sectors heatmap |
| sector-detail.tsx | /sectors/:sector | Markets | public | Single sector detail |
| charting.tsx | /charting | Charts | session | Interactive charting |
| options.tsx | /options | F&O | session | F&O intraday signals |
| option-chain.tsx | /option-chain | F&O | session | Live option chain |
| oi-lab.tsx | /oi-lab | F&O | session | OI Lab tracker + heatmap |
| strategies.tsx | /strategies | F&O | session | Recommended strategies + Custom builder |
| strategies-builder.tsx | /strategies | F&O | session | Custom strategy builder tab |
| swing-cash.tsx | /swing-cash | Trade | owner | Swing Cash Queue |
| paper-trading.tsx | /paper-trading | Trade | session | Paper trading dashboard (F&O + Equity) |
| paper-reports.tsx | /paper-reports | Trade | session | Paper trading P&L reports |
| portfolio-analyser.tsx | /portfolio | Trade | session | Portfolio analyser |
| watchlist.tsx | /watchlist | — | session | Personal watchlist |
| backtest-lab.tsx | /backtest | Research | owner | Backtest lab |
| flows.tsx | /flows | Research | session | Institutional flows (FII/DII, Participant OI) |
| premarket.tsx | /premarket | Research | session | Pre-market readiness |
| daily-analysis.tsx | /daily-analysis | Admin | owner | Pre/post market Telegram reports |
| news.tsx | /news | Research | public | Market news |
| infra-health.tsx | /infra-health | Admin | owner | Infra health dashboard |
| fno-diagnostics.tsx | /fno-diagnostics | Admin | owner | F&O diagnostics |
| kite.tsx | /kite | Admin | owner | Kite Connect session management |
| status.tsx | /status | Admin | session | System status |
| admin.tsx | /admin | Admin | owner | User management |
| audit.tsx | /audit | Admin | owner | Security audit |
| learn.tsx | /learn | — | public | Learn page |
| manifesto.tsx | /manifesto | — | public | Manifesto |
| legal/*.tsx | /legal/* | — | public | Legal pages (bypass auth) |

---

## 4. Data Flows

### Flow A — Live Market Data

```
Kite Connect (WebSocket/REST)
  │
  ├─ kiteFeed.ts (WebSocket ticks: index spot prices)
  │    └─ kiteIndexQuotes.ts (batch LTP cache, used by F&O signals)
  │
  ├─ kiteScanner.ts (REST quotes: NIFTY 500 equity)
  │    └─ scanner.ts routes → /stocks, /scan/top
  │
  ├─ kiteIntraday.ts (15-min candles for F&O indices)
  │    └─ optionSignals.ts → intraday bars
  │
  ├─ kiteFnoInstruments.ts (instrument master dump → cache)
  │    └─ contractMasterFact.ts → lot sizes, strike steps, tokens
  │
  └─ kiteOptionChain.ts (option chain REST)
       └─ optionChain.ts → optionSignals.ts → signal generation

Yahoo Finance (fallback, DELAYED, report-grade only)
  ├─ yahoo.ts → daily historical bars for swing scanner
  ├─ optionSignals.ts daily bars (when Kite daily bars unavailable)
  └─ HARD-REFUSED for paper trade opens since 2026-05-06

NSE Direct (delayed, info-only)
  ├─ fnoBanList.ts → /inst/fno-ban (bhavcopy download)
  ├─ instFlows.ts → FII/DII (archives.nseindia.com CSVs, T+1)
  └─ instFlows.ts → Participant OI (CSV, T+1)
```

### Flow B — F&O Signal Pipeline

```
1. Data readiness check (canonicalFnoReadiness.ts)
   ├─ Kite session ACTIVE?
   ├─ WebSocket feed CONNECTED?
   ├─ Daily bars READY? (all 3 indices: NIFTY/BANKNIFTY/SENSEX)
   └─ Intraday bars READY? (all 3 indices)
   → If any MISSING: signalCycle.status = DATA_BLOCKED (all signals suppressed)
   → If partial: PARTIAL (signals attempted but may fail per-index)

2. Per-index signal generation (optionSignals.ts → buildContext())
   ├─ Fetch intraday bars (kiteIntraday.ts)
   ├─ Fetch daily bars (Kite historical or Yahoo fallback)
   ├─ Fetch option chain (kiteOptionChain.ts)
   ├─ Compute indicators: EMA20/50 (daily), EMA9/21 (1h), VWAP, ATR, RSI, MACD
   ├─ Phase-3 confluence engine (confluenceEngine.ts)
   ├─ Compute IVR/IVP (ivHistory.ts)
   └─ Build signal candidates

3. Signal gate waterfall (per signal)
   ├─ Confidence floor ≥ 65 (HC_EMISSION_FLOOR)
   ├─ Regime filter (regimeClassifier.ts)
   ├─ HTF daily EMA50 bias
   ├─ True 1h HTF (EMA9/21 60-min stack)
   ├─ Vol-clamped stop gate
   ├─ Noise windows (09:15-09:30, 15:15-15:30)
   ├─ Expiry day gate
   ├─ Sector relative strength
   ├─ Win-rate calibration (30-day)
   ├─ ATM OI confluence
   └─ → isDemoted → BASELINE tier vs HC tier

4. Global veto (optionSignalVetoes.ts)
   ├─ Daily DD cap exceeded?
   ├─ VIX spike circuit breaker?
   └─ Correlation cap (max exposure per index group)

5. Contract master resolution (contractMasterFact.ts)
   ├─ Live instrument cache → trade_grade (NFO/BFO)
   ├─ Algorithmic expiry → info_only
   └─ Cold cache → fallback/unavailable

6. toSignal() → OptionSignal emitted
   ├─ Written to option_signal_history
   └─ → tryOpenPaperTrades() if tradeable

7. Paper trade open (paperTradingFO.ts → openPaperTrade())
   ├─ isPaperAutoTradingEnabled() gate (dev=false, prod=true)
   ├─ F&O risk guards (fnoPaperRiskGuards.ts, shadow mode)
   ├─ Premium plan validation
   ├─ Kite chain fetch for live premium
   ├─ Lot sizing (PAPER_FIXED_LOTS ceiling)
   ├─ Portfolio heat cap (MAX_FNO_HEAT_PCT=6%)
   ├─ INSERT paper_trade_fo row
   └─ → fnoSignalAlerts.ts → Telegram (ENTRY_OPENED)

8. Lifecycle monitoring (bootScheduler → every 30s in market hours)
   ├─ MTM sweep (mark-to-market open positions)
   ├─ SL/T1/T2 exit check (fnoExitDecision.ts)
   ├─ 15:20 IST force-close
   └─ → Telegram on close events
```

### Flow C — Swing Cash Pipeline

```
1. Candidate generation
   ├─ Pro Swing Scanner v3 (swingScanner.ts) → scan NIFTY 500
   ├─ fullNseScanner.ts → signals with STRONG_BUY
   └─ Equity entry safety gate (scoring.ts → computeEntrySafety())

2. Manual staging (swingOrderStaging.ts → stageSwingOrder())
   ├─ Risk validation (swingCashRiskGuards.ts)
   ├─ Kill switch check (app_state)
   ├─ Portfolio exposure check (buildSwingPortfolioState)
   └─ INSERT swing_order_staging (status=STAGED/APPROVAL_REQUIRED)
   → Telegram: ENTRY_READY alert (via swingAlerts.ts)

3. TTL sweep (swingTtlSweep.ts, every 10 min)
   ├─ expireStaleSwingOrders() on orders past 8h TTL
   └─ UPDATE swing_order_staging status=EXPIRED
   (No Telegram on expire)

4. Owner approval (swingStaging.ts → approveSwingOrder())
   ├─ Kill switch check
   ├─ Fresh Kite quote fetch
   ├─ Re-run risk evaluation
   ├─ CAS update → status=APPROVED/DRY_RUN_PLACED
   └─ ⚠️  CRITICAL GAP: APPROVED status does NOT create paper_trade_eq row
          The pipeline is disconnected — approval is terminal in staging table only.

5. Equity paper trading (paperTradingEq.ts) — SEPARATE PIPELINE
   ├─ runEquityPaperTradingTick() → from fullNseScanner signals
   ├─ openPaperEquityTrade() → INSERT paper_trade_eq
   └─ This path is NOT connected to the swing staging approval flow

6. Equity paper lifecycle
   ├─ runEquityPaperTradingTick() → MTM, SL/T1/T2 checks
   └─ → Telegram on close (swingAlerts.ts via tradeLifecycle)
```

### Flow D — Paper Trade Lifecycle (F&O)

```
Open → paper_trade_fo row (status=OPEN, entryPremium, lots, SL, targets)
  │
  ├─ MTM sweep (every 30s in market hours)
  │    └─ UPDATE paper_trade_fo.lastPremium, unrealizedPnl
  │
  ├─ Exit monitor (fnoExitDecision.ts)
  │    ├─ Check SL crossed → EXIT_STOP_LOSS
  │    ├─ Check T1 crossed → EXIT_TARGET_1 (partial exit)
  │    ├─ Check T2 crossed → EXIT_TARGET_2
  │    └─ Check 15:20 IST → EXIT_TIME_1520
  │
  ├─ Manual close → POST /paper/positions/fo/:id/close
  │
  └─ Close → UPDATE status=CLOSED, exitPremium, realizedPnl, exitAt
       ├─ fnoCostModel.ts → shadow STT/GST/brokerage (reporting only)
       ├─ Capital ledger update (paper_account)
       ├─ Telegram alert (fnoSignalAlerts.ts → CANONICAL pipeline)
       └─ paper_daily_summary_fo update
```

### Flow E — Backtest

```
Historical candles (kiteIntraday.ts / kite historical)
  │
  ├─ Directional backtest (backtest/directional.ts)
  │    ├─ Synthetic premium (~0.40% spot, ~0.50 delta, no theta/IV)
  │    ├─ Static lot sizes (lotSizeSource="static_map", lotSizeRegime="2026-JAN-NSE-REVISION")
  │    └─ INSERT backtest_trades rows
  │
  ├─ Strategy backtest (backtest/strategies/runner.ts)
  │    └─ Same synthetic premium + static lot sizes
  │
  └─ Reports (parity.ts → /parity/*)
       ├─ fnoCostModel.ts → charges (STT 0.15%/0.05% eff 2026-04-01)
       └─ Net P&L with charges
```

### Flow F — Telegram Notifications

```
F&O Signal Alerts (fnoSignalAlerts.ts)
  ├─ Bot: TELEGRAM_BOT_TOKEN → TELEGRAM_CHAT_ID (default bot)
  ├─ Events sent: ENTRY_OPENED, EXIT_STOP_LOSS, EXIT_TARGET_1, EXIT_TARGET_2, EXIT_MANUAL, EXIT_TIME
  ├─ Validation: 13 gates (validateTradeEventForNotification)
  │    ├─ production env only
  │    ├─ TRADE_GRADE source only
  │    ├─ finite price/quantity
  │    ├─ no TEST/DUMMY/MOCK symbols
  │    ├─ DB dedup (notification_delivery_log)
  │    └─ in-memory dedup (15-30 min window)
  └─ Formatter: formatTradeTelegramMessage (canonical pipeline)

Swing Cash Alerts (swingAlerts.ts)
  ├─ Bot: TELEGRAM_BOT_TOKEN → TELEGRAM_CHAT_ID (same default bot)
  ├─ Events sent: ENTRY_READY only
  ├─ Events NOT sent: EXPIRED, REJECTED, DRY_RUN, BLOCKED_BY_RISK
  └─ Formatter: formatTradeTelegramMessage (canonical pipeline)

Pre/Post Market Reports (dailyReports.ts)
  ├─ Bot: PREPOST_TELEGRAM_BOT_TOKEN → PREPOST_TELEGRAM_CHAT_ID (dedicated bot)
  ├─ Schedule: pre-market 08:50 IST, post-market 15:45 IST
  ├─ DB dedup: daily_report_runs table
  └─ 10/22 sections are SOURCE_NOT_INTEGRATED (FII/DII, GIFT Nifty, India VIX etc.)
```

---

## 5. Scheduled Jobs (bootScheduler.ts)

| Job | Interval | Description |
|---|---|---|
| F&O signal cycle | ~30s (market hours) | optionSignals → tryOpenPaperTrades → MTM sweep |
| Equity scanner tick | ~30s (market hours) | fullNseScanner → runEquityPaperTradingTick |
| Swing TTL sweep | 10 min | expireStaleSwingOrders (8h TTL) |
| Kite readiness scheduler | boot + refresh | kiteReadinessScheduler → warm up bars |
| OI Lab tracker | configurable | OI snapshot accumulation |
| Option chain snapshot | scheduled | optionChainSnapshotIngestor |
| Global data pump | 15s staggered | globalIndices refresh |
| Preset scheduler | 25s staggered | Global screener preset runs |
| Pre-market report | 08:50 IST | buildPreMarketReport → Telegram |
| Post-market report | 15:45 IST | buildPostMarketReport → Telegram |
| Instflows refresh | 15 min | FII/DII + Participant OI from NSE archives |
| DB pool stats log | periodic | Log DB connection pool stats |

---

## Phase 2A Update — 2026-07-10

**Verdict:** `PHASE_2A_SWING_TELEGRAM_FNO_P0_PARTIAL_GAP_REMAINS`

### New / modified data flows

#### Swing Approval → Paper Equity (NEW — code path wired, end-to-end proof pending)

```
Owner clicks Approve on staged swing order
  └─ POST /swing/staged-orders/:id/approve
       └─ approveSwingOrder() [swingOrderStaging.ts]
            └─ CAS: UPDATE paper_trade_eq_staging SET status='APPROVED' WHERE status='PENDING'
                 └─ (on success) openPaperEquityTradeFromStagedOrder(stagingRow) [paperTradingEq.ts]
                      └─ openPaperEquityTrade({ source: "SWING_STAGED_APPROVAL", stagedOrderId })
                           ├─ INSERT INTO paper_trade_eq (source='SWING_STAGED_APPROVAL', is_autonomous=false)
                           └─ raw SQL UPDATE paper_trade_eq SET staged_order_id=:id WHERE id=:newTradeId
```

**Status:** Code path wired. DB reconciliation, portfolio surface, and Telegram dry-run proof still required (FP-P0-01A).

**Fire-safe design:** approval CAS is committed before paper-open is attempted. If paper-open fails, approval remains APPROVED and the failure is logged. Paper-open failure never rolls back the approval.

#### Pre-Market Telegram — FII/DII Section (UPDATED)

```
buildPreMarketReport() [dailyReports.ts]
  └─ gatherPreMarketData()
       └─ getFiiDiiMonthly() [instFlows.ts]
            └─ SELECT FROM fii_dii_monthly ORDER BY month DESC LIMIT 3
                 └─ flatMap months → daily rows → take most recent row
                      └─ PreMarketFiiDii { date, fiiNet, diiNet, source }
```

Section `── FII / DII ACTIVITY ──` now renders actual net flows in crores (₹ sign, + prefix for positives). Falls back to "Unavailable" if DB query fails (fail-open).

#### F&O Readiness — suppressedIndices (UPDATED)

```
buildCanonicalFnoReadiness() [canonicalFnoReadiness.ts]
  └─ signalCycle.suppressedIndices = cycle.suppressed.map(s => s.index)
       └─ buildTelegramSummary({ suppressedIndices })
            └─ appends "Suppressed indices: BANKNIFTY, SENSEX" when non-empty
```

**Status:** Index names surfaced. Per-index diagnostic reasons (daily bars / intraday / option-chain / quote / failure reason) not yet added (FP-P0-03A).

### Outstanding flow gaps (Phase 2A P0)

| Gap | Flow not yet implemented |
|---|---|
| FP-P0-01A | paper_trade_eq row → portfolio surface → Telegram dry-run |
| FP-P0-02A | gatherPostMarketData → paper_trade_eq/fo counts by source |
| FP-P0-02B | Pre/post-market Telegram → swing staged/approved/expired/opened/closed counts |
| FP-P0-03A | Per-index DATA_BLOCKED: dailyBars/intradayBars/optionChain/quote status + reason |
| FP-P0-03B | Index isolation: SENSEX failure must not suppress NIFTY/BANKNIFTY |

*Phase 2A route/dataflow update: `PHASE_2A_DOCUMENTATION_UPDATED_PARTIAL_GAP_REMAINS`*

---

## Phase 2A P0 Closure — 2026-07-10

**Verdict:** `PHASE_2A_ROUTE_DATAFLOW_P0_GAPS_CLOSED_DEV_VERIFIED`

### All outstanding route/dataflow gaps closed:

| Gap | ID | Route / Flow added | Status |
|---|---|---|---|
| paper_trade_eq → Telegram | FP-P0-01A | `PostMarketEquityPaper{openedToday,closedToday,openCount}` wired in `gatherPostMarketData` + `buildPostMarketReport` | ✅ CLOSED |
| post-market paper counts | FP-P0-02A | `PostMarketFno{tradesOpened,tradesClosed,openCount,totalPnl}` serialized in builder | ✅ CLOSED |
| swing Telegram counts | FP-P0-02B | `PreMarketSwing.openedToday/closedToday/blockedToday` + `PostMarketSwing.*` in both builders | ✅ CLOSED |
| per-index DATA_BLOCKED | FP-P0-03A | `IndexFnoDiagnostic` now carries 7 new fields: `dailyBarsCount, intradayBarsCount, optionChainFetchOk, quoteStatus, source, asOf, freshness` | ✅ CLOSED |
| one-index isolation proof | FP-P0-03B | Tests prove NIFTY/BANKNIFTY unblocked when SENSEX fails (isolation verified per-index) | ✅ CLOSED |

### Updated IndexFnoDiagnostic dataflow:

```
getLastFnoCycleState() → cycle.suppressed[{index, reasons}]
getLastOptionSnapshotRun() → lastRun.errors[{underlying}]
getKiteReadiness() → kite.{sessionValid, feedConnected}

buildCanonicalFnoReadiness(inputs)
  └─ for each idx in OPTION_INDICES:
       ├─ intradayBarsCount: sup==null ? 1 : isDailyFail ? 1 : 0
       ├─ dailyBarsCount: sup==null ? 1 : 0
       ├─ optionChainFetchOk: !lastRun.errors.some(e => e.underlying===idx.symbol)
       ├─ quoteStatus: sessionValid&&feedConnected ? "ok" : !sessionValid ? "missing" : "unknown"
       ├─ source: sessionValid ? "kite" : "unknown"
       ├─ asOf: sup==null ? cycleTs.toISOString() : null
       └─ freshness: ageMs<15m ? "LIVE" : ageMs<60m ? "STALE" : "UNKNOWN"
```

### TTL sweep safe-error flow (FP-P0-05B):

```
POST /swing/staged-orders/expire-stale
  └─ requireOwner
       └─ try:
            expireStaleSwingOrders(owner, {now, fetchQuote, expiryReason:"BATCH_EXPIRE"})
              └─ res.json({expired, scanned, execution})
          catch:  ← ADDED: no raw SQL/stack in response
            res.status(200).json({expired:0, scanned:0, error:"sweep_failed", execution})
```
