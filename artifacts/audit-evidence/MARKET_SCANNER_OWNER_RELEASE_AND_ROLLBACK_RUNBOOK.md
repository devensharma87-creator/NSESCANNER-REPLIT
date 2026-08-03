# Market Scanner — Owner Release and Rollback Runbook

**Audience:** System owner only  
**Last updated:** 2026-08-03  
**Applies to:** All artifacts (api-server · scanner · global)  
**Deployment platform:** Replit Autoscale

---

## 1. Pre-Deployment Checklist

Complete every item before clicking **Publish**.

### 1.1 Required secrets (Replit Secrets panel)

| Secret | Required | Notes |
|--------|----------|-------|
| `SESSION_SECRET` | ✅ MANDATORY | API server hard-fails at startup if absent. Use 32+ char random string. |
| `APP_ACCESS_PASSWORD` | ✅ MANDATORY | Owner login password. |
| `GLOBAL_APP_ACCESS_PASSWORD` | ✅ MANDATORY | Global app owner password. |
| `KITE_API_KEY` | ✅ MANDATORY | KiteConnect API key (from developers.kite.trade). |
| `KITE_API_SECRET` | ✅ MANDATORY | KiteConnect API secret. |
| `KITE_TOKEN_ENC_KEY` | ✅ MANDATORY | Encryption key for stored access token. 32+ chars. |
| `TELEGRAM_BOT_TOKEN` | Optional | Default bot for F&O/swing/urgent alerts. |
| `TELEGRAM_CHAT_ID` | Optional | Chat ID for default bot. |
| `PREPOST_TELEGRAM_BOT_TOKEN` | Optional | Separate bot for daily pre/post-market reports. |
| `PREPOST_TELEGRAM_CHAT_ID` | Optional | Chat ID for pre/post bot. |
| `TRADINGVIEW_WEBHOOK_SECRET` | Optional | HMAC secret for TradingView webhook validation. |

### 1.2 Critical environment variables

| Variable | Safe value | Never set to |
|----------|-----------|--------------|
| `CORS_ORIGINS` | Specific domain or unset (same-origin) | `*` in production (hard-fail at startup) |
| `SWING_CASH_EXECUTION_MODE` | Unset or `paper_only` | `live_cash` without explicit owner review |
| `LIVE_CASH_SWING_ORDER_ENABLED` | Unset (defaults `false`) | `true` (no real-order code exists anyway, but belt-and-suspenders) |
| `NODE_ENV` | `production` | Any other value in live deployment |

### 1.3 Database state

- Dev DB schema changes propagate to prod on first Publish (Replit introspects the diff).
- For additive columns only: `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` was used. Drizzle-kit push does NOT run destructively on live tables declared in the schema.
- If deploying after a long gap: run `pnpm --filter @workspace/db exec drizzle-kit push` in dev and verify no DROP statements appear before confirming.

### 1.4 Final code verification

```bash
# From workspace root — all must return exit 0:
pnpm --filter @workspace/api-server exec tsc --noEmit
pnpm --filter @workspace/scanner exec tsc --noEmit
pnpm --filter @workspace/global exec tsc --noEmit
pnpm --filter @workspace/api-server exec vitest run --pool=threads   # must show 5117 passed
pnpm --filter @workspace/scanner exec vitest run                      # must show 947 passed
```

---

## 2. Deployment Procedure

### 2.1 Standard publish

1. Ensure all workflows are running and healthy (no crash-loop in logs).
2. In the Replit workspace, click **Publish** → confirm.
3. Wait for the build to complete (typically 2–4 minutes).
4. Note the production URL from the deployment confirmation screen.
5. Run the post-deploy smoke test (§3).

### 2.2 What Replit Publish does

- Builds all artifacts (api-server, scanner, global) in production mode.
- Applies any dev→prod DB schema diff (additive columns only; destructive changes blocked by schema declarations).
- Replaces the running production instance via zero-downtime swap.
- New instance boots with production env vars from Replit Secrets.

### 2.3 First-time cold-start note

The first request after a cold autoscale start may return a transient 500. This is a known platform cold-start behaviour — retry once before treating it as a regression. See memory file `autoscale-coldstart-500.md`.

---

## 3. Post-Deploy Smoke Test

Run immediately after every publish. All steps require the production URL.

```bash
PROD_URL="https://<your-repl-slug>.replit.app"  # Get from Replit deployment page

# 3.1 Health check — must return HTTP 200 with {"status":"ok"}
curl -sf "$PROD_URL/api/system/health" | jq .

# 3.2 Auth required — must return HTTP 401 (not 500, not HTML)
curl -sf -w "\nHTTP %{http_code}\n" "$PROD_URL/api/swing/status"

# 3.3 Build info — verifies the right commit is live
curl -sf "$PROD_URL/api/system/build-info" | jq .commit

# 3.4 Public asset — verify SPA is served
curl -sI "$PROD_URL/" | grep "HTTP/"

# 3.5 Rate limit check — verify API limiter responds (not 500)
curl -sf -w "HTTP %{http_code}\n" "$PROD_URL/api/fno/diagnostics"
# Expected: 401 (auth required) — NOT 500 or HTML
```

