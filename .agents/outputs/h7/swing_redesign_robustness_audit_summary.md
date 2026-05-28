# H7 — Swing Redesign Robustness + Leakage Audit Report

  > **read-only / scratch-only / historical daily-bar replay-derived / offline shadow evidence / approximate / not live-verified / not intraday-exact / not implementation approval**
  > Pure offline validation of H6 / M6. No live scoring, action labels, entries, stops, targets, RR, trigger latch, intraday refresh, paper-equity, F&O, schema, scheduler, workflow, route auth, `replit.md`, or memory/docs changes. No S4c / S4d / S4e / S4f activation.

  ## A. Data used
  - **H4 outcome CSV** `.agents/outputs/h4/swing_daily_ohlc_outcome_replay.csv` — 839 rows usable (joined to extended scoring + warnings; from H5).
  - **H6 shadow simulation results** (in notebook state) — M0/M1/M2/M3/M5/M6 score functions reused identically.
  - **H3 sector-leader map** — leader_class on 2 clean dates (5/19 + 5/26).
  - **read-only DB query**: `SELECT scan_date, symbol, sector FROM swing_scan_result WHERE scan_date IN (8 dates)` — backfilled 398 missing sectors so the per-sector slice was on 100 % coverage. No writes.
  - **Code inspection** of `artifacts/api-server/src/lib/swingScanner.ts` for leakage audit only — no edits.
  - Scope: 8 scan dates × NIFTY 500. 7 dates have ≥1 row with return_5d (5/26 too recent for 5D forward window). 707 rows have 5D forward.

  ## B. Validation approach
  Each test runs M0 (baseline) and M6 (combined H6 candidate) on the **identical** sub-sample, computes Pearson(shadow, return_5d), Spearman, Q5−Q1 5D, and reports the delta M6−M0. The M6 formula has **no fitted parameters** (all magnitudes are H5-derived round constants), so leave-one-date-out cannot "re-train" — it can only measure out-of-sample stability.

  ## C. Date-by-date robustness (Table A)
  | Date | n | nR5 | M0 Q5 | M0 Q1 | M0 Q5−Q1 | M6 Q5 | M6 Q1 | M6 Q5−Q1 | M6 beats M0 |
  |---|---|---|---|---|---|---|---|---|---|
  | 2026-05-11 | 159 | 159 | -2.29 % | -5.72 % | +3.43 % | -3.48 % | -2.43 % | -1.05 % | ✗ |
| 2026-05-13 | 111 | 111 | +1.07 % | +0.49 % | +0.58 % | -1.46 % | +1.37 % | -2.83 % | ✗ |
| 2026-05-14 | 118 | 118 | -0.50 % | -0.56 % | +0.06 % | +0.76 % | -0.70 % | +1.45 % | ✓ |
| 2026-05-15 | 10 | 10 | +7.55 % | +1.72 % | +5.83 % | +7.55 % | +1.98 % | +5.57 % | ✗ |
| 2026-05-18 | 98 | 98 | +2.95 % | +2.86 % | +0.09 % | +3.15 % | +3.44 % | -0.29 % | ✗ |
| 2026-05-19 | 106 | 106 | +1.52 % | +2.83 % | -1.31 % | +1.10 % | +2.01 % | -0.91 % | ✓ |
| 2026-05-20 | 105 | 105 | +2.25 % | +4.43 % | -2.17 % | +1.94 % | +2.30 % | -0.36 % | ✓ |
| 2026-05-26 | 132 | 0 | — | — | — | — | — | — | (no R5) |

  **M6 beats M0 on 3/7 evaluable dates (43 %).** On 2026-05-11 and 2026-05-13 M6 is actively worse (ΔQ5−Q1 = −4.48 pp and −3.40 pp respectively). On 2026-05-14, 2026-05-19, 2026-05-20 M6 helps. On 5-15 (n=10) and 5-18 (n=98) M6 is essentially neutral. The headline +1.02 pp Q5−Q1 improvement is therefore not date-stable; it is the **average** of three positive dates outweighing two negative dates. The full-sample improvement is not the result of a uniform per-date pattern.

  ## D. Leave-one-date-out results (Table B)
  M6 is parameter-free, so "leave-one-out" measures only how strongly each single date's removal moves the headline. Held-out-date deltas (M6 − M0):

  | Held-out date | n | nR5 | M0 Pearson (held) | M6 Pearson (held) | ΔPearson | ΔQ5−Q1 5D |
  |---|---|---|---|---|---|---|
  | 2026-05-11 | 159 | 159 | 0.129 | -0.008 | -0.137 | -4.48 % |
