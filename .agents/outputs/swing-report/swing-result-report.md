# Swing (Equity) Trading — Result Report

  **Source:** Production live paper-trading track record (`paper_trade_eq`, status = CLOSED)
  **Window:** signal 2026-04-29 → last exit 2026-06-04 (IST)
  **Generated:** 2026-06-07
  **Charge model:** Zerodha-equivalent NSE equity-delivery, FY 2025-26 (STT 0.1% both sides, NSE txn, SEBI, 18% GST, stamp 0.015% buy, DP ₹15.93/sell)

  > This is a *paper-trading* track record produced by the app's automated swing engine plus a few manual overrides. It is not advice; it reflects modeled fills and modeled costs.

  ## Headline

  | Metric | Value |
  |---|---|
  | Closed trades | 13 (currently 8 open) |
  | Win rate | 46.2% (6W / 7L) |
  | Gross realized P&L | ₹50,514.25 |
  | Modeled charges | ₹5,207.83 |
  | **Net P&L (after costs)** | **₹45,306.42** |
  | Net return on ₹10,00,000 base | 4.53% |
  | Profit factor | 2.38 |
  | Expectancy / trade | ₹3,485.11 |
  | Avg R-multiple | 0.69R |
  | Avg win / Avg loss | ₹13,005.59 / -₹4,675.31 |
  | Best / Worst trade | ₹28,337.76 / ₹-13,162.76 |
  | Avg holding period | 5.0 days |

  ## By exit reason

  | Exit reason | Trades | Net P&L | Win % |
  |---|---:|---:|---:|
  | MANUAL_OVERRIDE | 5 | ₹30,200.39 | 60% |
| STOPPED | 3 | ₹-25,618.61 | 0% |
| TARGET2_HIT | 2 | ₹28,332.72 | 50% |
| TRAIL_STOP_HIT | 3 | ₹12,391.92 | 67% |

## Per-trade detail

| Symbol | Exit (IST) | Days | Qty | Entry | Exit | Net P&L | R | Reason |
|---|---|---:|---:|---:|---:|---:|---:|---|
| RBLBANK | 2026-04-30 | 1 | 727 | 343.45 | 341.2 | ₹-2,204.90 | -0.12 | MANUAL_OVERRIDE |
| GODREJPROP | 2026-05-05 | 1 | 130 | 1912.7 | 1815.7209 | ₹-13,162.76 | -1.00 | STOPPED |
| CROMPTON | 2026-05-08 | 9 | 898 | 278.25 | 294.35 | ₹13,871.57 | 1.05 | MANUAL_OVERRIDE |
| JINDALSTEL | 2026-05-08 | 4 | 197 | 1262.9 | 1240.9 | ₹-4,898.37 | -0.37 | MANUAL_OVERRIDE |
| LAURUSLABS | 2026-05-08 | 4 | 214 | 1166.3 | 1226.9 | ₹12,384.33 | 1.10 | MANUAL_OVERRIDE |
| MARICO | 2026-05-08 | 3 | 301 | 789.05 | 827.6 | ₹11,047.75 | 1.31 | MANUAL_OVERRIDE |
| CIPLA | 2026-05-14 | 1 | 199 | 1279.1 | 1424.5743 | ₹28,337.76 | 3.00 | TARGET2_HIT |
| HAL | 2026-05-15 | 1 | 45 | 4649 | 4436.2943 | ₹-10,042.72 | -1.00 | STOPPED |
| JSWSTEEL | 2026-05-18 | 3 | 53 | 1314 | 1271.6463 | ₹-2,413.13 | -1.00 | STOPPED |
| ZEEL | 2026-05-27 | 0 | 2 | 83.7 | 89.34 | ₹-5.03 | 3.00 | TARGET2_HIT |
| GRASIM | 2026-06-01 | 18 | 1 | 2910.3 | 3105.3074 | ₹172.41 | 1.00 | TRAIL_STOP_HIT |
| GRASIM | 2026-06-01 | 17 | 70 | 2938.9 | 3120.4148 | ₹12,219.73 | 1.00 | TRAIL_STOP_HIT |
| NMDC | 2026-06-04 | 3 | 3 | 89.1 | 94.54 | ₹-0.22 | 1.00 | TRAIL_STOP_HIT |

## How to read this

  - **Profit factor 2.38** means gross winners were 2.38× gross losers — the edge came from winners being much larger than losers (avg win ₹13,005.59 vs avg loss ₹4,675.31), not from a high hit-rate (win rate is 46%). That is a classic trend/swing profile and depends on letting winners run and cutting losers at the stop.
  - **5 of 13 exits were MANUAL_OVERRIDE** — a meaningful share of the result came from discretionary closes, not the pure automated rules. The fully-systematic exits (STOPPED / TARGET2_HIT / TRAIL_STOP_HIT) net **₹15,106.04** across 8 trades.
  - **Sample size is small (13 closed trades over ~5 weeks)** — not yet statistically robust for a go-live decision.
  - 8 positions are still open; their unrealized P&L is **not** in these numbers.
  