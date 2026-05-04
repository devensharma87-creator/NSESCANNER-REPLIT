# Stock Scanner Pro — Complete Project Data File

**Project Name:** stock-scanner-pro-devensharma87
**Domain:** marketscannerbydev.in
**Generated:** 2026-05-04
**Git Commits:** 289
**Total TypeScript Lines:** ~112,360

---

## 1. Project Overview

Stock Scanner Pro is a private, comprehensive Indian stock market scanner and analysis platform for NSE/BSE. It is built as a pnpm monorepo using TypeScript, with an Express 5 API backend, React + Vite frontends, and PostgreSQL (Drizzle ORM) for persistence. The platform provides real-time market scanning, advanced options chain analysis, F&O intraday signals, paper trading, sector analysis, and a standalone global multi-asset scanner.

**Primary Data Sources:**
- Zerodha Kite Connect API — primary live market data, option chains, F&O universe, WebSocket tick feed
- Yahoo Finance API — delayed fallback (15-min lag)
- NSE India — option chains (fallback), bhavcopy
- TradingView — webhook integration, GIFT NIFTY data
- Binance API — crypto data for Global Scanner
- News Feeds — Moneycontrol, Mint, Economic Times, CNBC TV18, Business Standard, Investing.com

**Authentication:** HMAC-SHA256 signed HttpOnly session cookies with rate limiting and role-based access control.

---

## 2. Monorepo Structure

```
stock-scanner-pro/
├── artifacts/                    # Deployable applications
│   ├── api-server/               # Express 5 backend API (28,294 lines)
│   ├── scanner/                  # NSE Stock Scanner React+Vite frontend (28,112 lines)
│   ├── global/                   # Global Multi-Asset Scanner React+Vite frontend (9,184 lines)
│   └── mockup-sandbox/           # Component Preview Server (dev tooling)
├── lib/                          # Shared libraries (46,770 lines)
│   ├── api-spec/                 # OpenAPI 3.1 specification (3,483 lines, 66 operations)
│   ├── api-client-react/         # Generated TanStack Query hooks + custom fetch
│   ├── api-zod/                  # Generated Zod validation schemas
│   └── db/                       # Drizzle ORM schema + PostgreSQL connection
├── scripts/                      # Utility scripts
├── exports/                      # Backup exports
├── backups/                      # Source backups
├── package.json                  # Root workspace orchestration
├── pnpm-workspace.yaml           # Workspace config + catalog pins
├── tsconfig.base.json            # Shared strict TS defaults
├── tsconfig.json                 # Root solution config (libs only)
└── replit.md                     # Project documentation
```

---

## 3. Workspace Packages

### 3.1 @workspace/api-server
- **Path:** `artifacts/api-server/`
- **Type:** Express 5 Node.js server
- **Entry:** `src/index.ts` → `src/app.ts`
- **Build:** esbuild via `build.mjs`
- **Port:** 8080 (proxied at `/api`)
- **Key Dependencies:** express@5, kiteconnect@5.2, yahoo-finance2@3.14, drizzle-orm, pino, helmet, cookie-parser, cors, express-rate-limit, zod

### 3.2 @workspace/scanner
- **Path:** `artifacts/scanner/`
- **Type:** React + Vite SPA
- **Entry:** `src/main.tsx` → `src/App.tsx`
- **Route Base:** `/` (root)
- **Key Dependencies:** react@19.1, vite@7.3, @tanstack/react-query, wouter, recharts, lightweight-charts, framer-motion, Radix UI primitives, lucide-react, tailwindcss@4

### 3.3 @workspace/global
- **Path:** `artifacts/global/`
- **Type:** React + Vite SPA
- **Route Base:** `/global/`
- **Key Dependencies:** Same stack as scanner (react@19.1, vite, wouter, recharts, lightweight-charts, etc.)

### 3.4 @workspace/api-spec
- **Path:** `lib/api-spec/`
- **Purpose:** OpenAPI 3.1 specification (source of truth for API contracts)
- **Codegen:** `pnpm --filter @workspace/api-spec run codegen` (uses Orval)

### 3.5 @workspace/api-client-react
- **Path:** `lib/api-client-react/`
- **Purpose:** Generated TanStack Query hooks and custom fetch with `credentials: "include"`
- **Exports:** `./src/index.ts`

### 3.6 @workspace/api-zod
- **Path:** `lib/api-zod/`
- **Purpose:** Generated Zod validation schemas from OpenAPI spec
- **Exports:** `./src/index.ts`

### 3.7 @workspace/db
- **Path:** `lib/db/`
- **Purpose:** Drizzle ORM schemas, PostgreSQL pool connection
- **Exports:** `./src/index.ts` (pool), `./src/schema/index.ts` (all tables)
- **Commands:** `pnpm run push` (drizzle-kit push), `pnpm run push-force`
- **Key Dependencies:** drizzle-orm, drizzle-kit, drizzle-zod, pg, zod

---

## 4. Database Schema (PostgreSQL + Drizzle ORM)

