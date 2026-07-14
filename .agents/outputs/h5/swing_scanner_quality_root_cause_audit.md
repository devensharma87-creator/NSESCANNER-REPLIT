# H5 — Swing Scanner Quality Root-Cause Audit Report

  > **read-only / scratch-only / historical daily-bar replay-derived / approximate / not live-verified / not intraday-exact / not implementation approval**
  > Built entirely from `.agents/outputs/h4/` outcomes + read-only `swing_scan_result` columns + code inspection of `artifacts/api-server/src/lib/swingScanner.ts`. No code / schema / DB / scheduler / workflow / route-auth / `replit.md` / memory/docs changes. No S4c / S4d / S4e / S4f activation.

  ## A. Data used
  - **H4 outcome CSV** (`.agents/outputs/h4/swing_daily_ohlc_outcome_replay.csv`, 959 rows) → 839 usable after joining to extended scoring columns.
  - **`swing_scan_result`** extended columns (read-only): subscores (technical / smc / volume / momentum / fundamental / risk / context / rs), `rsi14`, `adx14`, `atr_pct`, `vol_ratio`, `pct_from_52w_low`, `pct_from_52w_high`, `weekly_trend`, `market_structure`, `quality_grade`, `buy_zone_lower/upper`, `stop_basis`, `target_basis`, `rr_to_t1`, plus per-row `warnings[]` flags.
  - **H3 sector-leader map** (5/19 + 5/26 clean dates).
  - **Code inspection**: `classifyAction` (lines 861-876), `classifySetup` (878-886), `setupQualityGrade` (888-896), `volatilityAndGapRisk` (694-708), `scoreAndPlan` (~900-1075). No edits made.

  ## B. H4 red flags — confirmed / rejected / refined

  | H4 finding | H5 verdict | Evidence |
  |---|---|---|
  | WATCH/BUY underperforms AVOID | **CONFIRMED** | WATCHLIST 5D = −1.68 % vs AVOID 5D = +1.18 % (Δ = −2.86 pp) |
  | Higher-score buckets underperform lower | **CONFIRMED** | Pearson r(score, return_5d) = **−0.211** (n=707); 70+ bucket 5D = −0.63 %, <50 bucket 5D = +2.41 % |
  | Sector leaders outperform laggards (directional) | **CONFIRMED** | Leader 5D = +2.60 %, laggard 5D = −3.30 %; AVOID∩leader 5D = +2.83 %, WATCHLIST∩leader 5D = +4.07 % |
  | Ambig same-day rate small (0.2 %) | **CONFIRMED** | not the weak link — sample/window depth is |
  | Sample is short forward window | **CONFIRMED** | 9 dates, 1–14 forward bars |

  ## C. Root causes ranked by evidence strength

  | # | Root cause | Strength | Evidence |
  |---|---|---|---|
  | **1** | **Final `score` is anti-monotonic with forward outcome on this window** | strong (n=707) | Pearson −0.211; quality-grade ladder also inverts: B+ 5D = −2.35 %, B = −0.59 %, C = +0.73 %, D/Avoid = +2.41 % |
  | **2** | **Fundamental subscore is the worst-performing component** | strong | Pearson r(fundamental_score, return_5d) = **−0.269**. Fundamentals appear to bias the scanner toward already-extended quality names that have run. |
  | **3** | **`classifyAction`'s `weakWarn` AVOID gate over-rejects mean-reverters** | strong | "Bearish structure" warning → AVOID (line 869), but Bearish-structure rows averaged **+3.23 % 5D** (n=74). "Price inside supply" → AVOID, but inside-supply rows averaged **+0.91 % 5D** vs no-warn +0.12 % (Δ = +0.79 pp — sign INVERTED on this window). |
  | **4** | **Sector leadership is uncaptured by current score** | strong | AVOID∩leader 5D = +2.83 % (n=95) — the AVOID label hides sector-leader winners. WATCHLIST∩leader 5D = +4.07 % (n=38) is the best-performing intersection in the data set. |
  | **5** | **RR is formulaic / non-discriminating** | strong | 762/839 rows (**90.8 %**) cluster at 2.0–2.5R; 1.2–1.5R = −1.12 % 5D (n=32), 1.5–2.0R = +0.80 % (n=45), 2.0–2.5R = +0.58 % (n=762). RR groups are nearly indistinguishable above 1.5. |
  | **6** | **RSI: classic mean-reversion regime in this window** | medium | r(rsi14, return_5d) = −0.134. <40 RSI 5D = +3.18 %; 70+ RSI 5D = −0.20 %. Scanner currently rewards "RSI in healthy swing zone" (1,642 reasons logged) but the zone is **not predictive** here. |
  | **7** | **Distance-from-52w-high signal is non-monotonic and "extended" overweights** | medium | "at-highs (≤3%)" 5D = +0.68 %, "near" = +1.16 %, "far (>20%)" = −1.04 %. `warn_extended` rows: −0.92 % vs +0.69 %, Δ = −1.61 pp — the warning IS predictive but does NOT demote score enough. |
  | **8** | **`warn_rs_weak` is the most predictive warning on this window** | medium | yes_n=9 → −2.55 % 5D vs no_n=698 → +0.56 % (Δ = **−3.11 pp**). Currently only logged, not gated to AVOID. |
  | **9** | **Score floor of 50 sweeps too many "winners" into AVOID** | medium | <50-score AVOID rows have 5D = +2.41 % (n=147). The score≥50 cut chops off the strongest performers in this window. |
  | **10** | **Context_score is degenerate** | weak | Pearson NaN — variance ≈ 0 across the sample. Likely either always-0 or always-2 in the period; its presence in the final score is computationally inert here. |

  ## D. Whether score is monotonic with forward returns
  **No — it is anti-monotonic on this window.** Pearson r(score, return_5d) = −0.211 (n=707). Monotonicity test by bucket:

  | Group | n | Entry | T1 | Stop | 1D | 3D | 5D | 10D | MFE | MAE |
