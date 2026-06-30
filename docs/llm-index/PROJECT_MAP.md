# Project Map

Complete codebase map. Use this to find the right file before opening source.

Risk levels: **LOW** | **MEDIUM** | **HIGH** | **CRITICAL**

---

## Backend — `artifacts/api-server/src/`

### Routes (`src/routes/`)

| File | Domain | Purpose | Risk |
|---|---|---|---|
| `index.ts` | backend | Route registry + background scheduler boot | HIGH |
| `auth.ts` | auth | Login, logout, session management | HIGH |
| `userAuth.ts` | auth | User signup, personal watchlist, `/auth/me` | HIGH |
| `admin.ts` | auth | Owner-only user management (`/admin/users`) | HIGH |
| `health.ts` | backend | `/api/healthz` | LOW |
| `scanner.ts` | scanner | `/api/stocks` — main NIFTY 500 scanner feed | HIGH |
| `deepscan.ts` | scanner | `/api/deep-scan/*` — per-symbol deep scan | HIGH |
| `stocksToWatch.ts` | scanner | Pro Swing Scanner v3 + sector coverage diagnostics | MEDIUM |
| `indices.ts` | data-source | Kite/Yahoo index board, futures volume, global cues | HIGH |
| `home.ts` | frontend | `/home/enrichment` — home dashboard aggregation | MEDIUM |
| `kite.ts` | data-source | Kite session management, reconnect, token write | CRITICAL |
| `chart.ts` | charting | `/chart/instruments` + `/chart/candles` — TradingView datafeed | HIGH |
| `optionChain.ts` | trading-engine | Live option chain, OI data | CRITICAL |
| `oiLab.ts` | trading-engine | OI buildup lab, Δ-window historical backfill | HIGH |
| `optionStrategies.ts` | trading-engine | Strategy recommender + custom builder | MEDIUM |
| `fno.ts` | trading-engine | F&O diagnostics facade (read-only, owner-only) | HIGH |
| `paper.ts` | trading-engine | Paper trading F&O + equity account/positions/trades | CRITICAL |
| `paperCombo.ts` | trading-engine | Multi-leg combo paper trades (Tier C lane) | HIGH |
| `backtest.ts` | trading-engine | Backtest lab — REAL_REPLAY + DIRECTIONAL | HIGH |
| `swingStaging.ts` | trading-engine | Swing cash staged-order queue + approval | CRITICAL |
| `alerts.ts` | alerting | Alert status + Telegram test endpoints | HIGH |
| `portfolio.ts` | portfolio | Per-user saved portfolios (owner/subscriber) | MEDIUM |
| `instFlows.ts` | data-source | FII/DII flows, participant OI | MEDIUM |
| `data.ts` | data-source | Central market-data layer diagnostics (owner-only) | HIGH |
| `optionChainSnapshot.ts` | data-source | Option chain write-only snapshot store diagnostics | HIGH |
| `candleWarehouse.ts` | data-source | Candle warehouse diagnostics + manual sync | HIGH |
| `equitySizing.ts` | trading-engine | Equity sizing preview (read-only diagnostic) | MEDIUM |
| `tradingview.ts` | alerting | TradingView webhook receiver | HIGH |
| `system.ts` | backend | System status endpoint | LOW |
| `global/` | data-source | Global multi-asset scanner routes | MEDIUM |

### Business Logic (`src/lib/`)

#### Data / Market Data Layer
| File | Domain | Purpose | Risk |
|---|---|---|---|
| `marketData/router.ts` | data-source | **Central live-quote router** — all live data must flow through here | CRITICAL |
| `marketData/policy.ts` | data-source | Source trust tiers, `INDSTOCKS_ENABLED` flag | CRITICAL |
| `marketData/types.ts` | data-source | `TrustedQuote`, `MarketDataResult`, trust-tier types | CRITICAL |
| `marketData/provenance.ts` | data-source | `sourcePriority`, candle provenance helpers | HIGH |
| `marketData/freshness.ts` | data-source | `isFreshFor()` freshness checker, `TIMEFRAME_CONFIG` | HIGH |
| `marketData/diagnostics.ts` | data-source | Data health probe for `/fno/data-health` | HIGH |
| `marketData/kiteProvider.ts` | data-source | Kite quote wrapper inside the trusted layer | CRITICAL |
| `marketData/indstocksProvider.ts` | data-source | INDstocks wrapper (disabled by default) | HIGH |
| `marketData/optionChainProvider.ts` | data-source | Trusted option chain facade | HIGH |
| `marketData/sourceValidation.ts` | data-source | Kite×INDstocks cross-validation | HIGH |
| `kiteAuth.ts` | data-source | Kite session store, token enc/dec, login time | CRITICAL |
| `kiteFeed.ts` | data-source | KiteTicker WebSocket for live index spots | CRITICAL |
| `kiteScanner.ts` | data-source | Kite batch quote scanner (8787 instruments) | CRITICAL |
| `kiteIntraday.ts` | data-source | Kite intraday candles (15-min historical) | HIGH |
| `kiteOptionChain.ts` | data-source | Kite option chain fetch | CRITICAL |
| `kiteIndexQuotes.ts` | data-source | Kite index spot price quotes | HIGH |
| `kiteFnoInstruments.ts` | data-source | Kite F&O instrument master | HIGH |
| `kiteReadiness.ts` | data-source | Kite session readiness checks | HIGH |
| `yahoo.ts` | data-source | Yahoo Finance wrapper (SECONDARY — never for signals) | HIGH |
| `nseBhavcopy.ts` | data-source | NSE EOD bhavcopy parser | MEDIUM |
| `candleWarehouseIngestor.ts` | database | Candle warehouse write + provenance stamping | HIGH |
| `dataProvider.ts` | data-source | Provider abstraction for scanner data | HIGH |

