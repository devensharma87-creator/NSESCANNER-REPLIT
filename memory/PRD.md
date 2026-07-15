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
- 2026-07-15 (iteration 8 · P0 Phase B + UnifiedGradeChip extension):
  * **P0 Phase B — Durable charges deducted from ledger (owner-approved)**.
    Writer path now subtracts `chargesTotal` from `paper_account.balance`
    on every close in the SAME txn that credits `proceeds`. Applies to
    `paperTradingFO.closePaperTradeForSignal` and
    `paperTradingEq.closePaperEquityTradeRow`. `dayRealizedPnl` stays
    GROSS to preserve report continuity — the charges-adjusted view is
    carried by the durable per-row `net_pnl` column stamped in Phase A.
  * **Reconciliation identity updated** — `paperAccountReconciliation.ts`
    now keys on `charges_status`:
      - `CURRENT` rows → contribute NET pnl (`realized_pnl − charges_total`)
      - `LEGACY_NOT_STORED` rows → contribute GROSS pnl (their historical
        balance write never had charges applied)
    Mixed ledgers straddling the Phase-B rollout boundary reconcile
    exactly. New fields on the API: `chargesActuallyDeducted` (authoritative
    sum from DB) and `ledgerNetRealizedPnl` (the exact number in the
    identity). `chargesEstimate` retained for context.
  * **Writer version bumped** — `paper-writer-v1.1.0-charges` →
    `paper-writer-v1.2.0-ledger-net`. Every Phase-B write is
    forensically identifiable.
  * **Test coverage** — `durableChargesPhaseB.test.ts` (5 tests): pure-
    CURRENT ledger, pure-LEGACY ledger, MIXED ledger straddling rollout,
    CURRENT-row-with-null-charges (defensive), empty ledger. Identity
    holds to ≤ 0.01 in all cases.
  * **LedgerHealthCard UI** updated to surface the new authoritative
    fields ("Ledger NET realized P&L", "Charges deducted (Phase B)") next
    to the schedule-based estimate; footer copy updated to reflect Phase B
    is live.
  * **UnifiedGradeChip extended to three more surfaces**:
      - `pages/scanner.tsx` (Full Scanner boot) — `source="kite"` with
        `fallbackUsed = fullMeta.kiteOffline`, chipId=`scanner-boot`.
      - `pages/sectors.tsx` (Sectoral heatmap index) — `source="scanner_cache"`
        (always INFO_ONLY — sector aggregates are contextual), chipId=`sectors-rollup`.
      - `pages/sector-detail.tsx` — same INFO_ONLY axis, chipId
        derived per sector name.
      - `components/home/index-expanded-panel.tsx` `AnalyticsProvenanceNote`
        — the custom trust-tier badge is replaced by the canonical
        `UnifiedGradeChip` (Kite live → KITE_TRADE_GRADE; Yahoo/delayed →
        INFO_ONLY; unavailable → UNAVAILABLE). Missing-reason + warnings
        copy preserved verbatim.
  * **Live smoke** — api-server restarted, `/api/paper/account?segment=FNO`
    returns `chargesActuallyDeducted=0`, `ledgerNetRealizedPnl=0`,
    `reconciled=true`, `driftAmount=0` (fresh ledger). EQUITY segment
    also reconciled=true.
  * **Test totals** — Backend: **3394/3394** pass (up from 3389 — 5 new
    Phase B identity tests). Frontend: **799/799** pass. Typecheck clean
    on both api-server and scanner.