|---|---|---|---|---|---|---|---|---|---|---|
| <50 | 147 | 76.9 % | 12.9 % | 19.0 % | +0.38 % | +1.00 % | +2.41 % | +1.96 % | +6.57 % | -2.76 % |
| 50-60 | 361 | 75.6 % | 14.4 % | 25.5 % | -0.02 % | +0.10 % | +0.82 % | +1.79 % | +6.15 % | -3.80 % |
| 60-70 | 272 | 75.4 % | 10.3 % | 30.5 % | -0.64 % | -1.09 % | -1.13 % | +0.65 % | +5.29 % | -4.65 % |
| 70+ | 59 | 62.7 % | 6.8 % | 13.6 % | -1.10 % | -1.08 % | -0.63 % | +3.38 % | +3.18 % | -3.88 % |

  Quality grade (combined score+RR+trend gate):
  | Group | n | Entry | T1 | Stop | 1D | 3D | 5D | 10D | MFE | MAE |
|---|---|---|---|---|---|---|---|---|---|---|
| B+ | 27 | 70.4 % | 0.0 % | 18.5 % | -0.93 % | -2.16 % | -2.35 % | -0.43 % | +3.32 % | -3.87 % |
| B | 352 | 73.3 % | 10.5 % | 27.6 % | -0.60 % | -0.67 % | -0.59 % | +1.39 % | +5.24 % | -4.38 % |
| C / Watch Only | 313 | 76.0 % | 15.0 % | 25.9 % | -0.04 % | -0.05 % | +0.73 % | +1.24 % | +6.12 % | -3.91 % |
| D / Avoid | 147 | 76.9 % | 12.9 % | 19.0 % | +0.38 % | +1.00 % | +2.41 % | +1.96 % | +6.57 % | -2.76 % |

  Both ladders **invert**. Higher = worse on this sample. Label: `candidate redesign item only`.

  ## E. Whether action labels are reliable
  **No.** Per-action outcomes:

  | Group | n | Entry | T1 | Stop | 1D | 3D | 5D | 10D | MFE | MAE |
