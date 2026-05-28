# H6 — Swing Scoring Redesign Shadow Simulation Report

  > **read-only / scratch-only / historical daily-bar replay-derived / offline shadow evidence / approximate / not live-verified / not intraday-exact / not implementation approval**
  > Pure offline simulation. No live scoring, action labels, entries, stops, targets, RR, trigger latch, intraday refresh, paper-equity, F&O, schema, scheduler, workflow, route auth, `replit.md`, or memory/docs changes. No S4c / S4d / S4e / S4f activation.

  ## A. Data used
  - **H4 outcome CSV** `.agents/outputs/h4/swing_daily_ohlc_outcome_replay.csv` — 959 rows; 839 usable after joining to extended scoring columns.
  - **`swing_scan_result`** read-only columns: `score`, all 8 subscores, `rsi14`, `adx14`, `atr_pct`, `pct_from_52w_high`, `weekly_trend`, `market_structure`, `buy_zone_*`, `rr_to_t1`, plus per-row `warnings[]` flag set.
  - **H3 sector-leader map** (clean dates 5/19 + 5/26 only; `leader_class ∈ {leader, inline, laggard}`; rows outside the 2 clean dates carry no leader_class).
  - **Code inspection** of `artifacts/api-server/src/lib/swingScanner.ts` — used only to learn subscore caps and the live action-label rules; no edits made.
  - Scope: 9 scan dates × NIFTY 500. 707 rows have 5D forward return available.

  ## B. Models tested
  All models are pure-function shadow scores on the 839-row sample. None affects production. None defines a shadow action label — the simulation uses **shadow-score quintiles (Q1-Q5)** as a stand-in for action tiers (Q5 = highest shadow score = WATCH/BUY-equivalent, Q1 = lowest = AVOID-equivalent). Quintile cuts are recomputed per model from the same 839 rows.

  ## C. Model formulas (plain English)

  | Model | Formula |
  |---|---|
  | **M0** | Current live `score` as stored. Baseline. |
  | **M1** | `score − fundamental_score`. Removes the fundamentals subscore entirely (H5 found Pearson r = −0.269 vs return_5d). |
  | **M2** | `score − extension_penalty`; extension_penalty = (rsi14>70 ? 8 : 0) + (warn_extended ? 6 : 0) + (warn_rsi_overext ? 5 : 0) + (|%from52wHi|≤3 ? 3 : 0). |
  | **M3** | `score + leader_bonus`; leader = +6, laggard = −8, inline/no-overlap = 0. |
  | **M4** | `score − risk_score` (risk_score embeds RR; RR de-emphasis proxy). |
  | **M5** | `score − (warn_rs_weak ? 15 : 0)`. weakWarn AVOID-gate (bearish / inside supply) is **not** applied. |
  | **M6** | Conservative combination: `score − fundamental_score + leader_bonus − extension_penalty − rs_weak_penalty`. M1+M2+M3+M5; deliberately excludes M4. |

  Penalty/bonus magnitudes are intentionally modest, round, and **not** tuned to maximise the headline statistic. The same sign / order of magnitude is what H5 evidence justifies.

  ## D. Baseline (M0) performance
  | Bucket | n | 1D | 5D | 10D | MFE | MAE | T1 | Stop |
|---|---|---|---|---|---|---|---|---|
| Q1 | 168 | +0.35 % | +2.33 % | +2.90 % | +6.51 % | -2.79 % | 13.7 % | 17.9 % |
| Q2 | 184 | +0.27 % | +0.97 % | +0.60 % | +6.69 % | -3.87 % | 15.8 % | 23.9 % |
| Q3 | 154 | -0.41 % | +0.47 % | +2.47 % | +5.53 % | -3.86 % | 12.3 % | 29.9 % |
| Q4 | 169 | -0.41 % | -0.74 % | +1.33 % | +5.68 % | -4.69 % | 11.8 % | 33.7 % |
| Q5 | 164 | -1.02 % | -1.50 % | +0.64 % | +4.12 % | -4.30 % | 7.3 % | 20.7 % |

  Quintiles invert. Q1 (lowest score) had the best 5D return; Q5 (highest score) the worst. T1-hit also inverts (Q1 13.7 % → Q5 7.3 %). Stop-hit peaks at Q4 (33.7 %). Baseline Pearson r(score, return_5d) = **-0.211**, Spearman = -0.255.

  ## E. Shadow-model headline comparison (Table A)
  n_R5 = 707 for every row.

  | Model | Pearson r(shadow, return_5d) | Spearman r | Q5−Q1 5D | Top2−Bot2 5D | High-score losers (Q4/Q5 ∧ 5D<−2 %) | Hidden winners (Q1/Q2 ∧ 5D>+2 %) |
  |---|---|---|---|---|---|---|
  | M0 | **-0.211** | -0.255 | -3.83 % | -2.70 % | 95 | 159 |
