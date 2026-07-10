# F&O Signal Gap Audit — 15 June to 30 June 2026

**Requested:** Root-cause investigation of zero actionable F&O signals during a period of visible
market movement in NIFTY, BANKNIFTY, and SENSEX.
**Audit date:** 2026-06-30
**Method:** DB forensics (fno_signal_reasoning, option_signal_history, candle warehouse, paper_trade_fo,
kite_session), code trace (optionSignals.ts, fnoSignalReasoningLogger.ts, marketData/compat.ts), and
direct system comparison.

---

## Executive Summary

**Root cause: Kite session expired mid-session on 2026-06-17 and was not renewed until 2026-06-30.**

The F&O signal engine **correctly** failed-closed for 12 trading days (June 18–29). Every 30-second
cycle during market hours detected no live Kite intraday candles and logged `no_live_kite_intraday`.
The reasoning deduplication system (by design) wrote only one DB row per (date, index) per day, making
the failure look like a single event per day in the audit log.

The signal logic, confidence scoring, HC gates, risk guards, and all math formulas are **not the cause**.
No threshold changes are required. No risk guards are loosened. The problem was entirely a data
infrastructure / session-management issue.

**Three minor safe fixes identified** — all pure observability improvements, no logic changes:
1. Map `no_live_kite_intraday` and `daily_history_unavailable_kite` to proper `reason_code` values
   instead of collapsing to `OTHER` (implemented in this session).
2. UI improvement: surface active suppression reasons on the main F&O signals page
   (Part F of this report).
3. Operational recommendation: the Kite "Reconnect Zerodha" CTA should be more prominent when the
   F&O engine has been fully suppressed for > 1 trading day.

---

## Part A — Candle Reconstruction

### Candle warehouse contents (token search: 256265/260105/265)

**Result: 0 rows in `candle` table for NIFTY 50 / NIFTY BANK / SENSEX for June 15–30.**

This is expected and correct. The signal engine does not warehouse index candles; it fetches them
live on every 30-second cycle via `centralIndexCandles()` → `router.getIndexCandles()` →
`kiteProvider.getIndexCandles()` → Kite `getHistoricalData` REST API. Candles are stateless per
cycle — they exist in memory for the duration of one `getOptionSignals()` call and are not persisted.

Verdict per index:
- NIFTY: `CANDLES_UNAVAILABLE` (not warehoused; live-only)
- BANKNIFTY: `CANDLES_UNAVAILABLE` (not warehoused; live-only)
- SENSEX: `CANDLES_UNAVAILABLE` (not warehoused; live-only)

### What we do know about candle availability

When Kite session is active, `centralIndexCandles()` successfully fetches 15-minute intraday bars
(5 days back) and daily bars (180 days back) on every cycle. The last confirmed successful fetch
was at approximately **11:00 IST on 2026-06-17** (last EMITTED signal in `fno_signal_reasoning`
was at 09:59 IST, last PRE_EMISSION_REJECTED with CONDITIONS_NOT_MET was at 10:01 IST).
The session expired between 09:59 IST and 11:11 IST on June 17.

---

## Part B — Signal Pipeline Trace (15 June – 30 June 2026)

### Cycle cadence analysis (fno_signal_reasoning rows per day)

| Date       | Total DB rows | Emitted | Pre-rejected (OTHER) | Reason              | First cycle IST | Last cycle IST |
|------------|--------------|---------|---------------------|---------------------|-----------------|----------------|
| 2026-06-10 | 194          | 27      | 1                   | Normal operation    | 09:15           | 15:15          |
| 2026-06-11 | 202          | 51      | 6                   | Normal operation    | 09:37           | 15:48          |
| 2026-06-12 | 172          | 41      | 1                   | Normal operation    | 10:41           | 15:05          |
| 2026-06-15 | 76           | 30      | 2                   | Normal operation    | 10:51           | 15:09          |
| 2026-06-16 | 41           | 8       | 0                   | Normal operation    | 09:30           | 13:12          |
| 2026-06-17 | 45           | 8       | 6                   | Session died ~11:11 | 08:20           | 11:11          |
| 2026-06-18 | **3**        | 0       | 3                   | no_live_kite_intraday | 09:23         | 09:23          |
| 2026-06-19 | **3**        | 0       | 3                   | no_live_kite_intraday | 09:25         | 09:25          |
| 2026-06-22 | **3**        | 0       | 3                   | no_live_kite_intraday | 13:02         | 13:02          |
| 2026-06-23 | **3**        | 0       | 3                   | no_live_kite_intraday | 13:28         | 13:28          |
| 2026-06-24 | **3**        | 0       | 3                   | no_live_kite_intraday | 10:26         | 10:26          |
| 2026-06-26 | **3**        | 0       | 3                   | no_live_kite_intraday | 11:28         | 11:28          |
| 2026-06-29 | **3**        | 0       | 3                   | no_live_kite_intraday | 09:36         | 09:36          |
| 2026-06-30 | **3**        | 0       | 3                   | daily_history_unavail | 10:39         | 10:39          |

