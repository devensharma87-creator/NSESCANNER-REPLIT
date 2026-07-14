# P1 F&O Exit Monitoring Reliability — Resume & Complete Verification Report

**Date:** 2026-07-03
**Scope:** Verify (not rebuild) reliable SL/target exit monitoring for open F&O paper trades using fresh trusted Kite data, per the 11-phase CODER PROMPT resume spec.
**Feature commits:** `bfd3471` / `c9ee754` — "Enhance F&O trading with exit monitoring and improved Telegram alerts" (2026-07-02 21:13:40 UTC).

## VERDICT

```
FNO_EXIT_MONITORING_DEV_VERIFIED
```

The exit-monitoring implementation is complete, correct, comprehensively tested, and **live in production** behind the same auth/schema/deploy guarantees as the rest of the app. It is **not yet PROD_VERIFIED** for one specific reason that is a data-availability fact, not a code defect: **zero F&O paper trades have been in an `OPEN` state at any point since the feature deployed to production**, so the live exit-monitor code path in prod has had nothing to evaluate yet and has produced no stamped evidence (`exit_detected_at`, `exit_monitor_status`, `last_exit_check_at`, etc. are `NULL` on all 28 existing rows, all of which are `CLOSED` and predate the deploy). This is the exact "no open trades cycled since deploy → DEV_VERIFIED" case flagged in the pre-verification architecture review. No rollback, no gap, no code change is indicated.

---

## 1. What was being verified

Reliable SL/target exit monitoring for **open F&O paper trades** (`paper_trade_fo`, NIFTY/BANKNIFTY/SENSEX only), specifically:

- Every exit evaluation runs off fresh, trust-gated (Kite-authoritative, non-stale) spot data — never Yahoo, never stale quotes, never fabricated data.
- Every check (success, block, or error) leaves an audit trail on the row (`exit_detected_at`, `exit_quote_source`, `exit_quote_as_of`, `exit_quote_freshness_sec`, `exit_trade_grade`, `exit_monitor_status`, `last_exit_check_at`, `last_exit_check_error`).
- No entry/signal/SL-target computation logic, no Swing logic, no broker execution was to be touched.
- Owner-only UI/API surfaces were to be checked for correct gating, not exercised destructively (no owner password use, no `run-now` in production).

## 2. Hard constraints — reaffirmed as respected

| Constraint | Status |
|---|---|
| No entry/signal/SL-target computation changes | ✅ Confirmed — `fnoExitDecision.ts` only reads existing stop/target premium fields, never recomputes them |
| No Swing logic touched | ✅ Confirmed — zero diffs outside `paper_trade_fo` / F&O exit path |
| No broker execution | ✅ Confirmed — paper-only; no Kite order placement anywhere in the exit path |
| No owner password use | ✅ Owner-only endpoints verified via clean 401 responses only; `run-now` was never invoked in production |
| No destructive migrations | ✅ All 9 new `paper_trade_fo` columns added via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (`applyFnoExitMonitorSchemaColumns`, memoized via `ensureFnoExitMonitorSchemaColumns`), never `drizzle-kit push` (which would attempt to drop out-of-schema tables in this DB) |
| Global Scanner out of scope | ✅ No changes touched `artifacts/global` |

## 3. Phase-by-phase summary

### Phase 0 — Audit (prior session)
Confirmed the feature was substantially built in commit `c9ee754`/`bfd3471` (2026-07-02): schema audit columns, `fnoExitDecision.ts` trust-gated decision logic, `fnoExitMonitorHealth.ts` migration + cycle-accumulator health tracking, wiring into `optionSignals.ts` exit sweep, 3 owner-only diagnostic endpoints in `routes/paper.ts`, `FoExitMonitorPanel` (paper-trading page) and an Infra Health "F&O Exit Monitoring" section, plus Telegram exit-notification integration via the canonical `tradeLifecycle` formatter.

### Phases 1–8 — Design & code correctness (verified via architecture review + code reading, this + prior session)
An independent code-review pass (architect, `responsibility: plan` then confirmatory review) examined the trust-gating logic, schema migration ordering, cycle-accumulator correctness, parity-fixture coverage, and Telegram-notification wiring, and **confirmed the feature is complete and sound**. Two design notes were surfaced (not gaps):

