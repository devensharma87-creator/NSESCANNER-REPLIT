# H4 — Swing Historical Daily-OHLC Outcome Replay Summary

  > **historical daily-bar replay / offline shadow evidence / approximate / not live-verified / not intraday-exact / not implementation approval**
  > Daily OHLC cannot prove exact intraday order when both stop and target fall inside the same day's range. All "_hit" markers and outcome labels are **best-effort daily approximations**.
  > No live swing scoring, recommendations, entries, stops, targets, RR, trigger latch, intraday refresh, paper-equity, F&O, schema, scheduler, workflows, route auth, `replit.md`, or memory/docs were touched.

  ## A. Data window used
  Scan dates **2026-05-11 … 2026-05-27** (9 days; 2026-05-28 = today, excluded since 0 forward bars).
  Forward OHLC pulled from Yahoo (3-month range), trimmed to bars strictly **after** each row's scan_date.

  ## B. Scan dates included
  - 2026-05-11: 159 rows, avg 12.0 forward bars (min 12, max 12)
- 2026-05-13: 111 rows, avg 10.0 forward bars (min 10, max 10)
- 2026-05-14: 118 rows, avg 9.0 forward bars (min 9, max 9)
- 2026-05-15: 10 rows, avg 8.0 forward bars (min 8, max 8)
- 2026-05-18: 98 rows, avg 7.0 forward bars (min 7, max 7)
- 2026-05-19: 106 rows, avg 6.0 forward bars (min 6, max 6)
- 2026-05-20: 105 rows, avg 5.0 forward bars (min 5, max 5)
- 2026-05-26: 132 rows, avg 1.0 forward bars (min 1, max 1)

  (_Forward-bar count drops as scan_date approaches today; 5/27 has only 1 forward bar, while 5/11 has the full 1/3/5/10 window._)

  ## C. Candidate selection logic (4 buckets, deduped per (scan_date, symbol))
  1. **actionable**: `action LIKE 'BUY%' OR 'WATCH%' OR 'WAIT%'`
  2. **top_score**: top 50 by `score` per scan_date
  3. **top_rs**: top 50 by `rs_score` per scan_date
  4. **top_avoid**: `action LIKE 'AVOID%'` AND top 30 by score within AVOID per scan_date

  Each row carries boolean `pick_*` flags. Total selected = **959** unique (scan_date, symbol) rows; bucket overlap is intentional.

  ## D. Number of rows replayed
  **959** total; **839** usable (daily_bars_approximate); 120 not usable (1 no_yahoo_bars, 119 insufficient_no_forward_bars).

  ## E. OHLC data source and coverage
  - Source: **Yahoo Finance v8 chart API**, daily interval, 3-month range. `.NS` suffix tried first, then `.BO`.
  - Symbols requested: 287
  - Symbols with bars: 286
  - Symbols with NO bars: 1 (ZOMATO)

  ## F. Entry / trigger reach rate (overall, daily approximation)
  **74.9 %** of usable rows had their `entry` price reached by a future-day high within the replay window.

  ## G. Target1 hit rate
  **12.3 %** of usable rows reached `target1` by a future-day high (after entry-reached or on entry day, whichever came first).

  ## H. Stop hit rate
  **25.1 %** of usable rows had their `stop_loss` touched by a future-day low (counted only after entry was reached).

  ## I. Ambiguous same-day rate
  **0.2 %** of usable rows had at least one bar where the day's range contained **both** target1 and stop_loss → outcome labelled `ambiguous_same_day_stop_and_target`. These are **not decision-grade for entry/exit timing**.

  ## J. Forward-return summary by action class

  | Group | Count | Entry rate | T1 hit rate | Stop hit rate | Ambig same-day | Not triggered | Avg 1D ret | Avg 5D ret | Avg 10D ret | Avg MFE | Avg MAE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| AVOID | 484 | 76.9 % | 12.2 % | 26.2 % | 0.2 % | 23.1 % | +0.08 % | +1.18 % | +2.18 % | +5.74 % | -3.31 % |