### 4.1 Table: `global_instruments` (PK: symbol)
| Column | Type | Constraints |
|--------|------|-------------|
| symbol | text | PRIMARY KEY |
| display_name | text | NOT NULL |
| asset_class | text | NOT NULL |
| source | text | NOT NULL |
| source_symbol | text | NOT NULL |
| currency | text | |
| notes | text | |
| created_at | timestamp(tz) | NOT NULL, DEFAULT now() |

### 4.2 Table: `global_candles` (PK: symbol + timeframe + ts)
| Column | Type | Constraints |
|--------|------|-------------|
| symbol | text | NOT NULL, composite PK |
| timeframe | text | NOT NULL, composite PK |
| ts | timestamp(tz) | NOT NULL, composite PK |
| open | doublePrecision | NOT NULL |
| high | doublePrecision | NOT NULL |
| low | doublePrecision | NOT NULL |
| close | doublePrecision | NOT NULL |
| volume | doublePrecision | |
| source | text | NOT NULL |
| fetched_at | timestamp(tz) | NOT NULL, DEFAULT now() |

**Indexes:** `global_candles_sym_tf_ts` on (symbol, timeframe, ts)

### 4.3 Table: `global_live_prices` (PK: symbol)
| Column | Type | Constraints |
|--------|------|-------------|
| symbol | text | PRIMARY KEY |
| price | doublePrecision | |
| prev_close | doublePrecision | |
| change_abs | doublePrecision | |
| change_pct | doublePrecision | |
| day_high | doublePrecision | |
| day_low | doublePrecision | |
| volume | doublePrecision | |
| source | text | NOT NULL |
| updated_at | timestamp(tz) | NOT NULL, DEFAULT now() |
| last_error | text | |
| failure_streak | integer | NOT NULL, DEFAULT 0 |
| last_failure_at | timestamp(tz) | |

### 4.4 Table: `global_watchlist` (PK: session_key + symbol)
| Column | Type | Constraints |
|--------|------|-------------|
| session_key | text | NOT NULL, composite PK |
| symbol | text | NOT NULL, composite PK |
| added_at | timestamp(tz) | NOT NULL, DEFAULT now() |

**Indexes:** `global_watchlist_session_idx` on (session_key)

### 4.5 Table: `global_sync_logs` (PK: source)
| Column | Type | Constraints |
|--------|------|-------------|
| source | text | PRIMARY KEY |
| last_ok_at | timestamp(tz) | |
| last_error_at | timestamp(tz) | |
| last_error | text | |
| ok_count | integer | NOT NULL, DEFAULT 0 |
| err_count | integer | NOT NULL, DEFAULT 0 |
| notes | text | |
| updated_at | timestamp(tz) | NOT NULL, DEFAULT now() |

### 4.6 Table: `global_screener_presets` (PK: id)
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PRIMARY KEY, DEFAULT random() |
| session_key | text | NOT NULL |
| name | text | NOT NULL |
| body | jsonb | NOT NULL |
| created_at | timestamp(tz) | NOT NULL, DEFAULT now() |
| updated_at | timestamp(tz) | NOT NULL, DEFAULT now() |
| auto_run_interval_min | integer | |
| last_run_at | timestamp(tz) | |
| last_run_error | text | |
| last_hit_symbols | jsonb | NOT NULL, DEFAULT [] |
| last_new_hits | jsonb | NOT NULL, DEFAULT [] |
| last_new_hits_at | timestamp(tz) | |
| share_token | text | |

**Indexes:** session_key; UNIQUE (session_key, name); UNIQUE (share_token)

### 4.7 Table: `global_instrument_overrides` (PK: symbol)
| Column | Type | Constraints |
|--------|------|-------------|
| symbol | text | PRIMARY KEY |
| disabled | integer | NOT NULL, DEFAULT 0 |
| disabled_at | timestamp(tz) | |
| note | text | |
| updated_at | timestamp(tz) | NOT NULL, DEFAULT now() |

### 4.8 Table: `fii_dii_daily` (PK: date)
| Column | Type | Constraints |
|--------|------|-------------|
| date | date | PRIMARY KEY |
| fii_buy | numeric(18,2) | NOT NULL |
| fii_sell | numeric(18,2) | NOT NULL |
| fii_net | numeric(18,2) | NOT NULL |
| dii_buy | numeric(18,2) | NOT NULL |
| dii_sell | numeric(18,2) | NOT NULL |
| dii_net | numeric(18,2) | NOT NULL |
| source | text | NOT NULL |
| updated_at | timestamp(tz) | NOT NULL, DEFAULT now() |

### 4.9 Table: `participant_oi_daily` (PK: date + client_type)
| Column | Type | Constraints |
|--------|------|-------------|
| date | date | NOT NULL, composite PK |
| client_type | text | NOT NULL, composite PK |
| future_index_long | integer | NOT NULL, DEFAULT 0 |
| future_index_short | integer | NOT NULL, DEFAULT 0 |
| future_stock_long | integer | NOT NULL, DEFAULT 0 |
| future_stock_short | integer | NOT NULL, DEFAULT 0 |
| option_index_call_long | integer | NOT NULL, DEFAULT 0 |
| option_index_put_long | integer | NOT NULL, DEFAULT 0 |
| option_index_call_short | integer | NOT NULL, DEFAULT 0 |
| option_index_put_short | integer | NOT NULL, DEFAULT 0 |
| option_stock_call_long | integer | NOT NULL, DEFAULT 0 |
| option_stock_put_long | integer | NOT NULL, DEFAULT 0 |
| option_stock_call_short | integer | NOT NULL, DEFAULT 0 |
| option_stock_put_short | integer | NOT NULL, DEFAULT 0 |
| total_long_contracts | integer | NOT NULL, DEFAULT 0 |
| total_short_contracts | integer | NOT NULL, DEFAULT 0 |
| updated_at | timestamp(tz) | NOT NULL, DEFAULT now() |

