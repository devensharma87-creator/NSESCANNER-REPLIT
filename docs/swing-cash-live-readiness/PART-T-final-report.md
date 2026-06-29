# Part T — Professional Swing Cash Live-Trading Readiness (Phase 1 Final Report)

**Date:** 2026-06-29
**Go-live status:** `PAPER_ONLY_STILL_ACTIVE` — nothing in this pack can place, stage, or authorise a live broker order.
**Scope delivered:** PURE swing **CASH** risk/validation modules + exhaustive unit tests + planning docs. **No** schema, routes, scheduler, UI, or broker wiring.

---

## 1. What was built

Seven pure leaf modules + one composer, all under `artifacts/api-server/src/lib/`, mirroring the safe shape of `fnoPaperRiskGuards.ts` / `equitySizingHelper.ts` (pure functions, no side effects, classification + metrics + reasons out):

| Part | File | Responsibility |
|---|---|---|
| Contract | `swingCashTypes.ts` | All types, classification unions, leaf + unified config interfaces, candidate/portfolio/decision shapes. No runtime logic, no import cycles. |
| B | `swingCashDataTrust.ts` | Trade-grade tiering. Only **fresh, complete Kite** (or an explicitly-approved licensed source) is trade-grade. Yahoo = info-only. Stale/missing/unknown → never tradeable. Missing benchmark/sector → REVIEW_REQUIRED, never fabricated. |
| C | `swingCashEntryGate.ts` | Entry validity/freshness: chase, distance-to-target/stop, remaining R:R, signal age/validity expiry, explicit trigger. Unverifiable freshness or non-`true` trigger → REVIEW_REQUIRED. |
| F | `swingCashLiquidity.ts` | Liquidity/execution gate. Incomplete feed → REVIEW_REQUIRED, never a fabricated "liquid". Circuit/ASM/GSM hard blocks. |
| H | `swingCashEventRisk.ts` | Result-day / result-window / corporate-action gate. Unavailable calendar → REVIEW_REQUIRED. Non-finite `daysToResult` → RESULT_DATE_UNKNOWN_REVIEW_REQUIRED. |
| G | `swingCashExposure.ts` | Sector / single-stock / duplicate / consecutive-day exposure caps on the **proposed** position value. |
| E | `swingCashSizing.ts` | Risk-based sizing off a small live-capital slice. Reserve cash, gap buffer, absolute per-trade risk cap, min position value. |
| N | `swingCashCostModel.ts` | All-in delivery cost model → net-R after costs. |
| D | `swingCashRiskGuards.ts` | **Composer** `evaluateSwingCashRisk(candidate, portfolio, config)` + `DEFAULT_SWING_CASH_CONFIG`. Runs the full chain, aggregates every block reason, decides `allowed` / `severity` / `reviewRequired`. |

**Gate chain (functional order):** DataTrust(B) → Entry(C) → Liquidity(F) → Event(H) → Sizing(E) → Exposure(G) → Cost(N) → portfolio-level caps (open/daily/weekly).

---

## 2. Default config is the safest possible

`DEFAULT_SWING_CASH_CONFIG`:
- `mode: "paper_only"` — the only mode that needs no human gate, and the one nothing escalates out of automatically.
- `requireManualApproval: true`; `liveCapitalCapPct: 10` (live readiness sizes off a small slice of the book).
- All blocking gates ON; `tradeGradeSources: ["kite"]` only (no licensed provider is trusted implicitly — it must be added explicitly).
- Conservative `minRR` (1.8), tiny per-trade risk (0.5% / ₹500 cap), reserve cash 20%, gap buffer 2%.

Even a fully clean candidate in any live-capable mode returns `reviewRequired: true` (`allowed: false`) — manual approval is structurally required before any live action.

---

## 3. Fail-closed hardening — five architect rounds

