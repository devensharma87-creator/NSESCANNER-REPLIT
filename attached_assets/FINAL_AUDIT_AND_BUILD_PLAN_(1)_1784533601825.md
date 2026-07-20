# FINAL AUDIT CONCLUSION & MASTER BUILD PLAN
**Market Scanner by Dev — marketscannerbydev.in · Hrishi Associates**
**Date:** Saturday 18 July 2026 (IST) · **Verified by:** independent source inspection of `marketscannerbydev-src.zip` (1,378 TS files — count matches the external audit's manifest exactly)
**Status:** This document closes the audit phase. Building starts from Section 6.

---

## 1. VERIFICATION VERDICT — the external audit is GENUINE and CONFIRMED

Every stop-ship claim was independently re-checked against the actual source tonight. Results:

| Claim | Source evidence found tonight | Verdict |
|---|---|---|
| P0-01 Wrong expiry rules | `optionSignals.ts:72-75`: BANKNIFTY `expiryWeekday: 4 /* last Thu */, monthly`; SENSEX `expiryWeekday: 2 /* Tue */`. Duplicated in `backtest/directional.ts:52-54`. Owner's own Friday screenshots show the LIVE contract master: BANKNIFTY 2026-07-28 = **Tuesday**, SENSEX 2026-07-23 = **Thursday** | **CONFIRMED** — signal path selects/treats wrong contracts; chain pages (which read the real master) are right, which is why the UI looked fine while the engine was wrong |
| P0-02 Swing fills at day-open | `swingSignals.ts:290-291`: `entryPrice = openPrice ?? ltp` — a mid-session signal is filled at 09:15's open | **CONFIRMED** — impossible fills; all swing paper P&L untrustworthy |
| P0-02 Yahoo provenance bypass | `scannerProvenance.ts:7-10` states Yahoo "must NEVER drive scanner signals … or trade decisions"; the swing auto-open path never checks provenance | **CONFIRMED** — the policy exists, the boundary doesn't |
| P0-04 Public-mode auth bypass | `auth.ts:118-122`: `if (isPublicAccessEnabled()) return next();` — total gate short-circuit for every /api/* request | **CONFIRMED** — and the live site banner showed "Public access ON" today |
| P0-04 Secrets in repo | `memory/test_credentials.md` present, 11 credential-keyword hits; PRD.md, STUB_FILES_NEEDED.md also carry connection info | **CONFIRMED** — rotation (C0.2) is the remedy |
| P0-05 Fail-open gates | `paperTradingFO.ts:702-703`: `expectedGrossEdge: null, estimatedCosts: null` passed literally; `:791-800` comment says verbatim "Chain-fetch failure ⇒ FAIL OPEN with warn" | **CONFIRMED** — economics gates cannot function; liquidity gate optional by design |
| P1-05 Sector gate inert | `fullNseScanner.ts:403,480`: every row `sector: "NSE EQ"` | **CONFIRMED** — sector-strength filter is a no-op |
| P1-10/11 Shallow health, drawdown math | `health.ts:7` always `status:"ok"`; `reportsView.ts:1196` divides drawdown by peak cumulative-P&L "equity" | **CONFIRMED** |

**Conclusion of Section 1:** the audit is accepted in full as the platform's defect inventory of record. Nothing in it was exaggerated; several items (expiry, public mode) are corroborated by the owner's own production screenshots.

## 2. NEW FINDING FROM TONIGHT'S PASS (not in the external audit's summary, sharper than its P1-10)

**`reconciliation_report` drift landmine is REAL in this codebase and self-arming.** `eodReconciliation.ts:59` contains `CREATE TABLE IF NOT EXISTS reconciliation_report` and `:165` inserts into it; `lib/db/src/schema/runtimeTables.ts` has NO declaration for it. The earlier R0 grep that reported "not created anywhere" was wrong. Consequence: the FIRST evening the EOD reconciliation job runs on Replit, the table materializes undeclared, and the next `drizzle-kit push` will propose dropping it — the exact landmine class we defused last week, re-armed by a sleeper. **Fix now (5 minutes, pre-approved): add the declaration to runtimeTables.ts today, before any EOD job fires.**

## 3. TELEGRAM EVIDENCE READ (tonight's two notifications)

1. **PRE/POST-MARKET [MANUAL TEST] messages, 20:46/20:47 IST:** "Weekend — markets closed… Broker execution: DISABLED." This is the C0.5 session gate + C0 execution flags **working and observable** — the Saturday-signal class from this morning is now blocked at the source, and the disabled state is honestly broadcast. Good.
2. **⚠️ SYSTEM_MODE_CHANGED: DEGRADED → READ_ONLY (drivers: KITE_SESSION_INVALID, DB_HEALTH_CHECK_FAILED), 20:53 IST:** two drivers, two different meanings. `KITE_SESSION_INVALID` is expected on a Saturday night (token expired / not logged in) — correct fail-safe behavior. **`DB_HEALTH_CHECK_FAILED` at 20:53 is NOT expected and must be run down before Monday**: the most likely cause is the C0.2 password rotation leaving one consumer (the health-check path, a second pool, or a script) on the old credential. Verification item **C0-V1**: identify every DATABASE_URL/credential consumer, confirm all use the rotated password, re-run the health check, and paste the healthy transition (READ_ONLY → normal once Kite logs in Monday). If the DB health check itself is broken, Monday's readiness gating will lie.

## 4. WHAT IS ALREADY DONE (so nothing gets rebuilt or double-fixed)

Instrumentation: 14-column funnel trace live on prod, canonical taxonomy, writer-permission matrix, B8 fabrication class foreclosed, column-width invariant test (caught 2 live overflows), test→prod write guard, quantity→qty fix, run_postgres self-heal fix, 4-table Drizzle declarations (push clean), Kite OAuth forwarder. Contained today (per Telegram + agent reports): public mode off pending final evidence, secrets rotation in progress, swing & F&O auto-open hard-flagged off, session gate on schedulers, immutable snapshot, banner, V2 flag ON. Evidence artifacts: case_study_2026-07-17, Phase-0 data matrix, delta report, this audit.

## 5. THE PRO-TRADER ANSWER ON "MONEY GENERATING MACHINE"

Said once, plainly, because everything downstream depends on it: **no tool generates money — a tool measures edge and enforces discipline; the edge comes from the strategy and the trader.** What this build can honestly promise: (a) signals computed on correct contracts from trade-grade data with every rejection explained; (b) fills, costs, and P&L that reconcile to the paise; (c) a UI that never shows a number it can't source; (d) an evaluation loop that tells you — after real costs, per setup, per regime — whether the edge exists. That is what "money machine" means for a professional: a machine that cannot lie to you about whether you're making money. The audit proved the current system could not answer that question (wrong contracts, impossible fills, ₹8L unexplained cash, gross-as-net). The build below makes it answerable. Profitability itself is decided by M6's data and your M4 strategy decisions — not by any line of code.

## 6. MASTER BUILD PLAN — your 16 requirements mapped, sequenced, nothing dropped

Order is non-negotiable: **truth → engine → presentation.** Polishing the UI before the pipeline is honest would repaint a dashboard over wrong numbers.

**TRACK A — TRUTH (C0 done + this weekend/next week)**
- A1 (today): reconciliation_report declaration (Sec 2) + C0-V1 DB-health rundown (Sec 3) + C0 evidence closeout.
- A2 = M1 (Mon–Wed): exchange-session/calendar service (one service answers: session open? previous/next session? holiday? special session? which session owns this candle?) — kills the Saturday-signal class permanently, fixes pre-market weekend n-2 staleness, becomes F-32's calendar (RBI dates verified vs official schedule, hard 6-Aug deadline); P0.1 market-state truth on every surface; suppression persistence; Saturday-2026-07-18-16:21 as a named regression fixture; P0.2 signals API degraded-state contract. *(Covers your #1 data accuracy, part of #7, #8.)*
- A3 = M2b (~2 sessions): contract-identity service — exact expiries from the live Kite/NFO master everywhere (signals, DTE, expiry-day regime, 14:30 force-close, IV snapshots, backtest); no exact match → BLOCKED_CONTRACT_NOT_FOUND; CI drift check vs next 8 listed expiries. *(Your #7's foundation — signals cannot be "perfect" on wrong contracts.)*
- A4 = M2c (~2 sessions): ledger truth — append-only balanced journal, atomic open/close/settle, capital events in the identity, ONE reconciliation engine (eodReconciliation subordinated to the canonical snapshot), versioned effective-dated cost model, read-only reconstruction of the ₹8L drift to its first bad event. *(Your #1/#8 for accounting; prerequisite for any honest P&L anywhere in the UI.)*

**TRACK B — ENGINE (next week)**
- B1 = M3 (~2 sessions): fail-closed ExecutionDecision contract (critical identity/quality/risk/economics gates: UNKNOWN→BLOCK; audit P0-05 acceptance tests incl. fault injection); PAPER_WRITER SQL discipline; durable net-equity risk latches; F-27 rebuilt durable with persisted skip reasons; VIX-level fix.
- B2 = M4 (owner, no code): entry model / trigger lifecycle / staleness / regime gating — decided from the W2 study memo (backfill + 90-session replay per the pre-approved plan). *(The heart of your #14 "deep thinking in F&O signalling" — this is a TRADING decision and it is yours; the study gives you a quarter's evidence per option.)*
- B3 = M5 (~3–4 sessions): real TREND_CONTINUATION emitter to the §15 contract implementing YOUR decisions; canonical bias function (one path feeds cards, signals, paper, alerts, reports — your #6 for the F&O lane); premium-based fills, dual stops, mandatory exits; **first honest paper trade**.
- B4 — Swing engine rebuild (after B3, ~2–3 sessions): provenance-gated candidates (Yahoo → BLOCKED_DATA_NOT_TRADE_GRADE), trigger-time or next-open documented fill model (kills the day-open fill), risk-budget sizing (risk ₹ / entry-stop distance, not slot division), authoritative sector mapping (kills "NSE EQ"), swing lifecycle state machine per the master doc. *(Your #7 swing half — rebuilt on the same fail-closed boundary as F&O, not patched.)*

**TRACK C — PRESENTATION & PRODUCT (parallel with M6's no-touch sample, ~1–2 weeks)**
- C1 Pipeline unification (#6): one `MarketSnapshot` contract — every tab consumes server-computed snapshots carrying `snapshot_id, source, as_of, market_session, freshness_state`; UI never recomputes its own truth; cross-page snapshot tests assert Option Chain, OI Lab, Trading Desk, Home show the SAME spot/PCR/session for the same snapshot_id. This single change eliminates the "fresh spot here, SPOT_UNAVAILABLE there" class forever.
- C2 Tab consolidation & cleanup (#4, #9, #12): merge duplicate surfaces per the 42→17-page consolidation already scoped (301-redirects, nothing deleted — retired pages archived behind redirects so no feature is lost, your #10/#11/#16); every remaining tab audited against the 46 screenshots for duplicate widgets, dead panels, and inconsistent chips; one provenance-chip system (LIVE/EOD/STALE/UNAVAILABLE/DIAG/MANUAL) everywhere.
- C3 UI upgrade (#5, #13): dark-terminal design system finalized (the option-chain redesign is the reference); density and hierarchy tuned for a trader's eye (levels and provenance first, decoration zero); BUG-53/54 signal cards land HERE — after exit-price provenance is split — with the full field set, live lifecycle states, freshness badges; scanner banner = weakest-input grade (kills the false "KITE TRADE-GRADE").
- C4 Reports/Portfolio truth (#14 portfolio): one filter contract per report (account/strategy/product/gross-net/date-range/timezone/snapshot); drawdown vs peak NET account equity; lifetime-vs-period never silently mixed; portfolio tab reads the canonical reconciliation snapshot only.
- C5 Backtest tab (#14 backtesting): consumes the SAME contract-identity + session services as live (no duplicated weekday tables — deletes directional.ts's copy); provenance columns REAL_CHAIN / BS_MODELLED / SYNTHETIC surfaced per run; M5-B emitter replay becomes the tab's first showcase.
- C6 Charting tab (#14 charting): Stage-5 scope as planned (saved layouts, lower-pane manager, drawing tools, sandboxed Pine-subset import) — sequenced AFTER M6 so it never competes with the money path.
- C7 Telegram suite (#15): pre-market brief and post-market wrap per the approved section-gated briefing spec (each section unlocks only when its source is trusted; MANUAL ✍️ notes; provenance chips in-message); F&O alerts and swing alerts emitted ONLY from the canonical signal path with tier, provenance, and session stamps — the [MANUAL TEST] plumbing that worked tonight becomes the delivery rail.
- C8 Options-education corrections (audit P1-08, part of #2/#8): European exercise, finite long-put max profit, ±2σ labeled as scenario bounds, suggestions gated on liquidity.

**TRACK D — PROOF**
- D1 = M6: 20+ signals / 5+ sessions, zero tuning, expectancy report net of versioned costs per setup/index/regime + backtest corroboration.
- D2 = audit release gates 1–9 as the paper-automation resume bar; gates 10–12 + separate owner approval before any real-money discussion. The audit's 20-session shadow requirement is satisfied BY M6 + the ongoing instrumented sessions.

## 7. FINAL CONCLUSION (deep and plain)

The platform's analysis layer is genuinely good — Friday proved it read a trend day correctly in real time — and its data-honesty architecture (provenance policy, instrumented funnel, fail-loud writers) is ahead of most retail-grade tools. But tonight's verified audit establishes that **the execution half was built on four broken foundations: wrong contract identity, untrusted fills, a non-reconciling ledger, and gates that pass when they cannot prove safety** — plus a public door that bypassed authentication entirely. Every rupee of paper P&L generated to date is unusable as evidence; that is not a tragedy, because near-zero real trades exist — the platform got audited BEFORE the bad foundations could poison a track record. Containment is in and observable. The build order above fixes truth first, engine second, presentation third, proof last; your 16 requirements are all present, none compromised, each in the slot where it can be built honestly. First honest paper trade lands at B3 (~2.5–3 weeks under the phase discipline); the first honest answer to "does this make money" lands with D1 roughly a week after. From tonight, the audit phase is CLOSED. We build.

## 8. IMMEDIATE KICK-OFF DIRECTIVE (send to the Replit coder now)

> **Iteration: A1 — audit closeout + Monday readiness. Scope:** (1) Add `reconciliation_report` to runtimeTables.ts (declaration matching eodReconciliation.ts:59's DDL exactly) — pre-approved; paste declaration + fresh drizzle dry-run showing zero pending. (2) C0-V1: enumerate every DB-credential consumer (pools, scripts, health checks, cron); verify all use the rotated password; identify why DB_HEALTH_CHECK_FAILED fired at 20:53; paste the failing check's error and the healthy re-run. (3) Close C0 evidence: anonymous-curl matrix (5 routes → 401/403), old-credential rejection proofs, snapshot path+SHA-256+row counts, flag states from BOTH workspace and deployment scopes, banner screenshot. (4) Commit this document + the audit into /memory/ and log in REPLIT_MIGRATION_NOTES.md. **Bright lines:** all permanent lines apply; no gate/threshold changes; no UI work; no fixes beyond the two scoped items. **Acceptance:** all four deliverables with literal evidence, then STOP for checkpoint. Weekend continues per the master directive: W1 backfill → W2 study+memo → W3/W4. Monday runbook unchanged: Kite login pre-open, flags verified, M1 kickoff on branch, no deploys 09:00–15:30.
