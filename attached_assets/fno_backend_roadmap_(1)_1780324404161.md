# F&O Signalling & Paper-Trade — Complete Backend Roadmap

> **Status:** Read-only trace. No code was changed.
> **Provenance:** Reconstructed from source via parallel code exploration; `file:line` pointers retained throughout so any claim can be jumped to and confirmed.
> **How to read the flags:** `⚠ VERIFY` marks a claim that the trace itself could not fully resolve, or where two sources disagree. These are not errors in the *system* — they are open questions for whoever tunes it. Resolve them against the live constants before relying on them.

---

## 0. Open questions to resolve first

These are pulled to the top because they affect how you read everything below — especially the §13 "0 HC today" diagnosis.

| # | Question | Why it matters | Where |
|---|----------|----------------|-------|
| Q1 | **Is the HC emission floor 70 or 65?** The explorer read `HC_EMISSION_FLOOR = 70` in the signal layer; `replit.md` documents `CONFIDENCE_THRESHOLDS.MIN_FNO_TRADE = 65` as "aligned with" it. | If these are *one* constant, one of the two readings is stale. If they are *two* (signal-emission floor vs paper-trade floor), then a setup scoring 67 would **emit as HC but fail to auto-open** — a silent gap that looks like "HC generated, 0 traded." | §4, §7b |
| Q2 | **Circuit breaker fail-OPEN vs every paper gate fail-CLOSED.** A DB error on the circuit-breaker check lets HC through (§5a); the same class of DB error anywhere in `openPaperTrade` blocks the trade (§7b). | Asymmetric failure: under a Neon hiccup the signal layer becomes *more* permissive exactly when the execution layer becomes *less* so. Intended? | §5a vs §7b |
| Q3 | **`mtm-sweep-health` route at `:1100`** sits in a `routes/paper.ts` list otherwise in the 280–560 range. | Likely a copy error (the `:1082`/`:1100` figures look like they came from `paperTradingFO.ts`, not the routes file). Confirm the actual route line. | §10 |
| Q4 | **`MIN_FNO_TRADE = 65` vs `FNO_RISK.MIN_CONFIDENCE = 65` vs `FNO_BASELINE` floor 55.** Three confidence numbers in three layers. | Worth a single source-of-truth table mapping each to its enforcing line. Drafted in §4 — confirm values. | §4, §7b, §7c |

---

## 1. Bird's-eye data flow