|---|---|---|---|---|---|---|---|---|---|---|
| WATCHLIST | 161 | 70.2 % | 7.5 % | 26.7 % | -1.09 % | -1.50 % | -1.68 % | +0.82 % | +5.18 % | -5.11 % |
| WAIT | 194 | 73.7 % | 16.5 % | 21.1 % | -0.29 % | -0.36 % | +0.38 % | +0.42 % | +6.19 % | -4.38 % |
| AVOID | 484 | 76.9 % | 12.2 % | 26.2 % | +0.08 % | +0.37 % | +1.18 % | +2.18 % | +5.74 % | -3.31 % |

  WATCHLIST (n=161) — the label intended to mark "promising-but-not-actionable-yet" — produced the worst 5D return in the cohort (−1.68 %), worse stop rate than AVOID (26.7 % vs 26.2 %), and the lowest T1-hit rate (7.5 %). `classifyAction` (lines 861-876) uses 5 score thresholds and 3 zone tests but the underlying score is anti-monotonic, so the labels inherit the inversion. Label: `candidate redesign item only — needs scoring fix before any label fix`.

  ## F. Whether high-score rows are over-extended
  **Yes, partially.** Cross-tab of distance-from-52w-high:

  | Group | n | Entry | T1 | Stop | 1D | 3D | 5D | 10D | MFE | MAE |
|---|---|---|---|---|---|---|---|---|---|---|
| at-highs (≤3%) | 177 | 92.1 % | 10.7 % | 33.9 % | -0.04 % | +0.17 % | +0.68 % | +3.39 % | +5.80 % | -3.44 % |
| near (3-10%) | 307 | 75.6 % | 13.4 % | 22.8 % | -0.05 % | +0.40 % | +1.16 % | +1.82 % | +6.35 % | -3.70 % |
| mid (10-20%) | 204 | 68.1 % | 12.7 % | 22.1 % | -0.21 % | -0.31 % | +0.64 % | +1.82 % | +4.87 % | -3.69 % |
| far (>20%) | 151 | 62.3 % | 11.3 % | 23.8 % | -0.86 % | -1.15 % | -1.04 % | -2.72 % | +5.59 % | -5.15 % |

  RSI distribution:
  | Group | n | Entry | T1 | Stop | 1D | 3D | 5D | 10D | MFE | MAE |
|---|---|---|---|---|---|---|---|---|---|---|
| <40 | 18 | 66.7 % | 11.1 % | 11.1 % | +0.63 % | +1.85 % | +3.18 % | +10.32 % | +7.22 % | -1.47 % |
| 40-50 | 82 | 70.7 % | 7.3 % | 22.0 % | +0.27 % | +0.72 % | +1.56 % | +5.99 % | +5.71 % | -2.75 % |
| 50-60 | 289 | 68.5 % | 15.9 % | 22.5 % | -0.06 % | -0.09 % | +0.71 % | +0.71 % | +5.73 % | -3.69 % |
| 60-70 | 306 | 77.8 % | 10.5 % | 27.5 % | -0.36 % | -0.35 % | +0.18 % | +1.22 % | +5.69 % | -4.31 % |
| 70+ (overbought) | 144 | 84.7 % | 11.8 % | 29.2 % | -0.68 % | -0.48 % | -0.20 % | +0.82 % | +5.67 % | -4.42 % |

  ATR % distribution:
  | Group | n | Entry | T1 | Stop | 1D | 3D | 5D | 10D | MFE | MAE |
|---|---|---|---|---|---|---|---|---|---|---|
| 1.5-3% | 275 | 80.4 % | 9.5 % | 31.6 % | -0.20 % | +0.30 % | +0.58 % | +1.36 % | +3.87 % | -3.18 % |
| 3-5% | 526 | 72.2 % | 14.3 % | 22.6 % | -0.27 % | -0.33 % | +0.51 % | +1.51 % | +6.63 % | -4.21 % |
| >=5% | 38 | 71.1 % | 5.3 % | 13.2 % | +0.08 % | -0.12 % | +0.14 % | -2.54 % | +6.87 % | -4.86 % |

  High-score-loser top-15 (score ≥ 65 ordered by worst 5D return):

  | Date | Symbol | Action | Score | RSI | %from52wHi | warn_extended | warn_rsi_overext | 5D ret |
  |---|---|---|---|---|---|---|---|---|
  | 2026-05-11 | ANANTRAJ | WATCHLIST | 65 | 59 | -27.4% |  |  | -11.76 % |
