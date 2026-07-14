# Database Index

PostgreSQL via Drizzle ORM. Schema files in `lib/db/src/schema/`.

**CRITICAL SAFETY RULE:** Never run `drizzle-kit push` — it will DROP tables not in the current schema (e.g. `strategy_definitions`, `strategy_engine_state`). For additive changes: `ALTER TABLE … ADD COLUMN IF NOT EXISTS`. See bottom of this file.

---

## Table Catalog

### `kite_session` (`kiteSession.ts`)
Zerodha/Kite OAuth session storage.
| Column | Type | Notes |
|---|---|---|
| id | varchar | Always `"active"` — single-row table |
| access_token | text | Encrypted (kiteCrypto.ts) |
| api_key | text | Encrypted |
| login_time | timestamp | When the session was established |
| expiry | timestamp | Token expiry |

**Used by:** `lib/kiteAuth.ts` · **Risk: CRITICAL** (holds the live trading session)

---

### `option_signals` (`optionSignals.ts`)
Live F&O option signals (current cycle state).
| Column | Notes |
|---|---|
| id | uuid pk |
| underlying | NIFTY / BANKNIFTY / SENSEX |
| direction | CALL / PUT |
| tier | HIGH_CONVICTION / BASELINE |
| confidence | 0–100 |
| strike, expiry | Option leg |
| signal data... | Full P3 confluence output |
| generated_at | IST epoch |

**Used by:** `lib/optionSignals.ts`, `routes/fno.ts` · **Risk: HIGH**

---

### `paper_trade_fo` (in `paperTrading.ts`)
F&O paper auto-trade records.
| Column | Notes |
|---|---|
| id | uuid pk |
| underlying | NIFTY / BANKNIFTY / SENSEX |
| direction | CALL / PUT |
| tier | STANDARD / BASELINE / MICRO |
| lots, lot_size | Position size |
| entry_premium | Premium at open |
| exit_premium | Premium at close (null if open) |
| status | OPEN / CLOSED / EXPIRED |
| opened_at, closed_at | Timestamps |
| pnl_gross | Realized P&L (gross — STT/charges via shadow model) |
| skip_reason | Why trade was skipped (if applicable) |

**Used by:** `lib/paperTradingFO.ts`, `routes/paper.ts` · **Risk: CRITICAL**

---

### `paper_trade_eq` (in `paperTrading.ts`)
Equity swing paper auto-trade records.
| Column | Notes |
|---|---|
| id | uuid pk |
| symbol | NSE symbol |
| direction | LONG / SHORT |
| entry_price, stop_price | Order levels |
| lots (qty) | Position size |
| status | OPEN / CLOSED |
| pnl_gross | Realized P&L |

**Used by:** `lib/paperTradingEq.ts`, `routes/paper.ts` · **Risk: CRITICAL**

---

### `paper_trade_combo` + `paper_trade_combo_leg` (`paperTradeCombo.ts`)
Tier C manual multi-leg combo paper trades. Fully isolated from `paper_trade_fo` lane.
| Key constraints | Notes |
|---|---|
| UNIQUE(combo_id, leg_index) | On legs table |
| 6 CHECK constraints | Leg direction/type validation |
| FK CASCADE | Legs cascade delete from combo |
| pg_advisory_xact_lock(7593721) | Concurrency lock during open |

**Rules:**
- `qty = lots × lotSize` — stored in shares, not lots
- Defined-risk only (rejects naked shorts: `maxLoss == null → UNDEFINED_RISK 400`)
- NOT in 15:20 force-exit; NOT in FNO heat budget
- Close uses CAS `WHERE id=? AND status='OPEN'`

**Used by:** `lib/paperTradingCombo.ts`, `routes/paperCombo.ts` · **Risk: HIGH**

---

### `paper_account` (in `paperTrading.ts`)
Capital ledger for paper trading.
| Column | Notes |
|---|---|
| id | Always 1 |
| balance | Current available cash |
| seed | Initial capital |
| lifetime_realized_pnl | Server-side sum (top-up safe) |

**Used by:** `lib/paperAccount.ts` · **Risk: CRITICAL**

---

### `fno_signal_reasoning` (`fnoSignalReasoning.ts`)
Per-signal reasoning audit log. Write-once append log.
| Column | Notes |
|---|---|
| id | uuid pk |
| underlying | NIFTY / BANKNIFTY / SENSEX |
| decision | PRE_EMISSION_REJECTED / EMITTED / SUPPRESSED |
| reason_code | WHY it was rejected/suppressed |
| confidence | Signal confidence at point of evaluation |
| captured_at | Timestamp |

**Used by:** `lib/fnoSignalReasoningLogger.ts`, `routes/fno.ts` (no-signal-gap distribution query)

---

