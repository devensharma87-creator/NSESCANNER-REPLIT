# Phase 1–7 Sequenced Remediation Plan — 2026-07-20

**Authority:** Superseding Phase 0 prompt §9, §12(9)  
**Status:** DESIGN AND PLAN ONLY — no Phase 1 execution in this run  
**Precondition:** All Phase 1 work requires explicit owner approval after Phase 0 review.

---

## Phase 0 Completion Criteria (Before Phase 1 Starts)

| Criterion | Status |
|-----------|--------|
| C0 hard blocks unchanged | MET |
| Evidence manifest created | MET |
| P0-D provenance gates implemented | MET |
| P0-A TradeAdmissionDecision boundary | MET |
| P0-C test isolation guard | MET |
| P0-G historical detector | MET |
| Branch isolation | NOT MET (Replit blocker — owner must create separately) |
| TEST_DATABASE_URL provisioned | NOT MET (owner action required) |
| Tests run on new code | NOT MET (typecheck + test run required) |
| F&O balance drift resolved | NOT MET (owner decision required) |
| Six deleted rows classified | NOT MET (owner decision required) |
| Equity contamination classified | NOT MET (owner action required) |
| BANKNIFTY/SENSEX expiry official source | NOT MET (owner action required) |
| Holiday calendar official source | NOT MET (owner action required) |

---

## Phase 1: Foundation — Session, Provenance, Ledger Hardening

**Preconditions:**
- Owner approved Phase 0 review
- TEST_DATABASE_URL provisioned
- F&O balance incident owner-classified
- Equity test contamination classified

**P1-A: Canonical Session Service**
- Implement `canonicalSessionService.ts` with half-open boundaries
- `isWithinExchangeSession(date: Date): SessionDecision` — half-open [09:15:00, 15:30:00)
- Block 15:30:00–15:30:59 explicitly (BOUNDARY_EDGE)
- Integrate official NSE/BSE holiday calendar (official circular required first)
- Return `SESSION_CLOSED` with reason (WEEKEND/HOLIDAY/AFTER_HOURS/PRE_OPEN/BOUNDARY_EDGE/UNKNOWN)
- Fail closed when calendar data is absent or stale

**P1-B: Writer-Boundary Session Gate**
- Add canonical session check to `openPaperEquityTrade()` at the admission boundary
- Make `TradeAdmissionDecision` fully async with all gates wired
- Tests: Saturday, Sunday, official holiday, after-close, pre-open, boundary edge, special session unknown

**P1-C: Timestamp Separation Schema Migration**
- Design (not apply) schema migration adding to `paper_trade_eq` and `paper_trade_fo`:
  - `signal_triggered_at` (from signal source, external, untrusted)
  - `server_received_at` (server wall clock at signal receipt)
  - `decision_at` (server wall clock at admission decision)
  - `db_created_at` (database DEFAULT NOW())
  - `writer_version`, `build_sha` (already partially present)
- Apply ONLY to test database initially; prod via Publish diff propagation

**P1-D: GET/HEAD Read Purity**
- Remove `ensureDailyReset()` from GET handler paths
- Move to explicit authenticated POST command and idempotent scheduler
- Integration test: representative GET requests cause zero DB writes

**P1-E: Kite Instrument Master Gate**
- Warm the Kite instrument cache before any FO paper trade open
- Verify `contractGrade === "instrument_master"` (CONTRACT_NOT_TRADE_GRADE gate now in place)
- Test: cold cache → blocked; warm cache → admitted (through remaining gates)

**P1-F: TEST_DATABASE_URL Integration**
- Convert all DB-backed tests to use `requireIsolatedTestDb()`
- Run full api-server suite against isolated test DB
- Verify 0 DB-backed tests reach operational DB

**Deliverable:** Green test suite on isolated DB, canonical session service, all writer-boundary gates active.  
**Estimated scope:** 5–8 days  
**Owner gate before Phase 2:** Review test results, balance incident classification, 10 clean paper sessions observed.

---

## Phase 2: Data Truthfulness and Source Honesty

**P2-A: PCR/OI Missing-Data Semantics**
- Return `null` (not 0) when PCR denominator is zero or OI data missing
- Label GEX outputs with model assumptions, sign convention, OI source

**P2-B: Single Canonical Market Snapshot**
- One shared snapshot per 60-second tick
- All tabs (Home, Portfolio, Charts, F&O, Swing) read the same snapshot
- No independent re-fetches under the same label without declaring different source/time

**P2-C: Swing Levels Migration to Kite Historical**
- Migrate `computeSwingLevels()` from Yahoo daily candles to Kite candle warehouse
- Set `levelsSource = "kite"` only when Kite candles used
- `LEVELS_NOT_TRADE_GRADE` gate will then allow opens for Kite-grade levels

**P2-D: Scanner Row-Level Provenance Display**
- Implement `isTradeGradeScannerRow()` in `scanner.tsx` using `row.rowSource.canDriveSignals`
- Show per-row source badge (Kite/Yahoo/Stale/Unknown)
- Remove broad Kite-offline flag in favour of row-level provenance

