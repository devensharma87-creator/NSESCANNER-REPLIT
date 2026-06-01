# F&O Signalling & Paper-Trade — Backend Roadmap (code-verified)

> **Status:** Read-only trace, **verified against live source on 2026-06-01**. No trading/signal/execution logic was changed. (One in-code *comment* in `paperTradingFO.ts` was corrected — see §0 — because it carried the stale value that triggered this whole review. No runtime behaviour changed.)
> **Provenance:** Reconstructed from source; `file:line` pointers retained so any claim can be jumped to and confirmed.
> **Flags:** `✓ VERIFIED (file:line)` = checked against the live constant/code this date. `⚠ VERIFY` = a claim from the original trace I did **not** re-open this pass (mostly secondary line numbers) — still trustworthy, just not re-confirmed here. `→ note` = maintenance observation, not a bug.

---

## 0. Open questions — RESOLVED

The four open questions the original trace flagged are now answered against live constants.

| # | Question | Verdict | Evidence |
|---|----------|---------|----------|
| **Q1** | Is the HC emission floor **70 or 65**? | **65.** The "70" reading was **stale**. The floor *was* 70 pre-Phase-3 and was lowered to 65 when the confluence engine began haircutting confidence directly. | `optionSignals.ts:519 const HC_EMISSION_FLOOR = 65;` and `tradingConfig.ts:3-8` (comment: *"Aligned with HC_EMISSION_FLOOR… Was 70 pre-Phase-3"*, `MIN_FNO_TRADE: 65`). |
| **Q4** | `MIN_FNO_TRADE` vs `FNO_RISK.MIN_CONFIDENCE` vs BASELINE 55 — three numbers? | **Two real floors, not three.** STANDARD floor = **65** (and `FNO_RISK.MIN_CONFIDENCE` is a *reference to* `MIN_FNO_TRADE`, not a separate literal). BASELINE floor = **55**. Sub-tier breakpoints 55/60/65. | `paperAccount.ts:82 MIN_CONFIDENCE: CONFIDENCE_THRESHOLDS.MIN_FNO_TRADE`; `paperAccount.ts:129 MIN_CONFIDENCE: 55`; `riskPctForConfidence :161-171`. |
| **Q1 consequence** | Is there a silent **emit-but-don't-trade band**? | **No.** Because emission floor (65) **equals** the STANDARD trade floor (65), every setup that emits as HC (conf ≥ 65) also clears paper gate #2 (conf ≥ 65). **The §13 "infrastructure, not strategy" conclusion is NOT undermined by a hidden gating gap.** | `optionSignals.ts:519` == `tradingConfig.ts:8`. |
| **Q2** | Circuit-breaker **fail-OPEN** vs paper gates **fail-CLOSED** — real and intended? | **Real and intentional.** On a DB error the circuit-breaker count returns `0` → breaker disarmed → HC emission continues (**fail-OPEN**). The paper-execution risk/stats gates fail **CLOSED**. Liquidity gate #9 also fails OPEN on chain-fetch error. | breaker: `optionSignalGates.ts:166` (returns 0 on catch) + `:425`; liquidity: `paperTradingFO.ts:502-514`; stats fail-closed: `paperTradingFO.ts:172`. |
| **Q3** | Is `mtm-sweep-health` at `:1100` a **copy error**? | **No.** `routes/paper.ts` is **1525 lines**; the handler genuinely sits at `:1101` (`res.json(getMtmSweepHealth())`). The original author assumed the file ended ~560. | `routes/paper.ts:1095-1101` (file length 1525). |

**Single source of truth for confidence floors (✓ VERIFIED):**