### `tv_alerts` (`tvAlerts.ts`)
TradingView webhook alert records.
| Column | Notes |
|---|---|
| id | uuid pk |
| symbol | Ticker |
| action | alert action string |
| raw | Full webhook payload (jsonb) |
| received_at | Timestamp |

**Used by:** `routes/tradingview.ts`, `lib/tradingViewAlerts.ts`

---

### `inst_flows` (`instFlows.ts`)
FII/DII daily institutional flow records.
| Column | Notes |
|---|---|
| date | Trading date |
| fii_net, dii_net | Net buy/sell ₹ crore |
| participant_oi | Jsonb OI breakdown |

**Used by:** `lib/instFlows.ts`, `routes/instFlows.ts`

---

### `swing_scan` (`swingScan.ts`)
Pro Swing Scanner v3 results (once-per-day after 15:35 IST).
| Column | Notes |
|---|---|
| symbol | NSE symbol |
| scan_date | IST scan date |
| score | Composite swing score |
| signals | Jsonb signal array |
| data_source | kite / yahoo |

**Used by:** `lib/swingScannerStore.ts`, `routes/stocksToWatch.ts`

---

### `swing_order_staging` (`swingOrderStaging.ts`)
Swing cash staged-order queue (Phase 2 live-readiness).
| Column | Notes |
|---|---|
| id | uuid pk |
| symbol | NSE symbol |
| direction | LONG / SHORT |
| entry_price | Staged limit order price (NOT current LTP) |
| stop_price | Stop-loss level |
| target_price | Target level |
| quantity | Shares |
| risk_amount | ₹ risk |
| status | STAGED / APPROVED / REJECTED / EXPIRED / WATCHING |
| broker_order_id | Always null (broker DISABLED) |
| broker_status | Always BROKER_DISABLED |
| risk_eval_source | Always `kite` |
| created_at, updated_at | Timestamps |
| expires_at | TTL expiry |

**Risk: CRITICAL** — `broker_order_id` MUST stay null; broker integration hard-disabled.

**Used by:** `lib/swingOrderStaging.ts`, `routes/swingStaging.ts`

---

### `option_chain_snapshot` (`optionChainSnapshot.ts`)
Write-only option chain OI snapshot store. Does NOT feed trading decisions.
| Column | Notes |
|---|---|
| id | uuid pk |
| underlying | Index |
| expiry | Expiry date |
| snapshot | Full option chain jsonb |
| captured_at | Timestamp |

**Analytics:** `lib/optionSnapshotAnalytics.ts`, `GET /api/option-snapshots/analytics` (owner-only strict)

---

### `candle` (`candleWarehouse.ts`)
Candle warehouse — EOD + intraday candle substrate. Does NOT feed live signals.
| Column | Notes |
|---|---|
| symbol | NSE/BSE symbol |
| timeframe | 1D / 15m / etc. |
| candle_time | IST-wall-clock-in-UTC |
| open, high, low, close, volume | OHLCV |
| source_provider | kite / yahoo / indstocks |
| source_priority | 1=authoritative, 2=secondary_validation, 99=unknown |
| validated_by | Cross-validation source |
| validation_status | valid / stale / conflict |
| asof | Seconds since epoch (NOT milliseconds) |
| fetched_at | Fetch timestamp |
| is_stale | Boolean |
| fallback_used | Boolean |
| data_quality | good / degraded / bad |
| warnings | Jsonb array |

**Write guard:** `onConflictDoUpdate` with `WHERE excluded.source_priority <= candle.source_priority` — lower-trust source CANNOT overwrite Kite row.
**IST time gotcha:** DailyBars asOf is in milliseconds at source — must convert to seconds before writing.

**Used by:** `lib/candleWarehouseIngestor.ts`, `routes/candleWarehouse.ts`

---

### `iv_history` (`ivHistory.ts`)
IV (Implied Volatility) history for IVR/IVP computation.
| Column | Notes |
|---|---|
| underlying | NIFTY / BANKNIFTY / SENSEX |
| trade_date | Date |
| atm_iv | ATM IV percentage |

**Used by:** `lib/ivHistory.ts`, `lib/regimeClassifier.ts`

---

### `global_scanner` (`globalScanner.ts`)
Global multi-asset scanner cache (artifacts/global frontend).
| Column | Notes |
|---|---|
| symbol | Asset symbol |
| asset_class | equity / crypto / commodity / etc. |
| data | Jsonb snapshot |
| updated_at | Last refresh |

**Used by:** `lib/global/`, `routes/global/`

---

### `users` (`users.ts`)
User accounts. Role-based access control.
| Column | Notes |
|---|---|
| id | uuid pk |
| email | Unique |
| password_hash | bcrypt |
| role | owner / subscriber / viewer |
| tab_access | String allow-list (NOT a DB migration — checked in auth middleware) |
| created_at | Timestamp |