#### F&O Engine
| File | Domain | Purpose | Risk |
|---|---|---|---|
| `optionSignals.ts` | trading-engine | **Main F&O signal engine** (Phase 1-4) | CRITICAL |
| `confluenceEngine.ts` | trading-engine | P3 confluence engine — replaces per-detector confidence | CRITICAL |
| `optionSignalGates.ts` | trading-engine | Gate functions (HTF, noise window, sector RS, win-rate) | CRITICAL |
| `optionSignalVetoes.ts` | trading-engine | Signal veto logic | HIGH |
| `optionSignalLifecycle.ts` | trading-engine | Signal open/close lifecycle management | HIGH |
| `optionChain.ts` | trading-engine | Option chain data assembly | HIGH |
| `optionAnalytics.ts` | trading-engine | Option analytics computations | MEDIUM |
| `oiBuildup.ts` | trading-engine | OI buildup detection | HIGH |
| `oiLab.ts` | trading-engine | OI lab historical analysis | HIGH |
| `ivHistory.ts` | trading-engine | IV history, IVR/IVP computation | HIGH |
| `regimeClassifier.ts` | trading-engine | Market regime classification | HIGH |
| `blackScholes.ts` | trading-engine | BS option pricing | MEDIUM |
| `fnoPaperRiskGuards.ts` | trading-engine | F&O paper risk guard pack (shadow mode) | HIGH |
| `fnoDiagnosticsFacade.ts` | trading-engine | F&O diagnostics aggregator | HIGH |
| `fnoCostModel.ts` | trading-engine | F&O cost model (shadow/reporting only) | HIGH |
| `fnoPremiumExitOverlay.ts` | trading-engine | Premium-based exit overlay | HIGH |
| `fnoShadowExits.ts` | trading-engine | Shadow exit simulation | HIGH |
| `fnoObservability.ts` | trading-engine | F&O observability metrics | HIGH |
| `fnoSignalReasoningLogger.ts` | trading-engine | Signal reasoning persistence | HIGH |
| `fnoReasoningAnalytics.ts` | trading-engine | Signal reasoning analytics | MEDIUM |
| `fnoTradingDays.ts` | trading-engine | Trading day counter (Mon-Fri, no holiday list) | MEDIUM |

#### Swing Cash Engine
| File | Domain | Purpose | Risk |
|---|---|---|---|
| `swingOrderStaging.ts` | trading-engine | **Swing staged-order lifecycle** (create/approve/expire/reject) | CRITICAL |
| `swingAlerts.ts` | alerting | **Swing Telegram alert builder** — production-verified wording | CRITICAL |
| `swingCashDataTrust.ts` | trading-engine | Data trust gate for swing entries | CRITICAL |
| `swingCashEntryGate.ts` | trading-engine | Entry quality gate | HIGH |
| `swingCashSizing.ts` | trading-engine | Position sizing for equity swing | HIGH |
| `swingCashRiskGuards.ts` | trading-engine | Risk guard pack for swing | HIGH |
| `swingCashLiquidity.ts` | trading-engine | Liquidity gate | HIGH |
| `swingCashEventRisk.ts` | trading-engine | Corporate action / event risk gate | HIGH |
| `swingCashExposure.ts` | trading-engine | Portfolio exposure gate | HIGH |
| `swingCashCostModel.ts` | trading-engine | Transaction cost model | HIGH |
| `swingCashTypes.ts` | shared | Type definitions for swing cash engine | HIGH |
| `swingScanner.ts` | scanner | Pro Swing Scanner v3 pure-math | HIGH |
| `swingScannerStore.ts` | scanner | Swing scan scheduler + result store | HIGH |
| `swingScannerData.ts` | data-source | Swing scan data fetcher (Kite-first + Yahoo fallback) | HIGH |
| `swingSignals.ts` | trading-engine | Swing signal generation | HIGH |
| `swingKillSwitch.ts` | trading-engine | Kill-switch for swing engine | HIGH |
| `swingLiveExecutionConfig.ts` | trading-engine | `LIVE_CASH_SWING_ORDER_ENABLED` flag | CRITICAL |
| `swingDryRunBroker.ts` | trading-engine | Dry-run broker stub | HIGH |
| `swingShadowDiagnostic.ts` | trading-engine | Shadow diagnostic for swing | MEDIUM |