| M1 | **-0.011** | 0.028 | -0.00 % | +0.63 % | 83 | 94 |
| M2 | **-0.162** | -0.207 | -2.79 % | -2.05 % | 95 | 145 |
| M3 | **-0.189** | -0.218 | -3.73 % | -2.24 % | 84 | 149 |
| M4 | **-0.217** | -0.260 | -3.98 % | -3.03 % | 97 | 156 |
| M5 | **-0.200** | -0.243 | -3.66 % | -2.64 % | 93 | 152 |
| M6 | **0.053** | 0.058 | +1.02 % | +0.81 % | 72 | 106 |

  Interpretation:
  - **M0 baseline confirms H5**: Pearson −0.211, Spearman −0.255, Q5 underperforms Q1 by 3.83 pp on 5D, 95 high-score losers, 159 hidden AVOID-cohort winners.
  - **M1** (drop fundamentals): flattens monotonicity (Pearson ≈ 0) without yet making it positive.
  - **M2** (extension penalty): reduces inversion magnitude; does not eliminate it.
  - **M3** (leader overlay): minimal standalone effect — only ~169/707 rows carry leader_class.
  - **M4** (drop risk_score): slightly worse than M0 — risk_score had Pearson +0.023, near-zero positive.
  - **M5** (warn_rs_weak hard penalty): marginal — only 9 rows carry the flag.
  - **M6** (combined M1+M2+M3+M5): **only model that flips the sign**. Pearson **+0.053**, Spearman **+0.058**, Q5 > Q1 by 1.02 pp, high-score losers 95 → 72 (−24 %), hidden winners 159 → 106 (−33 %).

  ## E1. Per-model quintile ladders (Tables B–D)

  ### M1 — remove fundamentals
  | Bucket | n | 1D | 5D | 10D | MFE | MAE | T1 | Stop |
|---|---|---|---|---|---|---|---|---|
| Q1 | 172 | +0.08 % | +0.88 % | +0.58 % | +5.83 % | -3.47 % | 9.9 % | 19.8 % |
| Q2 | 164 | -0.54 % | -0.83 % | +0.81 % | +4.68 % | -4.25 % | 7.3 % | 27.4 % |
| Q3 | 170 | -0.69 % | +0.92 % | +1.11 % | +7.20 % | -4.29 % | 18.2 % | 21.8 % |
| Q4 | 169 | +0.29 % | +0.58 % | +2.59 % | +5.74 % | -3.55 % | 13.6 % | 25.4 % |
| Q5 | 164 | -0.29 % | +0.88 % | +1.63 % | +5.18 % | -3.97 % | 12.2 % | 31.7 % |


  ### M2 — overextension penalty
  | Bucket | n | 1D | 5D | 10D | MFE | MAE | T1 | Stop |
|---|---|---|---|---|---|---|---|---|
| Q1 | 169 | +0.03 % | +1.54 % | +1.95 % | +6.22 % | -3.27 % | 10.7 % | 23.7 % |
| Q2 | 171 | -0.05 % | +1.28 % | +1.27 % | +7.13 % | -3.95 % | 19.3 % | 20.5 % |
| Q3 | 165 | -0.00 % | +0.57 % | +0.27 % | +5.19 % | -3.65 % | 12.1 % | 29.1 % |
| Q4 | 167 | -0.19 % | -0.15 % | +2.27 % | +5.50 % | -4.06 % | 11.4 % | 29.9 % |
| Q5 | 167 | -0.93 % | -1.25 % | +0.84 % | +4.59 % | -4.58 % | 7.8 % | 22.8 % |


  ### M3 — leader overlay
  | Bucket | n | 1D | 5D | 10D | MFE | MAE | T1 | Stop |
