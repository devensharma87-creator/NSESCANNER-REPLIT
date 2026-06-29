# PART M — Swing CASH Phase 2 Final Report

**Feature:** Swing CASH Live-Readiness — Phase 2: Order Staging + Fast Approval Queue
**Date:** 2026-06-29
**Build type:** Additive only. Broker execution HARD-DISABLED. No real order can be placed.

---

## 1. Files touched

### New library / service modules (`artifacts/api-server/src/lib/`)
- `swingLiveExecutionConfig.ts` — execution-mode resolver (`getSwingExecutionMode` default `paper_only`, fails CLOSED to `paper_only`), live-flag gate (`isLiveCashSwingOrderEnabled` default FALSE, **no deployment fallback**), book-capital reader, status builder.
- `swingKillSwitch.ts` — owner kill-switch (in-memory + `appState`-backed; `enabled`/`reason`/`updatedAt`/`updatedBy`).
- `swingDryRunBroker.ts` — DRY-RUN simulator. Never imports a broker SDK; every result `placed: false`, ids prefixed `DRYRUN-`.
- `swingCashLiveCandidateAdapter.ts` — the ONLY live data boundary. Builds/rechecks a `SwingCashCandidate` via the central trusted market-data layer (Kite authoritative; Yahoo never trade-grade; missing/stale → null + reason, never fabricated). Injectable fetcher for tests.
- `swingOrderStaging.ts` — staging service: `stageSwingOrder`, list/get, `approveSwingOrder` (CAS + full Phase-1 recheck, fail-closed), `rejectSwingOrder`, `markWatchOnly`, `expireStaleSwingOrders`, `refreshAndRecheckSwingOrder`, `buildSwingPortfolioState`.
- `swingOrderStaging.test.ts` — 25 unit tests (Part L cases 1–20, injected DB/adapter/clock/kill-switch).

### New DB schema
- `lib/db/src/schema/swingOrderStaging.ts` — Drizzle definition of `swing_order_staging` (mirrors the raw migration; protects the table from a future `drizzle-kit push` DROP). Exported from `lib/db/src/schema/index.ts`.

### New routes
- `artifacts/api-server/src/routes/swingStaging.ts` — `/swing/*` router (11 endpoints). Registered in `artifacts/api-server/src/routes/index.ts`.

### New UI
- `artifacts/scanner/src/pages/swing-cash.tsx` — owner-only "Swing Cash Live Queue" page. Registered in `artifacts/scanner/src/App.tsx`; nav entry in `artifacts/scanner/src/components/layout.tsx` (Trading Desk).

### Contracts + generated (codegen output, not hand-edited)
- `lib/api-spec/openapi.yaml` — added `/swing/*` paths + schemas.
- `lib/api-client-react/src/generated/*`, `lib/api-zod/src/generated/*` — regenerated via `pnpm --filter @workspace/api-spec run codegen`.

### Migration artifact
- `docs/swing-cash-live-readiness/migrations/swing_order_staging.sql` — exact applied SQL.

### Final-fix pass (this session, post-architect-FAIL)
- `lib/api-spec/openapi.yaml` — added `benchmarkAvailable` (boolean, nullable) to `SwingStageRequest`.
- `artifacts/api-server/src/routes/swingStaging.ts` — `buildSnapshotCandidate` now wires `benchmarkAvailable`.
- `artifacts/api-server/src/lib/swingCashLiveCandidateAdapter.ts` — `rebuildCandidateForRecheck` ties daily-candle OHLC + as-of together (honesty fix).
- `artifacts/api-server/src/lib/swingOrderStaging.ts` — corrected `buildSwingPortfolioState` docstring (no behavior change).

---

## 2. Files confirmed UNTOUCHED

- `artifacts/api-server/src/lib/swingCashRiskGuards.ts` — Phase-1 pure risk engine. `git diff` empty. **Unmodified.**
- `artifacts/api-server/src/lib/swingCashDataTrust.ts` — Phase-1 data-trust gate. `git diff` empty. **Unmodified.**
- `artifacts/api-server/src/lib/swingCashTypes.ts` — Phase-1 shared types/config. `git diff` empty. **Unmodified.**
- All F&O modules (`optionSignals.ts`, `oiLab.ts`, paper-trader FNO/EQ lanes, `paperAccount.ts`), option-chain, candle warehouse, capital ledger, and swing-scanner signal logic — not part of this change set.
- `replit.md` — not trimmed (owner directive: never trim).

Architect (evaluate_task, this session) independently confirmed the three Phase-1 pure modules produced no `git diff`.

---

## 3. Schema changes and exact SQL