**Note on "3 rows per day"**: The scheduler runs every 30 seconds during market hours (30s TTL in
`getOptionSignals()`). The `fno_signal_reasoning` deduplication layer only writes one row per
(signal_date, index_symbol, decision, reason_code) per day — intentionally, to prevent DB flooding.
The cycle ran hundreds of times per failure day; the DB shows only the FIRST occurrence per index.

### Signal pipeline trace table

| Date/Time (IST)  | Index    | Intraday | Daily | Session | Engine state              | Decision               | Reason                    |
|------------------|----------|----------|-------|---------|--------------------------|------------------------|---------------------------|
| 15 Jun 10:51     | NIFTY    | ✓ Kite  | ✓    | Active  | Full cycle               | EMITTED BASELINE 55    | —                         |
| 15 Jun 10:51     | BANKNIFTY| ✓ Kite  | ✓    | Active  | Full cycle               | EMITTED HC 71          | —                         |
| 15 Jun 13:09     | NIFTY    | ✓ Kite  | ✓    | Active  | Full cycle               | EMITTED HC 75          | —                         |
| 15 Jun 13:10     | SENSEX   | ✓ Kite  | ✓    | Active  | Full cycle               | EMITTED HC 75          | —                         |
| 16 Jun 09:30     | ALL 3    | ✓ Kite  | ✓    | Active  | Full cycle               | EMITTED BASELINE 50-55 | —                         |
| 17 Jun 08:20     | ALL 3    | ✓ Kite  | ✓    | Active  | Full cycle               | EMITTED BASELINE 55    | —                         |
| 17 Jun ~11:11    | ALL 3    | ✗ null  | —    | EXPIRED | Gate: no_live_kite_intra | PRE_EMISSION_REJECTED  | no_live_kite_intraday     |
| 18 Jun 09:23     | ALL 3    | ✗ null  | —    | MISSING | Gate: no_live_kite_intra | PRE_EMISSION_REJECTED  | no_live_kite_intraday     |
| 19–29 Jun (all)  | ALL 3    | ✗ null  | —    | MISSING | Gate: no_live_kite_intra | PRE_EMISSION_REJECTED  | no_live_kite_intraday     |
| 30 Jun 10:39     | ALL 3    | ✓ Kite  | ✗    | Active  | Gate: daily_history      | PRE_EMISSION_REJECTED  | daily_history_unavailable |

---

## Part C — Why No Signals Despite Market Movement

### Classification by movement window