#### Paper Trading
| File | Domain | Purpose | Risk |
|---|---|---|---|
| `paperTradingFO.ts` | trading-engine | F&O paper auto-trader (openPaperTrade, tick, close) | CRITICAL |
| `paperTradingEq.ts` | trading-engine | Equity paper auto-trader | CRITICAL |
| `paperTradingCombo.ts` | trading-engine | Multi-leg combo paper trading | HIGH |
| `paperAccount.ts` | trading-engine | Capital ledger, DD caps, heat budget, sizing | CRITICAL |
| `paperAutoTradeFlag.ts` | trading-engine | `isPaperAutoTradingEnabled()` — fail-closed flag | CRITICAL |
| `paperReportsFO.ts` | trading-engine | F&O paper reports + analytics | MEDIUM |
| `paperReportsEq.ts` | trading-engine | Equity paper reports | MEDIUM |
| `paperAnalyticsFO.ts` | trading-engine | F&O analytics | MEDIUM |
| `paperEqAudit.ts` | trading-engine | Equity audit | MEDIUM |
| `paperDailySummaryFo.ts` | trading-engine | Daily F&O summary | MEDIUM |

#### Alerting
| File | Domain | Purpose | Risk |
|---|---|---|---|
| `alerting.ts` | alerting | Core alerting — `alertOwner()`, Telegram dispatch, dedup, rate-limit | CRITICAL |
| `swingAlerts.ts` | alerting | Swing-specific alert builder (see swording rules) | CRITICAL |
| `tradingViewAlerts.ts` | alerting | TradingView webhook parser/handler | HIGH |
| `notifications/` | alerting | Notification helpers | MEDIUM |

#### Scanner / Scoring
| File | Domain | Purpose | Risk |
|---|---|---|---|
| `scanner.ts` | scanner | Main NIFTY 500 scanner orchestration | HIGH |
| `fullNseScanner.ts` | scanner | Full NSE universe scanner | HIGH |
| `scannerFastPath.ts` | scanner | Fast-path scanner for cached results | HIGH |
| `scannerProvenance.ts` | scanner | Scanner row provenance stamping | HIGH |
| `scoring.ts` | scanner | Signal scoring + entry safety gate | HIGH |
| `sectorMap.ts` | scanner | Sector/industry mapping | MEDIUM |
| `sectorCoverage.ts` | scanner | Sector coverage diagnostics | MEDIUM |
| `sectorStrength.ts` | scanner | Relative sector strength | MEDIUM |
| `indicators.ts` | scanner | Technical indicators (EMA, RSI, etc.) | HIGH |
| `tradeSetups.ts` | scanner | Trade setup detection | HIGH |
| `deepscan.ts` | scanner | Per-symbol deep scan | HIGH |
| `stocksToWatch.ts` | scanner | Stocks-to-watch aggregation | MEDIUM |

#### Auth / System
| File | Domain | Purpose | Risk |
|---|---|---|---|
| `auth.ts` (lib) | auth | HMAC-SHA256 session, role-based access | CRITICAL |
| `userAuth.ts` (lib) | auth | User account management | HIGH |
| `publicAccess.ts` | auth | Public-mode access rules | HIGH |
| `securityAudit.ts` | auth | Security audit endpoint | HIGH |
| `systemStatus.ts` | backend | System status | LOW |
| `logger.ts` | backend | Structured logger (pino) — use `req.log` in routes | LOW |
| `appStateStore.ts` | backend | In-memory app state | MEDIUM |

---

## Frontend — `artifacts/scanner/src/`

