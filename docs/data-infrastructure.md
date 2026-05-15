# Data Infrastructure

This document captures per-feature implementation notes for the data layers and diagnostic tools that have been added to the platform. `replit.md` keeps only short pointers to each entry here.

Last updated: 2026-05-15.

---

## Sector / industry mapping (Priority 2 — completed)

**File:** `artifacts/api-server/src/lib/sectorMap.ts`

Single source of truth for `symbol → {sector, industry}`.

- **Layered lookup**: UNIVERSE (200 entries from `lib/universe.ts`) → curated EXTENSION (295 NIFTY 500 mid/small caps) → `{sector:"Unmapped", industry:"Unmapped"}` fallback.
- **Auto-population**: `swingScannerStore.toResultRow` reads `r.sector || lookupSector(r.symbol).sector`, so all future scans auto-fill missing rows.
- **One-shot historical backfill**: `pnpm --filter @workspace/api-server run backfill:swing-sector` (idempotent, supports `-- --dry-run`).
- **Coverage diagnostic** (owner-only): `GET /api/stocks-to-watch/diagnostics/sector-coverage` returns `lookup` + `db` views with an `unmappedSymbols` list.
- **Current state**: 477 NIFTY 500 symbols mapped at 100 % (2026-05-15).

---

## Option-chain snapshots (Priority 3 — completed)

**Schema:** `lib/db/src/schema/optionChainSnapshot.ts`
**Ingestor:** `artifacts/api-server/src/lib/optionChainSnapshotIngestor.ts`

Durable per-contract option snapshots. **Write-only data layer — does NOT feed any trading decision.**

- **Tables**:
  - `option_chain_snapshot` — composite PK `(underlying, expiry, strike, opt_type, captured_at)`; LTP/OI/ChgOI/volume/IV/bid/ask/Greeks/spread/depth nullable; `tradingsymbol` / `instrument_token` reserved nullable.
  - `option_chain_snapshot_run` — per-cycle bookkeeping.
- **Cadence**: every `OPTION_SNAPSHOT_INTERVAL_MIN` (default 5) during market hours.
- **Coverage**: `SNAPSHOT_INDICES = ["NIFTY","BANKNIFTY","SENSEX"]` (mirrors `FNO_INDICES`), front + next expiry, ATM ± `OPTION_SNAPSHOT_STRIKE_WINDOW` (default 10) strikes.
- **Idempotency**: ON CONFLICT upsert.
- **Retention**: daily sweep at `OPTION_SNAPSHOT_RETENTION_DAYS` (default 30).
- **Env gate**: `OPTION_SNAPSHOT_ENABLED` (auto-off in dev via `REPLIT_DEPLOYMENT` check, mirrors `isPaperAutoTradingEnabled`).
- **Owner-only diagnostics** (strict owner gate, no public-mode read bypass):
  - `GET /api/option-snapshots/diagnostics` — config + per-underlying coverage + recent runs.
  - `POST /api/option-snapshots/run-now?force=1` — manual cycle (`force` bypasses market-hours guard).

---

## Candle warehouse (Priority 4 — completed)

**Schema:** `lib/db/src/schema/candleWarehouse.ts`
**Ingestor:** `artifacts/api-server/src/lib/candleWarehouseIngestor.ts`

Durable OHLCV+OI candle warehouse. **Write-only data substrate — does NOT feed swing scanner / F&O signals / paper-trader / scoring / strategy builder / scanner / order paths.** The swing scanner's `fetchDailyBars` continues to read directly from `fetchKiteHistoricalByToken` (cache-fronted), NOT from this table.

- **Tables**:
  - `candle` — composite PK `(instrument_token, interval, ts)`; OHLC numeric, volume bigint, oi bigint nullable, source varchar, denormalised symbol/exchange tags.
  - `candle_sync_run` — per-cycle bookkeeping with kind/interval/universe/symbols/rows/errors.
- **Source**: reuses `fetchKiteHistoricalByToken` (already throttled at ~2.5 req/s with in-flight dedup) — no new broker calls.
- **Universes**: env CSV `CANDLE_WAREHOUSE_UNIVERSES` (default `indices`; allowed `indices,fno-stocks,swing-500`). Indices = NIFTY/BANKNIFTY/SENSEX (mirrors snapshot universe + `FNO_INDICES`).
- **Intervals**: `day` + `15minute` (5 m intentionally excluded as too heavy for v1).
- **Cadence**: daily sync after 15:40 IST latched per IST-day; 15-min intraday loop during market hours; per-cycle symbol cap (`CANDLE_WAREHOUSE_MAX_SYMBOLS_PER_RUN`, default 60) so heavy universes spread across cycles.
- **Backfill**: 400-day daily / 30-day intraday on first sight; auto-detect BACKFILL vs INCREMENTAL by gap from latest stored ts (5-day threshold for daily, 1-day for 15 m).
- **Idempotency**: ON CONFLICT upsert on PK.
- **Retention**: intraday swept by `CANDLE_WAREHOUSE_RETENTION_DAYS_INTRADAY` (default 60); daily candles kept indefinitely.
- **Env gate**: `CANDLE_WAREHOUSE_ENABLED` (auto-off in dev via `REPLIT_DEPLOYMENT` check; mirrors `isPaperAutoTradingEnabled`).
- **Owner-only diagnostics** (strict owner gate, no public-mode read bypass):
  - `GET /api/candles/diagnostics` — config + by-interval coverage + 100 most-stale per-symbol rows + recent 20 runs + in-memory ring buffer.
  - `POST /api/candles/sync?interval=&universe=&kind=&ignoreCap=1` — manual trigger.