| Constant | Value | Where | Role |
|----------|-------|-------|------|
| `HC_EMISSION_FLOOR` | **65** | `optionSignals.ts:519` | Signal layer — below → demoted to BASELINE tier (not emitted as HC) |
| `CONFIDENCE_THRESHOLDS.MIN_FNO_TRADE` | **65** | `tradingConfig.ts:8` | Canonical config value |
| `FNO_RISK.MIN_CONFIDENCE` | **65** | `paperAccount.ts:82` (→ references `MIN_FNO_TRADE`) | Paper layer STANDARD floor (gate #2) |
| `FNO_BASELINE_RISK.MIN_CONFIDENCE` | **55** | `paperAccount.ts:129` | Paper layer BASELINE-lane floor |
| Sub-tier cuts | 55 / 60 / 65 | `riskPctForConfidence :161` | Sizing band MICRO/BASELINE/STANDARD |

→ **One residual coupling note (not a bug):** `HC_EMISSION_FLOOR` (`optionSignals.ts:519`) is a **separate literal** from `CONFIDENCE_THRESHOLDS.MIN_FNO_TRADE` (`tradingConfig.ts:8`). They are equal today (both 65) and the config comment documents the alignment, but they are not *wired* to one symbol — editing one without the other is the only way the feared emit-but-don't-trade band could ever appear. Optional hardening: import `MIN_FNO_TRADE` into `optionSignals.ts` so the two can never drift. (Left as a recommendation — it is a code change.)

---

## 1. Bird's-eye data flow

```
                       ┌──────────────────────────────────────────────┐
   every 30s (market   │  setInterval  (optionSignals.ts:1731)          │
   OPEN only)  ───────▶│  → getOptionSignals()                          │
                       └───────────────┬──────────────────────────────┘
                                       ▼
  ┌─ SIGNAL LAYER ──────────────────────────────────────────────────────┐
  │ 1. expireStalePendingSignals                                         │
  │ 2. loadGateContext()        ── session-wide gates                    │
  │ 3. getKiteIndexQuotes()     ── live spot LTP (Phase-4 KiteTicker)    │
  │ 4. FOR each index in OPTION_INDICES {NIFTY, BANKNIFTY, SENSEX}:      │
  │       fetchKiteIntraday 15m×5d  +  daily×180d   (Kite-ONLY)          │
  │       buildSignalsForIndex():                                        │
  │           classifyRegime               (Phase 1)                     │
  │           5 detectors + always-on BASELINE detector                  │
  │           scoreConfluence              (Phase 3 — replaces           │
  │                                          per-detector confidence)    │
  │           apply per-setup demotion gates → isDemoted partition       │
  │           build option geometry (strike / CE-PE / entry / stop /     │
  │                                   T1 / T2)                            │
  │       snapshot ATM IV → IVR / IVP                                    │
  │ 5. final vetoes: circuit-breaker · OI hard-veto · HC-emission-floor  │
  │                  · correlation cap                                    │
  │ 6. recordOrUpdate()  ── lifecycle upsert → option_signal_history     │
  │ 7. enrichBundlesWithOptionLevels() ── spot levels → option premiums  │
  └──────────────────────────────┬──────────────────────────────────────┘
                                  ▼
  ┌─ PAPER LAYER ───────────────────────────────────────────────────────┐
  │ 8. openPaperTrade()         on PENDING→TRIGGERED  (paperTradingFO.ts) │
  │    markOpenFnoTradesToMarket + markAllOpenFnoTradesToMarket  (MTM)   │
  │    forceCloseAllOpenFnoFor1520()   at 15:20 IST                       │
  └──────────────────────────────┬──────────────────────────────────────┘
                                  ▼
  9. log signalCount / highConvictionCount / baselineCount / suppressedSummary
```

The two-layer split (signal vs paper) is the key mental model: **a signal can be emitted and still never trade**, because the paper-layer gates are stricter than — and partly independent of — the signal layer. **But the confidence *floor* is the same on both sides (65), so the only setups that emit-but-don't-trade are those blocked by a *different* paper gate (DD cap, liquidity, daily cap, etc.), not by a confidence mismatch.**

---

## 2. Triggering & scheduler

- **Heartbeat:** `setInterval` at `optionSignals.ts:1731`, period `TRIGGER_SWEEP_INTERVAL_MS = 30_000`. Fires only when market is OPEN (IST hours). Documented constraint: *do not set below 15s (Kite throttling).*
- **On-demand:** the same `getOptionSignals()` backs `/api/options/signals`, so UI refreshes run the identical pipeline.
- **Boot staggering** (`bootScheduler.ts`): `globalDataPump +15s`, `presetScheduler +25s`, `instFlowsRefresher +60s` — spreads cold-start DB/connection load. ⚠ VERIFY line numbers.

---

## 3. F&O universe & data sourcing

**Universe — `OPTION_INDICES` (`optionSignals.ts:52-56`):**

| Index | strikeStep | Expiry |
|-------|-----------|--------|
| NIFTY | 50 | weekly |
| BANKNIFTY | 100 | monthly |
| SENSEX | 100 | weekly |

→ **Maintenance:** adding/removing an index requires editing **three** places or it half-works: `OPTION_INDICES`, `FNO_INDICES` in `oiLab.ts`, and `SIGNAL_INDEX_TO_LTP_KEY`.

- **Candles (Kite-first, Yahoo HARD-CUT for F&O, 2026-05-06):** `fetchKiteIntraday` for 15m×5d and daily×180d. Yahoo fallback is disabled for F&O emission to prevent stale-data signals (`tradingConfig.isActionableForFno` returns false for `DELAYED_YAHOO`). ✓ VERIFIED `tradingConfig.ts:43-45`.
- **`suppressedSummary`:** per-index skip-reason string (e.g. `no_live_kite_intraday … — Yahoo fallback disabled`) — the line typically seen in logs on a quiet/offline day.

---

## 4. Confidence & tiering — single source of truth

See the **§0 verified table**. Summary:

- **Signal emit:** `confidence ≥ HC_EMISSION_FLOOR (65)` AND passes all demotion gates → `HIGH_CONVICTION`; otherwise `BASELINE` tier.
- **Paper STANDARD floor:** `FNO_RISK.MIN_CONFIDENCE (65)`; **BASELINE floor:** `55`.
- Because emit floor == STANDARD trade floor, there is **no confidence-driven emit-but-don't-trade band**.

**Cycle counts (logged every sweep):**
- `signalCount` = total emitted (HC + BASELINE)
- `highConvictionCount` = cleared floor **and** all demotion gates
- `baselineCount` = baseline outlooks **plus** demoted HC setups

---

## 5. Signal generation (detectors → confluence → geometry)

### 5a. The six detectors (`buildSignalsForIndex`)

Detector registry ✓ VERIFIED at `optionSignals.ts:1287-1291` (+ always-on BASELINE at `:985`).

| Detector | Trigger logic |
|----------|---------------|
| `trend_continuation` | EMA stack 9>21, RSI>50, price>VWAP; targets pivot R1/R2 |
| `vwap_reclaim` | Price crosses VWAP + volume confirm; late-session cutoff (`VWAP_RECLAIM_LATE_CUTOFF_IST_MIN`, `:1288`) |
| `volume_breakout` | Break of `prevSwingHigh` with volume > 1.5× `avgVol20` |
| `ema_pullback` | Retest of EMA9/21 inside an existing trend |
| `mean_reversion` | Extreme RSI (>75 / <25) + ≥2×ATR from VWAP (`trendClass:false`) |
| **`BASELINE` (always-on)** | Directional vote: Spot-vs-VWAP, Spot-vs-EMA21, EMA9-vs-EMA21, RSI-vs-50 |

→ `BASELINE` is **not a tier and not a fallback** — it is a legitimate always-on directional read that runs every cycle. Don't confuse the *detector* `BASELINE` with the *tier* `BASELINE`: a HIGH_CONVICTION setup demoted by a gate also lands in the BASELINE *tier* but keeps its original detector name.

### 5b. The four phases

- **Phase 1 — Regime + IV:** `classifyRegime` → `TRENDING_BULL/BEAR`, `RANGING`, `VOLATILE`, `EXPIRY_DAY`. ATM IV snapshotted → IVR/IVP.
- **Phase 2 — Structure:** intraday EMA20/50 + 60-bar Volume Profile (POC/VAH/VAL).
- **Phase 3 — Confluence engine** (`confluenceEngine.ts`): `scoreConfluence` **replaces** per-detector confidence by summing weighted votes. Legacy per-detector confidence preserved in `optionSignals.legacyEmit.bak.ts`.
- **Phase 4 — Live spot:** `getKiteIndexQuotes()` provides KiteTicker WebSocket spot for lifecycle evaluation.

**Confluence weight table — ✓ VERIFIED `confluenceEngine.ts:100-201`:**

| Factor | Supports (bull-aligned) | Opposes | Neutral / risk |
|--------|------------------------|---------|----------------|
| EMA_STACK | **+5** | **−8** | 0 |
| VWAP | **+3** | **−6** | 0 (within 5 bps) |
| VOLUME_PROFILE | **+3** | **−3** | 0 / −3 risk / +2 |
| REGIME | **+5** (trend agrees) | **−10** (fading trend) | −2/−3/−5 risk |
| IV_RANK | +2 | −2 | ⚠ VERIFY exact branch |

> Sum range ≈ **[−30, +20]** (`confluenceEngine.ts:80`). The deliberate **bearish asymmetry** (EMA −8 vs +5, VWAP −6 vs +3, Regime −10 floor) makes the engine **harder to convince of a bullish setup against bearish structure** than vice-versa — by design.

### 5c. Option geometry (spot signal → option trade)

- **Strike:** nearest to spot by `strikeStep`.
- **Type:** `CALL` for BULLISH, `PUT` for BEARISH.
- **Entry:** from `prevSwingHigh/Low` or bar extremes; `applyTriggerRealism` shifts it if too far from spot.
- **Stop / targets (`clampPlanForIntraday`):** Stop floor `max(0.3%·spot, 1.0·ATR15)`, ceiling `max(0.45%·spot, 0.6·ATR15)`; T1 `min(structural, max(1.0%·spot, 1.6·ATR15))`; T2 `T1 × 1.7` (capped at structural T2). ⚠ VERIFY exact coefficients.
- **Spot → option premium:** Black-Scholes delta projection — `optionEntry = optionLtp + delta·(spotEntry − spot)`.

---

## 6. The full gate stack

Gates run in **four passes**:

```
loadGateContext (session-wide)          ← Pass A, blocks ALL HC
        │ ▼
buildSignalsForIndex demotion gates     ← Pass B, demotes HC→BASELINE per setup
        │ ▼
getOptionSignals final vetoes           ← Pass C, drops or demotes survivors
        │ ▼  (signal layer done)
openPaperTrade gate sequence            ← Pass D, blocks the actual trade (§7b)
```

### 6a. Pass A — session-wide (`loadGateContext`, `optionSignalGates.ts:416`)

✓ VERIFIED constants: `DAILY_STOP_LIMIT = 2` (`:34`), `VIX_INTRADAY_SPIKE_PCT = 5` (`:55`), `VIX_DAY_SPIKE_PCT = 7` (`:60`), `BIAS_FLIP_COOLDOWN_MIN = 45` (`:39`).

| Gate | Threshold | Effect / fail-mode |
|------|-----------|--------------------|
| Circuit breaker | `stoppedToday ≥ DAILY_STOP_LIMIT (2)` | Reject ALL HC (BASELINE ok); **fail-OPEN on DB error** — `loadStoppedTodayCount` catch returns 0 → breaker disarmed (`:166`) |
| VIX intraday spike | `≥ 5%` | Reject ALL HC; fail-open if VIX missing |
| VIX day spike | `≥ 7%` | Reject ALL HC; fail-open |
| Bias-flip cooldown | `45m` after a stop | Reject setup opposing a recent stop; fail-open (`loadRecentStopsByIndex` catch → empty map, `:204`) |
| Stale pending | `~45m` | Expire the pending order |

### 6b. Pass B — per-setup demotion (`buildSignalsForIndex`)

| Gate | Threshold | Effect |
|------|-----------|--------|
| Vol-clamp stop | `VOL_CLAMP_REJECT_RATIO = 1.5` | Reject if ratio>1.5; demote if 1.0–1.5 |
| HTF bias (daily EMA50) | spot vs EMA50 | Demote HC→BASELINE |
| True 1h HTF | EMA9/21 on session-aware 60m bars | Demote |
| Noise window | 09:15–09:30 / 15:15–15:30 IST | Demote |
| Expiry day | `regime === EXPIRY_DAY` | Demote |
| Sector RS | `RELATIVE_STRENGTH.TOLERANCE_PCT = 1.0%` (NIFTY exempt) | Demote |
| 30-day win-rate | `WIN_RATE_CALIBRATION {LOOKBACK:30, MIN_SAMPLE:10, MIN_WR:0.4}` | Demote; **fail-open** (empty map = no-op) |

**Combined partition:** `isDemoted = volClamped || htfConflictGate || noiseWindow || inExpiryDay || htf1hConflictGate || rsConflictGate || lowWinRateGate`. Clean setups fill the **top-3 HC pool**; demoted ones are forced to BASELINE tier and appended after.

**`loadSetupWinRates` SQL (`optionSignalGates.ts:~150` / original trace `:254`)** — the query that timed out in prod. On failure → empty `Map` → `lowWinRateGate` no-op (benefit of the doubt) = the W6-P5 fail-open.

### 6c. Pass C — final orchestration vetoes (`getOptionSignals`)

| Veto | Condition | Effect |
|------|-----------|--------|
| Global veto | circuit-breaker OR VIX spike | Drop ALL HIGH_CONVICTION |
| OI hard-veto | `|sentimentScore| ≥ 30` opposing direction | Drop the signal entirely |
| ATM-OI confirmation | both ATM legs vote against, `|atmVote| ≥ 2` | Mutate surviving HC → BASELINE |
| Correlation cap | one index per bucket (BROAD/BANK) per direction | Only highest-confidence card survives |

> **Why ATM-OI confirmation sits outside the `isDemoted` partition:** it needs a *fresh* option-chain fetch, which only happens after the partition is built. Treat Pass C as authoritative over Pass B for any single setup.

---

## 7. Paper-trade execution (`paperTradingFO.ts`)

### 7a. Auto-trade master switch

`isPaperAutoTradingEnabled()`: `true` if `PAPER_TRADING_ENABLED ∈ {1,true,yes,on}`; else falls back to `REPLIT_DEPLOYMENT === "1"`. **Dev = read-only** (early-return); prod has it explicitly true. Manual buys/closes are **not** gated by this.

### 7b. `openPaperTrade` — ordered gate sequence (Pass D)

| # | Gate | Constant / source | Fail-mode |
|---|------|-------------------|-----------|
| 1 | Auto-trade enabled | `isPaperAutoTradingEnabled()` | fail-closed |
| 2 | Confidence floor | **`FNO_RISK.MIN_CONFIDENCE = 65`** (BASELINE 55) ✓ `paperTradingFO.ts:295` | fail-closed |
| 3 | Market open | `computeMarketStatus === 'open'` | fail-closed |
| 4 | Consecutive stops | `MAX_CONSECUTIVE_STOPS_PER_DAY = 2` | fail-closed |
| 5 | Daily DD cap | `MAX_DAILY_LOSS_PCT = 0.025` | fail-closed |
| 6 | Weekly DD cap | `MAX_WEEKLY_LOSS_PCT = 0.05` | fail-closed |
| 7 | Time cutoff | 15:25 IST (STANDARD) / 14:45 IST (BASELINE) | fail-closed |
| 8 | Liquidity — LTP | `FNO_LIQUIDITY.MIN_OPTION_LTP = 20` (`:480`) | fail-closed |
| 9 | Liquidity — chain | spread ≤ 1.5%, OI ≥ 50k (`fetchOptionChain`) | **fail-OPEN** on chain-fetch error (`:502-514`); but strike-missing & OI<floor fail **closed** (`:525,:553`) |
| 10 | TX start | `db.transaction` + `FOR UPDATE` on account row | — |
| 11 | Daily trade cap | `MAX_TRADES_PER_DAY = 4` | fail-closed |
| 12 | Baseline stats | `getBaselineDayStats()` (0.75% loss / lane locks) | **fail-closed** (`BASELINE_GUARDRAIL_STATS_UNAVAILABLE`) |
| 13 | Portfolio heat | `PORTFOLIO_HEAT.MAX_FNO_HEAT_PCT = 0.06` | fail-closed |

> **Q2 — the two fail-OPEN holes in an otherwise fail-closed wall:** gate #9 (chain liquidity, on fetch failure) and the Pass-A circuit breaker. Both open under the *same* infra condition (chain/DB fetch failure), so a Neon/Kite wobble can simultaneously skip the liquidity check *and* disarm the circuit breaker. **This is real and currently by design** (signal layer: "don't suppress good reads on a transient blip"; the explicit comment at `paperTradingFO.ts:172` notes fail-open is unacceptable for the *stats* path). Whether the circuit breaker specifically should flip to fail-closed is an **owner decision**, not a bug to silently patch.

**Dedup SELECT** on `(signalDate, indexSymbol, setupKey, direction)` runs in this path — the query that **timed out at 10:07 IST**, dropping 2 BASELINE opens. It fails at the *read*, before any insert (clean failure, no partial row).

### 7c. Sizing

- **Fixed lots (STANDARD opens):** `PAPER_FIXED_LOTS = {NIFTY:10, SENSEX:40, BANKNIFTY:30}`.
- **Risk-pct tiers (`riskPctForConfidence`, ✓ `paperAccount.ts:161-171`):** MICRO **0.25%** (conf 55–59), BASELINE **0.5%** (60–64), STANDARD **2.0%** (65+).
- **Multipliers:** post-stop cool-down 60min × 0.5; `REGIME_SIZING.VOLATILE_MULT = 0.5`.
- **Baseline guardrails (`FNO_BASELINE_GUARDRAILS`, ✓ `paperAccount.ts:146-155`):** max **2** BASELINE/day, **0.75%** daily loss cap, 2-loss lane lock, **14:45 IST** late cutoff. `getBaselineDayStats` **fails CLOSED**.

### 7d. Persistence & idempotency

- `paper_trade_fo` stores `entry_premium`, `stop_premium`, `target1_premium`, `target2_premium`, `last_premium`, `realized_pnl`, `max_runup`, `max_drawdown` (legs persist `qty = lots × lotSize`).
- `reconcileMissingPaperTrades` backfills missed opens and reads `h.tier AS persisted_tier` to prevent post-deploy re-promotion.

---

## 8. Signal lifecycle (`optionSignalLifecycle.ts`)

- **`recordOrUpdate`** upserts into `option_signal_history` (geometry + status + MFE/MAE).
- **`evaluateTransition`** uses wick-aware bar high/low to move `PENDING → TRIGGERED → TARGET1_HIT/TARGET2_HIT/STOPPED/EXPIRED`.
- **Anti-phantom-trade:** a signal first observed *already* terminal logs as `MISSED_WINDOW` and **no paper trade opens**.
- **`signal_fingerprint`:** SHA-256[:16] of `(signalDate, indexSymbol, setupKey, direction, optionType, selectedStrike)` — the correlation ID linking `EMITTED → OPENED → CLOSED_*`.

> **State machine:**
> ```
> PENDING ──trigger──▶ TRIGGERED ──┬──▶ TARGET1_HIT ──▶ TARGET2_HIT
>    │                              ├──▶ STOPPED
>    │                              ├──▶ EXPIRED
>    └──stale 45m──▶ (expired)      └──▶ TIME_EXIT_1520 / MANUAL_OVERRIDE
> (first-seen terminal) ──▶ MISSED_WINDOW   [no trade]
> ```

---

## 9. Exit / close & realized P&L

- **`pickExitPremium`:** chooses `lastPremium` (force-exit/manual) vs the locked target/stop premium.
- **Exit reasons:** `TARGET1_HIT`, `TARGET2_HIT`, `STOPPED`, `EXPIRED`, `MANUAL_OVERRIDE`, `TIME_EXIT_1520`.
- **15:20 force-exit:** `forceCloseAllOpenFnoFor1520()` closes every open FNO row, latches `lastForceExit1520Date` (once/day). The **combo lane is opted OUT**.
- **Realized P&L:** `realizedPnl = (exitPremium − entryPremium) × lots × lotSize`.

---

## 10. Mark-to-market (MTM)

- **Cohort path:** `markOpenFnoTradesToMarket` — refreshes OPEN rows in the *current* signal cohort.
- **Full sweep (P22):** `markAllOpenFnoTradesToMarket(signalDate)` — refreshes *every* OPEN row by stored strike/optionType, even rows that dropped out of the cohort.
- **`pickLtpFromChain(chain, strike, optionType)`:** epsilon-tolerant strike match (numeric round-trip jitter).
- **Freshness:** `MTM_FRESHNESS_WINDOW_MS = 45_000` skips rows already refreshed this cycle. Updates only `last_premium`, `last_evaluated_at`, `max_runup` (GREATEST), `max_drawdown` (LEAST).
- `last_premium` also feeds `pickExitPremium` (settlement) **and** `getBaselineDayStats` (intraday loss cap) — a high-blast-radius field. (Fresher MTM makes both *more* accurate; this was explicitly approved — see `replit.md` P22 note.)

---

## 11. Observability & diagnostics

- **Reasoning logger (`fnoSignalReasoningLogger.ts`):** writes `fno_signal_reasoning`; `getReasoningLoggerHealth()` → write counters + last success/error.
- **Daily summary (`paperDailySummaryFo.ts`):** `fetchDurableSkipReasons` reads `SKIPPED/MISSED_WINDOW` from `fno_signal_reasoning` when the in-memory ring is empty.
- **MTM sweep health:** `getMtmSweepHealth()` defined in `paperTradingFO.ts` (~`:1082`).
- **Routes (`routes/paper.ts`, file = 1525 lines):** `GET /paper/positions/fo`, `GET /paper/trades/fo`, `POST /paper/positions/fo/:id/close` → `MANUAL_OVERRIDE`, `GET /paper/diagnostics/untriggered/fo`, `…/daily-summary/fo`, `…/environment`, and `…/mtm-sweep-health` ✓ **VERIFIED at `:1101`** (`res.json(getMtmSweepHealth())`). Plus combo-lane endpoints (`/api/paper/combos`).

---

## 12. DB schema (`lib/db/src/schema/`)

| Table | Holds |
|-------|-------|
| `paper_trade_fo` | signal/geometry + lots/lot_size + premium fields + status + exit + realized_pnl + runup/drawdown + journal/tags |
| `option_signal_history` | signal geometry + status + MFE/MAE |
| `fno_signal_reasoning` | decision / reason / fingerprint / snapshot JSONB |
| `paper_daily_summary_fo` | daily roll-up + `skipped_by_reason` JSONB |

⚠ VERIFY exact file:line ranges (not re-opened this pass).

---

## 13. Why "all BASELINE, 0 HC" on a quiet day — re-confirmed

Every cycle logged `highConvictionCount=0`: detectors found directional reads (BASELINE votes) but **no setup cleared the HC emission floor (65) + demotion gates**, so nothing reached STANDARD-tier auto-open. The 2 BASELINE opens attempted at 10:07 IST failed at the **dedup SELECT** due to a Neon connect timeout — **infrastructure, not strategy**.

**Caveats from the original trace — now RESOLVED:**
1. ~~Assumes the emission floor is 70.~~ **Floor is 65 (verified).** Since 65 == the STANDARD trade floor, there is no hidden emit-but-don't-trade band; the "infrastructure, not strategy" conclusion **stands**. (A 0-HC day with floor 65 means confidence genuinely didn't reach 65 *or* the Pass-B/C demotion gates caught everything that did — both are strategy/market-condition outcomes, not a config bug.)
2. The fail-OPEN circuit breaker (Q2) + fail-OPEN liquidity gate (#9) remain a real asymmetry: a Neon wobble can also let *unintended* HC through on a different cycle. To audit a specific incident, grep the day's `fno_signal_reasoning` rows for any HC emitted during the timeout window.

---

## 14. Suggested next steps (owner decisions — no code changed here)

| Priority | Action | Resolves |
|----------|--------|----------|
| ~~High~~ DONE | ~~Diff the three confidence constants.~~ **Verified: emit & STANDARD-trade floors both 65; BASELINE 55. No gap.** | Q1, Q4, §13 caveat 1 |
| Medium | (Optional hardening) wire `HC_EMISSION_FLOOR` to `CONFIDENCE_THRESHOLDS.MIN_FNO_TRADE` so the two literals can never drift apart. | §0 coupling note |
| Medium | **Owner decision:** should the circuit breaker fail **closed** under DB error (vs current fail-open)? Liquidity gate #9 has the same property. | Q2, §13 caveat 2 |
| ~~Medium~~ DONE | ~~Confirm `mtm-sweep-health` route line.~~ **Verified at `routes/paper.ts:1101` — not a copy error.** | Q3 |
| Low | Add a dedicated emit-but-don't-trade counter to make any future drift observable in logs, not inferred. | §4 |
| Low | Add retry/backoff around the dedup SELECT and `loadSetupWinRates` so a single Neon timeout doesn't silently drop opens. | §6b, §7b |

---

*Verified pass 2026-06-01 against live source. The only edit to executable files was correcting a stale doc-comment in `paperTradingFO.ts` (the "70 conf floor" / "1% loss cap" text → "65" / "0.5%"). No signal, gate, sizing, exit, or execution logic was changed.*
