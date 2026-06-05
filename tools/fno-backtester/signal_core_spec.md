# F&O Signal Core — Specification v1

**Status:** Design spec for review. No trading logic is final until this is approved and the backtester (Layer 4) validates it on 2–3 years of data.

**Scope:** NIFTY, BANKNIFTY, SENSEX only. 15-minute bars. Long options only (buy ATM CE/PE). Paper-trading until backtest evidence justifies otherwise.

**Design principle:** ONE legible score per index per bar. Every input is visible and auditable. There is no hidden second engine that overrides the first — the failure mode of the old system.

---

## 1. The confluence gate (your chosen design)

A signal is emitted **only when all core structural factors agree** on direction. This is deliberately strict. It produces few, high-quality signals. Expect 1–3 trades per week across all three indices combined, not per day.

The four **core factors** (all must agree on direction for a trade to exist):

| Factor | Bullish when | Bearish when |
|---|---|---|
| **EMA stack (9/20/50)** | 9 > 20 > 50, price above all | 9 < 20 < 50, price below all |
| **VWAP location** | price above session VWAP | price below session VWAP |
| **SMC structure** | last break of structure is bullish (higher high + bullish CHoCH/BOS) | last BOS bearish (lower low) |
| **FVG alignment** | price reacting from a bullish fair-value gap (demand) | price reacting from a bearish FVG (supply) |

If these four do not all point the same way → **NEUTRAL, no signal.** This is the gate.

## 2. The tilt layer (does not gate, only adjusts confidence)

Once the gate passes, three context inputs adjust a confidence score but **cannot create or block** a trade:

| Tilt input | Effect |
|---|---|
| **FII/DII daily bias** (EOD) | ±10 confidence if today's direction matches net institutional cash flow direction; penalty if against |
| **Regime** (TRENDING / RANGING / VOLATILE / EXPIRY) | trend-with = bonus; counter-trend or expiry = penalty; VOLATILE = size ×0.5 downstream |
| **RSI(14)** | confirms (50–70 long / 30–50 short) = small bonus; overbought/oversold against direction = small penalty |

**Confidence = 60 (base, since gate already passed) + tilt adjustments, clamped [0, 100].**

Because the gate is strict, base starts at 60 (a passed-gate signal is already decent). HC floor for full-size remains a tunable parameter, NOT assumed — the backtest sets it.

## 3. Auto-derived levels (Entry / Stop / T1 / T2)

All levels are **spot-level first** (where the index must trade), then translated to the ATM option premium for settlement. This fixes the old PREMIUM_STOP_HIT leak by keeping spot and premium stops reconciled.

- **Entry:** the confluence trigger price — the 15m close that confirms the setup (e.g. reclaim of VWAP / mitigation of the FVG). No chasing: if price is already >0.5% or >1.2×ATR15 beyond trigger, the signal is stale → skip.
- **Stop:** structural — beyond the SMC swing point that invalidates the setup, floored at `max(0.30% of spot, 1.0×ATR15)`, capped at `max(0.45% of spot, 0.6×ATR15)`. If the structural stop is wider than the cap by >1.5×, **reject** (vol regime broke the setup).
- **Target 1:** nearest opposing structure (prior swing / VAH-VAL / POC), and must be ≥ 1.5R from entry or the trade is rejected for poor R:R **before** it's taken.
- **Target 2:** `entry + (T1 distance × 1.7)`, capped at the next major structural level.
- **Premium reconciliation:** the spot stop is converted to a premium stop via the live/historical chain. The 30%-of-premium cap is a *backstop*, not the primary stop. If the spot stop implies a premium loss >30%, the **position size is reduced** so the spot stop fits — rather than tightening the premium stop and getting noise-stopped. This is the key fix.

## 4. What changed from the old system, and why

| Old behaviour | Problem (from your data) | New behaviour |
|---|---|---|
| Detector confidence overridden by confluence engine | Two engines, opaque, median conf 50 | One score, gate + tilt, fully visible |
| Logged every 30s poll | 88× duplicate inflation, broke all metrics | Log once per state-change only |
| Premium stop tightened to 30% | PREMIUM_STOP_HIT 0% win, −₹4,447 avg | Reconcile via position SIZE, not stop tightening |
| Hard time cutoffs (13:30, 14:45) | Killed 13:00–14:00, your best window | Cutoffs set by backtest, not assumption |
| Caps guessed (2 baseline/day, 2 stops) | Strangled dominant setup | Caps set by backtest drawdown evidence |

## 5. Open parameters — to be set by the backtester, NOT guessed

These are explicitly **unknown** until Layer 4 runs. Hard-coding them now is what broke the old system:

- HC confidence floor for full-size sizing
- Daily / weekly drawdown caps
- Max trades per day per index
- Session cutoff times (if any survive the evidence)
- Slippage assumption per side (start 0.5%, calibrate)
- R:R minimum (start 1.5, test 1.2–2.0)

## 6. Explicit non-goals (honesty)

- This will **not** win every trade. Target is positive expectancy after costs, not high win rate.
- This is **not** "full proof." It is measurable, auditable, and cost-honest.
- It will be **quiet.** Few trades is the design, not a bug.
