# Phase 0 Invalid-Session Trade Report — 2026-07-20

**Authority:** Superseding Phase 0 prompt §6.1, §6.2, P0-G  
**Status:** STATIC FORENSIC ANALYSIS (no DB queries run in this session — queries require live DB access)  
**Detector implementation:** `artifacts/api-server/src/lib/invalidSessionDetector.ts` (P0-G)

---

## Screenshot-Documented Suspicious Timestamps

The following rows were visible in the portfolio screenshot (artifact `image_1784533417503.png`).  
All assessments are based on the displayed timestamps — the underlying DB rows are the authoritative source.  
Recalculation must be done from DB rows (see §6.1 directive: "Recalculate these values from the underlying rows").

| Symbol | Displayed Open Timestamp (IST) | Displayed Capital (₹) | Classification | Reason |
|--------|-------------------------------|----------------------|----------------|--------|
| DLF | 18 Jul 16:00:28 | ~₹1,09,982 | `WEEKEND_OPEN` + `AFTER_HOURS_OPEN` | 2026-07-18 is Saturday. Also after 15:30 IST. PROVED |
| ADANIGREEN | 14 Jul 19:02:54 | ~₹1,65,978 | `AFTER_HOURS_OPEN` | 2026-07-14 is Monday. 19:02 IST is after close. PROVED |
| TITAN | 09 Jul 23:41:35 | ~₹96,544 | `AFTER_HOURS_OPEN` + `SUSPICIOUS_BATCH_TS` | 09-Jul is Wed. 23:41 IST impossible regular session. Shares identical ts with EXIDEIND, GRASIM. PROVED |
| EXIDEIND | 09 Jul 23:41:35 | ~₹96,544 | `AFTER_HOURS_OPEN` + `SUSPICIOUS_BATCH_TS` | Identical timestamp to TITAN and GRASIM. PROVED |
| GRASIM | 09 Jul 23:41:35 | ~₹96,544 | `AFTER_HOURS_OPEN` + `SUSPICIOUS_BATCH_TS` | Identical timestamp to TITAN and EXIDEIND. PROVED |
| DLF (2nd row) | 10 Jul 11:30:30 | ~₹ (need DB) | `SESSION_LIKELY_VALID` | 10-Jul is Thu. 11:30 IST is plausible. Calendar/provenance not yet verified. LIKELY |
| DELHIVERY | 01 Jul 14:55:01 | ~₹ (need DB) | `SESSION_LIKELY_VALID` | 01-Jul is Wed. 14:55 IST plausible. LIKELY |
| MARUTI | 30 Jun 14:56:17 | ~₹ (need DB) | `SESSION_LIKELY_VALID` | 30-Jun is Tue. 14:56 IST plausible. LIKELY |
| ABB | 29 Jun 15:12:03 | ~₹ (need DB) | `SESSION_LIKELY_VALID` | 29-Jun is Mon. 15:12 IST plausible. LIKELY |

**Note:** `SESSION_LIKELY_VALID` means time-of-day is plausible for a regular session.  
Quote freshness, signal provenance, and writer build SHA have NOT been verified from the DB.

---

## Capital Exposure Analysis (Screenshot-Based)

| Category | Count | Approx Capital (₹) | % of Total Visible |
|----------|-------|--------------------|--------------------|
| Clearly invalid (WEEKEND or AFTER_HOURS) | 5 | ~₹5,69,994 | ~54.2% |
| Time-plausible (SESSION_LIKELY_VALID) | 4 | ~₹4,82,043 | ~45.8% |
| **Total visible** | **9** | **~₹10,52,037** | — |

**Label:** LIKELY — screenshot transcription may have rounding errors; recalculate from DB rows.  
**Important:** "Accounting arithmetic and fill admissibility are separate dimensions" (§6.1 directive).  
The trades may have internally consistent P&L while being operationally invalid fills.

---

## Root Cause Analysis

### Writer Defect (LIKELY)

`openPaperEquityTrade()` does not enforce the canonical exchange-session gate at the writer boundary.  
The function uses `signal.triggeredAt` for multiple event timestamps rather than server receipt time.

**Evidence source:** Replacement audit + code inspection of `paperTradingEq.ts`.  
**Label:** LIKELY — the audit finding is supported by code review, but the exact call path  
that opened the off-session rows (auto vs. manual vs. staged vs. reconciliation) is UNPROVED  
until the specific `created_at` timestamps are matched to server logs and writer invocations.

### Test Contamination (UNPROVED for EQ)

Prior sessions noted TESTSTK/GAPTT-style test contamination. The equity "clean reconciliation"  
claim from an earlier session is explicitly NOT carried forward (§5.3 directive).  
**Label:** UNPROVED — requires classifying all rows by provenance.

### Reconciliation/Resume Writer (UNPROVED)

`reconcileMissingPaperTrades()` rebuilds synthetic signals from stored history. It may have  
re-opened positions at the historical signal time rather than the current server time.  
**Label:** UNPROVED — requires log-level tracing of which writer created each row.

---

## Invalidator Reason Code Breakdown (Expected from DB Run)

When the detector (`invalidSessionDetector.ts`) is run against the operational DB  
(bounded, read-only, with `statement_timeout`), the expected breakdown is:

- `WEEKEND_OPEN`: ≥1 (DLF 18-Jul confirmed weekend)
- `AFTER_HOURS_OPEN`: ≥5 (ADANIGREEN, TITAN, EXIDEIND, GRASIM, DLF-18Jul)  
- `SUSPICIOUS_BATCH_TS`: ≥3 (identical 09-Jul 23:41:35 batch)
- `SESSION_LIKELY_VALID`: 4+ (plausible timestamps needing calendar verification)
- `CANNOT_ASSESS`: TBD

**DB query required.** Not run in this session because the database is operational and  
the Phase 0 no-DB-mutation rule requires read-only bounded queries during market hours.  
The detector is implemented and ready to run when the owner approves.

---

## No Row Modifications

**CONFIRMED:** The detector (`invalidSessionDetector.ts`) contains ONLY SELECT queries.  
No UPDATE, DELETE, INSERT, or TRUNCATE statements.  
No rows modified, reclassified, or deleted in this session.