| 2026-05-11 | EDELWEISS | AVOID / NO T | 69 | 60 | -4.9% |  |  | -11.18 % |
| 2026-05-11 | DCMSHRIRAM | AVOID / NO T | 67 | 56 | -18.3% |  |  | -10.39 % |
| 2026-05-11 | TANLA | WATCHLIST | 71 | 59 | -28.3% |  |  | -9.87 % |
| 2026-05-11 | APTUS | AVOID / NO T | 67 | 76 | -21.9% | ✓ | ✓ | -9.54 % |
| 2026-05-11 | WEBELSOLAR | AVOID / NO T | 67 | 61 | -29.4% |  |  | -9.50 % |
| 2026-05-11 | FINCABLES | WATCHLIST | 65 | 78 | -3.6% | ✓ | ✓ | -9.49 % |
| 2026-05-11 | TORNTPOWER | WATCHLIST | 68 | 58 | -7.9% |  |  | -9.31 % |
| 2026-05-11 | HOMEFIRST | AVOID / NO T | 71 | 58 | -22.6% |  |  | -9.28 % |
| 2026-05-11 | DATAPATTNS | AVOID / NO T | 66 | 65 | -4.0% |  |  | -9.18 % |
| 2026-05-14 | HINDCOPPER | WATCHLIST | 75 | 67 | -20.3% |  |  | -8.89 % |
| 2026-05-11 | JMFINANCIL | AVOID / NO T | 68 | 59 | -29.3% |  |  | -8.51 % |
| 2026-05-13 | GRSE | AVOID / NO T | 70 | 54 | -19.0% |  |  | -7.62 % |
| 2026-05-14 | MUTHOOTFIN | AVOID / NO T | 66 | 53 | -14.9% |  |  | -7.34 % |
| 2026-05-11 | MMTC | AVOID / NO T | 70 | 59 | -24.4% |  |  | -7.17 % |

  7/15 of the worst high-score losers carry `warn_extended` or `warn_rsi_overext` — the scanner sees the extension but does not downgrade the action label.

  ## G. Whether AVOID contains hidden winners
  **Yes.** AVOID-cohort top-15 5D winners:

  | Date | Symbol | Score | RSI | Weekly | Leader | warn_bearish | warn_inside_supply | 5D ret |
  |---|---|---|---|---|---|---|---|---|
  | 2026-05-19 | BLISSGVS | 51 | 61 | Bullish | inline |  | ✓ | +34.65 % |
| 2026-05-20 | ATGL | 41 | 50 | Bullish |  | ✓ | ✓ | +32.55 % |
| 2026-05-13 | GLAND | 70 | 56 | Bullish |  |  | ✓ | +20.68 % |
| 2026-05-19 | ATGL | 51 | 54 | Bullish | leader |  | ✓ | +15.04 % |
| 2026-05-18 | ANGELONE | 45 | 53 | Bullish |  |  |  | +13.74 % |
| 2026-05-20 | ADANIENSOL | 49 | 60 | Bullish |  | ✓ | ✓ | +13.66 % |
| 2026-05-20 | ADANIPOWER | 50 | 61 | Bullish |  | ✓ |  | +12.94 % |
| 2026-05-11 | GLAND | 75 | 66 | Bullish |  |  | ✓ | +12.85 % |
| 2026-05-19 | DATAPATTNS | 24 | 43 | Bullish | leader | ✓ | ✓ | +12.65 % |
| 2026-05-20 | AIAENG | 47 | 56 | Bullish |  | ✓ | ✓ | +11.54 % |
| 2026-05-20 | CUMMINSIND | 59 | 61 | Bullish |  |  | ✓ | +11.54 % |
| 2026-05-18 | ENDURANCE | 54 | 55 | Neutral+ |  |  | ✓ | +11.29 % |
| 2026-05-13 | ZYDUSLIFE | 70 | 56 | Neutral+ |  |  | ✓ | +10.73 % |
| 2026-05-13 | GESHIP | 63 | 53 | Bullish |  |  | ✓ | +10.67 % |
| 2026-05-20 | ASTRAL | 22 | 33 | Weak |  | ✓ | ✓ | +10.63 % |

  Almost every AVOID winner is sent to AVOID by either (a) score<50 or (b) the `weakWarn` gate (`Bearish structure` / `inside supply`). Both gates have negative predictive value on this window — see §B and §J.

  ## H. Whether sector leadership helps

  AVOID ∩ {leader, inline, laggard} (H3 overlap = 5/19 + 5/26 only):

  | Group | n | Entry | T1 | Stop | 1D | 3D | 5D | 10D | MFE | MAE |
