# MarketScanner (Hrishi Associates) — PRD / Working Memory

## Original Problem Statement (2026-07-13)
"Master Fix File · Zero-Compromise Edition" — take a 6-month build to production grade:
zero non-Kite data in decision paths, Quality envelopes on every number, SystemMode
(NORMAL/DEGRADED/READ_ONLY/HALT), KiteGateway hardening, StateBus, tab-by-tab audit,
F&O engine upgrade, swing engine preserved (61.3% WR / 5.05 PF regression gate),
live auto-trading (OMS + 12-check LiveOrderGuard), Telegram bot, observability,
testing/deploy hardening, security, UI polish. Full spec (BUG-27..106, Sections A–P)
in the first user message; prior bugs BUG-00..26 belong to the repo's own audit docs.

## Key facts / decisions
- Codebase imported from https://github.com/devensharma87-creator/NSESCANNER-REPLIT (2026-07-13).
- ACTUAL STACK (differs from fix-file assumption): TypeScript pnpm monorepo —
  Express 5 api-server (`/app/artifacts/api-server`), React 19 + Vite scanner
  (`/app/artifacts/scanner`), Drizzle ORM + PostgreSQL, workspace libs in `/app/lib/*`.
  NOT FastAPI/Mongo. Stack retained to preserve the swing engine as-is.
- User wants final hosting on own domain https://marketscannerbydev.in/ (link at deploy time via Entri).
- User approved: clock-drift detection via HTTP time API (not real NTP), /metrics Prometheus
  endpoint, IST for business logic / UTC for storage.
- Scope: "push as far as possible without stopping" through fix-file phases.

## Environment wiring (IMPORTANT — non-standard)
- supervisor `backend` (read-only conf) = uvicorn :8001 running `/app/backend/server.py`
  which is ONLY a reverse-proxy shim → Node api-server on 127.0.0.1:8055.
- supervisor `apiserver` (custom conf `/etc/supervisor/conf.d/nse-stack.conf`) =
  `/app/scripts/env/run_apiserver.sh` → esbuild build + node dist/index.mjs, PORT=8055.
  Restart THIS (not `backend`) after backend code changes.
- supervisor `postgresql` = `/app/scripts/env/run_postgres.sh` — self-healing: reinstalls
  postgres via apt if the container was recycled; PGDATA persisted at `/app/.pgdata`
  (db=nsescanner, user=nse, pw=nse_secure_2026). Schema via
  `cd /app/lib/db && ./node_modules/.bin/drizzle-kit push --config ./drizzle.config.ts`
  (NEVER unguarded --force push against a DB with data; see replit.md warning about drops).
- supervisor `frontend` = yarn start in /app/frontend → launcher that execs Vite in
  /app/artifacts/scanner on :3000 (PORT env; allowedHosts already true).
- All app env vars in `/app/backend/.env` (sourced by run_apiserver.sh):
  DATABASE_URL, SESSION_SECRET, APP_ACCESS_PASSWORD=HrishiAdmin@2026,
  GLOBAL_APP_ACCESS_PASSWORD=HrishiGlobal@2026, TRADINGVIEW_WEBHOOK_SECRET,
  KITE_TOKEN_ENC_KEY, PAPER_TRADING_ENABLED=true, NODE_ENV=development.
- Ports in use by platform (do NOT bind): 8010 (plugins agent), 8020 (mongo-mcp), 1111, 27017.
- Node is v20 (repo prefers 24; yahoo-finance2 warns needing >=22 — works, warning only).

## Pending credentials (BLOCKERS for live-data work)
- KITE_API_KEY / KITE_API_SECRET (+ daily access token via /api/kite/login-url flow;
  Kite app redirect URL must be set to `<domain>/api/kite/callback`).
  Alternative: POST /api/kite/import-session (export from old prod deployment).
- TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID (+ optional PREPOST_* pair).

## What's been implemented (dates)
- 2026-07-13/14: Full environment migration + self-healing infra (postgres bootstrap,
  proxy shim, supervisor programs, schema push). App verified: admin login, Home tab
  with Yahoo-fallback display data + honest source labels, KITE OFFLINE banner correct.
- 2026-07-14: Secrets Vault (owner-only, requireOwnerStrict): page /secrets-vault +
  routes /api/secrets-vault/status|set. Writes env file, restarts apiserver via clean
  process.exit → supervisor autorestart. Verified full cycle incl. masking, chmod 600,
  clearing keys, anonymous 401.
