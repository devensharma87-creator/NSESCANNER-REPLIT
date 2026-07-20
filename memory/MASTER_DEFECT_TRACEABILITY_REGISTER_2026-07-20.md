# Master Defect Traceability Register — 2026-07-20

**Authority:** Superseding Phase 0 prompt §6, §12(8)  
**Format:** Each defect → source location, evidence, remediation, test, status

---

## D-01: Impossible Equity Opening Timestamps

**Section:** §6.1  
**Source:** Portfolio screenshot + `openPaperEquityTrade()` (`paperTradingEq.ts:192`)  
**Evidence:**
- DLF opened 2026-07-18 16:00:28 IST — Saturday + after close. PROVED
- ADANIGREEN opened 2026-07-14 19:02:54 IST — after close. PROVED
- TITAN/EXIDEIND/GRASIM opened 2026-07-09 23:41:35 IST — impossible time + identical batch. PROVED
- Writer `openPaperEquityTrade()` uses `signal.triggeredAt` for timestamps — LIKELY root cause
- Session gate absent at writer boundary — PROVED (code inspection)

**Remediation:** Phase 1 — canonical session service, writer-boundary session gate  
**Test:** P0 test: Saturday/Sunday/after-close blocked (implementation deferred to Phase 1)  
**Status:** UNRESOLVED — defect confirmed, writer fix deferred

---

## D-02: Market Session Boundary Defects

**Section:** §6.2  
**Source:** Code inspection of `computeMarketStatus()` and FO writer  
**Evidence:**
- Half-open boundary `15:30:00`–`15:30:59` treatment unknown — UNPROVED
- EQ writer lacks canonical session gate — PROVED (no `computeMarketStatus` call in `openPaperEquityTrade`)
- FO writer calls `computeMarketStatus(new Date())` — PROVED, but half-open semantics unverified

**Remediation:** Phase 1 — canonical `isWithinExchangeSession(date)` with half-open [09:15, 15:30) semantics  
**Test:** Tests for `15:30:00` and `15:30:59` — deferred to Phase 1  
**Status:** UNRESOLVED — partially addressed by FO writer but EQ writer gap confirmed

---

## D-03: Writer-Boundary Timestamp and Provenance Controls

**Section:** §6.3  
**Source:** Code inspection  
**Evidence:**
- `signal.triggeredAt` used as database timestamp — PROVED (paperTradingEq.ts:197 uses `signal.signalDate` from signal object)
- Separate immutable fields for signal_time/server_time/decision_time/exchange_quote_time/db_created_time — MISSING schema fields
- TradeAdmissionDecision boundary — IMPLEMENTED this session (P0-A, `tradeAdmissionDecision.ts`)

**Remediation:**  
P0-A: Implemented `evaluateAdmission()` boundary (this session)  
Phase 1: Schema migration to add separate timestamp columns (design only, not applied)  
**Test:** P0 test: `decisionAt` is server clock, not signal time — IMPLEMENTED  
**Status:** PARTIALLY ADDRESSED — boundary type implemented; schema migration deferred

---

## D-04: GET/HEAD Endpoint Impurity

**Section:** §6.4  
**Source:** Audit finding  
**Evidence:**
- `ensureDailyReset()` called from GET handlers (`/api/paper/account`, `/api/paper/positions`) — LIKELY
- Combo GET may remark/persist — LIKELY
- P0-B: Clean separation between reads and writes — NOT IMPLEMENTED this session

**Remediation:** Phase 1 — move `ensureDailyReset()` to scheduled job; add read-purity integration tests  
**Test:** Integration test: GET causes zero DB writes — NOT RUN (requires TEST_DATABASE_URL)  
**Status:** UNRESOLVED — deferred to Phase 1

---

## D-05: F&O Rollover and Stale-Open Settlement

**Section:** §6.5  
**Source:** Audit  
**Evidence:**
- `sweepStaleOpenPaperTrades()` may close OPEN trades without returning deployed capital — LIKELY
- Sleep-through-15:20 scenario: next-day stale sweep may fabricate exit — LIKELY
- F&O drift ₹799,772.70 — may be related — UNPROVED

**Remediation:** Phase 1 — capital conservation property tests, explicit pending-close state  
**Test:** Capital conservation tests — NOT IMPLEMENTED (Phase 1)  
**Status:** UNRESOLVED

---

## D-06: Test Contamination and Unsafe DB Coupling

**Section:** §6.6  
**Source:** Audit + memory entry  
**Evidence:**
- Prior tests reached shared operational DB — PROVED (TESTSTK rows exist)
- `TEST_DATABASE_URL` not provisioned — PROVED
- DB tests inherit `DATABASE_URL` — LIKELY