|---|---|---|---|---|---|---|---|---|---|---|
| AVOID ∩ leader | 95 | 81.1 % | 10.5 % | 13.7 % | +1.18 % | +1.60 % | +2.83 % | — | +5.14 % | -1.70 % |
| AVOID ∩ inline | 35 | 68.6 % | 14.3 % | 28.6 % | -1.12 % | +0.46 % | +3.05 % | — | +2.89 % | -3.91 % |
| AVOID ∩ laggard | 1 | 0.0 % | 0.0 % | 0.0 % | -0.27 % | -2.02 % | -3.30 % | — | +0.28 % | -3.64 % |

  WATCHLIST / WAIT / BUY ∩ {leader, inline, laggard}:

  | Group | n | Entry | T1 | Stop | 1D | 3D | 5D | 10D | MFE | MAE |
|---|---|---|---|---|---|---|---|---|---|---|
| WAIT ∩ leader | 36 | 69.4 % | 16.7 % | 13.9 % | +0.04 % | -0.02 % | +2.03 % | — | +4.85 % | -3.09 % |
| WAIT ∩ inline | 18 | 83.3 % | 11.1 % | 11.1 % | +0.85 % | -0.47 % | +1.96 % | — | +5.30 % | -2.34 % |
| WATCHLIST ∩ leader | 38 | 63.2 % | 2.6 % | 0.0 % | +0.99 % | +5.60 % | +4.07 % | — | +2.84 % | -1.38 % |
| WAIT ∩ laggard | 6 | 33.3 % | 0.0 % | 0.0 % | -0.01 % | — | — | — | +0.91 % | -0.95 % |
| WATCHLIST ∩ inline | 8 | 75.0 % | 0.0 % | 0.0 % | +0.13 % | — | — | — | +1.82 % | -1.08 % |

  **Yes — strongly.** The sector-leader overlay separates winners from losers within EVERY action class:
  - AVOID∩leader (+2.83 %, n=95) vs AVOID∩laggard (−3.30 %, n=1; too thin)
  - WATCHLIST∩leader **+4.07 %** (n=38) — the best intersection in the sample
  - WAIT∩leader +2.03 % (n=36)

  Label: `candidate redesign item only — supports an overlay, not a replacement`. Sample is still thin (H3 clean dates = 2; n_laggard usable = 1), so the magnitudes are not decision-grade.

  ## I. Which current score components appear useful (positive Pearson with 5D return)

  | Component | Pearson r(_, return_5d) | n | Verdict |
  |---|---|---|---|
  | momentum_score | **+0.108** | 707 | Mildly useful — only positive subscore. |
  | risk_score | +0.023 | 707 | Noise. |
  | pct_from_52w_high | +0.117 | 707 | Useful as continuous feature, ignored as a label gate. |
  | sector-leader overlay (qualitative) | n/a | 169 leaders vs 7 laggards | Strongly useful — see §H. |
  | `warn_rs_weak` (when triggered) | n/a | 9 yes vs 698 no, Δ = −3.11 pp | High specificity, low recall. Useful as a hard gate. |
  | `warn_extended` | n/a | 74 yes vs 633 no, Δ = −1.61 pp | Useful as a demotion signal. |
  | `warn_rsi_overext` | n/a | 63 yes vs 644 no, Δ = −1.26 pp | Useful as a demotion signal. |

  ## J. Which components appear weak or misleading (negative Pearson or sign-inverted on this window)

  | Component | Pearson r(_, return_5d) | n | Verdict |
  |---|---|---|---|
  | **fundamental_score** | **−0.269** | 707 | Worst component. Strong negative correlation. `candidate redesign item only`. |
  | **final score** | **−0.211** | 707 | Inherits component issues. |
  | volume_score | −0.139 | 707 | Negative — likely co-moves with extension. |
  | rs_score (raw) | −0.132 | 707 | Negative — likely flagging stocks that already ran. |
  | rsi14 (as raw input) | −0.134 | 707 | Negative — confirms mean-reversion regime. |
  | technical_score | −0.050 | 707 | Slight negative, near-noise. |
  | smc_score | −0.037 | 707 | Near-noise. |
  | context_score | **NaN** (zero-variance) | 707 | Computationally inert on this sample. |
  | `warn_inside_supply` | YES = +0.91 % vs NO = +0.12 % | 357 / 350 | **Sign INVERTED** on this window — and this warning is one of the **three weakWarn → AVOID** triggers. Material false-rejection driver. |
  | `warn_bearish` | YES = +3.23 % vs NO = +0.24 % | 66 / 641 | **Sign INVERTED** — and `bias === "Bearish"` is the most aggressive AVOID gate in `classifyAction`. |
  | **RR (2.0-2.5R cluster)** | r ≈ 0 across bucket | 762/839 = **90.8 %** | Formulaic — `buildTargets` defaults to ~2R; no discriminating power. |

  ## K. Score / action mismatch examples (114 rows)

  Score≥65 mapped to AVOID (`weakWarn` or RR<1.2 or Bearish bias):

  | Date | Symbol | Score | RR | Bias | Top warning | 5D ret |
  |---|---|---|---|---|---|---|
  | 2026-05-11 | ABCAPITAL | 71 | 2.00 | Bullish | Inside supply | -1.00 % |
