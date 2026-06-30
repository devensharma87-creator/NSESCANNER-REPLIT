# Critical Flows

End-to-end flows for the most important system behaviors.

---

## 1. Kite Data Ingestion / Live Quotes

**Risk: CRITICAL**

```
KiteTicker WebSocket (index spots)
  → lib/kiteFeed.ts → in-memory spot cache
  → consumed by: optionSignals.ts (SIGNAL_INDEX_TO_LTP_KEY)

Kite REST batch quote (equities/F&O)
  → lib/kiteScanner.ts → routes/scanner.ts
  → marketData/router.ts (TrustedQuote)
  → scanner.ts, deepscan.ts, swingOrderStaging.ts

Kite historical candles (15-min)
  → lib/kiteIntraday.ts
  → F&O signal engine (intraday VP, EMA stacks)
  → Swing scanner data (swingScannerData.ts)

Kite option chain
  → lib/kiteOptionChain.ts
  → marketData/optionChainProvider.ts (trusted facade)
  → optionSignals.ts, paper.ts (openPaperTrade)
```

**Entry point:** `lib/kiteFeed.ts` (WebSocket), `lib/kiteScanner.ts` (REST batch)  
**Trust layer:** `lib/marketData/router.ts` (all quote data must pass through here)  
**DB tables touched:** `kite_session` (auth), `candle` (warehouse write-through)  
**Frontend:** `KiteOfflineBanner` on scanner/stock-detail/deep-scan, `KiteOfflineNote` on fundamentals  
**Verification:** `pnpm --filter @workspace/api-server run test` → `marketData/*.test.ts`  
**Known danger:** Session expiry → silent fallback to Yahoo; must show `KiteOfflineBanner`

---

## 2. NSE/BSE Scanner Flow

**Risk: HIGH**

```
GET /api/stocks
  → routes/scanner.ts
  → lib/scanner.ts (orchestration)
  → lib/kiteScanner.ts (batch quotes — Kite authoritative)
  → lib/indicators.ts (EMA, RSI, ATR)
  → lib/scoring.ts (signal score, entry safety gate)
  → lib/sectorMap.ts (sector classification)
  → lib/scannerProvenance.ts (stamps source per row)
  → JSON response with StockRow[] + provenance

Deep scan:
  GET /api/deep-scan/:symbol
  → routes/deepscan.ts → lib/deepscan.ts
  → Kite historical + Yahoo fundamentals (labeled)
  → lib/scoring.ts → EntryPlanCard data
```

**Entry:** `routes/scanner.ts`, `routes/deepscan.ts`  
**Key lib:** `lib/scanner.ts`, `lib/kiteScanner.ts`, `lib/scoring.ts`, `lib/scannerProvenance.ts`  
**DB tables:** none (scanner is stateless; results not persisted)  
**Frontend:** `pages/scanner.tsx`, `pages/stock-detail.tsx`, `pages/deep-scan.tsx`  
**Source honesty:** `scannerProvenance.ts` stamps each row with signal source; a Kite LTP tick cannot retroactively promote Yahoo-sourced signal  
**Verification:** `scannerProvenance.test.ts`, `deepscan.honesty.test.ts`

---

## 3. F&O Option-Chain Signal Flow

**Risk: CRITICAL**

```
Phase 1: Regime classification
  → lib/regimeClassifier.ts (IVR/IVP, daily/weekly DD caps)

Phase 2: EMA20/50 + intraday VP (15-min Kite candles)
  → lib/kiteIntraday.ts → confluenceEngine.ts

Phase 3: Confluence engine (replaces per-detector confidence)
  → lib/confluenceEngine.ts
  → lib/optionSignalGates.ts (HTF, noise, RS, win-rate gates)
  → lib/optionSignalVetoes.ts

Phase 4: KiteTicker live index spot
  → lib/kiteFeed.ts → optionSignals.ts (SIGNAL_INDEX_TO_LTP_KEY)

Signal emission:
  → lib/optionSignals.ts → fetchKiteOptionChain (premium validation)
  → lib/paperTradingFO.ts (openPaperTrade) — gated by isPaperAutoTradingEnabled()
  → lib/alerting.ts (F&O owner alert — stub/log only currently)

Signal guards (fail-OPEN on data failure):
  HTF daily-EMA50, True-1h HTF, time-of-day, expiry-day,
  sector RS, 30-day win-rate, ATM-OI confluence, post-stop cooldown
```

**Entry:** Scheduled tick in `lib/paperTradingFO.ts` (`runFnoPaperTradingTick`)  
**Key lib:** `optionSignals.ts`, `confluenceEngine.ts`, `optionSignalGates.ts`, `paperTradingFO.ts`, `paperAccount.ts`  
**DB tables:** `option_signals`, `paper_trade_fo`, `paper_account`, `fno_signal_reasoning`  
**Frontend:** `pages/options.tsx`, `components/fno/`, `pages/fno-diagnostics.tsx`  
**Verification:** `optionSignalGates.*.test.ts`, `fnoPaperRiskGuards.test.ts`, `paperTradingFO.premiumPath.test.ts`  
**Known danger:** `isPaperAutoTradingEnabled()` must fail-CLOSED; manual buys are not gated