| WAIT | 194 | 73.7 % | 16.5 % | 21.1 % | 0.5 % | 26.3 % | -0.29 % | +0.38 % | +0.42 % | +6.19 % | -4.38 % |
| WATCHLIST | 161 | 70.2 % | 7.5 % | 26.7 % | 0.0 % | 29.8 % | -1.09 % | -1.68 % | +0.82 % | +5.18 % | -5.11 % |

  ## K. Forward-return summary by score bucket

  | Group | Count | Entry rate | T1 hit rate | Stop hit rate | Ambig same-day | Not triggered | Avg 1D ret | Avg 5D ret | Avg 10D ret | Avg MFE | Avg MAE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| <50 | 147 | 76.9 % | 12.9 % | 19.0 % | 0.7 % | 23.1 % | +0.38 % | +2.41 % | +1.96 % | +6.57 % | -2.76 % |
| 50-60 | 361 | 75.6 % | 14.4 % | 25.5 % | 0.3 % | 24.4 % | -0.02 % | +0.82 % | +1.79 % | +6.15 % | -3.80 % |
| 60-70 | 272 | 75.4 % | 10.3 % | 30.5 % | 0.0 % | 24.6 % | -0.64 % | -1.12 % | +0.65 % | +5.29 % | -4.65 % |
| 70+ | 59 | 62.7 % | 6.8 % | 13.6 % | 0.0 % | 37.3 % | -1.10 % | -0.63 % | +3.38 % | +3.18 % | -3.88 % |

  ## L. Forward-return summary by RS bucket

  | Group | Count | Entry rate | T1 hit rate | Stop hit rate | Ambig same-day | Not triggered | Avg 1D ret | Avg 5D ret | Avg 10D ret | Avg MFE | Avg MAE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| high | 467 | 71.5 % | 12.2 % | 22.9 % | 0.2 % | 28.5 % | -0.32 % | -0.19 % | +1.73 % | +5.85 % | -4.21 % |
| medium | 27 | 55.6 % | 7.4 % | 18.5 % | 0.0 % | 44.4 % | -3.72 % | -2.27 % | -1.36 % | +1.94 % | -6.79 % |
| low | 345 | 80.9 % | 12.8 % | 28.7 % | 0.3 % | 19.1 % | +0.17 % | +1.42 % | -5.94 % | +5.88 % | -3.26 % |

  ## M. Forward-return summary by sector leader class (H3 clean dates only — 5/19 & 5/26)

  | Group | Count | Entry rate | T1 hit rate | Stop hit rate | Ambig same-day | Not triggered | Avg 1D ret | Avg 5D ret | Avg 10D ret | Avg MFE | Avg MAE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| leader | 169 | 74.6 % | 10.1 % | 10.7 % | 0.6 % | 25.4 % | +0.90 % | +2.60 % | — | +4.56 % | -1.92 % |
| inline | 61 | 73.8 % | 11.5 % | 19.7 % | 0.0 % | 26.2 % | -0.37 % | +2.70 % | — | +3.46 % | -3.08 % |
| laggard | 7 | 28.6 % | 0.0 % | 0.0 % | 0.0 % | 71.4 % | -0.05 % | -3.30 % | — | +0.82 % | -1.34 % |

  ## N. Whether WATCHLIST/BUY rows outperform AVOID rows

  | Metric | WATCH+BUY (n=161) | AVOID (n=484) | Δ |
  |---|---|---|---|
  | Avg 1D return | -1.09 % | +0.08 % | -1.17 % |
  | Avg 3D return | -1.50 % | +0.37 % | -1.87 % |
  | Avg 5D return | -1.68 % | +1.18 % | -2.86 % |
  | Avg 10D return | +0.82 % | +2.18 % | -1.36 % |
  | Avg MFE | +5.18 % | +5.74 % | -0.56 % |
  | Avg MAE | -5.11 % | -3.31 % | -1.80 % |
  | T1 hit rate | 7.5 % | 12.2 % | — |

  **Scanner-quality risk flag**: WATCH+BUY underperformed AVOID on 1D return by 1.17 pp on this 9-day window. Directionally concerning, but must not be acted on from this sample — short forward window, low actionable-volume per day, no delivery/intraday data.

  ## O. Whether sector leaders outperform laggards (H3 leader_class overlap)

  Leader 1D avg = +0.90 % (n=169); Laggard 1D avg = -0.05 % (n=7); Δ = +0.95 %.
