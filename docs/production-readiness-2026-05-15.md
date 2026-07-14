# Production Readiness Checklist & Safe Deployment Verification Runbook

**Date:** 2026-05-15
**Target environment:** `marketscannerbydev.in` (Replit Autoscale Deployment)
**Scope:** documentation/runbook only — no runtime, signal, paper-trader, ingestion, scheduler, or schema code is changed by this document.

---

## 0. How to use this document

1. Before any production deploy, walk Section 4 (**Go-live checklist**) end-to-end. Tick every line.
2. Immediately after the deploy is healthy, walk Section 5 (**Smoke-test checklist**).
3. If anything in Section 4 or 5 fails, stop and consult Section 6 (**Rollback plan**) before debugging in place.
4. Sections 1-3 are reference material (priorities completed + env-var reference).

This file is a snapshot of the world as of 2026-05-15. When new priorities ship, append a new dated section rather than rewriting history.

---

## 1. Completed priorities covered by this runbook

All ten priorities below are SHIPPED, ARCHITECT-APPROVED, and merged. Each row links to the architecture note that covers the "why".

| # | Priority | Surface added | Architecture doc |
|---|---|---|---|
| 1 | Kite token encryption-at-rest | `lib/kiteCrypto.ts`, AES-256-GCM envelope on `kite_session.{api_key, access_token, public_token}` | `docs/audit-implementation-status-2026-05-15.md` (Priority 1) |
| 2 | Sector / industry mapping | `artifacts/api-server/src/lib/sectorMap.ts` + `GET /api/stocks-to-watch/diagnostics/sector-coverage` | `docs/data-infrastructure.md` |
| 3 | Option-chain snapshots (write-only data substrate) | `lib/db/src/schema/optionChainSnapshot.ts` + ingestor + `GET/POST /api/option-snapshots/*` | `docs/data-infrastructure.md` |
| 4 | Candle warehouse (write-only data substrate) | `lib/db/src/schema/candleWarehouse.ts` + ingestor + `GET/POST /api/candles/*` | `docs/data-infrastructure.md` |
| 5 | Equity sizing helper (read-only diagnostic mirror of `openPaperEquityTrade`'s 11 gates) | `artifacts/api-server/src/lib/equitySizingHelper.ts` + `GET /api/paper/eq/sizing-preview` + `GET /api/paper/eq/candidates-diagnostic` | `docs/data-infrastructure.md` |
| 6 | Owner-only diagnostic route auth tests | `diagnosticRouteAuth.test.ts` (vitest, supertest) — pins owner-cookie gating on all P2-P5 diagnostics | `docs/audit-implementation-status-2026-05-15.md` |
| 7 | DD-latch route integration tests | Daily / weekly / monthly drawdown latches asserted at the route level for both EQ and FNO lanes | `docs/audit-implementation-status-2026-05-15.md` |
| 8 | Encryption-key rotation script + runbook | `artifacts/api-server/src/scripts/rotateKiteTokenEncKey.ts` (dry-run + `--apply`); invoked via `pnpm --filter @workspace/api-server run rotate:kite-key` | `docs/kite-token-enc-key-rotation.md` |
| 9 | Option snapshot analytics (read-only) | `artifacts/api-server/src/lib/optionSnapshotAnalytics.ts` + `GET /api/option-snapshots/analytics` (PCR, OI deltas, max pain, ATM straddle, IV, spread, staleness) | `docs/data-infrastructure.md` |
| 10 | `/infra-health` owner-only dashboard (read-only roll-up) | `artifacts/scanner/src/pages/infra-health.tsx` + `lib/infraHealth.ts` (5 sections, OK/WARN/STALE/FAIL/DISABLED states) | `replit.md` § "Owner-only Data Infrastructure Health dashboard" |

**Crucial property of Priorities 2-10:** none of them touch the F&O signal pipeline, paper-trader entry/exit logic, scanner recommendation, swing scanner scoring, strategy builder, combo lane, Kite execution path, or DB schema (other than additive `paper_trade_combo*`, `option_chain_snapshot`, `candle_warehouse`, `paper_daily_summary_fo` tables that have already been pushed). They are all observation surfaces. This is what makes this deploy low-risk.

---

## 2. Required production environment variables

Every variable below is read by runtime code. Names are taken verbatim from the source — typos in production env will silently disable the feature.

### 2.1 Hard-required (server will not function safely without these)

| Variable | Purpose | Failure mode if missing/wrong | Source of truth |
|---|---|---|---|
| `DATABASE_URL` | Postgres connection string. Used by Drizzle, paper-trader, ingestors, sessions. | Server fails to boot. | platform-managed |
| `SESSION_SECRET` | HMAC key for signed session cookies (`cookieParser(SESSION_SECRET)`). Min 32 chars recommended. | `app.ts` throws on boot ("SESSION_SECRET env var is required"). | `artifacts/api-server/src/app.ts` |
| `APP_ACCESS_PASSWORD` | Public-mode bypass + `/login` gate + `GET /api/kite/export-session` auth (gated by the `x-app-password` header). | Login page rejects everyone; mirror flow fails. Set this. | `routes/kite.ts:123`, `securityAudit.ts` |
| `KITE_API_KEY` / `KITE_API_SECRET` | Zerodha OAuth + REST. | Daily 06:00 IST login flow can't run; `/login/zerodha` 503s. | `lib/kiteAuth.ts` |
| `KITE_TOKEN_ENC_KEY` | 32-byte (base64 or hex) AES-256-GCM key for envelope-encrypting Kite tokens at rest. | If unset: tokens written PLAINTEXT and a one-time warning is logged. **Always set in production.** If wrong (decrypt fails): fail-closed, daily 06:00 IST recovers. | `lib/kiteCrypto.ts` |
| `TRADINGVIEW_WEBHOOK_SECRET` | HMAC secret for inbound TradingView webhooks. | Webhook endpoint returns 503 (locked) in production. | `lib/securityAudit.ts` |

### 2.2 Strongly recommended in production

| Variable | Purpose | Default if unset | Source |
|---|---|---|---|
| `KITE_MIRROR_ALLOWED_HOSTS` | CSV allow-list of hosts that the dev mirror may pull from when calling `GET /api/kite/export-session` on prod. | Defaults to `marketscannerbydev.in,localhost,127.0.0.1`. **Set explicitly in production** so a leaked APP_ACCESS_PASSWORD can't be used from arbitrary hosts. | `routes/kite.ts:203`, `lib/kiteAuth.ts:535` |
| `PAPER_TRADING_ENABLED` | Master gate for the paper auto-trader (`runEquityPaperTradingTick`, `tryOpenPaperTrades`, etc). Accepts `1`/`true`/`yes`/`on` to enable. | Falls back to auto-detect via `REPLIT_DEPLOYMENT === "1"`. **Production must explicitly set `true`.** Manual buys/closes are NOT gated. | `lib/paperAutoTradeFlag.ts` |
| `LOG_LEVEL` | Pino logger level. | `info`. | `lib/logger.ts` |
| `NODE_ENV` | Standard. | Set by platform. Many security-audit checks key off `production`. | various |

### 2.3 Option-chain snapshot ingestor (Priority 3) — opt-in feature flags

All values have working defaults; you only need to set them if you want to override.

| Variable | Default | Range | Effect |
|---|---|---|---|
| `OPTION_SNAPSHOT_ENABLED` | auto-detect (off in dev, on in deployment) | `1`/`true`/`yes`/`on` enables; anything else disables | Master gate. When off, ingestor logs `OPTION_SNAPSHOT_ENABLED is off` and exits. Diagnostics endpoints stay readable. |
| `OPTION_SNAPSHOT_INTERVAL_MIN` | `5` | 1-60 | Snapshot bucket cadence in minutes. |
| `OPTION_SNAPSHOT_STRIKE_WINDOW` | `10` | 1-50 | Strikes to capture each side of ATM. |
| `OPTION_SNAPSHOT_EXPIRIES` | `2` | 1-6 | Number of expiries per underlying. |
| `OPTION_SNAPSHOT_RETENTION_DAYS` | `30` | 1-365 | Daily retention sweep cutoff. |

Source: `artifacts/api-server/src/lib/optionChainSnapshotIngestor.ts:57-85`.

### 2.4 Candle warehouse ingestor (Priority 4) — opt-in feature flags

| Variable | Default | Range | Effect |
|---|---|---|---|
| `CANDLE_WAREHOUSE_ENABLED` | auto-detect (off in dev, on in deployment) | `1`/`true`/`yes`/`on` enables | Master gate. When off, ingestor exits with `CANDLE_WAREHOUSE_ENABLED is off`. |
| `CANDLE_WAREHOUSE_UNIVERSES` | `indices` (CSV) | any subset of `indices`, `fno-stocks`, `swing-500` | Which symbol universes to pull. Unknown values are silently dropped; if the resulting list is empty, falls back to `indices`. |
| `CANDLE_WAREHOUSE_DAILY_BACKFILL_DAYS` | `400` | 30-2000 | First-run daily history depth (~252 trading days = ~400 calendar). |
| `CANDLE_WAREHOUSE_INTRADAY_BACKFILL_DAYS` | `30` | 1-90 | First-run intraday history depth. |
| `CANDLE_WAREHOUSE_MAX_SYMBOLS_PER_RUN` | `60` | 1-1000 | Per-tick batch size (rate-limit guard). |
| `CANDLE_WAREHOUSE_RETENTION_DAYS_INTRADAY` | `60` | 7-365 | Intraday retention sweep cutoff. Daily candles are not auto-pruned. |

Also exposed but not in the requested list (mention for completeness): `CANDLE_WAREHOUSE_INCREMENTAL_DAYS` (default 7, 1-30) — top-up window for incremental ticks.

Source: `artifacts/api-server/src/lib/candleWarehouseIngestor.ts:158-200`.

### 2.5 Key-rotation operator vars (Priority 8) — set transiently during a rotation

| Variable | When to set |
|---|---|
| `KITE_TOKEN_ENC_KEY_OLD` / `KITE_TOKEN_ENC_KEY_NEW` | Only during a key rotation. `pnpm --filter @workspace/api-server run rotate:kite-key` reads them, decrypts the live `kite_session` row with OLD, re-encrypts under NEW inside one transaction. Unset both immediately after rotating `KITE_TOKEN_ENC_KEY`. Full runbook: `docs/kite-token-enc-key-rotation.md`. |

---

## 3. Pre-deploy sanity (run from the developer workspace)

```bash
# 1. Clean typecheck across the whole monorepo.
pnpm run typecheck

# 2. API server tests (vitest; live-DB heat-SQL regression skips when DATABASE_URL unset).
pnpm --filter @workspace/api-server run test

# 3. Scanner tests (vitest + jsdom; includes the 16 infraHealth.ts unit tests).
pnpm --filter @workspace/scanner run test

# 4. Confirm the OpenAPI codegen output is in sync (run if you touched lib/api-spec/openapi.yaml).
pnpm --filter @workspace/api-spec run codegen
git --no-optional-locks status -- lib/api-client-react/src/generated lib/api-zod/src/generated
```

All three commands must finish green. If `typecheck` fails, do not deploy.

---

## 4. Go-live checklist

Walk this list immediately before clicking Deploy.

### 4.1 Secrets & environment

- [ ] `DATABASE_URL`, `SESSION_SECRET`, `APP_ACCESS_PASSWORD` set in production secrets.
- [ ] `KITE_API_KEY`, `KITE_API_SECRET` set with the keys from Zerodha developer console (NOT the dev keys).
- [ ] `KITE_TOKEN_ENC_KEY` set to a freshly-generated 32-byte key (base64 or hex). Confirm via `/audit` that the "Kite token encrypted at rest" check is OK — not the "plaintext fallback" warn.
- [ ] `TRADINGVIEW_WEBHOOK_SECRET` set.
- [ ] `KITE_MIRROR_ALLOWED_HOSTS` set explicitly (e.g. `marketscannerbydev.in`). Do NOT rely on the dev-default that includes localhost.
- [ ] `PAPER_TRADING_ENABLED=true` set explicitly (production must not depend on the auto-detect fallback).
- [ ] `OPTION_SNAPSHOT_ENABLED` is intentionally either set to `true` (you want snapshot ingestion in prod) or left unset / explicitly `false` (you do not). Decide deliberately — do not let the auto-detect default surprise you.
- [ ] `CANDLE_WAREHOUSE_ENABLED` is intentionally either set to `true` or explicitly `false`. Same rule as above.
- [ ] No `.env` file is committed. `.gitignore` already blocks `.env*`, `*.sql`, `*.dump`, `*.backup`, `safe-export-*.sql`.

### 4.2 Encryption / token hygiene

- [ ] `KITE_TOKEN_ENC_KEY` length verified (32 bytes after base64/hex decode). The crypto module fail-closes on invalid keys, but you want to know now, not at 06:00 IST.
- [ ] If migrating from a previous key, the rotation script (`pnpm --filter @workspace/api-server run rotate:kite-key`) was run dry-run-then-`--apply` per `docs/kite-token-enc-key-rotation.md`.
- [ ] Local DB dumps (if any) used `scripts/safe-db-export.sh`, not raw `pg_dump`. The safe script excludes `kite_session` and scrubs `users.password_hash` + `global_screener_presets.share_token`.
- [ ] No raw `pg_dump` of the live DB has been shared in chat, support tickets, or screenshots.

### 4.3 Owner-only access verified

- [ ] `/infra-health` redirects non-owners to login (Priority 6 tests cover this server-side; eyeball it once in incognito).
- [ ] `/admin` and the INFRA nav link are not visible to subscriber accounts.
- [ ] `/api/security/audit`, `/api/option-snapshots/diagnostics`, `/api/option-snapshots/analytics`, `/api/candles/diagnostics`, `/api/stocks-to-watch/diagnostics/sector-coverage`, `/api/paper/eq/candidates-diagnostic`, `/api/paper/eq/sizing-preview` all return 401/403 without an owner cookie.
- [ ] Public-mode share URL still gives read-only access to non-owner-gated pages — and only those pages.

### 4.4 Tests / typecheck green

- [ ] `pnpm run typecheck` (root, monorepo-wide) green.
- [ ] `pnpm --filter @workspace/api-server run test` green.
- [ ] `pnpm --filter @workspace/scanner run test` green (66/66 as of 2026-05-15).
- [ ] If you changed `lib/api-spec/openapi.yaml`, codegen was regenerated and committed.

### 4.5 Rollback plan acknowledged

- [ ] You have read Section 6 below before deploying.
- [ ] You know which previous deployment hash to roll back to (see Replit Deployments → previous successful release).
- [ ] You know how to disable the snapshot/candle ingestors via env without redeploying code.

---

## 5. Post-deployment smoke-test checklist

Run these in order immediately after the new deployment becomes "Promoted". Pause and investigate before declaring success if any step fails.

> Replace `$DOMAIN` with your production domain (e.g. `https://marketscannerbydev.in`). Owner-cookie endpoints require a logged-in browser session — the easiest way is to walk them in DevTools after signing in.

### 5.1 Public health

- [ ] **`GET $DOMAIN/api/healthz`** → `{ "status": "ok", ... }` with HTTP 200 within 2s.
- [ ] **`GET $DOMAIN/`** loads the public scanner shell without console errors.
- [ ] **`GET $DOMAIN/legal/disclaimer`** loads (legal pages bypass login).

### 5.2 Owner-only dashboards (logged in as owner)

- [ ] **`$DOMAIN/infra-health`** loads. Header roll-up badge shows OK or a known WARN. Each of the five sections renders without "Failed: …" text.
- [ ] **`GET $DOMAIN/api/option-snapshots/diagnostics`** → JSON. `config.enabled` matches your intended setting. If enabled, `coverage` lists NIFTY/BANKNIFTY/SENSEX with `latest_snapshot` within the last `OPTION_SNAPSHOT_INTERVAL_MIN × 2` minutes (during market hours).
- [ ] **`GET $DOMAIN/api/option-snapshots/analytics`** → JSON. `groupCount > 0` during market hours. Each group has finite `pcr`, `maxPainStrike`, `atmStrike`. `staleness.isStale` is `false`.
- [ ] **`GET $DOMAIN/api/candles/diagnostics`** → JSON. `config.enabled` matches your intended setting. `byInterval` populated.
- [ ] **`GET $DOMAIN/api/stocks-to-watch/diagnostics/sector-coverage`** → `lookup.sectorCoveragePct >= 95`. (100 ideal; 95-99 warn but acceptable.)
- [ ] **`GET $DOMAIN/api/paper/eq/candidates-diagnostic`** → JSON. `accountSnapshot.balance` and `openCount` reasonable.
- [ ] **`GET $DOMAIN/api/security/audit`** → `summary.fail === 0`. Specifically, the "Kite token encrypted at rest" check is OK (not the warn fallback).

### 5.3 Owner-only access behavior

- [ ] In an incognito window, **`$DOMAIN/infra-health`** redirects to login.
- [ ] In an incognito window, **`$DOMAIN/api/security/audit`** returns 401/403.
- [ ] As a logged-in non-owner subscriber (if you have such a test account), **`$DOMAIN/infra-health`** redirects or 403s.

### 5.4 Public-mode bypass safety

- [ ] Public-mode share URL renders the public scanner pages but does NOT expose `/admin`, `/infra-health`, `/audit`, `/status`, `/manifesto`, `/paper-trading`, `/paper-reports`, or `/kite`.
- [ ] No diagnostic endpoint returns data without an owner cookie.

### 5.5 Logs hygiene

- [ ] Tail production logs for 10 minutes. Confirm:
  - [ ] No log line contains a Kite access token (search for known prefix, or just visually scan; tokens are 32+ alphanumeric).
  - [ ] No log line contains `KITE_TOKEN_ENC_KEY` value.
  - [ ] No log line dumps `req.body` for the `/api/webhooks/tradingview` route.
  - [ ] No "plaintext fallback" warning from `kiteCrypto.ts` (means `KITE_TOKEN_ENC_KEY` is missing).
  - [ ] No "DECRYPT_FAILED" stack from `kiteCrypto.ts` (means key is wrong; the daily 06:00 IST login flow will recover, but something is misconfigured).

### 5.6 Trading surfaces (owner spot-check, no actions)

- [ ] **`$DOMAIN/paper-trading`** loads. `EnvironmentBanner` shows green ("Production · Live") if `PAPER_TRADING_ENABLED=true`.
- [ ] **`$DOMAIN/paper-reports`** loads with the closed-trade history.
- [ ] **`$DOMAIN/options/strategies/NIFTY`** returns the Recommended Plans bundle.
- [ ] No new trades have appeared from the deploy itself (auto-trader runs on its own cadence; check `paper_trade_fo.opened_at` timestamps for anything within the deploy window — a fresh open coincident with the deploy is suspicious only if outside market hours).

---

## 6. Rollback plan

These are listed in increasing order of disruption. Always try the least-disruptive option that resolves the issue.

### 6.1 Disable option-chain snapshot ingestion (no redeploy)

Symptom: snapshot writes are flooding the DB / Kite is being rate-limited / diagnostics show repeated failures.

```
# In Replit Deployments → Secrets:
OPTION_SNAPSHOT_ENABLED=false
```

Restart the deployment. Ingestor exits cleanly on next tick with `OPTION_SNAPSHOT_ENABLED is off`. Existing snapshot rows remain readable; analytics endpoint keeps working off the most-recent stored snapshot.

### 6.2 Disable candle warehouse ingestion (no redeploy)

Symptom: candle backfill is consuming Kite quota / DB I/O is too high / per-symbol stale list is growing unbounded.

```
CANDLE_WAREHOUSE_ENABLED=false
```

Restart the deployment. Ingestor exits cleanly with `CANDLE_WAREHOUSE_ENABLED is off`. Existing candle rows remain readable. Nothing else breaks — no scanner or signal path reads from the warehouse for trading decisions.

### 6.3 Bad `KITE_TOKEN_ENC_KEY` (key set but decrypt fails)

Symptom: server boots fine, but `kiteCrypto.ts` logs `DECRYPT_FAILED` for every read of `kite_session`. Kite features degrade to "session expired".

Recovery options, in order of preference:

1. **Fastest:** delete the row and let the next 06:00 IST login flow recreate it under the current key.
   ```sql
   DELETE FROM kite_session;
   ```
2. **If you still have the previous key:** set `KITE_TOKEN_ENC_KEY` back to the old value, restart, then run `pnpm --filter @workspace/api-server run rotate:kite-key -- --apply` per `docs/kite-token-enc-key-rotation.md` to migrate to the new key.
3. **If you can't wait until 06:00 IST and step 1 isn't acceptable:** manually trigger the OAuth login from the owner UI (`/login/zerodha`) after deleting the row.

### 6.4 Force a fresh Kite login

Useful any time the cached session is suspect (token leaked, decrypt failing, account got logged out on the Zerodha side).

```sql
DELETE FROM kite_session;
```

The daily scheduler picks up at the next 06:00 IST. To trigger immediately, log in as owner and use `/login/zerodha`.

### 6.5 Full deployment rollback (last resort)

Use only when env-level toggles can't recover the situation (e.g. a code regression that breaks health checks or signal generation).

1. **Replit Deployments → Releases** → pick the previous successful release → **Promote**.
2. The DB schema is forward-compatible with all priorities listed in Section 1: every Priority 2-10 table is additive (no `DROP`, no `ALTER` on legacy columns), so rolling code back does NOT require any DB migration.
3. After rollback, verify:
   - `GET $DOMAIN/api/healthz` → 200.
   - `paper_trade_fo` and `paper_trade_eq` open positions are intact (count + sum match pre-rollback).
   - The scheduler ticks log normally.
4. Open a post-mortem before re-attempting the deploy. Do not redeploy "fixed" code without re-running the full Section 4 + 5 checklists.

### 6.6 Credential rotation order (after a confirmed leak)

Per `replit.md` § "Security hygiene":

1. `KITE_API_SECRET` in Zerodha developer console.
2. `APP_ACCESS_PASSWORD`.
3. `SESSION_SECRET`.
4. Postgres password / `DATABASE_URL`.
5. `TRADINGVIEW_WEBHOOK_SECRET`.

The current `kite_session` row auto-dies at the next 06:00 IST or via `DELETE FROM kite_session;` (Section 6.4).

---

## 7. Production-readiness blockers found while writing this runbook

**None.** Every documented surface, env-var, endpoint, and rollback path matches code on disk as of commit `611afc2c` (the Priority 10 acceptance commit). No runtime code was modified to produce this document.

If a future deploy attempt surfaces a new blocker (e.g. an env-var rename, a removed endpoint, a schema change), append a dated note to Section 7 and update Sections 2 / 5 / 6 in the same commit so the runbook never drifts from reality.

---

## 8. Confirmation of scope discipline

This runbook adds:

- **One file:** `docs/production-readiness-2026-05-15.md` (this file).

This runbook does NOT change:

- F&O signal logic, F&O entry/exit logic.
- Swing scanner logic, swing scoring, recommendations.
- Paper trading execution (FO, EQ, or combo lanes).
- Kite order/execution logic.
- Strategy builder, combo lane.
- Scanner recommendation logic.
- Option snapshot ingestion (read-only documentation of existing behavior only).
- Candle warehouse ingestion (read-only documentation of existing behavior only).
- Database schema.
- Scheduler behavior.
- Any runtime TypeScript / TSX / SQL.

`pnpm run typecheck` and all test suites are unaffected because no `.ts` / `.tsx` / `.sql` file was modified.