### 4.10 Table: `kite_session` (PK: id)
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PRIMARY KEY |
| api_key | text | NOT NULL |
| access_token | text | NOT NULL |
| public_token | text | |
| user_id | text | |
| user_name | text | |
| login_time | timestamp(tz) | NOT NULL, DEFAULT now() |
| expires_at | timestamp(tz) | NOT NULL |

### 4.11 Table: `option_signal_history` (PK: signal_date + index_symbol + setup_key + direction)
| Column | Type | Constraints |
|--------|------|-------------|
| signal_date | date | NOT NULL, composite PK |
| index_symbol | text | NOT NULL, composite PK |
| setup_key | text | NOT NULL, composite PK |
| direction | text | NOT NULL, composite PK |
| index_name | text | NOT NULL |
| strike | numeric(18,4) | NOT NULL |
| option_type | text | NOT NULL |
| entry | numeric(18,4) | NOT NULL |
| stop_loss | numeric(18,4) | NOT NULL |
| target1 | numeric(18,4) | NOT NULL |
| target2 | numeric(18,4) | NOT NULL |
| entry_trigger | text | |
| option_entry | numeric(18,4) | |
| option_stop_loss | numeric(18,4) | |
| option_target1 | numeric(18,4) | |
| option_target2 | numeric(18,4) | |
| confidence | integer | NOT NULL, DEFAULT 0 |
| tier | text | |
| setup_name | text | |
| generated_at | timestamp(tz) | NOT NULL, DEFAULT now() |
| status | text | NOT NULL, DEFAULT 'PENDING' |
| triggered_at | timestamp(tz) | |
| exited_at | timestamp(tz) | |
| exit_reason | text | |
| exit_price | numeric(18,4) | |
| max_favorable_excursion | numeric(18,4) | NOT NULL, DEFAULT 0 |
| max_adverse_excursion | numeric(18,4) | NOT NULL, DEFAULT 0 |
| last_spot | numeric(18,4) | NOT NULL |
| last_evaluated_at | timestamp(tz) | NOT NULL, DEFAULT now() |

**Indexes:** signal_date; status

### 4.12 Table: `paper_account` (PK: segment)
| Column | Type | Constraints |
|--------|------|-------------|
| segment | text | PRIMARY KEY |
| seed_capital | numeric(18,2) | NOT NULL |
| balance | numeric(18,2) | NOT NULL |
| day_realized_pnl | numeric(18,2) | NOT NULL, DEFAULT 0 |
| day_trade_count | integer | NOT NULL, DEFAULT 0 |
| day_open_count | integer | NOT NULL, DEFAULT 0 |
| last_reset_date | date | |
| created_at | timestamp(tz) | NOT NULL, DEFAULT now() |
| updated_at | timestamp(tz) | NOT NULL, DEFAULT now() |

### 4.13 Table: `paper_trade_fo` (PK: id)
| Column | Type | Constraints |
|--------|------|-------------|
| id | varchar | PRIMARY KEY, DEFAULT gen_random_uuid() |
| signal_date | date | NOT NULL |
| index_symbol | text | NOT NULL |
| setup_key | text | NOT NULL |
| direction | text | NOT NULL |
| index_name | text | NOT NULL |
| option_type | text | NOT NULL |
| strike | numeric(18,4) | NOT NULL |
| lots | integer | NOT NULL |
| lot_size | integer | NOT NULL |
| entry_premium | numeric(18,4) | NOT NULL |
| stop_premium | numeric(18,4) | NOT NULL |
| target1_premium | numeric(18,4) | NOT NULL |
| target2_premium | numeric(18,4) | NOT NULL |
| capital_deployed | numeric(18,2) | NOT NULL |
| last_premium | numeric(18,4) | NOT NULL |
| opened_at | timestamp(tz) | NOT NULL, DEFAULT now() |
| last_evaluated_at | timestamp(tz) | NOT NULL, DEFAULT now() |
| status | text | NOT NULL, DEFAULT 'OPEN' |
| exited_at | timestamp(tz) | |
| exit_premium | numeric(18,4) | |
| exit_reason | text | |
| realized_pnl | numeric(18,2) | |
| max_runup | numeric(18,2) | NOT NULL, DEFAULT 0 |
| max_drawdown | numeric(18,2) | NOT NULL, DEFAULT 0 |

**Indexes:** UNIQUE (signal_date, index_symbol, setup_key, direction); signal_date; status; (signal_date, status)

