# H3 — Swing Historical Sector / RS Shadow Replay Summary

  > **historical shadow evidence / offline only / not live scoring / not implementation / not live verified**
  > No live swing scoring, recommendations, entries, stops, targets, RR, trigger latch, intraday refresh, paper-equity, F&O, schema, scheduler, workflows, route auth, `replit.md`, or memory/docs were touched.

  ## Scale & data-quality notes
  - `rs_score` is on a **0–10 scale** in `swing_scan_result`.
  - **Critical eligibility fix**: 3 historical scan dates (2026-05-18, 2026-05-20, 2026-05-27) had `rs_score` non-NULL but **identically 0 across every row** — a separate facet of the same historical RS bug pattern S3a/S3b target. Initial H3 pass included those days and produced misleadingly low avg-rs_score sectors; the report below has been **re-gated** to exclude them. Days included now require ≥80 % sector coverage AND ≥50 % rows with `rs_score > 0`.
  - **Action labels in this codebase are verbose** (`AVOID / NO TRADE`, `BUY BREAKOUT / RETEST ONLY`, `WAIT FOR CONFIRMATION`, `WAIT FOR PULLBACK`, `WATCHLIST`). H3 uses prefix-based classification: BUY*, WATCHLIST/WATCH*, AVOID*, WAIT*, OTHER. The raw label is kept in the CSV.
  - Leader / laggard threshold: **|Δrs| ≥ 2.0** (≈ ±1σ, ≈ p15 / p85 on the calibration sample).

  ## A. Data window used
  3 eligible scan dates between **2026-05-19** and **2026-05-28**.

  ## B. Scan dates included
  - 2026-05-28 (476 rows, 25 sectors, real-rs 86 %, rs20 100 %)
- 2026-05-26 (476 rows, 25 sectors, real-rs 82 %, rs20 100 %)
- 2026-05-19 (452 rows, 24 sectors, real-rs 84 %, rs20 100 %)

  ## C. Scan dates excluded and why
  - 2026-05-27: rows=450, sector=100 %, real-rs=0 %, rs-zero=100 % — rs_score all-zero (historical RS bug).
- 2026-05-20: rows=463, sector=100 %, real-rs=0 %, rs-zero=100 % — rs_score all-zero (historical RS bug).
- 2026-05-18: rows=450, sector=100 %, real-rs=0 %, rs-zero=100 % — rs_score all-zero (historical RS bug).
- 2026-05-15: rows=10, sector=0 %, real-rs=0 %, rs-zero=100 % — pre-S3a/S4a (sector not persisted).
- 2026-05-14: rows=467, sector=0 %, real-rs=0 %, rs-zero=100 % — pre-S3a/S4a (sector not persisted).
- 2026-05-13: rows=460, sector=0 %, real-rs=91 %, rs-zero=9 % — pre-S3a/S4a (sector not persisted).
- 2026-05-11: rows=475, sector=0 %, real-rs=92 %, rs-zero=8 % — pre-S3a/S4a (sector not persisted).

  **6 of 10 historical scan dates were excluded — the usable historical window is very small.**

  ## D. Sector coverage summary
  - Distinct sectors observed across included window: **25**
  - (day × sector) aggregations: **74**
  - Confident aggregations (member_count ≥ 5): **60**
  - Low-confidence aggregations: **14** (kept in CSV, excluded from sector ranking)

  ## E. RS coverage summary
  - `rs_score > 0` on every included day (eligibility gate).
  - `rs20` / `rs50` / `rs120` present on 5/19, 5/26, 5/28 ≈ 100 %; absent on 5/18, 5/20, 5/27 (and ALL 3 of those latter days are now excluded entirely).
  - This means stock-vs-sector deltas for rs20/rs50/rs120 are present on **every row in the included sample** (3 / 3 days).

  ## F. Sector ranking — included days (confident only, by avg rs_score)

  **2026-05-28** — Top 3 / Bottom 3

  Top:

  | Rank | Sector | Members | Avg rs_score | Avg score | B/W/A/Wait | Top by score |