**Remediation:**  
P0-C: Implemented `testIsolationGuard.ts` (this session)  
Sentinel test implemented in `swingSignals.provenance.test.ts`  
Owner action: provision `TEST_DATABASE_URL`  
**Test:** Sentinel test — IMPLEMENTED but NOT RUN  
**Status:** PARTIALLY ADDRESSED — guard implemented, provisioning pending

---

## D-07: Source Provenance and Single Canonical Data Pipeline

**Section:** §6.7  
**Source:** Comparison matrix  
**Evidence:**
- `isTradeGradeSwingRow()` was absent — PROVED → FIXED this session
- `LEVELS_NOT_TRADE_GRADE` gate was absent from EQ path — PROVED → FIXED this session
- `CONTRACT_NOT_TRADE_GRADE` gate was absent from FO path — PROVED → FIXED this session
- `scanner.tsx` uses broad Kite-offline flag not row-level provenance — PROVED → DEFERRED Phase 1

**Remediation:** P0-D implemented (this session); Phase 1 for scanner.tsx provenance display  
**Test:** `swingSignals.provenance.test.ts` — IMPLEMENTED  
**Status:** PARTIALLY ADDRESSED — writer gates implemented; scanner display deferred

---

## D-08: Contract Identity and Expiry Rules

**Section:** §6.8  
**Source:** Comparison matrix  
**Evidence:**
- BANKNIFTY=Thu (monthly, last Thu), SENSEX=Tue (weekly) — current repo values
- Scratchpad says "reversed" — UNPROVED without official source
- NSE made BANKNIFTY monthly-only in Nov 2024 — per repo comment
- `CONTRACT_NOT_TRADE_GRADE` gate now blocks static_fallback — IMPLEMENTED

**Remediation:** `NEEDS_OFFICIAL_FACT` — no change until official NSE/BSE circular + effective date  
**Test:** Expiry tests for NIFTY/BANKNIFTY/SENSEX — NOT IMPLEMENTED (Phase 1)  
**Status:** UNRESOLVED — awaiting official source

---

## D-09: Official Holiday and Event Calendar

**Section:** §6.9  
**Source:** ZIP vs repo conflict  
**Evidence:**
- ZIP and repo have conflicting 2026 dates — PROVED
- Neither is authoritative without primary source — UNPROVED for both

**Remediation:** `NEEDS_OFFICIAL_FACT` — NSE/BSE circular required  
**Status:** UNRESOLVED — awaiting official source

---

## D-10: F&O Combo Debit/Quantity Arithmetic

**Section:** §6.10  
**Source:** Audit  
**Evidence:** Combo lane: `qty = lots × lotSize`, P&L = `Σ sign·(last−entry)·qty` — per replit.md  
**Remediation:** Dimensional unit tests — deferred to Phase 1  
**Status:** UNRESOLVED

---

## D-11: PCR, OI, GEX Missing-Data Semantics

**Section:** §6.11  
**Source:** Audit  
**Evidence:** Missing PCR denominator may return 0 instead of null — LIKELY  
**Remediation:** Phase 1 — return null/unknown for missing PCR; label GEX assumptions  
**Status:** UNRESOLVED

---

## D-12: Backtest Integrity

**Section:** §6.12  
**Source:** Audit  
**Evidence:** Per `backtest-lab-synthetic-premium` memory entry — premiums are synthetic  
**Remediation:** Phase 2 — rebuild admissibility/coverage/cost disclosure  
**Status:** UNRESOLVED

---

## D-13: Telegram Scheduling and Truthfulness

**Section:** §6.13  
**Source:** Weekend Telegram messages in screenshots; 15–17 July signal gap  
**Evidence:**
- Pre/post market reports sent on weekends — PROVED (screenshots)
- Signal gap 15–17 July — Replit sleep is LIKELY but not PROVED
- PREPOST bot separation implemented — PROVED (per replit.md)

**Remediation:** Phase 1 — durable worker heartbeat, official calendar awareness, bounded catch-up  
**Status:** UNRESOLVED

---

## D-14: Security — Kite Session Export Exposure

**Section:** §6.14  
**Source:** Code inspection of `kite.ts:155`  
**Evidence:** Route bypasses session auth, returns apiKey + accessToken in plaintext — PROVED  
**Remediation:** Phase 1 — add `requireOwnerStrict` or rate-limited password check; negative auth test  
**Status:** UNRESOLVED — no credential rotation this session

---

## D-15: F&O Balance Drift ₹799,772.70

**Section:** §5.2  
**Source:** Prior audit  
**Evidence:**  
- Seed: ₹200,000; Closed P&L: ₹6,508.30; Expected: ₹206,508.30; Actual: ₹1,006,281.00
- Unexplained: ₹799,772.70 — PROVED (arithmetic)
- Root cause: UNPROVED

**Remediation:** Owner-approved ledger incident procedure required  
**Status:** UNRESOLVED_OWNER_CLASSIFICATION — risk base untrusted until resolved