**Label: supports sector-RS overlay design, not live activation.**

  ## P. Data-quality limitations
  - Sample is from a 9-day window with **rapidly shrinking forward depth** (5/27 → 1 bar; 5/11 → ~14 bars).
  - Outcome resolution is **daily granularity**: when stop and target fall in the same bar's H/L range, intraday order is unknown → labelled `ambiguous_same_day_stop_and_target`.
  - Yahoo OHLC is post-market consolidated; intraday touches that did not print may be missed.
  - 1 symbol missing from Yahoo (ZOMATO).
  - BUY rows are essentially absent in the historical sample (1 `BUY BREAKOUT / RETEST ONLY` row total, on 5/28 which is excluded). The "WATCH+BUY" comparison is effectively **WATCHLIST + WAIT against AVOID**.
  - AVOID dominates the population (`AVOID / NO TRADE` ≈ 90 % of scan rows), so comparisons are inherently AVOID-skewed.
  - Forward returns are computed from scan-day `close_price` to the close of the Nth subsequent trading day; if forward depth < N the cell is null.
  - No delivery / intraday tick data — pure daily-bar replay.

  ## Q. Whether this supports S4c / S4e design
  **Sector leader-vs-laggard signal: supports S4c design, not live activation** (1D edge = +0.95 %, n_leader=169, n_laggard=7).
**Scanner-quality flag**: WATCH/BUY < AVOID on 1D. S4e design must explicitly address this finding before any activation.

  ## R. What still requires live verification
  - **S2b** intraday refresh (`intraday_last` / `trigger_hit`) — replay impossible (columns are 0/false across history).
  - **S3b** post-deep-scan RS benchmark — still pending the next live deep-scan.
  - **F&O P25** — live MFE-available evidence collection, ≥ 20 closed trades (currently 3 / 20). H4 does not affect this.
  - Actual fill prices, slippage, gap behaviour, partial fills.
  - Real intraday order of stop-vs-target on ambiguous-bar days.
  - Delivery confirmation (no `bhavcopy` / delivery table exists).
  - Intraday trigger order (`candle` warehouse empty).
  - Live activation of S4c / S4d / S4e / S4f — **not approved on this evidence**.

  ## S. Confirmation that no code/schema/trading behaviour changed
  - No DB writes (only `SELECT` via the read-only sandbox).
  - No schema / scheduler / workflow / app code / route auth / `replit.md` / memory/docs changes.
  - Outputs are scratch-only under `.agents/outputs/h4/` (CSV + this summary).
  - No changes to swing scoring / recommendations / entries / stops / targets / RR / sector scoring / delivery scoring / live stock-vs-sector RS / intraday refresh / trigger latch / paper-equity / F&O signal generation/entry/exit/target/stop/sizing/gates/confluence / option snapshots / candle warehouse.
  - 571/571 api-server tests + workspace typecheck remain green from checkpoint `780003834e`.

  ## Standing labels applied
  - `historical daily-bar replay`
  - `offline shadow evidence`
  - `approximate`
  - `not live-verified`
  - `not intraday-exact`
  - `not implementation approval`

  **Stopping per spec. No S4c / S4d / S4e / S4f, no implementation, no live activation initiated. Awaiting next instruction.**
  