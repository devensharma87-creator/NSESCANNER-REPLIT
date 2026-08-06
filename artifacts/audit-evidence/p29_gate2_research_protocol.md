# Pack 9 — Frozen Research Protocol v1.0

**Protocol ID:** PACK9-PROTO-2026-08-06  
**Written:** 2026-08-06T10:05:00Z  
**Status:** FROZEN — no changes permitted after hash is recorded. Any modification requires a new Protocol ID and invalidates the untouched test period.

---

## 1. Candidate Hypotheses

Seven intraday F&O strategy archetypes are evaluated. All must use the same economic logic across NIFTY, BANKNIFTY, and SENSEX (index-specific contract resolution and date-effective lot sizes allowed; arbitrary per-index parameter drift is not).

| ID | Family | Direction | Data Requirement |
|---|---|---|---|
| C1 | Opening-Range Momentum Breakout (ORB) | Directional | Real spot candles + real option premiums for qualification |
| C2 | Trend Pullback / EMA Continuation | Directional | Real spot candles + real option premiums for qualification |
| C3 | Volatility Compression Breakout | Directional | Real spot candles + real option premiums for qualification |
| C4 | Defined-Risk Directional Debit Spread | Multi-leg | Synchronized real bid/ask premiums for both legs required |
| C5 | Failed-Breakout / Liquidity-Sweep Reversal | Counter-trend | Real spot candles + real option premiums; no VWAP mean-reversion |
| C6 | Volatility-Expansion Long Straddle/Strangle | Volatility | Two-leg real premiums at synchronized timestamps required |
| C7 | Defined-Risk Premium-Selling (Iron Fly/Condor) | Neutral | Four-leg real bid/ask with margin/tail-loss modeling required |
| CB | Existing accepted setups (benchmark controls) | Mixed | As already implemented; not eligible for UNIVERSAL_FNO_V2_QUALIFIED |

---

## 2. Allowed Input Fields

**Spot candle fields (real Kite-fetched CSV):** open, high, low, close (no volume — index candles carry no volume).  
**Derived indicators (computed from real OHLC):** EMA(9), EMA(20), EMA(50), RSI(14), ATR(14), ADX(14), opening-range high/low, session mean (equal-weight typical-price substitute).  
**Option chain snapshot fields (real captured, if available):** LTP, bid, ask, spread, IV, delta, theta, OI, volume, captured_at.  
**Excluded fields:** fabricated premiums, interpolated prices, Yahoo/Upstox-shadow values in trade qualification, same-bar close as execution price.

---

## 3. Entry Decision Timestamp

All entry decisions use the **close of the decision bar**. Execution occurs at the **next eligible captured quote** (≤ REPLAY_ENTRY_TOLERANCE_MIN = 5 minutes after the close timestamp). No bar's information may be used to both generate the signal and compute the fill price on the same bar.

---

## 4. Execution / Fill Model

- **Fill price priority:** Real captured LTP → real bid/ask midpoint → Black-Scholes from captured IV (labeled `BLACK_SCHOLES_MODELLED`) → UNAVAILABLE (null P&L, not priced).
- **Tolerance:** ≤ 5 minutes (REPLAY_ENTRY_TOLERANCE_MIN) between signal close and fill capture.
- **Multi-leg synchronization:** Both legs of a spread/straddle must resolve within the same 5-minute tolerance window; mismatched legs → trade marked UNAVAILABLE.
- **Delta proxy (DIRECTIONAL mode):** ATM delta ≈ 0.50; P&L = |delta| × sign × (exitSpot − entrySpot) × lotSize × lots. Labeled `MODELLED_DIRECTIONAL_PROXY` on every trade. **Excluded from qualification.**

---

## 5. Contract, Strike, and Expiry Selection

- **Contract:** ATM option (nearest-to-spot strike on the decision bar).
- **Strike step:** NIFTY = 50 pt, BANKNIFTY = 100 pt, SENSEX = 100 pt.
- **Expiry:** Nearest expiry ≥ signal date present in `option_chain_snapshot` (memoized per underlying/date).
- **Expiry cadence:** NIFTY weekly (Wednesdays), BANKNIFTY monthly, SENSEX weekly (Wednesdays).
- **Lot sizes:** Date-effective NSE lot sizes as of the trade date (NIFTY=65, BANKNIFTY=30, SENSEX=20 for the primary research window; any revision date applies from that date forward).

---

## 6. Exit, Stop, Target, and Time-Stop Rules

- **Stop:** 1× ATR(14) from entry spot in the adverse direction.
- **Target 1:** 1× ATR(14) in the favorable direction (default parameter).
- **Target 2:** 2× ATR(14) in the favorable direction (default parameter, optional).
- **Time stop:** Hard force-exit at 15:20 IST (market close margin). No position held overnight.
- **Intrabar fill:** When stop/target is breached intrabar, fill at the stop/target price (not the close).

---

## 7. Maximum Trades per Day and Overlap Policy

- **Maximum simultaneous positions:** 1 per index (one position at a time).
- **Maximum trades per day per index:** No hard limit; time-stop prevents excessive activity.
- **Overlap policy:** A new signal is rejected while a position is open on the same index.

---

## 8. Transaction Costs, Slippage, and Spread Assumptions

All rates sourced from `FNO_COST_PARAMS` (effective 2026-04-01):