- **FROZEN_PREMIUM is an intentional design deviation, not a defect.** Locked premium plans (`entryPremium`/`stopPremium`/`target1Premium`/`target2Premium`) are captured at trade open and never recomputed — the exit monitor evaluates the *live* premium against those frozen levels. This is correct: recomputing SL/target off live premium would be an entry/signal logic change, which is explicitly out of scope. **Do not downgrade the verdict for this.**
- **`exit_notification_status` is a dead column.** The column exists on the schema and is documented, but nothing in the current write path ever populates it (Telegram exit notifications are sent via the separate `tradeLifecycle` canonical formatter, whose outcome is not persisted back to this column). Flagged for a future cleanup task; not a functional gap in exit monitoring itself.
- **Freshness-rounding note:** the quote-freshness gate has ~120.49s of slack versus the nominal threshold in one edge case; assessed as acceptable and not a reliability risk.

Confirmed via direct code reading this session:
- `paperReportsFO.ts` reads exclusively `status = "CLOSED"` rows (line 374, guarded by a runtime assertion at line 156-157) — exit-monitor audit columns cannot leak into performance reporting logic.
- `tradeLifecycle/parityFixtures.ts` includes dedicated F&O exit fixtures — `FIXTURE_FNO_EXIT_SL`, `FIXTURE_FNO_EXIT_TARGET`, `FIXTURE_FNO_EXIT_MANUAL` (lines 283, 314, 345) — alongside the pre-existing Swing exit fixtures, so the canonical notification formatter's parity harness exercises all three F&O exit reasons.

### Phase 9 — Test suite (this session, COMPLETE, all green)
| Suite | Result |
|---|---|
| api-server targeted subset (55 files: fno/paper/exit/option/kite/trade/parity/notification + routes), run in 3 chunks via `--pool=threads` | **928 passing** (467 + 241 + 220) |
| scanner full suite (`pnpm --filter @workspace/scanner run test`) | **762 passing** / 35 files |
| `pnpm run typecheck` (full monorepo: libs + every leaf workspace) | **clean** |
| LLM doc index (`index:llm` freshness check) | **fresh**, 335 files, no drift |

### Phase 10 — Production verification (this session, COMPLETE)

**Deploy timeline.** Feature landed at commit `c9ee754` (2026-07-02 21:13:40 UTC). The first "Published your App" deploy commit strictly after that timestamp is `55f3785` (2026-07-03 10:53:32 UTC), i.e. the feature has been live in production for under a day as of this report.

**Auth gating (curled unauthenticated against `https://marketscannerbydev.in`):**

| Endpoint | Method | Result |
|---|---|---|
| `/api/paper/diagnostics/fo/exit-monitor/status` | GET | `401 {"error":"unauthorized","code":"AUTH_REQUIRED"}` |
| `/api/paper/diagnostics/fo/exit-monitor/run-dry` | POST | `401 {"error":"unauthorized","code":"AUTH_REQUIRED"}` |
| `/api/paper/diagnostics/fo/exit-monitor/run-now` | POST | `401 {"error":"unauthorized","code":"AUTH_REQUIRED"}` |

No secrets, stack traces, or internal detail leaked in any response. `run-now` was **not invoked** — per the hard constraint, it was only probed unauthenticated to confirm gating; the resulting 401 is independently corroborated in the production deployment logs (`POST /api/paper/diagnostics/fo/exit-monitor/run-now` → `statusCode 401`), confirming the request actually reached the live server and route.

**Database evidence (production, read-only queries):**

- All 9 new audit columns (`exit_detected_at`, `exit_quote_source`, `exit_quote_as_of`, `exit_quote_freshness_sec`, `exit_trade_grade`, `exit_monitor_status`, `last_exit_check_at`, `last_exit_check_error`, `exit_notification_status`) exist on the live `paper_trade_fo` table — the additive migration ran successfully in production.
- `paper_trade_fo` status distribution: **28 total rows, 28 CLOSED, 0 OPEN.**
- `opened_at` range: earliest `2026-05-04 10:26:16 UTC`, latest `2026-06-15 05:20:44 UTC` — i.e. **the most recent trade opened and closed on 2026-06-15**, roughly 2.5 weeks *before* the exit-monitor code deployed (2026-07-03).
- All 28 rows have `exit_detected_at` / `exit_monitor_status` / `last_exit_check_at` = `NULL`. This is **expected, not a bug**: these columns are only stamped by the live exit-monitor sweep against rows with `status = 'OPEN'`, and none has existed since the feature went live. There has been nothing for the deployed code to stamp yet.