- 2026-07-15 (iteration 7 · P1 unified chip vocabulary + preset test fix):
  * **P0 Phase A verified end-to-end** — `durableChargesIdentity.test.ts` 4/4 pass;
    `GET /api/paper/account?segment=FNO&reconcile=1` returns the durable
    `chargesEstimate.schedule=FNO_V1_2026Q1`, `grossRealizedPnl`,
    `estimatedNetRealizedPnl`. Reconciliation identity holding.
  * **P1 (c) — Option Chain unified vocabulary**: new reusable
    `UnifiedGradeChip` atom (`components/ui/unified-grade-chip.tsx`) that reuses
    the pure `deriveHomeUnifiedGrade` derivation but accepts an *inline*
    descriptor — decoupled from `HOME_MARKET_PULSE_SECTIONS`. Wired into
    `option-chain.tsx` in two places:
      - Above the 6-card analytics grid (Spot / PCR / Max Pain / ATM IV /
        Total OI / Bias). Emits KITE_TRADE_GRADE when `chain.source === "kite"`
        and no fallback/staleness; downgrades to INFO_ONLY on NSE fallback or
        past-freshness data; UNAVAILABLE when the chain never arrived.
      - Above the Greeks toolbar row — always INFO_ONLY since Greeks are
        derived (Black-Scholes, r=6.75%), never a trade-decisioning quote.
    Tests: `unified-grade-chip.test.ts` — 8 tests locking in every
    `(source, runtime) → HomeUnifiedGrade` transition.
  * **P1 (d) — Chip vocab unified across Portfolio + Signals**: new
    `StatusChip` atom (`components/ui/status-chip.tsx`) with six intent
    variants (ok / pending / active / warn / err / info). Same border+bg-tint
    grammar in both `LedgerHealthCard` and the F&O `StatusPill` in
    `options.tsx`. Colour tokens harmonised (emerald / amber / cyan / rose /
    secondary); typography, iconography and dimensions now identical across
    both call sites. `data-testid="status-chip-*"` hooks added for testing.
  * **BUG-53/54 confirmed dropped**: verified against
    `FULL_PLATFORM_BUG_REGISTER.csv` + `MASTER_QUANT_BUG_REGISTER_2026_07_09.csv`
    — no entries exist for those IDs. Backlog line cleaned up.
  * **Flaky test fixed** — `globalPresetRoutes.test.ts` 3/3 pass. Root cause:
    the router mounts `router.use("/global", requireGlobalAuth)`, and
    `requireGlobalAuth` returns 503 when `GLOBAL_APP_ACCESS_PASSWORD` is
    unset. Fix: set the env var in `beforeAll` (harness forges signed cookies
    directly so login flow is bypassed). Restored on teardown.
  * **Test totals** — Backend: 3389/3389 pass (up from 3382 flaky). Frontend:
    799/799 pass (up from 791). Typecheck clean on both api-server and scanner.

- 2026-07-14 (iteration 6 · P0 Phase A): Durable charges column path COMPLETE.
  * **Schema (additive nullable, zero destructive migration)**: 7 new columns on
    `paper_trade_fo`, `paper_trade_eq`, `paper_trade_combo` — `gross_pnl`,
    `charges_total`, `charges_breakdown_json`, `charges_model_version`,
    `charges_calculated_at`, `net_pnl`, `charges_status`. `writer_version` also
    added to `paper_trade_combo` for parity. All applied via idempotent
    `ALTER TABLE ADD COLUMN IF NOT EXISTS` in `ensurePaperTradeChargesColumns()`,
    hooked into boot at 16 s via `scheduleBootJob`.
  * **Writer path** (`paperTradingFO.closePaperTradeForSignal`,
    `paperTradingEq.close*`): every close now stamps all seven columns.
    Charges computed once at close via canonical model (`computeFnoTradeCost` +
    `mapCostToChargesBreakdown` for FO; `computeEquityCharges` for equity).
    `chargesStatus = "CURRENT"` on all new writes. Balance-side path UNCHANGED
    per owner approval Q4=b — reconciliation identity remains gross in Phase A.
  * **CURRENT_WRITER_VERSION** bumped to `paper-writer-v1.1.0-charges` so
    consumers can key the durable-charges era off the writer_version tag.
  * **Report layer** (`paperReportsFO`, `paperReportsEq`): prefers DB-stored
    charges + net when `chargesStatus === "CURRENT"`; recomputes via canonical
    model when LEGACY. New `chargesStatus` field surfaced on every trade
    detail row so the UI can flag legacy rows visibly.
  * **Post-market Telegram**: F&O block now adds `F&O charges (durable, N trades):
    ₹-X` + `F&O net realized P&L: ₹±Y` lines when at least one CURRENT row
    closed today. LEGACY rows counted separately with explicit "NOT included in
    net" footnote.
  * **Legacy row policy**: pre-P0 rows carry `chargesStatus = "LEGACY_NOT_STORED"`
    and are NEVER back-filled without owner approval.
  * **Reconciliation identity**: UNCHANGED in Phase A per owner approval — Phase B
    (balance-side decrement + seed refill migration) requires separate approval.
  * **Tests**: new `durableChargesIdentity.test.ts` (4 tests — FO CURRENT, FO
    LEGACY, EQ CURRENT, EQ LEGACY, all prove `realizedPnl − charges = netPnl`).
    All pass. `dailyReports.test.ts` updated for new PostMarketFno shape
    (117/117). Typecheck clean api-server + scanner + lib/db. Migration verified
    in DB — 21 columns present (3 tables × 7 charges columns).