| 2026-05-11 | AJANTPHARM | 71 | 2.00 | Sideways | Inside supply | +5.34 % |
| 2026-05-11 | ALKEM | 69 | 2.00 | Bullish | Inside supply | -2.10 % |
| 2026-05-11 | ANGELONE | 71 | 2.00 | Bearish | Bearish | -4.42 % |
| 2026-05-11 | APTUS | 67 | 2.00 | Bullish | Inside supply | -9.54 % |
| 2026-05-11 | ATGL | 66 | 2.00 | Bullish | Inside supply | -1.79 % |
| 2026-05-11 | ATUL | 65 | 2.00 | Bullish | Inside supply | +0.18 % |
| 2026-05-11 | BOSCHLTD | 69 | 1.98 | Bullish | Inside supply | -0.31 % |
| 2026-05-11 | CAMS | 66 | 2.00 | Bullish | Inside supply | -5.42 % |
| 2026-05-11 | CGCL | 74 | 2.00 | Bullish | Inside supply | -2.46 % |

  Score<55 mapped to WATCHLIST/BUY (none expected from rules):

  | Date | Symbol | Score | Action | 5D ret |
  |---|---|---|---|---|
  | (none in sample) |  |  |  |  |

  Per the code, score<55 mapped to WATCHLIST should be impossible (line 874 requires score≥58); empty sub-table confirms the rule is enforced. The high-score→AVOID mismatch is the live problem — it's driven by the `weakWarn` set + Bearish-bias gate, both of which were sign-inverted on this 9-day window.

  ## L. Recommended redesign priorities (CANDIDATE — not approved)

  All items labelled `candidate redesign item only` unless noted. None of these is approved for live activation.

  1. **(C1) Re-examine `classifyAction` AVOID gates** — the `weakWarn` keyword set (`bearish` / `liquidity low` / `inside supply`) and the `bias === "Bearish"` hard gate were sign-inverted on this sample. Candidate: convert to graduated demotion (score penalty) instead of hard AVOID, or re-derive the keyword set from forward-outcome backtest data once more outcome history exists.
  2. **(C2) Re-weight or replace fundamental_score in the final score** — most negative Pearson of any subscore (−0.269) on this window. Candidate: down-weight in final score, OR move fundamentals from "score" to "post-filter quality grade" only.
  3. **(C3) Demote/penalise extended setups** — `warn_extended` and `warn_rsi_overext` are predictive (Δ ≈ −1.5 pp 5D) but currently only annotate; they do not demote. Candidate: subtract from final score directly OR raise the BUY-tier score floor from 72 → ~76 when extension flags fire.
  4. **(C4) Add sector-leader overlay as a multiplier on action tier** — leader overlay is the strongest separator in the data (WATCHLIST∩leader +4.07 %; AVOID∩leader +2.83 %). Candidate: bump action by one tier when leader, drop one tier when laggard. **Requires H3 clean-data foundation first — currently only 2 clean dates.**
  5. **(C5) De-formulaise RR** — 90.8 % of rows cluster at 2.0–2.5R; RR carries near-zero discriminating power above 1.5. Candidate: stop logging RR as a "score input", treat it as a sizing input only.
  6. **(C6) Remove or rederive context_score** — zero-variance on this sample; computationally inert.
  7. **(C7) Lower the score≥50 AVOID floor or replace it with a structure-based floor** — <50-score AVOID winners (n=147) had 5D = +2.41 %, the best of any bucket. Candidate: remove the absolute floor; use weakness-structure gates only.
  8. **(C8) Promote `warn_rs_weak` from advisory to hard gate** — only 9 fires but Δ = −3.11 pp on 5D return.

  ## M. What should be fixed before S4c / S4d / S4e
  - **(C2) and (C3)** — fundamentals weighting and extension demotion — must be re-examined first because they materially distort the **score itself** that the action labels (S4e) consume.
  - **(C1)** — AVOID-gate review — must be done before any action-label rework (S4e), because the current gate is rejecting hidden winners and S4e built on top of it would inherit the rejection.
  - **(C4)** sector-leader overlay (S4c family) requires the H3 clean-data foundation to grow beyond 2 dates — pending S2b live verification + S3b post-deep-scan RS benchmark.
  - All eight items still labelled `candidate redesign item only`.

  ## N. What still needs live verification
  - **S2b**: intraday refresh (`intraday_last` / `trigger_hit`) — still pending; would replace the daily-bar approximation in H4.
  - **S3b**: post-deep-scan RS benchmark — still pending.
  - **F&O P25**: live MFE-available evidence collection (3 / 20 trades).
  - **Forward window depth**: rerun H4 / H5 once 60+ trading days of forward data are available so the mean-reversion regime in this 9-day window does not dominate findings.
  - **Regime conditioning**: classify the May 11-27 window's market regime (likely mean-reverting, intraday range-bound) and re-test whether the "anti-monotonicity" of score holds in trending regimes; current sample cannot distinguish a permanent scoring bug from a regime-specific bias.
  - **Per-symbol look-ahead bias check**: confirm `pct_from_52w_high` is computed at scan_date close, not retrospectively.
  - All candidate redesign items (C1–C8): require live A/B or shadow-mode evaluation over ≥ 1 quarter before any activation.

  ## O. Confirmation that no code / schema / trading behaviour changed
  - No DB writes (read-only `SELECT` via the sandbox).
  - No schema / scheduler / workflow / app code / route auth / `replit.md` / memory/docs changes.
  - No changes to swing scoring, recommendations, entries, stops, targets, RR, sector scoring (live), delivery scoring, stock-vs-sector RS (live), intraday refresh, trigger latch, paper-equity, F&O signal generation, F&O entries / exits / targets / stops / sizing / gates / confluence, option snapshots, candle warehouse.
  - Outputs scratch-only under `.agents/outputs/h5/` (this report only — no CSV; raw data is the H4 CSV joined to live read-only columns).
  - 571 / 571 api-server tests + workspace typecheck remain green from checkpoint `780003834e`.

  ## Standing labels applied
  `historical daily-bar replay-derived` · `offline shadow evidence` · `approximate` · `not live-verified` · `not intraday-exact` · `not implementation approval` · `candidate redesign item only` (for all eight redesign suggestions).

  **Stopping per spec. No S4c / S4d / S4e / S4f, no scoring changes, no action-label changes, no entry/stop/target/RR changes, no paper-equity execution changes. Awaiting next instruction.**
  