```
                       ┌──────────────────────────────────────────────┐
   every 30s (market   │  setInterval  (optionSignals.ts:1731)          │
   OPEN only)  ───────▶│  → getOptionSignals()  (optionSignals.ts:2105) │
                       └───────────────┬──────────────────────────────┘
                                       ▼
  ┌─ SIGNAL LAYER ──────────────────────────────────────────────────────┐
  │ 1. expireStalePendingSignals (2116)                                  │
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
  │                          (+ MFE/MAE, fingerprint)                    │
  │ 7. enrichBundlesWithOptionLevels() ── spot levels → option premiums  │
  │                                        (Black-Scholes delta)         │
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

The two-layer split (signal vs paper) is the single most important mental model: **a signal can be emitted and still never trade**, because the floors and gates in the paper layer are stricter than — and partly independent of — the signal layer (see Q1).

---

## 2. Triggering & scheduler

- **Heartbeat:** `setInterval` at `optionSignals.ts:1731`, period `TRIGGER_SWEEP_INTERVAL_MS = 30_000` (`:1719`). Fires only when `computeMarketStatus(now) === "open"` (IST market hours). Documented constraint: *"F&O Signal Sweep Cadence — do not set below 15s (Kite throttling)."*
- **On-demand:** the same `getOptionSignals()` backs the API route `/api/options/signals` for the UI, so manual UI refreshes run the identical pipeline.
- **Boot staggering** (`bootScheduler.ts:15`, applied in `app.ts:~219`): `globalDataPump +15s`, `presetScheduler +25s`, `instFlowsRefresher +60s` — spreads cold-start DB/connection load. Directly relevant to the W6-P5 connect-timeout failures.

---

## 3. F&O universe & data sourcing

**Universe — `OPTION_INDICES` (`optionSignals.ts:52–56`):**

| Index | strikeStep | Expiry |
|-------|-----------|--------|
| NIFTY | 50 | weekly |
| BANKNIFTY | 100 | monthly |
| SENSEX | 100 | weekly |

> **Maintenance note:** adding/removing an index requires editing **three** places, or it half-works: `OPTION_INDICES` (here), `FNO_INDICES` in `oiLab.ts`, and `SIGNAL_INDEX_TO_LTP_KEY`.

- **LTP key map — `SIGNAL_INDEX_TO_LTP_KEY` (`:65–69`):** internal symbol → quote key (e.g. `NIFTY → ^NSEI`).
- **Candles (Kite-first, Yahoo HARD-CUT for F&O):** `fetchKiteIntraday` for 15m×5d (`:2154`) and daily×180d (`:2170`). Yahoo fallback is **disabled** for F&O emission (`:2144`, `:2166`) to prevent stale-data signals — the **2026-05-06 hard-cut**.
- **`indicesWithBars`:** count of indices that returned usable intraday bars *and* passed `buildContext`.
- **`suppressedSummary`:** per-index skip-reason string built at `:2453` (e.g. `no_live_kite_intraday (…) — Yahoo fallback disabled`). This is the line you've been reading in the logs.
- **`buildContext` (`:252–262`):** computes EMA9/21, RSI, VWAP, ATR, then slices full-window indicators to session length so warm-up is consistent.

---

## 4. Confidence & tiering — single source of truth

This table consolidates every confidence threshold scattered across the codebase. **All four values are `⚠ VERIFY` against live constants (see Q1, Q4).**

| Threshold | Documented value | Layer | Enforced at | Effect |
|-----------|-----------------|-------|-------------|--------|
| `HC_EMISSION_FLOOR` | **70** (explorer) | Signal | `optionSignals.ts:515`, emit `:1404` | Below → emitted as BASELINE, not HC |
| `MIN_FNO_TRADE` | **65** (`replit.md`) | Cross-ref | docs only | Stated "aligned with" emission floor — but ≠ 70 |
| `FNO_RISK.MIN_CONFIDENCE` | **65** (BASELINE 55) | Paper | `openPaperTrade` gate #2 | Below → no auto-open |
| Risk-pct tier cuts | 55 / 60 / 65 | Paper | `riskPctForConfidence :161` | Sizing band (MICRO/BASELINE/STANDARD) |

**Tier decision rule:** a setup is `HIGH_CONVICTION` **iff** `confidence ≥ emission floor` **AND** it passes all demotion gates (§5b). Otherwise it is `BASELINE`.

**Cycle counts (logged every sweep):**
- `signalCount` = total emitted (HC + BASELINE)
- `highConvictionCount` = cleared floor **and** all demotion gates
- `baselineCount` = baseline outlooks **plus** demoted HC setups

> The gap between Q1's two numbers is exactly the population of setups that would log into `signalCount` and possibly `highConvictionCount` but never satisfy paper gate #2. If 70≠65 is real, this is a quiet emit-but-don't-trade band worth a dedicated log line.

---

## 5. Signal generation (detectors → confluence → geometry)

### 5a. The six detectors (`buildSignalsForIndex`)

| Detector | Line | Trigger logic |
|----------|------|---------------|
| `trend_continuation` | 527 | EMA stack 9>21, RSI>50, price>VWAP; targets pivot R1/R2 |
| `vwap_reclaim` | 621 | Price crosses VWAP from below (bull) / above (bear) + volume confirm; **13:30 IST cutoff** (`:1280`) |
| `volume_breakout` | 725 | Break of `prevSwingHigh` with volume > 1.5× `avgVol20` |
| `ema_pullback` | 818 | Retest of EMA9/21 inside an existing trend |
| `mean_reversion` | 886 | Extreme RSI (>75 / <25) + ≥2×ATR from VWAP |
| **`BASELINE` (always-on)** | 948 | Directional vote: Spot-vs-VWAP, Spot-vs-EMA21, EMA9-vs-EMA21, RSI-vs-50 (`:949`) |

> `BASELINE` is **not a tier and not a fallback** — it is a legitimate always-on directional read that runs every cycle. It is why you see `setup=BASELINE` rows even when the five pattern detectors are silent. Don't confuse the *detector* `BASELINE` (here) with the *tier* `BASELINE` (§4) — a HIGH_CONVICTION setup demoted by a gate also lands in the BASELINE *tier* but keeps its original detector name.

### 5b. The four phases

- **Phase 1 — Regime + IV:** `classifyRegime` (`:433`, helper `:207`) → `TRENDING_BULL/BEAR`, `RANGING`, `VOLATILE`, `EXPIRY_DAY`. ATM IV is snapshotted and ranked into IVR/IVP (`:2202–2203`).
- **Phase 2 — Structure:** intraday EMA20/50 and a 60-bar Volume Profile (POC/VAH/VAL) (`:260–261`, `:334`).
- **Phase 3 — Confluence engine** (`confluenceEngine.ts:89–222`, invoked `:1369`): `scoreConfluence` **replaces** per-detector confidence by summing weighted votes — see table below. Legacy per-detector confidence preserved in `optionSignals.legacyEmit.bak.ts`.
- **Phase 4 — Live spot:** `getKiteIndexQuotes()` (`:2136`) provides KiteTicker WebSocket spot for lifecycle evaluation.

**Confluence weight table (`scoreConfluence`):**

| Factor | Bull vote | Bear vote |
|--------|-----------|-----------|
| EMA stack | +5 | −8 |
| VWAP | +3 | −6 |
| Volume Profile | +3 | −3 |
| Regime | +5 … | … −10 |
| IV Rank | +2 | −2 |

> Note the deliberate bearish asymmetry (EMA −8 vs +5, VWAP −6 vs +3, Regime −10 floor): the engine is **harder to convince of a bullish setup against bearish structure** than vice-versa. Worth keeping in mind when a "should-have-been-bull" signal scores low.

### 5c. Option geometry (spot signal → option trade)

- **Strike (`:1156`):** nearest to spot by `strikeStep`.
- **Type (`:1221`):** `CALL` for BULLISH, `PUT` for BEARISH.
- **Entry (`:1033`):** from `prevSwingHigh/Low` or bar extremes; `applyTriggerRealism` shifts it if it sits too far from spot.
- **Stop / targets (`clampPlanForIntraday`, `:1058`):**
  - Stop floor `max(0.3%·spot, 1.0·ATR15)`, ceiling `max(0.45%·spot, 0.6·ATR15)`
  - T1 `min(structural, max(1.0%·spot, 1.6·ATR15))`
  - T2 `T1 × 1.7` (capped at structural T2)
- **Spot → option premium (`:1791`):** Black-Scholes delta projection —
  `optionEntry = optionLtp + delta·(spotEntry − spot)` (same formula for stop/targets).

---

## 6. The full gate stack

Gates run in **three passes**: session-wide pre-detection, per-setup demotion, then final orchestration vetoes. The precedence diagram makes the order explicit.

```
loadGateContext (session-wide)          ← Pass A, blocks ALL HC
        │
        ▼