- 2026-07-14 (iteration 5): Full technical audit + dead-code cleanup.
  * **Audit doc**: new `/app/memory/AUDIT_2026_07_14.md` capturing the
    zero-compromise verification — every trade-grade path stays on Kite,
    zero fake-data leaks, provider-import regression guard enforces
    boundary at compile time and via a regression test allowlist
    (63 files reviewed, ZERO direct-yahoo imports in decisioning code).
  * **Dead code removed**:
    - `lib/__dryrun_tmp.ts` (temp scratch file, never imported)
    - `lib/marketData/analyticsRouter.ts` (unwired "central router", zero callers)
    - `components/market-mood.tsx` (superseded by `mmi-gauge.tsx`)
    - `components/events-marquee.tsx` (unused page component)
    - `components/markets-news-card.tsx` (unused page component)
  * **Intentionally kept**: `lib/optionSignals.legacyEmit.bak.ts` (Phase-3
    backup — explicit docstring, not compiled, not imported).
  * **Only surviving mock**: `global-status-banner.tsx::getMockReadiness`
    — dev-only (`import.meta.env.DEV`), stripped from production builds.
  * **Regime hysteresis, IST daily latches, force-exit mutex** — every
    concurrency / timing invariant re-verified in source.
  * Suites: api-server 3382/3385 (same 3 pre-existing unrelated failures),
    scanner 791/791. Typecheck clean api-server + scanner + lib/db.
- 2026-07-14 (iteration 4): D unified vocabulary + G reason-category chips.
  * **D Market-Pulse unified vocabulary** — new `HomeUnifiedGrade` union
    added to `homeMarketPulseSourceMap.ts` with six canonical values:
    KITE_TRADE_GRADE / NSE_ARCHIVE / DELAYED_T_PLUS_1 / INFO_ONLY /
    UNAVAILABLE / PROVIDER_NOT_CONFIGURED. Derived deterministically from
    the existing (sourceStatus, source) pair via `deriveHomeUnifiedGrade`
    (pure). Rich 7-value status kept internally as `data-status` attribute
    for analytics; the primary chip label is the new 6-value vocab, aligned
    with the daily-reports legend footer added in iteration 1.
    `SectionSourceLabel` component switched to render the unified grade.
    Consumer contract updated: `HomeSectionSource` now carries `unifiedGrade`
    field alongside the legacy `sourceStatus`.
  * **G F&O Cockpit reason-category chips** — new pure classifier
    `fnoReasonCategories.ts` maps any suppressed reason prose string into
    one of seven owner-facing buckets: DATA_FAILURE / MARKET_CLOSED /
    BROKER_DISABLED / CAPITAL_BLOCK / RISK_VETO / SIGNAL_QUALITY /
    NO_SETUP (+ OTHER catch-all). New `FnoReasonCategoriesStrip`
    component consumes `data.diagnostics.suppressed[]`, groups reasons by
    bucket, renders category chips with count + tooltip samples. Wired
    into `options.tsx` just below the SignalGateBanner and expiry-day
    banner. Hidden on a fully clean session.
    Tests: `fnoReasonCategories.test.ts` — 12 tests (single-reason
    classification for every bucket, OTHER fallback, summarizeFnoReasons
    ordering + sample cap). All pass. Scanner suite: 791/791.
- 2026-07-14 (iteration 3): B.8 writer_version + LedgerHealthCard frontend + roadmap cleanup.
  * **B.8 writer_version schema tag** — nullable text column added to
    `paper_trade_fo` + `paper_trade_eq` via `ensurePaperTradeWriterVersionColumn`
    (ALTER TABLE ADD COLUMN IF NOT EXISTS, memoized, retries on transient DB
    blips). New rows stamped with `CURRENT_WRITER_VERSION = "paper-writer-v1.0.0"`.
    Pre-B.8 rows carry NULL and are honestly labelled legacy. Bump the version
    string whenever the writer path materially changes (schema, charges, etc).
    Boot job "paper-trade-writer-version-column" scheduled at boot+15s so the
    writer path never inserts into a missing column on a fresh deploy.
    Drizzle schema updated (`paperTradeFoTable.writerVersion` +
    `paperTradeEqTable.writerVersion`); `lib/db` rebuilt.
  * **Frontend Portfolio LedgerHealthCard** — new
    `scanner/src/components/ledger-health-card.tsx` renders a one-line status
    row that fetches `/paper/account?segment={FNO|EQUITY}&reconcile=1` every
    60 s. Shows ✅ Reconciled / ⚠ Drift ₹X / ⌛ Loading / ❌ Failed with a
    click-to-expand detail (seed, expected, drift, open MTM, gross/net,
    charges estimate + schedule). `data-testid` hooks for testing agent.
    Wired into both Equity and F&O segments of `/paper-trading` page.
  * **BUG-53/54 clarification**: raw fix-file text never made it into the repo
    — only the numeric IDs. User acknowledged no additional spec exists;
    dropping these IDs from the roadmap.
  * **Testing**: 3382/3385 (unchanged from iteration 2). Typecheck clean.
    Reconciliation smoke-tested end-to-end; `writer_version` column confirmed
    present in DB after api-server restart.