### 3.6 Functional smoke test (authenticated)

Log in to the scanner UI at `$PROD_URL` with your `APP_ACCESS_PASSWORD`. Verify:

- [ ] Market data loads on the scanner home page (or shows an honest "no data" state if outside market hours)
- [ ] F&O page shows a diagnostics summary (not an error screen)
- [ ] Swing Cash page shows `paper_only` mode in the execution banner
- [ ] No red error banners on the portfolio/home page for reasons OTHER than missing Kite session

---

## 4. Rollback Procedure

### 4.1 When to rollback

Rollback if, after deployment:
- API server does not start (startup exception in logs)
- More than 3% of authenticated API requests return 500 (check deployment logs)
- DB migrations applied destructively (tables dropped unexpectedly)
- Broker order flow is unexpectedly active (should NEVER happen — brokerExecutionEnabled is always false)

### 4.2 Rollback via Replit Checkpoints

1. In the Replit workspace, open the **Checkpoints** panel.
2. Find the checkpoint corresponding to the last known-good commit.
3. Click **Restore** on that checkpoint.
4. After restore, verify the workspace compiles (`tsc --noEmit` passes).
5. **Publish** the restored checkpoint.

### 4.3 Safe rollback commit reference

The canonical pre-Pack-4 safe baseline is commit `141d3c8` (Pack 3 closure). All commits on `main` after Pack 3 acceptance are Pack 4 additions only (test files + evidence files — no production code changes).

**Pack 4 adds ZERO production source changes.** All 6 new test files are in `src/lib/p22.*.test.ts`. The evidence files are in `artifacts/audit-evidence/`. Rolling back Pack 4 is therefore low-risk (just removes test coverage, not production logic).

### 4.4 Emergency: disable Kite session without rollback

If the Kite session causes issues (bad token, API abuse):

```bash
# Via authenticated API call (owner cookie required):
curl -X POST "$PROD_URL/api/kite/invalidate-session" \
  -H "Cookie: scanner_session=<your-owner-cookie>"
```

Or: delete the `kite_sessions` table row directly via the production database tool in Replit.

### 4.5 Emergency: kill swing execution

The kill-switch is accessible in the UI (Swing Cash page → Kill Switch toggle) or via API:

```bash
curl -X POST "$PROD_URL/api/swing/kill-switch" \
  -H "Cookie: scanner_session=<your-owner-cookie>" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "reason": "Emergency stop"}'
```

This sets `killSwitchEnabled = true` in the DB, blocking all new swing order staging approvals. Existing open positions are NOT affected (no automated closure).

---

## 5. Monitoring and Alerts

### 5.1 Telegram alerts

- **Default bot** (`TELEGRAM_BOT_TOKEN`): F&O entries/exits, swing lifecycle, urgent system alerts (Kite session lost, data-health failures).
- **Pre/post bot** (`PREPOST_TELEGRAM_BOT_TOKEN`): Daily market summary reports (pre-open + post-close).
- Both bots use DB-backed dedup to prevent duplicate alerts across autoscale restarts.

### 5.2 Checking production logs

In Replit: **Deployments** → select the current deployment → **Logs** tab.

Key patterns to watch:
```
# Healthy startup sequence:
"SESSION_SECRET present"
"DB connection established"
"Kite instruments loaded: N instruments"
"Boot scheduler registered"

# Warning patterns:
"HARD_STALE" — market data is more than the freshness budget old
"DATA_BLOCKED" — provider unavailable (check Kite session)
"Telegram alert failed" — check bot token

# Critical patterns (require action):
"SESSION_SECRET env var is required" — secret missing → app won't start
"CORS_ORIGINS=* is not allowed in production" — env var set wrong
"unhandledRejection" — uncaught promise rejection
```

### 5.3 Read-only production DB queries

Via Replit's built-in database tool with `environment: "production"`:

```sql
-- Check recent paper trades
SELECT status, COUNT(*) FROM paper_trades_fo GROUP BY status;
SELECT status, COUNT(*) FROM paper_trade_eq GROUP BY status;

-- Check Kite session
SELECT created_at, expires_at FROM kite_sessions ORDER BY created_at DESC LIMIT 1;

-- Check recent system alerts
SELECT alert_key, fired_at FROM system_alert_state ORDER BY fired_at DESC LIMIT 10;
```

---

## 6. Known Constraints and Design Decisions

| Constraint | Detail |
|-----------|--------|
| Broker execution | `brokerExecutionEnabled` is always `false` in code — no real order is ever placed regardless of env vars |
| Swing paper only | All approved swing orders go to `paper_trade_eq` — no broker integration wired |
| F&O paper only | F&O trades via KiteConnect API are read-only (option chain, OI) — paper positions only |
| Yahoo Finance | Used as labeled secondary data source only; never drives signals or paper trades |
| Public-access mode | When enabled, anonymous visitors can read owner-only data tabs (paper trades, positions) — mutations still require auth |
| Production read-replica lag | Production DB reads may lag fresh writes by minutes (autoscale replica); re-query before concluding a write failed |