|---|---|---|---|---|---|---|
| 1 | Healthcare | 8 | 8.75 | 58.02 | 0/3/5/0 | GLAND, HCG, LAURUSLABS |
| 2 | Metals | 21 | 8.60 | 56.85 | 0/3/17/1 | TATASTEEL, COALINDIA, NATIONALUM |
| 3 | Telecom | 7 | 8.44 | 55.51 | 0/1/5/1 | INDUSTOWER, HFCL, TATACOMM |

  Bottom:

  | Rank | Sector | Members | Avg rs_score | Avg score | B/W/A/Wait |
|---|---|---|---|---|---|
| 18 | Information Technology | 5 | 2.54 | 52.14 | 1/0/4/0 |
| 19 | Cement | 15 | 2.23 | 42.93 | 0/1/14/0 |
| 20 | IT | 28 | 2.08 | 44.96 | 0/2/26/0 |

**2026-05-26** — Top 3 / Bottom 3

  Top:

  | Rank | Sector | Members | Avg rs_score | Avg score | B/W/A/Wait | Top by score |
|---|---|---|---|---|---|---|
| 1 | Healthcare | 8 | 8.75 | 60.49 | 0/4/4/0 | HCG, GLAND, LAURUSLABS |
| 2 | Telecom | 7 | 8.66 | 57.99 | 0/1/4/2 | INDUSTOWER, TEJASNET, TATACOMM |
| 3 | Metals | 21 | 8.51 | 57.02 | 0/0/18/3 | JSWSTEEL, GMDCLTD, NMDC |

  Bottom:

  | Rank | Sector | Members | Avg rs_score | Avg score | B/W/A/Wait |
|---|---|---|---|---|---|
| 18 | Information Technology | 5 | 2.56 | 54.14 | 0/0/5/0 |
| 19 | Cement | 15 | 2.08 | 42.15 | 0/1/14/0 |
| 20 | IT | 28 | 1.85 | 45.69 | 0/0/28/0 |

**2026-05-19** — Top 3 / Bottom 3

  Top:

  | Rank | Sector | Members | Avg rs_score | Avg score | B/W/A/Wait | Top by score |
|---|---|---|---|---|---|---|
| 1 | Healthcare | 8 | 8.75 | 48.06 | 0/0/5/3 | ASTERDM, GLAND, HCG |
| 2 | Telecom | 6 | 8.38 | 49.17 | 0/0/6/0 | BHARTIARTL, INDUSTOWER, TEJASNET |
| 3 | Metals | 21 | 8.21 | 41.40 | 0/0/20/1 | JSWSTEEL, SAIL, SHYAMMETL |

  Bottom:

  | Rank | Sector | Members | Avg rs_score | Avg score | B/W/A/Wait |
|---|---|---|---|---|---|
| 18 | Information Technology | 5 | 2.78 | 37.56 | 0/0/5/0 |
| 19 | Cement | 15 | 2.16 | 30.43 | 0/0/15/0 |
| 20 | IT | 28 | 1.11 | 34.34 | 0/0/28/0 |

  ## G. Stock-vs-sector RS — sample (latest day = 2026-05-28, leaders only, top 10 by Δrs)

  | Symbol | Sector | Action class | Score | rs_score | Sector avg rs | Δrs | Sector rank | Rank in sector |
