# MISSION DIRECTIVE — F&O MONEY-PATH COMPLETION

**Objective:** The platform's first honest, fully-instrumented paper trade — signal emitted by a real production writer, executed with real option premiums, exited by a defined rule, P&L computed net of real NSE costs — followed by a continuous 20+ signal evaluation sample across NIFTY / BANKNIFTY / SENSEX.
**Target:** First real trade within ~10 trading sessions of mission start. Evaluation sample within ~5 sessions after that.
**This is one mission, not six slices.** Each phase below checkpoints ONCE at its end. Sub-steps inside a phase are pre-authorized as scoped here. Everything not on this mission's critical path is frozen until the mission completes.

**Why this exists:** Six months of build has produced a truthful platform and zero trades. The 2026-07-17 session is the proof case: the analysis layer read the day correctly (bullish OI positioning on all three indices), the market delivered +1.1% to +1.7% trend moves, and the system emitted only INFO_ONLY baseline broadcasts whose triggers expired 30–90 minutes before price crossed every one of them. Nothing was wrong with the market read. The tradeable lane does not exist, and the trigger lifecycle is mis-designed. This mission builds the lane and fixes the lifecycle. Nothing else.

---

## STANDING BRIGHT LINES (unchanged, condensed)
1. Schema: `ADD COLUMN IF NOT EXISTS` freely; anything else needs owner pre-approval. New tables get same-day Drizzle declarations.
2. No merges / no Publish until Phase M2 lands (DRIFT-P0).
3. No deploys/restarts during market hours (09:00–15:30 IST).
4. No threshold, veto, clamp, or gate value changes EXCEPT where this mission explicitly scopes them with owner decision recorded.
5. Acceptance evidence is literal: pasted test lines (`--pool=threads`, Replit/Shell), typecheck exit 0, raw query output, screenshots.
6. No adjacent actions. Defects found off-path: log, report, continue.
7. Paper trading only. No live order path work.

---

## PHASE M0 — CLOSE THE LEDGER + BUILD THE EVIDENCE FILE (tonight + weekend)
Scope:
- Finish the existing post-close docket: Items 2–4 (column-width invariant test; paper_trade_eq.quantity diagnosis→proposal; persistence-audit note), Friday probes (Rows F/G/K), and the 9-section acceptance query with the 10:50–11:43 gap annotation. Combined Fri+Mon sample closes P0.4 Step 2.
- Add one read-only capture: **the 2026-07-17 case study** — persist to `/app/memory/forensics/`: (a) all three baseline plan snapshots (triggers, expiry timestamps, MFE/MAE); (b) actual session path: the exact time price crossed each plan's trigger vs. when the plan expired; (c) regime labels vs realized session character (RANGING label on a trend day); (d) timestamps of all 12 "MARKET CLOSED" suppression events — if ANY fired during 09:15–15:30 IST, flag as live P0.1 evidence.
- Deliver the **TRIGGER-GEOMETRY & LIFECYCLE OPTIONS MEMO** (owner decision input, ≤2 pages): using the case study + the earlier 6/6 STALE_TRIGGER evidence, lay out options with pros/cons and the specific numbers from real days for: (1) entry placement model — displaced breakout entry vs pullback/retest entry vs regime-conditional; (2) trigger lifecycle — fixed time-expiry vs re-arm-on-retest vs rolling revalidation; (3) staleness window length; (4) regime gating rules (what may fire in RANGING vs TRENDING vs EXPIRY_DAY). NO recommendations disguised as defaults — options with evidence, owner decides.
Checkpoint M0: docket evidence + acceptance results + case study + memo.

## PHASE M1 — P0.1 + P0.2 (financial truth on the signal surface) — ~2 sessions
Scope (per the master fix doc §4.1 + schema-drift section):
- P0.1: only `marketStatus.marketOpen === false` from a current trusted response renders market-closed. Missing/stale/loading/error → neutral degraded state. Remove deprecated closed-by-default fallbacks. Tests: 09:14 / 09:15 / 12:00 / 15:29 / 15:30 / holiday / special session / missing response / stale cache. If M0 found in-session suppressions, those exact timestamps become regression cases.
- P0.2: `/api/options/signals` returns HTTP 200 on degraded states with `marketStatus` / `setupState` / `dataQuality` / `warnings` / `blockingReasons`; execution fields preserved end-to-end; `contractInstrumentToken` harmonised across DB/Zod/OpenAPI/TS/tests IN THE CODE LAYER (no prod column renames).
Checkpoint M1: tests + typecheck + before/after API samples.

