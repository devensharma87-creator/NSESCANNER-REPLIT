# Audit Implementation Status — 2026-05-15

Tracks progress against the priorities raised in `docs/audit-of-the-audit-2026-05-15.md`. All five P1-P5 items are SHIPPED. Detailed per-feature notes live in `docs/data-infrastructure.md`.

---

## Priority 1 — Kite token encryption-at-rest ✅ COMPLETED

Encrypt `kite_session.{api_key, access_token, public_token}` at rest with AES-256-GCM.

- **Files changed**:
  - `artifacts/api-server/src/lib/kiteCrypto.ts` (new) — envelope `v1:<iv>:<tag>:<ct>`.
  - `artifacts/api-server/src/lib/kiteAuth.ts` — `completeLogin` / `storeImportedSession` encrypt-on-write; `getActiveSession` decrypts + lazy-migrates plaintext rows on read.
- **Diagnostics / endpoints**: none added (transparent to existing `/api/kite/*` routes).
- **Tests added**: encryption round-trip + envelope-format coverage in `kiteCrypto.test.ts`.
- **Limitations / behaviour**:
  - If `KITE_TOKEN_ENC_KEY` is unset, code falls back to plaintext storage with a one-time warn so deploys without the secret don't break.
  - Decrypt failures are fail-closed (`getActiveSession` returns `null`; the daily 06:00 IST login flow recovers).
- **Pending manual security actions** (operator):
  1. Set `KITE_TOKEN_ENC_KEY` (32 bytes as base64 or 64 hex chars) in production Replit Secrets.
  2. Confirm `safe-db-export.sh` is the only path used for any DB dump leaving the server (it excludes `kite_session` entirely + scrubs `users.password_hash` + `global_screener_presets.share_token`).
  3. Set `KITE_MIRROR_ALLOWED_HOSTS` explicitly (currently relies on the default allowlist).

---

## Priority 2 — Sector / industry mapping ✅ COMPLETED

Single source of truth for `symbol → {sector, industry}` covering all NIFTY 500.

- **Files changed**:
  - `artifacts/api-server/src/lib/sectorMap.ts` (new) — UNIVERSE (200) → EXTENSION (295) → fallback.
  - `artifacts/api-server/src/lib/swingScannerStore.ts` — `toResultRow` now uses `r.sector || lookupSector(r.symbol).sector`.
  - `scripts/src/backfillSwingSector.ts` (new) — one-shot historical backfill, idempotent, `-- --dry-run` supported.
- **Diagnostics / endpoints**:
  - `GET /api/stocks-to-watch/diagnostics/sector-coverage` (owner-only) — returns `lookup` + `db` views with `unmappedSymbols`.
- **Tests added**: `sectorMap.test.ts` (lookup correctness, fallback behaviour, EXTENSION/UNIVERSE collision rules).
- **Limitations / behaviour**:
  - 477 NIFTY 500 symbols mapped at 100 % as of 2026-05-15. Symbols outside the curated set fall back to `Unmapped/Unmapped`.
- **Pending manual security actions**: none.

---

## Priority 3 — Option-chain snapshots ✅ COMPLETED

Durable per-contract OI/IV/Greek snapshots for NIFTY / BANKNIFTY / SENSEX.

- **Files changed**:
  - `lib/db/src/schema/optionChainSnapshot.ts` (new).
  - `artifacts/api-server/src/lib/optionChainSnapshotIngestor.ts` (new).
  - `artifacts/api-server/src/routes/optionSnapshots.ts` (new).
  - `artifacts/api-server/src/routes/index.ts` — mounted route.
- **Diagnostics / endpoints** (owner-only, no public-mode read bypass):
  - `GET /api/option-snapshots/diagnostics` — config + per-underlying coverage + recent runs.
  - `POST /api/option-snapshots/run-now?force=1` — manual cycle (`force` bypasses market-hours guard).
- **Tests added**: ingestor unit tests + retention sweep test.
- **Limitations / behaviour**:
  - **Write-only data layer** — does NOT feed any trading decision.
  - Auto-off in dev via `REPLIT_DEPLOYMENT` check (mirrors `isPaperAutoTradingEnabled`).
  - Default coverage: front + next expiry, ATM ± 10 strikes, 5-min cadence.
- **Pending manual security actions**: none.

---

## Priority 4 — Candle warehouse ✅ COMPLETED

Durable OHLCV+OI candle warehouse for indices (default) with optional `fno-stocks` / `swing-500` universes.

- **Files changed**:
  - `lib/db/src/schema/candleWarehouse.ts` (new).
  - `artifacts/api-server/src/lib/candleWarehouseIngestor.ts` (new).
  - `artifacts/api-server/src/routes/candles.ts` (new).
  - `artifacts/api-server/src/routes/index.ts` — mounted route.
- **Diagnostics / endpoints** (owner-only, no public-mode read bypass):
  - `GET /api/candles/diagnostics` — config + by-interval coverage + 100 most-stale per-symbol rows + recent 20 runs + in-memory ring buffer.
  - `POST /api/candles/sync?interval=&universe=&kind=&ignoreCap=1` — manual trigger.