**Deliverable:** Truthful data labels across all tabs; swing opens possible with Kite levels.  
**Owner gate before Phase 3:** Review Telegram output for no fake-zero narratives; swing signal backtest with Kite levels.

---

## Phase 3: Capital Conservation and Reconciliation

**P3-A: F&O Balance Drift Resolution**
- Owner-classified root cause investigation
- Full account EOD reconciliation: seed + capital events + closed P&L + charges = balance
- Never announce "all consistent" unless full reconciliation passes

**P3-B: Stale-Open Settlement State Machine**
- Explicit `PENDING_CLOSE` state for positions when market closed
- `sweepStaleOpenPaperTrades()` returns deployed capital; no fabricated fills
- Sleep-through-15:20: safe deferred close on next session open
- Capital conservation property tests for all 8 scenarios (§6.5)

**P3-C: Full EOD Reconciliation Service**
- Compare: balance = seed + Σ capital_events + Σ closed_pnl + Σ charges − Σ open_deployed
- Run post-market, result stored with timestamp
- Alert if balance diverges by > ₹1 from expected

**Deliverable:** Balance consistent across all sessions; no mystery drift.  
**Owner gate before Phase 4:** 20 consecutive clean reconciliation passes.

---

## Phase 4: Durable Scheduler and Telegram

**P4-A: Worker Heartbeat and Job Runs**
- Persist heartbeat every 60 seconds to `worker_heartbeats` table
- `job_runs` table with start/end/result/exception per scheduled job
- Bounded catch-up after sleep/restart (max 1 missed job per queue)

**P4-B: Telegram Calendar and Session Awareness**
- No pre-market report on weekends or holidays
- No post-market report if session did not open
- Explicit MARKET_CLOSED / NO_DATA / STALE / DEGRADED / BLOCKED labels
- Durable dedup (already partially present via `daily_report_runs`)

**P4-C: Signal Gap Root Cause**
- With durable heartbeat, identify the 15–17 July gap cause definitively
- Replit sleep vs. scheduler bug vs. Kite session expiry — prove with evidence

**Deliverable:** No spurious weekend Telegram alerts; signal gap explained with evidence.

---

## Phase 5: Security Hardening

**P5-A: Kite Session Export**
- Add `requireOwnerStrict` gate or convert to POST-only with owner cookie
- Rate limiting (2 requests / 10 minutes per IP)
- Audit log with redacted token (last 4 chars only)
- Negative auth test: anonymous → 401

**P5-B: Full Security Audit**
- CORS policy review
- All admin/debug routes require owner strict
- Build-info endpoint: no secrets, only build SHA + time + environment

**P5-C: Secret Exposure Assessment**
- Review server logs for any token/secret fragments
- Owner determines if Kite API key rotation is needed

**Deliverable:** Security report clean; no raw broker secrets exposed via API.

---

## Phase 6: Backtest Integrity

**P6-A: Admissibility Rebuild**
- Bar validity: official trading date + session + special session + source provenance
- Report: candidates / admissible / simulated / closed / open/unresolved / rejected reasons

**P6-B: Real-Premium Performance**
- No F&O premium backtest claims without stored, timestamped option-chain history
- Label all synthetic-premium results explicitly

**P6-C: Walk-Forward Windows**
- Mandatory out-of-sample disclosure
- Win rate denominator cannot include unresolved/no-exit cases without disclosure

**Deliverable:** Backtest reports trustworthy for owner review.

---

## Phase 7: UI Professional Presentation

**P7-A: Global Status Strip**
- One compact strip: market/session state, system mode, Kite state, DB state,
  worker heartbeat, canonical snapshot time/age, broker execution state, build SHA

**P7-B: Portfolio Invalid-Record Quarantine**
- Visibly quarantine rows with `WEEKEND_OPEN`, `AFTER_HOURS_OPEN`, `SUSPICIOUS_BATCH_TS`
- Label with reason code; never silently rewrite or delete

**P7-C: Professional Design Pass**
- Only after data contracts are truthful (Phase 2 complete)
- Preserve all features; remove duplicate representations after identifying canonical source

**Deliverable:** Professional, truthful UI with all data provenance visible.

---

## 30-Session Qualification Clock

**NOT_STARTED**  
Cannot start until:
1. F&O balance incident owner-resolved (Phase 3 complete)
2. Equity test contamination classified (Phase 1-F complete)
3. Six deleted rows explicit owner classification
4. Durable worker/session evidence (Phase 4-A complete)
5. Isolated reconciliation passes (Phase 3-C complete)
6. Admission gates verified without C0 change (Phase 1-B complete)

**After clock starts:** 30 consecutive clean sessions of paper trading with  
all gates active, balance reconciled, and no mysterious opens — observed and  
logged with durable heartbeat evidence — before live broker execution is considered.

**Live broker execution requires SEPARATE explicit owner approval** after clock completes.