## PHASE M2 — DRIFT RECONCILIATION (unblocks merge/deploy) — ~1–2 sessions
Scope: origin-story inventory of all drift items re-verified against post-recovery reality; TS declarations matching live DB byte-for-byte; `drizzle-kit push` diff = ZERO pending; deployment-env audit (REASONING_WRITER_V2_ENABLED and every writer-read env var present in the Publish deployment config). Closing sub-step: ENV-ISOLATION — provision `nsescanner_test`, add `.env.test`, retire the `!includes("dummy")` idiom in the 17 test files. Owner-side password rotation coordinates here.
Checkpoint M2: empty diff pasted + env audit + first successful merge/Publish. DRIFT-P0 lifts.

## PHASE M3 — PAPER_WRITER DISCIPLINE (the trade path becomes trustworthy) — ~2 sessions
Scope (as previously ruled): `transitionExecutionStatus(fingerprint, from[], to, writerId)` — compare-and-set at SQL level, permission matrix + legal transitions enforced inside it, all four writer sites converted, no app-level read-then-write on execution_status anywhere; TRIGGERED_CLOSED stamp on the paper close path; DB-read validation against closed unions with warn-logging (fingerprint + raw value + writerId); fingerprint widening to varchar(64) full-hash for new writes + comment fix. **VIX rider:** add `VixSnapshot.level`, populate in loadVixSnapshot, fix optionSignals.ts:3191 to write level not intradayPct, 5–80 sanity gate, explicit-NULL + data_quality annotation for VIX-unavailable; denominator = post-cutover rows.
Checkpoint M3: tests (including race-simulation tests for the compare-and-set) + typecheck.

## PHASE M4 — OWNER DECISION GATE (no code)
Owner selects, from the M0 memo: entry model, trigger lifecycle, staleness window, regime gating rules. Decisions recorded in PRD verbatim. This gate is scheduled DURING M1–M3 build time so it never blocks the critical path — memo lands at M0, decision due before M5 starts.

## PHASE M5 — P1.2: THE REAL EMITTER + FIRST TRADE — ~3–4 sessions
Scope:
- Build the production TREND_CONTINUATION writer to the master doc §15 contract (regime eligibility, trigger transition not state, confirmation, volume, bias alignment, HTF veto, invalidation, cooldown, dedup, time-of-day, expiry handling, confidence formula, minimum data quality, tier, skip reasons) — implementing the OWNER'S M4 decisions for entry/lifecycle/regime, not defaults.
- Canonical bias function: ONE path consumed by cards, signals, paper, alerts, reports.
- Regime classifier validation against the M0 case study + trailing sessions; regime-compatible gating (no MR in strong trend, trend rules per owner decision).
- Wire emission → contract selection → sizing → paper execution through the existing (now disciplined) paper path: entry from option tick/ask-mid hierarchy (never spot), dual stop (spot invalidation + premium stop), T1/T2 exits + the mandatory exit set already implemented, all writes through transitionExecutionStatus, full funnel rows with values_tested_json populated.
- One additional setup (VWAP_RECLAIM or EMA_PULLBACK, owner picks at M4) MAY follow in the same phase ONLY after TREND_CONTINUATION's first live signals verify clean end-to-end.
Checkpoint M5: the first real paper trade's COMPLETE trace pasted — funnel rows from candidate to open, option-premium entry, lifecycle transitions, exit, net P&L with cost model — plus full suite green. Sites A/B/C acceptance (open since Step 2) closes here.

## PHASE M6 — EVALUATION SAMPLE — ~5 sessions, passive + daily spot-checks
Scope: run continuously across all three indices. Daily read-only verification: funnel sums, zero fabricated fields, exits firing per rule. NO tuning during the sample window regardless of P&L — the sample's integrity is the product. At 20+ signals / 5+ sessions: deliver the evaluation report (per-setup, per-index, per-regime expectancy after costs; funnel conversion; skip-reason distribution; trigger-hit vs stale rates vs the old baseline).
Checkpoint M6: the report. Owner then makes the first evidence-based tuning decisions — which is the moment the 6–12 month out-of-sample clock officially starts.

---

## EXPLICITLY DEFERRED UNTIL MISSION COMPLETE
/audit panel (P0.4 Step 3) · P1.3 exit-price provenance (EXCEPTION: if M5's exit path would write an ambiguous unit, implement the unit-label column then, minimally) · BUG-53/54 signal cards · Briefing engine Phases 1–4 · Row J/J' · Phases 7/8/9 · all backlog items not named above.

## FAILURE HANDLING DURING MISSION
Live-market incidents: the emergency lane from 2026-07-17 applies (diagnose → minimal pre-approved fix → evidence → resume). Off-path defects: log and continue. If any phase slips >2 sessions past estimate: stop, report the specific blocker, re-plan with owner — do not silently extend.

## DEFINITION OF MISSION SUCCESS
A trade the owner can trust: every number on its trace real, labeled, and reproducible — followed by a sample large enough to start judging the strategy instead of the plumbing. Not "the system is perfect." The system MEASURABLE. Perfection comes from the measurement loop this mission switches on.