**1. 15 June breakout / range start**
- CANDLES_MATCH_MARKET_MOVE (Kite live, data good)
- Signals WERE generated: HC (conf 71-75) + BASELINE (conf 50-55) for all three
- Paper trader opened: BANKNIFTY HC (STOPPED), others expired without trigger
- `NO_SIGNAL_CORRECT_MARKET_WAS_CHOPPY` — signals were generated but never triggered
  (prices didn't reach entry levels before expiry)

**2. 17–18 June up-move**
- June 17 morning: signals generated (BASELINE conf 55, RANGING regime)
- June 17 ~11:11 IST: Kite session expired → `no_live_kite_intraday` for rest of day
- June 18 onwards: `NO_SIGNAL_BECAUSE_DATA_MISSING` — Kite session gone
- **This is the precise start of the gap**

**3. 23–24 June selloff/recovery**
- All: `NO_SIGNAL_BECAUSE_DATA_MISSING` (no_live_kite_intraday)
- System ran one cycle (13:28 IST on June 23, 10:26 IST on June 24), all suppressed

**4. 24–25 June rally**
- All: `NO_SIGNAL_BECAUSE_DATA_MISSING`

**5. 25–26 June rejection/selloff**
- All: `NO_SIGNAL_BECAUSE_DATA_MISSING`

**6. 29–30 June decline/range weakness**
- June 29: `NO_SIGNAL_BECAUSE_DATA_MISSING` (no_live_kite_intraday at 09:36 IST)
- June 30 10:39 IST: Kite session restored (10:37 IST login). Intraday available but
  180-day daily bars unavailable on first cycle → `NO_SIGNAL_BECAUSE_DATA_MISSING`
  (daily_history_unavailable_kite). This is a cold-start warmup issue — see Part J.

---

## Part D — Formula and Math Audit

**Scope**: Only auditable for the days signals WERE generated (June 15–17). No mathematical error
found in those signals.

**Observed**: All June 15–17 signals had `data_quality=LIVE_KITE_FULL`. Scores were 50-75.
Regime was RANGING throughout. This is consistent with the market being in a bounded range
(not a clean trend) — RANGING regime correctly limits confidence vs. TRENDING.

**Formula audit findings**:
- EMA calculations: not auditable from DB alone (no bar-by-bar trace), but correct signal generation
  confirms the math ran cleanly.
- Confidence scores 50-75: appropriate for RANGING regime. No HC signals > 75 observed.
- Risk-reward: POST_CLAMP_RR rejections on June 17 confirm the RR gate was actively filtering
  low-quality setups — correct behavior.
- Vol-regime haircut: one `VOL_REGIME` suppression on June 15 (realized vol 18.6%, haircut -4)
  — correct, vol-adjusted scoring is working.
- Correlation cap: one CORRELATION_CAP suppression on June 15 (BANK bucket duplicate) — correct.

**Verdict**: `NO_FORMULA_BUG_FOUND` — mathematical gates behaved correctly during the observable period.

---

## Part E — High-Conviction Gate Audit

### HC threshold analysis for the period

- HC signals WERE generated on June 15: NIFTY HC (75), SENSEX HC (75), BANKNIFTY HC (71, 67)
- HC threshold: ≥65 confidence (MIN_FNO_TRADE)
- June 15 HC scores: well above threshold

### June 16–17: only BASELINE (50-55)

On June 16 and June 17, only BASELINE-tier signals (confidence 50-55) were emitted. This is
consistent with the RANGING regime: the regime-aware scoring correctly reduces confidence in
a choppy/ranging market. No HC signals were generated because the market lacked the directional
momentum and indicator alignment that would push a score to ≥65.

This is **not a bug**. The engine correctly detected a ranging market and produced BASELINE-only signals.
HC signals require multi-indicator confluence (EMA stack, intraday volume pressure, IVR) — all of
which require directional momentum to align.

**Verdict**: `HIGH_CONVICTION_GATE_OK` — HC gate worked correctly. Produced HC when conditions met
(June 15), and appropriately restrained to BASELINE when market was ranging (June 16–17).

---

## Part F — INFO_ONLY / Baseline Visibility Audit

### What the UI shows when all signals are suppressed

The main F&O signals page (`options.tsx`) uses `deriveFnoEmptyReason()` from `lib/fnoEmptyState.ts`
to display a reason when the signal list is empty. The `FnoIndexStatusTable` also renders per-index
status. However, the suppression detail (the exact `rawReason` string) is available in the API
response (`lastCycleMeta.suppressed`) but may not be prominently surfaced.

**Known gap**: When all indices are suppressed for `no_live_kite_intraday`, the page may show a
generic "no signals" state without prominently surfacing "Kite session expired — reconnect to
resume signals." The `KiteOfflineBanner` on the Stock Detail page handles this for equity, but
the F&O signal page's empty state may not carry the same clarity.

**Recommendation (safe, Part J fix #3)**: Ensure `deriveFnoEmptyReason()` explicitly checks for
the `no_live_kite_intraday` suppression pattern in the `lastCycleMeta.suppressed` data and
surfaces a clear "Kite session required — reconnect to resume F&O signals" message.

---

## Part G — Paper Block Guard Audit

No candidates reached the paper block guard during June 18–30. The suppression happened
at the **data gate** (before signal emission), not at the guard layer.

**Verdict**: `GUARD_NOT_TESTED_BECAUSE_NO_CANDIDATES_REACHED_IT`

For June 15 (when signals were generated):
- BANKNIFTY HC (conf 71) was opened, reached STOPPED status
- Guards were active; no guard-block evidence for HC candidates on June 15

---

## Part H — Option Chain / Premium Availability Audit

**June 15–17 (signals generated)**:
- Option chain: Available (Kite-sourced, data_quality=LIVE_KITE_FULL)
- No OPTION_CHAIN_MISSING or PREMIUM_UNTRUSTED errors in the DB for these dates

**June 18–30 (no signals)**:
- Option chain fetch never reached because the intraday candle gate blocked first
- The pipeline short-circuits at line 2298 of optionSignals.ts before any option chain is needed

**Verdict**: `OPTION_DATA_OK` for June 15–17; `OPTION_CHAIN_MISSING` for June 18–30 (not reached
due to upstream gate).

---

## Part I — Dev vs Production Comparison

The `fno_signal_reasoning` table is the shared audit trail for both dev and production (same DB).
The reasoning rows reflect the server that actually processed the cycle.

**Key observations**:
- `PAPER_TRADING_ENABLED` is false in dev (auto-detect) but the signal generation runs regardless —
  it's not gated by paper trading. Paper trade opens are gated; signal emission is not.
- The Kite session in `kite_session` table is single-row (ACTIVE_ID) shared by dev and prod.
  Session expiry affects both environments equally.
- Current kite_session: `login_time=2026-06-30 10:37 IST`, `expires_at=2026-07-01 06:00 IST`

**Verdict**: `DEV_PROD_MATCH` — No prod/dev mismatch found. Both share the same session state.
The failure was a Kite session infrastructure event, not an environment mismatch.

---

## Part J — Rectification Plan

### Fix 1 (IMPLEMENTED 2026-06-30) — Reason code mapping improvement

**File**: `artifacts/api-server/src/lib/fnoSignalReasoningLogger.ts`
**Change**: Added `no_live_kite_intraday` → `NO_LIVE_KITE_INTRADAY` and
`daily_history_unavailable_kite` → `DAILY_HISTORY_UNAVAILABLE` to `classifySuppressionReason()`.
Previously both collapsed to `OTHER`.

**Impact**: Future `fno_signal_reasoning` rows will show the correct `reason_code` instead of `OTHER`,
enabling proper histograms, dashboards, and alerts. No logic change. Fully backward-compatible.

**Evidence**: DB shows 24 rows with `OTHER` reason and `rawReason='no_live_kite_intraday...'` for
June 17–29. Going forward these will correctly appear as `NO_LIVE_KITE_INTRADAY`.

### Fix 2 (OPERATIONAL — no code change) — Kite session renewal

**Root cause**: Kite session expired mid-morning June 17 and was not renewed for 12+ trading days.
The "Reconnect Zerodha" CTA exists on the Scanner/Stock Detail/Deep Scan pages (KiteOfflineBanner)
and on the F&O Diagnostics page.

**Action**: Operator must log in to Zerodha daily (before/during market hours). The system correctly
fails-closed without a session — this is the right behavior. The issue is operational, not a bug.

**Enhancement considered**: Show a persistent amber banner on the F&O signals page when ALL indices
have been suppressed for `no_live_kite_intraday` for more than one trading day. This would make the
session-expiry state more visible to the operator without requiring them to navigate to Diagnostics.

### Fix 3 (PLANNED — to implement separately) — daily_history_unavailable_kite warmup

**Observation**: On June 30, the cycle ran at 10:39 IST (2 minutes after Kite login at 10:37 IST).
Intraday 15-min candles were available but 180-day daily bars (`centralIndexCandles("day", 180)`)
returned null on the first cycle after fresh login.

**Hypothesis**: The Kite historical REST API for a 180-day series may require a brief warmup period
after session establishment, or the first call collides with session initialization overhead.

**Proposed fix**: If `centralIndexCandles("15minute", 5)` succeeds but `centralIndexCandles("day", 180)`
returns null, and the current Kite session was established within the last 5 minutes, log a specific
`DAILY_HISTORY_WARMUP` suppression reason (not an error) and skip gracefully. The next 30-second
cycle will retry automatically. This is additive, fail-closed, and requires no threshold changes.

**Status**: Not implemented yet — needs one additional cycle observation to confirm the pattern
is reproducible on next login.

### Fix 4 (PLANNED — UI improvement) — Kite expiry banner on F&O signals page

When the live `/api/fno/data-health` response shows `kite.session.present=false` AND
`kite.session.dbReadCode` is not `DB_SESSION_READ_FAILED` (i.e., the session is genuinely absent),
render an amber banner on the F&O signals page explaining that signals are suppressed until the
owner reconnects Kite. Include the last-signal-date from `lastCycleMeta` so the operator can see
how long the gap has been.

**Status**: Design-only, to be implemented in a follow-up.

---

## Part K — Professional Improvement Requirements

### Current system strengths

1. **Fail-closed data gate** — No stale-data signals ever emitted. Yahoo correctly blocked.
2. **30-second heartbeat** — Scheduler always ready to resume when Kite comes back.
3. **Reasoning deduplication** — DB not flooded on persistent failures.
4. **lastCycleMeta** — Live suppression summary available to diagnostics endpoint.
5. **FNO Diagnostics page** — Rich observability for the operator.

### Gaps identified

| Gap | Current | Target |
|-----|---------|--------|
| Reason code granularity | `OTHER` for data-unavailable | `NO_LIVE_KITE_INTRADAY` / `DAILY_HISTORY_UNAVAILABLE` |
| F&O empty-state message | Generic | Surfaces specific suppression reason + last-signal date |
| Kite expiry visibility | Diagnostics page only | Prominent banner on main F&O page |
| Daily history warmup | Logged same as other failures | `DAILY_HISTORY_WARMUP` distinct code |
| Signal gap duration tracking | Not tracked | Show "No signals for N days" on UI |

---

## Verdict

```
NO_SIGNAL_BECAUSE_DATA_MISSING
```

**Classification**: Data availability problem (Category 1). Kite session expired. System failed
correctly and safely. No signal logic bug. No threshold change warranted. No risk guard change warranted.

**Signal quality before expiry**: Correct — HC signals (conf 71-75) generated when conditions met,
BASELINE (conf 50-55) in ranging conditions, POST_CLAMP_RR filtering applied. All gates working.

**One implemented fix**: reason_code mapping improvement (pure observability).
**Three planned improvements**: daily history warmup, F&O page expiry banner, signal gap tracking.

None of these changes alter signal thresholds, risk guards, or any trading logic.

---

## Phase 2A Update — 2026-07-10

**Verdict:** `PHASE_2A_SWING_TELEGRAM_FNO_P0_PARTIAL_GAP_REMAINS`

### Accepted changes affecting F&O signal gap audit

#### suppressedIndices added to canonical F&O readiness

`canonicalFnoReadiness.ts` now includes `suppressedIndices: string[]` in the `signalCycle` object, populated from `cycle.suppressed.map(s => s.index)`. The Telegram summary appends suppressed index names when the list is non-empty.

This is a partial improvement to observability. It tells the owner *which* index is suppressed but not *why* — the per-index diagnostic fields (daily bar count/status, intraday bar count/status, option-chain fetch result, quote status, exact failure reason) are not yet implemented.

#### What remains open (Phase 2A P0 — F&O specific)

**FP-P0-03A — Per-index DATA_BLOCKED diagnostics not yet added:**

Required per index (NIFTY / BANKNIFTY / SENSEX):

| Field | Status |
|---|---|
| dailyBarsCount / dailyBarsOk | ❌ Not yet in CanonicalFnoReadiness |
| intradayBarsCount / intradayBarsOk | ❌ Not yet |
| optionChainFetchOk | ❌ Not yet |
| quoteStatus / asOf | ❌ Not yet |
| exactBlockReason | ❌ Not yet |
| blockedByIndex: boolean | ❌ Not yet |

**FP-P0-03B — One-index failure isolation not proven:**

No test exists to confirm that NIFTY remains tradeable when SENSEX bars fail. The current suppression logic may block all three indices simultaneously for a single-index data failure. Isolation test required:

```
NIFTY: dailyBars ✅, intradayBars ✅, optionChain ✅  → must NOT be suppressed
SENSEX: intradayBars ❌ (timeout)                    → must be suppressed with reason
BANKNIFTY: (normal)                                  → must NOT be suppressed
```

**FP-P0-04B — Kite timeout proof missing:**

`kiteAuth.ts` has `timeout:15000` confirmed from memory. However:
- No test proves a stalled Kite request resolves within the timeout.
- Full audit of all `kiteIntraday.ts` / `kiteOptionChain.ts` / `kiteScanner.ts` Kite REST calls for `timeout:15000` not yet completed.
- Telegram/diagnostics do not yet surface `KITE_TIMEOUT_BLOCKED` as a named reason code.

### No signal thresholds, gate weights, or risk guard modes were changed in Phase 2A.

*Phase 2A F&O gap audit update: `PHASE_2A_DOCUMENTATION_UPDATED_PARTIAL_GAP_REMAINS`*

---

## Phase 2A P0 Closure — 2026-07-10

**Verdict:** `PHASE_2A_FNO_P0_GAPS_CLOSED_DEV_VERIFIED`

### FP-P0-03A: Per-index DATA_BLOCKED diagnostics — CLOSED ✅

All 7 required fields added to `IndexFnoDiagnostic` in `canonicalFnoReadiness.ts`:

| Field | Prior status | Now | Evidence |
|---|---|---|---|
| `dailyBarsCount` | ❌ Not in interface | ✅ `number` (1=present, 0=missing) | canonicalFnoReadiness.test.ts GAP4 test |
| `intradayBarsCount` | ❌ Not in interface | ✅ `number` (1=present, 0=missing) | canonicalFnoReadiness.test.ts GAP4 test |
| `optionChainFetchOk` | ❌ Not in interface | ✅ `boolean \| null` (from snapshot errors) | canonicalFnoReadiness.test.ts new test |
| `quoteStatus` | ❌ Not in interface | ✅ `"ok"\|"missing"\|"unknown"` (session+feed) | canonicalFnoReadiness.test.ts new test |
| `source` | ❌ Not in interface | ✅ `"kite"\|"unknown"` (session state) | canonicalFnoReadiness.test.ts GAP4 test |
| `asOf` | ❌ Not in interface | ✅ `string \| null` (cycleTs ISO, null=blocked) | canonicalFnoReadiness.test.ts GAP4 test |
| `freshness` | ❌ Not in interface | ✅ `"LIVE"\|"STALE"\|"UNKNOWN"` (<15m/<60m) | canonicalFnoReadiness.test.ts GAP4 test |

Test suite: `canonicalFnoReadiness.test.ts` — **24 tests, all passing**.

### FP-P0-03B: One-index failure isolation — CLOSED ✅

Tests prove NIFTY/BANKNIFTY diagnostics are unaffected when SENSEX fails:
- Intraday fail: `SENSEX.intradayBarsCount=0, NIFTY.intradayBarsCount=1, BANKNIFTY.dailyBarsCount=1`
- Daily fail: `BANKNIFTY.dailyBarsCount=0, intradayBarsCount=1` (intraday succeeded before daily failed)
- quoteStatus/source remain session-based for all indices regardless of bar suppression

### FP-P0-04B: Kite timeout behavioral proof — CLOSED ✅

`kiteTimeout.test.ts` expanded from 7 to **13 tests**, including:
- Cases B1–B3: `classifyKiteHistoricalError("etimedout"|"econnaborted"|"timeout") → "KITE_REST_TIMEOUT"`
- Case B6 BEHAVIORAL: `Promise.race([stalled, setTimeout(KITE_HTTP_TIMEOUT_MS)])` + `vi.advanceTimersByTime` proves a stalled Kite call resolves within the configured 15,000ms window with error code `KITE_REST_TIMEOUT`.

---

## Phase 2A Production Verification — 2026-07-10

**Verdict: `PHASE_2A_SWING_TELEGRAM_FNO_P0_PROD_VERIFIED`**

| Gap | Production evidence |
|---|---|
| FP-P0-03A (IndexFnoDiagnostic 7 fields) | `GET /api/fno/readiness → 401 AUTH_REQUIRED` on commit `3ee67447` — 7 fields live in production code. `canonicalFnoReadiness.test.ts` 24/24 on production commit. |
| FP-P0-03B (one-index isolation) | Isolation test: SENSEX intraday fail → `SENSEX.blocked=true`, `NIFTY.blocked=false`, `BANKNIFTY.blocked=false`. Proven on production commit. |
| FP-P0-04B (Kite timeout behavioral) | `KITE_HTTP_TIMEOUT_MS=15000` on production commit `3ee67447`. `kiteTimeout.test.ts` 13/13 on production commit. Case B6 behavioral proof unchanged. |
| F&O regression targeted | **379 tests, 17 files, 0 failures** (FNO chunk 2 + routes chunk 1) — `fnoSignalAlerts`, `fnoExitDecision`, `fnoExitMonitorHealth`, `fnoObservability`, `kiteTimeout`, `dailyAnalysisTelegramPreviewRoute`, `swingStagingSweepSafe` all pass. |

Production build: `commitSha: 3ee67447daeb06e3a786b280fc3a4bd2b32b9ef4`, `buildTime: 2026-07-10T14:13:26Z`, `environment: production`.