buildSignalsForIndex demotion gates     ← Pass B, demotes HC→BASELINE per setup
        │
        ▼
getOptionSignals final vetoes           ← Pass C, drops or demotes survivors
        │
        ▼  (signal layer done)
openPaperTrade gate sequence            ← Pass D, blocks the actual trade (§7b)
```

### 6a. Pass A — session-wide (`loadGateContext`, applied `:2123`)

| Gate | Threshold | Audit tag | Effect / fail-mode |
|------|-----------|-----------|--------------------|
| Circuit breaker | `DAILY_STOP_LIMIT = 2` stops | `CIRCUIT_BREAKER` | Reject ALL HC (BASELINE ok); **fail-OPEN on DB error** ⚠ (Q2) |
| VIX intraday spike | `VIX_INTRADAY_SPIKE_PCT = 5%` | `VIX_SPIKE` | Reject ALL HC; fail-open if VIX missing |
| VIX day spike | `VIX_DAY_SPIKE_PCT = 7%` | `VIX_SPIKE` | Reject ALL HC; fail-open |
| Bias-flip cooldown | `BIAS_FLIP_COOLDOWN_MIN = 45m` | `BIAS_FLIP_COOLDOWN` | Reject setup opposing a recent stop; fail-open |
| Stale pending | `STALE_PENDING_MAX_MIN = 45m` | `STALE_TRIGGER` | Expire the pending order |

### 6b. Pass B — per-setup demotion (`buildSignalsForIndex ~:1450–1554`)

| Gate | Threshold | Audit tag | Effect |
|------|-----------|-----------|--------|
| Vol-clamp stop | `VOL_CLAMP_REJECT_RATIO = 1.5` | `VOL_CLAMPED` | Reject if ratio>1.5; demote if 1.0–1.5 |
| HTF bias (daily EMA50) | spot vs EMA50 | `HTF_CONFLICT` | Demote HC→BASELINE |
| True 1h HTF | EMA9/21 on session-aware 60m bars | `HTF1H_CONFLICT` | Demote |
| Noise window | 09:15–09:30 / 15:15–15:30 IST | `OPENING/CLOSING` | Demote |
| Expiry day | `regime === EXPIRY_DAY` | `EXPIRY_DAY` | Demote |
| Sector RS | `RELATIVE_STRENGTH.TOLERANCE_PCT = 1.0%` (NIFTY exempt) | `RS_CONFLICT` | Demote |
| 30-day win-rate | `WIN_RATE_CALIBRATION {LOOKBACK:30, MIN_SAMPLE:10, MIN_WR:0.4}` | `LOW_WINRATE` | Demote; **fail-open** (empty map = no-op) |

**Combined partition (`:1542`):**
```
isDemoted = volClamped || htfConflictGate || noiseWindow
            || inExpiryDay || htf1hConflictGate || rsConflictGate
            || lowWinRateGate