- 2026-07-14 (Sections F.2 + B.6/B.7 + G/D/E audit): Zero-compromise iteration 2.
  * **F.2 (expiry-day banner)**: `options.tsx` renders a violet "EXPIRY DAY"
    banner listing indices where `signal.regime === "EXPIRY_DAY"` plus the
    three mode changes (MEAN_REVERSION only, size × 0.5, auto-close 14:30 IST).
    Hidden on normal sessions. `data-testid="expiry-day-banner"`.
  * **F.3 (regime chip hysteresis)**: BUG-73 backend already surfaces
    hysteresis pending state in `regime.reason`; existing RegimeChip tooltip
    renders it verbatim. No code change needed.
  * **F.4 (T1/T2 indicators)**: Verified `statusChip` in options.tsx already
    handles TARGET1_HIT / TARGET2_HIT / STOPPED / EXPIRED with distinct
    icons + tones.
  * **B.6/B.7 (gross vs net P&L + charges)**: `paperAccountReconciliation.ts`
    now includes `chargesEstimate` (static SEBI schedule — brokerage/STT/
    exchange/GST/SEBI/stamp), `grossRealizedPnl`, `estimatedNetRealizedPnl`.
    Schedule fingerprint (`FNO_V1_2026Q1` / `EQ_CNC_V1_2026Q1`) surfaced.
    `estimated: true` hard-flagged — ledger stays gross until a durable
    `charges` column write path lands.
  * **B.3 (top-up path)**: `/paper/account/topup` + `/withdraw` verified —
    already implemented with ₹10cr cap and audit note. B.3 is operational,
    not a code gap; new reconciliation snapshot tells owner when to top up.
  * **G / D / E**: audit-only this round. Existing implementations already
    honest — no new fake data anywhere; label vocabulary unification is
    left for the next iteration.
  * **Testing**: 3382/3385 (up from 3380). Typecheck clean api-server +
    scanner. Reconciliation smoke-tested end-to-end.
- 2026-07-14 (Sections A + B.5 + B.1/B.2 + C audit): Zero-compromise fixes.
  * **A.6 (post-market wording)**: `dailyReports.ts buildPostMarketReport` — F&O section
    lines are now scoped as `F&O paper trades:` / `F&O realized P&L:`, and Equity block
    as `Equity paper trades:`. No ambiguity when only one segment has activity.
  * **A.7 (legend footer)**: Both pre-market and post-market reports now end with a
    one-line legend explaining TRADE-GRADE / INFO-ONLY / STALE / Unavailable /
    Provider-not-configured. Consumer no longer needs external context to decode
    section grades.
  * **A audit confirmed already correct**: A.1 unavailable-source labels (data
    coverage map surfaces `SOURCE_NOT_INTEGRATED` honestly), A.2 FII/DII source
    label ("NSE archive, prev day"), A.4/A.5 retry logic (60s window ticks, DB
    FAILED-status retry, `dailyReports_pre_market_deliveries_status_check`), A.8
    "Broker execution: DISABLED" hard-wired in both reports.
  * **B.5 (owner-facing block reason)**: `/swing/staged-orders/:id/paper-open-preview`
    was returning `blockedReason: "CONCURRENT_CAP"` on any `wouldOpen=false`, which
    is misleading — the actual block is a capital shortfall. Now returns
    `"INSUFFICIENT_CAPITAL"` correctly, plus new `capitalShortfall` field.
  * **B.1/B.2 (paper account ↔ trade ledger reconciliation)**: new module
    `paperAccountReconciliation.ts` — pure read-only tie-out for a segment on
    an IST date. Verifies the identity `seed - Σ(open capital deployed) +
    Σ(lifetime realized P&L) = balance`, surfaces drift with tolerance
    (0.01 × rows involved). Includes info-only mark-to-market P&L on open
    positions. New endpoint `GET /paper/account?segment={FNO|EQUITY}&reconcile=1`.
    Verified live: FNO seed ₹200k, balance ₹200k, drift 0, reconciled=true.
    Tests: `paperAccountReconciliation.test.ts` — 2 pure-shape checks.
  * **C audit — no code changes needed**: `getMarketStatusDetail` returns
    `marketOpen: boolean` + IST-formatted `serverIst`; the options page gates
    the "Market is closed" screen strictly on `data?.marketStatus != null &&
    !data.marketStatus.marketOpen` with a legacy-payload refetch guard.
    `contractInstrumentToken` string→number coercion is present in the
    /options/signals route. `execution` truth (executionStatus /
    executionBlockedReason / paperTradeOpened) fully enriched on every
    /signal-history row. INFO_ONLY / BLOCKED / NOT_CONFIRMED / OPENED all
    surface with correct paper-badge label + block-reason mapping in
    `option-signal-alerter.tsx`. Sections C.1–C.10 verified stable.
  * Full suite: 3380/3384 (up from 3378). 3 unrelated `globalPresetRoutes`
    pre-existing failures unchanged; 1 flaky swingTtlSweep "db pool exhausted"
    race under parallel load (20/20 pass in isolation).