### 4.14 Table: `paper_trade_eq` (PK: id)
| Column | Type | Constraints |
|--------|------|-------------|
| id | varchar | PRIMARY KEY, DEFAULT gen_random_uuid() |
| symbol | text | NOT NULL |
| name | text | NOT NULL |
| exchange | text | NOT NULL, DEFAULT 'NSE' |
| signal_date | date | NOT NULL |
| signal_triggered_at | timestamp(tz) | NOT NULL |
| qty | integer | NOT NULL |
| entry_price | numeric(18,4) | NOT NULL |
| stop_price | numeric(18,4) | NOT NULL |
| target1_price | numeric(18,4) | NOT NULL |
| target2_price | numeric(18,4) | NOT NULL |
| trailed_to_t1 | integer | NOT NULL, DEFAULT 0 |
| capital_deployed | numeric(18,2) | NOT NULL |
| last_price | numeric(18,4) | NOT NULL |
| last_evaluated_at | timestamp(tz) | NOT NULL, DEFAULT now() |
| opened_at | timestamp(tz) | NOT NULL, DEFAULT now() |
| status | text | NOT NULL, DEFAULT 'OPEN' |
| exited_at | timestamp(tz) | |
| exit_price | numeric(18,4) | |
| exit_reason | text | |
| realized_pnl | numeric(18,2) | |
| max_runup | numeric(18,2) | NOT NULL, DEFAULT 0 |
| max_drawdown | numeric(18,2) | NOT NULL, DEFAULT 0 |

**Indexes:** UNIQUE (symbol, signal_date); status; (symbol, status); exited_at

### 4.15 Table: `tv_alerts` (PK: id)
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PRIMARY KEY |
| received_at | timestamp(tz) | NOT NULL, DEFAULT now() |
| symbol | text | |
| ticker | text | |
| exchange | text | |
| interval | text | |
| side | text | |
| strategy | text | |
| price | numeric(18,4) | |
| message | text | |
| raw | jsonb | NOT NULL |

**Indexes:** received_at; symbol

### 4.16 Table: `users` (PK: id)
| Column | Type | Constraints |
|--------|------|-------------|
| id | serial | PRIMARY KEY |
| email | text | NOT NULL, UNIQUE |
| password_hash | text | NOT NULL |
| full_name | text | NOT NULL |
| phone | text | |
| role | text | NOT NULL, DEFAULT 'subscriber' |
| status | text | NOT NULL, DEFAULT 'pending' |
| created_at | timestamp(tz) | NOT NULL, DEFAULT now() |
| updated_at | timestamp(tz) | NOT NULL, DEFAULT now() |
| subscription_started_at | timestamp(tz) | |
| subscription_expires_at | timestamp(tz) | |
| amount_paise | integer | |
| paid_at | timestamp(tz) | |
| payment_ref | text | |
| notes | text | |
| allowed_tabs | text[] | NOT NULL, DEFAULT [] |

**Indexes:** status; subscription_expires_at

### 4.17 Table: `personal_watchlist` (PK: owner_key + symbol)
| Column | Type | Constraints |
|--------|------|-------------|
| owner_key | text | NOT NULL, composite PK |
| symbol | text | NOT NULL, composite PK |
| added_at | timestamp(tz) | NOT NULL, DEFAULT now() |
| notes | text | |

**Indexes:** owner_key

---

## 5. API Endpoints (66 OpenAPI Operations)

### 5.1 Health & System
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/healthz | Health check |
| GET | /api/system/status | Real-time subsystem status |
| GET | /api/security/audit | Security audit (18 checks) |

### 5.2 Authentication
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/auth/status | Check auth status (cookie-based) |
| POST | /api/auth/login | Login with APP_ACCESS_PASSWORD |
| POST | /api/auth/logout | Logout (clear session cookie) |

### 5.3 Market Data
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/market/summary | Indian market indices snapshot |
| GET | /api/market/global | Global indices data |
| GET | /api/market/trend | Overall market trend analysis |
| GET | /api/market/events | Market events calendar |
| GET | /api/market/premarket | Pre-market data |
| GET | /api/home/enrichment | Home tab enrichment (sparklines, RSI, MACD, ADX, vol ratio, options summary) |

### 5.4 Stocks & Sectors
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/stocks | Full stock list with quotes and scores |
| GET | /api/stocks/:symbol | Single stock detail |
| GET | /api/stocks/:symbol/statements | Financial statements |
| GET | /api/stocks/:symbol/history | Price history |
| GET | /api/sectors | All sectors with performance |
| GET | /api/sectors/:sector | Single sector detail |
| GET | /api/index/:slug | Index detail page data |
| GET | /api/indices | Full indices board (27 instruments, 5 categories) |

### 5.5 Scanner & Scans
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/scan/top | Top bullish/bearish setups |
| GET | /api/scan/full-nse | Full NSE scan (4000+ stocks) |
| GET | /api/scan/full-nse/status | Full NSE scan status |
| GET | /api/scan/full-nse/export | Full NSE scan CSV export |
| GET | /api/provider/status | Data provider status |