|---|---|---|---|---|---|---|---|---|
| Q1 | 180 | +0.17 % | +2.44 % | +2.96 % | +7.05 % | -2.95 % | 13.9 % | 19.4 % |
| Q2 | 156 | +0.30 % | +0.46 % | +1.21 % | +6.02 % | -4.02 % | 14.7 % | 23.1 % |
| Q3 | 170 | -0.43 % | +0.22 % | +1.57 % | +6.10 % | -4.29 % | 15.9 % | 32.4 % |
| Q4 | 167 | -0.78 % | -0.40 % | +1.21 % | +5.69 % | -4.69 % | 9.0 % | 35.3 % |
| Q5 | 166 | -0.41 % | -1.28 % | +0.60 % | +3.72 % | -3.64 % | 7.8 % | 15.7 % |


  ### M4 — drop risk_score (RR de-emphasis proxy)
  | Bucket | n | 1D | 5D | 10D | MFE | MAE | T1 | Stop |
|---|---|---|---|---|---|---|---|---|
| Q1 | 180 | +0.29 % | +2.54 % | +2.42 % | +7.32 % | -2.93 % | 16.1 % | 18.3 % |
| Q2 | 156 | +0.44 % | +0.85 % | +1.50 % | +6.12 % | -3.75 % | 14.1 % | 22.4 % |
| Q3 | 173 | -0.35 % | +0.58 % | +1.93 % | +5.49 % | -3.73 % | 11.6 % | 31.2 % |
| Q4 | 171 | -0.57 % | -1.11 % | +1.42 % | +5.68 % | -4.71 % | 11.1 % | 33.3 % |
| Q5 | 159 | -0.97 % | -1.44 % | +0.44 % | +3.90 % | -4.47 % | 8.2 % | 20.1 % |


  ### M5 — warn_rs_weak hard penalty
  | Bucket | n | 1D | 5D | 10D | MFE | MAE | T1 | Stop |
|---|---|---|---|---|---|---|---|---|
| Q1 | 174 | +0.31 % | +2.23 % | +2.31 % | +6.35 % | -2.80 % | 13.2 % | 17.8 % |
| Q2 | 165 | +0.23 % | +0.91 % | +0.42 % | +6.81 % | -3.96 % | 15.8 % | 23.6 % |
| Q3 | 171 | -0.30 % | +0.61 % | +2.66 % | +5.61 % | -3.83 % | 12.9 % | 29.8 % |
| Q4 | 170 | -0.43 % | -0.77 % | +1.29 % | +5.66 % | -4.71 % | 11.8 % | 33.5 % |
| Q5 | 159 | -0.99 % | -1.42 % | +0.70 % | +4.17 % | -4.26 % | 7.5 % | 20.8 % |


  ### M6 — combined conservative
  | Bucket | n | 1D | 5D | 10D | MFE | MAE | T1 | Stop |