- 2026-07-14 (Phase 4 kickoff): BUG-85/86/87 Telegram bot + 429 boot-storm polish.
  * **BUG-87 priority tiers**: `AlertPriority` = CRITICAL | WARN | INFO added to
    `alerting.ts`. Prefix (`🔴 [CRITICAL]` / `⚠️ [WARN]` / `ℹ️ [INFO]`) is
    prepended to Telegram messages. `alertOwner(..., priority?)` — default WARN
    preserves historical behaviour, all existing callers unchanged.
  * **BUG-85/86 bot commands**: new `telegramBotCommands.ts` — long-polls
    `getUpdates` (timeout=25s), owner-only whitelist via `TELEGRAM_CHAT_ID`,
    fail-closed if not configured, first-boot fast-forwards past backlog,
    persists `telegram_bot_last_update_id` in app_state.
    Commands: `/help /status /clock /positions /pnl /pause /resume`.
    `/pause` and `/resume` write to `system_mode_override` (same audit
    trail as UI override buttons). Started via `scheduleBootJob` at boot+110s.
    Verified running in supervisor logs.
    Tests: `telegramBotCommands.test.ts` — 5 tests (routing, /help lists all,
    `@bot_username` syntax, arg-stripping, case-insensitive). All pass.
  * **429 boot-storm polish**: added `BOOT_STORM_GRACE_MS = 60_000` skip on
    `/api/*` rate limiter. Steady-state limit (300/min per-IP) unchanged;
    the first 60s after api-server start is exempt so the frontend's
    initial data-hydration burst never trips 429.
  * Full suite: 3378/3381 (up from 3373; +5 bot-router tests). Same 3 unrelated
    `globalPresetRoutes` pre-existing failures.