### 5.6 Options & F&O
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/options/chain/:underlying | Full option chain |
| GET | /api/options/analytics/:underlying | Option analytics |
| GET | /api/options/chain/:underlying/export | Option chain CSV export |
| GET | /api/options/strategies/:underlying | 13 strategy templates |
| GET | /api/options/signals | Live F&O intraday signals |
| GET | /api/options/signal-history | Historical signal log |
| GET | /api/options/signal-report | Signal performance report |
| GET | /api/options/signal-report/dates | Available signal report dates |
| GET | /api/options/signal-report/export | Signal report CSV export |

### 5.7 OI Lab
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/options/oi-lab/universe | F&O universe for OI lab |
| GET | /api/options/oi-lab/insights/:underlying | OI insights per underlying |
| POST | /api/options/oi-lab/snapshot | Bulk OI snapshot download |
| GET | /api/options/oi-lab/heatmap | OI heatmap data |
| POST | /api/options/oi-lab/tracker/start | Start intraday OI tracker |
| POST | /api/options/oi-lab/tracker/stop | Stop intraday OI tracker |
| GET | /api/options/oi-lab/tracker/status | Tracker status |
| GET | /api/options/oi-lab/tracker/series | Tracker time-series data |
| GET | /api/options/oi-lab/heatmap/export | OI heatmap CSV export |
| GET | /api/options/oi-lab/tracker/export | OI tracker CSV export |

### 5.8 Institutional Flows
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/inst/fii-dii | FII/DII daily cash flow data |
| GET | /api/inst/participant-oi | Participant-wise OI data |
| POST | /api/inst/refresh | Force refresh institutional data |

### 5.9 Deep Scan
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/deepscan/lookup | Universal symbol lookup |
| GET | /api/deepscan/snapshot/:symbol | Deep scan snapshot for a stock |

### 5.10 Kite Connect Integration
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/kite/status | Kite session status |
| GET | /api/kite/login-url | Generate Kite login URL |
| GET | /api/kite/callback | OAuth callback handler |
| POST | /api/kite/logout | Disconnect Kite session |
| GET | /api/kite/export-session | Export session for mirroring |
| GET | /api/kite/export-instruments | Export instruments cache |
| POST | /api/kite/import-session | Import session from production |
| POST | /api/kite/subscribe | Subscribe to WebSocket ticks |
| GET | /api/kite/quotes | Batch quotes |
| GET | /api/kite/quote/:symbol | Single symbol quote |
| GET | /api/kite/stream | SSE live tick stream |

### 5.11 TradingView Webhooks
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/webhooks/tradingview | Receive TV alert webhooks |
| GET | /api/webhooks/tradingview | List received alerts |
| DELETE | /api/webhooks/tradingview | Clear alert history |

### 5.12 Paper Trading
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/paper/account | Paper account balances |
| GET | /api/paper/positions/fo | Open F&O paper positions |
| GET | /api/paper/trades/fo | F&O trade history |
| POST | /api/paper/positions/fo/:id/close | Close F&O position |
| GET | /api/paper/reports/fo/monthly | F&O monthly report |
| GET | /api/paper/reports/fo/yearly | F&O yearly report |
| GET | /api/paper/positions/eq | Open equity paper positions |
| GET | /api/paper/trades/eq | Equity trade history |
| POST | /api/paper/positions/eq/:id/close | Close equity position |
| GET | /api/paper/reports/eq/monthly | Equity monthly report |
| GET | /api/paper/reports/eq/yearly | Equity yearly report |

### 5.13 User & Admin
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/admin/users | List all users |
| GET | /api/admin/users/:id | Get single user |
| PATCH | /api/admin/users/:id | Update user |
| DELETE | /api/admin/users/:id | Delete user |

### 5.14 Other
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/stocks-to-watch | Catalyst-driven stocks to watch |
| GET | /api/news | Aggregated market news |
| GET | /api/watchlist/:key | Personal watchlist |

### 5.15 Global Scanner (prefixed /api/global/)
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/global/auth/status | Global scanner auth status |
| POST | /api/global/auth/login | Global scanner login |
| POST | /api/global/auth/logout | Global scanner logout |
| GET | /api/global/instruments | All global instruments |
| GET | /api/global/dashboard | Global dashboard summary |
| GET | /api/global/instruments/disabled | Disabled instruments |
| POST | /api/global/instruments/:symbol/disabled | Disable instrument |
| DELETE | /api/global/instruments/:symbol/disabled | Re-enable instrument |
| GET | /api/global/instruments/:symbol | Single instrument detail |
| GET | /api/global/instruments/:symbol/candles | Historical candles |
| GET | /api/global/instruments/:symbol/indicators | Computed indicators |
| GET | /api/global/watchlist | Global watchlist |
| POST | /api/global/watchlist | Add to global watchlist |
| DELETE | /api/global/watchlist/:symbol | Remove from global watchlist |
| GET | /api/global/screener-presets | User's screener presets |
| GET | /api/global/screener-presets/library | Curated preset library |
| GET | /api/global/screener-presets/share/:token | Get shared preset |
| POST | /api/global/screen | Run ad-hoc screen |
| POST | /api/global/screener-presets | Create preset |
| POST | /api/global/screener-presets/:id/acknowledge | Acknowledge new hits |
| POST | /api/global/screener-presets/:id/run-now | Force-run preset |
| POST | /api/global/screener-presets/:id/share | Generate share link |
| POST | /api/global/screener-presets/import/:token | Import shared preset |
| PATCH | /api/global/screener-presets/:id | Update preset |
| DELETE | /api/global/screener-presets/:id | Delete preset |
| DELETE | /api/global/screener-presets/:id/share | Revoke share link |
| GET | /api/global/status | Global scanner health |

