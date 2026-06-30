# AGENT START HERE

**Read this first. ~2 min. Saves hours of codebase scanning.**

---

## What This Project Is

**NSE Stock Screener / Hrishiassociates** — Indian stock market analytics and trading website at `marketscannerbydev.in`.

Core capabilities:
- NSE/BSE equity scanner (NIFTY 500 universe)
- F&O option-chain signal engine (NIFTY / BANKNIFTY / SENSEX)
- Swing cash staged-order system with Telegram alerts
- Kite-first live market data layer
- Paper trading engine (F&O auto + equity + combo lanes)
- Portfolio analyser, charting, deep scan, OI lab, pre-market/global cues
- Backtest lab (REAL_REPLAY + DIRECTIONAL strategy research)

**Production URL:** `https://marketscannerbydev.in`  
**Deployment:** Replit autoscale

---

## Repository Layout

```
/
├── artifacts/
│   ├── api-server/          Express 5 backend (Node.js, TypeScript)
│   │   ├── src/routes/      All API route files (28 routers)
│   │   ├── src/lib/         Business logic, engines, data providers
│   │   └── src/middlewares/ Auth middleware (requireOwner etc.)
│   ├── scanner/             React + Vite NSE frontend
│   │   ├── src/pages/       Page components (~30 pages)
│   │   ├── src/components/  Shared UI components
│   │   └── src/lib/         Frontend-only logic & hooks
│   └── global/              React + Vite global multi-asset frontend
├── lib/
│   ├── db/src/schema/       Drizzle ORM schema (20 tables)
│   ├── api-spec/openapi.yaml OpenAPI contract (source of truth for codegen)
│   ├── api-client-react/    Generated React Query hooks (DO NOT EDIT)
│   ├── api-zod/             Generated Zod schemas (DO NOT EDIT)
│   └── indicators/          Pure math indicators shared lib
├── scripts/src/             Utility scripts (tsx, not deployed)
├── docs/                    Architecture docs + audit reports
│   └── llm-index/           ← YOU ARE HERE
└── AGENT.md                 Root agent instructions
```

---

## Which Index File to Read Next

| Your task | Read this |
|---|---|
| Adding/changing an API endpoint | `API_ROUTES_INDEX.md` |
| DB schema / migrations | `DATABASE_INDEX.md` |
| Data source trust / provenance / honesty | `DATA_SOURCES_AND_PROVENANCE.md` |
| F&O signal engine / swing engine / paper trader | `CRITICAL_FLOWS.md` |
| Running tests / typecheck / verification | `TEST_AND_VERIFICATION_INDEX.md` |
| Finding a specific file by purpose | `PROJECT_MAP.md` |
| What changed recently | `CHANGELOG_FOR_AGENTS.md` |

---

## Source-of-Truth Data Policy (NEVER BREAK)

| Source | Allowed for | NOT allowed for |
|---|---|---|
| **Kite Connect** | All live signals, scanner, F&O engine, paper trades, swing risk-eval | Nothing excluded — this is the authoritative source |
| **Yahoo Finance** | Display-only fundamentals, news fallback, non-trading analytics | Any live signal/price decision; must NEVER overwrite Kite values |
| **INDstocks** | Secondary cross-validation ONLY (currently DISABLED by env flag) | Signals, trading decisions, scanner primary data |
| **NSE Bhavcopy** | EOD price/volume reference, sector weight refresh | Live intraday decisions |
| **DB cache / warehouse** | Candle warehouse substrate, historical OI | Not authoritative for live intraday quotes |

**The golden rule:** Any non-Kite data that reaches a UI must be labeled with its source. Any non-Kite value that could affect a trading decision must be rejected by the trust gate (`marketData/router.ts`).

---

## Critical Do-Not-Break Rules

1. **Kite priority is inviolable.** `marketData/router.ts` is the single entry point for all live quote data. Do NOT add direct provider imports in new route/lib files.

2. **Swing alert wording is production-verified.** `buildSwingOrderText` in `swingAlerts.ts` must say:
   - `Risk eval: kite (as of <time>)` — NOT `Data: kite`
   - `Note: Entry is the staged limit order price — not current market price`
   Never revert to the old `Data: kite` label.

3. **Broker execution is hard-disabled.** `LIVE_CASH_SWING_ORDER_ENABLED` must remain unset/false in production unless explicitly enabled. `swingLiveExecutionConfig.ts` controls this.

4. **No silent synthetic fallbacks.** Any fallback to non-Kite data must: log a WARN, set `fallback=true`, label the UI source, and never mark the result as `tradeable`.

5. **Paper trading auto-open is gated.** `isPaperAutoTradingEnabled()` in `paperAutoTradeFlag.ts` must fail-closed. Manual buys/closes are NOT gated.

6. **Do not trim/reorganize `replit.md`.** Owner has explicitly forbidden this.

7. **Drizzle schema changes need `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, NOT `drizzle-kit push`** (push would DROP live tables not in schema). See `DATABASE_INDEX.md`.

8. **Codegen must be run after OpenAPI changes.** Command: `pnpm --filter @workspace/api-spec run codegen`

---

## Standard Commands

```bash
# Typecheck (full — always run this)
pnpm run typecheck

# Tests
pnpm --filter @workspace/api-server run test    # api-server (vitest --pool=threads)
pnpm --filter @workspace/scanner run test       # scanner (vitest + jsdom)

# Regenerate LLM index
pnpm --filter @workspace/scripts run index:llm

# Check index freshness
pnpm --filter @workspace/scripts run index:llm:check

# DB schema push (dev only — SAFE method)
# Use: ALTER TABLE … ADD COLUMN IF NOT EXISTS  (NOT drizzle-kit push)

# Codegen (after openapi.yaml changes)
pnpm --filter @workspace/api-spec run codegen
```

---

## Where Production-Sensitive Logic Lives

| Area | Files |
|---|---|
| Kite auth / session | `lib/kiteAuth.ts`, `lib/kiteFeed.ts`, `lib/kiteReadiness.ts` |
| Kite live quotes | `lib/marketData/router.ts`, `lib/kiteScanner.ts` |
| F&O signal engine | `lib/optionSignals.ts`, `lib/confluenceEngine.ts`, `lib/optionSignalGates.ts` |
| Swing cash engine | `lib/swingOrderStaging.ts`, `lib/swingCash*.ts`, `lib/swingAlerts.ts` |
| Paper F&O auto-trader | `lib/paperTradingFO.ts`, `lib/paperAccount.ts` |
| Paper equity auto-trader | `lib/paperTradingEq.ts` |
| Telegram alerting | `lib/alerting.ts`, `lib/swingAlerts.ts` |
| Data trust policy | `lib/marketData/policy.ts`, `lib/marketData/types.ts` |
| Auth middleware | `src/middlewares/` (requireOwner, requireSubscriberOrOwner) |
| DB schema | `lib/db/src/schema/` |

---

## Agent Workflow (Token-Saving Protocol)

1. Read `AGENT_START_HERE.md` (this file) ← done
2. Read ONE specific index file for your task type (see table above)
3. Open only source files the index identifies as relevant
4. Make changes
5. Run: `pnpm run typecheck` + relevant tests
6. Run: `pnpm --filter @workspace/scripts run index:llm`
7. Run: `pnpm --filter @workspace/scripts run index:llm:check`
8. Append entry to `CHANGELOG_FOR_AGENTS.md`