Table `swing_order_staging` created via **raw `CREATE TABLE IF NOT EXISTS`** (idempotent), applied with `psql "$DATABASE_URL" -f docs/swing-cash-live-readiness/migrations/swing_order_staging.sql`. **NOT** via `drizzle-kit push` (push wants to DROP out-of-schema tables in this repo). Applied to dev DB 2026-06-29. **Run once against prod after deploy.**

Exact SQL (see `migrations/swing_order_staging.sql`): a `uuid` PK table with owner/symbol/instrument fields, full risk-plan fields (entry/limit/stop/target1/target2/qty/capital/maxRisk/riskPercent), `candidate_snapshot_json` + `risk_decision_json` + `recheck_decision_json` (jsonb), status/approval/broker/event-risk/missed-opportunity columns, **9 CHECK constraints** (status, approval_status, side, execution_mode, broker_status enums + positive quantity/entry/stop/target1) and **4 indexes** (owner, status, owner+status, expires_at). `broker_status` defaults `'BROKER_DISABLED'`.

This is **additive and non-destructive** — no `ALTER`, no `DROP`, no data migration.

---

## 4. Current mode

`paper_only` (default). `getSwingExecutionMode()` reads `SWING_CASH_EXECUTION_MODE`; unset/blank/unrecognised → fails CLOSED to `paper_only`. No env override is set, so the lane is in `paper_only`.

---

## 5. Broker execution status

**HARD-DISABLED.** `isLiveCashSwingOrderEnabled()` reads `LIVE_CASH_SWING_ORDER_ENABLED`, defaults **FALSE**, and has **no deployment/`REPLIT_DEPLOYMENT` fallback** — production cannot silently enable it. No broker SDK is imported anywhere in the lane. With the flag false, staged/approved orders carry `brokerStatus = BROKER_DISABLED` and all broker fields (`broker_order_id`, `broker_response_json`) are null. The only placement path that exists is the DRY-RUN simulator (Section 11), reachable only in `live_dry_run` mode, and it still places nothing real.

---

## 6. Staging service summary

`swingOrderStaging.ts` (pure-ish, injected DB/adapter/clock/kill-switch):
- **Stage** persists the full risk decision: live candidate snapshot (`candidate_snapshot_json`) + Phase-1 `risk_decision_json`, plan fields, event-risk fields, mode, and `expires_at`. Kill-switch checked first.
- **Approve** uses a CAS update (`WHERE id=? AND status=...`) and runs a **full Phase-1 recheck against live data, fail-closed** — if the recheck is not clean/ready or review is required, the order goes `RECHECK_BLOCKED`/`APPROVAL_REQUIRED` and is NOT approved. Kill-switch checked before approve.
- **Reject / Watch-only / Expire** transition the row honestly with reasons.
- **Expire-stale** sweeps past-`expires_at` PENDING rows and records the missed-opportunity tracker (Section 13).
- Capital/exposure caps are evaluated via `buildSwingPortfolioState` from this owner's own committed staging rows (notional; broker disabled). Phase-2 evaluates the recheck against the stage-time frozen portfolio snapshot; live per-approval re-derivation is a documented Phase-3 follow-up (see Section 15).
- With `LIVE_CASH` flag false → broker fields null + `BROKER_DISABLED` throughout.

---

## 7. API route summary

`/swing/*` (registered in `routes/index.ts`). **Reads = subscriber or owner; all mutations = owner-only.**

| Method | Path | Access |
|---|---|---|
| GET | `/swing/status` | subscriber/owner |
| POST | `/swing/kill-switch` | owner |
| GET | `/swing/staged-orders` | subscriber/owner |
| POST | `/swing/staged-orders` | owner |
| POST | `/swing/staged-orders/expire-stale` | owner |
| GET | `/swing/staged-orders/:id` | subscriber/owner |
| POST | `/swing/staged-orders/:id/refresh` | owner |
| POST | `/swing/staged-orders/:id/approve` | owner |
| POST | `/swing/staged-orders/:id/reject` | owner |
| POST | `/swing/staged-orders/:id/watch` | owner |
| POST | `/swing/staged-orders/:id/expire` | owner |

All curl-smoked through the shared proxy in P3 (stage prices via live Kite `dataSource=kite`; approve fail-closed `RECHECK_BLOCKED` off-hours; reject/watch/expire transitions OK; kill-switch blocks stage with `KILL_SWITCH_ACTIVE`; broker fields null / `BROKER_DISABLED` throughout). Request bodies validated by generated Zod schemas. The market freshness/source/OHLC fields on a candidate are **server-stamped**; the only client-supplied signal *context* fields are `sector` and `benchmarkAvailable` (both fail-closed when omitted).

---

## 8. UI summary