---

## 6. Frontend Pages — NSE Scanner (27 routes)

| Route | Page Component | Lines | Description |
|-------|---------------|-------|-------------|
| `/` | dashboard.tsx | 226 | Home — Global Cues, Sentiment, Heatmap, Breadth, Indian Indices tabs, IndicesBoard, Trend, Mood, Gainers/Losers, Setups |
| `/scanner` | scanner.tsx | 573 | Full stock scanner table (sortable, filterable, ~280 stocks) |
| `/stock/:symbol` | stock-detail.tsx | 376 | Individual stock detail (chart, financials, signals) |
| `/option-chain` | option-chain.tsx | 1,261 | Option chain viewer with Greeks, PCR, max pain, filters |
| `/option-chain/:underlying` | option-chain.tsx | 1,261 | Option chain for specific underlying |
| `/options` | options.tsx | 1,161 | F&O intraday signals + signal report |
| `/strategies` | strategies.tsx | 805 | 13 option strategy templates |
| `/oi-lab` | oi-lab.tsx | 2,467 | OI Lab — heatmap, tracker, IV skew, insights |
| `/deep-scan` | deep-scan.tsx | 730 | Deep scan with universal lookup |
| `/sectors` | sectors.tsx | 92 | Sector overview grid |
| `/sectors/:sector` | sector-detail.tsx | 122 | Individual sector detail |
| `/flows` | flows.tsx | 978 | FII/DII flows + participant OI analysis |
| `/watchlist` | watchlist.tsx | 545 | Personal watchlist |
| `/premarket` | premarket.tsx | 676 | Pre/Post market — Game Plan, Key Levels, Option Snapshot |
| `/stocks-to-watch` | stocks-to-watch.tsx | 247 | Catalyst-driven stock ideas |
| `/news` | news.tsx | 287 | Aggregated market news |
| `/indices` | indices.tsx | 11 | Redirect to home |
| `/index/:slug` | index-detail.tsx | 234 | Individual index detail page |
| `/kite` | kite.tsx | 367 | Kite Connect session management |
| `/paper-trading` | paper-trading.tsx | 931 | Paper trading positions & entry |
| `/paper-reports` | paper-reports.tsx | 989 | Paper trading P&L reports |
| `/learn` | learn.tsx | 1,322 | Educational content (futures, options, psychology) |
| `/admin` | admin.tsx | 405 | User management admin panel |
| `/audit` | audit.tsx | 212 | Security audit dashboard |
| `/status` | status.tsx | 223 | System status monitor |
| `/manifesto` | manifesto.tsx | 391 | Platform manifesto |
| `*` | not-found.tsx | 21 | 404 page |

**Total page lines:** 15,652

---

## 7. Frontend Pages — Global Scanner (5 routes)

| Route | Page Component | Description |
|-------|---------------|-------------|
| `/global/` | Dashboard.tsx | Global dashboard — 392 instruments, multi-asset summary |
| `/global/screener` | Screener.tsx | Multi-asset screener with presets |
| `/global/watchlist` | Watchlist.tsx | Global watchlist |
| `/global/instrument/:symbol` | InstrumentDetail.tsx | Instrument detail with lightweight-charts |
| `*` | not-found.tsx | 404 page |

---

## 8. Key Frontend Components — Scanner

### 8.1 Home Tab Components (`src/components/home/`)
| File | Lines | Description |
|------|-------|-------------|
| global-cues-strip.tsx | 64 | GIFT Nifty, Dow, S&P 500, Nasdaq, USD/INR, Brent, Gold, VIX, DXY, US10Y strip |
| sentiment-bar.tsx | 100 | India VIX + FII/DII net + Expiry countdown |
| sectoral-heatmap.tsx | 66 | Color-coded sector blocks (green/red by %) |
| breadth-bar.tsx | 61 | Advance/Decline ratio bar |
| index-tabs.tsx | 216 | 4 Indian index mini-cards with sparklines + bias badges |
| index-expanded-panel.tsx | 457 | Expanded panel: OHLC, EMAs, VWAP, Market Profile, CPR, Momentum, Options Layer, Pivots |
| market-take.tsx | 70 | Auto-generated market narrative |

