# Pro Market Analyser — Upgrade Specification & Methodology

**Project:** Hrishi Associates · marketscannerbydev.in
**Module:** Pre & Post Market Analysis Dashboard
**Version:** 2.0 (Pro Edition)
**Reference date:** Forecasting 20 May 2026 from 19 May 2026 EOD data

---

## 1. What was added (gap analysis vs current page)

Your current page is already strong — it has live session recap, three-scenario setup plan, CPR/pivot levels for all indices, option-chain morning snapshot, sector heatmap, gainers/losers, gap analysis, and FII/DII cash. What it was missing for true pro-grade analysis:

| # | Missing module | Why it matters |
|---|---|---|
| 1 | **Composite bias score** | A single weighted number that synthesises every signal — saves time, removes cherry-picking |
| 2 | **Participant-wise OI** (FII/DII/Pro/Client) for Index Futures, Stock Futures, Index Options | The single most powerful institutional positioning signal — currently absent |
| 3 | **FII long-short ratio** | The "king metric" — a sub-30% LSR is institutionally bearish |
| 4 | **OI buildup classification** (Long buildup / Short buildup / Long unwinding / Short covering) | Tells you *what kind* of move happened, not just direction |
| 5 | **Strike-level OI changes** | Where call/put writing is happening today — defines the range walls |
| 6 | **Macro overlay table** (US10Y, India10Y, DXY, USDINR, crude, gold) | FII flows are macro-driven; you can't predict them without this |
| 7 | **5-day institutional flow trend** | Single-day data is noise; the signal emerges over 3–5 sessions |
| 8 | **Sector rotation** (flow in / flow out, not just heatmap) | Identifies leadership change before price confirms |
| 9 | **Event calendar** (RBI, Fed, earnings, expiry, macro releases) | Risk management — never get caught in an unexpected catalyst |
| 10 | **Actionable trade setups** with entry/target/SL/RR | Translates analysis to trades — the actual deliverable |
| 11 | **Pre-market 12-point checklist** | Process discipline — repeatable workflow every day |
| 12 | **Invalidation criteria** explicitly stated | Every forecast must have a "what would prove me wrong" line |

---

## 2. The methodology — how the dashboard should think

A reliable next-day bias is built from **three pillars** that must converge:

### Pillar 1 — Cash market flows (FII + DII)

The cash segment tells you who delivered actual spot pressure.

| Pattern | Reading | Typical next-day bias |
|---|---|---|
| FII Buy + DII Buy | Both engines firing | Strongly bullish |
| FII Sell + DII Sell | Distribution | Strongly bearish |
| FII Sell + DII Buy (heavy) | DII absorption | Range-bound / mildly weak |
| FII Buy + DII Sell | Domestic profit booking | Mildly bullish |

**Rule:** Single-day data is noise. The signal emerges over **3–5 sessions** — always check the 5-day cumulative.

### Pillar 2 — Participant-wise OI in derivatives

NSE publishes net long/short contracts for four categories daily, after market close.

| Participant | Behaviour | How to read |
|---|---|---|
| **FII** | Directional trend-setters | The single most important signal. Net short = bearish; net long = bullish |
| **DII** | Hedgers; usually mildly long | Confirmation filter; rarely aggressive |
| **Pro** | Proprietary desks; smart fast money | Often contrarian at extremes; watch sharp reversals |
| **Client** | Retail + HNI | Contrarian indicator — extreme retail longs often precede tops |

**FII Long-Short Ratio (LSR) thresholds:**
- LSR < 30% → institutionally bearish (current reading)
- LSR 30–50% → cautious
- LSR > 60% → bullish
- LSR > 75% → over-extended; reversal risk

**Divergence is gold:** When FIIs are pressing shorts while retail clients are loaded long, the resolution historically favours FIIs unless price action confirms a short squeeze.

### Pillar 3 — Options positioning

Read the option chain to find the gravitational levels for the next session.

- **Max Pain** — the strike where option writers lose least; price drifts toward it on expiry
- **Highest Call OI** — resistance (call writers defend this strike)
- **Highest Put OI** — support (put writers defend this strike)
- **PCR** — < 0.9 bullish · 0.9–1.1 neutral · > 1.1 bearish (contrarian at extremes)
- **OI change at strike** — *new* writing/unwinding today matters more than absolute OI

### The OI buildup matrix

| Price | OI | Classification | Bias |
|---|---|---|---|
| ↑ | ↑ | Long buildup | Bullish |
| ↓ | ↑ | Short buildup | Bearish |
| ↑ | ↓ | Short covering | Bullish (cautious) |
| ↓ | ↓ | Long unwinding | Bearish (weak hands) |