### Pages (`src/pages/`)
| File | Domain | Purpose |
|---|---|---|
| `dashboard.tsx` (index) | frontend | Home / market pulse |
| `scanner.tsx` | scanner | NIFTY 500 equity scanner |
| `stock-detail.tsx` | scanner | Per-symbol detail + entry plan |
| `deep-scan.tsx` | scanner | Deep scan results |
| `options.tsx` | trading-engine | F&O signal display |
| `option-chain.tsx` | trading-engine | Live option chain |
| `oi-lab.tsx` | trading-engine | OI lab |
| `paper-trading.tsx` | trading-engine | Live paper trading dashboard |
| `paper-reports.tsx` | trading-engine | Paper trade history + analytics |
| `backtest-lab.tsx` | trading-engine | Backtest lab UI |
| `charting.tsx` | charting | TradingView-powered chart |
| `portfolio-analyser.tsx` | portfolio | Portfolio analyser (Phase 1+2) |
| `stocks-to-watch.tsx` | scanner | Pro Swing Scanner v3 |
| `sectors.tsx` | scanner | Sector analysis |
| `sector-detail.tsx` | scanner | Per-sector detail |
| `premarket.tsx` | data-source | Pre-market cues |
| `indices.tsx` | data-source | Index board |
| `flows.tsx` | data-source | FII/DII institutional flows |
| `news.tsx` | data-source | News feed |
| `infra-health.tsx` | backend | Owner-only infra health dashboard |
| `fno-diagnostics.tsx` | trading-engine | F&O diagnostics UI |
| `kite.tsx` | data-source | Kite session management |
| `admin.tsx` | auth | Owner-only admin panel |
| `audit.tsx` | auth | Security audit |

### Key Frontend Libraries (`src/lib/`)
| File | Purpose |
|---|---|
| `auth-api.ts` | Auth hooks + tab access control |
| `fnoEmptyState.ts` | F&O empty-state / banner logic |
| `infraHealth.ts` | Infra health severity helpers |
| `optionChainFilters.ts` | Option chain filter helpers |
| `portfolio/` | Portfolio pure libs (calc, csv, score, risk, allocation) |
| `fno/` | F&O frontend helpers |
| `charting/` | Charting datafeed client |

---

## Shared Libraries — `lib/`

| Package | Purpose |
|---|---|
| `lib/db/src/schema/` | Drizzle ORM schema — 20 tables |
| `lib/api-spec/openapi.yaml` | OpenAPI spec (source of truth) |
| `lib/api-client-react/` | Generated React Query hooks (DO NOT EDIT MANUALLY) |
| `lib/api-zod/` | Generated Zod schemas (DO NOT EDIT MANUALLY) |
| `lib/indicators/` | Pure math indicators (EMA, RSI, ATR, VWAP, etc.) |

---

## Scripts — `scripts/src/`

| File | Purpose |
|---|---|
| `generateLlmIndex.ts` | **LLM index generator** — run: `pnpm --filter @workspace/scripts run index:llm` |
| `checkLlmIndex.ts` | **Stale index checker** — run: `pnpm --filter @workspace/scripts run index:llm:check` |
| `refreshNifty500SectorReference.ts` | Refresh NIFTY 500 sector weights from NSE CSV |
| `fixBacktestTradeTimes.ts` | One-off timezone backfill for pre-fix backtest runs |
| `dedupeFnoSignalReasoning.ts` | Dedup F&O signal reasoning records |

---

## Configuration Files

| File | Purpose |
|---|---|
| `pnpm-workspace.yaml` | Workspace package discovery, catalog, overrides |
| `tsconfig.base.json` | Shared strict TS defaults |
| `tsconfig.json` | Root TS solution config (lib composites only) |
| `lib/api-spec/openapi.yaml` | OpenAPI spec — edit this, then run codegen |
| `lib/db/src/schema/*.ts` | Drizzle schema — edit here, then `ALTER TABLE` in DB |
| `.gitignore` | Git ignores |

---

## Test Files

All test files follow `*.test.ts` naming. Key ones:

| Test | Covers |
|---|---|
| `swingAlerts.test.ts` | Swing alert wording enforcement (58 tests) |
| `alerting.test.ts` | Core alerting dedup/rate-limit |
| `swingOrderStaging.test.ts` | Swing staging lifecycle |
| `paperHeatSql.test.ts` | Heat cap SQL regression |
| `optionSignalGates.*.test.ts` | F&O gate logic |
| `fnoPaperRiskGuards.test.ts` | F&O risk guard pack |
| `deepscan.honesty.test.ts` | Deep scan data honesty |
| `scannerProvenance.test.ts` | Scanner provenance stamping |
| `marketData/*.test.ts` | Market data layer trust gates |
| `infraHealth.test.ts` | Infra health severity helpers |
| `portfolio/*.test.ts` | Portfolio pure math |