| 2026-05-13 | 111 | 111 | -0.063 | -0.150 | -0.087 | -3.40 % |
| 2026-05-14 | 118 | 118 | -0.008 | 0.079 | 0.087 | +1.40 % |
| 2026-05-15 | 10 | 10 | 0.104 | 0.039 | -0.065 | -0.25 % |
| 2026-05-18 | 98 | 98 | -0.050 | -0.042 | 0.008 | -0.38 % |
| 2026-05-19 | 106 | 106 | -0.185 | -0.021 | 0.164 | +0.40 % |
| 2026-05-20 | 105 | 105 | -0.167 | -0.080 | 0.087 | +1.81 % |
| 2026-05-26 | 132 | 0 | — | — | — | — |

  LODO summary: **M6 wins on the held-out date in 3/7 cases (43 %).** On 5-11 (the largest single date, 159 rows) the held-out delta is ΔPearson = −0.137 — M6 is strictly worse on that date in isolation. Headline +0.053 Pearson is driven by 5-19 (+0.164), 5-20 (+0.087), 5-14 (+0.087), and partially offset by 5-11 / 5-13 negatives.

  ## E. Sector robustness (Table C)
  Sectors with n ≥ 15:

  | Sector | n | nR5 | M0 Pearson | M6 Pearson | ΔPearson | ΔQ5−Q1 5D |
  |---|---|---|---|---|---|---|
  | Capital Goods | 127 | 103 | -0.355 | 0.047 | 0.402 | +9.66 % |
| Pharma | 107 | 90 | 0.009 | 0.171 | 0.162 | +1.68 % |
| Financials | 104 | 92 | -0.332 | -0.036 | 0.295 | +4.58 % |
| Energy | 75 | 63 | -0.492 | 0.099 | 0.591 | +14.77 % |
| Chemicals | 58 | 47 | -0.426 | 0.083 | 0.509 | +6.75 % |
| Auto | 56 | 45 | -0.335 | -0.023 | 0.313 | +6.64 % |
| FMCG | 47 | 40 | 0.081 | 0.260 | 0.179 | +2.10 % |
| Banking | 47 | 40 | -0.399 | 0.046 | 0.445 | +4.70 % |
| Metals | 43 | 37 | -0.137 | 0.088 | 0.225 | +3.06 % |
| Consumer Discretionary | 41 | 37 | 0.035 | 0.098 | 0.063 | +0.37 % |
| Healthcare | 27 | 21 | 0.529 | 0.214 | -0.315 | -9.90 % |
| Logistics | 26 | 22 | 0.018 | -0.393 | -0.410 | -3.45 % |
| Cement | 16 | 15 | -0.113 | 0.148 | 0.261 | +5.83 % |

  **M6 ΔPearson positive in 11/13 sectors (85 %).** Improvement is broad: it works in Capital Goods, Pharma, Financials, Energy, Chemicals, Auto, FMCG, Banking, Metals, Consumer Discretionary, Cement. **Fails in Healthcare** (ΔPearson −0.315, n=27) and **Logistics** (ΔPearson −0.410, n=26). Both failing sectors are small (n<30) so the magnitudes are not decision-grade in isolation, but the direction is wrong in both — a real risk if M6 ever ran live. Improvement is **not** concentrated in a single dominant sector — Energy and Capital Goods both show large gains but Pharma, Financials, Auto, Banking all do too.

  ## F. Action-class robustness (Table D)
  Note: the H4/H5 sample contains **0 BUY-class rows** — the universe is WATCHLIST / WAIT / AVOID only. Cannot test BUY in this audit.

  | Action class | n | M0 Pearson | M6 Pearson | M0 Q5−Q1 | M6 Q5−Q1 | ΔPearson | ΔQ5−Q1 |
  |---|---|---|---|---|---|---|---|
  | WATCHLIST | 161 | -0.072 | -0.017 | -0.97 % | +1.24 % | 0.055 | +2.22 % |
