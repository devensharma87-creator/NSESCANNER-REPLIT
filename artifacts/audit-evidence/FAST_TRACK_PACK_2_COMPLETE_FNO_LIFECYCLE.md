# Fast-Track Pack 2 — Complete F&O Lifecycle

**Status:** COMPLETE  
**Date:** 2026-08-01  
**Prompt:** Prompt 20 — Fast-Track Pack 2: Complete F&O Lifecycle  

---

## §1 Scope

Pack 2 covers the complete F&O paper-trading lifecycle:

| Area | Coverage |
|------|----------|
| Market session state | `computeMarketStatus`, `getMarketStatusDetail`, `isNseHoliday`, `buildCanonicalFnoReadiness`, `deriveMarketSessionLabel` |
| Setup availability honesty | `computeIndexFnoSetupAvailability`, `computeAllIndexFnoSetupAvailability`, `OPTION_INDICES` |
| Confluence/veto structural proof | VWAP/volume unavailability policy for all 3 indices |
| Index/contract policy | Per-index setup retirement, NIFTY/BANKNIFTY/SENSEX parity |
| Signal plan immutability | `FNO_EXIT_PRIORITY_RULE`, `SPOT_EXIT_FRESHNESS_WINDOW_MS` |
| Phase A/B admission gates | `computePreliminaryAdmission`, `computeFinalExecutionAdmission` |
| Monitoring/exit decisions | `evaluateFnoPaperTradeExit` (all blocked/hold/exit variants) |
| Charges and P&L | `computeFnoTradeCost`, `FNO_COST_PARAMS`, `FNO_COST_PARAMS_ASOF` |
| Lifecycle reconciliation | Pure-formula equation validator for all 4 invariants |
| UI defects (options.tsx) | P20-D01, P20-D02, P20-D03 |

---

## §2 Intentional Architecture — NOT Defects

### C0 Hard Block
`FNO_AUTO_OPEN_C0_BLOCKED = true` in `paperTradingFO.ts:398`. All F&O paper opens immediately return null, pending M1 exchange-calendar service completion. Comment: *"Lift ONLY after M1 exchange-calendar service is complete."* This is correct per design — not touched.

### Phase B F&O Unconditional Rejection
`computeFinalExecutionAdmission` in `sessionAdmission.ts` lines 518–523: F&O lanes (`nse_fo`/`bse_fo`) always return `TRADE_ADMISSION_CONTEXT_INCOMPLETE` with `quoteProvenance="fno_no_provider_timestamp"`. Root cause: Kite REST option-chain response (KiteQuote) provides no per-contract or response-level exchange/provider event timestamp. Documented in `FNO_EXIT_MONITORING_RELIABILITY_REPORT.md`. Not changed.

---

## §3 UI Defects Fixed (options.tsx)

### P20-D01 — Null changePctDisplay direction (lines 1134–1135)
- **Pre-fix:** `const up = (changePctDisplay ?? 0) >= 0` — `null ?? 0 = 0 >= 0 = true` → always bullish/green when data is missing.
- **Fix:** `const up = changePctDisplay != null && Number.isFinite(changePctDisplay) ? changePctDisplay >= 0 : null` — null is muted/neutral.
- **Classification:** D-167-class (same root cause pattern). Latent — not currently observable on live data but structurally incorrect.

### P20-D02 — MFE/MAE null guard (lines 740–743)
- **Pre-fix:** Single outer `||` guard allowed one null through; `?? 0` fabricated "0.00" for the absent value.
- **Fix:** Individual `!= null` guard on each span — absent value simply omits the element.

### P20-D03 — Toast null target/stop (lines 839–841)
- **Pre-fix:** `(s.optionTarget1 ?? 0).toFixed(2)` and `(s.optionStopLoss ?? 0).toFixed(2)` → "T1 ₹0.00 · SL ₹0.00" fabricated for null.
- **Fix:** `optBlock` built incrementally — T1 and SL parts only included when non-null.

---

## §4 New Test Files

### `artifacts/api-server/src/lib/p20.lifecycleGates.test.ts`
- **89 tests** across 7 describe blocks:
  - `§P20-A Market session state — computeMarketStatus` (9 tests)
  - `§P20-A Market session state — getMarketStatusDetail` (9 tests)
  - `§P20-A Market readiness — buildCanonicalFnoReadiness` (7 tests)
  - `§P20-B Setup availability honesty` (11 tests)
  - `§P20-C Confluence/VWAP policy — structural proofs` (3 tests)
  - `§P20-D Index and contract policy` (4 tests)
  - `§P20-E Signal plan immutability — structural sentinels` (2 tests)
  - `§P20-F Paper admission gates` (7 tests)
  - `§P20-H Monitoring and exit decisions` (13 tests)
  - `§P20-I Charges and P&L` (16 tests)
  - `§P20-L Lifecycle reconciliation equations` (6 tests)