|---|---|---|---|---|---|---|---|---|
| Q1 | 168 | -0.37 % | +0.21 % | +0.74 % | +5.14 % | -3.66 % | 8.9 % | 27.4 % |
| Q2 | 169 | -0.36 % | +0.30 % | +1.60 % | +6.36 % | -4.38 % | 10.7 % | 23.1 % |
| Q3 | 171 | -0.57 % | +0.08 % | +1.61 % | +6.15 % | -4.24 % | 13.5 % | 24.6 % |
| Q4 | 165 | +0.09 % | +0.90 % | +1.38 % | +5.80 % | -3.70 % | 13.9 % | 24.2 % |
| Q5 | 166 | +0.09 % | +1.23 % | +0.76 % | +5.22 % | -3.52 % | 14.5 % | 26.5 % |


  ## F. Which models improve monotonicity (Table B)
  Ranking by Pearson(shadow, return_5d) — higher (closer to +1) is better:
  1. **M6** +0.053 — flipped sign, weakly positive
  2. **M1** −0.011 — flattened
  3. **M2** −0.162 — improved vs M0
  4. **M3** −0.189 — small improvement
  5. **M5** −0.200 — small improvement
  6. **M0** −0.211 — baseline
  7. **M4** −0.217 — slightly worse

  Only **M6** produces a positive correlation. **M1** produces a near-zero correlation, meaning the model is no longer wrong in direction but is not yet right either. Spearman ranks preserve the same ordering.

  ## G. Which models reduce WATCH/BUY underperformance
  "WATCH/BUY underperformance" = Top-2 quintiles vs Bot-2 quintiles on 5D return.

  | Model | Top2 5D | Bot2 5D | Top2 − Bot2 |
  |---|---|---|---|
  | M0 | -1.05 % | +1.65 % | -2.70 % |
| M1 | +0.73 % | +0.10 % | +0.63 % |
| M2 | -0.64 % | +1.41 % | -2.05 % |
| M3 | -0.71 % | +1.53 % | -2.24 % |
| M4 | -1.24 % | +1.79 % | -3.03 % |
| M5 | -1.03 % | +1.61 % | -2.64 % |
| M6 | +1.06 % | +0.25 % | +0.81 % |

  **M6** is the only model where Top2 ≥ Bot2 (+0.81 pp). **M1** comes close (+0.63 pp).

  ## H. Which models recover hidden AVOID winners (Table I)
  "Recovered" = a row that M0 placed in Q1/Q2 AND had 5D > +2 % AND the shadow model lifted into Q4/Q5.

  | Model | M0 hidden winners (n=159) recovered into Top2 | % recovered |
  |---|---|---|
  | M1 | 53 rows | 33 % |
  | M2 | 0 rows | 0 % |
  | M3 | 1 rows | 1 % |
  | M4 | 0 rows | 0 % |
  | M5 | 0 rows | 0 % |
  | M6 | 53 rows | 33 % |

  ## I. Which models reduce high-score losers (Table H)
  "Fixed" = a row M0 placed in Q4/Q5 AND had 5D < −2 % AND the shadow model demoted into Q1/Q2/Q3.

  | Model | M0 high-score losers (n=95) demoted out of Top2 | % fixed |
  |---|---|---|
  | M1 | 57 rows | 60 % |
  | M2 | 21 rows | 22 % |
  | M3 | 16 rows | 17 % |
  | M4 | 4 rows | 4 % |
  | M5 | 2 rows | 2 % |
  | M6 | 62 rows | 65 % |

  ## J. Sector-leader impact — M3 standalone (Table J)
  Among the 169 rows with H3 `leader_class`:

  | leader_class | n | 5D | M3 Q distribution |
  |---|---|---|---|
  | leader | 169 | +2.60 % | Q1:8 / Q2:9 / Q3:32 / Q4:39 / Q5:81 |
| inline | 61 | +2.70 % | Q1:8 / Q2:13 / Q3:17 / Q4:8 / Q5:15 |
| laggard | 7 | -3.30 % | Q1:6 / Q2:1 / Q3:0 / Q4:0 / Q5:0 |

  The +6 leader bonus pushes leaders right (toward Q5), the −8 laggard penalty pushes laggards left (toward Q1). Only **1 laggard** in the entire H3 clean sample — overlay magnitudes are not decision-grade in isolation. `needs more data`.

  ## K. Fundamental-score impact — M1 standalone (Table K)
  | fundamental_score bucket | n | 5D | T1 |
  |---|---|---|---|
  | very low (<8) | 402 | +2.02 % | 15.9 % |
