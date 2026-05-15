# Final Deployment Verification Execution Plan

**Date:** 2026-05-15
**Companion to:** [`docs/production-readiness-2026-05-15.md`](./production-readiness-2026-05-15.md) (P11 runbook)
**Scope:** planning/checklist only — no runtime, trading, ingestion, scheduler, or schema code is changed by this document.

---

## How to use this plan

This is the **execution sequence** for verifying a production deployment. The companion P11 runbook is the **reference manual** (env-var meanings, why-this-matters context, full command examples). This file is the linear walk-through you tick off in real time.

Walk Phase A → B → C → D in order. Stop and consult Phase E if any check fails.

---

## Phase A — Pre-deploy verification (do these BEFORE clicking Deploy)

| # | Check | Command / Where | Pass criteria | Status |
|---|---|---|---|---|
| A1 | All required secrets configured | Replit Deployments → Secrets pane | Every var in P11 §2.1 is present and non-empty: `DATABASE_URL`, `SESSION_SECRET`, `APP_ACCESS_PASSWORD`, `KITE_API_KEY`, `KITE_API_SECRET`, `KITE_TOKEN_ENC_KEY`, `TRADINGVIEW_WEBHOOK_SECRET` | ☐ |
| A2 | `KITE_TOKEN_ENC_KEY` configured | Replit Secrets | Present, decoded length = 32 bytes (base64 or hex). | ☐ |
| A3 | Kite encryption-at-rest verified (dev) | `GET /api/security/audit` (owner cookie, dev) | "Kite token encrypted at rest" check status = `ok` (NOT the plaintext-fallback warn). | ☐ |
| A4 | `APP_ACCESS_PASSWORD` rotation status | Operator log / password manager | If recently rotated, the new value is mirrored to dev. If never rotated and the previous value has been in use >90 days, **rotate now** before deploy. | ☐ |
| A5 | `SESSION_SECRET` rotation status | Operator log | Same rule as A4. Rotating invalidates all existing sessions — users will be re-prompted to log in. Acceptable if planned. | ☐ |
| A6 | `KITE_API_SECRET` rotation status confirmed | Zerodha developer console + Replit Secrets | If rotated in Zerodha console, the new value is also in Replit Secrets. The two MUST match or the daily 06:00 IST login flow 503s. | ☐ |
| A7 | `KITE_MIRROR_ALLOWED_HOSTS` configured (if dev mirror is used) | Replit Secrets | Set explicitly to the production domain (e.g. `marketscannerbydev.in`). Do NOT rely on the dev-default that includes `localhost,127.0.0.1`. If you do not use the dev mirror at all, this can stay unset. | ☐ |
| A8 | Option snapshot scheduler intent | Replit Secrets | `OPTION_SNAPSHOT_ENABLED` is set EXPLICITLY to `true` or `false` per intent. Do not rely on auto-detect for production. | ☐ |
| A9 | Candle warehouse scheduler intent | Replit Secrets | `CANDLE_WAREHOUSE_ENABLED` is set EXPLICITLY to `true` or `false` per intent. | ☐ |
| A10 | Safe DB export process confirmed | Operator habit | Any local DB dumps used `scripts/safe-db-export.sh` (excludes `kite_session`, scrubs `users.password_hash` and `global_screener_presets.share_token`). No raw `pg_dump` was shared. | ☐ |
| A11 | No plaintext tokens leaked | `git --no-optional-locks log -p \| grep -iE "(access_token\|api_secret\|password)"` (spot-check), Replit chat history | No commit, screenshot, support ticket, or chat message exposes a Kite token, secret, or password. | ☐ |
| A12 | Owner-only diagnostic routes still gated (dev) | Incognito browser → `/api/security/audit` | Returns 401/403 without an owner cookie. | ☐ |
| A13 | `/infra-health` owner-only (dev) | Incognito browser → `/infra-health` | Redirects to login. | ☐ |
| A14 | Typecheck + tests green | `pnpm run typecheck && pnpm --filter @workspace/api-server run test && pnpm --filter @workspace/scanner run test` | All three exit 0. Scanner: 66/66. | ☐ |

**If any A-row is ☐ unticked, do not deploy.** Resolve the row first.

---

## Phase B — Deploy