|---|---|---|---|---|---|---|---|---|
| TATATECH | IT | WATCHLIST | 67.90 | 10.00 | 2.08 | 7.92 | 20 | 1/28 |
| RATEGAIN | IT | AVOID | 66.40 | 10.00 | 2.08 | 7.92 | 20 | 2/28 |
| GRASIM | Cement | WATCHLIST | 60.70 | 10.00 | 2.23 | 7.77 | 19 | 1/15 |
| OFSS | Information Technology | BUY | 72.90 | 10.00 | 2.54 | 7.46 | 18 | 1/5 |
| JAGRAN | Media | AVOID | 60.00 | 10.00 | 3.54 | 6.46 | 17 | 2/8 |
| EXIDEIND | Automobile | WATCHLIST | 62.90 | 10.00 | 3.60 | 6.40 | — | 1/3 |
| HSCL | Construction | WATCHLIST | 67.90 | 10.00 | 3.62 | 6.38 | 16 | 2/12 |
| WELSPUNLIV | Consumer Discretionary | AVOID | 60.70 | 10.00 | 3.75 | 6.25 | 15 | 8/43 |
| ARVIND | Consumer Discretionary | AVOID | 57.10 | 10.00 | 3.75 | 6.25 | 15 | 13/43 |
| SAREGAMA | Media | AVOID | 67.10 | 9.50 | 3.54 | 5.96 | 17 | 1/8 |

  ## H. Leader / inline / laggard classification (whole included window)

  | Class | Definition | Count | Share |
  |---|---|---|---|
  | leader | Δrs ≥ +2 vs sector mean rs_score | 435 | 31.0 % |
  | inline | −2 < Δrs < +2 | 530 | 37.7 % |
  | laggard | Δrs ≤ −2 | 439 | 31.3 % |

  ### Action distribution (prefix-classified)
  - AVOID: 1216 (86.6 %)
- WATCHLIST: 101 (7.2 %)
- WAIT: 86 (6.1 %)
- BUY: 1 (0.1 %)

  ### Raw-label action distribution
  - `AVOID / NO TRADE`: 1216 (86.6 %)