The dominant risk in a pure risk-gate is the **`NaN`-makes-every-comparison-false** trap: a single missing/`NaN`/`Infinity` input silently slips past `x > cap` / `x >= cap` / `x < min` (all false for `NaN`) and a corrupt candidate reads as "safe / fresh / liquid / clear / within-cap". The architect drove this out across five rounds; every hole is now closed and regression-tested:

- **R1–R2:** initial gate logic + the "missing data → omit/label, never fabricate" stance across all leaves.
- **R3 (4 holes):** entry-gate freshness-provability + explicit `triggered===true`; data-trust non-finite `nowMs` → UNAVAILABLE; sizing non-finite/negative input/config → `SIZING_INPUT_INVALID` (qty 0); event-risk non-finite `daysToResult` → REVIEW_REQUIRED.
- **R4 (2 holes):** exposure non-finite/negative inputs/config → `inputInvalid` hard block (`EXPOSURE_INPUT_INVALID`); composer portfolio-counter/cap non-finite/negative → `PORTFOLIO_STATE_INVALID`.
- **R5:** PASS — no residual numeric-comparison bypass in the reviewed surface; still pure, additive, F&O-isolated, `paper_only`, Kite-only trade-grade, no loosened risk.

**Principle (now in agent memory):** every numeric guard in a fail-closed module must validate finiteness/sign of its inputs **and config** *before* any threshold comparison, because the unguarded path fails *open*.

---

## 4. Test coverage

One vitest file per module. **83/83 scoped tests green** (`vitest run --pool=threads swingCash`), **api-server typecheck clean** (`tsc -p tsconfig.json --noEmit`). Covers every Part S case (Yahoo reject, stale Kite, chased entry, deteriorated R:R, sector/single-stock cap, duplicate, consecutive-day, reserve cash, gap buffer, event-unavailable→review, insufficient cash, max-daily entries, manual-approval-required, cost net-R) **plus** the R3/R4 NaN/Infinity/negative regression set on every module and composer propagation.

> Note: the **full** api-server vitest suite OOMs under the default forks pool in this environment; the scoped `--pool=threads` run is the canonical gate for this pack (consistent with the repo-wide api-server testing note).

---

## 5. Absolute-rules compliance (verified)

- ✅ Swing **CASH only** — zero imports/reads/writes of F&O engine / risk / scoring / option-chain / capital-ledger / F&O paper.
- ✅ **No live broker orders**; live execution is not wired anywhere. Default mode `paper_only`.
- ✅ **No loosened risk** — only added gates and fail-closed guards.
- ✅ **Yahoo/delayed is never trade-grade** — Kite-only by default; licensed source must be explicitly configured.
- ✅ **Additive-only** — no schema/routes/scheduler/UI/broker changes.
- ✅ **Never fabricate** — missing/`NaN`/`Infinity` → omit / label UNAVAILABLE / force REVIEW_REQUIRED / hard block. Never silently safe/clear/liquid/fresh/within-cap.

---

## 6. Phase 2+ — owner decisions required (NOT started)

Phase 1 is a pure, inert foundation. None of the following is built; each needs an explicit owner decision before any later phase:

1. **Licensed trade-grade source** — approve/name a licensed real-time provider, or stay Kite-only? (Drives `tradeGradeSources`.)
2. **Event/result calendar feed** — which source for earnings/result dates + corporate actions? Until one exists, every candidate is REVIEW_REQUIRED on event risk.
3. **Notifications** — where should staged/review-required candidates surface (in-app panel, email, none for now)?
4. **`swing_order_staging` table** — approve a new DB table to persist staged (never auto-executed) candidates? This is the first non-additive step and needs explicit sign-off (and must use `ADD COLUMN IF NOT EXISTS`-style migration discipline, never an unguarded `drizzle-kit push`).
5. **Broker enablement** — confirm live execution stays hard-disabled until an explicit, separately-approved phase. Default remains `paper_only`.

**Recommendation:** keep `PAPER_ONLY_STILL_ACTIVE` until items 1–2 have a real data source — without a licensed source and an event calendar, no candidate can honestly clear to "tradeable" anyway.
