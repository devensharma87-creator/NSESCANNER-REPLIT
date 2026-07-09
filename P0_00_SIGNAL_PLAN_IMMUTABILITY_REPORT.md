# P0-00 — SIGNAL PLAN IMMUTABILITY REPORT

**Date**: 2026-07-09
**Verdict**: **`P0_00_SIGNAL_PLAN_IMMUTABILITY_DEV_VERIFIED`** (production publish pending)
**Scope**: F&O option-signal plan snapshot vs live MTM separation. Zero trading-logic change.

---

## 1. Owner-observed issue

On the live F&O signals surface the owner saw a **SENSEX 77100 PUT** signal card (confidence 65, TRIGGERED) whose **entry price, market price and stop-loss changed after emission/trigger without any notice** — the plan appeared to silently rewrite itself while the trade idea was live.

## 2. Exact SENSEX 77100 PUT forensic evidence

Dev DB, `option_signal_history` (composite key `signal_date / index_symbol / setup_key / direction` — the table has no `id` column):

| Field | Value |
|---|---|
| signal_date / index | 2026-07-09 / SENSEX |
| setup / direction | EMA_PULLBACK / BEARISH |
| strike / type | **77100 PUT** |
| option_entry / option_stop_loss | ₹165.40 / ₹115.78 |
| option_target1 / option_target2 | ₹597.78 / ₹900.43 |
| confidence / tier / status | 65 / BASELINE / TRIGGERED |
| created_at | 2026-07-09 06:06:59.430Z (11:36:59 IST) |
| last evaluated spot / at | 76,975.47 @ 07:10:16.918Z (12:40 IST) |

A structurally identical historical row (2026-05-06 SENSEX 77100 PUT, entry ₹253.46 / SL ₹177.42 / T1 ₹478.35 / T2 ₹635.77, EXPIRED) confirmed the same column layout and the same mutation exposure across the table's lifetime.

Production DB was searched with the same predicates; the mutation **mechanism** (below) is identical in the deployed code path since the premium-enrichment feature shipped.

## 3. Root cause (confirmed)

Three compounding causes; the primary one is a **real server-side DB mutation**, not a rendering artifact:

1. **PRIMARY — `optionPremiumPatch` spread into every status-transition UPDATE** (`recordOrUpdate` in `artifacts/api-server/src/lib/optionSignalLifecycle.ts`, pre-fix lines ~530-570). Each poll cycle the API re-projected option premiums from the **current** Greeks/ATM state and — whenever any status transition or refresh ran — spread that patch into the `UPDATE` on `option_signal_history`, silently overwriting `option_entry`, `option_stop_loss`, `option_target1`, `option_target2`. Suspect #1 ("actual DB row update") and #3 ("API returning mutable projected values") **CONFIRMED**.
2. **Frontend conflation** — `options.tsx` rendered a single premium grid mixing the (already-mutating) stored plan with the live re-projection; no LOCKED vs LIVE distinction. Suspect #2 **CONFIRMED** as an aggravator.
3. **ATM-drift backfill risk** — the premium backfill path could stamp premiums computed for the **current** ATM strike onto a row whose locked strike had drifted away (different contract). Suspect #5/#6 class risk **CONFIRMED as latent** (guard added).

Ruled out: trailing-stop logic (none on these rows), same-signal-ID reuse for a different contract in the observed rows, cache-key collision, timezone rendering.

## 4. Before / after API payload

**Before**: `GET /api/options/signals` returned a single flat set of `optionEntry / optionStopLoss / optionTarget1 / optionTarget2` whose values changed cycle-to-cycle (they mirrored the mutating DB row / live re-projection). No way to distinguish plan from projection.