- `WATCHLIST`: 101 (7.2 %)
- `WAIT FOR CONFIRMATION`: 75 (5.3 %)
- `WAIT FOR PULLBACK`: 11 (0.8 %)
- `BUY BREAKOUT / RETEST ONLY`: 1 (0.1 %)

  ## I. Current action vs shadow sector-RS support

  | Action × Class | Count | Shadow label |
  |---|---|---|
  | BUY ∩ leader | 1 | SUPPORTS |
  | BUY ∩ laggard | 0 | CONFLICTS |
  | WATCHLIST ∩ leader | 69 | SUPPORTS |
  | WATCHLIST ∩ laggard | 0 | CONFLICTS |
  | AVOID ∩ leader | 314 | CONFLICTS |
  | AVOID ∩ laggard | 429 | SUPPORTS |

  Aggregate over all 1404 (stock × day) rows:
  - SUPPORTS: **499** (35.5 %)
  - CONFLICTS: **314** (22.4 %)
  - NEUTRAL: **591** (42.1 %)

  Restricted to **actionable subset** (action_class ∈ {BUY, WATCHLIST, AVOID}) = 1318 rows:
  - SUPPORTS: **499** (37.9 %)
  - CONFLICTS: **314** (23.8 %)

  ## J. Main findings (offline shadow only)

  1. **Strongest sectors on 2026-05-28**: Healthcare (avg rs=8.75, n=8); Metals (avg rs=8.60, n=21); Telecom (avg rs=8.44, n=7).
  2. **Weakest sectors on 2026-05-28**: IT (avg rs=2.08, n=28); Cement (avg rs=2.23, n=15); Information Technology (avg rs=2.54, n=5).
  3. **Persistence of strong sectors across the 3 included days**: Healthcare, Metals, Telecom appear in the top-3 on all 3 days — directionally interesting sector persistence.
  4. **High-score (≥60) stocks in the 3 weakest sectors on 2026-05-28** — potential demotion candidates if a sector-RS overlay were ever introduced:
     - OFSS (Information Technology) score=72.9 rs=10.00 action=`BUY BREAKOUT / RETEST ONLY` Δrs=7.46
   - TATATECH (IT) score=67.9 rs=10.00 action=`WATCHLIST` Δrs=7.92
   - RATEGAIN (IT) score=66.4 rs=10.00 action=`AVOID / NO TRADE` Δrs=7.92
   - COFORGE (IT) score=65.0 rs=4.90 action=`AVOID / NO TRADE` Δrs=2.82
   - FSL (IT) score=61.4 rs=4.70 action=`WATCHLIST` Δrs=2.62
  5. **High-RS stocks in the 3 strongest sectors on 2026-05-28** — sector-confirmed leaders:
     - LAURUSLABS (Healthcare) rs=10.00 score=67.1 action=`WATCHLIST`
   - GLAND (Healthcare) rs=10.00 score=67.1 action=`WATCHLIST`
   - HCG (Healthcare) rs=10.00 score=67.1 action=`AVOID / NO TRADE`
   - ASTERDM (Healthcare) rs=10.00 score=63.6 action=`AVOID / NO TRADE`
   - KIMS (Healthcare) rs=10.00 score=61.4 action=`AVOID / NO TRADE`
  6. **Laggards inside strong sectors on 2026-05-28** — would have been demoted by a sector-overlay:
     - KRSNAA (Healthcare) rs=0.00 Δrs=-8.75 score=26.4 action=`AVOID / NO TRADE`
   - JSL (Metals) rs=2.50 Δrs=-6.10 score=36.4 action=`AVOID / NO TRADE`
   - APLAPOLLO (Metals) rs=2.90 Δrs=-5.70 score=36.4 action=`AVOID / NO TRADE`
   - MOIL (Metals) rs=3.50 Δrs=-5.10 score=39.3 action=`AVOID / NO TRADE`
   - ONMOBILE (Telecom) rs=4.80 Δrs=-3.64 score=39.3 action=`AVOID / NO TRADE`
  7. The CONFLICTS rate of **22.4 %** (all rows) / **23.8 %** (actionable subset) quantifies how often a sector-RS overlay would have **disagreed with the current action** on this 3-day sample.

  ## K. Whether this supports S4c design

  **Label: insufficient historical evidence.** Only 3 eligible days survived the rs-zero gate; the actionable subset is 1318 rows. Sample is far too small to support an S4c design decision. Recommendation: forward-collect more healthy deep-scan days before re-running H3.

  Additional caveats:
  - 3 included days × ~470 rows each = a very thin window.
  - Only 1318 rows have an action in {BUY, WATCHLIST, AVOID} → the meaningful comparison subset is small.
  - Leader/laggard threshold (|Δrs| ≥ 2.0) is heuristic ±1σ — sensitivity analysis must be part of any S4c design phase.
  - AVOID labels are dominant (`AVOID / NO TRADE` ≈ 87 % of rows), so SUPPORTS/CONFLICTS skew towards AVOID-side outcomes.

  ## L. What still needs live verification
  - **S2b** intraday refresh writing `intraday_last` / `trigger_hit` — replay impossible (columns are 0 / false across the entire historical window).
  - **S3b** post-deep-scan RS benchmark — H3 actually *re-proves the existence* of the historical rs_score=0 collapse on 5/18, 5/20, 5/27 but cannot validate any fix. Live deep-scan run still required.
  - Production trigger-latch behaviour and forward outcome of today's BUY/WATCHLIST names.
  - Delivery confirmation — no `bhavcopy` / delivery table exists; forward collection required.
  - Daily OHLC trigger-order proof (and `candle` warehouse is empty).
  - Live scoring activation of any sector-RS overlay (S4c) — **not approved on this evidence**.

  ## M. Confirmation that no code/schema/trading behaviour changed
  - No DB writes (only `SELECT` via the read-only sandbox).
  - No schema / scheduler / workflow / app code / route auth / `replit.md` / memory/docs changes.
  - Outputs are scratch-only under `.agents/outputs/h3/` (CSV + this summary).
  - No changes to swing scoring / recommendations / entries / stops / targets / RR / sector scoring / delivery scoring / stock-vs-sector RS in live code / intraday refresh / trigger latch / paper-equity / F&O signal generation/entry/exit/target/stop/sizing/gates/confluence / option snapshots / candle warehouse.
  - 571/571 api-server tests + workspace typecheck remain green from checkpoint `780003834e`.

  ## Standing labels applied
  - `historical shadow evidence`
  - `offline only`
  - `not live scoring`
  - `not implementation`
  - `not live verified`

  **Stopping per spec. Awaiting next instruction. No S4c, no implementation, no live activation initiated.**
  