---

## 7. Architecture Quick Reference

```
artifacts/
  api-server/     — Express API (Node.js, Drizzle ORM, PostgreSQL)
  scanner/        — React SPA (Vite, React Query, Tanstack Router)
  global/         — Global multi-asset scanner SPA

lib/
  db/             — Drizzle schema + migrations (shared)
  api-zod/        — Zod schemas (source of truth for API shapes)
  api-client-react/ — Generated React Query hooks
```

**Port assignment:** Each artifact reads `PORT` from env (Replit assigns unique ports). Hard-coded ports cause blank previews.

**Session cookie:** `scanner_session` — signed (`s:value.hmac`), `httpOnly`, `secure` (prod), `sameSite=lax`.

**Auth model:**
- Owner: password login → signed cookie value `"owner"` → `requireOwner` / `requireOwnerStrict`
- Subscriber: DB-registered user → signed cookie value `"u:<userId>"` → `requireSubscriberOrOwner`
- Anonymous: no cookie → 401 (or 200 for read-only routes in public-access mode)

---

---

## 8. Runtime Release-Boundary Verification (Prompt 22A — 2026-08-03)

The following runtime gates were closed as part of the final release-boundary closure.
All checks are automated (vitest + spawnSync probes + sentinel build grep).

### 8.1 Automated gate summary

| Gate | What it proves | Test file |
|------|---------------|-----------|
| G1 (D12 fix) | Auth boundary: getUserById null/missing/disabled → 401 not 500 | p22a.d12Auth.test.ts (23 tests) |
| G2 | Input/routing boundaries: 400 / 413 / 404 / sanitized 500 / CORS / CSP | p22a.runtimeBoundaries.test.ts (21 tests) |
| G3 | Config startup rejection: missing SESSION_SECRET; CORS=* in prod | p22a.configRejection.test.ts (17 tests) |
| G4 | Sentinel build scan: zero secret leaks in JS/CSS/HTML output | Build grep (manual CI step) |
| G5 | Broker hard-block matrix: all LIVE_CASH / execution-mode combinations | p22a.brokerHardBlock.test.ts (28 tests) |
| G6 | Scheduler/cache runtime: scan cache contract; sweep tick idempotency | p22a.schedulerCache.test.ts (13 tests) |
| G7 | Owner journeys J1–J4: read / F&O safety / swing safety / failure paths | p22a.ownerJourneys.test.ts (24 tests) |

### 8.2 Re-running the runtime gates

```bash
# Run all 6 new p22a gate test files (takes ~30–60s)
pnpm --filter @workspace/api-server exec vitest run --pool=threads "src/lib/p22a\."
# Expected: 6 test files, 126 tests, 0 failures

# Re-run full api-server suite (takes ~2min)
pnpm --filter @workspace/api-server exec vitest run --pool=threads
# Expected: 5,243 tests, 0 failures

# Re-run sentinel build check
SESSION_SECRET=SENTINEL_SESS_SECRET_XQ99 APP_ACCESS_PASSWORD=SENTINEL_APP_PASS_RZ44 \
  KITE_API_SECRET=SENTINEL_KITE_SECRET_PW77 KITE_TOKEN_ENC_KEY=SENTINEL_ENC_KEY_MM33 \
  TELEGRAM_BOT_TOKEN=SENTINEL_TG_BOT_HH11 DATABASE_URL=SENTINEL_DB_URL_YY88 \
  VITE_API_BASE_URL=/scanner pnpm --filter @workspace/scanner run build
grep -r "SENTINEL_" artifacts/scanner/dist/    # expect 0 lines

SESSION_SECRET=SENTINEL_SESS_SECRET_XQ99 APP_ACCESS_PASSWORD=SENTINEL_APP_PASS_RZ44 \
  KITE_API_SECRET=SENTINEL_KITE_SECRET_PW77 KITE_TOKEN_ENC_KEY=SENTINEL_ENC_KEY_MM33 \
  TELEGRAM_BOT_TOKEN=SENTINEL_TG_BOT_HH11 DATABASE_URL=SENTINEL_DB_URL_YY88 \
  VITE_API_BASE_URL=/global pnpm --filter @workspace/global run build
grep -r "SENTINEL_" artifacts/global/dist/     # expect 0 lines
```

### 8.3 D12 auth boundary production note

`GET /api/user/me` uses `getUserById` which calls `db.select().from(usersTable).where(…).limit(1)`.
If the DB row is missing or the user is disabled, the route returns **401 AUTH_REQUIRED** (not 500).
This was a regression in Pack 4 (the mock lacked `db.select`) — confirmed fixed and tested in G1.

---

END_MARKET_SCANNER_OWNER_RELEASE_AND_ROLLBACK_RUNBOOK