**After** (OpenAPI + codegen updated):
- `planSnapshot` — the immutable plan of record read straight from the locked DB row: strike, expiry, direction, `entryPremiumPlanned`, `stopPremiumPlanned`, `target1PremiumPlanned`, `target2PremiumPlanned`, spot levels, `premiumLockedAt`, plus `legacyPlanFields: true` for pre-fix rows that never got a lock stamp.
- `liveMtm` — this cycle's re-projection for the CURRENT ATM: live premium, live strike, `strikeDrift` flag when live ATM ≠ locked strike.
- `planRevised` — populated ONLY from `option_signal_plan_audit` rows (audited revisions).
- `paperFill` — actual paper-trade fill for the same signal (via `getPaperFillsForDate`), so fill-vs-plan divergence is explicit instead of overwriting the plan.

## 5. Before / after UI behavior

**Before**: one premium grid; numbers changed silently on every refresh; owner could not tell plan from market.

**After** (`artifacts/scanner/src/pages/options.tsx`):
- **"Locked plan (PE 77100) — plan of record"** section with Plan Entry / Plan T1 / Plan SL / Plan T2 and a "premiums locked HH:MM IST" stamp — explicitly labeled as not changing after trigger.
- **LIVE MTM — updates with market** section, visually separate.
- **Strike-drift honesty**: if live ATM ≠ locked strike, live premium projections are **hidden** with an explicit warning ("live premium projections would price a different contract than the plan").
- **Legacy rows** (`legacyPlanFields`) render a warning instead of pretending pre-fix values were locked.
- Fill divergence note: "(plan ₹X — fill happens at the live premium of the trigger tick, divergence is expected)".

## 6. DB rows inspected

- Dev: 2026-07-09 SENSEX 77100 PUT BEARISH row (section 2); 2026-05-06 SENSEX 77100 PUT BEARISH (EXPIRED); surrounding `option_signal_history` rows for 77100-strike CALL/PUT across May-July 2026; `paper_trade_fo` 77100-strike rows (2026-06-17 CALL pair) to separate paper-fill values from signal-plan values.
- Prod: same-predicate searches on `option_signal_history` / `paper_trade_fo` (read-only).
- Post-fix dev: schema verified — `option_premium_locked_at` column present; `option_signal_plan_audit` table present with 4-reason CHECK constraint.

## 7. Whether actual DB mutation occurred

**YES.** The premium columns were rewritten in the DB by `recordOrUpdate`'s spread of `optionPremiumPatch` into status-transition UPDATEs. This was a genuine silent-plan-mutation bug at the persistence layer.

## 8. Whether only display recomputation occurred

**NO — display recomputation alone does not explain it**, but display conflation was a real secondary factor: even between DB writes, the card mixed live projections into plan positions. Both layers are fixed (separation at API + UI, immutability at DB).

## 9. Files changed

| File | Change |
|---|---|
| `lib/db/src/schema/optionSignals.ts` | `option_premium_locked_at` column; `optionSignalPlanAuditTable` (append-only, old/new value, reason, changed_by, changed_at, CHECK on 4 allowed reasons) |
| `artifacts/api-server/src/lib/optionSignalLifecycle.ts` | Removed `optionPremiumPatch` from status transitions; `persistOptionPremiums` is now the ONLY premium writer — one-shot (`option_entry IS NULL` + lock stamp) and strike-guarded; `recordOrUpdate` / `persistOptionPremiums` / `getPlanRevisedKeys` gated on the schema-ensure below |
| `artifacts/api-server/src/lib/optionSignalPlanSchema.ts` | **NEW — production migration path** (architect-review finding): memoized, idempotent runtime schema-ensure (`ALTER TABLE … ADD COLUMN IF NOT EXISTS option_premium_locked_at` + `CREATE TABLE IF NOT EXISTS option_signal_plan_audit` with the 4-reason CHECK + index), same lazy-DDL pattern as `daily_report_runs` / `system_alert_dedup` / `ensureFnoExitMonitorSchemaColumns`. Production self-provisions on the first lifecycle call after publish — NO manual prod SQL step, NO drizzle-kit push |
| `artifacts/api-server/src/lib/optionSignals.ts` | `planSnapshot` / `liveMtm` / `planRevised` / `paperFill` composition; `getPaperFillsForDate` |
| `lib/api-spec/openapi.yaml` + generated clients | New response fields (codegen run) |
| `artifacts/scanner/src/pages/options.tsx` | LOCKED PLAN vs LIVE MTM split, legacy fallback, strike-drift suppression |
| `artifacts/api-server/src/lib/optionSignalPlanImmutability.test.ts` | New regression suite |

