# API Routes Index

All backend routes. Base path: `/api` (served by `artifacts/api-server`).

Auth legend: **PUBLIC** = unauthenticated allowed | **SUBSCRIBER+** = subscriber or owner | **OWNER** = owner only | **OWNER_STRICT** = owner only, no public-mode bypass

Rate-limit legend: **RL** = rate-limited

Risk: **LOW** | **MEDIUM** | **HIGH** | **CRITICAL**

---

## Health

| Method | Path | Auth | Purpose | Risk |
|---|---|---|---|---|
| GET | `/api/healthz` | PUBLIC | Server health check | LOW |

---

## Auth

| Method | Path | Auth | Purpose | Risk |
|---|---|---|---|---|
| POST | `/api/auth/login` | PUBLIC | Owner login (password) | HIGH |
| POST | `/api/auth/logout` | PUBLIC | Clear session cookie | MEDIUM |
| GET | `/api/auth/me` | PUBLIC | Current session info | MEDIUM |
| POST | `/api/auth/signup` | OWNER | Create subscriber account | HIGH |
| GET | `/api/auth/users` | OWNER | List users | HIGH |
| DELETE | `/api/auth/users/:id` | OWNER | Delete user | HIGH |

---

## Scanner

| Method | Path | Auth | Purpose | Risk |
|---|---|---|---|---|
| GET | `/api/stocks` | PUBLIC | NIFTY 500 scanner — Kite batch quotes + signals | HIGH |
| GET | `/api/deep-scan/:symbol` | PUBLIC | Per-symbol deep scan (Kite + Yahoo labeled) | HIGH |
| GET | `/api/stocks-to-watch/analysis` | PUBLIC | Pro Swing Scanner v3 results | HIGH |
| GET | `/api/stocks-to-watch/diagnostics/sector-coverage` | OWNER | Sector coverage diagnostics | MEDIUM |

---

## Indices / Pre-market / Global

| Method | Path | Auth | Purpose | Risk |
|---|---|---|---|---|
| GET | `/api/indices` | PUBLIC | Kite index board (NIFTY, SENSEX, etc.) | HIGH |
| GET | `/api/indices/:symbol` | PUBLIC | Single index detail | HIGH |
| GET | `/api/indices/futures-volume` | PUBLIC | Index futures volume | MEDIUM |
| GET | `/api/indices/global` | PUBLIC | Global cues (Yahoo) | MEDIUM |
| GET | `/api/pre-market` | PUBLIC | Pre-market data | MEDIUM |

---

## Home / Dashboard

| Method | Path | Auth | Purpose | Risk |
|---|---|---|---|---|
| GET | `/api/home/enrichment` | PUBLIC | Home dashboard aggregated data | MEDIUM |

---

## Kite Session

| Method | Path | Auth | Purpose | Risk |
|---|---|---|---|---|
| GET | `/api/kite/status` | OWNER | Kite session status | HIGH |
| POST | `/api/kite/connect` | OWNER | Store new Kite access token | CRITICAL |
| POST | `/api/kite/disconnect` | OWNER | Clear Kite session | HIGH |

---

## Option Chain & OI

| Method | Path | Auth | Purpose | Risk |
|---|---|---|---|---|
| GET | `/api/option-chain/:underlying` | PUBLIC | Live option chain (Kite) | CRITICAL |
| GET | `/api/option-chain/:underlying/oi-buildup` | PUBLIC | OI buildup detection | HIGH |
| GET | `/api/oi-lab/:underlying` | PUBLIC | OI lab analysis | HIGH |

---

## Option Strategies

| Method | Path | Auth | Purpose | Risk |
|---|---|---|---|---|
| GET | `/api/options/strategies/:underlying` | PUBLIC | Regime-ranked strategy bundle (13 strategies) | MEDIUM |
| POST | `/api/options/strategies/:underlying/custom` | PUBLIC | Custom strategy builder payoff | MEDIUM |

---

## F&O Diagnostics (Owner-only, read-only)

| Method | Path | Auth | Purpose | Risk |
|---|---|---|---|---|
| GET | `/api/fno/data-health` | OWNER | F&O data health (Kite session, cycle state) | HIGH |
| GET | `/api/fno/diagnostics/today` | OWNER | Today's F&O signal diagnostics | HIGH |
| GET | `/api/fno/diagnostics/gate-waterfall` | OWNER | Gate pass/fail waterfall | HIGH |
| GET | `/api/fno/diagnostics/no-trade-reasons` | OWNER | No-trade reason distribution | HIGH |
| GET | `/api/fno/diagnostics/setup-performance` | OWNER | Setup win-rate performance | HIGH |
| GET | `/api/fno/diagnostics/blocked-signals` | OWNER | Blocked signal log | HIGH |
| GET | `/api/fno/no-signal-gap` | OWNER | Trading-day gap since last signal | HIGH |