| AVOID | 484 | -0.220 | -0.033 | -3.80 % | -0.05 % | 0.187 | +3.75 % |
| WAIT | 194 | -0.067 | 0.175 | -1.54 % | +2.36 % | 0.242 | +3.90 % |

  **M6 improves all 3 action classes** (ΔQ5−Q1 positive everywhere). Most striking: WAIT-class rows — M6 Pearson +0.175 vs M0 −0.067, ΔQ5−Q1 = +3.90 pp. M6 is **not** merely a re-ranking artefact of the AVOID cohort.

  ## G. Component ablation (Table E)
  M6 minus each component, full sample, n_R5 = 707:

  | Variant | Pearson | Q5−Q1 5D | Pearson loss vs M6 | % of M6 gain (Δ vs M0=−0.211) lost |
  |---|---|---|---|---|
  | M6 (full) | +0.053 | +1.02 % | 0.000 | 0 % |
  | M6 − fundamentals downweight | **−0.132** | **−2.64 %** | **0.185** | **70 %** |
  | M6 − overextension penalty | +0.023 | +0.50 % | 0.030 | 11 % |
  | M6 − leader overlay | +0.034 | +0.48 % | 0.019 | 7 % |
  | M6 − warn_rs_weak penalty | +0.044 | +0.89 % | 0.008 | 3 % |

  **Fundamentals downweight carries ~70 % of M6's improvement on its own.** Extension penalty contributes ~11 %, leader overlay ~7 %, warn_rs_weak ~3 %. The combined model's headline number is dominated by **one** component; the other three are small additive perturbations.

  ## H. Simpler model comparison (Table F)
  Full sample, n_R5 = 707:

  | Model | Pearson | Spearman | Q5−Q1 5D | Components |
  |---|---|---|---|---|
  | M0 | −0.211 | −0.255 | −3.83 % | (baseline) |
  | M1 | −0.011 | +0.028 | −0.00 % | fund |
  | M1+M5 | −0.000 | +0.038 | +0.21 % | fund + rs_weak |
  | M1+M3 | +0.013 | +0.059 | +0.41 % | fund + leader |
  | M1+M2 | +0.025 | +0.023 | +0.30 % | fund + extension |
  | **M1+M2+M5** | **+0.034** | +0.031 | +0.48 % | fund + extension + rs_weak |
  | M6 (M1+M2+M3+M5) | +0.053 | +0.058 | +1.02 % | all four |

  **M1+M2+M5 captures Pearson +0.034 with three components versus M6's +0.053 with four** — i.e. 64 % of the M6 gain with one fewer parameter and zero dependence on the H3 sector-leader overlay (which today has only 2 clean dates and 1 laggard). The extra +0.019 Pearson that M6 adds over M1+M2+M5 is entirely the leader-overlay piece, and only ~169/707 rows even carry a leader_class — i.e. the overlay's contribution is supported by a thin slice.

  **Simpler-model verdict**: **M1+M2+M5 is preferred over M6.** Same direction, almost the same magnitude, no dependence on the still-thin H3 overlay, lower over-fitting surface. Label: `simpler candidate shadow model`.

  ## I. Leakage audit (Tables G, I, J)

  Code-inspection method: walked `artifacts/api-server/src/lib/swingScanner.ts` (~1 100 lines) — `buildDailyOhlc`, `addIndicators`, `classifyMarketStructure`, `scoreAndPlan`, `buildTargets`, `computeSwingScore` — and confirmed the lookups inside each subscore use only `bars[i]` for `i ≤ scan_index`. Field-by-field assessment:

  ### Fields SAFE at scan time (Table I)

  | Field | Computed from | Verdict |
  |---|---|---|
  | `score`, `technical_score`, `smc_score`, `volume_score`, `momentum_score` | prior daily bars only | **safe** |
  | `fundamental_score`, `fundamental_status` | static fundamentals snapshot ingested out-of-band, not future-derived | **safe** (but see §J) |
  | `risk_score` | derived from `atr_pct`, `vol_ratio`, `adx14`, RR | **safe** |
  | `context_score` | regime classifier on prior bars | **safe** (also zero-variance per H6) |
  | `rs_score` | trailing 20/50/120-bar relative strength | **safe** |
  | `rsi14`, `adx14`, `atr_pct`, `vol_ratio` | prior daily OHLC | **safe** |
  | `pct_from_52w_high`, `pct_from_52w_low` | 252-bar trailing window | **safe IF the 252 window ends at scan_index** — see §J |
  | `weekly_trend`, `market_structure` | trailing bars only | **safe** |
  | `buy_zone_lower`, `buy_zone_upper`, `entry`, `stop_loss`, `target1` | derived from `close_price` + ATR + recent swing | **safe** (deterministic from scan-time inputs) |
  | `rr_to_t1` | derived | **safe** |
  | warning flags (`warn_*`) | derived from above | **safe if inputs safe** |
  | H4/H5 forward returns (`return_1d/3d/5d/10d/20d`, `mfe`, `mae`) | **future** Yahoo bars after scan | **future by design — outcome labels, never used as features** |

  ### Fields with leakage RISK (Table J)

  | Field | Risk | Severity |
  |---|---|---|
  | `close_price` (scan day's close) | If the scanner ran intraday and `close_price` was filled with that day's *partial* OHLC after market close, the close itself is "scan-time-safe" but `entry / stop / target` derived from it assume that close was final. If the scan in production runs **after** 15:35 IST (per replit.md "deep scan once-per-day after 15:35 IST"), this is safe. **Risk: only if the same-day close was used while the bar was still forming.** | **low (post-15:35 schedule mitigates)** |
  | `leader_class` (H3 sector-leader map) | H3 computed sector RS using closes from the same scan_date. The 2 clean H3 dates (5/19 + 5/26) include the scan-day close itself. If sector-RS uses the **scan_date close** to rank sectors, the leader_class for each stock is therefore computed from a price that *includes* the same close the stock was scored at — **NOT future, but circular**: stocks that closed strongly that day are more likely to be ranked into a "leader" sector, then awarded the M3 +6 bonus, then evaluated against forward returns starting at next bar's open. This is **not look-ahead bias** but it is **close-to-circular** at the day boundary. | **medium — needs verification of H3 timing** |
  | `pct_from_52w_high` | If the 252-bar trailing window includes the *current* bar, that's fine. If `addIndicators` uses `Math.max(...closes)` over a window that includes a forward bar, that would be leakage. Code spot-checked: looks correct (uses `bars.slice(scan_index − 251, scan_index + 1)`). | **low (but recommend explicit test)** |
  | `outcome_label` / forward return / MFE / MAE | These ARE forward bars. They are correctly used only as labels, never as features. No leakage as long as no model formula reads them. Confirmed M0–M6 formulas read only score / fundamental_score / rsi14 / pct_from_52w_high / warn_* / leader_class. | **none (used as labels only)** |
  | Yahoo `.NS` daily bar from H4 (used to compute forward outcomes) | Different data source than the scanner's bars; using a *different* close source for the same date can introduce reconciliation noise. H4 already flagged 0.2 % same-day stop/target ambiguity. | **none for leakage; noise contributor for outcomes** |

  **No CRITICAL leakage detected.** One **medium-severity** item: the H3 leader_class is computed from sector-closes that include the scan_date — this is not future-bias but it is close to circular at the day boundary. Recommendation: **before any M3-component activation, run an explicit "next-day-leader_class" variant where leader is computed only from closes ≤ scan_date−1** and re-test M6's improvement. If M6 still helps with the lagged leader, the overlay is safe; if not, the leader contribution is mostly circular.

  ## J. Outcome-bias audit (Table H)

  | Bias source | Present in sample? | Impact |
  |---|---|---|
  | Daily-bar approximation (H4 used daily bars, not intraday) | Yes — flagged in H4 (0.2 % same-day ambiguous) | Low impact on aggregate; would inflate stop-rate slightly for high-ATR rows |
  | Shrinking forward window near current date | **Yes — 5-26 has 132 rows but 0 with return_5d**; 5-20 has 105 rows with 5D return but no 20D | M6 / M0 5D comparison is therefore done on 7 dates not 8; outcome quality degrades toward the right end of the sample window |
  | Missing BUY rows | **Yes — 0 BUY rows in 839-row sample** | Cannot test M6's effect on the action class that would actually trigger paper-equity auto-opens. **Material gap.** |
  | AVOID-dominated sample | **Yes — 484/839 (58 %) are AVOID** | M6's "hidden winners" finding is largely a re-ranking inside the AVOID cohort. The action-class slice in §F confirms M6 helps WAIT and WATCHLIST too, but the headline number is weighted by AVOID rows. |
  | Yahoo `.NS`/`.BO` coverage gaps | Partial (some symbols missing forward bars → 132 rows have no return_5d) | Excluded from monotonicity tests — small bias |
  | Same-day stop/target ambiguity | Yes (0.2 %) | Negligible at aggregate level |
  | Survivorship from current NIFTY 500 universe | **Yes — the scan universe was today's NIFTY 500, not the universe as of each scan date** | Mild positive bias on every model equally (constants subtract out in M6−M0 deltas); does **not** invalidate the M6-vs-M0 comparison but does invalidate absolute return claims |

  ## K. Whether M6 remains the best candidate
  **No — not on this evidence.** M6 *is* the best of the seven H6 candidates by headline Pearson (+0.053). But the H7 stress-tests reveal:
  - M6 wins on only **3/7** dates and on only **3/7** held-out LODO trials (both 43 %).
  - M6's improvement is **dominated by the fundamentals-removal component** (70 % of the Pearson gain).
  - M6 fails in 2 of 13 sectors (Healthcare ΔPearson −0.315, Logistics −0.410); both small sectors, but the wrong-direction is material.
  - The leader-overlay component (which adds the marginal +0.019 Pearson over M1+M2+M5) carries a **medium-severity circularity concern** at the day boundary and only ~169 rows even carry a leader_class.
  - **0 BUY rows** in the sample — M6 has not been tested on the action class it would matter most for.

  ## L. Whether a simpler model is preferable
  **Yes.** **M1+M2+M5** captures 64 % of M6's headline Pearson gain with:
  - one fewer component,
  - no dependence on the H3 leader overlay (which is thin and circularity-suspect),
  - explicit, fully data-supported H5 grounding for each of its three components,
  - the same all-positive action-class behaviour.

  Recommended label: `simpler candidate shadow model` — preferred over M6 for any future shadow-mode evaluation.

  If even simpler is desired, **M1 alone** (single `score − fundamental_score` subtraction) flattens Pearson to ≈ 0 (−0.011) — i.e. it eliminates the inversion completely. It does not produce positive monotonicity by itself, but it removes the worst component of the current scoring. **M1 is the smallest defensible step.**

  ## M. Whether evidence is enough for live shadow-mode implementation
  **No.** Even setting aside the H7 robustness shortfalls, three hard prerequisites are unmet:
  1. **0 BUY rows tested** — the action class that would actually drive live behaviour is missing from the evidence base.
  2. **Date-by-date instability** (43 % win rate) means a single trending week could erase the apparent gain.
  3. **Sample is 9-day mean-reverting** — regime-conditioned re-evaluation has not been done. The "fundamentals correlate negatively with forward return" finding may be a **regime artefact** that flips in trending tape.
  4. **Medium-severity leader_class circularity** unresolved (M3 component).

  What *would* be enough: a **live shadow-mode run** that computes the candidate shadow score alongside the live score for ≥1 quarter, **never acts on it**, logs both scores + outcomes to disk for later comparison. Shadow-mode is the *measurement* step — not the implementation step. None of the live behaviours (recommendations / entries / stops / targets / RR / action labels / paper-equity / F&O) would change during shadow-mode.

  H7 itself **does not approve** even shadow-mode activation. That would require a separate explicit approval decision.

  ## N. What still requires live verification
  - **Forward-window depth ≥ 60 trading days** before any monotonicity claim is generalisable.
  - **Trending-regime re-evaluation** — sample period (May 11-27, 2026) is mean-reverting; re-test on a trending tape.
  - **70/30 scan-date train/test split** once ≥ 30 distinct dates exist.
  - **BUY-class coverage**: re-run H4 → H7 once the sample contains material BUY rows.
  - **H3 leader_class lagged variant**: compute leader_class from closes ≤ scan_date−1 and re-test §I medium-risk finding.
  - **`pct_from_52w_high` window-bounds explicit unit test**: confirm window is `[scan_index − 251, scan_index]`, not `[..., scan_index + 1]`.
  - **S2b** intraday refresh, **S3b** post-deep-scan RS benchmark, **F&O P25** (3 / 20 trades) — all still pending and unrelated to swing redesign.
  - **Live shadow-mode** of M1+M2+M5 (or M1 alone) — not approved here; would require a separate decision and is the prerequisite to any implementation approval.

  ## O. Confirmation that no code / schema / trading behaviour changed
  - No DB writes (read-only SELECT only via the sandbox).
  - No schema / scheduler / workflow / app code / route auth / `replit.md` / memory/docs changes.
  - No changes to swing scoring, recommendations, action labels, entries, stops, targets, RR, trigger latch, intraday refresh, paper-equity, F&O signal generation, F&O entries / exits / targets / stops / sizing / gates / confluence, option snapshots, candle warehouse.
  - Outputs scratch-only under `.agents/outputs/h7/`: `swing_redesign_robustness_audit.csv` (94 slices × 12 cols) + this summary.
  - No git commit of the outputs (per spec).
  - 571 / 571 api-server tests + workspace typecheck remain unchanged from checkpoint `8e1bad41dfc`.

  ## Standing labels applied
  `historical daily-bar replay-derived` · `offline shadow evidence` · `approximate` · `not live-verified` · `not intraday-exact` · `not implementation approval`

  ## Verdict
  - **No live scoring changes approved.**
  - **No action-label changes approved.**
  - **No entry / stop / target / RR changes approved.**
  - **No paper-equity execution changes approved.**
  - **No S4c / S4d / S4e / S4f approved.**
  - M6 status: `overfit risk too high` for live activation (wins 43 % of dates / LODO trials; ~70 % of gain from one component; 2 / 13 sectors wrong-direction; 0 BUY rows tested; medium-severity circularity unresolved).
  - Best simpler alternative: **M1+M2+M5** → `simpler candidate shadow model` (preferred over M6 for any future shadow-mode discussion; **not approved for shadow-mode activation here**).
  - Smallest defensible step: **M1 alone** (single `score − fundamental_score` subtraction) — eliminates the score inversion without claiming positive monotonicity.
  - Leakage audit verdict: **no critical leakage; one medium-severity circularity** on H3-derived leader_class — `do not proceed with M3 component until leader_class lagged-variant test is done`.

  **S2b / S3b / F&O P25 still pending. S4c / S4d / S4e / S4f not approved. Stopping per spec. Awaiting next instruction.**
  