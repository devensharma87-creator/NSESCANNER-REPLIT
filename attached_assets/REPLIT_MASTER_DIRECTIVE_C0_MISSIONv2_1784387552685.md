# REPLIT MASTER DIRECTIVE — C0 CONTAINMENT + F&O COMPLETION MISSION v2
**Issued:** Saturday 18 July 2026 (IST) · **Authority:** Owner (Devendra) · **Binding documents:** this directive, PRD.md, FNO_COMPLETION_MISSION.md, PROJECT_DELTA_REPORT.md, NSESCANNER_SOURCE_BACKUP_DEEP_AUDIT_2026-07-18.md, case_study_2026-07-17.md, the conversation-record PDF.
**Structure:** every phase below follows the four-part standard — Scope · Bright lines · Deliverables · Acceptance evidence. Execute phases strictly in order. One phase = one checkpoint. No work outside the active phase.

---

## 0. PERMANENT BRIGHT LINES (re-registered for this environment; no expiry)
1. **Schema:** only `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` without pre-approval. Anything else (ALTER TYPE, DROP, RENAME, constraints, defaults) requires owner approval BEFORE execution. New tables get same-day Drizzle declarations in `runtimeTables.ts` or proper schema files.
2. **No Publish / no manual `drizzle-kit push`** except at a phase checkpoint with a pasted zero-pending dry-run diff.
3. **No deploys/restarts 09:00–15:30 IST** on trading days. Weekend/off-hours deploys allowed.
4. **No changes to gates, thresholds, vetoes, cooldowns, sizing, or signal/paper logic** without an owner ruling recorded in PRD.md. Diagnose-only when in doubt.
5. **No adjacent actions.** Off-scope defects: log in PRD → report → continue. Never fix inline.
6. **Acceptance evidence is literal:** pasted test pass counts, typecheck exit codes, raw psql output, curl responses, screenshots. Claims without evidence are not accepted.
7. **Never fabricate, never fail open, label everything.** Missing/unknown critical data blocks; it never defaults to pass.
8. **The ₹8,00,644.80 paper-cash drift is EVIDENCE.** It must never be "fixed" by a direct balance update. Repair happens only via documented journal corrections after the M2c reconstruction, with owner approval.
9. **Prompts and reports follow the four-part standard.** Anything unevidenced enters as a VERIFY step, not an assumption.

---

## PHASE C0 — CONTAINMENT (execute TODAY, Saturday 18 July; all items pre-approved)

**Scope:** remove live exposure and arm the environment for Monday. No feature work, no refactors, no tuning.

**Deliverables (in order):**
- **C0.1 Disable public mode.** Site fully behind owner authentication. Evidence: anonymous curl to 5 representative GET routes (paper account, trades, reports, admin/subscribers, system status) each returns 401/403; screenshot of the site prompting for login.
- **C0.2 Secrets rotation batch.** Rotate: APP_ACCESS_PASSWORD; `nse` database password (update run_apiserver/run scripts, .env, drizzle config); session secret (then invalidate all sessions); Telegram bot token; Kite API secret regenerated in the Zerodha developer console if feasible today (else scheduled Monday pre-open with owner). Delete `memory/test_credentials.md` and any other plaintext-credential file from the repo (rotation renders git history harmless — no history rewrite required, note this in the migration log). Evidence: old DB password rejected (psql auth failure pasted); old app password rejected; session cookie invalidated; file deletion commit hash.
- **C0.3 Disable legacy swing auto-open.** `runEquityPaperTradingTick` / the paperTradingEq auto-open path behind a named flag `SWING_AUTO_OPEN_ENABLED=false` (default false) or a hard guard. Evidence: code diff + a dry tick log showing the path short-circuits with a persisted/logged reason.
- **C0.4 Hard-block all F&O auto-open** behind a named flag `FNO_AUTO_OPEN_ENABLED=false` (explicit, not the current accidental zero). Evidence: diff + guard log line.
- **C0.5 Interim session gate on schedulers.** Signal sweep + alert emission + baseline broadcast skip entirely when the market calendar says the exchange session is closed (weekends, holidays, outside 09:15–15:30). ~10-line guard using the existing calendar service; the full session service comes in M1. Evidence: with today being Saturday, a manually-invoked sweep logs `SKIPPED_SESSION_CLOSED` and emits nothing; no new signal rows dated 2026-07-18 after the guard lands.
- **C0.6 Immutable snapshot BEFORE anything else touches paper data.** pg_dump (or equivalent) of: paper accounts, paper_trade_fo, paper_trade_eq, positions, charges, capital events, audit/event rows, option_signal_history, fno_signal_reasoning; plus deployed commit SHA and env inventory (values redacted, keys listed). Stored under a dated forensics path, checksum recorded. Evidence: file path + SHA-256 + row counts per table.
- **C0.7 Product banner.** Visible on all pages: "Analysis mode — automation suspended — data provenance limits apply." Evidence: screenshot.
- **C0.8 Instrumentation flag ON.** `REASONING_WRITER_V2_ENABLED=1` in BOTH workspace env AND the deployment config (artifact/deploy toml or Replit deployment secrets). Restart (weekend window). Evidence: env values pasted from both scopes; one probe write showing the 9 instrumented columns populated; boot trace clean.
- **C0.9 Commit the binding artifacts** into `/memory/`: PROJECT_DELTA_REPORT.md (owner will re-supply if absent), NSESCANNER_SOURCE_BACKUP_DEEP_AUDIT_2026-07-18.md, this directive. Append a C0 entry to REPLIT_MIGRATION_NOTES.md. Evidence: committed file list + hashes.