---

## 4. Swing Cash Staged-Order Flow

**Risk: CRITICAL**

```
1. Swing scanner (once-per-day after 15:35 IST)
   → lib/swingScannerStore.ts → lib/swingScanner.ts
   → lib/swingScannerData.ts (Kite-first, Yahoo fallback)
   → Result stored in swing_scan table

2. Risk evaluation (when order is staged)
   POST /api/swing/staged-orders
   → routes/swingStaging.ts → lib/swingOrderStaging.ts
   → lib/swingCashDataTrust.ts (Kite data freshness gate)
   → lib/swingCashEntryGate.ts (LTP vs entry/stop checks)
   → lib/swingCashSizing.ts (position sizing)
   → lib/swingCashLiquidity.ts (ASM/GSM, volume)
   → lib/swingCashEventRisk.ts (corporate actions)
   → lib/swingCashExposure.ts (portfolio exposure caps)
   → lib/swingCashCostModel.ts (brokerage, STT, charges)
   → DB write: swing_order_staging table
   → lib/swingAlerts.ts → alertOwner() → Telegram

3. Approval flow
   POST /api/swing/staged-orders/:id/approve (owner-only)
   → lib/swingOrderStaging.ts (approveSwingOrder)
   → lib/swingDryRunBroker.ts (dry-run, no real order)
   → alertSwingOrderApprovedDryRun()

4. Manual expire
   POST /api/swing/staged-orders/:id/expire (owner-only)
   → lib/swingOrderStaging.ts (manuallyExpireSwingOrder)
   → alertSwingOrderExpired() → Telegram SWING_ORDER_EXPIRED

5. TTL expire (scheduler, runs hourly)
   → lib/swingOrderStaging.ts (expireStaleSwingOrders)
   → alertSwingOrderExpired() → Telegram SWING_ORDER_EXPIRED
```

**Alert wording (NEVER CHANGE):**
- `Risk eval: kite (as of <time>)` ← data source label
- `Note: Entry is the staged limit order price — not current market price`
- Telegram events: `SWING_ORDER_STAGED`, `SWING_ORDER_APPROVAL_REQUIRED`, `SWING_ORDER_EXPIRED`, `SWING_ORDER_REJECTED`, `SWING_ORDER_APPROVED_DRY_RUN`, `SWING_ORDER_BLOCKED_BY_RISK`

**Entry:** `POST /api/swing/staged-orders`  
**Key lib:** `swingOrderStaging.ts`, `swingAlerts.ts`, `swingCash*.ts`, `alerting.ts`  
**DB tables:** `swing_order_staging`  
**Frontend:** Currently Telegram-only; no dedicated UI page for staging in v1  
**Broker:** HARD-DISABLED. `LIVE_CASH_SWING_ORDER_ENABLED` must be false. `brokerOrderId` always null, `brokerStatus` always `BROKER_DISABLED`  
**Verification:** `swingAlerts.test.ts` (58 tests), `swingOrderStaging.test.ts`, `swingCash*.test.ts`

---

## 5. Telegram Alert Delivery Flow

**Risk: HIGH**

```
alertOwner(event, message)
  → lib/alerting.ts
  → In-memory dedup check (15min per-order for STAGED/EXPIRED/REJECTED/APPROVED; 1h symbol+setupKey for BLOCKED)
  → Rate-limit check
  → Telegram Bot API: POST https://api.telegram.org/bot<TOKEN>/sendMessage
  → In-memory lastAlert + lastSwingAlert state update
  → Structured log: WARN [alertEvent]

Rate limits:
  - 15-min dedup per order event
  - 1-hour dedup for symbol+setupKey BLOCKED events
  - POST /api/alerts/test-swing-staged-order: 30s rate-limit
  - POST /api/alerts/test-telegram: separate limit

Env vars required:
  TELEGRAM_BOT_TOKEN — bot token (never logged)
  TELEGRAM_CHAT_ID — destination chat ID (never logged)
```

**Entry:** `lib/alerting.ts` → `alertOwner()`  
**Swing alerts:** `lib/swingAlerts.ts` → `alertSwingOrderStaged()`, `alertSwingOrderExpired()`, etc.  
**Diagnostics:** `GET /api/alerts/status` (owner-only) → `lastAlert`, `lastSwingAlert` in-memory state  
**Test endpoints:** `POST /api/alerts/test-telegram`, `POST /api/alerts/test-swing-staged-order`  
**Verification:** `alerting.test.ts`, `swingAlerts.test.ts`  
**Production-verified:** `telegramStatus: SENT` for all 7 event types