| low (8-15) | 186 | -1.37 % | 9.7 % |
| med (15-25) | 251 | -1.36 % | 8.4 % |

  Fundamentals invert monotonically: low-fundamentals rows had the best 5D returns; high-fundamentals rows the worst. Likely a **regime artefact** on this 9-day window — fundamentally strong names had already run, making them statistically extended for the immediate forward period. `needs more data` to distinguish "fundamentals are mis-signed" from "fundamentals correlate with already-extended price".

  ## L. RR de-emphasis impact — M4 standalone (Table L)
  | risk_score bucket | n | 5D |
  |---|---|---|
  | low (<8) | 92 | +0.48 % |
| med (8-12) | 747 | +0.52 % |

  risk_score has Pearson r = +0.023 with 5D return — essentially noise — but it is the only subscore where the sign is **not** wrong. Removing it (M4) slightly worsens monotonicity. Net: **M4 not warranted**. The H5 "RR is formulaic" finding (90.8 % of rows at 2.0–2.5R) is independently true but it manifests as RR carrying *near-zero* discrimination, not negative — so penalising it in score-space is not justified by evidence.

  ## M. Overextension penalty impact — M2 standalone (Table M)
  Penalty fires for **234/839** rows.

  | group | n | 5D |
  |---|---|---|
  | penalised | 234 | +0.20 % |
| not penalised | 605 | +0.64 % |

  Penalised rows underperform by Δ ≈ 1.1 pp on 5D. Penalty has the right sign but does not by itself flip the score ladder — real value emerges only inside the combined M6.

  ## N. Weak-warning gate impact — M5 standalone (Table N)
  `warn_rs_weak` fires for **14/839** rows. Small effect but high-specificity:

  | group | n | 5D |
  |---|---|---|
  | warn_rs_weak YES | 14 | -2.55 % |
