# Exit Premium Market Shadow Column — Report

**Status: `EXIT_PREMIUM_MARKET_SHADOW_DEV_VERIFIED`**
**Date: 2026-07-08**
**Scope: P1 — observation-only shadow field on `paper_trade_fo`**

---

## 1. Objective

Capture the real Kite option-chain LTP at the moment a paper F&O trade is closed, and
persist it as a shadow field alongside the frozen exit-premium already recorded by the
auto-trader. This enables honest post-P0 comparison of the synthetic paper-exit price
against the market price that was actually available at the same instant.

**This is pure observation. No realized P&L, account balance, exit decision, signal
scoring, DD cap, heat calculation, or any other trading logic was changed by this task.**

---

## 2. Why This Matters

The F&O paper-trader prices exits using `last_premium` (the last MTM snapshot before the
exit condition fired), which is a real Kite tick. However, it is not the same as the
option-chain best-bid/ask LTP at the precise moment of exit. Once post-P0 paper trades
accumulate, comparing `exit_premium` (frozen synthetic price) with `exit_premium_market`
(simultaneous Kite chain LTP) will reveal:

- Slippage/staleness magnitude between the MTM price and the live market quote
- Whether the paper-trader's exit price is optimistic or pessimistic vs. market
- Shadow gross P&L using the real market LTP (purely informational; not credited to the account)

---

## 3. Shadow Fields Added

Eight nullable columns added to `paper_trade_fo` (all additive — no existing column
modified, no existing index changed, no NOT NULL constraint):

| Column | Type | Meaning |
|---|---|---|
| `exit_premium_market` | NUMERIC(18,4) | Real Kite chain LTP for this strike/side at exit time |
| `exit_premium_market_source` | TEXT | Always `"KITE_CHAIN"` when populated |
| `exit_premium_market_as_of` | TIMESTAMPTZ | Timestamp of the chain fetch used |
| `exit_premium_market_age_sec` | INTEGER | Age of chain in seconds at capture time |
| `exit_premium_market_gap` | NUMERIC(18,4) | `exit_premium_market − exit_premium` (positive = market > frozen) |
| `exit_premium_market_gap_pct` | NUMERIC(8,4) | Gap as % of frozen exit price |
| `market_shadow_gross_pnl` | NUMERIC(18,2) | `(market_ltp − entry_premium) × lots × lot_size` in ₹ — **observation only** |
| `exit_premium_market_unavailable_reason` | TEXT | Why capture failed (see §5) |

**The `market_shadow_gross_pnl` column is never read by any trading path.** It is not
credited to the paper account. It is not used in DD cap calculation. It is not used in
heat calculation. It is not surfaced in any Telegram alert. It is purely a diagnostic
field for future analysis of exit-price quality.

---

## 4. Implementation

### 4.1 Pure module — `fnoMarketShadowCapture.ts`

Three pure helpers (no I/O, fully unit-tested):

- **`extractStrikeLtpFromChain(chain, strike, optionType)`** — finds the matching row
  by strike (±0.05 tolerance for NUMERIC float jitter), returns `null` for zero/negative/
  NaN/Infinity LTP or missing CE/PE side.
- **`computeMarketShadow(marketLtp, entryPremium, frozenExitPremium, lots, lotSize)`** —
  computes `gap`, `gapPct` (0 when frozenExitPremium = 0, no division-by-zero), and
  `shadowGrossPnl` rounded to 4dp.
- **`captureExitMarketPremium(tradeRow, chain | null)`** — discriminated union result:
  `{ available: true, marketLtp, source, asOf, ageSec, gap, gapPct, shadowGrossPnl }`
  or `{ available: false, unavailableReason }`.

Schema migration helpers:

- **`applyFoMarketShadowColumns(db)`** — runs 8 `ALTER TABLE … ADD COLUMN IF NOT EXISTS`
  statements. Safe to call multiple times (idempotent). Uses raw SQL per project policy
  (drizzle-kit push is never used here — it would prompt to DROP unrelated tables not in
  the Drizzle schema).