### 8.2 Core Components (`src/components/`)
| File | Lines | Description |
|------|-------|-------------|
| indices-board.tsx | 604 | Full IndicesBoard — 27 instruments, 5 tabs (India, Global, Commodities, Indian ADRs, FX/Macro) |
| layout.tsx | 377 | App shell with navigation, header, sidebar |
| option-signal-alerter.tsx | 388 | Live F&O signal toast notifications |
| stock-statements.tsx | 419 | Financial statement tables |
| tradingview-alerts.tsx | 381 | TradingView alert display |
| login-gate.tsx | 270 | Authentication gate |
| global-strip.tsx | 263 | Global indices strip in header |
| indian-strip.tsx | 260 | Indian indices strip in header |
| in-app-candle-chart.tsx | 217 | Candlestick chart (lightweight-charts) |
| events-marquee.tsx | 178 | Market events ticker |
| mmi-gauge.tsx | 122 | Market Mood Index gauge |
| theme-switcher.tsx | 107 | Dark/Light/Ocean theme toggle |
| trend-card.tsx | 84 | Overall market trend card |
| access-guard.tsx | 85 | Role-based access control wrapper |
| error-boundary.tsx | 67 | Error boundary |

### 8.3 UI Component Library (`src/components/ui/`) — 57 components
Radix-based shadcn/ui component library including: accordion, alert-dialog, avatar, badge, button, card, carousel, chart, checkbox, collapsible, command, context-menu, dialog, drawer, dropdown-menu, form, hover-card, input, input-otp, label, menubar, navigation-menu, popover, progress, radio-group, resizable, scroll-area, select, separator, sheet, sidebar, signal-badge, skeleton, slider, sonner, switch, table, tabs, textarea, toast, toaster, toggle, toggle-group, tooltip, and more.

---

## 9. Backend Library Modules (api-server/src/lib/)

| Module | Lines | Description |
|--------|-------|-------------|
| optionSignals.ts | 1,497 | F&O signal detection (4 detectors + baseline outlook + lifecycle) |
| oiLab.ts | 1,376 | OI Lab engine — snapshots, heatmap, tracker, insights |
| fullNseScanner.ts | 936 | Full NSE scan (4000+ stocks, stale-while-revalidate) |
| paperTradingFO.ts | 755 | F&O paper trading auto-execution engine |
| paperTradingEq.ts | 560 | Equity swing paper trading engine |
| optionChain.ts | 515 | Option chain orchestration (Kite + NSE fallback, Black-Scholes) |
| indicesBoard.ts | 481 | Indices board data fetcher (27 instruments, 5 categories) |
| scanner.ts | 443 | Core stock scanner + scoring |
| swingSignals.ts | 334 | Equity swing signal generation |
| kiteFeed.ts | 332 | Kite WebSocket ticker with auto-reconnect |
| scoring.ts | 282 | Stock recommendation scoring engine |
| kiteScanner.ts | — | Kite-first batch quote scanner |
| kiteAuth.ts | — | Kite OAuth + session management |
| kiteIntraday.ts | — | Generic Kite historical data fetcher |
| kiteIndexQuotes.ts | — | Index quote batch refresher |
| kiteFnoInstruments.ts | — | F&O instruments loader (NFO + BFO) |
| kiteOptionChain.ts | — | Kite option chain data |
| globalIndices.ts | — | Global indices data aggregation |
| giftNifty.ts | — | GIFT NIFTY data from TradingView |
| optionAnalytics.ts | — | Option analytics computations |
| optionStrategies.ts | — | 13 strategy template builder |
| optionSignalLifecycle.ts | — | Signal lifecycle tracking (pending→triggered→exited) |
| blackScholes.ts | — | Black-Scholes model + Greeks calculator |
| marketTrend.ts | 141 | Overall market trend analysis |
| liveBias.ts | — | Live directional bias computation |
| instFlows.ts | — | FII/DII + participant OI data fetching |
| newsRss.ts | — | Multi-source news RSS aggregation |
| marketEvents.ts | — | Market events calendar |
| preMarket.ts | — | Pre/post-market data |
| deepscan.ts | — | Deep scan + universal lookup |
| dataProvider.ts | — | Data provider abstraction layer |
| indicators.ts | — | Technical indicators (RSI, MACD, ADX, etc.) |
| yahoo.ts | — | Yahoo Finance wrapper with circuit breaker |
| nseBhavcopy.ts | — | NSE bhavcopy + delivery % loader |
| universe.ts | — | Stock universe management |
| symbolAlias.ts | — | Symbol alias resolution |
| financials.ts | — | Financial statements fetcher |
| stocksToWatch.ts | — | Catalyst detection from news feeds |
| watchlist.ts | — | Watchlist operations |
| watchlistLists.ts | — | Watchlist list management |
| csvExport.ts | — | CSV export utilities |
| diskCache.ts | — | Disk-based caching layer |
| logger.ts | — | Pino logger singleton |
| auth.ts | — | HMAC-SHA256 auth middleware |
| userAuth.ts | — | User registration/login (password-based) |
| securityAudit.ts | — | 18-check security audit |
| systemStatus.ts | — | Subsystem status collector |
| tradingViewAlerts.ts | — | TV webhook processor |
| paperAccount.ts | — | Paper account balance management |
| paperReportsEq.ts | — | Equity paper trading reports |
| paperReportsFO.ts | — | F&O paper trading reports |