---

## Equity sizing helper & diagnostics (Priority 5 — completed)

**Helper:** `artifacts/api-server/src/lib/equitySizingHelper.ts`
**Tests:** `artifacts/api-server/src/lib/equitySizingHelper.test.ts`
**Routes:** `artifacts/api-server/src/routes/equitySizing.ts`

Pure-function equity sizing preview that mirrors `openPaperEquityTrade`'s gate sequence EXACTLY. **Read-only / preview only — never called from any execution path.**

### Gate sequence (early-return, identical to live path)

```
INVALID_STOP → STOP_SANITY → DD_DAILY → DD_WEEKLY → DD_MONTHLY
  → DAILY_CAP → CONCURRENT_CAP → DEPLOY_LE_0 → QTY_LT_1
  → INSUFF_BAL → HEAT_CAP
```

### Result shape

```ts
{
  verdict, reason, detail,
  qty, capitalRequired, perShareRisk, totalRisk, riskPct,
  accountValue, slots, perPosition, deploy,
  newHeat, projectedHeat, heatCap,
  limits
}
```

### Constants (single-sourced from `paperAccount.ts` and echoed in `result.limits`, drift-guarded by test)

- `SEED_CAPITAL.EQUITY` = ₹1 M
- `EQUITY_RISK.BASE_SLOTS` = 4 / `MAX_CONCURRENT` = 10 / `MAX_NEW_PER_DAY` = 3
- `EQUITY_STOP_SANITY` 1–8 %
- `PORTFOLIO_HEAT.MAX_EQ_HEAT_PCT` = 6 %

### Owner-only diagnostic endpoints (strict owner gate, no public-mode bypass)

- `GET /api/paper/eq/sizing-preview?symbol=&entry=&stop=` — single-shot preview against a live account snapshot. Calls `ensureDailyReset("EQUITY")` + reads sticky DD latches via `getEqDaily/Weekly/MonthlyRealizedDrawdown` for full live-path parity.
- `GET /api/paper/eq/candidates-diagnostic` — batch preview over the latest swing-scan candidates with `action <> 'AVOID / NO TRADE'`, plus a reason histogram.

### Limitations (accepted)

- Preview is **not transactional** — it reads OUTSIDE any `FOR UPDATE` lock, so its verdict can drift between snapshot and an immediate live open. This is intentional and explicitly disclaimed in the JSON response.
- `INSUFF_BAL` is mathematically unreachable through the helper's own formula (proven by 648-case sweep test) but kept as defence-in-depth, mirroring the live path.
- Candidates surface uses `swing_scan_result.action <> 'AVOID / NO TRADE'`, not literal `STRONG_BUY` (which is a downstream label produced by `fullNseScanner`, not stored in `swing_scan_result`).
- Helper is **not connected to any automated trading decision** — it is a diagnostic tool only.

---

## Combo paper-trader lane (Tier C, Phase 1 — shipped 2026-05-13)

See `docs/combo-paper-trader-design.md` for the design note. Owner-only manual multi-leg paper trades, fully isolated from the auto `paper_trade_fo` lane.

- **Tables** (`paper_trade_combo` + `paper_trade_combo_leg`): UNIQUE(combo_id, leg_index), 6 CHECK constraints, FK CASCADE. Combo legs persist `qty = lots × lotSize` (shares); `lots` is taken straight from the request, never reverse-derived. P&L formula `Σ sign·(last−entry)·qty` therefore yields rupees.
- **Routes** (`/api/paper/combos`): owner-only. POST opens, GET lists/details (re-marks live on detail), POST `:id/close`. All pricing comes from `fetchOptionChain` server-side; the request schema does not accept premium/IV/Greeks/margin/P&L — `sanitizeLegSpec` strips them defense-in-depth.
- **Defined-risk only v1**: rejects naked shorts/ratios via `snapshot.maxLoss == null` → `UNDEFINED_RISK` 400.
- **Concurrency safety**: open-cap (`COMBO_MAX_OPEN`) gated inside the insert txn under `pg_advisory_xact_lock(7593721)`; close uses CAS `WHERE id=? AND status='OPEN'` and returns "already closed" for the loser of a race.
- **Isolation**: auto-trader paths (`runFnoPaperTradingTick`, `tryOpenPaperTrades`, etc.) only touch `paper_trade_fo` / `paper_trade_eq`; combo lane never enters the FNO heat budget and is **opted out of the 15:20 force-exit**.