---

## Paper Trading — F&O + Equity (Owner-only)

| Method | Path | Auth | Purpose | Risk |
|---|---|---|---|---|
| GET | `/api/paper/account` | OWNER | Capital account + MTM | CRITICAL |
| GET | `/api/paper/positions/fo` | OWNER | Open F&O positions | CRITICAL |
| GET | `/api/paper/trades/fo` | OWNER | Closed F&O trade history | HIGH |
| POST | `/api/paper/positions/fo/:id/close` | OWNER | Manual close F&O position | CRITICAL |
| POST | `/api/paper/account/topup` | OWNER | Add capital to account | HIGH |
| POST | `/api/paper/account/withdraw` | OWNER | Withdraw capital | HIGH |
| GET | `/api/paper/missed/fo` | OWNER | Missed F&O opportunity log | MEDIUM |
| GET | `/api/paper/events/eq` | OWNER | Equity paper trade events | HIGH |
| GET | `/api/paper/diagnostics/environment` | PUBLIC | Auto-trading enabled/disabled (no secrets) | LOW |
| GET | `/api/paper/analytics/fo` | OWNER | F&O analytics | HIGH |
| GET | `/api/paper/analytics/fo/failure-diagnosis` | OWNER | Failure diagnosis | HIGH |
| GET | `/api/paper/analytics/fo/shadow-costs` | OWNER | Shadow cost model | MEDIUM |
| GET | `/api/paper/analytics/fo/shadow-exits` | OWNER | Shadow exit simulation | MEDIUM |
| GET | `/api/paper/diagnostics/fno-observability` | OWNER | F&O observability metrics | HIGH |
| GET | `/api/paper/diagnostics/fno-reasoning` | OWNER | Signal reasoning log | HIGH |
| GET | `/api/paper/diagnostics/fno-reasoning/analytics` | OWNER | Reasoning analytics | MEDIUM |
| GET | `/api/paper/diagnostics/daily-summary/fo` | OWNER | Daily F&O summary | MEDIUM |
| GET | `/api/paper/diagnostics/fo/mtm-sweep` | OWNER | MTM sweep state | HIGH |
| GET | `/api/paper/diagnostics/fo/exit-safety` | OWNER | Exit safety latch state | HIGH |
| GET | `/api/paper/eq/sizing-preview` | OWNER | Equity sizing preview (diagnostic only) | MEDIUM |
| GET | `/api/paper/eq/candidates-diagnostic` | OWNER | Equity candidate diagnostic | MEDIUM |

---

## Paper Combo (Owner-only — Tier C manual multi-leg)

| Method | Path | Auth | Purpose | Risk |
|---|---|---|---|---|
| POST | `/api/paper/combos` | OWNER | Open multi-leg combo paper trade | HIGH |
| GET | `/api/paper/combos` | OWNER | List open/closed combos | HIGH |
| GET | `/api/paper/combos/:id` | OWNER | Combo detail (live re-mark) | HIGH |
| POST | `/api/paper/combos/:id/close` | OWNER | Close combo | HIGH |

---

## Swing Staging (CRITICAL — Broker hard-disabled)

| Method | Path | Auth | Purpose | Risk |
|---|---|---|---|---|
| GET | `/api/swing/status` | SUBSCRIBER+ | Swing system status | HIGH |
| POST | `/api/swing/kill-switch` | OWNER | Enable/disable swing system | CRITICAL |
| GET | `/api/swing/staged-orders` | SUBSCRIBER+ | List staged orders | HIGH |
| POST | `/api/swing/staged-orders` | OWNER | **Create staged order** (broker DISABLED) | CRITICAL |
| POST | `/api/swing/staged-orders/expire-stale` | OWNER | TTL-expire stale orders | HIGH |
| GET | `/api/swing/staged-orders/:id` | SUBSCRIBER+ | Order detail | HIGH |
| POST | `/api/swing/staged-orders/:id/refresh` | OWNER | Re-evaluate risk | HIGH |
| POST | `/api/swing/staged-orders/:id/approve` | OWNER | Approve (dry-run only) | CRITICAL |
| POST | `/api/swing/staged-orders/:id/reject` | OWNER | Reject order | HIGH |
| POST | `/api/swing/staged-orders/:id/watch` | OWNER | Mark for watching | MEDIUM |
| POST | `/api/swing/staged-orders/:id/expire` | OWNER | Manual expire | HIGH |