**C0 exit condition:** no autonomous open can occur by construction; sensitive routes authenticated; secrets rotated and verified dead; snapshot exists; Saturday-signal class impossible; Monday will run instrumented.

---

## WEEKEND WORK (after C0 checkpoint, same weekend)

- **W1 — Candle backfill (pre-approved).** Kite historical API (entitlement confirmed): 15-min OHLC, NIFTY/BANKNIFTY/SENSEX, ~90 sessions, ~84 REST calls at ≤3 req/s, provenance `source='KITE_HISTORICAL_BACKFILL_2026-07-18'`. Evidence: per-index row counts + date ranges.
- **W2 — M0-B trigger-geometry study.** Replay 3 entry models (displaced-breakout / pullback-retest / regime-conditional) × staleness-window variants (fixed expiry vs re-arm-on-retest vs rolling revalidation) over the backfilled 90 sessions × 3 indices. Output: descriptive statistics per model per regime (trigger-hit vs stale rate, MFE/MAE post-trigger, time-to-trigger distribution). **No ranking, no recommendation — owner decides.** Evidence: stats tables + the ≤2-page options memo for the M4 decision.
- **W3 — M2a residue.** (a) Resolve the eodReconciliation conflict: does THIS repo's `eodReconciliation.ts` write a `reconciliation_report` table (audit says yes on the backup; R0 grep said no here)? If yes → declare it in runtimeTables.ts same-day. (b) Paste a fresh `drizzle-kit push` dry-run: must be zero pending. Evidence: grep output + dry-run diff.
- **W4 — F-27 suppression log audit.** What did the direction-independent cooldown actually suppress Jul 15–18? Evidence: log/DB extract per suppression with timestamp, detector, direction.

---

## MISSION v2 SEQUENCE (post-weekend; one phase per checkpoint)