**Conclusion of Phase 10:** the code is deployed, the schema migration succeeded, the owner-only surfaces are correctly gated in production, and the route wiring is confirmably live — but there is **no positive stamp evidence** of the trust-gated exit-decision path having executed against a real open trade in production, because no F&O paper trade has been open at any point in the current production deploy's lifetime. Per the pre-verification review's own criterion ("stamps exist in prod → PROD_VERIFIED; no open trades cycled since deploy → DEV_VERIFIED"), this places the feature at **DEV_VERIFIED**, not PROD_VERIFIED.

### Phase 11 — This report

---

## 4. Owner-only manual visual verification (pending — cannot be completed by the agent)

The following require a human owner to log in and visually confirm; they were **not exercised** here since doing so would require the owner password, which was correctly not requested:

- [ ] `OWNER_MANUAL_VISUAL_VERIFICATION_PENDING` — `FoExitMonitorPanel` (`artifacts/scanner/src/components/fno/FoExitMonitorPanel.tsx`) renders correctly on `/paper-trading` when logged in as owner, including its empty state (expected right now, since there are 0 OPEN F&O trades).
- [ ] `OWNER_MANUAL_VISUAL_VERIFICATION_PENDING` — the F&O Exit Monitoring section on `/infra-health` (`artifacts/scanner/src/pages/infra-health.tsx`) renders health/status data correctly when logged in as owner.
- [ ] `OWNER_MANUAL_VISUAL_VERIFICATION_PENDING` — `GET /api/paper/diagnostics/fo/exit-monitor/status` returns a well-formed health snapshot when called with valid owner credentials (only the unauthenticated 401 path was verified by the agent).
- [ ] `OWNER_MANUAL_VISUAL_VERIFICATION_PENDING` — `POST /api/paper/diagnostics/fo/exit-monitor/run-dry` (dry-run, no mutation) produces a sane simulated decision when called by the owner once at least one F&O paper trade is OPEN.

## 5. Companion docs

No companion report (`docs/data-infrastructure.md` parity notes, global-data-health report, swing-TTL report, Telegram alert-quality report) required updates — none of their described behaviors changed as part of this verification. `replit.md` already documents the "F&O Exit Monitoring Reliability" audit columns under the Combo/data-infrastructure section from the 2026-07-02 build.

## 6. Pending production evidence checklist — gates the upgrade to `FNO_EXIT_MONITORING_PROD_VERIFIED`

**Status: accepted by owner on 2026-07-03.** No code action is required now; do not rebuild or refactor this module in the meantime. The `DEV_VERIFIED` verdict stands until every item below is confirmed against a real production `paper_trade_fo` row the next time an F&O paper trade actually opens in production. This is a data-availability wait, not an open defect.

When the next F&O trade opens in production, re-run Phase 10 (prod DB query + log check) and confirm, in order:

1. **Trade opens** — the new row transitions to `status = 'OPEN'` in production `paper_trade_fo`.
2. **Check cadence** — `last_exit_check_at` is stamped (non-NULL, advancing) after each exit-monitor cycle while the trade is OPEN.
3. **Outcome class** — `exit_monitor_status` is populated (`MONITORED` / `BLOCKED` / `UNMONITORED`) on every check, never left NULL while OPEN.
4. **Source honesty** — `exit_quote_source` reflects a Kite/trusted data-quality label, never Yahoo or an untrusted fallback silently powering an exit decision.
5. **Quote timestamp present** — `exit_quote_as_of` is populated for every evaluated check (not just successful ones).
6. **Trade-grade gating** — `exit_trade_grade` is `true` only when the underlying quote is fresh and trade-grade; confirm at least one BLOCKED example where it is `false`/absent, if the market conditions produce one.
7. **Fail-closed on bad data** — when a check hits stale/missing data, confirm the outcome is `BLOCKED` (trade stays OPEN, no premature close) rather than the trade being force-closed off bad data.
8. **Single close** — if SL/target is hit, confirm the DB row closes exactly once (`status` flips `OPEN → CLOSED` a single time, no duplicate close writes or double-decrement of capital/heat).
9. **Single Telegram send** — confirm the exit Telegram notification for that trade fires exactly once, not duplicated across retries/redundant cycles.
10. **Notification dedup** — confirm the notification-log dedup mechanism (canonical `tradeLifecycle` formatter / dedup key) correctly suppresses a second send attempt for the same exit event.
11. **No real order** — confirm zero broker order-placement calls were made for this trade (paper-only, as designed).
12. **Broker execution still disabled** — confirm the broker-execution kill switch/flag is still off in production after this trade's full lifecycle.

Only once all 12 are confirmed with evidence (query results / log lines) should the verdict in this report be updated to:

```
FNO_EXIT_MONITORING_PROD_VERIFIED
```