### Global Scanner Submodules (api-server/src/lib/global/)
| Module | Description |
|--------|-------------|
| auth.ts | Global scanner auth |
| binance.ts | Binance crypto data pump |
| curatedPresets.ts | Curated screener preset library |
| dataLayer.ts | Global data layer (candles, prices, instruments) |
| disabledSymbols.ts | Instrument override management |
| indicators.ts | Global instrument indicators |
| presetScheduler.ts | Auto-run screener preset scheduler |
| screener.ts | Multi-asset screening engine |
| universe.ts | 392-instrument universe seeder |
| yahoo.ts | Yahoo Finance pump for commodities/forex/equities |

---

## 10. Environment Variables & Secrets

| Variable | Purpose |
|----------|---------|
| DATABASE_URL | PostgreSQL connection string |
| APP_ACCESS_PASSWORD | Admin login password (HMAC-SHA256) |
| SESSION_SECRET | Cookie signing secret |
| TRADINGVIEW_WEBHOOK_SECRET | TradingView webhook auth |
| KITE_API_KEY | Zerodha Kite API key |
| KITE_API_SECRET | Zerodha Kite API secret |
| KITE_ACCESS_TOKEN | Kite session access token |
| KITE_MIRROR_URL | Production URL for session auto-mirror |
| KITE_MIRROR_ALLOWED_HOSTS | Allowed hosts for SSRF protection |
| PORT | Server port (set per artifact by workflow) |
| NODE_ENV | Environment (development/production) |

---

## 11. Workflows (Runtime Services)

| Workflow | Command | Port |
|----------|---------|------|
| API Server | `pnpm --filter @workspace/api-server run dev` | 8080 |
| NSE Scanner (web) | `pnpm --filter @workspace/scanner run dev` | dynamic (PORT env) |
| Global Scanner (web) | `pnpm --filter @workspace/global run dev` | dynamic (PORT env) |
| Mockup Sandbox | `pnpm --filter @workspace/mockup-sandbox run dev` | 8081 |

---

## 12. Key Technical Decisions

### Data Pipeline
- **Kite Connect** is primary for ALL live market data (quotes, option chains, historical, WebSocket ticks)
- **Yahoo Finance** is the delayed fallback (15-min lag) with a process-wide circuit breaker
- **NSE Direct** is geo-blocked from Replit, used only as option chain fallback
- **Auto-mirror** imports Kite sessions from production on dev startup
- **Disk cache** persists instrument dumps, scan results, and failure states across restarts

### Scanning Architecture
- Full NSE scan covers ~8,684 universe → ~4,284 quoted stocks per cycle (60s refresh)
- Stale-while-revalidate: returns cached data immediately, background refresh
- Scan hard timeout prevents runaway scans from blocking the server
- Yahoo batch enrichment for stocks without Kite quotes

### Options & F&O
- 4 signal detectors: Trend Continuation, VWAP Reclaim, Volume Breakout, EMA Pullback
- Baseline Outlook fallback for quiet markets
- Option premium projection using Black-Scholes
- Real-time lifecycle tracking: PENDING → TRIGGERED → EXITED
- F&O paper trading auto-entry with 30% premium stop-loss cap
- 13 option strategy templates with delta-based strike picking

### Security
- Helmet CSP headers in production
- HMAC-SHA256 signed HttpOnly cookies
- Rate limiting on auth endpoints
- SSRF guards on session mirroring
- 18-point security audit

### Frontend Architecture
- React 19.1 with wouter for routing (lightweight)
- TanStack Query for server state (30s refetch intervals)
- Recharts for data visualization
- lightweight-charts for candlestick charts
- Tailwind CSS v4 with shadcn/ui component library
- Dark/Light/Ocean theme support
- JetBrains Mono for monospaced elements

---

## 13. Code Statistics Summary

| Metric | Value |
|--------|-------|
| Total TypeScript lines | ~112,360 |
| API Server source | 28,294 lines |
| Scanner frontend source | 28,112 lines |
| Global frontend source | 9,184 lines |
| Shared libraries | 46,770 lines |
| OpenAPI operations | 66 |
| Database tables | 17 |
| Frontend pages (Scanner) | 27 routes |
| Frontend pages (Global) | 5 routes |
| UI components | 57 |
| API route files | 18 |
| Backend library modules | 50+ |
| Git commits | 289 |
| OpenAPI spec lines | 3,483 |

---

## 14. Build & Deploy Commands

```bash
# Install dependencies
pnpm install

# Typecheck entire workspace
pnpm run typecheck

# Build libs (composite, declaration emit)
pnpm run typecheck:libs

# Build API server
pnpm --filter @workspace/api-server run build

# Build scanner frontend
pnpm --filter @workspace/scanner run build

# Build global frontend
pnpm --filter @workspace/global run build

# Run OpenAPI codegen (after spec changes)
pnpm --filter @workspace/api-spec run codegen

# Push database schema
pnpm --filter @workspace/db run push

# Force push database schema
pnpm --filter @workspace/db run push-force
```

---

## 15. Production Domain & Proxy Routing

- **Domain:** marketscannerbydev.in
- **Proxy:** Path-based routing via Replit reverse proxy
  - `/api/*` → API Server (port 8080)
  - `/global/*` → Global Scanner frontend
  - `/` → NSE Scanner frontend
- **TLS:** Managed by Replit
- **Deployment:** Replit Deployments (auto-build, health checks)

---

*End of project data file.*
