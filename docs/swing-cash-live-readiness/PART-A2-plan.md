# Part A2 — Phased Implementation Plan (Swing Cash Live-Readiness)

Derived from the Part A map + architect review. Each phase ends in a **safe, reversible, tested**
state. Default mode stays the safest. Live broker execution stays **hard-disabled by default**.

Mirrors this codebase's proven safety pattern: **pure module + shadow/read-only**, exactly like the
F&O Paper Risk Guard Pack (`fnoPaperRiskGuards.ts`) and the read-only `equitySizingHelper.ts`.

## Phase 1 — PURE guard pack (THIS TASK) — risk: LOW, reversible

New pure modules under `artifacts/api-server/src/lib/` (no DB, no network, no side effects, no wiring):

| File | Spec part | Responsibility |
|---|---|---|
| `swingCashTypes.ts` | B–N | Shared types, classifications, unified config interface |
| `swingCashDataTrust.ts` | B | Per-candidate trade-grade classification |
| `swingCashEntryGate.ts` | C | Entry freshness / chase / RR-deterioration classification |
| `swingCashLiquidity.ts` | F | Liquidity / execution-risk classification |
| `swingCashEventRisk.ts` | H | Event / result / corporate-action classification |
| `swingCashExposure.ts` | G | Sector / single-stock / duplicate / consecutive-day exposure |
| `swingCashSizing.ts` | E | Risk-based position sizing (reserve cash, max value, gap buffer) |
| `swingCashCostModel.ts` | N | Cash delivery cost/slippage model + net-R |
| `swingCashRiskGuards.ts` | D | `evaluateSwingCashRisk()` composes all of the above |

Each module ships with exhaustive vitest unit tests (Part S cases). **No** schema, routes, scheduler,
UI, or broker code in Phase 1. `DEFAULT_SWING_CASH_CONFIG` defaults to the safest mode,
`mode: "paper_only"` (with `requireManualApproval: true` and a Kite-only trade-grade allow-list);
nothing is wired to execution, so this phase cannot place orders or alter any existing behaviour.

## Phase 2 — read-only preview/diagnostics — risk: LOW-MED
Owner-only diagnostic endpoint that runs candidates through the pure pack for visibility (like
`/api/paper/eq/sizing-preview`). Optional Stocks-to-Watch badges. No order writes, no scheduler.

## Phase 3 — additive staging foundation — risk: MED  *(needs owner sign-off)*
`swing_order_staging` table — **additive only** (this repo's `drizzle-kit push` DROPS out-of-schema
tables, so add via guarded additive SQL + schema). Owner-only CRUD routes, idempotency, full
`riskDecisionJson`. No broker order placement.

## Phase 4 — fast-approval UI — risk: MED  *(needs owner sign-off)*
Mobile approval queue/cards, final data recheck on approve, expiry on price move. Notifications only
after the owner picks an infra (no paid integration without approval).

## Phase 5 — mode machine + kill-switch + reconciliation — risk: HIGH  *(needs owner sign-off)*
`PAPER_ONLY / LIVE_DRY_RUN / LIVE_STAGED_APPROVAL / LIVE_AUTO_SMALL_SIZE`. Kill-switch halts staging/
approval/orders/auto-open/auto-exit. Dry-run broker adapter never calls Kite order APIs.

## Phase 6 — broker abstraction (DISABLED) — risk: HIGHEST  *(needs explicit owner sign-off)*
place/cancel/status/reconcile interfaces + mocks. Hard gate `LIVE_CASH_SWING_ORDER_ENABLED=false`.
No real orders without separate written approval.

## Phase 7 — dashboards/reports — risk: MED
Readiness dashboard (Part O), missed-opportunity tracker (Part P), paper-vs-live comparison (Part Q).

## Phase 8 — go-live evidence gate — risk: gated
Only after ≥30 trading days clean dry-run/staged data + clean reconciliation + explicit owner approval.

## Owner decisions required before Phase 3+ (do not assume)
1. Is there any `TRADE_GRADE_LICENSED` source besides Kite? (default: **no** — only Kite is trade-grade.)
2. Event/result calendar: real API, manual calendar, or "unavailable → manual review"? (default: **unavailable → review**.)
3. Notification channel for fast approval (Telegram / email / browser / none).
4. Approve creating the additive `swing_order_staging` table.
5. Broker/live enablement policy (stays OFF until explicitly approved).

## Current go-live status after Phase 1
`PAPER_ONLY_STILL_ACTIVE` — pure decision/diagnostic primitives only; nothing wired to execution.