| Phase | Sessions | Scope | Hard dependency |
|---|---|---|---|
| **M1** | Mon–Wed | P0.1 market-state truth + ONE exchange-session/calendar service (replaces every fragmented weekend/holiday/IST check; owns event calendar incl. F-32's dates verified vs official RBI schedule; fixes pre-market n-2 weekend bug) + suppression-event persistence + **regression case: the 2026-07-18 16:21 Saturday signal must be impossible** + P0.2 signals API degraded-state contract | C0 |
| **M2b** | ~2 | **Contract-identity service:** exact expiries from the live Kite/NFO contract master; delete weekday arithmetic from optionSignals, DTE, force-close, IV snapshots, backtest; no exact match → `BLOCKED_CONTRACT_NOT_FOUND` (never silent next-contract substitution); persist expiry_source, master_as_of, instrument token per signal; CI drift check vs next 8 listed expiries. Acceptance anchored to reality: NIFTY Tue, BANKNIFTY Tue, SENSEX Thu per the live master | M1 calendar |
| **M2c** | ~2 | **Ledger truth:** append-only balanced journal (seed/deposit/withdraw/deploy/settle/P&L/fee/adjustment); atomic open-close-settle; ONE canonical reconciliation (retire or subordinate eodReconciliation); versioned effective-dated cost model used everywhere; read-only reconstruction of the ₹8L drift to its first bad event, categorized | C0.6 snapshot |
| **M3** | ~2 | PAPER_WRITER discipline (SQL compare-and-set transitionExecutionStatus; TRIGGERED_CLOSED stamp; closed-union read validation) + VIX rider (VixSnapshot.level; fix optionSignals vix write; 5–80 sanity; explicit-NULL contract) + **fail-closed ExecutionDecision contract** (critical identity/quality/risk/economics gates: UNKNOWN→BLOCK; advisory-only may pass labeled) + durable net-equity risk latches in DB + F-27 rebuilt durable with persisted canonical skip reasons | M2b, M2c |
| **M4** | 0 (owner) | Owner decision from the W2 memo: entry model, trigger lifecycle, staleness window, regime gating. Recorded verbatim in PRD | W2 |
| **M5** | ~3–4 | Real TREND_CONTINUATION production emitter to the doc-§15 contract implementing the M4 decisions; canonical bias function (one path for cards/signals/paper/alerts/reports); wire emission→contract→sizing→paper execution through the disciplined path (option-premium entry hierarchy, dual stops, mandatory exits, full instrumented trace). **First honest paper trade.** Sites A/B/C acceptance closes | M1, M2b, M2c, M3, M4 |
| **M6** | ~5 | No-touch evaluation: 20+ signals across 3 indices; daily read-only verification; zero tuning regardless of P&L; expectancy report (per setup/index/regime, net of versioned costs) + M5-B historical replay through the Stage-4 engine with provenance labels as corroboration | M5 |
| **Post-mission** | batch | Audit Phase-3 presentation truth: scanner grade = weakest input; report scopes + drawdown vs peak net equity; options education/payoff corrections; canonical health/readiness snapshot; bounded coverage metrics; universe eligibility + authoritative sectors; F-37 wire-or-rename | M6 |

---

## STANDING RULINGS (already decided — do not re-ask)
- **F-32 event blackout:** retained; hardcoded calendar condemned — must consume M1's calendar service with RBI dates verified against the official schedule **before 6 Aug 2026**, else flag OFF.
- **F-27 cooldown:** provisionally ratified; non-compliant as built (process-local, restart-reset, no persisted reason); rebuilt to standard in M3. W4 log audit owed.
- **F-37:** ratified as diagnostic-only; rename so "gate" stops overclaiming; wire-or-retire decided post-mission.
- **BUG-53/54 signal cards:** sequenced after P1.3-class exit-price provenance work; spec already in PRD; ETA field removed; data_source + freshness load-bearing.
- **Historical rows stay dirty** (VIX, taxonomy, ledger) with documented cutover dates; no retro-mapping, no backfill of legacy rows without separate approval.
- **Reporting language:** UNMAPPED counts are the honest taxonomy metric; funnel counts must sum; gaps are annotated, never hidden.

## MONDAY 20 JULY RUNBOOK (before 09:15 IST)
1. Kite login via the OAuth forwarder; verify session row persisted + KiteReadiness green BEFORE open.
2. Confirm C0 flags state: SWING_AUTO_OPEN=false, FNO_AUTO_OPEN=false, REASONING_WRITER_V2=1, public mode off, banner visible.
3. No deploys after 09:00. M1 work proceeds on the branch during the session; any deploy waits for 15:30.
4. 11:30–14:00: 60-second Row K in-session rate re-probe (3 req/s, abort on first 429) to promote Row K from FEASIBLE-off-hours to ACTIVE.
5. Evening: M1 checkpoint evidence + first instrumented-Monday funnel query (closes P0.4 Step 2 on the combined sample).

## COMMONLY-MISSED CHECKLIST (verify your sent prompt covers every line)
[ ] Session-secret rotation followed by session INVALIDATION (rotating without invalidating leaves live cookies)
[ ] Flag set in the DEPLOYMENT config, not just workspace env (the Emergent lesson)
[ ] Snapshot taken BEFORE any ledger/auth change, checksummed
[ ] "Old credential rejected" negative tests, not just "new one works"
[ ] Saturday 2026-07-18 16:21 signal as a named regression fixture in M1
[ ] eodReconciliation/reconciliation_report conflict resolved with grep evidence
[ ] F-32's 6-Aug deadline registered; F-27 log audit delivered
[ ] Backfill rows provenance-labeled; study reports statistics, not a winner
[ ] The ₹8L drift reconstruction is read-only; correction only via approved journal entries
[ ] Kite API key/secret exposure noted; regeneration scheduled if not done in C0.2
[ ] PROJECT_DELTA_REPORT.md actually committed (owner re-supplies if the agent lacks it)
[ ] No gate/threshold value changed anywhere in C0–M3; M4 is where trading parameters get decided, by the owner
