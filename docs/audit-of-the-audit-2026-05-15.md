# Audit-of-the-Audit — Delta Document

**Source:** `attached_assets/Consolidated_Trading_Platform_Audit_and_Implementation_Report_*.docx`
**Date:** 2026-05-15
**Verifier:** main agent, against running production checkpoint `a592bef` and live DB.

---

## 0. Security incident summary (verified, no values printed)

| Item | Verified state | Action |
|---|---|---|
| `kite_session` table contents | 1 row, plaintext `api_key` + `access_token` + `public_token`, expires 2026-05-16 06:00 IST | **Self-rotates tomorrow.** Optionally `DELETE FROM kite_session;` to kill now |
| `KITE_API_SECRET` (long-lived) | Set in env (32 chars) | **USER MUST ROTATE in Zerodha developer console** |
| `KITE_API_KEY` | Set in env (16 chars) | Not secret per OAuth flow, but rotating it forces a clean break — optional |
| `APP_ACCESS_PASSWORD` | Set in env | **USER MUST ROTATE before next 06:00 IST** — gates `/api/kite/export-session` |
| `SESSION_SECRET` | Set in env | **USER SHOULD ROTATE** (invalidates all old cookies, defense-in-depth) |
| `DATABASE_URL` Postgres password | Set | **USER SHOULD ROTATE** if dump source was the DB itself |
| `TRADINGVIEW_WEBHOOK_SECRET` | Set | Rotate if webhook secret was in the dump |
| `users.password_hash` | bcrypt, not plain | Rotate subscriber passwords only if dump went somewhere truly untrusted |
| `global_screener_presets.share_token` | Plaintext share-link bearer | Bump tokens (`UPDATE … SET share_token = gen_random_uuid()::text`) if shared presets were in scope |
| `.env*` files in repo | None | Now blocked by `.gitignore` going forward |
| pg_dump / backup scripts in repo | None | None to remediate |
| Token logging in pino | None found | OK |

### Code/process changes shipped this turn (no trading code touched)

1. `scripts/safe-db-export.sh` (NEW, 4.8 KB, executable) — `pg_dump` wrapper that excludes `kite_session` entirely and scrubs `users.password_hash` + `global_screener_presets.share_token`. Includes a leak-check grep that aborts if obvious secrets remain.
2. `.gitignore` hardened — `.env*`, `*.sql`, `*.dump`, `*.backup`, `safe-export-*.sql`, `*.pem`, `*.key` now blocked.
3. `artifacts/api-server/src/lib/securityAudit.ts` — two new `warn`-severity checks: `secret_kite_session_at_rest` and `secret_export_session_endpoint`. Surfaces the plaintext storage and the export-endpoint risk in the owner audit dashboard.
4. `replit.md` — new "Security hygiene" section with the rotation order and the safe-export rule.

---

## 1. Verification methodology

For each P0/P1 claim from the consolidated audit, I ran one of:

- **DB probe** — `psql` against the live database (`information_schema`, row counts, NULL ratios).
- **Code probe** — `rg`/read against the actual source tree at `a592bef`.
- **Behaviour probe** — checked the route handler / lib function the claim references.

Claims are bucketed into: **Already implemented** · **Partially implemented** · **Genuinely missing** · **Incorrect / not applicable**.

---

## 2. Delta — claim-by-claim

### A. Already implemented (audit overstated severity)