| Component | Rate |
|---|---|
| Brokerage | ₹20 per side (₹40 round-trip) |
| STT | 0.15% on sell-side option premium turnover |
| Exchange transaction | 0.03503% on total premium turnover (both legs) |
| SEBI charges | ₹10 per crore on total turnover |
| GST | 18% on (brokerage + exchange + SEBI) |
| Stamp duty | 0.003% on buy-side premium |
| Spread cost | 25 bps per side (canonical default; real bid/ask used when available) |
| Slippage | 10 bps per side (market-order slippage estimate) |

**Stress test:** All results also computed at 2× default spread and 3× slippage; qualification requires survival.

---

## 9. Chronological Train / Validation / Test Split

**Spot candle universe:** 2024-07-18 to 2026-07-17 (real 15-min Kite-fetched CSV).  
**Option snapshot universe:** captured from system activation; must verify actual coverage dates.

| Period | Dates | Purpose |
|---|---|---|
| Training | 2024-07-18 to 2025-10-31 | Parameter selection |
| Validation | 2025-11-01 to 2026-03-31 | Bounded parameter refinement |
| **Test (UNTOUCHED)** | **2026-04-01 to 2026-07-17** | **Final evaluation — no parameter changes after viewing** |

**The test period (2026-04-01 to 2026-07-17) is sealed. Parameters selected on training/validation data must not be modified after any test-set result is inspected.**

---

## 10. Walk-Forward Schedule (Growing Window, 3 Folds)

| Fold | Training Window | Validation Window |
|---|---|---|
| F1 | 2024-07-18 to 2025-01-31 | 2025-02-01 to 2025-04-30 |
| F2 | 2024-07-18 to 2025-06-30 | 2025-07-01 to 2025-09-30 |
| F3 | 2024-07-18 to 2025-10-31 | 2025-11-01 to 2026-01-31 |

---

## 11. Regime Definitions

| Regime | Classification Rule |
|---|---|
| TRENDING_BULL | EMA9 > EMA21, spot above VWAP-substitute, ADX > 20 |
| TRENDING_BEAR | EMA9 < EMA21, spot below VWAP-substitute, ADX > 20 |
| RANGING | ADX ≤ 20 |
| HIGH_VOL | ATR / spot > 0.8% (ATR-pct above threshold) |
| LOW_VOL | ATR / spot < 0.4% |
| GAP_DAY | |open − prev_close| / prev_close > 0.3% |
| EXPIRY_DAY | Current date is the expiry date for any of the three indices |

---

## 12. Qualification Metrics and Minimum Samples

**Minimum sample requirements (all must pass):**
- ≥ 30 qualifying trades per index on the untouched test set
- ≥ 60% of eligible entry bars priced (not UNAVAILABLE) — REPLAY_MIN_COVERAGE_PCT threshold

**Qualification thresholds (all must pass simultaneously):**
- Positive net expectancy: E[net P&L per trade] > 0 after all costs (untouched test)
- Profit factor ≥ 1.30 on the combined three-index untouched test set
- Maximum drawdown ≤ 20% of starting research capital on the untouched test
- Missing premium / UNAVAILABLE rate ≤ 30% of eligible trades
- Cost/slippage stress survival: result remains positive at 2× spread, 3× slippage
- No single trading day, expiry date, or index accounts for > 40% of total net profit
- No catastrophic regime failure: no single regime produces ≥ −15% drawdown
- Parameter-neighborhood stability: ±10% parameter perturbation does not flip the sign of net P&L
- Walk-forward consistency: ≥ 2 of 3 folds show positive validation P&L

---

## 13. Parameter Search Space and Maximum Trials

| Parameter | Range | Step | Default |
|---|---|---|---|
| target1R (T1 risk multiple) | 0.5 – 2.0 | 0.5 | 1.0 |
| target2R (T2 risk multiple) | 1.0 – 3.0 | 0.5 | 2.0 |

**Maximum trials per candidate per index:** 12 (4 T1 values × 3 T2 values).  
**Multiple-testing correction:** Bonferroni correction applied across 7 candidates × 3 indices = 21 tests (α = 0.05 → α_corrected = 0.0024). Statistical significance is informative, not a gate; economic significance (effect size) is primary.

---

## 14. Tie-Breaking and Rejection Rules

- If two parameter sets tie on profit factor, select the one with lower max drawdown.
- If still tied, select the one with more trades (more robust sample).
- A candidate is immediately rejected (`REJECTED_DATA_INTEGRITY`) if any lookahead, synthetic premium use, or provider-policy violation is detected.
- A candidate is rejected (`REJECTED_COST_SENSITIVE`) if it fails the 2× spread stress test even with positive baseline results.
- Proxy-only results (MODELLED_DIRECTIONAL_PROXY) are classified `REJECTED_DATA_INTEGRITY` for qualification purposes — the directional evidence is preserved separately as exploratory research.

---

## 15. Untouched Test Period Guarantee

The test period (2026-04-01 to 2026-07-17) must not be used for parameter selection or post-hoc adjustment. Any change to parameters after viewing test results requires:
1. A new Protocol ID (PACK9-PROTO-YYYY-MM-DD-Rn).
2. A new untouched test period (earlier data becomes training).
3. The prior experiment to be recorded as INVALIDATED.

END_OF_RESEARCH_PROTOCOL_PACK9_V1_0