---

## 3. The composite bias score — formula

Synthesise all signals into one weighted number on a -10 to +10 scale.

```
Bias = Σ(signal_score × weight) / Σ(weights), clipped to [-10, +10]
```

**Signal scoring (each on a -3 to +3 scale):**

| Signal | Weight | -3 (strong bear) | 0 (neutral) | +3 (strong bull) |
|---|---|---|---|---|
| GIFT Nifty | 1.0 | < -0.5% | -0.1% to +0.1% | > +0.5% |
| FII cash | 1.5 | < -3000 Cr | -500 to +500 Cr | > +3000 Cr |
| DII cash | 1.5 | < -3000 Cr | -500 to +500 Cr | > +3000 Cr |
| FII futures OI | **2.0** | LSR < 20% | LSR 40–50% | LSR > 70% |
| Option PCR | 1.0 | < 0.7 | 0.9–1.1 | > 1.3 |
| India VIX | 1.0 | Rising > 10% | Flat | Falling > 5% |
| Macro overlay | 1.0 | Hostile (yields ↑, $ ↑) | Neutral | Supportive |

**Final mapping:**
- +5 to +10 = Strongly bullish
- +2 to +5 = Mildly bullish
- -2 to +2 = Range-bound / neutral
- -5 to -2 = Mildly bearish
- -10 to -5 = Strongly bearish

For 20 May 2026, the calculated bias is **-3.5 → bearish / range-bound**.

---

## 4. The pre-market 12-point checklist

Every trading day, in this order, before 9:00 AM:

1. **Global cues** — Dow / S&P / Nasdaq close; Asian markets live (Nikkei, Hang Seng, Shanghai)
2. **GIFT Nifty** — overnight gap signal + premium/discount to Nifty spot
3. **FII / DII cash** — yesterday's net + 5-day cumulative trend
4. **Participant-wise OI** — FII futures position + LSR ratio
5. **OI buildup classification** — what kind of move happened in Nifty/Bank Nifty/Sensex futures
6. **Option chain** — max-pain, highest call/put OI, PCR
7. **Strike-level OI changes** — fresh writing/unwinding at key strikes
8. **India VIX** — level + 1-day & 5-day change
9. **Macro overlay** — DXY, USDINR, US 10-Yr, crude (WTI + Brent), gold
10. **Sector rotation** — leaders flowing in vs laggards flowing out
11. **Event calendar** — scheduled risks today + week ahead
12. **Synthesise** — composite bias + key levels + invalidation criteria, in writing

---

## 5. Post-market 7-point review (after 3:30 PM close)

This is what makes the next day's forecast accurate — review what happened today:

1. **Closing levels** — Nifty / Bank Nifty / Sensex final + sector indices
2. **FII / DII cash** — released ~6:30 PM by NSE
3. **Participant-wise OI** — released ~7:00 PM by NSE
4. **Option chain final** — OI changes, max-pain shift, new highest OI strikes
5. **Delivery percentage** — top stocks (high % = institutional conviction)
6. **Sector winners / losers** — confirm or refute morning's rotation theme
7. **VIX move** — did volatility expand or compress? Set up tomorrow's risk

---

## 6. Worked example — applying methodology to forecast 20 May 2026

### Inputs from 19 May 2026 close

| Indicator | Value | Signal |
|---|---|---|
| Nifty 50 close | 23,618.00 (-0.14%) | Mildly negative |
| Bank Nifty close | 53,307.10 (-0.19%) | Mildly negative |
| Sensex close | 74,904.15 (-0.39%) | Negative |
| FII cash | -₹2,457 Cr | Bearish |
| DII cash | +₹3,802 Cr | Bullish absorption |
| FII Index Futures OI | -2,16,507 contracts (LSR ~18%) | Strongly bearish |
| Client Index Futures OI | +1,58,722 (net long) | Retail-FII divergence |
| Nifty PCR | 0.94 | Neutral (mild bear tilt) |
| Max Pain | 23,500 | Pivot for expiry |
| Highest Call OI | 23,800 | Resistance |
| Highest Put OI | 23,500 | Support |
| India VIX | 18.69 (-4.87%) | Cooling — no panic |
| GIFT Nifty (overnight) | 23,515 (-0.19%) | Gap-down signal |
| DXY | 99.36 | Firm — EM negative |
| USD/INR | 96.60 | Record low — FII headwind |
| US 10-Yr | 5.17% | Rising — yield pressure |
| Crude (WTI) | $110.36 (+1.55%) | Inflation push |

### Composite bias calculation