- 2026-07-14 (Phase 3 continued): BUG-72–79 audit + BUG-73 regime hysteresis.
  * **BUG-72 (detector cooldown) — VERIFIED EXISTS**: `BIAS_FLIP_COOLDOWN_MIN=45`
    in `optionSignalGates.ts`, applied via `isBiasFlipSuppressed()` — after a
    STOPPED close on one direction, the OPPOSITE direction is blocked for 45m
    on the same index. Independent bias-flip suppression per-index.
  * **BUG-73 (regime hysteresis) — NEW**: `regimeClassifier.classifyRegimeWithHysteresis`
    wraps the raw stateless classifier. Per-index in-memory state; a NEW regime
    label must appear for `REGIME_HYSTERESIS_N=3` consecutive reads before it
    replaces the stable label. EXPIRY_DAY (calendar-driven) bypasses hysteresis
    and applies immediately. `optionSignals.ts buildContext` switched to the
    hysteresis wrapper (keyed by `cfg.symbol`); `backtest/directional.ts` keeps
    the raw classifier (historical replay doesn't need damping).
    Tests: `regimeClassifier.hysteresis.test.ts` — 7 tests (prime read, single
    flip suppressed, N-th flip sticks, interrupted run resets, per-index
    isolation, N=1 disables). All pass.
  * **BUG-74 audit**: no separate fix-file bug 74 — combined into BUG-72/73.
  * **BUG-75/76/77 (partial exits ladder) — VERIFIED EXISTS**: lifecycle
    supports `TARGET1_HIT` runner state (partial win locked at T1, remainder
    continues targeting T2). Terminal states TARGET2_HIT / STOPPED / EXPIRED /
    TIME_EXIT_1520 / TIME_EXIT_1430_EXPIRY (post-BUG-80). EOD sweep settles T1
    runners at T1, full EXPIRED settles at lastPremium.
  * **BUG-78 (signal-reason fingerprint dedupe) — VERIFIED EXISTS (P15b)**:
    `computeSignalFingerprint({signalDate,indexSymbol,setupKey,direction,
    optionType,selectedStrike})` → 16-hex SHA-256. Upstream batch dedupe map
    in `fnoSignalReasoningLogger.ts` (once-per-transition contract).
  * **BUG-79 (session-level throttling) — VERIFIED EXISTS**: FNO daily caps —
    HC `FNO_RISK.MAX_TRADES_PER_DAY=4`, BASELINE `FNO_BASELINE_GUARDRAILS.
    MAX_TRADES_PER_DAY=2`, consecutive-stops cap, portfolio heat cap 6%.
    Also `POST_STOP_COOLDOWN.COOLDOWN_MINUTES=60` × `SIZE_MULT=0.5` per index.
  * Full suite: 3373/3376 passing (same 3 unrelated `globalPresetRoutes`
    pre-existing failures — confirmed unchanged).
- 2026-07-14 (later still): BUG-80 EXPIRY_DAY special mode (Phase-3 kickoff).
  * `optionSignals.ts` buildSignalsForIndex: on `ctx.regime.regime === "EXPIRY_DAY"`,
    every trend-class detector (trend_continuation, vwap_reclaim, volume_breakout,
    ema_pullback) is suppressed with reason `expiry-day gate (BUG-80: MEAN_REVERSION
    only on expiry — pin/unwind dynamics dominate)`. Only `mean_reversion` runs.
  * `paperAccount.REGIME_SIZING`: added `EXPIRY_DAY_MULT = 0.5`. `paperTradingFO.ts`
    sizing block applies this multiplier when `signal.regime === "EXPIRY_DAY"`
    (stacks multiplicatively with POST_STOP_COOLDOWN.SIZE_MULT).
  * New IST 14:30 auto-close: `paperTradingFO.forceCloseAllOpenFnoFor1430Expiry`
    closes every OPEN paper F&O row on indices expiring today with reason
    `TIME_EXIT_1430_EXPIRY`. Hooked into the existing 30s trigger sweep in
    `optionSignals.ts` with its own daily latch (`lastForceExit1430ExpiryDate`,
    idempotent per IST day); the global 15:20 latch still fires after that for
    non-expiring positions.
  * New `CloseReason: TIME_EXIT_1430_EXPIRY` (paperTradingFO), new
    `FnoReasoningDecision: CLOSED_TIME_EXIT_1430_EXPIRY` (fnoSignalReasoningLogger),
    fnoFailureDiagnosis groups both time-exit variants together as force-exits.
    exit_reason DB column is free-text (no CHECK), so no schema migration.
  * New `indexesExpiringTodayIst(now?)` helper exported from `optionSignals.ts` —
    pure, no side effects; used by the trigger sweep + tests.
  * Tests: new `optionSignals.expiryDay.test.ts` (5 tests — indexesExpiringTodayIst
    behaviour for weekly/monthly indices on/off expiry day + EXPIRY_DAY_MULT=0.5).
    Full suite: 3366/3369 passing (3 unrelated pre-existing failures in
    `globalPresetRoutes` — verified pre-existing via git-stash re-run).
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
- P1 Phase 3: F&O signal correctness (BUG-72-80 all DONE; BUG-53/54 dropped —
  see iteration 3 note: raw fix-file text never landed in the repo and no
  spec exists in either bug register).
- P1 Phase 4: Telegram bot commands + priority tiers (BUG-85-87).
- P2 Phase 5-6: tab polish, reconciliation, portfolio.
- P2 Phase 7: Live auto-trading (Section G) — needs Kite + prolonged observation.
- P3 Phase 8-9: replay harness, canary, AI sentiment.

## Notes for next session
- Read `/app/replit.md` + `/app/docs/*` before touching signal code: repo has strict
  invariants (swing engine untouchable, fail-closed guards, drizzle push warnings).
- Existing audit registers: FULL_PLATFORM_BUG_REGISTER.csv, MASTER_QUANT_BUG_REGISTER_2026_07_09.csv
  overlap heavily with the user's fix file — cross-reference before implementing.