1. Replit Deployments → **Promote** (or `git push` to trigger autoscale build).
2. Wait for build to finish. Note the new release hash.
3. Confirm previous release hash is still listed in the Releases history (you'll need it for B-rollback).

---

## Phase C — Post-deploy smoke tests (logged in as owner, against `$DOMAIN`)

Replace `$DOMAIN` with your production URL (e.g. `https://marketscannerbydev.in`).

| # | Endpoint | Pass criteria | What's a warning | What's a blocker (rollback) |
|---|---|---|---|---|
| C1 | `GET $DOMAIN/api/healthz` (no cookie) | HTTP 200, `{ "status": "ok" }` within 2s. | response > 2s | non-200, server unreachable |
| C2 | `$DOMAIN/infra-health` (owner browser) | Page loads, header roll-up badge = OK or WARN. All 5 sections render without "Failed: …" text. | header badge = WARN with reason known + accepted | header badge = FAIL on Security or Snapshot section; any section shows "Failed: …" persistently |
| C3 | `GET $DOMAIN/api/option-snapshots/diagnostics` | HTTP 200. `config.enabled` matches Phase A8 intent. If enabled and during market hours: `coverage` lists NIFTY/BANKNIFTY/SENSEX with `latest_snapshot` within `OPTION_SNAPSHOT_INTERVAL_MIN × 2` minutes (default 10 min). | latest_snapshot 10-30 min stale (Kite hiccup) | latest_snapshot >30 min stale during market hours; `config.enabled` ≠ Phase A8 intent |
| C4 | `GET $DOMAIN/api/option-snapshots/analytics` | HTTP 200. During market hours: `groupCount > 0`, each group has finite `pcr`, `maxPainStrike`, `atmStrike`. `staleness.isStale === false` for at least the top group per underlying. | one group `isStale === true` | endpoint 500s; all groups stale; PCR/maxPain `null` across all groups |
| C5 | `GET $DOMAIN/api/candles/diagnostics` | HTTP 200. `config.enabled` matches Phase A9 intent. `byInterval` populated if enabled. | `perSymbolStaleTop100` non-empty (acceptable backfill churn) | `config.enabled` ≠ Phase A9 intent; endpoint 500s |
| C6 | `GET $DOMAIN/api/stocks-to-watch/diagnostics/sector-coverage` | HTTP 200. `lookup.sectorCoveragePct >= 95` (100 ideal, per P11 §5.2). | 95-99% coverage | <95% coverage; endpoint 500s |
| C7 | `GET $DOMAIN/api/paper/eq/candidates-diagnostic` | HTTP 200. `accountSnapshot.balance` reasonable. `accountSnapshot.openCount` matches what you expected pre-deploy. | `acceptedCount === 0` outside market hours (normal); DD warn flags within configured caps | endpoint 500s; `accountSnapshot.balance` zero/null; openCount differs by >1 from pre-deploy snapshot (would suggest auto-trader fired during deploy) |
| C8 | Owner-only access — incognito | `$DOMAIN/infra-health`, `$DOMAIN/api/security/audit`, `$DOMAIN/api/option-snapshots/diagnostics` (no cookie) | All redirect to login or return 401/403. | — | any returns 200 with diagnostic data |
| C9 | Public-mode share URL | Open share URL in fresh browser (no owner cookie) | Public scanner pages render. `/infra-health`, `/admin`, `/audit`, `/status`, `/manifesto`, `/paper-trading`, `/paper-reports`, `/kite` are NOT linked from nav and return 401/403/redirect when typed directly. | — | any owner-only path is reachable from public mode |
| C10 | Logs hygiene (10-min tail) | Replit Deployments → Logs | No log line contains a Kite access token, no `KITE_TOKEN_ENC_KEY` value, no `req.body` dump for `/api/webhooks/tradingview`. | sporadic Yahoo fallback warns | "plaintext fallback" warn from `kiteCrypto.ts`; `DECRYPT_FAILED` stack; any token-shaped string in logs |

**If C2-C10 all green** (or only have entries in the "warning" column), the deploy is verified.

---

## Phase D — Trading-surface spot-check (owner, no actions taken)

| # | Surface | Pass criteria | Blocker |
|---|---|---|---|
| D1 | `$DOMAIN/paper-trading` | Loads. `EnvironmentBanner` is GREEN ("Production · Live") if `PAPER_TRADING_ENABLED=true`. | Banner amber when production should be live; page shows new auto-opens timestamped during the deploy window outside market hours |
| D2 | `$DOMAIN/paper-reports` | Loads with closed-trade history. | 500 / blank |
| D3 | `$DOMAIN/options/strategies/NIFTY` | Returns Recommended Plans bundle. | empty / 500 |
| D4 | `paper_trade_fo` open positions count | `SELECT COUNT(*) FROM paper_trade_fo WHERE status='OPEN';` | Matches pre-deploy snapshot ± actions you took. | Differs by >1 from pre-deploy snapshot with no explanatory market-hours opens between deploy start and now |

---

## Phase E — Rollback triggers and actions

Map each trigger to the **smallest** action that resolves it. Always try lower-numbered actions first.

| Trigger | Symptom | Smallest action | If that fails | Reference |
|---|---|---|---|---|
| **Kite decrypt failure** | C2 shows persistent `DECRYPT_FAILED` in security card; logs show repeated `DECRYPT_FAILED` from `kiteCrypto.ts`; Kite features show "session expired" | `DELETE FROM kite_session;` and let next 06:00 IST recreate, OR trigger `/login/zerodha` from owner UI | If you still have the old key: temporarily restore old `KITE_TOKEN_ENC_KEY`, then run `pnpm --filter @workspace/api-server run rotate:kite-key -- --apply` per `docs/kite-token-enc-key-rotation.md` | P11 §6.3 |
| **Owner-only route exposure** | C8 returns 200 + diagnostic data without owner cookie, OR C9 shows owner pages reachable from public mode | **Roll back deployment immediately** (Phase E action 5). Open a post-mortem before next attempt. | — | P11 §6.5 |
| **Plaintext token found** | C10 surfaces a Kite token in logs / DB dump / chat | (a) Roll back if the token leaked publicly. (b) Rotate per the credential order in P11 §6.6 (`KITE_API_SECRET` → `APP_ACCESS_PASSWORD` → `SESSION_SECRET` → DB password → `TRADINGVIEW_WEBHOOK_SECRET`). (c) `DELETE FROM kite_session;` to kill the leaked session. | — | P11 §6.4, §6.6 |
| **Scheduler overload** (snapshot) | C3 shows snapshot writes flooding / Kite rate-limited / repeated diag failures | Set `OPTION_SNAPSHOT_ENABLED=false` in Replit Secrets and restart deployment. Existing rows remain readable. | — | P11 §6.1 |
| **Scheduler overload** (candle) | C5 shows candle backfill consuming Kite quota / DB I/O too high / per-symbol stale list growing unbounded | Set `CANDLE_WAREHOUSE_ENABLED=false` in Replit Secrets and restart. | — | P11 §6.2 |
| **Failing health check / DB errors** | C1 returns non-200 or times out; deployment marked unhealthy by autoscaler; OR repeated "Failed query" warnings in logs with `paper_trade_eq` / `paper_trade_fo` writes silently skipping (the 2026-05-13 paperAccount.ts column-name gotcha pattern) | If `DATABASE_URL` is wrong: fix secret + restart. If a recent code deploy caused it: roll back deployment (Phase E action 5). | If schema drift suspected: stop, do not push schema, escalate. | P11 §6.5, replit.md "Gotchas" |
| **Unexpected trading behavior** | D4 shows phantom opens, OR `/paper-trading` shows trades you did not authorize, OR auto-trader opens outside market hours | (a) Set `PAPER_TRADING_ENABLED=false` and restart to halt auto-trader (manual buys/closes still work). (b) Roll back deployment. (c) Audit `paper_trade_fo`/`paper_trade_eq` for the offending rows; close manually if needed. | Escalate before redeploying. | P11 §6.5, replit.md "Cross-cutting" |

### Rollback actions (in order of disruption)

1. **Disable option snapshots** — set `OPTION_SNAPSHOT_ENABLED=false` + restart. No data loss.
2. **Disable candle warehouse** — set `CANDLE_WAREHOUSE_ENABLED=false` + restart. No data loss.
3. **Force fresh Kite login** — `DELETE FROM kite_session;` Next 06:00 IST or manual `/login/zerodha` recreates the row under the current encryption key.
4. **Disable paper auto-trader** — set `PAPER_TRADING_ENABLED=false` + restart. Manual buys/closes still work.
5. **Revert deployment** — Replit Deployments → Releases → previous successful release → Promote. Schema is forward-compatible with all P1-P10 work (every new table is additive), so no migration is needed for the rollback. Verify C1 + D4 immediately after.
6. **Rotate credentials** (only if leak suspected) — order: `KITE_API_SECRET` (Zerodha console) → `APP_ACCESS_PASSWORD` → `SESSION_SECRET` → `DATABASE_URL` → `TRADINGVIEW_WEBHOOK_SECRET`. Then `DELETE FROM kite_session;`.

---

## Phase F — Manual actions remaining for the operator

These are the things only **you** can do (Agent cannot execute them):

1. **Phase A1-A10** — confirm secrets in the Replit Deployments UI. Agent cannot read secret values.
2. **Phase B** — click Promote in the Replit Deployments UI. Agent cannot push deployments.
3. **Phase C8-C9** — perform the incognito-browser owner-only access verification. Agent cannot maintain a separate browser session.
4. **Phase C10** — tail production logs in the Replit UI for 10 minutes.
5. **Phase D1-D4** — visually verify trading surfaces and run the SQL count for D4 (Agent has DB query access via the database skill if you want this delegated, but you should eyeball the result).
6. **Phase E rollback** — trigger any rollback action via Replit UI / Secrets pane. Agent can advise but cannot click Promote.
7. **Credential rotation** (if Phase E action 6 needed) — rotate `KITE_API_SECRET` in the Zerodha developer console (external system, no Agent access).

---

## Confirmation of scope discipline

This plan adds:

- **One file:** `docs/deployment-verification-plan-2026-05-15.md` (this file).

This plan changes **nothing else**. Specifically, no modifications were made to:

- F&O signal logic, F&O entry/exit logic.
- Swing scanner logic, swing scoring/recommendations.
- Paper trading execution (FO, EQ, or combo lanes).
- Kite order/execution logic.
- Strategy builder.
- Combo lane.
- Scanner recommendation logic.
- Option snapshot ingestion.
- Candle warehouse ingestion.
- Database schema.
- Scheduler behavior.
- Any runtime TypeScript / TSX / SQL.
- The P11 runbook (`docs/production-readiness-2026-05-15.md`) — no factual errors were found that required edits.

`pnpm run typecheck` and all test suites are unaffected because no `.ts` / `.tsx` / `.sql` file was modified.