| # | Audit claim | What actually exists |
|---|---|---|
| A1 | "No paper-trade audit table" | `paper_trade_eq`, `paper_trade_fo`, `paper_eq_audit`, `paper_daily_summary_fo`, plus `/paper/diagnostics/untriggered/fo`, `/paper/diagnostics/daily-summary/fo`, `/paper/diagnostics/daily-summary/fo/history` (replit.md "Diagnostics & observability"). |
| A2 | "No F&O signal gating / safety nets" | 13 active gates documented in replit.md "Paper-trader safety nets" table: liquidity, DD caps (daily/weekly), vol-clamped stop, HTF, true 1h HTF, time-of-day, expiry-day, sector RS, win-rate, ATM-OI, 15:20 force-exit, post-stop cool-down, portfolio heat cap. |
| A3 | "No equity entry-safety logic" | `computeEntrySafety()` in `lib/scoring.ts` returns `entryQuality` GOOD/FAIR/POOR; POOR demotes `STRONG_BUY→BUY`, blocking auto-opens. |
| A4 | "No Kite-vs-Yahoo source labeling" | `tradingConfig.isActionableForFno` returns false for `DELAYED_YAHOO`; `KiteOfflineBanner` + `KiteOfflineNote` UI; `dataProvider.ts` source attribution. |
| A5 | "No security audit / live checks" | `securityAudit.ts` runs 16 (now 18 with today's additions) live + config checks; owner-only audit dashboard. |
| A6 | "No instruments cache resilience" | `kiteAuth.ts` has 7-step cache: TTL, exponential failure cooldown, generation tokens to prevent stale-overwrite, disk warm-start, `forceRefreshInstruments` admin path with raw-SDK probe, `autoMirrorInstruments` for cold start. |
| A7 | "OI Lab missing intraday history" | OI Lab Δ-window Kite-historical backfill ATM±7 strikes × 2 sides, WORKERS=2, fail-OPEN. |
| A8 | "No combo / multi-leg manual paper trader" | `paper_trade_combo` + `paper_trade_combo_leg` shipped 2026-05-13, advisory-locked open-cap, defined-risk-only v1, isolated from auto-trader. |
| A9 | "No options strategy custom builder" | `/strategies` "Custom Builder" tab, `POST /options/strategies/:underlying/custom`, max 8 legs, scenario sliders, zero math duplication. |
| A10 | "Pro Swing Scanner is just a placeholder" | TS port of full Pro Swing Scanner v3 in `lib/swingScanner.ts` + `lib/swingScannerData.ts` + once-per-day deep scan after 15:35 IST + 15min intraday LTP refresh. |

### B. Partially implemented (real gaps inside otherwise-correct features)

| # | Audit claim | What's there | What's missing |
|---|---|---|---|
| B1 | "Sector / industry mapping is missing" | `swing_scan_result` schema **has** `sector` column. `relativeStrength.ts` references sector in the gate. | DB-verified: **1645/1645 rows have NULL sector**. Either the populator never wrote it, or it was dropped during a backfill. **Real gap.** RS gate currently runs without sector signal for swing universe. |
| B2 | "Option signal exit tracks wrong price" | `option_signal_history` has both `exit_price` (numeric) and `option_entry`/`option_stop_loss`. | The table tracks **spot exit only** — there's no `option_exit_premium` column matching the existing `option_entry`. Audit claim is partially right; the omission is real but it's in the **history/journal layer**, not in `paper_trade_fo` (which correctly stores `entry_premium`/`exit_premium`). |
| B3 | "No candle/bar warehouse" | `iv_history` table exists; F&O daily history → live Kite `day` interval (no persistence by design); `global_candles` table exists for the Global artifact (crypto/forex/global indices/commodities). | No persisted **NSE equity** intraday/daily candles. Backtests (when they exist — see C5) would have to re-pull from Kite each run, and you can't go back further than Kite's history window. **Real gap if backtesting is on the roadmap.** |
| B4 | "FII/DII flows are static" | `fii_dii_daily` + `participant_oi_daily` tables and `/flows` endpoint exist; directional formula was just fixed (a592bef). | No automated daily ingest cron — relies on manual sync. **Real gap.** |
| B5 | "No India VIX / sector-index history" | VIX is read live from Kite (`optionSignalGates.ts`). Sector indices used live in `relativeStrength.ts`. | Neither persisted. Same backtest implication as B3. |

### C. Genuinely missing (audit is correct)

| # | Audit claim | DB/code probe |
|---|---|---|
| C1 | `strategy_versions` / strategy registry | `information_schema.tables` — none. |
| C2 | `feature_snapshots` (per-decision feature vector) | None. Pipeline computes features but doesn't persist them. |
| C3 | `backtest_runs` + `backtest_trades` | None. No backtest harness in repo (`rg backtest` returns zero hits in `lib/`/`artifacts/`). |
| C4 | `walk_forward_results` | None. |
| C5 | `signal_expectancy` rollup | Computed live in `WIN_RATE_CALIBRATION` lookback (30-day, MIN_SAMPLE 10) but not persisted. The 30-day win-rate gate works; longer-horizon expectancy / R-multiple analysis does not. |
| C6 | `option_chain_snapshot` (point-in-time chain capture) | None. Live chain pulled on demand; no persisted history of past chains for replay/research. |
| C7 | Corporate-actions / results-calendar table | None. |
| C8 | `data_source_status` / `data_quality_scores` | `securityAudit.ts` covers SECURITY only; no equivalent telemetry table for *data freshness*. We have ad-hoc heuristics (`getIndicesBoard()` 8s race deadline, "No live data — last attempt" empty-state copy) but nothing rolled up. |
| C9 | Encrypted-at-rest Kite session columns | Confirmed plaintext (see security section). Real gap; **not implemented this turn** per scope constraint. |

### D. Incorrect / not applicable to this codebase

| # | Audit claim | Why it doesn't apply |
|---|---|---|
| D1 | "`global_candles` is empty" | DB probe: table exists in `lib/db/src/schema/globalScanner.ts`, used by Global artifact for crypto/forex/global equities/commodities. Not used for Indian/F&O — those use Kite live. Audit conflated two unrelated subsystems. |
| D2 | "`paper_trade_fo` uses `entry`/`stop_loss` and they're broken" | Schema verified: actual columns are `entry_premium`/`stop_premium`/`exit_premium`/`last_premium`/`target1_premium`/`target2_premium`. The "Gotcha" in replit.md (2026-05-13 fix) flagged exactly this naming pattern; column-name typos surface as `Failed query`. The audit was looking at a stale snapshot. |
| D3 | "`QTY_LT_1` rejection blocks valid trades" | `rg` returns zero hits for `QTY_LT_1` anywhere in `artifacts/api-server/src/` or `lib/`. Either the token was renamed or it never existed in this codebase. |
| D4 | "F&O universe is too narrow / hardcoded" | NIFTY / BANKNIFTY / SENSEX is **deliberate** per replit.md — F&O signal pipeline scope. Adding indices is a 3-place edit (`OPTION_INDICES`, `FNO_INDICES`, `SIGNAL_INDEX_TO_LTP_KEY`) — well-documented, not a defect. |
| D5 | "`computeEqLot` does not exist / equity sizing is missing" | `EQUITY_DD_CAPS` (2/4/8% of ₹10L sticky latches) + `EQUITY_STOP_SANITY` (1–8%) + manual buy route + paper-trader read-only-in-dev gating exist. There is no `computeEqLot` because equities use `qty = floor(riskRupees / stopRupees)`, not lot sizes. |
| D6 | "Dev environment can clobber prod paper trades" | Resolved 2026-05-13 (`PAPER_TRADING_ENABLED` env override + `EnvironmentBanner` + `/paper/diagnostics/environment`). Dev is read-only for the auto-trader. |
| D7 | "Auth is open / public" | `requireAuth`, `requireOwner`, HMAC-SHA256 signed HttpOnly cookies, rate-limit buckets (login 5/15min, webhook 60/min, general 300/min), live-probe check `auth_gate_live` = 401 verified. Public-access mode is read-only by design and limited to a curated subset of routes. |
| D8 | "Webhook is forge-able" | Live probe `auth_webhook_post_secret` verifies POST returns 400/401/503 without `TRADINGVIEW_WEBHOOK_SECRET`; in production it's 503-locked when secret is absent. |
| D9 | "OI computation uses wrong side for support/resistance" | Resolved (replit.md Gotcha): `computeAnalytics()` filters `topResistance` to CE strikes ≥ spot, `topSupport` to PE strikes ≤ spot. |

---

## 3. Top-5 implementation priorities (recommendation, awaiting approval)

Ranked by **value × isolation × low-blast-radius**. None of these touch the F&O signal pipeline, paper-trader gates, strategy builder, combo lane, or scanner UI logic without explicit follow-up approval per item.

### Priority 1 — Encrypt Kite session columns at rest (security closure)

| Field | Detail |
|---|---|
| **Files / modules** | `lib/db/src/schema/kiteSession.ts` (no schema change — same `text` columns), `artifacts/api-server/src/lib/kiteCrypto.ts` (NEW, AES-256-GCM with `KITE_TOKEN_ENC_KEY`), `kiteAuth.ts` (`completeLogin`, `getActiveSession`, `storeImportedSession` — encrypt-on-write, decrypt-on-read), `kite.ts` route (`/export-session` returns plaintext payload as today, since the consumer needs a usable token). |
| **DB migrations** | None — values stay in same columns, just ciphertext-formatted (`v1:<iv>:<tag>:<ct>` prefix lets us detect un-migrated rows and migrate on first read). |
| **API changes** | None public. |
| **UI changes** | None. |
| **Test plan** | Unit test for `encrypt(plain)→decrypt(...)===plain` round-trip. Integration test: write a row via `completeLogin` mock, confirm DB column starts with `v1:` prefix and is base64-ish. Add `KITE_TOKEN_ENC_KEY` to env-required check in `securityAudit.ts`. |
| **Risk** | LOW — single read/write surface. If `KITE_TOKEN_ENC_KEY` is lost, daily re-login fixes it. Dev mirror still works because `/export-session` decrypts before returning. |
| **Complexity** | S (½ day). Closes the dump-leak vector permanently. |

### Priority 2 — Backfill `swing_scan_result.sector` + ongoing populator

| Field | Detail |
|---|---|
| **Files / modules** | `lib/swingScannerData.ts` (writer), `lib/sectorMap.ts` (NEW — single static or DB-backed NSE-symbol→sector lookup), `artifacts/api-server/src/lib/swingScannerStore.ts` (call sectorMap on insert). |
| **DB migrations** | None (column exists). One-time backfill SQL: `UPDATE swing_scan_result SET sector = sm.sector FROM sector_map sm WHERE …;`. Optional new `sector_map` table seeded from NSE industry CSV. |
| **API changes** | `/api/stocks-to-watch/analysis` already returns rows; sector field starts populating. |
| **UI changes** | Sector pill on Stocks-to-Watch row (additive). |
| **Test plan** | Insert a row, assert sector resolves. Backfill smoke: `SELECT count(*) FROM swing_scan_result WHERE sector IS NULL` should drop to ~0. |
| **Risk** | LOW — writes only. Sector RS gate already gracefully degrades on missing sector, so partial backfill is safe. |
| **Complexity** | S–M (1 day, mostly the static sector CSV). |

### Priority 3 — Persist option-chain snapshots (research substrate)

| Field | Detail |
|---|---|
| **Files / modules** | NEW `lib/db/src/schema/optionChainSnapshot.ts` (`underlying`, `expiry`, `taken_at`, `spot`, `strikes` JSONB), `artifacts/api-server/src/lib/optionChainSnapshot.ts` (writer), hook in `fetchOptionChain` to opportunistic-write at most 1 snapshot/min/underlying. |
| **DB migrations** | One new table. Drizzle push. |
| **API changes** | NEW `GET /api/options/snapshots/:underlying?from=&to=` (owner-only). |
| **UI changes** | None v1 — just substrate. |
| **Test plan** | Throttle test: 10 calls in 60s → 1 row. Round-trip JSONB. Disk usage probe: ~2 KB/strike × 80 strikes × 4 underlyings × 375 snaps/day ≈ 240 MB/day — needs a 30-day retention CRON (include in PR). |
| **Risk** | LOW (writes only, no read path that affects trading). MEDIUM disk-usage if retention isn't enforced. |
| **Complexity** | M (2 days incl. retention job). |

### Priority 4 — Persist NSE 1d/15m candles for the F&O universe (backtest substrate)

| Field | Detail |
|---|---|
| **Files / modules** | NEW `lib/db/src/schema/nseCandles.ts` (composite PK `symbol`+`interval`+`bar_time`), NEW `artifacts/api-server/src/lib/nseCandleStore.ts`, scheduled fetcher running 16:00 IST daily for 1d, every 15min for 15m bars on F&O symbols only (≈100 symbols × 4 intervals = manageable). |
| **DB migrations** | One new partitioned table (or plain table — partitioning is overkill at this volume). |
| **API changes** | None public v1. |
| **UI changes** | None. |
| **Test plan** | Vitest for fetcher (mock Kite). Manual: confirm `count(*)` grows by ~25 bars/symbol/day. |
| **Risk** | LOW for the trading code path (writes only). Highest **scope risk**: tempting to start using these candles in live signals — DO NOT in this PR. |
| **Complexity** | M (2–3 days). |

### Priority 5 — Equity manual-buy sizing helper + lifetime journal

| Field | Detail |
|---|---|
| **Files / modules** | `artifacts/scanner/src/pages/paper-trading.tsx` (manual buy modal — show `qty = floor(riskRupees / stopRupees)` preview), `paperAccount.ts` (single helper `suggestEquityQty({entry, stop, riskPct, capital})` — pure, testable). |
| **DB migrations** | None. |
| **API changes** | NEW `POST /paper/positions/eq/suggest-qty` returning `{qty, riskRupees, capitalUsedPct, dailyDDHeadroom}` — pure preview, no DB writes. |
| **UI changes** | One modal preview line + a "use suggested" button. |
| **Test plan** | Pure-fn unit tests on `suggestEquityQty`. UI test: enter entry/stop, see qty update. |
| **Risk** | VERY LOW — preview only. The actual buy still goes through existing `POST /paper/positions/eq/manual` with the same DD-cap & sanity gates. |
| **Complexity** | S (1 day). |

---

## 4. What I am NOT recommending right now (and why)

- **Strategy versions / backtest harness / walk-forward / expectancy tables (C1–C5).** These are correct gaps but they're a **multi-month** programme. Building them on top of P3+P4 (snapshot + candle persistence) is the right order. Recommend revisiting after P3+P4 ship and at least 2 weeks of data is captured.
- **`/api/kite/export-session` redesign** (replace shared password with a scoped key). Real improvement but breaks `autoMirrorSession()` for any dev environment that hasn't been updated. Schedule for a quiet weekend, not in the middle of trading hours.
- **F&O universe expansion**, **paper-trader gate tuning**, **scanner column changes** — all out of scope per your guardrails.

---

## 5. Open questions for the user

1. After Priority 1 (encryption at rest) ships, do you want me to also encrypt `users.password_hash`? It's already bcrypt — encrypting bcrypt is mostly theatre. I'd recommend **no**, and instead track this as a "low" finding.
2. For Priority 4 (NSE candles), do you want the fetcher to be opportunistic (write what comes through `dataProvider`) or scheduled (own cron)? Scheduled is cleaner for backtests; opportunistic is cheaper.
3. Are you OK with the audit-of-the-audit landing as `docs/audit-of-the-audit-2026-05-15.md` and being kept in repo, or would you prefer it stay in chat only?