**Used by:** `lib/userAuth.ts`, `lib/auth.ts`, `routes/userAuth.ts`, `routes/admin.ts`

---

### `portfolios` + `portfolio_holdings` (`portfolio.ts`)
Per-user saved Portfolio Analyser portfolios (Phase 2).
| Column | Notes |
|---|---|
| id | uuid pk |
| owner_key | User email (ownerKey-scoped — each user sees only their own) |
| name | Portfolio name |
| is_default | Boolean |
| Holdings: qty, rate, buy_date | Book-keeping only |
| Holdings: broker, tag, notes | Optional metadata |

**NO** targetPrice / stopLoss stored — advisory fields intentionally excluded.
**Access:** owner OR subscriber; unauth → empty/403. No public/shared access.

**Used by:** `routes/portfolio.ts`, frontend `lib/portfolio/persistence.ts`

---

### `backtest` (`backtest.ts`)
Backtest run records and trade log.
| Column | Notes |
|---|---|
| id | uuid pk |
| run_type | REAL_REPLAY / DIRECTIONAL |
| underlying | NIFTY / BANKNIFTY / SENSEX |
| status | RUNNING / COMPLETED / FAILED |
| summary | Jsonb (equityCurve, metrics, etc.) |
| trades | Jsonb array |
| created_at | Timestamp |

**Timezone gotcha:** Candle times are IST-wall-clock-in-UTC. `entry_at`/`exit_at` for `modeled` trades must use `candleUtcIso()`, NOT `toISOString()`. A pre-2026-06-05 bug stored times +05:30 ahead — backfill script at `scripts/src/fixBacktestTradeTimes.ts`.

**Used by:** `lib/backtest/`, `routes/backtest.ts`

---

### `instrument_map` (`instrumentMap.ts`)
Kite × INDstocks instrument mapping (DISABLED by default).
| Column | Notes |
|---|---|
| kite_key | Kite instrument identifier |
| indstocks_scrip_code | INDstocks code |
| match_status | VERIFIED / UNVERIFIED / CONFLICT / EXPIRED |
| last_verified_at | Timestamp |

**Used by:** `lib/marketData/instrumentMapStore.ts` (only when INDSTOCKS_ENABLED)

---

### `indstocks_token` (`indstocksToken.ts`)
INDstocks API token cache (encrypted). Only read when INDSTOCKS_ENABLED.

---

### `app_state` (`appState.ts`)
Key-value app state store. Used for persistent latches and flags.
| Key | Purpose |
|---|---|
| `swing_scan_run` | Cold-start latch for swing scanner |
| Various latch keys | One-time-per-day flags |

**Used by:** `lib/appStateStore.ts`

---

### `strategy_control` (`strategyControl.ts`)
Strategy engine definitions and state.
| Table | Notes |
|---|---|
| strategy_definitions | Strategy config records |
| strategy_engine_state | Engine runtime state |

**IMPORTANT:** These tables exist in Drizzle schema (`strategyControl.ts`) SPECIFICALLY to prevent `drizzle-kit push` from dropping them. They were created before the Drizzle schema was added. Do not remove them from the schema.

---

## Safe Schema Change Procedure

### Adding a column (SAFE)
```sql
ALTER TABLE my_table ADD COLUMN IF NOT EXISTS new_col TEXT;
```
Run via psql or the `executeSql` tool against the database.

### UNSAFE — never do this
```bash
pnpm --filter @workspace/api-server exec drizzle-kit push
# ↑ Will prompt to DROP live tables not fully covered by schema
```

### After adding column
1. Add the column to the Drizzle schema file in `lib/db/src/schema/*.ts`
2. Run `pnpm run typecheck:libs` to rebuild lib declarations
3. The column is immediately usable via Drizzle ORM

### Creating a new table (SAFE)
```sql
CREATE TABLE IF NOT EXISTS new_table (...);
```
Then add to `lib/db/src/schema/*.ts` and export from `lib/db/src/schema/index.ts`.

---

## Query Patterns

### Standard Drizzle query
```typescript
import { db } from "@workspace/db";
import { myTable } from "@workspace/db/schema";

const rows = await db.select().from(myTable).where(eq(myTable.col, val));
```

### Raw SQL (complex queries)
```typescript
import { sql } from "drizzle-orm";
const rows = await db.execute(sql`SELECT ... FROM ...`);
// rows.rows is Record<string, unknown>[] — cast manually
```

### Express-5 param gotcha
```typescript
// req.params["id"] is string | string[] in Express 5
// Use the helper:
import { paramId } from "../lib/paramId";
const id = paramId(req); // returns string, throws 400 on invalid
```

### Transaction with advisory lock
```typescript
await db.transaction(async tx => {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(7593721)`);
  // ... safe concurrent operations
});
```