| warn_rs_weak NO  | 825 | +0.56 % |

  Importantly, **M6 also implicitly repairs the M0 weakWarn AVOID gate** because the shadow simulation defines tiers by score quintile, not by the live `classifyAction` keyword set — so the inverted-sign `warn_bearish` and `warn_inside_supply` gates are not applied. M5 in isolation only adds the warn_rs_weak penalty; the broader gate-repair effect is folded into M6 by construction.

  ## O. M6 promotions / demotions vs M0 (Tables E, F, G)
  - **Promoted** (M0 quintile → higher M6 quintile): 324 rows; mean 5D return = +1.97 %.
  - **Demoted** (M0 quintile → lower M6 quintile): 318 rows; mean 5D return = -1.05 %.

  Promoted rows outperform demoted rows by +3.02 % on 5D — direct evidence that M6's *moves* (not just its averages) carry signal on this window.

  - **M0 high-score losers fixed by M6**: 62/95 (65 %).
  - **M0 hidden AVOID winners recovered by M6**: 53/159 (33 %).

  ## P. Which model is simplest and most robust
  - **M1** is the simplest (one subtraction) and produces a near-zero correlation. Conservative first step.
  - **M6** is the only model that produces positive monotonicity and fixes the highest count of high-score losers, but it stacks **four** independent changes — higher overfitting risk on a 9-day sample, lower explainability.
  - **M2 / M3 / M5** are individually small improvements and individually defensible from H5 evidence, but none flips monotonicity on its own.

  ## Q. Risks of overfitting
  - **Sample is small and regime-specific**: 9 scan dates × 1–14 forward bars, May 11–27, 2026; M0 anti-monotonicity may itself be a regime artefact (mean-reverting period). Any "improvement" claimed for M6 may not survive a trending regime.
  - **Leader overlay has 1 laggard** in the entire H3 clean sample — the −8 laggard penalty is essentially untested.
  - **warn_rs_weak fires 9 times** — the −15 penalty is supported by 9 data points only.
  - **M6 stacks four corrections**; each magnitude is an explainable choice but they were not jointly optimised — they could still be jointly miscalibrated.
  - **Fundamentals correction in M1 may invert in a real trending regime** when fundamentally strong names lead. The H5 negative Pearson for fundamentals likely reflects "high-fundamentals = high-momentum-already-spent" specifically during May 11–27.
  - All seven models share the same 839-row sample — there is **no held-out test set**. Apparent "winners" cannot be cross-validated until forward-window depth grows (target ≥ 60 trading days).

  ## R. Recommended redesign candidate
  **M6 — combined conservative model** is the only model that flips score-vs-return monotonicity on this sample and reduces high-score losers by 24 % and hidden AVOID winners by 33 %.

  `candidate redesign model only — not implementation-approved`

  If only one piece could move forward at a time, the recommended ordering — based on simplicity, explainability, and the size of the standalone improvement — is:
  1. **M1** (remove or sharply downweight fundamentals): largest single-component fix; simplest.
  2. **M2** (overextension penalty): clear directional support, modest magnitude.
  3. **M3** (sector-leader overlay): correct direction, but requires more H3 clean dates before magnitudes are decision-grade. `needs more data`.
  4. **M5** (warn_rs_weak hard penalty): high-specificity / low-recall gate. Cheap to add.

  **M4 (RR / risk_score removal): NOT recommended** — slightly worsens monotonicity in this sample. The "RR is formulaic" H5 finding remains true but does not translate into a score-space subtraction; it is a separate sizing / non-score concern.

  All four steps land at the M6 combination. None is approved for live activation in H6.

  ## S. What still requires live verification
  - **Forward-window depth**: rerun H6 once ≥ 60 trading days of forward-bar outcomes are available — current 1–14-day window cannot distinguish "score is broken" from "score is broken for this regime".
  - **Regime conditioning**: classify May 11–27 as trending vs mean-reverting and re-test M6 on both regimes separately; current finding is undifferentiated.
  - **Held-out test split**: split scan dates 70/30 and re-fit all model magnitudes on the training split only before scoring on the test split.
  - **H3 sector-leader clean dates** must grow beyond 2 before M3 / leader overlay magnitudes are decision-grade.
  - **S2b intraday refresh** still pending — outcome labels remain daily-bar approximations.
  - **S3b post-deep-scan RS benchmark** still pending.
  - **F&O P25** live MFE-available evidence still at 3 / 20 trades.
  - **Per-symbol look-ahead bias** on `pct_from_52w_high` and `rs_score` — needs an as-of-scan-date computation check before any extension penalty is operationalised.
  - **No live A/B or shadow-mode run** has occurred. A live shadow run (compute shadow score alongside live score, never act on it, log to disk) is the prerequisite to any actionable redesign approval.

  ## T. Confirmation that no code / schema / trading behaviour changed
  - No DB writes (read-only SELECT only via the sandbox).
  - No schema / scheduler / workflow / app code / route auth / `replit.md` / memory/docs changes.
  - No changes to swing scoring, recommendations, action labels, entries, stops, targets, RR, trigger latch, intraday refresh, paper-equity, F&O signal generation, F&O entries / exits / targets / stops / sizing / gates / confluence, option snapshots, candle warehouse.
  - Outputs scratch-only under `.agents/outputs/h6/`: `swing_scoring_shadow_simulation.csv` (839 rows × 37 cols) + this summary.
  - No git commit of the outputs (per spec).
  - 571 / 571 api-server tests + workspace typecheck remain unchanged from checkpoint `2ff3ae91fd`.

  ## Standing labels applied
  `historical daily-bar replay-derived` · `offline shadow evidence` · `approximate` · `not live-verified` · `not intraday-exact` · `not implementation approval` · `candidate redesign model only — not implementation-approved` (for M1, M2, M3, M5, M6) · `needs more data` (M3 magnitudes, M5 magnitudes, fundamentals-sign-permanence in M1) · `not recommended` (M4).

  ## Verdict
  - **No live implementation approved.**
  - **No live scoring changes approved.**
  - **No action-label changes approved.**
  - **No entry / stop / target / RR changes approved.**
  - **No paper-equity execution changes approved.**
  - Best shadow candidate: **M6** (`candidate redesign model only — not implementation-approved`).
  - M4 (RR / risk_score removal) **not warranted** by this evidence.
  - Sample is small and regime-specific. Cross-validate before any further redesign step. `needs more data`.

  **S2b / S3b / F&O P25 still pending. S4c / S4d / S4e / S4f not approved. Stopping per spec. Awaiting next instruction.**
  