**Safety invariants:** `brokerOrderId` is always null. `brokerStatus` is always `BROKER_DISABLED`. `LIVE_CASH_SWING_ORDER_ENABLED` must be unset/false.

---

## Alerts (Owner-only)

| Method | Path | Auth | Purpose | Risk |
|---|---|---|---|---|
| GET | `/api/alerts/status` | OWNER | Last alert + lastSwingAlert state | HIGH |
| POST | `/api/alerts/test-telegram` **[TEST RL]** | OWNER | Send test F&O Telegram alert | HIGH |
| POST | `/api/alerts/test-swing-staged-order` **[SAMPLE RL]** | OWNER | Send sample swing alert (`[SAMPLE]` labeled) | HIGH |

**Note:** Test endpoints are rate-limited. Second immediate call → 429.

---

## Portfolio (Owner/Subscriber — per-user)

| Method | Path | Auth | Purpose | Risk |
|---|---|---|---|---|
| GET | `/api/portfolios` | SUBSCRIBER+ | List user's portfolios | MEDIUM |
| POST | `/api/portfolios` | SUBSCRIBER+ | Create portfolio | MEDIUM |
| GET | `/api/portfolios/:id` | SUBSCRIBER+ | Get portfolio + holdings | MEDIUM |
| PUT | `/api/portfolios/:id` | SUBSCRIBER+ | Update portfolio holdings | MEDIUM |
| DELETE | `/api/portfolios/:id` | SUBSCRIBER+ | Delete portfolio | MEDIUM |

---

## Charting

| Method | Path | Auth | Purpose | Risk |
|---|---|---|---|---|
| GET | `/api/chart/instruments` | PUBLIC | Instrument search (NSE+BSE merged, Kite tokens) | HIGH |
| GET | `/api/chart/candles` | PUBLIC | TradingView candle datafeed (Kite historical) | HIGH |

---

## Institutional Flows

| Method | Path | Auth | Purpose | Risk |
|---|---|---|---|---|
| GET | `/api/inst-flows/fii-dii` | PUBLIC | FII/DII daily flows | MEDIUM |
| GET | `/api/inst-flows/participant-oi` | PUBLIC | Participant OI data | MEDIUM |

---

## Backtest Lab

| Method | Path | Auth | Purpose | Risk |
|---|---|---|---|---|
| GET | `/api/backtest/fno/runs` | SUBSCRIBER+ | List backtest runs | HIGH |
| GET | `/api/backtest/fno/runs/:id` | SUBSCRIBER+ | Backtest run detail | HIGH |
| POST | `/api/backtest/fno/runs` | OWNER | Create/trigger backtest run | HIGH |
| GET | `/api/backtest/fno/runs/:id/risk-guard-simulation` | OWNER | Risk guard simulation on replay | HIGH |

---

## Data Layer Diagnostics (Owner-only)

| Method | Path | Auth | Purpose | Risk |
|---|---|---|---|---|
| GET | `/api/data/diagnostics` | OWNER | Central market-data layer health | HIGH |
| GET | `/api/data/symbol/:symbol` | OWNER | Per-symbol trust-tier diagnostic | HIGH |
| POST | `/api/data/compare` | OWNER | Kite vs INDstocks side-by-side | HIGH |

---

## Option Chain Snapshots (Owner-only)

| Method | Path | Auth | Purpose | Risk |
|---|---|---|---|---|
| GET | `/api/option-snapshots/diagnostics` | OWNER | Snapshot store diagnostics | HIGH |
| GET | `/api/option-snapshots/analytics` | OWNER_STRICT | PCR / OI / IV / max-pain analytics | HIGH |
| POST | `/api/option-snapshots/ingest` | OWNER | Manual snapshot ingest | HIGH |

---

## Candle Warehouse (Owner-only)

| Method | Path | Auth | Purpose | Risk |
|---|---|---|---|---|
| GET | `/api/candles/diagnostics` | OWNER | Candle warehouse diagnostics | HIGH |
| POST | `/api/candles/sync` | OWNER | Manual sync trigger | HIGH |

---

## TradingView Alerts

| Method | Path | Auth | Purpose | Risk |
|---|---|---|---|---|
| POST | `/api/tradingview/webhook` | HMAC | TradingView webhook receiver (TRADINGVIEW_WEBHOOK_SECRET) | HIGH |

---

## System / Admin

| Method | Path | Auth | Purpose | Risk |
|---|---|---|---|---|
| GET | `/api/system/status` | PUBLIC | System status | LOW |
| GET | `/api/admin/users` | OWNER | List all users | HIGH |
| DELETE | `/api/admin/users/:id` | OWNER | Delete user account | HIGH |
| GET | `/api/security/audit` | OWNER | Security audit report | HIGH |
