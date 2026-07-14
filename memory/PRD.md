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