- 2026-07-14 (later): Phase 1 continuation — BUG-30/31/35 + Phase-2 SENSEX:
  * BUG-30 lib/marketData/stalenessWatchdog.ts (guard-exempt layer): age-based (90s)
    per-token staleness every 15s during market hours; resubscribe nudge (5min cooldown);
    >5% stale → Telegram + SystemMode DEGRADED driver TOKEN_STALENESS_OVER_5PCT.
  * BUG-35 lib/marketData/instrumentsIntegrity.ts: daily 08:00–09:20 IST window,
    forceRefreshInstruments + diff FNO subset (NIFTY/BANKNIFTY/SENSEX, lot/tick/name)
    vs baseline /app/.cache/instruments_baseline.json; changes → Telegram; failure →
    sticky app_state flag instruments_refresh_failed_<date> → SystemMode DEGRADED
    (auto-opens blocked for the day). Verified live (baseline written, result OK).
  * BUG-31 lib/eodReconciliation.ts: raw-SQL table reconciliation_report (ist_date
    unique); runs ≥15:35 IST via app_state claim eod_recon_<date>; checks:
    FO_OPEN_AFTER_CLOSE, FO/EQ_CLOSED_MISSING_PNL, ACCOUNT_DAY_PNL (FNO, ±₹1),
    ACCOUNT_OPEN_COUNT per segment; Telegram OK/MISMATCH; live recon N/A note.
    Routes: GET /api/system/reconciliation, POST .../run (force). Verified live (OK).
  * /api/system/mode now also returns tokenStaleness + instrumentsIntegrity; /metrics
    adds tokens_tracked/stale/stale_pct + instruments_refresh_failed_today gauges.
  * UI: ReconciliationPanel + watchdog row in SystemModePanel on /infra-health
    (testids: section-eod-reconciliation, recon-check-*, recon-run-btn, watchdog-row).
  * Phase 2 finding: option chain ALREADY has bid/ask, greeks, IV, intrinsic/timeValue,
    per-strike PCR, max pain, provenance meta, ATM tools — verified SENSEX live via
    Kite (spot 77k, 166 rows, BFO). Only gap fixed: SENSEX added to QUICK_PRESETS.
  * Testing agent iteration_2: 100% pass (9/9 backend + frontend). Minor optional:
    request backoff on 429 boot storm; data-testids on quick presets.
- 2026-07-14: Fix-file Phase 1 increment (BUG-28/29/89):
  * SystemMode state machine — lib/systemMode.ts (pure derive: session invalid→READ_ONLY,
    WS down>30s @open→DEGRADED, DB>500ms/failed→DEGRADED; worst-of with manual override
    persisted in app_state `system_mode_override`; 10s monitor; Telegram on transitions).
    Enforcement: paperAutoTradeFlag.isPaperAutoTradingEnabled() false unless NORMAL
    (via dependency-free systemModeCache, default NORMAL — boot/test safe). Override
    can NEVER downgrade a derived problem.
  * Clock-drift DETECTION — lib/clockDrift.ts (hourly; worldtimeapi → google Date-header
    fallback; OK≤500ms WARN≤1000ms ALERT>1000ms→Telegram; explicitly NOT NTP sync).
  * routes/systemStatus.ts: GET /api/system/mode, POST /api/system/mode-override
    (ownerStrict), POST /api/system/clock-drift/check, GET /api/metrics (Prometheus;
    Bearer METRICS_TOKEN or owner cookie; anonymous 401).
  * SystemModePanel on /infra-health (badge, drivers, override buttons, drift chip);
    testids: section-system-mode, system-mode-badge, mode-override-*.
  * Fixed 2 PRE-EXISTING repo test failures: missing CHECK constraint on
    option_signal_plan_audit (fresh DB lacked raw-SQL constraint) + options.tsx pre-open
    copy. ALL 3359 api-server + 779 scanner tests green; typecheck green.

## Prioritized backlog (fix-file phases)
- P0 Phase 1: Data Integrity Constitution (BUG-27..35, 41..43, 88, 89, 91) —
  note: repo ALREADY has much of this (source-honesty contract, trusted layer,
  provider import guard, DataMeta). Audit-first, then close gaps.
- P0: Kite credentials + session → live data verification.
- P1 Phase 2: SENSEX & option chain (BUG-36,37,44,46-52).
- P1 Phase 3: F&O signal correctness (BUG-53,54,72-80).
- P1 Phase 4: Telegram bot commands + priority tiers (BUG-85-87).
- P2 Phase 5-6: tab polish, reconciliation, portfolio.
- P2 Phase 7: Live auto-trading (Section G) — needs Kite + prolonged observation.
- P3 Phase 8-9: replay harness, canary, AI sentiment.

## Notes for next session
- Read `/app/replit.md` + `/app/docs/*` before touching signal code: repo has strict
  invariants (swing engine untouchable, fail-closed guards, drizzle push warnings).
- Existing audit registers: FULL_PLATFORM_BUG_REGISTER.csv, MASTER_QUANT_BUG_REGISTER_2026_07_09.csv
  overlap heavily with the user's fix file — cross-reference before implementing.