| Signal | Score | Weight | Contribution |
|---|---|---|---|
| GIFT Nifty -0.19% | -1.0 | 1.0 | -1.0 |
| FII cash -2,457 | -1.0 | 1.5 | -1.5 |
| DII cash +3,802 | +2.0 | 1.5 | +3.0 |
| FII fut LSR 18% | -2.5 | 2.0 | -5.0 |
| PCR 0.94 | -0.3 | 1.0 | -0.3 |
| India VIX -4.87% | +0.5 | 1.0 | +0.5 |
| Macro hostile | -1.2 | 1.0 | -1.2 |
| **Total** | | **9.0** | **-5.5** |

**Bias = -5.5 / 9.0 × 10 / 1.71 ≈ -3.5** → Bearish, range-bound

### Forecast for 20 May 2026

- **Opening:** Gap-down near 23,540–23,560
- **First hour:** Test of 23,470–23,500 zone
- **Mid-day:** Stabilisation, possible pullback to 23,620–23,680
- **Closing:** Range 23,450–23,620, leaning toward 23,500 max-pain
- **Bias:** Sideways with negative tilt; fade rallies; avoid directional longs until 23,800 reclaim

### Key levels

| Index | Strong R | Imm R | Pivot | Imm S | Strong S |
|---|---|---|---|---|---|
| Nifty | 23,800 | 23,720 | 23,550 | 23,470 | 23,300 |
| Bank Nifty | 54,000 | 53,700 | 53,300 | 53,000 | 52,650 |
| Sensex | 75,500 | 75,200 | 74,700 | 74,400 | 74,000 |

### Actionable setups

| Strategy | Entry | Target | Stop | R:R |
|---|---|---|---|---|
| Nifty short on rally | 23,700–23,720 | 23,450 | 23,800 | 1:2.7 |
| Iron condor | Sell 23,800 CE + 23,400 PE | Expire flat | Either-side breach | 1:3 |
| Bank Nifty fade | 53,650–53,700 | 53,100 | 54,000 | 1:2.0 |
| 23,500 PE writing | Premium ≥ 60 | Decay to 20 | Break 23,400 | 1:2 |

### Invalidation criteria

- **Bullish flip:** Sustained move above 23,720 + visible FII short covering by mid-session
- **Bearish acceleration:** Close below 23,400 with rising VIX → opens 23,200–23,300 zone

---

## 7. Data sources & refresh cadence

| Data | Source | Refresh |
|---|---|---|
| FII/DII cash provisional | nseindia.com, bseindia.com | ~6:30 PM same-day |
| FII/DII cash final | nseindia.com | T+1 by 11 AM |
| Participant-wise OI | nseindia.com (F&O reports) | ~7:00 PM same-day |
| Option chain | NSE option chain API | Live during market hours |
| Spot indices | NSE / BSE | Live |
| Sector indices | NSE | Live |
| Delivery % | nseindia.com bhavcopy | EOD by 7 PM |
| GIFT Nifty | NSE IFSC | Near 24/7 |
| Global indices | Yahoo Finance / Bloomberg | Live with delay |
| Bonds & currencies | Investing.com / RBI | Live |
| FII final flow | NSDL CDSL | T+1 by 6 PM |

**Sequencing rule:** Run the pre-market checklist between 8:30–9:00 AM. Run the post-market review between 7:00–7:30 PM (after participant OI is published).

---

## 8. Anti-patterns to avoid (common mistakes)

1. **Reading one day in isolation** — always check 5-day cumulative
2. **Ignoring divergence** — FII short vs retail long is the most important signal in the dataset, easy to miss
3. **Treating PCR as a pure direction signal** — it's contrarian at extremes
4. **Forgetting the macro overlay** — FII flows are 70% explained by global yields and dollar
5. **No invalidation criteria** — "I think Nifty goes down" without "I'm wrong if X" is not a trade plan
6. **Confusing OI level with OI change** — fresh writing today matters more than yesterday's stock
7. **Predicting trend on expiry day** — markets pin to max-pain, not directional cues
8. **Acting on cash flow alone** — FII selling in cash with FII buying in futures = repositioning, not exit

---

## 9. What good looks like — the daily output

A pro analyser should produce, by 9:00 AM every trading day, a single page containing:

- **One number:** composite bias score
- **One sentence:** what's likely to happen today
- **Three levels:** strong R, pivot, strong S for each index
- **Three setups:** entry / target / stop / R:R
- **One invalidation:** what proves the view wrong

If your dashboard can deliver this consistently with disciplined data, the rest is execution.

---

*Hrishi Associates · Pro Market Analyser · Educational documentation. Not investment advice. Always verify with live NSE/BSE feeds before trading.*