```
Setups are sorted by confidence; clean ones fill the **top-3 HC pool**; demoted ones are forced to BASELINE tier and appended after the HC cards.

**`loadSetupWinRates` SQL (`optionSignalGates.ts:254`) — the query that timed out in prod:**
```sql
SELECT setup_key,
       COUNT(*) FILTER (WHERE realized_pnl <> 0)::int AS total,
       COUNT(*) FILTER (WHERE realized_pnl > 0)::int  AS wins
  FROM paper_trade_fo
 WHERE status = 'CLOSED'
   AND opened_at >= $1            -- 30 days ago
   AND exit_reason IN ('TARGET1_HIT','TARGET2_HIT','STOPPED','EXPIRED')
 GROUP BY setup_key
```
On failure → empty `Map` → `lowWinRateGate` no-op (benefit of the doubt). The W6-P5 fail-open.

### 6c. Pass C — final orchestration vetoes (`getOptionSignals ~:2235–2287`)

| Veto | Condition | Tag | Effect |
|------|-----------|-----|--------|
| Global veto | circuit-breaker OR VIX spike | — | Drop ALL HIGH_CONVICTION |
| OI hard-veto | `|sentimentScore| ≥ 30` opposing direction | `OI_VETO` | Drop the signal entirely |
| ATM-OI confirmation | `applyOiConfirmation :2073`, both ATM legs vote against, `|atmVote| ≥ 2` | — | Mutate surviving HC → BASELINE |
| Correlation cap | one index per bucket (BROAD/BANK) per direction | — | Only highest-confidence card survives |

> **Why ATM-OI confirmation sits outside the `isDemoted` partition:** it needs a *fresh* option-chain fetch, which only happens after the partition is built. So it can demote a setup that already "passed" Pass B. Treat Pass C as authoritative over Pass B for any single setup.

---

## 7. Paper-trade execution (`paperTradingFO.ts`)

### 7a. Auto-trade master switch

`isPaperAutoTradingEnabled()` (`paperAutoTradeFlag.ts`): `true` if `PAPER_TRADING_ENABLED ∈ {1,true,yes,on}`; else falls back to `REPLIT_DEPLOYMENT === "1"`. **Dev = read-only** (early-return); prod has it explicitly true. Manual buys/closes are **not** gated by this.

### 7b. `openPaperTrade` — exact ordered gate sequence (Pass D)

| # | Gate | Constant / source | Fail-mode |
|---|------|-------------------|-----------|
| 1 | Auto-trade enabled | `isPaperAutoTradingEnabled()` | fail-closed |
| 2 | Confidence floor | `FNO_RISK.MIN_CONFIDENCE = 65` (BASELINE 55) ⚠ Q1 | fail-closed |
| 3 | Market open | `computeMarketStatus === 'open'` | fail-closed |
| 4 | Consecutive stops | `MAX_CONSECUTIVE_STOPS_PER_DAY = 2` | fail-closed |
| 5 | Daily DD cap | `MAX_DAILY_LOSS_PCT = 0.025` (`getDailyRealizedDrawdown`) | fail-closed |
| 6 | Weekly DD cap | `MAX_WEEKLY_LOSS_PCT = 0.05` (`getWeeklyRealizedDrawdown`) | fail-closed |
| 7 | Time cutoff | 15:25 IST (STANDARD) / 14:45 IST (BASELINE) | fail-closed |
| 8 | Liquidity — LTP | `FNO_LIQUIDITY.MIN_OPTION_LTP = 20` | fail-closed |
| 9 | Liquidity — chain | spread ≤ 1.5%, OI ≥ 50k (`fetchOptionChain`) | **fail-OPEN** on fetch error |
| 10 | TX start | `db.transaction` + `FOR UPDATE` on account row | — |
| 11 | Daily trade cap | `MAX_TRADES_PER_DAY = 4` | fail-closed |
| 12 | Baseline stats | `getBaselineDayStats()` (0.75% loss / lane locks) | fail-closed |
| 13 | Portfolio heat | `PORTFOLIO_HEAT.MAX_FNO_HEAT_PCT = 0.06` | fail-closed |

> **Two fail-OPEN holes in an otherwise fail-closed wall:** gate #9 (chain liquidity) and the Pass-A circuit breaker (Q2). Both open under the *same* infra condition (chain/DB fetch failure). Under a Neon/Kite wobble the system will simultaneously skip the liquidity check *and* skip the circuit breaker — the worst combination. Flag for review.

**Dedup SELECT (`:344`)** on `(signalDate, indexSymbol, setupKey, direction)` runs in this path — the exact query that **timed out at 10:07 IST**, dropping 2 BASELINE opens. It fails at the *read*, before any insert, so there's no partial row (clean failure, no corruption).

### 7c. Sizing

- **Fixed lots (STANDARD opens):** `PAPER_FIXED_LOTS = {NIFTY:10, SENSEX:40, BANKNIFTY:30}`.
- **Risk-pct tiers (`riskPctForConfidence, :161`):** MICRO 0.25% (conf 55–59), BASELINE 0.5% (60–64), STANDARD 2.0% (65+).
- **Multipliers:** post-stop cool-down 60min × 0.5; `REGIME_SIZING.VOLATILE_MULT = 0.5`.
- **Baseline guardrails (`FNO_BASELINE_GUARDRAILS`):** max 2 BASELINE/day, 0.75% daily loss cap (incl. unrealised via `getBaselineDayStats`), 2-loss lane lock, 14:45 IST late cutoff. `getBaselineDayStats` **fails CLOSED** (`BASELINE_GUARDRAIL_STATS_UNAVAILABLE`).

### 7d. Persistence & idempotency

- `paper_trade_fo` stores `entry_premium`, `stop_premium`, `target1_premium`, `target2_premium`, `last_premium`, `realized_pnl`, `max_runup`, `max_drawdown` (legs persist `qty = lots × lotSize`).
- `reconcileMissingPaperTrades` backfills missed opens and reads `h.tier AS persisted_tier` (`:1604`) to prevent post-deploy re-promotion.

---

## 8. Signal lifecycle (`optionSignalLifecycle.ts`)

- **`recordOrUpdate` (`:254`)** upserts into `option_signal_history`: `signalDate`, `indexSymbol`, `setupKey`, `direction`, `strike`, `optionType`, `entry`, `stopLoss`, `target1`, `target2`, `optionEntry`, `optionStopLoss`, `status`, plus MFE/MAE (`maxFavorableExcursion` / `maxAdverseExcursion`).
- **`evaluateTransition` (`:143`)** uses bar high/low (wick-aware) to move a signal `PENDING → TRIGGERED → TARGET1_HIT/TARGET2_HIT/STOPPED/EXPIRED`.
- **Anti-phantom-trade:** if a signal is first observed *already* in a terminal state (hit T2 or stop within one 30s poll), it logs as `MISSED_WINDOW` and **no paper trade opens**.
- **`signal_fingerprint` (`fnoSignalReasoningLogger.ts:262`, `computeSignalFingerprint`):** SHA-256[:16] of the 6-tuple `(signalDate, indexSymbol, setupKey, direction, optionType, selectedStrike)`. The correlation ID linking `EMITTED → OPENED → CLOSED_*` across reasoning rows.

> **State machine:**
> ```
> PENDING ──trigger──▶ TRIGGERED ──┬──▶ TARGET1_HIT ──▶ TARGET2_HIT
>    │                              ├──▶ STOPPED
>    │                              ├──▶ EXPIRED
>    └──stale 45m──▶ (expired)      └──▶ TIME_EXIT_1520 / MANUAL_OVERRIDE
>
> (first-seen terminal) ──▶ MISSED_WINDOW   [no trade]
> ```

---

## 9. Exit / close & realized P&L

- **`pickExitPremium` (`:1534`):** chooses `lastPremium` (force-exit/manual) vs the locked target/stop premium.
- **Exit reasons:** `TARGET1_HIT`, `TARGET2_HIT`, `STOPPED`, `EXPIRED`, `MANUAL_OVERRIDE`, `TIME_EXIT_1520`.
- **15:20 force-exit:** `forceCloseAllOpenFnoFor1520()` (`:1562`) closes every open FNO row, latches `lastForceExit1520Date` (once/day). The **combo lane is opted OUT**. This is the path the post-15:20 Part A check verifies renders as `TIME EXIT 1520` in the UI.
- **Realized P&L:** `realizedPnl = (exitPremium − entryPremium) × lots × lotSize`.

---

## 10. Mark-to-market (MTM)

- **Cohort path:** `markOpenFnoTradesToMarket` — refreshes OPEN rows in the *current* signal cohort.
- **Full sweep (P22):** `markAllOpenFnoTradesToMarket(signalDate)` — refreshes *every* OPEN row by looking up its stored strike/optionType in a fresh chain, even rows that dropped out of the cohort.
- **`pickLtpFromChain(chain, strike, optionType)` (`:1034`):** epsilon-tolerant strike match (numeric round-trip jitter).
- **Freshness:** `MTM_FRESHNESS_WINDOW_MS = 45_000` skips rows already refreshed this cycle. Updates only `last_premium`, `last_evaluated_at`, `max_runup` (GREATEST), `max_drawdown` (LEAST).
- `last_premium` also feeds `pickExitPremium` (settlement) **and** `getBaselineDayStats` (intraday loss cap) — so an MTM staleness bug silently corrupts both the exit price and the baseline guardrail at once. High-blast-radius field.

---

## 11. Observability & diagnostics

- **Reasoning logger (`fnoSignalReasoningLogger.ts`):** writes `fno_signal_reasoning` (`decision`, `reason_code`, `signal_fingerprint`, `snapshot` JSONB). `getReasoningLoggerHealth()` (`:73`) → `writesAttempted/Succeeded/Failed`, last success/error.
- **Daily summary (`paperDailySummaryFo.ts`):** `fetchDurableSkipReasons` (`:47`) reads `SKIPPED/MISSED_WINDOW` from `fno_signal_reasoning` when the in-memory ring is empty. Table `paper_daily_summary_fo` (`signals_generated`, `trades_opened`, `valid_candidates`, `skipped_by_reason` JSONB, `total_pnl`).
- **MTM sweep health:** `getMtmSweepHealth()` (`paperTradingFO.ts:1082`).
- **Routes (`routes/paper.ts`):** `GET /paper/positions/fo` (`:289`, live-LTP enriched), `GET /paper/trades/fo` (`:315`), `POST /paper/positions/fo/:id/close` (`:343` → `MANUAL_OVERRIDE`), `GET /paper/diagnostics/untriggered/fo` (`:473`), `…/daily-summary/fo` (`:521`), `…/environment` (`:556`), `…/mtm-sweep-health` (`:1100` ⚠ Q3). Plus the combo-lane endpoints (`/api/paper/combos`).

---

## 12. DB schema (`lib/db/src/schema/`)

| Table | File:line | Holds |
|-------|-----------|-------|
| `paper_trade_fo` | `paperTrading.ts:73–132` | id, signal_date, index_symbol, setup_key, direction, option_type, strike, lots, lot_size, entry_premium, stop_premium, target1_premium, target2_premium, capital_deployed, last_premium, status, exited_at, exit_premium, exit_reason, realized_pnl, max_runup, max_drawdown, journal, tags |
| `option_signal_history` | `optionSignals.ts:12–71` | signal geometry + status + MFE/MAE |
| `fno_signal_reasoning` | `fnoSignalReasoning.ts:67–143` | decision / reason / fingerprint / snapshot |
| `paper_daily_summary_fo` | `paperTrading.ts:306–330` | daily roll-up + skipped_by_reason |

---

## 13. Why you saw "all BASELINE, 0 HC" today

Every cycle logged `highConvictionCount=0`: the detectors found directional reads (BASELINE votes) but **no setup cleared the HC emission floor + demotion gates**, so nothing reached STANDARD-tier auto-open. The 2 BASELINE opens attempted at 10:07 IST failed at the **dedup SELECT** (`:344`) due to the Neon connect timeout — **infrastructure, not strategy**.

**Two caveats on this diagnosis:**
1. It assumes the emission floor reading (Q1) is correct. If the true floor is 65 not 70, some setups *did* clear it and were lost downstream — a different root cause. Confirm before concluding "strategy is fine."
2. The fail-OPEN circuit breaker (Q2) + fail-OPEN liquidity gate (#9) mean a Neon wobble doesn't just *block* trades — it can also let *unintended* ones through on a different cycle. Worth grepping the day's reasoning rows for any HC that slipped past during the timeout window.

---

## 14. Suggested next steps (not yet done)

| Priority | Action | Resolves |
|----------|--------|----------|
| High | Diff `HC_EMISSION_FLOOR` vs `MIN_FNO_TRADE` vs `FNO_RISK.MIN_CONFIDENCE` in live source; collapse to one constant or document the gap with a log line | Q1, Q4, §13 caveat 1 |
| High | Decide intended behaviour for circuit-breaker + liquidity fail-OPEN under infra failure; consider fail-closed for the circuit breaker specifically | Q2, §13 caveat 2 |
| Medium | Confirm the `mtm-sweep-health` route line; fix if it's a `paperTradingFO.ts` line pasted into the routes list | Q3 |
| Medium | Add a dedicated emit-but-don't-trade counter so the §4 gap is observable in logs, not inferred | §4 |
| Low | Add retry/backoff around the dedup SELECT (`:344`) and `loadSetupWinRates` (`:254`) so a single Neon timeout doesn't silently drop opens | §6b, §7b |

---

*Want a deeper drill on any single block — verbatim `openPaperTrade` gate code, the full `scoreConfluence` weight derivation, or the exact `clampPlanForIntraday` math? Name the block and I'll expand it. (This document is a trace; no code was changed.)*