`artifacts/scanner/src/pages/swing-cash.tsx` — owner-only "Swing Cash Live Queue" (nav under Trading Desk). Renders staged-order cards with all plan + risk + data-provenance fields and Approve / Reject / Watch / Expire / Refresh actions wired to the generated hooks. Loud banners state the current mode, **"Broker execution: DISABLED"**, and **"Approval does NOT place a real order."** There is no "Buy Now" affordance. Scanner typecheck clean; 711/711 scanner tests pass; clean HMR. (Page is owner-gated, so an unauthenticated screenshot shows the login gate; the underlying hooks are the same endpoints curl-validated in P3.)

---

## 9. Final data recheck summary

Approval and refresh re-fetch a LIVE candidate via `swingCashLiveCandidateAdapter.ts` (Kite authoritative through the trusted layer) and re-run the **full Phase-1 risk + data-trust evaluation, fail-closed**. Key honesty properties:
- LTP refreshes only when the live quote is fresh; otherwise carried + reasoned, never faked.
- **Daily OHLC candle and its `dailyCandleAsOfMs` move together** — when the live quote has an LTP but null OHLC, the daily candle and its as-of are both carried from the snapshot (reason `LIVE_OHLC_MISSING_DAILY_CARRIED`); a fresh as-of is never stamped over carried OHLC.
- `benchmarkAvailable` is owner-supplied signal context (like `sector`); omitted/false → fail-closed `REVIEW_REQUIRED`. It is **not** a freshness/source claim.
- Any unavailable input → omit/label + reason, never fabricate.

---

## 10. Event-risk handling

Staged rows persist event-risk context (`result_date_known`, `result_date`, `corporate_action_risk`, `event_risk_status`, `manual_review_required`) and the candidate's ASM/GSM status. An owner-supplied `eventOverride` can annotate a candidate during recheck (recorded with a reason). Unknown event data is labelled honestly (not assumed safe) and can route a candidate to manual review rather than silent approval.

---

## 11. Dry-run broker summary

`swingDryRunBroker.ts` is a pure simulator: `placeOrderDryRun` / status / cancel / reconcile. It imports no broker SDK, makes no network call, and returns `placed: false` with a synthetic `DRYRUN-<ts>-<rand>` id and the note "DRY RUN — no real broker order was placed." Reachable only in `live_dry_run` mode. In the current `paper_only` mode it is not exercised, and even when exercised it places nothing real.

---

## 12. Kill-switch summary

`swingKillSwitch.ts` — owner-only switch (in-memory + `appState`-backed, with `enabled`/`reason`/`updatedAt`/`updatedBy`). Toggled via `POST /swing/kill-switch` (owner-only). Checked **before stage and before approve** (and before any dry-run path). When active, stage/approve are rejected with `KILL_SWITCH_ACTIVE` (curl-verified in P3). Fail-safe: it can only *block*, never enable execution.

---

## 13. Missed-opportunity tracker summary

When a staged order expires (sweep or explicit expire), `missed_opportunity_json` records that the candidate lapsed. P&L of the missed move is labelled **`MISSED_PNL_UNAVAILABLE`** when it cannot be computed from trusted data — it is **never fabricated**. This gives the owner an honest record of lapsed setups without inventing returns.

---

## 14. Tests run

- `swingOrderStaging.test.ts` — **25/25** (Part L cases 1–20; injected DB/adapter/clock/kill-switch).
- Scoped final regression (`--pool=threads`): `swingOrderStaging.test.ts` + `swingCashRiskGuards.test.ts` + `swingCashDataTrust.test.ts` — **50/50 passing**.
- `pnpm --filter @workspace/api-server run typecheck` — **clean**.
- `pnpm --filter @workspace/scanner run typecheck` — **clean**.
- `pnpm --filter @workspace/scanner run test` — **711/711**.
- `pnpm --filter @workspace/api-spec run codegen` (incl. `typecheck:libs`) — **clean**.
- The full api-server vitest suite OOMs in this environment; tests were run scoped with `--pool=threads` per the repo's documented convention.
- Architect (evaluate_task) — **PASS**, no blockers; confirmed Phase-1 pure modules unmodified.

---

## 15. Any blocker

**None blocking the target status.** One documented limitation carried to Phase 3:
- **Concurrent-approval window**: approval/refresh re-evaluate exposure caps against the stage-time **frozen** `portfolioState`, not a live per-approval rebuild of committed state. Acceptable here because the broker is hard-disabled (positions are notional, no real capital at risk). Live re-derivation is a documented Phase-3 hardening item; the `buildSwingPortfolioState` docstring now states this honestly.

Operational reminder (not a code blocker): run `swing_order_staging.sql` once against the **prod** DB after deploy (dev already applied).

---

## 16. Exact status

```
LIVE_STAGED_APPROVAL_READY_BUT_BROKER_DISABLED
```