### `artifacts/scanner/src/lib/p20.optionsPageFixes.test.ts`
- **24 tests** across 3 describe blocks:
  - `§P20-D01 Direction derivation` (9 tests)
  - `§P20-D02 MFE/MAE null guard` (7 tests)
  - `§P20-D03 Toast null target/stop` (8 tests)

---

## §5 Gate Coverage

### Gate A — Market Session State
- `computeMarketStatus`: 9 cases covering open (10:00, 15:30 boundary), closed (pre-hours, post-hours, weekend, holiday), pre_open (09:10).
- `getMarketStatusDetail`: 9 cases — all 6 reasons (OPEN, WEEKEND, HOLIDAY, BEFORE_OPEN, PRE_OPEN, AFTER_CLOSE) verified with correct `marketOpen` flag, `isTradingDay`, `exchangeTimezone`.
- `isNseHoliday`: confirmed 2026-01-26 = holiday, 2026-07-06 = trading day.
- `buildCanonicalFnoReadiness`: no session → MISSING, expired session → EXPIRED, active session → ACTIVE.
- `deriveMarketSessionLabel`: holiday → "holiday", pre_open → "preopen".

### Gate B — Setup Availability Honesty
- `computeAllIndexFnoSetupAvailability` returns exactly 9 records (3 indices × 3 setups).
- All 9 have `eligibleForEmission: false` and `scope: "INDEX_FNO"`.
- VOLUME_BREAKOUT: `INDEX_VOLUME_UNAVAILABLE`, missingInputs includes `volumeProfile`.
- MEAN_REVERSION: `SESSION_VWAP_UNAVAILABLE`, missingInputs includes `sessionVwap`; explanation explicitly states "No proxy … is substituted".
- TREND_CONTINUATION_NO_VWAP: `RETIRED_INDEX_FNO_POLICY`, explanation includes threshold "50".

### Gate C — Confluence/Veto
- VOLUME_BREAKOUT explanation mentions "zero volume" as root cause.
- MEAN_REVERSION explanation confirms no VWAP proxy substitution.
- TREND_CONTINUATION_NO_VWAP explanation includes max-conf arithmetic and threshold.

### Gate D — Contract/Index Policy
- `FNO_COST_PARAMS_ASOF = "2026-04-01"` — authoritative rate date confirmed.
- STT_RATE_SELL_PREMIUM = 0.0015 (0.15%, eff. 2026-04-01).
- All 3 indices covered; SENSEX setup structure identical to NIFTY/BANKNIFTY.

### Gate E — Signal Plan Immutability
- `FNO_EXIT_PRIORITY_RULE = "STOP_WINS_ON_SAME_BAR_TIE"` confirmed.
- `SPOT_EXIT_FRESHNESS_WINDOW_MS = 120_000` confirmed.

### Gate F — Paper Admission Gates
- **Phase A:** market hours → `allowed: true`; weekend, holiday, pre-open → `allowed: false`.
- **Phase B (F&O):** `nse_fo` and `bse_fo` lanes always → `allowed: false`, `reason: "TRADE_ADMISSION_CONTEXT_INCOMPLETE"`, `quoteProvenance: "fno_no_provider_timestamp"`, `detail` contains "no trusted per-premium event timestamp".
- These tests prove Phase B F&O rejection is unconditional, as required by the documented intentional design.

### Gate H — Monitoring and Exit Decisions
- **BLOCKED paths:**
  - `asOfMs` too old → `STALE_QUOTE`
  - `asOfMs = null` → `STALE_QUOTE` (missing quote)
  - `source = "DELAYED_YAHOO"` → `SOURCE_NOT_TRADE_GRADE`
  - `kiteSessionActive = false` → `KITE_UNAVAILABLE`
  - `contractValid = false` → `CONTRACT_INVALID` (highest precedence)
  - `CONTRACT_INVALID` beats `KITE_UNAVAILABLE` in precedence ordering
- **EXIT paths:**
  - Spot reaches TARGET2 level → `EXIT TARGET2_HIT`, `settlement: "FROZEN_PREMIUM"`
  - Spot reaches STOP level → `EXIT STOPPED`
  - Same-bar stop+target2 → STOP wins per `FNO_EXIT_PRIORITY_RULE = "STOP_WINS_ON_SAME_BAR_TIE"`
  - BEARISH stop hit (hi ≥ stop) → `EXIT STOPPED`