Allowed mutation reasons (DB-enforced): `MANUAL_OWNER_EDIT`, `CONTRACT_CORRECTION_WITH_AUDIT`, `CORPORATE_ACTION_ADJUSTMENT`, `DATA_ERROR_CORRECTION_WITH_AUDIT`. Silent recalculation / polling overwrite / quote overwrite / cache overwrite are structurally impossible (no code path writes premium columns outside the IS-NULL-guarded lock; audit CHECK rejects e.g. `SILENT_DRIFT`).

## 10. Tests and exact counts

| Suite | Files | Tests | Result |
|---|---|---|---|
| `optionSignalPlanImmutability.test.ts` (one-shot lock; strike guard blocks drifted backfill; PENDING→TRIGGERED leaves premiums untouched; two-poll stability; audit CHECK rejects SILENT_DRIFT) | 1 | **5 / 5** | ✅ |
| api-server `fno*` family | 22 | **516 / 516** | ✅ |
| api-server `paper* + optionSignal* + *lifecycle* + routes` (re-run post schema-ensure: 136 + 218 + 249) | 44 | **603 / 603** | ✅ |
| scanner full suite | 35 | **770 / 770** | ✅ |
| `pnpm run typecheck` (libs + all leaves) | — | 0 errors | ✅ |
| `verify:release` | — | **11 PASS / 0 WARN / 0 FAIL** | ✅ |
| LLM index (`index:llm` → `index:llm:check`) | — | 350 / 350 fresh | ✅ |
| API server workflow restart + `/api/healthz` | — | 200 | ✅ |

## 11. Safety confirmation (Part H)

| # | Item | Status |
|---|---|---|
| 1 | No broker execution | ✅ |
| 2 | No real orders | ✅ |
| 3 | No Telegram messages (tests use `TESTIDX_P000_${pid}` fake index; lifecycle no-ops for fake indices) | ✅ |
| 4 | No strategy threshold changes | ✅ |
| 5 | No detector weight changes | ✅ |
| 6 | No signal confidence formula changes | ✅ |
| 7 | No stop formula changes — only display/persistence separation | ✅ |
| 8 | No target formula changes | ✅ |
| 9 | No account balance change | ✅ |
| 10 | No realized P&L rewrite | ✅ |
| 11 | No historical trade rewrite (legacy rows labeled, never backfilled) | ✅ |
| 12 | No destructive migration (additive column + new table; `ALTER TABLE … ADD COLUMN IF NOT EXISTS` pattern, no drizzle-kit push) | ✅ |
| 13 | No stale/report-grade source can drive trades | ✅ unchanged |
| 14 | No Yahoo/delayed source can drive F&O signals or paper opens | ✅ unchanged |
| 15 | Plan fields cannot silently mutate (IS-NULL one-shot lock + strike guard + audit CHECK) | ✅ enforced at DB + code + test |

## 12. Final verdict

**`P0_00_SIGNAL_PLAN_IMMUTABILITY_DEV_VERIFIED`**

Forensically explained, fixed, regression-tested, reports updated. Architect review PASSED with one blocking pre-publish gap — **no production migration path** — which was fixed in the same session (`optionSignalPlanSchema.ts` runtime ensure; production self-provisions the column/table/CHECK on first lifecycle call after publish).

**Not** PROD_VERIFIED. PROD_VERIFIED checklist for the owner:

1. Publish the app.
2. Verify `/api/build-info` shows the fix commit.
3. Confirm the deploy log (or first signal cycle) shows `optionSignalPlanSchema: plan-immutability schema ready` — no manual prod SQL is required.
4. Verify a live TRIGGERED card renders LOCKED PLAN vs LIVE MTM and the locked premiums do not change across refreshes.

Per instruction, work **stops here** — Lane 1 is not started.