- **`ensureFoMarketShadowColumns()`** — lazy singleton wrapper; runs once per process,
  memoized. Called automatically on first `applyMarketShadowToDb()` write.
- **`applyMarketShadowToDb(tradeId, captureResult)`** — writes the shadow fields via a
  targeted `UPDATE … WHERE id = $1`. No-op (resolves immediately) when `available: false`
  and `unavailableReason` is `CHAIN_MISSING` or `SOURCE_NOT_KITE`.
  Actually writes `exitPremiumMarketUnavailableReason` for all unavailability cases.
  Awaits `ensureFoMarketShadowColumns()` before any write.

### 4.2 Wire points in `paperTradingFO.ts`

Shadow capture is **fire-and-forget** (`void ... .catch(() => {})`) at two exit paths:

**Orphan sweep (`evaluateOrphanedOpenTrades`)**
- Chain is already fetched and passed into the per-trade evaluation.
- Shadow capture reuses the in-scope `chain` — zero extra API calls.
- Fires immediately after the close succeeds (before lifecycle-advance bookkeeping).

**15:20 force-exit sweep (`forceCloseAllOpenFnoFor1520`)**
- Chain must be fetched per-index (the sweep iterates over open rows by index symbol).
- An anonymous async IIFE fetches `fetchOptionChain(out.indexSymbol)` then calls
  `applyMarketShadowToDb`. If the fetch fails, the catch swallows it silently.
- The actual close (`closePaperTradeForSignal`) completes **before** the shadow fetch
  starts — close outcome is never conditional on chain availability.

In both paths: if the shadow write fails (network, DB, column-not-yet-added), the
fire-and-forget catch suppresses the error. The close is already persisted before the
shadow write begins.

### 4.3 `toClosedTrade()` in `paper.ts`

All 8 shadow fields are now exposed in the `GET /api/paper/positions/fo/closed` response.
Pre-P1 rows return `null` for all shadow fields (columns are nullable). No Zod validation
change was required — the fields are added to the OpenAPI `PaperTradeFOClosed` schema as
nullable, and codegen regenerated the Zod schema and React Query hooks.

---

## 5. Unavailability Reasons

| Reason | Meaning |
|---|---|
| `CHAIN_MISSING` | Chain was `null` — option chain not available at exit time |
| `SOURCE_NOT_KITE` | `chain.spotSource !== "kite"` — NSE-direct or unavailable chains rejected |
| `STRIKE_NOT_IN_CHAIN` | The trade's strike was not found among chain rows |
| `LTP_MISSING` | Strike row present but CE/PE side missing |
| `LTP_INVALID` | LTP is zero, negative, NaN, or Infinity |

Only `KITE_CHAIN` source is accepted. NSE-direct chains produce `SOURCE_NOT_KITE` and are
not used for shadow capture. This matches the project's data-sourcing policy: only Kite
data is considered authoritative.

---

## 6. OpenAPI and Codegen

`lib/api-spec/openapi.yaml`: 8 fields added to `PaperTradeFOClosed` schema (all nullable,
no `required` entry, backward-compatible).

Codegen run: `pnpm --filter @workspace/api-spec run codegen` — generated `lib/api-client-react`
hooks and `lib/api-zod` Zod schemas. typecheck:libs clean after codegen.

---

## 7. DB Migration

Applied via `ALTER TABLE paper_trade_fo ADD COLUMN IF NOT EXISTS …` (8 statements, all
`IF NOT EXISTS`, idempotent). Applied to dev DB directly via `psql $DATABASE_URL`. Also
wired lazily in `ensureFoMarketShadowColumns()` so any future fresh-DB environment (CI,
new replica, prod) auto-migrates on first write without a separate migration step.