- **Lifecycle milestone (not terminal):**
  - TARGET1 hit → `HOLD` with `next: "TARGET1_HIT"` (trade continues targeting T2)
  - This is correct: `evaluateTransition` returns `exited: false` for T1; only T2/STOP are terminal
- **HOLD path:** fresh data, spot neutral → `HOLD`, `tradeGrade: true`
- **BLOCKED diagnostics:** `wouldHaveExited` present on BLOCKED result; never mutates trade.
- **Quote metadata:** `quoteSource`, `quoteAsOfMs`, `quoteFreshnessSec` surfaced on all result kinds.

### Gate I — Charges and P&L
- `grossPnl = (exit - entry) × quantity` — winning CALL (2000), losing CALL (-2000).
- `netPnl = grossPnl - totalCost` — always less than grossPnl.
- Brokerage: ₹40 round trip, ₹20 single side.
- STT = `sellTurnover × 0.0015` (verified arithmetic).
- GST = 18% of (brokerage + exchangeTxn + sebi) (verified arithmetic).
- Stamp duty on buy side only.
- `totalCost = sum of all 8 components` (arithmetic consistency).
- Missing exit → `grossPnl: null`, `netPnl: null` (no fabricated zero).
- `entryPremium = 0` → `computable: false`.
- `lots = 0` → `computable: false`, `quantity: 0`.
- `quantity = lots × lotSize` (exact integer: 3 lots × 30 = 90).

### Gate L — Lifecycle Reconciliation Equations
Four invariants verified via a pure `validateLifecycleEquations()` helper:
1. `signalsEmitted = tradeableSignals + watchlistSignals + infoOnlySignals`
2. `tradeableSignals = admissionPassed + admissionRejected`
3. `admissionPassed = paperOpened` (assuming zero open-write failures)
4. `paperOpened = paperStillOpen + paperClosed`

Cases: balanced counts (all pass), all-INFO_ONLY (all pass), EQ1 miscounting detected, EQ2 miscounting detected, EQ4 miscounting detected, all-quiet session (all pass).

---

## §6 Known-Good Coverage Already Present (Not Repeated)

~80 F&O-related test files already in the suite (confirmed pre-flight):
- `sessionAdmission.test.ts` (427L) — equity admission paths in depth
- `fnoExitDecision.test.ts` (171L) — exit decision existing coverage
- `canonicalFnoReadiness.test.ts` (337L) — readiness builder
- `fnoCostModel.test.ts` (242L) — charge model existing coverage
- `optionSignals.setupAvailability.test.ts` (445L) — setup availability
- `optionSignalsRoute.test.ts` (511L) — route-level tests

Pack 2 adds proofs for the specific gaps identified in preflight — gate-sequence proofs, documentation-as-test for intentional blocking decisions, and UI defect regression tests.

---

## §7 Closing Battery Results

| Check | Result |
|-------|--------|
| `cd artifacts/scanner && pnpm exec tsc --noEmit` | ✅ CLEAN |
| `cd artifacts/global && pnpm exec tsc --noEmit` | ✅ CLEAN |
| `cd artifacts/api-server && pnpm exec tsc --noEmit` | ✅ CLEAN |
| `cd artifacts/scanner && pnpm run test` | ✅ **902/902** (+24 new) |
| `cd artifacts/api-server && pnpm run test:full` | ✅ **4617/4617** (+89 new) |
| Targeted `p20.lifecycleGates.test.ts` | ✅ **89/89** |
| Targeted `p20.optionsPageFixes.test.ts` | ✅ **24/24** |
| `git diff --check` | ✅ CLEAN |

Pack 1 baselines preserved:
- `p19.packTests`: still passing (included in scanner 902)
- `p19a.indexDetail`: still passing (included in scanner 902)
- `p19a.foSummary`: still passing (included in scanner 902)

---

## §8 Constraints Honoured

- No commit, push, deploy, or DB changes performed.
- `DB_TEST_RUNTIME_AUTHORIZED ≠ "true"` throughout.
- `FNO_AUTO_OPEN_C0_BLOCKED` untouched.
- Phase B F&O unconditional rejection untouched.
- No new strategy, no threshold changes, no swing-trading changes.
- `production: PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`

---

END_FAST_TRACK_PACK_2_COMPLETE_FNO_LIFECYCLE