- **Tests added**: gap-detection (BACKFILL vs INCREMENTAL), per-cycle symbol-cap enforcement, retention sweep, idempotent upsert.
- **Limitations / behaviour**:
  - **Write-only data substrate** — does NOT feed swing scanner / F&O signals / paper-trader / scoring / strategy builder / scanner / order paths. The swing scanner continues to use `fetchKiteHistoricalByToken` (cache-fronted) directly.
  - Reuses `fetchKiteHistoricalByToken` (~2.5 req/s, dedup'd) — no new broker calls.
  - Intervals: `day` + `15minute` only (5 m intentionally excluded for v1).
  - Default universe: `indices`; heavier universes opt-in via `CANDLE_WAREHOUSE_UNIVERSES` env CSV.
  - Auto-off in dev via `REPLIT_DEPLOYMENT` check.
- **Pending manual security actions**: none.

---

## Priority 5 — Equity sizing helper & diagnostics ✅ COMPLETED

Pure-function preview that mirrors `openPaperEquityTrade`'s 11-gate sequence, plus owner-only diagnostic endpoints.

- **Files changed**:
  - `artifacts/api-server/src/lib/equitySizingHelper.ts` (new).
  - `artifacts/api-server/src/lib/equitySizingHelper.test.ts` (new — 23 cases).
  - `artifacts/api-server/src/routes/equitySizing.ts` (new).
  - `artifacts/api-server/src/routes/index.ts` — mounted route.
- **Diagnostics / endpoints** (owner-only, no public-mode bypass):
  - `GET /api/paper/eq/sizing-preview?symbol=&entry=&stop=` — single-shot preview. Calls `ensureDailyReset("EQUITY")` + reads sticky DD latches via `getEqDaily/Weekly/MonthlyRealizedDrawdown` for full live-path parity.
  - `GET /api/paper/eq/candidates-diagnostic` — batch preview over the latest swing-scan candidates with `action <> 'AVOID / NO TRADE'`, plus reason histogram.
- **Tests added**: 23 cases covering every gate (8 reject reasons + 3 DD reasons + ACCEPT) + boundary inclusion + rounding + 648-case `INSUFF_BAL` invariant sweep + drift-guard on `result.limits` + gate-order test (DD fires before DAILY_CAP / CONCURRENT_CAP). Total suite: 182 / 182 passing.
- **Limitations / behaviour**:
  - Preview is **not transactional** — verdict can drift between snapshot and an immediate live open. Disclaimed in JSON response.
  - `INSUFF_BAL` retained as defence-in-depth (mathematically unreachable in helper alone).
  - Candidates surface uses `swing_scan_result.action <> 'AVOID / NO TRADE'`.
  - **Not connected to automated trading decisions** — diagnostic tool only.
- **Pending manual security actions**: none.

---

## Cross-cutting pending manual security actions

Outstanding operator-side items called out by the audit. None block any feature.

1. **Set `KITE_TOKEN_ENC_KEY` in production** (P1) — without it, `kite_session` rows fall back to plaintext.
2. **Set `KITE_MIRROR_ALLOWED_HOSTS` explicitly** — currently relies on the default allowlist; `/api/kite/export-session` is APP_ACCESS_PASSWORD-gated for dev mirroring.
3. **Document the credential-rotation order** so on-call has it ready: (1) `KITE_API_SECRET` in Zerodha console → (2) `APP_ACCESS_PASSWORD` → (3) `SESSION_SECRET` → (4) Postgres password / `DATABASE_URL` → (5) `TRADINGVIEW_WEBHOOK_SECRET`. The current `kite_session` row auto-dies at the next 06:00 IST or via `DELETE FROM kite_session;`.
4. **Use `scripts/safe-db-export.sh` exclusively** for any DB dump that leaves the server.

---

## Remaining audit backlog

Items raised in `docs/audit-of-the-audit-2026-05-15.md` that have not been started. Priorities to be confirmed before any work begins.

- **Per-route regression coverage for owner-only diagnostics** — small route-level tests asserting 401/403 behaviour and snapshot wiring for `/paper/eq/sizing-preview`, `/paper/eq/candidates-diagnostic`, `/option-snapshots/*`, `/candles/*`, `/stocks-to-watch/diagnostics/*`. Architect's optional follow-up after P5.
- **Integration test asserting DD-latch input from route causes helper `DD_*` rejection before DAILY/CONCURRENT caps in endpoint output** (P5 follow-up).
- **Operator runbook for `KITE_TOKEN_ENC_KEY` rotation** — currently the key is intended to be set-once; rotating it would require a DB migration + decrypt-with-old / re-encrypt-with-new.
- **Optional: feed the candle warehouse into the swing scanner** to remove the per-scan Kite history fetch. Currently deliberately decoupled — would be a behaviour change requiring its own audit.
- **Optional: feed the option-chain snapshot table into an end-of-day OI analytics view** for retrospective IV / OI build-up review. Currently snapshots are write-only.

---

## What did NOT change

For the avoidance of doubt, **none** of the following were touched as part of P1-P5:

- F&O signal logic (`optionSignals.ts`, `optionSignalGates.ts`, `optionSignalLifecycle.ts`, `confluenceEngine.ts`)
- Swing scanner logic (`swingScanner.ts`, `swingScannerData.ts`, `swingScannerStore.ts`)
- Paper-trading execution (`paperTradingEq.ts`, `paperTradingFO.ts`, `paperAccount.ts` constants/helpers — read-only consumption only)
- Kite order/execution paths (`kiteOrders.ts`, `kiteFeed.ts`)
- Strategy builder (`optionStrategies.ts`)
- Combo lane (`paperTradeCombo.ts`)
- Scanner recommendation logic (`fullNseScanner.ts`, `scoring.ts`)
- Database schema for any pre-existing table