---

## 6. Portfolio Manual Add / Resolver / Pricing Flow

**Risk: MEDIUM**

```
Portfolio Analyser (Phase 2 — DB-persisted per user):

1. Holdings input
   CSV upload OR manual entry (qty, rate, date, broker, tag)
   → lib/portfolio/csv.ts (parser + row validation)
   → lib/portfolio/calc.ts (per-holding metrics, XIRR)

2. Live pricing
   useGetStockDetail() React Query hook
   → GET /api/deep-scan/:symbol (Kite LTP primary)
   → Yahoo fundamentals (labeled)

3. Risk + analytics
   → lib/portfolio/risk.ts (HHI, concentration flags)
   → lib/portfolio/allocation.ts (sector/stock/market-cap views)
   → lib/portfolio/score.ts (structure score — SEBI-neutral labels only)
   → lib/portfolio/benchmark.ts (Nifty 500 buy-and-hold return)

4. Persistence
   → POST /api/portfolios (create)
   → PUT /api/portfolios/:id (update holdings)
   → DB: portfolios + portfolio_holdings tables (ownerKey-scoped)

Honesty rules:
  - "Benchmark unavailable" shown when Nifty 500 data absent
  - "CMP unavailable" shown when Kite quote unavailable
  - SEBI-neutral vocab only: Strong Structure / Hold with Review / etc.
  - NO targetPrice / stopLoss / signal surfaced from score.ts
```

**Entry:** `pages/portfolio-analyser.tsx`  
**Key lib:** `lib/portfolio/*.ts` (calc, csv, score, risk, allocation, benchmark)  
**DB tables:** `portfolios`, `portfolio_holdings`  
**Frontend:** `pages/portfolio-analyser.tsx`, `components/portfolio/`  
**Verification:** `csv.test.ts`, `calc.test.ts`, `score.test.ts` (395/395 scanner tests)

---

## 7. Chart Candle Source / Provenance Flow

**Risk: HIGH**

```
TradingView chart datafeed:
  GET /api/chart/instruments → lib/chartInstruments.ts
    Merges curated list + Kite instrument master
    Dedupes by symbol (NSE wins, BSE-only like NSDL survives)
    Returns quote_source field

  GET /api/chart/candles?symbol=&timeframe=&from=&to=
    → routes/chart.ts → lib/chartDatafeed.ts
    → lib/kiteIntraday.ts OR lib/nseBhavcopy.ts (EOD)
    → Provenance: source stamped per candle
    → isFreshFor() freshness check (TIMEFRAME_CONFIG)
    → Returns candles with isStale/asOf/source fields

Provenance rules:
  - Intraday badge: "live" or "delayed" (never "live" for EOD)
  - asOf must be SECONDS (DailyBars are ms — gotcha: convert)
  - IST-local naive timestamps in CSV exports (not ISO 8601)
  - BSE prices via Kite by instrument_token (source=kite even for BSE)
```

**Entry:** `routes/chart.ts`  
**Key lib:** `lib/chartDatafeed.ts`, `lib/chartInstruments.ts`, `lib/marketData/provenance.ts`  
**DB tables:** `candle` (warehouse substrate, not primary source)  
**Frontend:** `pages/charting.tsx`, `components/charting-chart.tsx`  
**Verification:** `chartDatafeed.test.ts`, `chart.provenance.test.ts`, `chartInstruments.test.ts`

---

## 8. Auth-Protected Production Endpoints

**Risk: CRITICAL**

```
Auth middleware stack:
  public-mode GET → requirePublicOrAuth → passes
  subscriber   → requireSubscriberOrOwner()
  owner        → requireOwner (strict)

Session:
  HMAC-SHA256 HttpOnly session cookie
  lib/auth.ts → verifySession()
  DB: users table (role: owner | subscriber | viewer)

Public-mode:
  Entire site readable via shareable URL (no auth needed for GET)
  Mutations require auth

Owner-only endpoints (partial list):
  POST /api/swing/staged-orders
  POST /api/alerts/test-*
  POST /api/paper/positions/fo/:id/close
  GET  /api/fno/*
  GET  /api/paper/diagnostics/*
  GET  /api/data/*
  GET  /api/option-snapshots/analytics
  GET  /api/admin/users

Legal pages:
  /legal/* bypass login (stripped-down UI)
```

**Entry:** `src/middlewares/` (requireOwner, requireSubscriberOrOwner, requireOwnerStrict)  
**Key lib:** `lib/auth.ts`, `lib/publicAccess.ts`, `lib/userAuth.ts`  
**DB tables:** `users`  
**Frontend:** `components/access-guard.tsx`, `components/login-gate.tsx`  
**Verification:** All unauth endpoint probes must return 401; auth probes return data  
**Known danger:** `requireOwner` allows anonymous GET in public mode → use `requireOwnerStrict` for endpoints that expose secret metadata