**drizzle-kit push was NOT used.** Per project policy: push would prompt to DROP
`strategy_definitions` and `strategy_engine_state` tables that are not in the Drizzle
schema. All new-column additions use raw `ALTER TABLE … ADD COLUMN IF NOT EXISTS`.

---

## 8. Test Coverage

### New tests — `fnoMarketShadowCapture.test.ts` (29 tests, pure, no DB)

| Group | Cases |
|---|---|
| `extractStrikeLtpFromChain` | Exact match CE/PE, float jitter, strike absent, CE side missing, LTP=0, LTP<0, LTP=NaN, LTP=Infinity, empty rows |
| `computeMarketShadow` | Positive/negative/zero gap, frozenExit=0 (no div-by-zero), losing trade P&L, 4dp rounding |
| `captureExitMarketPremium` | All 5 unavailability branches, CE happy path, PE happy path, numeric-string strike, numeric-string premiums, losing trade |
| `__resetFoMarketShadowColumnsGuardForTests` | Does not throw |

### Regression fix — `fnoPremiumExitOverlay.test.ts`

Added `beforeAll(async () => { if (hasDb) await ensureFoMarketShadowColumns(); })` so
that the DB-integration tests (which INSERT into `paper_trade_fo` inside rolled-back
transactions) apply the migration before their first INSERT. Without this, a fresh-DB
test run would fail with `column "exit_premium_market" does not exist`. The fix follows
the identical pattern established by `fnoExitMonitorHealth.test.ts`.

---

## 9. Regression Gate

| Check | Result |
|---|---|
| typecheck (full, all artifacts + libs) | CLEAN ✅ |
| Scanner tests | 770/770 ✅ |
| api-server chunk 1 (files 1–28) | 588/588 ✅ |
| api-server chunk 2 (files 29–56) | 590/590 ✅ |
| api-server chunk 3a (files 57–70) | 158/158 ✅ |
| api-server chunk 3b (files 71–84) | 138/138 ✅ |
| api-server chunk 4 (files 85–112) | 771/771 ✅ |
| fnoMarketShadowCapture.test.ts | 29/29 ✅ |
| fnoPremiumExitOverlay.test.ts (post-migration fix) | 18/18 ✅ |
| No signal/decision/P&L/balance code touched | CONFIRMED ✅ |
| No drizzle-kit push | CONFIRMED ✅ |
| No Telegram alert path changed | CONFIRMED ✅ |

---

## 10. What Was NOT Changed

The following were explicitly out-of-scope and untouched:

- Realized P&L calculation (`computePnl`, `closePaperTradeForSignal`) — unchanged
- Account balance ledger (`paperAccount.ts`, `PAPER_ACCOUNT_SEED`) — unchanged
- DD cap / heat cap logic — unchanged
- Signal scoring / confluence engine — unchanged
- Exit decision gates (F&O exit monitor, premium hard-stop, orphan exit) — unchanged
- Any Telegram alert content or timing — unchanged
- Any frontend UI rendering — unchanged (8 fields are available via API but no
  frontend component was added; that is a separate follow-up)
- Backtest / strategy research paths — unchanged

---

## 11. Production Publish Status

**Production publish is still pending.** The dev DB migration is applied. The prod DB
migration will run automatically via `ensureFoMarketShadowColumns()` on first shadow
write after the next production deploy, because the function is called lazily inside
`applyMarketShadowToDb` and is protected by `IF NOT EXISTS`. No manual prod migration
step is required.

The existing production deployment (commit `eb09789d`) does not have these changes. A
republish is required to activate shadow capture in production.

---

## 12. Final Verdict

**`EXIT_PREMIUM_MARKET_SHADOW_DEV_VERIFIED`**

| Component | Status |
|---|---|
| 8 shadow columns in Drizzle schema | ✓ Complete |
| Pure capture module + migration helpers | ✓ Complete |
| OpenAPI spec updated + codegen run | ✓ Complete |
| Wire in orphan sweep (reuses cached chain) | ✓ Complete |
| Wire in 15:20 sweep (fetch chain per-index) | ✓ Complete |
| `toClosedTrade()` exposes 8 fields in API response | ✓ Complete |
| Dev DB migration applied | ✓ Complete |
| 29 new unit tests (pure) | ✓ 29/29 PASS |
| All api-server + scanner tests green | ✓ ~2835 tests pass |
| typecheck clean | ✓ Complete |
| Realized P&L / balance / decisions unchanged | ✓ CONFIRMED |
| Shadow gross P&L is observation-only | ✓ CONFIRMED |
| Production publish pending | ✓ PENDING (expected) |

---

## 13. Production Verification — 2026-07-08

**Timestamp:** 2026-07-08T10:17–10:24 UTC
**Verdict: `EXIT_PREMIUM_MARKET_SHADOW_PROD_INFRA_VERIFIED_LIVE_SAMPLE_PENDING`**

### Part A — Fresh Deploy Proof

| Check | Value | Status |
|---|---|---|
| HTTP 200 `/api/build-info` | 200 | ✓ PASS |
| commitShort | `a8e0a6a6` (shadow column commit) | ✓ CONFIRMED |
| buildTime | 2026-07-08T10:17:16.984Z | ✓ After publish |
| bootTime | 2026-07-08T10:19:32.258Z | ✓ After publish |
| environment | production | ✓ PASS |
| All 7 checkpoint markers | true | ✓ PASS |
| No secrets exposed | Zero secret-pattern keys in response | ✓ PASS |
| verify:release | 11 PASS \| 0 WARN \| 0 FAIL | ✓ PASS |

### Part B — Production Schema Verification

All 8 P1-specified shadow columns present in production DB, all nullable. Migration was additive only — no historical trade was modified.

| Column | Exists in Prod? | Nullable? | Verdict |
|---|---|---|---|
| `exit_premium_market` | YES — numeric | YES | ✓ PASS |
| `exit_premium_market_source` | YES — text | YES | ✓ PASS |
| `exit_premium_market_as_of` | YES — timestamptz | YES | ✓ PASS |
| `exit_premium_market_age_sec` | YES — integer | YES | ✓ PASS |
| `exit_premium_market_gap` | YES — numeric | YES | ✓ PASS |
| `exit_premium_market_gap_pct` | YES — numeric | YES | ✓ PASS |
| `exit_premium_market_unavailable_reason` | YES — text | YES | ✓ PASS |
| `market_shadow_gross_pnl` | YES — numeric | YES | ✓ PASS |

**Note on verification prompt's extended list:** The prompt listed 13 expected fields. Five were not part of the P1 implementation spec and do not exist:
`exit_premium_market_fresh` (no boolean flag — availability inferred from IS NOT NULL), `exit_premium_market_available` (same), `exit_premium_model` (not in P1 scope), `market_shadow_net_pnl` (only gross P&L implemented in P1), `market_shadow_total_charges` (not in P1 scope). These are natural follow-up items, not P1 blockers. The PARTIAL_GAP_REMAINS criteria ("fake, stale, non-trade-grade, mixed into realized P&L, missing from reports, or crashes legacy rows") do not apply to any of the 8 implemented fields.

### Part C — API / Route Verification

Legacy trades (pre-deploy, 10 most recent from prod DB):

| Trade Type | exit_premium_market | market_shadow_gross_pnl | Reason | Verdict |
|---|---|---|---|---|
| Legacy STOPPED (2026-06-15) | null | null | Not captured (pre-deploy) | ✓ PASS |
| Legacy TIME_EXIT_1520 (2026-06-08) | null | null | Not captured (pre-deploy) | ✓ PASS |
| All 10 legacy rows | null | null | Not captured (pre-deploy) | ✓ PASS |

No null-as-zero. No crash. `toClosedTrade()` returns `null` for all 8 shadow fields on legacy rows (confirmed by DB query of 10 most-recent closed trades — all pre-deploy).

### Part D — Live Capture Verification

**NO_LIVE_EXIT_SAMPLE_YET**

Query for trades closed after bootTime (2026-07-08T10:19:32Z): 0 rows. No open positions in production at verification time. Shadow capture infrastructure is live and will record on the next F&O paper trade exit.

### Part E — Report / UI Verification

| Surface | Status |
|---|---|
| `GET /api/paper/positions/fo/closed` exposes all 8 shadow fields | ✓ PASS — API verified |
| `exit_premium_market` is separate from `exit_premium` (realized) | ✓ CONFIRMED |
| `market_shadow_gross_pnl` is separate from `realized_pnl` | ✓ CONFIRMED |
| Shadow does not replace realized P&L | ✓ CONFIRMED |
| Legacy rows return null safely — no crash, no null-as-zero | ✓ CONFIRMED |
| Frontend UI component for shadow display | PENDING (deferred — no UI added in P1) |

The API layer exposes all 8 fields. A dedicated frontend panel showing "REALIZED PAPER P&L" vs "MARKET SHADOW P&L" labels is deferred to a follow-up task.

### Part F — Regression Checks

| Check | Status |
|---|---|
| Release Integrity (verify:release 11/11) | ✓ PROD_VERIFIED |
| P0-1 F&O Cost Model (fnoCostModel* 251/251) | ✓ PROD_VERIFIED |
| P0-2 VWAP / Volume Profile Honesty (optionSignals.zeroVolume, scanner 770/770) | ✓ PROD_VERIFIED |
| P0-3 Trigger Wording (optionSignals.triggerSemantics) | ✓ PROD_VERIFIED |
| Provider import guard (checkpoint `providerImportCompat=true`) | ✓ GREEN |
| F&O cost model guard (fnoCostModelGuard.test.ts) | ✓ GREEN |
| Broker execution disabled | ✓ CONFIRMED (paper-only env) |
| No real orders placed | ✓ CONFIRMED |
| No Telegram spam | ✓ CONFIRMED |
| No strategy / threshold changes | ✓ CONFIRMED |
| No destructive migration | ✓ CONFIRMED (additive only, IF NOT EXISTS) |
| Realized paper P&L unchanged | ✓ CONFIRMED |
| Account balance logic unchanged | ✓ CONFIRMED |
| Stale/report-grade data cannot drive live trades | ✓ CONFIRMED (shadow capture only fires after close) |

### Part G — Tests

| Suite | Count | Status |
|---|---|---|
| verify:release | 11 PASS \| 0 WARN \| 0 FAIL | ✓ |
| api-server typecheck | CLEAN | ✓ |
| fnoMarketShadowCapture + core shadow/paper/FNO (5 files) | 84/84 | ✓ |
| fnoCost* + optionSignal* + paper* (20 files) | 251/251 | ✓ |
| fnoExit* + fnoSignal* + fnoSpot* + canonical (12 files) | 287/287 | ✓ |
| backtest replay + routes (2 files) | 4/4 | ✓ |
| Scanner (35 files) | 770/770 | ✓ |
| LLM index (index:llm:check) | 350 files fresh | ✓ |

**Total targeted api-server tests: 626 pass (39 file-invocations). Scanner: 770/770.**

### Final Verdict

**`EXIT_PREMIUM_MARKET_SHADOW_PROD_INFRA_VERIFIED_LIVE_SAMPLE_PENDING`**

Production is live at commit `a8e0a6a6`. All 8 shadow columns are present in the production DB (additive, nullable, no historical rewrites). The API exposes all shadow fields. Legacy trades correctly return null. No post-deploy F&O paper trade exits have occurred yet — shadow capture will record on the next real exit. Full PROD_VERIFIED requires a live sample trade confirming capture or honest unavailability recording.
